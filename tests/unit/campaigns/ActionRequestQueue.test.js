import ActionRequestQueue from '../../../src/campaigns/ActionRequestQueue.js';

const settle = async () => {
  for (let count = 0; count < 12; count++) await Promise.resolve();
};

test('a busy actor queues its commands without blocking a different free-play actor', async () => {
  const busy = new Set(['a']);
  const queue = new ActionRequestQueue({ isReady: (actor) => !busy.has(actor) });
  const executed = [];
  const first = queue.enqueue('a', () => executed.push('a1'));
  const second = queue.enqueue('a', () => executed.push('a2'));
  const other = queue.enqueue('b', () => executed.push('b'));
  await other;
  expect(executed).toEqual(['b']);
  busy.delete('a');
  queue.flush();
  await Promise.all([first, second]);
  expect(executed).toEqual(['b', 'a1', 'a2']);
  queue.dispose();
});

test('queued commands revalidate resources at execution rather than spending or reserving early', async () => {
  let ready = false;
  let resources = 1;
  const queue = new ActionRequestQueue({ isReady: () => ready });
  const spend = () => {
    if (resources < 1) throw new Error('Resource unavailable');
    resources--;
  };
  const first = queue.enqueue('a', spend);
  const second = queue.enqueue('a', spend);
  const rejected = expect(second).rejects.toThrow('Resource unavailable');
  await settle();
  expect(resources).toBe(1);
  ready = true;
  queue.flush();
  await first;
  await rejected;
  expect(resources).toBe(0);
  queue.dispose();
});

test('disposing the queue cancels waiting requests instead of running them in another scene', async () => {
  const queue = new ActionRequestQueue({ isReady: () => false });
  const execute = jest.fn();
  const pending = queue.enqueue('a', execute);
  const cancelled = expect(pending).rejects.toThrow('cancelled');
  queue.dispose();
  await cancelled;
  expect(execute).not.toHaveBeenCalled();
});
