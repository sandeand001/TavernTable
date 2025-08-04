// src/systems/dice/diceLog.js - Dice Roll Logging System

/**
 * Dice Roll Logging System
 * 
 * Provides persistent logging and display of dice roll history with visual feedback.
 * Maintains a configurable history of recent rolls with timestamps and color coding.
 * 
 * Features:
 * - Fixed-position overlay with configurable max entries
 * - Color-coded results matching main dice system
 * - Automatic cleanup of old entries
 * - Responsive design with scroll support
 * - Error handling for DOM manipulation
 * 
 * @module DiceLogger
 * @author TavernTable
 * @since 1.0.0
 */

import { DICE_CONFIG } from '../../config/GameConstants.js';
import { GameErrors } from '../../utils/ErrorHandler.js';

/**
 * Dice roll logging and history management
 */
class DiceLogger {
  /**
   * Create a new DiceLogger instance
   */
  constructor() {
    this.logContainer = null;
    this.maxEntries = 20;
  }

  /**
   * Initialize the dice log UI component
   * @returns {boolean} True if initialized successfully, false otherwise
   */
  init() {
    try {
      // Prevent duplicate initialization
      if (document.getElementById('dice-log')) {
        return true;
      }
      
      this.logContainer = this.createLogContainer();
      if (!this.logContainer) {
        return false;
      }
      
      const title = this.createTitle();
      const logContent = this.createLogContent();
      
      this.logContainer.appendChild(title);
      this.logContainer.appendChild(logContent);
      document.body.appendChild(this.logContainer);
      
      return true;
      
    } catch (error) {
      GameErrors.handleError(error, 'Failed to initialize dice logger');
      return false;
    }
  }

  /**
   * Create the main log container element
   * @private
   * @returns {HTMLElement|null} Log container element or null on failure
   */
  createLogContainer() {
    try {
      const container = document.createElement('div');
      container.id = 'dice-log';
      
      // Apply styling using centralized approach
      Object.assign(container.style, {
        position: 'fixed',
        right: '20px',
        top: '20px',
        width: '250px',
        maxHeight: '400px',
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        border: '2px solid #333',
        borderRadius: '10px',
        padding: '15px',
        color: DICE_CONFIG.COLORS.NORMAL_ROLL,
        fontSize: '14px',
        overflowY: 'auto',
        zIndex: '1000',
        fontFamily: 'monospace'
      });
      
      return container;
      
    } catch (error) {
      GameErrors.handleError(error, 'Failed to create log container');
      return null;
    }
  }

  /**
   * Create the log title element
   * @private
   * @returns {HTMLElement} Title element
   */
  createTitle() {
    const title = document.createElement('div');
    title.textContent = '🎲 Dice Roll Log';
    
    Object.assign(title.style, {
      fontWeight: 'bold',
      borderBottom: '1px solid #555',
      paddingBottom: '10px',
      marginBottom: '10px',
      textAlign: 'center'
    });
    
    return title;
  }

  /**
   * Create the log content container
   * @private
   * @returns {HTMLElement} Log content element
   */
  createLogContent() {
    const logContent = document.createElement('div');
    logContent.id = 'dice-log-content';
    return logContent;
  }

  /**
   * Add a new dice roll entry to the log
   * @param {number} diceType - Number of sides on the die
   * @param {number} diceCount - Number of dice rolled
   * @param {number[]} results - Array of individual roll results
   * @param {number} total - Sum of all rolls
   * @returns {boolean} True if entry was added successfully, false otherwise
   */
  addEntry(diceType, diceCount, results, total) {
    try {
      // Validate inputs
      if (!Number.isInteger(diceType) || diceType < 1) {
        GameErrors.showValidationError('Invalid dice type for log entry');
        return false;
      }
      
      if (!Number.isInteger(diceCount) || diceCount < 1) {
        GameErrors.showValidationError('Invalid dice count for log entry');
        return false;
      }
      
      if (!Array.isArray(results) || results.length !== diceCount) {
        GameErrors.showValidationError('Invalid results array for log entry');
        return false;
      }
      
      const logContent = document.getElementById('dice-log-content');
      if (!logContent) {
        GameErrors.showSystemError('Dice log content not found');
        return false;
      }
      
      const logEntry = this.createLogEntry(diceType, diceCount, results, total);
      if (!logEntry) {
        return false;
      }
      
      // Add to bottom of log (most recent at bottom)
      logContent.appendChild(logEntry);
      
      // Keep only last maxEntries entries (remove from top)
      while (logContent.children.length > this.maxEntries) {
        logContent.removeChild(logContent.firstChild);
      }
      
      // Auto-scroll to bottom to show latest entry
      logContent.scrollTop = logContent.scrollHeight;
      
      return true;
      
    } catch (error) {
      GameErrors.handleError(error, 'Failed to add dice log entry');
      return false;
    }
  }

