class LoginThrottle {
  constructor({ limit = 30, windowMs = 60000, maxEntries = 10000, now = Date.now } = {}) {
    if (
      !Number.isInteger(limit) ||
      limit <= 0 ||
      !Number.isFinite(windowMs) ||
      windowMs <= 0 ||
      !Number.isInteger(maxEntries) ||
      maxEntries <= 0 ||
      typeof now !== 'function'
    )
      throw new TypeError('Sign-in throttling requires positive limits and a clock');
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxEntries = maxEntries;
    this.now = now;
    this.entries = new Map();
  }

  get size() {
    return this.entries.size;
  }

  allow(key) {
    if (typeof key !== 'string' || !key) throw new TypeError('Sign-in attempts need a key');
    const now = this.now();
    for (const [entryKey, entry] of this.entries)
      if (now - entry.since >= this.windowMs) this.entries.delete(entryKey);
    let entry = this.entries.get(key);
    if (!entry || now - entry.since >= this.windowMs) {
      if (this.entries.size >= this.maxEntries) {
        this.entries.delete(this.entries.keys().next().value);
      }
      entry = { since: now, count: 0 };
      this.entries.set(key, entry);
    } else {
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
    entry.count += 1;
    return entry.count <= this.limit;
  }
}

module.exports = { LoginThrottle };
