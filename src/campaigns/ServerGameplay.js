import CampaignWorld from './CampaignWorld.js';
import CombatSession from '../entities/characters/CombatSession.js';
import {
  getTokenConditions,
  linkTokenCharacter,
  facingAngleFromDirection,
  buildMovementRange,
  getMovementRoute,
  setTokenMovementSettings,
} from '../entities/creatures/TokenMovement.js';
import { encodeScene } from './CampaignScene.js';
import { buildSurfaceRange, getSurfaceRoute } from '../terrain/SurfaceNavigation.js';
import { MAX_STEP_HEIGHT_FEET, FLIGHT_TAKEOFF_FEET } from '../config/TokenMovementConfig.js';
import { boundsIntersectSolid } from '../terrain/ConvexGeometry.js';
import { playerCreatureVisibility } from './CreatureVisibility.js';
import { collectCollisionObstacles } from '../systems/dice/DicePhysics.js';
import ServerTargeting from './ServerTargeting.js';
import { getCharacterDefinition } from '../config/CharacterCatalog.js';
import { PLAYER_COMMAND_KINDS } from './PlayerCommandProtocol.js';
import { fallingDice } from '../rules/falling.js';
import { ConnectionUnavailableError } from './CampaignConnections.js';
import { navigationGeometry } from '../scene/token-adapter/movement/SurfaceMotion.js';
import { campaignLandingForSupport } from '../scene/token-adapter/SavedPlacements.js';
import { getTokenCommand } from '../config/TokenCommandConfig.js';

const copy = (value) => JSON.parse(JSON.stringify(value));

export function gameplayError(message, code, status = 422) {
  return Object.assign(new Error(message), { code, status });
}

export function gameplayRuntime(scene, library) {
  const world = CampaignWorld.fromScene(scene, { ruleset: library.ruleset, library });
  const actors = scene.creatures.map((saved) => {
    const actor = {
      id: saved.id,
      name: saved.name,
      type: saved.type,
      allegiance: saved.allegiance || 'neutral',
      creatureType: saved.creatureType || 'humanoid',
      creatureSize: saved.creatureSize || 'medium',
      mapId: scene.version === 3 ? saved.mapId : 'map-main',
      gridX: saved.gridX,
      gridY: saved.gridY,
      world: { ...saved.pose.world },
      facingAngle: saved.facingAngle,
      movementSettings: { ...saved.movement },
      flightActive: saved.pose.kind === 'flight',
    };
    if (saved.characterId) linkTokenCharacter(actor, library, saved.characterId);
    return actor;
  });
  const combat = new CombatSession({
    library,
    hasToken: (actor) => actors.includes(actor),
    getLocationId: (actor) => world.getLocationId(actor.mapId),
  });
  combat.restore(scene.combat, actors);
  return { world, actors, combat };
}

function playerMovementBudget(combat, actor, travelMode) {
  const status = combat.status(actor, travelMode);
  return status.active
    ? status.movement
    : {
        spent: status.movement.spent,
        remaining: combat.freeMovementAllowance(actor, travelMode),
        total: status.movement.base,
      };
}

export function playerGameplayState(scene, library, ownedIds) {
  if (!scene)
    return {
      version: 1,
      commands: [...PLAYER_COMMAND_KINDS],
      ownedTokens: [],
      turn: null,
    };
  const runtime = gameplayRuntime(scene, library);
  const owned = new Set(ownedIds);
  return {
    version: 1,
    commands: [...PLAYER_COMMAND_KINDS],
    turn: runtime.combat.active
      ? {
          active: true,
          number: runtime.combat.turn,
          tokenId: owned.has(runtime.combat.activeToken?.characterSheetId)
            ? runtime.combat.activeToken.id
            : null,
        }
      : null,
    ownedTokens: runtime.actors
      .filter((actor) => owned.has(actor.characterSheetId))
      .map((actor) => {
        runtime.combat.targeting = new ServerTargeting({
          runtime,
          scene,
          library,
          actor,
          ownedIds,
        });
        const status = runtime.combat.status(actor);
        const movement = playerMovementBudget(runtime.combat, actor);
        const permittedTurn = !status.active || status.isTurn;
        const saved = scene.creatures.find((entry) => entry.id === actor.id);
        const supportedPose =
          saved.pose.kind === 'ground' ||
          (saved.pose.kind === 'flight' &&
            library.rules.flightAvailability(
              runtime.combat.movementCharacter(actor, library.get(actor.characterSheetId))
            ).allowed);
        const canMove =
          permittedTurn &&
          !status.busy &&
          !status.downed &&
          movement.remaining > 0 &&
          supportedPose;
        const moveCode = canMove
          ? 'allowed'
          : !permittedTurn
            ? 'not-your-turn'
            : !supportedPose
              ? 'unsupported-pose'
              : status.busy
                ? 'busy'
                : status.downed
                  ? 'downed'
                  : 'movement-unavailable';
        return {
          tokenId: actor.id,
          mapId: actor.mapId,
          availability: {
            move: {
              allowed: canMove,
              code: moveCode,
              reason: canMove
                ? null
                : !permittedTurn
                  ? 'Wait for your active turn'
                  : !supportedPose
                    ? 'This movement pose is not supported yet'
                    : status.busy
                      ? 'Finish the current action or movement'
                      : 'No movement is available',
            },
            'turn.end': {
              allowed: status.isTurn && !status.busy,
              code: status.isTurn && !status.busy ? 'allowed' : 'not-your-turn',
            },
            remove: {
              allowed:
                !status.active &&
                !status.busy &&
                saved.pose.kind === 'ground' &&
                !library.get(actor.characterSheetId).concentration &&
                !runtime.combat.effects.some(
                  (effect) =>
                    effect.characterId === actor.characterSheetId ||
                    effect.targetTokenIds?.includes(actor.id)
                ),
              code: status.active ? 'combat-dm-only' : 'safe-removal-required',
              reason: status.active
                ? 'Only the DM may remove sprites during combat'
                : 'Remove only a grounded creature after resolving active effects',
            },
          },
          economy: {
            actions: status.actions,
            bonusActions: status.bonusActions,
            reactions: status.reactions,
            restrictedActions: status.restrictedActions,
            attacksRemaining: status.attacksRemaining,
            attacksAvailable: status.attacksAvailable,
            bonusAttacksRemaining: status.bonusAttacksRemaining,
          },
          availableActions: copy(runtime.combat.availableActions(actor)),
          canUndo: status.canUndo,
          movement: {
            spentFeet: movement.spent,
            remainingFeet: movement.remaining,
            allowanceFeet: movement.total,
          },
        };
      }),
  };
}

