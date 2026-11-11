import { createStructure } from '../../../src/terrain/ConstructionBlueprints.js';
import {
  stretchStructure,
  stretchStructureHeight,
  stretchBuildingFeature,
  buildingFeatureHandlePoints,
} from '../../../src/terrain/ConstructionHandles.js';

test('a side drag preserves the opposite wall and uses grid or fine increments', () => {
  const spec = createStructure({
    id: 'house',
    kind: 'building',
    xFeet: 60,
    zFeet: 60,
    lengthFeet: 30,
    widthFeet: 25,
    heightFeet: 20,
  });
  const grid = stretchStructure(spec, 'west', { x: 38.2, z: 60 });
  expect(grid.xFeet + grid.lengthFeet / 2).toBe(75);
  expect(grid.lengthFeet).toBe(35);
  const fine = stretchStructure(spec, 'west', { x: 38.2, z: 60 }, { fine: true });
  expect(fine.lengthFeet).toBe(37);
  expect(fine.xFeet + fine.lengthFeet / 2).toBe(75);
  expect(stretchStructureHeight(spec, 13).heightFeet).toBe(30);
});

test('round structures stretch their diameter around the anchored opposite edge', () => {
  const spec = createStructure({
    id: 'dome',
    kind: 'dome',
    xFeet: 60,
    zFeet: 60,
    diameterFeet: 30,
  });
  const next = stretchStructure(spec, 'east', { x: 85, z: 60 });
  expect(next.diameterFeet).toBe(40);
  expect(next.xFeet - next.diameterFeet / 2).toBe(45);
  expect(next.zFeet).toBe(60);
});

test.each(['stalagmite', 'stalactite'])(
  '%s diameter handles preserve narrow sizes and use half-foot changes',
  (kind) => {
    const spec = createStructure({
      id: 'narrow',
      kind,
      xFeet: 60,
      zFeet: 60,
      diameterFeet: 3.7,
    });
    const grip = spec.xFeet + spec.diameterFeet / 2;
    expect(stretchStructure(spec, 'east', { x: grip, z: 60 })).toEqual(spec);
    const expanded = stretchStructure(spec, 'east', { x: grip + 0.6, z: 60 });
    expect(expanded.diameterFeet).toBeCloseTo(4.2);
    expect(expanded.xFeet - expanded.diameterFeet / 2).toBeCloseTo(58.15);
    const minimum = stretchStructure(spec, 'east', { x: 50, z: 60 });
    expect(minimum.diameterFeet).toBe(1);
    expect(minimum.xFeet - minimum.diameterFeet / 2).toBeCloseTo(58.15);
  }
);

test('short terrace stair height handles preserve an unmoved grip and retain their lower bound', () => {
  const spec = createStructure({
    id: 'short-stair',
    kind: 'wall',
    style: 'battlement',
    wallStairs: true,
    wallStairExit: 'terrace',
    xFeet: 60,
    zFeet: 60,
    heightFeet: 3,
    lengthFeet: 80,
  });
  expect(stretchStructureHeight(spec, 0)).toEqual(spec);
  expect(stretchStructureHeight(spec, 5).heightFeet).toBe(8);
  expect(stretchStructureHeight(spec, -5).heightFeet).toBe(0.5);
});

function house() {
  return createStructure({
    id: 'house',
    kind: 'building',
    xFeet: 60,
    zFeet: 60,
    heightFeet: 40,
    lengthFeet: 40,
    widthFeet: 30,
  });
}
const windowFeature = {
  id: 'wide',
  floor: 1,
  side: 'south',
  u: 0.5,
  widthFeet: 5,
  heightFeet: 5,
  sillFeet: 2,
};

test('window side and corner handles anchor the opposite edge and can grow across storeys', () => {
  const spec = house(),
    window = { ...windowFeature };
  const next = stretchBuildingFeature(spec, window, 'window', 'feature-top-east', {
    alongFeet: 10,
    elevationFeet: 12.4,
    depthFeet: 0,
  });
  expect(next.widthFeet).toBe(15);
  expect(next.u).toBe(0.625);
  expect((next.u - 0.5) * 40 - next.widthFeet / 2).toBe(-2.5);
  expect(next.sillFeet).toBe(2);
  expect(next.heightFeet).toBe(17.5);
  expect(window).toEqual(windowFeature);
});

test('window handles reach half-foot sizes, support fine adjustments and do not round a zero-distance grab', () => {
  const spec = house();
  const small = stretchBuildingFeature(spec, windowFeature, 'window', 'feature-east', {
    alongFeet: -100,
    elevationFeet: 0,
    depthFeet: 0,
  });
  expect(small.widthFeet).toBe(0.5);
  const fine = stretchBuildingFeature(
    spec,
    windowFeature,
    'window',
    'feature-east',
    { alongFeet: 1.24, elevationFeet: 0, depthFeet: 0 },
    { fine: true }
  );
  expect(fine.widthFeet).toBeCloseTo(6.2);
  expect(
    stretchBuildingFeature(spec, fine, 'window', 'feature-east', {
      alongFeet: 0,
      elevationFeet: 0,
      depthFeet: 0,
    })
  ).toEqual(fine);
});

test('window bottom and movement handles preserve the top or size and stay clear of floor/roof bands', () => {
  const spec = house();
  const low = stretchBuildingFeature(spec, windowFeature, 'window', 'feature-bottom', {
    alongFeet: 0,
    elevationFeet: -10,
    depthFeet: 0,
  });
  expect(low.sillFeet).toBe(0.5);
  expect(low.heightFeet).toBe(6.5);
  const moved = stretchBuildingFeature(spec, windowFeature, 'window', 'feature-move', {
    alongFeet: 2.6,
    elevationFeet: 1.1,
    depthFeet: 0,
  });
  expect(moved).toMatchObject({ u: 0.5625, sillFeet: 3, widthFeet: 5, heightFeet: 5 });
});

test('balcony corner handles resize width/depth without changing the floor and keep the far width edge anchored', () => {
  const spec = house(),
    balcony = { id: 'deck', floor: 2, side: 'east', u: 0.5, widthFeet: 10, depthFeet: 5 };
  const next = stretchBuildingFeature(spec, balcony, 'balcony', 'feature-depth-east', {
    alongFeet: 5,
    elevationFeet: 0,
    depthFeet: 5,
  });
  expect(next).toMatchObject({ floor: 2, widthFeet: 15, depthFeet: 10 });
  expect((next.u - 0.5) * 30 - next.widthFeet / 2).toBeCloseTo(-5, 10);
});

test('feature handles lie on the selected wall or actual balcony deck, including quarter-turn buildings', () => {
  const spec = { ...house(), angleRadians: Math.PI / 2 };
  const points = buildingFeatureHandlePoints(spec, windowFeature, 'window');
  expect(points['feature-top']).toMatchObject({ x: 0, y: 17 });
  expect(points['feature-east'].x).toBe(2.5);
  const balcony = { id: 'deck', floor: 2, side: 'south', u: 0.5, widthFeet: 10, depthFeet: 7.5 };
  const deck = buildingFeatureHandlePoints(spec, balcony, 'balcony');
  expect(deck['feature-depth']).toMatchObject({ y: 20, z: 22.5 });
});
