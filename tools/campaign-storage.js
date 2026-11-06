const { DatabaseSync } = require('node:sqlite');

class SqliteCampaignStorage {
  constructor(filename) {
    this.database = new DatabaseSync(filename);
    this.closed = false;
    this.queue = Promise.resolve();
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS characters (
        campaign_id TEXT NOT NULL REFERENCES campaigns(id),
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (campaign_id, key)
      );
    `);
  }

  transaction(mode, operation) {
    const pending = this.queue.then(async () => {
      if (this.closed) throw new Error('The campaign database is closed');
      const database = this.database;
      database.exec(mode === 'readwrite' ? 'BEGIN IMMEDIATE' : 'BEGIN');
      try {
        const result = await operation({
          getCampaign: (id) => {
            const row = database.prepare('SELECT value FROM campaigns WHERE id = ?').get(id);
            return row ? JSON.parse(row.value) : undefined;
          },
          listCampaigns: () =>
            database
              .prepare('SELECT value FROM campaigns')
              .all()
              .map((row) => JSON.parse(row.value)),
          writeCampaign: (record, insert = false) => {
            const query = insert
              ? 'INSERT INTO campaigns (id, value) VALUES (?, ?)'
              : 'INSERT INTO campaigns (id, value) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value';
            database.prepare(query).run(record.id, JSON.stringify(record));
          },
          readCharacters: (id) =>
            database
              .prepare('SELECT key, value FROM characters WHERE campaign_id = ? ORDER BY key')
              .all(id)
              .map((row) => ({ ...row })),
          replaceCharacters: (id, records) => {
            database.prepare('DELETE FROM characters WHERE campaign_id = ?').run(id);
            const insert = database.prepare(
              'INSERT INTO characters (campaign_id, key, value) VALUES (?, ?, ?)'
            );
            for (const row of records) insert.run(id, row.key, row.value);
          },
        });
        database.exec('COMMIT');
        return result;
      } catch (error) {
        try {
          database.exec('ROLLBACK');
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            'The disk transaction could not be rolled back'
          );
        }
        throw error;
      }
    });
    this.queue = pending.then(
      () => undefined,
      () => undefined
    );
    return pending;
  }

  async close() {
    await this.queue;
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }
}

module.exports = { SqliteCampaignStorage };
