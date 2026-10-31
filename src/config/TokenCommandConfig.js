import { MANUAL_ACTIONS } from './HumanoidActionCatalog.js';

// ── Constants ──────────────────────────────────────────────────
const DEFAULT_COMMANDS = [
  // ── Character Sheet ─────────────────────────────────────────
  {
    id: 'character-sheet',
    label: 'Character Sheet',
    description: 'Open this creature in the character sheet window.',
    icon: '📜',
    accent: '#66CFFF',
  },
  // ── Emotes Command ───────────────────────────────────────────
  {
    id: 'emotes',
    label: 'Emotes',
    description: 'Trigger quick expressive animations for this token.',
    icon: '😊',
    accent: '#FFBD80',
    tint: 0xffbd80,
    subActions: MANUAL_ACTIONS.filter((action) => action.group === 'emotes'),
  },
  {
    id: 'actions',
    label: 'Actions',
    description: 'Visual actions for a stationary, grounded creature. No gameplay rules.',
    icon: '\u2728',
    accent: '#a5b4fc',
    subActions: MANUAL_ACTIONS.filter((action) => action.group === 'actions'),
  },
];

// ── Command Registry & Lookup ─────────────────────────────────
// NOTE: §4 violation — _registerCommand builds the tree lazily at import time; getTokenCommand is a pure data accessor. Extraction not warranted.
export const TOKEN_COMMANDS = DEFAULT_COMMANDS;

function _registerCommand(map, command) {
  map[command.id] = command;
  if (Array.isArray(command.subActions)) {
    command.subActions.forEach((child) => _registerCommand(map, child));
  }
}

const TOKEN_COMMAND_LOOKUP = TOKEN_COMMANDS.reduce((map, command) => {
  _registerCommand(map, command);
  return map;
}, Object.create(null));

export function getTokenCommand(commandId) {
  if (!commandId) return null;
  return TOKEN_COMMAND_LOOKUP[commandId] || null;
}
