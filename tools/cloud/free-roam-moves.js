const stableStringify = require('fast-json-stable-stringify');
const { CloudError } = require('./cloud-error.js');
const { CLOUD_FREE_ROAM_MOVE_LIMIT, isCloudUUID } = require('../../src/campaigns/CloudProtocol.js');
const { validatePlayerMotion } = require('../../src/campaigns/PlayerPublicProtocol.js');
const {
  samePlacement,
  sceneActorPlacement,
} = require('../../src/scene/token-adapter/SavedPlacements.js');

const MAX_BYTES = 192_000;
const invalid = () =>
  new CloudError(503, 'invalid-campaign-head', 'The saved movement checkpoint is invalid');

function isGroundRoute(motion) {
  return (
    motion?.completed === true &&
    motion.continuing !== true &&
    motion.kind === 'walk' &&
    motion.from?.pose.kind === 'ground' &&
    motion.route.every((point) => point.mapId === motion.from.mapId && point.pose.kind === 'ground')
  );
}

function freeRoamMoves(head) {
  if (
    head.version === 1 &&
    head.freeRoamMoves === undefined &&
    head.sceneCheckpointRevision === undefined
  )
    return [];
  const moves = head.freeRoamMoves;
  if (
    head.version !== 2 ||
    head.sceneRef === null ||
    !Array.isArray(moves) ||
    !moves.length ||
    moves.length > CLOUD_FREE_ROAM_MOVE_LIMIT ||
    !Number.isSafeInteger(head.sceneCheckpointRevision) ||
    head.sceneCheckpointRevision < head.campaign.sceneRevision - moves.length ||
    head.sceneCheckpointRevision >= head.campaign.sceneRevision ||
    head.campaign.sceneRevision <= moves.length ||
    Buffer.byteLength(JSON.stringify(moves)) > MAX_BYTES
  )
    throw invalid();
  for (const [index, saved] of moves.entries()) {
    if (
      !saved ||
      !isCloudUUID(saved.sessionId) ||
      !Number.isSafeInteger(saved.generation) ||
      saved.generation < 1 ||
      saved.generation > head.generation ||
      (index && saved.generation <= moves[index - 1].generation) ||
      saved.sceneRevision !== head.campaign.sceneRevision - moves.length + index + 1 ||
      !Number.isSafeInteger(saved.charactersRevision) ||
      saved.charactersRevision < 0 ||
      saved.charactersRevision > head.campaign.charactersRevision ||
      saved.entry?.kind !== 'move' ||
      !isCloudUUID(saved.entry.commandId) ||
      typeof saved.entry.tokenId !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,299}$/.test(saved.entry.tokenId) ||
      (saved.combatState !== undefined &&
        (saved.combatState?.tokenId !== saved.entry.tokenId ||
          saved.combatState.movementSpent !== 0))
    )
      throw invalid();
    try {
      validatePlayerMotion(saved.entry.motion);
    } catch (error) {
      if (['invalid-player-state', 'invalid-saved-placement'].includes(error.code)) throw invalid();
      throw error;
    }
    if (!isGroundRoute(saved.entry.motion)) throw invalid();
  }
  return moves;
}

function applyMove(scene, { entry, combatState }) {
  const actor = scene.creatures.find(({ id }) => id === entry.tokenId);
  if (
    !actor ||
    !samePlacement(sceneActorPlacement(scene, actor), entry.motion.from) ||
    (combatState && combatState.characterId !== actor.characterId)
  )
    throw invalid();
  Object.assign(actor, structuredClone(entry.motion.route.at(-1)));
  if (combatState) {
    const index = scene.combat.states.findIndex(({ tokenId }) => tokenId === actor.id);
    if (index === -1) scene.combat.states.push(structuredClone(combatState));
    else scene.combat.states[index] = structuredClone(combatState);
  }
  scene.combat.effects ??= [];
}

