import {
  CHARACTER_DEFINITIONS,
  normalizeCreatureType,
} from '../../../../src/config/CharacterCatalog.js';
import {
  MANUAL_ACTIONS,
  HUMANOID_ANIMATIONS,
} from '../../../../src/config/HumanoidActionCatalog.js';
import { TOKEN_3D_MODELS } from '../../../../src/config/token-adapter/MannequinConfig.js';
import { CREATURE_SCALES } from '../../../../src/config/GameConstants.js';
import { getTokenCommand } from '../../../../src/config/TokenCommandConfig.js';
import { GameValidators } from '../../../../src/utils/Validation.js';
import { createCreature } from '../../../../src/entities/creatures/CreatureFactory.js';
import { getCreatureTypeLabel } from '../../../../src/entities/creatures/creatureHelpers.js';
import { setTokenMovementSettings } from '../../../../src/entities/creatures/TokenMovement.js';
import { applyTokenCommand } from '../../../../src/core/game-manager/internals/tokenCommands.js';
import { cloneHumanoidRig } from '../../../../src/scene/token-adapter/HumanoidRig.js';
import {
  createHumanoidFixture,
  finishHumanoid,
  handPositions,
  humanoidBounds,
  installHumanoidAssetFiles,
  stepHumanoid,
  wallSurface,
} from '../../../helpers/humanoid-fixture.js';

let restoreFiles;
let fixtures;

beforeAll(() => {
  restoreFiles = installHumanoidAssetFiles();
});
beforeEach(() => {
  fixtures = [];
});
afterEach(() => {
  for (const fixture of fixtures) fixture.adapter.disposeMovementRange();
});
afterAll(() => restoreFiles());

async function fixture(options) {
  const created = await createHumanoidFixture(options);
  fixtures.push(created);
  return created;
}

test('one character definition drives validation, generic creation, labels and model registration', () => {
  expect(Object.keys(CREATURE_SCALES)).toEqual(CHARACTER_DEFINITIONS.map(({ id }) => id));
  for (const character of CHARACTER_DEFINITIONS) {
    const creature = createCreature(character.id);
    expect(creature.type).toBe(character.id);
    expect(creature.sprite).toBeNull();
    expect(GameValidators.creatureType(character.id).isValid).toBe(true);
    expect(getCreatureTypeLabel(character.id)).toBe(character.label);
    expect(TOKEN_3D_MODELS[character.id].path).toBe(character.model.path);
    for (const alias of character.aliases) {
      expect(normalizeCreatureType(alias)).toBe(character.id);
      expect(createCreature(alias).type).toBe(character.id);
      expect(TOKEN_3D_MODELS[alias]).toBe(TOKEN_3D_MODELS[character.id]);
    }
  }
});

test('one action definition supplies the menu, clip and playback metadata without replacing Rumba', () => {
  expect(new Set(MANUAL_ACTIONS.map(({ id }) => id)).size).toBe(MANUAL_ACTIONS.length);
  for (const action of MANUAL_ACTIONS) {
    expect(getTokenCommand(action.id)).toBe(action);
    if (action.animation) {
      expect(HUMANOID_ANIMATIONS[action.animation.key].path).toBe(action.animation.path);
    }
  }
  expect(HUMANOID_ANIMATIONS.jump.path).toContain('Rumba Dancing');
  expect(HUMANOID_ANIMATIONS.actionJump.path).toContain('Jumping.fbx');
});

test('unsupported and independent same-named rigs fail explicitly', () => {
  expect(() => cloneHumanoidRig(new three.Group(), three)).toThrow(/missing required/);
  const root = new three.Group();
  for (let i = 0; i < 2; i++) {
    const bone = new three.Bone();
    bone.name = 'mixamorigHips';
    root.add(bone);
  }
  expect(() => cloneHumanoidRig(root, three)).toThrow(/Ambiguous humanoid bone/);
});

