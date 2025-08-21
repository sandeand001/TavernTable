/**
 * GameManager.js - Main coordinator for TavernTable
 * Coordinates between managers and exposes unified API
 */
import { logger, LOG_CATEGORY } from '../utils/Logger.js';
import { ErrorHandler, errorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../utils/ErrorHandler.js';
import { Sanitizers } from '../utils/Validation.js';
import { GRID_CONFIG } from '../config/GameConstants.js';
import { RenderCoordinator } from '../coordinators/RenderCoordinator.js';
import { StateCoordinator } from '../coordinators/StateCoordinator.js';
import { InputCoordinator } from '../coordinators/InputCoordinator.js';
import { TerrainCoordinator } from '../coordinators/TerrainCoordinator.js';

class GameManager {
  constructor() {
    this.app = null;
    this.gridContainer = null;
    this.spritesReady = false;
    this.tileWidth = GRID_CONFIG.TILE_WIDTH;
    this.tileHeight = GRID_CONFIG.TILE_HEIGHT;
    this.cols = GRID_CONFIG.DEFAULT_COLS;
    this.rows = GRID_CONFIG.DEFAULT_ROWS;
    // ...existing code...
  }
  // ...existing code...
}
export default GameManager;
