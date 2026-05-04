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

      // Reset any elevation offsets and remove shadows before applying to base grid
      if (this.c.gameManager?.gridContainer?.children) {
        this.c.gameManager.gridContainer.children.forEach((child) => {
          if (child.isGridTile) {
            const tlc = this.c._tileLifecycle;
            if (tlc && typeof tlc.clearTileArtifacts === 'function') {
              // Centralized cleanup of per-tile artifacts with explicit resets
              tlc.clearTileArtifacts(child, { resetAlpha: true, resetY: true });
            } else {
              // Fallback to previous inline behavior to preserve compatibility
              child.alpha = 1.0;
              if (typeof child.baseIsoY === 'number') child.y = child.baseIsoY;
              if (child.shadowTile && child.parent?.children?.includes(child.shadowTile)) {
                child.parent.removeChild(child.shadowTile);
                if (typeof child.shadowTile.destroy === 'function' && !child.shadowTile.destroyed) {
                  child.shadowTile.destroy();
                }
                child.shadowTile = null;
              }
              if (child.depressionOverlay) {
                try {
                  if (child.children?.includes(child.depressionOverlay))
                    child.removeChild(child.depressionOverlay);
                  if (
                    typeof child.depressionOverlay.destroy === 'function' &&
                    !child.depressionOverlay.destroyed
                  ) {
                    child.depressionOverlay.destroy();
                  }
                } catch (_) {
                  /* best-effort */
                }
                child.depressionOverlay = null;
              }
              if (child.baseSideFaces && child.parent?.children?.includes(child.baseSideFaces)) {
                child.parent.removeChild(child.baseSideFaces);
                if (
                  typeof child.baseSideFaces.destroy === 'function' &&
                  !child.baseSideFaces.destroyed
                ) {
                  child.baseSideFaces.destroy();
                }
                child.baseSideFaces = null;
              }
            }
          }
        });
      }

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