export async function movePlayerActor(
  scene,
  library,
  tokenId,
  target,
  { dice, id, useSlowFall } = {}
) {
  const runtime = gameplayRuntime(scene, library);
  const actor = runtime.actors.find((entry) => entry.id === tokenId);
  const saved = scene.creatures.find((entry) => entry.id === tokenId);
  if (
    !actor ||
    !target ||
    target.mapId !== actor.mapId ||
    !Number.isInteger(target.gridX) ||
    !Number.isInteger(target.gridY)
  )
    throw gameplayError('Choose a valid destination on this actor map', 'invalid-destination');
  if (saved.pose.kind === 'flight') return moveFlyingActor(scene, library, runtime, actor, target);
  if (saved.pose.kind !== 'ground')
    throw gameplayError('This movement pose is not supported yet', 'unsupported-movement');
  const map = runtime.world.getMap(actor.mapId);
  const occupied = [];
  const unit = map.grid.tileWorldSize / 5;
  for (const other of runtime.actors) {
    if (other === actor || !runtime.world.sharesLocation(other.mapId, actor.mapId)) continue;
    const position = runtime.world.toMapPosition(
      actor.mapId,
      runtime.world.getCampaignPosition(other.id)
    );
    occupied.push({
      gridX: Math.floor(position.x / map.grid.tileWorldSize),
      gridY: Math.floor(position.z / map.grid.tileWorldSize),
      heightFeet: position.y / unit,
    });
  }

  const blocked = new Set(
    map.terrain.placeables
      .filter((entry) => ['plant', 'structure'].includes(entry.type))
      .map((entry) => `${entry.gridX},${entry.gridY}`)
  );
  const status = runtime.combat.status(actor);
  if ((status.active && !status.isTurn) || status.busy || status.downed)
    throw gameplayError('Movement requires your active, available turn', 'not-your-turn');
  const range = buildSurfaceRange({
    geometry: navigationGeometry({
      campaignWorld: runtime.world,
      campaignMapId: actor.mapId,
      spatial: { tileWorldSize: map.grid.tileWorldSize },
      terrainEngine: { geometry: runtime.world.getMapGeometry(actor.mapId) },
    }),
    start: {
      gridX: actor.gridX,
      gridY: actor.gridY,
      xFeet: actor.world.x / unit,
      zFeet: actor.world.z / unit,
      heightFeet: actor.world.y / unit,
      surfaceId: saved.pose.surfaceId,
    },
    speedFeet: playerMovementBudget(runtime.combat, actor).remaining,
    prone: getTokenConditions(actor).includes('prone'),
    isOccupied: (x, y, height, bodyHeight) =>
      blocked.has(`${x},${y}`) ||
      occupied.some(
        (other) =>
          other.gridX === x &&
          other.gridY === y &&
          other.heightFeet < height + bodyHeight - 1e-7 &&
          other.heightFeet + 5 > height + 1e-7
      ),
  });
  const route = getSurfaceRoute(range, target.gridX, target.gridY);
  if (!route?.length)
    throw gameplayError('That destination is blocked or beyond your movement', 'unreachable');
  let height = actor.world.y / unit;
  let last = route.at(-1);
  let distanceFeet = 0;
  for (const step of route) {
    if (height - step.heightFeet > MAX_STEP_HEIGHT_FEET + 1e-6) {
      last = step;
      distanceFeet = height - step.heightFeet;
      break;
    }
    height = step.heightFeet;
  }
  const next = copy(scene);
  const moved = next.creatures.find((entry) => entry.id === actor.id);
  const destination = {
    x: (last.xFeet ?? (last.gridX + 0.5) * 5) * unit,
    y: last.heightFeet * unit,
    z: (last.zFeet ?? (last.gridY + 0.5) * 5) * unit,
  };
  const ticket = runtime.combat.beginConnectionMovement(actor, last.cost);
  runtime.combat.finishMovement(ticket, last.cost);
  moved.gridX = last.gridX;
  moved.gridY = last.gridY;
  moved.facingAngle = facingAngleFromDirection(
    destination.x - actor.world.x,
    destination.z - actor.world.z
  );
  moved.pose = {
    kind: 'ground',
    world: destination,
    ...(last.surfaceId !== 'terrain' ? { surfaceId: last.surfaceId } : {}),
  };
  const fall =
    distanceFeet > 0
      ? await applyPlayerFall(runtime, library, actor, { id, distanceFeet, useSlowFall }, dice)
      : null;
  runtime.combat.completeFreeMovement(actor);
  next.combat = runtime.combat.snapshot();
  encodeScene(next, { ruleset: library.ruleset, library });
  return {
    scene: next,
    receipt: {
      type: 'move',
      tokenId,
      costFeet: last.cost,
      route: route.slice(0, route.indexOf(last) + 1).map((step) => ({
        mapId: actor.mapId,
        gridX: step.gridX,
        gridY: step.gridY,
        facingAngle: moved.facingAngle,
        pose: {
          kind: 'ground',
          world: {
            x: (step.xFeet ?? (step.gridX + 0.5) * 5) * unit,
            y: step.heightFeet * unit,
            z: (step.zFeet ?? (step.gridY + 0.5) * 5) * unit,
          },
          ...(step.surfaceId !== 'terrain' ? { surfaceId: step.surfaceId } : {}),
        },
      })),
      ...(fall ? { fall } : {}),
      placement: {
        mapId: actor.mapId,
        gridX: moved.gridX,
        gridY: moved.gridY,
        facingAngle: moved.facingAngle,
        pose: moved.pose,
      },
    },
  };
}

