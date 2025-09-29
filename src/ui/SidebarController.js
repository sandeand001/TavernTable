/* eslint-disable indent */
/**
 * SidebarController.js - Manages the right sidebar menu system
 *
 * Handles tab switching, dice log management, and sidebar interactions
 * Following clean, modular design principles with single responsibility
 */
import {
  getCreatureButtons,
  getDiceLogContentEl,
  getTokenButtonByType,
  getShadingControls,
  getBiomeRootEl,
  getTabButtons,
  getTabPanels,
  getGridOpacityControl,
  getAnimationSpeedControl,
  getBiomeButtons,
  getBiomeButtonByKey,
  getTerrainPlaceablesRoot,
  createPlaceableButton,
} from './domHelpers.js';
import { logger, LOG_CATEGORY } from '../utils/Logger.js';

class SidebarController {
  constructor() {
    // Default active tab (original): dice-log
    this.activeTab = 'dice-log';
    this.diceLogEntries = [];
    this.maxLogEntries = 50; // Prevent memory issues with large logs

    this.init();
  }

  // Small helpers to avoid repeating common selectors
  _getTabButtons() {
    return getTabButtons();
  }

  _getTabPanels() {
    return getTabPanels();
  }

  //

  /**
   * Initialize the sidebar controller
   * Sets up event listeners and default state
   */
  init() {
    this.setupTabListeners();
    this.setupRangeSliderListeners();
    this.setupDiceLogControls();
    this.showTab(this.activeTab);

    // Biome menu now lazy-builds when Biomes tab first opened
    // Initialize global rich shading defaults
    if (!window.richShadingSettings) {
      window.richShadingSettings = {
        enabled: true,
        intensity: 1.0, // 0..1 multiplier for alpha
        density: 1.0, // 0.5..1.5 multiplier for element counts/sizes
        performance: false,
        shorelineSandStrength: 1.0, // 0..2 multiplier for shoreline sand effect
      };
    }

    // Add welcome message to dice log
    this.addDiceLogEntry('Welcome to TavernTable! Roll some dice to see history here.', 'system');
  }

  /**
   * Wire tab buttons to show corresponding panels and handle keyboard nav.
   * Defensive: tolerates missing DOM in test/dom-less environments.
   */
  setupTabListeners() {
    try {
      const buttons = this._getTabButtons();
      if (!buttons || buttons.length === 0) return;
      buttons.forEach((btn) => {
        // Avoid double-binding
        if (btn.dataset.boundClick) return;
        btn.addEventListener('click', () => {
          const tab = btn.getAttribute('data-tab');
          if (tab) this.showTab(tab);
        });
        // Basic keyboard navigation (left/right)</span>
        btn.addEventListener('keydown', (ev) => {
          try {
            if (ev.key === 'ArrowRight') {
              // focus next
              const next = btn.nextElementSibling || buttons[0];
              next?.focus();
            } else if (ev.key === 'ArrowLeft') {
              const prev = btn.previousElementSibling || buttons[buttons.length - 1];
              prev?.focus();
            }
          } catch (_) {
            /* ignore */
          }
        });
        btn.dataset.boundClick = 'true';
      });
    } catch (_) {
      /* ignore DOM wiring errors */
    }
  }

  setupDiceLogControls() {
    try {
      const clearBtn = document.querySelector('#dice-log-panel .panel-footer .clear-button');
      if (clearBtn && !clearBtn.dataset.boundClick) {
        clearBtn.addEventListener('click', () => this.clearDiceLog());
        clearBtn.dataset.boundClick = 'true';
      }
    } catch (_) {
      /* ignore */
    }
  }

