import {
  getConnectionTravelOption,
  getConnectionTraversalActions,
} from '../../campaigns/CampaignTravel.js';
import { travelCampaignConnection } from '../../campaigns/SceneWorld.js';
import { GameErrors } from '../../utils/error/ErrorHandler.js';
import { logger, LOG_CATEGORY } from '../../utils/logger/Logger.js';
import { isFloorSurface } from '../../terrain/SurfaceNavigation.js';
import { changeCampaignDoor } from '../../campaigns/CampaignDoorActions.js';

export default class CampaignTraversalPopup {
  constructor({ gameManager }) {
    this.gameManager = gameManager;
    this.pending = false;
    this.ready = Promise.resolve();
    this.root = document.createElement('section');
    this.root.className = 'campaign-traversal-popup';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'false');
    this.root.setAttribute('aria-label', 'Traversal options');
    this.root.innerHTML = `<h3></h3>
      <output role="status" aria-live="polite"></output>
      <div class="campaign-traversal-actions">
        <button type="button" data-travel-confirm></button>
        <span class="campaign-traversal-extra" data-travel-extra></span>
        <button type="button" data-travel-cancel>Cancel</button>
      </div>`;
    this.title = this.root.querySelector('h3');
    this.status = this.root.querySelector('output');
    this.confirm = this.root.querySelector('[data-travel-confirm]');
    this.extra = this.root.querySelector('[data-travel-extra]');
    this.cancel = this.root.querySelector('[data-travel-cancel]');
    this.confirm.addEventListener('click', () => {
      this.ready = this._confirm();
    });
    this.cancel.addEventListener('click', () => this.hide());
    this.changed = (event) => {
      if (event.detail?.gameManager !== gameManager) return;
      if (gameManager.campaignViewBusy) {
        this._cancelApproachOffer();
        this.hide();
      } else if (!this.root.hidden && !this.pending) this._refresh();
    };
    this.keyDown = (event) => {
      if (event.key === 'Escape' && (this.approach || !this.root.hidden)) {
        event.preventDefault();
        this._cancelApproachOffer();
        this.hide();
      }
    };
    this.pointerDown = (event) => this._captureFeature(event);
    this.canvasClick = (event) => {
      if (event.target !== this.gameManager.getEventCanvas?.() || !this.suppressCanvasClick) return;
      this.suppressCanvasClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    this.pagehide = () => this.dispose();
    this.frame = () => this._checkApproach();
  }

  attach() {
    document.body.append(this.root);
    for (const event of ['taverntable:campaignViewStateChanged', 'taverntable:combatChanged'])
      window.addEventListener(event, this.changed);
    document.addEventListener('keydown', this.keyDown, true);
    document.addEventListener('pointerdown', this.pointerDown, true);
    document.addEventListener('mousedown', this.pointerDown, true);
    document.addEventListener('click', this.canvasClick, true);
    window.addEventListener('pagehide', this.pagehide, { once: true });
    this.gameManager.threeSceneManager?.addAnimationCallback?.(this.frame);
    return this;
  }

  open(connectionId, { clientX = 0, clientY = 0 } = {}, actor = null) {
    this._cancelApproachOffer();
    this.hide();
    const gm = this.gameManager;
    this.actor = actor || this._actingCreature();
    this.connectionId = connectionId;
    this.surfaceTarget = null;
    this.point = { clientX, clientY };
    this.error = null;
    const option = this._refresh();
    const connection = gm.campaignWorld.getConnections().find((entry) => entry.id === connectionId);
    if (option?.approach && !(connection.kind === 'door' && connection.open !== true)) {
      const request = this.actor.flightActive
        ? gm.token3DAdapter.requestFlyToPoint(this.actor, option.approach.point, { closest: true })
        : gm.token3DAdapter.requestMoveToSurface(this.actor, option.approach, { closest: true });
      if (request?.goal || request?.queued) {
        this.ready = new Promise((resolve) => {
          this.approach = {
            actor: this.actor,
            connectionId,
            mapId: gm.campaignMapId,
            turn: gm.characterServices.combat.turn,
            active: gm.characterServices.combat.active,
            point: { clientX, clientY },
            resolve,
          };
        });
      }
      return;
    }
    this.root.hidden = false;
    this.root.style.left = `${Math.max(8, Math.min(clientX + 12, window.innerWidth - 288))}px`;
    this.root.style.top = `${Math.max(8, Math.min(clientY + 12, window.innerHeight - 220))}px`;
    this.cancel.focus({ preventScroll: true });
  }

