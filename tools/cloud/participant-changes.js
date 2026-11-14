const stableStringify = require('fast-json-stable-stringify');
const { CloudError } = require('./cloud-error.js');
const { participantDelta } = require('./participant-state.js');
const { cloudOwnerDelta } = require('../../src/campaigns/CloudOwnerProtocol.js');
const { isCloudUUID, isCloudParticipantRequest } = require('../../src/campaigns/CloudProtocol.js');

const accessDenials = new Set([
  'campaign-not-found',
  'campaign-access-changed',
  'live-session-paused',
  'live-session-changed',
  'pilot-access-required',
  'invalid-account-eligibility',
]);
const unavailable = () =>
  new CloudError(
    503,
    'participant-observation-unavailable',
    'Live campaign changes are temporarily unavailable'
  );

function synchronousListener(result) {
  if (typeof result?.then !== 'function') return;
  void Promise.resolve(result).catch((error) => {
    console.error('[cloud-participant-listener]', {
      code: 'participant-listener-rejection',
      kind: error instanceof Error ? 'error' : 'non-error',
    });
  });
  throw new Error('Participant listeners must enqueue events synchronously');
}

class ParticipantChanges {
  constructor(store) {
    this.store = store;
    this.groups = new Map();
  }

  subscribe(principal, id, command, expected, callbacks, ownerWorld = false) {
    const scope = this.store._accessExpectation(expected);
    if (
      !isCloudUUID(id) ||
      !isCloudParticipantRequest(command) ||
      !scope ||
      (ownerWorld && scope.seatId !== null) ||
      (scope.seatId === null &&
        [command.observerTokenId, command.mapId, command.assetKey].some((value) => value !== null))
    )
      throw new CloudError(
        400,
        'invalid-participant-request',
        'Choose current live campaign access'
      );
    if (typeof callbacks?.onEvent !== 'function' || typeof callbacks?.onError !== 'function')
      throw new Error('Participant observation requires event and error listeners');
    let resolve;
    let reject;
    const ready = new Promise((accepted, denied) => {
      resolve = accepted;
      reject = denied;
    });
    const viewer = {
      principal,
      ownerWorld,
      id,
      command: structuredClone(command),
      scope,
      callbacks,
      resolve,
      reject,
      settled: false,
      closed: false,
      group: null,
      previous: null,
      cachedAssets: null,
    };
    void this._admit(viewer).catch((error) => this._fail(viewer, error));
    return {
      ready,
      close: () => {
        if (!viewer.settled) {
          viewer.settled = true;
          viewer.reject(
            new CloudError(
              409,
              'participant-observation-closed',
              'Participant observation was closed'
            )
          );
        }
        this._remove(viewer);
      },
    };
  }

  async _admit(viewer) {
    const admitted = await this.store.getLiveAccess(viewer.principal, viewer.id, {
      sessionId: viewer.command.sessionId,
    });
    if (viewer.closed) return;
    if (
      admitted.participant.access.role !== (viewer.scope.seatId === null ? 'owner' : 'member') ||
      admitted.participant.access.seatId !== viewer.scope.seatId ||
      admitted.participant.access.accessGeneration !== viewer.scope.accessGeneration
    )
      throw new CloudError(409, 'campaign-access-changed', 'Refresh current player access');
    let group = this.groups.get(viewer.id);
    if (group && group.sessionId !== viewer.command.sessionId) {
      this._failGroup(
        group,
        new CloudError(409, 'live-session-changed', 'Reconnect to the live game')
      );
      group = null;
    }
    if (!group) {
      group = {
        id: viewer.id,
        sessionId: viewer.command.sessionId,
        viewers: new Set(),
        stops: [],
        closed: false,
        dirty: false,
        running: false,
        frame: null,
        signals: new Map(),
      };
      this.groups.set(viewer.id, group);
    }
    viewer.group = group;
    group.viewers.add(viewer);
    if (!group.stops.length) this._start(group);
    this._schedule(group);
  }

