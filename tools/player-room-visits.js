function playerRoomVisits(scene) {
  const visits = new Map();
  if (scene?.version !== 3) return visits;
  const rooms = new Set(scene.maps.filter((map) => map.base === 'floor').map((map) => map.id));
  for (const actor of scene.creatures) {
    if (!actor.characterId || !rooms.has(actor.mapId)) continue;
    if (!visits.has(actor.characterId)) visits.set(actor.characterId, new Set());
    visits.get(actor.characterId).add(actor.mapId);
  }
  return visits;
}

module.exports = { playerRoomVisits };
