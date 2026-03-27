const DEFAULT_COMMANDS = [
  // ── Advance Command ──────────────────────────────────────────
  {
    id: 'advance',
    label: 'Advance',
    description: 'Flag this unit to push forward or close the distance.',
    icon: '⤴',
    accent: '#66CFFF',
    tint: 0x66cfff,
    subActions: [
      {
        id: 'advance-flank',
        label: 'Flank',
        description: 'Curve outward before closing in.',
        icon: '🗡',
        accent: '#7ad7ff',
      },
      {
        id: 'advance-charge',
        label: 'Charge',
        description: 'Full-speed rush toward the target.',
        icon: '⚡',
        accent: '#4ad0ff',
      },
      {
        id: 'advance-focus',
        label: 'Lock Target',
        description: 'Advance while maintaining aim.',
        icon: '🎯',
        accent: '#9fd0ff',
      },
    ],
  },
  // ── Hold Command ──────────────────────────────────────────────
  {
    id: 'hold',
    label: 'Hold',
    description: 'Hold position and defend the current tile.',
    icon: '🛡',
    accent: '#4E7BFF',
    tint: 0x4e7bff,
  },
  // ── Support Command ──────────────────────────────────────────
  {
    id: 'support',
    label: 'Support',
    description: 'Assist allies; mark as providing buffs or aid.',
    icon: '✨',
    accent: '#63FFD3',
    tint: 0x63ffd3,
    subActions: [
      {
        id: 'support-heal',
        label: 'Stabilise',
        description: 'Provide healing or first aid.',
        icon: '✚',
        accent: '#8ffff0',
      },
      {
        id: 'support-bolster',
        label: 'Bolster',
        description: 'Grant temporary buffs or shields.',
        icon: '🛡',
        accent: '#6efff0',
      },
    ],
  },
  // ── Emotes Command ───────────────────────────────────────────
  {
    id: 'emotes',
    label: 'Emotes',
    description: 'Trigger quick expressive animations for this token.',
    icon: '😊',
    accent: '#FFBD80',
    tint: 0xffbd80,
    subActions: [
      {
        id: 'emote-defeated',
        label: 'Defeated',
        description: 'Collapse into the defeated pose.',
        icon: '💀',
        accent: '#f87171',
      },
      {
        id: 'emote-idle',
        label: 'Idle',
        description: 'Play a relaxed idle animation (random pick).',
        icon: '😌',
        accent: '#facc15',
      },
      {
        id: 'emote-rumba',
        label: 'Rumba Dance',
        description: 'Loop a flashy rumba dance.',
        icon: '💃',
        accent: '#fb7185',
      },
      {
        id: 'emote-fancy-pose',
        label: 'Fancy Pose',
        description: 'Strike a stylish, poised stance.',
        icon: '💃',
        accent: '#e879f9',
      },
      {
        id: 'emote-dynamic-pose',
        label: 'Dynamic Pose',
        description: 'Hold an action-ready dynamic pose.',
        icon: '🕺',
        accent: '#34d399',
      },
    ],
  },
  // ── Focus Command ────────────────────────────────────────────
  {
    id: 'focus',
    label: 'Focus',
    description: 'Prioritise this token for targeted abilities.',
    icon: '🎯',
    accent: '#A18BFF',
    tint: 0xa18bff,
  },
  // ── Clear Command ────────────────────────────────────────────
  {
    id: 'clear',
    label: 'Clear',
    description: 'Remove any quick command markers from this token.',
    icon: '✖',
    accent: '#7E8DAA',
    tint: null,
  },
];

// ── Command Registry & Lookup ─────────────────────────────────
export const TOKEN_COMMANDS = DEFAULT_COMMANDS;

function registerCommand(map, command) {
  map[command.id] = command;
  if (Array.isArray(command.subActions)) {
    command.subActions.forEach((child) => registerCommand(map, child));
  }
}

const TOKEN_COMMAND_LOOKUP = TOKEN_COMMANDS.reduce((map, command) => {
  registerCommand(map, command);
  return map;
}, Object.create(null));

export function getTokenCommand(commandId) {
  if (!commandId) return null;
  return TOKEN_COMMAND_LOOKUP[commandId] || null;
}
