/**
 * ErrorHandler.js - Focused Error Management System for TavernTable
 * 
 * Pure error handling system focused on error processing, user notifications,
 * recovery strategies, and telemetry. All logging functionality moved to Logger.js
 * for proper separation of concerns.
 * 
 * Features:
 * - Error processing and categorization
 * - User-friendly notification system
 * - Error recovery and retry mechanisms
 * - Telemetry collection for production debugging
 * - Integration with Logger for structured logging
 * 
 * @author TavernTable Development Team
 * @version 2.1.0
 */

import { logger, LOG_LEVEL, LOG_CATEGORY } from './Logger.js';

/**
 * Error severity levels with semantic meaning
 */
export const ERROR_SEVERITY = Object.freeze({
  DEBUG: 'debug',      // Development information, not shown to users
  INFO: 'info',        // Informational messages, minimal user impact
  WARNING: 'warning',  // Non-critical issues that should be monitored
  ERROR: 'error',      // Application errors that affect functionality
  CRITICAL: 'critical' // System-level failures requiring immediate attention
});

/**
 * Error categories for organized logging and handling
 */
export const ERROR_CATEGORY = Object.freeze({
  INITIALIZATION: 'initialization',   // Game startup and setup failures
  RENDERING: 'rendering',            // Graphics and display issues
  INPUT: 'input',                    // User interaction problems
  ASSETS: 'assets',                  // Resource loading failures
  VALIDATION: 'validation',          // Data validation errors
  NETWORK: 'network',               // API and connectivity issues
  COORDINATE: 'coordinate',         // Grid and positioning errors
  TOKEN: 'token',                   // Token management failures
  GAME_STATE: 'game_state',         // Game logic and state errors
  PERFORMANCE: 'performance',       // Performance and memory issues
  SECURITY: 'security',             // Security-related errors
  SYSTEM: 'system'                  // System-level and environment errors
});

/**
 * Error recovery strategies
 */
export const RECOVERY_STRATEGY = Object.freeze({
  NONE: 'none',                    // No automatic recovery
  RETRY: 'retry',                  // Attempt operation again
  FALLBACK: 'fallback',           // Use alternative implementation
  RELOAD: 'reload',               // Reload component or page
  RESET: 'reset',                 // Reset to initial state
  GRACEFUL_DEGRADATION: 'graceful' // Continue with reduced functionality
});

/**
 * Configuration interface for error handling behavior
 */
export class ErrorHandlerConfig {
  constructor(options = {}) {
    this.environment = options.environment || 'development';
    this.enableUserNotifications = options.enableUserNotifications ?? true;
    this.enableTelemetry = options.enableTelemetry ?? false;
    this.enableRetry = options.enableRetry ?? true;
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 1000;
    this.maxLogEntries = options.maxLogEntries || 500;
    this.telemetryEndpoint = options.telemetryEndpoint || null;
    this.userNotificationTimeout = options.userNotificationTimeout || 5000;
  }
}

/**
 * Structured error entry with comprehensive metadata
 */
export class ErrorEntry {
  constructor(error, severity, category, context = {}) {
    this.id = this.generateId();
    this.timestamp = new Date().toISOString();
    this.severity = severity;
    this.category = category;
    this.message = this.extractMessage(error);
    this.stack = this.extractStack(error);
    this.context = this.sanitizeContext(context);
    this.userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown';
    this.url = typeof window !== 'undefined' ? window.location.href : 'Unknown';
    this.sessionId = this.getSessionId();
    this.retryCount = 0;
    this.resolved = false;
  }

