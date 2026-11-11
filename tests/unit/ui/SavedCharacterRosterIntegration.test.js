import fs from 'node:fs';
import path from 'node:path';
import { initializeApplication } from '../../../src/ui/UIController.js';
import CampaignLauncher from '../../../src/ui/campaigns/CampaignLauncher.js';
import CharacterSheetWindow from '../../../src/ui/components/CharacterSheetWindow.js';
import { SAVED_CHARACTER_DRAG_MIME } from '../../../src/ui/characters/SavedCharacterRoster.js';

let mockFinishRestore;

jest.mock('../../../src/ui/sessions/SessionLogin.js', () => ({
  ensureSession: jest.fn(async () => ({ role: 'dm' })),
}));

jest.mock('../../../src/core/GameManager.js', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    initialize: jest.fn(async () => {}),
    enableHybridRender: jest.fn(async () => {}),
    is3DModeActive: () => true,
    token3DAdapter: { setSelectedToken: jest.fn(async () => {}) },
    threeSceneManager: { restoreView: jest.fn() },
    placedTokens: [],
    tokenManager: {
      cancelSavedCharacterPlacement: jest.fn(),
      getSelectedTokenType: () => 'mannequin',
    },
    inputCoordinator: {
      handleSavedCharacterDrop: jest.fn(async () => true),
      handleTokenDrop: jest.fn(async () => true),
    },
  })),
}));
jest.mock('../../../src/ui/campaigns/CampaignLauncher.js', () => ({
  __esModule: true,
  default: jest.fn(),
  mountCampaignControls: jest.fn(),
}));
jest.mock('../../../src/campaigns/CampaignAutosave.js', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(function ({ gameManager }) {
    gameManager.sceneAutosave = this;
    this.ready = false;
    this.start = jest.fn(async () => {
      await new Promise((resolve) => {
        mockFinishRestore = resolve;
      });
      this.ready = true;
    });
    this.subscribe = (callback) => {
      callback();
      return () => {};
    };
  }),
}));
jest.mock('../../../src/ui/characters/characterServices.js', () => ({
  ...jest.requireActual('../../../src/ui/characters/characterServices.js'),
  connectCharacterServices: jest.fn((manager, services) => {
    manager.characterServices = services;
  }),
}));
jest.mock('../../../src/campaigns/SceneWorld.js', () => ({
  captureCampaignScene: jest.fn(async () => ({
    camera: { target: { x: 0, y: 0, z: 0 }, zoom: 1 },
  })),
  changeCampaignView: jest.fn(async () => {}),
}));
jest.mock('../../../src/ui/components/CharacterSheetWindow.js', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(({ gameManager }) => ({
    gameManager,
    attach: jest.fn().mockReturnThis(),
    open: jest.fn(async () => true),
    destroy: jest.fn(),
  })),
}));

const settle = async () => {
  for (let step = 0; step < 20; step++) await Promise.resolve();
};

function drop(target, types, payloads) {
  const event = new MouseEvent('drop', {
    bubbles: true,
    cancelable: true,
    clientX: 120,
    clientY: 80,
  });
  Object.defineProperty(event, 'dataTransfer', {
    value: { types, getData: (type) => payloads[type] || '' },
  });
  target.dispatchEvent(event);
}

test('real bootstrap mounts the roster only after restoration, keeps saved and generic drops separate, and reuses the canonical sheet', async () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'index.html'), 'utf8');
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  const gm = window.gameManager;
  const token = {
    id: 'existing-token',
    characterSheetId: 'hero',
    name: 'Existing hero',
    type: 'knight',
    world: { x: 3.5, y: 0, z: 2.5 },
  };
  gm.placedTokens = [token];
  const library = {
    store: { identity: { role: 'dm' } },
    list: () => [{ id: 'hero', name: token.name, classId: '', level: 1 }],
    get: () => ({ id: 'hero', name: token.name }),
    classes: new Map(),
    create: jest.fn(),
  };
  CampaignLauncher.mockImplementation(() => ({
    choose: async () => ({ campaign: { id: 'campaign' }, library, sessionRole: 'dm', scene: {} }),
  }));
  window.sidebarController = {
    snapshotDiceLog: () => [],
    restoreDiceLog: () => {},
    refreshCreatureSelection: jest.fn(),
  };
  document.dispatchEvent(new Event('DOMContentLoaded'));
  const startup = initializeApplication();
  await settle();
  const host = document.getElementById('saved-character-roster');
  expect(mockFinishRestore).toEqual(expect.any(Function));
  expect(host.children).toHaveLength(0);
  mockFinishRestore();
  await startup;
  expect(host.textContent).toContain('Existing hero');
  expect(host.querySelectorAll('.saved-character-roster')).toHaveLength(1);
  try {
    document.dispatchEvent(new Event('DOMContentLoaded'));
    const container = document.getElementById('game-container');
    const payload = JSON.stringify({ characterId: 'hero', appearance: 'knight' });
    drop(container, [SAVED_CHARACTER_DRAG_MIME], { [SAVED_CHARACTER_DRAG_MIME]: payload });
    expect(gm.inputCoordinator.handleSavedCharacterDrop).toHaveBeenCalledTimes(1);
    expect(gm.inputCoordinator.handleSavedCharacterDrop).toHaveBeenLastCalledWith(payload, 120, 80);
    expect(gm.inputCoordinator.handleTokenDrop).not.toHaveBeenCalled();
    drop(container, [SAVED_CHARACTER_DRAG_MIME, 'text/plain'], { 'text/plain': 'knight' });
    expect(gm.inputCoordinator.handleSavedCharacterDrop).toHaveBeenLastCalledWith('', 120, 80);
    expect(gm.inputCoordinator.handleTokenDrop).not.toHaveBeenCalled();
    drop(container, ['application/taverntable-token'], {
      'application/taverntable-token': 'knight',
    });
    expect(gm.inputCoordinator.handleTokenDrop).toHaveBeenCalledWith('knight', 120, 80);
    host.querySelector('[data-roster-action="focus"]').click();
    await settle();
    const sheets = CharacterSheetWindow.mock.results[0].value;
    expect(sheets.open).toHaveBeenCalledWith(token);
    expect(gm.threeSceneManager.restoreView).toHaveBeenCalledWith(
      expect.objectContaining({ target: token.world })
    );
    host.querySelector('[data-roster-action="open"]').click();
    await settle();
    expect(CharacterSheetWindow).toHaveBeenCalledTimes(1);
    expect(sheets.open).toHaveBeenCalledTimes(2);
    expect(library.create).not.toHaveBeenCalled();
    expect(gm.placedTokens).toEqual([token]);
    expect(gm.characterServices.sessionRole).toBe('dm');
  } finally {
    gm.savedCharacterRoster?.destroy();
    document.body.replaceChildren();
    delete window.sidebarController;
  }
});
