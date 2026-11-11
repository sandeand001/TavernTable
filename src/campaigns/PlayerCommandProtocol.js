import { FLIGHT_ELEVATION_STEPS } from '../config/TokenMovementConfig.js';

export const PLAYER_COMMAND_VERSION = 1;
export const PLAYER_COMMAND_KINDS = Object.freeze([
  'move',
  'turn.end',
  'stand',
  'roll',
  'action.use',
  'place',
  'remove',
  'flight.takeoff',
  'flight.drop',
  'traverse',
  'flight.raise',
  'flight.lower',
  'facing',
  'movement.settings',
  'emote',
  'action.undo',
]);

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const only = (value, names) =>
  record(value) && Object.keys(value).every((key) => names.includes(key));
const identifier = (value) =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,299}$/.test(value);

export function validatePlayerCommand(command) {
  const invalid = () => {
    throw Object.assign(new Error('Invalid player gameplay command'), {
      status: 400,
      code: 'invalid-command',
    });
  };
  if (
    !only(command, [
      'version',
      'commandId',
      'sceneRevision',
      'charactersRevision',
      'observerTokenId',
      'tokenId',
      'kind',
      'payload',
      'view',
    ]) ||
    command.version !== PLAYER_COMMAND_VERSION ||
    typeof command.commandId !== 'string' ||
    !/^[a-zA-Z0-9_-]{8,100}$/.test(command.commandId) ||
    !Number.isSafeInteger(command.sceneRevision) ||
    command.sceneRevision < 0 ||
    !Number.isSafeInteger(command.charactersRevision) ||
    command.charactersRevision < 0 ||
    (command.kind === 'place'
      ? command.tokenId !== null || command.observerTokenId !== null
      : !identifier(command.tokenId) || !identifier(command.observerTokenId)) ||
    !PLAYER_COMMAND_KINDS.includes(command.kind)
  )
    invalid();
  if (
    command.view !== undefined &&
    (!only(command.view, ['mapId', 'assetKey']) ||
      (command.view.mapId !== undefined &&
        command.view.mapId !== null &&
        !identifier(command.view.mapId)) ||
      (command.view.assetKey !== undefined &&
        command.view.assetKey !== null &&
        (typeof command.view.assetKey !== 'string' || command.view.assetKey.length > 150)))
  )
    invalid();
  if (
    command.kind === 'move' &&
    (!only(command.payload, ['target', 'useSlowFall']) ||
      (command.payload.useSlowFall !== undefined &&
        typeof command.payload.useSlowFall !== 'boolean') ||
      !only(command.payload.target, ['mapId', 'gridX', 'gridY']) ||
      !identifier(command.payload.target.mapId) ||
      !Number.isInteger(command.payload.target.gridX) ||
      !Number.isInteger(command.payload.target.gridY))
  )
    invalid();
  if (
    ['turn.end', 'stand', 'remove', 'flight.takeoff', 'action.undo'].includes(command.kind) &&
    !only(command.payload, [])
  )
    invalid();
  if (
    command.kind === 'flight.drop' &&
    (!only(command.payload, ['useSlowFall']) || typeof command.payload.useSlowFall !== 'boolean')
  )
    invalid();
  if (
    command.kind === 'traverse' &&
    (!only(command.payload, ['connectionId', 'action']) ||
      !identifier(command.payload.connectionId) ||
      (command.payload.action !== undefined &&
        !['up', 'down', 'enter'].includes(command.payload.action)))
  )
    invalid();
  if (
    ['flight.raise', 'flight.lower'].includes(command.kind) &&
    (!only(command.payload, ['feet']) || !FLIGHT_ELEVATION_STEPS.includes(command.payload.feet))
  )
    invalid();
  if (
    command.kind === 'facing' &&
    (!only(command.payload, ['angle']) || !Number.isFinite(command.payload.angle))
  )
    invalid();
  if (
    command.kind === 'movement.settings' &&
    (!only(command.payload, ['mode', 'type']) ||
      !Object.keys(command.payload).length ||
      (command.payload.mode !== undefined && !['walk', 'run'].includes(command.payload.mode)) ||
      (command.payload.type !== undefined && !['default', 'drunk'].includes(command.payload.type)))
  )
    invalid();
  if (
    command.kind === 'emote' &&
    (!only(command.payload, ['actionId', 'animationKey']) ||
      !identifier(command.payload.actionId) ||
      (command.payload.animationKey !== undefined && !identifier(command.payload.animationKey)))
  )
    invalid();
  if (
    command.kind === 'roll' &&
    (!only(command.payload, ['expression', 'label', 'mode']) ||
      typeof command.payload.expression !== 'string' ||
      command.payload.expression.length > 160 ||
      typeof command.payload.label !== 'string' ||
      command.payload.label.length > 240 ||
      !['normal', 'advantage', 'disadvantage'].includes(command.payload.mode))
  )
    invalid();
  if (
    command.kind === 'action.use' &&
    (!only(command.payload, ['actionId', 'choice', 'targeting']) ||
      !identifier(command.payload.actionId) ||
      (command.payload.choice !== undefined &&
        !only(command.payload.choice, ['slotLevel', 'amount', 'variant'])))
  )
    invalid();
  if (
    command.kind === 'place' &&
    (!only(command.payload, ['characterId', 'appearance', 'grantId']) ||
      !identifier(command.payload.characterId) ||
      !identifier(command.payload.grantId) ||
      typeof command.payload.appearance !== 'string' ||
      !command.payload.appearance)
  )
    invalid();
  return command;
}
