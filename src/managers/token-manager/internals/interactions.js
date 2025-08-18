import { logger } from '../../../utils/Logger.js';
import { CoordinateUtils } from '../../../utils/CoordinateUtils.js';
import { TerrainHeightUtils } from '../../../utils/TerrainHeightUtils.js';

/**
 * Wire up token right-drag interactions and global snap bridge.
 * Mirrors previous TokenManager.setupTokenInteractions behavior.
 */
export function setupTokenInteractions(c, sprite, tokenData) {
  sprite.interactive = true;
  sprite.buttonMode = true;
  // Ensure pickers ignore tokens when selecting tiles
  sprite.isCreatureToken = true;

  // Store references for event handling
  sprite.tokenData = tokenData;
  sprite.isRightDragging = false;

  logger.info(`Created ${tokenData.type} token - right-click and drag to move`);

  // Right mouse button down - start dragging immediately
  sprite.on('pointerdown', function (event) {
    if (event.data.originalEvent.button === 2) { // Right click
      logger.debug(`Right-drag started on ${this.tokenData.type}`);

      this.isRightDragging = true;
      this.alpha = 0.7; // Visual feedback - make semi-transparent
      this.dragData = event.data;
      // Capture starting pointer local position and compute offset so cursor "grabs" sprite at contact point
      const startLocal = this.dragData.getLocalPosition(this.parent);
      this.dragOffsetX = this.x - startLocal.x;
      this.dragOffsetY = this.y - startLocal.y;
      this.dragStartX = this.x; // for potential future cancel logic
      this.dragStartY = this.y;

      event.stopPropagation();
      event.preventDefault();
    }
  });

  // Mouse move - update token position if right-dragging (allow full directional movement)
  const gm = c.gameManager; // capture for closure
  sprite.on('pointermove', function (event) {
    if (this.isRightDragging && this.dragData) {
      const moveData = event?.data || this.dragData;
      const newLocal = moveData.getLocalPosition(this.parent);
      const candidateX = newLocal.x + (this.dragOffsetX || 0);
      const candidateBaseY = newLocal.y + (this.dragOffsetY || 0);

      let finalY = candidateBaseY;
      if (gm) {
        // First invert using baseline (remove any prior elevation we might have added)
        const baselineGrid = CoordinateUtils.isometricToGrid(candidateX, candidateBaseY, gm.tileWidth, gm.tileHeight);
        try {
          const height = gm?.terrainCoordinator?.dataStore?.get(baselineGrid.gridX, baselineGrid.gridY) ?? 0;
          const elev = TerrainHeightUtils.calculateElevationOffset(height);
          finalY = candidateBaseY + elev; // add elevation effect after determining grid
          this.zIndex = (baselineGrid.gridX + baselineGrid.gridY) * 100 + 1;
        } catch (_) { /* ignore */ }
      }

      this.x = candidateX;
      this.y = finalY;
    }
  });

  // Right mouse button up - end dragging and snap to grid
  sprite.on('pointerup', function (event) {
    // Some browsers report button=0 on pointerup for a right-button drag; rely on state instead of button check
    if (this.isRightDragging) {
      logger.debug(`Right-drag ended on ${this.tokenData.type} - snapping to grid`);

      this.isRightDragging = false;
      this.alpha = 1.0; // Restore full opacity
      // Capture pointer-local coordinates before clearing drag state
      let localX = null, localY = null;
      try {
        const data = event?.data || this.dragData;
        if (data && this.parent) {
          const p = data.getLocalPosition(this.parent);
          localX = p.x;
          localY = p.y;
        }
      } catch (_) { /* ignore getLocalPosition errors */ }

      // Snap to grid using the topmost picker via TokenManager (pass pointer coords when available)
      if (typeof window !== 'undefined' && window.snapToGrid) {
        window.snapToGrid(this, localX, localY);
      } else if (gm?.tokenManager) {
        gm.tokenManager.snapToGrid(this, localX, localY);
      }

      // Now clear drag data
      this.dragData = null;
      this.dragOffsetX = this.dragOffsetY = undefined;

      event.stopPropagation();
    }
  });

  // Handle mouse leaving the canvas area
  sprite.on('pointerupoutside', function (event) {
    if (this.isRightDragging) {
      logger.debug('Right-drag cancelled (mouse left canvas) - snapping to grid');

      this.isRightDragging = false;
      this.alpha = 1.0;
      // Capture pointer-local coordinates if available before clearing
      let localX = null, localY = null;
      try {
        const data = event?.data || this.dragData;
        if (data && this.parent) {
          const p = data.getLocalPosition(this.parent);
          localX = p.x;
          localY = p.y;
        }
      } catch (_) { /* ignore getLocalPosition errors */ }

      // Snap to grid
      if (typeof window !== 'undefined' && window.snapToGrid) {
        window.snapToGrid(this, localX, localY);
      } else if (gm?.tokenManager) {
        gm.tokenManager.snapToGrid(this, localX, localY);
      }

      // Clear drag data
      this.dragData = null;
      this.dragOffsetX = this.dragOffsetY = undefined;
    }
  });

  // One-time context menu suppression for right-drag UX
  if (typeof window !== 'undefined' && !window.__ttContextMenuSuppressed && c.gameManager?.app?.view) {
    window.__ttContextMenuSuppressed = true;
    c.gameManager.app.view.addEventListener('contextmenu', e => {
      if (e.target === c.gameManager.app.view) {
        e.preventDefault();
      }
    });
  }

  // Ensure a global snapToGrid bridge exists (backward compatibility for existing handlers)
  if (typeof window !== 'undefined' && !window.snapToGrid) {
    window.snapToGrid = (tokenSprite, localX = null, localY = null) => {
      try {
        c.snapToGrid(tokenSprite, localX, localY);
      } catch (e) {
        logger.error('snapToGrid bridge error', { error: e?.message, stack: e?.stack });
      }
    };
  }
}
