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
import { GameErrors } from '../../utils/ErrorHandler.js';
import { DICE_CONFIG } from '../../config/GameConstants.js';

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
      GameErrors.showUserError('Please wait for current roll to complete');
      return false;
    }
    
    // Validate dice sides
    const validationResult = GameValidators.validateDiceSides(sides);
    if (!validationResult.isValid) {
      GameErrors.showValidationError(`Invalid dice type: ${validationResult.message}`);
      return false;
    }
    
    // Get and validate dice count
    const diceCountEl = document.getElementById('dice-count');
    const resultEl = document.getElementById('dice-result');
    
    if (!diceCountEl || !resultEl) {
      GameErrors.showSystemError('Dice interface elements not found');
      return false;
    }

    const diceCount = parseInt(diceCountEl.value) || 1;
    const countValidation = GameValidators.validateDiceCount(diceCount);
    if (!countValidation.isValid) {
      GameErrors.showValidationError(`Invalid dice count: ${countValidation.message}`);
      return false;
    }

    isRolling = true;
    
    // Animation phase
    let animationFrame = 0;
    const animationDuration = DICE_CONFIG.ANIMATION_FRAMES;
    
    function animateRoll() {
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
        GameErrors.handleError(error, 'Failed to animate dice roll');
        isRolling = false;
      }
    }
    
    function showFinalResult() {
      try {
        const results = [];
        for (let i = 0; i < diceCount; i++) {
          results.push(Math.floor(Math.random() * sides) + 1);
        }
        
        const total = results.reduce((sum, val) => sum + val, 0);
        
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
          const logMessage = diceCount === 1 
            ? `Rolled d${sides}: ${results[0]}`
            : `Rolled ${diceCount}d${sides}: [${results.join(', ')}] = ${total}`;
          window.sidebarController.addDiceLogEntry(logMessage, 'roll');
        }
        
        setTimeout(() => {
          resultEl.style.color = DICE_CONFIG.COLORS.NORMAL_ROLL;
          resultEl.style.textShadow = 'none';
          isRolling = false;
        }, DICE_CONFIG.RESULT_DISPLAY_DURATION);
      } catch (error) {
        GameErrors.handleError(error, 'Failed to display dice result');
        isRolling = false;
      }
    }
    
    // Start animation
    requestAnimationFrame(animateRoll);
    return true;
    
  } catch (error) {
    GameErrors.handleError(error, 'Failed to roll dice');
    isRolling = false;
    return false;
  }
}

// Make rollDice available globally for HTML onclick handlers
window.rollDice = rollDice;