  /**
   * Wire range/slider controls such as grid opacity, animation speed, and shading controls.
   * Defensive: checks for element presence and avoids throwing.
   */
  setupRangeSliderListeners() {
    try {
      // Grid opacity
      const { slider: gridSlider } = getGridOpacityControl() || {};
      if (gridSlider && !gridSlider.dataset.boundInput) {
        gridSlider.addEventListener('input', () => {
          const v = Number(gridSlider.value);
          if (!Number.isFinite(v)) return;
          try {
            this.onGridOpacityChange(v);
          } catch (_) {
            /* ignore */
          }
        });
        gridSlider.dataset.boundInput = 'true';
      }

      // Animation speed
      const { slider: animSlider } = getAnimationSpeedControl() || {};
      if (animSlider && !animSlider.dataset.boundInput) {
        animSlider.addEventListener('input', () => {
          const v = Number(animSlider.value);
          if (!Number.isFinite(v)) return;
          try {
            this.onAnimationSpeedChange(v);
          } catch (_) {
            /* ignore */
          }
        });
        animSlider.dataset.boundInput = 'true';
      }

      // Rich shading controls (intensity/density/shore/perf)
      try {
        const { shadeToggle, intensity, density, shore, perf } = getShadingControls();
        if (shadeToggle && !shadeToggle.dataset.boundChange) {
          shadeToggle.addEventListener('change', () => {
            if (!window.richShadingSettings) window.richShadingSettings = {};
            window.richShadingSettings.enabled = !!shadeToggle.checked;
            try {
              window.gameManager?.terrainCoordinator?.setRichShadingEnabled?.(
                !!shadeToggle.checked
              );
            } catch (_) {
              /* ignore */
            }
          });
          shadeToggle.dataset.boundChange = 'true';
        }
        if (intensity && !intensity.dataset.boundInput) {
          intensity.addEventListener('input', () => {
            const pct = Number(intensity.value);
            if (!Number.isFinite(pct)) return;
            if (!window.richShadingSettings) window.richShadingSettings = {};
            window.richShadingSettings.intensity = pct / 100;
          });
          intensity.dataset.boundInput = 'true';
        }
        if (density && !density.dataset.boundInput) {
          density.addEventListener('input', () => {
            const pct = Number(density.value);
            if (!Number.isFinite(pct)) return;
            if (!window.richShadingSettings) window.richShadingSettings = {};
            window.richShadingSettings.density = pct / 100;
          });
          density.dataset.boundInput = 'true';
        }
        if (shore && !shore.dataset.boundInput) {
          shore.addEventListener('input', () => {
            const pct = Number(shore.value);
            if (!Number.isFinite(pct)) return;
            if (!window.richShadingSettings) window.richShadingSettings = {};
            window.richShadingSettings.shorelineSandStrength = pct / 100;
          });
          shore.dataset.boundInput = 'true';
        }
        if (perf && !perf.dataset.boundChange) {
          perf.addEventListener('change', () => {
            if (!window.richShadingSettings) window.richShadingSettings = {};
            window.richShadingSettings.performance = !!perf.checked;
          });
          perf.dataset.boundChange = 'true';
        }
      } catch (_) {
        /* ignore shading wiring */
      }
    } catch (_) {
      /* ignore overall */
    }
  }

  /**
   * Show a specific tab and hide others
   * @param {string} tabId - The ID of the tab to show
   */
  showTab(tabId) {
    // Validate tab ID
    const validTabs = ['dice-log', 'creatures', 'terrain', 'biomes', 'settings'];
    if (!validTabs.includes(tabId)) {
      logger.debug('Invalid tab ID', { tabId }, LOG_CATEGORY.UI);
      return;
    }

    // Update active tab
    this.activeTab = tabId;

    // Update tab button states
    const tabButtons = this._getTabButtons();
    tabButtons.forEach((button) => {
      const isActive = button.getAttribute('data-tab') === tabId;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-selected', isActive);
    });

    // Update tab panel visibility
    const tabPanels = this._getTabPanels();
    tabPanels.forEach((panel) => {
      const isActive = panel.id === `${tabId}-panel`;
      panel.classList.toggle('active', isActive);
    });

    // Trigger any tab-specific initialization
    this.onTabChange(tabId);
  }

  /**
   * Handle tab change events
   * @param {string} tabId - The newly active tab ID
   */
  onTabChange(tabId) {
    switch (tabId) {
      case 'dice-log':
        this.refreshDiceLog();
        break;
      case 'creatures':
        // Ensure selected creature token is highlighted
        this.refreshCreatureSelection();
        break;
      case 'terrain':
        // Future: Initialize terrain tools
        this.buildTerrainPlaceablesMenuSafely();
        // Inform the coordinator that the placeables panel is visible so
        // input handlers will honor placeable selection and allow placement.
        try {
          window.gameManager?.terrainCoordinator?.setPlaceablesPanelVisible?.(true);
        } catch (_) {
          /* ignore */
        }
        break;
      case 'biomes':
        this.buildBiomeMenuSafely();
        this._wireGenerateMapButton();
        // Ensure control defaults reflect current settings when switching tabs
        this._syncRichShadingControlsFromState();
        break;
      case 'settings':
        // Future: Load current game settings
        break;
      default:
        break;
    }
    // If switching away from the terrain tab, ensure the coordinator knows the
    // placeables panel is no longer visible so placement is blocked when the
    // UI isn't showing the placeables panel.
    try {
      if (tabId !== 'terrain') {
        window.gameManager?.terrainCoordinator?.setPlaceablesPanelVisible?.(false);
      }
    } catch (_) {
      /* ignore */
    }
  }

