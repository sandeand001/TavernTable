import { createStructure } from '../../../src/terrain/ConstructionBlueprints.js';
import {
  cellarConnectionCandidates,
  cellarConnectionFits,
} from '../../../src/terrain/CellarConnections.js';
import { structureDisplayName } from '../../../src/terrain/BuildingModel.js';

const building = (changes) =>
  createStructure({
    id: 'structure-1',
    kind: 'building',
    xFeet: 60,
    zFeet: 60,
    lengthFeet: 30,
    widthFeet: 30,
    ...changes,
  });
const cellar = (changes) =>
  createStructure({
    id: 'cellar',
    kind: 'cellar',
    xFeet: 60,
    zFeet: 60,
    lengthFeet: 60,
    widthFeet: 50,
    building: { access: { kind: 'ladder', structureId: null, xFeet: 0, zFeet: 0 } },
    ...changes,
  });

test('menu names and on-map identifiers use the same readable building number', () => {
  expect(structureDisplayName(building())).toBe('Building 1');
  expect(structureDisplayName(building({ id: 'structure-12', kind: 'turret' }))).toBe('Turret 12');
  expect(structureDisplayName(cellar({ id: 'structure-9' }))).toBe('Cellar 9');
});

test('only buildings that contain the actual access hatch and landing appear, not distant or merely overlapping shells', () => {
  const near = building(),
    far = building({ id: 'far', xFeet: 120 });
  const edge = building({ id: 'edge', xFeet: 77.5 });
  const wrongHeight = building({ id: 'raised', baseFeet: 10 });
  expect(
    cellarConnectionCandidates(cellar(), [near, far, edge, wrongHeight]).map((s) => s.id)
  ).toEqual([near.id]);
  expect(cellarConnectionFits(cellar(), edge)).toBe(false);
});

test('moving an access point changes the available buildings without moving the cellar footprint', () => {
  const a = building(),
    b = building({ id: 'structure-2', xFeet: 95 });
  const spec = cellar({
    xFeet: 77.5,
    lengthFeet: 90,
    building: { access: { kind: 'ladder', structureId: null, xFeet: -17.5, zFeet: 0 } },
  });
  expect(cellarConnectionCandidates(spec, [a, b]).map((s) => s.id)).toEqual([a.id]);
  const shifted = {
    ...spec,
    building: { ...spec.building, access: { ...spec.building.access, xFeet: 17.5 } },
  };
  expect(cellarConnectionCandidates(shifted, [a, b]).map((s) => s.id)).toEqual([b.id]);
});

test('rotated and round targets use their real inner footprint, not their padded grid or enclosing square', () => {
  const round = building({ kind: 'turret', diameterFeet: 30, angleRadians: Math.PI / 2 });
  expect(cellarConnectionFits(cellar(), round)).toBe(true);
  expect(
    cellarConnectionFits(
      cellar({
        building: { access: { kind: 'ladder', structureId: null, xFeet: 11, zFeet: 11 } },
      }),
      round
    )
  ).toBe(false);
  expect(cellarConnectionFits(cellar(), building({ angleRadians: Math.PI / 2 }))).toBe(true);
});
