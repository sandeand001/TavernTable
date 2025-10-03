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
} from './domHelpers.js';
import { logger, LOG_CATEGORY } from '../utils/Logger.js';

class SidebarController {
  constructor() {
    this.activeTab = 'dice-log';
    this.diceLogEntries = [];
    this.maxLogEntries = 50;
    this._placeablesBuilt = false;
    this._biomesBuilt = false;
    this.init();
  }

  init() {
    // Wire tab buttons
    try {
      const buttons = getTabButtons();
      const panels = getTabPanels();
      buttons.forEach((btn) => {
        if (!btn.dataset.boundClick) {
          btn.addEventListener('click', () => {
            const tabId = btn.getAttribute('data-tab');
            this.switchTab(tabId);
          });
          btn.dataset.boundClick = 'true';
        }
      });
      // Activate initial tab
      this.switchTab(this.activeTab);
      // Grid + animation controls
      const gridOpacity = getGridOpacityControl();
      if (gridOpacity && !gridOpacity.dataset.boundChange) {
        gridOpacity.addEventListener('input', () => {
          const val = Number(gridOpacity.value) / 100;
          this.onGridOpacityChange(val);
        });
        gridOpacity.dataset.boundChange = 'true';
      }
      const animSpeed = getAnimationSpeedControl();
      if (animSpeed && !animSpeed.dataset.boundChange) {
        animSpeed.addEventListener('input', () => {
          const val = Number(animSpeed.value) / 100;
          this.onAnimationSpeedChange(val);
        });
        animSpeed.dataset.boundChange = 'true';
      }
      // Panels (show/hide by class)
      panels.forEach((p) => p.classList.remove('active'));
    } catch (_) {
      /* ignore init errors */
    }
  }

  switchTab(tabId) {
    this.activeTab = tabId;
    try {
      const buttons = getTabButtons();
      const panels = getTabPanels();
      buttons.forEach((b) => b.classList.toggle('active', b.getAttribute('data-tab') === tabId));
      panels.forEach((p) => p.classList.toggle('active', p.id === `${tabId}-panel`));
    } catch (_) {
      /* ignore */
    }
    this.onTabChange(tabId);
  }

  onTabChange(tabId) {
    if (tabId === 'dice-log') this.refreshDiceLog();
    else if (tabId === 'creatures') this.refreshCreatureSelection();
    else if (tabId === 'terrain') {
      this.buildTerrainPlaceablesMenuSafely();
      try {
        window.gameManager?.terrainCoordinator?.setPlaceablesPanelVisible?.(true);
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
        window.gameManager?.terrainCoordinator?.setPlaceablesPanelVisible?.(false);
      } catch (_) {
        /* ignore */
      }
    }
  }

  /* =============================
   * Unified Placeables Grid
   * ============================= */
  buildTerrainPlaceablesMenuSafely() {
    if (this._placeablesBuilt) return; // Build only once per session; remove this if dynamic updates needed
    const root = getTerrainPlaceablesRoot();
    if (!root) return;
    root.textContent = '';
    root.classList.add('placeables-unified-grid');

    // Lazy import to avoid cost until tab viewed
    import('../config/TerrainPlaceables.js')
      .then((mod) => {
        const TERRAIN_PLACEABLES = mod.TERRAIN_PLACEABLES || mod.default || {};
        const entries = Object.entries(TERRAIN_PLACEABLES);
        if (!entries.length) return;

        // Buckets: match order requirement
        const buckets = [
          {
            key: 'trees',
            title: 'Trees',
            filter: ([id, def]) => def.type === 'plant-family' || /^family-/.test(id),
          },
          {
            key: 'plants',
            title: 'Flowers & Plants',
            filter: ([id]) => /flower|bush|plant/i.test(id),
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
        ];

        // Collect matched ids to compute remaining 'Other'
        const used = new Set();
        const bucketData = buckets.map((b) => {
          const list = entries.filter((e) => b.filter(e));
          list.forEach(([id]) => used.add(id));
          return { ...b, list };
        });
        const otherList = entries.filter(([id]) => !used.has(id));
        if (otherList.length) bucketData.push({ key: 'other', title: 'Other', list: otherList });

        // Helper to build a button (family vs individual)
        const buildBtn = (id, def) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'placeable-btn';
          btn.dataset.placeable = id;
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
          btn.addEventListener('click', () => {
            if (window.gameManager?.terrainCoordinator?.isPlaceableRemovalMode?.()) return;
            const current =
              window.gameManager?.terrainCoordinator?.getSelectedPlaceable?.() ||
              window.selectedTerrainPlaceable ||
              null;
            const next = current === id ? null : id;
            try {
              window.gameManager?.terrainCoordinator?.setSelectedPlaceable?.(next);
            } catch (e) {
              /* ignore set failure */
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
            .forEach(([id, def]) => root.appendChild(buildBtn(id, def)));
        });

        this._placeablesBuilt = true;
      })
      .catch(() => {
        /* ignore load error */
      });
  }

  /* =============================
   * Biomes (existing logic preserved, simplified)
   * ============================= */
  _wireGenerateMapButton() {
    const btn = document.getElementById('generate-map');
    const lock = document.getElementById('biome-seed-lock');
    const reseed = document.getElementById('biome-reseed');

    if (btn && !btn.dataset.boundClick) {
      btn.addEventListener('click', async () => {
        const biome = window.selectedBiome;
        if (!biome) return;
        try {
          try {
            window.gameManager?.placeableMeshPool?.clearAll?.();
          } catch (e) {
            // ignore clear error
          }
          if (
            !window.gameManager?.terrainCoordinator ||
            window.gameManager.terrainCoordinator._isGenerating
          )
            return;
          btn.disabled = true;
          btn.classList.add('disabled');
          if (lock && !lock.checked) {
            const newSeed = Math.floor(Math.random() * 0xffffffff) >>> 0;
            try {
              window.gameManager?.terrainCoordinator?.setBiomeSeed?.(newSeed);
            } catch (e) {
              // ignore seed set error
            }
          }
          let ok = false;
          try {
            ok = await window.gameManager?.terrainCoordinator?.generateBiomeElevation?.(biome);
          } catch (e) {
            // ignore generate error
          }
          if (ok) {
            try {
              window.gameManager?.terrainCoordinator?.applyBiomePaletteToBaseGrid?.();
            } catch (e) {
              // ignore palette error
            }
          }
        } finally {
          try {
            btn.disabled = false;
            btn.classList.remove('disabled');
          } catch (e) {
            // ignore
          }
        }
      });
      btn.dataset.boundClick = 'true';
    }

    if (lock && !lock.dataset.boundChange) {
      try {
        const s = window.richShadingSettings || {};
        if (typeof s.lockSeed === 'boolean') lock.checked = !!s.lockSeed;
      } catch (e) {
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
        } catch (e) {
          // ignore
        }
        try {
          window.gameManager?.terrainCoordinator?.applyBiomePaletteToBaseGrid?.();
        } catch (e) {
          // ignore
        }
      });
      reseed.dataset.boundClick = 'true';
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
      if (gm?.terrainCoordinator?.isTerrainModeActive && gm?.terrainCoordinator?.terrainManager) {
        gm.terrainCoordinator.terrainManager.refreshAllTerrainDisplay();
      } else if (gm?.terrainCoordinator && !gm.terrainCoordinator.isTerrainModeActive) {
        const enabled = !!window.richShadingSettings?.enabled;
        if (enabled) gm.terrainCoordinator.applyBiomePaletteToBaseGrid?.();
        else gm.terrainCoordinator.setRichShadingEnabled?.(false);
      }
    } catch (e) {
      /* ignore */
    }
  }