  buildTerrainPlaceablesMenuSafely() {
    try {
      // Avoid rebuilding if already populated
      if (this._placeablesBuilt) return;
      const root = getTerrainPlaceablesRoot();
      if (!root) return; // nothing to do in minimal/test env

      // Wire collapsible header controls if present
      try {
        const header = document.getElementById('placeables-collapse-header');
        const btn = document.getElementById('placeables-collapse-btn');
        if (header && btn && !btn.dataset.boundToggle) {
          const toggle = () => {
            const expanded = header.getAttribute('aria-expanded') === 'true';
            const next = !expanded;
            header.setAttribute('aria-expanded', String(next));
            root.style.display = next ? '' : 'none';
            btn.textContent = next ? '▾' : '▸';
            // Inform coordinator about panel visibility for placement logic
            try {
              window.gameManager?.terrainCoordinator?.setPlaceablesPanelVisible?.(next);
            } catch (_) {
              /* ignore */
            }
          };
          header.addEventListener('click', (e) => {
            e.stopPropagation();
            toggle();
          });
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggle();
          });
          btn.dataset.boundToggle = 'true';
        }
      } catch (_) {
        /* ignore collapse wiring errors */
      }

      // Wire placeable removal toggle (mutually exclusive with placeable selection)
      try {
        const removalToggle = document.getElementById('placeable-removal-toggle');
        if (removalToggle && !removalToggle.dataset.boundChange) {
          removalToggle.addEventListener('change', () => {
            const enabled = !!removalToggle.checked;
            try {
              window.gameManager?.terrainCoordinator?.setPlaceableRemovalMode?.(enabled);
            } catch (_) {
              /* ignore */
            }
            if (enabled) {
              // Clear any global fallback selection
              window.selectedTerrainPlaceable = null;
              try {
                // Visually clear selected button highlight
                const rootEl = getTerrainPlaceablesRoot();
                rootEl
                  ?.querySelectorAll?.('.placeable-btn.selected')
                  ?.forEach((b) => b.classList.remove('selected'));
              } catch (_) {
                /* ignore */
              }
            }
          });
          removalToggle.dataset.boundChange = 'true';
        }
      } catch (_) {
        /* ignore placeable removal toggle wiring errors */
      }

