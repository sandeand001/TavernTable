import {
  captureCampaignScene,
  restoreCampaignScene,
  applySceneCharacterLinks,
  reconcileCampaignScene,
  isCampaignActionInProgress,
} from './SceneWorld.js';
import { decodeScene, encodeScene } from './CampaignScene.js';
import { SceneNotReadyError } from '../scene/token-adapter/SavedPlacements.js';
import { notifyCreatureNames } from '../entities/creatures/CreatureNames.js';
import { GameErrors } from '../utils/error/ErrorHandler.js';
import CampaignWorld from './CampaignWorld.js';
import { applyBuildingScene } from './CampaignBuildingEditor.js';

const pause = (delay) => new Promise((resolve) => setTimeout(resolve, delay));
const ACTION_WAIT = 'Waiting for the current action to finish...';
const SAVE_DELAY = 2000;
const MAX_SAVE_WAIT = 10000;
const RETRY_DELAY = 100;

export default class CampaignAutosave {
  constructor({ gameManager, library, combat, getRollLog = () => [], restoreRollLog = () => {} }) {
    this.gameManager = gameManager;
    this.library = library;
    this.combat = combat;
    this.getRollLog = getRollLog;
    this.restoreRollLog = restoreRollLog;
    this.generation = 0;
    this.acknowledged = 0;
    this.ready = false;
    this.error = null;
    this.waiting = null;
    this.listeners = new Set();
    this.disposers = [];
    this.writing = null;
    this.timer = null;
    this.firstDirtyAt = null;
    this.closed = false;
    gameManager.sceneAutosave = this;
  }

  get dirty() {
    return (
      this.generation > this.acknowledged || this.library.isSaving || this.library.pendingScenes > 0
    );
  }

