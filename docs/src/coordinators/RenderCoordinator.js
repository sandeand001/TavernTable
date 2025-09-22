/**
 * RenderCoordinator.js - Manages PIXI rendering setup and viewport operations
 *
 * Extracted from GameManager to follow single responsibility principle
 * Handles PIXI application lifecycle, grid positioning, and zoom management
 */

import { logger, LOG_LEVEL, LOG_CATEGORY } from '../utils/Logger.js';
import { CoordinateUtils } from '../utils/CoordinateUtils.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../utils/ErrorHandler.js';
import { GameValidators } from '../utils/Validation.js';
import { GRID_CONFIG } from '../config/GameConstants.js';
// Decoupled from ui/domHelpers: allow injection via gameManager.domPorts.getGameContainer
function _getGameContainer(gameManager) {
  if (gameManager?.domPorts?.getGameContainer) return gameManager.domPorts.getGameContainer();
  if (typeof document === 'undefined') return null;
  return document.getElementById('game-container');
}

export class RenderCoordinator {
  constructor(gameManager) {
    this.gameManager = gameManager;
  }

  /**
   * Create and configure the PIXI application
   * @throws {Error} When PIXI application cannot be created or container not found
   */
  createPixiApp() {
    try {
      // Validate PIXI availability
      if (typeof PIXI === 'undefined') {
        throw new Error('PIXI.js library is not loaded');
      }

      // Initialize PIXI application with configuration
      this.gameManager.app = new PIXI.Application({
        width: window.innerWidth,
        height: window.innerHeight,
        backgroundColor: GRID_CONFIG.BACKGROUND_COLOR,
      });

      // Validate application creation
      const appValidation = GameValidators.pixiApp(this.gameManager.app);
      if (!appValidation.isValid) {
        throw new Error(`PIXI application validation failed: ${appValidation.errors.join(', ')}`);
      }

      // Find and validate game container
      const gameContainer = _getGameContainer(this.gameManager);
      const containerValidation = GameValidators.domElement(gameContainer, 'div');
      if (!containerValidation.isValid) {
        throw new Error(
          `Game container validation failed: ${containerValidation.errors.join(', ')}`
        );
      }

      // Attach canvas to container (PIXI 7 compatibility)
      const canvas = this.gameManager.app.canvas || this.gameManager.app.view;
      if (!canvas) {
        throw new Error('PIXI application canvas not found');
      }
      gameContainer.appendChild(canvas);

      // Configure stage interaction
      this.gameManager.app.stage.interactive = false;
      this.gameManager.app.stage.interactiveChildren = true;

      // Make app globally available for debugging
      window.app = this.gameManager.app;

      logger.log(LOG_LEVEL.DEBUG, 'PIXI application created successfully', LOG_CATEGORY.SYSTEM, {
        context: 'RenderCoordinator.createPixiApp',
        stage: 'pixi_initialization_complete',
        appDimensions: {
          width: this.gameManager.app.screen.width,
          height: this.gameManager.app.screen.height,
        },
        renderer: this.gameManager.app.renderer.type,
        globallyAvailable: !!window.app,
      });
    } catch (error) {
      new ErrorHandler().handle(error, ERROR_SEVERITY.CRITICAL, ERROR_CATEGORY.INITIALIZATION, {
        context: 'RenderCoordinator.createPixiApp',
        stage: 'pixi_application_creation',
        pixiAvailable: typeof PIXI !== 'undefined',
        containerExists: !!_getGameContainer(this.gameManager),
        gameManagerState: !!this.gameManager,
        errorType: error.constructor.name,
      });
      throw error;
    }
  }

