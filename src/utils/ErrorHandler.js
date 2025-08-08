// src/utils/ErrorHandler.js - Centralized error handling system

/**
 * Centralized error handling for the TavernTable application
 * Provides consistent error logging, user notifications, and recovery strategies
 */

/**
 * Error severity levels
 */
export const ERROR_LEVELS = {
  INFO: 'info',
  WARNING: 'warning', 
  ERROR: 'error',
  CRITICAL: 'critical'
};

/**
 * Error categories for better organization
 */
export const ERROR_CATEGORIES = {
  INITIALIZATION: 'initialization',
  RENDERING: 'rendering',
  INPUT: 'input',
  SPRITES: 'sprites',
  VALIDATION: 'validation',
  NETWORK: 'network'
};

/**
 * Main error handler class
 */
export class ErrorHandler {
  constructor() {
    this.errorLog = [];
    this.maxLogSize = 100;
    this.isInitialized = false;
  }
  
  /**
   * Initialize error handler with user notification system
   */
  initialize() {
    // Create error display element if it doesn't exist
    if (!document.getElementById('error-display')) {
      const errorDiv = document.createElement('div');
      errorDiv.id = 'error-display';
      errorDiv.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        max-width: 300px;
        z-index: 10000;
        font-family: Arial, sans-serif;
      `;
      document.body.appendChild(errorDiv);
    }
    this.isInitialized = true;
  }
  
  /**
   * Log and handle an error
   * @param {Error|string} error - Error object or message
   * @param {string} level - Error severity level
   * @param {string} category - Error category
   * @param {Object} context - Additional context information
   */
  handle(error, level = ERROR_LEVELS.ERROR, category = ERROR_CATEGORIES.VALIDATION, context = {}) {
    const errorEntry = {
      timestamp: new Date().toISOString(),
      message: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : null,
      level,
      category,
      context,
      id: Date.now() + Math.random()
    };
    
    // Add to log
    this.errorLog.push(errorEntry);
    if (this.errorLog.length > this.maxLogSize) {
      this.errorLog.shift();
    }
    
    // Console logging
    this.logToConsole(errorEntry);
    
    // User notification for important errors
    if (level === ERROR_LEVELS.ERROR || level === ERROR_LEVELS.CRITICAL) {
      this.showUserNotification(errorEntry);
    }
    
    return errorEntry.id;
  }
  
  /**
   * Log error to console with appropriate method
   * @param {Object} errorEntry - Error entry object
   */
  logToConsole(errorEntry) {
    const prefix = `[${errorEntry.level.toUpperCase()}][${errorEntry.category}]`;
    const message = `${prefix} ${errorEntry.message}`;
    
    switch (errorEntry.level) {
      case ERROR_LEVELS.INFO:
        console.info(message, errorEntry.context);
        break;
      case ERROR_LEVELS.WARNING:
        console.warn(message, errorEntry.context);
        break;
      case ERROR_LEVELS.ERROR:
      case ERROR_LEVELS.CRITICAL:
        console.error(message, errorEntry);
        break;
      default:
        console.log(message, errorEntry.context);
    }
  }
  
  /**
   * Show user-friendly notification
   * @param {Object} errorEntry - Error entry object
   */
  showUserNotification(errorEntry) {
    if (!this.isInitialized) {
      this.initialize();
    }
    
    const errorDisplay = document.getElementById('error-display');
    if (!errorDisplay) return;
    
    const notification = document.createElement('div');
    notification.style.cssText = `
      background: ${errorEntry.level === ERROR_LEVELS.CRITICAL ? '#dc3545' : '#f8d7da'};
      color: ${errorEntry.level === ERROR_LEVELS.CRITICAL ? 'white' : '#721c24'};
      padding: 10px;
      margin-bottom: 5px;
      border-radius: 4px;
      border: 1px solid ${errorEntry.level === ERROR_LEVELS.CRITICAL ? '#dc3545' : '#f5c6cb'};
      animation: slideIn 0.3s ease-out;
    `;
    
    // Create secure DOM elements instead of innerHTML to prevent XSS
    const strongElement = document.createElement('strong');
    strongElement.textContent = errorEntry.level === ERROR_LEVELS.CRITICAL ? 'Critical Error' : 'Error';
    
    const messageElement = document.createElement('span');
    messageElement.textContent = this.getUserFriendlyMessage(errorEntry);
    
    const closeButton = document.createElement('button');
    closeButton.textContent = '×';
    closeButton.style.cssText = 'float: right; background: none; border: none; color: inherit; cursor: pointer;';
    closeButton.addEventListener('click', () => notification.remove());
    
    notification.appendChild(strongElement);
    notification.appendChild(document.createElement('br'));
    notification.appendChild(messageElement);
    notification.appendChild(closeButton);
    
    errorDisplay.appendChild(notification);
    
    // Auto-remove after delay (except critical errors)
    if (errorEntry.level !== ERROR_LEVELS.CRITICAL) {
      setTimeout(() => {
        if (notification.parentElement) {
          notification.remove();
        }
      }, 5000);
    }
  }
  
  /**
   * Convert technical error to user-friendly message
   * @param {Object} errorEntry - Error entry object
   * @returns {string} User-friendly message
   */
  getUserFriendlyMessage(errorEntry) {
    const categoryMessages = {
      [ERROR_CATEGORIES.INITIALIZATION]: 'Failed to start the game. Please refresh the page.',
      [ERROR_CATEGORIES.RENDERING]: 'Display issue encountered. The game may not render correctly.',
      [ERROR_CATEGORIES.INPUT]: 'Input processing error. Some controls may not work.',
      [ERROR_CATEGORIES.SPRITES]: 'Asset loading failed. Some graphics may appear as colored shapes.',
      [ERROR_CATEGORIES.VALIDATION]: 'Invalid input detected. Please check your settings.',
      [ERROR_CATEGORIES.NETWORK]: 'Network issue encountered. Some features may be unavailable.'
    };
    
    return categoryMessages[errorEntry.category] || 'An unexpected error occurred.';
  }
  
  /**
   * Get recent errors
   * @param {number} count - Number of recent errors to return
   * @returns {Array} Recent error entries
   */
  getRecentErrors(count = 10) {
    return this.errorLog.slice(-count);
  }
  
  /**
   * Clear error log
   */
  clearLog() {
    this.errorLog = [];
  }
}

// Global error handler instance
export const errorHandler = new ErrorHandler();

/**
 * Convenience functions for common error scenarios
 */
export const GameErrors = {
  /**
   * Handle initialization errors
   * @param {Error|string} error - Error details
   * @param {Object} context - Additional context
   */
  initialization(error, context = {}) {
    return errorHandler.handle(error, ERROR_LEVELS.CRITICAL, ERROR_CATEGORIES.INITIALIZATION, context);
  },
  
  /**
   * Handle rendering errors
   * @param {Error|string} error - Error details
   * @param {Object} context - Additional context
   */
  rendering(error, context = {}) {
    return errorHandler.handle(error, ERROR_LEVELS.ERROR, ERROR_CATEGORIES.RENDERING, context);
  },
  
  /**
   * Handle validation errors
   * @param {Error|string} error - Error details
   * @param {Object} context - Additional context
   */
  validation(error, context = {}) {
    return errorHandler.handle(error, ERROR_LEVELS.WARNING, ERROR_CATEGORIES.VALIDATION, context);
  },
  
  /**
   * Handle sprite loading errors
   * @param {Error|string} error - Error details
   * @param {Object} context - Additional context
   */
  sprites(error, context = {}) {
    return errorHandler.handle(error, ERROR_LEVELS.WARNING, ERROR_CATEGORIES.SPRITES, context);
  },
  
  /**
   * Handle input validation errors
   * @param {Error|string} error - Error details
   * @param {Object} context - Additional context
   */
  input(error, context = {}) {
    return errorHandler.handle(error, ERROR_LEVELS.WARNING, ERROR_CATEGORIES.INPUT, context);
  },
  
  /**
   * Handle network errors
   * @param {Error|string} error - Error details
   * @param {Object} context - Additional context
   */
  network(error, context = {}) {
    return errorHandler.handle(error, ERROR_LEVELS.ERROR, ERROR_CATEGORIES.NETWORK, context);
  },
  
  /**
   * Generic error handler
   * @param {Error|string} error - Error details
   * @param {string} message - User-friendly message
   * @param {Object} context - Additional context
   */
  handleError(error, message, context = {}) {
    return errorHandler.handle(error, ERROR_LEVELS.ERROR, ERROR_CATEGORIES.INITIALIZATION, { message, ...context });
  }
};
