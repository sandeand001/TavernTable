import * as three from 'three';
import { diceState } from '../../../../src/systems/dice/DiceState.js';
import { scheduleRollAnimation } from '../../../../src/systems/dice/DiceAnimationScheduler.js';
import { loadD20Model } from '../../../helpers/d20-model.js';

const model = loadD20Model();
const metrics = { cols: 25, rows: 25, tileSize: 1, centerX: 12.5, centerZ: 12.5 };

async function replay({
  seed = 8,
  fps = 60,
  randomValues = null,
  boardSize = 25,
  cancelAtFrame = null,
  useManagerRemoval = false,
} = {}) {
  const mesh = model.clone(true);
  mesh.scale.setScalar(3.6);
  let rng = seed >>> 0;
  let randomIndex = 0;
  const random = jest.spyOn(Math, 'random').mockImplementation(() => {
    if (randomValues && randomIndex < randomValues.length) return randomValues[randomIndex++];
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    return rng / 4294967296;
  });
  let callback;
  let settled = null;
  let error = null;
  let cancelled = null;
  let cocked = null;
  let cancellationCount = 0;
  const remove = jest.fn();
  const manager = {
    gameManager: {
      cols: boardSize,
      rows: boardSize,
      placedTokens: [],
      getTerrainHeight: () => 0,
      spatial: {
        tileWorldSize: 1,
        elevationUnit: 0.3,
        worldToGrid: (x, z) => ({ gridX: Math.floor(x), gridY: Math.floor(z) }),
      },
    },
    addAnimationCallback: (fn) => {
      callback = fn;
      return useManagerRemoval ? undefined : remove;
    },
    removeAnimationCallback: remove,
  };
  diceState.threeNamespace = three;
  let animation;
  const samples = [];
  try {
    animation = await scheduleRollAnimation(
      manager,
      mesh,
      { ...metrics, cols: boardSize, rows: boardSize },
      {
        onSettle: (payload) => {
          settled = payload;
        },
        onError: (failure) => {
          error = failure;
        },
        onCancel: (payload) => {
          cancelled = payload;
          cancellationCount += 1;
        },
        onCocked: (payload) => {
          cocked = payload;
        },
      }
    );
    for (let frame = 0; frame <= fps * 8; frame += 1) {
      if (frame === cancelAtFrame) animation.stopAnimation();
      callback((frame * 1000) / fps);
      samples.push({
        time: frame / fps,
        position: mesh.position.clone(),
        quaternion: mesh.quaternion.clone(),
      });
      if (settled || error || cancelled || cocked) break;
    }
    return {
      settled,
      error,
      cancelled,
      cocked,
      cancellationCount,
      samples,
      remove,
      scale: mesh.scale.x,
    };
  } finally {
    animation?.dispose();
    random.mockRestore();
  }
}

describe('Large d20 rolling', () => {
  test('cancellation removes the scene callback and never publishes a number', async () => {
    const result = await replay({ cancelAtFrame: 15, useManagerRemoval: true });

    expect(result.settled).toBeNull();
    expect(result.error).toBeNull();
    expect(result.cancelled).not.toBeNull();
    expect(result.cancellationCount).toBe(1);
    expect(result.remove).toHaveBeenCalledTimes(1);
    expect(result.remove).toHaveBeenCalledWith(expect.any(Function));
  });

  test('fits the large die inside the minimum supported board', async () => {
    const result = await replay({ seed: 42, boardSize: 5 });

    expect(result.error).toBeNull();
    expect(result.settled).not.toBeNull();
    expect(result.scale).toBeLessThan(3.6);
  });

  test('keeps cross-board throws bounded instead of extending arbitrary paths', async () => {
    const result = await replay({
      randomValues: [0.8 / 24.2, 0.5, 0.1, 0.1, 0, 0, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9],
    });

    expect(result.error).toBeNull();
    expect(result.settled).not.toBeNull();
    expect(result.samples.at(-1).time).toBeLessThan(6);
    expect(result.settled.faceInfo.value).toBeGreaterThanOrEqual(1);
    expect(result.settled.faceInfo.value).toBeLessThanOrEqual(20);
  });

  test('uses the same physical resting face and pose at 30 and 120 FPS', async () => {
    const low = await replay({ seed: 2, fps: 30 });
    const high = await replay({ seed: 2, fps: 120 });

    expect(low.error).toBeNull();
    expect(high.error).toBeNull();
    expect(low.settled?.faceInfo?.value).toBe(high.settled?.faceInfo?.value);
    expect(low.settled?.faceInfo?.value).toBeGreaterThanOrEqual(1);
    expect(low.samples.at(-1).quaternion.angleTo(high.samples.at(-1).quaternion)).toBeLessThan(
      1e-5
    );
    expect(low.samples.at(-1).position.distanceTo(high.samples.at(-1).position)).toBeLessThan(1e-5);
  });

  test('tumbles without large angular jumps or a cosmetic final pose snap', async () => {
    const result = await replay({ seed: 1 });
    expect(result.settled).not.toBeNull();
    let largestStep = 0;
    for (let i = 1; i < result.samples.length; i += 1) {
      largestStep = Math.max(
        largestStep,
        result.samples[i - 1].quaternion.angleTo(result.samples[i].quaternion)
      );
    }
    expect(largestStep).toBeLessThan(0.4);
    const last = result.samples.at(-1);
    const previous = result.samples.at(-2);
    expect(last.quaternion.angleTo(previous.quaternion)).toBeLessThan(0.02);
    expect(result.remove).toHaveBeenCalledTimes(1);
  });
});
