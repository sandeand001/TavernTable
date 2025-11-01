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

export class RenderCoordinator {
  /**
   * @param {object} gameManager
   * @param {object} [domPorts] - injected DOM accessors (UI layer). Expected shape:
   *   { getGameContainer: () => HTMLElement|null }
   */
  constructor(gameManager, domPorts = {}) {
    this.gameManager = gameManager;
    const defaultGetGameContainer = () => {
      if (typeof document === 'undefined') return null;
      return document.getElementById('game-container');
    };
    this.domPorts = {
      getGameContainer: domPorts.getGameContainer || defaultGetGameContainer,
    };
  }

  /**
   * Create and configure the PIXI application
   */
  createPixiApp() {
    try {
      if (typeof PIXI === 'undefined') throw new Error('PIXI.js library is not loaded');

      const width = typeof window !== 'undefined' ? window.innerWidth || 1024 : 1024;
      const height = typeof window !== 'undefined' ? window.innerHeight || 768 : 768;
      const hasPixiUtils = typeof PIXI.utils !== 'undefined';
      const supportsWebGL = hasPixiUtils ? PIXI.utils.isWebGLSupported?.() !== false : true;
      const baseOptions = {
        width,
        height,
        backgroundColor: GRID_CONFIG.BACKGROUND_COLOR,
        antialias: true,
        resolution: (typeof window !== 'undefined' && window.devicePixelRatio) || 1,
      };

      const attemptCreateApp = (options) => {
        try {
          return new PIXI.Application(options);
        } catch (err) {
          return { __error: err };
        }
      };

      const primaryOptions = supportsWebGL ? baseOptions : { ...baseOptions, forceCanvas: true };
      let app = attemptCreateApp(primaryOptions);
      if (app && app.__error) {
        if (!primaryOptions.forceCanvas) {
          const fallbackOptions = { ...baseOptions, forceCanvas: true };
          app = attemptCreateApp(fallbackOptions);
          if (!app || app.__error) {
            throw app?.__error || new Error('Failed to create PIXI application');
          }
        } else {
          throw app.__error;
        }
      }

      this.gameManager.app = app;

      const appValidation = GameValidators.pixiApp(this.gameManager.app);
      if (!appValidation.isValid) {
        throw new Error(`PIXI application validation failed: ${appValidation.errors.join(', ')}`);
      }

      const gameContainer = this.domPorts.getGameContainer();
      const containerValidation = GameValidators.domElement(gameContainer, 'div');
      if (!containerValidation.isValid) {
        throw new Error(
          `Game container validation failed: ${containerValidation.errors.join(', ')}`
        );
      }

      const canvas = this.gameManager.app.canvas || this.gameManager.app.view;
      if (!canvas) throw new Error('PIXI application canvas not found');
      gameContainer.appendChild(canvas);

      this.gameManager.app.stage.interactive = false;
      this.gameManager.app.stage.interactiveChildren = true;

      window.app = this.gameManager.app; // debug convenience

      const rendererType = this.gameManager.app?.renderer?.type;
      const rendererName = (() => {
        try {
          if (typeof PIXI.RENDERER_TYPE !== 'undefined') {
            const entries = Object.entries(PIXI.RENDERER_TYPE);
            const match = entries.find(([, value]) => value === rendererType);
            return match ? match[0].toLowerCase() : rendererType;
          }
        } catch (_) {
          /* ignore */
        }
        return rendererType;
      })();

      if (rendererName && /canvas/i.test(String(rendererName))) {
        logger.log(
          LOG_LEVEL.WARN,
          'PIXI WebGL unavailable, using canvas renderer',
          LOG_CATEGORY.SYSTEM,
          {
            context: 'RenderCoordinator.createPixiApp',
            stage: 'pixi_initialization_complete',
            renderer: rendererName,
            webglSupported: supportsWebGL,
          }
        );
      }

      logger.log(LOG_LEVEL.DEBUG, 'PIXI application created successfully', LOG_CATEGORY.SYSTEM, {
        context: 'RenderCoordinator.createPixiApp',
        stage: 'pixi_initialization_complete',
        appDimensions: {
          width: this.gameManager.app.screen.width,
          height: this.gameManager.app.screen.height,
        },
        renderer: rendererName,
        globallyAvailable: !!window.app,
      });
    } catch (error) {
      new ErrorHandler().handle(error, ERROR_SEVERITY.CRITICAL, ERROR_CATEGORY.INITIALIZATION, {
        context: 'RenderCoordinator.createPixiApp',
        stage: 'pixi_application_creation',
        pixiAvailable: typeof PIXI !== 'undefined',
        containerExists: !!this.domPorts.getGameContainer(),
        gameManagerState: !!this.gameManager,
        errorType: error.constructor.name,
      });
      throw error;
    }
  }

