import GameManager from '../../../src/core/GameManager.js';
import { enableHybridRender } from '../../../src/core/game-manager/internals/init.js';

jest.mock('../../../src/core/game-manager/internals/init.js', () => ({
  enableHybridRender: jest.fn(),
}));

test('concurrent scene readiness requests await the same complete initialization', async () => {
  let finish;
  const ready = new Promise((resolve) => {
    finish = resolve;
  });
  enableHybridRender.mockReturnValue(ready);
  const manager = new GameManager();
  const first = manager.enableHybridRender();
  let restored = false;
  const second = manager.enableHybridRender().then(() => {
    restored = true;
  });
  expect(enableHybridRender).toHaveBeenCalledTimes(1);
  await Promise.resolve();
  expect(restored).toBe(false);
  finish('ready');
  await expect(first).resolves.toBe('ready');
  await second;
  expect(restored).toBe(true);
});