  _start(group) {
    const campaign = this.store.firestore.collection('campaigns').doc(group.id);
    const signal = (kind, value) => {
      const fingerprint = stableStringify(value);
      if (group.signals.get(kind) === fingerprint) return;
      group.signals.set(kind, fingerprint);
      this._schedule(group);
    };
    const failed = (error) => {
      console.error('[cloud-change-observer]', {
        code: 'participant-observation-failed',
        kind: error instanceof Error ? 'error' : 'non-error',
      });
      this._failGroup(group, unavailable());
    };
    group.stops.push(
      campaign.onSnapshot((snapshot) => signal('head', snapshot.data()?.generation ?? null), failed)
    );
    group.stops.push(
      campaign
        .collection('liveSession')
        .doc('current')
        .onSnapshot((snapshot) => {
          const value = snapshot.data();
          signal(
            'live',
            value
              ? {
                  generation: value.generation,
                  state: value.state,
                  sessionId: value.sessionId,
                }
              : null
          );
        }, failed)
    );
    group.stops.push(
      campaign.collection('seats').onSnapshot(
        (snapshot) =>
          signal(
            'access',
            snapshot.docs.map((row) => {
              const value = row.data();
              return {
                id: row.id,
                memberUid: value.memberUid,
                accessGeneration: value.accessGeneration ?? 0,
                characterIds: value.characterIds,
              };
            })
          ),
        failed
      )
    );
  }

  _schedule(group) {
    if (group.closed) return;
    group.dirty = true;
    if (group.running) return;
    group.running = true;
    void this._drain(group)
      .catch((error) => this._failGroup(group, error))
      .finally(() => {
        group.running = false;
        if (group.dirty && !group.closed) this._schedule(group);
      });
  }

  _load(group, head) {
    const key = stableStringify({
      generation: head.generation,
      sceneRef: head.sceneRef,
      charactersRef: head.charactersRef,
    });
    if (group.frame?.key === key) return group.frame.promise;
    const frame = { key, head, promise: this.store._loadSnapshot(head) };
    group.frame = frame;
    void frame.promise.catch(() => {
      if (group.frame === frame) group.frame = null;
    });
    return frame.promise;
  }

