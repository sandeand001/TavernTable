// MannequinConfig.js — Model definitions, animation library, and movement constants
// Extracted from Token3DAdapter.js (Phase 5 refactor)

export const MANNEQUIN_MODEL = {
  path: 'assets/animated-sprites/Standing Idle.fbx',
  tileSpan: 1,
  margin: 0.92,
  baseRotation: { x: 0, y: Math.PI / 2, z: 0 },
  animation: {
    autoplay: true,
    loop: true,
    clampWhenFinished: false,
  },
  animations: {
    idle: {
      path: 'assets/animated-sprites/Standing Idle.fbx',
      loop: 'repeat',
      clampWhenFinished: false,
    },
    idleVariant2: {
      path: 'assets/animated-sprites/idle (2).fbx',
      loop: 'repeat',
      clampWhenFinished: false,
    },
    idleVariant3: {
      path: 'assets/animated-sprites/idle (3).fbx',
      loop: 'repeat',
      clampWhenFinished: false,
    },
    idleVariant4: {
      path: 'assets/animated-sprites/idle (4).fbx',
      loop: 'repeat',
      clampWhenFinished: false,
    },
    idleVariant5: {
      path: 'assets/animated-sprites/idle (5).fbx',
      loop: 'repeat',
      clampWhenFinished: false,
    },
    walk: {
      path: 'assets/animated-sprites/Walking.fbx',
      loop: 'repeat',
      clampWhenFinished: false,
    },
    walkBackward: {
      path: 'assets/animated-sprites/Walk Backward.fbx',
      loop: 'repeat',
      clampWhenFinished: false,
    },
    run: {
      path: 'assets/animated-sprites/running.fbx',
      loop: 'repeat',
      clampWhenFinished: false,
    },
    runBackward: {
      path: 'assets/animated-sprites/Run Backward.fbx',
      loop: 'repeat',
      clampWhenFinished: false,
    },
    sprint: {
      path: 'assets/animated-sprites/Sprint.fbx',
      loop: 'repeat',
      clampWhenFinished: false,
    },
    runStop: {
      path: 'assets/animated-sprites/run to stop.fbx',
      loop: 'once',
      clampWhenFinished: true,
    },
    drunkWalk: {
      path: 'assets/animated-sprites/drunk walk.fbx',
      loop: 'repeat',
      clampWhenFinished: false,
    },
    drunkWalkBackward: {
      path: 'assets/animated-sprites/drunk walk backwards.fbx',
      loop: 'repeat',
      clampWhenFinished: false,
    },
    drunkRunForward: {
      path: 'assets/animated-sprites/drunk run forward.fbx',
      loop: 'repeat',
      clampWhenFinished: false,
    },
    drunkRunBackward: {
      path: 'assets/animated-sprites/drunk run backward.fbx',
      loop: 'repeat',
      clampWhenFinished: false,
    },
    fall: {
      path: 'assets/animated-sprites/Falling To Landing.fbx',
      loop: 'once',
      clampWhenFinished: true,
    },
    climb: {
      path: 'assets/animated-sprites/Climbing.fbx',
      loop: 'once',
      clampWhenFinished: true,
    },
    climbWall: {
      path: 'assets/animated-sprites/Climbing Up Wall.fbx',
      loop: 'repeat',
      clampWhenFinished: false,
    },
    climbRecover: {
      path: 'assets/animated-sprites/Crouched To Standing.fbx',
      loop: 'once',
      clampWhenFinished: true,
    },
    hardLanding: {
      path: 'assets/animated-sprites/hard landing.fbx',
      loop: 'once',
      clampWhenFinished: true,
    },
    fallToRoll: {
      path: 'assets/animated-sprites/falling to roll.fbx',
      loop: 'once',
      clampWhenFinished: true,
    },
    fallLoop: {
      path: 'assets/animated-sprites/falling idle.fbx',
      loop: 'repeat',
      clampWhenFinished: false,
    },
    defeated: {
      path: 'assets/animated-sprites/Defeated.fbx',
      loop: 'once',
      clampWhenFinished: true,
    },
    jump: {
      path: 'assets/animated-sprites/Rumba Dancing (1).fbx',
      loop: 'repeat',
      clampWhenFinished: false,
      preserveRootMotion: true,
    },
    fancyPose: {
      path: 'assets/animated-sprites/Female Standing Pose.fbx',
      loop: 'once',
      clampWhenFinished: true,
    },
    dynamicPose: {
      path: 'assets/animated-sprites/Female Dynamic Pose.fbx',
      loop: 'once',
      clampWhenFinished: true,
    },
  },
  movementProfile: {
    startMoveDelay: 1,
    startToWalkBlendLead: 0.12,
    stopTravelPortion: 0.58,
    stopBlendLead: 0.14,
    walkFadeIn: 0.18,
    walkFadeOut: 0.18,
    startFadeIn: 0.12,
    startFadeOut: 0.1,
    stopFadeIn: 0.18,
    stopFadeOut: 0.15,
    idleFadeIn: 0.22,
    idleFadeOut: 0.2,
    fallFadeIn: 0.08,
    fallFadeOut: 0.12,
    fallLoopFadeIn: 0.08,
    fallLoopFadeOut: 0.12,
    fallLoopVerticalSpeed: 9,
    fallLoopMinDuration: 0.24,
    fallLoopMaxDuration: 1.2,
    fallLoopTimeScale: 4.5,
    fallLoopMinDrop: 4.5,
    runSpeedMultiplier: 1.7,
    drunkWalkSpeedMultiplier: 0.65,
    drunkRunSpeedMultiplier: 1.35,
  },
  shadows: {
    cast: true,
    receive: true,
  },
  verticalOffset: 0,
};

