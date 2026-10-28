// MannequinConfig.js — Model definitions, animation library, and movement constants
// Extracted from Token3DAdapter.js (Phase 5 refactor)

import { CHARACTER_DEFINITIONS, DEFAULT_CHARACTER_ID } from '../CharacterCatalog.js';
import { HUMANOID_ANIMATIONS } from '../HumanoidActionCatalog.js';

// ── Shared Humanoid Model Definition ────────────────────
const HUMANOID_MODEL = {
  retargetAnimations: true,
  tileSpan: 1,
  margin: 0.92,
  baseRotation: { x: 0, y: Math.PI / 2, z: 0 },
  animation: {
    autoplay: true,
    loop: true,
    clampWhenFinished: false,
  },
  animations: HUMANOID_ANIMATIONS,
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

// ── Model Registry ─────────────────────────────────────
export const TOKEN_3D_MODELS = {};
for (const character of CHARACTER_DEFINITIONS) {
  const model = { ...HUMANOID_MODEL, ...character.model };
  TOKEN_3D_MODELS[character.id] = model;
  for (const alias of character.aliases) TOKEN_3D_MODELS[alias] = model;
}
export const MANNEQUIN_MODEL = TOKEN_3D_MODELS[DEFAULT_CHARACTER_ID];

// ── Default Movement Profile ───────────────────────────
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
  fallLoopTimeScale: 4.5,
  fallLoopMinDrop: 4.5,
};

// ── Fall & Landing Constants ────────────────────────────
export const FALL_GRAVITY_FEET_PER_SECOND_SQUARED = 32.174;
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
// ── Climb Constants ───────────────────────────────────
export const DEFAULT_CLIMB_DURATION = 1.2;
export const DEFAULT_CLIMB_RECOVER_DURATION = 0.95;
export const MAX_STANDARD_CLIMB_LEVELS = 4;
export const HIGH_WALL_SEGMENT_LEVELS = 4;
export const DEFAULT_CLIMB_WALL_DURATION = 1.2;
export const CLIMB_WALL_ENTRY_TILE_HALF_RATIO = 0.68;
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
// ── Selection & Logging Constants ──────────────────────
export const SELECTION_COLLIDER_HEIGHT = 2.3;
export const SELECTION_COLLIDER_RADIUS_RATIO = 0.46;
export const PATHING_LOG_LOCAL_STORAGE_KEY = 'tt:pathingLogs';
export const PATHING_LOG_ENV_FLAG = 'TT_PATHING_LOGS';
export const PATHING_LOG_PREFIX = '[Token3DAdapter]';
export const PATHING_LOG_ARCHIVE_LIMIT = 300;
export const FALL_HEIGHT_VERBOSE_STORAGE_KEYS = ['tt:fallHeightVerbose', 'ttFallHeightVerbose'];
export const TOKEN_WORLD_LOCK_PROP = '__ttWorldLock';
