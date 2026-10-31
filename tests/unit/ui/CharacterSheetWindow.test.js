import CharacterSheetWindow from '../../../src/ui/components/CharacterSheetWindow.js';
import { TokenManager } from '../../../src/managers/TokenManager.js';
import { installSelectionMethods } from '../../../src/scene/token-adapter/SelectionEffects.js';
import { ErrorHandler } from '../../../src/utils/error/ErrorHandler.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { CompendiumCatalog } from '../../../src/entities/characters/CompendiumCatalog.js';
import { getTokenMovementSettings } from '../../../src/entities/creatures/TokenMovement.js';

describe('Tabbed in-app character sheets', () => {
  let gameManager;
  let manager;
  let sheets;
  const originalViewport = { width: window.innerWidth, height: window.innerHeight };

  function movementControl(label) {
    return sheets.root.querySelector(`[aria-label="${label}"]`);
  }

  function addToken() {
    manager.addTokenToCollection({}, manager.placedTokens.length + 1, 1);
    return manager.placedTokens.at(-1);
  }

  function selectToken(token) {
    window.dispatchEvent(
      new CustomEvent('taverntable:tokenSelected', { detail: { token, gameManager } })
    );
  }

  function attachSelectionAdapter() {
    const adapter = { gameManager, _selectedToken: null };
    installSelectionMethods(adapter);
    adapter._refreshVisualState = jest.fn(async () => {});
    gameManager.token3DAdapter = adapter;
    return adapter;
  }

  function pointer(target, type, clientX, clientY) {
    target.dispatchEvent(
      new MouseEvent(type, { button: 0, clientX, clientY, bubbles: true, cancelable: true })
    );
  }

  beforeEach(() => {
    localStorage.clear();
    gameManager = {
      get placedTokens() {
        return manager.placedTokens;
      },
    };
    manager = new TokenManager(gameManager);
    attachSelectionAdapter();
    const catalog = new CompendiumCatalog({
      ...{ version: 1, entries: [], classes: [] },
      ruleset: '2014',
    });
    const characterServices = {
      catalog,
      library: new CharacterLibrary({
        ruleset: '2014',
        catalog: catalog.entries,
        classes: catalog.classes,
        storage: localStorage,
      }),
    };
    sheets = new CharacterSheetWindow({ gameManager, characterServices }).attach();
  });

  afterEach(() => {
    sheets.destroy();
    window.innerWidth = originalViewport.width;
    window.innerHeight = originalViewport.height;
  });

  test('opens a named character once per token in one non-modal window', () => {
    const token = addToken();
    sheets.open(token);
    sheets.open(token);

    expect(document.querySelectorAll('.character-sheet-window')).toHaveLength(1);
    expect(sheets.root.hidden).toBe(false);
    expect(sheets.root.getAttribute('aria-modal')).toBe('false');
    expect(sheets.root.querySelectorAll('[role="tab"]')).toHaveLength(1);
    expect(sheets.heading.textContent).toBe('Mannequin');
    expect(sheets.panel.textContent).toContain('Compendium');
    expect(movementControl('Character speed (feet)').value).toBe('30');
    expect(movementControl('Walk movement').getAttribute('aria-pressed')).toBe('true');
    expect(movementControl('Movement type').value).toBe('default');
  });

  test('keeps only an editable plain-text title and moves character management behind a gear', async () => {
    await sheets.open(addToken());
    const gear = sheets.root.querySelector('button[aria-label="Character settings"]');
    expect(gear).not.toBeNull();
    const settings = sheets.root.querySelector('section[aria-label="Character settings"]');
    expect(settings.hidden).toBe(true);
    expect(gear.getAttribute('aria-expanded')).toBe('false');
    expect(sheets.heading.getAttribute('contenteditable')).toBe('plaintext-only');
    expect(sheets.heading.getAttribute('aria-label')).toBe('Character name');
    expect(sheets.characterContent.main.querySelector('[data-character-field="name"]')).toBeNull();
    expect(settings.contains(sheets.characterContent.librarySelect)).toBe(true);
    for (const action of ['new', 'export', 'import', 'delete', 'compendium'])
      expect(settings.querySelector(`[data-sheet-action="${action}"]`)).not.toBeNull();
    gear.click();
    expect(settings.hidden).toBe(false);
    expect(gear.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(sheets.characterContent.librarySelect);
    sheets.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(settings.hidden).toBe(true);
    expect(document.activeElement).toBe(gear);
  });

  test('the title saves plain text with Enter or blur, while Escape cancels the draft', async () => {
    const token = addToken();
    await sheets.open(token);
    const id = token.characterSheetId;
    const library = gameManager.characterServices.library;
    sheets.heading.focus();
    sheets.heading.textContent = '  Sentinel  ';
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    sheets.heading.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    await sheets.renameReady;
    expect(library.get(id).name).toBe('Sentinel');
    expect(sheets.heading.textContent).toBe('Sentinel');
    expect(sheets.tabs.get(token).button.textContent).toBe('Sentinel');
    sheets.heading.focus();
    sheets.heading.textContent = 'Cancelled';
    sheets.heading.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
    await sheets.renameReady;
    expect(library.get(id).name).toBe('Sentinel');
    expect(sheets.heading.textContent).toBe('Sentinel');
    sheets.heading.focus();
    sheets.heading.textContent = 'North\nSentinel';
    sheets.heading.blur();
    await sheets.renameReady;
    expect(library.get(id).name).toBe('North Sentinel');
    expect(sheets.heading.textContent).toBe('North Sentinel');
    expect(sheets._gesture).toBeNull();
  });

  test('the plain-text title accepts 100 characters and reports longer names without changing the saved value', async () => {
    const token = addToken();
    await sheets.open(token);
    const error = jest.spyOn(ErrorHandler.prototype, 'handle').mockImplementation(() => {});
    try {
      sheets.heading.focus();
      sheets.heading.textContent = 'N'.repeat(100);
      sheets.heading.blur();
      expect(await sheets.renameReady).toBe(true);
      sheets.heading.focus();
      sheets.heading.textContent = 'N'.repeat(101);
      sheets.heading.blur();
      expect(await sheets.renameReady).toBe(false);
      expect(error).toHaveBeenCalled();
      expect(gameManager.characterServices.library.get(token.characterSheetId).name).toBe(
        'N'.repeat(100)
      );
      expect(sheets.heading.textContent).toBe('N'.repeat(100));
      expect(sheets.characterContent.settingsPanel.hidden).toBe(true);
      expect(sheets.characterContent.status.classList.contains('sheet-error')).toBe(true);
    } finally {
      error.mockRestore();
    }
  });

  test("Movement controls keep each creature's distance, mode, and type independent", () => {
    const first = addToken();
    const second = addToken();
    const refresh = jest.fn();
    const applyStyle = jest.fn();
    gameManager.token3DAdapter.refreshMovementRange = refresh;
    gameManager.token3DAdapter.applyMovementStyle = applyStyle;
    sheets.open(first);
    refresh.mockClear();
    movementControl('Character speed (feet)').value = '25';
    movementControl('Character speed (feet)').dispatchEvent(new Event('change', { bubbles: true }));
    expect(refresh).toHaveBeenCalled();
    refresh.mockClear();
    movementControl('Run movement').click();
    expect(refresh).toHaveBeenCalled();
    refresh.mockClear();
    movementControl('Movement type').value = 'drunk';
    movementControl('Movement type').dispatchEvent(new Event('change', { bubbles: true }));

    expect(getTokenMovementSettings(first)).toEqual({ speed: 25, mode: 'run', type: 'drunk' });
    expect(refresh).toHaveBeenCalled();
    expect(applyStyle).toHaveBeenCalledTimes(2);
    expect(applyStyle).toHaveBeenLastCalledWith(first);
    sheets.open(second);
    expect(movementControl('Character speed (feet)').value).toBe('30');
    expect(movementControl('Walk movement').getAttribute('aria-pressed')).toBe('true');
    expect(movementControl('Movement type').value).toBe('default');
    sheets.open(first);
    expect(movementControl('Character speed (feet)').value).toBe('25');
    expect(movementControl('Run movement').getAttribute('aria-pressed')).toBe('true');
    expect(movementControl('Movement type').value).toBe('drunk');
  });

  test.each(['-5', ''])(
    'an invalid movement speed %p reports an error and preserves the prior allowance',
    (value) => {
      const token = addToken();
      sheets.open(token);
      const error = jest.spyOn(ErrorHandler.prototype, 'handle').mockImplementation(() => {});
      try {
        movementControl('Character speed (feet)').value = value;
        movementControl('Character speed (feet)').dispatchEvent(
          new Event('change', { bubbles: true })
        );
        expect(error).toHaveBeenCalled();
        expect(movementControl('Character speed (feet)').value).toBe('30');
        expect(getTokenMovementSettings(token)).toEqual({
          speed: 30,
          mode: 'walk',
          type: 'default',
        });
      } finally {
        error.mockRestore();
      }
    }
  );

  test('an external speed edit refreshes the map range without discarding a focused field draft', () => {
    const token = addToken();
    const refresh = jest.fn();
    gameManager.token3DAdapter.refreshMovementRange = refresh;
    sheets.open(token);
    refresh.mockClear();
    const name = sheets.root.querySelector('[aria-label="Character name"]');
    name.focus();
    name.textContent = 'Uncommitted name';
    gameManager.characterServices.library.edit(token.characterSheetId, { speed: 20 });
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: `taverntable.character.v1.${token.characterSheetId}`,
        newValue: 'updated',
      })
    );
    expect(getTokenMovementSettings(token).speed).toBe(20);
    expect(refresh).toHaveBeenCalled();
    expect(name.textContent).toBe('Uncommitted name');
    expect(document.activeElement.getAttribute('aria-label')).toBe('Character name');
  });

  test('creates and selects a tab on token selection only while the window is visible', () => {
    const first = addToken();
    const second = addToken();
    selectToken(first);
    expect(sheets.tabs.size).toBe(0);
    expect(sheets.root.hidden).toBe(true);

    sheets.open(first);
    selectToken(second);
    expect(sheets.tabs.size).toBe(2);
    expect(sheets.activeToken).toBe(second);
    selectToken(first);
    expect(sheets.activeToken).toBe(first);

    sheets.hide();
    const third = addToken();
    selectToken(third);
    expect(sheets.root.hidden).toBe(true);
    expect(sheets.tabs.size).toBe(2);
    sheets.open(second);
    expect(sheets.tabs.size).toBe(2);
    expect(sheets.activeToken).toBe(second);
  });

  test('actual 3D selection updates sheets immediately, including reselecting a closed tab', async () => {
    const first = addToken();
    const second = addToken();
    const adapter = gameManager.token3DAdapter;
    sheets.open(first);

    await adapter.setSelectedToken(second);
    expect(sheets.activeToken).toBe(second);
    sheets.closeTab(second);
    expect(sheets.activeToken).toBe(first);
    await adapter.setSelectedToken(second);
    expect(sheets.activeToken).toBe(second);
    expect(adapter.getSelectedToken()).toBe(second);
  });

  test('placing another creature does not overwrite a saved shared character name or its sheet tab', () => {
    const first = addToken();
    sheets.open(first);
    expect(sheets.heading.textContent).toBe('Mannequin');
    addToken();
    expect(sheets.heading.textContent).toBe('Mannequin');
    expect(sheets.tabs.get(first).button.textContent).toBe('Mannequin');
    expect(sheets.tabs.get(first).close.getAttribute('aria-label')).toBe('Close Mannequin sheet');
  });

  test('clicking a sheet tab selects that exact creature on the map', async () => {
    const first = addToken();
    const second = addToken();
    const adapter = attachSelectionAdapter();
    sheets.open(first);
    sheets.open(second);
    await adapter.setSelectedToken(second);
    const selection = jest.spyOn(adapter, 'setSelectedToken');

    sheets.tabs.get(first).button.click();

    expect(adapter.getSelectedToken()).toBe(first);
    expect(sheets.activeToken).toBe(first);
    expect(selection).toHaveBeenCalledTimes(1);
    expect(selection).toHaveBeenCalledWith(first);
  });

  test('keyboard tab switching also selects the associated creature', async () => {
    const first = addToken();
    const second = addToken();
    const adapter = attachSelectionAdapter();
    sheets.open(first);
    sheets.open(second);
    await adapter.setSelectedToken(second);

    sheets.tabs
      .get(second)
      .button.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
      );

    expect(adapter.getSelectedToken()).toBe(first);
    expect(sheets.activeToken).toBe(first);
  });

  test('opening a character sheet selects its creature without creating a selection feedback loop', () => {
    const token = addToken();
    const adapter = attachSelectionAdapter();
    const selection = jest.spyOn(adapter, 'setSelectedToken');

    sheets.open(token);
    sheets.open(token);

    expect(adapter.getSelectedToken()).toBe(token);
    expect(selection).toHaveBeenCalledTimes(1);
    expect(sheets.tabs.size).toBe(1);
  });

  test('explicit tab selection focuses the current token position, but passive map selection does not', async () => {
    const first = addToken();
    const second = addToken();
    first.world = { x: 2.5, y: 1.2, z: 4.5 };
    second.world = { x: 14.5, y: 7.2, z: 10.5 };
    const focus = jest.fn();
    const zoom = jest.fn();
    gameManager.threeSceneManager = { setCameraTarget: focus, setZoom: zoom };
    sheets.open(first);
    sheets.open(second);
    focus.mockClear();
    first.world = { x: 3.1, y: 2, z: 5.2 };

    sheets.tabs.get(first).button.click();

    expect(focus).toHaveBeenCalledWith(3.1, 5.2, 2);
    expect(zoom).not.toHaveBeenCalled();
    sheets.minimize();
    focus.mockClear();
    await gameManager.token3DAdapter.setSelectedToken(second);
    expect(focus).not.toHaveBeenCalled();
    expect(sheets.minimized).toBe(true);
    sheets.restore();
    sheets.tabs
      .get(second)
      .button.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
      );
    expect(focus).toHaveBeenLastCalledWith(3.1, 5.2, 2);
    sheets.hide();
    focus.mockClear();
    await gameManager.token3DAdapter.setSelectedToken(second);
    expect(focus).not.toHaveBeenCalled();
    expect(sheets.root.hidden).toBe(true);
  });

  test('delayed selection visuals cannot refocus the camera onto an older tab', async () => {
    const first = addToken();
    const second = addToken();
    first.world = { x: 2, y: 3, z: 4 };
    second.world = { x: 7, y: 8, z: 9 };
    const focus = jest.fn();
    const pending = [];
    gameManager.threeSceneManager = { setCameraTarget: focus };
    gameManager.token3DAdapter.getSelectedToken = () => null;
    gameManager.token3DAdapter.setSelectedToken = () =>
      new Promise((resolve) => pending.push(resolve));
    sheets.open(first);
    sheets.open(second);
    pending[1]();
    await Promise.resolve();
    pending[0]();
    await Promise.resolve();
    expect(focus).toHaveBeenLastCalledWith(7, 9, 8);
  });

  test('closing the window preserves tabs, active sheet, position, and dimensions', () => {
    const token = addToken();
    sheets.open(token);
    const header = sheets.root.querySelector('header');
    pointer(header, 'pointerdown', 100, 140);
    pointer(window, 'pointermove', 160, 180);
    pointer(window, 'pointerup', 160, 180);
    const resize = sheets.root.querySelector('.character-sheet-resize');
    pointer(resize, 'pointerdown', 550, 450);
    pointer(window, 'pointermove', 600, 490);
    pointer(window, 'pointerup', 600, 490);
    const style = sheets.root.getAttribute('style');

    sheets.root.querySelector('.character-sheet-window-close').click();
    expect(sheets.root.hidden).toBe(true);
    sheets.open(token);
    expect(sheets.root.getAttribute('style')).toBe(style);
    expect(sheets.tabs.size).toBe(1);
    expect(sheets.activeToken).toBe(token);
  });

  test('Minimize collapses to the title bar and Restore keeps the original size and tabs', () => {
    const first = addToken();
    const second = addToken();
    sheets.open(first);
    sheets.open(second);
    const style = sheets.root.getAttribute('style');
    const toggle = sheets.root.querySelector('.character-sheet-window-minimize');
    const close = sheets.root.querySelector('.character-sheet-window-close');
    expect(toggle.textContent).toBe('\u2212');
    expect(toggle.title).toBe('Minimize');
    expect(close.textContent).toBe('\u00d7');
    expect(close.title).toBe('Close');
    expect(close.getAttribute('aria-label')).toBe('Close character sheets');

    toggle.click();

    expect(sheets.minimized).toBe(true);
    expect(sheets.root.hidden).toBe(false);
    expect(sheets.root.style.height).toBe('48px');
    expect(sheets.root.dataset.minimized).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('Restore character sheets');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toBe('\u25a1');
    expect(toggle.title).toBe('Restore');
    expect(sheets.tabs.size).toBe(2);
    toggle.click();
    expect(sheets.minimized).toBe(false);
    expect(toggle.textContent).toBe('\u2212');
    expect(toggle.title).toBe('Minimize');
    expect(sheets.root.getAttribute('style')).toBe(style);
    expect(sheets.activeToken).toBe(second);
  });

  test('the minimized title bar can move without losing the full restored dimensions', () => {
    sheets.open(addToken());
    sheets.minimize();
    pointer(sheets.root.querySelector('header'), 'pointerdown', 100, 140);
    pointer(window, 'pointermove', 180, 190);
    pointer(window, 'pointerup', 180, 190);

    expect(sheets.root.style.left).toBe('160px');
    expect(sheets.root.style.top).toBe('170px');
    expect(sheets.root.style.height).toBe('48px');
    sheets.restore();
    expect(sheets.root.style.left).toBe('160px');
    expect(sheets.root.style.top).toBe('170px');
    expect(sheets.root.style.width).toBe('480px');
    expect(sheets.root.style.height).toBe('360px');
  });

  test('map selection updates a minimized sheet without restoring it', async () => {
    const first = addToken();
    const second = addToken();
    sheets.open(first);
    sheets.minimize();

    await gameManager.token3DAdapter.setSelectedToken(second);

    expect(sheets.minimized).toBe(true);
    expect(sheets.root.style.height).toBe('48px');
    expect(sheets.activeToken).toBe(second);
    expect(sheets.tabs.size).toBe(2);
    sheets.restore();
    expect(sheets.heading.textContent).toBe('Mannequin 2');
    expect(gameManager.token3DAdapter.getSelectedToken()).toBe(second);
  });

  test('explicit sheet opening restores a minimized window, including after Close', () => {
    const first = addToken();
    const second = addToken();
    sheets.open(first);
    sheets.minimize();
    sheets.open(second);
    expect(sheets.minimized).toBe(false);
    expect(sheets.root.style.height).toBe('360px');
    expect(sheets.activeToken).toBe(second);
    sheets.minimize();
    sheets.root.querySelector('.character-sheet-window-close').click();
    expect(sheets.root.hidden).toBe(true);
    sheets.open(first);
    expect(sheets.root.hidden).toBe(false);
    expect(sheets.minimized).toBe(false);
    expect(sheets.tabs.size).toBe(2);
  });

  test('restoring a title bar dragged to the bottom keeps the full window in the viewport', () => {
    sheets.open(addToken());
    sheets.minimize();
    pointer(sheets.root.querySelector('header'), 'pointerdown', 100, 140);
    pointer(window, 'pointermove', 100, 4000);
    pointer(window, 'pointerup', 100, 4000);

    expect(parseFloat(sheets.root.style.top)).toBe(window.innerHeight - 48 - 8);
    sheets.restore();
    expect(sheets.root.style.height).toBe('360px');
    expect(parseFloat(sheets.root.style.top)).toBe(window.innerHeight - 360 - 8);
  });

  test('hidden resize controls cannot change the saved full size while minimized', () => {
    sheets.open(addToken());
    sheets.minimize();
    const resize = sheets.root.querySelector('.character-sheet-resize');
    pointer(resize, 'pointerdown', 500, 370);
    pointer(window, 'pointermove', 600, 500);
    pointer(window, 'pointerup', 600, 500);
    resize.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    );

    sheets.restore();
    expect(sheets.root.style.width).toBe('480px');
    expect(sheets.root.style.height).toBe('360px');
  });

  test('closes individual tabs, selecting an adjacent tab and hiding after the last one', () => {
    const first = addToken();
    const second = addToken();
    sheets.open(first);
    sheets.open(second);
    sheets.tabs.get(second).close.click();
    expect(sheets.activeToken).toBe(first);
    expect(gameManager.token3DAdapter.getSelectedToken()).toBe(first);
    expect(sheets.tabs.size).toBe(1);
    sheets.tabs.get(first).close.click();
    expect(sheets.tabs.size).toBe(0);
    expect(sheets.root.hidden).toBe(true);
  });

  test('token deletion removes only its tab, including while the window is closed', () => {
    const first = addToken();
    const second = addToken();
    sheets.open(first);
    sheets.open(second);
    sheets.hide();
    manager.removeToken(second);
    expect(sheets.root.hidden).toBe(true);
    expect(sheets.tabs.has(second)).toBe(false);
    expect(sheets.activeToken).toBe(first);
    manager.removeToken(first);
    expect(sheets.tabs.size).toBe(0);
  });

  test('hidden-window tab cleanup does not select a different creature on the map', async () => {
    const first = addToken();
    const second = addToken();
    const adapter = gameManager.token3DAdapter;
    sheets.open(first);
    sheets.open(second);
    sheets.hide();
    await adapter.setSelectedToken(null);
    const selection = jest.spyOn(adapter, 'setSelectedToken');

    manager.removeToken(second);

    expect(sheets.root.hidden).toBe(true);
    expect(sheets.activeToken).toBe(first);
    expect(adapter.getSelectedToken()).toBeNull();
    expect(selection).not.toHaveBeenCalled();
  });

  test('tab keyboard navigation switches sheets without moving the map', () => {
    const first = addToken();
    const second = addToken();
    sheets.open(first);
    sheets.open(second);
    const mapKeys = jest.fn();
    document.addEventListener('keydown', mapKeys);
    try {
      sheets.tabs
        .get(second)
        .button.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
        );
      expect(sheets.activeToken).toBe(first);
      expect(document.activeElement).toBe(sheets.tabs.get(first).button);
      expect(mapKeys).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', mapKeys);
    }
  });

  test('moves and resizes within viewport bounds and remains reachable after viewport shrink', () => {
    sheets.open(addToken());
    const header = sheets.root.querySelector('header');
    pointer(header, 'pointerdown', 100, 140);
    pointer(window, 'pointermove', -200, -200);
    pointer(window, 'pointerup', -200, -200);
    expect(sheets.root.style.left).toBe('8px');
    expect(sheets.root.style.top).toBe('8px');

    const resize = sheets.root.querySelector('.character-sheet-resize');
    pointer(resize, 'pointerdown', 500, 370);
    pointer(window, 'pointermove', 4000, 3000);
    pointer(window, 'pointerup', 4000, 3000);
    expect(parseFloat(sheets.root.style.width)).toBe(window.innerWidth - 16);
    expect(parseFloat(sheets.root.style.height)).toBe(window.innerHeight - 16);

    window.innerWidth = 240;
    window.innerHeight = 180;
    window.dispatchEvent(new Event('resize'));
    expect(sheets.root.style.width).toBe('224px');
    expect(sheets.root.style.height).toBe('164px');
    expect(sheets.root.style.left).toBe('8px');
    expect(sheets.root.style.top).toBe('8px');
  });

  test('closing during a gesture removes its global pointer handlers', () => {
    sheets.open(addToken());
    pointer(sheets.root.querySelector('header'), 'pointerdown', 100, 140);
    sheets.hide();
    const style = sheets.root.getAttribute('style');
    pointer(window, 'pointermove', 600, 500);
    expect(sheets.root.getAttribute('style')).toBe(style);
  });

  test('resizing respects minimum dimensions and supports keyboard arrows', () => {
    sheets.open(addToken());
    const resize = sheets.root.querySelector('.character-sheet-resize');
    pointer(resize, 'pointerdown', 500, 370);
    pointer(window, 'pointermove', -2000, -2000);
    pointer(window, 'pointerup', -2000, -2000);
    expect(sheets.root.style.width).toBe('280px');
    expect(sheets.root.style.height).toBe('220px');

    resize.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    );
    resize.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    );
    expect(sheets.root.style.width).toBe('290px');
    expect(sheets.root.style.height).toBe('230px');
  });

  test('losing browser focus ends a drag rather than leaving it stuck', () => {
    sheets.open(addToken());
    pointer(sheets.root.querySelector('header'), 'pointerdown', 100, 140);
    window.dispatchEvent(new Event('blur'));
    const style = sheets.root.getAttribute('style');
    pointer(window, 'pointermove', 600, 500);
    expect(sheets.root.getAttribute('style')).toBe(style);
  });

  test('rejects a stale or removed token instead of opening a ghost tab', () => {
    const token = addToken();
    manager.removeToken(token);
    expect(() => sheets.open(token)).toThrow(/no longer in this session/);
    expect(sheets.tabs.size).toBe(0);
  });
});
