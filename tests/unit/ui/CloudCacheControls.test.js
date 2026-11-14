import CloudCacheControls from '../../../src/ui/sessions/CloudCacheControls.js';
import { CloudParticipantCacheError } from '../../../src/campaigns/CloudParticipantCache.js';
import { GameErrors } from '../../../src/utils/error/ErrorHandler.js';

const MiB = 1024 * 1024;

function fixture(options = {}) {
  let identity = { uid: 'cache-player' };
  let onIdentity;
  const usage = {
    bytes: 4 * MiB + 1,
    limitBytes: 256 * MiB,
    assetStorageAvailable: true,
    crossTabCoordinated: true,
    ...options.usage,
  };
  const cache = {
    available: true,
    getUsage: jest.fn(async () => ({ ...usage })),
    protectView: jest.fn(async () => async () => {}),
    setBudget: jest.fn(async (bytes) => {
      usage.limitBytes = bytes;
    }),
    clear: jest.fn(async () => {
      usage.bytes = 0;
    }),
    requestPersistence: jest.fn(async () => ({ status: 'accepted', persistent: true })),
    close: jest.fn(async () => {}),
    ...options.cache,
  };
  const account = {
    identity: () => identity,
    subscribe: (listener) => {
      onIdentity = listener;
      listener(identity);
      return () => {
        onIdentity = null;
      };
    },
  };
  const controls = new CloudCacheControls({
    cache,
    uid: identity.uid,
    account,
    ...options.controls,
  });

  document.body.append(controls.root);
  return {
    controls,
    cache,
    usage,
    changeIdentity: (next) => {
      identity = next;
      onIdentity?.(next);
    },
  };
}

let inputError;
beforeEach(() => {
  inputError = jest.spyOn(GameErrors, 'input').mockImplementation(() => {});
});
afterEach(() => {
  inputError.mockRestore();
  document.body.replaceChildren();
});

test('a budget below protected view bytes is saved without claiming immediate eviction', async () => {
  const setup = fixture({
    usage: { bytes: 1472, protectedBytes: 1472 },
    cache: {
      setBudget: jest.fn(async (bytes) => {
        setup.usage.limitBytes = bytes;
        setup.usage.overBudget = setup.usage.bytes > bytes;
        return { ...setup.usage, evictedEntries: 0, evictedBytes: 0 };
      }),
    },
  });
  try {
    await setup.controls.ready;
    setup.controls.budget.value = '0';
    setup.controls.root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await setup.controls.idle;
    expect(setup.cache.setBudget).toHaveBeenCalledWith(0);
    expect(setup.controls.usageOutput.textContent).toContain('1,472 bytes used of 0 bytes');
    expect(setup.controls.status.textContent).toMatch(/protected/i);
    expect(setup.controls.status.textContent).toMatch(/fully takes effect.*protected views close/i);
    expect(setup.usage.bytes).toBe(1472);
    expect(setup.usage.protectedBytes).toBe(1472);
    expect(inputError).not.toHaveBeenCalled();
  } finally {
    await setup.controls.destroy();
  }
});

test('private-cache settings show exact local usage and save an adjustable account/browser budget without changing cloud quota', async () => {
  const { controls, cache } = fixture();
  try {
    await controls.ready;
    const budget = controls.root.querySelector('[aria-label="Private cache budget in MiB"]');
    const usage = controls.root.querySelector('[aria-label="Private cache usage"]');
    expect(budget.value).toBe('256');
    expect(usage.textContent).toContain('4,194,305 bytes');
    expect(controls.root.textContent).toMatch(/public catalogs.*separate/i);
    budget.value = '128';
    controls.root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await controls.idle;
    expect(cache.setBudget).toHaveBeenCalledWith(128 * MiB);
    expect(usage.textContent).toContain('134,217,728 bytes');
    expect(controls.status.textContent).toMatch(/cloud.*limits.*unchanged/i);
    expect(inputError).not.toHaveBeenCalled();
  } finally {
    await controls.destroy();
  }
});

test('private-cache clear invalidates downloads first, clears only its bound account, and waits for current authority reconnect', async () => {
  const order = [];
  let finishClear;
  let finishReconnect;
  const setup = fixture({
    cache: {
      clear: jest.fn(() => {
        order.push('clear');
        return new Promise((resolve) => {
          finishClear = () => {
            setup.usage.bytes = 0;
            resolve();
          };
        });
      }),
    },
    controls: {
      beforeClear: () => order.push('invalidate'),
      onCleared: () => {
        order.push('reconnect');
        return new Promise((resolve) => {
          finishReconnect = resolve;
        });
      },
    },
  });
  try {
    await setup.controls.ready;
    const button = setup.controls.root.querySelector('[data-cache-clear]');
    button.click();
    expect(order).toEqual(['invalidate', 'clear']);
    expect(setup.cache.clear).toHaveBeenCalledWith();
    expect(button.disabled).toBe(true);
    finishClear();
    for (let step = 0; step < 20 && !finishReconnect; step++) await Promise.resolve();
    expect(order).toEqual(['invalidate', 'clear', 'reconnect']);
    expect(setup.controls.usageOutput.textContent).toContain('0 bytes used');
    expect(button.disabled).toBe(true);
    finishReconnect();
    await setup.controls.idle;
    expect(setup.controls.status.textContent).toMatch(/cleared.*private cache/i);
    expect(setup.controls.status.textContent).toMatch(/cloud authority/i);
    expect(inputError).not.toHaveBeenCalled();
  } finally {
    finishClear?.();
    finishReconnect?.();
    await setup.controls.idle.catch(() => {});
    await setup.controls.destroy();
  }
});

