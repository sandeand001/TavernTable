import { GameErrors } from '../../utils/error/ErrorHandler.js';

export default class FallingController {
  constructor({ gameManager, library, combat, getCharacter, onChanged }) {
    this.gameManager = gameManager;
    this.library = library;
    this.combat = combat;
    this.getCharacter = getCharacter;
    this.onChanged = onChanged;
    this.pending = new Map();
    this.dialogs = new Map();
    this.disposed = false;
  }

  // -- Fall lifecycle --
  begin(token, distanceFeet, { ignoreFlight = false } = {}) {
    if (typeof ignoreFlight !== 'boolean') {
      throw new Error('A fall requires an explicit flight protection policy');
    }
    const dice = this.library.rules.fallingDice(distanceFeet);
    const existing = this.pending.get(token);
    if (existing) return existing.begin;
    const record = { id: globalThis.crypto.randomUUID(), context: null, roll: null };
    this.pending.set(token, record);
    record.begin = this._retry(token, async () => {
      const character = await this.getCharacter(token);
      this._assertCurrent(token, character.id);
      if (record.characterId && record.characterId !== character.id)
        throw new Error('The falling creature changed its linked character');
      record.characterId = character.id;
      record.protection ||= this.library.rules.fallProtection(character, { ignoreFlight });
      const protection = record.protection;
      const slowFall = this.combat.slowFallAvailability(token);
      if (record.useSlowFall === undefined) {
        record.useSlowFall =
          !protection.avoidDamage &&
          dice > 0 &&
          slowFall.allowed &&
          (await this._prompt(token, {
            title: `${character.name} is falling`,
            message: `${Number(distanceFeet.toFixed(2))} feet. Use your reaction for Slow Fall to reduce damage by ${slowFall.reduction}? The descent and landing will be animated more gently.`,
            choices: [
              { value: true, label: 'Use Slow Fall (reaction)' },
              { value: false, label: 'Fall normally' },
            ],
          }));
      }
      this._assertCurrent(token, character.id);
      if (record.useSlowFall && record.slowReduction === undefined) {
        record.slowReduction = await this.combat.useSlowFall(token, record.id);
      }
      const expression = protection.avoidDamage || dice === 0 ? '0' : `${dice}d6`;
      if (!record.roll) {
        if (expression === '0') {
          record.roll = {
            total: 0,
            text: `${character.name}: no falling damage (${protection.reason || 'less than 10 feet'}).`,
          };
        } else {
          const { rollDiceExpression } = await import('../../systems/dice/dice.js');
          const rolled = await rollDiceExpression({
            expression,
            label: `${character.name}: falling damage`,
          });
          if (rolled.cancelled) throw new Error('Falling damage must be resolved before landing');
          record.roll = rolled;
        }
      }
      const outcome = this.library.rules.resolveFall({
        distanceFeet,
        rawDamage: protection.avoidDamage ? 0 : record.roll.total,
        reduction: protection.reduction + (record.slowReduction || 0),
        avoidDamage: protection.avoidDamage,
        proneImmune: protection.proneImmune,
      });
      record.context = Object.freeze({
        id: record.id,
        characterId: character.id,
        ...outcome,
        proneImmune: protection.proneImmune,
        avoidDamage: protection.avoidDamage,
        featherFall: protection.featherFall,
        reason: protection.reason,
        slowFall: record.useSlowFall === true,
        wasProne: (character.conditions || []).includes('prone'),
        roll: { ...record.roll, expression },
      });
      this.onChanged(character.id);
      return record.context;
    });
    return record.begin;
  }

  land(token, context) {
    const record = this.pending.get(token);
    if (!record || record.context !== context) throw new Error('This fall is no longer pending');
    if (!record.land) {
      record.land = this._retry(token, async () => {
        this._assertCurrent(token, context.characterId);
        const result = await this.combat.applyFall(token, context);
        this.pending.delete(token);
        this.onChanged(context.characterId);
        this.gameManager.sceneAutosave?.changed('fall landing');
        return result;
      });
    }
    return record.land;
  }

  async stand(token) {
    const adapter = this.gameManager.token3DAdapter;
    const held = token.flightActive || adapter?.isWallAttached?.(token);
    if (token.__threeMesh && !held && !adapter?.hasAnimation(token, 'standUp')) {
      throw new Error('Wait for the getting-up animation to finish loading');
    }
    const result = await this.combat.standUp(token);
    if (!held) adapter?.playStandUp?.(token);
    this.onChanged(token.characterSheetId);
    this.gameManager.sceneAutosave?.changed('standing up');
    return result;
  }

  cancel(token) {
    this.pending.delete(token);
    this.dialogs.get(token)?.cancel();
  }

  dispose() {
    this.disposed = true;
    for (const token of this.pending.keys()) this.cancel(token);
  }

  // -- Explicit, recoverable errors --
  _assertCurrent(token, characterId) {
    if (
      this.disposed ||
      !this.gameManager.placedTokens.includes(token) ||
      token.characterSheetId !== characterId
    ) {
      throw new Error('The falling creature is no longer linked to this character in the scene');
    }
  }

  async _retry(token, operation) {
    while (!this.disposed && this.gameManager.placedTokens.includes(token)) {
      try {
        return await operation();
      } catch (error) {
        if (this.disposed || !this.gameManager.placedTokens.includes(token)) throw error;
        GameErrors.gameState(error, {
          component: 'FallingController',
          operation: 'resolveFall',
          tokenId: token.id,
        });
        await this._prompt(token, {
          title: 'Fall paused - not resolved',
          message: `${error.message} The creature will stay paused; no failed save is treated as a completed landing. Retry after resolving the problem.`,
          choices: [{ value: true, label: 'Retry fall resolution' }],
        });
      }
    }
    throw new Error('The falling creature was removed before its fall completed');
  }

  // -- Start-of-fall prompt --
  _prompt(token, { title, message, choices }) {
    const previousFocus = document.activeElement;
    const backdrop = document.createElement('div');
    backdrop.className = 'sheet-fall-prompt-backdrop';
    const dialog = document.createElement('section');
    dialog.className = 'sheet-card sheet-fall-prompt';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', title);
    const heading = document.createElement('h3');
    heading.textContent = title;
    const description = document.createElement('p');
    description.textContent = message;
    dialog.append(heading, description);
    backdrop.append(dialog);
    document.body.append(backdrop);
    return new Promise((resolve, reject) => {
      const finish = (value, error = null) => {
        this.dialogs.delete(token);
        backdrop.remove();
        if (previousFocus?.isConnected) previousFocus.focus();
        if (error) reject(error);
        else resolve(value);
      };
      const buttons = choices.map((choice) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = choice.label;
        button.addEventListener('click', () => finish(choice.value), { once: true });
        dialog.append(button);
        return button;
      });
      dialog.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Escape' && choices.length > 1) {
          event.preventDefault();
          finish(choices.at(-1).value);
        } else if (event.key === 'Tab') {
          event.preventDefault();
          const index = buttons.indexOf(document.activeElement);
          buttons[(index + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length].focus();
        }
      });
      this.dialogs.set(token, {
        cancel: () => finish(null, new Error('The falling creature was removed')),
      });
      buttons.at(-1).focus();
    });
  }
}