  openSurface(surface, event, actor) {
    this._cancelApproachOffer();
    this.actor = actor;
    this.connectionId = null;
    this.surfaceTarget = surface;
    this.point = { clientX: event.clientX, clientY: event.clientY };
    this.error = null;
    this._refresh();
    this.root.hidden = false;
    this.root.style.left = `${Math.max(8, Math.min(event.clientX + 12, window.innerWidth - 288))}px`;
    this.root.style.top = `${Math.max(8, Math.min(event.clientY + 12, window.innerHeight - 220))}px`;
    this.cancel.focus({ preventScroll: true });
  }

  _cancelApproachOffer() {
    const approach = this.approach;
    this.approach = null;
    approach?.resolve(false);
  }

  _actingCreature() {
    const gm = this.gameManager;
    return (
      gm.token3DAdapter.getSelectedToken() ||
      gm.placedTokens.find((token) => token.id === gm.campaignView.focusTokenId)
    );
  }

  _checkApproach() {
    const approach = this.approach;
    if (!approach) return;
    const gm = this.gameManager;
    const session = gm.characterServices.combat;
    if (
      gm.campaignMapId !== approach.mapId ||
      gm.campaignViewBusy ||
      gm.campaignMapFailure ||
      !gm.placedTokens.includes(approach.actor) ||
      this._actingCreature() !== approach.actor ||
      session.turn !== approach.turn ||
      session.active !== approach.active ||
      gm.characterServices.targeting?.active
    ) {
      this._cancelApproachOffer();
      return;
    }
    if (gm.token3DAdapter.isMovementInProgress(approach.actor)) return;
    this.approach = null;
    try {
      const option = getConnectionTravelOption(gm, approach.actor, approach.connectionId);
      if (option.allowed || (!option.approach && !option.insufficientMovement))
        this.open(approach.connectionId, approach.point, approach.actor);
      else
        logger.info(
          'Connection approach stopped before traversal',
          {
            tokenId: approach.actor.id,
            connectionId: approach.connectionId,
            reason: option.reason,
          },
          LOG_CATEGORY.INTERACTION
        );
      approach.resolve(option.allowed);
    } catch (error) {
      approach.resolve(false);
      GameErrors.input(error, { component: 'CampaignTraversalPopup', operation: 'approach' });
    }
  }

  hide() {
    const hadFocus = this.root.contains(document.activeElement);
    this.root.hidden = true;
    if (hadFocus) this.gameManager.getEventCanvas?.()?.focus({ preventScroll: true });
  }

  _captureFeature(event) {
    if (this.root.contains(event.target)) return;
    const gm = this.gameManager;
    const onCanvas = event.target === gm.getEventCanvas?.();
    if (onCanvas && event.type === 'mousedown' && this.suppressCanvasClick) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (onCanvas) this.suppressCanvasClick = false;
    const cameraGesture =
      onCanvas &&
      (event.button !== 0 ||
        event.shiftKey ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        gm.interactionManager?.isSpacePressed);
    if (!cameraGesture) this._cancelApproachOffer();
    this.hide();
    if (
      !onCanvas ||
      cameraGesture ||
      gm.campaignViewBusy ||
      gm.campaignMapFailure ||
      gm.characterServices?.targeting?.active ||
      gm.isTerrainModeActive?.() ||
      (gm.terrainEngine.getSelectedPlaceable?.() &&
        gm.terrainEngine.isPlaceablesPanelVisible?.()) ||
      gm.selectedTokenType === 'remove'
    )
      return;
    const hit = gm.pickingService?.pickConnectionSync(event.clientX, event.clientY);
    if (!hit) {
      const actor = this._actingCreature();
      if (!actor || (!actor.openingHold && !actor.surfaceHold)) return;
      const ground = gm.pickingService.pickGroundSync(event.clientX, event.clientY);
      if (!ground || ground.token) return;
      const surface = ground.surface || { point: ground.world, normal: { x: 0, y: 1, z: 0 } };
      const option = gm.token3DAdapter.getSurfaceClimbOption(actor, surface);
      if (!isFloorSurface(surface) && !option.plan?.gapFalls.length) return;
      this.suppressCanvasClick = true;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.openSurface(surface, event, actor);
      return;
    }
    this.suppressCanvasClick = true;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.open(hit.connection.id, event);
  }

