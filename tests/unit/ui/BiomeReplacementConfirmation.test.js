import {
  confirmBiomeReplacement,
  replacementWarningEnabled,
  setReplacementWarningEnabled,
} from '../../../src/ui/terrain/BiomeReplacementConfirmation.js';

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<button id="previous">Previous control</button>';
  document.getElementById('previous').focus();
});

afterEach(() => {
  jest.restoreAllMocks();
  document.body.replaceChildren();
});

test('cancelling the warning never saves its opt-out or changes focus', async () => {
  const pending = confirmBiomeReplacement();
  const dialog = document.querySelector('[data-biome-replacement-confirmation]');
  const description = document.getElementById(dialog.getAttribute('aria-describedby'));
  expect(description?.textContent).toMatch(/creature tokens.*character sheets.*other maps/is);
  dialog.querySelector('[name="skipWarning"]').checked = true;
  dialog.querySelector('[data-cancel]').click();
  await expect(pending).resolves.toBe(false);
  expect(replacementWarningEnabled()).toBe(true);
  expect(document.activeElement.id).toBe('previous');
});

test('a confirmed opt-out persists until the warning is explicitly restored', async () => {
  const pending = confirmBiomeReplacement();
  const dialog = document.querySelector('[data-biome-replacement-confirmation]');
  dialog.querySelector('[name="skipWarning"]').checked = true;
  dialog.querySelector('form').requestSubmit();
  await expect(pending).resolves.toBe(true);
  expect(replacementWarningEnabled()).toBe(false);
  await expect(confirmBiomeReplacement()).resolves.toBe(true);
  expect(document.querySelector('[data-biome-replacement-confirmation]')).toBeNull();
  setReplacementWarningEnabled(true);
  expect(replacementWarningEnabled()).toBe(true);
  const restored = confirmBiomeReplacement();
  expect(document.querySelector('[data-biome-replacement-confirmation]')).not.toBeNull();
  document.querySelector('[data-biome-replacement-confirmation] [data-cancel]').click();
  await expect(restored).resolves.toBe(false);
});

test('an unsaved opt-out is reported and cannot silently dismiss the warning', async () => {
  const pending = confirmBiomeReplacement();
  const dialog = document.querySelector('[data-biome-replacement-confirmation]');
  const checkbox = dialog.querySelector('[name="skipWarning"]');
  checkbox.checked = true;
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage unavailable');
  });
  dialog.querySelector('form').requestSubmit();
  expect(dialog.isConnected).toBe(true);
  expect(dialog.querySelector('[role="alert"]').textContent).toMatch(/could not save/i);
  checkbox.checked = false;
  dialog.querySelector('form').requestSubmit();
  await expect(pending).resolves.toBe(true);
  expect(replacementWarningEnabled()).toBe(true);
});

test('keyboard focus stays in the warning and Escape cancels it', async () => {
  const pending = confirmBiomeReplacement();
  const dialog = document.querySelector('[data-biome-replacement-confirmation]');
  const first = dialog.querySelector('[name="skipWarning"]');
  const last = dialog.querySelector('button[type="submit"]');
  last.focus();
  last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  expect(document.activeElement).toBe(first);
  first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
  expect(document.activeElement).toBe(last);
  last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await expect(pending).resolves.toBe(false);
  expect(document.activeElement.id).toBe('previous');
});
