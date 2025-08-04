/**
 * SidebarController.js - Manages the right sidebar menu system
 * 
 * Handles tab switching, dice log management, and sidebar interactions
 * Following clean, modular design principles with single responsibility
 */

class SidebarController {
  constructor() {
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
  }

  /**
   * Show a specific tab and hide others
   * @param {string} tabId - The ID of the tab to show
   */
  showTab(tabId) {
    // Validate tab ID
    const validTabs = ['dice-log', 'creatures', 'terrain', 'settings'];
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
      case 'settings':
        // Future: Load current game settings
        break;
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

    if (this.diceLogEntries.length === 0) {
      logContent.innerHTML = '<div class="dice-log-entry">No dice rolls yet. Roll some dice!</div>';
      return;
    }

    const logHTML = this.diceLogEntries.map((entry, index) => {
      const isRecent = index < 3; // Mark first 3 entries as recent
      const recentClass = isRecent ? 'recent' : '';
      
      return `
        <div class="dice-log-entry ${recentClass}">
          <span class="log-time">[${entry.timestamp}]</span>
          <span class="log-message">${entry.message}</span>
        </div>
      `;
    }).join('');

    logContent.innerHTML = logHTML;

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
    // Get the currently selected token from the global state
    const selectedToken = window.selectedTokenType;
    
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
    window.selectedTokenType = tokenType;
    this.refreshCreatureSelection();
  }

  /**
   * Handle grid opacity change
   * @param {number} opacity - Opacity value from 0 to 1
   */
  onGridOpacityChange(opacity) {
    // TODO: Integrate with GameManager to change grid opacity
    console.log(`Grid opacity changed to: ${opacity}`);
  }

  /**
   * Handle animation speed change
   * @param {number} speed - Speed multiplier
   */
  onAnimationSpeedChange(speed) {
    // TODO: Integrate with GameManager to change animation speed
    console.log(`Animation speed changed to: ${speed}x`);
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