function materializeFreeRoamScene(head, text) {
  const moves = freeRoamMoves(head);
  if (!moves.length) return text;
  const scene = JSON.parse(text);
  if (scene.version !== 3 || !Array.isArray(scene.creatures)) throw invalid();
  for (const move of moves)
    if (move.sceneRevision > head.sceneCheckpointRevision) applyMove(scene, move);
  return JSON.stringify(scene);
}

function rebaseFreeRoamMove(head, command, sessionId) {
  const moves = freeRoamMoves(head);
  const current = head.campaign.sceneRevision;
  if (
    command.kind !== 'move' ||
    command.payload.closest ||
    command.payload.target.elevationFeet !== undefined ||
    command.charactersRevision !== head.campaign.charactersRevision ||
    command.sceneRevision >= current ||
    current - command.sceneRevision > moves.length
  )
    return false;
  return moves
    .slice(command.sceneRevision - current)
    .every(
      (move) =>
        move.sessionId === sessionId &&
        move.charactersRevision === command.charactersRevision &&
        move.generation === head.generation - (current - move.sceneRevision) &&
        move.entry.tokenId !== command.tokenId
    );
}

function freeRoamMovesSince(head, previous, sessionId) {
  const count = head.generation - previous.generation;
  const moves = freeRoamMoves(head);
  if (
    count <= 0 ||
    count > moves.length ||
    head.campaign.sceneRevision - previous.state.sceneRevision !== count ||
    head.campaign.charactersRevision !== previous.state.revision
  )
    return [];
  const recent = moves.slice(-count);
  return recent.every(
    (move, index) =>
      move.generation === previous.generation + index + 1 &&
      move.sessionId === sessionId &&
      move.charactersRevision === previous.state.revision
  )
    ? recent
    : [];
}

function appendFreeRoamMove(head, previous, next, command, packet) {
  if (
    command.kind !== 'move' ||
    command.payload.closest ||
    command.payload.target.elevationFeet !== undefined ||
    packet?.entries.length !== 1 ||
    !isGroundRoute(packet.entries[0].motion) ||
    previous.revision !== next.revision
  )
    return null;
  const scene = JSON.parse(previous.scene);
  if (scene.version !== 3 || scene.combat.active) return null;
  const resolved = JSON.parse(next.scene);
  const entry = packet.entries[0];
  const combatState = resolved.combat.states.find(({ tokenId }) => tokenId === entry.tokenId);
  if (combatState && combatState.movementSpent !== 0) return null;
  const movement = {
    generation: packet.generation,
    sessionId: packet.sessionId,
    sceneRevision: packet.sceneRevision,
    charactersRevision: packet.charactersRevision,
    entry: structuredClone(entry),
    ...(combatState ? { combatState: structuredClone(combatState) } : {}),
  };
  applyMove(scene, movement);
  // Fall back if the resolver changed anything the movement checkpoint cannot reproduce.
  if (stableStringify(scene) !== stableStringify(resolved)) return null;
  const recent = freeRoamMoves(head);
  const fits = (moves) =>
    moves.length <= CLOUD_FREE_ROAM_MOVE_LIMIT &&
    Buffer.byteLength(JSON.stringify(moves)) <= MAX_BYTES;
  const moves = [...recent, movement];
  if (fits(moves))
    return {
      moves,
      checkpointRevision: head.sceneCheckpointRevision ?? previous.sceneRevision,
      checkpointScene: null,
    };
  if (!fits([movement])) return null;
  // Keep the last burst's routes and conflict window even when their positions are folded in.
  const tail = moves.slice(-Math.floor(CLOUD_FREE_ROAM_MOVE_LIMIT / 2));
  while (!fits(tail)) tail.shift();
  return {
    moves: tail,
    checkpointRevision: previous.sceneRevision,
    checkpointScene: previous.scene,
  };
}

module.exports = {
  appendFreeRoamMove,
  freeRoamMoves,
  freeRoamMovesSince,
  materializeFreeRoamScene,
  rebaseFreeRoamMove,
};
