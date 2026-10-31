import { GameErrors } from '../../utils/error/ErrorHandler.js';
import { attacksPerAction, characterActionOptions } from './combat/actions.js';
import { copyRollSummary } from '../../systems/dice/rollSummary.js';
import { snapshotCombat, restoreCombat } from './combat/persistence.js';
import {
  standingAvailability,
  standUp,
  slowFallAvailability,
  useSlowFall,
  applyFall,
} from './combat/falling.js';
import { movementSpeed } from '../../rules/flight.js';
import { getTokenTravelMode } from '../creatures/TokenMovement.js';

const EPSILON = 1e-7;

export default class CombatSession {
  constructor({
    library,
    isMoving = () => false,
    isSceneMoving = () => false,
    hasToken = () => true,
  }) {
    this.library = library;
    this.isMoving = isMoving;
    this.isSceneMoving = isSceneMoving;
    this.lastSceneMoving = false;
    this.hasToken = hasToken;
    this.active = false;
    this.activeToken = null;
    this.turn = 0;
    this.states = new Map();
    this.histories = new Map();
    this.rollScopes = new WeakSet();
    this.moves = new Map();
    this.listeners = new Set();
    this.pending = null;
    this.committing = null;
  }

  // -- Manual turns --
  snapshot(options) {
    return snapshotCombat(this, options);
  }

