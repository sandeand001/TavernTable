const fs = require('node:fs/promises');
const path = require('node:path');
const {
  PROTECTED_ASSET_MAGIC,
  PROTECTED_ASSET_MAX_BYTES,
} = require('../src/core/ProtectedAsset.js');

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

function protectedLocation(relative) {
  const parts = relative.split(path.sep).map((part) => part.toLowerCase());
  const assets = parts.indexOf('assets');
  if (assets < 0) return false;
  const assetPath = parts.slice(assets);
  const privateDirectories = [
    ['assets', 'terrain', 'source-packs'],
    ['assets', 'animated-sprites', 'source-packs'],
    ['assets', 'items', 'source-packs'],
    ['assets', 'terrain', 'representatives', 'cave'],
    ['assets', 'terrain', 'representatives', 'chest'],
  ];
  if (privateDirectories.some((prefix) => prefix.every((part, index) => assetPath[index] === part)))
    throw notFound();
  if (assetPath[1] !== 'protected') return false;
  if (assetPath.length !== 3 || !/^[a-z0-9][a-z0-9-]{0,79}\.ttasset$/.test(assetPath[2]))
    throw notFound();
  return true;
}

async function isProtectedAssetFile(filename, size) {
  if (!Number.isSafeInteger(size) || size <= 32 || size > PROTECTED_ASSET_MAX_BYTES) return false;
  const file = await fs.open(filename, 'r');
  try {
    const header = Buffer.alloc(PROTECTED_ASSET_MAGIC.length);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    return (
      bytesRead === header.length &&
      PROTECTED_ASSET_MAGIC.every((value, index) => header[index] === value)
    );
  } finally {
    await file.close();
  }
}

async function resolvePublicFile(root, pathname) {
  if (
    typeof pathname !== 'string' ||
    !pathname.startsWith('/') ||
    pathname.includes('\\') ||
    pathname
      .split('/')
      .filter(Boolean)
      .some((part) => part.startsWith('.'))
  )
    throw notFound();
  const filename = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  const relative = path.relative(root, filename);
  if (relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw notFound();
  const requestedProtected = protectedLocation(relative);
  const resolved = await fs.realpath(filename);
  const realRelative = path.relative(root, resolved);
  if (realRelative.startsWith('..' + path.sep) || path.isAbsolute(realRelative)) throw notFound();
  const actualProtected = protectedLocation(realRelative);
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) throw notFound();
  if ((requestedProtected || actualProtected) && !(await isProtectedAssetFile(resolved, stat.size)))
    throw notFound();
  return {
    filename: resolved,
    size: stat.size,
    contentType: mimeTypes[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
  };
}

module.exports = { resolvePublicFile, isProtectedAssetFile };
