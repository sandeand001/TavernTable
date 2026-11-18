async function reconcileRoomVisits({
  store,
  authority,
  session,
  campaignId,
  state = null,
  scene = null,
}) {
  const profile = authority.profile(session);
  if (profile.role === 'player' && profile.campaignId !== campaignId)
    throw new Error('Room discovery belongs to a different player campaign');
  const checkpoint = state || (await store.readCharacters(campaignId, { includeRoomVisits: true }));
  authority.recordRoomVisitEntries(campaignId, checkpoint.roomVisits || []);
  if (scene) authority.recordRoomVisits(campaignId, scene);
  return profile.role === 'player' ? authority.visitedRoomIds(session) : null;
}

async function recoverRoomVisitsAfterCommit(context) {
  try {
    return await reconcileRoomVisits(context);
  } catch (error) {
    console.error(`[TavernTable room discovery] Retained ${context.campaignId} for retry:`, error);
    return null;
  }
}

module.exports = { reconcileRoomVisits, recoverRoomVisitsAfterCommit };
