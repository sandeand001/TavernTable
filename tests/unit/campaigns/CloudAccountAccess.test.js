import { CloudAccountAccess } from '../../../tools/cloud/account-access.js';

test('identity provider outages remain typed service failures rather than false sign-in denials', async () => {
  const access = new CloudAccountAccess({
    auth: {
      verifyIdToken: async () => {
        throw Object.assign(new Error('PRIVATE PROVIDER DETAILS'), { code: 'app/network-error' });
      },
    },
    firestore: {
      collection: () => {
        throw new Error('No metadata is available');
      },
    },
  });
  let failure;
  try {
    await access.verifyAuthorization('Bearer fixture-token');
  } catch (error) {
    failure = error;
  }
  expect(failure).toMatchObject({ status: 503, code: 'identity-unavailable' });
  expect(failure.message).not.toContain('PRIVATE PROVIDER DETAILS');
});
test('eligibility metadata outages do not become false approval denials or disclose datastore details', async () => {
  const access = new CloudAccountAccess({
    auth: {
      verifyIdToken: async () =>
        JSON.parse('{"uid":"fixture-uid","email_verified":true,"auth_time":1}'),
    },
    firestore: {
      collection: () => ({
        doc: () => ({
          get: async () => {
            throw Object.assign(new Error('PRIVATE DATASTORE DETAILS'), { code: 14 });
          },
        }),
      }),
    },
  });
  let failure;
  try {
    await access.verifyAuthorization('Bearer fixture-token');
  } catch (error) {
    failure = error;
  }
  expect(failure).toMatchObject({ status: 503, code: 'eligibility-unavailable' });
  expect(failure.message).not.toContain('PRIVATE DATASTORE DETAILS');
});

test.each([undefined, -1, '1'])(
  'invalid verified sign-in scope %p is denied before eligibility reads',
  async (authTime) => {
    const collection = jest.fn();
    const access = new CloudAccountAccess({
      auth: {
        verifyIdToken: async () => {
          const identity = JSON.parse('{"uid":"fixture-uid","email_verified":true}');
          identity['auth_time'] = authTime;
          return identity;
        },
      },
      firestore: { collection },
    });
    await expect(access.verifyAuthorization('Bearer fixture-token')).rejects.toMatchObject({
      status: 401,
      code: 'invalid-identity',
    });
    expect(collection).not.toHaveBeenCalled();
  }
);
