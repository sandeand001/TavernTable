/* eslint-disable indent */
// Error notification manager extracted with no behavior changes.
import { RECOVERY_STRATEGY, ERROR_CATEGORY } from './enums.js';
import { getErrorContainer, getErrorStylesEl } from '../../ui/domHelpers.js';

export class ErrorNotificationManager {
  constructor(config) {
    this.config = config;
    this.container = null;
    this.activeNotifications = new Map();
    this.initialized = false;
  }

  initialize() {
    if (this.initialized || typeof document === 'undefined') return;

    this.container = getErrorContainer() || document.getElementById('tavern-error-container');
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
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'true');
    return container;
  }

  injectStyles() {
    if (getErrorStylesEl()) return;
    if (document.getElementById('tavern-error-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'tavern-error-styles';
    styles.textContent = `
      .tavern-error-container { position: fixed; top: 20px; right: 20px; z-index: 10000; max-width: 400px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
      .tavern-error-notification { margin-bottom: 10px; padding: 12px 16px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15); animation: slideInRight 0.3s ease-out; max-height: 200px; overflow: hidden; position: relative; }
      .tavern-error-notification.error { background: #fee; color: #d63384; border: 1px solid #f5c2c7; }
      .tavern-error-notification.critical { background: #dc3545; color: white; border: 1px solid #b02a37; }
      .tavern-error-notification.warning { background: #fff3cd; color: #664d03; border: 1px solid #ffecb5; }
      .tavern-error-header { font-weight: 600; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center; }
      .tavern-error-message { font-size: 14px; line-height: 1.4; }
      .tavern-error-close { background: none; border: none; color: inherit; cursor: pointer; font-size: 18px; line-height: 1; opacity: 0.7; padding: 0; margin-left: 8px; }
      .tavern-error-close:hover { opacity: 1; }
      .tavern-error-actions { margin-top: 8px; display: flex; gap: 8px; }
      .tavern-error-button { background: rgba(255, 255, 255, 0.2); border: 1px solid rgba(255, 255, 255, 0.3); color: inherit; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; }
      .tavern-error-button:hover { background: rgba(255, 255, 255, 0.3); }
      @keyframes slideInRight { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
      @keyframes slideOutRight { from { transform: translateX(0); opacity: 1; } to { transform: translateX(100%); opacity: 0; } }
    `;
    document.head.appendChild(styles);
  }

  show(errorEntry, recoveryStrategy = RECOVERY_STRATEGY.NONE) {
    if (!this.config.enableUserNotifications || !this.shouldShowToUser(errorEntry.severity)) return;
    this.initialize();
    const notification = this.createNotification(errorEntry, recoveryStrategy);
    this.container.appendChild(notification);
    this.activeNotifications.set(errorEntry.id, notification);
    if (errorEntry.severity !== 'critical') {
      const t = setTimeout(() => this.dismiss(errorEntry.id), this.config.userNotificationTimeout);
      if (typeof t?.unref === 'function') t.unref();
    }
  }

  createNotification(errorEntry, recoveryStrategy) {
    const notification = document.createElement('div');
    notification.className = `tavern-error-notification ${errorEntry.severity}`;
    notification.dataset.errorId = errorEntry.id;
    notification.setAttribute('role', 'alert');

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
      default:
        break;
    }
    return actions.children.length > 0 ? actions : null;
  }

  handleRetry(errorEntry) {
    const retryEvent = new CustomEvent('errorRetry', { detail: { errorEntry } });
    window.dispatchEvent(retryEvent);
    this.dismiss(errorEntry.id);
  }

  dismiss(errorId) {
    const notification = this.activeNotifications.get(errorId);
    if (notification) {
      notification.style.animation = 'slideOutRight 0.3s ease-in';
      const t = setTimeout(() => {
        if (notification.parentNode) notification.parentNode.removeChild(notification);
        this.activeNotifications.delete(errorId);
      }, 300);
      if (typeof t?.unref === 'function') t.unref();
    }
  }

  dismissAll() {
    for (const [errorId] of this.activeNotifications) this.dismiss(errorId);
  }

  shouldShowToUser(severity) {
    return severity === 'error' || severity === 'critical';
  }

  getSeverityTitle(severity) {
    const titles = {
      debug: 'Debug',
      info: 'Information',
      warning: 'Warning',
      error: 'Error',
      critical: 'Critical Error',
    };
    return titles[severity] || 'Error';
  }

  getUserFriendlyMessage(errorEntry) {
    const categoryMessages = {
      initialization: 'Game failed to start properly. Please refresh the page.',
      rendering: 'Display issue detected. Some graphics may not appear correctly.',
      input: 'Input problem encountered. Some controls may not respond.',
      assets: 'Failed to load game assets. Some features may appear as placeholders.',
      validation: 'Invalid input detected. Please check your settings.',
      network: 'Network connection issue. Some features may be unavailable.',
      coordinate: 'Grid positioning error. Token placement may be affected.',
      token: 'Token management issue. Some tokens may not behave correctly.',
      [ERROR_CATEGORY.GAME_STATE]: 'Game state error. The game may not function as expected.',
      performance: 'Performance issue detected. The game may run slowly.',
      security: 'Security validation failed. Action was blocked for safety.',
      system: 'System error encountered. Please try again.',
    };
    return (
      categoryMessages[errorEntry.category] || errorEntry.message || 'An unexpected error occurred.'
    );
  }
}