  buildBiomeMenuSafely() {
    if (this._biomesBuilt) return;
    try {
      const root = getBiomeRootEl();
      if (!root) return;
      root.textContent = '';
      import('../config/BiomeConstants.js')
        .then((mod) => {
          const { BIOME_GROUPS } = mod;
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
          if (window.selectedBiome) this.selectBiome(window.selectedBiome);
        })
        .catch(() => {
          /* ignore */
        });
    } catch (e) {
      /* ignore */
    }
  }

  selectBiome(biomeKey) {
    window.selectedBiome = biomeKey;
    try {
      if (
        window.gameManager?.terrainCoordinator &&
        !window.gameManager.terrainCoordinator.isTerrainModeActive
      ) {
        window.gameManager.terrainCoordinator.applyBiomePaletteToBaseGrid?.();
      }
    } catch (e) {
      /* ignore */
    }
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
    } catch (e) {
      /* ignore */
    }
  }

  /* =============================
   * Dice Log
   * ============================= */
  addDiceLogEntry(message, type = 'roll') {
    const timestamp = new Date().toLocaleTimeString();
    const entry = { message, type, timestamp, id: Date.now() + Math.random() };
    this.diceLogEntries.unshift(entry);
    if (this.diceLogEntries.length > this.maxLogEntries) {
      this.diceLogEntries = this.diceLogEntries.slice(0, this.maxLogEntries);
    }
    if (this.activeTab === 'dice-log') this.refreshDiceLog();
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
      messageSpan.textContent = entry.message;
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

  /* =============================
   * Creatures / Tokens
   * ============================= */
  refreshCreatureSelection() {
    const selectedToken = window.gameManager?.selectedTokenType ?? window.selectedTokenType;
    if (!selectedToken) return;
    const allTokenButtons = getCreatureButtons();
    allTokenButtons.forEach((btn) => {
      btn.classList.remove('selected');
      btn.setAttribute('aria-pressed', 'false');
    });
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

  onGridOpacityChange(opacity) {
    if (window.gameManager?.gridContainer) {
      window.gameManager.gridContainer.children.forEach((child) => {
        if (child.isGridTile) child.alpha = opacity;
      });
    } else {
      logger.debug('GameManager not available for grid opacity change', {}, LOG_CATEGORY.UI);
    }
  }

  onAnimationSpeedChange(speed) {
    if (window.gameManager?.app) {
      window.gameManager.app.animationSpeedMultiplier = speed;
      if (window.gameManager.app.ticker) window.gameManager.app.ticker.speed = speed;
    } else {
      logger.debug('GameManager not available for animation speed change', {}, LOG_CATEGORY.UI);
    }
  }
}

window.sidebarController = new SidebarController();
export default SidebarController;
