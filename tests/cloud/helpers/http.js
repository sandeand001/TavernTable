const http = require('node:http');
const { once } = require('node:events');
const { createCloudHttpHandler } = require('../../../tools/cloud/cloud-http.js');

async function cloudApi({ access, store = null, port = 0, protectedAssetKeys = null }) {
  const origin = 'http://127.0.0.1:4300';
  const handler = createCloudHttpHandler({
    access,
    store,
    allowedOrigins: [origin],
    protectedAssetKeys,
  });
  const server = http.createServer((request, response) => {
    void handler(request, response).then(
      (handled) => {
        if (!handled) {
          response.writeHead(404);
          response.end();
        }
      },
      () => {
        response.writeHead(500);
        response.end();
      }
    );
  });
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('The cloud API did not bind TCP');
  return {
    origin,
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      const closing = new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
      server.closeAllConnections();
      await closing;
    },
  };
}

module.exports = { cloudApi };
