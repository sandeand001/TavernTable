import { logger, LOG_CATEGORY } from '../../utils/logger/Logger.js';
import { GameErrors } from '../../utils/error/ErrorHandler.js';
import {
  activateTerrainMode as _activateMode,
  loadTerrainStateAndDisplay as _loadStateAndDisplay,
  handleTerrainModeActivationError as _handleActivationError,
} from './internals/activation/mode.js';

/**
 * ActivationHelpers - façade for TerrainCoordinator enable/disable helpers.
 * Pure delegation of existing logic to keep public behavior identical.
 */
export class ActivationHelpers {
  constructor(coordinator) {
    this.c = coordinator;
  }

  // ── Delegation Helpers ─────────────────────────────────────────────

  prepareBaseGridForEditing() {
    // No-op: 2D PIXI container removed (ADR-0001)
  }
  validateTerrainSystemForActivation() {
    if (typeof this.c._validateTerrainSystemForActivation === 'function')
      return this.c._validateTerrainSystemForActivation();
    return this.c.validateTerrainSystemState();
  }
  resetTerrainContainerSafely() {
    // No-op: terrain PIXI container removed (ADR-0001)
  }
  validateContainerIntegrity() {
    // No-op: PIXI container removed (ADR-0001)
  }
  activateTerrainMode() {
    if (typeof this.c._activateTerrainMode === 'function') return this.c._activateTerrainMode();
    return _activateMode(this.c);
  }
  loadTerrainStateAndDisplay() {
    if (typeof this.c._loadTerrainStateAndDisplay === 'function')
      return this.c._loadTerrainStateAndDisplay();
    return _loadStateAndDisplay(this.c);
  }
  handleTerrainModeActivationError(error) {
    if (typeof this.c._handleTerrainModeActivationError === 'function')
      return this.c._handleTerrainModeActivationError(error);
    return _handleActivationError(this.c, error);
  }

  // ── Enable Terrain Mode ────────────────────────────────────────────

  enableTerrainMode() {
    try {
      this.validateTerrainSystemForActivation();
      this.resetTerrainContainerSafely();
      this.validateContainerIntegrity();
      this.prepareBaseGridForEditing();
      this.activateTerrainMode();
      this.loadTerrainStateAndDisplay();
      try {
        this.c.applyTerrainModeGridTint?.();
      } catch (_) {
        /* non-fatal */
      }

      logger.info(
        'Terrain mode enabled',
        {
          context: 'ActivationHelpers.enableTerrainMode',
          tool: this.c.brush.tool,
          brushSize: this.c.brush.brushSize,
        },
        LOG_CATEGORY.USER
      );
    } catch (error) {
      this.handleTerrainModeActivationError(error);
    }
  }

  // ── Disable Terrain Mode ───────────────────────────────────────────

  disableTerrainMode() {
    try {
      this.c.isTerrainModeActive = false;
      this.c.isDragging = false;
      this.c.lastModifiedCell = null;
      try {
        this.c.restoreTerrainModeGridTint?.();
      } catch (_) {
        /* non-fatal */
      }

      // 2D tile cleanup removed: sprite tiles don't exist in 3D mode.

      // Apply current terrain modifications permanently to base grid
      this.c.applyTerrainToBaseGrid();

      // Reset height indicator
      this.c.resetHeightIndicator?.();

      // Apply biome palette immediately if a biome is selected
      if (!this.c.isTerrainModeActive && typeof window !== 'undefined' && window.selectedBiome) {
        try {
          this.c.applyBiomePaletteToBaseGrid();
        } catch (_) {
          /* non-fatal */
        }
      }

      logger.info(
        'Terrain mode disabled with permanent grid integration',
        {
          context: 'ActivationHelpers.disableTerrainMode',
          permanentIntegration: true,
        },
        LOG_CATEGORY.USER
      );
    } catch (error) {
      GameErrors.gameState(error, {
        stage: 'disableTerrainMode',
        context: 'ActivationHelpers.disableTerrainMode',
      });
      throw error;
    }
  }
}
