export class FootprintIndex {
  constructor(values) {
    this.buckets = new Map();
    this.minX = Infinity;
    this.minZ = Infinity;
    this.maxX = -Infinity;
    this.maxZ = -Infinity;
    for (const value of values) {
      const { min, max } = value.bounds ?? value;
      const minX = Math.floor(min.x / 5),
        maxX = Math.floor(max.x / 5);
      const minZ = Math.floor(min.z / 5),
        maxZ = Math.floor(max.z / 5);
      this.minX = Math.min(this.minX, minX);
      this.minZ = Math.min(this.minZ, minZ);
      this.maxX = Math.max(this.maxX, maxX);
      this.maxZ = Math.max(this.maxZ, maxZ);
      for (let x = minX; x <= maxX; x++)
        for (let z = minZ; z <= maxZ; z++) {
          const key = `${x},${z}`;
          if (!this.buckets.has(key)) this.buckets.set(key, []);
          this.buckets.get(key).push(value);
        }
    }
  }

  atPoint(x, z) {
    return this.buckets.get(`${Math.floor(x / 5)},${Math.floor(z / 5)}`) || [];
  }

  inBounds(bounds) {
    const nearby = new Set();
    const minX = Math.max(this.minX, Math.floor(bounds.min.x / 5));
    const minZ = Math.max(this.minZ, Math.floor(bounds.min.z / 5));
    const maxX = Math.min(this.maxX, Math.floor(bounds.max.x / 5));
    const maxZ = Math.min(this.maxZ, Math.floor(bounds.max.z / 5));
    for (let x = minX; x <= maxX; x++)
      for (let z = minZ; z <= maxZ; z++)
        for (const value of this.buckets.get(`${x},${z}`) || []) nearby.add(value);
    return [...nearby];
  }
}
