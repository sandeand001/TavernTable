// src/systems/dice/dice.js - Interactive dice rolling system
/**
 * Dice Rolling System
 *
 * Provides animated dice rolling functionality with visual feedback and logging.
 * Supports standard RPG dice types (D4, D6, D8, D10, D12, D20, D100) with
 * multiple dice rolling capabilities.
 *
 * Features:
 * - Animated rolling effect with random number display
 * - Color-coded results (green for max, red for min, white for normal)
 * - Automatic logging integration with sidebar dice log
 * - Support for multiple dice of the same type
 * - Prevention of concurrent rolls during animation
 * - Comprehensive error handling and input validation
 *
 * Integration: Automatically integrates with sidebarController when available
 *
 * @module DiceSystem
 * @author TavernTable
 * @since 1.0.0
 */

// ── Imports ────────────────────────────────────────────────────
import { DICE_CONFIG } from '../../config/GameConstants.js';

import { playD20RollOnGrid } from './dice3d.js';

import { GameValidators } from '../../utils/Validation.js';
import { logger, LOG_LEVEL, LOG_CATEGORY } from '../../utils/logger/Logger.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../../utils/error/ErrorHandler.js';
import { buildRollBreakdown } from './rollSummary.js';

// ── DOM Port Injection ──────────────────────────────────────────
let _diceDomPorts = {};
export function setDiceDomPorts(ports = {}) {
  _diceDomPorts = ports || {};
}
function _getDiceButtons() {
  if (_diceDomPorts.getDiceButtons) return _diceDomPorts.getDiceButtons();
  if (typeof document === 'undefined') return [];
  return Array.from(document.querySelectorAll('[data-dice]'));
}
function _getDiceCountEl() {
  if (_diceDomPorts.getDiceCountEl) return _diceDomPorts.getDiceCountEl();
  if (typeof document === 'undefined') return null;
  return document.querySelector('[data-dice-count]');
}
function _getDiceResultEl() {
  if (_diceDomPorts.getDiceResultEl) return _diceDomPorts.getDiceResultEl();
  if (typeof document === 'undefined') return null;
  return document.querySelector('[data-dice-result]');
}

// ── 3D Dice Integration ────────────────────────────────────────
let isRolling = false;

function _releaseRollControls() {
  isRolling = false;
  _getDiceButtons().forEach((button) => {
    const wasDisabled = button.getAttribute('data-prev-disabled') === '1';
    button.disabled = wasDisabled;
    button.classList.toggle('disabled', wasDisabled);
    button.setAttribute('aria-disabled', wasDisabled ? 'true' : 'false');
    button.removeAttribute('data-prev-disabled');
  });
}

function _disableRollControls() {
  _getDiceButtons().forEach((button) => {
    if (!button.hasAttribute('data-prev-disabled')) {
      button.setAttribute('data-prev-disabled', button.disabled ? '1' : '0');
    }
    button.disabled = true;
    button.classList.add('disabled');
    button.setAttribute('aria-disabled', 'true');
  });
}

function _maybePlay3DDice({ sides, diceCount } = {}) {
  if (sides !== 20 || diceCount !== 1) {
    return Promise.resolve(null);
  }
  return playD20RollOnGrid({ dismissOnClick: true });
}

// ── Roll Logic & Animation ─────────────────────────────────────
/**
 * Rolls dice with animation and validation
 * @param {number} sides - Number of sides on the die (4, 6, 8, 10, 12, 20, 100)
 * @returns {boolean} True if roll was initiated successfully, false otherwise
 */
