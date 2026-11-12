/** @jest-environment node */
import { CloudAccountAccess } from '../../../tools/cloud/account-access.js';
import { CloudCampaignStore } from '../../../tools/cloud/campaign-store.js';

test('external metadata transaction outages stay explicit and redacted rather than becoming missing campaigns', async () => {
  const firestore = {
    collection: () => {
      throw new Error('No metadata is available');
    },
    runTransaction: async () => {
      throw Object.assign(new Error('PRIVATE TRANSACTION DETAILS'), { code: 14 });
    },
  };
  const access = new CloudAccountAccess({ auth: { verifyIdToken: async () => null }, firestore });
  const store = new CloudCampaignStore({ firestore, access, packs: [] });
  let failure;
  try {
    await store.list({ uid: 'outage-fixture-uid', emailVerified: true });
  } catch (error) {
    failure = error;
  }
  expect(failure).toMatchObject({ status: 503, code: 'campaign-metadata-unavailable' });
  expect(failure.message).not.toContain('PRIVATE TRANSACTION DETAILS');
});
