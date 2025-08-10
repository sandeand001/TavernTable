/**
 * TerrainValidation.js - Centralized validation for terrain system components
 * 
 * Provides consistent validation logic for terrain coordinates, height modifications,
 * system state, and other terrain-related operations. Eliminates scattered validation
 * code and provides standardized error messages.
 */

import { TERRAIN_CONFIG } from '../config/TerrainConstants.js';
import { logger, LOG_LEVEL, LOG_CATEGORY } from '../utils/Logger.js';
import { TerrainHeightUtils } from './TerrainHeightUtils.js';

export class TerrainValidation {
  /**
   * Validate the overall terrain system state
   * @param {Object} terrainCoordinator - The terrain coordinator instance
   * @param {Object} terrainManager - The terrain manager instance
   * @returns {Object} Validation result with isValid flag and details
   */
  static validateTerrainSystemState(terrainCoordinator, terrainManager) {
    const result = {
      isValid: true,
      errors: [],
      warnings: [],
      details: {}
    };

    try {
      // Validate terrain coordinator
      if (!terrainCoordinator) {
        result.errors.push('TerrainCoordinator is null or undefined');
        result.isValid = false;
      } else {
        // Check coordinator state
        result.details.coordinatorInitialized = !!terrainCoordinator.isInitialized;
        result.details.terrainModeActive = !!terrainCoordinator.isTerrainModeActive;
        
        // Validate height data structures
        if (!terrainCoordinator.terrainHeights) {
          result.errors.push('TerrainCoordinator terrainHeights is null');
          result.isValid = false;
        } else if (!TerrainHeightUtils.isValidHeightArray(terrainCoordinator.terrainHeights)) {
          result.errors.push('TerrainCoordinator terrainHeights is invalid');
          result.isValid = false;
        }

        if (!terrainCoordinator.baseTerrainHeights) {
          result.errors.push('TerrainCoordinator baseTerrainHeights is null');
          result.isValid = false;
        } else if (!TerrainHeightUtils.isValidHeightArray(terrainCoordinator.baseTerrainHeights)) {
          result.errors.push('TerrainCoordinator baseTerrainHeights is invalid');
          result.isValid = false;
        }

        // Validate game manager dependency
        if (!terrainCoordinator.gameManager) {
          result.errors.push('TerrainCoordinator missing gameManager dependency');
          result.isValid = false;
        }
      }

      // Validate terrain manager
      if (!terrainManager) {
        result.errors.push('TerrainManager is null or undefined');
        result.isValid = false;
      } else {
        // Check manager state
        result.details.managerInitialized = !!terrainManager.isInitialized;
        
        // Validate container state
        if (!terrainManager.terrainContainer) {
          result.errors.push('TerrainManager terrainContainer is null');
          result.isValid = false;
        } else if (terrainManager.terrainContainer.destroyed) {
          result.errors.push('TerrainManager terrainContainer has been destroyed');
          result.isValid = false;
        }

        // Validate tiles map
        if (!terrainManager.terrainTiles) {
          result.errors.push('TerrainManager terrainTiles map is null');
          result.isValid = false;
        } else {
          result.details.tileCount = terrainManager.terrainTiles.size;
        }

        // Validate coordinator reference
        if (!terrainManager.terrainCoordinator) {
          result.errors.push('TerrainManager missing terrainCoordinator reference');
          result.isValid = false;
        }

        // Validate game manager dependency
        if (!terrainManager.gameManager) {
          result.errors.push('TerrainManager missing gameManager dependency');
          result.isValid = false;
        }
      }

      // Cross-validate coordinator and manager consistency
      if (terrainCoordinator && terrainManager) {
        if (terrainCoordinator.terrainManager !== terrainManager) {
          result.warnings.push('TerrainCoordinator and TerrainManager have inconsistent references');
        }
        
        if (terrainManager.terrainCoordinator !== terrainCoordinator) {
          result.warnings.push('TerrainManager and TerrainCoordinator have inconsistent references');
        }
      }

      logger.log(LOG_LEVEL.DEBUG, 'Terrain system state validation completed', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainValidation.validateTerrainSystemState',
        isValid: result.isValid,
        errorCount: result.errors.length,
        warningCount: result.warnings.length
      });

      return result;
    } catch (error) {
      result.isValid = false;
      result.errors.push(`Validation process error: ${error.message}`);
      
      logger.log(LOG_LEVEL.ERROR, 'Error during terrain system validation', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainValidation.validateTerrainSystemState',
        error: error.message
      });
      
