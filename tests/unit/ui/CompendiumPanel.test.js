import CompendiumPanel, { readCompendiumDrag } from '../../../src/ui/components/CompendiumPanel.js';
import { CompendiumCatalog } from '../../../src/entities/characters/CompendiumCatalog.js';
import snapshot from '../../../assets/data/srd2014.json';

afterEach(() => document.body.replaceChildren());

test.each([
  {
    name: 'Chain Mail',
    query: 'chain mail',
    rules: ['AC 16', 'no Dexterity modifier', 'Strength 13', 'Disadvantage on Stealth'],
  },
  { name: 'Shield', query: 'shield', rules: ['+2 AC'] },
  { name: 'Chain Mail +1', query: 'chain mail +1', rules: ['AC 17'] },
])('Details for $name show its armor mechanics', ({ name, query, rules }) => {
  const panel = new CompendiumPanel({
    catalog: new CompendiumCatalog({ ...snapshot, ruleset: '2014' }),
    onAdd: jest.fn(),
    onError: jest.fn(),
  });
  document.body.append(panel.root);
  const search = panel.root.querySelector('[aria-label="Search compendium"]');
  search.value = query;
  search.dispatchEvent(new Event('input', { bubbles: true }));
  expect(
    [...panel.root.querySelectorAll('.sheet-compendium-entry h5')].map((node) => node.textContent)
  ).toContain(name);
  const detailsButton = [...panel.root.querySelectorAll('button')].find(
    (button) => button.getAttribute('aria-label') === `Details ${name}`
  );
  detailsButton.click();
  const details = panel.root.querySelector('[aria-label="Compendium entry details"]');
  expect(details.hidden).toBe(false);
  for (const rule of rules) expect(details.textContent).toContain(rule);
});

test('compendium drags reject another ruleset or source pin instead of reinterpreting a matching ID', () => {
  const entry = {
    id: 'spell:shared',
    kind: 'spell',
    name: 'Shared spell',
    description: [],
    sourcePack: 'srd-2024',
    sourceVersion: 'seed.1',
  };
  const revised = new CompendiumCatalog({
    version: 1,
    ruleset: '2024',
    entries: [entry],
    classes: [],
  });
  const classic = new CompendiumCatalog({
    version: 1,
    ruleset: '2014',
    entries: [{ ...entry, sourcePack: 'srd-2014' }],
    classes: [],
  });
  const payload = JSON.stringify({
    version: 2,
    ruleset: '2024',
    entryId: entry.id,
    sourcePack: entry.sourcePack,
    sourceVersion: entry.sourceVersion,
  });
  expect(readCompendiumDrag(payload, revised)).toBe(entry.id);
  expect(() => readCompendiumDrag(payload, classic)).toThrow('ruleset');
  expect(() => readCompendiumDrag(payload.replace('seed.1', 'seed.2'), revised)).toThrow('source');
});

test('expanded reference categories are searchable but do not pretend to apply character effects', () => {
  const catalog = new CompendiumCatalog({
    version: 1,
    ruleset: '2024',
    classes: [],
    entries: [
      {
        id: 'reference:alert',
        kind: 'feat',
        name: 'Alert',
        category: 'Feat',
        description: ['Reference feat rules.'],
        automation: 'reference',
      },
    ],
  });
  const panel = new CompendiumPanel({ catalog, onAdd: jest.fn(), onError: jest.fn() });
  const category = panel.root.querySelector('[aria-label="Compendium category"]');
  category.value = 'feat';
  category.dispatchEvent(new Event('change'));
  const row = panel.root.querySelector('[data-entry-id="reference:alert"]');
  expect(row).not.toBeNull();
  expect(row.draggable).toBe(false);
  expect(row.querySelector('[data-compendium-add]')).toBeNull();
  row.querySelector('[aria-label="Details Alert"]').click();
  expect(panel.root.querySelector('.sheet-compendium-detail').textContent).toContain(
    'Reference feat rules.'
  );
});
