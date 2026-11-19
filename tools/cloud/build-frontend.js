const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { parseArgs } = require('node:util');
const { parse } = require('acorn');
const { JSDOM } = require('jsdom');
const { validateApplicationRuntime } = require('../../src/campaigns/CloudRuntime.js');
const { FIREBASE_BROWSER_VERSION } = require('../../src/campaigns/CloudAccount.js');

const COMPATIBILITY = Object.freeze({ runtime: 1, participant: 1, privateCache: 1 });
const GROUPS = [
  ['assets/animated-sprites', ['.fbx']],
  ['assets/terrain/3d Assets/OBJ', ['.obj']],
  ['assets/terrain/3d Assets/Textures', ['.png', '.jpg', '.jpeg']],
  ['assets/terrain/3d Assets/Tropical/textures', ['.png', '.jpg', '.jpeg']],
  ['assets/images/construction', ['.svg']],
];
const RUNTIME_ASSET_SOURCES = [
  'src/core/ModelAssetCache.js',
  'src/core/ModelPostProcessing.js',
  'src/config/CharacterCatalog.js',
  'src/config/HumanoidActionCatalog.js',
  'src/config/token-adapter/CoverMetrics.js',
];
const FIXED_ASSETS = [
  'assets/Items/d20-gold.glb',
  'assets/terrain/3d Assets/Tropical/source/MZRa_Pack_M02P.fbx',
  'assets/terrain/3d Assets/License_Pro.txt',
  'assets/data/SRD2014-NOTICE.txt',
  'assets/data/SRD2014-UPSTREAM-LICENSE.txt',
  'assets/FRONTEND-NOTICES.txt',
  'assets/data/resources/manifest.json',
  'assets/data/resources/NOTICES.txt',
];
const PROVENANCE = Object.freeze({
  tropical: 'owner-reported-free-use; formal-license-unrecorded; local-packaging-approved',
  deploymentApproved: false,
});
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const invalid = (message) =>
  Object.assign(new Error(message), { code: 'invalid-frontend-package' });
const validDigest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const diskPath = (root, relative) => path.join(root, ...relative.split('/'));

function productionRuntime(value) {
  if (value?.mode !== 'cloud' || value.environment !== 'production')
    throw invalid(
      'A Hosting package requires explicit production cloud mode, never emulator/local'
    );
  return validateApplicationRuntime(value, {
    baseURL: `https://${value.firebase?.projectId}.web.app/`,
  });
}

function sourceAllowed(relative) {
  if (
    typeof relative !== 'string' ||
    relative.includes('\\') ||
    relative.includes('%') ||
    relative.split('/').some((part) => !part || part.startsWith('.'))
  )
    return false;
  if (relative === 'index.html') return true;
  if (
    /^src\/.+\.(?:js|css)$/.test(relative) &&
    !/(?:^|\/)(?:__tests__|fixtures)(?:\/|$)|\.(?:test|spec)\.js$/.test(relative)
  )
    return true;
  return (
    FIXED_ASSETS.includes(relative) ||
    /^assets\/data\/resources\/[a-z0-9][a-z0-9._-]*\.json$/.test(relative) ||
    GROUPS.some(
      ([directory, extensions]) =>
        path.posix.dirname(relative) === directory &&
        extensions.includes(path.posix.extname(relative).toLowerCase())
    )
  );
}

async function sourceFile(root, relative) {
  if (!sourceAllowed(relative))
    throw invalid('A dependency is outside the public allowlist: ' + relative);
  const filename = diskPath(root, relative);
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw invalid('A public input is not a regular file: ' + relative);
  const resolved = await fs.realpath(filename);
  if (resolved !== filename)
    throw invalid('Public inputs cannot traverse filesystem links: ' + relative);
  return filename;
}

async function fileDigest(filename) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(filename)) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  return { bytes, sha256: hash.digest('hex') };
}

function* nodes(value) {
  if (!value || typeof value !== 'object') return;
  if (typeof value.type === 'string') yield value;
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) yield* nodes(item);
    } else if (child && typeof child === 'object') yield* nodes(child);
  }
}

