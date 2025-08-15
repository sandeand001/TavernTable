/**
 * SidebarController.js - Manages the right sidebar menu system
 * 
 * Handles tab switching, dice log management, and sidebar interactions
 * Following clean, modular design principles with single responsibility
 */

class SidebarController {
  constructor() {
  // Default active tab (original): dice-log
  this.activeTab = 'dice-log';
    this.diceLogEntries = [];
    this.maxLogEntries = 50; // Prevent memory issues with large logs
    
    this.init();
  }

  /**
   * Initialize the sidebar controller
   * Sets up event listeners and default state
   */
  init() {
    this.setupTabListeners();
    this.setupRangeSliderListeners();
    this.showTab(this.activeTab);

  // Biome menu now lazy-builds when Biomes tab first opened
    // Initialize global rich shading defaults
    if (!window.richShadingSettings) {
      window.richShadingSettings = {
        enabled: true,
        intensity: 1.0, // 0..1 multiplier for alpha
        density: 1.0,   // 0.5..1.5 multiplier for element counts/sizes
        performance: false
      };
    }
    
    // Add welcome message to dice log
    this.addDiceLogEntry('Welcome to TavernTable! Roll some dice to see history here.', 'system');
  }

  /**
   * Set up event listeners for tab navigation
   */
  setupTabListeners() {
    const tabButtons = document.querySelectorAll('.tab-button');
    
    tabButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        const tabId = e.target.getAttribute('data-tab');
        this.showTab(tabId);
      });
      
      // Keyboard accessibility
      button.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const tabId = e.target.getAttribute('data-tab');
          this.showTab(tabId);
        }
      });
    });
  }

  /**
   * Set up range slider listeners for settings
   */
  setupRangeSliderListeners() {
    // Grid opacity slider
    const gridOpacitySlider = document.getElementById('grid-opacity');
    const gridOpacityValue = gridOpacitySlider?.nextElementSibling;
    
    if (gridOpacitySlider) {
      gridOpacitySlider.addEventListener('input', (e) => {
        const value = e.target.value;
        if (gridOpacityValue) {
          gridOpacityValue.textContent = `${value}%`;
        }
        // TODO: Apply grid opacity to game
        this.onGridOpacityChange(value / 100);
      });
    }

    // Animation speed slider
    const animationSpeedSlider = document.getElementById('animation-speed');
    const animationSpeedValue = animationSpeedSlider?.nextElementSibling;
    
    if (animationSpeedSlider) {
      animationSpeedSlider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        if (animationSpeedValue) {
          animationSpeedValue.textContent = `${value}x`;
        }
        // TODO: Apply animation speed to game
        this.onAnimationSpeedChange(value);
      });
    }

    // Biome Rich Shading controls
    const shadeToggle = document.getElementById('rich-shading-toggle');
    const intensity = document.getElementById('shading-intensity');
    const intensityVal = document.getElementById('shading-intensity-value');
    const density = document.getElementById('pattern-density');
    const densityVal = document.getElementById('pattern-density-value');
    const perf = document.getElementById('performance-simplify');

    if (shadeToggle) {
      // Initialize from current settings
      shadeToggle.checked = !!window.richShadingSettings?.enabled;
      shadeToggle.addEventListener('change', () => {
        window.richShadingSettings.enabled = shadeToggle.checked;
        this._refreshTerrainOverlayIfActive();
      });
    }
    if (intensity && intensityVal) {
      const init = Math.round((window.richShadingSettings?.intensity ?? 1) * 100);
      intensity.value = String(init);
      intensityVal.textContent = `${init}%`;
      intensity.addEventListener('input', () => {
        const pct = parseInt(intensity.value, 10) || 0;
        window.richShadingSettings.intensity = Math.max(0, Math.min(150, pct)) / 100;
        intensityVal.textContent = `${pct}%`;
        this._refreshTerrainOverlayIfActive();
      });
    }
    if (density && densityVal) {
      const init = Math.round((window.richShadingSettings?.density ?? 1) * 100);
      density.value = String(init);
      densityVal.textContent = `${init}%`;
      density.addEventListener('input', () => {
        const pct = parseInt(density.value, 10) || 0;
        window.richShadingSettings.density = Math.max(50, Math.min(150, pct)) / 100; // 0.5..1.5
        densityVal.textContent = `${pct}%`;
        this._refreshTerrainOverlayIfActive();
      });
    }
    if (perf) {
      perf.checked = !!window.richShadingSettings?.performance;
      perf.addEventListener('change', () => {
        window.richShadingSettings.performance = perf.checked;
        this._refreshTerrainOverlayIfActive();
      });
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
      console.warn(`Invalid tab ID: ${tabId}`);
      return;
    }

    // Update active tab
    this.activeTab = tabId;

    // Update tab button states
    const tabButtons = document.querySelectorAll('.tab-button');
    tabButtons.forEach(button => {
      const isActive = button.getAttribute('data-tab') === tabId;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-selected', isActive);
    });

    // Update tab panel visibility
    const tabPanels = document.querySelectorAll('.tab-panel');
    tabPanels.forEach(panel => {
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
      break;
    case 'biomes':
      this.buildBiomeMenuSafely();
  // Ensure control defaults reflect current settings when switching tabs
  this._syncRichShadingControlsFromState();
      break;
    case 'settings':
      // Future: Load current game settings
      break;
    }
  }

  _syncRichShadingControlsFromState() {
    try {
      const s = window.richShadingSettings || {};
      const shadeToggle = document.getElementById('rich-shading-toggle');
      const intensity = document.getElementById('shading-intensity');
      const intensityVal = document.getElementById('shading-intensity-value');
      const density = document.getElementById('pattern-density');
      const densityVal = document.getElementById('pattern-density-value');
      const perf = document.getElementById('performance-simplify');
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
      if (perf) perf.checked = !!s.performance;
    } catch (_) { /* ignore */ }
  }

  _refreshTerrainOverlayIfActive() {
    try {
      const gm = window.gameManager;
      if (gm?.terrainCoordinator?.isTerrainModeActive && gm?.terrainCoordinator?.terrainManager) {
        gm.terrainCoordinator.terrainManager.refreshAllTerrainDisplay();
      } else if (gm?.terrainCoordinator && !gm.terrainCoordinator.isTerrainModeActive) {
        // Outside edit mode, re-apply biome palette to base grid for immediate feedback on color-only changes
        if (typeof gm.terrainCoordinator.applyBiomePaletteToBaseGrid === 'function') {
          gm.terrainCoordinator.applyBiomePaletteToBaseGrid();
        }
      }
    } catch (_) { /* non-fatal */ }
  }

  buildBiomeMenuSafely() {
    try {
      const root = document.getElementById('biome-menu-root');
      // If previously built but root is missing or empty (e.g., moved to new tab), allow rebuild
      if (this._biomesBuilt) {
        if (!root || root.children.length === 0) {
          this._biomesBuilt = false; // reset flag to trigger rebuild
        } else {
          return; // already populated
        }
      }
      // Lazy import to avoid blocking initial load
      import('../config/BiomeConstants.js').then(mod => {
        const { BIOME_GROUPS } = mod;
        if (!root) return;
        root.textContent = '';
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

          list.forEach(b => {
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
          try { this.selectBiome(window.selectedBiome); } catch(_) { /* ignore */ }
        }
      }).catch(() => {/* ignore */});
    } catch (_) { /* swallow to avoid UI disruption */ }
  }

  selectBiome(biomeKey) {
    window.selectedBiome = biomeKey;
    if (window.sidebarController?.activeTab === 'terrain') {
      console.log('Biome selected:', biomeKey);
    }
    // If game manager exists and terrain mode is OFF, immediately apply biome palette colors
    try {
      if (window.gameManager && window.gameManager.terrainCoordinator && !window.gameManager.terrainCoordinator.isTerrainModeActive) {
        window.gameManager.terrainCoordinator.applyBiomePaletteToBaseGrid();
      }
    } catch(_) { /* non-fatal */ }
    // Visual selection state
    try {
      const root = document.getElementById('biome-menu-root');
      if (root) {
        root.querySelectorAll('.biome-btn.selected').forEach(btn => btn.classList.remove('selected'));
        const newly = root.querySelector(`.biome-btn[data-biome="${biomeKey}"]`);
        if (newly) {
          newly.classList.add('selected');
          newly.setAttribute('aria-pressed', 'true');
        }
      }
    } catch (_) { /* silent */ }
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
      id: Date.now() + Math.random() // Simple unique ID
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
    const logContent = document.getElementById('dice-log-content');
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
    const allTokenButtons = document.querySelectorAll('#creature-content button[id^="token-"], #token-remove');
    allTokenButtons.forEach(btn => {
      btn.classList.remove('selected');
      btn.setAttribute('aria-pressed', 'false');
    });
    
    // Highlight the selected token
    const selectedButton = document.getElementById(`token-${selectedToken}`);
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
      window.gameManager.gridContainer.children.forEach(child => {
        if (child.isGridTile) {
          child.alpha = opacity;
        }
      });
    } else {
      console.warn('GameManager not available for grid opacity change');
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
      console.warn('GameManager not available for animation speed change');
    }
  }
}

// Global functions for HTML onclick handlers
window.clearDiceLog = () => {
  if (window.sidebarController) {
    window.sidebarController.clearDiceLog();
  }
};

// Create and expose global instance
window.sidebarController = new SidebarController();

export default SidebarController;
