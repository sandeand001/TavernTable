// src/utils/Validation.js - Input validation utilities

/**
 * Comprehensive validation utilities for TavernTable
 * Provides consistent input validation, type checking, and data sanitization
 */

import { GRID_CONFIG, CREATURE_SCALES, DICE_CONFIG } from '../config/GameConstants.js';
import { logger } from './Logger.js';

/**
 * Basic type validation utilities
 */
export const TypeValidators = {
    /**
     * Check if value is a valid number
     * @param {*} value - Value to check
     * @param {Object} options - Validation options
     * @returns {boolean} True if valid number
     */
    isNumber(value, options = {}) {
        if (typeof value !== 'number' || isNaN(value) || !isFinite(value)) {
            return false;
        }

        if (options.min !== undefined && value < options.min) return false;
        if (options.max !== undefined && value > options.max) return false;
        if (options.integer && !Number.isInteger(value)) return false;

        return true;
    },

    /**
     * Check if value is a valid string
     * @param {*} value - Value to check
     * @param {Object} options - Validation options
     * @returns {boolean} True if valid string
     */
    isString(value, options = {}) {
        if (typeof value !== 'string') return false;

        if (options.minLength !== undefined && value.length < options.minLength) return false;
        if (options.maxLength !== undefined && value.length > options.maxLength) return false;
        if (options.pattern && !options.pattern.test(value)) return false;
        if (options.notEmpty && value.trim().length === 0) return false;

        return true;
    },

    /**
     * Check if value is a valid object
     * @param {*} value - Value to check
     * @param {Array} requiredKeys - Required object keys
     * @returns {boolean} True if valid object
     */
    isObject(value, requiredKeys = []) {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            return false;
        }

        return requiredKeys.every(key => key in value);
    },

    /**
     * Check if value is a valid array
     * @param {*} value - Value to check
     * @param {Object} options - Validation options
     * @returns {boolean} True if valid array
     */
    isArray(value, options = {}) {
        if (!Array.isArray(value)) return false;

        if (options.minLength !== undefined && value.length < options.minLength) return false;
        if (options.maxLength !== undefined && value.length > options.maxLength) return false;
        if (options.elementType && !value.every(el => typeof el === options.elementType)) return false;

        return true;
    }
};

/**
 * Game-specific validation utilities
 */
export const GameValidators = {
    /**
     * Validate grid coordinates
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @returns {Object} Validation result
     */
    coordinates(x, y) {
        const result = { isValid: true, errors: [] };

        if (!TypeValidators.isNumber(x, { integer: true, min: 0 })) {
            result.isValid = false;
            result.errors.push(`Invalid X coordinate: ${x}. Must be a non-negative integer.`);
        }

        if (!TypeValidators.isNumber(y, { integer: true, min: 0 })) {
            result.isValid = false;
            result.errors.push(`Invalid Y coordinate: ${y}. Must be a non-negative integer.`);
        }

        return result;
    },

    /**
     * Validate creature type
     * @param {string} creatureType - Creature type to validate
     * @returns {Object} Validation result
     */
    creatureType(creatureType) {
        const result = { isValid: true, errors: [] };
        const validTypes = Object.keys(CREATURE_SCALES);

        if (!TypeValidators.isString(creatureType, { notEmpty: true })) {
            result.isValid = false;
            result.errors.push('Creature type must be a non-empty string.');
            return result;
        }

        if (!validTypes.includes(creatureType)) {
            result.isValid = false;
            result.errors.push(`Invalid creature type: ${creatureType}. Valid types: ${validTypes.join(', ')}`);
        }

        return result;
    },

    /**
     * Validate grid cell dimensions
     * @param {number} cellSize - Cell size in pixels
     * @returns {Object} Validation result
     */
    cellSize(cellSize) {
        const result = { isValid: true, errors: [] };
        const { MIN_CELL_SIZE, MAX_CELL_SIZE } = GRID_CONFIG;

        if (!TypeValidators.isNumber(cellSize, {
            integer: true,
            min: MIN_CELL_SIZE,
            max: MAX_CELL_SIZE
        })) {
            result.isValid = false;
            result.errors.push(
                `Invalid cell size: ${cellSize}. Must be an integer between ${MIN_CELL_SIZE} and ${MAX_CELL_SIZE}.`
            );
        }

        return result;
    },

    /**
     * Validate PIXI.js application instance
     * @param {Object} app - PIXI application instance
     * @returns {Object} Validation result
     */
    pixiApp(app) {
        const result = { isValid: true, errors: [] };

        // Check if app is an object
        if (!app || typeof app !== 'object') {
            result.isValid = false;
            result.errors.push('Invalid PIXI application: not an object.');
            return result;
        }

        // Check for stage property and functionality
        if (!app.stage || typeof app.stage.addChild !== 'function') {
            result.isValid = false;
            result.errors.push('Invalid PIXI application: stage is not properly initialized.');
        }

        // Check for renderer property and functionality
        if (!app.renderer || typeof app.renderer.render !== 'function') {
            result.isValid = false;
            result.errors.push('Invalid PIXI application: renderer is not properly initialized.');
        }

        // Check for canvas OR view (PIXI 7 compatibility)
        const canvas = app.canvas || app.view;
        if (!canvas) {
            result.isValid = false;
            result.errors.push('Invalid PIXI application: neither canvas nor view property available.');
        }

        return result;
    },

    /**
     * Validate DOM element
     * @param {Element} element - DOM element to validate
     * @param {string} expectedTag - Expected tag name (optional)
     * @returns {Object} Validation result
     */
    domElement(element, expectedTag = null) {
        const result = { isValid: true, errors: [] };

        if (!(element instanceof Element)) {
            result.isValid = false;
            result.errors.push('Value is not a valid DOM element.');
            return result;
        }

        if (expectedTag && element.tagName.toLowerCase() !== expectedTag.toLowerCase()) {
            result.isValid = false;
            result.errors.push(`Expected ${expectedTag} element, got ${element.tagName}.`);
        }

        if (!element.parentNode && !document.body.contains(element)) {
            result.isValid = false;
            result.errors.push('Element is not attached to the document.');
        }

        return result;
    },

    /**
     * Validate dice sides value
     * @param {number} sides - Number of sides on the die
     * @returns {Object} Validation result with isValid and message properties
     */
    validateDiceSides(sides) {
        if (!TypeValidators.isNumber(sides, { integer: true, min: 1 })) {
            return { isValid: false, message: 'Dice sides must be a positive integer' };
        }

        if (!DICE_CONFIG.VALID_SIDES.includes(sides)) {
            return {
                isValid: false,
                message: `Invalid dice type. Valid options: ${DICE_CONFIG.VALID_SIDES.join(', ')}`
            };
        }

        return { isValid: true, message: 'Valid dice sides' };
    },

    /**
     * Validate dice count value
     * @param {number} count - Number of dice to roll
     * @returns {Object} Validation result with isValid and message properties
     */
    validateDiceCount(count) {
        if (!TypeValidators.isNumber(count, { integer: true, min: DICE_CONFIG.MIN_COUNT })) {
            return {
                isValid: false,
                message: `Count must be at least ${DICE_CONFIG.MIN_COUNT}`
            };
        }

        if (count > DICE_CONFIG.MAX_COUNT) {
            return {
                isValid: false,
                message: `Maximum ${DICE_CONFIG.MAX_COUNT} dice allowed`
            };
        }

        return { isValid: true, message: 'Valid dice count' };
    }
};