  get status() {
    if (this.sharedConflict)
      return { state: 'error', text: `Paused / conflict: ${this.sharedConflict.message}` };
    if (this.error) return { state: 'error', text: `Not saved: ${this.error.message}` };
    if (!this.ready) return { state: 'loading', text: 'Restoring campaign...' };
    if (this.waiting) return { state: 'saving', text: this.waiting };
    if (this.dirty || this.writing) return { state: 'saving', text: 'Saving...' };
    return {
      state: 'saved',
      text: this.library.store?.storageInfo?.kind === 'host' ? 'Saved to host' : 'Saved',
      savedAt: this.library.sceneSavedAt,
    };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  _publish() {
    this.combat.actionRequests?.flush();
    this.combat.persistenceRequests?.flush();
    this.gameManager.campaignRequests?.flush();
    for (const listener of this.listeners) {
      try {
        listener(this.status);
      } catch (error) {
        GameErrors.gameState(error, { component: 'CampaignAutosave', operation: 'notify' });
      }
    }
  }

  async start(scene = null) {
    if (this.ready || this.closed)
      throw new Error('This campaign save coordinator has already started or closed');
    try {
      if (scene) {
        await restoreCampaignScene(this.gameManager, scene, this.library, this.combat);
        this.restoreRollLog(scene.rollLog);
      }
      this.library.bindScene({
        capture: (engine, context) => this._capture(engine, context),
        saving: () => this._publish(),
        settled: () => this._publish(),
        committed: (captured) => {
          const tokens = applySceneCharacterLinks(this.gameManager, captured.scene, this.library);
          if (tokens.length) notifyCreatureNames(this.gameManager, tokens, { saved: true });
        },
        saved: (captured) => this._saved(captured),
      });
      this.disposers.push(this.gameManager.terrainEngine.onChanged(() => this.changed('terrain')));
      let combatSnapshot = JSON.stringify(this.combat.snapshot());
      this.disposers.push(
        this.combat.subscribe(() => {
          const next = JSON.stringify(this.combat.snapshot());
          if (next === combatSnapshot) return;
          combatSnapshot = next;
          this.changed('combat');
        })
      );
      const hidden = () => {
        if (document.visibilityState === 'hidden')
          void this.flush().catch((error) => this._failed(error));
      };
      document.addEventListener('visibilitychange', hidden);
      this.disposers.push(() => document.removeEventListener('visibilitychange', hidden));
      const leaving = (event) => {
        if (!this.dirty && !this.error) return;
        event.preventDefault();
        event.returnValue = '';
        void this.flush().catch((error) => this._failed(error));
      };
      window.addEventListener('beforeunload', leaving);
      this.disposers.push(() => window.removeEventListener('beforeunload', leaving));
      this.ready = true;
      this.changed('initial board');
      await this.flush();
    } catch (error) {
      this._failed(error);
      throw error;
    }
  }

  changed() {
    if (!this.ready || this.closed) return;
    this.generation++;
    this.firstDirtyAt ??= performance.now();
    this._publish();
    this._schedule();
  }

  pauseForSharedUpdate() {
    if (this.gameManager.characterServices?.sessionRole === 'player')
      throw new Error('Canonical shared-scene conflicts require the DM workspace');
    if (!this.sharedConflict) {
      this.sharedConflict = Object.assign(
        new Error(
          'The shared campaign changed while local work was pending. Local work is retained; discard or reapply it against a fresh canonical base before saving.'
        ),
        { code: 'shared-scene-conflict' }
      );
      GameErrors.gameState(this.sharedConflict, {
        component: 'CampaignAutosave',
        operation: 'sharedConflict',
      });
    }
    clearTimeout(this.timer);
    this.timer = null;
    this.gameManager.campaignMapFailure = this.sharedConflict;
    this._publish();
    return this.sharedConflict;
  }

  async reconcile(state, { discardLocal = false, expectedGeneration = null } = {}) {
    const gm = this.gameManager;
    if (gm.characterServices?.sessionRole === 'player')
      throw new Error('Canonical scene reconciliation requires the DM workspace');
    if (
      !this.ready ||
      this.closed ||
      this.writing ||
      this.library.isSaving ||
      this.library.pendingScenes ||
      (!discardLocal &&
        (this.dirty || this.error || this.sharedConflict || this.library.failure)) ||
      isCampaignActionInProgress(gm)
    )
      throw new SceneNotReadyError(
        'Finish or resolve the current action/save before applying a shared scene'
      );
    if (discardLocal && expectedGeneration !== this.generation)
      throw new SceneNotReadyError(
        'Local work changed after confirmation. Confirm the discard again before refreshing.'
      );
    if (state.sceneRevision < this.library.sceneRevision || state.revision < this.library.revision)
      throw new Error('The host returned an outdated shared campaign snapshot');
    this.ready = false;
    gm.campaignViewBusy = true;
    try {
      gm.token3DAdapter.clearSharedPresentations?.();
      this.library.reload(state);
      const scene = decodeScene(state.scene, {
        ruleset: this.library.ruleset,
        library: this.library,
      });
      await reconcileCampaignScene(gm, scene, this.library, this.combat);
      this.restoreRollLog(scene.rollLog);
      gm.campaign = this.library.campaign;
      if (gm.campaignContext) gm.campaignContext.campaign = this.library.campaign;
      if (discardLocal) {
        this.acknowledged = this.generation;
        this.firstDirtyAt = null;
        this.waiting = null;
        this.error = null;
        this.sharedConflict = null;
        gm.campaignMapFailure = null;
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.ready = true;
    } catch (error) {
      gm.campaignMapFailure = error;
      this._failed(error);
      throw error;
    } finally {
      gm.campaignViewBusy = false;
      this._publish();
    }
  }

  _checkpointDue() {
    return this.firstDirtyAt !== null && performance.now() - this.firstDirtyAt >= MAX_SAVE_WAIT;
  }

  _schedule({ retry = false } = {}) {
    if (this.closed || !this.ready || this.writing || this.error || this.sharedConflict) return;
    clearTimeout(this.timer);
    this.timer = null;
    if (this.generation <= this.acknowledged) return;
    const moving = isCampaignActionInProgress(this.gameManager);
    if (moving) {
      if (this.waiting !== ACTION_WAIT) {
        this.waiting = ACTION_WAIT;
        this._publish();
      }
      if (isCampaignActionInProgress(this.gameManager, { allowMovementCheckpoint: true })) return;
    } else if (this.waiting === ACTION_WAIT) {
      this.waiting = null;
    }
    const remaining = Math.max(0, MAX_SAVE_WAIT - (performance.now() - this.firstDirtyAt));
    const delay = moving ? remaining : Math.min(SAVE_DELAY, remaining);
    this.timer = setTimeout(
      () => {
        this.timer = null;
        void this._save({ allowMovementCheckpoint: this._checkpointDue() }).catch((error) => {
          if (!(error instanceof SceneNotReadyError)) this._failed(error);
        });
      },
      retry ? Math.max(RETRY_DELAY, delay) : delay
    );
  }

  async _capture(engine, context = {}) {
    if (this.sharedConflict) throw this.sharedConflict;
    const generation = this.generation;
    const capturedAt = performance.now();
    const scene = await captureCampaignScene(this.gameManager, engine, {
      ...context,
      combat: context.combat || this.combat,
      rollLog: this.getRollLog(),
    });
    if (this.sharedConflict) throw this.sharedConflict;
    const presentations =
      this.library.store.storageInfo?.kind === 'host'
        ? this.gameManager.token3DAdapter.getSharedPresentations(scene)
        : [];
    return {
      generation,
      capturedAt,
      scene,
      value: encodeScene(scene, { ruleset: this.library.ruleset, library: engine }),
      ...(presentations.length ? { presentations } : {}),
    };
  }

  _saved(captured) {
    if (!this.gameManager.campaignWorld && captured.scene.version === 3)
      applyBuildingScene(
        this.gameManager,
        captured.scene,
        CampaignWorld.fromScene(captured.scene, {
          ruleset: this.library.ruleset,
          library: this.library,
        })
      );
    this.gameManager.campaignWorld?.acceptCheckpoint(captured.scene);
    this.gameManager.token3DAdapter.acknowledgeSharedPresentations?.(captured.presentations);
    this.acknowledged = Math.max(this.acknowledged, captured.generation);
    this.firstDirtyAt = this.generation > this.acknowledged ? captured.capturedAt : null;
    if (this.firstDirtyAt === null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.waiting = null;
    this._publish();
  }

  _save({ allowMovementCheckpoint = false } = {}) {
    if (this.sharedConflict) return Promise.reject(this.sharedConflict);
    if (this.writing) return this.writing;
    clearTimeout(this.timer);
    this.timer = null;
    if (this.generation <= this.acknowledged) return Promise.resolve();
    if (isCampaignActionInProgress(this.gameManager, { allowMovementCheckpoint })) {
      this.waiting = ACTION_WAIT;
      this._publish();
      return Promise.reject(new SceneNotReadyError(ACTION_WAIT));
    }
    this.writing = this.library
      .saveScene(async (engine) => {
        const captured = await this._capture(engine, {
          completedActionsOnly: !allowMovementCheckpoint,
        });
        if (isCampaignActionInProgress(this.gameManager, { allowMovementCheckpoint }))
          throw new SceneNotReadyError(ACTION_WAIT);
        return captured;
      })
      .then(({ captured }) => {
        this.error = null;
        this._saved(captured);
      })
      .catch((error) => {
        if (error instanceof SceneNotReadyError) {
          this.waiting = error.message;
          this._publish();
        } else this._failed(error);
        throw error;
      })
      .finally(() => {
        this.writing = null;
        this._publish();
        this._schedule({ retry: !!this.waiting });
      });
    this._publish();
    return this.writing;
  }

  async flush({ waitForScene = true } = {}) {
    if (this.sharedConflict) throw this.sharedConflict;
    if (!this.ready || this.closed)
      throw new Error('The campaign is not ready to save; its saved board was not overwritten');
    clearTimeout(this.timer);
    this.timer = null;
    try {
      do {
        try {
          await this.library.flush();
          if (this.sharedConflict) throw this.sharedConflict;
          if (isCampaignActionInProgress(this.gameManager)) {
            if (!waitForScene) throw new SceneNotReadyError(ACTION_WAIT);
            if (
              this._checkpointDue() &&
              !isCampaignActionInProgress(this.gameManager, { allowMovementCheckpoint: true })
            ) {
              await (this.writing || this._save({ allowMovementCheckpoint: true }));
            }
            await pause(RETRY_DELAY);
          } else if (this.writing || this.dirty) {
            await (this.writing || this._save());
          }
        } catch (error) {
          if (!(error instanceof SceneNotReadyError) || !waitForScene) throw error;
          await pause(RETRY_DELAY);
        }
      } while (this.dirty || this.writing || isCampaignActionInProgress(this.gameManager));
    } finally {
      this._schedule();
    }
  }

  async retry() {
    if (this.sharedConflict) throw this.sharedConflict;
    this.error = null;
    this._publish();
    return this.flush();
  }

  _failed(error) {
    if (error instanceof SceneNotReadyError) return;
    if (this.error !== error)
      GameErrors.gameState(error, {
        component: 'CampaignAutosave',
        operation: 'save',
        campaignId: this.library.campaign.id,
      });
    this.error = error;
    this._publish();
  }

  dispose() {
    this.closed = true;
    this.combat.dispose();
    this.gameManager.campaignRequests?.dispose();
    this.gameManager.campaignRequests = null;
    clearTimeout(this.timer);
    for (const dispose of this.disposers) dispose();
    this.listeners.clear();
    if (this.gameManager.sceneAutosave === this) delete this.gameManager.sceneAutosave;
  }
}
