const { createHash } = require('node:crypto');

const { CloudError, metadataUnavailable } = require('./cloud-error.js');
const accessError = (status, code, message) => new CloudError(status, code, message);
const invalidIdentityCodes = new Set([
  'auth/argument-error',
  'auth/invalid-argument',
  'auth/invalid-id-token',
  'auth/id-token-expired',
  'auth/id-token-revoked',
  'auth/user-disabled',
  'auth/user-not-found',
]);
const unavailableIdentityCodes = new Set([
  'app/network-error',
  'app/network-timeout',
  'auth/internal-error',
  'auth/network-request-failed',
  'auth/too-many-requests',
]);

function pilotAccountKey(uid) {
  if (typeof uid !== 'string' || !uid || uid.length > 128)
    throw accessError(401, 'invalid-identity', 'The verified account identity is invalid');
  return createHash('sha256').update(uid).digest('hex');
}

class CloudAccountAccess {
  constructor({ auth, firestore }) {
    if (typeof auth?.verifyIdToken !== 'function' || typeof firestore?.collection !== 'function')
      throw new Error('Cloud account access requires identity and metadata clients');
    this.auth = auth;
    this.firestore = firestore;
  }

  async verifyAuthorization(authorization) {
    const bearer = typeof authorization === 'string' && /^Bearer ([^\s]+)$/i.exec(authorization);
    if (!bearer)
      throw accessError(401, 'authentication-required', 'Sign in before using cloud campaigns');
    let identity;
    try {
      identity = await this.auth.verifyIdToken(bearer[1], true);
    } catch (error) {
      if (invalidIdentityCodes.has(error.code))
        throw accessError(401, 'invalid-identity', 'Sign in again before using cloud campaigns');
      if (unavailableIdentityCodes.has(error.code))
        throw accessError(
          503,
          'identity-unavailable',
          'Cloud identity is temporarily unavailable; retry online'
        );
      throw error;
    }
    pilotAccountKey(identity.uid);
    if (identity.email_verified !== true)
      throw accessError(
        403,
        'email-verification-required',
        'Verify your email before using campaigns'
      );
    await this.assertEligibility(identity.uid);
    return Object.freeze({ uid: identity.uid, emailVerified: true });
  }

  async assertEligibility(uid, transaction = null) {
    const key = pilotAccountKey(uid);
    if (transaction !== null && typeof transaction.get !== 'function')
      throw new Error('Eligibility checks require a Firestore transaction or a direct read');
    let snapshot;
    try {
      const reference = this.firestore.collection('pilotAccounts').doc(key);
      snapshot = transaction ? await transaction.get(reference) : await reference.get();
    } catch (error) {
      if (!transaction && metadataUnavailable(error))
        throw accessError(
          503,
          'eligibility-unavailable',
          'Cloud account access is temporarily unavailable; retry online'
        );
      throw error;
    }
    if (!snapshot.exists)
      throw accessError(
        403,
        'pilot-access-required',
        'This account has not been approved for the private pilot'
      );
    const record = snapshot.data();
    if (record?.version !== 1 || record.uid !== uid || typeof record.enabled !== 'boolean')
      throw accessError(
        503,
        'invalid-account-eligibility',
        'Account eligibility could not be verified'
      );
    if (!record.enabled)
      throw accessError(
        403,
        'pilot-access-required',
        'This account is not enabled for the private pilot'
      );
  }
}

module.exports = { CloudAccountAccess, pilotAccountKey };
