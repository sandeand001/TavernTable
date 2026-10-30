import snapshot from '../../../../assets/data/srd2014.json';
import { CompendiumCatalog } from '../../../../src/entities/characters/CompendiumCatalog.js';

test('the offline 2014 catalog finds a complete spell without a network service', () => {
  const catalog = new CompendiumCatalog({ ...snapshot, ruleset: '2014' });
  const [fireball] = catalog.search('fireball', { kind: 'spell' });
  expect(fireball.id).toBe('spell:fireball');
  expect(fireball.level).toBe(3);
  expect(fireball.damage[0].damage_at_slot_level['3']).toBe('8d6');
  expect(fireball.description.length).toBeGreaterThan(0);
  expect(catalog.entries).toHaveLength(1065);
  expect(catalog.classes).toHaveLength(12);
});

test('class slot progression is not overwritten by subclass feature-only rows', () => {
  const catalog = new CompendiumCatalog({ ...snapshot, ruleset: '2014' });
  const wizard = catalog.classes.find((entry) => entry.id === 'wizard');
  expect(wizard.slots['6']).toEqual([4, 3, 3, 0, 0, 0, 0, 0, 0]);
  expect(wizard.slots['10']).toEqual([4, 3, 3, 3, 2, 0, 0, 0, 0]);
});

test('individual weapon proficiency identifiers match the class rules', () => {
  const catalog = new CompendiumCatalog({ ...snapshot, ruleset: '2014' });
  const [dagger] = catalog.search('Dagger', { kind: 'item' });
  const wizard = catalog.classes.find((entry) => entry.id === 'wizard');
  expect(dagger.weapon.proficiency).toBe('daggers');
  expect(wizard.proficiencies).toContain(dagger.weapon.proficiency);
});

test('items needing unimplemented HP recalculation remain explicitly reference-only', () => {
  const catalog = new CompendiumCatalog({ ...snapshot, ruleset: '2014' });
  const [amulet] = catalog.search('Amulet of Health', { kind: 'item' });
  const [ring] = catalog.search('Ring of Protection', { kind: 'item' });
  expect(amulet.automation).toBe('reference');
  expect(amulet.effects).toEqual({});
  expect(ring.automation).toBe('effects');
  expect(ring.effects).toEqual({ ac: 1, saves: 1 });
});
