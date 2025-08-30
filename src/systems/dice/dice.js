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

import { GameValidators } from '../../utils/Validation.js';
import { logger, LOG_LEVEL, LOG_CATEGORY } from '../../utils/Logger.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../../utils/ErrorHandler.js';
import { DICE_CONFIG } from '../../config/GameConstants.js';
import { getDiceButtons, getDiceCountEl, getDiceResultEl } from '../../ui/domHelpers.js';

// Dice rolling functionality with animation
let isRolling = false;

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
    const diceCountEl = getDiceCountEl();
    const resultEl = getDiceResultEl();

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

    // Soft-disable dice buttons to avoid rapid re-clicks during animation
    const diceButtons = getDiceButtons();
    diceButtons.forEach((btn) => {
      // Preserve prior disabled state
      if (!btn.hasAttribute('data-prev-disabled')) {
        btn.setAttribute('data-prev-disabled', btn.disabled ? '1' : '0');
      }
      btn.disabled = true;
      btn.classList.add('disabled');
      btn.setAttribute('aria-disabled', 'true');
    });

    // Animation phase
    let animationFrame = 0;
    const animationDuration = DICE_CONFIG.ANIMATION_FRAMES;

    const animateRoll = () => {
      try {
        animationFrame++;

        // Show random numbers during animation
        const tempResults = [];
        for (let i = 0; i < diceCount; i++) {
          tempResults.push(Math.floor(Math.random() * sides) + 1);
        }

        if (diceCount === 1) {
          resultEl.textContent = `Rolling... ${tempResults[0]}`;
        } else {
          const tempTotal = tempResults.reduce((sum, val) => sum + val, 0);
          resultEl.textContent = `Rolling... [${tempResults.join(', ')}] = ${tempTotal}`;
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
        isRolling = false;
        // Re-enable dice buttons based on previous state
        const diceBtns = getDiceButtons();
        diceBtns.forEach((btn) => {
          const wasDisabled = btn.getAttribute('data-prev-disabled') === '1';
          btn.disabled = wasDisabled;
          btn.classList.toggle('disabled', wasDisabled);
          btn.setAttribute('aria-disabled', wasDisabled ? 'true' : 'false');
          btn.removeAttribute('data-prev-disabled');
        });
      }
    };

    const showFinalResult = () => {
      const results = [];
      let total = 0;

      try {
        for (let i = 0; i < diceCount; i++) {
          results.push(Math.floor(Math.random() * sides) + 1);
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
          window.sidebarController.addDiceLogEntry(logMessage, 'roll');
        }

        const t = setTimeout(() => {
          resultEl.style.color = DICE_CONFIG.COLORS.NORMAL_ROLL;
          resultEl.style.textShadow = 'none';
          isRolling = false;
          // Re-enable dice buttons after successful roll concludes
          const diceBtns = getDiceButtons();
          diceBtns.forEach((btn) => {
            const wasDisabled = btn.getAttribute('data-prev-disabled') === '1';
            btn.disabled = wasDisabled;
            btn.classList.toggle('disabled', wasDisabled);
            btn.setAttribute('aria-disabled', wasDisabled ? 'true' : 'false');
            btn.removeAttribute('data-prev-disabled');
          });
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
        isRolling = false;
        // Re-enable dice buttons after result shows
        const diceBtns = getDiceButtons();
        diceBtns.forEach((btn) => {
          const wasDisabled = btn.getAttribute('data-prev-disabled') === '1';
          btn.disabled = wasDisabled;
          btn.classList.toggle('disabled', wasDisabled);
          btn.setAttribute('aria-disabled', wasDisabled ? 'true' : 'false');
          btn.removeAttribute('data-prev-disabled');
        });
      }
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
        diceCountElement: !!getDiceCountEl(),
        resultElement: !!getDiceResultEl(),
      },
    });
    isRolling = false;
    // Attempt to re-enable dice buttons on failure
    const diceBtns = getDiceButtons();
    diceBtns.forEach((btn) => {
      const wasDisabled = btn.getAttribute('data-prev-disabled') === '1';
      btn.disabled = wasDisabled;
      btn.classList.toggle('disabled', wasDisabled);
      btn.setAttribute('aria-disabled', wasDisabled ? 'true' : 'false');
      btn.removeAttribute('data-prev-disabled');
    });
    return false;
  }
}

// No global exposure needed; UI wires events via modules