  generateId() {
    return `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  extractMessage(error) {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    if (error && typeof error.toString === 'function') return error.toString();
    return 'Unknown error occurred';
  }

  extractStack(error) {
    if (error instanceof Error && error.stack) {
      return error.stack.split('\n').slice(0, 10).join('\n'); // Limit stack trace
    }
    return null;
  }

  sanitizeContext(context) {
    // Remove sensitive information and limit context size
    const sanitized = {};
    const maxValueLength = 1000;
    
    for (const [key, value] of Object.entries(context)) {
      if (this.isSensitiveKey(key)) continue;
      
      if (typeof value === 'string' && value.length > maxValueLength) {
        sanitized[key] = value.substring(0, maxValueLength) + '...';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = JSON.stringify(value).substring(0, maxValueLength);
      } else {
        sanitized[key] = value;
      }
    }
    
    return sanitized;
  }

  isSensitiveKey(key) {
    const sensitivePatterns = /password|token|secret|key|auth|credential/i;
    return sensitivePatterns.test(key);
  }

  getSessionId() {
    if (typeof sessionStorage !== 'undefined') {
      let sessionId = sessionStorage.getItem('tavern_session_id');
      if (!sessionId) {
        sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        sessionStorage.setItem('tavern_session_id', sessionId);
      }
      return sessionId;
    }
    return 'unknown_session';
  }

  toJSON() {
    return {
      id: this.id,
      timestamp: this.timestamp,
      severity: this.severity,
      category: this.category,
      message: this.message,
      stack: this.stack,
      context: this.context,
      userAgent: this.userAgent,
      url: this.url,
      sessionId: this.sessionId,
      retryCount: this.retryCount,
      resolved: this.resolved
    };
  }
}

/**
 * User notification manager for error display
 */
export class ErrorNotificationManager {
  constructor(config) {
    this.config = config;
    this.container = null;
    this.activeNotifications = new Map();
    this.initialized = false;
  }

  initialize() {
    if (this.initialized || typeof document === 'undefined') return;

    this.container = document.getElementById('tavern-error-container');
    if (!this.container) {
      this.container = this.createContainer();
      document.body.appendChild(this.container);
    }

    this.injectStyles();
    this.initialized = true;
  }

  createContainer() {
    const container = document.createElement('div');
    container.id = 'tavern-error-container';
    container.className = 'tavern-error-container';
    return container;
  }

  injectStyles() {
    if (document.getElementById('tavern-error-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'tavern-error-styles';
    styles.textContent = `
      .tavern-error-container {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 10000;
        max-width: 400px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }

      .tavern-error-notification {
        margin-bottom: 10px;
        padding: 12px 16px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        animation: slideInRight 0.3s ease-out;
        max-height: 200px;
        overflow: hidden;
        position: relative;
      }

      .tavern-error-notification.error {
        background: #fee;
        color: #d63384;
        border: 1px solid #f5c2c7;
      }

      .tavern-error-notification.critical {
        background: #dc3545;
        color: white;
        border: 1px solid #b02a37;
      }

      .tavern-error-notification.warning {
        background: #fff3cd;
        color: #664d03;
        border: 1px solid #ffecb5;
      }

      .tavern-error-header {
        font-weight: 600;
        margin-bottom: 4px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .tavern-error-message {
        font-size: 14px;
        line-height: 1.4;
      }

      .tavern-error-close {
        background: none;
        border: none;
        color: inherit;
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
        opacity: 0.7;
        padding: 0;
        margin-left: 8px;
      }

      .tavern-error-close:hover {
        opacity: 1;
      }

      .tavern-error-actions {
        margin-top: 8px;
        display: flex;
        gap: 8px;
      }

      .tavern-error-button {
        background: rgba(255, 255, 255, 0.2);
        border: 1px solid rgba(255, 255, 255, 0.3);
        color: inherit;
        padding: 4px 8px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
      }

      .tavern-error-button:hover {
        background: rgba(255, 255, 255, 0.3);
      }

      @keyframes slideInRight {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }

      @keyframes slideOutRight {
        from {
          transform: translateX(0);
          opacity: 1;
        }
        to {
          transform: translateX(100%);
          opacity: 0;
        }
      }
    `;
    document.head.appendChild(styles);
  }

  show(errorEntry, recoveryStrategy = RECOVERY_STRATEGY.NONE) {
    if (!this.config.enableUserNotifications || !this.shouldShowToUser(errorEntry.severity)) {
      return;
    }

    this.initialize();
    
    const notification = this.createNotification(errorEntry, recoveryStrategy);
    this.container.appendChild(notification);
    this.activeNotifications.set(errorEntry.id, notification);

    // Auto-dismiss for non-critical errors
    if (errorEntry.severity !== ERROR_SEVERITY.CRITICAL) {
      setTimeout(() => {
        this.dismiss(errorEntry.id);
      }, this.config.userNotificationTimeout);
    }
  }

  createNotification(errorEntry, recoveryStrategy) {
    const notification = document.createElement('div');
    notification.className = `tavern-error-notification ${errorEntry.severity}`;
    notification.dataset.errorId = errorEntry.id;

    const header = document.createElement('div');
    header.className = 'tavern-error-header';

    const title = document.createElement('span');
    title.textContent = this.getSeverityTitle(errorEntry.severity);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'tavern-error-close';
    closeBtn.textContent = '×';
    closeBtn.onclick = () => this.dismiss(errorEntry.id);

    header.appendChild(title);
    header.appendChild(closeBtn);

    const message = document.createElement('div');
    message.className = 'tavern-error-message';
    message.textContent = this.getUserFriendlyMessage(errorEntry);

    notification.appendChild(header);
    notification.appendChild(message);

    // Add recovery actions if available
    if (recoveryStrategy !== RECOVERY_STRATEGY.NONE) {
      const actions = this.createRecoveryActions(errorEntry, recoveryStrategy);
      if (actions) {
        notification.appendChild(actions);
      }
    }

    return notification;
  }

  createRecoveryActions(errorEntry, strategy) {
    const actions = document.createElement('div');
    actions.className = 'tavern-error-actions';

    switch (strategy) {
    case RECOVERY_STRATEGY.RETRY: {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'tavern-error-button';
      retryBtn.textContent = 'Retry';
      retryBtn.onclick = () => this.handleRetry(errorEntry);
      actions.appendChild(retryBtn);
      break;
    }

    case RECOVERY_STRATEGY.RELOAD: {
      const reloadBtn = document.createElement('button');
      reloadBtn.className = 'tavern-error-button';
      reloadBtn.textContent = 'Reload';
      reloadBtn.onclick = () => window.location.reload();
      actions.appendChild(reloadBtn);
      break;
    }
    }

    return actions.children.length > 0 ? actions : null;
  }

  handleRetry(errorEntry) {
    // Emit retry event for handlers to catch
    const retryEvent = new CustomEvent('errorRetry', {
      detail: { errorEntry }
    });
    window.dispatchEvent(retryEvent);
    this.dismiss(errorEntry.id);
  }

  dismiss(errorId) {
    const notification = this.activeNotifications.get(errorId);
    if (notification) {
      notification.style.animation = 'slideOutRight 0.3s ease-in';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
        this.activeNotifications.delete(errorId);
      }, 300);
    }
  }

  dismissAll() {
    for (const [errorId] of this.activeNotifications) {
      this.dismiss(errorId);
    }
  }

  shouldShowToUser(severity) {
    return severity === ERROR_SEVERITY.ERROR || severity === ERROR_SEVERITY.CRITICAL;
  }

  getSeverityTitle(severity) {
    const titles = {
      [ERROR_SEVERITY.DEBUG]: 'Debug',
      [ERROR_SEVERITY.INFO]: 'Information',
      [ERROR_SEVERITY.WARNING]: 'Warning',
      [ERROR_SEVERITY.ERROR]: 'Error',
      [ERROR_SEVERITY.CRITICAL]: 'Critical Error'
    };
    return titles[severity] || 'Error';
  }

  getUserFriendlyMessage(errorEntry) {
    // Category-specific user-friendly messages
    const categoryMessages = {
      [ERROR_CATEGORY.INITIALIZATION]: 'Game failed to start properly. Please refresh the page.',
      [ERROR_CATEGORY.RENDERING]: 'Display issue detected. Some graphics may not appear correctly.',
      [ERROR_CATEGORY.INPUT]: 'Input problem encountered. Some controls may not respond.',
      [ERROR_CATEGORY.ASSETS]: 'Failed to load game assets. Some features may appear as placeholders.',
      [ERROR_CATEGORY.VALIDATION]: 'Invalid input detected. Please check your settings.',
      [ERROR_CATEGORY.NETWORK]: 'Network connection issue. Some features may be unavailable.',
      [ERROR_CATEGORY.COORDINATE]: 'Grid positioning error. Token placement may be affected.',
      [ERROR_CATEGORY.TOKEN]: 'Token management issue. Some tokens may not behave correctly.',
      [ERROR_CATEGORY.GAME_STATE]: 'Game state error. The game may not function as expected.',
      [ERROR_CATEGORY.PERFORMANCE]: 'Performance issue detected. The game may run slowly.',
      [ERROR_CATEGORY.SECURITY]: 'Security validation failed. Action was blocked for safety.',
      [ERROR_CATEGORY.SYSTEM]: 'System error encountered. Please try again.'
    };

    return categoryMessages[errorEntry.category] || errorEntry.message || 'An unexpected error occurred.';
  }
}

/**
 * Telemetry manager for error reporting
 */
export class ErrorTelemetryManager {
  constructor(config) {
    this.config = config;
    this.pendingErrors = [];
    this.sendTimeout = null;
  }

  async report(errorEntry) {
    if (!this.config.enableTelemetry || !this.config.telemetryEndpoint) {
      return;
    }

    this.pendingErrors.push(errorEntry.toJSON());
    
    // Batch send errors to reduce network requests
    if (this.sendTimeout) {
      clearTimeout(this.sendTimeout);
    }
    
    this.sendTimeout = setTimeout(() => {
      this.sendBatch();
    }, 2000);
  }

  async sendBatch() {
    if (this.pendingErrors.length === 0) return;

    const errors = [...this.pendingErrors];
    this.pendingErrors = [];

    try {
      await fetch(this.config.telemetryEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          errors,
          metadata: {
            userAgent: navigator.userAgent,
            timestamp: new Date().toISOString(),
            environment: this.config.environment
          }
        })
      });
    } catch (error) {
      // Failed to send telemetry - add back to pending (with limit)
      if (this.pendingErrors.length < 50) {
        this.pendingErrors.unshift(...errors);
      }
    }
  }
}

/**
 * Main ErrorHandler class - Central error management system
 */
export class ErrorHandler {
  constructor(config = {}) {
    this.config = new ErrorHandlerConfig(config);
    this.errorLog = [];
    this.notificationManager = new ErrorNotificationManager(this.config);
    this.telemetryManager = new ErrorTelemetryManager(this.config);
    this.recoveryStrategies = new Map();
    this.errorCounts = new Map();
    this.initialized = false;
    this.logger = logger; // Use the imported logger instance

    this.initialize();
  }

  initialize() {
    if (this.initialized) return;

    // Set up global error handlers
    if (typeof window !== 'undefined') {
      window.addEventListener('error', (event) => {
        this.handle(event.error, ERROR_SEVERITY.ERROR, ERROR_CATEGORY.SYSTEM, {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno
        });
      });

      window.addEventListener('unhandledrejection', (event) => {
        this.handle(event.reason, ERROR_SEVERITY.ERROR, ERROR_CATEGORY.SYSTEM, {
          type: 'unhandled_promise_rejection',
          promise: event.promise
        });
      });
    }

    this.initialized = true;
  }

  /**
   * Main error handling method
   * @param {Error|string} error - Error object or message
   * @param {string} severity - Error severity level
   * @param {string} category - Error category
   * @param {Object} context - Additional context information
   * @param {string} recoveryStrategy - Recovery strategy to apply
   * @returns {string} Error ID for tracking
   */
  handle(error, severity = ERROR_SEVERITY.ERROR, category = ERROR_CATEGORY.SYSTEM, context = {}, recoveryStrategy = RECOVERY_STRATEGY.NONE) {
    try {
      // Create structured error entry
      const errorEntry = new ErrorEntry(error, severity, category, context);
      
      // Add to internal log
      this.addToLog(errorEntry);
      
      // Log to central Logger system
      const logLevel = this.mapSeverityToLogLevel(severity);
      this.logger.log(logLevel, LOG_CATEGORY.ERROR, errorEntry.message, {
        errorId: errorEntry.id,
        category: errorEntry.category,
        context: errorEntry.context,
        stack: errorEntry.stack,
        userAgent: errorEntry.userAgent,
        url: errorEntry.url,
        sessionId: errorEntry.sessionId
      });
      
      // User notification
      this.notificationManager.show(errorEntry, recoveryStrategy);
      
      // Telemetry reporting
      this.telemetryManager.report(errorEntry);
      
      // Track error frequency
      this.trackErrorFrequency(errorEntry);
      
      // Apply recovery strategy
      this.applyRecoveryStrategy(errorEntry, recoveryStrategy);
      
      return errorEntry.id;
    } catch (handlerError) {
      // Fallback error handling to prevent infinite loops
      // Use direct console logging to avoid recursive error handling
      console.error('ErrorHandler failed to handle error:', handlerError);
      console.error('Original error:', error);
      return 'handler_error_' + Date.now();
    }
  }

  addToLog(errorEntry) {
    this.errorLog.push(errorEntry);
    
    // Maintain log size limit
    if (this.errorLog.length > this.config.maxLogEntries) {
      this.errorLog.shift();
    }
  }

  /**
   * Maps error severity to Logger log levels
   */
  mapSeverityToLogLevel(severity) {
    switch (severity) {
    case ERROR_SEVERITY.DEBUG:
      return LOG_LEVEL.DEBUG;
    case ERROR_SEVERITY.INFO:
      return LOG_LEVEL.INFO;
    case ERROR_SEVERITY.WARNING:
      return LOG_LEVEL.WARN;
    case ERROR_SEVERITY.ERROR:
      return LOG_LEVEL.ERROR;
    case ERROR_SEVERITY.CRITICAL:
      return LOG_LEVEL.FATAL;
    default:
      return LOG_LEVEL.INFO;
    }
  }

  trackErrorFrequency(errorEntry) {
    const key = `${errorEntry.category}:${errorEntry.message}`;
    const current = this.errorCounts.get(key) || 0;
    this.errorCounts.set(key, current + 1);

    // Alert on high frequency errors
    if (current + 1 >= 5) {
      this.handle(
        `High frequency error detected: ${errorEntry.message}`,
        ERROR_SEVERITY.WARNING,
        ERROR_CATEGORY.SYSTEM,
        { originalErrorId: errorEntry.id, frequency: current + 1 }
      );
    }
  }

  applyRecoveryStrategy(errorEntry, strategy) {
    switch (strategy) {
    case RECOVERY_STRATEGY.RETRY:
      this.scheduleRetry(errorEntry);
      break;
    case RECOVERY_STRATEGY.FALLBACK:
      this.executeFallback(errorEntry);
      break;
    case RECOVERY_STRATEGY.RESET:
      this.executeReset(errorEntry);
      break;
    case RECOVERY_STRATEGY.GRACEFUL_DEGRADATION:
      this.executeGracefulDegradation(errorEntry);
      break;
    default:
      // No recovery action
      break;
    }
  }

  scheduleRetry(errorEntry) {
    if (errorEntry.retryCount >= this.config.maxRetries) {
      this.handle(
        `Max retries exceeded for error: ${errorEntry.message}`,
        ERROR_SEVERITY.ERROR,
        errorEntry.category,
        { originalErrorId: errorEntry.id }
      );
      return;
    }

    setTimeout(() => {
      errorEntry.retryCount++;
      // Emit retry event
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('errorRetry', {
          detail: { errorEntry }
        }));
      }
    }, this.config.retryDelay * Math.pow(2, errorEntry.retryCount)); // Exponential backoff
  }

  executeFallback(errorEntry) {
    // Emit fallback event for handlers to implement specific fallback logic
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('errorFallback', {
        detail: { errorEntry }
      }));
    }
  }

  executeReset(errorEntry) {
    // Emit reset event
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('errorReset', {
        detail: { errorEntry }
      }));
    }
  }

  executeGracefulDegradation(errorEntry) {
    // Emit graceful degradation event
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('errorGracefulDegradation', {
        detail: { errorEntry }
      }));
    }
  }

  /**
   * Get recent errors with optional filtering
   * @param {Object} filters - Filter criteria
   * @returns {Array} Filtered error entries
   */
  getErrors(filters = {}) {
    let errors = [...this.errorLog];

    if (filters.severity) {
      errors = errors.filter(e => e.severity === filters.severity);
    }

    if (filters.category) {
      errors = errors.filter(e => e.category === filters.category);
    }

    if (filters.limit) {
      errors = errors.slice(-filters.limit);
    }

    if (filters.since) {
      const since = new Date(filters.since);
      errors = errors.filter(e => new Date(e.timestamp) >= since);
    }

    return errors;
  }

  /**
   * Get error statistics
   * @returns {Object} Error statistics
   */
  getStatistics() {
    const stats = {
      total: this.errorLog.length,
      bySeverity: {},
      byCategory: {},
      recent: this.errorLog.filter(e => 
        new Date() - new Date(e.timestamp) < 3600000 // Last hour
      ).length
    };

    for (const severity of Object.values(ERROR_SEVERITY)) {
      stats.bySeverity[severity] = this.errorLog.filter(e => e.severity === severity).length;
    }

    for (const category of Object.values(ERROR_CATEGORY)) {
      stats.byCategory[category] = this.errorLog.filter(e => e.category === category).length;
    }

    return stats;
  }

  /**
   * Clear error log
   * @param {Object} criteria - Optional criteria for selective clearing
   */
  clearLog(criteria = {}) {
    if (Object.keys(criteria).length === 0) {
      this.errorLog = [];
      this.errorCounts.clear();
      return;
    }

    // Selective clearing based on criteria
    if (criteria.severity) {
      this.errorLog = this.errorLog.filter(e => e.severity !== criteria.severity);
    }

    if (criteria.category) {
      this.errorLog = this.errorLog.filter(e => e.category !== criteria.category);
    }

    if (criteria.before) {
      const before = new Date(criteria.before);
      this.errorLog = this.errorLog.filter(e => new Date(e.timestamp) >= before);
    }
  }

  /**
   * Register custom recovery strategy
   * @param {string} strategyName - Strategy identifier
   * @param {Function} strategyFunction - Recovery function
   */
  registerRecoveryStrategy(strategyName, strategyFunction) {
    this.recoveryStrategies.set(strategyName, strategyFunction);
  }

  /**
   * Update configuration
   * @param {Object} newConfig - Configuration updates
   */
  updateConfig(newConfig) {
    this.config = new ErrorHandlerConfig({ ...this.config, ...newConfig });
    this.notificationManager.config = this.config;
    this.telemetryManager.config = this.config;
  }

  /**
   * Destroy error handler and clean up resources
   */
  destroy() {
    this.notificationManager.dismissAll();
    this.clearLog();
    this.initialized = false;
  }
}

// Browser-safe environment detection
const getEnvironment = () => {
  // Check if we're in Node.js environment
  if (typeof globalThis !== 'undefined' && globalThis.process && globalThis.process.env) {
    return globalThis.process.env.NODE_ENV || 'development';
  }
  
  // Browser environment - check for common production indicators
  if (typeof window !== 'undefined') {
    // Check if we're on localhost or development domains
    const hostname = window.location?.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname?.includes('dev')) {
      return 'development';
    }
    return 'production';
  }
  
  // Default fallback
  return 'development';
};

const environment = getEnvironment();
const isProduction = environment === 'production';
const isDevelopment = environment === 'development';

// Global error handler instance with production-ready defaults
export const errorHandler = new ErrorHandler({
  environment: environment,
  enableTelemetry: isProduction,
  enableUserNotifications: true,
  enableConsoleLogging: true,
  enableStackTrace: isDevelopment,
  maxRetries: 3,
  retryDelay: 1000,
  maxLogEntries: 1000,
  userNotificationTimeout: 5000
});

/**
 * Convenience wrapper functions for common error scenarios
 * These provide a simplified API while maintaining full functionality
 */
export const GameErrors = {
  /**
   * Handle initialization errors (critical level)
   * @param {Error|string} error - Error details
   * @param {Object} context - Additional context
   * @param {string} recoveryStrategy - Recovery strategy
   * @returns {string} Error ID
   */
  initialization(error, context = {}, recoveryStrategy = RECOVERY_STRATEGY.RELOAD) {
    return errorHandler.handle(
      error, 
      ERROR_SEVERITY.CRITICAL, 
      ERROR_CATEGORY.INITIALIZATION, 
      context, 
      recoveryStrategy
    );
  },

  /**
   * Handle rendering errors
   * @param {Error|string} error - Error details
   * @param {Object} context - Additional context
   * @param {string} recoveryStrategy - Recovery strategy
   * @returns {string} Error ID
   */
  rendering(error, context = {}, recoveryStrategy = RECOVERY_STRATEGY.GRACEFUL_DEGRADATION) {
    return errorHandler.handle(
      error, 
      ERROR_SEVERITY.ERROR, 
      ERROR_CATEGORY.RENDERING, 
      context, 
      recoveryStrategy
    );
  },

  /**
   * Handle input validation errors
   * @param {Error|string} error - Error details
   * @param {Object} context - Additional context
   * @returns {string} Error ID
   */
  validation(error, context = {}) {
    return errorHandler.handle(
      error, 
      ERROR_SEVERITY.WARNING, 
      ERROR_CATEGORY.VALIDATION, 
      context
    );
  },

  /**
   * Handle asset loading errors
   * @param {Error|string} error - Error details
   * @param {Object} context - Additional context
   * @param {string} recoveryStrategy - Recovery strategy
   * @returns {string} Error ID
   */
  assets(error, context = {}, recoveryStrategy = RECOVERY_STRATEGY.FALLBACK) {
    return errorHandler.handle(
      error, 
      ERROR_SEVERITY.WARNING, 
      ERROR_CATEGORY.ASSETS, 
      context, 
      recoveryStrategy
    );
  },

  /**
   * Handle sprite/token errors
   * @param {Error|string} error - Error details
   * @param {Object} context - Additional context
   * @param {string} recoveryStrategy - Recovery strategy
   * @returns {string} Error ID
   */
  sprites(error, context = {}, recoveryStrategy = RECOVERY_STRATEGY.FALLBACK) {
    return errorHandler.handle(
      error, 
      ERROR_SEVERITY.WARNING, 
      ERROR_CATEGORY.TOKEN, 
      context, 
      recoveryStrategy
    );
  },

  /**
   * Handle input processing errors
   * @param {Error|string} error - Error details
   * @param {Object} context - Additional context
   * @param {string} recoveryStrategy - Recovery strategy
   * @returns {string} Error ID
   */
  input(error, context = {}, recoveryStrategy = RECOVERY_STRATEGY.RETRY) {
    return errorHandler.handle(
      error, 
      ERROR_SEVERITY.WARNING, 
      ERROR_CATEGORY.INPUT, 
      context, 
      recoveryStrategy
    );
  },

  /**
   * Handle network/API errors
   * @param {Error|string} error - Error details
   * @param {Object} context - Additional context
   * @param {string} recoveryStrategy - Recovery strategy
   * @returns {string} Error ID
   */
  network(error, context = {}, recoveryStrategy = RECOVERY_STRATEGY.RETRY) {
    return errorHandler.handle(
      error, 
      ERROR_SEVERITY.ERROR, 
      ERROR_CATEGORY.NETWORK, 
      context, 
      recoveryStrategy
    );
  },

  /**
   * Handle coordinate/positioning errors
   * @param {Error|string} error - Error details
   * @param {Object} context - Additional context
   * @param {string} recoveryStrategy - Recovery strategy
   * @returns {string} Error ID
   */
  coordinate(error, context = {}, recoveryStrategy = RECOVERY_STRATEGY.FALLBACK) {
    return errorHandler.handle(
      error, 
      ERROR_SEVERITY.WARNING, 
      ERROR_CATEGORY.COORDINATE, 
      context, 
      recoveryStrategy
    );
  },

  /**
   * Handle game state errors
   * @param {Error|string} error - Error details
   * @param {Object} context - Additional context
   * @param {string} recoveryStrategy - Recovery strategy
   * @returns {string} Error ID
   */
  gameState(error, context = {}, recoveryStrategy = RECOVERY_STRATEGY.RESET) {
    return errorHandler.handle(
      error, 
      ERROR_SEVERITY.ERROR, 
      ERROR_CATEGORY.GAME_STATE, 
      context, 
      recoveryStrategy
    );
  },

  /**
   * Handle performance issues
   * @param {Error|string} error - Error details
   * @param {Object} context - Additional context
   * @returns {string} Error ID
   */
  performance(error, context = {}) {
    return errorHandler.handle(
      error, 
      ERROR_SEVERITY.WARNING, 
      ERROR_CATEGORY.PERFORMANCE, 
      context, 
      RECOVERY_STRATEGY.GRACEFUL_DEGRADATION
    );
  },

  /**
   * Handle security-related errors
   * @param {Error|string} error - Error details
   * @param {Object} context - Additional context
   * @returns {string} Error ID
   */
  security(error, context = {}) {
    return errorHandler.handle(
      error, 
      ERROR_SEVERITY.CRITICAL, 
      ERROR_CATEGORY.SECURITY, 
      context
    );
  },

  /**
   * Generic error handler with automatic category detection
   * @param {Error|string} error - Error details
   * @param {Object} context - Additional context
   * @param {string} severity - Error severity level
   * @param {string} recoveryStrategy - Recovery strategy
   * @returns {string} Error ID
   */
  generic(error, context = {}, severity = ERROR_SEVERITY.ERROR, recoveryStrategy = RECOVERY_STRATEGY.NONE) {
    // Attempt to auto-categorize based on error message/context
    let category = ERROR_CATEGORY.SYSTEM;
    
    const errorMsg = (error instanceof Error ? error.message : error).toLowerCase();
    
    if (errorMsg.includes('network') || errorMsg.includes('fetch')) {
      category = ERROR_CATEGORY.NETWORK;
    } else if (errorMsg.includes('render') || errorMsg.includes('display')) {
      category = ERROR_CATEGORY.RENDERING;
    } else if (errorMsg.includes('input') || errorMsg.includes('click')) {
      category = ERROR_CATEGORY.INPUT;
    } else if (errorMsg.includes('asset') || errorMsg.includes('load')) {
      category = ERROR_CATEGORY.ASSETS;
    } else if (errorMsg.includes('token') || errorMsg.includes('sprite')) {
      category = ERROR_CATEGORY.TOKEN;
    } else if (errorMsg.includes('coordinate') || errorMsg.includes('position')) {
      category = ERROR_CATEGORY.COORDINATE;
    }
    
    return errorHandler.handle(error, severity, category, context, recoveryStrategy);
  }
};

// Export error handler for direct access if needed
export { errorHandler as default };

/**
 * Integration helpers for easier adoption across the codebase
 */

/**
 * Async wrapper that automatically handles promise rejections
 * @param {Function} asyncFn - Async function to wrap
 * @param {Object} context - Error context
 * @param {string} category - Error category
 * @param {string} recoveryStrategy - Recovery strategy
 * @returns {Function} Wrapped function
 */
export function withErrorHandling(asyncFn, context = {}, category = ERROR_CATEGORY.SYSTEM, recoveryStrategy = RECOVERY_STRATEGY.NONE) {
  return async (...args) => {
    try {
      return await asyncFn(...args);
    } catch (error) {
      errorHandler.handle(error, ERROR_SEVERITY.ERROR, category, {
        ...context,
        functionName: asyncFn.name,
        arguments: args
      }, recoveryStrategy);
      throw error; // Re-throw for caller handling
    }
  };
}

/**
 * Decorator for class methods to add automatic error handling
 * @param {string} category - Error category
 * @param {string} recoveryStrategy - Recovery strategy
 * @returns {Function} Method decorator
 */
export function handleErrors(category = ERROR_CATEGORY.SYSTEM, recoveryStrategy = RECOVERY_STRATEGY.NONE) {
  return function(target, propertyKey, descriptor) {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function(...args) {
      try {
        return await originalMethod.apply(this, args);
      } catch (error) {
        errorHandler.handle(error, ERROR_SEVERITY.ERROR, category, {
          className: target.constructor.name,
          methodName: propertyKey,
          arguments: args
        }, recoveryStrategy);
        throw error;
      }
    };
    
    return descriptor;
  };
}

/**
 * Performance monitoring wrapper
 * @param {Function} fn - Function to monitor
 * @param {string} operationName - Operation identifier
 * @param {number} thresholdMs - Performance threshold in milliseconds
 * @returns {Function} Wrapped function
 */
export function withPerformanceMonitoring(fn, operationName, thresholdMs = 1000) {
  return async (...args) => {
    const startTime = performance.now();
    
    try {
      const result = await fn(...args);
      const duration = performance.now() - startTime;
      
      if (duration > thresholdMs) {
        GameErrors.performance(`Slow operation detected: ${operationName}`, {
          operation: operationName,
          duration,
          threshold: thresholdMs
        });
      }
      
      return result;
    } catch (error) {
      const duration = performance.now() - startTime;
      GameErrors.performance(`Operation failed: ${operationName}`, {
        operation: operationName,
        duration,
        error: error.message
      });
      throw error;
    }
  };
}