export function rollDice(sides) {
  try {
    // Prevent multiple concurrent rolls
    if (isRolling) {
      new ErrorHandler().handle(
        new Error('Concurrent dice roll attempt blocked'),
        ERROR_SEVERITY.LOW,
        ERROR_CATEGORY.INPUT,
        {
          context: 'rollDice',
          stage: 'concurrency_check',
          isRolling: true,
          requestedSides: sides,
        }
      );
      return false;
    }

    // Validate dice sides
    const validationResult = GameValidators.validateDiceSides(sides);
    if (!validationResult.isValid) {
      new ErrorHandler().handle(
        new Error(`Invalid dice type: ${validationResult.message}`),
        ERROR_SEVERITY.MEDIUM,
        ERROR_CATEGORY.INPUT,
        {
          context: 'rollDice',
          stage: 'dice_validation',
          requestedSides: sides,
          validationMessage: validationResult.message,
          supportedDice: DICE_CONFIG.VALID_SIDES,
        }
      );
      return false;
    }

    // Get and validate dice count
    const diceCountEl = _getDiceCountEl();
    const resultEl = _getDiceResultEl();

    if (!diceCountEl || !resultEl) {
      new ErrorHandler().handle(
        new Error('Required dice interface elements not found'),
        ERROR_SEVERITY.HIGH,
        ERROR_CATEGORY.INITIALIZATION,
        {
          context: 'rollDice',
          stage: 'element_validation',
          diceCountElement: !!diceCountEl,
          resultElement: !!resultEl,
          missingElements: [
            !diceCountEl ? 'dice-count' : null,
            !resultEl ? 'dice-result' : null,
          ].filter(Boolean),
        }
      );
      return false;
    }

    const diceCount = parseInt(diceCountEl.value) || 1;
    const countValidation = GameValidators.validateDiceCount(diceCount);
    if (!countValidation.isValid) {
      new ErrorHandler().handle(
        new Error(`Invalid dice count: ${countValidation.message}`),
        ERROR_SEVERITY.MEDIUM,
        ERROR_CATEGORY.INPUT,
        {
          context: 'rollDice',
          stage: 'count_validation',
          requestedCount: diceCount,
          originalValue: diceCountEl.value,
          validationMessage: countValidation.message,
          limits: { min: DICE_CONFIG.MIN_COUNT, max: DICE_CONFIG.MAX_COUNT },
        }
      );
      return false;
    }

    isRolling = true;

    const isSingleD20 = sides === 20 && diceCount === 1;
    const d20PhysicalRollPromise = isSingleD20 ? _maybePlay3DDice({ sides, diceCount }) : null;

    // Soft-disable dice buttons to avoid rapid re-clicks during animation
    _disableRollControls();

    // Animation phase
    let animationFrame = 0;
    const animationDuration = DICE_CONFIG.ANIMATION_FRAMES;

    const animateRoll = () => {
      try {
        animationFrame++;

        // Show a consistent status message during animation to avoid implying a final result
        if (resultEl.textContent !== 'Rolling...') {
          resultEl.textContent = 'Rolling...';
        }

        if (animationFrame < animationDuration) {
          requestAnimationFrame(animateRoll);
        } else {
          // Final result
          showFinalResult();
        }
      } catch (error) {
        new ErrorHandler().handle(error, ERROR_SEVERITY.MEDIUM, ERROR_CATEGORY.RENDERING, {
          context: 'rollDice',
          stage: 'animation_error',
          animationFrame: animationFrame,
          totalFrames: DICE_CONFIG.ANIMATION_FRAMES,
          diceType: `d${sides}`,
          diceCount: diceCount,
          isRolling: isRolling,
        });
        _releaseRollControls();
      }
    };

    const showFinalResult = () => {
      const finalize = async () => {
        const results = [];
        let total = 0;
        let physical = false;
        let digitalReason = '';

        try {
          if (isSingleD20 && d20PhysicalRollPromise) {
            const physicalRoll = await d20PhysicalRollPromise;
            if (physicalRoll?.reason === 'cancelled') {
              resultEl.textContent = 'Roll cancelled.';
              _releaseRollControls();
              return;
            }
            if (physicalRoll?.reason === 'cocked') {
              resultEl.textContent = 'D20 is cocked. Roll again.';
              _releaseRollControls();
              return;
            }
            if (
              physicalRoll?.success &&
              Number.isInteger(physicalRoll.value) &&
              physicalRoll.value >= 1 &&
              physicalRoll.value <= 20
            ) {
              results.push(physicalRoll.value);
              physical = true;
            } else if (
              physicalRoll?.reason === 'no-manager' ||
              physicalRoll?.reason === 'no-window'
            ) {
              logger.log(
                LOG_LEVEL.INFO,
                '3D d20 unavailable; using the 2D roll',
                LOG_CATEGORY.USER,
                { reason: physicalRoll.reason }
              );
              results.push(Math.floor(Math.random() * sides) + 1);
              digitalReason = physicalRoll.reason;
            } else {
              throw physicalRoll?.error || new Error('Unable to read the settled d20 face');
            }
          } else {
            for (let i = 0; i < diceCount; i++) {
              results.push(Math.floor(Math.random() * sides) + 1);
            }
          }

          total = results.reduce((sum, val) => sum + val, 0);

          logger.log(LOG_LEVEL.INFO, 'Dice roll completed', LOG_CATEGORY.USER, {
            diceType: `d${sides}`,
            diceCount: diceCount,
            results: results,
            total: total,
            rollQuality:
              diceCount === 1
                ? results[0] === sides
                  ? 'maximum'
                  : results[0] === 1
                    ? 'minimum'
                    : 'normal'
                : 'multiple_dice',
            timestamp: new Date().toISOString(),
          });

          // Determine result color based on roll quality
          let resultColor = DICE_CONFIG.COLORS.NORMAL_ROLL;
          if (diceCount === 1) {
            if (results[0] === sides) {
              resultColor = DICE_CONFIG.COLORS.MAX_ROLL;
            } else if (results[0] === 1) {
              resultColor = DICE_CONFIG.COLORS.MIN_ROLL;
            }
          } else {
            const maxPossible = diceCount * sides;
            const minPossible = diceCount;

            if (total === maxPossible) {
              resultColor = DICE_CONFIG.COLORS.MAX_ROLL;
            } else if (total === minPossible) {
              resultColor = DICE_CONFIG.COLORS.MIN_ROLL;
            }
          }

          if (diceCount === 1) {
            resultEl.textContent = `Result: d${sides} → ${results[0]}`;
          } else {
            resultEl.textContent = `Result: ${diceCount}d${sides} → [${results.join(', ')}] = ${total}`;
          }

          // Apply color coding
          resultEl.style.color = resultColor;
          resultEl.style.textShadow = `0 0 5px ${resultColor}`;

          // Log to sidebar dice log
          if (window.sidebarController) {
            const logMessage =
              diceCount === 1
                ? `Rolled d${sides}: ${results[0]}`
                : `Rolled ${diceCount}d${sides}: [${results.join(', ')}] = ${total}`;
            const expression = `${diceCount}d${sides}`;
            window.sidebarController.addDiceLogEntry(logMessage, 'roll', {
              label: diceCount === 1 ? `d${sides}` : expression,
              total,
              breakdown: buildRollBreakdown({
                expression,
                terms: [{ count: diceCount, sides, sign: 1, values: results }],
                mode: 'normal',
                total,
                physical,
                digitalReason,
              }),
            });
          }

          const t = setTimeout(() => {
            resultEl.style.color = DICE_CONFIG.COLORS.NORMAL_ROLL;
            resultEl.style.textShadow = 'none';
            _releaseRollControls();
          }, DICE_CONFIG.RESULT_DISPLAY_DURATION);
          if (typeof t?.unref === 'function') t.unref();
        } catch (error) {
          new ErrorHandler().handle(error, ERROR_SEVERITY.MEDIUM, ERROR_CATEGORY.RENDERING, {
            context: 'rollDice',
            stage: 'result_display_error',
            results: results || [],
            total: total || 0,
            diceType: `d${sides}`,
            diceCount: diceCount,
            sidebarAvailable: !!window.sidebarController,
          });
          if (!results.length) resultEl.textContent = `Unable to roll d${sides}. Please try again.`;
          _releaseRollControls();
        }
      };

      finalize();
    };

    // Start animation
    requestAnimationFrame(animateRoll);
    return true;
  } catch (error) {
    new ErrorHandler().handle(error, ERROR_SEVERITY.HIGH, ERROR_CATEGORY.SYSTEM, {
      context: 'rollDice',
      stage: 'main_function_error',
      sides: sides,
      isRolling: isRolling,
      globalScope: {
        sidebarController: !!window.sidebarController,
        diceCountElement: !!_getDiceCountEl(),
        resultElement: !!_getDiceResultEl(),
      },
    });
    _releaseRollControls();
    return false;
  }
}

