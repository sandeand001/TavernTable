import { readFileSync } from 'node:fs';
import path from 'node:path';
import PlayerControls from '../../../src/ui/sessions/PlayerControls.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';

afterEach(() => {
  document.body.replaceChildren();
  delete document.body.dataset.sessionRole;
});

test('the shared game layout retains dice, camera settings and player tabs while restricting DM authoring controls', () => {
  const html = readFileSync(path.resolve(__dirname, '..', '..', '..', 'index.html'), 'utf8');
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const id = library.create('Player scout');
  const controls = new PlayerControls({ identity: { role: 'player' }, library });
  controls.update({
    campaign: { id: 'table', name: 'Test table' },
    profile: { name: 'Player' },
    observerTokenId: 'real-scout',
    observers: [{ id: 'real-scout', name: 'Player scout', mapId: 'main', characterId: id }],
    maps: [{ id: 'main', name: 'Courtyard' }],
    location: { id: 'location', name: 'Village' },
    publicScene: { presentation: { mapId: 'main' } },
    gameplay: { version: 1, commands: [], ownedTokens: [], turn: null },
  });
  expect(document.querySelectorAll('[data-dice]')).toHaveLength(6);
  expect(document.querySelector('[data-tab="dice-log"]').hidden).toBe(false);
  expect(document.querySelector('[data-tab="compendium"]').hidden).toBe(false);
  expect(document.querySelector('[data-tab="settings"]').hidden).toBe(false);
  expect(document.querySelector('[data-tab="terrain"]').hidden).toBe(true);
  expect(document.querySelector('[data-tab="biomes"]').hidden).toBe(true);
  expect(document.getElementById('creature-content').closest('.section').hidden).toBe(true);
  expect(document.getElementById('token-remove').closest('.section').hidden).toBe(true);
  expect(document.getElementById('saved-character-roster').textContent).toContain('Player scout');
  expect(document.querySelector('[aria-label="Active character"]').value).toBe('real-scout');
  expect(document.querySelector('[aria-label="Location area"]').value).toBe('main');
  controls.destroy();
});

test('destroying player controls releases roster handlers and preserves the existing inert state', () => {
  const html = readFileSync(path.resolve(__dirname, '..', '..', '..', 'index.html'), 'utf8');
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  const terrain = document.querySelector('[data-tab="terrain"]');
  terrain.inert = true;
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const opened = [];
  const controls = new PlayerControls({
    identity: { role: 'player' },
    library,
    onSheet: (id) => opened.push(id),
  });
  const button = document.createElement('button');
  button.dataset.assignedCharacter = 'assigned';
  document.getElementById('saved-character-roster').append(button);
  controls.destroy();
  button.click();
  expect(opened).toEqual([]);
  expect(terrain.inert).toBe(true);
});

test('DM-only hidden controls remain hidden under the real game styles in a player browser', () => {
  const root = path.resolve(__dirname, '..', '..', '..');
  const html = readFileSync(path.join(root, 'index.html'), 'utf8');
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  const styles = document.createElement('style');
  styles.textContent = `${readFileSync(path.join(root, 'src', 'ui', 'styles.css'), 'utf8')}\n${readFileSync(path.join(root, 'src', 'ui', 'sessions', 'player.css'), 'utf8')}`;
  document.head.append(styles);
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const controls = new PlayerControls({ identity: { role: 'player' }, library });
  expect(getComputedStyle(document.querySelector('[data-tab="terrain"]')).display).toBe('none');
  expect(getComputedStyle(document.querySelector('[data-tab="biomes"]')).display).toBe('none');
  expect(
    getComputedStyle(document.getElementById('token-remove').closest('.section')).display
  ).toBe('none');
  controls.destroy();
  styles.remove();
});

test('normal player session controls expose reconnect, sign out and same-command retry only for uncertain results', () => {
  const root = path.resolve(__dirname, '..', '..', '..');
  document.body.innerHTML = new DOMParser().parseFromString(
    readFileSync(path.join(root, 'index.html'), 'utf8'),
    'text/html'
  ).body.innerHTML;
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const actions = [];
  const controls = new PlayerControls({
    identity: { role: 'player' },
    library,
    onReconnect: () => actions.push('reconnect'),
    onSignOut: () => actions.push('signout'),
    onRetry: () => actions.push('retry'),
  });
  document.querySelector('[data-player-reconnect]').click();
  document.querySelector('[data-player-signout]').click();
  controls.updateCommandState({ canRetry: false, pending: false, failure: null });
  expect(document.querySelector('[data-player-retry]').hidden).toBe(true);
  controls.updateCommandState({
    canRetry: true,
    pending: false,
    failure: new Error('Response lost'),
  });
  document.querySelector('[data-player-retry]').click();
  expect(actions).toEqual(['reconnect', 'signout', 'retry']);
  expect(document.querySelectorAll('[data-dice]')).toHaveLength(6);
  controls.destroy();
});
