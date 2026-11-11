class RequestBodyLimitError extends Error {
  constructor() {
    super('The request exceeds its size limit');
    this.name = 'RequestBodyLimitError';
    this.status = 413;
  }
}

function readLimitedBody(request, maximum) {
  if (!Number.isSafeInteger(maximum) || maximum < 1)
    throw new Error('HTTP body reads require an explicit positive byte limit');
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let exceeded = false;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > maximum) {
        if (!exceeded) reject(new RequestBodyLimitError());
        exceeded = true;
        chunks.length = 0;
      } else if (!exceeded) chunks.push(chunk);
    });
    request.on('error', reject);
    request.on('end', () => {
      if (exceeded) return;
      const body = Buffer.concat(chunks, size);
      chunks.length = 0;
      resolve(body);
    });
  });
}

module.exports = { readLimitedBody, RequestBodyLimitError };