  /**
   * Center the grid on the screen
   */
  centerGrid() {
    if (!this.gameManager.gridContainer || !this.gameManager.app) {
      logger.debug('Cannot center grid: missing gridContainer or app');
      return;
    }

    // Calculate the actual grid size in pixels
    const gridWidthPixels =
      ((this.gameManager.cols * this.gameManager.tileWidth) / 2) * this.gameManager.gridScale;
    const gridHeightPixels =
      ((this.gameManager.rows * this.gameManager.tileHeight) / 2) * this.gameManager.gridScale;

    // Center the grid based on current screen size and grid dimensions
    this.gameManager.gridContainer.x = this.gameManager.app.screen.width / 2 - gridWidthPixels / 2;
    this.gameManager.gridContainer.y =
      this.gameManager.app.screen.height / 2 - gridHeightPixels / 2;

    // Ensure minimum margins from screen edges
    const minMargin = 50;
    this.gameManager.gridContainer.x = Math.max(
      minMargin - gridWidthPixels / 2,
      this.gameManager.gridContainer.x
    );
    this.gameManager.gridContainer.y = Math.max(minMargin, this.gameManager.gridContainer.y);
  }

  /**
   * Reset the grid zoom to default scale and center the view
   */
  resetZoom() {
    if (this.gameManager.interactionManager) {
      this.gameManager.interactionManager.resetZoom();
    } else {
      logger.debug('Cannot reset zoom: InteractionManager not available');
    }
  }

  /**
   * Fix any existing tokens that might be in the wrong container
   * Ensures all placed tokens are properly positioned in the grid
   */
  fixExistingTokens() {
    if (!this.gameManager.placedTokens || !this.gameManager.gridContainer) {
      return;
    }

    this.gameManager.placedTokens.forEach((tokenData) => {
      if (tokenData.creature && tokenData.creature.sprite) {
        const sprite = tokenData.creature.sprite;

        // Remove from current parent
        if (sprite.parent) {
          sprite.parent.removeChild(sprite);
        }

        // Add to grid container
        this.gameManager.gridContainer.addChild(sprite);

        // Recalculate position relative to grid using CoordinateUtils and footprint center
        const fp = tokenData.footprint || { w: 1, h: 1 };
        const centerGX = tokenData.gridX + (fp.w - 1) / 2;
        const centerGY = tokenData.gridY + (fp.h - 1) / 2;
        const iso = CoordinateUtils.gridToIsometric(
          centerGX,
          centerGY,
          this.gameManager.tileWidth,
          this.gameManager.tileHeight
        );
        sprite.x = iso.x;
        sprite.y = iso.y;
      }
    });
  }

  /**
   * Handle window resize events
   * Updates PIXI application size and recenters grid
   */
  handleResize() {
    if (!this.gameManager.app) {
      return;
    }

    try {
      // Update PIXI app size
      this.gameManager.app.renderer.resize(window.innerWidth, window.innerHeight);

      // Recenter grid with new dimensions
      this.centerGrid();

      logger.log(LOG_LEVEL.DEBUG, 'Render view resized', LOG_CATEGORY.SYSTEM, {
        context: 'RenderCoordinator.handleResize',
        stage: 'viewport_resize_complete',
        newDimensions: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
        gridRecentered: true,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      new ErrorHandler().handle(error, ERROR_SEVERITY.MEDIUM, ERROR_CATEGORY.RENDERING, {
        context: 'RenderCoordinator.handleResize',
        stage: 'viewport_resize',
        targetDimensions: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
        pixiAppAvailable: !!this.gameManager.app,
        rendererAvailable: !!this.gameManager.app?.renderer,
        gridCenteringAttempted: true,
      });
    }
  }

  /**
   * Get current viewport information
   * @returns {Object} Viewport details including dimensions and scale
   */
  getViewportInfo() {
    if (!this.gameManager.app || !this.gameManager.gridContainer) {
      return null;
    }

    return {
      screenWidth: this.gameManager.app.screen.width,
      screenHeight: this.gameManager.app.screen.height,
      gridX: this.gameManager.gridContainer.x,
      gridY: this.gameManager.gridContainer.y,
      gridScale: this.gameManager.gridScale,
      cols: this.gameManager.cols,
      rows: this.gameManager.rows,
    };
  }
}
