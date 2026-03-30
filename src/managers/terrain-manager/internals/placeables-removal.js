export function removeItem(m, x, y, id = null) {
  const tileKey = `${x},${y}`;
  if (!m.placeables || !m.placeables.has(tileKey)) return false;
  const list = m.placeables.get(tileKey);
  let removed = false;
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    if (!id || p.placeableId === id) {
      try {
        // Only attempt removal if object looks like a sprite
        if (p && p.parent && typeof p.parent.removeChild === 'function') {
          p.parent.removeChild(p);
        }
      } catch (_) {
        /* best-effort */
      }
      // Remove any attached 3D model (full replacement mode)
      try {
        if (p.__threeModel) {
          const tm = p.__threeModel;
          try {
            tm.parent?.remove(tm);
          } catch (_) {
            /* ignore */
          }
          // dispose resources
          try {
            tm.traverse?.((n) => {
              if (n.isMesh) {
                try {
                  n.geometry?.dispose?.();
                } catch (_) {
                  /* ignore */
                }
                if (n.material) {
                  const mats = Array.isArray(n.material) ? n.material : [n.material];
                  for (const mtl of mats) {
                    try {
                      mtl.map?.dispose?.();
                    } catch (_) {
                      /* ignore */
                    }
                    try {
                      mtl.alphaMap?.dispose?.();
                    } catch (_) {
                      /* ignore */
                    }
                    try {
                      mtl.dispose?.();
                    } catch (_) {
                      /* ignore */
                    }
                  }
                }
              }
            });
          } catch (_) {
            /* ignore */
          }
          delete p.__threeModel;
        }
      } catch (_) {
        /* ignore */
      }
      // Phase 4: if instanced, remove from mesh pool
      try {
        const gm = m.gameManager;
        if (gm?.features?.instancedPlaceables && p.__instancedRef) {
          gm.placeableMeshPool?.removePlaceable(p.__instancedRef);
          delete p.__instancedRef;
        }
      } catch (_) {
        /* ignore */
      }
      list.splice(i, 1);
      removed = true;
    }
  }
  if (list.length === 0) m.placeables.delete(tileKey);
  return removed;
}
