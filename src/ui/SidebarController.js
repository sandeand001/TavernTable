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
  getVisualGridToggle,
  getSunTimeControl,
  getBiomeButtons,
  getBiomeButtonByKey,
  getTreeDensityControls,
  getTerrainPlaceablesRoot,
  getTerrainModeEls,
} from './dom-helpers.js';

import { logger, LOG_CATEGORY } from '../utils/logger/Logger.js';
import CompendiumSidebar from './characters/CompendiumSidebar.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../utils/error/ErrorHandler.js';
import { copyRollSummary } from '../systems/dice/rollSummary.js';
import { rollSummaryMarkup } from './dice/rollSummary.js';
import { replaceCampaignBiome } from '../campaigns/CampaignBiomeGeneration.js';
import { cavernNetworkDefaults } from '../campaigns/CampaignLogicalPassages.js';
import { attachPanelToggles, setPanelCollapsed } from './controls/PanelVisibilityControls.js';
import { openBiomeGenerationReview } from './terrain/BiomeGenerationReview.js';
import {
  BIOME_REPLACEMENT_WARNING_KEY,
  confirmBiomeReplacement,
  replacementWarningEnabled,
  setReplacementWarningEnabled,
} from './terrain/BiomeReplacementConfirmation.js';
import {
  getBiomeGenerationFamily,
  getBiomeGenerationVariant,
} from '../config/biome/BiomeGenerationFamilies.js';
import { isAssetAllowedInBiome } from '../config/assets/BiomeAssetMatrix.js';
import { PURE_POLY_ASSETS } from '../config/assets/PurePolyAssets.js';
import { chooseDifferentDungeonSeed } from '../terrain/generation/DungeonLayouts.js';

const PROTECTED_SCENERY_CHECK_TIMEOUT_MS = 10000;

