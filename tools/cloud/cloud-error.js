class CloudError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'CloudError';
    this.status = status;
    this.code = code;
  }
}

const unavailableMetadataCodes = new Set([2, 4, 5, 7, 8, 10, 13, 14, 16]);
const metadataUnavailable = (error) => unavailableMetadataCodes.has(error?.code);

module.exports = { CloudError, metadataUnavailable };
