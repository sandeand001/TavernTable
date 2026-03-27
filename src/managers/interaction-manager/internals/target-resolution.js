export async function resolvePointerTarget(mgr, event) {
  const gm = mgr.gameManager;
  let gridX = null;
  let gridY = null;
  let token = null;

  const threeTarget = pick3DTarget(mgr, event);
  if (threeTarget) {
    token = threeTarget.token || token;
    if (Number.isFinite(threeTarget.gridX)) {
      gridX = threeTarget.gridX;
    }
    if (Number.isFinite(threeTarget.gridY)) {
      gridY = threeTarget.gridY;
    }
  }

  const spriteToken = pickTokenBySprite(mgr, event);
  if (spriteToken) {
    if (!token) {
      token = spriteToken;
    }
    if (!Number.isFinite(gridX) && Number.isFinite(spriteToken.gridX)) {
      gridX = spriteToken.gridX;
    }
    if (!Number.isFinite(gridY) && Number.isFinite(spriteToken.gridY)) {
      gridY = spriteToken.gridY;
    }
  }

  const canUse3D =
    typeof gm?.is3DModeActive === 'function' &&
    gm.is3DModeActive() &&
    gm.pickingService &&
    typeof gm.pickingService.pickGround === 'function';

  let groundPick = null;
  if (canUse3D) {
    try {
      groundPick = await gm.pickingService.pickGround(event.clientX, event.clientY);
    } catch (_) {
      groundPick = null;
    }

    if (groundPick?.token && !token) {
      token = groundPick.token;
    }

    if (groundPick?.grid) {
      const gx = Math.round(groundPick.grid.gx);
      const gy = Math.round(groundPick.grid.gy);
      if (Number.isFinite(gx) && Number.isFinite(gy)) {
        gridX = gx;
        gridY = gy;
      }
    }
  }

  if ((!Number.isFinite(gridX) || !Number.isFinite(gridY)) && token) {
    if (Number.isFinite(token.gridX)) {
      gridX = token.gridX;
    }
    if (Number.isFinite(token.gridY)) {
      gridY = token.gridY;
    }
  }

  if (!Number.isFinite(gridX) || !Number.isFinite(gridY)) {
    const gridCoords = mgr.getGridCoordinatesFromClick(event);
    if (gridCoords) {
      gridX = gridCoords.gridX;
      gridY = gridCoords.gridY;
    }
  }

  if (!token && Number.isFinite(gridX) && Number.isFinite(gridY)) {
    try {
      token = gm?.tokenManager?.findExistingTokenAt?.(gridX, gridY) || null;
    } catch (_) {
      token = null;
    }
  }

  return {
    gridX: Number.isFinite(gridX) ? gridX : null,
    gridY: Number.isFinite(gridY) ? gridY : null,
    token,
  };
}

export function tryCaptureRadialTrigger(mgr, event) {
  try {
    const capture = pick3DTarget(mgr, event) || pickSpriteTarget(mgr, event);
    if (!capture || !capture.token) {
      mgr._pendingRadialContext = null;
      return false;
    }
    mgr._pendingRadialContext = {
      token: capture.token,
      gridX: Number.isFinite(capture.gridX) ? capture.gridX : null,
      gridY: Number.isFinite(capture.gridY) ? capture.gridY : null,
      originX: event.clientX,
      originY: event.clientY,
      lastScreenX: capture.screenPosition?.x ?? event.clientX,
      lastScreenY: capture.screenPosition?.y ?? event.clientY,
      screenPosition: capture.screenPosition || { x: event.clientX, y: event.clientY },
      initialEvent: event,
    };
    event.preventDefault();
    event.stopPropagation();
    return true;
  } catch (_) {
    mgr._pendingRadialContext = null;
    return false;
  }
}

export function dispatchRadialMenuRequest(mgr, context) {
  if (typeof window === 'undefined' || !context?.token) {
    return;
  }
  try {
    const computedScreen =
      get3DTokenScreenPosition(mgr, context.token) ||
      context.screenPosition ||
      (context.lastScreenX && context.lastScreenY
        ? { x: context.lastScreenX, y: context.lastScreenY }
        : null);

    window.dispatchEvent(
      new CustomEvent('taverntable:tokenRadial', {
        detail: {
          token: context.token,
          tokenId: context.token?.id || null,
          gridX:
            Number.isFinite(context.gridX) || Number.isFinite(context.token?.gridX)
              ? (context.gridX ?? context.token?.gridX ?? null)
              : null,
          gridY:
            Number.isFinite(context.gridY) || Number.isFinite(context.token?.gridY)
              ? (context.gridY ?? context.token?.gridY ?? null)
              : null,
          screenX: computedScreen?.x ?? context.lastScreenX ?? context.originX,
          screenY: computedScreen?.y ?? context.lastScreenY ?? context.originY,
          screenPosition: computedScreen || {
            x: context.lastScreenX ?? context.originX,
            y: context.lastScreenY ?? context.originY,
          },
        },
      })
    );
  } catch (_) {
    /* ignore dispatch errors */
  }
}