  async _drain(group) {
    while (group.dirty && !group.closed) {
      group.dirty = false;
      const values = await Promise.all(
        [...group.viewers].map(async (viewer) => {
          try {
            if (viewer.scope.seatId === null && !viewer.ownerWorld) {
              const owner = await this.store._ownerLiveHead(
                viewer.principal,
                viewer.id,
                viewer.command,
                viewer.scope
              );
              if (viewer.previous && owner.head.generation < viewer.previous.head.generation)
                throw new CloudError(
                  503,
                  'invalid-change-history',
                  'The committed campaign revision moved backwards'
                );
              return viewer.closed ? null : { viewer, owner };
            }
            const next = viewer.ownerWorld
              ? await this.store._ownerWorldSnapshot(
                  viewer.principal,
                  viewer.id,
                  { sessionId: viewer.command.sessionId },
                  viewer.scope,
                  (head) => this._load(group, head)
                )
              : await this.store._participantSnapshot(
                  viewer.principal,
                  viewer.id,
                  {
                    ...viewer.command,
                    assetKey: viewer.previous?.state.publicScene.assetKey ?? null,
                  },
                  viewer.scope,
                  (head) => this._load(group, head)
                );
            if (viewer.previous && next.generation < viewer.previous.generation)
              throw new CloudError(
                503,
                'invalid-change-history',
                'The committed campaign revision moved backwards'
              );
            return viewer.closed ? null : { viewer, next };
          } catch (error) {
            if (error.code === 'participant-state-changed') {
              group.dirty = true;
              return null;
            }
            this._fail(viewer, error);
            return null;
          }
        })
      );
      if (group.closed) return;
      const ready = values.filter(Boolean);
      const advancing = ready.filter(
        ({ viewer, next }) =>
          (viewer.scope.seatId !== null || viewer.ownerWorld) &&
          viewer.previous &&
          next.generation > viewer.previous.generation
      );
      let history = null;
      if (advancing.length) {
        const chosen = advancing[0].viewer;
        const afterGeneration = Math.min(
          ...advancing.map(({ viewer }) => viewer.previous.generation)
        );
        try {
          history = await this.store._participantCommittedChanges(
            chosen.principal,
            group.id,
            chosen.command,
            chosen.scope,
            afterGeneration
          );
        } catch (error) {
          if (!accessDenials.has(error.code)) throw error;
          this._fail(chosen, error);
          group.dirty = true;
          continue;
        }
      }
      for (const { viewer, next, owner } of ready) {
        if (viewer.closed || group.closed) continue;
        if (owner) {
          if (!viewer.previous || owner.head.generation > viewer.previous.head.generation) {
            viewer.previous = owner;
            this._emit(viewer, owner);
          }
          continue;
        }
        if (history && next.generation !== history.headGeneration) {
          group.dirty = true;
          continue;
        }
        if (viewer.ownerWorld) {
          let event;
          if (!viewer.previous) event = { kind: 'owner-checkpoint', checkpoint: next };
          else if (next.generation === viewer.previous.generation) continue;
          else if (history?.resync || next.generation !== viewer.previous.generation + 1)
            event = { kind: 'owner-resync', checkpoint: next };
          else {
            try {
              const presentations = group.frame?.head.presentationRef
                ? await this.store._ownerWorldPresentations(
                    viewer.principal,
                    group.id,
                    viewer.command,
                    viewer.scope,
                    viewer.previous,
                    next,
                    group.frame
                  )
                : [];
              event = {
                kind: 'owner-delta',
                delta: cloudOwnerDelta(viewer.previous, next, presentations),
              };
            } catch (error) {
              if (error.code === 'participant-state-changed') {
                group.dirty = true;
                continue;
              }
              this._fail(viewer, error);
              continue;
            }
          }
          viewer.previous = next;
          this._emit(viewer, event);
          continue;
        }
        let event;
        if (!viewer.previous) {
          const cached =
            viewer.command.assetKey !== null &&
            viewer.command.assetKey === next.state.publicScene.assetKey;
          event = {
            kind: 'checkpoint',
            checkpoint: cached
              ? {
                  ...next,
                  state: {
                    ...next.state,
                    publicScene: { ...next.state.publicScene, assets: null },
                  },
                }
              : next,
          };
        } else if (next.generation === viewer.previous.generation) continue;
        else if (history?.resync || next.generation !== viewer.previous.generation + 1)
          event = { kind: 'resync', checkpoint: next };
        else {
          const delta = participantDelta(viewer.previous, next, {
            cachedAssets: viewer.cachedAssets,
          });
          if (delta.kind === 'update' && group.frame?.head.presentationRef) {
            try {
              const presentations = await this.store._participantPresentations(
                viewer.principal,
                group.id,
                viewer.command,
                viewer.scope,
                viewer.previous,
                next,
                group.frame
              );
              if (presentations.length) delta.presentations = presentations;
            } catch (error) {
              if (error.code === 'participant-state-changed') {
                group.dirty = true;
                continue;
              }
              this._fail(viewer, error);
              continue;
            }
          }
          event = { kind: 'delta', delta };
        }
        viewer.previous = next;
        if (next.state.publicScene.assets) viewer.cachedAssets = next.state.publicScene.assets;
        if (next.state.publicScene.assetKey === null) viewer.cachedAssets = null;
        this._emit(viewer, event);
      }
    }
  }

  _emit(viewer, event) {
    if (viewer.closed) return;
    try {
      synchronousListener(viewer.callbacks.onEvent(structuredClone(event)));
      if (!viewer.settled) {
        viewer.settled = true;
        viewer.resolve();
      }
    } catch (error) {
      console.error('[cloud-participant-listener]', {
        code: 'participant-listener-failed',
        kind: error instanceof Error ? 'error' : 'non-error',
      });
      this._fail(
        viewer,
        new CloudError(
          503,
          'participant-listener-failed',
          'The participant event could not be accepted'
        )
      );
    }
  }

  _fail(viewer, error) {
    if (viewer.closed) return;
    this._remove(viewer);
    if (!viewer.settled) {
      viewer.settled = true;
      viewer.reject(error);
    }
    try {
      synchronousListener(viewer.callbacks.onError(error));
    } catch (failure) {
      console.error('[cloud-participant-listener]', {
        code: 'participant-error-listener-failed',
        kind: failure instanceof Error ? 'error' : 'non-error',
      });
    }
  }

  _failGroup(group, error) {
    for (const viewer of [...group.viewers]) this._fail(viewer, error);
  }

  _remove(viewer) {
    if (viewer.closed) return;
    viewer.closed = true;
    const group = viewer.group;
    if (!group) return;
    group.viewers.delete(viewer);
    if (group.viewers.size || group.closed) return;
    group.closed = true;
    group.frame = null;
    this.groups.delete(group.id);
    for (const stop of group.stops) stop();
    group.stops = [];
  }
}

module.exports = { ParticipantChanges };
