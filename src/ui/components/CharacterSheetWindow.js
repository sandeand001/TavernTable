import { getTokenDisplayName } from '../../entities/creatures/creatureHelpers.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../../utils/error/ErrorHandler.js';
import CharacterSheetContent from './CharacterSheetContent.js';

const VIEWPORT_MARGIN = 8;
const MIN_WIDTH = 280;
const MIN_HEIGHT = 220;
const MINIMIZED_HEIGHT = 48;

export default class CharacterSheetWindow {
  // ── Construction & Lifecycle ───────────────────────────────
  constructor({
    gameManager,
    characterServices = null,
    initialBounds = null,
    onOpenCompendium = null,
  }) {
    this.gameManager = gameManager;
    this.characterServices = characterServices;
    this.onOpenCompendium = onOpenCompendium;
    this.tabs = new Map();
    this.activeToken = null;
    this.minimized = false;
    this._nextTabId = 0;
    this._gesture = null;
    this._nameEdit = null;
    this.renameReady = Promise.resolve(true);
    this._bounds = initialBounds || { left: 80, top: 120, width: 480, height: 360 };
    this._onSelected = (event) => {
      const { token, gameManager: source } = event.detail || {};
      if (source === this.gameManager && token && !this.root.hidden) {
        this._select(token);
      }
    };
    this._onRemoved = (event) => {
      if (event.detail?.gameManager === this.gameManager) this.closeTab(event.detail.token);
    };
    this._onNamesChanged = (event) => {
      if (event.detail?.gameManager === this.gameManager) this._refreshNames();
    };
    this._onViewportResize = () => this._applyBounds(this._bounds);
    this._onPointerMove = (event) => this._moveGesture(event);
    this._onPointerEnd = () => this._endGesture();
    this._build();
    this._applyBounds(this._bounds);
  }

  attach(parent = document.body) {
    if (this.root.parentNode === parent) return this;
    parent.appendChild(this.root);
    window.addEventListener('taverntable:tokenSelected', this._onSelected);
    window.addEventListener('taverntable:tokenRemoved', this._onRemoved);
    window.addEventListener('taverntable:tokenNamesChanged', this._onNamesChanged);
    window.addEventListener('resize', this._onViewportResize);
    window.addEventListener('blur', this._onPointerEnd);
    return this;
  }

  destroy() {
    this._nameEdit = null;
    this._destroyed = true;
    this._endGesture();
    this.characterContent.destroy();
    window.removeEventListener('taverntable:tokenSelected', this._onSelected);
    window.removeEventListener('taverntable:tokenRemoved', this._onRemoved);
    window.removeEventListener('taverntable:tokenNamesChanged', this._onNamesChanged);
    window.removeEventListener('resize', this._onViewportResize);
    window.removeEventListener('blur', this._onPointerEnd);
    this.root.remove();
    this.tabs.clear();
    this.activeToken = null;
  }

  // ── Public Window & Tab Actions ────────────────────────────
  open(token) {
    this._select(token, { syncToken: true });
    this.root.hidden = false;
    this.restore();
    this.tabs.get(token).button.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    this.tabs.get(token).button.focus({ preventScroll: true });
    return this.ready;
  }

  hide() {
    this._commitNameEdit();
    this.heading.blur();
    this._endGesture();
    this.root.hidden = true;
  }

  minimize() {
    this._setMinimized(true);
  }

  restore() {
    this._setMinimized(false);
  }

  closeTab(token) {
    const tab = this.tabs.get(token);
    if (!tab) return;
    if (this._nameEdit?.token === token) {
      if (this.gameManager.placedTokens.includes(token)) this._commitNameEdit();
      else this._nameEdit = null;
      this.heading.blur();
    }
    const tokens = [...this.tabs.keys()];
    const index = tokens.indexOf(token);
    const hadFocus = tab.item.contains(document.activeElement);
    tab.item.remove();
    this.tabs.delete(token);
    if (this.activeToken !== token) return;
    const next = tokens[index + 1] || tokens[index - 1];
    if (next) {
      this._select(next, { syncToken: !this.root.hidden });
      if (hadFocus) this.tabs.get(next).button.focus();
    } else {
      this.activeToken = null;
      this.characterContent.clear();
      this.heading.textContent = '';
      this.hide();
    }
  }

