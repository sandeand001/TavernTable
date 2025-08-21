
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
					requestedSides: sides
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
					requestedSides: sides
				}
			);
			return false;
		}
		// ...existing code...
	} catch (error) {
		new ErrorHandler().handle(error, ERROR_SEVERITY.HIGH, ERROR_CATEGORY.INPUT, {
			context: 'rollDice',
			stage: 'exception',
			error: error.message
		});
		return false;
	}
}
// ...existing code...