describe.each(CHARACTER_DEFINITIONS.map(({ id }) => [id]))('%s actual-FBX contract', (type) => {
  test('has grounded feet, a one-square footprint and the complete shared locomotion family', async () => {
    const f = await fixture({ type });
    const bounds = humanoidBounds(f);
    expect(Math.abs(bounds.min.y - f.token.world.y)).toBeLessThan(0.015);
    expect(bounds.max.y - bounds.min.y).toBeGreaterThan(0.8);
    expect(bounds.max.y - bounds.min.y).toBeLessThan(1.05);
    for (const key of [
      'idle',
      'walk',
      'walkBackward',
      'run',
      'runBackward',
      'drunkWalk',
      'drunkWalkBackward',
      'drunkRunForward',
      'drunkRunBackward',
      'climb',
      'climbWall',
      'climbWallDown',
      'climbRecover',
      'ledgeHang',
      'fall',
      'fallLoop',
      'hardLanding',
      'fallToRoll',
    ])
      expect(f.adapter.hasAnimation(f.token, key)).toBe(true);
    const collider = f.mesh.userData.__ttSelectionCollider;
    expect(collider.geometry.parameters.radiusTop).toBeCloseTo(0.46);
    expect(collider.geometry.parameters.radiusBottom).toBeCloseTo(0.46);
    if (type !== 'mannequin') {
      expect(
        f.skins.some((skin) => [].concat(skin.material).some((material) => material.map))
      ).toBe(true);
    }
  });

  test('a failed retarget is reported, never played raw, and can be retried', async () => {
    const f = await fixture({ type, height: 0 });
    f.adapter._animationClipCache = new Map();
    const retarget = jest
      .spyOn(f.adapter, '_retargetAnimationClip')
      .mockRejectedValueOnce(new Error('Incompatible rig'));
    await expect(applyTokenCommand(f.gm, f.token, 'action-wave')).rejects.toThrow(
      'Incompatible rig'
    );
    expect(f.data.current).toBe('idle');
    expect(f.adapter.hasAnimation(f.token, 'actionWave')).toBe(false);
    expect(f.token.quickCommand).toBeUndefined();
    retarget.mockRestore();
    await expect(applyTokenCommand(f.gm, f.token, 'action-wave')).resolves.toBe(true);
  });

  test.each(['movement', 'removal'])(
    'an action finishing its download after %s cannot interrupt or resurrect the creature',
    async (change) => {
      const f = await fixture({ type, height: 0 });
      const { adapter, token, data } = f;
      adapter._animationClipCache = new Map();
      const source = await adapter._loadAnimationSource(HUMANOID_ANIMATIONS.actionWave.path);
      let complete;
      const pendingSource = new Promise((resolve) => {
        complete = resolve;
      });
      const load = jest.spyOn(adapter, '_loadAnimationSource').mockReturnValue(pendingSource);
      const pending = applyTokenCommand(f.gm, token, 'action-wave');
      await expect(adapter.playTokenAction(token, 'action-punch')).rejects.toThrow(/still loading/);
      if (change === 'movement') {
        expect(adapter.requestMoveToGrid(token, 4, 4).cost).toBe(5);
      } else {
        adapter.onTokenRemoved(token);
      }
      complete(source);
      await expect(pending).rejects.toThrow(change === 'movement' ? /movement|climb/ : /removed/);
      load.mockRestore();
      expect(token.quickCommand).toBeUndefined();
      expect(data.actions.actionWave).toBeUndefined();
      if (change === 'movement') {
        finishHumanoid(f);
        expect(token.world).toEqual({ x: 4.5, y: 0, z: 4.5 });
      } else {
        expect(adapter._tokenAnimationData.has(token)).toBe(false);
        expect(token.__threeMesh).toBeUndefined();
        data.mixer.update(5);
        expect(token.__threeMesh).toBeUndefined();
      }
    }
  );

  test('preserves movement allowance, real-time style changes and exact flat-grid arrival', async () => {
    const f = await fixture({ type, height: 0 });
    const { adapter, token } = f;
    setTokenMovementSettings(token, { speed: 10 });
    expect(adapter.requestMoveToGrid(token, 2, 4)).toBeNull();
    expect(adapter.requestMoveToGrid(token, 3, 4).cost).toBe(10);
    expect(adapter.requestMoveToGrid(token, 4, 4)).toBeNull();
    for (let frame = 0; frame < 20; frame++) stepHumanoid(f);
    setTokenMovementSettings(token, { mode: 'run', type: 'drunk' });
    adapter.applyMovementStyle(token);
    const keys = new Set();
    finishHumanoid(f, () => {
      const key = adapter._movementStates.get(token)?.loopActionKey;
      if (key) keys.add(key);
    });
    expect(keys.has('drunkRunForward')).toBe(true);
    expect(token.world).toEqual({ x: 3.5, y: 0, z: 4.5 });
    expect([token.gridX, token.gridY]).toEqual([3, 4]);
    expect(token.__ttWorldLock).toBeUndefined();
    expect(Math.abs(humanoidBounds(f).min.y)).toBeLessThan(0.025);
  });

  test('charges double vertical distance, holds still and resumes up/down without a pose jump', async () => {
    const f = await fixture({ type, height: 40 });
    const { adapter, token, data } = f;
    setTokenMovementSettings(token, { speed: 50 });
    expect(adapter.requestMoveToSurface(token, wallSurface(2)).cost).toBe(25);
    finishHumanoid(f);
    const held = handPositions(f);
    for (let frame = 0; frame < 120; frame++) stepHumanoid(f);
    expect(handPositions(f).every((hand, i) => hand.distanceTo(held[i]) < 1e-8)).toBe(true);
    expect(adapter.requestMoveToSurface(token, wallSurface(7.1))).toBeNull();
    expect(adapter.requestMoveToSurface(token, wallSurface(7)).cost).toBe(50);
    finishHumanoid(f);
    expect(token.world.y).toBeCloseTo(7);
    expect(adapter.isWallAttached(token)).toBe(true);
    expect(adapter.requestMoveToSurface(token, wallSurface(6)).cost).toBeCloseTo(10, 8);
    finishHumanoid(f);
    expect(token.world.y).toBeCloseTo(6);
    expect(data.current).toBe('climbWallDown');
    await expect(applyTokenCommand(f.gm, token, 'action-wave')).rejects.toThrow(/movement|climb/);
    expect(token.quickCommand).toBeUndefined();
  });

  test('hangs with both hands at the lip, then finishes on top rather than stopping mid-crouch', async () => {
    const f = await fixture({ type, high: true });
    const { adapter, token, data } = f;
    expect(adapter.requestMoveToSurface(token, wallSurface(7))).toBeTruthy();
    finishHumanoid(f);
    expect(data.current).toBe('ledgeHang');
    for (const hand of handPositions(f)) {
      expect(Math.abs(hand.x - 6)).toBeLessThan(0.025);
      expect(Math.abs(hand.y - 7.2)).toBeLessThan(0.025);
    }
    const held = handPositions(f);
    for (let frame = 0; frame < 120; frame++) stepHumanoid(f);
    expect(handPositions(f).every((hand, i) => hand.distanceTo(held[i]) < 1e-8)).toBe(true);
    expect(adapter.requestMoveToGrid(token, 6, 4)).toBeTruthy();
    finishHumanoid(f);
    expect(token.world.y).toBeCloseTo(7.2);
    expect(data.current).toBe('idle');
    expect(token.__ttWorldLock).toBeUndefined();
    expect(Math.abs(humanoidBounds(f).min.y - 7.2)).toBeLessThan(0.025);
  });

  test('Run releases a wall hold into the same gravity-driven fall and grounded recovery', async () => {
    const f = await fixture({ type, high: true });
    const { adapter, token, data } = f;
    expect(adapter.requestMoveToSurface(token, wallSurface(4))).toBeTruthy();
    finishHumanoid(f);
    setTokenMovementSettings(token, { mode: 'run' });
    adapter.applyMovementStyle(token);
    expect(adapter.requestMoveToGrid(token, 5, 4).cost).toBe(0);
    for (
      let frame = 0;
      frame < 120 && adapter._movementStates.get(token)?.phase !== 'fall';
      frame++
    ) {
      stepHumanoid(f);
    }
    expect(adapter._movementStates.get(token).phase).toBe('fall');
    await expect(adapter.playTokenAction(token, 'action-punch')).rejects.toThrow(/movement|climb/);
    let airborne = 0;
    while (token.world.y > 1e-8 && airborne < 5) {
      stepHumanoid(f);
      airborne += 1 / 120;
    }
    expect(airborne).toBeGreaterThanOrEqual(Math.sqrt(40 / 32.174) - 1e-9);
    expect(airborne).toBeLessThan(Math.sqrt(40 / 32.174) + 1 / 120);
    finishHumanoid(f);
    expect(token.world).toEqual({ x: 5.5, y: 0, z: 4.5 });
    expect(data.current).toBe('idle');
    expect(token.__ttWorldLock).toBeUndefined();
    expect(Math.abs(humanoidBounds(f).min.y)).toBeLessThan(0.025);
  });

  test.each(MANUAL_ACTIONS.map((action) => [action.id, action]))(
    '%s loads and plays without changing gameplay position or movement settings',
    async (commandId, definition) => {
      const f = await fixture({ type, height: definition.requiresWall ? 24 : 0 });
      const { adapter, token, data } = f;
      const world = { ...token.world };
      const settings = { ...token.movementSettings };
      const before = handPositions(f);
      if (definition.animation?.lazy)
        expect(adapter.hasAnimation(token, definition.animation.key)).toBe(false);
      await expect(applyTokenCommand(f.gm, token, commandId)).resolves.toBe(true);
      expect(token.quickCommand).toBe(commandId);
      const key = data.current;
      expect(definition.choices || [definition.animation.key]).toContain(key);
      let motion = 0;
      const duration = data.clips[key];
      for (let frame = 0; frame < Math.ceil((duration + 0.3) * 60); frame++) {
        stepHumanoid(f, 1 / 60);
        for (const [i, hand] of handPositions(f).entries()) {
          motion = Math.max(motion, hand.distanceTo(before[i]));
        }
      }
      if (definition.requiresWall) {
        expect(token.world.y).toBe(world.y);
        expect(Math.hypot(token.world.x - world.x, token.world.z - world.z)).toBeLessThan(0.5);
      } else {
        expect(token.world).toEqual(world);
      }
      expect(token.movementSettings).toEqual(settings);
      expect(adapter.isMovementInProgress(token)).toBe(false);
      if (definition.group === 'actions') expect(motion).toBeGreaterThan(0.005);
      if (definition.revertTo) {
        expect(data.current).toBe(definition.revertTo);
        expect(adapter._getManualAnimationState(token)).toBeNull();
      } else if (definition.requiresWall) {
        expect(data.current).toBe('actionCoverHold');
      } else {
        expect(data.current).toBe(key);
      }
    }
  );
});
import * as three from 'three';
