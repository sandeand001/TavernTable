/** @jest-environment node */
import { LoginThrottle } from '../../../tools/login-throttle.js';

test('expired sign-in counters are removed during a later attempt', () => {
  let time = 100;
  const throttle = new LoginThrottle({ windowMs: 1000, now: () => time });
  expect(throttle.allow('host-old')).toBe(true);
  expect(throttle.allow('player-old')).toBe(true);

  time += 1001;
  expect(throttle.allow('player-new')).toBe(true);

  expect(throttle.size).toBe(1);
});

test('distinct-key bursts cannot grow the throttle table past its capacity', () => {
  const throttle = new LoginThrottle({ maxEntries: 2 });
  expect(throttle.allow('first')).toBe(true);
  expect(throttle.allow('second')).toBe(true);
  expect(throttle.allow('third')).toBe(true);
  expect(throttle.size).toBe(2);
});

test('the configured limit allows exactly one minute window worth of attempts', () => {
  let time = 0;
  const throttle = new LoginThrottle({ limit: 3, windowMs: 1000, now: () => time });
  expect([1, 2, 3, 4].map(() => throttle.allow('same-key'))).toEqual([true, true, true, false]);
  time += 1000;
  expect(throttle.allow('same-key')).toBe(true);
});
