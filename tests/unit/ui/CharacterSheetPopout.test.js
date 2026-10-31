import CharacterSheetWindow from '../../../src/ui/components/CharacterSheetWindow.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { CompendiumCatalog } from '../../../src/entities/characters/CompendiumCatalog.js';
import { installSelectionMethods } from '../../../src/scene/token-adapter/SelectionEffects.js';
import { getTokenMovementSettings } from '../../../src/entities/creatures/TokenMovement.js';
import { notifyCharacterChanged } from '../../../src/ui/characters/characterServices.js';
import { ErrorHandler } from '../../../src/utils/error/ErrorHandler.js';
import snapshot from '../../../assets/data/srd2014.json';

describe('Character sheet pop-out windows', () => {
  let sheets;
  let gameManager;
  let library;
  let hero;
  let scout;
  let frame;
  let popout;
  let openWindow;
  let sourceLink;
  let sourceStyle;
  const originalViewport = { width: window.innerWidth, height: window.innerHeight };
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const control = (label) => sheets.root.querySelector(`[aria-label="${label}"]`);

  beforeEach(() => {
    localStorage.clear();
    hero = { id: 'hero', type: 'knight', name: 'Hero', world: { x: 1, y: 0, z: 1 } };
    scout = { id: 'scout', type: 'mannequin', name: 'Scout', world: { x: 2, y: 0, z: 2 } };
    gameManager = {
      placedTokens: [hero, scout],
      threeSceneManager: { setCameraTarget: jest.fn() },
    };
    const adapter = {
      gameManager,
      _selectedToken: null,
      _refreshVisualState: jest.fn(async () => {}),
      refreshMovementRange: jest.fn(),
      isMovementInProgress: () => false,
    };
    installSelectionMethods(adapter);
    gameManager.token3DAdapter = adapter;
    const catalog = new CompendiumCatalog({ ...snapshot, ruleset: '2014' });
    library = new CharacterLibrary({
      ruleset: '2014',
      storage: localStorage,
      catalog: catalog.entries,
      classes: catalog.classes,
    });
    sheets = new CharacterSheetWindow({
      gameManager,
      characterServices: { catalog, library },
    }).attach();
    frame = document.createElement('iframe');
    document.body.append(frame);
    popout = frame.contentWindow;
    Object.defineProperty(popout, 'closed', { value: false, writable: true });
    jest.spyOn(popout, 'focus').mockImplementation(() => {});
    jest.spyOn(popout, 'close').mockImplementation(() => {
      popout.closed = true;
    });
    jest.spyOn(popout, 'confirm').mockReturnValue(false);
    jest.spyOn(window, 'focus').mockImplementation(() => {});
    jest.spyOn(window, 'confirm').mockReturnValue(false);
    openWindow = jest.spyOn(window, 'open').mockReturnValue(popout);
    sourceLink = document.createElement('link');
    sourceLink.rel = 'stylesheet';
    sourceLink.href = 'character-sheet.css';
    sourceStyle = document.createElement('style');
    sourceStyle.textContent = 'body { margin: 0; }';
    document.head.append(sourceLink, sourceStyle);
  });

  afterEach(() => {
    sheets.destroy();
    frame.remove();
    sourceLink.remove();
    sourceStyle.remove();
    window.innerWidth = originalViewport.width;
    window.innerHeight = originalViewport.height;
    jest.restoreAllMocks();
    document.body.replaceChildren();
  });

  test('the title-bar control moves the same live sheet and every tab into a styled browser window', async () => {
    await sheets.open(hero);
    await sheets.open(scout);
    const root = sheets.root;
    const content = sheets.characterContent;
    const services = gameManager.characterServices;
    sheets.popoutButton.click();

    expect(openWindow).toHaveBeenCalledWith(
      '',
      '_blank',
      expect.stringContaining('popup=yes,width=480,height=360')
    );
    expect(popout.document.body.querySelector('.character-sheet-window')).toBe(root);
    expect(root.ownerDocument).toBe(popout.document);
    expect(document.querySelector('.character-sheet-window')).toBeNull();
    expect(sheets.characterContent).toBe(content);
    expect(gameManager.characterServices).toBe(services);
    expect(sheets.tabs.size).toBe(2);
    expect(sheets.activeToken).toBe(scout);
    expect(sheets.popoutButton.textContent).toBe('Dock');
    expect(popout.document.title).toBe('Scout - Character sheets - TavernTable');
    expect(popout.document.documentElement.lang).toBe(document.documentElement.lang);
    expect(popout.document.querySelector('base').href).toBe(document.baseURI);
    expect(popout.document.querySelector('link[rel="stylesheet"]').href).toBe(sourceLink.href);
    expect(popout.document.querySelector('style').textContent).toBe(sourceStyle.textContent);
    expect(popout.document.querySelector('script')).toBeNull();
  });

  test('opening another character or requesting another pop-out reuses and focuses the existing window', async () => {
    await sheets.open(hero);
    expect(sheets.popOut()).toBe(true);
    expect(sheets.popOut()).toBe(true);
    await sheets.open(scout);

    expect(openWindow).toHaveBeenCalledTimes(1);
    expect(popout.focus).toHaveBeenCalledTimes(3);
    expect(sheets.activeToken).toBe(scout);
    expect(popout.document.activeElement).toBe(sheets.tabs.get(scout).button);
  });

  test('map selection and pop-out tabs remain synchronized through the real selection events', async () => {
    await sheets.open(hero);
    sheets.popOut();
    gameManager.threeSceneManager.setCameraTarget.mockClear();
    await gameManager.token3DAdapter.setSelectedToken(scout);
    await sheets.ready;

    expect(sheets.activeToken).toBe(scout);
    expect(sheets.tabs.get(scout).button.getAttribute('aria-selected')).toBe('true');
    expect(gameManager.threeSceneManager.setCameraTarget).not.toHaveBeenCalled();
    sheets.tabs.get(hero).button.click();
    await sheets.ready;
    expect(gameManager.token3DAdapter.getSelectedToken()).toBe(hero);
    expect(gameManager.threeSceneManager.setCameraTarget).toHaveBeenCalledWith(1, 1, 0);
    expect(popout.document.title).toBe('Hero - Character sheets - TavernTable');
  });

  test('renaming, speed edits and HP adjustments in the pop-out update the original character and map', async () => {
    await sheets.open(hero);
    library.edit(hero.characterSheetId, { hp: { current: 10, max: 10, temp: 0 } });
    await sheets.open(hero);
    sheets.popOut();
    sheets.heading.focus();
    sheets.heading.textContent = 'Sentinel';
    sheets.heading.dispatchEvent(
      new popout.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
    expect(await sheets.renameReady).toBe(true);
    expect(library.get(hero.characterSheetId).name).toBe('Sentinel');
    expect(sheets.tabs.get(hero).button.textContent).toBe('Sentinel');
    expect(popout.document.title).toBe('Sentinel - Character sheets - TavernTable');

    const speed = control('Character speed (feet)');
    speed.value = '25';
    speed.dispatchEvent(new popout.Event('change', { bubbles: true }));
    expect(library.get(hero.characterSheetId).speed).toBe(25);
    expect(getTokenMovementSettings(hero).speed).toBe(25);
    expect(gameManager.token3DAdapter.refreshMovementRange).toHaveBeenCalled();

    control('Damage hit points').click();
    control('Damage amount').value = '3';
    sheets.characterContent.healthBar.editor.dispatchEvent(
      new popout.Event('submit', { bubbles: true, cancelable: true })
    );
    await flush();
    expect(library.get(hero.characterSheetId).hp.current).toBe(7);
    expect(control('Hit point total').textContent).toBe('7 / 10');
  });

  test('pop-out combat controls spend the original game budgets and update its shared history', async () => {
    await sheets.open(hero);
    sheets.popOut();
    sheets.root.querySelector('[data-sheet-section="combat"]').click();
    control('Start turn').click();
    sheets.root.querySelector('[data-action-id="dash"]').click();
    await flush();

    expect(gameManager.characterServices.combat.status(hero).actions).toBe(0);
    expect(sheets.root.querySelector('[data-history-entry]').textContent).toContain('Dash');
    expect(control('End turn')).not.toBeNull();
  });

  test('an in-flight shared dice roll completes in the pop-out and survives docking without a second roll', async () => {
    const dice = await import('../../../src/systems/dice/dice.js');
    let finishRoll;
    const roll = jest.spyOn(dice, 'rollDiceExpression').mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRoll = resolve;
        })
    );
    await sheets.open(hero);
    control('Roll Initiative').click();
    await flush();
    expect(roll).toHaveBeenCalledTimes(1);
    sheets.popOut();
    finishRoll({ cancelled: false, text: 'Initiative = 15', values: [15], total: 15 });
    await flush();

    expect(control('Character roll result').textContent).toBe('Initiative = 15');
    expect(sheets.root.querySelector('[data-history-entry]').textContent).toContain(
      'Initiative = 15'
    );
    sheets.dock();
    expect(control('Character roll result').textContent).toBe('Initiative = 15');
    expect(roll).toHaveBeenCalledTimes(1);
  });

  test('main-window character updates preserve a focused pop-out field draft', async () => {
    await sheets.open(hero);
    sheets.popOut();
    const speed = control('Character speed (feet)');
    speed.focus();
    speed.value = '42';
    library.edit(hero.characterSheetId, { speed: 20 });
    notifyCharacterChanged(gameManager, hero.characterSheetId);

    expect(control('Character speed (feet)')).toBe(speed);
    expect(speed.value).toBe('42');
    expect(popout.document.activeElement).toBe(speed);
    expect(sheets.characterContent.status.textContent).toContain('Finish this field');
  });

  test('reselecting the same map creature preserves a focused pop-out field draft', async () => {
    await sheets.open(hero);
    sheets.popOut();
    const speed = control('Character speed (feet)');
    speed.focus();
    speed.value = '42';
    await gameManager.token3DAdapter.setSelectedToken(hero);
    await sheets.ready;

    expect(speed.value).toBe('42');
    expect(popout.document.activeElement).toBe(speed);
  });

  test('switching map creatures blurs the old pop-out field before changing characters', async () => {
    await sheets.open(hero);
    sheets.popOut();
    const speed = control('Character speed (feet)');
    const previousCharacterAtBlur = [];
    speed.addEventListener('blur', () => {
      previousCharacterAtBlur.push(sheets.characterContent.token === hero);
    });
    speed.focus();
    await gameManager.token3DAdapter.setSelectedToken(scout);
    await sheets.ready;

    expect(previousCharacterAtBlur).toEqual([true]);
    expect(sheets.activeToken).toBe(scout);
  });

  test('combat refreshes preserve a focused custom attack-count draft in the pop-out', async () => {
    await sheets.open(hero);
    sheets.popOut();
    sheets.root.querySelector('[data-sheet-section="combat"]').click();
    const editor = sheets.characterContent.customActions;
    editor.root.querySelector('details').open = true;
    editor.override.click();
    editor.attackCount.value = '7';
    editor.attackCount.focus();
    library.actions.setAttackCount(hero.characterSheetId, 3);
    notifyCharacterChanged(gameManager, hero.characterSheetId);

    expect(editor.attackCount.value).toBe('7');
    expect(editor.override.checked).toBe(true);
    expect(popout.document.activeElement).toBe(editor.attackCount);
  });

  test('rest-resource refreshes preserve a focused resource draft in the pop-out', async () => {
    await sheets.open(hero);
    library.edit(hero.characterSheetId, { classId: 'fighter', level: 5 });
    await sheets.open(hero);
    sheets.popOut();
    const rest = sheets.characterContent.restControls;
    rest.root.querySelector('[data-rest-action="resources"]').click();
    const resource = rest.resources.querySelector('input[data-rest-resource]');
    resource.focus();
    resource.value = '0';
    gameManager.characterServices.combat.startTurn(hero);

    expect(rest.resources.querySelector('input[data-rest-resource]')).toBe(resource);
    expect(resource.value).toBe('0');
    expect(popout.document.activeElement).toBe(resource);
  });

  test('character, custom ability, daily reset and layout confirmations belong to the pop-out', async () => {
    await sheets.open(hero);
    library.actions.upsert(hero.characterSheetId, { name: 'Signal', cost: 'free' });
    await sheets.open(hero);
    sheets.popOut();
    const content = sheets.characterContent;
    sheets.settingsButton.click();
    content.root.querySelector('[data-sheet-action="delete"]').click();
    content.customActions.rows.querySelector('[data-custom-action="delete"]').click();
    content.restControls.root.querySelector('[data-rest-action="daily"]').click();
    sheets.root.querySelector('[data-sheet-section="combat"]').click();
    sheets.root.querySelector('[data-play-layout-action="toggle"]').click();
    sheets.root.querySelector('[data-play-layout-action="reset"]').click();

    expect(popout.confirm).toHaveBeenCalledTimes(4);
    expect(window.confirm).not.toHaveBeenCalled();
    expect(library.get(hero.characterSheetId).name).toBe('Hero');
    expect(library.actions.list(hero.characterSheetId)).toHaveLength(1);
  });

  test('JSON export requests its download in the pop-out document', async () => {
    const createDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const revokeDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: jest.fn(() => 'blob:character-backup'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: jest.fn() });
    try {
      await sheets.open(hero);
      sheets.popOut();
      const clicked = jest
        .spyOn(popout.HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => {});
      sheets.settingsButton.click();
      sheets.root.querySelector('[data-sheet-action="export"]').click();
      await flush();

      expect(clicked).toHaveBeenCalledTimes(1);
      expect(clicked.mock.instances[0].ownerDocument).toBe(popout.document);
      expect(clicked.mock.instances[0].download).toBe('Hero.json');
      expect(JSON.parse(sheets.characterContent.backupText.value)).toBeTruthy();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:character-backup');
    } finally {
      if (createDescriptor) Object.defineProperty(URL, 'createObjectURL', createDescriptor);
      else delete URL.createObjectURL;
      if (revokeDescriptor) Object.defineProperty(URL, 'revokeObjectURL', revokeDescriptor);
      else delete URL.revokeObjectURL;
    }
  });

  test('Dock closes the browser window and restores the same tabs and original in-app bounds', async () => {
    await sheets.open(hero);
    await sheets.open(scout);
    const bounds = { ...sheets._bounds };
    const root = sheets.root;
    sheets.popOut();
    sheets.popoutButton.click();

    expect(popout.close).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.character-sheet-window')).toBe(root);
    expect(root.ownerDocument).toBe(document);
    expect(sheets._bounds).toEqual(bounds);
    expect(root.style.width).toBe('480px');
    expect(root.style.height).toBe('360px');
    expect(sheets.tabs.size).toBe(2);
    expect(sheets.activeToken).toBe(scout);
    expect(sheets.popoutButton.getAttribute('aria-label')).toBe('Pop out character sheets');
    expect(document.activeElement).toBe(sheets.popoutButton);
  });

  test.each(['popOut', 'dock'])(
    '%s blurs a focused field before changing documents',
    async (action) => {
      await sheets.open(hero);
      if (action === 'dock') sheets.popOut();
      const speed = control('Character speed (feet)');
      const owner = speed.ownerDocument;
      const blurOwners = [];
      speed.addEventListener('blur', () => blurOwners.push(speed.ownerDocument === owner));
      speed.focus();
      sheets[action]();

      expect(blurOwners).toEqual([true]);
      expect(speed.ownerDocument).not.toBe(owner);
    }
  );

  test.each(['pop-out', 'game'])(
    '%s page closure returns the sheet without losing tabs or stealing focus',
    async (source) => {
      await sheets.open(hero);
      sheets.popOut();
      const owner = source === 'pop-out' ? popout : window;
      owner.dispatchEvent(new owner.Event('pagehide'));

      expect(popout.close).toHaveBeenCalledTimes(1);
      expect(sheets.root.ownerDocument).toBe(document);
      expect(sheets.root.hidden).toBe(false);
      expect(sheets.tabs.has(hero)).toBe(true);
      expect(window.focus).not.toHaveBeenCalled();
    }
  );

  test('the sheet Close button closes the pop-out and retains the existing hidden-window behavior', async () => {
    await sheets.open(hero);
    sheets.popOut();
    control('Close character sheets').click();
    await gameManager.token3DAdapter.setSelectedToken(scout);

    expect(popout.close).toHaveBeenCalledTimes(1);
    expect(sheets.root.ownerDocument).toBe(document);
    expect(sheets.root.hidden).toBe(true);
    expect(sheets.tabs.has(scout)).toBe(false);
    await sheets.open(scout);
    expect(sheets.root.hidden).toBe(false);
    expect(sheets.root.ownerDocument).toBe(document);
    expect(openWindow).toHaveBeenCalledTimes(1);
  });

  test('closing a focused pop-out tab focuses its neighbor and the last tab closes the pop-out', async () => {
    await sheets.open(hero);
    await sheets.open(scout);
    sheets.popOut();
    sheets.tabs.get(scout).close.focus();
    sheets.tabs.get(scout).close.click();

    expect(sheets.activeToken).toBe(hero);
    expect(popout.document.activeElement).toBe(sheets.tabs.get(hero).button);
    sheets.tabs.get(hero).close.click();
    expect(popout.close).toHaveBeenCalledTimes(1);
    expect(sheets.tabs.size).toBe(0);
    expect(sheets.root.hidden).toBe(true);
    expect(sheets.root.ownerDocument).toBe(document);
  });

  test('the pop-out fills its own viewport without overwriting saved in-app bounds', async () => {
    await sheets.open(hero);
    const bounds = { ...sheets._bounds };
    sheets.popOut();
    popout.innerHeight = 500;
    popout.dispatchEvent(new popout.Event('resize'));
    window.innerWidth = 300;
    window.innerHeight = 260;
    window.dispatchEvent(new Event('resize'));

    expect(sheets.root.style.width).toBe('100%');
    expect(sheets.root.style.height).toBe('100%');
    expect(sheets.root.style.left).toBe('0px');
    expect(sheets.root.style.top).toBe('0px');
    expect(sheets.root.style.getPropertyValue('--sheet-window-height')).toBe('500px');
    expect(sheets._bounds).toEqual(bounds);
    sheets.dock();
    expect(sheets.root.style.width).toBe('284px');
    expect(sheets.root.style.height).toBe('244px');
    expect(sheets.root.style.left).toBe('8px');
    expect(sheets.root.style.top).toBe('8px');
  });

  test('pop-out uses native window controls instead of in-app minimization, dragging or resizing', async () => {
    await sheets.open(hero);
    sheets.minimize();
    sheets.popOut();
    sheets.minimizeButton.click();
    const style = sheets.root.getAttribute('style');
    sheets.root
      .querySelector('header')
      .dispatchEvent(
        new popout.MouseEvent('pointerdown', { button: 0, bubbles: true, cancelable: true })
      );
    control('Resize character sheet window').dispatchEvent(
      new popout.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
    );

    expect(sheets.minimized).toBe(false);
    expect(sheets._gesture).toBeNull();
    expect(sheets.root.getAttribute('style')).toBe(style);
  });

  test('blocked pop-ups report an actionable error and leave the original sheet unchanged', async () => {
    await sheets.open(hero);
    openWindow.mockReturnValue(null);
    const error = jest.spyOn(ErrorHandler.prototype, 'handle').mockImplementation(() => {});
    const style = sheets.root.getAttribute('style');
    expect(sheets.popOut()).toBe(false);

    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Allow pop-ups for this site') }),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ operation: 'popOut' })
    );
    expect(sheets.root.ownerDocument).toBe(document);
    expect(sheets.root.getAttribute('style')).toBe(style);
    expect(sheets.popoutButton.textContent).toBe('Pop out');
    expect(sheets.activeToken).toBe(hero);
  });

  test('a failed pop-out setup closes the unused window and restores the live sheet', async () => {
    await sheets.open(hero);
    jest.spyOn(popout.document.head, 'append').mockImplementationOnce(() => {
      throw new Error('Could not initialize the browser window');
    });
    const error = jest.spyOn(ErrorHandler.prototype, 'handle').mockImplementation(() => {});
    expect(sheets.popOut()).toBe(false);

    expect(error).toHaveBeenCalled();
    expect(popout.close).toHaveBeenCalledTimes(1);
    expect(sheets.root.ownerDocument).toBe(document);
    expect(sheets.root.hidden).toBe(false);
    expect(sheets.root.dataset.poppedOut).toBe('false');
    expect(sheets.tabs.has(hero)).toBe(true);
  });

  test('blocked pop-ups display the actionable message through the standard notification system', async () => {
    await sheets.open(hero);
    openWindow.mockReturnValue(null);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(sheets.popOut()).toBe(false);

    expect(document.querySelector('#tavern-error-container [role="alert"]').textContent).toContain(
      'Allow pop-ups for this site'
    );
  });

  test('destroying sheets closes the pop-out and removes both windows lifecycle handlers', async () => {
    await sheets.open(hero);
    sheets.popOut();
    sheets.destroy();
    popout.dispatchEvent(new popout.Event('pagehide'));
    window.dispatchEvent(new Event('pagehide'));

    expect(popout.close).toHaveBeenCalledTimes(1);
    expect(sheets.root.isConnected).toBe(false);
    expect(sheets.tabs.size).toBe(0);
    expect(sheets.characterContent.disposed).toBe(true);
    expect(document.querySelector('.character-sheet-window')).toBeNull();
  });
});
