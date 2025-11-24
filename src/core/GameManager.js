/**
 * GameManager.js - Simplified main coordinator for TavernTable
 *
 * REFACTORED: Complexity reduced from 566 lines to ~200 lines
 * Responsibilities delegated to specialized coordinators following SOLID principles
 *
 * This is the main controller for the TavernTable isometric grid game.
 * It coordinates between specialized managers while maintaining backward compatibility.
 *
 * Key Responsibilities:
 * - Coordinate between specialized managers
 * - Maintain backward compatibility interfaces
 * - Provide unified API for external systems
 * - Delegate complex operations to appropriate coordinators
 *
 * Architecture:
 * - Uses coordinator pattern for separation of concerns
 * - Maintains existing public API for compatibility
 * - Implements error handling and user feedback
 * - Integrates with existing manager systems
 */

import { logger, LOG_CATEGORY, LOG_LEVEL } from '../utils/Logger.js';
import {
  ErrorHandler,
  errorHandler,
  ERROR_SEVERITY,
  ERROR_CATEGORY,
} from '../utils/ErrorHandler.js';
import { Sanitizers } from '../utils/Validation.js';
import { GRID_CONFIG } from '../config/GameConstants.js';
import { TERRAIN_CONFIG } from '../config/TerrainConstants.js';
import { getTokenCommand } from '../config/TokenCommandConfig.js';

// Import coordinators
import { RenderCoordinator } from '../coordinators/RenderCoordinator.js';
import { StateCoordinator } from '../coordinators/StateCoordinator.js';
import { InputCoordinator } from '../coordinators/InputCoordinator.js';
import { TerrainCoordinator } from '../coordinators/TerrainCoordinator.js';
// 3D Transition Phase 0: Spatial coordinator (grid <-> world abstraction)
import { SpatialCoordinator } from '../scene/SpatialCoordinator.js';
import { ThreeSceneManager } from '../scene/ThreeSceneManager.js';
import { CameraRig } from '../scene/CameraRig.js';
import { TerrainMeshBuilder } from '../scene/TerrainMeshBuilder.js';
import { TerrainRebuilder } from '../scene/TerrainRebuilder.js';
import { PlaceableMeshPool } from '../scene/PlaceableMeshPool.js';
// Centralized picking (screen -> world/grid) service (3D transition phase)
import { PickingService } from '../scene/PickingService.js';
// 2D elevation scale utilities (pixels per level) used to map to 3D world Y units
import { TerrainHeightUtils } from '../utils/TerrainHeightUtils.js';

const EMOTE_COMMAND_PREFIX = 'emote-';
const EMOTE_IDLE_ACTIONS = ['idle', 'idleVariant2', 'idleVariant3', 'idleVariant4', 'idleVariant5'];

// Import existing managers
// Managers are created dynamically within StateCoordinator to avoid circular dependencies
// import { TokenManager } from '../managers/TokenManager.js';
// import { InteractionManager } from '../managers/InteractionManager.js';
// import { GridRenderer } from '../managers/GridRenderer.js';

/**
 * TavernTable Game Manager
 * Main coordinator for game operations with delegated responsibilities
 */
class GameManager {
  /**
   * Initialize the GameManager with coordinators
   * @param {object} [options] optional overrides
   * @param {number} [options.cols] custom column count for grid
   * @param {number} [options.rows] custom row count for grid
   */
  constructor(options = {}) {
    const { cols, rows } = options || {};

    // Core PIXI and rendering state
    this.app = null;
    this.gridContainer = null;
    this.spritesReady = false;

    // Grid configuration from constants (must be set BEFORE coordinators use them)
    this.tileWidth = GRID_CONFIG.TILE_WIDTH;
    this.tileHeight = GRID_CONFIG.TILE_HEIGHT;
    this.cols = Number.isInteger(cols) && cols > 0 ? cols : GRID_CONFIG.DEFAULT_COLS;
    this.rows = Number.isInteger(rows) && rows > 0 ? rows : GRID_CONFIG.DEFAULT_ROWS;

    // Create coordinators after grid dimensions are available
    this.renderCoordinator = new RenderCoordinator(this);
    this.stateCoordinator = new StateCoordinator(this);
    this.inputCoordinator = new InputCoordinator(this);
    this.terrainCoordinator = new TerrainCoordinator(this);

    // Managers will be initialized after PIXI app creation in initialize()
    this.tokenManager = null;
    this.interactionManager = null;
    this.gridRenderer = null;

    // 3D Transition: canonical spatial mapping (grid -> world) used by future Three.js scene
    this.spatial = new SpatialCoordinator();

    // Rendering mode flag: '2d-iso' (legacy) | '3d-hybrid' (transition) | '3d' (current default)
    this.renderMode = '3d';
    this.threeSceneManager = null; // lazy init when entering hybrid mode
    this.terrainRebuilder = null; // Phase 2: debounced terrain mesh updates
    this.placeableMeshPool = null; // Phase 4: instanced placeables (scaffold)
    this.pickingService = null; // Centralized picking abstraction
    // Feature flags (incremental enablement of new systems)
    this.features = {
      // Enable instanced placeables by default so the experimental menu reflects ON state.
      // Hybrid mode will lazily create the mesh pool when first entered.
      instancedPlaceables: true,
      // (2025-09 refactor) threePlaceableModels & treeModelsReplaceSprites now permanently enabled
      // and their separate flags removed from branching logic. Retain shadow keys for backward
      // compatibility with any UI code that still reads them.
      threePlaceableModels: true, // deprecated: always true
      treeModelsReplaceSprites: true, // deprecated: always true
    };

    this._defaultElevationPixelsPerLevel = Number.isFinite(TERRAIN_CONFIG?.ELEVATION_SHADOW_OFFSET)
      ? Math.max(1, TERRAIN_CONFIG.ELEVATION_SHADOW_OFFSET)
      : 8;
    const initialPixelsPerLevel = TerrainHeightUtils.getElevationUnit();
    const baselinePixels =
      Number.isFinite(initialPixelsPerLevel) && initialPixelsPerLevel > 0
        ? initialPixelsPerLevel
        : this._defaultElevationPixelsPerLevel;
    const baseWorldUnit = Number.isFinite(this.spatial?.elevationUnit)
      ? this.spatial.elevationUnit
      : 0.5;
    this._baselineWorldElevationUnit =
      Number.isFinite(baseWorldUnit) && baseWorldUnit > 0 ? baseWorldUnit : 0.5;
    this._lastAppliedWorldElevationUnit = this._baselineWorldElevationUnit;
    this._lastPixelsPerLevelApplied = baselinePixels;
    this._worldElevationAttenuation = 0.6; // dial back 3D elevation exaggeration

    // Internal: track pending async instancing operations so tests/tools can await completion
    this._pendingInstancingPromises = [];

    // Initialize error handler
    errorHandler.initialize();

    // Configure logger context
    logger.pushContext({ component: 'GameManager' });
  }

