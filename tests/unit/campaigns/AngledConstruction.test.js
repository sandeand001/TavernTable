import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { sceneState } from '../../helpers/sceneState.js';
import {
  isSurfaceGripValid,
  wallClimbStarts,
  planSurfaceClimb,
} from '../../../src/campaigns/CampaignSurfaceClimb.js';

test.each([Math.PI / 4, -Math.PI / 6, Math.PI / 2])(
  'an angled wall has paid vertical and sideways climbing with a saved real normal: %s',
  (angleRadians) => {
    localStorage.clear();
    const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
    const engine = new TerrainEngine(25, 25);
    engine.placeStructure({
      id: 'angled',
      kind: 'wall',
      xFeet: 60,
      zFeet: 60,
      lengthFeet: 40,
      heightFeet: 20,
      angleRadians,
    });
    const scene = sceneState();
    scene.version = 2;
    scene.grid = { cols: 25, rows: 25, tileWorldSize: 1 };
    scene.terrain.heights = engine.save().heights;
    scene.terrain.geometry = engine.geometry.save();
    const world = CampaignWorld.fromScene(scene, { ruleset: '2014', library });
    const normal = { x: -Math.sin(angleRadians), y: 0, z: Math.cos(angleRadians) };
    const contact = { x: 60 + normal.x, y: 5, z: 60 + normal.z };
    const picked = {
      point: { x: contact.x / 5, y: 2, z: contact.z / 5 },
      normal,
    };
    const starts = wallClimbStarts(world, 'map-main', { x: 10, y: 0, z: 16 }, picked);
    expect(starts.length).toBeGreaterThan(0);
    const start = starts[0];
    expect(
      isSurfaceGripValid(
        world.save().maps,
        {
          mapId: 'map-main',
          pose: { kind: 'grip', world: start.world, grip: start.grip },
        },
        (id) => world.getMapGeometry(id)
      )
    ).toBe(true);
    const raised = planSurfaceClimb(
      world,
      'map-main',
      start.world,
      start.grip,
      {
        point: {
          x: start.world.x - (normal.x * start.grip.offsetFeet) / 5,
          y: 3,
          z: start.world.z - (normal.z * start.grip.offsetFeet) / 5,
        },
        normal,
      },
      { allowanceFeet: 30 }
    );
    expect(raised.costFeet).toBe(20);
    expect(raised.targetWorld.y).toBeCloseTo(2);
    const last = raised.points.at(-1);
    const sideways = planSurfaceClimb(
      world,
      'map-main',
      last.world,
      last.pose.grip,
      {
        point: {
          x: last.world.x + Math.cos(angleRadians) - (normal.x * start.grip.offsetFeet) / 5,
          y: 3,
          z: last.world.z + Math.sin(angleRadians) - (normal.z * start.grip.offsetFeet) / 5,
        },
        normal,
      },
      { allowanceFeet: 20 }
    );
    expect(sideways.points.at(-1).pose.kind).toBe('grip');
    expect(sideways.costFeet).toBeGreaterThan(0);
  }
);
