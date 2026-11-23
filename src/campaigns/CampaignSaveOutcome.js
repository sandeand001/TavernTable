export async function verifyRejectedSceneSave(library, error, previous) {
  let uncertain = null;
  if (
    !Number.isInteger(error?.status) ||
    error.status < 400 ||
    error.status >= 500 ||
    [408, 429].includes(error.status) ||
    error?.code === 'invalid-session-response'
  )
    uncertain = new Error('The host did not definitively reject the scene save');
  try {
    if (!library.store?.readScene || !library.campaign?.id)
      throw new Error('The saved campaign state cannot be checked');
    const saved = await library.store.readScene(library.campaign.id);
    if (
      saved.revision !== previous.sceneRevision ||
      saved.charactersRevision !== previous.charactersRevision ||
      saved.scene !== previous.scene
    )
      throw new Error('The saved campaign changed while the scene was being written');
  } catch (verificationError) {
    uncertain ||= verificationError;
  }
  return uncertain;
}