function moveFlyingActor(scene, library, runtime, actor, target) {
  const character = runtime.combat.movementCharacter(actor, library.get(actor.characterSheetId));
  const permission = library.rules.flightAvailability(character);
  const status = runtime.combat.status(actor, 'fly');
  if (!permission.allowed) throw gameplayError(permission.reason, 'flight-unavailable');
  if ((status.active && !status.isTurn) || status.busy || status.downed)
    throw gameplayError('Movement requires your active, available turn', 'not-your-turn');
  const map = runtime.world.getMap(actor.mapId);
  const tile = map.grid.tileWorldSize;
  const obstacles = runtime.world.getObstacles({ mapId: actor.mapId });
  const occupied = runtime.actors
    .filter((entry) => entry !== actor && runtime.world.sharesLocation(entry.mapId, actor.mapId))
    .map((entry) => {
      const at = runtime.world.getCampaignPosition(entry.id);
      return {
        min: { x: at.x - 2, y: at.y + 1e-6, z: at.z - 2 },
        max: { x: at.x + 2, y: at.y + 5 - 1e-6, z: at.z + 2 },
      };
    });
  const blocked = new Set(
    map.terrain.placeables
      .filter((entry) => ['plant', 'structure'].includes(entry.type))
      .map((entry) => `${entry.gridX},${entry.gridY}`)
  );
  for (let y = 0; y < map.grid.rows; y++)
    for (let x = 0; x < map.grid.cols; x++) {
      const body = runtime.world.toCampaignBounds(actor.mapId, {
        min: { x: x * tile + 1e-6, y: actor.world.y + 1e-6, z: y * tile + 1e-6 },
        max: { x: (x + 1) * tile - 1e-6, y: actor.world.y + tile - 1e-6, z: (y + 1) * tile - 1e-6 },
      });
      if ([...obstacles, ...occupied].some((entry) => boundsIntersectSolid(body, entry, 1e-6)))
        blocked.add(`${x},${y}`);
    }
  const range = buildMovementRange({
    cols: map.grid.cols,
    rows: map.grid.rows,
    startGridX: actor.gridX,
    startGridY: actor.gridY,
    speed: playerMovementBudget(runtime.combat, actor, 'fly').remaining,
    tileWorldSize: tile,
    elevationUnit: 0,
    getHeight: () => 0,
    blocked,
  });
  const route = getMovementRoute(range, target.gridX, target.gridY);
  if (!route?.length)
    throw gameplayError('That destination is blocked or beyond your movement', 'unreachable');
  const last = route.at(-1);
  const position = { x: (last.gridX + 0.5) * tile, y: actor.world.y, z: (last.gridY + 0.5) * tile };
  const ticket = runtime.combat.beginConnectionMovement(actor, last.cost, 'fly');
  const next = copy(scene);
  const moved = next.creatures.find((entry) => entry.id === actor.id);
  moved.gridX = last.gridX;
  moved.gridY = last.gridY;
  moved.facingAngle = facingAngleFromDirection(
    position.x - actor.world.x,
    position.z - actor.world.z
  );
  moved.pose = { kind: 'flight', world: position };
  const routeFeet = [
    runtime.world.toCampaignPosition(actor.mapId, actor.world),
    ...route.map((step) =>
      runtime.world.toCampaignPosition(actor.mapId, {
        x: (step.gridX + 0.5) * tile,
        y: actor.world.y,
        z: (step.gridY + 0.5) * tile,
      })
    ),
  ];
  actor.world = { ...position };
  actor.gridX = moved.gridX;
  actor.gridY = moved.gridY;
  actor.facingAngle = moved.facingAngle;
  runtime.combat.finishMovement(ticket, last.cost);
  runtime.combat.completeFreeMovement(actor);
  next.combat = runtime.combat.snapshot();
  encodeScene(next, { ruleset: library.ruleset, library });
  return {
    scene: next,
    receipt: {
      type: 'move',
      tokenId: actor.id,
      costFeet: last.cost,
      routeFeet,
      placement: {
        mapId: actor.mapId,
        gridX: moved.gridX,
        gridY: moved.gridY,
        facingAngle: moved.facingAngle,
        pose: moved.pose,
      },
    },
  };
}

