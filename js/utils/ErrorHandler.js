// js/utils/ErrorHandler.js - Centralized error handling and logging

/**
 * Error types for categorizing different kinds of failures
 */
export const ERROR_TYPES = {
  INITIALIZATION: 'INITIALIZATION',
  SPRITE_LOADING: 'SPRITE_LOADING',
  INVALID_INPUT: 'INVALID_INPUT',
  GRID_OPERATION: 'GRID_OPERATION',
  TOKEN_OPERATION: 'TOKEN_OPERATION'
};

/**
 * Centralized error handler for the TavernTable application
 * Provides consistent error logging and user feedback
 */
export class ErrorHandler {
  /**
   * Log an error with context information
   * @param {string} type - Error type from ERROR_TYPES
   * @param {string} message - Human-readable error message
   * @param {Error} [error] - Original error object
   * @param {Object} [context] - Additional context data
   */
  static logError(type, message, error = null, context = {}) {
    const errorInfo = {
      type,
      message,
      timestamp: new Date().toISOString(),
      context,
      stack: error?.stack
    };
    
    console.error(`[${type}] ${message}`, errorInfo);
    
    // In production, this could send to error tracking service
    if (process.env.NODE_ENV === 'production') {
      // Example: sendToErrorService(errorInfo);
    }
  }
  
  /**
   * Show user-friendly error message
   * @param {string} message - Message to display to user
   * @param {boolean} [isTemporary=true] - Whether message should auto-hide
   */
  static showUserError(message, isTemporary = true) {
    // Create or update error display element
    let errorElement = document.getElementById('error-display');
    
    if (!errorElement) {
      errorElement = document.createElement('div');
      errorElement.id = 'error-display';
      errorElement.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #ff4444;
        color: white;
        padding: 10px 15px;
        border-radius: 5px;
        z-index: 1000;
        max-width: 300px;
        font-family: Arial, sans-serif;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
      `;
      document.body.appendChild(errorElement);
    }
    
    errorElement.textContent = message;
    errorElement.style.display = 'block';
    
    if (isTemporary) {
      setTimeout(() => {
        if (errorElement) {
          errorElement.style.display = 'none';
        }
      }, 5000);
    }
  }
  
  /**
   * Handle initialization errors with specific messaging
   * @param {Error} error - The initialization error
   * @param {string} component - Component that failed to initialize
   */
  static handleInitializationError(error, component) {
    const message = `Failed to initialize ${component}`;
    this.logError(ERROR_TYPES.INITIALIZATION, message, error, { component });
    this.showUserError(`Game initialization failed. Please refresh the page.`);
  }
  
  /**
   * Handle sprite loading errors gracefully
   * @param {Error} error - The sprite loading error
   * @param {string} spriteKey - The sprite that failed to load
   */
  static handleSpriteError(error, spriteKey) {
    const message = `Failed to load sprite: ${spriteKey}`;
    this.logError(ERROR_TYPES.SPRITE_LOADING, message, error, { spriteKey });
    // Don't show user error for sprite failures - use fallback graphics
  }
  
  /**
   * Handle input validation errors
   * @param {string} field - The field that failed validation
   * @param {*} value - The invalid value
   * @param {string} requirement - What was expected
   */
  static handleValidationError(field, value, requirement) {
    const message = `Invalid ${field}: ${value}. ${requirement}`;
    this.logError(ERROR_TYPES.INVALID_INPUT, message, null, { field, value, requirement });
    this.showUserError(message);
  }
}

/**
 * Wrapper for async operations with error handling
 * @param {Function} operation - Async function to execute
 * @param {string} operationName - Name for error context
 * @returns {Promise} Promise that resolves to result or null on error
 */
export async function safeAsync(operation, operationName) {
  try {
    return await operation();
  } catch (error) {
    ErrorHandler.logError(
      ERROR_TYPES.GRID_OPERATION, 
      `Failed to execute ${operationName}`, 
      error,
      { operationName }
    );
    return null;
  }
}

/**
 * Wrapper for synchronous operations with error handling
 * @param {Function} operation - Function to execute
 * @param {string} operationName - Name for error context
 * @param {*} [defaultValue=null] - Value to return on error
 * @returns {*} Operation result or default value on error
 */
export function safeSyncr(operation, operationName, defaultValue = null) {
  try {
    return operation();
  } catch (error) {
    ErrorHandler.logError(
      ERROR_TYPES.TOKEN_OPERATION, 
      `Failed to execute ${operationName}`, 
      error,
      { operationName }
    );
    return defaultValue;
  }
}
