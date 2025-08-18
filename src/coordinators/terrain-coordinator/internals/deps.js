import { logger } from '../../../utils/Logger.js';
import { GameValidators as DefaultGameValidators, Sanitizers as DefaultSanitizers } from '../../../utils/Validation.js';

export function validateDependencies(c) {
  const missingDependencies = [];

  if (!c || typeof c !== 'object') {
    throw new Error('Invalid coordinator context for validateDependencies');
  }

  // Resolve validators/sanitizers from coordinator instance, globals, or module defaults
  const gv = (
    c?.GameValidators
    || (typeof window !== 'undefined' ? window.GameValidators : undefined)
    || globalThis?.GameValidators
    || DefaultGameValidators
  );
  const sz = (
    c?.Sanitizers
    || (typeof window !== 'undefined' ? window.Sanitizers : undefined)
    || globalThis?.Sanitizers
    || DefaultSanitizers
  );

  const usedDefaultsGV = gv === DefaultGameValidators;
  const usedDefaultsSZ = sz === DefaultSanitizers;

  if (!gv) {
    missingDependencies.push('GameValidators');
  }
  if (!sz) {
    missingDependencies.push('Sanitizers');
  }

  // Attach back to coordinator for consistent downstream access
  if (!c.GameValidators) c.GameValidators = gv;
  if (!c.Sanitizers) c.Sanitizers = sz;

  const enumFn = sz?.enum || c?.Sanitizers?.enum;
  if (typeof enumFn !== 'function') {
    logger.warn('Sanitizers.enum method not available', {
      context: 'TerrainCoordinator.validateDependencies',
      sanitizersType: typeof (c?.Sanitizers || sz),
      enumType: typeof enumFn,
      availableMethods: (c?.Sanitizers ? Object.keys(c.Sanitizers) : (sz ? Object.keys(sz) : []))
    });
  }

  if (missingDependencies.length > 0) {
    throw new Error(`Missing required dependencies: ${missingDependencies.join(', ')}`);
  }

  logger.debug('Dependencies validated', {
    context: 'TerrainCoordinator.validateDependencies',
    sanitizersEnumAvailable: typeof enumFn === 'function',
    allDependenciesValid: missingDependencies.length === 0,
    usedModuleDefaults: { GameValidators: usedDefaultsGV, Sanitizers: usedDefaultsSZ }
  });
}