  _refresh() {
    try {
      const actions = this.surfaceTarget
        ? this._surfaceActions()
        : getConnectionTraversalActions(this.gameManager, this.actor, this.connectionId);
      const option = actions[0];
      this.extra.replaceChildren();
      for (const extra of actions.slice(1)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.travelAction = extra.action;
        button.textContent = `${extra.actionLabel}${extra.costFeet !== undefined ? ` (${extra.costFeet} ft)` : ''}`;
        button.disabled = this.pending || !extra.allowed;
        button.title = extra.reason || '';
        button.addEventListener('click', () => {
          this.ready = this._confirm(extra.action);
        });
        this.extra.append(button);
      }
      if (!this.surfaceTarget) this._doorControls();
      const label =
        option.kind === 'window' && option.actionLabel === 'Climb in'
          ? 'Enter'
          : option.kind === 'window' && option.actionLabel === 'Climb out'
            ? 'Exit'
            : option.kind === 'window' && option.actionLabel === 'Climb toward window'
              ? 'Climb'
              : option.actionLabel;
      this.title.textContent = this.surfaceTarget
        ? option.gapFalls?.length
          ? 'Climb and re-grab?'
          : actions.length > 1
            ? 'Climb or drop?'
            : 'Climb?'
        : option.kind === 'window'
          ? label === 'Climb'
            ? 'Climb to window?'
            : `${label} window?`
          : option.kind === 'stairs'
            ? 'Use stairs?'
            : option.kind === 'ladder'
              ? 'Use ladder?'
              : `${label} ${option.name}?`;
      this.confirm.textContent = `${label}${option.costFeet !== undefined ? ` (${option.costFeet} ft)` : ''}`;
      this.confirm.disabled = this.pending || !option.allowed;
      this.status.textContent =
        this.error?.message ||
        (option.allowed
          ? ''
          : option.insufficientMovement
            ? 'Not enough movement.'
            : option.reason);
      this.status.hidden = !this.status.textContent;
      this.status.dataset.state = this.error || !option.allowed ? 'error' : 'ready';
      return option;
    } catch (error) {
      this.confirm.disabled = true;
      this.status.textContent = error.message;
      this.status.hidden = false;
      this.status.dataset.state = 'error';
      GameErrors.input(error, { component: 'CampaignTraversalPopup', operation: 'show' });
    }
  }

  _surfaceActions() {
    const gm = this.gameManager;
    const adapter = gm.token3DAdapter;
    const option = adapter.getSurfaceClimbOption(this.actor, this.surfaceTarget);
    const actions = [
      {
        ...option,
        name: 'Surface movement',
        targetName: 'the clicked surface',
        gapFalls: option.plan?.gapFalls,
        action: 'cross',
        actionLabel: option.plan?.gapFalls.length ? 'Climb and re-grab' : option.actionLabel,
      },
    ];
    if (isFloorSurface(this.surfaceTarget)) {
      const physical = gm.campaignWorld.toCampaignPosition(this.actor.mapId, this.actor.world);
      const support = gm.campaignWorld.findSupportBelow(physical, {
        mapId: gm.campaignMapId,
        geometry: gm.terrainEngine.geometry,
      });
      actions.push({
        action: 'drop',
        actionLabel: 'Drop',
        costFeet: 0,
        allowed: !!support && adapter.getSurfaceDropOption(this.actor).allowed,
        fallDistanceFeet: support ? physical.y - support.positionFeet.y : 0,
      });
    }
    return actions;
  }

