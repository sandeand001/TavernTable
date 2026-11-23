import { buildLocationOverview } from '../../../src/campaigns/LocationOverview.js';

function map(id, locationId, { cols = 10, rows = 8, y = 0, quarterTurns = 0 } = {}) {
  return {
    id,
    name: id,
    locationId,
    grid: { cols, rows },
    originFeet: { x: 0, y, z: 0 },
    quarterTurns,
  };
}

test('a location overview connects cavern chambers without including outside or unrelated locations', () => {
  const scene = {
    maps: [
      map('main', 'main'),
      map('chamber', 'chamber', { cols: 6, rows: 8, quarterTurns: 1 }),
      map('upper', 'main', { y: 12 }),
      map('outside', 'outside'),
      map('unrelated', 'unrelated'),
    ],
    connections: [
      {
        id: 'stairs',
        name: 'Upper stairs',
        kind: 'stairs',
        ends: [
          { mapId: 'main', positionFeet: { x: 5, y: 0, z: 5 } },
          { mapId: 'upper', positionFeet: { x: 5, y: 0, z: 5 } },
        ],
      },
    ],
    logicalPassages: [
      {
        id: 'connected',
        kind: 'chamber',
        ends: [
          { mapId: 'main', side: 'east' },
          { mapId: 'chamber', side: 'west' },
        ],
      },
      {
        id: 'outside',
        kind: 'outside',
        ends: [
          { mapId: 'main', side: 'west' },
          { mapId: 'outside', side: 'east' },
        ],
      },
    ],
  };
  const before = JSON.parse(JSON.stringify(scene));
  const overview = buildLocationOverview(scene, 'main');
  expect(overview.nodes.map(({ id }) => id).sort()).toEqual(['chamber', 'main', 'upper']);
  expect(overview.edges.map(({ id, kind }) => [id, kind])).toEqual([
    ['connected', 'passage'],
    ['stairs', 'stairs'],
  ]);
  expect(overview.levels.map(({ level }) => level)).toEqual([12, 0]);
  const main = overview.nodes.find(({ id }) => id === 'main');
  const chamber = overview.nodes.find(({ id }) => id === 'chamber');
  expect(chamber.width).toBe(80);
  expect(chamber.height).toBe(60);
  expect(
    chamber.x >= main.x + main.width ||
      main.x >= chamber.x + chamber.width ||
      chamber.y >= main.y + main.height ||
      main.y >= chamber.y + chamber.height
  ).toBe(true);
  expect(
    overview.edges.every((edge) => edge.points.every(({ x, y }) => Number.isFinite(x + y)))
  ).toBe(true);
  expect(scene).toEqual(before);
  expect(buildLocationOverview(JSON.parse(JSON.stringify(scene)), 'main')).toEqual(overview);
  expect(buildLocationOverview(scene, 'chamber')).toEqual(overview);
});

test('a requested location must exist', () => {
  expect(() => buildLocationOverview({ maps: [map('a', 'one')] }, 'missing')).toThrow(
    /selected location/i
  );
});

test('very different area sizes can be arranged without overlapping', () => {
  const scene = {
    maps: [
      map('a', 'one', { cols: 100, rows: 100 }),
      map('b', 'one', { cols: 100, rows: 100 }),
      map('c', 'one', { cols: 5, rows: 5 }),
    ],
    connections: ['b', 'c'].map((target) => ({
      id: target,
      name: target,
      kind: 'opening',
      ends: [
        { mapId: 'a', positionFeet: { x: 499, y: 0, z: 250 } },
        { mapId: target, positionFeet: { x: 1, y: 0, z: target === 'b' ? 250 : 12.5 } },
      ],
    })),
  };
  const overview = buildLocationOverview(scene, 'one');
  for (const [index, first] of overview.nodes.entries())
    for (const second of overview.nodes.slice(index + 1))
      expect(
        first.x + first.width <= second.x ||
          second.x + second.width <= first.x ||
          first.y + first.height <= second.y ||
          second.y + second.height <= first.y
      ).toBe(true);
});

test('repeated windows do not obscure clearer area connections', () => {
  const end = (mapId) => ({ mapId, positionFeet: { x: 5, y: 0, z: 5 } });
  const scene = {
    maps: [map('outside', 'one'), map('inside', 'one'), map('upper', 'one', { y: 10 })],
    connections: [
      { id: 'door', name: 'Door', kind: 'door', ends: [end('outside'), end('inside')] },
      { id: 'window-1', name: 'Window', kind: 'window', ends: [end('outside'), end('inside')] },
      { id: 'window-2', name: 'Window', kind: 'window', ends: [end('outside'), end('upper')] },
      { id: 'window-3', name: 'Window', kind: 'window', ends: [end('outside'), end('upper')] },
    ],
  };
  const edges = buildLocationOverview(scene, 'one').edges;
  expect(edges.map(({ id }) => id)).toEqual(['door', 'window-2']);
  expect(edges.find(({ id }) => id === 'window-2').name).toBe('Window access (2 openings)');
});