  // ── Minimized State ──────────────────────────────────────
  _setMinimized(minimized) {
    this._commitNameEdit();
    this.heading.blur();
    this._endGesture();
    this.minimized = minimized;
    this.root.dataset.minimized = String(minimized);
    this.minimizeButton.textContent = minimized ? '\u25a1' : '\u2212';
    this.minimizeButton.title = minimized ? 'Restore' : 'Minimize';
    this.minimizeButton.setAttribute(
      'aria-label',
      minimized ? 'Restore character sheets' : 'Minimize character sheets'
    );
    this.minimizeButton.setAttribute('aria-expanded', String(!minimized));
    this._applyBounds(this._bounds);
    if (minimized && this.root.contains(document.activeElement)) {
      this.minimizeButton.focus({ preventScroll: true });
    }
  }

  // ── DOM Construction ─────────────────────────────────────
  _build() {
    this.root = document.createElement('section');
    this.root.className = 'character-sheet-window';
    this.root.hidden = true;
    this.root.dataset.minimized = 'false';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'false');
    this.root.setAttribute('aria-label', 'Character sheets');
    this.root.innerHTML = `
      <header class="character-sheet-titlebar">
        <h2>Character sheets</h2>
        <div class="character-sheet-window-actions">
          <button type="button" class="character-sheet-window-minimize" aria-label="Minimize character sheets" title="Minimize" aria-expanded="true" aria-controls="character-sheet-panel">&#8722;</button>
          <button type="button" class="character-sheet-window-close" aria-label="Close character sheets" title="Close">&times;</button>
        </div>
      </header>
      <div class="character-sheet-tabs" role="tablist" aria-label="Creature character sheets"></div>
      <div class="character-sheet-content" role="tabpanel" id="character-sheet-panel" tabindex="0">
        <div class="character-sheet-heading">
          <h3 contenteditable="false" role="textbox" aria-label="Character name" aria-multiline="false"
            aria-describedby="character-sheet-save-status" tabindex="0" spellcheck="false"
            title="Click to rename. Enter saves; Escape cancels."></h3>
          <button type="button" class="character-sheet-settings-toggle" aria-label="Character settings"
            aria-expanded="false" aria-controls="character-sheet-settings" title="Character settings">&#9881;</button>
        </div>
        <div class="character-sheet-editor-host"></div>
        <p class="character-sheet-hint">Select a creature or a sheet tab to keep them in sync.</p>
      </div>
      <button type="button" class="character-sheet-resize" aria-label="Resize character sheet window" title="Drag to resize, or use the arrow keys"></button>
    `;
    this.tablist = this.root.querySelector('[role="tablist"]');
    this.panel = this.root.querySelector('[role="tabpanel"]');
    this.heading = this.panel.querySelector('h3');
    this.characterContent = new CharacterSheetContent({
      gameManager: this.gameManager,
      services: this.characterServices,
      onOpenCompendium: this.onOpenCompendium,
    });
    this.panel.querySelector('.character-sheet-editor-host').append(this.characterContent.root);
    this.settingsButton = this.root.querySelector('.character-sheet-settings-toggle');
    this.settingsButton.addEventListener('click', () => {
      this._setSettingsOpen(this.characterContent.settingsPanel.hidden);
      if (!this.characterContent.settingsPanel.hidden) this.characterContent.librarySelect.focus();
    });
    this.characterContent.settingsPanel
      .querySelector('[data-sheet-settings-close]')
      .addEventListener('click', () => this._setSettingsOpen(false, true));
    this.heading.addEventListener('focus', () => {
      if (this.heading.getAttribute('contenteditable') === 'false') return;
      this._nameEdit = {
        token: this.activeToken,
        characterId: this.activeToken.characterSheetId,
        original: this.heading.textContent,
      };
    });
    this.heading.addEventListener('blur', () => this._commitNameEdit());
    this.heading.addEventListener('keydown', (event) => {
      if (event.isComposing) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        this.heading.blur();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this._nameEdit = null;
        this.heading.textContent = getTokenDisplayName(this.activeToken);
        this.heading.blur();
      }
    });
    this.minimizeButton = this.root.querySelector('.character-sheet-window-minimize');
    this.minimizeButton.addEventListener('click', () => {
      if (this.minimized) this.restore();
      else this.minimize();
    });
    this.root.querySelector('.character-sheet-window-close').addEventListener('click', () => {
      this.hide();
    });
    this.root
      .querySelector('.character-sheet-titlebar')
      .addEventListener('pointerdown', (event) => {
        if (!event.target.closest('button')) this._startGesture(event, 'move');
      });
    const resize = this.root.querySelector('.character-sheet-resize');
    resize.addEventListener('pointerdown', (event) => this._startGesture(event, 'resize'));
    resize.addEventListener('keydown', (event) => {
      if (this.minimized) return;
      const changes = {
        ArrowLeft: [-10, 0],
        ArrowRight: [10, 0],
        ArrowUp: [0, -10],
        ArrowDown: [0, 10],
      };
      const change = changes[event.key];
      if (!change) return;
      event.preventDefault();
      this._applyBounds({
        ...this._bounds,
        width: this._bounds.width + change[0],
        height: this._bounds.height + change[1],
      });
    });
    this.root.addEventListener('keydown', (event) => {
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        !this.characterContent.settingsPanel.hidden
      ) {
        event.preventDefault();
        this._setSettingsOpen(false, true);
      }
      event.stopPropagation();
    });
    for (const type of ['mousedown', 'mouseup', 'wheel', 'contextmenu']) {
      this.root.addEventListener(type, (event) => event.stopPropagation());
    }
  }

  // ── Tab Selection & Naming ─────────────────────────────────
  _select(token, { syncToken = false } = {}) {
    if (!this.gameManager.placedTokens.includes(token)) {
      throw new Error('Cannot open a character sheet for a creature no longer in this session');
    }
    if (this.activeToken !== token) {
      this._commitNameEdit();
      this.heading.blur();
      this._setSettingsOpen(false);
    }
    if (!this.tabs.has(token)) this._addTab(token);
    this.activeToken = token;
    for (const [entry, tab] of this.tabs) {
      const selected = entry === token;
      tab.button.setAttribute('aria-selected', String(selected));
      tab.button.tabIndex = selected ? 0 : -1;
    }
    this.panel.setAttribute('aria-labelledby', this.tabs.get(token).button.id);
    if (!this.root.hidden && !this.minimized) {
      this.tabs.get(token).button.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
    this._refreshNames();
    this.ready = this.characterContent.show(token);
    this._syncNameEditing();
    void this.ready.then(() => {
      if (!this._destroyed && this.activeToken === token) this._syncNameEditing();
    });
    if (syncToken) {
      void this._selectMapToken(token);
      this._focusCamera(token);
    }
  }

  _focusCamera(token) {
    const manager = this.gameManager.threeSceneManager;
    if (typeof manager?.setCameraTarget !== 'function') return;
    try {
      const world =
        this.gameManager.token3DAdapter?._resolveTokenWorldPosition?.(token) || token.world;
      if (!world || ![world.x, world.y, world.z].every(Number.isFinite)) {
        throw new Error('Creature camera focus requires a valid current world position');
      }
      manager.setCameraTarget(world.x, world.z, world.y);
    } catch (error) {
      new ErrorHandler().handle(error, ERROR_SEVERITY.ERROR, ERROR_CATEGORY.UI, {
        component: 'CharacterSheetWindow',
        operation: 'focusCreature',
        tokenId: token.id,
      });
    }
  }

  async _selectMapToken(token) {
    try {
      const adapter = this.gameManager.token3DAdapter;
      if (typeof adapter?.setSelectedToken !== 'function') {
        throw new Error('Creature selection is not available before the 3D scene is ready');
      }
      if (adapter.getSelectedToken?.() !== token) {
        await adapter.setSelectedToken(token);
      }
    } catch (error) {
      new ErrorHandler().handle(error, ERROR_SEVERITY.ERROR, ERROR_CATEGORY.UI, {
        component: 'CharacterSheetWindow',
        operation: 'selectCreature',
        tokenId: token.id,
      });
    }
  }

  _addTab(token) {
    const item = document.createElement('div');
    item.className = 'character-sheet-tab-item';
    const button = document.createElement('button');
    button.type = 'button';
    button.id = `character-sheet-tab-${++this._nextTabId}`;
    button.className = 'character-sheet-tab';
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', this.panel.id);
    button.addEventListener('click', () => this._select(token, { syncToken: true }));
    button.addEventListener('keydown', (event) => this._handleTabKey(event, token));
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'character-sheet-tab-close';
    close.textContent = 'x';
    close.addEventListener('click', () => this.closeTab(token));
    item.append(button, close);
    this.tablist.appendChild(item);
    this.tabs.set(token, { item, button, close });
  }

  _refreshNames() {
    for (const [token, tab] of this.tabs) {
      const name = getTokenDisplayName(token);
      tab.button.textContent = name;
      tab.close.setAttribute('aria-label', `Close ${name} sheet`);
    }
    if (this.activeToken && this._nameEdit?.token !== this.activeToken)
      this.heading.textContent = getTokenDisplayName(this.activeToken);
  }

  _syncNameEditing() {
    const editable = !!(this.activeToken?.characterSheetId && this.characterContent.services);
    this.heading.setAttribute('contenteditable', editable ? 'plaintext-only' : 'false');
    this.heading.setAttribute('aria-readonly', String(!editable));
  }

  _commitNameEdit() {
    const edit = this._nameEdit;
    if (!edit) return this.renameReady;
    this._nameEdit = null;
    const text = this.heading.textContent.replace(/[\r\n]+/g, ' ');
    if (text === edit.original) {
      this._refreshNames();
      return this.renameReady;
    }
    this.renameReady = Promise.resolve(
      this.characterContent.rename(edit.token, text, edit.characterId)
    ).then((saved) => {
      if (!this._destroyed) this._refreshNames();
      return saved;
    });
    return this.renameReady;
  }

  _setSettingsOpen(open, focus = false) {
    this.characterContent.setSettingsOpen(open);
    this.settingsButton.setAttribute('aria-expanded', String(open));
    if (focus) this.settingsButton.focus({ preventScroll: true });
  }

  _handleTabKey(event, token) {
    const tokens = [...this.tabs.keys()];
    const index = tokens.indexOf(token);
    const choices = {
      ArrowLeft: (index + tokens.length - 1) % tokens.length,
      ArrowRight: (index + 1) % tokens.length,
      Home: 0,
      End: tokens.length - 1,
    };
    if (!(event.key in choices)) return;
    event.preventDefault();
    const next = tokens[choices[event.key]];
    this._select(next, { syncToken: true });
    this.tabs.get(next).button.focus();
  }

  // ── Dragging, Resizing & Viewport Bounds ────────────────────
  _applyBounds(bounds) {
    const availableWidth = Math.max(1, window.innerWidth - VIEWPORT_MARGIN * 2);
    const availableHeight = Math.max(1, window.innerHeight - VIEWPORT_MARGIN * 2);
    const width = Math.min(
      availableWidth,
      Math.max(Math.min(MIN_WIDTH, availableWidth), bounds.width)
    );
    const height = Math.min(
      availableHeight,
      Math.max(Math.min(MIN_HEIGHT, availableHeight), bounds.height)
    );
    const visibleHeight = this.minimized ? Math.min(MINIMIZED_HEIGHT, availableHeight) : height;
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(bounds.left, window.innerWidth - width - VIEWPORT_MARGIN)
    );
    const top = Math.max(
      VIEWPORT_MARGIN,
      Math.min(bounds.top, window.innerHeight - visibleHeight - VIEWPORT_MARGIN)
    );
    this._bounds = { left, top, width, height };
    for (const [property, value] of Object.entries({ ...this._bounds, height: visibleHeight })) {
      this.root.style[property] = `${value}px`;
    }
    this.root.style.setProperty('--sheet-window-height', `${height}px`);
  }

  _startGesture(event, kind) {
    if (event.button !== 0 || (kind === 'resize' && this.minimized)) return;
    this._endGesture();
    this._gesture = {
      kind,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      bounds: { ...this._bounds },
      handle: event.currentTarget,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerEnd);
    window.addEventListener('pointercancel', this._onPointerEnd);
    event.preventDefault();
    event.stopPropagation();
  }

  _moveGesture(event) {
    const gesture = this._gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    const bounds = gesture.bounds;
    this._applyBounds(
      gesture.kind === 'move'
        ? { ...bounds, left: bounds.left + dx, top: bounds.top + dy }
        : {
            ...bounds,
            width: Math.min(bounds.width + dx, window.innerWidth - bounds.left - VIEWPORT_MARGIN),
            height: Math.min(bounds.height + dy, window.innerHeight - bounds.top - VIEWPORT_MARGIN),
          }
    );
    event.preventDefault();
  }

  _endGesture() {
    const gesture = this._gesture;
    if (gesture?.handle.hasPointerCapture?.(gesture.pointerId)) {
      gesture.handle.releasePointerCapture(gesture.pointerId);
    }
    this._gesture = null;
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerEnd);
    window.removeEventListener('pointercancel', this._onPointerEnd);
  }
}
