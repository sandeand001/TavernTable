import { LOG_CATEGORY } from '../enums.js';

/**
 * Performance monitor for tracking method execution times
 */
export class PerformanceMonitor {
  constructor(logger) {
    this.logger = logger;
    this.activeTimers = new Map();
  }

  startTimer(operationName, context = {}) {
    const timerId = `${operationName}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const startTime = performance.now();

    this.activeTimers.set(timerId, {
      operationName,
      startTime,
      context,
    });

    return timerId;
  }

  endTimer(timerId, additionalContext = {}) {
    const timer = this.activeTimers.get(timerId);
    if (!timer) {
      this.logger.warn('Performance timer not found', { timerId });
      return;
    }

    const endTime = performance.now();
    const duration = endTime - timer.startTime;

    this.activeTimers.delete(timerId);

    this.logger.info(
      `Operation completed: ${timer.operationName}`,
      {
        operation: timer.operationName,
        duration: Math.round(duration * 100) / 100, // Round to 2 decimal places
        startTime: timer.startTime,
        endTime,
        ...timer.context,
        ...additionalContext,
      },
      LOG_CATEGORY.PERFORMANCE
    );

    return duration;
  }

  measureAsync(operationName, asyncFn, context = {}) {
    return async (...args) => {
      const timerId = this.startTimer(operationName, context);
      try {
        const result = await asyncFn(...args);
        this.endTimer(timerId, { success: true });
        return result;
      } catch (error) {
        this.endTimer(timerId, {
          success: false,
          error: error.message,
        });
        throw error;
      }
    };
  }

  measureSync(operationName, syncFn, context = {}) {
    return (...args) => {
      const timerId = this.startTimer(operationName, context);
      try {
        const result = syncFn(...args);
        this.endTimer(timerId, { success: true });
        return result;
      } catch (error) {
        this.endTimer(timerId, {
          success: false,
          error: error.message,
        });
        throw error;
      }
    };
  }
}
