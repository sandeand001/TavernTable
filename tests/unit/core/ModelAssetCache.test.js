import ModelAssetCache from '../../../src/core/ModelAssetCache.js';

test('a rejected in-flight model load is retired so the next request retries', async () => {
  const cache = new ModelAssetCache();
  cache._three = {};
  cache._registry.retry = { path: 'retry.obj', format: 'OBJ' };
  let reject;
  const pending = new Promise((_resolve, fail) => {
    reject = fail;
  });
  const root = { clone: jest.fn(() => ({ id: 'retry-copy' })) };
  cache._loadOBJ = jest.fn().mockReturnValueOnce(pending).mockResolvedValueOnce(root);

  const first = cache.getModel('retry');
  const concurrent = cache.getModel('retry');
  expect(cache._loadOBJ).toHaveBeenCalledTimes(1);
  const failure = new Error('transient load failure');
  reject(failure);
  expect((await Promise.allSettled([first, concurrent])).map(({ status }) => status)).toEqual([
    'rejected',
    'rejected',
  ]);
  expect(cache._loading.has('retry')).toBe(false);

  await expect(cache.getModel('retry')).resolves.toEqual({ id: 'retry-copy' });
  expect(cache._loadOBJ).toHaveBeenCalledTimes(2);
  expect(root.clone).toHaveBeenCalledWith(true);
});
