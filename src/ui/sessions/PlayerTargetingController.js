import TargetingOverlay from '../../scene/targeting/TargetingOverlay.js';
import { escapeHtml as escape } from '../characters/escapeHtml.js';
import { GameErrors } from '../../utils/error/ErrorHandler.js';
import { areaPlacement, facingDirection } from '../../rules/targeting/geometry.js';

export default class PlayerTargetingController {
  constructor({ gameManager, getState }) {
    this.gameManager = gameManager;
    this.getState = getState;
    this.root = document.createElement('section');
    this.root.className = 'targeting-panel';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Choose targets');
    this.root.hidden = true;
    document.body.append(this.root);
    this.root.addEventListener('click', (event) => this.click(event));
    this.key = (event) => {
      if (!this.active || event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.cancel('Targeting cancelled. No action or resources were spent.');
    };
    this.down = (event) => this.capture(event, true);
    this.pointer = (event) => this.capture(event, false);
    this.frame = () => {
      if (!this.active) return;
      const state = this.getState();
      if (
        state.sceneRevision !== this.active.sceneRevision ||
        state.revision !== this.active.charactersRevision ||
        state.observerTokenId !== this.active.token.id
      )
        this.cancel('The host viewpoint or state changed. Choose targets again.');
    };
    document.addEventListener('keydown', this.key, true);
    window.addEventListener('mousedown', this.down, true);
    for (const type of ['pointerdown', 'pointerup', 'mouseup', 'click', 'dblclick'])
      window.addEventListener(type, this.pointer, true);
  }

  choose(token, action, choice = {}) {
    if (this.destroyed) throw new Error('The target selector is closed');
    if (this.active) throw new Error('Finish choosing targets for the current action');
    const state = this.getState();
    if (
      token.id !== state.observerTokenId ||
      !state.publicScene.actors.some((actor) => actor.id === token.id && actor.owned) ||
      !state.gameplay.ownedTokens.some(
        (actor) =>
          actor.tokenId === token.id && actor.availableActions.some(({ id }) => id === action.id)
      )
    )
      throw new Error('This action is not available to the active assigned character');
    if (!['tokens', 'self', 'manual', 'area', 'point'].includes(action.targeting?.kind))
      throw new Error('This host targeting presentation is not supported');
    const manager = this.gameManager.threeSceneManager;
    if (!manager?.addAnimationCallback)
      throw new Error('The native target presentation is not ready');
    if (manager !== this.frameManager) {
      this.frameManager?.removeAnimationCallback(this.frame);
      manager.addAnimationCallback(this.frame);
      this.frameManager = manager;
    }
    const profile = JSON.parse(JSON.stringify(action.targeting));
    if (!this.overlay)
      this.overlay = new TargetingOverlay(
        this.gameManager.threeSceneManager.three,
        this.gameManager.threeSceneManager.scene
      );
    return new Promise((resolve) => {
      this.active = {
        token,
        action,
        profile,
        choice: JSON.parse(JSON.stringify(choice)),
        targets:
          profile.kind === 'self' || profile.requireCasterTarget
            ? [{ tokenId: token.id, count: 1 }]
            : [],
        sceneRevision: state.sceneRevision,
        charactersRevision: state.revision,
        resolve,
        error: '',
        origin: null,
        placed: profile.anchor === 'caster',
        direction: null,
      };
      this.root.hidden = false;
      this.render();
      this.renderOverlay();
    });
  }

  render() {
    const active = this.active;
    if (!active) return;
    const selected = new Map(active.targets.map((target) => [target.tokenId, target.count]));
    const actors = this.getState().publicScene.actors.filter(
      (actor) => active.profile.kind !== 'self' || actor.id === active.token.id
    );
    this.root.innerHTML = `<header><h3>${escape(active.action.label)}: choose targets</h3>
      <button type="button" data-target-action="cancel" aria-label="Cancel targeting">Cancel</button></header>
      <p>Only the active character's authorized visible creatures are shown. The host checks range, line of sight, eligibility and resource costs.</p>
      ${active.profile.requiresWilling ? '<p>The host assumes non-hostile creatures are willing; no owner or DM consent checkbox is required.</p>' : ''}
      ${['area', 'point'].includes(active.profile.kind) ? '<p>Click an authorized floor to place the destination. This is a target preview only; the host determines the affected creatures and costs.</p>' : ''}
      <div class="targeting-targets">${actors
        .map(
          (actor) => `
        <button type="button" data-target-token="${escape(actor.id)}" aria-pressed="${selected.has(actor.id)}">
          ${escape(actor.name)}${selected.has(actor.id) ? ` (${selected.get(actor.id)})` : ''}</button>
        ${
          active.profile.allowRepeat && selected.has(actor.id)
            ? `<button type="button" data-target-minus="${escape(actor.id)}" aria-label="Remove one target allocation">-</button>`
            : ''
        }
      `
        )
        .join('')}</div>
      <output role="status">${escape(active.error)}</output>
      <button type="button" data-target-action="confirm">Confirm targets and ask host</button>`;
  }

  toggle(id, minus = false) {
    const active = this.active;
    if (!active || !this.getState().publicScene.actors.some((actor) => actor.id === id))
      throw new Error('The selected creature is not visible to this character');
    if (active.profile.kind === 'self' && id !== active.token.id)
      throw new Error('This action targets the caster only');
    const previous = active.targets.find((target) => target.tokenId === id);
    if (previous && (!active.profile.allowRepeat || (minus && previous.count === 1)))
      active.targets.splice(active.targets.indexOf(previous), 1);
    else if (previous) previous.count += minus ? -1 : 1;
    else if (!minus) active.targets.push({ tokenId: id, count: 1 });
    active.error = '';
    this.render();
    this.renderOverlay();
  }

  placeOrigin(mapId, point) {
    const active = this.active;
    if (!active || !['area', 'point'].includes(active.profile.kind))
      throw new Error('Choose an area or point action before placing a destination');
    if (!point || !['x', 'y', 'z'].every((axis) => Number.isFinite(point[axis])))
      throw new Error('The targeting destination has no valid native position');
    const world = this.gameManager.campaignWorld;
    world.getMap(mapId);
    active.origin = world.toCampaignPosition(mapId, point);
    active.placed = true;
    active.error = '';
    this.render();
    this.renderOverlay();
  }

  click(event) {
    if (!this.active) return;
    try {
      const command = event.target.closest('[data-target-action]')?.dataset.targetAction;
      if (command === 'cancel') {
        this.cancel('Targeting cancelled. No action or resources were spent.');
        return;
      }
      if (command === 'confirm') {
        const active = this.active;
        const count = active.targets.reduce((total, target) => total + target.count, 0);
        if (
          ['tokens', 'self'].includes(active.profile.kind) &&
          (count < active.profile.minTargets || count > active.profile.maxTargets)
        )
          throw new Error(
            `Choose ${active.profile.minTargets} to ${active.profile.maxTargets} target allocations`
          );
        if (
          active.profile.requireCasterTarget &&
          !active.targets.some((target) => target.tokenId === active.token.id)
        )
          throw new Error('This action must include its caster');
        if (['area', 'point'].includes(active.profile.kind) && !active.placed)
          throw new Error('Place the targeting destination before asking the host');
        const result = {
          choice: active.choice,
          targeting:
            active.profile.kind === 'manual'
              ? { manual: true }
              : ['area', 'point'].includes(active.profile.kind)
                ? {
                    ...(active.origin ? { origin: { ...active.origin } } : {}),
                    ...(active.direction ? { direction: { ...active.direction } } : {}),
                  }
                : { targets: active.targets.map((target) => ({ ...target })) },
        };
        this.active = null;
        this.root.hidden = true;
        active.resolve(result);
        return;
      }
      const target = event.target.closest('[data-target-token]')?.dataset.targetToken;
      const minus = event.target.closest('[data-target-minus]')?.dataset.targetMinus;
      if (target || minus) this.toggle(target || minus, !!minus);
    } catch (error) {
      this.active.error = error.message;
      this.render();
      GameErrors.input(error, { component: 'PlayerTargetingController', operation: 'select' });
    }
  }

  capture(event, select) {
    if (!this.active || event.button !== 0) return;
    const canvas = this.gameManager.getEventCanvas?.() || this.gameManager.threeSceneManager.canvas;
    if (!canvas || !event.composedPath().includes(canvas)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!select) return;
    try {
      const picked = this.gameManager.pickingService.pickGroundSync(
        event.clientX,
        event.clientY,
        canvas
      );
      if (['area', 'point'].includes(this.active.profile.kind)) {
        if (!picked?.point) throw new Error('Choose a supported native floor destination');
        this.placeOrigin(this.gameManager.campaignMapId, picked.point);
      } else {
        if (!picked?.token) throw new Error('Choose a visible creature on the map');
        this.toggle(picked.token.id);
      }
    } catch (error) {
      this.active.error = error.message;
      this.render();
      GameErrors.input(error, { component: 'PlayerTargetingController', operation: 'pick' });
    }
  }

  renderOverlay() {
    const active = this.active;
    if (!active || !this.overlay) return;
    const gm = this.gameManager;
    const state = this.getState();
    const world = gm.campaignWorld;
    this.overlay.clear();
    this.overlay.setViewTransform(world.getViewTransform(gm.campaignMapId));
    const actor = state.publicScene.actors.find(({ id }) => id === active.token.id);
    if (!actor) throw new Error('The active targeting observer is no longer available');
    const origin = world.toCampaignPosition(actor.mapId, actor.pose.world);
    if (active.profile.rangeFeet > 0)
      this.overlay.range(origin, active.profile.rangeFeet, 0x67e8f9);
    const selected = new Set(active.targets.map((target) => target.tokenId));
    if (active.profile.kind === 'area' && (active.origin || active.profile.anchor === 'caster')) {
      const projectedActor = {
        world: origin,
        facingAngle: world.toCampaignFacing(actor.mapId, actor.facingAngle),
      };
      const selection = {
        ...(active.origin ? { origin: active.origin } : {}),
        direction: active.direction || facingDirection(projectedActor.facingAngle),
      };
      this.overlay.area(
        areaPlacement(active.profile, projectedActor, selection, 5),
        0xfbbf24,
        0.18
      );
    } else if (active.profile.kind === 'point' && active.origin)
      this.overlay.ring(active.origin, 1, 0xfbbf24);
    for (const target of state.publicScene.actors)
      if (active.profile.kind !== 'self' || target.id === actor.id)
        this.overlay.ring(
          world.toCampaignPosition(target.mapId, target.pose.world),
          1.8,
          selected.has(target.id) ? 0x34d399 : 0x64748b
        );
  }

  cancel(reason = 'Targeting cancelled. No action or resources were spent.') {
    const active = this.active;
    this.finish();
    active?.resolve({ cancelled: true, reason });
  }

  finish() {
    this.active = null;
    this.root.hidden = true;
    this.overlay?.clear();
  }

  destroy() {
    this.destroyed = true;
    this.cancel();
    document.removeEventListener('keydown', this.key, true);
    window.removeEventListener('mousedown', this.down, true);
    for (const type of ['pointerdown', 'pointerup', 'mouseup', 'click', 'dblclick'])
      window.removeEventListener(type, this.pointer, true);
    this.frameManager?.removeAnimationCallback(this.frame);
    this.overlay?.dispose();
    this.root.remove();
  }
}
