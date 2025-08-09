/**
 * UIController.js
 * Handles UI interactions and initialization for TavernTable
 * 
 * This module manages all user interface interactions that were previously
 * defined inline in the HTML. It provides clean separation between the
 * game logic and UI control, making the code more maintainable and testable.
 * 
 * Key Features:
 * - Collapsible panel management
 * - Grid resizing controls  
 * - Zoom reset functionality
 * - Game initialization coordination
 * - Global function exposure for HTML compatibility
 * 
 * @module UIController
 * @version 1.0.0
 */

import GameManager from '../core/GameManager.js';
import { GRID_CONFIG } from '../config/GameConstants.js';
import { logger, LOG_LEVEL, LOG_CATEGORY } from '../utils/Logger.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../utils/ErrorHandler.js';
import { Sanitizers, GameValidators } from '../utils/Validation.js';

/**
 * Toggle the visibility of the creature tokens panel
 * Manages the collapsible state and arrow indicator
 */
function toggleCreatureTokens() {
  try {
    const content = document.getElementById('creature-content');
    const arrow = document.getElementById('creature-arrow');
    
    // Validate DOM elements
    const contentValidation = GameValidators.domElement(content, 'div');
    if (!contentValidation.isValid) {
      throw new Error(`Content panel validation failed: ${contentValidation.getErrorMessage()}`);
    }
    
    // Toggle visibility
    const isHidden = content.style.display === 'none';
    content.style.display = isHidden ? 'block' : 'none';
    
    // Update arrow indicator if present
    if (arrow) {
      arrow.textContent = isHidden ? '▼' : '▶';
    }
    
  } catch (error) {
    new ErrorHandler().handle(error, ERROR_SEVERITY.LOW, ERROR_CATEGORY.INPUT, {
      context: 'toggleCreatureTokens',
      stage: 'ui_toggle',
      elementIds: ['creature-content', 'creature-arrow'],
      uiAction: 'panel_visibility_toggle'
    });
  }
}

/**
 * Resize the game grid based on user input
 * Validates input values and delegates to GameManager for actual resizing
 */
function resizeGrid() {
  try {
    // Validate GameManager availability
    if (!window.gameManager) {
      throw new Error('Game is still loading. Please wait a moment and try again.');
    }
    
    if (!window.gameManager.resizeGrid) {
      throw new Error('Grid resize feature is not available.');
    }
    
    // Get and validate input elements
    const widthInput = document.getElementById('grid-width');
    const heightInput = document.getElementById('grid-height');
    
    const widthValidation = GameValidators.domElement(widthInput, 'input');
    const heightValidation = GameValidators.domElement(heightInput, 'input');
    
    if (!widthValidation.isValid || !heightValidation.isValid) {
      throw new Error('Grid resize input elements not found or invalid.');
    }
    
    // Sanitize and validate input values
    const newWidth = Sanitizers.integer(widthInput.value, GRID_CONFIG.DEFAULT_COLS, {
      min: GRID_CONFIG.MIN_COLS,
      max: GRID_CONFIG.MAX_COLS
    });
    
    const newHeight = Sanitizers.integer(heightInput.value, GRID_CONFIG.DEFAULT_ROWS, {
      min: GRID_CONFIG.MIN_ROWS,
      max: GRID_CONFIG.MAX_ROWS
    });
    
    // Perform grid resize
    window.gameManager.resizeGrid(newWidth, newHeight);
    
  } catch (error) {
    new ErrorHandler().handle(error, ERROR_SEVERITY.MEDIUM, ERROR_CATEGORY.INPUT, {
      context: 'resizeGrid',
      stage: 'grid_resize_validation',
      inputValues: {
        width: document.getElementById('grid-width')?.value,
        height: document.getElementById('grid-height')?.value
      },
      constraints: {
        minWidth: GRID_CONFIG.MIN_COLS,
        maxWidth: GRID_CONFIG.MAX_COLS,
        minHeight: GRID_CONFIG.MIN_ROWS,
        maxHeight: GRID_CONFIG.MAX_ROWS
      }
    });
  }
}

/**
 * Reset the grid zoom to default scale and center the view
 * Provides user-friendly zoom reset functionality
 */
function resetZoom() {
  try {
    if (!window.gameManager) {
      throw new Error('Game manager not available');
    }
    
    if (!window.gameManager.resetZoom) {
      throw new Error('Reset zoom feature not available');
    }
    
    window.gameManager.resetZoom();
  } catch (error) {
    new ErrorHandler().handle(error, ERROR_SEVERITY.MEDIUM, ERROR_CATEGORY.RENDERING, {
      context: 'resetZoom',
      stage: 'zoom_reset_operation',
      gameManagerAvailable: !!window.gameManager,
      resetZoomAvailable: !!(window.gameManager?.resetZoom)
    });
  }
}

/**
 * Initialize the application when the page loads
 * Sets up the game manager and handles any initialization errors
 */
async function initializeApplication() {
  try {
    // Validate gameManager exists
    if (!window.gameManager) {
      throw new Error('GameManager not found. Application cannot start.');
    }
    
    // Initialize the game manager
    await window.gameManager.initialize();
    
  } catch (error) {
    new ErrorHandler().handle(error, ERROR_SEVERITY.CRITICAL, ERROR_CATEGORY.INITIALIZATION, {
      context: 'initializeApplication',
      stage: 'application_startup',
      timestamp: new Date().toISOString(),
      gameManagerAvailable: !!window.gameManager,
      initializationFailed: true
    });
  }
}

/**
 * Create and configure the global GameManager instance
 * This provides the main application controller
 */
function createGameManager() {
  try {
    const gameManager = new GameManager();
    window.gameManager = gameManager;
    return gameManager;
  } catch (error) {
    new ErrorHandler().handle(error, ERROR_SEVERITY.CRITICAL, ERROR_CATEGORY.INITIALIZATION, {
      context: 'createGameManager',
      stage: 'game_manager_instantiation',
      errorType: error.constructor.name,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

// Initialize the game manager and set up event listeners
const gameManager = createGameManager();

logger.log(LOG_LEVEL.INFO, 'GameManager created successfully', LOG_CATEGORY.SYSTEM, {
  gameManagerType: gameManager.constructor.name,
  globallyAvailable: !!window.gameManager,
  timestamp: new Date().toISOString()
});

// Make functions available globally for HTML onclick handlers (backward compatibility)
window.toggleCreatureTokens = toggleCreatureTokens;
window.resizeGrid = resizeGrid;
window.resetZoom = resetZoom;

logger.log(LOG_LEVEL.DEBUG, 'UI functions exposed globally', LOG_CATEGORY.SYSTEM, {
  exposedFunctions: ['toggleCreatureTokens', 'resizeGrid', 'resetZoom'],
  compatibilityMode: 'HTML_onclick_handlers'
});

// Signal that UI modules are loaded (for debugging module loading issues)
window.moduleLoadStatus = window.moduleLoadStatus || {};
window.moduleLoadStatus.loaded = true;

// Start the application when the page loads
window.addEventListener('load', initializeApplication);

// Export functions for ES6 module usage
export { 
  toggleCreatureTokens, 
  resizeGrid, 
  resetZoom, 
  initializeApplication 
};