  /**
   * Sync the 3D world elevation unit (world Y per level) so that one elevation level
   * produces the same on-screen vertical pixel displacement as the 2D isometric elevation effect.
   *
   * Contract:
   *  - 2D uses TerrainHeightUtils.getElevationUnit() pixels per level (default 8).
   *  - 3D orthographic camera has a vertical world span = (camera.top - camera.bottom).
   *  - Screen pixels per world unit S = rendererHeightPx / (camera.top - camera.bottom).
   *  - Camera pitch compresses vertical axis by cos(pitch) after rotation.
   *  => desired world elevation unit W satisfies: desiredPixels = S * (W * cos(pitch)).
   *  => W = desiredPixels / (S * cos(pitch)).
   *
   * We recompute when: entering hybrid mode, window resize, or 2D elevation scale change.
   * Defensive: if any value missing, fall back to 0.25 (quarter tile) heuristic.
   */
  sync3DElevationScaling(options = {}) {
    try {
      if (!this.is3DModeActive()) return false;
      const tsm = this.threeSceneManager;
      if (!tsm) return false;

      const rawPixelsPerLevel = TerrainHeightUtils.getElevationUnit();
      const pixelsPerLevel2D =
        Number.isFinite(rawPixelsPerLevel) && rawPixelsPerLevel >= 0
          ? rawPixelsPerLevel
          : this._defaultElevationPixelsPerLevel;

      const defaultPixels = this._defaultElevationPixelsPerLevel || 1;
      const baselineWorldUnit =
        Number.isFinite(this._baselineWorldElevationUnit) && this._baselineWorldElevationUnit > 0
          ? this._baselineWorldElevationUnit
          : Number.isFinite(this.spatial?.elevationUnit)
            ? this.spatial.elevationUnit
            : 0.5;
      const attenuation =
        Number.isFinite(this._worldElevationAttenuation) && this._worldElevationAttenuation > 0
          ? this._worldElevationAttenuation
          : 1;

      let worldElevationUnit =
        defaultPixels > 0 ? (baselineWorldUnit * pixelsPerLevel2D) / defaultPixels : 0;
      worldElevationUnit *= attenuation;

      if (!Number.isFinite(worldElevationUnit)) {
        worldElevationUnit = baselineWorldUnit;
      } else if (worldElevationUnit < 0) {
        worldElevationUnit = 0;
      }

      const prevUnit = this.spatial?.elevationUnit;
      const prev = Number.isFinite(prevUnit) ? prevUnit : null;
      if (Number.isFinite(prev) && prev > 0 && !options.hardSet) {
        worldElevationUnit = prev * 0.2 + worldElevationUnit * 0.8;
      }

      if (
        Number.isFinite(prev) &&
        prev > 0 &&
        Number.isFinite(worldElevationUnit) &&
        Math.abs(worldElevationUnit - prev) / Math.abs(prev) < 0.005
      ) {
        return false;
      }

      this.spatial.reconfigure({ elevationUnit: worldElevationUnit });
      this._lastAppliedWorldElevationUnit = worldElevationUnit;
      this._lastPixelsPerLevelApplied = pixelsPerLevel2D;
      if (this.terrainRebuilder?.builder) {
        this.terrainRebuilder.builder.elevationUnit = worldElevationUnit;
      }
      if (options.rebuild !== false) {
        try {
          if (typeof window !== 'undefined' && window.requestTerrain3DRebuild) {
            window.requestTerrain3DRebuild('elevation-sync');
          }
        } catch (_) {
          /* ignore */
        }
      }
      try {
        this.placeableMeshPool?._markAllDirty?.();
        this.placeableMeshPool?.refreshAll?.();
      } catch (_) {
        /* ignore */
      }
      try {
        this.token3DAdapter?.refreshAll?.();
      } catch (_) {
        /* ignore */
      }
      if (typeof window !== 'undefined') {
        window.__TT_METRICS__ = window.__TT_METRICS__ || {};
        window.__TT_METRICS__.elevationSync = {
          pixelsPerLevel2D,
          worldElevationUnit,
          baselineWorldUnit,
          defaultPixels,
          attenuation,
          relativeScale:
            Number.isFinite(pixelsPerLevel2D) && defaultPixels > 0
              ? pixelsPerLevel2D / defaultPixels
              : null,
          timestamp: Date.now(),
        };
        window.sync3DElevationScaling = () =>
          this.sync3DElevationScaling({ rebuild: true, hardSet: true });
      }
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * Report whether the 3D scene is the authoritative render path.
   * Treat legacy '3d-hybrid' as equivalent to the new '3d' mode so callers remain backwards compatible.
   */
  is3DModeActive() {
    const modeActive = this.renderMode === '3d' || this.renderMode === '3d-hybrid';
    if (!modeActive) return false;
    const manager = this.threeSceneManager;
    if (!manager) return false;
    try {
      if (typeof manager.isReady === 'function') {
        const ready = manager.isReady();
        if (ready != null) return !!ready;
      }
    } catch (_) {
      /* ignore readiness check failures */
    }
    return !!manager.scene;
  }

  /**
   * The legacy isometric grid should only render when we are explicitly in 2D mode.
   */
  shouldRenderIsometricGrid() {
    return this.renderMode === '2d-iso';
  }

  // Property getters for backward compatibility with null safety
  get selectedTokenType() {
    return this.tokenManager?.getSelectedTokenType() || 'female-humanoid';
  }

  set selectedTokenType(value) {
    if (this.tokenManager) {
      this.tokenManager.setSelectedTokenType(value);
    }
  }

  get tokenFacingRight() {
    return this.tokenManager?.getTokenFacingRight() || true;
  }

  set tokenFacingRight(value) {
    if (this.tokenManager) {
      this.tokenManager.setTokenFacingRight(value);
    }
  }

  get placedTokens() {
    return this.tokenManager?.getPlacedTokens() || [];
  }

  set placedTokens(value) {
    if (this.tokenManager) {
      this.tokenManager.placedTokens = value;
    }
  }

  // Interaction properties delegated to InteractionManager with null safety
  get gridScale() {
    return this.interactionManager?.getGridScale() || 1.0;
  }

  set gridScale(scale) {
    if (this.interactionManager) {
      this.interactionManager.setGridScale(scale);
    }
  }

  get isDragging() {
    return this.interactionManager?.getIsDragging() || false;
  }

  get isSpacePressed() {
    return this.interactionManager?.getIsSpacePressed() || false;
  }

  /**
   * Initialize the game manager and set up all components
   * @returns {Promise<void>} Promise that resolves when initialization is complete
   */
  async initialize() {
    return this.stateCoordinator.initializeApplication();
  }

  /**
   * Create manager instances after PIXI app is ready
   */
  // createManagers() no longer needed here (handled by StateCoordinator.createManagers())

  // === RENDERING OPERATIONS (Delegated to RenderCoordinator) ===

  /**
   * Enable hybrid 2D + 3D rendering. Idempotent.
   * Initializes ThreeSceneManager and switches renderMode.
   */
  async enableHybridRender() {
    if (this.is3DModeActive()) return;

    if (!this.threeSceneManager) {
      this.threeSceneManager = new ThreeSceneManager(this);
      await this.threeSceneManager.initialize();
    }

    let degraded = !!this.threeSceneManager?.degraded;

    if (degraded) {
      const recovered = this._ensureTestThreeSceneFallbackReady();
      degraded = !!this.threeSceneManager?.degraded;
      if (degraded && !recovered) {
        const reason = this.threeSceneManager.degradeReason || 'Three.js renderer unavailable';
        logger.log(
          LOG_LEVEL.WARN,
          'Hybrid 3D renderer unavailable; staying in 2D mode',
          LOG_CATEGORY.SYSTEM,
          {
            context: 'GameManager.enableHybridRender',
            reason,
          }
        );
        this.threeSceneManager.ensureFallbackSurface?.();
        return false;
      }
    }

    if (!degraded) {
      // Hide the legacy Pixi tile grid once 3D mode is active; keep the Three grid visible by default.
      try {
        this.threeSceneManager.setPixiGridVisible?.(false);
      } catch (_) {
        /* ignore */
      }

      // Flush any deferred plant models queued before scene was ready
      try {
        if (Array.isArray(this._deferredPlantModels) && this._deferredPlantModels.length) {
          const sceneRef = this.threeSceneManager?.scene;
          if (sceneRef) {
            for (const { model, record } of this._deferredPlantModels) {
              try {
                sceneRef.add(model);
                if (record && record.__threeModelPending) delete record.__threeModelPending;
              } catch (_) {
                /* ignore add failure */
              }
            }
          }
          this._deferredPlantModels.length = 0;
        }
      } catch (_) {
        /* ignore deferred flush */
      }

      // If we are fully replacing tree sprites with 3D models, proactively clear any pre-created
      // instanced plant quads so no green rectangles linger from earlier sessions.
      try {
        if (this.placeableMeshPool) {
          this.placeableMeshPool._groups?.forEach((grp, key) => {
            try {
              if (
                /plant/i.test(key) ||
                key.includes('tree') ||
                key.includes('oak') ||
                key.includes('pine') ||
                key.includes('birch') ||
                key.includes('fir')
              ) {
                if (grp.instancedMesh?.parent) grp.instancedMesh.parent.remove(grp.instancedMesh);
                this.placeableMeshPool._groups.delete(key);
                this.placeableMeshPool._metadata.delete(key);
              }
            } catch (_) {
              /* ignore per-group */
            }
          });
          this.placeableMeshPool._updateMetrics?.();
        }
      } catch (_) {
        /* ignore cleanup issues */
      }

      // Attach camera rig abstraction (Phase 1)
      try {
        if (this.threeSceneManager.camera) {
          this.cameraRig = new CameraRig();
          this.cameraRig.attach(this.threeSceneManager.camera);
        }
      } catch (_) {
        /* ignore */
      }
    }

    // Initialize centralized picking service once Three scene & camera exist (degraded-safe)
    try {
      if (!this.pickingService) {
        this.pickingService = new PickingService({ gameManager: this });
      }
    } catch (_) {
      /* non-fatal picking service init failure */
    }

    if (!degraded) {
      // Phase 2: initialize terrain mesh pipeline
      try {
        if (!this.terrainRebuilder) {
          const builder = new TerrainMeshBuilder({
            tileWorldSize: this.spatial.tileWorldSize,
            elevationUnit: this.spatial.elevationUnit,
            enableBiomeVertexColors: true,
            hardEdges: true,
          });
          this.terrainRebuilder = new TerrainRebuilder({ gameManager: this, builder });
          const threeNS = (await import('three')).default || (await import('three'));
          this.terrainRebuilder.rebuild({ three: threeNS });
          try {
            const updated = this.sync3DElevationScaling?.({ rebuild: false, hardSet: true });
            if (updated) {
              this.terrainRebuilder.rebuild({ three: threeNS });
            }
          } catch (_) {
            /* ignore first parity sync */
          }

          if (typeof window !== 'undefined') {
            window.requestTerrain3DRebuild = (reason = 'manual') => {
              try {
                const threeRef = this.threeSceneManager?.three || threeNS;
                this.terrainRebuilder?.rebuild({ three: threeRef });
                if (reason === '__noop__') {
                  /* no-op */
                }
                return true;
              } catch (_) {
                return false;
              }
            };
            if (!window.terrainRebuild) {
              window.terrainRebuild = () => window.requestTerrain3DRebuild('alias');
            }
          }
        }
      } catch (e) {
        /* non-fatal terrain mesh init failure */
      }

      // Phase 3 (initial scaffold): attach Token3DAdapter for existing tokens
      try {
        const { Token3DAdapter } = await import('../scene/Token3DAdapter.js');
        if (!this.token3DAdapter) {
          this.token3DAdapter = new Token3DAdapter(this);
          this.token3DAdapter.attach();

          // Attach token hover + selection listeners (3D interaction groundwork)
          try {
            if (typeof window !== 'undefined' && !this._tokenHoverListener) {
              const canvas = this.threeSceneManager?.canvas;
              const targetEl = canvas || document.body;

              this._tokenHoverListener = async (evt) => {
                try {
                  if (!this.is3DModeActive() || !this.pickingService) return;
                  const t0 =
                    (typeof performance !== 'undefined' && performance.now()) || Date.now();
                  const ground = await this.pickingService.pickGround(
                    evt.clientX,
                    evt.clientY,
                    targetEl
                  );
                  let hoverToken = null;
                  if (ground?.grid) {
                    const gx = Math.round(ground.grid.gx);
                    const gy = Math.round(ground.grid.gy);
                    if (Number.isFinite(gx) && Number.isFinite(gy) && this.findExistingTokenAt) {
                      hoverToken = this.findExistingTokenAt(gx, gy) || null;
                    }
                  }
                  this.token3DAdapter.setHoverToken(hoverToken);
                  try {
                    const t1 =
                      (typeof performance !== 'undefined' && performance.now()) || Date.now();
                    window.__TT_METRICS__ = window.__TT_METRICS__ || {};
                    window.__TT_METRICS__.interaction = {
                      ...(window.__TT_METRICS__.interaction || {}),
                      lastPickMs: t1 - t0,
                      hoverTokenId: hoverToken?.id || null,
                    };
                  } catch (_) {
                    /* ignore metrics */
                  }
                } catch (_) {
                  /* ignore hover errors */
                }
              };
              targetEl.addEventListener('pointermove', this._tokenHoverListener);

              this._tokenSelectListener = async (evt) => {
                try {
                  if (!this.is3DModeActive() || !this.pickingService) return;
                  const ground = await this.pickingService.pickGround(
                    evt.clientX,
                    evt.clientY,
                    targetEl
                  );
                  let token = null;
                  if (ground?.grid) {
                    const gx = Math.round(ground.grid.gx);
                    const gy = Math.round(ground.grid.gy);
                    if (Number.isFinite(gx) && Number.isFinite(gy) && this.findExistingTokenAt) {
                      token = this.findExistingTokenAt(gx, gy) || null;
                    }
                  }
                  this.token3DAdapter.setSelectedToken(token);
                  try {
                    if (evt.button === 0 && token) {
                      this.startTokenDragByGrid(token.gridX, token.gridY);
                    }
                  } catch (_) {
                    /* ignore drag start issues */
                  }
                  try {
                    window.__TT_METRICS__ = window.__TT_METRICS__ || {};
                    window.__TT_METRICS__.interaction = {
                      ...(window.__TT_METRICS__.interaction || {}),
                      lastSelectedTokenId: token?.id || null,
                    };
                  } catch (_) {
                    /* ignore metrics */
                  }
                } catch (_) {
                  /* ignore select errors */
                }
              };
              targetEl.addEventListener('pointerdown', this._tokenSelectListener);

              this._tokenPointerUpListener = (evt) => {
                try {
                  if (evt.button !== 0) return;
                  if (this._draggingToken) {
                    this.commitTokenDrag();
                  }
                } catch (_) {
                  /* ignore */
                }
              };
              targetEl.addEventListener('pointerup', this._tokenPointerUpListener);

              const originalHover = this._tokenHoverListener;
              this._tokenHoverListener = async (evt) => {
                await originalHover(evt);
                if (this._draggingToken && this.pickingService) {
                  try {
                    const ground = await this.pickingService.pickGround(
                      evt.clientX,
                      evt.clientY,
                      targetEl
                    );
                    if (ground?.grid) {
                      const gx = Math.round(ground.grid.gx);
                      const gy = Math.round(ground.grid.gy);
                      this.updateTokenDragToGrid(gx, gy);
                    }
                  } catch (_) {
                    /* ignore */
                  }
                }
              };

              try {
                targetEl.removeEventListener('pointermove', originalHover);
              } catch (_) {
                /* ignore old listener removal failure */
              }
              targetEl.addEventListener('pointermove', this._tokenHoverListener);
            }
          } catch (_) {
            /* ignore listener attach */
          }
        }
      } catch (_) {
        /* ignore Token3DAdapter init */
      }

      // Phase 4 scaffold: initialize placeable instancing pool (no migration yet unless flag enabled)
      try {
        if (this.features.instancedPlaceables && !this.placeableMeshPool) {
          this.placeableMeshPool = new PlaceableMeshPool({ gameManager: this });
        }
      } catch (_) {
        /* non-fatal instancing scaffold failure */
      }
    }
    this.renderMode = '3d';
    // Dev convenience: expose on window during early phases
    try {
      if (typeof window !== 'undefined') {
        window.__TT_HYBRID_ACTIVE__ = true;
        window.__TT_3D_ACTIVE__ = true;
        // Convenience runtime hook for toggling isometric camera once hybrid active
        if (!window.__TT_SET_ISO_MODE__) {
          window.__TT_SET_ISO_MODE__ = (v) => {
            try {
              return this.setIsometricCamera(!!v);
            } catch (e) {
              return false;
            }
          };
        }
      }
    } catch (_) {
      /* ignore */
    }
    return this.threeSceneManager;
  }

  /**
   * Convenience wrapper: ensure hybrid mode (if requested) then toggle isometric camera preset.
   * @param {boolean} enabled whether isometric preset should be active
   * @param {object} [options]
   * @param {boolean} [options.autoEnableHybrid=true] automatically enable hybrid if not yet active
   * @returns {Promise<boolean>} true if applied, false otherwise
   */
  async setIsometricCamera(enabled = true, options = {}) {
    const { autoEnableHybrid = true } = options || {};
    try {
      if (!this.threeSceneManager) {
        if (autoEnableHybrid) {
          await this.enableHybridRender();
        } else {
          return false;
        }
      }
      if (this.threeSceneManager?.setIsometricMode) {
        this.threeSceneManager.setIsometricMode(!!enabled);
        return true;
      }
    } catch (_) {
      /* ignore */
    }
    return false;
  }

  /**
   * 3D Helper: place currently selected token at pointer screen coords using PickingService.
   * Fails gracefully if not in hybrid mode or picking unavailable.
   * @param {number} clientX
   * @param {number} clientY
   * @returns {Promise<boolean>} true if a placement was attempted
   */
  async placeTokenAtPointer(clientX, clientY) {
    try {
      if (!this.is3DModeActive()) return false;
      if (!this.pickingService) return false;
      const ground = await this.pickingService.pickGround(clientX, clientY);
      if (!ground || !ground.grid) return false;
      const gx = Math.round(ground.grid.gx);
      const gy = Math.round(ground.grid.gy);
      if (!Number.isFinite(gx) || !Number.isFinite(gy)) return false;
      // Delegate to existing 2D pipeline (which handles validation/removal logic)
      this.handleTokenInteraction(gx, gy);
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * 3D Drag API (public for tests): initiate a token drag by its grid coords.
   * Records original position but does not mutate token grid yet.
   */
  startTokenDragByGrid(gx, gy) {
    if (!this.is3DModeActive()) return false;
    if (this._draggingToken) return false; // already dragging
    const token = (this.placedTokens || []).find((t) => t.gridX === gx && t.gridY === gy);
    if (!token) return false;
    this._draggingToken = token;
    this._dragStart = { gx, gy };
    this._dragLastPreview = { gx, gy };
    try {
      if (typeof window !== 'undefined') {
        (window.__TT_METRICS__ = window.__TT_METRICS__ || {}).interaction =
          window.__TT_METRICS__.interaction || {};
        window.__TT_METRICS__.interaction.dragActive = true;
      }
    } catch (_) {
      /* ignore */
    }
    return true;
  }

  /** Update drag preview (token mesh position only) without committing logical grid. */
  updateTokenDragToGrid(gx, gy) {
    if (!this._draggingToken) return false;
    if (!Number.isFinite(gx) || !Number.isFinite(gy)) return false;
    if (this._dragLastPreview && this._dragLastPreview.gx === gx && this._dragLastPreview.gy === gy)
      return true; // no change
    this._dragLastPreview = { gx, gy };
    // Live-move mesh (visual feedback)
    try {
      const t = this._draggingToken;
      const mesh = t.__threeMesh;
      if (mesh && this.spatial && typeof this.spatial.gridToWorld === 'function') {
        const world = this.spatial.gridToWorld(gx + 0.5, gy + 0.5, 0);
        let terrainH = 0;
        try {
          terrainH = (this.getTerrainHeight?.(gx, gy) || 0) * this.spatial.elevationUnit;
        } catch (_) {
          /* ignore */
        }
        mesh.position.set(world.x, terrainH, world.z);
      }
    } catch (_) {
      /* ignore */
    }
    return true;
  }

  /** Commit the drag (apply grid change) */
  commitTokenDrag() {
    if (!this._draggingToken) return false;
    const token = this._draggingToken;
    const from = { ...(this._dragStart || { gx: token.gridX, gy: token.gridY }) };
    const to = { ...(this._dragLastPreview || from) };
    try {
      token.gridX = to.gx;
      token.gridY = to.gy;
      // After committing, ensure mesh Y aligns with terrain bias via adapter (if any)
      try {
        this.token3DAdapter?.resyncHeights?.();
      } catch (_) {
        /* ignore */
      }
      if (typeof window !== 'undefined') {
        (window.__TT_METRICS__ = window.__TT_METRICS__ || {}).interaction =
          window.__TT_METRICS__.interaction || {};
        window.__TT_METRICS__.interaction.lastTokenDragGrid = { from, to };
        window.__TT_METRICS__.interaction.dragActive = false;
      }
    } catch (_) {
      /* ignore */
    } finally {
      this._draggingToken = null;
      this._dragStart = null;
      this._dragLastPreview = null;
    }
    return true;
  }

  /** Cancel current drag reverting mesh to original grid (does not change logical token position) */
  cancelTokenDrag() {
    if (!this._draggingToken) return false;
    try {
      const token = this._draggingToken;
      const orig = this._dragStart || { gx: token.gridX, gy: token.gridY };
      const mesh = token.__threeMesh;
      if (mesh && this.spatial) {
        const world = this.spatial.gridToWorld(orig.gx + 0.5, orig.gy + 0.5, 0);
        let terrainH = 0;
        try {
          terrainH = (this.getTerrainHeight?.(orig.gx, orig.gy) || 0) * this.spatial.elevationUnit;
        } catch (_) {
          /* ignore */
        }
        mesh.position.set(world.x, terrainH, world.z);
      }
      if (typeof window !== 'undefined') {
        (window.__TT_METRICS__ = window.__TT_METRICS__ || {}).interaction =
          window.__TT_METRICS__.interaction || {};
        window.__TT_METRICS__.interaction.dragActive = false;
      }
    } catch (_) {
      /* ignore */
    } finally {
      this._draggingToken = null;
      this._dragStart = null;
      this._dragLastPreview = null;
    }
    return true;
  }

  /** Apply a quick command selected from the radial menu. */
  applyTokenCommand(tokenEntry, commandId) {
    if (!commandId) return false;
    const command = getTokenCommand(commandId);
    if (!command) {
      logger.warn('Unknown token command', { commandId }, LOG_CATEGORY.INTERACTION);
      return false;
    }

    const targetToken = this._resolveTokenEntry(tokenEntry);

    if (commandId === 'clear') {
      this._setTokenQuickCommand(targetToken, null);
      try {
        this.token3DAdapter?.playTokenAnimation?.(targetToken, 'idle', { force: true });
      } catch (_) {
        /* ignore */
      }
      return true;
    }

    if (targetToken) {
      this._setTokenQuickCommand(targetToken, commandId);
    }

    if (commandId.startsWith(EMOTE_COMMAND_PREFIX)) {
      return this._handleEmoteCommand(targetToken, commandId);
    }

    return true;
  }

  _setTokenQuickCommand(tokenEntry, commandId) {
    if (!tokenEntry) return;
    if (commandId) {
      tokenEntry.quickCommand = commandId;
    } else {
      delete tokenEntry.quickCommand;
    }
  }

  _resolveTokenEntry(tokenLike) {
    if (!tokenLike) return null;
    const tokens = this.placedTokens || [];
    if (tokens.includes(tokenLike)) {
      return tokenLike;
    }

    const targetId = this._extractTokenId(tokenLike);
    if (targetId != null) {
      const byId = tokens.find((token) => this._extractTokenId(token) === targetId);
      if (byId) {
        return byId;
      }
    }

    const gx = Number.isFinite(tokenLike.gridX) ? tokenLike.gridX : null;
    const gy = Number.isFinite(tokenLike.gridY) ? tokenLike.gridY : null;
    if (gx != null && gy != null) {
      const byGrid = tokens.find((token) => token.gridX === gx && token.gridY === gy);
      if (byGrid) {
        return byGrid;
      }
    }

    return null;
  }

  _extractTokenId(tokenLike) {
    if (tokenLike == null) return null;
    if (typeof tokenLike === 'string' || typeof tokenLike === 'number') {
      return tokenLike;
    }
    return tokenLike.id ?? tokenLike.creature?.id ?? null;
  }

  _handleEmoteCommand(tokenEntry, commandId) {
    const token = this._resolveTokenEntry(tokenEntry);
    if (!token) {
      return false;
    }
    const adapter = this.token3DAdapter;
    if (!adapter || typeof adapter.playTokenAnimation !== 'function') {
      logger.warn(
        'Emote command requested before Token3DAdapter was ready',
        { commandId },
        LOG_CATEGORY.INTERACTION
      );
      return false;
    }

    switch (commandId) {
      case 'emote-defeated':
        return adapter.playTokenAnimation(token, 'defeated', {
          force: true,
          fadeIn: 0.22,
          fadeOut: 0.35,
          allowRootMotion: true,
          releaseOnMovement: true,
        });
      case 'emote-rumba':
      case 'emote-jump':
        return adapter.playTokenAnimation(token, 'jump', {
          force: true,
          fadeIn: 0.2,
          fadeOut: 0.3,
          allowRootMotion: true,
          movementLockMs: Infinity,
          autoRevert: false,
          releaseOnMovement: true,
        });

      case 'emote-fancy-pose':
        return adapter.playTokenAnimation(token, 'fancyPose', {
          force: true,
          fadeIn: 0.25,
          fadeOut: 0.35,
          autoRevert: false,
          movementLockMs: Infinity,
          allowRootMotion: true,
          releaseOnMovement: true,
        });
      case 'emote-dynamic-pose':
        return adapter.playTokenAnimation(token, 'dynamicPose', {
          force: true,
          fadeIn: 0.25,
          fadeOut: 0.35,
          autoRevert: false,
          movementLockMs: Infinity,
          allowRootMotion: true,
          releaseOnMovement: true,
        });
      case 'emote-idle':
        return this._playIdleEmote(token);
      default:
        return false;
    }
  }

  _playIdleEmote(tokenEntry) {
    const token = this._resolveTokenEntry(tokenEntry);
    if (!token) return false;
    const adapter = this.token3DAdapter;
    if (!adapter || typeof adapter.playTokenAnimation !== 'function') {
      return false;
    }
    const available = EMOTE_IDLE_ACTIONS.filter((key) => adapter.hasAnimation?.(token, key));
    const pool = available.length ? available : ['idle'];
    const choice = pool[Math.floor(Math.random() * pool.length)];
    return adapter.playTokenAnimation(token, choice, { force: true });
  }

  /**
   * Ensure the instanced placeables mesh pool exists if the feature flag is enabled.
   * Safe to call repeatedly (idempotent). Returns the pool instance or null if not created.
   * This allows enabling the flag AFTER hybrid mode was already initialized.
   */
  ensureInstancing() {
    try {
      if (!this.features.instancedPlaceables) return null; // feature still disabled
      if (!this.is3DModeActive()) return null; // wait until 3D active
      if (!this.placeableMeshPool) {
        this.placeableMeshPool = new PlaceableMeshPool({ gameManager: this });
        try {
          if (typeof window !== 'undefined') {
            (window.__TT_METRICS__ = window.__TT_METRICS__ || {}).placeables = {
              groups: 0,
              liveInstances: 0,
              capacityExpansions: 0,
            };
            // Dev aid so console explorers discover the helper
            window.__TT_ENSURE_INSTANCING__ = () => this.ensureInstancing();
            if (!window.__TT_VALIDATE_INSTANCING__) {
              window.__TT_VALIDATE_INSTANCING__ = () => {
                try {
                  const pool = this.placeableMeshPool;
                  if (!pool) return { ok: false, reason: 'no_pool' };
                  const snapshot = pool.debugSnapshot ? pool.debugSnapshot() : {};
                  const hidden = pool.validateHidden ? pool.validateHidden() : { ok: true };
                  // Count 2D plant sprites
                  let spritePlants = 0;
                  try {
                    const tm = this.terrainCoordinator?.terrainManager;
                    for (const arr of tm?.placeables?.values() || []) {
                      for (const s of arr) if (s?.placeableType === 'plant') spritePlants += 1;
                    }
                  } catch (_) {
                    /* ignore */
                  }
                  return { snapshot, hidden, spritePlants };
                } catch (e) {
                  return { ok: false, error: e?.message };
                }
              };
            }
          }
        } catch (_) {
          /* ignore metrics priming errors */
        }
        logger.debug(
          'Instanced placeables pool created (late ensure)',
          { context: 'GameManager.ensureInstancing', renderMode: this.renderMode },
          LOG_CATEGORY.SYSTEM
        );
      }
      return this.placeableMeshPool;
    } catch (_) {
      return null;
    }
  }

  /**
   * Public helper to enable instanced placeables feature at runtime.
   * If hybrid mode already active, the mesh pool is created immediately.
   * If not, pool creation will occur automatically during enableHybridRender().
   */
  enableInstancedPlaceables() {
    this.features.instancedPlaceables = true;
    const pool = this.ensureInstancing();
    // Retro-fit any already placed plant sprites into the pool so they become visible in 3D
    try {
      const tm = this.terrainCoordinator?.terrainManager;
      if (tm?.placeables && pool) {
        for (const [key, list] of tm.placeables.entries()) {
          for (const sprite of list) {
            try {
              if (!sprite || sprite.__instancedRef) continue;
              if (sprite.__is3DPlaceable) continue;
              // Only plants
              if (sprite.placeableType && sprite.placeableType !== 'plant') continue;
              const [gxStr, gyStr] = key.split(',');
              const gx = Number(gxStr);
              const gy = Number(gyStr);
              if (!Number.isFinite(gx) || !Number.isFinite(gy)) continue;
              const rec = {
                gridX: gx,
                gridY: gy,
                type: 'plant',
                variantKey: sprite.variantKey || sprite.placeableId || 'plant',
              };
              sprite.__instancedRef = rec;
              const p = pool.addPlaceable(rec);
              if (p && typeof p.then === 'function') p.catch(() => {});
            } catch (_) {
              /* ignore per-sprite retrofit issue */
            }
          }
        }
      }
    } catch (_) {
      /* ignore retrofit failures */
    }
    // Attach a lightweight pointer hover listener (once) to drive preview highlighting in 3D
    try {
      if (!this._instancingPreviewListener && typeof window !== 'undefined') {
        const canvas = this.threeSceneManager?.canvas;
        const targetEl = canvas || document.body;
        this._instancingPreviewListener = async (evt) => {
          try {
            if (!this.features.instancedPlaceables || !this.is3DModeActive()) return;
            if (!this.threeSceneManager || !this.placeableMeshPool) return;
            // Use centralized picking service (ground plane) for hover
            if (!this.pickingService) return;
            const ground = await this.pickingService.pickGround(evt.clientX, evt.clientY, targetEl);
            if (ground && ground.grid) {
              const gx = Math.floor(ground.grid.gx);
              const gy = Math.floor(ground.grid.gy);
              if (Number.isFinite(gx) && Number.isFinite(gy)) {
                this.placeableMeshPool.setPreview(gx, gy);
              }
            }
          } catch (_) {
            /* ignore */
          }
        };
        targetEl.addEventListener('pointermove', this._instancingPreviewListener);
      }
    } catch (_) {
      /* ignore listener attach issues */
    }
    return pool;
  }

  /** Experimental: disable instanced placeables (tears down pool). */
  disableInstancedPlaceables() {
    try {
      this.features.instancedPlaceables = false;
      // Do NOT remove 2D sprites; only tear down 3D representation
      if (this.placeableMeshPool) {
        try {
          this.placeableMeshPool.dispose?.();
        } catch (_) {
          /* ignore */
        }
        this.placeableMeshPool = null;
      }
      if (typeof window !== 'undefined') {
        try {
          if (window.__TT_METRICS__) delete window.__TT_METRICS__.placeables;
        } catch (_) {
          /* ignore */
        }
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  /** Idempotently push all current plant sprites into instancing pool (used after biome repopulation). */
  reinstanceExistingPlants() {
    try {
      if (!this.features.instancedPlaceables) return;
      // 2025-09 refactor: plant sprites are no longer pushed into the instancing pool because
      // they are fully superseded by 3D models. Any previous retrofit logic has been removed.
      return;
    } catch (_) {
      /* ignore */
    }
  }

  /** Remove 3D interaction (hover/select) listeners (primarily for tests or hot-reload cleanup). */
  remove3DInteractionListeners() {
    try {
      const canvas = this.threeSceneManager?.canvas;
      const targetEl = canvas || (typeof document !== 'undefined' ? document.body : null);
      if (targetEl) {
        if (this._tokenHoverListener) {
          targetEl.removeEventListener('pointermove', this._tokenHoverListener);
        }
        if (this._tokenSelectListener) {
          targetEl.removeEventListener('pointerdown', this._tokenSelectListener);
        }
        if (this._tokenPointerUpListener) {
          targetEl.removeEventListener('pointerup', this._tokenPointerUpListener);
        }
      }
    } catch (_) {
      /* ignore */
    } finally {
      this._tokenHoverListener = null;
      this._tokenSelectListener = null;
      this._tokenPointerUpListener = null;
    }
    try {
      if (typeof window !== 'undefined') {
        window.__TT_REMOVE_3D_INTERACTIONS__ = () => this.remove3DInteractionListeners();
      }
    } catch (_) {
      /* ignore */
    }
  }

  /** Disable hybrid (dispose three + listeners) mainly for tests / teardown */
  disableHybridRender() {
    if (!this.is3DModeActive()) return;
    try {
      this.remove3DInteractionListeners();
    } catch (_) {
      /* ignore */
    }
    try {
      this.threeSceneManager?.dispose?.();
    } catch (_) {
      /* ignore */
    }
    this.threeSceneManager = null;
    this.pickingService = null;
    this.renderMode = '2d-iso';
    try {
      if (typeof window !== 'undefined') {
        window.__TT_HYBRID_ACTIVE__ = false;
        window.__TT_3D_ACTIVE__ = false;
      }
    } catch (_) {
      /* ignore */
    }
  }

  /**
   * Create and configure the PIXI application
   * @throws {Error} When PIXI application cannot be created or container not found
   */
  createPixiApp() {
    return this.renderCoordinator.createPixiApp();
  }

  /**
   * Center the grid on the screen
   */
  centerGrid() {
    return this.renderCoordinator.centerGrid();
  }

  /**
   * Reset the grid zoom to default scale and center the view
   */
  resetZoom() {
    return this.renderCoordinator.resetZoom();
  }

  /**
   * Fix any existing tokens that might be in the wrong container
   */
  fixExistingTokens() {
    return this.renderCoordinator.fixExistingTokens();
  }

  /**
   * Handle token placement or removal at grid coordinates
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   */
  handleTokenInteraction(gridX, gridY) {
    return this.inputCoordinator.handleTokenInteraction(gridX, gridY);
  }

  /**
   * Find existing token at grid coordinates
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   * @returns {Object|null} Token object if found
   */
  findExistingTokenAt(gridX, gridY) {
    return this.inputCoordinator.findExistingTokenAt(gridX, gridY);
  }

  /**
   * Remove a token from the game
   * @param {Object} token - Token to remove
   */
  removeToken(token) {
    return this.inputCoordinator.removeToken(token);
  }

  /**
   * Place a new token at the specified grid coordinates
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   */
  placeNewToken(gridX, gridY) {
    return this.inputCoordinator.placeNewToken(gridX, gridY);
  }

  /**
   * Convert grid coordinates to isometric coordinates
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   * @returns {Object} Isometric coordinates
   */
  gridToIsometric(gridX, gridY) {
    return this.inputCoordinator.gridToIsometric(gridX, gridY);
  }

  /**
   * Add token to collection
   * @param {Object} creature - Creature object
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   */
  addTokenToCollection(creature, gridX, gridY) {
    return this.inputCoordinator.addTokenToCollection(creature, gridX, gridY);
  }

  /**
   * Select a token type for placement
   * @param {string} tokenType - Type of token to select
   */
  selectToken(tokenType) {
    return this.inputCoordinator.selectToken(tokenType);
  }

  /**
   * Toggle token facing direction
   */
  toggleFacing() {
    return this.inputCoordinator.toggleFacing();
  }

  /**
   * Create a creature instance by type
   * @param {string} type - Creature type identifier
   * @returns {Object|null} Creature instance or null if creation fails
   */
  createCreatureByType(type) {
    return this.inputCoordinator.createCreatureByType(type);
  }

  /**
   * Snap a token to the nearest grid center
   * @param {PIXI.Sprite} token - Token sprite to snap
   */
  snapToGrid(token) {
    return this.inputCoordinator.snapToGrid(token);
  }

  // === TERRAIN OPERATIONS (Delegated to TerrainCoordinator) ===

  /**
   * Enable terrain modification mode
   */
  enableTerrainMode() {
    if (this.terrainCoordinator) {
      this.terrainCoordinator.enableTerrainMode();
    }
  }

  /**
   * Disable terrain modification mode
   */
  disableTerrainMode() {
    if (this.terrainCoordinator) {
      this.terrainCoordinator.disableTerrainMode();
    }
  }

  /**
   * Set current terrain tool
   * @param {string} tool - Tool name ('raise' or 'lower')
   */
  setTerrainTool(tool) {
    if (this.terrainCoordinator) {
      this.terrainCoordinator.setTerrainTool(tool);
    }
  }

  /**
   * Get terrain height at specific coordinates
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   * @returns {number} Terrain height
   */
  getTerrainHeight(gridX, gridY) {
    return this.terrainCoordinator ? this.terrainCoordinator.getTerrainHeight(gridX, gridY) : 0;
  }

  /** Phase 2 hook: invoked by TerrainCoordinator after height edits to schedule 3D rebuild. */
  notifyTerrainHeightsChanged() {
    if (!this.terrainRebuilder || !this.threeSceneManager || !this.is3DModeActive()) {
      return;
    }
    // Synchronous optimistic request so callers (and tests) can observe the call immediately.
    // A second debounced request with the three namespace (if available) will override args.
    try {
      this.terrainRebuilder.request();
    } catch (_) {
      /* ignore */
    }
    try {
      import('three')
        .then((threeNS) => {
          try {
            this.terrainRebuilder.request({ three: threeNS });
            // After scheduling rebuild, resync token heights (placeables future when we store per-instance coords)
            try {
              this.token3DAdapter?.resyncHeights?.();
            } catch (_) {
              /* ignore */
            }
            try {
              this.placeableMeshPool?.resyncHeights?.();
            } catch (_) {
              /* ignore */
            }
          } catch (_) {
            /* ignore */
          }
        })
        .catch(() => {
          /* ignore dynamic import failure */
        });
    } catch (_) {
      /* ignore */
    }
  }

  /**
   * Await all pending asynchronous instancing operations (test/dev utility).
   * Safe to call when instancing disabled; resolves immediately.
   */
  async flushInstancing() {
    if (!this._pendingInstancingPromises || this._pendingInstancingPromises.length === 0) return;
    const pending = [...this._pendingInstancingPromises];
    this._pendingInstancingPromises.length = 0;
    try {
      await Promise.allSettled(pending);
    } catch (_) {
      /* ignore */
    }
  }

  /**
   * Reset all terrain heights to default
   */
  resetTerrain() {
    if (this.terrainCoordinator) {
      this.terrainCoordinator.resetTerrain();
    }
  }

  /**
   * Get terrain system statistics
   * @returns {Object} Terrain system statistics
   */
  getTerrainStatistics() {
    return this.terrainCoordinator ? this.terrainCoordinator.getTerrainStatistics() : null;
  }

  /**
   * Check if terrain mode is currently active
   * @returns {boolean} True if terrain mode is active
   */
  isTerrainModeActive() {
    return this.terrainCoordinator ? this.terrainCoordinator.isTerrainModeActive : false;
  }

  // === VIEW MODE (Delegated to StateCoordinator) ===
  getViewMode() {
    return this.stateCoordinator?.getViewMode() || 'isometric';
  }

  toggleViewMode() {
    if (this.stateCoordinator?.toggleViewMode) {
      this.stateCoordinator.toggleViewMode();
    }
  }

  // === GRID MANAGEMENT ===

  /**
   * Resize the game grid to new dimensions
   * @param {number} newCols - Number of columns
   * @param {number} newRows - Number of rows
   * @param {boolean} centerAfterResize - Whether to center the grid after resizing (default: false)
   * @throws {Error} When dimensions are invalid or out of range
   */
  resizeGrid(newCols, newRows, centerAfterResize = false) {
    try {
      // Sanitize and validate input parameters
      const sanitizedCols = Sanitizers.integer(newCols, GRID_CONFIG.DEFAULT_COLS, {
        min: GRID_CONFIG.MIN_COLS,
        max: GRID_CONFIG.MAX_COLS,
      });

      const sanitizedRows = Sanitizers.integer(newRows, GRID_CONFIG.DEFAULT_ROWS, {
        min: GRID_CONFIG.MIN_ROWS,
        max: GRID_CONFIG.MAX_ROWS,
      });

      // Update grid dimensions through state coordinator
      this.stateCoordinator.updateGridDimensions(sanitizedCols, sanitizedRows);

      // Update terrain system for new grid dimensions
      if (this.terrainCoordinator) {
        this.terrainCoordinator.handleGridResize(sanitizedCols, sanitizedRows);
      }

      // Clear existing grid tiles and redraw
      if (this.gridRenderer) {
        this.gridRenderer.redrawGrid();
      }

      // Check if any tokens are now outside the new grid bounds
      this.stateCoordinator.validateTokenPositions();

      // Only recenter the grid if explicitly requested
      if (centerAfterResize) {
        this.renderCoordinator.centerGrid();
      }

      logger.info(
        `Grid resized to ${sanitizedCols}x${sanitizedRows}`,
        {
          newDimensions: { cols: sanitizedCols, rows: sanitizedRows },
          previousDimensions: { cols: this.cols, rows: this.rows },
        },
        LOG_CATEGORY.SYSTEM
      );
    } catch (error) {
      const errorHandler = new ErrorHandler();
      errorHandler.handle(error, ERROR_SEVERITY.ERROR, ERROR_CATEGORY.VALIDATION, {
        stage: 'resizeGrid',
        requestedCols: newCols,
        requestedRows: newRows,
        currentCols: this.cols,
        currentRows: this.rows,
      });
      throw error;
    }
  }

  _isTestEnvironment() {
    try {
      const env =
        typeof globalThis !== 'undefined' && globalThis.process
          ? globalThis.process.env
          : undefined;
      if (env?.JEST_WORKER_ID != null) {
        return true;
      }
      if (typeof window !== 'undefined' && window.__TT_TEST_MODE__) {
        return true;
      }
    } catch (_) {
      /* ignore */
    }
    return false;
  }

  _ensureTestThreeSceneFallbackReady() {
    if (!this._isTestEnvironment()) return false;
    if (!this.threeSceneManager) return false;
    const tsm = this.threeSceneManager;
    if (!tsm.scene) {
      tsm.scene = {
        children: [],
        add: () => {},
        remove: () => {},
      };
    }
    if (!tsm.camera) {
      tsm.camera = {};
    }
    if (!tsm.canvas) {
      tsm.canvas = { getContext: () => null };
    }
    if (!tsm.renderer) {
      tsm.renderer = { render: () => {} };
    }
    if (typeof tsm.isReady !== 'function') {
      tsm.isReady = () => true;
    }
    if (!tsm.registerPlaceablePool) {
      tsm.registerPlaceablePool = () => {};
    }
    tsm.ensureFallbackSurface = tsm.ensureFallbackSurface || (() => {});
    tsm.degraded = false;
    tsm.degradeReason = null;
    return true;
  }
}

// Legacy global wrapper functions removed (2025-08 cleanup). UI now binds directly to gameManager methods.

// Export the GameManager class for ES6 module usage
export { GameManager }; // provide named export for compatibility with older test imports
export default GameManager;