async function applyPlayerFall(
  runtime,
  library,
  actor,
  { id, distanceFeet, useSlowFall, ignoreFlight = false },
  dice
) {
  const character = runtime.combat.movementCharacter(actor, library.get(actor.characterSheetId));
  const protection = library.rules.fallProtection(character, { ignoreFlight });
  const count = protection.avoidDamage ? 0 : fallingDice(distanceFeet);
  const availability = runtime.combat.slowFallAvailability(actor);
  if (useSlowFall === undefined && count > 0 && availability.allowed)
    throw gameplayError(
      'Choose whether to use your Slow Fall reaction before falling',
      'confirmation-required'
    );
  if (useSlowFall && !availability.allowed)
    throw gameplayError('Slow Fall requires an available Monk reaction', 'reaction-unavailable');
  const slowReduction = useSlowFall ? await runtime.combat.useSlowFall(actor, id) : 0;
  const expression = count ? `${count}d6` : '0';
  const roll = await dice.roll({
    expression,
    label: `${character.name}: falling damage`,
    mode: 'normal',
  });
  const outcome = library.rules.resolveFall({
    distanceFeet,
    rawDamage: roll.total,
    reduction: protection.reduction + slowReduction,
    avoidDamage: protection.avoidDamage,
    proneImmune: protection.proneImmune,
  });
  await runtime.combat.applyFall(actor, {
    id,
    characterId: character.id,
    ...outcome,
    avoidDamage: protection.avoidDamage,
    proneImmune: protection.proneImmune,
    featherFall: protection.featherFall,
    reason: protection.reason,
    slowFall: useSlowFall === true,
    wasProne: character.conditions.includes('prone'),
    roll: { ...roll, expression },
  });
  await library.flush();
  return outcome;
}

export function playerCommandReceipt(result, previousScene, library) {
  const { type, routeFeet, ...receipt } = copy(result.receipt);
  receipt.kind = type;
  const runtime = gameplayRuntime(result.scene, library);
  const actor = runtime.actors.find((entry) => entry.id === receipt.tokenId);
  if (actor) {
    const status = runtime.combat.status(actor);
    const movement = playerMovementBudget(runtime.combat, actor);
    receipt.budget = {
      movementSpentFeet: movement.spent,
      movementRemainingFeet: movement.remaining,
      movementAllowanceFeet: movement.total,
      actions: status.actions,
      bonusActions: status.bonusActions,
      reactions: status.reactions,
      attacksRemaining: status.attacksRemaining,
    };
  }
  const previous = previousScene.creatures.find((entry) => entry.id === receipt.tokenId);
  if (previous && receipt.placement) {
    const from = {
      mapId: previousScene.version === 3 ? previous.mapId : 'map-main',
      gridX: previous.gridX,
      gridY: previous.gridY,
      facingAngle: previous.facingAngle,
      pose: copy(previous.pose),
    };
    if (!receipt.route) {
      receipt.route = routeFeet?.length
        ? routeFeet.slice(1).map((position, index, points) => {
            if (index === points.length - 1) return copy(receipt.placement);
            const source = runtime.world.getMap(from.mapId);
            const target = runtime.world.getMap(receipt.placement.mapId);
            const local = runtime.world.toMapPosition(source.id, position);
            const inside =
              local.x >= 0 &&
              local.z >= 0 &&
              local.x < source.grid.cols * source.grid.tileWorldSize &&
              local.z < source.grid.rows * source.grid.tileWorldSize;
            const map = inside ? source : target;
            const world = runtime.world.toMapPosition(map.id, position);
            return {
              mapId: map.id,
              gridX: Math.floor(world.x / map.grid.tileWorldSize),
              gridY: Math.floor(world.z / map.grid.tileWorldSize),
              facingAngle:
                from.facingAngle + ((map.quarterTurns - source.quarterTurns) * Math.PI) / 2,
              pose: { kind: receipt.placement.pose.kind === 'flight' ? 'flight' : 'ground', world },
            };
          })
        : [copy(receipt.placement)];
    }
    receipt.motion = {
      kind:
        receipt.fall || type === 'flight.drop'
          ? 'fall'
          : type === 'traverse'
            ? 'traverse'
            : previous.pose.kind === 'flight' || receipt.placement.pose.kind === 'flight'
              ? 'fly'
              : 'walk',
      completed: true,
      from,
      route: receipt.route,
    };
    if (type === 'flight.drop') receipt.costFeet = 0;
  }
  return receipt;
}

