import { MANUAL_ACTIONS } from './HumanoidActionCatalog.js';
import { FLIGHT_ELEVATION_STEPS, FLIGHT_TAKEOFF_FEET } from './TokenMovementConfig.js';

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
  {
    id: 'take-flight',
    label: 'Take flight',
    description: 'Rise 5 feet, spending 5 feet of flying movement.',
    icon: '\u2197',
    accent: '#7dd3fc',
    hidden: true,
    flight: { kind: 'takeoff', feet: FLIGHT_TAKEOFF_FEET },
  },
  ...[
    ['raise', 'Raise', '\u2191'],
    ['lower', 'Lower', '\u2193'],
  ].map(([kind, label, icon]) => ({
    id: `flight-${kind}`,
    label,
    description: `${label} flight elevation using flying movement.`,
    icon,
    accent: '#7dd3fc',
    hidden: true,
    flight: { kind },
    subActions: FLIGHT_ELEVATION_STEPS.map((feet) => {
      const amount = `${kind === 'raise' ? '+' : '-'}${feet} ft`;
      return {
        id: `flight-${kind}-${feet}`,
        label: amount,
        description: `${label} ${feet} feet. Costs ${feet} feet of flying movement.`,
        iconText: amount,
        accent: '#7dd3fc',
        flight: { kind, feet },
      };
    }),
  })),
  {
    id: 'flight-drop',
    label: 'Drop',
    description: 'Relinquish flight and fall. No movement cost; falling damage and Prone apply.',
    icon: '\u21a7',
    accent: '#fca5a5',
    hidden: true,
    flight: { kind: 'drop' },
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
