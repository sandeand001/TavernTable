import { playerGameURL } from '../../../src/ui/sessions/PlayerEntry.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';

test('the invitation document forwards to the shared game instead of loading the marker viewer', () => {
  const html = readFileSync(path.resolve(__dirname, '..', '..', '..', 'player.html'), 'utf8');
  const document = new DOMParser().parseFromString(html, 'text/html');
  const modules = [...document.querySelectorAll('script[type="module"]')].map((node) =>
    node.getAttribute('src')
  );
  expect(modules).toEqual(['src/ui/sessions/PlayerEntry.js']);
  expect(document.getElementById('player-map-view')).toBeNull();
});

test('a private invitation opens the shared game entry without converting it into a role or query-string credential', () => {
  const url = playerGameURL('http://localhost:3000/player.html#invite=private-test-invitation');
  expect(url).toBe('http://localhost:3000/?player=1#invite=private-test-invitation');
  expect(new URL(url).searchParams.has('invite')).toBe(false);
  expect(new URL(url).searchParams.has('role')).toBe(false);
});