  _doorControls() {
    const gm = this.gameManager;
    if (gm.characterServices?.workspace?.store.identity?.role === 'player') return;
    const door = gm.campaignWorld.getConnections().find((entry) => entry.id === this.connectionId);
    if (door?.kind !== 'door') return;
    for (const [action, label] of [
      [door.open ? 'close' : 'open', door.open ? 'Close door' : 'Open door'],
      [
        door.locked ? 'unlock' : 'lock',
        door.locked ? 'Unlock door' : door.open ? 'Close & lock door' : 'Lock door',
      ],
    ]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.doorAction = action;
      button.textContent = label;
      button.disabled =
        this.pending ||
        gm.campaignViewBusy ||
        gm.sceneAutosave?.ready === false ||
        !!gm.campaignMapFailure ||
        (action === 'open' && door.locked === true);
      button.title = action === 'open' && door.locked ? 'Unlock this door first.' : '';
      button.addEventListener('click', () => {
        this.ready = this._changeDoor(action);
      });
      this.extra.append(button);
    }
  }

  async _changeDoor(action) {
    if (this.pending) return false;
    this.pending = true;
    this.cancel.disabled = true;
    this.error = null;
    this._refresh();
    try {
      const change =
        action === 'lock'
          ? { open: false, locked: true }
          : action === 'unlock'
            ? { locked: false }
            : { open: action === 'open' };
      await changeCampaignDoor(this.gameManager, this.connectionId, change);
      return true;
    } catch (error) {
      this.error = error;
      GameErrors.input(error, { component: 'CampaignTraversalPopup', operation: 'door' });
      return false;
    } finally {
      this.pending = false;
      this.cancel.disabled = false;
      if (!this.disposed) {
        this.root.hidden = false;
        this._refresh();
      }
    }
  }

  async _confirm(action = 'cross') {
    if (this.pending || (action === 'cross' && this.confirm.disabled)) return false;
    const actor = this.actor;
    const id = this.connectionId;
    this.pending = true;
    this.confirm.disabled = this.cancel.disabled = true;
    for (const button of this.extra.querySelectorAll('button')) button.disabled = true;
    try {
      if (this.surfaceTarget) {
        const gm = this.gameManager;
        if (action === 'drop') {
          gm.token3DAdapter.requestSurfaceDrop(actor, this.surfaceTarget);
        } else {
          const result = gm.token3DAdapter.requestClimbToSurface(actor, this.surfaceTarget, {
            confirmGapDrops: true,
          });
          if (!result) throw new Error('The requested climbing route could not start');
        }
        this.hide();
        return true;
      }
      const result = await travelCampaignConnection(this.gameManager, actor, id, { action });
      this.hide();
      return result;
    } catch (error) {
      this.error = error;
      if (!this.disposed) {
        this.root.hidden = false;
        this.status.textContent = error.message;
        this.status.hidden = false;
        this.status.dataset.state = 'error';
      }
      GameErrors.input(error, { component: 'CampaignTraversalPopup', operation: 'travel' });
      return false;
    } finally {
      this.pending = false;
      this.cancel.disabled = false;
      if (!this.disposed && !this.root.hidden) this._refresh();
    }
  }

  dispose() {
    this.disposed = true;
    this._cancelApproachOffer();
    this.gameManager.threeSceneManager?.removeAnimationCallback?.(this.frame);
    for (const event of ['taverntable:campaignViewStateChanged', 'taverntable:combatChanged'])
      window.removeEventListener(event, this.changed);
    document.removeEventListener('keydown', this.keyDown, true);
    document.removeEventListener('pointerdown', this.pointerDown, true);
    document.removeEventListener('mousedown', this.pointerDown, true);
    document.removeEventListener('click', this.canvasClick, true);
    window.removeEventListener('pagehide', this.pagehide);
    this.root.remove();
    this.actor = null;
  }
}
