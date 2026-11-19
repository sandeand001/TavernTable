export function createLayeredExamples({ widthFeet, depthFeet }) {
  if (widthFeet < 125 || depthFeet < 125) {
    throw new Error(
      'The proof structures require a board at least 125 by 125 feet (25 by 25 squares)'
    );
  }
  const volumes = [];
  const box = (id, layerId, x0, y0, z0, x1, y1, z1, operation = 'add') =>
    volumes.push({
      id: `proof-${id}`,
      layerId,
      operation,
      bounds: { min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } },
    });
  box('bridge', 'bridge', 40, 8, 15, 65, 9, 25);
  for (let i = 0; i < 6; i++) {
    box(`bridge-stair-${i}`, 'bridge', 10 + i * 5, 0, 15, 15 + i * 5, (i + 1) * 1.5, 20);
  }
  box('cave-hill', 'roof', 10, 0, 55, 55, 20, 105);
  box('cave-chamber', 'cave', 15, 0, 60, 50, 10, 95, 'subtract');
  box('cave-entry', 'cave', 25, 0, 50, 35, 10, 65, 'subtract');
  box('upper-floor', 'upper', 75, 9.5, 30, 120, 10, 85);
  box('building-roof', 'roof', 75, 19.5, 30, 120, 20, 85);
  for (const [layerId, low, high] of [
    ['ground', 0, 9.5],
    ['upper', 10, 19.5],
  ]) {
    box(`${layerId}-wall-north`, layerId, 75, low, 30, 120, high, 31);
    box(`${layerId}-wall-south`, layerId, 75, low, 84, 120, high, 85);
    box(`${layerId}-wall-west`, layerId, 75, low, 31, 76, high, 84);
    box(`${layerId}-wall-east`, layerId, 119, low, 31, 120, high, 84);
  }
  box('entry-door', 'ground', 95, 0, 29, 100, 8, 32, 'subtract');
  box('balcony-door', 'upper', 95, 10, 83, 100, 18, 86, 'subtract');
  box('stairwell', 'ground', 80, 0, 35, 85, 11, 75, 'subtract');
  for (let i = 0; i < 8; i++) {
    box(`building-stair-${i}`, 'ground', 80, 0, 35 + i * 5, 85, (i + 1) * 1.25, 40 + i * 5);
  }
  box('balcony', 'upper', 90, 9.5, 85, 105, 10, 95);
  box('open-shaft', 'ground', 105, 0, 60, 110, 21, 65, 'subtract');
  return volumes;
}