      // Lazy import of placeables config to avoid early coupling
      import('../config/TerrainPlaceables.js')
        .then((mod) => {
          const { TERRAIN_PLACEABLES } = mod;
          if (!TERRAIN_PLACEABLES) return;
          // Clear root
          root.textContent = '';

          // Build group header
          const header = document.createElement('div');
          header.className = 'placeables-header';
          header.textContent = 'Placeable Plants';
          root.appendChild(header);

          // For each placeable that looks like a tree (key prefix 'tree-'), create a button
          // Mapping from placeable id -> canonical 3D model key (fall back to legacy translation if missing)
          const modelKeyMap = {
            'tree-green-deciduous': 'common-broadleaf-1',
            'tree-green-conifer': 'pine-conifer-1',
            'tree-green-willow': 'common-broadleaf-4',
            'tree-green-oval': 'common-broadleaf-2',
            'tree-green-columnar': 'pine-conifer-2',
            'tree-green-small': 'pine-conifer-4',
            'tree-green-small-oval': 'pine-conifer-5',
            'tree-green-tall-columnar': 'pine-conifer-3',
            'tree-orange-deciduous': 'common-broadleaf-3',
            'tree-yellow-willow': 'common-broadleaf-5',
            'tree-yellow-conifer': 'pine-conifer-5',
            'tree-yellow-conifer-alt': 'twisted-bare-2',
            'tree-bare-deciduous': 'twisted-bare-1',
          };

          // Simple offscreen thumbnail generator with caching
          const _thumbCache = {};
          async function generateModelThumbnail(modelKey) {
            if (_thumbCache[modelKey]) return _thumbCache[modelKey];
            try {
              // Lazy-load ModelAssetCache
              const modCache = await import('../core/ModelAssetCache.js');
              const MC = modCache.ModelAssetCache || modCache.default;
              if (!MC) throw new Error('ModelAssetCache missing');
              if (!window.__uiModelCache) window.__uiModelCache = new MC();
              const cache = window.__uiModelCache;
              const rootObj = await cache.getModel(modelKey);
              if (!rootObj) throw new Error('No model for ' + modelKey);
              // Create an offscreen renderer & scene
              const threeMod = cache._three || (await cache._ensureThreeAndLoader());
              const scene = new threeMod.Scene();
              const cam = new threeMod.PerspectiveCamera(35, 1, 0.1, 100);
              const box = new threeMod.Box3().setFromObject(rootObj);
              const size = new threeMod.Vector3();
              box.getSize(size);
              const center = new threeMod.Vector3();
              box.getCenter(center);
              const maxDim = Math.max(size.x, size.y, size.z);
              const dist = (maxDim * 1.6) / Math.tan((Math.PI * cam.fov) / 360);
              cam.position.set(center.x + dist * 0.6, center.y + dist * 0.8, center.z + dist * 0.6);
              cam.lookAt(center);
              scene.add(rootObj);
              // Simple lighting
              scene.add(new threeMod.AmbientLight(0xffffff, 1.0));
              const dir = new threeMod.DirectionalLight(0xffffff, 0.9);
              dir.position.set(10, 20, 10);
              scene.add(dir);
              const renderer = new threeMod.WebGLRenderer({ antialias: true, alpha: true });
              renderer.setSize(96, 96); // small square thumbnail
              renderer.outputColorSpace = threeMod.SRGBColorSpace || renderer.outputColorSpace;
              renderer.render(scene, cam);
              const dataUrl = renderer.domElement.toDataURL('image/png');
              _thumbCache[modelKey] = dataUrl;
              // Clean up heavy objects (keep rootObj cached internally by ModelAssetCache anyway)
              renderer.dispose();
              return dataUrl;
            } catch (err) {
              console.warn('[Sidebar] 3D thumbnail generation failed', modelKey, err);
              return null;
            }
          }

          Object.keys(TERRAIN_PLACEABLES)
            .filter((k) => k.startsWith('tree-'))
            .forEach((key) => {
              const def = TERRAIN_PLACEABLES[key];
              const modelKey = modelKeyMap[key];
              // Placeholder image (will be replaced asynchronously if modelKey found)
              const placeholder = Array.isArray(def.img) ? def.img[0] : def.img;
              const btn = createPlaceableButton(key, def.label || key, placeholder);
              if (modelKey) {
                // Mark while loading
                btn.classList.add('loading-3d-thumb');
                generateModelThumbnail(modelKey).then((url) => {
                  try {
                    if (url) {
                      const imgEl = btn.querySelector('img.placeable-preview');
                      if (imgEl) imgEl.src = url;
                      btn.classList.remove('loading-3d-thumb');
                      btn.classList.add('thumb-3d-generated');
                    } else {
                      btn.classList.remove('loading-3d-thumb');
                      btn.classList.add('thumb-3d-failed');
                    }
                  } catch (_) {
                    /* ignore UI update errors */
                  }
                });
              }

              // Select action: mark coordinator selected placeable so InputHandlers will paint
              btn.addEventListener('click', () => {
                try {
                  // Suppress selection if removal mode active
                  try {
                    if (window.gameManager?.terrainCoordinator?.isPlaceableRemovalMode?.()) {
                      return;
                    }
                  } catch (_) {
                    /* ignore */
                  }
                  // Toggle selection
                  const currently =
                    window.gameManager &&
                    window.gameManager.terrainCoordinator &&
                    typeof window.gameManager.terrainCoordinator.getSelectedPlaceable === 'function'
                      ? window.gameManager.terrainCoordinator.getSelectedPlaceable()
                      : window.selectedTerrainPlaceable || null;
                  const toSet = currently === key ? null : key;
                  // Respect coordinator API but note it was inert in older builds; set global fallback too
                  try {
                    if (
                      window.gameManager &&
                      window.gameManager.terrainCoordinator &&
                      typeof window.gameManager.terrainCoordinator.setSelectedPlaceable ===
                        'function'
                    ) {
                      window.gameManager.terrainCoordinator.setSelectedPlaceable(toSet);
                      // Ensure the coordinator believes the placeables panel is visible while selecting
                      try {
                        window.gameManager.terrainCoordinator.setPlaceablesPanelVisible(true);
                      } catch (_) {
                        /* ignore */
                      }
                    }
                  } catch (_) {
                    /* ignore selection errors */
                  }
                  window.selectedTerrainPlaceable = toSet;
                  // Visual state
                  root
                    .querySelectorAll('.placeable-btn')
                    .forEach((b) => b.classList.remove('selected'));
                  if (toSet) btn.classList.add('selected');
                } catch (_) {
                  /* ignore */
                }
              });

              // Variant cycle control (small button next to each placeable) - cycles variants in place-mode
              const cycle = document.createElement('button');
              cycle.type = 'button';
              cycle.className = 'placeable-cycle-btn';
              cycle.title = 'Cycle variant';
              cycle.textContent = '🔁';
              cycle.addEventListener('click', (ev) => {
                ev.stopPropagation();
                try {
                  // If there's a visible selection on the map, use coordinator to cycle at last hover or centered pos
                  // Best-effort: use lastGridCoords from input handlers if available
                  const last =
                    window.gameManager?.terrainCoordinator?._inputHandlers?.lastGridCoords || null;
                  const x = last?.x ?? Math.floor((window.gameManager?.cols || 10) / 2);
                  const y = last?.y ?? Math.floor((window.gameManager?.rows || 10) / 2);
                  try {
                    window.gameManager?.terrainManager?.cyclePlaceableVariant(x, y, key);
                  } catch (_) {
                    // fallback to directly calling internals if exposed
                    try {
                      // When removal mode toggles, disable/enable placeable selection/cycle buttons visually
                      try {
                        const removalToggle = document.getElementById('placeable-removal-toggle');
                        if (removalToggle && !removalToggle.dataset.boundDisableSync) {
                          const syncDisabled = () => {
                            const disabled = !!removalToggle.checked;
                            root
                              .querySelectorAll('.placeable-btn, .placeable-cycle-btn')
                              .forEach((b) => {
                                b.disabled = disabled;
                                b.classList.toggle('disabled', disabled);
                              });
                          };
                          removalToggle.addEventListener('change', syncDisabled);
                          syncDisabled();
                          removalToggle.dataset.boundDisableSync = 'true';
                        }
                      } catch (_) {
                        /* ignore */
                      }
                      import('../managers/terrain-manager/internals/placeables.js').then((m) => {
                        m.cyclePlaceableVariant(window.gameManager.terrainManager, x, y, key);
                      });
                    } catch (_) {
                      void 0;
                    }
                  }
                } catch (_) {
                  void 0;
                }
              });

              const wrapper = document.createElement('div');
              wrapper.className = 'placeable-entry';
              wrapper.appendChild(btn);
              wrapper.appendChild(cycle);
              root.appendChild(wrapper);
            });

          this._placeablesBuilt = true;
        })
        .catch((err) => {
          /* noop: sidebar continues without placeables */ void err;
        });
    } catch (_) {
      /* swallow errors to avoid breaking sidebar */
    }
  }

  _wireGenerateMapButton() {
    try {
      const btn = document.getElementById('generate-map');
      const lock = document.getElementById('biome-seed-lock');
      const reseed = document.getElementById('biome-reseed');
      if (btn && !btn.dataset.boundClick) {
        btn.addEventListener('click', async () => {
          const biome = window.selectedBiome;
          if (!biome) return; // require a selection
          try {
            // Clear existing instanced placeables so old trees do not persist into new map
            try {
              if (window.gameManager?.placeableMeshPool?.clearAll) {
                window.gameManager.placeableMeshPool.clearAll();
              }
            } catch (_) {
              /* ignore clear failure */
            }
            // Guard: prevent re-entry if generation is already running
            if (
              !window.gameManager?.terrainCoordinator ||
              window.gameManager.terrainCoordinator._isGenerating
            )
              return;
            // Disable button to prevent spamming
            try {
              btn.disabled = true;
              btn.classList.add('disabled');
            } catch (_) {
              /* ignore */
            }
            if (lock && !lock.checked) {
              const newSeed = Math.floor(Math.random() * 0xffffffff) >>> 0;
              try {
                window.gameManager?.terrainCoordinator?.setBiomeSeed?.(newSeed);
              } catch (_) {
                /* ignore */
              }
            }
            let ok = false;
            try {
              ok = await window.gameManager?.terrainCoordinator?.generateBiomeElevation?.(biome);
            } catch (_) {
              /* ignore */
            }
            try {
              if (ok && window.gameManager?.terrainCoordinator?.applyBiomePaletteToBaseGrid) {
                window.gameManager.terrainCoordinator.applyBiomePaletteToBaseGrid();
              }
            } catch (_) {
              /* ignore */
            }
          } catch (_) {
            /* ignore */
          } finally {
            // Re-enable button after generation cycle ends
            try {
              btn.disabled = false;
              btn.classList.remove('disabled');
            } catch (_) {
              /* ignore */
            }
          }
        });
        btn.dataset.boundClick = 'true';
      }
      if (lock && !lock.dataset.boundChange) {
        // reflect current locked state from global settings if present
        try {
          const s = window.richShadingSettings || {};
          if (typeof s.lockSeed === 'boolean') lock.checked = !!s.lockSeed;
        } catch (_) {
          /* ignore */
        }
        lock.addEventListener('change', () => {
          if (!window.richShadingSettings) window.richShadingSettings = {};
          window.richShadingSettings.lockSeed = !!lock.checked;
        });
        lock.dataset.boundChange = 'true';
      }
      if (reseed && !reseed.dataset.boundClick) {
        reseed.addEventListener('click', () => {
          if (!window.gameManager?.terrainCoordinator) return;
          const newSeed = Math.floor(Math.random() * 0xffffffff) >>> 0;
          try {
            window.gameManager?.terrainCoordinator?.setBiomeSeed?.(newSeed);
          } catch (_) {
            /* ignore */
          }
          // If a biome is currently selected and outside terrain mode, repaint palette-only
          try {
            window.gameManager?.terrainCoordinator?.applyBiomePaletteToBaseGrid?.();
          } catch (_) {
            /* ignore */
          }
        });
        reseed.dataset.boundClick = 'true';
      }
    } catch (_) {
      /* ignore */
    }
  }

  _syncRichShadingControlsFromState() {
    try {
      const s = window.richShadingSettings || {};
      const { shadeToggle, intensity, intensityVal, density, densityVal, shore, shoreVal, perf } =
        getShadingControls();
      if (shadeToggle) shadeToggle.checked = !!s.enabled;
      if (intensity && intensityVal && Number.isFinite(s.intensity)) {
        const pct = Math.round(s.intensity * 100);
        intensity.value = String(pct);
        intensityVal.textContent = `${pct}%`;
      }
      if (density && densityVal && Number.isFinite(s.density)) {
        const pct = Math.round(s.density * 100);
        density.value = String(pct);
        densityVal.textContent = `${pct}%`;
      }
      if (shore && shoreVal && Number.isFinite(s.shorelineSandStrength)) {
        const pct = Math.round(s.shorelineSandStrength * 100);
        shore.value = String(pct);
        shoreVal.textContent = `${pct}%`;
      }
      if (perf) perf.checked = !!s.performance;
    } catch (_) {
      /* ignore */
    }
  }

  _refreshTerrainOverlayIfActive() {
    try {
      const gm = window.gameManager;
      if (gm?.terrainCoordinator?.isTerrainModeActive && gm?.terrainCoordinator?.terrainManager) {
        gm.terrainCoordinator.terrainManager.refreshAllTerrainDisplay();
      } else if (gm?.terrainCoordinator && !gm.terrainCoordinator.isTerrainModeActive) {
        // Outside edit mode: only repaint the biome canvas if shading is enabled.
        const enabled = !!window.richShadingSettings?.enabled;
        if (enabled) {
          if (typeof gm.terrainCoordinator.applyBiomePaletteToBaseGrid === 'function') {
            gm.terrainCoordinator.applyBiomePaletteToBaseGrid();
          } else {
            /* applyBiomePaletteToBaseGrid not present (older build) */
          }
        } else {
          // If disabled, ensure painter is cleared and base tiles are visible
          if (typeof gm.terrainCoordinator.setRichShadingEnabled === 'function') {
            gm.terrainCoordinator.setRichShadingEnabled(false);
          } else {
            try {
              gm.terrainCoordinator._toggleBaseTileVisibility?.(true);
            } catch (_) {
              /* ignore refresh error */
            }
          }
        }
      }
    } catch (_) {
      /* non-fatal */
    }
  }

  buildBiomeMenuSafely() {
    try {
      const root = getBiomeRootEl();
      // If previously built but root is missing or empty (e.g., moved to new tab), allow rebuild
      if (this._biomesBuilt) {
        if (!root || root.children.length === 0) {
          this._biomesBuilt = false; // reset flag to trigger rebuild
        } else {
          return; // already populated
        }
      }
      // Lazy import to avoid blocking initial load
      import('../config/BiomeConstants.js')
        .then((mod) => {
          const { BIOME_GROUPS } = mod;
          if (!root) return;
          root.textContent = '';

          // (Color mode selector removed: single unified palette mode)

          Object.entries(BIOME_GROUPS).forEach(([group, list]) => {
            const groupContainer = document.createElement('div');
            groupContainer.className = 'biome-group';

            const headerBtn = document.createElement('button');
            headerBtn.className = 'biome-group-toggle';
            headerBtn.type = 'button';
            headerBtn.setAttribute('aria-expanded', 'false');
            headerBtn.textContent = group;

            const listEl = document.createElement('div');
            listEl.className = 'biome-group-list';
            listEl.style.display = 'none';

            headerBtn.addEventListener('click', () => {
              const expanded = headerBtn.getAttribute('aria-expanded') === 'true';
              headerBtn.setAttribute('aria-expanded', String(!expanded));
              listEl.style.display = expanded ? 'none' : 'grid';
            });

            list.forEach((b) => {
              const bBtn = document.createElement('button');
              bBtn.className = 'biome-btn';
              bBtn.type = 'button';
              bBtn.dataset.biome = b.key;
              bBtn.title = b.label;
              bBtn.textContent = (b.emoji || '') + ' ' + b.label;
              bBtn.addEventListener('click', () => this.selectBiome(b.key));
              listEl.appendChild(bBtn);
            });

            groupContainer.appendChild(headerBtn);
            groupContainer.appendChild(listEl);
            root.appendChild(groupContainer);
          });
          this._biomesBuilt = true;
          // Re-apply selected biome highlight if one was chosen earlier
          if (window.selectedBiome) {
            try {
              this.selectBiome(window.selectedBiome);
            } catch (_) {
              /* ignore */
            }
          }
        })
        .catch((err) => {
          /* noop: biome menu can be built later */ void err;
        });
    } catch (_) {
      /* swallow to avoid UI disruption */
    }
  }

  selectBiome(biomeKey) {
    window.selectedBiome = biomeKey;
    if (window.sidebarController?.activeTab === 'terrain') {
      logger.debug('Biome selected', { biomeKey }, LOG_CATEGORY.UI);
    }
    // If game manager exists and terrain mode is OFF, apply palette only (no auto-generation here)
    try {
      if (
        window.gameManager &&
        window.gameManager.terrainCoordinator &&
        !window.gameManager.terrainCoordinator.isTerrainModeActive
      ) {
        window.gameManager.terrainCoordinator.applyBiomePaletteToBaseGrid();
      }
    } catch (_) {
      /* non-fatal */
    }
    // Visual selection state
    try {
      const root = getBiomeRootEl();
      if (root) {
        getBiomeButtons(root).forEach((btn) => btn.classList.remove('selected'));
        const newly = getBiomeButtonByKey(biomeKey, root);
        if (newly) {
          newly.classList.add('selected');
          newly.setAttribute('aria-pressed', 'true');
        }
      }
    } catch (_) {
      /* silent */
    }
  }

  /**
   * Add an entry to the dice log
   * @param {string} message - The log message
   * @param {string} type - The type of log entry ('roll', 'system', etc.)
   */
  addDiceLogEntry(message, type = 'roll') {
    const timestamp = new Date().toLocaleTimeString();
    const entry = {
      message,
      type,
      timestamp,
      id: Date.now() + Math.random(), // Simple unique ID
    };

    // Add to beginning of array (newest first)
    this.diceLogEntries.unshift(entry);

    // Limit log size to prevent memory issues
    if (this.diceLogEntries.length > this.maxLogEntries) {
      this.diceLogEntries = this.diceLogEntries.slice(0, this.maxLogEntries);
    }

    // Update display if dice log tab is active
    if (this.activeTab === 'dice-log') {
      this.refreshDiceLog();
    }
  }

  /**
   * Refresh the dice log display
   */
  refreshDiceLog() {
    const logContent = getDiceLogContentEl();
    if (!logContent) return;

    // Clear existing content securely
    while (logContent.firstChild) {
      logContent.removeChild(logContent.firstChild);
    }

    if (this.diceLogEntries.length === 0) {
      const emptyEntry = document.createElement('div');
      emptyEntry.className = 'dice-log-entry';
      emptyEntry.textContent = 'No dice rolls yet. Roll some dice!';
      logContent.appendChild(emptyEntry);
      return;
    }

    // Create DOM elements securely to prevent XSS
    this.diceLogEntries.forEach((entry, index) => {
      const isRecent = index < 3; // Mark first 3 entries as recent

      const entryDiv = document.createElement('div');
      entryDiv.className = `dice-log-entry${isRecent ? ' recent' : ''}`;

      const timeSpan = document.createElement('span');
      timeSpan.className = 'log-time';
      timeSpan.textContent = `[${entry.timestamp}]`;

      const messageSpan = document.createElement('span');
      messageSpan.className = 'log-message';
      messageSpan.textContent = entry.message;

      entryDiv.appendChild(timeSpan);
      entryDiv.appendChild(messageSpan);
      logContent.appendChild(entryDiv);
    });

    // Auto-scroll to top to show newest entries
    logContent.scrollTop = 0;
  }

  /**
   * Clear the dice log
   */
  clearDiceLog() {
    this.diceLogEntries = [];
    this.addDiceLogEntry('Dice log cleared.', 'system');
  }

  /**
   * Refresh creature token selection highlighting
   * Should be called whenever a token is selected to update the UI
   */
  refreshCreatureSelection() {
    // Get the currently selected token from GameManager or fallback to window
    let selectedToken;
    if (window.gameManager && window.gameManager.selectedTokenType !== undefined) {
      selectedToken = window.gameManager.selectedTokenType;
    } else {
      selectedToken = window.selectedTokenType;
    }

    if (!selectedToken) return;

    // Clear all selections first
    // DRY: use shared helper
    const allTokenButtons = getCreatureButtons();
    allTokenButtons.forEach((btn) => {
      btn.classList.remove('selected');
      btn.setAttribute('aria-pressed', 'false');
    });

    // Highlight the selected token
    const selectedButton = getTokenButtonByType(selectedToken);
    if (selectedButton) {
      selectedButton.classList.add('selected');
      selectedButton.setAttribute('aria-pressed', 'true');
    }
  }

  /**
   * Update token selection (called by external systems)
   * @param {string} tokenType - The type of token that was selected
   */
  updateTokenSelection(tokenType) {
    // Use proper GameManager setter instead of direct window manipulation
    if (window.gameManager && window.gameManager.selectedTokenType !== undefined) {
      window.gameManager.selectedTokenType = tokenType;
    } else {
      // Fallback for backward compatibility
      window.selectedTokenType = tokenType;
    }
    this.refreshCreatureSelection();
  }

  /**
   * Handle grid opacity change
   * @param {number} opacity - Opacity value from 0 to 1
   */
  onGridOpacityChange(opacity) {
    // Integrate with GameManager to change grid opacity
    if (window.gameManager && window.gameManager.gridContainer) {
      // Apply opacity to grid tiles while preserving token visibility
      window.gameManager.gridContainer.children.forEach((child) => {
        if (child.isGridTile) {
          child.alpha = opacity;
        }
      });
    } else {
      logger.debug('GameManager not available for grid opacity change', {}, LOG_CATEGORY.UI);
    }
  }

  /**
   * Handle animation speed change
   * @param {number} speed - Speed multiplier
   */
  onAnimationSpeedChange(speed) {
    // Integrate with GameManager to change animation speed
    if (window.gameManager && window.gameManager.app) {
      // Store animation speed in app for use by animation systems
      window.gameManager.app.animationSpeedMultiplier = speed;

      // Update any existing PIXI ticker speed if available
      if (window.gameManager.app.ticker) {
        window.gameManager.app.ticker.speed = speed;
      }
    } else {
      logger.debug('GameManager not available for animation speed change', {}, LOG_CATEGORY.UI);
    }
  }
}

// No inline HTML handlers needed; events are delegated in setup

// Create and expose global instance
window.sidebarController = new SidebarController();

export default SidebarController;
