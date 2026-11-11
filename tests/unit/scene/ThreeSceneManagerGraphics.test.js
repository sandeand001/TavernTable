import { ThreeSceneManager } from '../../../src/scene/ThreeSceneManager.js';
import {
  errorHandler,
  ERROR_CATEGORY,
  ERROR_SEVERITY,
} from '../../../src/utils/error/ErrorHandler.js';
import { logger } from '../../../src/utils/logger/Logger.js';

function graphicsContext(renderer, exposeAdapter = true) {
  const debug = { UNMASKED_RENDERER_WEBGL: 1, UNMASKED_VENDOR_WEBGL: 2 };
  const loseContext = jest.fn();
  return {
    RENDERER: 3,
    VENDOR: 4,
    getContextAttributes: () => ({ powerPreference: 'high-performance' }),
    getParameter: jest.fn((parameter) =>
      parameter === debug.UNMASKED_RENDERER_WEBGL
        ? renderer
        : parameter === debug.UNMASKED_VENDOR_WEBGL
          ? 'GPU vendor'
          : 'WebKit WebGL'
    ),
    getExtension: jest.fn((extension) =>
      extension === 'WEBGL_debug_renderer_info'
        ? exposeAdapter
          ? debug
          : null
        : extension === 'WEBGL_lose_context'
          ? { loseContext }
          : null
    ),
    loseContext,
  };
}