export function pick3DTarget(mgr, event) {
  try {
    const gm = mgr.gameManager;
    if (!gm?.is3DModeActive?.()) {
      return null;
    }
    const picking = gm.pickingService;
    if (!picking || typeof picking.pickGroundSync !== 'function') {
      return null;
    }
    const targetElement = gm.threeSceneManager?.renderer?.domElement || gm.app?.view;
    const ground = picking.pickGroundSync(event.clientX, event.clientY, targetElement);
    if (!ground) {
      return null;
    }
    let gridX = Number.isFinite(ground?.grid?.gx) ? Math.round(ground.grid.gx) : null;
    let gridY = Number.isFinite(ground?.grid?.gy) ? Math.round(ground.grid.gy) : null;
    let token = ground.token || null;
    if (!token && gridX != null && gridY != null) {
      token = gm.tokenManager?.findExistingTokenAt?.(gridX, gridY) || null;
    }
    if (!token) {
      return null;
    }
    if (!Number.isFinite(gridX) && Number.isFinite(token.gridX)) {
      gridX = token.gridX;
    }
    if (!Number.isFinite(gridY) && Number.isFinite(token.gridY)) {
      gridY = token.gridY;
    }
    const screenPosition = get3DTokenScreenPosition(mgr, token) || {
      x: event.clientX,
      y: event.clientY,
    };
    return { token, gridX, gridY, screenPosition };
  } catch (_) {
    return null;
  }
}

export function pickSpriteTarget(mgr, event) {
  try {
    const gm = mgr.gameManager;
    if (!gm) {
      return null;
    }
    const gridCoords = mgr.getGridCoordinatesFromClick(event);
    if (!gridCoords) {
      return null;
    }
    const gridX = Number.isFinite(gridCoords.gridX) ? gridCoords.gridX : null;
    const gridY = Number.isFinite(gridCoords.gridY) ? gridCoords.gridY : null;
    if (gridX == null || gridY == null) {
      return null;
    }
    const token =
      (typeof gm.findExistingTokenAt === 'function'
        ? gm.findExistingTokenAt(gridX, gridY)
        : null) ||
      gm.tokenManager?.findExistingTokenAt?.(gridX, gridY) ||
      null;
    if (!token) {
      return null;
    }
    return {
      token,
      gridX,
      gridY,
      screenPosition: { x: event.clientX, y: event.clientY },
    };
  } catch (_) {
    return null;
  }
}

export function pickTokenBySprite(mgr, event) {
  try {
    const gm = mgr.gameManager;
    const tokens = gm?.placedTokens;
    if (!tokens || !tokens.length) {
      return null;
    }

    const renderer = gm?.app?.renderer;
    const interaction = renderer?.plugins?.interaction;
    if (!interaction || typeof interaction.mapPositionToPoint !== 'function') {
      return null;
    }

    const point = mgr._pointerScratch;
    point.x = 0;
    point.y = 0;
    interaction.mapPositionToPoint(point, event.clientX, event.clientY);

    const spriteMap = new WeakMap();
    const register = (displayObject, tokenEntry) => {
      if (!displayObject) return;
      spriteMap.set(displayObject, tokenEntry);
      const children = displayObject.children;
      if (Array.isArray(children)) {
        for (const child of children) {
          register(child, tokenEntry);
        }
      }
    };

    for (const token of tokens) {
      const sprite = token?.creature?.sprite;
      if (sprite) {
        register(sprite, token);
      }
    }

    const stage = gm?.app?.stage;
    if (stage && typeof interaction.hitTest === 'function') {
      const hit = interaction.hitTest(point, stage, event);
      let current = hit;
      while (current) {
        const tokenEntry = spriteMap.get(current) || current.tokenData || null;
        if (tokenEntry) {
          return tokenEntry;
        }
        current = current.parent;
      }
    }

    let bestToken = null;
    let bestScore = -Infinity;

    for (const tokenEntry of tokens) {
      const sprite = tokenEntry?.creature?.sprite;
      if (!sprite || !sprite.parent || !sprite.visible) {
        continue;
      }
      if (sprite.worldAlpha <= 0 || sprite.renderable === false) {
        continue;
      }
      if (typeof sprite.getBounds !== 'function') {
        continue;
      }

      let bounds;
      try {
        bounds = sprite.getBounds(false);
      } catch (_) {
        bounds = null;
      }
      if (!bounds || !bounds.contains(point.x, point.y)) {
        continue;
      }

      const score = Number.isFinite(sprite.zIndex)
        ? sprite.zIndex
        : Number.isFinite(sprite.y)
          ? sprite.y
          : 0;
      if (bestToken == null || score >= bestScore) {
        bestToken = tokenEntry;
        bestScore = score;
      }
    }

    return bestToken;
  } catch (_) {
    return null;
  }
}

export function get3DTokenScreenPosition(mgr, tokenEntry) {
  try {
    const gm = mgr.gameManager;
    const threeMgr = gm?.threeSceneManager;
    const mesh = tokenEntry?.__threeMesh;
    if (!mesh || !threeMgr?.camera || !threeMgr?.renderer || !threeMgr?.three) {
      return null;
    }
    mgr._radialProjectVector = mgr._radialProjectVector || new threeMgr.three.Vector3();
    const vector = mgr._radialProjectVector;
    mesh.getWorldPosition(vector);
    vector.project(threeMgr.camera);
    const dom = threeMgr.renderer.domElement;
    if (!dom) {
      return null;
    }
    const rect = dom.getBoundingClientRect();
    return {
      x: rect.left + ((vector.x + 1) / 2) * rect.width,
      y: rect.top + ((-vector.y + 1) / 2) * rect.height,
    };
  } catch (_) {
    return null;
  }
}
