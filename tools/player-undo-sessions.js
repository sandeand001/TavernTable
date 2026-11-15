const copy = (value) => JSON.parse(JSON.stringify(value));

function playerUndoFor(sessions, profile, state) {
  const saved = sessions.get(profile.id);
  if (
    !saved ||
    saved.campaignId !== profile.campaignId ||
    state.campaign.id !== profile.campaignId ||
    saved.sceneRevision !== state.sceneRevision ||
    saved.revision !== state.revision
  )
    return new Map();
  return new Map(
    [...saved.tokens].filter(([, entries]) =>
      entries.every((entry) => profile.characterIds.includes(entry.characterId))
    )
  );
}

function rememberPlayerUndo(sessions, profile, { previous, current, tokens, tokenId, reset }) {
  for (const [id, saved] of sessions) {
    if (saved.campaignId !== profile.campaignId || saved.sceneRevision > current.sceneRevision)
      continue;
    if (
      reset ||
      saved.sceneRevision !== previous.sceneRevision ||
      saved.revision !== previous.revision
    ) {
      sessions.delete(id);
      continue;
    }
    const retained = new Map(saved.tokens);
    retained.delete(tokenId);
    sessions.set(id, { ...saved, ...current, tokens: retained });
  }
  if (sessions.get(profile.id)?.sceneRevision > current.sceneRevision) return;
  const retained = reset
    ? new Map()
    : new Map([...tokens].map(([id, entries]) => [id, copy(entries.slice(-10))]));
  while (retained.size > 64) retained.delete(retained.keys().next().value);
  sessions.delete(profile.id);
  if (retained.size)
    sessions.set(profile.id, { campaignId: profile.campaignId, ...current, tokens: retained });
  while (sessions.size > 256) sessions.delete(sessions.keys().next().value);
}

function advancePlayerUndo(undo, previousScene, result, command) {
  const tokens = new Map(undo);
  if (result.undoReceipts?.length) tokens.set(command.tokenId, result.undoReceipts);
  else if (result.undoReceipts || command.kind === 'remove') tokens.delete(command.tokenId);
  for (const [tokenId, entries] of tokens) {
    const characterId = result.scene.creatures.find((entry) => entry.id === tokenId)?.characterId;
    const history =
      result.scene.combat.histories.find((entry) => entry.characterId === characterId)?.entries ||
      [];
    const retained = entries.filter(
      (entry) =>
        entry.characterId === characterId &&
        history.some((row) => row.sequence === entry.sequence && !row.undone)
    );
    if (retained.length) tokens.set(tokenId, retained);
    else tokens.delete(tokenId);
  }
  const reset = ['active', 'turn', 'activeTokenId'].some(
    (key) => previousScene.combat[key] !== result.scene.combat[key]
  );
  if (reset) tokens.clear();
  return { tokens, reset };
}

module.exports = { playerUndoFor, rememberPlayerUndo, advancePlayerUndo };