export const TOKEN_3D_MODELS = {
  mannequin: MANNEQUIN_MODEL,
  'defeated-doll': MANNEQUIN_MODEL,
  'female-humanoid': MANNEQUIN_MODEL,
};

export const DEFAULT_BILLBOARD_SIZE = 0.9;

export const DEFAULT_MOVEMENT_PROFILE = {
  startMoveDelay: 0.25,
  startToWalkBlendLead: 0.12,
  stopTravelPortion: 0.55,
  stopBlendLead: 0.12,
  walkFadeIn: 0.18,
  walkFadeOut: 0.18,
  startFadeIn: 0.12,
  startFadeOut: 0.1,
  stopFadeIn: 0.18,
  stopFadeOut: 0.15,
  idleFadeIn: 0.2,
  idleFadeOut: 0.2,
  fallFadeIn: 0.1,
  fallFadeOut: 0.12,
  fallLoopFadeIn: 0.1,
  fallLoopFadeOut: 0.12,
  fallLoopVerticalSpeed: 6.75,
  fallLoopMinDuration: 0.27,
  fallLoopMaxDuration: 1.33,
  fallLoopTimeScale: 4.5,
  fallLoopMinDrop: 4.5,
};

export const DEFAULT_FALL_TRIGGER_PROGRESS = 0.38;
export const DEFAULT_HEIGHT_SNAP_PROGRESS = 0.62;
export const HARD_LANDING_HEIGHT_THRESHOLD = 5;
export const ROLLING_LANDING_HEIGHT_THRESHOLD = 8;
export const FALL_MIN_HEIGHT_THRESHOLD = 3;
export const CONTINUOUS_ROTATION_SPEED = Math.PI;
export const SPRINT_THRESHOLD_SECONDS = 3;
export const SPRINT_SPEED_MULTIPLIER = 1.15;
export const SPRINT_LEAN_RADIANS = 0;
export const PATH_NAVIGATION_KEY = '__path_nav';
export const PATH_SPEED_WALK_MAX = 3;
export const PATH_SPEED_RUN_MAX = 6;
export const PATH_SPEED_DEFAULT_TOLERANCE = 0.35;
export const PATH_SPEED_MODES = {
  WALK: 'walk',
  RUN: 'run',
  SPRINT: 'sprint',
};
export const DEFAULT_CLIMB_DURATION = 1.2;
export const DEFAULT_CLIMB_RECOVER_DURATION = 0.95;
export const MAX_STANDARD_CLIMB_LEVELS = 4;
export const HIGH_WALL_SEGMENT_LEVELS = 4;
export const DEFAULT_CLIMB_WALL_DURATION = 1.2;
export const CLIMB_WALL_BLEND_LEAD = 0.2;
export const CLIMB_WALL_PROGRESS_EXPONENT = 1.35;
export const CLIMB_WALL_PROGRESS_SCALE = 0.5;
export const CLIMB_WALL_ENTRY_TILE_HALF_RATIO = 0.68;
export const CLIMB_WALL_ENTRY_MIN_RATIO = -0.45;
export const CLIMB_WALL_ENTRY_RUN_BACKOFF_RATIO = 0.32;
export const CLIMB_WALL_ENTRY_SPRINT_BACKOFF_RATIO = 1.1;
export const FALL_EDGE_TRIGGER_TILE_RATIO = 1 - CLIMB_WALL_ENTRY_TILE_HALF_RATIO * 0.5;
export const FALL_LANDING_THRESHOLD_CONFIG = {
  fall: { slope: 0.05, bias: 0.24, lower: 0.35, upper: 0.85 },
  hardLanding: { slope: 0.045, bias: 0.18, lower: 0.32, upper: 0.65 },
  fallToRoll: { slope: 0.06, bias: 0.3, lower: 0.45, upper: 1.0 },
};
export const FALL_LOOP_MIN_DROP = 4.5;
export const LANDING_VARIANTS_ALLOW_TILE_EXIT = new Set(['fallToRoll']);
export const LANDING_VARIANTS_FORCE_ZERO_ELEVATION = new Set(['fallToRoll', 'fall', 'hardLanding']);
export const LANDING_OFFSET_SANITIZE_LIMITS = {
  default: {
    horizontalMultiplier: 2.1,
    horizontalBonusTiles: 0.45,
    horizontalMaxTiles: 4,
  },
  fall: {
    horizontalMultiplier: 2.1,
    horizontalBonusTiles: 0.45,
    horizontalMaxTiles: 4,
  },
  hardLanding: {
    horizontalMultiplier: 1.35,
    horizontalBonusTiles: 0.35,
    horizontalMaxTiles: 2,
  },
  fallToRoll: {
    horizontalMultiplier: 1.55,
    horizontalBonusTiles: 0.4,
    horizontalMaxTiles: 2,
  },
};
export const CLIMB_APPROACH_TOLERANCE_MIN = 0.04;
export const CLIMB_APPROACH_TOLERANCE_RUN_SCALE = 0.65;
export const CLIMB_APPROACH_TOLERANCE_SPRINT_SCALE = 0.45;
export const MAX_INTERMEDIATE_CLIMB_CHAIN = 4;
export const PATH_STALL_REPATH_DELAY = 0.35;
export const SELECTION_COLLIDER_HEIGHT = 2.3;
export const SELECTION_COLLIDER_RADIUS_RATIO = 0.46;
export const CLIMB_RECOVER_DEFAULT_CROUCH_DROP = 0.05;
export const CLIMB_RECOVER_MIN_CROUCH_DROP = 0.01;
export const CLIMB_RECOVER_MAX_CROUCH_DROP = 0.25;
export const CLIMB_RECOVER_CROUCH_HOLD = 0.24;
export const CLIMB_RECOVER_STAND_RELEASE = 0.78;
export const PATHING_LOG_LOCAL_STORAGE_KEY = 'tt:pathingLogs';
export const PATHING_LOG_ENV_FLAG = 'TT_PATHING_LOGS';
export const PATHING_LOG_PREFIX = '[Token3DAdapter]';
export const PATHING_LOG_ARCHIVE_LIMIT = 300;
export const FALL_HEIGHT_VERBOSE_STORAGE_KEYS = ['tt:fallHeightVerbose', 'ttFallHeightVerbose'];
export const TOKEN_WORLD_LOCK_PROP = '__ttWorldLock';
