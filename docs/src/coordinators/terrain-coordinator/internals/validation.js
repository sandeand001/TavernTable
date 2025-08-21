import { logger, LOG_CATEGORY } from '../../../utils/Logger.js';
import { TerrainValidation } from '../../../utils/TerrainValidation.js';

/**
 * Validate the overall terrain system state. Mirrors TerrainCoordinator.validateTerrainSystemState
 */
export function validateTerrainSystemState(c) {
  try {
    const validationResult = TerrainValidation.validateTerrainSystemState(c, c.terrainManager);

    if (!validationResult.isValid) {
      const errorMessage = TerrainValidation.getErrorMessage(validationResult);
      logger.error('Terrain system state validation failed', {
        context: 'validation.validateTerrainSystemState',
        errors: validationResult.errors,
        warnings: validationResult.warnings,
        details: validationResult.details
      });
      throw new Error(`Terrain system state corrupted: ${errorMessage}`);
    }

    const warnings = TerrainValidation.getWarningMessages(validationResult);
    if (warnings.length > 0) {
      logger.warn('Terrain system validation warnings', {
        context: 'validation.validateTerrainSystemState',
        warnings
      }, LOG_CATEGORY.SYSTEM);
    }

    logger.debug('Terrain system state validation passed', {
      context: 'validation.validateTerrainSystemState',
      details: validationResult.details
    }, LOG_CATEGORY.SYSTEM);

    return true;
  } catch (error) {
    logger.error('Critical error during terrain system validation', {
      context: 'validation.validateTerrainSystemState',
      error: error.message
    });
    throw error;
  }
}

/**
 * Validate consistency of terrain data arrays (working/base). Mirrors TerrainCoordinator.validateTerrainDataConsistency
 */
export function validateTerrainDataConsistency(c) {
  try {
    if (!c.dataStore?.working || !c.dataStore?.base) {
      return false;
    }

    const expectedRows = c.gameManager.rows;
    const expectedCols = c.gameManager.cols;

    if (c.dataStore.working.length !== expectedRows) {
      return false;
    }

    for (let i = 0; i < c.dataStore.working.length; i++) {
      if (!Array.isArray(c.dataStore.working[i]) || c.dataStore.working[i].length !== expectedCols) {
        return false;
      }
    }

    if (c.dataStore.base.length !== expectedRows) {
      return false;
    }

    for (let i = 0; i < c.dataStore.base.length; i++) {
      if (!Array.isArray(c.dataStore.base[i]) || c.dataStore.base[i].length !== expectedCols) {
        return false;
      }
    }

    return true;
  } catch (error) {
    logger.warn('Error validating terrain data consistency', {
      context: 'validation.validateTerrainDataConsistency',
      error: error.message
    });
    return false;
  }
}