function stringReferences(tree) {
  const references = new Set();
  for (const node of nodes(tree)) {
    if (node.type === 'Literal' && typeof node.value === 'string') references.add(node.value);
    if (node.type === 'TemplateElement') references.add(node.value.cooked);
  }
  return references;
}

async function runtimeAssetSelection(root) {
  const references = new Set();
  for (const relative of RUNTIME_ASSET_SOURCES) {
    const text = await fs.readFile(await sourceFile(root, relative), 'utf8');
    for (const value of stringReferences(
      parse(text, { ecmaVersion: 'latest', sourceType: 'module' })
    ))
      if (value) references.add(value);
  }
  const referenceValues = [...references];
  const tropicalSource = await sourceFile(
    root,
    'assets/terrain/3d Assets/Tropical/source/MZRa_Pack_M02P.fbx'
  );
  const tropicalBinary = (await fs.readFile(tropicalSource)).toString('latin1').toLowerCase();
  const selected = new Set();
  let candidateFiles = 0;
  let candidateBytes = 0;
  for (const [directory, extensions] of GROUPS) {
    for (const entry of await fs.readdir(diskPath(root, directory), {
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !extensions.includes(path.extname(entry.name).toLowerCase())) continue;
      const source = directory + '/' + entry.name;
      const filename = diskPath(root, source);
      candidateFiles++;
      candidateBytes += (await fs.stat(filename)).size;
      const stem = path.parse(entry.name).name;
      const referenced =
        directory.endsWith('/construction') ||
        references.has(source) ||
        references.has(entry.name) ||
        references.has(stem) ||
        referenceValues.some((value) => value.endsWith('/' + entry.name)) ||
        (directory.includes('/Tropical/textures') &&
          tropicalBinary.includes(entry.name.toLowerCase()));
      if (referenced) selected.add(source);
    }
  }
  let selectedBytes = 0;
  for (const source of selected) selectedBytes += (await fs.stat(diskPath(root, source))).size;
  return {
    files: selected,
    summary: {
      candidateFiles,
      candidateBytes,
      selectedFiles: selected.size,
      selectedBytes,
      excludedFiles: candidateFiles - selected.size,
      excludedBytes: candidateBytes - selectedBytes,
    },
  };
}

function externalURL(value) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    if (error instanceof TypeError) throw invalid('An external browser dependency is not a URL');
    throw error;
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^https:\/\/cdn\.jsdelivr\.net\/npm\/(?:three|cannon-es)@\d+\.\d+\.\d+\//.test(value)
  )
    throw invalid('Browser dependencies require explicit pinned upstream URLs');
  return value;
}

