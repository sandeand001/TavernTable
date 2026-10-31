import { CHARACTER_DEFINITIONS } from '../../../../../src/config/CharacterCatalog.js';
import { setTokenMovementSettings } from '../../../../../src/entities/creatures/TokenMovement.js';
import {
  createHumanoidFixture,
  finishHumanoid,
  installHumanoidAssetFiles,
} from '../../../../helpers/humanoid-fixture.js';

let restoreFiles;
const fixtures = [];

beforeAll(() => {
  restoreFiles = installHumanoidAssetFiles();
});
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.adapter.disposeMovementRange();
});
afterAll(() => restoreFiles());

const directions = [
  ['east', { x: 3, y: 3 }, { x: 9, y: 3 }, (x) => x <= 4],
  ['west', { x: 8, y: 3 }, { x: 2, y: 3 }, (x) => x >= 7],
  ['north', { x: 4, y: 6 }, { x: 4, y: 0 }, (_, y) => y >= 5],
  ['south', { x: 4, y: 1 }, { x: 4, y: 7 }, (_, y) => y <= 2],
];

describe.each(CHARACTER_DEFINITIONS.map(({ id }) => id))('%s planned rolling landings', (type) => {
  test.each(directions)(
    '%s: a clear 13.5-foot drop plays the grounded roll within 30 feet',
    async (_, start, goal, isHigh) => {
      const f = await createHumanoidFixture({ type, height: 0, elevationUnit: 0.3 });
      fixtures.push(f);
      f.gm.getTerrainHeight = (x, y) => (isHigh(x, y) ? 9 : 0);
      f.token.gridX = start.x;
      f.token.gridY = start.y;
      f.adapter._syncTokenAndMeshWorld(
        { token: f.token, mesh: f.mesh },
        { x: start.x + 0.5, y: 2.7, z: start.y + 0.5 }
      );
      setTokenMovementSettings(f.token, { mode: 'run', speed: 30 });

      const request = f.adapter.requestMoveToGrid(f.token, goal.x, goal.y);
      expect(request).toBeTruthy();
      expect(request.cost).toBe(30);
      const landings = new Set();
      finishHumanoid(f, () => {
        const state = f.adapter._movementStates.get(f.token);
        if (state?.fallMode === 'landing') landings.add(state.fallLandingKey);
      });

      expect(landings).toContain('fallToRoll');
      expect(landings).not.toContain('hardLanding');
      expect(f.token.world).toEqual({ x: goal.x + 0.5, y: 0, z: goal.y + 0.5 });
    }
  );
});

test.each([
  ['the route ends at contact', { x: 5, y: 3 }, (x) => (x <= 4 ? 9 : 0)],
  ['the route turns after contact', { x: 6, y: 2 }, (x) => (x <= 4 ? 9 : 0)],
  [
    'the landing has another elevation change',
    { x: 8, y: 3 },
    (x) => (x <= 4 ? 9 : x <= 5 ? 0 : 1),
  ],
])('retains a hard landing when %s', async (_, goal, getHeight) => {
  const f = await createHumanoidFixture({ type: 'mutant', height: 0, elevationUnit: 0.3 });
  fixtures.push(f);
  f.gm.getTerrainHeight = getHeight;
  f.token.gridX = 3;
  f.token.gridY = 3;
  f.adapter._syncTokenAndMeshWorld({ token: f.token, mesh: f.mesh }, { x: 3.5, y: 2.7, z: 3.5 });
  setTokenMovementSettings(f.token, { mode: 'run', speed: 30 });

  expect(f.adapter.requestMoveToGrid(f.token, goal.x, goal.y)).toBeTruthy();
  const landings = new Set();
  finishHumanoid(f, () => {
    const state = f.adapter._movementStates.get(f.token);
    if (state?.fallMode === 'landing') landings.add(state.fallLandingKey);
  });

  expect(landings).toContain('hardLanding');
  expect(landings).not.toContain('fallToRoll');
  expect(f.token.world).toEqual({
    x: goal.x + 0.5,
    y: getHeight(goal.x, goal.y) * 0.3,
    z: goal.y + 0.5,
  });
});
