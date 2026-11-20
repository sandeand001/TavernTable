import { samePlacement } from '../scene/token-adapter/SavedPlacements.js';

const copy = (value) => JSON.parse(JSON.stringify(value));
const invalid = (message) =>
  Object.assign(new Error(message), {
    status: 422,
    code: 'invalid-scene-presentation',
  });

export function coalesceLiveMovementPresentations(presentations) {
  if (!Array.isArray(presentations) || !presentations.length || presentations.length > 256)
    throw invalid('Choose valid bounded live movement presentations');
  const result = [];
  const active = new Map();
  for (const value of presentations) {
    const entry = copy(value);
    if (
      entry?.kind !== 'move' ||
      !entry.motion ||
      !Array.isArray(entry.motion.route) ||
      !entry.motion.route.length
    ) {
      result.push(entry);
      continue;
    }
    const key = JSON.stringify([entry.tokenId, entry.commandId]);
    const index = active.get(key);
    if (index === undefined) {
      active.set(key, result.length);
      result.push(entry);
      continue;
    }
    const previous = result[index];
    if (
      previous.motion.kind !== entry.motion.kind ||
      !samePlacement(previous.motion.route.at(-1), entry.motion.from)
    )
      throw invalid('Live movement chunks must form one contiguous route');
    previous.motion.route.push(...entry.motion.route);
    previous.motion.completed = previous.motion.completed && entry.motion.completed;
    previous.motion.continuing = entry.motion.continuing === true;
  }
  const ids = result.map((entry) => entry?.commandId);
  if (new Set(ids).size !== ids.length)
    throw invalid('Live movement presentations must have unique command IDs');
  return result;
}
