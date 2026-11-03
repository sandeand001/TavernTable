// Shared terrain materials and constructed-surface colors.

export function getTerrainLayerColor(layerId) {
  return (
    {
      bridge: 0x9c744b,
      cave: 0x858e91,
      ground: 0x808179,
      upper: 0xb9a98a,
      roof: 0x784c43,
    }[layerId] ?? 0x99938c
  );
}

export function createTerrainMaterial(three, { color = 0x777766 } = {}) {
  try {
    return new three.MeshStandardMaterial({ color, flatShading: false });
  } catch (_) {
    // Fallback stub for non-WebGL test environments.
    return { isMaterial: true, color };
  }
}
