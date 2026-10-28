function clip(file, loop = 'repeat', metadata = {}) {
  return {
    path: `assets/animated-sprites/${file}.fbx`,
    loop,
    clampWhenFinished: loop === 'once',
    ...metadata,
  };
}

function visualClip(key, file, loop = 'once') {
  return { key, ...clip(file, loop), lazy: true, retarget: true };
}

const LOCOMOTION_ANIMATIONS = {
  idle: clip('Standing Idle'),
  idleVariant2: clip('idle (2)'),
  idleVariant3: clip('idle (3)'),
  idleVariant4: clip('idle (4)'),
  idleVariant5: clip('idle (5)'),
  walk: clip('Walking'),
  walkBackward: clip('Walk Backward'),
  run: clip('running'),
  runBackward: clip('Run Backward'),
  sprint: clip('Sprint'),
  runStop: clip('run to stop', 'once'),
  drunkWalk: clip('drunk walk'),
  drunkWalkBackward: clip('drunk walk backwards'),
  drunkRunForward: clip('drunk run forward'),
  drunkRunBackward: clip('drunk run backward'),
  fall: clip('Falling To Landing', 'once', { contactTime: 8 / 30 }),
  climb: clip('Climbing', 'once'),
  climbWall: clip('Climbing Up Wall'),
  climbWallDown: clip('Climbing Down Wall', 'repeat', { preserveRootMotion: true }),
  climbRecover: clip('Crouched To Standing', 'once'),
  hardLanding: clip('Hard Landing', 'once', { contactTime: 3 / 30 }),
  fallToRoll: clip('falling to roll', 'once', { contactTime: 2 / 30 }),
  fallLoop: clip('falling idle'),
  vault: clip('Vault Over Box', 'once', { traversalStart: 0.2, traversalEnd: 1.7 }),
  hopDown: clip('Jump Down', 'once'),
};

const VISUAL_PLAYBACK = {
  force: true,
  fadeIn: 0.18,
  fadeOut: 0.22,
  allowRootMotion: true,
  inPlace: true,
  movementLockMs: Infinity,
  releaseOnMovement: true,
};