      return result;
    }
  }

  /**
   * Validate terrain coordinates against grid bounds
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @param {Object} bounds - Object with cols and rows properties
   * @returns {Object} Validation result with isValid flag and error message
   */
  static validateTerrainCoordinates(x, y, bounds) {
    const result = {
      isValid: true,
      error: null,
      details: {}
    };

    try {
      // Validate input types
      if (!Number.isInteger(x)) {
        result.isValid = false;
        result.error = `Invalid X coordinate: ${x}. Must be an integer.`;
        return result;
      }

      if (!Number.isInteger(y)) {
        result.isValid = false;
        result.error = `Invalid Y coordinate: ${y}. Must be an integer.`;
        return result;
      }

      // Validate bounds object
      if (!bounds || typeof bounds !== 'object') {
        result.isValid = false;
        result.error = 'Invalid bounds object provided';
        return result;
      }

      if (!Number.isInteger(bounds.cols) || bounds.cols <= 0) {
        result.isValid = false;
        result.error = `Invalid bounds.cols: ${bounds.cols}. Must be a positive integer.`;
        return result;
      }

      if (!Number.isInteger(bounds.rows) || bounds.rows <= 0) {
        result.isValid = false;
        result.error = `Invalid bounds.rows: ${bounds.rows}. Must be a positive integer.`;
        return result;
      }

      // Check coordinate bounds
      if (x < 0 || x >= bounds.cols) {
        result.isValid = false;
        result.error = `X coordinate ${x} is out of bounds [0, ${bounds.cols - 1}]`;
        return result;
      }

      if (y < 0 || y >= bounds.rows) {
        result.isValid = false;
        result.error = `Y coordinate ${y} is out of bounds [0, ${bounds.rows - 1}]`;
        return result;
      }

      // Store validation details
      result.details = {
        coordinates: { x, y },
        bounds: { cols: bounds.cols, rows: bounds.rows },
        valid: true
      };

      return result;
    } catch (error) {
      result.isValid = false;
      result.error = `Coordinate validation error: ${error.message}`;
      
      logger.log(LOG_LEVEL.ERROR, 'Error validating terrain coordinates', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainValidation.validateTerrainCoordinates',
        coordinates: { x, y },
        bounds,
        error: error.message
      });
      
      return result;
    }
  }

  /**
   * Validate a height modification operation
   * @param {number} currentHeight - Current height value
   * @param {string} tool - Tool being used ('raise' or 'lower')
   * @param {Object} bounds - Height bounds and step configuration
   * @returns {Object} Validation result with isValid flag and details
   */
  static validateHeightModification(currentHeight, tool, bounds = {}) {
    const result = {
      isValid: true,
      error: null,
      newHeight: currentHeight,
      canModify: true,
      details: {}
    };

    try {
      // Validate current height
      if (!Number.isFinite(currentHeight)) {
        result.isValid = false;
        result.error = `Invalid current height: ${currentHeight}. Must be a finite number.`;
        return result;
      }

      // Validate tool
      if (!tool || typeof tool !== 'string') {
        result.isValid = false;
        result.error = `Invalid tool: ${tool}. Must be a string.`;
        return result;
      }

      const normalizedTool = tool.toLowerCase();
      if (normalizedTool !== 'raise' && normalizedTool !== 'lower') {
        result.isValid = false;
        result.error = `Invalid tool: ${tool}. Must be 'raise' or 'lower'.`;
        return result;
      }

      // Set default bounds from configuration
      const minHeight = bounds.minHeight ?? TERRAIN_CONFIG.MIN_HEIGHT;
      const maxHeight = bounds.maxHeight ?? TERRAIN_CONFIG.MAX_HEIGHT;
      const heightStep = bounds.heightStep ?? TERRAIN_CONFIG.HEIGHT_STEP;

      // Validate bounds
      if (!Number.isFinite(minHeight) || !Number.isFinite(maxHeight) || minHeight >= maxHeight) {
        result.isValid = false;
        result.error = `Invalid height bounds: min=${minHeight}, max=${maxHeight}`;
        return result;
      }

      if (!Number.isFinite(heightStep) || heightStep <= 0) {
        result.isValid = false;
        result.error = `Invalid height step: ${heightStep}. Must be a positive number.`;
        return result;
      }

      // Check if current height is within bounds
      if (currentHeight < minHeight || currentHeight > maxHeight) {
        result.isValid = false;
        result.error = `Current height ${currentHeight} is outside valid range [${minHeight}, ${maxHeight}]`;
        return result;
      }

      // Calculate new height based on tool
      let newHeight;
      if (normalizedTool === 'raise') {
        newHeight = Math.min(currentHeight + heightStep, maxHeight);
        result.canModify = newHeight > currentHeight;
      } else { // lower
        newHeight = Math.max(currentHeight - heightStep, minHeight);
        result.canModify = newHeight < currentHeight;
      }

      result.newHeight = newHeight;
      result.details = {
        currentHeight,
        newHeight,
        tool: normalizedTool,
        heightStep,
        bounds: { minHeight, maxHeight },
        wouldChange: newHeight !== currentHeight,
        atBoundary: !result.canModify
      };

      // Log boundary conditions
      if (!result.canModify) {
        const boundaryType = normalizedTool === 'raise' ? 'maximum' : 'minimum';
        logger.log(LOG_LEVEL.DEBUG, `Height modification blocked at ${boundaryType} boundary`, LOG_CATEGORY.SYSTEM, {
          context: 'TerrainValidation.validateHeightModification',
          currentHeight,
          tool: normalizedTool,
          boundary: boundaryType === 'maximum' ? maxHeight : minHeight
        });
      }

      return result;
    } catch (error) {
      result.isValid = false;
      result.error = `Height modification validation error: ${error.message}`;
      
      logger.log(LOG_LEVEL.ERROR, 'Error validating height modification', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainValidation.validateHeightModification',
        currentHeight,
        tool,
        error: error.message
      });
      
      return result;
    }
  }

  /**
   * Validate terrain mode transition
   * @param {boolean} currentMode - Current terrain mode state
   * @param {boolean} targetMode - Target terrain mode state
   * @param {Object} systemState - Current system state
   * @returns {Object} Validation result with isValid flag and details
   */
  static validateTerrainModeTransition(currentMode, targetMode, systemState = {}) {
    const result = {
      isValid: true,
      error: null,
      canTransition: true,
      warnings: [],
      details: {}
    };

    try {
      // Validate mode values
      if (typeof currentMode !== 'boolean') {
        result.isValid = false;
        result.error = `Invalid current mode: ${currentMode}. Must be boolean.`;
        return result;
      }

      if (typeof targetMode !== 'boolean') {
        result.isValid = false;
        result.error = `Invalid target mode: ${targetMode}. Must be boolean.`;
        return result;
      }

      // Check if transition is needed
      if (currentMode === targetMode) {
        result.canTransition = false;
        result.details.reason = 'Already in target mode';
        return result;
      }

      // Validate system state for transition
      if (targetMode === true) {
        // Entering terrain mode
        if (!systemState.gameManager) {
          result.warnings.push('GameManager not available for terrain mode initialization');
        }

        if (!systemState.gridInitialized) {
          result.warnings.push('Grid not initialized - terrain mode may not work correctly');
        }

        if (systemState.activeTools && systemState.activeTools.length > 0) {
          result.warnings.push('Other tools are active - may conflict with terrain mode');
        }
      } else {
        // Exiting terrain mode
        if (systemState.hasUnsavedChanges) {
          result.warnings.push('Unsaved terrain changes may be lost');
        }

        if (systemState.activeTerrainOperations > 0) {
          result.warnings.push('Active terrain operations in progress');
        }
      }

      result.details = {
        currentMode,
        targetMode,
        transition: currentMode ? 'exit' : 'enter',
        warningCount: result.warnings.length
      };

      logger.log(LOG_LEVEL.DEBUG, 'Terrain mode transition validation completed', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainValidation.validateTerrainModeTransition',
        transition: result.details.transition,
        canTransition: result.canTransition,
        warningCount: result.warnings.length
      });

      return result;
    } catch (error) {
      result.isValid = false;
      result.error = `Mode transition validation error: ${error.message}`;
      
      logger.log(LOG_LEVEL.ERROR, 'Error validating terrain mode transition', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainValidation.validateTerrainModeTransition',
        currentMode,
        targetMode,
        error: error.message
      });
      
      return result;
    }
  }

  /**
   * Validate terrain configuration object
   * @param {Object} config - Configuration object to validate
   * @returns {Object} Validation result with isValid flag and details
   */
  static validateTerrainConfig(config) {
    const result = {
      isValid: true,
      errors: [],
      warnings: [],
      details: {}
    };

    try {
      if (!config || typeof config !== 'object') {
        result.isValid = false;
        result.errors.push('Configuration must be a valid object');
        return result;
      }

      // Validate required height properties
      const requiredHeightProps = ['MIN_HEIGHT', 'MAX_HEIGHT', 'DEFAULT_HEIGHT', 'HEIGHT_STEP'];
      for (const prop of requiredHeightProps) {
        if (!(prop in config)) {
          result.errors.push(`Missing required property: ${prop}`);
          result.isValid = false;
        } else if (!Number.isFinite(config[prop])) {
          result.errors.push(`Property ${prop} must be a finite number, got: ${config[prop]}`);
          result.isValid = false;
        }
      }

      // Validate height bounds logic
      if (result.isValid && config.MIN_HEIGHT >= config.MAX_HEIGHT) {
        result.errors.push(`MIN_HEIGHT (${config.MIN_HEIGHT}) must be less than MAX_HEIGHT (${config.MAX_HEIGHT})`);
        result.isValid = false;
      }

      if (result.isValid && (config.DEFAULT_HEIGHT < config.MIN_HEIGHT || config.DEFAULT_HEIGHT > config.MAX_HEIGHT)) {
        result.errors.push(`DEFAULT_HEIGHT (${config.DEFAULT_HEIGHT}) must be between MIN_HEIGHT and MAX_HEIGHT`);
        result.isValid = false;
      }

      if (result.isValid && config.HEIGHT_STEP <= 0) {
        result.errors.push(`HEIGHT_STEP (${config.HEIGHT_STEP}) must be positive`);
        result.isValid = false;
      }

      // Validate visual properties
      const visualProps = ['HEIGHT_ALPHA', 'HEIGHT_BORDER_ALPHA', 'ELEVATION_SHADOW_OFFSET'];
      for (const prop of visualProps) {
        if (prop in config && !Number.isFinite(config[prop])) {
          result.warnings.push(`Visual property ${prop} should be a finite number, got: ${config[prop]}`);
        }
      }

      // Check for reasonable value ranges
      if (result.isValid) {
        const heightRange = config.MAX_HEIGHT - config.MIN_HEIGHT;
        if (heightRange > 1000) {
          result.warnings.push(`Very large height range (${heightRange}) may cause performance issues`);
        }

        if (config.HEIGHT_STEP > heightRange / 2) {
          result.warnings.push(`HEIGHT_STEP (${config.HEIGHT_STEP}) is very large relative to height range (${heightRange})`);
        }
      }

      result.details = {
        heightRange: result.isValid ? config.MAX_HEIGHT - config.MIN_HEIGHT : null,
        stepCount: result.isValid ? Math.ceil((config.MAX_HEIGHT - config.MIN_HEIGHT) / config.HEIGHT_STEP) : null
      };

      return result;
    } catch (error) {
      result.isValid = false;
      result.errors.push(`Configuration validation error: ${error.message}`);
      
      logger.log(LOG_LEVEL.ERROR, 'Error validating terrain configuration', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainValidation.validateTerrainConfig',
        error: error.message
      });
      
      return result;
    }
  }

  /**
   * Get a formatted error message from validation result
   * @param {Object} validationResult - Result from any validation method
   * @returns {string} Formatted error message
   */
  static getErrorMessage(validationResult) {
    if (!validationResult || validationResult.isValid) {
      return '';
    }

    if (validationResult.error) {
      return validationResult.error;
    }

    if (validationResult.errors && validationResult.errors.length > 0) {
      return validationResult.errors.join('; ');
    }

    return 'Unknown validation error';
  }

  /**
   * Get formatted warning messages from validation result
   * @param {Object} validationResult - Result from any validation method
   * @returns {string[]} Array of warning messages
   */
  static getWarningMessages(validationResult) {
    if (!validationResult || !validationResult.warnings) {
      return [];
    }

    return Array.isArray(validationResult.warnings) ? validationResult.warnings : [];
  }
}