describe('GPU-first renderer creation', () => {
  let manager;
  let context;
  let three;
  let warning;
  let log;
  let status;

  beforeEach(() => {
    manager = new ThreeSceneManager({});
    manager.canvas = document.createElement('canvas');
    context = jest.spyOn(manager.canvas, 'getContext');
    three = {
      WebGLRenderer: jest.fn().mockImplementation((options) => ({
        domElement: options.canvas,
        getContext: () => options.context,
        dispose: jest.fn(),
      })),
    };
    warning = jest.spyOn(errorHandler, 'handle').mockReturnValue('graphics-warning');
    log = jest.spyOn(logger, 'log').mockImplementation(() => {});
    status = document.createElement('output');
    status.id = 'graphics-status';
    document.body.appendChild(status);
  });

  afterEach(() => {
    manager.dispose();
    status.remove();
    context.mockRestore();
    warning.mockRestore();
    log.mockRestore();
  });

  test('requests high-performance hardware before allowing a software context', () => {
    const gl = graphicsContext('ANGLE (NVIDIA, NVIDIA GeForce RTX 5070, D3D11)');
    context.mockReturnValue(gl);

    const renderer = manager._createRenderer(three);

    expect(context).toHaveBeenCalledTimes(1);
    expect(context).toHaveBeenCalledWith('webgl2', {
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: true,
    });
    expect(three.WebGLRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        canvas: manager.canvas,
        context: gl,
        powerPreference: 'high-performance',
      })
    );
    expect(renderer.domElement).toBe(manager.canvas);
    expect(manager.getRenderStats().graphics).toEqual(
      expect.objectContaining({
        mode: 'hardware',
        renderer: expect.stringContaining('RTX 5070'),
        fallbackUsed: false,
      })
    );
    expect(status.textContent).toContain('GPU');
    expect(status.textContent).toContain('RTX 5070');
    expect(warning).not.toHaveBeenCalled();
  });

  test('keeps the same input canvas and explicitly warns when software fallback is needed', () => {
    const canvas = manager.canvas;
    const gl = graphicsContext('ANGLE (Microsoft, Microsoft Basic Render Driver, D3D11)');
    context.mockReturnValueOnce(null).mockReturnValueOnce(gl);

    manager._createRenderer(three);

    expect(context.mock.calls.map(([, attributes]) => attributes)).toEqual([
      expect.objectContaining({
        powerPreference: 'high-performance',
        failIfMajorPerformanceCaveat: true,
      }),
      expect.objectContaining({
        powerPreference: 'high-performance',
        failIfMajorPerformanceCaveat: false,
      }),
    ]);
    expect(manager.canvas).toBe(canvas);
    expect(manager.getRenderStats().graphics).toEqual(
      expect.objectContaining({ mode: 'software', fallbackUsed: true })
    );
    expect(status.textContent).toContain('Software fallback');
    expect(warning).toHaveBeenCalledWith(
      expect.any(Error),
      ERROR_SEVERITY.WARNING,
      ERROR_CATEGORY.RENDERING,
      expect.objectContaining({
        renderer: expect.stringContaining('Microsoft Basic Render Driver'),
        suggestion: expect.stringContaining('hardware acceleration'),
      })
    );
  });

  test.each(['SwiftShader', 'llvmpipe', 'softpipe', 'WARP'])(
    'does not mistake %s for hardware when a host ignores the strict request',
    (renderer) => {
      context.mockReturnValue(graphicsContext(renderer));

      manager._createRenderer(three);

      expect(manager.getRenderStats().graphics).toEqual(
        expect.objectContaining({ mode: 'software', fallbackUsed: true })
      );
      expect(warning).toHaveBeenCalledTimes(1);
    }
  );

  test('reports hardware if the relaxed context still uses a physical GPU', () => {
    context
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(graphicsContext('ANGLE (AMD, AMD Radeon Graphics, D3D11)'));

    manager._createRenderer(three);

    expect(manager.getRenderStats().graphics).toEqual(
      expect.objectContaining({ mode: 'hardware', fallbackUsed: true })
    );
    expect(warning).not.toHaveBeenCalled();
  });

  test('does not claim a verified GPU when the browser hides adapter information', () => {
    context.mockReturnValue(graphicsContext('hidden', false));

    manager._createRenderer(three);

    expect(manager.getRenderStats().graphics.mode).toBe('unverified');
    expect(status.textContent).toContain('unverified');
    expect(warning).not.toHaveBeenCalled();
  });

  test('rejects missing WebGL 2 instead of returning a success-shaped renderer', () => {
    context.mockReturnValue(null);

    expect(() => manager._createRenderer(three)).toThrow('WebGL 2');
    expect(three.WebGLRenderer).not.toHaveBeenCalled();
  });

  test('releases an acquired context and propagates renderer initialization errors', () => {
    const gl = graphicsContext('NVIDIA GeForce RTX 5070');
    const failure = new Error('Renderer initialization failed');
    context.mockReturnValue(gl);
    three.WebGLRenderer.mockImplementation(() => {
      throw failure;
    });

    expect(() => manager._createRenderer(three)).toThrow(failure);
    expect(gl.loseContext).toHaveBeenCalledTimes(1);
    expect(context).toHaveBeenCalledTimes(1);
    expect(warning).not.toHaveBeenCalled();
  });

  test('reports context loss and rechecks the actual adapter after restoration', () => {
    const gl = graphicsContext('NVIDIA GeForce RTX 5070');
    context.mockReturnValue(gl);
    manager.renderer = manager._createRenderer(three);
    const canvas = manager.canvas;

    canvas.dispatchEvent(new Event('webglcontextlost'));
    expect(manager.getRenderStats().graphics.mode).toBe('unavailable');
    expect(manager.canvas).toBe(canvas);

    gl.getParameter.mockImplementation((parameter) =>
      parameter === 1 ? 'Microsoft Basic Render Driver' : 'GPU vendor'
    );
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(manager.getRenderStats().graphics.mode).toBe('software');
    expect(status.textContent).toContain('Software fallback');
    expect(warning).toHaveBeenCalled();
  });

  test('clears adapter status and context listeners when the renderer is disposed', () => {
    context.mockReturnValue(graphicsContext('NVIDIA GeForce RTX 5070'));
    manager.renderer = manager._createRenderer(three);
    const canvas = manager.canvas;
    manager.dispose();

    expect(manager.getRenderStats().graphics.mode).toBe('not-initialized');
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(manager.getRenderStats().graphics.mode).toBe('not-initialized');
  });
});