  restore(data, tokens) {
    if (this.pending || this.committing || this.moves.size)
      throw new Error('Finish pending work before restoring combat');
    const restored = restoreCombat(data, tokens, this.library);
    Object.assign(this, restored);
    this._publish();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  startTurn(token) {
    this._character(token);
    this._assertSettled();
    if (this.isMoving(token)) throw new Error('Finish movement before starting this turn');
    if (this.activeToken) throw new Error('End the current turn before starting another');
    this.active = true;
    this.activeToken = token;
    this.turn++;
    for (const previous of this.states.values()) {
      previous.customTurnUses = {};
      previous.undo = [];
      previous.spellsCast = [];
    }
    const state = this._state(token);
    Object.assign(state, {
      actions: 1,
      restrictedActions: 0,
      bonusActions: 1,
      reactions: 1,
      attacksRemaining: 0,
      movementSpent: 0,
      movementBonus: 0,
      dashes: 0,
      attackActionTaken: false,
      readied: false,
      spellsCast: [],
      customTurnUses: {},
      actionSurgeUsed: false,
      bonusAttacksRemaining: 0,
    });
    this._publish();
  }

  endTurn() {
    if (!this.activeToken) throw new Error('No turn is active');
    this._assertSettled();
    this.activeToken = null;
    this._publish();
  }

  endCombat() {
    this._assertSettled();
    this.active = false;
    this.activeToken = null;
    this.states.clear();
    this._publish();
  }

  status(token, travelMode = getTokenTravelMode(token)) {
    const character = this._character(token);
    const state = this._state(token);
    const speed = movementSpeed(character, travelMode);
    const total = Math.max(0, speed * (1 + state.dashes) + state.movementBonus);
    const isTurn = this.active && this.activeToken === token;
    const moving = this.isMoving(token) || this.isSceneMoving();
    return {
      active: this.active,
      isTurn,
      turn: this.turn,
      downed: character.hp.current === 0,
      actions: state.actions,
      restrictedActions: state.restrictedActions,
      bonusActions: state.bonusActions,
      reactions: state.reactions,
      attacksRemaining: state.attacksRemaining,
      attacksAvailable:
        isTurn && !this.library.rules.cannotTakeActions(character)
          ? state.attacksRemaining +
            state.actions *
              attacksPerAction(
                character,
                this.library.actions.snapshot(character.id).attackCountOverride
              )
          : 0,
      bonusAttacksRemaining: state.bonusAttacksRemaining,
      customTurnUses: { ...state.customTurnUses },
      recent: state.recent.map((entry) => ({ ...entry })),
      movement: {
        base: speed,
        total,
        spent: state.movementSpent,
        remaining:
          isTurn && !this.library.rules.movementImpaired(character)
            ? Math.max(0, total - state.movementSpent)
            : 0,
      },
      busy:
        this.pending !== null ||
        this.committing !== null ||
        this.library.isSaving ||
        this.moves.size > 0 ||
        moving,
      canUndo:
        state.undo.length > 0 &&
        !this.pending &&
        !this.committing &&
        !this.library.isSaving &&
        this.moves.size === 0 &&
        !moving,
    };
  }

  // -- Selected-character session history --
  history(token, filter = 'all') {
    if (!['all', 'turn'].includes(filter)) throw new Error('Choose All rolls or This turn');
    const character = this._character(token);
    const entries = this.histories.get(character.id) || [];
    return entries
      .filter((entry) => filter === 'all' || (this.active && entry.turn === this.turn))
      .map((entry) => ({
        ...entry,
        ...(entry.rollResult ? { rollResult: { ...entry.rollResult } } : {}),
        followups: entry.followups.map((roll) => ({ ...roll })),
      }));
  }

  historyEntry(token, sequence) {
    const character = this._character(token);
    const entry = this.histories.get(character.id)?.find((item) => item.sequence === sequence);
    if (!entry) throw new Error('The original use is no longer in this character history');
    return {
      ...entry,
      ...(entry.rollResult ? { rollResult: { ...entry.rollResult } } : {}),
      followups: entry.followups.map((roll) => ({ ...roll })),
    };
  }

  captureRoll(token) {
    if (this.library.isSaving) throw new Error('Finish saving character changes before rolling');
    const character = this._character(token);
    const scope = Object.freeze({
      characterId: character.id,
      characterName: character.name,
      turn: this.active ? this.turn : null,
    });
    this.rollScopes.add(scope);
    return scope;
  }

  recordRoll(scope, roll) {
    if (!this.rollScopes.has(scope)) throw new Error('This roll context is no longer available');
    if (
      !roll ||
      typeof roll !== 'object' ||
      Object.keys(roll).some(
        (key) => !['label', 'expression', 'rollText', 'parentSequence', 'rollResult'].includes(key)
      ) ||
      ['label', 'expression', 'rollText'].some(
        (key) => typeof roll[key] !== 'string' || !roll[key].length || roll[key].length > 10000
      ) ||
      (roll.parentSequence !== undefined && typeof roll.parentSequence !== 'string')
    ) {
      throw new Error('The roll history entry has invalid fields');
    }
    const summary = roll.rollResult == null ? null : copyRollSummary(roll.rollResult);
    this.library.get(scope.characterId);
    const entries = this.histories.get(scope.characterId) || [];
    if (roll.parentSequence && !entries.some((entry) => entry.sequence === roll.parentSequence)) {
      throw new Error('The original use is no longer in this character history');
    }
    const entry = {
      ...roll,
      characterId: scope.characterId,
      characterName: scope.characterName,
      turn: scope.turn,
      type: 'roll',
      sequence: globalThis.crypto.randomUUID(),
      followups: [],
      ...(summary ? { rollResult: summary } : {}),
    };
    this.rollScopes.delete(scope);
    if (!this.histories.has(scope.characterId)) this.histories.set(scope.characterId, entries);
    entries.unshift(entry);
    this._publish();
    return { ...entry };
  }

  // -- Action reservations --
  availableActions(token, choices = {}) {
    this._character(token);
    return characterActionOptions(this.library, token, choices).filter((action) =>
      this._available(token, action)
    );
  }

  prepareAction(token, actionId, choice = {}) {
    const character = this._character(token);
    if (this.pending || this.committing || this.library.isSaving)
      throw new Error('Finish the current action or character save first');
    if (
      !choice ||
      typeof choice !== 'object' ||
      Object.keys(choice).some((key) => !['slotLevel', 'amount'].includes(key))
    )
      throw new Error('Unsupported action choice');
    const action = characterActionOptions(this.library, token, { [actionId]: choice }).find(
      (entry) => entry.id === actionId
    );
    if (!action) throw new Error('Unknown character action');
    if (!this._available(token, action))
      throw new Error('That action is unavailable or its cost is spent');
    const ticket = Object.freeze({
      id: globalThis.crypto.randomUUID(),
      token,
      action,
      characterId: character.id,
      characterName: character.name,
      classId: character.classId,
      level: character.level,
      turn: this.turn,
      attackCount:
        action.cost === 'attack'
          ? attacksPerAction(
              character,
              this.library.actions.snapshot(character.id).attackCountOverride
            )
          : null,
      choice: { ...choice, ...(action.kind === 'spell' ? { slotLevel: action.slotLevel } : {}) },
    });
    this.pending = ticket;
    this._publish();
    return ticket;
  }

  commitAction(ticket, rollText = '', rollResult = null) {
    if (this.pending !== ticket) throw new Error('This action reservation is no longer active');
    let managed = false;
    try {
      if (this.library.isSaving)
        throw new Error('Finish saving character changes before committing this use');
      const summary = rollResult === null ? null : copyRollSummary(rollResult);
      const character = this._character(ticket.token);
      const action = characterActionOptions(this.library, ticket.token, {
        [ticket.action.id]: ticket.choice,
      }).find((entry) => entry.id === ticket.action.id);
      const attackCount =
        action?.cost === 'attack'
          ? attacksPerAction(
              character,
              this.library.actions.snapshot(character.id).attackCountOverride
            )
          : null;
      if (
        character.id !== ticket.characterId ||
        character.classId !== ticket.classId ||
        character.level !== ticket.level ||
        ticket.turn !== this.turn ||
        ticket.attackCount !== attackCount ||
        JSON.stringify(action) !== JSON.stringify(ticket.action)
      ) {
        throw new Error('The character or action changed while rolling; no costs were spent');
      }
      if (!this._available(ticket.token, action, true))
        throw new Error('The action cost is no longer available');
      const state = this._state(ticket.token);
      const before = this._actionSnapshot(state);
      const sequence = globalThis.crypto.randomUUID();
      const apply = (receipt, session = this) => {
        const state = session._state(ticket.token);
        if (session.active) {
          if (action.cost === 'attack') {
            if (state.attacksRemaining === 0) {
              session._spendMainAction(state, action);
              state.attacksRemaining = attackCount;
            }
            state.attacksRemaining--;
            state.attackActionTaken = true;
          } else if (action.cost === 'action') session._spendMainAction(state, action);
          else if (action.cost === 'bonus') state.bonusActions--;
          else if (action.cost === 'reaction') state.reactions--;
          else if (action.cost === 'bonus-attack') state.bonusAttacksRemaining--;
          if (action.effect === 'dash') {
            state.dashes++;
          }
          if (action.effect === 'ready') state.readied = true;
          if (action.effect === 'extra-action') {
            state.actions++;
            if (session.library.rules.surgeRestricted) state.restrictedActions++;
            state.actionSurgeUsed = true;
          }
          if (action.effect === 'bonus-attacks') state.bonusAttacksRemaining += action.bonusAttacks;
          if (action.kind === 'spell' || action.isSpell) {
            state.spellsCast.push({
              cost: action.cost,
              level: action.spellLevel,
              usesSlot: action.usesSlot === true,
            });
          }
          if (action.customId && action.reset === 'turn' && action.maximum !== null) {
            state.customTurnUses[action.customId] =
              (state.customTurnUses[action.customId] || 0) + 1;
          }
        }
        const result = {
          ...action,
          characterId: character.id,
          characterName: ticket.characterName,
          type: 'use',
          sequence,
          turn: session.active ? session.turn : null,
          rollText,
          ...(summary ? { rollResult: summary } : {}),
        };
        if (!session.histories.has(character.id)) session.histories.set(character.id, []);
        session.histories.get(character.id).unshift(result);
        state.recent.unshift(result);
        state.recent = state.recent.slice(0, 10);
        state.undo.push({ before, receipt, sequence: result.sequence, characterId: character.id });
        state.undo = state.undo.slice(-10);
        return result;
      };
      const persisted = this._persistWithScene(
        () =>
          this.library.actions.consume(character.id, {
            ...(action.spellId ? { spellId: action.spellId, slotLevel: action.slotLevel } : {}),
            ...(action.resourceId
              ? { resourceId: action.resourceId, resourceCost: action.resourceCost }
              : {}),
            ...(action.customId ? { customId: action.customId } : {}),
          }),
        apply
      );
      managed = true;
      return this._afterPersistence(ticket, persisted, apply);
    } finally {
      if (!managed) this._releasePersistence(ticket);
    }
  }

  cancelAction(ticket) {
    if (this.pending !== ticket) throw new Error('This action reservation is no longer active');
    if (this.committing === ticket) throw new Error('This use is already being saved');
    this.pending = null;
    this._publish();
  }

  useAction(token, actionId, choice = {}) {
    return this.commitAction(this.prepareAction(token, actionId, choice));
  }

  undoLastUse(token) {
    this._assertSettled();
    const character = this._character(token);
    const state = this._state(token);
    const entry = state.undo.at(-1);
    if (!entry || entry.characterId !== character.id)
      throw new Error('No matching action use can be undone');
    if (
      state.movementSpent >
      movementSpeed(character, getTokenTravelMode(token)) * (1 + entry.before.dashes) +
        entry.before.movementBonus +
        EPSILON
    ) {
      throw new Error('That movement has already been used; make a manual adjustment instead');
    }
    const ticket = Object.freeze({ token, characterId: character.id, undo: true });
    this.pending = ticket;
    let managed = false;
    try {
      const apply = (receipt, session = this) => {
        const state = session._state(token);
        Object.assign(state, entry.before);
        state.undo.pop();
        const recent = state.recent.find((row) => row.sequence === entry.sequence);
        if (recent) recent.undone = true;
      };
      const persisted = this._persistWithScene(
        () => this.library.actions.undo(entry.receipt),
        apply
      );
      managed = true;
      return this._afterPersistence(ticket, persisted, apply);
    } finally {
      if (!managed) this._releasePersistence(ticket);
    }
  }

  _persistWithScene(operation, apply) {
    if (!this.library.withCombatSnapshot) return operation();
    return this.library.withCombatSnapshot((engine) => {
      const histories = new Map(
        [...this.histories].map(([id, entries]) => [id, JSON.parse(JSON.stringify(entries))])
      );
      const bySequence = new Map(
        [...histories.values()].flat().map((entry) => [entry.sequence, entry])
      );
      const states = new Map(
        [...this.states].map(([token, state]) => [
          token,
          {
            ...state,
            ...JSON.parse(JSON.stringify(this._actionSnapshot(state))),
            recent: state.recent.map((entry) => bySequence.get(entry.sequence)),
            undo: [...state.undo],
          },
        ])
      );
      const staged = Object.assign(Object.create(Object.getPrototypeOf(this)), this, {
        library: engine,
        states,
        histories,
        listeners: new Set(),
        _movementSnapshot: new Map(
          [...this.states].map(([token, state]) => [token, state.movementSpent])
        ),
      });
      apply(null, staged);
      return staged;
    }, operation);
  }

  _afterPersistence(ticket, persisted, apply) {
    if (typeof persisted?.then === 'function') {
      this.committing = ticket;
      this._publish();
      return persisted.then(apply).finally(() => this._releasePersistence(ticket));
    }
    try {
      return apply(persisted);
    } finally {
      this._releasePersistence(ticket);
    }
  }

  _releasePersistence(ticket) {
    if (this.pending === ticket) this.pending = null;
    if (this.committing === ticket) this.committing = null;
    this._publish();
  }

  finishAttackAction(token) {
    if (this.activeToken !== token || this.pending)
      throw new Error("Finish attacks during this creature's turn");
    this._state(token).attacksRemaining = 0;
    this._publish();
  }

  adjustEconomy(token, values) {
    this._assertSettled();
    this._character(token);
    const allowed = [
      'actions',
      'bonusActions',
      'reactions',
      'attacksRemaining',
      'bonusAttacksRemaining',
    ];
    if (
      !values ||
      Object.keys(values).some((key) => !allowed.includes(key)) ||
      Object.values(values).some((value) => !Number.isInteger(value) || value < 0 || value > 20)
    ) {
      throw new Error('Economy adjustments must be whole numbers from 0 to 20');
    }
    const state = this._state(token);
    Object.assign(state, values);
    if (Object.hasOwn(values, 'actions')) state.restrictedActions = 0;
    state.undo = [];
    this._publish();
  }

  _spendMainAction(state, action) {
    state.actions--;
    if (state.restrictedActions > 0 && this.library.rules.canUseSurgeAction(action)) {
      state.restrictedActions--;
    }
  }

  _actionSnapshot(state) {
    return {
      actions: state.actions,
      restrictedActions: state.restrictedActions,
      bonusActions: state.bonusActions,
      reactions: state.reactions,
      attacksRemaining: state.attacksRemaining,
      bonusAttacksRemaining: state.bonusAttacksRemaining,
      movementBonus: state.movementBonus,
      dashes: state.dashes,
      attackActionTaken: state.attackActionTaken,
      readied: state.readied,
      actionSurgeUsed: state.actionSurgeUsed,
      spellsCast: state.spellsCast.map((spell) => ({ ...spell })),
      customTurnUses: { ...state.customTurnUses },
    };
  }

  _available(token, action, ignorePending = false) {
    if (this.committing || this.library.isSaving) return false;
    if (this.pending && !ignorePending) return false;
    if (this.library.rules.cannotTakeActions(this._character(token))) return false;
    if (action.spellReady === false) return false;
    if (action.resourceId) {
      const resource = this.library.rest
        .status(token.characterSheetId)
        .resources.find((entry) => entry.id === action.resourceId);
      if (!resource || (resource.maximum !== null && resource.remaining < action.resourceCost))
        return false;
    }
    if (action.customId && action.maximum !== null) {
      const entry = this.library.actions
        .list(token.characterSheetId)
        .find((candidate) => candidate.id === action.customId);
      if (!entry || (entry.reset !== 'turn' && entry.remaining < 1)) return false;
      if (
        this.active &&
        entry.reset === 'turn' &&
        (this._state(token).customTurnUses[entry.id] || 0) >= entry.maximum
      )
        return false;
    }
    if (!this.active) return !action.requiresCombat;
    const state = this._state(token);
    if (action.ownTurnOnly && this.activeToken !== token) return false;
    if (action.oncePerTurn && state.actionSurgeUsed) return false;
    if (action.readiedRequired && !state.readied) return false;
    if (action.attackRequired && !state.attackActionTaken) return false;
    if (action.attackCompleted && state.attacksRemaining > 0) return false;
    if (
      (action.kind === 'spell' || action.isSpell) &&
      !this.library.rules.canCastSpell(action, state.spellsCast, {
        isTurn: this.activeToken === token,
      })
    )
      return false;
    if (action.cost === 'reaction') return state.reactions > 0;
    if (action.cost === 'free') return !action.ownTurnOnly || this.activeToken === token;
    if (this.activeToken !== token) return false;
    if (action.cost === 'attack') return state.attacksRemaining > 0 || state.actions > 0;
    if (action.cost === 'action')
      return (
        state.actions > 0 &&
        state.attacksRemaining === 0 &&
        (state.actions > state.restrictedActions || this.library.rules.canUseSurgeAction(action))
      );
    if (action.cost === 'bonus') return state.bonusActions > 0;
    if (action.cost === 'bonus-attack') return state.bonusAttacksRemaining > 0;
    return false;
  }

  // -- Committed movement --
  standingAvailability(token) {
    return standingAvailability(this, token);
  }

  standUp(token) {
    return standUp(this, token);
  }

  slowFallAvailability(token) {
    return slowFallAvailability(this, token);
  }

  useSlowFall(token, fallId) {
    return useSlowFall(this, token, fallId);
  }

  applyFall(token, context) {
    return applyFall(this, token, context);
  }

  freeMovementAllowance(token, travelMode = getTokenTravelMode(token)) {
    const character = this._character(token);
    if (this.active || this.library.rules.movementImpaired(character)) return 0;
    return Math.max(0, movementSpeed(character, travelMode) - this._state(token).movementSpent);
  }

  completeFreeMovement(token) {
    if (!this.active) {
      this._state(token).movementSpent = 0;
      this._publish();
    }
  }

  movementAllowance(token, travelMode = getTokenTravelMode(token)) {
    if (!this.active || this.activeToken !== token) return 0;
    return this.status(token, travelMode).movement.remaining;
  }

  adjustMovement(token, remaining) {
    if (!this.active || this.activeToken !== token)
      throw new Error('Adjust movement for the creature taking its turn');
    this._assertSettled();
    if (!Number.isFinite(remaining) || remaining < 0 || remaining > 10000) {
      throw new Error('Remaining movement must be a number from 0 to 10000 feet');
    }
    const state = this._state(token);
    state.movementBonus =
      state.movementSpent +
      remaining -
      movementSpeed(this._character(token), getTokenTravelMode(token)) * (1 + state.dashes);
    state.undo = [];
    this._publish();
  }

  beginMovement(token, cost, travelMode = getTokenTravelMode(token)) {
    if (!this.active || this.activeToken !== token)
      throw new Error('Movement requires this creature to have the active turn');
    if (this.library.rules.movementImpaired(this._character(token)))
      throw new Error(
        'A creature at 0 HP or with restricted movement cannot request combat movement'
      );
    if (
      this.pending ||
      this.committing ||
      this.library.isSaving ||
      this.moves.size ||
      this.isMoving(token)
    ) {
      throw new Error('Finish the current action or movement first');
    }
    const allowance = this.movementAllowance(token, travelMode);
    if (!Number.isFinite(cost) || cost < 0 || cost > allowance + EPSILON) {
      throw new Error('Not enough movement remains this turn');
    }
    const ticket = Object.freeze({
      id: globalThis.crypto.randomUUID(),
      token,
      turn: this.turn,
      cost,
      allowance,
    });
    this._state(token).movementSpent += cost;
    this.moves.set(ticket.id, ticket);
    this._publish();
    return ticket;
  }

  finishMovement(ticket, actualCost) {
    if (this.moves.get(ticket.id) !== ticket || ticket.turn !== this.turn) {
      throw new Error('This movement reservation is no longer active');
    }
    if (!Number.isFinite(actualCost) || actualCost < 0 || actualCost > ticket.allowance + EPSILON) {
      throw new Error('Movement exceeded the original allowance of the committed route');
    }
    this._state(ticket.token).movementSpent += actualCost - ticket.cost;
    this.moves.delete(ticket.id);
    this._publish();
  }

  forget(token) {
    for (const [id, ticket] of this.moves) {
      if (ticket.token === token) this.moves.delete(id);
    }
    if (this.pending?.token === token) this.pending = null;
    this.states.delete(token);
    if (this.activeToken === token) this.activeToken = null;
    this._publish();
  }

  // -- State and notifications --
  syncMovementStatus() {
    const moving = this.isSceneMoving();
    if (moving !== this.lastSceneMoving) {
      this.lastSceneMoving = moving;
      this._publish();
    }
  }

  _character(token) {
    if (!token || !this.hasToken(token) || !token.characterSheetId) {
      throw new Error('Load a saved character for a creature in this scene');
    }
    return this.library.get(token.characterSheetId);
  }

  _state(token) {
    if (!this.states.has(token)) {
      this.states.set(token, {
        actions: 1,
        restrictedActions: 0,
        bonusActions: 1,
        reactions: 1,
        attacksRemaining: 0,
        movementSpent: 0,
        movementBonus: 0,
        dashes: 0,
        attackActionTaken: false,
        readied: false,
        recent: [],
        spellsCast: [],
        customTurnUses: {},
        actionSurgeUsed: false,
        bonusAttacksRemaining: 0,
        undo: [],
      });
    }
    return this.states.get(token);
  }

  _assertSettled() {
    if (
      this.pending ||
      this.committing ||
      this.library.isSaving ||
      this.moves.size ||
      this.isSceneMoving() ||
      (this.activeToken && this.isMoving(this.activeToken))
    ) {
      throw new Error('Finish the current action or movement before changing turns');
    }
  }

  _publish() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        GameErrors.gameState(error, { component: 'CombatSession', operation: 'notify' });
      }
    }
  }
}
