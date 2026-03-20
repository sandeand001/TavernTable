// src/systems/dice/utils.js — Shared math & logging utilities for the dice subsystem
/**
 * Pure utility functions shared by dice.js and dice3d.js.
 * No side effects, no imports — safe to import anywhere.
 *
 * @module DiceUtils
 */

/**
 * Cubic ease-out: starts fast, decelerates to a stop.
 * @param {number} t - Progress in [0, 1].
 * @returns {number} Eased value in [0, 1].
 */
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

/**
 * Returns a random float in the range [min, max).
 * @param {number} min - Inclusive lower bound.
 * @param {number} max - Exclusive upper bound.
 * @returns {number}
 */
export const randomBetween = (min, max) => min + Math.random() * (max - min);

/**
 * Clamps a finite number to [min, max]. Non-finite values pass through unchanged.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clampToRange(value, min, max) {
  if (!Number.isFinite(value)) return value;
  if (Number.isFinite(min) && value < min) return min;
  if (Number.isFinite(max) && value > max) return max;
  return value;
}

/**
 * Clamps a grid coordinate to [0, maxExclusive - 1].
 * Non-finite inputs are returned unchanged.
 * @param {number} value
 * @param {number} maxExclusive - Exclusive upper bound (e.g. grid column count).
 * @returns {number}
 */
export function clampGridCoordinate(value, maxExclusive) {
  if (!Number.isFinite(value) || !Number.isFinite(maxExclusive)) return value;
  if (value < 0) return 0;
  if (value >= maxExclusive) return maxExclusive - 1;
  return value;
}

/**
 * Converts an Error into a plain serialisable payload for structured logging.
 * Returns undefined when error is falsy so log calls can omit the field cleanly.
 * @param {Error|null|undefined} error
 * @returns {{ message: string, stack: string, name: string } | undefined}
 */
export const toErrorPayload = (error) =>
  error
    ? {
        message: error.message,
        stack: error.stack,
        name: error.name,
      }
    : undefined;