async function applicationSources(root, html) {
  const dom = new JSDOM(html);
  try {
    const document = dom.window.document;
    if (document.querySelector('base'))
      throw invalid('The application shell must not override its versioned document location');
    const runtimeTags = document.querySelectorAll('[id="taverntable-runtime"]');
    if (
      runtimeTags.length !== 1 ||
      runtimeTags[0].tagName !== 'SCRIPT' ||
      runtimeTags[0].type !== 'application/json'
    )
      throw invalid('The application shell requires exactly one JSON runtime tag');
    const maps = document.querySelectorAll('script[type="importmap"]');
    if (maps.length !== 1) throw invalid('The application requires one explicit pinned import map');
    const map = JSON.parse(maps[0].textContent);
    if (!map.imports || typeof map.imports !== 'object' || Array.isArray(map.imports))
      throw invalid('The application import map is invalid');
    const externals = new Set(Object.values(map.imports).map(externalURL));
    const sources = new Set();
    const pending = [];
    for (const element of document.querySelectorAll('script[src], link[rel="stylesheet"]')) {
      const target = element.getAttribute('src') ?? element.getAttribute('href');
      if (!/^(?:\.\/)?src\/.+\.(?:js|css)$/.test(target))
        throw invalid('Shell dependencies must be explicit application modules or styles');
      pending.push(target.replace(/^\.\//, ''));
    }
    if (!pending.length) throw invalid('The application has no browser entry modules');
    while (pending.length) {
      const relative = pending.pop();
      if (sources.has(relative)) continue;
      const filename = await sourceFile(root, relative);
      const text = await fs.readFile(filename, 'utf8');
      sources.add(relative);
      if (relative.endsWith('.css')) {
        if (/@import\b|url\s*\(/i.test(text))
          throw invalid('Review stylesheet asset imports before adding them to the public package');
        continue;
      }
      const tree = parse(text, { ecmaVersion: 'latest', sourceType: 'module' });
      for (const node of nodes(tree)) {
        if (
          ![
            'ImportDeclaration',
            'ExportAllDeclaration',
            'ExportNamedDeclaration',
            'ImportExpression',
          ].includes(node.type) ||
          !node.source
        )
          continue;
        const expression = node.source;
        let specifier = expression.type === 'Literal' ? expression.value : null;
        if (
          expression.type === 'TemplateLiteral' &&
          relative === 'src/campaigns/CloudAccount.js' &&
          expression.expressions.length === 1 &&
          expression.expressions[0].type === 'Identifier' &&
          expression.expressions[0].name === 'FIREBASE_BROWSER_VERSION' &&
          expression.quasis[0].value.cooked === 'https://www.gstatic.com/firebasejs/' &&
          ['/firebase-app.js', '/firebase-auth.js'].includes(expression.quasis[1].value.cooked)
        ) {
          externals.add(
            `https://www.gstatic.com/firebasejs/${FIREBASE_BROWSER_VERSION}${expression.quasis[1].value.cooked}`
          );
          continue;
        }
        if (typeof specifier !== 'string')
          throw invalid('Review computed browser imports before packaging: ' + relative);
        if (Object.hasOwn(map.imports, specifier)) continue;
        if (externals.has(specifier)) continue;
        if (!specifier.startsWith('.') || /[?#%\\]/.test(specifier))
          throw invalid('An undeclared browser module cannot be packaged: ' + relative);
        specifier = path.posix.normalize(path.posix.join(path.posix.dirname(relative), specifier));
        if (!/^src\/.+\.js$/.test(specifier) || !sourceAllowed(specifier))
          throw invalid('A browser import escapes the public application: ' + relative);
        pending.push(specifier);
      }
    }
    return { sources, externals: [...externals].sort() };
  } finally {
    dom.window.close();
  }
}

async function publicAssets(root) {
  const runtimeAssets = await runtimeAssetSelection(root);
  const selected = new Set(FIXED_ASSETS);
  for (const source of runtimeAssets.files) selected.add(source);
  const manifest = JSON.parse(
    await fs.readFile(await sourceFile(root, 'assets/data/resources/manifest.json'), 'utf8')
  );
  if (manifest.version !== 1 || !Array.isArray(manifest.packs) || !manifest.packs.length)
    throw invalid('The public resource manifest is invalid');
  const packs = new Set();
  for (const pack of manifest.packs) {
    if (
      !pack ||
      typeof pack !== 'object' ||
      !/^assets\/data\/resources\/[a-z0-9][a-z0-9._-]*\.json$/.test(pack.file) ||
      packs.has(pack.file) ||
      !validDigest(pack.hash) ||
      !Number.isSafeInteger(pack.bytes) ||
      pack.bytes < 1 ||
      !Array.isArray(pack.licenses) ||
      !pack.licenses.length ||
      pack.licenses.some((license) => typeof license !== 'string' || !license)
    )
      throw invalid('A resource pack has invalid public metadata');
    const actual = await fileDigest(await sourceFile(root, pack.file));
    if (actual.bytes !== pack.bytes || actual.sha256 !== pack.hash)
      throw invalid('A resource pack failed its declared size/hash check: ' + pack.id);
    packs.add(pack.file);
    selected.add(pack.file);
  }
  return { files: selected, assetSelection: runtimeAssets.summary };
}

async function allFiles(root, relative = '') {
  const result = [];
  for (const entry of await fs.readdir(diskPath(root, relative), { withFileTypes: true })) {
    const name = relative ? relative + '/' + entry.name : entry.name;
    if (entry.isSymbolicLink()) throw invalid('A package contains a filesystem link');
    if (entry.isDirectory()) result.push(...(await allFiles(root, name)));
    else if (entry.isFile()) result.push(name);
    else throw invalid('A package contains a non-file entry');
  }
  return result.sort();
}

async function verifyCloudFrontend(output) {
  const root = await fs.realpath(output);
  const publicRoot = path.join(root, 'public');
  const manifest = JSON.parse(
    await fs.readFile(path.join(publicRoot, 'frontend-manifest.json'), 'utf8')
  );
  const retired = manifest.retiredReleases === undefined ? [] : manifest.retiredReleases;
  if (
    manifest.version !== 1 ||
    !validDigest(manifest.release) ||
    !validDigest(manifest.runtimeDigest) ||
    JSON.stringify(manifest.compatibility) !== JSON.stringify(COMPATIBILITY) ||
    JSON.stringify(manifest.assetProvenance) !== JSON.stringify(PROVENANCE) ||
    !Array.isArray(manifest.releases) ||
    manifest.releases.length < 1 ||
    manifest.releases.length > 2 ||
    manifest.releases[0] !== manifest.release ||
    manifest.releases.some((value) => !validDigest(value)) ||
    new Set(manifest.releases).size !== manifest.releases.length ||
    !Array.isArray(retired) ||
    retired.some((value) => !validDigest(value) || manifest.releases.includes(value)) ||
    new Set(retired).size !== retired.length ||
    !Array.isArray(manifest.files) ||
    !manifest.files.length
  )
    throw invalid('The public package manifest or compatibility version is invalid');
  const names = new Set();
  if (manifest.assetSelection) {
    const selection = manifest.assetSelection;
    const values = [
      selection.candidateFiles,
      selection.candidateBytes,
      selection.selectedFiles,
      selection.selectedBytes,
      selection.excludedFiles,
      selection.excludedBytes,
    ];
    if (
      values.some((value) => !Number.isSafeInteger(value) || value < 0) ||
      selection.candidateFiles !== selection.selectedFiles + selection.excludedFiles ||
      selection.candidateBytes !== selection.selectedBytes + selection.excludedBytes
    )
      throw invalid('The public package asset-selection summary is invalid');
  }
  for (const file of manifest.files) {
    if (
      !sourceAllowed(file.source) ||
      !manifest.releases.some((release) => file.path === `releases/${release}/${file.source}`) ||
      !validDigest(file.sha256) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      names.has(file.path)
    )
      throw invalid('A package file is outside the declared public release');
    names.add(file.path);
    const filename = diskPath(publicRoot, file.path);
    if ((await fs.realpath(filename)) !== filename || !(await fs.lstat(filename)).isFile())
      throw invalid('A public package file is not a regular contained file');
    const actual = await fileDigest(filename);
    if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256)
      throw invalid('A public package file failed integrity verification: ' + file.source);
  }
  for (const release of manifest.releases) {
    const entry = `releases/${release}/index.html`;
    if (!names.has(entry)) throw invalid('Every retained release requires its own entry shell');
    const dom = new JSDOM(await fs.readFile(diskPath(publicRoot, entry), 'utf8'));
    try {
      const tags = dom.window.document.querySelectorAll('[id="taverntable-runtime"]');
      if (
        tags.length !== 1 ||
        tags[0].tagName !== 'SCRIPT' ||
        tags[0].type !== 'application/json' ||
        dom.window.document.querySelector('meta[name="taverntable-build"]')?.content !== release
      )
        throw invalid('A retained entry shell has invalid runtime/build metadata');
      const runtime = productionRuntime(JSON.parse(tags[0].textContent));
      if (digest(JSON.stringify(runtime)) !== manifest.runtimeDigest)
        throw invalid('A retained entry shell changed its account/API runtime');
    } finally {
      dom.window.close();
    }
  }
  const actualNames = await allFiles(publicRoot);
  if (
    actualNames.length !== names.size + 1 ||
    actualNames.some((name) => name !== 'frontend-manifest.json' && !names.has(name))
  )
    throw invalid('The public output contains an undeclared file');
  const hosting = JSON.parse(await fs.readFile(path.join(root, 'firebase.json'), 'utf8'));
  const expected = hostingConfiguration(manifest.release, retired);
  if (JSON.stringify(hosting) !== JSON.stringify(expected))
    throw invalid('The Hosting configuration does not match the reviewed static-only package');
  return manifest;
}

function hostingConfiguration(release, retired = []) {
  return {
    hosting: {
      public: 'public',
      ignore: [],
      redirects: ['/', '/index.html', ...retired.map((id) => `/releases/${id}/index.html`)].map(
        (source) => ({
          source,
          destination: `/releases/${release}/index.html`,
          type: 302,
        })
      ),
      headers: [
        {
          source: '**',
          headers: [
            { key: 'X-Content-Type-Options', value: 'nosniff' },
            { key: 'Cache-Control', value: 'no-store' },
          ],
        },
        {
          source: '/releases/**',
          headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
        },
        {
          // Hosting redirects inherit their destination entry's cache policy.
          source: '/releases/*/index.html',
          headers: [{ key: 'Cache-Control', value: 'no-store' }],
        },
      ],
    },
  };
}

async function buildCloudFrontend({ root, output, runtime, previous = null }) {
  root = await fs.realpath(root);
  output = path.resolve(output);
  const parentOfRoot = path.relative(output, root);
  const inRoot = path.relative(root, output);
  if (
    !parentOfRoot ||
    (!parentOfRoot.startsWith('..' + path.sep) && !path.isAbsolute(parentOfRoot)) ||
    (!inRoot.startsWith('..' + path.sep) &&
      !path.isAbsolute(inRoot) &&
      inRoot.split(path.sep)[0] !== 'build')
  )
    throw invalid('Frontend output must be a new build directory, not an input tree or its parent');
  try {
    await fs.lstat(output);
    throw invalid('Refusing to overwrite an existing frontend package');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  runtime = productionRuntime(runtime);
  const runtimeDigest = digest(JSON.stringify(runtime));
  const html = await fs.readFile(await sourceFile(root, 'index.html'), 'utf8');
  const application = await applicationSources(root, html);
  const assets = await publicAssets(root);
  const inputs = new Set(['index.html', ...application.sources, ...assets.files]);
  const files = [];
  for (const source of [...inputs].sort()) {
    const filename = await sourceFile(root, source);
    files.push({ source, filename, ...(await fileDigest(filename)) });
  }
  const release = digest(
    JSON.stringify({
      version: 1,
      compatibility: COMPATIBILITY,
      runtimeDigest,
      externals: application.externals,
      files: files.map(({ source, bytes, sha256 }) => ({ source, bytes, sha256 })),
      assetSelection: assets.assetSelection,
      provenance: PROVENANCE,
    })
  );
  const dom = new JSDOM(html);
  let rendered;
  try {
    const tag = dom.window.document.querySelector('[id="taverntable-runtime"]');
    tag.textContent = JSON.stringify(runtime).replace(/</g, '\\u003c');
    const meta = dom.window.document.createElement('meta');
    meta.name = 'taverntable-build';
    meta.content = release;
    dom.window.document.head.append(meta);
    rendered = Buffer.from(dom.serialize(), 'utf8');
  } finally {
    dom.window.close();
  }
  const notices = Buffer.concat([
    await fs.readFile(await sourceFile(root, 'assets/data/resources/NOTICES.txt')),
    Buffer.from('\n\n'),
    await fs.readFile(await sourceFile(root, 'assets/FRONTEND-NOTICES.txt')),
  ]);
  const old = previous === null ? null : await verifyCloudFrontend(previous);
  if (old && old.runtimeDigest !== runtimeDigest)
    throw invalid('A retained release must use the same explicit account/API runtime');
  const releases = old && old.release !== release ? [release, old.release] : [release];
  const retiredReleases = [...new Set([...(old?.retiredReleases || []), ...(old?.releases || [])])]
    .filter((id) => !releases.includes(id))
    .sort();
  await fs.mkdir(path.dirname(output), { recursive: true });
  let staging = await fs.mkdtemp(path.join(path.dirname(output), '.frontend-package-'));
  try {
    const publicRoot = path.join(staging, 'public');
    const records = [];
    for (const file of files) {
      const relative = `releases/${release}/${file.source}`;
      const target = diskPath(publicRoot, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      if (file.source === 'index.html') await fs.writeFile(target, rendered);
      else if (file.source === 'assets/data/resources/NOTICES.txt')
        await fs.writeFile(target, notices);
      else {
        await fs.copyFile(file.filename, target);
        const copied = await fileDigest(target);
        if (copied.bytes !== file.bytes || copied.sha256 !== file.sha256)
          throw invalid('A public source changed during packaging: ' + file.source);
      }
      records.push({ path: relative, source: file.source, ...(await fileDigest(target)) });
    }
    if (old && old.release !== release) {
      for (const file of old.files.filter((file) =>
        file.path.startsWith(`releases/${old.release}/`)
      )) {
        const target = diskPath(publicRoot, file.path);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(diskPath(path.join(previous, 'public'), file.path), target);
        records.push(file);
      }
    }
    const manifest = {
      version: 1,
      release,
      releases,
      retiredReleases,
      runtimeDigest,
      compatibility: COMPATIBILITY,
      externalModules: application.externals,
      assetSelection: assets.assetSelection,
      assetProvenance: PROVENANCE,
      files: records.sort((a, b) => a.path.localeCompare(b.path, 'en')),
    };
    await fs.writeFile(
      path.join(publicRoot, 'frontend-manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n'
    );
    await fs.writeFile(
      path.join(staging, 'firebase.json'),
      JSON.stringify(hostingConfiguration(release, retiredReleases), null, 2) + '\n'
    );
    await verifyCloudFrontend(staging);
    await fs.rename(staging, output);
    staging = null;
    return manifest;
  } catch (error) {
    if (staging !== null) {
      try {
        await fs.rm(staging, { recursive: true, force: true });
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Frontend packaging and staging cleanup failed'
        );
      }
    }
    throw error;
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      'firebase-config': { type: 'string' },
      'api-origin': { type: 'string' },
      out: { type: 'string' },
      previous: { type: 'string' },
      verify: { type: 'string' },
    },
  });
  let manifest;
  if (values.verify) {
    if (Object.keys(values).length !== 1)
      throw invalid('Use --verify with only an existing package');
    manifest = await verifyCloudFrontend(path.resolve(values.verify));
  } else {
    if (!values['firebase-config'] || !values['api-origin'] || !values.out)
      throw invalid('Pass --firebase-config, --api-origin and a new --out directory');
    manifest = await buildCloudFrontend({
      root: path.resolve(__dirname, '..', '..'),
      output: values.out,
      runtime: {
        version: 1,
        mode: 'cloud',
        environment: 'production',
        apiOrigin: values['api-origin'],
        firebase: JSON.parse(await fs.readFile(path.resolve(values['firebase-config']), 'utf8')),
      },
      previous: values.previous ? path.resolve(values.previous) : null,
    });
  }
  console.log(
    JSON.stringify({
      release: manifest.release,
      retainedReleases: manifest.releases.length,
      files: manifest.files.length,
      bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0),
      excludedAssetFiles: manifest.assetSelection?.excludedFiles ?? 0,
      excludedAssetBytes: manifest.assetSelection?.excludedBytes ?? 0,
      deploymentApproved: false,
      tropicalLicenseRecorded: false,
    })
  );
}

if (require.main === module)
  main().catch((error) => {
    console.error('[cloud-frontend-build]', {
      code: error.code === 'invalid-frontend-package' ? error.code : 'frontend-build-failed',
      kind: error instanceof Error ? 'error' : 'non-error',
      ...(error.code === 'invalid-frontend-package' ? { message: error.message } : {}),
    });
    process.exitCode = 1;
  });

module.exports = { buildCloudFrontend, verifyCloudFrontend };
