import { attachHostSessionUpdates } from './HostSessionUpdates.js';
import { validateCloudOwnerSnapshot } from '../../campaigns/CloudOwnerProtocol.js';
import { isCloudAccessScope, isCloudUUID } from '../../campaigns/CloudProtocol.js';
import { GameErrors } from '../../utils/error/ErrorHandler.js';

const copy = (value) => structuredClone(value);

export default class CloudHostSessionUpdates {
  constructor({ gameManager, services, parent, sessionId, access, onStatus = () => {} }) {
    const store = services.workspace.store;
    if (
      !isCloudAccessScope(access) ||
      access.role !== 'owner' ||
      access.uid !== store.uid ||
      access.campaignId !== services.campaign.id ||
      !isCloudUUID(sessionId) ||
      ['observeOwnerEvents', 'bindOwnerWorld', 'isLocalChange'].some(
        (method) => typeof store[method] !== 'function'
      )
    )
      throw new Error('Cloud shared rendering requires current live owner world access');
    this.store = store;
    this.access = copy(access);
    this.sessionId = sessionId;
    this.closed = false;
    this.phase = 'connecting';
    this.current = null;
    this.onStatus = onStatus;
    const adapter = {
      isLocalChange: (event) => store.isLocalChange(event),
      readCharacters: async (id) => {
        if (this.closed || this.current === null || id !== this.access.campaignId)
          throw new Error('The current live owner checkpoint is unavailable.');
        return copy(this.current);
      },
      subscribeChanges: (listener) => {
        this.observation = store.observeOwnerEvents(access.campaignId, { sessionId }, access, {
          onState: (checkpoint, context) => {
            if (this.closed) return;
            validateCloudOwnerSnapshot(checkpoint);
            if (
              checkpoint.access.uid !== this.access.uid ||
              checkpoint.access.campaignId !== this.access.campaignId ||
              checkpoint.sessionId !== this.sessionId
            )
              throw new Error('The owner world checkpoint belongs to a different live scope.');
            this.current = copy(checkpoint.state);
            const origin = checkpoint.origin;
            const kind = context.reconcile
              ? 'playerCommit'
              : origin?.kind === 'world.command'
                ? 'playerCommand'
                : origin?.kind === 'characters.assigned.commit'
                  ? 'playerCommit'
                  : origin?.kind === 'characters.commit'
                    ? 'commitCharacters'
                    : 'commitScene';
            listener({
              type: 'campaign',
              version: 1,
              campaignId: access.campaignId,
              kind,
              sceneRevision: checkpoint.state.sceneRevision,
              charactersRevision: checkpoint.state.revision,
              origin,
              reconcile: context.reconcile,
              presentations: context.reconcile ? [] : copy(context.presentations || []),
            });
          },
          onStatus: (status) => {
            if (this.closed) return;
            this.phase = status.phase;
            if (['paused', 'ended', 'denied', 'error', 'closed'].includes(status.phase)) {
              this.current = null;
              this.releaseBinding?.();
              this.releaseBinding = null;
              listener({ type: 'invalid-update', reason: status.reason });
            } else if (['connecting', 'synchronizing', 'reconnecting'].includes(status.phase))
              listener({ type: 'disconnected' });
            this.onStatus(status);
          },
        });
        return () => {
          void this._closeStream().catch((error) =>
            GameErrors.gameState(error, {
              component: 'CloudHostSessionUpdates',
              operation: 'close',
            })
          );
        };
      },
    };
    this.dispose = attachHostSessionUpdates({ gameManager, services, parent, store: adapter });
    this.ready = this.observation.ready.then(() => {
      if (this.closed || this.phase !== 'ready' || this.current === null)
        throw new Error('The owner world closed before shared rendering became ready.');
      this.releaseBinding = store.bindOwnerWorld(access.campaignId, sessionId, access);
      return this;
    });
  }

  _closeStream() {
    this.closingStream ??= this.observation.close();
    return this.closingStream;
  }

  async close() {
    if (this.closing) return this.closing;
    this.closed = true;
    this.current = null;
    this.releaseBinding?.();
    this.releaseBinding = null;
    this.dispose();
    this.closing = this._closeStream();
    return this.closing;
  }
}
