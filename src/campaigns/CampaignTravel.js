import {
  ConnectionUnavailableError,
  connectionEntryDistance,
  connectionFlightEntry,
  connectionGroundEntry,
} from './CampaignConnections.js';
import {
  getTokenConditions,
  getTokenFallTraits,
  getTokenMovementSettings,
  getTokenTravelMode,
} from '../entities/creatures/TokenMovement.js';

function denied(message, code = 'unavailable', details = {}) {
  const error = new ConnectionUnavailableError(message);
  Object.assign(error, details);
  error.code = code;
  throw error;
}

function assertConnectionActor(gm, token, stationary = true, openingId = null) {
  if (!gm.campaignWorld || !gm.placedTokens.includes(token))
    throw new Error('Connection travel requires a placed campaign creature');
  if (gm.campaignMapFailure) throw gm.campaignMapFailure;
  const session = gm.characterServices.combat;
  if (
    gm.sceneAutosave?.ready === false ||
    gm.campaignViewBusy ||
    gm.characterServices.library.isSaving ||
    session.pending ||
    session.committing ||
    gm.terrainEngine.hasPendingStroke ||
    (stationary &&
      (session.moves.size ||
        gm.placedTokens.some((actor) => gm.token3DAdapter.isMovementInProgress(actor))))
  )
    denied('Finish the current movement, action or map change before travelling');
  if (token.mapId !== gm.campaignMapId)
    denied('Focus this creature on its own map before travelling');
  if (
    gm.token3DAdapter.isWallAttached?.(token) &&
    token.openingHold?.openingId !== openingId &&
    !token.surfaceHold
  )
    denied('Finish the wall or ledge hold before travelling');
  if (session.active && session.activeToken !== token)
    denied('Only the creature taking its turn can travel during combat');
  if (
    token.characterSheetId &&
    gm.characterServices.library.rules.movementImpaired(
      gm.characterServices.library.get(token.characterSheetId)
    )
  )
    denied('This creature cannot move');
  if (token.flightActive) {
    const base = token.characterSheetId
      ? gm.characterServices.library.get(token.characterSheetId)
      : {
          speed: getTokenMovementSettings(token).speed,
          hp: token.hp || { current: 1 },
          conditions: getTokenConditions(token),
          fallTraits: getTokenFallTraits(token),
        };
    const permission = gm.characterServices.library.rules.flightAvailability(
      session.movementCharacter(token, base)
    );
    if (!permission.allowed) denied(permission.reason);
  }
  return session;
}

export function prepareConnectionTravel(gm, token, id, { action = 'cross' } = {}) {
  const session = assertConnectionActor(gm, token, true, id);
  const travelMode = getTokenTravelMode(token);
  let allowance =
    travelMode === 'fly'
      ? getTokenFallTraits(token).flySpeed
      : getTokenMovementSettings(token).speed;
  if (token.characterSheetId) {
    allowance = session.active
      ? session.movementAllowance(token, travelMode)
      : session.freeMovementAllowance(token, travelMode);
  }
  const plan = gm.campaignWorld.planConnection(id, token.mapId, token.world, {
    mapId: gm.campaignMapId,
    geometry: gm.terrainEngine.geometry,
    coverBounds: gm.placeableMeshPool?.targetingCoverBounds() ?? null,
    occupants: gm.placedTokens.filter((actor) => actor !== token),
    travelMode,
    action,
    openingHold: token.openingHold?.openingId,
    surfaceGrip: token.surfaceHold,
    allowanceFeet: allowance,
  });
  if (
    plan.kind === 'window' &&
    travelMode === 'ground' &&
    action !== 'drop' &&
    getTokenConditions(token).includes('prone')
  )
    denied('Stand up before climbing through an opening.');
  const costFeet =
    plan.costFeet *
    (travelMode === 'ground' && getTokenConditions(token).includes('prone') ? 2 : 1);
  if (costFeet > allowance + 1e-6)
    denied(
      `This route needs ${costFeet} ft; only ${allowance} ft remains`,
      'insufficient-movement',
      { costFeet, allowanceFeet: allowance }
    );
  return { ...plan, costFeet, travelMode, free: !session.active };
}