test.each(['accepted', 'denied', 'unavailable'])(
  'browser persistence %s is reported truthfully as best-effort local storage, not cloud durability',
  async (status) => {
    const { controls, cache } = fixture({
      cache: {
        requestPersistence: jest.fn(async () => ({
          status,
          persistent: status === 'accepted',
        })),
      },
    });
    try {
      await controls.ready;
      controls.root.querySelector('[data-cache-persistence]').click();
      await controls.idle;
      expect(cache.requestPersistence).toHaveBeenCalledTimes(1);
      expect(controls.status.textContent).toContain(status);
      expect(controls.status.textContent).toMatch(/cloud authority/i);
      expect(controls.status.textContent).toMatch(/replaceable|evicted/i);
      expect(inputError).not.toHaveBeenCalled();
    } finally {
      await controls.destroy();
    }
  }
);

test('explicit cache budget and resolved persistence failures remain failed and use repository GameErrors', async () => {
  const failure = new CloudParticipantCacheError(
    'cache-unavailable',
    'The private browser storage operation failed.'
  );
  const { controls, cache, usage } = fixture({
    cache: {
      setBudget: jest.fn(async () => {
        throw failure;
      }),
      requestPersistence: jest.fn(async () => ({
        status: 'failed',
        persistent: false,
        error: failure,
      })),
    },
  });
  try {
    await controls.ready;
    controls.budget.value = '128';
    controls.root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await expect(controls.idle).rejects.toBe(failure);
    expect(usage.limitBytes).toBe(256 * MiB);
    expect(controls.status.textContent).toMatch(/private.*cache.*failed/i);
    expect(controls.status.textContent).toMatch(/cloud authority.*unchanged/i);
    controls.root.querySelector('[data-cache-persistence]').click();
    await expect(controls.idle).rejects.toBe(failure);
    expect(controls.status.textContent).toMatch(/browser persistence failed/i);
    expect(inputError).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({ component: 'CloudCacheControls', operation: 'persistence' })
    );
    expect(cache.clear).not.toHaveBeenCalled();
  } finally {
    await controls.destroy();
  }
});

test('an account replacement hides old usage and cannot clear or adjust another UID cache', async () => {
  const invalidate = jest.fn();
  const { controls, cache, changeIdentity } = fixture({
    controls: { beforeClear: invalidate },
  });
  try {
    await controls.ready;
    changeIdentity({ uid: 'another-account' });
    expect(controls.usageOutput.textContent).toBe('');
    expect(controls.root.querySelector('[data-cache-clear]').disabled).toBe(true);
    await expect(controls.clear()).rejects.toMatchObject({ code: 'cache-unavailable' });
    expect(invalidate).not.toHaveBeenCalled();
    expect(cache.clear).not.toHaveBeenCalled();
    expect(cache.setBudget).not.toHaveBeenCalled();
    expect(cache.getUsage).toHaveBeenCalledTimes(1);
  } finally {
    await controls.destroy();
  }
});

test('cache settings distinguish detected capabilities from unavailable coordination, artwork storage and recovered cache warnings', async () => {
  const { controls } = fixture({
    cache: {
      getUsage: jest.fn(async () => ({
        bytes: 0,
        limitBytes: 256 * MiB,
        assetStorageAvailable: false,
        crossTabCoordinated: false,
      })),
    },
  });
  try {
    await controls.ready;
    const notice = controls.root.querySelector('[aria-label="Private cache availability"]');
    expect(notice).not.toBeNull();
    expect(notice.textContent).toMatch(/cross-tab.*unavailable/i);
    expect(notice.textContent).toMatch(/artwork.*unavailable/i);
    controls.updateStatus({
      cache: {
        phase: 'warning',
        code: 'cache-unavailable',
        message: 'Private artwork cache write failed; verified online artwork remains current.',
      },
    });
    expect(notice.textContent).toContain('Private artwork cache write failed');
    expect(inputError).toHaveBeenCalledWith(
      expect.any(CloudParticipantCacheError),
      expect.objectContaining({ operation: 'cacheRecovery' })
    );
  } finally {
    await controls.destroy();
  }
});
