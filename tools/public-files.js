const fs = require('node:fs/promises');
const path = require('node:path');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.wasm': 'application/wasm',
};
const notFound = () => Object.assign(new Error('File not found'), { status: 404 });

async function resolvePublicFile(root, pathname) {
  if (
    typeof pathname !== 'string' ||
    !pathname.startsWith('/') ||
    pathname
      .split('/')
      .filter(Boolean)
      .some((part) => part.startsWith('.'))
  )
    throw notFound();
  const filename = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  const relative = path.relative(root, filename);
  if (relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw notFound();
  const resolved = await fs.realpath(filename);
  const realRelative = path.relative(root, resolved);
  if (realRelative.startsWith('..' + path.sep) || path.isAbsolute(realRelative)) throw notFound();
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) throw notFound();
  return {
    filename: resolved,
    size: stat.size,
    contentType: mimeTypes[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
  };
}

module.exports = { resolvePublicFile };
