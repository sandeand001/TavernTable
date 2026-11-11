import { mountCampaignControls } from '../../../src/ui/campaigns/CampaignLauncher.js';
import CampaignMapControls from '../../../src/ui/campaigns/CampaignMapControls.js';
import CampaignBackupPanel from '../../../src/ui/campaigns/CampaignBackupPanel.js';
import CampaignSharingPanel from '../../../src/ui/campaigns/CampaignSharingPanel.js';
import { ErrorHandler } from '../../../src/utils/error/ErrorHandler.js';

jest.mock('../../../src/ui/campaigns/CampaignMapControls.js', () =>
  jest.fn().mockImplementation(() => {
    const root = globalThis.document.createElement('details');
    root.innerHTML = '<summary>Maps &amp; focus</summary>';
    return { root };
  })
);
jest.mock('../../../src/ui/campaigns/CampaignBackupPanel.js', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ open: jest.fn() })),
  downloadCampaignJSON: jest.fn(),
}));
jest.mock('../../../src/ui/campaigns/CampaignSharingPanel.js', () =>
  jest.fn().mockImplementation(() => ({ open: jest.fn() }))
);

let services, gm, saveState;
const button = (root, text) =>
  [...root.querySelectorAll('button')].find((element) => element.textContent === text);

beforeEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '<div id="settings-panel"></div>';
  const saveListeners = new Set();
  saveState = (state) => {
    for (const listener of saveListeners) listener(state);
  };
  services = {
    campaign: { id: 'adventure', name: 'Evening adventure', ruleset: '2024', coreVersion: '5.2' },
    workspace: {
      store: {
        identity: { role: 'dm', id: 'host' },
        backupStatus: jest.fn(async () => ({
          latest: { createdAt: '2026-11-06T02:00:00.000Z' },
        })),
        subscribeChanges: jest.fn(() => jest.fn()),
      },
    },
    autosave: {
      ready: true,
      subscribe: jest.fn((listener) => {
        saveListeners.add(listener);
        listener({ state: 'saved', text: 'Saved to host' });
        return () => saveListeners.delete(listener);
      }),
      retry: jest.fn(async () => {}),
      flush: jest.fn(async () => {}),
    },
    library: { flush: jest.fn(async () => {}) },
  };
  gm = { placedTokens: [] };
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  document.body.replaceChildren();
  jest.restoreAllMocks();
});

test('Settings contains campaign/session options while the floating region contains only map controls', async () => {
  const controls = mountCampaignControls(gm, services);
  expect(controls.parentElement.id).toBe('settings-panel');
  expect(controls.getAttribute('aria-label')).toBe('Current campaign');
  expect(controls.textContent).toContain('Evening adventure');
  expect(controls.textContent).toContain('2024 / SRD 5.2');
  expect([...controls.querySelectorAll('button')].map((element) => element.textContent)).toEqual([
    'Campaigns',
    'Retry save',
    'Players & sharing',
    'Discard local changes and refresh',
    'Sign out',
    'JSON backups',
  ]);
  expect(button(controls, 'Discard local changes and refresh').hidden).toBe(true);
  expect(controls.querySelector('[aria-label="Campaign save status"]').textContent).toBe(
    'Saved to host'
  );
  expect(controls.querySelector('[aria-label="Shared session status"]')).not.toBeNull();
  await Promise.resolve();
  expect(
    controls.querySelector('[aria-label="Automatic JSON backup status"]').textContent
  ).toContain('JSON backup:');

  const floating = document.querySelector('.campaign-tools');
  expect(floating.getAttribute('aria-label')).toBe('DM map controls');
  expect(floating.textContent).toBe('Maps & focus');
  expect([...floating.children]).toEqual([CampaignMapControls.mock.results[0].value.root]);
  expect(floating.querySelector('output')).toBeNull();
});

test.each(['player', 'unknown'])('%s does not receive floating Maps & focus controls', (role) => {
  services.workspace.store.identity.role = role;
  mountCampaignControls(gm, services);
  expect(CampaignMapControls).not.toHaveBeenCalled();
  expect(document.querySelector('.campaign-tools')).toBeNull();
  expect(document.querySelector('[aria-label="Viewed map"]')).toBeNull();
});

test('explicit browser-only campaigns retain their local DM map controls', () => {
  delete services.workspace.store.identity;
  mountCampaignControls(gm, services);
  expect(CampaignMapControls).toHaveBeenCalledWith({ gameManager: gm });
  expect(document.querySelector('.campaign-tools')).not.toBeNull();
});

test('Settings save status and Retry save continue following autosave updates', () => {
  const controls = mountCampaignControls(gm, services);
  const retry = button(controls, 'Retry save');
  expect(retry.hidden).toBe(true);
  saveState({ state: 'error', text: 'Disk unavailable' });
  expect(retry.hidden).toBe(false);
  expect(controls.querySelector('[aria-label="Campaign save status"]').textContent).toBe(
    'Disk unavailable'
  );
  retry.click();
  expect(services.autosave.retry).toHaveBeenCalledTimes(1);
  saveState({ state: 'saving', text: 'Saving to host...' });
  expect(controls.getAttribute('aria-busy')).toBe('true');
  expect(retry.hidden).toBe(true);
});

test('sharing and backup buttons open the same campaign dialogs from Settings', () => {
  const controls = mountCampaignControls(gm, services);
  button(controls, 'Players & sharing').click();
  expect(CampaignSharingPanel).toHaveBeenCalledWith({
    workspace: services.workspace,
    campaignId: 'adventure',
  });
  expect(CampaignSharingPanel.mock.results[0].value.open).toHaveBeenCalledTimes(1);
  button(controls, 'JSON backups').click();
  expect(CampaignBackupPanel).toHaveBeenCalledWith({
    workspace: services.workspace,
    campaignId: 'adventure',
  });
  expect(CampaignBackupPanel.mock.results[0].value.open).toHaveBeenCalledTimes(1);
});

test('returning to Campaigns still rejects unfinished movement and reports the error in Settings', () => {
  const report = jest.spyOn(ErrorHandler.prototype, 'handle').mockImplementation(() => {});
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
  gm.campaignViewBusy = true;
  const controls = mountCampaignControls(gm, services);
  button(controls, 'Campaigns').click();
  expect(controls.querySelector('[aria-label="Campaign save status"]').textContent).toContain(
    'Finish the current roll or movement'
  );
  expect(confirm).not.toHaveBeenCalled();
  expect(services.autosave.flush).not.toHaveBeenCalled();
  expect(report).toHaveBeenCalled();
});