  /** Center the grid on the screen */
  centerGrid() {
    if (!this.gameManager.gridContainer || !this.gameManager.app) {
      logger.debug('Cannot center grid: missing gridContainer or app');
      return;
    }
    const gridWidthPixels =
      ((this.gameManager.cols * this.gameManager.tileWidth) / 2) * this.gameManager.gridScale;
    const gridHeightPixels =
      ((this.gameManager.rows * this.gameManager.tileHeight) / 2) * this.gameManager.gridScale;

    this.gameManager.gridContainer.x = this.gameManager.app.screen.width / 2 - gridWidthPixels / 2;
    this.gameManager.gridContainer.y =
      this.gameManager.app.screen.height / 2 - gridHeightPixels / 2;

    const minMargin = 50;
    this.gameManager.gridContainer.x = Math.max(
      minMargin - gridWidthPixels / 2,
      this.gameManager.gridContainer.x
    );
    this.gameManager.gridContainer.y = Math.max(minMargin, this.gameManager.gridContainer.y);
  }
  /** Reset zoom via interaction manager */
  resetZoom() {
    if (this.gameManager.interactionManager) {
      this.gameManager.interactionManager.resetZoom();
    } else logger.debug('Cannot reset zoom: InteractionManager not available');
  }

  /** Ensure placed token sprites are in grid container and positioned correctly */
  fixExistingTokens() {
    if (!this.gameManager.placedTokens || !this.gameManager.gridContainer) return;
    this.gameManager.placedTokens.forEach((tokenData) => {
      if (tokenData.creature && tokenData.creature.sprite) {
        const sprite = tokenData.creature.sprite;
        if (sprite.parent) sprite.parent.removeChild(sprite);
        this.gameManager.gridContainer.addChild(sprite);
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

  /** Handle window resize: resize renderer & recenter grid */
  handleResize() {
    if (!this.gameManager.app) return;
    try {
      this.gameManager.app.renderer.resize(window.innerWidth, window.innerHeight);
      this.centerGrid();
      logger.log(LOG_LEVEL.DEBUG, 'Render view resized', LOG_CATEGORY.SYSTEM, {
        context: 'RenderCoordinator.handleResize',
        stage: 'viewport_resize_complete',
        newDimensions: { width: window.innerWidth, height: window.innerHeight },
        gridRecentered: true,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      new ErrorHandler().handle(error, ERROR_SEVERITY.MEDIUM, ERROR_CATEGORY.RENDERING, {
        context: 'RenderCoordinator.handleResize',
        stage: 'viewport_resize',
        targetDimensions: { width: window.innerWidth, height: window.innerHeight },
        pixiAppAvailable: !!this.gameManager.app,
        rendererAvailable: !!this.gameManager.app?.renderer,
        gridCenteringAttempted: true,
      });
    }
  }

  /** Get viewport info snapshot */
  getViewportInfo() {
    if (!this.gameManager.app || !this.gameManager.gridContainer) return null;
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
