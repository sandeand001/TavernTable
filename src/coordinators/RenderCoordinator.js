/**
 * RenderCoordinator.js - Manages PIXI rendering setup and viewport operations
 * 
 * Extracted from GameManager to follow single responsibility principle
 * Handles PIXI application lifecycle, grid positioning, and zoom management
 */

import logger from '../utils/Logger.js';
import { GameErrors } from '../utils/ErrorHandler.js';
import { GameValidators } from '../utils/Validation.js';
import { GRID_CONFIG } from '../config/GameConstants.js';

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
        backgroundColor: GRID_CONFIG.BACKGROUND_COLOR
      });
      
      // Validate application creation
      const appValidation = GameValidators.pixiApp(this.gameManager.app);
      if (!appValidation.isValid) {
        throw new Error(`PIXI application validation failed: ${appValidation.getErrorMessage()}`);
      }
      
      // Find and validate game container
      const gameContainer = document.getElementById('game-container');
      const containerValidation = GameValidators.domElement(gameContainer, 'div');
      if (!containerValidation.isValid) {
        throw new Error(`Game container validation failed: ${containerValidation.getErrorMessage()}`);
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
      
      logger.debug('PIXI application created successfully');
    } catch (error) {
      GameErrors.initialization(error, {
        stage: 'createPixiApp',
        pixiAvailable: typeof PIXI !== 'undefined',
        containerExists: !!document.getElementById('game-container')
      });
      throw error;
    }
  }

  /**
   * Center the grid on the screen
   */
  centerGrid() {
    if (!this.gameManager.gridContainer || !this.gameManager.app) {
      logger.warn('Cannot center grid: missing gridContainer or app');
      return;
    }

    // Calculate the actual grid size in pixels
    const gridWidthPixels = (this.gameManager.cols * this.gameManager.tileWidth / 2) * this.gameManager.gridScale;
    const gridHeightPixels = (this.gameManager.rows * this.gameManager.tileHeight / 2) * this.gameManager.gridScale;
    
    // Center the grid based on current screen size and grid dimensions
    this.gameManager.gridContainer.x = (this.gameManager.app.screen.width / 2) - (gridWidthPixels / 2);
    this.gameManager.gridContainer.y = (this.gameManager.app.screen.height / 2) - (gridHeightPixels / 2);
    
    // Ensure minimum margins from screen edges
    const minMargin = 50;
    this.gameManager.gridContainer.x = Math.max(minMargin - gridWidthPixels / 2, this.gameManager.gridContainer.x);
    this.gameManager.gridContainer.y = Math.max(minMargin, this.gameManager.gridContainer.y);
  }

  /**
   * Reset the grid zoom to default scale and center the view
   */
  resetZoom() {
    if (this.gameManager.interactionManager) {
      this.gameManager.interactionManager.resetZoom();
    } else {
      logger.warn('Cannot reset zoom: InteractionManager not available');
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

    this.gameManager.placedTokens.forEach(tokenData => {
      if (tokenData.creature && tokenData.creature.sprite) {
        const sprite = tokenData.creature.sprite;
        
        // Remove from current parent
        if (sprite.parent) {
          sprite.parent.removeChild(sprite);
        }
        
        // Add to grid container
        this.gameManager.gridContainer.addChild(sprite);
        
        // Recalculate position relative to grid
        const isoX = (tokenData.gridX - tokenData.gridY) * (this.gameManager.tileWidth / 2);
        const isoY = (tokenData.gridX + tokenData.gridY) * (this.gameManager.tileHeight / 2);
        sprite.x = isoX;
        sprite.y = isoY;
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
      
      logger.debug(`Render view resized to ${window.innerWidth}x${window.innerHeight}`);
    } catch (error) {
      GameErrors.rendering(error, { 
        stage: 'handleResize',
        dimensions: { width: window.innerWidth, height: window.innerHeight }
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
      rows: this.gameManager.rows
    };
  }
}