  /**
   * Create a formatted log entry element
   * @private
   * @param {number} diceType - Number of sides on the die
   * @param {number} diceCount - Number of dice rolled
   * @param {number[]} results - Array of individual roll results
   * @param {number} total - Sum of all rolls
   * @returns {HTMLElement|null} Log entry element or null on failure
   */
  createLogEntry(diceType, diceCount, results, total) {
    try {
      const logEntry = document.createElement('div');
      
      Object.assign(logEntry.style, {
        marginBottom: '8px',
        padding: '5px',
        borderRadius: '5px',
        backgroundColor: 'rgba(255, 255, 255, 0.1)'
      });
      
      const timestamp = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
      
      let resultText;
      let resultColor = DICE_CONFIG.COLORS.NORMAL_ROLL;
      
      if (diceCount === 1) {
        resultText = `${timestamp} - d${diceType}: ${results[0]}`;
        // Color coding for single die
        if (results[0] === diceType) {
          resultColor = DICE_CONFIG.COLORS.MAX_ROLL;
        } else if (results[0] === 1) {
          resultColor = DICE_CONFIG.COLORS.MIN_ROLL;
        }
      } else {
        resultText = `${timestamp} - ${diceCount}d${diceType}: [${results.join(', ')}] = ${total}`;
        // Color coding for multiple dice
        const maxPossible = diceCount * diceType;
        const minPossible = diceCount;
        
        if (total === maxPossible) {
          resultColor = DICE_CONFIG.COLORS.MAX_ROLL;
        } else if (total === minPossible) {
          resultColor = DICE_CONFIG.COLORS.MIN_ROLL;
        }
      }
      
      logEntry.textContent = resultText;
      logEntry.style.color = resultColor;
      
      return logEntry;
      
    } catch (error) {
      GameErrors.handleError(error, 'Failed to create log entry');
      return null;
    }
  }

  /**
   * Clear all log entries
   * @returns {boolean} True if cleared successfully, false otherwise
   */
  clear() {
    try {
      const logContent = document.getElementById('dice-log-content');
      if (logContent) {
        logContent.innerHTML = '';
        return true;
      }
      return false;
    } catch (error) {
      GameErrors.handleError(error, 'Failed to clear dice log');
      return false;
    }
  }

  /**
   * Hide the dice log
   * @returns {boolean} True if hidden successfully, false otherwise
   */
  hide() {
    try {
      if (this.logContainer) {
        this.logContainer.style.display = 'none';
        return true;
      }
      return false;
    } catch (error) {
      GameErrors.handleError(error, 'Failed to hide dice log');
      return false;
    }
  }

  /**
   * Show the dice log
   * @returns {boolean} True if shown successfully, false otherwise
   */
  show() {
    try {
      if (this.logContainer) {
        this.logContainer.style.display = 'block';
        return true;
      }
      return false;
    } catch (error) {
      GameErrors.handleError(error, 'Failed to show dice log');
      return false;
    }
  }

  /**
   * Toggle dice log visibility
   * @returns {boolean} True if toggled successfully, false otherwise
   */
  toggle() {
    try {
      if (this.logContainer) {
        const isVisible = this.logContainer.style.display !== 'none';
        this.logContainer.style.display = isVisible ? 'none' : 'block';
        return true;
      }
      return false;
    } catch (error) {
      GameErrors.handleError(error, 'Failed to toggle dice log');
      return false;
    }
  }
}

// Create singleton instance
const diceLogger = new DiceLogger();

// Export for ES6 modules
export { DiceLogger, diceLogger };

// Legacy global exports for backward compatibility
window.diceLogger = diceLogger;
window.DiceLogger = DiceLogger;
