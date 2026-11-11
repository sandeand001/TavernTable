import { openDatabase, requestResult, transact } from '../storage/indexedDB.js';

export default class IndexedDBCampaignStorage {
  constructor(factory, name) {
    this.factory = factory;
    this.name = name;
    this.database = null;
    this.opening = null;
    this.closed = false;
  }

  async transaction(mode, operation) {
    const database = await this._database();
    return transact(database, ['campaigns', 'characters'], mode, (transaction) => {
      const campaigns = transaction.objectStore('campaigns');
      const characters = transaction.objectStore('characters');
      return operation({
        getCampaign: (id) => requestResult(campaigns.get(id)),
        listCampaigns: () => requestResult(campaigns.getAll()),
        writeCampaign: (record, insert = false) =>
          requestResult(insert ? campaigns.add(record) : campaigns.put(record)),
        readCharacters: async (id) =>
          (await requestResult(characters.index('campaignId').getAll(id))).map(
            ({ key, value }) => ({ key, value })
          ),
        replaceCharacters: async (id, records) => {
          const previous = await requestResult(characters.index('campaignId').getAll(id));
          for (const row of previous) characters.delete([id, row.key]);
          for (const row of records) characters.put({ campaignId: id, ...row });
        },
      });
    });
  }

  async _database() {
    if (this.closed) throw new Error('The campaign database is closed');
    if (this.database) return this.database;
    if (!this.opening) {
      this.opening = openDatabase(this.factory, this.name, (database) => {
        database.createObjectStore('campaigns', { keyPath: 'id' });
        const characters = database.createObjectStore('characters', {
          keyPath: ['campaignId', 'key'],
        });
        characters.createIndex('campaignId', 'campaignId');
      })
        .then((database) => {
          if (this.closed) {
            database.close();
            throw new Error('The campaign database is closed');
          }
          this.database = database;
          database.onversionchange = () => this.close();
          return database;
        })
        .finally(() => {
          this.opening = null;
        });
    }
    return this.opening;
  }

  close() {
    this.closed = true;
    this.database?.close();
    this.database = null;
  }
}