/**
 * Input sanitization utilities
 */
export const Sanitizers = {
    /**
     * Sanitize and parse integer input
     * @param {*} value - Value to sanitize
     * @param {number} defaultValue - Default value if parsing fails
     * @param {Object} options - Min/max constraints
     * @returns {number} Sanitized integer
     */
    integer(value, defaultValue = 0, options = {}) {
        const parsed = parseInt(value, 10);

        if (isNaN(parsed)) return defaultValue;

        let result = parsed;
        if (options.min !== undefined) result = Math.max(result, options.min);
        if (options.max !== undefined) result = Math.min(result, options.max);

        return result;
    },

    /**
     * Sanitize string input
     * @param {*} value - Value to sanitize
     * @param {string} defaultValue - Default value if sanitization fails
     * @param {Object} options - Sanitization options
     * @returns {string} Sanitized string
     */
    string(value, defaultValue = '', options = {}) {
        if (typeof value !== 'string') return defaultValue;

        let result = value;

        if (options.trim !== false) result = result.trim();
        if (options.toLowerCase) result = result.toLowerCase();
        if (options.toUpperCase) result = result.toUpperCase();

        if (options.maxLength !== undefined) {
            result = result.substring(0, options.maxLength);
        }

        if (options.allowedChars && typeof options.allowedChars.test === 'function') {
            result = result.replace(new RegExp(`[^${options.allowedChars.source}]`, 'g'), '');
        }

        return result || defaultValue;
    },

    /**
     * Sanitize coordinates to grid bounds
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @param {Object} gridBounds - Grid boundaries
     * @returns {Object} Sanitized coordinates
     */
    coordinates(x, y, gridBounds = {}) {
        const { width = Infinity, height = Infinity } = gridBounds;

        return {
            x: Math.max(0, Math.min(Math.floor(x || 0), width - 1)),
            y: Math.max(0, Math.min(Math.floor(y || 0), height - 1))
        };
    },

    /**
     * Sanitize enum values to allowed options
     * @param {*} value - Value to sanitize
     * @param {*} defaultValue - Default value if value not in allowed list
     * @param {Array} allowedValues - Array of allowed values
     * @returns {*} Sanitized value from allowed list
     */
    enum(value, defaultValue, allowedValues = []) {
        if (!Array.isArray(allowedValues)) {
            logger.warn('Sanitizers.enum called with invalid allowedValues array', {
                allowedValues,
                defaultValue,
                value
            });
            return defaultValue;
        }

        // Check if value is in allowed list
        if (allowedValues.includes(value)) {
            return value;
        }

        // Fallback to default value
        return defaultValue;
    }
};
