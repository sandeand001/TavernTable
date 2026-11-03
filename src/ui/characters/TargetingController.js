import { targetingBoard, targetingPositions } from '../../coordinators/TargetingBoard.js';
import {
  targetingAvailability,
  validateTargetSelection,
  targetStatus,
} from '../../rules/targeting/assessment.js';
import { targetRelation, facingDirection } from '../../rules/targeting/geometry.js';
import TargetingOverlay from '../../scene/targeting/TargetingOverlay.js';
import { GameErrors } from '../../utils/error/ErrorHandler.js';
import { escapeHtml as escape } from './escapeHtml.js';
import TargetingProfileEditor from './TargetingProfileEditor.js';
import { characterActionOptions } from '../../entities/characters/combat/actions.js';

export default class TargetingController {
  constructor({ gameManager, library, session, onChanged }) {
    this.gameManager = gameManager;
    this.library = library;
    this.session = session;
    this.onChanged = onChanged;
    this.active = null;
    this.preview = null;
    this.boardCache = null;
    this.overlay = null;
    this.disposed = false;
    this.root = document.createElement('section');
    this.root.className = 'targeting-panel';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Choose targets');
    this.root.hidden = true;
    this.effectRoot = document.createElement('section');
    this.effectRoot.className = 'targeting-effects-panel';
    this.effectRoot.setAttribute('aria-label', 'Active spell effects');
    this.effectRoot.hidden = true;
    document.body.append(this.root, this.effectRoot);
    this.editor = new TargetingProfileEditor({ library, onChanged });
    this.root.addEventListener('click', (event) => this.click(event));
    this.root.addEventListener('change', (event) => this.change(event));
    this.effectRoot.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-end-area], [data-end-flight]');
      if (!button) return;
      try {
        const effectId = button.dataset.endArea || button.dataset.endFlight;
        const effect = this.session.effects.find((effect) => effect.id === effectId);
        await this.session.endEffect(effectId);
        if (effect?.kind === 'flight') this.onChanged?.(effect.characterId);
      } catch (error) {
        this.failure(error);
      }
    });
    this.mouseDown = (event) => this.captureDown(event);
    this.pointerDown = (event) => {
      if (this.active && event.button === 0 && this.overBoard(event))
        event.stopImmediatePropagation();
    };
    this.endLeftGesture = (event) => {
      if (!this.active || event.button !== 0 || !this.overBoard(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    this.mouseMove = (event) => this.captureMove(event);
    this.keyDown = (event) => {
      if (!this.active || event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.cancel();
    };
    window.addEventListener('mousedown', this.mouseDown, true);
    window.addEventListener('pointerdown', this.pointerDown, true);
    for (const type of ['pointerup', 'mouseup', 'click', 'dblclick'])
      window.addEventListener(type, this.endLeftGesture, true);
    window.addEventListener('mousemove', this.mouseMove, true);
    document.addEventListener('keydown', this.keyDown, true);
    this.frame = () => {
      if (this.disposed) return;
      if (
        !this.visualError &&
        this.overlay &&
        (this.active || this.preview || this.session.effects.length)
      ) {
        try {
          this.renderOverlay();
        } catch (error) {
          this.failure(error);
        }
      }
    };
    gameManager.threeSceneManager?.addAnimationCallback?.(this.frame);
    this.unsubscribe = session.subscribe(() => {
      this.boardCache = null;
      this.renderEffects();
      if (this.active) this.render();
    });
  }

  // -- Board rules shared by availability and confirmation --
  beginQuery() {
    this.boardCache = null;
  }
  flightRecipients() {
    return this.session.effects.flatMap((effect) =>
      effect.kind === 'flight' ? effect.targetTokenIds : []
    );
  }
  board() {
    return (this.boardCache ||= targetingBoard(this.gameManager, this.flightRecipients()));
  }
  hasTokenId(id, characterId = null) {
    return this.gameManager.placedTokens.some(
      (token) => token.id === id && (characterId === null || token.characterSheetId === characterId)
    );
  }
  availability(token, action) {
    if (!action.targeting) return { allowed: true, reason: '', candidates: [] };
    if (this.session.isMoving(token) || this.session.isSceneMoving())
      return { allowed: false, reason: 'Finish scene movement before targeting', candidates: [] };
    const board = this.board();
    const actor = board.tokens.find((entry) => entry.id === token.id);
    return targetingAvailability(board, actor, action.targeting);
  }
  validate(token, action, selection) {
    this.beginQuery();
    const board = this.board(),
      actor = board.tokens.find((entry) => entry.id === token.id);
    return validateTargetSelection(board, actor, action.targeting, selection);
  }

  async ensureOverlay() {
    if (this.overlay || this.disposed) return;
    if (!this.overlayLoading) {
      this.overlayLoading = import('three')
        .then((three) => {
          if (this.disposed) return;
          const scene = this.gameManager.threeSceneManager?.scene;
          if (!scene?.isScene) throw new Error('Wait for the 3D board before selecting targets');
          this.overlay = new TargetingOverlay(three, scene);
        })
        .finally(() => {
          this.overlayLoading = null;
        });
    }
    return this.overlayLoading;
  }

  async choose(token, ticket) {
    if (this.active || (this.selectionRequest && !this.selectionRequest.cancelled))
      throw new Error('Finish selecting targets for the current action');
    const request = { token, ticket, cancelled: false };
    this.selectionRequest = request;
    try {
      if (ticket.action.targeting?.kind !== 'manual') await this.ensureOverlay();
      if (request.cancelled) return { cancelled: true };
      if (this.disposed || this.session.pending !== ticket)
        throw new Error('This target selection is no longer current');
      this.beginQuery();
      const available = this.availability(token, ticket.action);
      if (!available.allowed) throw new Error(available.reason);
      const profile = ticket.action.targeting;
      const mode =
        available.candidates.find((target) => target.mode)?.mode || profile.modes?.[0]?.id || null;
      return await new Promise((resolve) => {
        this.active = {
          token,
          ticket,
          action: ticket.action,
          profile,
          resolve,
          error: '',
          locked: false,
          aiming: false,
          selection: {
            targets: [],
            exclusions: [],
            mode,
            placed: profile.anchor === 'caster',
            ...(profile.requiresWilling ? { willingConfirmed: false } : {}),
            ...(ticket.action.kind === 'spell' && ticket.action.usesSlot
              ? { slotLevel: ticket.action.slotLevel }
              : {}),
          },
          filter:
            profile.preferred === 'friendly' &&
            available.candidates.some((target) => ['self', 'friendly'].includes(target.relation))
              ? 'friendly'
              : 'any',
        };
        this.root.hidden = false;
        this.render();
        this.renderOverlay();
      });
    } finally {
      if (this.selectionRequest === request) this.selectionRequest = null;
    }
  }

  finish() {
    this.active = null;
    this.preview = null;
    this.root.hidden = true;
    this.beginQuery();
    this.visualError = null;
    this.renderOverlay();
    this.renderEffects();
  }
  cancel() {
    const pending = this.active;
    const request = this.selectionRequest;
    if (!pending && !request) return;
    if (request) request.cancelled = true;
    this.finish();
    const ticket = pending?.ticket || request?.ticket;
    if (this.session.pending === ticket && this.session.committing !== ticket)
      this.session.cancelAction(ticket);
    pending?.resolve({ cancelled: true });
  }
  cancelFor(token) {
    if (this.active?.token === token || this.selectionRequest?.token === token) this.cancel();
    else if (this.preview?.token === token) this.finish();
    if (this.editor.token === token && this.editor.pending) this.editor.close(false);
  }
  async configure(token, action) {
    if (this.session.pending || this.library.isSaving)
      throw new Error('Finish the current action before configuring targets');
    return this.editor.open(token, action);
  }

  // -- Selection panel --
  spellSlotLevels(state) {
    if (state.action.kind !== 'spell' || !state.action.usesSlot) return [];
    const slots = this.library.stats(state.token.characterSheetId).spellSlots;
    return state.action.slotLevels
      .map((level) => slots[level - 1])
      .filter((slot) => slot?.remaining > 0);
  }

  selectSpellLevel(slotLevel) {
    const state = this.active;
    if (!state) throw new Error('Open the spell targeting popup before choosing a level');
    try {
      if (this.library.isSaving || this.session.committing || this.session.pending !== state.ticket)
        throw new Error('Finish the current save before choosing a casting level');
      if (
        !Number.isInteger(slotLevel) ||
        !this.spellSlotLevels(state).some((slot) => slot.level === slotLevel)
      )
        throw new Error('Choose an available spell slot level');
      const action = characterActionOptions(this.library, state.token, {
        [state.ticket.action.id]: { ...state.ticket.choice, slotLevel },
      }).find((entry) => entry.id === state.ticket.action.id);
      if (!action?.spellReady) throw new Error('The selected casting level is no longer available');
      state.action = action;
      state.profile = action.targeting;
      state.selection.slotLevel = action.slotLevel;
      state.error = '';
      this.render();
      this.renderOverlay();
    } catch (error) {
      GameErrors.validation(error, {
        component: 'TargetingController',
        operation: 'selectSpellLevel',
      });
      state.error = error.message;
      this.render();
    }
  }

  render() {
    const state = this.active;
    if (!state) return;
    const board = this.board(),
      actor = board.tokens.find((entry) => entry.id === state.token.id);
    if (!actor || this.session.pending !== state.ticket) {
      this.cancel();
      return;
    }
    const { profile, selection } = state;
    const slotLevels = this.spellSlotLevels(state);
    const selectedMode = profile.modes?.find((mode) => mode.id === selection.mode);
    const rangeLabel = selectedMode
      ? `${selectedMode.normal === selectedMode.long ? selectedMode.long : `${selectedMode.normal}/${selectedMode.long}`} ft ${selectedMode.id} range`
      : `${profile.rangeFeet} ft range`;
    const allocationLabel = `${profile.minTargets === profile.maxTargets ? '' : 'up to '}${profile.maxTargets} ${profile.allowRepeat ? 'projectiles / attacks' : profile.maxTargets === 1 ? 'target' : 'targets'}`;
    const chosen = new Map(selection.targets.map((target) => [target.tokenId, target.count]));
    let valid = false,
      assessed = null;
    state.validation = '';
    try {
      if (
        state.action.kind === 'spell' &&
        state.action.usesSlot &&
        !slotLevels.some((slot) => slot.level === state.selection.slotLevel)
      )
        throw new Error('Choose an available spell slot level, or cancel the cast');
      if (
        profile.anchor === 'caster' ||
        selection.origin ||
        ['tokens', 'self', 'manual'].includes(profile.kind)
      ) {
        assessed = this.validate(
          state.token,
          state.action,
          profile.kind === 'manual' ? { manual: true } : selection
        );
        valid =
          profile.anchor === 'caster' ||
          selection.placed ||
          ['tokens', 'self', 'manual'].includes(profile.kind);
      }
    } catch (error) {
      state.validation = error.message;
    }
    const targets = board.tokens.filter((target) => {
      const relation = targetRelation(actor, target);
      return (
        state.filter === 'any' ||
        relation === state.filter ||
        (state.filter === 'friendly' && relation === 'self')
      );
    });
    this.root.innerHTML = `<header><h3>${escape(state.action.label)}: choose targets</h3>
      <button type="button" data-target-action="cancel" aria-label="Cancel targeting">Cancel</button></header>
      ${
        state.action.kind === 'spell'
          ? state.action.usesSlot
            ? `<div class="targeting-cast-level" role="group"
        aria-label="Spell slot level for ${escape(state.action.label)}"><strong>Cast at level</strong>
        <div>${slotLevels
          .map(
            (slot) => `<button type="button" data-target-slot-level="${slot.level}"
          aria-label="Cast ${escape(state.action.label)} at level ${slot.level}" aria-pressed="${slot.level === selection.slotLevel}"
          ${this.library.isSaving ? 'disabled' : ''}>Level ${slot.level} <small>(${slot.remaining} available)</small></button>`
          )
          .join('')}</div>
        <small>Uses one spell slot of the chosen level. Higher levels upcast the spell.</small></div>`
            : '<p>Cantrip (no spell slot)</p>'
          : ''
      }
      <p>${profile.kind === 'manual' ? escape(profile.reason) : `${rangeLabel} | ${profile.kind === 'area' ? `${profile.sizeFeet} ft ${profile.shape}` : allocationLabel}`}</p>
      ${profile.coverageNote ? `<p>${escape(profile.coverageNote)}</p>` : ''}
      ${
        profile.kind === 'area' || profile.kind === 'point'
          ? `<p>${
              profile.anchor === 'point' && ['cone', 'line', 'cube'].includes(profile.shape)
                ? 'Click to place the origin, then aim and click to lock its direction.'
                : 'Move the pointer to preview. Left-click to place/lock the area.'
            } Confirm commits the cast.</p>`
          : ''
      }
      ${
        profile.modes
          ? `<label>Weapon mode<select aria-label="Targeting weapon mode" data-target-mode>
        ${profile.modes.map((mode) => `<option value="${mode.id}" ${mode.id === selection.mode ? 'selected' : ''}>${mode.id}: ${mode.normal}/${mode.long} ft</option>`).join('')}</select></label>`
          : ''
      }
      ${
        !['manual', 'self'].includes(profile.kind)
          ? `<label>Show<select aria-label="Target allegiance filter" data-target-filter>
        ${['any', 'friendly', 'hostile', 'neutral'].map((relation) => `<option ${relation === state.filter ? 'selected' : ''} value="${relation}">${relation}</option>`).join('')}</select></label>`
          : ''
      }
      ${
        profile.kind === 'area' || profile.kind === 'point'
          ? `<label>Origin elevation above terrain (ft)<input type="number"
        min="0" max="1000" step="1" value="${state.elevation || 0}" aria-label="Spell origin elevation" data-target-elevation></label>`
          : ''
      }
      <div class="targeting-candidates">${
        profile.kind === 'tokens' || profile.allowExclusions
          ? targets
              .map((target) => {
                const status = targetStatus(board, actor, target, profile, selection.mode);
                const selected = profile.allowExclusions
                  ? selection.exclusions.includes(target.id)
                  : chosen.has(target.id);
                return `<div><button type="button" data-target-token="${escape(target.id)}" aria-pressed="${selected}"
            ${profile.kind === 'tokens' && !status.allowed ? 'disabled' : ''}>${escape(target.name)}
            (${escape(targetRelation(actor, target))}, ${Number(status.distance.toFixed(2))} ft)${chosen.get(target.id) ? ` × ${chosen.get(target.id)}` : ''}</button>
            ${profile.allowRepeat && chosen.has(target.id) ? `<button type="button" data-target-minus="${escape(target.id)}" aria-label="Remove one allocation from ${escape(target.name)}">−</button>` : ''}
            ${status.reason && profile.kind === 'tokens' ? `<small>${escape(status.reason)}</small>` : ''}
            ${status.disadvantage.length ? `<small>Disadvantage: ${escape(status.disadvantage.join(', '))}</small>` : ''}</div>`;
              })
              .join('')
          : ''
      }</div>
      ${
        profile.requiresWilling
          ? `<label><input type="checkbox" data-target-willing
        aria-label="Selected creatures are willing" ${selection.willingConfirmed ? 'checked' : ''}>
        I confirm that every selected creature is willing (including self).</label>`
          : ''
      }
      ${
        profile.kind === 'area'
          ? `<p data-target-count>Area includes ${assessed?.targets.length || 0} creatures.</p>
        <ul>${(assessed?.targets || []).map((target) => `<li>${escape(target.name)}</li>`).join('')}</ul>`
          : ''
      }
      <p role="status">${escape(state.error || (!valid ? state.validation || 'Choose a target or area' : profile.flightGrant ? 'Ready to confirm. Fly will grant temporary flight; Take flight remains a separate movement choice.' : 'Ready to confirm. Damage and saves remain manual.'))}</p>
      <button type="button" data-target-action="confirm" aria-label="Confirm targets" ${valid ? '' : 'disabled'}>${profile.kind === 'manual' ? 'Confirm manual targeting' : 'Confirm targets / cast'}</button>`;
  }

  click(event) {
    const state = this.active;
    if (!state) return;
    const slotLevel = event.target.closest('[data-target-slot-level]')?.dataset.targetSlotLevel;
    if (slotLevel !== undefined) {
      this.selectSpellLevel(Number(slotLevel));
      return;
    }
    const action = event.target.closest('[data-target-action]')?.dataset.targetAction;
    if (action === 'cancel') {
      this.cancel();
      return;
    }
    if (action === 'confirm') {
      try {
        const result = this.validate(
          state.token,
          state.action,
          state.profile.kind === 'manual' ? { manual: true } : state.selection
        );
        this.preview = {
          token: state.token,
          profile: state.profile,
          selection: { ...state.selection },
        };
        this.active = null;
        this.root.hidden = true;
        state.resolve({
          ...result,
          ...(state.action.kind === 'spell' && state.action.usesSlot
            ? { slotLevel: state.action.slotLevel }
            : {}),
        });
      } catch (error) {
        state.error = error.message;
        this.render();
      }
      return;
    }
    const selected = event.target.closest('[data-target-token]')?.dataset.targetToken;
    const minus = event.target.closest('[data-target-minus]')?.dataset.targetMinus;
    if (selected) this.toggle(selected);
    if (minus) this.toggle(minus, -1);
  }

  toggle(tokenId, increment = 1) {
    const state = this.active;
    if (!state) return;
    state.error = '';
    if (state.profile.requiresWilling) state.selection.willingConfirmed = false;
    if (state.profile.allowExclusions) {
      const list = state.selection.exclusions;
      const index = list.indexOf(tokenId);
      if (index >= 0) list.splice(index, 1);
      else list.push(tokenId);
    } else {
      const list = state.selection.targets;
      const previous = list.find((entry) => entry.tokenId === tokenId);
      if (previous && (!state.profile.allowRepeat || previous.count + increment <= 0))
        list.splice(list.indexOf(previous), 1);
      else if (previous) previous.count += increment;
      else if (increment > 0) list.push({ tokenId, count: 1 });
    }
    this.render();
    this.renderOverlay();
  }

  change(event) {
    const state = this.active;
    if (!state) return;
    if (event.target.hasAttribute('data-target-willing'))
      state.selection.willingConfirmed = event.target.checked;
    if (event.target.hasAttribute('data-target-mode')) {
      state.selection.mode = event.target.value;
      state.selection.targets = [];
      if (state.profile.requiresWilling) state.selection.willingConfirmed = false;
    }
    if (event.target.hasAttribute('data-target-filter')) state.filter = event.target.value;
    if (event.target.hasAttribute('data-target-elevation')) {
      const value = event.target.valueAsNumber;
      if (!Number.isInteger(value) || value < 0 || value > 1000) {
        state.error = 'Elevation must be 0 to 1000 feet';
        this.render();
        return;
      }
      state.elevation = value;
      if (state.baseOrigin)
        state.selection.origin = {
          ...state.baseOrigin,
          y: state.baseOrigin.y + (value * this.board().tileSize) / 5,
        };
    }
    this.render();
    this.renderOverlay();
  }

  // -- Intercept only board left-clicks while choosing targets --
  overBoard(event) {
    const canvas = this.gameManager.getEventCanvas?.();
    return canvas && (event.target === canvas || canvas.contains(event.target));
  }
  captureDown(event) {
    if (!this.active || event.button !== 0 || !this.overBoard(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      const pick = this.gameManager.pickingService?.pickGroundSync(event.clientX, event.clientY);
      if (
        this.active.profile.kind === 'tokens' ||
        (this.active.profile.allowExclusions && this.active.selection.placed && pick?.token)
      ) {
        if (pick?.token) this.toggle(pick.token.id);
      } else if (pick?.world || pick?.surface?.point) {
        this.updatePoint(pick.world || pick.surface.point, true);
      }
    } catch (error) {
      this.failure(error);
    }
  }
  captureMove(event) {
    if (
      !this.active ||
      !this.overBoard(event) ||
      event.buttons & 6 ||
      !['area', 'point'].includes(this.active.profile.kind)
    )
      return;
    try {
      const pick = this.gameManager.pickingService?.pickGroundSync(event.clientX, event.clientY);
      const point = pick?.world || pick?.surface?.point;
      if (point) this.updatePoint(point, false);
    } catch (error) {
      this.failure(error);
    }
  }
  updatePoint(point, locked) {
    const state = this.active;
    if (!state || (!locked && state.locked)) return;
    const gm = this.gameManager;
    if (gm.campaignWorld) point = gm.campaignWorld.toCampaignPosition(gm.campaignMapId, point);
    const directional = ['cone', 'line', 'cube'].includes(state.profile.shape);
    if (state.profile.anchor === 'caster' || state.aiming) {
      state.selection.aim = { ...point };
      if (locked) {
        state.locked = true;
        state.aiming = false;
      }
    } else if (!state.selection.placed || locked) {
      state.baseOrigin = { ...point };
      state.selection.origin = {
        ...point,
        y: point.y + ((state.elevation || 0) * this.board().tileSize) / 5,
      };
      const facing = facingDirection(
        this.board().tokens.find((token) => token.id === state.token.id)
      );
      state.selection.aim = {
        x: point.x + facing.x,
        y: state.selection.origin.y,
        z: point.z + facing.z,
      };
      if (locked) {
        state.aiming = directional;
        state.locked = !directional;
      }
    }
    if (locked) state.selection.placed = true;
    state.error = '';
    this.visualError = null;
    this.render();
    this.renderOverlay();
  }

  renderOverlay() {
    if (!this.overlay || this.disposed) return;
    const gm = this.gameManager;
    this.overlay.setViewTransform(
      gm.campaignWorld ? gm.campaignWorld.getViewTransform(gm.campaignMapId) : null
    );
    const state = this.active || this.preview;
    const positions =
      state || this.session.effects.length
        ? targetingPositions(this.gameManager, this.flightRecipients())
        : null;
    if (!state) {
      this.overlay.update(positions, null, null, null, this.session.effects);
      return;
    }
    if (
      this.boardCache &&
      (positions.tokens.length !== this.boardCache.tokens.length ||
        positions.tokens.some((token) => {
          const old = this.boardCache.tokens.find((entry) => entry.id === token.id);
          return (
            !old ||
            ['x', 'y', 'z'].some(
              (axis) =>
                old.world[axis] !== token.world[axis] ||
                old.groundWorld?.[axis] !== token.groundWorld?.[axis]
            )
          );
        }))
    )
      this.beginQuery();
    const board = this.board();
    const actor = state && board.tokens.find((entry) => entry.id === state.token.id);
    this.overlay.update(board, actor, state?.profile, state?.selection, this.session.effects);
  }
  renderEffects() {
    if (this.disposed) return;
    if (this.overlay) this.renderOverlay();
    this.effectRoot.hidden = this.session.effects.length === 0;
    this.effectRoot.innerHTML = `<h4>Active spell effects</h4>${this.session.effects
      .map((effect) => {
        if (effect.kind === 'flight') {
          const names = effect.targetTokenIds.map((id) => {
            const token = this.gameManager.placedTokens.find((token) => token.id === id);
            return token?.characterSheetId
              ? this.library.get(token.characterSheetId).name
              : token?.name || id;
          });
          return `<div><strong>${escape(effect.label)}</strong>
        <span>${effect.flySpeed} ft flying speed${effect.hover ? ' + Hover' : ''}: ${escape(names.join(', '))}</span>
        <span>Concentration | ${effect.remainingTurns} caster turns remaining</span>
        <button type="button" data-end-flight="${escape(effect.id)}" aria-label="End ${escape(effect.label)}"
        title="End concentration and remove this temporary flight grant. Airborne targets fall unless another source supports them.">End spell</button></div>`;
        }
        return `<div><strong>${escape(effect.label)}</strong> <span>${effect.remainingTurns} caster turns remaining</span>
      <button type="button" data-end-area="${escape(effect.id)}" aria-label="End ${escape(effect.label)} area" title="Remove this visual area; end concentration and mechanical effects separately on the sheet when appropriate.">End area</button></div>`;
      })
      .join('')}`;
    if (this.session.effects.length && !this.overlay)
      void this.ensureOverlay()
        .then(() => this.renderOverlay())
        .catch((error) => this.failure(error));
  }
  failure(error) {
    this.visualError = error.message;
    GameErrors.gameState(error, { component: 'TargetingController', operation: 'targeting' });
    if (this.active) {
      this.active.error = error.message;
      const status = this.root.querySelector('[role="status"]');
      if (status) status.textContent = error.message;
      const confirm = this.root.querySelector('[data-target-action="confirm"]');
      if (confirm) confirm.disabled = true;
    } else {
      this.effectRoot.hidden = false;
      this.effectRoot.textContent = `Targeting visual error: ${error.message}`;
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    this.unsubscribe();
    window.removeEventListener('mousedown', this.mouseDown, true);
    window.removeEventListener('pointerdown', this.pointerDown, true);
    for (const type of ['pointerup', 'mouseup', 'click', 'dblclick'])
      window.removeEventListener(type, this.endLeftGesture, true);
    window.removeEventListener('mousemove', this.mouseMove, true);
    document.removeEventListener('keydown', this.keyDown, true);
    this.gameManager.threeSceneManager?.removeAnimationCallback?.(this.frame);
    this.overlay?.dispose();
    this.editor.dispose();
    this.root.remove();
    this.effectRoot.remove();
  }
}