export async function rollDiceExpression(
  { expression, label = 'Character roll', mode = 'normal' },
  { random = Math.random, physicalRoll = _maybePlay3DDice } = {}
) {
  if (
    typeof expression !== 'string' ||
    expression.length > 160 ||
    typeof label !== 'string' ||
    label.length > 240 ||
    !['normal', 'advantage', 'disadvantage'].includes(mode)
  ) {
    throw new Error('Invalid character dice request');
  }
  const notation = expression.toLowerCase().replace(/\s+/g, '');
  const pattern = /([+-]?)(?:(\d*)d(\d+)|(\d+))/gy;
  const terms = [];
  let cursor = 0;
  let diceCount = 0;
  while (cursor < notation.length) {
    pattern.lastIndex = cursor;
    const match = pattern.exec(notation);
    if (!match || (cursor > 0 && !match[1])) throw new Error('Unsupported dice expression');
    const sign = match[1] === '-' ? -1 : 1;
    if (match[3]) {
      const count = Number(match[2] || 1);
      const sides = Number(match[3]);
      if (
        !GameValidators.validateDiceSides(sides).isValid ||
        !GameValidators.validateDiceCount(count).isValid
      ) {
        throw new Error('Unsupported dice type or count');
      }
      diceCount += count;
      terms.push({ count, sides, sign, values: [] });
    } else {
      const value = Number(match[4]);
      if (!Number.isSafeInteger(value) || value > 10000)
        throw new Error('Dice modifier is too large');
      terms.push({ constant: sign * value });
    }
    cursor = pattern.lastIndex;
  }
  if (!terms.length || diceCount > 100)
    throw new Error('Invalid or excessively large dice expression');
  const diceTerms = terms.filter((term) => term.sides);
  const d20Check =
    diceTerms.length === 1 &&
    diceTerms[0].sides === 20 &&
    diceTerms[0].count === 1 &&
    diceTerms[0].sign === 1;
  if (mode !== 'normal' && !d20Check) throw new Error('Advantage requires a single d20 check');
  if (isRolling) throw new Error('Finish the current dice roll before rolling again');
  isRolling = true;
  _disableRollControls();
  const resultElement = _getDiceResultEl();
  if (resultElement) resultElement.textContent = `Rolling ${label}...`;
  let physical = false;
  let digitalReason = '';
  try {
    for (const term of diceTerms) {
      if (d20Check && mode === 'normal') {
        const rolled = await physicalRoll({ sides: 20, diceCount: 1 });
        if (rolled?.reason === 'cancelled') {
          const text = `${label}: roll cancelled.`;
          if (resultElement) resultElement.textContent = text;
          return { cancelled: true, text };
        }
        if (
          rolled?.success &&
          Number.isInteger(rolled.value) &&
          rolled.value >= 1 &&
          rolled.value <= 20
        ) {
          term.values.push(rolled.value);
          physical = true;
          continue;
        }
        if (!['no-manager', 'no-window'].includes(rolled?.reason)) {
          throw (
            rolled?.error ||
            new Error(
              rolled?.reason === 'cocked'
                ? 'The d20 is cocked; roll again'
                : 'Unable to read the settled d20'
            )
          );
        }
        digitalReason = ' (digital; 3D unavailable)';
        logger.log(LOG_LEVEL.INFO, 'Character roll using digital dice', LOG_CATEGORY.USER, {
          reason: rolled.reason,
        });
      }
      const count = d20Check && mode !== 'normal' ? 2 : term.count;
      for (let index = 0; index < count; index++) {
        const value = random();
        if (!Number.isFinite(value) || value < 0 || value >= 1)
          throw new Error('Invalid dice randomness');
        term.values.push(Math.floor(value * term.sides) + 1);
      }
    }
    const total = terms.reduce((sum, term) => {
      if (term.constant != null) return sum + term.constant;
      const value =
        d20Check && mode !== 'normal'
          ? mode === 'advantage'
            ? Math.max(...term.values)
            : Math.min(...term.values)
          : term.values.reduce((subtotal, roll) => subtotal + roll, 0);
      return sum + term.sign * value;
    }, 0);
    const values = diceTerms.flatMap((term) => term.values);
    const rolledText = values.length ? ` [${values.join(', ')}]` : '';
    const text = `${label}: ${notation}${mode !== 'normal' ? ` (${mode}, digital)` : digitalReason}${rolledText} = ${total}`;
    const summary = {
      label,
      total,
      breakdown: buildRollBreakdown({
        expression: notation,
        terms,
        mode,
        total,
        physical,
        digitalReason,
      }),
    };
    if (resultElement) resultElement.textContent = text;
    if (typeof window !== 'undefined')
      window.sidebarController?.addDiceLogEntry(text, 'roll', summary);
    return { expression: notation, label, mode, values, total, physical, text, summary };
  } catch (error) {
    if (resultElement) resultElement.textContent = `Unable to roll: ${error.message}`;
    throw error;
  } finally {
    _releaseRollControls();
  }
}

// No global exposure needed; UI wires events via modules
