import {
  captureCampaignScene,
  restoreCampaignScene,
  applySceneCharacterLinks,
} from './SceneWorld.js';
import { encodeScene } from './CampaignScene.js';
import { SceneNotReadyError } from '../scene/token-adapter/SavedPlacements.js';
import { notifyCreatureNames } from '../entities/creatures/CreatureNames.js';
import { GameErrors } from '../utils/error/ErrorHandler.js';

const pause = (delay) => new Promise((resolve) => setTimeout(resolve, delay));

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
    if (this.error) return { state: 'error', text: `Not saved: ${this.error.message}` };
    if (!this.ready) return { state: 'loading', text: 'Restoring campaign...' };
    if (this.waiting) return { state: 'saving', text: this.waiting };
    if (this.dirty || this.writing) return { state: 'saving', text: 'Saving...' };
    return { state: 'saved', text: 'Saved', savedAt: this.library.sceneSavedAt };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  _publish() {
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
          if (tokens.length) notifyCreatureNames(this.gameManager, tokens);
        },
        saved: (captured) => this._saved(captured),
      });
      this.disposers.push(
        this.gameManager.terrainCoordinator.dataStore.subscribe(() => this.changed('terrain'))
      );
      this.disposers.push(this.combat.subscribe(() => this.changed('combat')));
      const interact = () => this.changed('settings');
      for (const event of ['pointerup', 'keyup', 'change']) {
        document.addEventListener(event, interact);
        this.disposers.push(() => document.removeEventListener(event, interact));
      }
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
    this.firstDirtyAt ??= Date.now();
    this._publish();
    this._schedule();
  }

  _schedule(delay = 300) {
    if (this.closed || !this.ready || this.writing || this.error || !this.dirty) return;
    clearTimeout(this.timer);
    const remaining = Math.max(0, 1000 - (Date.now() - this.firstDirtyAt));
    this.timer = setTimeout(
      () => {
        this.timer = null;
        void this._save().catch((error) => {
          if (!(error instanceof SceneNotReadyError)) this._failed(error);
        });
      },
      Math.min(delay, remaining)
    );
  }

  async _capture(engine, context = {}) {
    const generation = this.generation;
    const scene = await captureCampaignScene(this.gameManager, engine, {
      ...context,
      combat: context.combat || this.combat,
      rollLog: this.getRollLog(),
    });
    return {
      generation,
      scene,
      value: encodeScene(scene, { ruleset: this.library.ruleset, library: engine }),
    };
  }

  _saved(captured) {
    this.acknowledged = Math.max(this.acknowledged, captured.generation);
    this.waiting = null;
    this._publish();
  }

  _save() {
    if (this.writing) return this.writing;
    clearTimeout(this.timer);
    this.timer = null;
    this.writing = this.library
      .saveScene((engine) => this._capture(engine))
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
        this.firstDirtyAt = this.dirty ? Date.now() : null;
        this._publish();
        this._schedule(this.waiting ? 100 : 300);
      });
    this._publish();
    return this.writing;
  }

  async flush() {
    if (!this.ready || this.closed)
      throw new Error('The campaign is not ready to save; its saved board was not overwritten');
    clearTimeout(this.timer);
    this.timer = null;
    do {
      try {
        await this.library.flush();
        if (this.writing || this.dirty) await (this.writing || this._save());
      } catch (error) {
        if (!(error instanceof SceneNotReadyError)) throw error;
        await pause(100);
      }
    } while (this.dirty || this.writing);
  }

  async retry() {
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
    clearTimeout(this.timer);
    for (const dispose of this.disposers) dispose();
    this.listeners.clear();
    if (this.gameManager.sceneAutosave === this) delete this.gameManager.sceneAutosave;
  }
}
