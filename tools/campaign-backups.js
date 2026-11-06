const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');

const backupName = /^backup-[0-9TZ-]+-[a-f0-9]{8}\.json$/;

class CampaignBackups {
  constructor({ directory, store, intervalMs = 300000, retain = 20, io = fs }) {
    if (!Number.isInteger(intervalMs) || intervalMs < 1 || !Number.isInteger(retain) || retain < 1)
      throw new Error('Invalid campaign backup interval or retention');
    this.directory = directory;
    this.store = store;
    this.io = io;
    this.intervalMs = intervalMs;
    this.retain = retain;
    this.changed = new Map();
    this.hashes = new Map();
    this.states = new Map();
    this.queue = Promise.resolve();
    this.closed = false;
    this.timer = setInterval(() => {
      void this.flush().catch((error) => console.error('[TavernTable JSON backup]', error));
    }, intervalMs);
    this.timer.unref?.();
  }

  _folder(id) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id))
      throw new Error('Invalid campaign backup identity');
    return path.join(this.directory, id);
  }

  changedCampaign(id) {
    this._folder(id);
    this.changed.set(id, (this.changed.get(id) || 0) + 1);
  }

  async list(id) {
    const folder = this._folder(id);
    let names;
    try {
      names = await this.io.readdir(folder);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const records = await Promise.all(
      names
        .filter((name) => backupName.test(name))
        .map(async (name) => {
          const stat = await this.io.stat(path.join(folder, name));
          return { name, createdAt: stat.mtime.toISOString(), bytes: stat.size };
        })
    );
    return records.sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name)
    );
  }

  async read(id, name) {
    if (typeof name !== 'string' || !backupName.test(name))
      throw new Error('Invalid campaign backup filename');
    const filename = path.join(this._folder(id), name);
    const stat = await this.io.stat(filename);
    if (stat.size > 128000000) throw new Error('The campaign backup exceeds the supported size');
    const text = await this.io.readFile(filename, 'utf8');
    const parsed = this.store.parseBackup(text);
    if (parsed.campaign.id !== id) throw new Error('The backup belongs to a different campaign');
    return text;
  }

  async status(id) {
    const state = this.states.get(id);
    const latest = (await this.list(id))[0] || null;
    return {
      state: state?.error ? 'error' : this.changed.has(id) ? 'pending' : latest ? 'saved' : 'none',
      error: state?.error || null,
      latest,
      intervalMs: this.intervalMs,
      retain: this.retain,
    };
  }

  _enqueue(operation) {
    if (this.closed) return Promise.reject(new Error('The campaign backup module is closed'));
    const pending = this.queue.then(operation);
    this.queue = pending.then(
      () => undefined,
      () => undefined
    );
    return pending;
  }

  backupNow(id) {
    return this._enqueue(() => this._snapshot(id, true));
  }

  flush() {
    return this._enqueue(async () => {
      const errors = [];
      for (const id of [...this.changed.keys()]) {
        try {
          await this._snapshot(id, false);
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length)
        throw new AggregateError(errors, 'One or more campaign JSON backups failed');
    });
  }

  async _snapshot(id, force) {
    const generation = this.changed.get(id);
    let staging;
    try {
      const folder = this._folder(id);
      const text = await this.store.exportBackup(id);
      this.store.parseBackup(text);
      const hash = createHash('sha256').update(text).digest('hex');
      if (!force && !this.hashes.has(id)) {
        const latest = (await this.list(id))[0];
        if (latest) {
          const previous = await this.io.readFile(path.join(folder, latest.name));
          this.hashes.set(id, createHash('sha256').update(previous).digest('hex'));
        }
      }
      if (!force && this.hashes.get(id) === hash) {
        if (this.changed.get(id) === generation) this.changed.delete(id);
        this.states.set(id, { error: null });
        return (await this.list(id))[0];
      }
      await this.io.mkdir(folder, { recursive: true, mode: 0o700 });
      const suffix = randomBytes(4).toString('hex');
      const name = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${suffix}.json`;
      staging = path.join(folder, `.${suffix}.tmp`);
      const file = await this.io.open(staging, 'wx', 0o600);
      try {
        await file.writeFile(text, 'utf8');
        await file.sync();
      } finally {
        await file.close();
      }
      await this.io.rename(staging, path.join(folder, name));
      staging = null;
      const snapshots = await this.list(id);
      for (const old of snapshots.slice(this.retain))
        await this.io.unlink(path.join(folder, old.name));
      this.hashes.set(id, hash);
      if (this.changed.get(id) === generation) this.changed.delete(id);
      this.states.set(id, { error: null });
      return snapshots.find((snapshot) => snapshot.name === name);
    } catch (error) {
      this.states.set(id, { error: error.message });
      this.changedCampaign(id);
      throw error;
    } finally {
      if (staging) {
        try {
          await this.io.unlink(staging);
        } catch (error) {
          if (error.code !== 'ENOENT') console.error('[TavernTable backup staging cleanup]', error);
        }
      }
    }
  }

  async close() {
    clearInterval(this.timer);
    try {
      await this.flush();
    } finally {
      await this.queue;
      this.closed = true;
    }
  }
}

module.exports = { CampaignBackups };
