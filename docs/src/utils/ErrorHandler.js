// ErrorHandler.js - Centralized error handling
export const ERROR_SEVERITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
};
export const ERROR_CATEGORY = {
  SYSTEM: 'system',
  USER: 'user',
  VALIDATION: 'validation',
};
export function errorHandler(category, severity, message) {
  console.error(`[${category}][${severity}] ${message}`);
}
export class ErrorHandler {
  static handle(category, severity, message) {
    errorHandler(category, severity, message);
  }
}
