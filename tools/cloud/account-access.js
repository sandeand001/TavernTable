const { createHash } = require('node:crypto');

class CloudAccessError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'CloudAccessError';
    this.status = status;
    this.code = code;
  }
}

const accessError = (status, code, message) => new CloudAccessError(status, code, message);
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
const unavailableMetadataCodes = new Set([2, 4, 5, 7, 8, 10, 13, 14, 16]);

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
    const key = pilotAccountKey(identity.uid);
    if (identity.email_verified !== true)
      throw accessError(
        403,
        'email-verification-required',
        'Verify your email before using campaigns'
      );
    let snapshot;
    try {
      snapshot = await this.firestore.collection('pilotAccounts').doc(key).get();
    } catch (error) {
      if (unavailableMetadataCodes.has(error.code))
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
    if (record?.version !== 1 || record.uid !== identity.uid || typeof record.enabled !== 'boolean')
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
    return Object.freeze({ uid: identity.uid, emailVerified: true });
  }
}

module.exports = { CloudAccountAccess, CloudAccessError, pilotAccountKey };
