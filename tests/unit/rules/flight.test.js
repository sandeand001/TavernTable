import { flightAvailability, movementSpeed } from '../../../src/rules/flight.js';
import { canRemainAirborne, fallProtection } from '../../../src/rules/falling.js';
import {
  buildFlightRange,
  getMovementRoute,
} from '../../../src/entities/creatures/TokenMovement.js';

const character = (updates = {}) => ({
  speed: 30,
  hp: { current: 10 },
  conditions: [],
  fallTraits: { flySpeed: 60, hover: false },
  ...updates,
});

test('ground and flight speeds are distinct and invalid speeds or travel modes fail explicitly', () => {
  expect(movementSpeed(character())).toBe(30);
  expect(movementSpeed(character(), 'fly')).toBe(60);
  expect(() => movementSpeed(character(), 'teleport')).toThrow('Travel mode');
  expect(() => movementSpeed(character({ fallTraits: { flySpeed: NaN } }), 'fly')).toThrow('speed');
});

test('flight requires an active speed and movable character; hover preserves suspension, not movement', () => {
  expect(flightAvailability(character()).allowed).toBe(true);
  expect(flightAvailability(character({ fallTraits: { flySpeed: 0 } })).allowed).toBe(false);
  expect(flightAvailability(character({ conditions: ['prone'] })).allowed).toBe(false);
  expect(flightAvailability(character({ conditions: ['restrained'] })).allowed).toBe(false);
  expect(canRemainAirborne(character({ conditions: ['prone'] }))).toBe(false);
  const hovering = character({
    fallTraits: { flySpeed: 60, hover: true },
    conditions: ['restrained'],
  });
  expect(canRemainAirborne(hovering)).toBe(true);
  expect(flightAvailability(hovering).allowed).toBe(false);
  expect(canRemainAirborne(character({ fallTraits: { flySpeed: 0, hover: true } }))).toBe(false);
});

test('Drop relinquishes flight protection but not Feather Fall or other reductions', () => {
  expect(fallProtection(character()).avoidDamage).toBe(true);
  expect(fallProtection(character(), { ignoreFlight: true })).toMatchObject({
    avoidDamage: false,
    reason: '',
  });
  expect(
    fallProtection(
      character({
        fallTraits: { flySpeed: 60, hover: true, featherFall: true, fallDamageReduction: 4 },
      }),
      { ignoreFlight: true }
    )
  ).toMatchObject({ avoidDamage: true, featherFall: true, reduction: 4 });
  expect(() => fallProtection(character(), { ignoreFlight: 'yes' })).toThrow('protection');
});

test('flight range retains five-foot horizontal and diagonal costs, bypasses lower terrain and blocks cliffs', () => {
  const options = {
    cols: 7,
    rows: 5,
    startGridX: 1,
    startGridY: 2,
    speed: 15,
    tileWorldSize: 1,
    elevationUnit: 0.5,
    flightWorldY: 1,
    getHeight: (x) => (x === 2 ? 1 : 0),
  };
  const range = buildFlightRange(options);
  expect(range.travelMode).toBe('fly');
  expect(range.flightWorldY).toBe(1);
  expect(getMovementRoute(range, 4, 2).at(-1).cost).toBe(15);
  expect(getMovementRoute(range, 2, 3).at(-1).cost).toBe(5);
  expect(getMovementRoute(range, 5, 2)).toBeNull();
  expect(
    getMovementRoute(buildFlightRange({ ...options, getHeight: (x) => (x === 2 ? 2 : 0) }), 3, 2)
  ).toBeNull();
});

test('flight remains usable with zero terrain elevation scale and rejects invalid heights', () => {
  const options = {
    cols: 3,
    rows: 3,
    startGridX: 0,
    startGridY: 0,
    speed: 5,
    tileWorldSize: 1,
    elevationUnit: 0,
    flightWorldY: 1,
    getHeight: () => 100,
  };
  expect(getMovementRoute(buildFlightRange(options), 1, 1).at(-1).cost).toBe(5);
  expect(() => buildFlightRange({ ...options, getHeight: () => NaN })).toThrow('Terrain height');
});