function actionLabel(connection, token, mapId, action) {
  if (action === 'down') return 'Climb down';
  if (action === 'drop') return 'Let go';
  if (token?.flightActive) return 'Fly through';
  if (connection.kind === 'window')
    return mapId === connection.outsideMapId ? 'Climb in' : 'Climb out';
  return connection.kind === 'stairs'
    ? 'Use stairs'
    : connection.kind === 'ladder'
      ? 'Use ladder'
      : connection.kind === 'opening'
        ? 'Go through'
        : 'Enter';
}

export function getConnectionTravelOption(gm, token, id, { action = 'cross' } = {}) {
  const connection = gm.campaignWorld.getConnections().find((entry) => entry.id === id);
  if (!connection) throw new Error('The map connection no longer exists');
  const source = connection.ends.find((end) => end.mapId === gm.campaignMapId);
  if (!source) throw new Error('The connection is not on the viewed map');
  const destination = connection.ends.find((end) => end !== source);
  const option = {
    name: connection.name,
    kind: connection.kind,
    targetName: gm.campaignWorld.getMap(destination.mapId).name,
    actionLabel: actionLabel(connection, token, source.mapId, action),
  };
  if (!token)
    return { ...option, allowed: false, reason: 'Select a creature before using this entrance.' };
  try {
    assertConnectionActor(gm, token, false, id);
    if (connection.enabled === false) denied('This connection is unavailable');
    const approachPoint = token.flightActive
      ? connectionFlightEntry(gm.campaignWorld, connection, source.mapId, token.world, {
          mapId: gm.campaignMapId,
          geometry: gm.terrainEngine.geometry,
        })
      : connectionGroundEntry(gm.campaignWorld, connection, source.mapId, token.world, {
          mapId: gm.campaignMapId,
          geometry: gm.terrainEngine.geometry,
        });
    if (
      !token.openingHold &&
      !token.surfaceHold &&
      (connectionEntryDistance(gm.campaignWorld, connection, source.mapId, token.world, {
        travelMode: getTokenTravelMode(token),
        mapId: gm.campaignMapId,
        geometry: gm.terrainEngine.geometry,
      }) >
        5 + 1e-6 ||
        (token.flightActive && Math.abs(approachPoint.y - token.world.y) > 1e-6))
    ) {
      return {
        ...option,
        allowed: false,
        reason: 'Approach the entrance first.',
        approach: {
          point: approachPoint,
          normal: { x: 0, y: 1, z: 0 },
        },
      };
    }
    const plan = prepareConnectionTravel(gm, token, connection.id, { action });
    let costFeet = plan.costFeet;
    if (
      plan.kind === 'window' &&
      plan.targetMapId === token.mapId &&
      ['ledge', 'grip'].includes(plan.targetPose?.kind) &&
      action !== 'down'
    ) {
      const climb = gm.token3DAdapter.getClimbTowardOpeningOption(
        token,
        connection.id,
        plan.targetPose
      );
      if (!climb.allowed) denied(climb.reason);
      costFeet = climb.costFeet;
    }
    return {
      ...option,
      costFeet,
      allowed: true,
      actionLabel: plan.actionLabel || option.actionLabel,
      targetName: gm.campaignWorld.getMap(plan.targetMapId).name,
      ...(plan.fall ? { fallDistanceFeet: plan.fall.distanceFeet } : {}),
    };
  } catch (error) {
    if (!(error instanceof ConnectionUnavailableError)) throw error;
    return {
      ...option,
      allowed: false,
      reason: error.message,
      insufficientMovement: error.code === 'insufficient-movement',
      ...(Number.isFinite(error.costFeet) ? { costFeet: error.costFeet } : {}),
    };
  }
}

export function getConnectionTraversalActions(gm, token, id) {
  const actions = ['cross'];
  return actions.map((action) => ({
    ...getConnectionTravelOption(gm, token, id, { action }),
    action,
  }));
}