export async function executePlayerCommand(
  scene,
  library,
  command,
  { dice, ownedIds = [], placementGrant } = {}
) {
  if (command.kind === 'place')
    return placePlayerCharacter(scene, library, command.payload, placementGrant);
  if (command.kind === 'move')
    return movePlayerActor(scene, library, command.tokenId, command.payload.target, {
      dice,
      id: command.commandId,
      useSlowFall: command.payload.useSlowFall,
    });
  const runtime = gameplayRuntime(scene, library);
  const actor = runtime.actors.find((entry) => entry.id === command.tokenId);
  if (command.kind === 'action.undo') {
    const status = runtime.combat.status(actor);
    if (!status.canUndo || (status.active && !status.isTurn))
      throw gameplayError('No matching use can be undone on this turn', 'undo-unavailable');
    await runtime.combat.undoLastUse(actor);
    await library.flush();
    const next = copy(scene);
    next.combat = runtime.combat.snapshot();
    encodeScene(next, { ruleset: library.ruleset, library });
    return { scene: next, receipt: { type: 'action.undo', tokenId: actor.id } };
  }
  if (command.kind === 'emote') {
    const action = getTokenCommand(command.payload.actionId);
    const saved = scene.creatures.find((entry) => entry.id === actor.id);
    const character = library.get(actor.characterSheetId);
    if (
      !action ||
      !['emotes', 'actions'].includes(action.group) ||
      saved.pose.kind !== 'ground' ||
      library.rules.movementImpaired(character) ||
      character.conditions.includes('prone')
    )
      throw gameplayError(
        'Choose an available visual action for a grounded, standing creature',
        'emote-unavailable'
      );
    const animationKey =
      action.animation?.key || action.choices?.find((key) => key === command.payload.animationKey);
    if (!animationKey || (action.animation && command.payload.animationKey !== undefined))
      throw gameplayError('Choose a canonical visual animation', 'invalid-emote');
    return {
      scene,
      receipt: {
        type: 'emote',
        tokenId: actor.id,
        actionId: action.id,
        animationKey,
      },
    };
  }
  if (command.kind === 'movement.settings') {
    setTokenMovementSettings(actor, command.payload);
    const next = copy(scene);
    const moved = next.creatures.find((entry) => entry.id === actor.id);
    moved.movement = { ...actor.movementSettings };
    encodeScene(next, { ruleset: library.ruleset, library });
    return {
      scene: next,
      receipt: { type: 'movement.settings', tokenId: actor.id, movement: moved.movement },
    };
  }
  if (command.kind === 'facing') {
    const next = copy(scene);
    const moved = next.creatures.find((entry) => entry.id === actor.id);
    moved.facingAngle = command.payload.angle;
    encodeScene(next, { ruleset: library.ruleset, library });
    return {
      scene: next,
      receipt: { type: 'facing', tokenId: actor.id, facingAngle: moved.facingAngle },
    };
  }
  if (command.kind === 'traverse') {
    const status = runtime.combat.status(actor);
    if ((status.active && !status.isTurn) || status.busy || status.downed)
      throw gameplayError('Movement requires your active, available turn', 'not-your-turn');
    if (
      !runtime.world
        .getConnections(actor.mapId)
        .some((entry) => entry.id === command.payload.connectionId)
    )
      throw gameplayError('This connection is not available here', 'unreachable');
    let plan;
    try {
      plan = runtime.world.planConnection(command.payload.connectionId, actor.mapId, actor.world, {
        travelMode: actor.flightActive ? 'fly' : 'ground',
        action: command.payload.action,
        occupants: runtime.actors.filter((entry) => entry !== actor),
      });
    } catch (error) {
      if (!(error instanceof ConnectionUnavailableError)) throw error;
      throw gameplayError(error.message, 'unreachable');
    }
    if (plan.fall)
      throw gameplayError(
        'Release requires an authoritative physical landing',
        'unsupported-traversal'
      );
    const target = runtime.world.getMap(plan.targetMapId);
    const ticket = runtime.combat.beginConnectionMovement(actor, plan.costFeet, plan.travelMode);
    runtime.combat.finishMovement(ticket, plan.costFeet);
    const next = copy(scene);
    const moved = next.creatures.find((entry) => entry.id === actor.id);
    moved.mapId = plan.targetMapId;
    moved.gridX = Math.floor(plan.targetWorld.x / target.grid.tileWorldSize);
    moved.gridY = Math.floor(plan.targetWorld.z / target.grid.tileWorldSize);
    moved.facingAngle = plan.targetFacingAngle ?? moved.facingAngle + plan.facingDelta;
    moved.pose = { ...(plan.targetPose || { kind: 'ground' }), world: { ...plan.targetWorld } };
    actor.mapId = moved.mapId;
    actor.world = { ...moved.pose.world };
    actor.flightActive = moved.pose.kind === 'flight';
    runtime.combat.completeFreeMovement(actor);
    next.combat = runtime.combat.snapshot();
    encodeScene(next, { ruleset: library.ruleset, library });
    return {
      scene: next,
      receipt: {
        type: 'traverse',
        tokenId: actor.id,
        costFeet: plan.costFeet,
        routeFeet: plan.routeFeet,
        placement: {
          mapId: moved.mapId,
          gridX: moved.gridX,
          gridY: moved.gridY,
          facingAngle: moved.facingAngle,
          pose: moved.pose,
        },
      },
    };
  }
  if (command.kind === 'flight.drop') {
    const saved = scene.creatures.find((entry) => entry.id === actor.id);
    if (saved.pose.kind !== 'flight')
      throw gameplayError('Only an airborne creature can drop', 'flight-unavailable');
    const from = runtime.world.getCampaignPosition(actor.id);
    const landing = runtime.world.findSupportBelow(from, { mapId: actor.mapId });
    if (!landing) throw gameplayError('There is no supported landing below', 'landing-unavailable');
    const distanceFeet = Math.max(0, from.y - landing.positionFeet.y);
    const outcome = await applyPlayerFall(
      runtime,
      library,
      actor,
      {
        id: command.commandId,
        distanceFeet,
        useSlowFall: command.payload.useSlowFall,
        ignoreFlight: true,
      },
      dice
    );
    const transfer = campaignLandingForSupport(runtime.world, actor, landing);
    const targetMap = runtime.world.getMap(landing.mapId);
    actor.mapId = landing.mapId;
    actor.world = { ...landing.world };
    actor.gridX = Math.floor(actor.world.x / targetMap.grid.tileWorldSize);
    actor.gridY = Math.floor(actor.world.z / targetMap.grid.tileWorldSize);
    if (transfer) actor.facingAngle = transfer.placement.facingAngle;
    actor.flightActive = false;
    const next = copy(scene);
    const moved = next.creatures.find((entry) => entry.id === actor.id);
    if (next.version === 3) moved.mapId = actor.mapId;
    moved.gridX = actor.gridX;
    moved.gridY = actor.gridY;
    moved.facingAngle = actor.facingAngle;
    moved.pose = {
      kind: 'ground',
      world: { ...actor.world },
      ...(landing.surfaceId ? { surfaceId: landing.surfaceId } : {}),
    };
    next.combat = runtime.combat.snapshot();
    encodeScene(next, { ruleset: library.ruleset, library });
    return {
      scene: next,
      receipt: {
        type: 'flight.drop',
        tokenId: actor.id,
        distanceFeet,
        result: outcome,
        placement: {
          mapId: actor.mapId,
          gridX: actor.gridX,
          gridY: actor.gridY,
          facingAngle: actor.facingAngle,
          pose: moved.pose,
        },
      },
    };
  }
  if (['flight.takeoff', 'flight.raise', 'flight.lower'].includes(command.kind)) {
    const takeoff = command.kind === 'flight.takeoff';
    const lower = command.kind === 'flight.lower';
    const saved = scene.creatures.find((entry) => entry.id === actor.id);
    const character = runtime.combat.movementCharacter(actor, library.get(actor.characterSheetId));
    const available = library.rules.flightAvailability(character);
    if (!available.allowed || saved.pose.kind !== (takeoff ? 'ground' : 'flight'))
      throw gameplayError(
        available.reason ||
          (takeoff ? 'Take off from a supported floor' : 'Change elevation while airborne'),
        'flight-unavailable'
      );
    const map = runtime.world.getMap(actor.mapId);
    const unit = map.grid.tileWorldSize / 5;
    const costFeet = takeoff ? FLIGHT_TAKEOFF_FEET : command.payload.feet;
    const position = { ...actor.world, y: actor.world.y + (lower ? -costFeet : costFeet) * unit };
    const support = lower
      ? runtime.world.findSupportBelow(runtime.world.toCampaignPosition(actor.mapId, actor.world), {
          mapId: actor.mapId,
        })
      : null;
    const targetFeet = runtime.world.toCampaignPosition(actor.mapId, position);
    if (support && targetFeet.y < support.positionFeet.y - 1e-6)
      throw gameplayError('That descent would go below the supported floor', 'flight-blocked');
    const landed = support && Math.abs(targetFeet.y - support.positionFeet.y) <= 1e-6;
    const body = runtime.world.toCampaignBounds(actor.mapId, {
      min: {
        x: actor.world.x - 0.5 * unit,
        y: Math.min(actor.world.y, position.y) + 1e-6,
        z: actor.world.z - 0.5 * unit,
      },
      max: {
        x: actor.world.x + 0.5 * unit,
        y: Math.max(actor.world.y, position.y) + 5 * unit,
        z: actor.world.z + 0.5 * unit,
      },
    });
    if (
      runtime.world
        .getObstacles({ mapId: actor.mapId })
        .some((obstacle) => boundsIntersectSolid(body, obstacle, 1e-6))
    )
      throw gameplayError('There is no clear space for takeoff', 'flight-blocked');
    const ticket = runtime.combat.beginConnectionMovement(actor, costFeet, 'fly');
    runtime.combat.finishMovement(ticket, costFeet);
    runtime.combat.completeFreeMovement(actor);
    actor.world = position;
    actor.flightActive = !landed;
    const next = copy(scene);
    const moved = next.creatures.find((entry) => entry.id === actor.id);
    if (landed) {
      const targetMap = runtime.world.getMap(support.mapId);
      const sourceMap = runtime.world.getMap(actor.mapId);
      if (next.version === 3) moved.mapId = support.mapId;
      moved.gridX = Math.floor(support.world.x / targetMap.grid.tileWorldSize);
      moved.gridY = Math.floor(support.world.z / targetMap.grid.tileWorldSize);
      moved.facingAngle += ((targetMap.quarterTurns - sourceMap.quarterTurns) * Math.PI) / 2;
      moved.pose = {
        kind: 'ground',
        world: support.world,
        ...(support.surfaceId !== 'terrain' ? { surfaceId: support.surfaceId } : {}),
      };
      actor.mapId = support.mapId;
      actor.world = { ...support.world };
    } else moved.pose = { kind: 'flight', world: position };
    next.combat = runtime.combat.snapshot();
    encodeScene(next, { ruleset: library.ruleset, library });
    return {
      scene: next,
      receipt: {
        type: command.kind,
        tokenId: actor.id,
        costFeet,
        placement: {
          mapId: actor.mapId,
          gridX: moved.gridX,
          gridY: moved.gridY,
          facingAngle: moved.facingAngle,
          pose: moved.pose,
        },
      },
    };
  }
  if (command.kind === 'remove') {
    const character = library.get(actor.characterSheetId);
    const saved = scene.creatures.find((entry) => entry.id === actor.id);
    if (
      runtime.combat.active ||
      character.concentration ||
      saved.pose.kind !== 'ground' ||
      runtime.combat.effects.some(
        (effect) => effect.characterId === character.id || effect.targetTokenIds?.includes(actor.id)
      )
    )
      throw gameplayError(
        'Remove a grounded character outside combat after resolving active effects',
        'removal-unavailable'
      );
    runtime.combat.forget(actor);
    const next = copy(scene);
    next.creatures = next.creatures.filter((entry) => entry.id !== actor.id);
    next.combat = runtime.combat.snapshot();
    if (next.version === 3 && next.view.focusTokenId === actor.id) next.view.focusTokenId = null;
    if (next.version !== 3 && next.selection === actor.id) next.selection = null;
    encodeScene(next, { ruleset: library.ruleset, library });
    return { scene: next, receipt: { type: 'remove', tokenId: actor.id } };
  }
  if (command.kind === 'action.use') {
    const targeting = new ServerTargeting({ runtime, scene, library, actor, ownedIds });
    runtime.combat.targeting = targeting;
    const ticket = runtime.combat.prepareAction(
      actor,
      command.payload.actionId,
      command.payload.choice || {}
    );
    const selection = ticket.action.targeting
      ? targeting.validate(actor, ticket.action, command.payload.targeting)
      : null;
    let roll = null;
    const targetRolls = [];
    const rolls = [];
    if (ticket.action.roll) {
      const request = ticket.action.roll;
      const allocations =
        request.attack && selection?.targets.length && !selection.manual
          ? selection.targets.flatMap((target) =>
              Array.from({ length: target.count }, () => target)
            )
          : [null];
      for (const target of allocations) {
        const advantage =
          request.check && (request.advantage === true || target?.advantage?.length > 0);
        const disadvantage =
          request.check &&
          (request.disadvantage === true ||
            target?.disadvantage?.length > 0 ||
            (request.attack && getTokenConditions(actor).includes('prone')));
        const mode =
          !!advantage === !!disadvantage ? 'normal' : advantage ? 'advantage' : 'disadvantage';
        roll = await dice.roll({ ...request, mode }, targeting.rollContext());
        roll.mapId = actor.mapId;
        rolls.push(roll);
        if (roll.rerollRequired) {
          runtime.combat.cancelAction(ticket);
          return {
            scene,
            receipt: {
              type: 'action.use',
              tokenId: actor.id,
              actionId: ticket.action.id,
              rerollRequired: true,
              roll,
              rolls,
            },
          };
        }
        if (target)
          targetRolls.push({
            tokenId: target.tokenId,
            label: `${ticket.action.label} vs ${target.name}`,
            expression: roll.expression,
            text: roll.text,
            summary: roll.summary,
          });
      }
    }
    const result = await runtime.combat.commitAction(
      ticket,
      (targetRolls.length
        ? targetRolls.map((entry) => entry.text).join('\n')
        : roll?.text || ''
      ).slice(0, 10000),
      targetRolls.length > 1 ? null : roll?.summary || null,
      selection,
      targetRolls
    );
    await library.flush();
    const next = copy(scene);
    next.combat = runtime.combat.snapshot();
    encodeScene(next, { ruleset: library.ruleset, library });
    return {
      scene: next,
      receipt: {
        type: 'action.use',
        tokenId: actor.id,
        actionId: result.id,
        cost: result.cost,
        sequence: result.sequence,
        ...(roll ? { roll, rolls } : {}),
      },
    };
  }
  if (command.kind === 'roll') {
    const map = runtime.world.getMap(actor.mapId);
    const creatures = scene.creatures.map((entry) => ({
      ...entry,
      mapId: scene.version === 3 ? entry.mapId : 'map-main',
    }));
    const visibility = playerCreatureVisibility({
      world: runtime.world,
      creatures,
      ownedIds: [actor.characterSheetId],
      publishedIds: runtime.world.listMaps().map((entry) => entry.id),
      observerTokenId: actor.id,
    });
    const projected = visibility.visible.map((entry) => {
      const point = runtime.world.projectCreature(entry.id, actor.mapId).world;
      return {
        gridX: Math.floor(point.x / map.grid.tileWorldSize),
        gridY: Math.floor(point.z / map.grid.tileWorldSize),
      };
    });
    const scope = runtime.combat.captureRoll(actor);
    const roll = await dice.roll(command.payload, {
      metrics: { cols: map.grid.cols, rows: map.grid.rows, tileSize: map.grid.tileWorldSize },
      groundHeights: map.terrain.heights.map((row) =>
        row.map((height) => height * map.terrain.worldElevationUnit)
      ),
      obstacles: collectCollisionObstacles(
        {
          gameManager: {
            placedTokens: projected,
            spatial: {
              tileWorldSize: map.grid.tileWorldSize,
              gridToWorld: (x, z) => ({
                x: x * map.grid.tileWorldSize,
                z: z * map.grid.tileWorldSize,
              }),
            },
          },
        },
        { tileSize: map.grid.tileWorldSize }
      ),
    });
    roll.mapId = actor.mapId;
    await runtime.combat.recordRoll(scope, {
      label: roll.label,
      expression: roll.expression,
      rollText: roll.text,
      ...(roll.summary ? { rollResult: roll.summary } : {}),
    });
    await library.flush();
    const next = copy(scene);
    next.combat = runtime.combat.snapshot();
    encodeScene(next, { ruleset: library.ruleset, library });
    return { scene: next, receipt: { type: 'roll', tokenId: actor.id, roll } };
  }
  if (command.kind === 'stand') {
    await runtime.combat.standUp(actor);
    await library.flush();
    const next = copy(scene);
    next.combat = runtime.combat.snapshot();
    encodeScene(next, { ruleset: library.ruleset, library });
    return { scene: next, receipt: { type: 'stand', tokenId: actor.id } };
  }
  if (command.kind !== 'turn.end')
    throw gameplayError('This player command is not supported', 'unsupported-command', 400);
  if (runtime.combat.activeToken !== actor)
    throw gameplayError('Only your own active turn can be ended', 'not-your-turn');
  await runtime.combat.endTurn();
  await library.flush();
  const next = copy(scene);
  next.combat = runtime.combat.snapshot();
  encodeScene(next, { ruleset: library.ruleset, library });
  return { scene: next, receipt: { type: 'turn.end', tokenId: actor.id } };
}

