import '../../../src/ui/UIController.js';
import { applyTokenCommand } from '../../../src/core/game-manager/internals/tokenCommands.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { CompendiumCatalog } from '../../../src/entities/characters/CompendiumCatalog.js';

test('the real radial event opens and reuses the sheet window without applying a quick command', () => {
  const previousManager = window.gameManager;
  const first = { id: 'token-1', name: 'Mannequin 1' };
  const second = { id: 'token-2', name: 'Mannequin 2' };
  const catalog = new CompendiumCatalog({
    ...{ version: 1, entries: [], classes: [] },
    ruleset: '2014',
  });
  const gameManager = {
    placedTokens: [first, second],
    applyTokenCommand: jest.fn(),
    token3DAdapter: { setSelectedToken: jest.fn() },
    characterServices: {
      catalog,
      library: new CharacterLibrary({
        ruleset: '2014',
        catalog: catalog.entries,
        classes: catalog.classes,
        storage: localStorage,
      }),
    },
  };
  window.gameManager = gameManager;
  try {
    for (const token of [first, second, first]) {
      window.dispatchEvent(
        new CustomEvent('taverntable:tokenRadial', {
          detail: { token, screenX: 500, screenY: 400 },
        })
      );
      document
        .querySelector('.radial-menu path[data-action-id="character-sheet"]')
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }

    expect(document.querySelectorAll('.character-sheet-window')).toHaveLength(1);
    const root = document.querySelector('.character-sheet-window');
    expect(root.hidden).toBe(false);
    expect(root.querySelectorAll('[role="tab"]')).toHaveLength(2);
    expect(root.querySelector('h3').textContent).toBe('Mannequin 1');
    expect(gameManager.applyTokenCommand).not.toHaveBeenCalled();
    expect(gameManager.token3DAdapter.setSelectedToken).toHaveBeenLastCalledWith(first);
    expect(first.quickCommand).toBeUndefined();
    expect(second.quickCommand).toBeUndefined();
    root.querySelector('.character-sheet-window-close').click();
    expect(root.hidden).toBe(true);
  } finally {
    for (const token of [first, second]) {
      window.dispatchEvent(
        new CustomEvent('taverntable:tokenRemoved', { detail: { token, gameManager } })
      );
    }
    window.gameManager = previousManager;
  }
});

test.each([
  'emote-defeated',
  'emote-idle',
  'emote-rumba',
  'emote-fancy-pose',
  'emote-dynamic-pose',
])('%s still plays its existing token animation', async (command) => {
  const token = {};
  const gameManager = {
    placedTokens: [token],
    token3DAdapter: { playTokenAction: jest.fn().mockResolvedValue(true) },
  };
  expect(await applyTokenCommand(gameManager, token, command)).toBe(true);
  expect(gameManager.token3DAdapter.playTokenAction).toHaveBeenCalledWith(token, command);
  expect(token.quickCommand).toBe(command);
});

test.each(['unavailable', 'character-sheet'])(
  '%s cannot accidentally become a token quick-command marker',
  async (command) => {
    const token = {};
    expect(await applyTokenCommand({ placedTokens: [token] }, token, command)).toBe(false);
    expect(token.quickCommand).toBeUndefined();
  }
);

test('a command marker is applied only after asynchronous animation readiness succeeds', async () => {
  const token = {};
  let complete;
  const ready = new Promise((resolve) => {
    complete = resolve;
  });
  const gameManager = {
    placedTokens: [token],
    token3DAdapter: { playTokenAction: jest.fn(() => ready) },
  };
  const pending = applyTokenCommand(gameManager, token, 'action-wave');
  expect(token.quickCommand).toBeUndefined();
  complete(true);
  expect(await pending).toBe(true);
  expect(token.quickCommand).toBe('action-wave');
});

test('a rejected clip load cannot leave a success-shaped command marker', async () => {
  const token = {};
  const gameManager = {
    placedTokens: [token],
    token3DAdapter: {
      playTokenAction: jest.fn().mockRejectedValue(new Error('Invalid character rig')),
    },
  };
  await expect(applyTokenCommand(gameManager, token, 'action-wave')).rejects.toThrow(
    'Invalid character rig'
  );
  expect(token.quickCommand).toBeUndefined();
});

test('the catalog populates and binds all palette entries once, including drag payloads', () => {
  const previous = window.gameManager;
  const container = document.createElement('div');
  container.id = 'creature-content';
  document.body.appendChild(container);
  const gameManager = { selectToken: jest.fn() };
  window.gameManager = gameManager;
  try {
    document.dispatchEvent(new Event('DOMContentLoaded'));
    document.dispatchEvent(new Event('DOMContentLoaded'));
    expect(container.querySelectorAll('button')).toHaveLength(3);
    const knight = container.querySelector('#token-knight');
    knight.click();
    expect(gameManager.selectToken).toHaveBeenCalledTimes(1);
    expect(gameManager.selectToken).toHaveBeenCalledWith('knight');
    const transfer = { setData: jest.fn() };
    const drag = new Event('dragstart', { bubbles: true });
    Object.defineProperty(drag, 'dataTransfer', { value: transfer });
    container.querySelector('#token-mutant').dispatchEvent(drag);
    expect(transfer.setData).toHaveBeenCalledWith('application/taverntable-token', 'mutant');
  } finally {
    container.remove();
    window.gameManager = previous;
  }
});