async function verifyProtectedScenery(cache) {
  if (typeof cache?.verifyProtectedAssetAccess !== 'function')
    throw new Error('Protected scenery access is unavailable');
  let timeout;
  try {
    await Promise.race([
      cache.verifyProtectedAssetAccess(PURE_POLY_ASSETS[0].id),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('The protected scenery access check timed out')),
          PROTECTED_SCENERY_CHECK_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

class SidebarController {
  // ── Constructor ─────────────────────────────────────────────

  constructor() {
    this.activeTab = 'dice-log';
    this.diceLogEntries = [];
    this.maxLogEntries = 50;
    this._placeablesBuilt = false;
    this._biomesBuilt = false;
    this._lifecycle = 0;
    this._disposers = [];
    this.init();
    if (typeof window !== 'undefined')
      this._listen(window, 'taverntable:campaignViewStateChanged', () => {
        this._syncGenerationSelection();
        this._syncPlaceableSuitability();
      });
  }

  init() {
    attachPanelToggles();
    // Wire tab buttons
    try {
      const buttons = getTabButtons();
      const panels = getTabPanels();
      buttons.forEach((btn) => {
        if (!btn.dataset.boundClick) {
          this._listen(
            btn,
            'click',
            () => {
              const tabId = btn.getAttribute('data-tab');
              this.switchTab(tabId);
            },
            { boundKey: 'boundClick' }
          );
        }
      });
      // Activate initial tab
      this.switchTab(this.activeTab, { reveal: false });
      // Grid controls
      const { slider: gridOpacitySlider, valueEl: gridOpacityValue } = getGridOpacityControl();
      if (gridOpacitySlider && !gridOpacitySlider.dataset.boundChange) {
        const applyGridOpacity = () => {
          const raw = Number(gridOpacitySlider.value);
          if (!Number.isFinite(raw)) return;
          this.onGridOpacityChange(raw / 100);
          if (gridOpacityValue) gridOpacityValue.textContent = `${Math.round(raw)}%`;
        };
        this._listen(gridOpacitySlider, 'input', applyGridOpacity, { boundKey: 'boundChange' });
        this._listen(gridOpacitySlider, 'change', applyGridOpacity);
        applyGridOpacity();
      }
      const { slider: sunTimeSlider, valueEl: sunTimeValue } = getSunTimeControl();
      if (sunTimeSlider && !sunTimeSlider.dataset.boundSunTime) {
        this._syncSunTimeSliderState(sunTimeSlider, sunTimeValue);
        this.onSunTimeChange(Number(sunTimeSlider.value), {
          immediate: true,
          skipNotify: true,
          skipPersist: true,
        });
        const applySunTime = () => {
          const raw = Number(sunTimeSlider.value);
          if (!Number.isFinite(raw)) return;
          if (sunTimeValue) sunTimeValue.textContent = this._formatMinutes(raw);
          this.onSunTimeChange(raw);
        };
        this._listen(sunTimeSlider, 'input', applySunTime, { boundKey: 'boundSunTime' });
        this._listen(sunTimeSlider, 'change', applySunTime);
        if (typeof window !== 'undefined') {
          this._listenGlobal(
            '__TT_SUN_TIME_LISTENERS__',
            (mins) => this._syncSunTimeSliderState(sunTimeSlider, sunTimeValue, mins),
            sunTimeSlider,
            'sunTimeListenerBound'
          );
        }
      }
      const visualGridToggle = getVisualGridToggle();
      if (visualGridToggle && !visualGridToggle.dataset.boundChange) {
        this._syncVisualGridToggleState(visualGridToggle);
        this._listen(
          visualGridToggle,
          'change',
          () => {
            this.onVisualGridVisibilityChange(visualGridToggle.checked);
          },
          { boundKey: 'boundChange' }
        );
        if (typeof window !== 'undefined') {
          this._listenGlobal(
            '__TT_GRID_VISIBILITY_LISTENERS__',
            (visible) => this._syncVisualGridToggleState(visualGridToggle, visible),
            visualGridToggle,
            'gridListenerBound'
          );
        }
      }
      // Panels (show/hide by class)
      panels.forEach((p) => p.classList.remove('active'));
    } catch (_) {
      /* ignore init errors */
    }
  }

  // ── Public API ──────────────────────────────────────────────

  _listen(target, type, listener, { boundKey = null } = {}) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, listener);
    if (boundKey) target.dataset[boundKey] = 'true';
    this._disposers.push(() => {
      target.removeEventListener(type, listener);
      if (boundKey) delete target.dataset[boundKey];
    });
  }

  _listenGlobal(name, listener, target, boundKey) {
    if (target.dataset[boundKey]) return;
    const listeners = window[name] || (window[name] = []);
    listeners.push(listener);
    target.dataset[boundKey] = 'true';
    this._disposers.push(() => {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
      delete target.dataset[boundKey];
    });
  }

  dispose() {
    this.compendiumSidebar?.destroy();
    this.compendiumSidebar = null;
    for (const dispose of this._disposers.splice(0).reverse()) dispose();
    this._placeablesBuilt = false;
    this._biomesBuilt = false;
    this._lifecycle++;
  }

  switchTab(tabId, { reveal = true } = {}) {
    const sidebar = document.getElementById('right-sidebar');
    if (reveal && sidebar?.hasAttribute('data-collapsible-panel')) {
      setPanelCollapsed(sidebar, false);
    }
    this.activeTab = tabId;
    try {
      const buttons = getTabButtons();
      const panels = getTabPanels();
      buttons.forEach((b) => {
        const selected = b.getAttribute('data-tab') === tabId;
        b.classList.toggle('active', selected);
        b.setAttribute('aria-selected', String(selected));
      });
      panels.forEach((p) => p.classList.toggle('active', p.id === `${tabId}-panel`));
    } catch (_) {
      /* ignore */
    }
    this.onTabChange(tabId);
  }

  openCompendium(entryId = null) {
    this.pendingCompendiumEntry = entryId;
    this.switchTab('compendium');
    return this.compendiumReady;
  }

  _showCompendium(entryId) {
    const host = document.getElementById('compendium-panel');
    try {
      const gameManager = window.gameManager;
      if (!host || !gameManager) throw new Error('The game is not ready to open the compendium');
      if (this.compendiumSidebar?.gameManager !== gameManager) {
        this.compendiumSidebar?.destroy();
        host.replaceChildren();
        this.compendiumSidebar = new CompendiumSidebar({ gameManager }).attach(host);
      }
      return this.compendiumSidebar.open(entryId);
    } catch (error) {
      if (host) host.textContent = `${error.message}. Select the Compendium tab to retry.`;
      new ErrorHandler().handle(error, ERROR_SEVERITY.WARNING, ERROR_CATEGORY.UI, {
        component: 'SidebarController',
        operation: 'openCompendium',
      });
      return Promise.resolve(false);
    }
  }

  // ── Event Handlers ──────────────────────────────────────────

  onTabChange(tabId) {
    if (tabId === 'dice-log') this.refreshDiceLog();
    else if (tabId === 'creatures') this.refreshCreatureSelection();
    else if (tabId === 'compendium') {
      this.compendiumReady = this._showCompendium(this.pendingCompendiumEntry);
      this.pendingCompendiumEntry = null;
    } else if (tabId === 'terrain') {
      this.buildTerrainPlaceablesMenuSafely();
      try {
        window.gameManager?.terrainEngine?.setPlaceablesPanelVisible?.(true);
      } catch (_) {
        /* ignore */
      }
    } else if (tabId === 'biomes') {
      this.buildBiomeMenuSafely();
      this._wireGenerateMapButton();
      this._syncRichShadingControlsFromState();
    }
    if (tabId !== 'terrain') {
      try {
        window.gameManager?.terrainEngine?.setPlaceablesPanelVisible?.(false);
      } catch (_) {
        /* ignore */
      }
      this._ensureTerrainModeToggleOff();
    }
  }

  _ensureTerrainModeToggleOff() {
    try {
      const { toggleEl, toolsEl } = getTerrainModeEls();
      if (!toggleEl || !toggleEl.checked) return;

      toggleEl.checked = false;
      const handlerBound = toggleEl.dataset.boundChange === 'true';
      toggleEl.dispatchEvent(new Event('change', { bubbles: true }));

      if (!handlerBound) {
        if (toolsEl) toolsEl.style.display = 'none';
        try {
          window.gameManager?.disableTerrainMode?.();
          window.gameManager?.terrainEngine?.setPlaceableRemovalMode?.(false);
        } catch (_) {
          /* ignore */
        }
        const removalToggle = document.getElementById('placeable-removal-toggle');
        if (removalToggle) removalToggle.checked = false;
      }

      logger.debug(
        'Terrain mode auto-disabled via tab switch',
        { tabId: this.activeTab },
        LOG_CATEGORY.UI
      );
    } catch (error) {
      logger.debug(
        'Failed to auto-disable terrain mode',
        { error: error?.message },
        LOG_CATEGORY.UI
      );
    }
  }

  // ── Public API (Placeables) ───────────────────────────────

  buildTerrainPlaceablesMenuSafely() {
    if (this._placeablesBuilt) return; // Build only once per session; remove this if dynamic updates needed
    const lifecycle = this._lifecycle;
    const root = getTerrainPlaceablesRoot();
    if (!root) return;
    root.textContent = '';
    root.classList.add('placeables-unified-grid');

    // Lazy import to avoid cost until tab viewed
    import('../config/terrain/TerrainPlaceables.js')
      .then((mod) => {
        if (lifecycle !== this._lifecycle) return;
        const TERRAIN_PLACEABLES = mod.TERRAIN_PLACEABLES || mod.default || {};
        const entries = Object.entries(TERRAIN_PLACEABLES);
        if (!entries.length) return;

        // Buckets: match order requirement
        const buckets = [
          {
            key: 'trees',
            title: 'Trees',
            filter: ([id, def]) =>
              def.type === 'plant-family' ||
              def.treeModel === true ||
              /^family-/.test(id) ||
              /^tree-/i.test(id),
          },
          {
            key: 'tropical',
            title: 'Tropical Plants',
            filter: ([id, def]) =>
              /tropical/i.test(id) ||
              /tropical/i.test(def?.label || '') ||
              /tropical/i.test(def?.modelKey || ''),
          },
          {
            key: 'plants',
            title: 'Flowers & Plants',
            filter: ([id]) =>
              /flower|bush|plant/i.test(id) || /^pure-poly-(grass|cactus)-/.test(id),
          },
          {
            key: 'mushrooms',
            title: 'Mushrooms',
            filter: ([id]) => /mushroom/i.test(id),
          },
          {
            key: 'rocks',
            title: 'Rocks',
            filter: ([id]) => /rock|boulder|pebble/i.test(id),
          },
          {
            key: 'lighting',
            title: 'Light Sources',
            filter: ([id, def]) => id === 'source-dungeon-torch' || def.lightSource === true,
          },
          {
            key: 'source-representatives',
            title: 'Source Pack Representatives',
            filter: ([id]) => /^(?:source-|pure-poly-)/.test(id),
          },
        ];

        // Collect matched ids to compute remaining 'Other'
        const used = new Set();
        const bucketData = buckets.map((b) => {
          const list = entries.filter((entry) => {
            const id = entry[0];
            if (used.has(id)) return false;
            if (!b.filter(entry)) return false;
            used.add(id);
            return true;
          });
          return { ...b, list };
        });

        // Helper to build a button (family vs individual)
        const buildBtn = (id, def, bucketKey) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'placeable-btn';
          btn.dataset.placeable = id;
          btn.dataset.placeableBucket = bucketKey;
          if (def.protectedKeyId) btn.dataset.protectedKeyId = def.protectedKeyId;
          btn.title = def.label || id;
          if (def.type === 'plant-family') {
            btn.classList.add('no-thumb', 'plant-family');
            const span = document.createElement('span');
            span.className = 'placeable-label';
            span.textContent = def.label || id;
            btn.appendChild(span);
          } else {
            // Simple text-only button (thumbnails removed per new requirements)
            const span = document.createElement('span');
            span.className = 'placeable-label';
            span.textContent = def.label || id;
            btn.appendChild(span);
          }
          this._listen(btn, 'click', () => {
            if (window.gameManager?.terrainEngine?.isPlaceableRemovalMode?.()) return;
            const current = window.gameManager?.terrainEngine?.getSelectedPlaceable?.() || null;
            const next = current === id ? null : id;
            try {
              const engine = window.gameManager?.terrainEngine;
              if (!engine) throw new Error('Terrain editing is not ready yet');
              if (
                next &&
                def.protectedKeyId &&
                !window.gameManager?.modelAssetCache?.hasProtectedAssetKeyProvider?.()
              )
                throw new Error('Configure protected-asset access before placing this model');
              if (next && engine.biomeKey && !isAssetAllowedInBiome(id, engine.biomeKey))
                throw new Error(`"${def.label || id}" is not available in this biome`);
              engine.setSelectedPlaceable(next);
            } catch (e) {
              new ErrorHandler().handle(e, ERROR_SEVERITY.WARNING, ERROR_CATEGORY.INPUT, {
                context: 'selectTerrainPlaceable',
                placeableId: id,
              });
              return;
            }
            window.selectedTerrainPlaceable = next;
            root
              .querySelectorAll('.placeable-btn')
              .forEach((bEl) => bEl.classList.remove('selected'));
            if (next) btn.classList.add('selected');
          });
          return btn;
        };

        bucketData.forEach((bucket) => {
          if (!bucket.list.length) return;
          // Section header
          const hdr = document.createElement('div');
          hdr.className = 'placeables-section-header';
          hdr.dataset.placeableBucket = bucket.key;
          hdr.textContent = bucket.title;
          root.appendChild(hdr);
          // Sort alphabetically by label for consistency
          bucket.list
            .slice()
            .sort((a, b) => {
              const la = (a[1].label || a[0]).toLowerCase();
              const lb = (b[1].label || b[0]).toLowerCase();
              return la.localeCompare(lb);
            })
            .forEach(([id, def]) => root.appendChild(buildBtn(id, def, bucket.key)));
        });

        this._placeablesBuilt = true;
        this._syncPlaceableSuitability(root);
      })
      .catch(() => {
        /* ignore load error */
      });
  }

  _syncPlaceableSuitability(root = getTerrainPlaceablesRoot()) {
    if (!root) return;
    const biomeKey = window.gameManager?.terrainEngine?.biomeKey;
    const protectedAssetsAvailable =
      window.gameManager?.modelAssetCache?.hasProtectedAssetKeyProvider?.() === true;
    for (const button of root.querySelectorAll('.placeable-btn')) {
      const allowed =
        (!button.dataset.protectedKeyId || protectedAssetsAvailable) &&
        (!biomeKey || isAssetAllowedInBiome(button.dataset.placeable, biomeKey));
      button.hidden = !allowed;
      button.disabled = !allowed;
    }
    for (const header of root.querySelectorAll('.placeables-section-header')) {
      header.hidden = ![...root.querySelectorAll('.placeable-btn')].some(
        (button) =>
          button.dataset.placeableBucket === header.dataset.placeableBucket && !button.hidden
      );
    }
  }

  // ── DOM Helpers (Biomes) ───────────────────────────────────

  _wireGenerateMapButton() {
    const btn = document.getElementById('generate-map');
    const cycle = document.getElementById('dungeon-next-layout');
    const palette = document.getElementById('biome-apply-palette');
    const lock = document.getElementById('biome-seed-lock');
    const reseed = document.getElementById('biome-reseed');
    const structures = document.getElementById('biome-structures-toggle');
    const warning = document.getElementById('biome-replacement-warning');
    const syncWarning = () => {
      if (!warning) return;
      try {
        warning.checked = replacementWarningEnabled();
        warning.disabled = false;
      } catch (error) {
        warning.checked = true;
        warning.disabled = true;
        this._reportBiomeGenerationError(
          document.getElementById('biome-generation-status'),
          error,
          'replacementWarning'
        );
      }
    };
    syncWarning();
    if (warning && !warning.dataset.boundWarning) {
      this._listen(
        warning,
        'change',
        () => {
          try {
            setReplacementWarningEnabled(warning.checked);
          } catch (error) {
            warning.checked = !warning.checked;
            this._reportBiomeGenerationError(
              document.getElementById('biome-generation-status'),
              error,
              'replacementWarning'
            );
          }
        },
        { boundKey: 'boundWarning' }
      );
      this._listen(window, 'storage', (event) => {
        if (event.key === null || event.key === BIOME_REPLACEMENT_WARNING_KEY) syncWarning();
      });
    }
    if (structures && window.gameManager?.terrainEngine)
      structures.checked = window.gameManager.terrainEngine.structureGenerationEnabled;
    if (structures && !structures.dataset.boundStructures) {
      structures.checked = window.gameManager?.terrainEngine?.structureGenerationEnabled !== false;
      this._listen(
        structures,
        'change',
        () => {
          const engine = window.gameManager?.terrainEngine;
          try {
            if (!engine) throw new Error('Terrain generation is not ready yet');
            engine.setStructureGeneration(structures.checked);
            this._syncDungeonCycleControl();
          } catch (error) {
            if (engine) structures.checked = engine.structureGenerationEnabled;
            new ErrorHandler().handle(error, ERROR_SEVERITY.WARNING, ERROR_CATEGORY.INPUT, {
              context: 'structureGeneration',
            });
          }
        },
        { boundKey: 'boundStructures' }
      );
    }

    if (palette && !palette.dataset.boundClick) {
      this._listen(
        palette,
        'click',
        () => {
          const status = document.getElementById('biome-generation-status');
          try {
            const engine = window.gameManager?.terrainEngine;
            if (!engine) throw new Error('Terrain editing is not ready yet');
            this._syncGenerationSelection();
            if (!this._generationBiome) throw new Error('Choose a biome family first');
            engine.setBiome(this._generationBiome, { generateIfFlat: false });
            window.selectedBiome = engine.biomeKey;
            window.__TT_USER_SELECTED_BIOME__ = true;
            this._syncPlaceableSuitability();
            if (status) {
              const label = getBiomeGenerationVariant(engine.biomeKey)?.label || engine.biomeKey;
              status.setAttribute('role', 'status');
              status.textContent = `Applied the ${label} palette without generating terrain.`;
            }
          } catch (error) {
            if (status) {
              status.setAttribute('role', 'alert');
              status.textContent = `Cannot apply palette: ${error.message}.`;
            }
            new ErrorHandler().handle(error, ERROR_SEVERITY.WARNING, ERROR_CATEGORY.INPUT, {
              context: 'applyBiomePalette',
            });
          }
        },
        { boundKey: 'boundClick' }
      );
    }

    if (btn && !btn.dataset.boundClick) {
      this._listen(
        btn,
        'click',
        async () => {
          if (this._biomeGenerationBusy) return;
          const status = document.getElementById('biome-generation-status');
          try {
            const gm = window.gameManager;
            const engine = gm?.terrainEngine;
            if (!engine) throw new Error('Terrain editing is not ready yet');
            this._syncGenerationSelection();
            const selectedBiome = this._generationBiome;
            if (!selectedBiome) throw new Error('Choose a biome before generating a map');
            if (engine.isActive || engine.isGenerating) {
              throw new Error('Finish terrain editing before generating a new map');
            }
            const mapId = gm.campaignMapId ?? null;
            const campaignId = gm.campaign?.id ?? null;
            const beforeReview = JSON.stringify(engine.save());
            const mapUnchanged = () =>
              window.gameManager === gm &&
              gm.terrainEngine === engine &&
              (gm.campaignMapId ?? null) === mapId &&
              (gm.campaign?.id ?? null) === campaignId &&
              JSON.stringify(engine.save()) === beforeReview;
            const cancelled = () => {
              if (!status) return;
              status.setAttribute('role', 'status');
              status.textContent = 'Generation cancelled; no terrain was generated.';
            };
            this._setBiomeGenerationBusy(true);
            let protectedAssetsAvailable = false;
            let protectedAssetsUnavailableReason = null;
            const family = getBiomeGenerationFamily(selectedBiome);
            if (
              family?.fields.some((field) => field.id === 'assetPack') &&
              gm.modelAssetCache?.hasProtectedAssetKeyProvider?.() === true
            ) {
              if (status) {
                status.setAttribute('role', 'status');
                status.textContent = 'Checking protected scenery access...';
              }
              try {
                await verifyProtectedScenery(gm.modelAssetCache);
                protectedAssetsAvailable = true;
              } catch (error) {
                const failure = error instanceof Error ? error : new Error(String(error));
                protectedAssetsUnavailableReason = failure.message;
                logger.warn(
                  'Protected scenery access check failed',
                  { reason: failure.message },
                  LOG_CATEGORY.UI
                );
                if (status) {
                  status.setAttribute('role', 'alert');
                  status.textContent = `Protected scenery is unavailable: ${failure.message}. Built-in scenery remains available.`;
                }
              }
              if (!mapUnchanged())
                throw new Error('The active map changed while checking protected scenery');
              if (this._generationBiome !== selectedBiome)
                throw new Error('The biome selection changed while checking protected scenery');
            }
            const variant = getBiomeGenerationVariant(selectedBiome);
            const scene = gm.campaignWorld?.save();
            const reviewed = await openBiomeGenerationReview({
              biomeKey: selectedBiome,
              biomeName: variant?.label,
              generationRecipe: engine.generationRecipe,
              gridSize: { cols: engine.cols, rows: engine.rows },
              structuresEnabled: structures
                ? structures.checked
                : engine.structureGenerationEnabled,
              protectedAssetsAvailable,
              protectedAssetsUnavailableReason,
              ...(scene ? { cavernDefaults: cavernNetworkDefaults(scene, mapId) } : {}),
            });
            if (!reviewed) {
              cancelled();
              return;
            }
            if (!mapUnchanged())
              throw new Error('The active map changed while reviewing generation');
            const confirmed = await confirmBiomeReplacement();
            syncWarning();
            if (!confirmed) {
              cancelled();
              return;
            }
            if (!mapUnchanged())
              throw new Error('The active map changed while reviewing generation');
            const { gridSize, ...generationOptions } = reviewed;
            if (generationOptions.assetPack === 'pure-poly') {
              if (status) {
                status.setAttribute('role', 'status');
                status.textContent = 'Rechecking protected scenery access...';
              }
              await verifyProtectedScenery(gm.modelAssetCache);
              if (!mapUnchanged())
                throw new Error('The active map changed while checking protected scenery');
              if (this._generationBiome !== selectedBiome)
                throw new Error('The biome selection changed while checking protected scenery');
            }
            const includeStructures = structures
              ? structures.checked
              : engine.structureGenerationEnabled;
            const sameDungeon =
              engine.biomeKey === 'dungeon' &&
              generationOptions.biomeKey === 'dungeon' &&
              includeStructures &&
              gridSize.cols === engine.cols &&
              gridSize.rows === engine.rows &&
              engine.generationRecipe?.values?.dungeonRoomCount ===
                generationOptions.dungeonRoomCount;
            const seed =
              lock && !lock.checked
                ? sameDungeon
                  ? chooseDifferentDungeonSeed({
                      cols: gridSize.cols,
                      rows: gridSize.rows,
                      roomCount: generationOptions.dungeonRoomCount,
                      currentSeed: engine.biomeSeed,
                      currentStructures: engine.geometry.getStructures(),
                    })
                  : Math.floor(Math.random() * 0x100000000) >>> 0
                : engine.biomeSeed;
            await this._commitBiomeGeneration(
              gm,
              { structures: includeStructures, seed, ...generationOptions },
              gridSize,
              status
            );
          } catch (error) {
            this._reportBiomeGenerationError(status, error, 'generateTerrainMap');
          } finally {
            this._setBiomeGenerationBusy(false);
          }
        },
        { boundKey: 'boundClick' }
      );
    }

    if (cycle && !cycle.dataset.boundClick) {
      this._listen(
        cycle,
        'click',
        async () => {
          if (this._biomeGenerationBusy) return;
          const status = document.getElementById('biome-generation-status');
          try {
            const gm = window.gameManager;
            const engine = gm?.terrainEngine;
            const recipe = engine?.generationRecipe;
            const roomCount =
              recipe?.biomeKey === 'dungeon' ? recipe.values?.dungeonRoomCount : null;
            if (
              !engine ||
              engine.biomeKey !== 'dungeon' ||
              !Number.isInteger(roomCount) ||
              !engine.structureGenerationEnabled
            )
              throw new Error('Generate a Dungeon with a room count before cycling its layout');
            if (engine.isActive || engine.isGenerating)
              throw new Error('Finish terrain editing before generating a new map');
            const mapId = gm.campaignMapId ?? null;
            const campaignId = gm.campaign?.id ?? null;
            const before = JSON.stringify(engine.save());
            const unchanged = () =>
              window.gameManager === gm &&
              gm.terrainEngine === engine &&
              (gm.campaignMapId ?? null) === mapId &&
              (gm.campaign?.id ?? null) === campaignId &&
              JSON.stringify(engine.save()) === before;
            this._setBiomeGenerationBusy(true);
            const confirmed = await confirmBiomeReplacement();
            syncWarning();
            if (!confirmed) {
              if (status) {
                status.setAttribute('role', 'status');
                status.textContent = 'Generation cancelled; no terrain was generated.';
              }
              return;
            }
            if (!unchanged()) throw new Error('The active map changed while reviewing generation');
            const seed = chooseDifferentDungeonSeed({
              cols: engine.cols,
              rows: engine.rows,
              roomCount,
              currentSeed: engine.biomeSeed,
              currentStructures: engine.geometry.getStructures(),
            });
            await this._commitBiomeGeneration(
              gm,
              {
                ...recipe.values,
                biomeKey: 'dungeon',
                dungeonRoomCount: roomCount,
                structures: true,
                seed,
              },
              { cols: engine.cols, rows: engine.rows },
              status
            );
          } catch (error) {
            this._reportBiomeGenerationError(status, error, 'cycleDungeonLayout');
          } finally {
            this._setBiomeGenerationBusy(false);
          }
        },
        { boundKey: 'boundClick' }
      );
    }

    if (lock && !lock.dataset.boundChange) {
      try {
        const s = window.richShadingSettings || {};
        if (typeof s.lockSeed === 'boolean') lock.checked = !!s.lockSeed;
      } catch (e) {
        /* ignore */
      }
      this._listen(
        lock,
        'change',
        () => {
          if (!window.richShadingSettings) window.richShadingSettings = {};
          if (window.richShadingSettings.lockSeed === !!lock.checked) return;
          window.richShadingSettings.lockSeed = !!lock.checked;
          window.gameManager?.sceneAutosave?.changed('terrain shading');
        },
        { boundKey: 'boundChange' }
      );
    }

    if (reseed && !reseed.dataset.boundClick) {
      this._listen(
        reseed,
        'click',
        () => {
          const newSeed = Math.floor(Math.random() * 0xffffffff) >>> 0;
          try {
            const engine = window.gameManager?.terrainEngine;
            if (!engine) throw new Error('Terrain editing is not ready yet');
            engine.setBiomeSeed(newSeed);
          } catch (error) {
            new ErrorHandler().handle(error, ERROR_SEVERITY.WARNING, ERROR_CATEGORY.INPUT, {
              context: 'reseedTerrainBiome',
            });
          }
        },
        { boundKey: 'boundClick' }
      );
    }
  }

  _syncRichShadingControlsFromState() {
    try {
      const s = window.richShadingSettings || {};
      // eslint-disable-next-line
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
    } catch (e) {
      /* ignore */
    }
  }

  _refreshTerrainOverlayIfActive() {
    try {
      const gm = window.gameManager;
      if (gm?.terrainEngine && !gm.terrainEngine.isActive) {
        const enabled = !!window.richShadingSettings?.enabled;
        gm.terrainEngine.setRichShadingEnabled(enabled);
      }
    } catch (e) {
      /* ignore */
    }
  }

  buildBiomeMenuSafely() {
    if (this._biomesBuilt) return;
    const lifecycle = this._lifecycle;
    try {
      const root = getBiomeRootEl();
      if (!root) return;
      root.textContent = '';
      import('../config/biome/BiomeGenerationFamilies.js')
        .then((mod) => {
          if (lifecycle !== this._lifecycle) return;
          const { BIOME_GENERATION_FAMILIES } = mod;
          for (const entry of BIOME_GENERATION_FAMILIES) {
            const button = document.createElement('button');
            button.className = 'biome-btn';
            button.type = 'button';
            button.dataset.biomeFamily = entry.key;
            button.dataset.biome = entry.fields[0].default;
            button.dataset.biomeVariants = entry.variants.map(({ key }) => key).join('|');
            button.title = entry.label;
            button.textContent = `${entry.emoji ? `${entry.emoji} ` : ''}${entry.label}`;
            button.setAttribute('aria-pressed', 'false');
            this._listen(button, 'click', () => {
              window.__TT_USER_SELECTED_BIOME__ = true;
              this.selectBiome(entry.fields[0].default);
            });
            root.appendChild(button);
          }
          this._biomesBuilt = true;
          this._syncGenerationSelection();
        })
        .catch(() => {
          /* ignore */
        });
    } catch (e) {
      /* ignore */
    }
  }

  selectBiome(biomeKey) {
    try {
      const engine = window.gameManager?.terrainEngine;
      if (!engine) throw new Error('Terrain editing is not ready yet');
      if (!getBiomeGenerationVariant(biomeKey)) throw new Error('Choose a supported biome family');
      this._syncGenerationSelection();
      this._generationBiome = biomeKey;
      this._renderBiomeSelection();
    } catch (error) {
      new ErrorHandler().handle(error, ERROR_SEVERITY.WARNING, ERROR_CATEGORY.INPUT, {
        context: 'selectTerrainBiome',
        biomeKey,
      });
      return;
    }
  }

  _setBiomeGenerationBusy(busy) {
    this._biomeGenerationBusy = busy;
    const generate = document.getElementById('generate-map');
    const palette = document.getElementById('biome-apply-palette');
    if (generate) {
      generate.disabled = busy;
      generate.classList.toggle('disabled', busy);
    }
    if (palette) palette.disabled = busy;
    this._syncDungeonCycleControl();
  }

  _syncDungeonCycleControl() {
    const button = document.getElementById('dungeon-next-layout');
    if (!button) return;
    const engine = window.gameManager?.terrainEngine;
    const recipe = engine?.generationRecipe;
    const count = recipe?.biomeKey === 'dungeon' ? recipe.values?.dungeonRoomCount : null;
    button.hidden = engine?.biomeKey !== 'dungeon';
    button.disabled =
      button.hidden ||
      !!this._biomeGenerationBusy ||
      !Number.isInteger(count) ||
      !engine.structureGenerationEnabled ||
      engine.isActive ||
      engine.isGenerating;
    button.title = !Number.isInteger(count)
      ? 'Generate a Dungeon with a chosen room count first.'
      : !engine.structureGenerationEnabled
        ? 'Enable Structures & landmarks to generate another layout.'
        : 'Replace this Dungeon with a different layout and seed, even when the seed is locked.';
  }

  async _commitBiomeGeneration(gm, options, gridSize, status) {
    if (status) {
      status.setAttribute('role', 'status');
      status.textContent = 'Generating terrain and biome structures...';
    }
    if (!(await replaceCampaignBiome(gm, options, gridSize)))
      throw new Error('Terrain generation could not begin');
    const engine = gm.terrainEngine;
    this._generationBiome = engine.biomeKey;
    this._generationAppliedBiome = engine.biomeKey;
    window.selectedBiome = engine.biomeKey;
    window.__TT_USER_SELECTED_BIOME__ = true;
    this._renderBiomeSelection();
    this._syncPlaceableSuitability();
    this._syncDungeonCycleControl();
    if (status) {
      const name = getBiomeGenerationVariant(engine.biomeKey)?.label || engine.biomeKey;
      const seed = engine.biomeKey === 'dungeon' ? ` Layout seed: ${engine.biomeSeed}.` : '';
      status.textContent = `Generated ${name} on the ${engine.cols} x ${engine.rows} map.${seed}`;
    }
    window.treeDensityMultiplier = engine.treeDensityMultiplier;
    const density = getTreeDensityControls();
    const densityPercent = Math.round(engine.treeDensityMultiplier * 100);
    if (density.slider) density.slider.value = String(densityPercent);
    if (density.valueEl) density.valueEl.textContent = `${densityPercent}%`;
  }

  _reportBiomeGenerationError(status, error, context) {
    const failure = error instanceof Error ? error : new Error(String(error));
    if (status) {
      status.setAttribute('role', 'alert');
      const guidance = /creature|occupied/i.test(failure.message)
        ? ' Resolve affected creatures or effects on linked maps before replacing the map.'
        : '';
      status.textContent = failure.committed
        ? failure.message
        : `Cannot generate: ${failure.message}.${guidance}`;
    }
    new ErrorHandler().handle(failure, ERROR_SEVERITY.WARNING, ERROR_CATEGORY.INPUT, { context });
  }

  _syncGenerationSelection() {
    const gm = window.gameManager;
    const engine = gm?.terrainEngine;
    const mapId = gm?.campaignMapId ?? null;
    const campaignId = gm?.campaign?.id ?? null;
    const appliedBiome = engine?.biomeKey ?? null;
    if (
      this._generationManager !== gm ||
      this._generationEngine !== engine ||
      this._generationMapId !== mapId ||
      this._generationCampaignId !== campaignId
    ) {
      this._generationManager = gm;
      this._generationEngine = engine;
      this._generationMapId = mapId;
      this._generationCampaignId = campaignId;
      this._generationBiome = appliedBiome;
    } else if (
      appliedBiome !== this._generationAppliedBiome &&
      this._generationBiome === this._generationAppliedBiome
    ) {
      this._generationBiome = appliedBiome;
    }
    this._generationAppliedBiome = appliedBiome;
    this._syncDungeonCycleControl();
    this._renderBiomeSelection();
  }

  _renderBiomeSelection() {
    const root = getBiomeRootEl();
    if (!root) return;
    const selected = getBiomeButtonByKey(this._generationBiome, root);
    for (const button of getBiomeButtons(root)) {
      const active = button === selected;
      button.classList.toggle('selected', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  // ── Public API (Dice Log) ─────────────────────────────────

  addDiceLogEntry(message, type = 'roll', rollResult = null) {
    const summary = rollResult === null ? null : copyRollSummary(rollResult);
    const timestamp = new Date().toLocaleTimeString();
    const entry = { message, type, timestamp, id: Date.now() + Math.random(), rollResult: summary };
    this.diceLogEntries.unshift(entry);
    if (this.diceLogEntries.length > this.maxLogEntries) {
      this.diceLogEntries = this.diceLogEntries.slice(0, this.maxLogEntries);
    }
    if (this.activeTab === 'dice-log') this.refreshDiceLog();
    window.gameManager?.sceneAutosave?.changed('shared roll log');
  }

  snapshotDiceLog() {
    return JSON.parse(JSON.stringify(this.diceLogEntries));
  }

  restoreDiceLog(entries) {
    this.diceLogEntries = JSON.parse(JSON.stringify(entries));
    this.refreshDiceLog();
  }

  refreshDiceLog() {
    const logContent = getDiceLogContentEl();
    if (!logContent) return;
    while (logContent.firstChild) logContent.removeChild(logContent.firstChild);
    if (this.diceLogEntries.length === 0) {
      const emptyEntry = document.createElement('div');
      emptyEntry.className = 'dice-log-entry';
      emptyEntry.textContent = 'No dice rolls yet. Roll some dice!';
      logContent.appendChild(emptyEntry);
      return;
    }
    this.diceLogEntries.forEach((entry, index) => {
      const isRecent = index < 3;
      const entryDiv = document.createElement('div');
      entryDiv.className = `dice-log-entry${isRecent ? ' recent' : ''}`;
      const timeSpan = document.createElement('span');
      timeSpan.className = 'log-time';
      timeSpan.textContent = `[${entry.timestamp}]`;
      const messageSpan = document.createElement('span');
      messageSpan.className = 'log-message';
      if (entry.rollResult) messageSpan.innerHTML = rollSummaryMarkup(entry.rollResult);
      else messageSpan.textContent = entry.message;
      entryDiv.appendChild(timeSpan);
      entryDiv.appendChild(messageSpan);
      logContent.appendChild(entryDiv);
    });
    logContent.scrollTop = 0;
  }

  clearDiceLog() {
    this.diceLogEntries = [];
    this.addDiceLogEntry('Dice log cleared.', 'system');
  }

  // ── Public API (Creatures) ────────────────────────────────

  refreshCreatureSelection() {
    const selectedToken = window.gameManager?.selectedTokenType ?? window.selectedTokenType;
    if (!selectedToken) return;
    const allTokenButtons = getCreatureButtons();
    allTokenButtons.forEach((btn) => {
      btn.classList.remove('selected');
      btn.setAttribute('aria-pressed', 'false');
    });
    if (window.gameManager?.tokenManager?.selectedSavedCharacterId) return;
    const selectedButton = getTokenButtonByType(selectedToken);
    if (selectedButton) {
      selectedButton.classList.add('selected');
      selectedButton.setAttribute('aria-pressed', 'true');
    }
  }

  updateTokenSelection(tokenType) {
    if (window.gameManager && window.gameManager.selectedTokenType !== undefined) {
      window.gameManager.selectedTokenType = tokenType;
    } else {
      window.selectedTokenType = tokenType;
    }
    this.refreshCreatureSelection();
  }

  // ── DOM Helpers ────────────────────────────────────────────

  _syncVisualGridToggleState(toggleEl, explicitVisible) {
    if (!toggleEl) return;
    let resolved = true;
    if (typeof explicitVisible === 'boolean') {
      resolved = explicitVisible;
    } else if (typeof window !== 'undefined') {
      if (window.gameManager?.threeSceneManager) {
        resolved = !!window.gameManager.threeSceneManager.showBootstrapGrid;
      } else if (typeof window.__TT_PENDING_BOOTSTRAP_GRID_VISIBLE === 'boolean') {
        resolved = !!window.__TT_PENDING_BOOTSTRAP_GRID_VISIBLE;
      }
    }
    toggleEl.checked = resolved;
    toggleEl.disabled = false;
  }

  _formatMinutes(mins) {
    if (!Number.isFinite(mins)) return '00:00';
    const safe = ((Math.round(mins) % 1440) + 1440) % 1440;
    const hours = Math.floor(safe / 60);
    const minutes = safe % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  _syncSunTimeSliderState(sliderEl, valueEl, explicitMinutes) {
    if (!sliderEl) return;
    let resolved = Number.isFinite(explicitMinutes) ? explicitMinutes : null;
    if (!Number.isFinite(resolved) && typeof window !== 'undefined') {
      const gm = window.gameManager;
      if (gm?.threeSceneManager?.getSunTimeMinutes) {
        resolved = gm.threeSceneManager.getSunTimeMinutes();
      } else if (Number.isFinite(window.__TT_PENDING_SUN_TIME_MINUTES)) {
        resolved = window.__TT_PENDING_SUN_TIME_MINUTES;
      }
    }
    if (!Number.isFinite(resolved)) resolved = 720;
    const rounded = Math.round(((resolved % 1440) + 1440) % 1440);
    sliderEl.value = String(rounded);
    if (valueEl) valueEl.textContent = this._formatMinutes(rounded);
  }

  onVisualGridVisibilityChange(visible) {
    const next = !!visible;
    if (typeof window !== 'undefined') {
      window.__TT_PENDING_BOOTSTRAP_GRID_VISIBLE = next;
    }
    const gm = typeof window !== 'undefined' ? window.gameManager : null;
    if (gm?.threeSceneManager) {
      gm.threeSceneManager.setBootstrapGridVisible(next);
    }
  }

  onGridOpacityChange() {
    // 2D sprite tile opacity removed; Three.js mesh controls grid visibility.
    logger.debug('Grid opacity change not applicable in 3D mode', {}, LOG_CATEGORY.UI);
  }

  onSunTimeChange(minutes, options = {}) {
    if (!Number.isFinite(minutes)) return;
    const normalized = ((minutes % 1440) + 1440) % 1440;
    if (typeof window !== 'undefined') {
      window.__TT_PENDING_SUN_TIME_MINUTES = normalized;
      if (!options.skipNotify && Array.isArray(window.__TT_SUN_TIME_LISTENERS__)) {
        window.__TT_SUN_TIME_LISTENERS__.forEach((fn) => {
          try {
            fn(normalized);
          } catch (_) {
            /* ignore */
          }
        });
      }
    }
    const gm = typeof window !== 'undefined' ? window.gameManager : null;
    if (gm?.threeSceneManager?.setSunTimeMinutes) {
      gm.threeSceneManager.setSunTimeMinutes(normalized, {
        immediate: !!options.immediate,
        skipPersist: !!options.skipPersist,
      });
    }
  }
}

window.sidebarController = new SidebarController();
/* NFC NOTE (2025-09-19): SidebarController flagged as orphan; usage is indirect via global
window.sidebarController for dice system & selection updates. Scheduled for architectural
review in a later phase. Keep for now (NFC). */
export default SidebarController;