function placePlayerCharacter(scene, library, payload, grant) {
  if (!grant || grant.characterId !== payload.characterId)
    throw gameplayError('This placement destination is not authorized', 'placement-forbidden', 403);
  if (scene.combat.active) throw gameplayError('Place characters outside combat', 'combat-active');
  if (scene.creatures.some((actor) => actor.characterId === payload.characterId))
    throw gameplayError('This character already has a placed actor', 'already-placed', 409);
  const definition = getCharacterDefinition(payload.appearance);
  if (!definition)
    throw gameplayError('Choose an explicit supported character model', 'invalid-model');
  const character = library.get(payload.characterId);
  const runtime = gameplayRuntime(scene, library);
  const map = runtime.world.getMap(grant.mapId);
  const unit = map.grid.tileWorldSize / 5;
  const x = (grant.gridX + 0.5) * 5,
    z = (grant.gridY + 0.5) * 5;
  const below =
    (map.terrain.heights[grant.gridY]?.[grant.gridX] * map.terrain.worldElevationUnit) / unit;
  const support = runtime.world.getMapGeometry(grant.mapId).findSupport(x, z, {
    belowFeet: below + 1e-5,
    clearanceFeet: 5,
    surfaceId: grant.surfaceId,
  });
  if (!support)
    throw gameplayError('The granted cell has no supported clear floor', 'invalid-placement');
  const position = { x: x * unit, y: support.heightFeet * unit, z: z * unit };
  for (const actor of runtime.actors) {
    if (!runtime.world.sharesLocation(actor.mapId, grant.mapId)) continue;
    const other = runtime.world.toMapPosition(
      grant.mapId,
      runtime.world.getCampaignPosition(actor.id)
    );
    if (
      Math.floor(other.x / map.grid.tileWorldSize) === grant.gridX &&
      Math.floor(other.z / map.grid.tileWorldSize) === grant.gridY &&
      Math.abs(other.y - position.y) < map.grid.tileWorldSize
    )
      throw gameplayError('The granted cell is occupied', 'occupied-placement');
  }
  const next = copy(scene);
  const counts = new Map(next.tokenCounters.types);
  const instanceNumber = (counts.get(definition.id) || 0) + 1;
  counts.set(definition.id, instanceNumber);
  const actor = {
    id: `token-${next.tokenCounters.nextId + 1}`,
    instanceNumber,
    type: definition.id,
    name: character.name,
    nameMode: 'character',
    characterId: character.id,
    ...(scene.version === 3 ? { mapId: grant.mapId } : {}),
    gridX: grant.gridX,
    gridY: grant.gridY,
    facingAngle: 0,
    movement: { mode: 'walk', type: 'default' },
    allegiance: 'neutral',
    creatureType: 'humanoid',
    creatureSize: 'medium',
    pose: {
      kind: 'ground',
      world: position,
      ...(support.id !== 'terrain' ? { surfaceId: support.id } : {}),
    },
  };
  next.creatures.push(actor);
  next.tokenCounters = { nextId: next.tokenCounters.nextId + 1, types: [...counts] };
  encodeScene(next, { ruleset: library.ruleset, library });
  return {
    scene: next,
    receipt: {
      type: 'place',
      tokenId: actor.id,
      characterId: character.id,
      placement: {
        mapId: grant.mapId,
        gridX: actor.gridX,
        gridY: actor.gridY,
        facingAngle: actor.facingAngle,
        pose: actor.pose,
      },
    },
  };
}
