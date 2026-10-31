export const TOKEN_MOVEMENT_DEFAULTS = Object.freeze({
  speed: 50,
  mode: 'walk',
  type: 'default',
});

export const FEET_PER_GRID_SQUARE = 5;
export const FLIGHT_ELEVATION_STEPS = Object.freeze([5, 10, 15, 20]);
export const FLIGHT_TAKEOFF_FEET = 5;
export const FLIGHT_PACE_MULTIPLIER = 2;
export const MAX_STEP_HEIGHT_FEET = 1.5;
export const MAX_LOW_LEDGE_HEIGHT_FEET = 2.5;
export const HARD_LANDING_HEIGHT_FEET = 7.5;
export const ROLLING_LANDING_HEIGHT_FEET = 12;
export const KEYBOARD_TOKEN_CONTROLS_ENABLED = false;

export const FALL_TRAITS_DEFAULTS = Object.freeze({
  flySpeed: 0,
  hover: false,
  featherFall: false,
  fallDamageReduction: 0,
  proneImmune: false,
});

export const MOVEMENT_CONDITIONS = Object.freeze([
  'prone',
  'grappled',
  'restrained',
  'incapacitated',
  'unconscious',
  'paralyzed',
  'petrified',
  'stunned',
]);