export const MANUAL_ACTIONS = [
  {
    id: 'emote-defeated',
    group: 'emotes',
    label: 'Defeated',
    description: 'Collapse into the defeated pose.',
    icon: '\uD83D\uDC80',
    accent: '#f87171',
    animation: { key: 'defeated', ...clip('Defeated', 'once') },
    playback: {
      force: true,
      fadeIn: 0.22,
      fadeOut: 0.35,
      allowRootMotion: true,
      releaseOnMovement: true,
    },
  },
  {
    id: 'emote-idle',
    group: 'emotes',
    label: 'Idle',
    description: 'Play a relaxed idle animation (random pick).',
    icon: '\uD83D\uDE0C',
    accent: '#facc15',
    choices: ['idle', 'idleVariant2', 'idleVariant3', 'idleVariant4', 'idleVariant5'],
    playback: { force: true },
  },
  {
    id: 'emote-rumba',
    group: 'emotes',
    label: 'Rumba Dance',
    description: 'Loop a flashy rumba dance.',
    icon: '\uD83D\uDC83',
    accent: '#fb7185',
    // Keep the historical dance key separate from the new actual jump.
    animation: {
      key: 'jump',
      ...clip('Rumba Dancing (1)', 'repeat', { preserveRootMotion: true }),
    },
    playback: {
      force: true,
      fadeIn: 0.2,
      fadeOut: 0.3,
      allowRootMotion: true,
      movementLockMs: Infinity,
      autoRevert: false,
      releaseOnMovement: true,
    },
  },
  {
    id: 'emote-fancy-pose',
    group: 'emotes',
    label: 'Fancy Pose',
    description: 'Strike a stylish, poised stance.',
    icon: '\uD83D\uDC83',
    accent: '#e879f9',
    animation: { key: 'fancyPose', ...clip('Female Standing Pose', 'once') },
    playback: {
      force: true,
      fadeIn: 0.25,
      fadeOut: 0.35,
      autoRevert: false,
      movementLockMs: Infinity,
      allowRootMotion: true,
      releaseOnMovement: true,
    },
  },
  {
    id: 'emote-dynamic-pose',
    group: 'emotes',
    label: 'Dynamic Pose',
    description: 'Hold an action-ready dynamic pose.',
    icon: '\uD83D\uDD7A',
    accent: '#34d399',
    animation: { key: 'dynamicPose', ...clip('Female Dynamic Pose', 'once') },
    playback: {
      force: true,
      fadeIn: 0.25,
      fadeOut: 0.35,
      autoRevert: false,
      movementLockMs: Infinity,
      allowRootMotion: true,
      releaseOnMovement: true,
    },
  },
  {
    id: 'action-wave',
    group: 'actions',
    label: 'Wave',
    description: 'Wave until another action or movement is selected.',
    icon: '\uD83D\uDC4B',
    accent: '#facc15',
    animation: visualClip('actionWave', 'Waving', 'repeat'),
    playback: VISUAL_PLAYBACK,
  },
  {
    id: 'action-sit',
    group: 'actions',
    label: 'Sit',
    description: 'Hold a seated idle pose. Visual only; no chair or gameplay effect.',
    icon: '\uD83E\uDE91',
    accent: '#c4b5fd',
    animation: visualClip('actionSit', 'Sitting Idle', 'repeat'),
    playback: VISUAL_PLAYBACK,
  },
  {
    id: 'action-cover',
    group: 'actions',
    label: 'Take Cover',
    description: 'Align to an adjacent wall and crouch. Requires a wall high enough for the pose.',
    icon: '\u2193',
    accent: '#93c5fd',
    animation: visualClip('actionCover', 'stand to cover (2)'),
    requiresWall: true,
    playback: VISUAL_PLAYBACK,
  },
  {
    id: 'action-jump',
    group: 'actions',
    label: 'Jump',
    description: 'Perform a complete jump in place without moving the token.',
    icon: '\u2191',
    accent: '#67e8f9',
    animation: visualClip('actionJump', 'Jumping'),
    playback: VISUAL_PLAYBACK,
    revertTo: 'idle',
  },
  {
    id: 'action-punch',
    group: 'actions',
    label: 'Punch',
    description: 'Preview an unarmed attack. Does not attack or deal damage.',
    icon: '\uD83D\uDC4A',
    accent: '#fb923c',
    animation: visualClip('actionPunch', 'Punching'),
    playback: VISUAL_PLAYBACK,
    revertTo: 'idle',
  },
  {
    id: 'action-hit',
    group: 'actions',
    label: 'Hit Reaction',
    description: 'Preview a hit reaction without changing health or position.',
    icon: '\u26A1',
    accent: '#fca5a5',
    animation: visualClip('actionHit', 'Standing React Large Gut'),
    playback: VISUAL_PLAYBACK,
    revertTo: 'idle',
  },
  {
    id: 'action-dodge',
    group: 'actions',
    label: 'Dodge',
    description:
      'Dodge sideways, then step naturally back. Does not evade attacks or change cells.',
    icon: '\u21AA',
    accent: '#6ee7b7',
    animation: visualClip('actionDodge', 'Standing Dodge Left'),
    returnAnimation: visualClip('dodgeRecover', 'right strafe walk'),
    playback: {
      ...VISUAL_PLAYBACK,
      inPlace: false,
      blocksMovement: true,
      releaseOnMovement: false,
    },
    revertTo: 'idle',
  },
  {
    id: 'action-cast',
    group: 'actions',
    label: 'Cast Spell',
    description: 'Preview two-handed spellcasting. No spell effects or rules are applied.',
    icon: '\u2728',
    accent: '#d8b4fe',
    animation: visualClip('actionCast', 'Standing 2H Magic Attack 01'),
    playback: VISUAL_PLAYBACK,
    revertTo: 'idle',
  },
];

export const HUMANOID_ANIMATIONS = {
  ...LOCOMOTION_ANIMATIONS,
  ...Object.fromEntries(
    MANUAL_ACTIONS.flatMap((action) =>
      [action.animation, action.returnAnimation].filter(Boolean)
    ).map((animation) => {
      const { key, ...descriptor } = animation;
      return [key, descriptor];
    })
  ),
};

const manualActions = new Map(MANUAL_ACTIONS.map((action) => [action.id, action]));

export function getManualAction(commandId) {
  return manualActions.get(commandId === 'emote-jump' ? 'emote-rumba' : commandId) || null;
}
