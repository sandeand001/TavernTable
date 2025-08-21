// Validation.js - Input sanitizers
export const Sanitizers = {
  sanitizeString: (str) => str.replace(/[^a-zA-Z0-9 _-]/g, ''),
  sanitizeNumber: (num) => Number(num) || 0,
};
