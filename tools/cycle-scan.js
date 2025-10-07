#!/usr/bin/env node
/**
 * cycle-scan.js (NFC tooling)
 * Lightweight static import cycle detector for .js files under src/.
 * Intentionally conservative: detects only straightforward relative path cycles.
 * Does NOT change behavior; used for visibility during NFC cleanup.
 *
 * Approach:
 * 1. Scan all JS files under src/ (recursive) excluding test directories for ES import statements.
 * 2. Build a directed graph of absolute normalized module paths (without extension).
 * 3. Run DFS to detect back-edges (simple cycles). Limit reported cycles to a max length (default 8) to avoid noise.
 * 4. Exit code 0 always (visibility only). Prints warning blocks if cycles found.
 */

const fs = require('fs');
const path = require('path');

const SRC_ROOT = path.resolve(process.cwd(), 'src');
const MAX_CYCLE_LEN = 8;

/** Collect all .js files recursively under src (excluding tests directories). */
function collectJsFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue; // skip hidden
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'tests' || e.name === '__tests__') continue;
      files.push(...collectJsFiles(full));
    } else if (e.isFile() && e.name.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

const IMPORT_RE = /import\s+(?:[^'";]+?from\s+)?["']([^"']+)["'];?/g;

function parseImports(file) {
  const text = fs.readFileSync(file, 'utf8');
  const imports = [];
  let m;
  while ((m = IMPORT_RE.exec(text))) {
    const spec = m[1];
    if (spec.startsWith('.')) {
      // relative import; resolve
      const resolved = path.normalize(path.resolve(path.dirname(file), spec));
      imports.push(resolved);
    }
  }
  return imports;
}

function stripExt(p) {
  return p.replace(/\.(js|mjs)$/i, '');
}

function buildGraph(files) {
  const graph = new Map();
  const fileSet = new Set(files.map((f) => stripExt(f)));
  for (const f of files) {
    const base = stripExt(f);
    const imps = parseImports(f)
      .map(stripExt)
      .filter((r) => fileSet.has(r)); // only track internal
    graph.set(base, imps);
  }
  return graph;
}

function detectCycles(graph) {
  const visited = new Set();
  const stack = new Set();
  const cycles = [];

  function dfs(node, pathStack) {
    if (stack.has(node)) {
      // cycle found: slice from first occurrence
      const idx = pathStack.indexOf(node);
      const cycle = pathStack.slice(idx).concat(node);
      if (cycle.length <= MAX_CYCLE_LEN + 1) {
        const sig = cycle.join('>');
        if (!cycles.some((c) => c.join('>') === sig)) cycles.push(cycle);
      }
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    stack.add(node);
    pathStack.push(node);
    const nbrs = graph.get(node) || [];
    for (const n of nbrs) dfs(n, pathStack);
    stack.delete(node);
    pathStack.pop();
  }

  for (const node of graph.keys()) {
    if (!visited.has(node)) dfs(node, []);
  }
  return cycles;
}

function relativeCycle(cycle) {
  return cycle.map((p) => path.relative(SRC_ROOT, p) || '.');
}

function main() {
  const files = collectJsFiles(SRC_ROOT);
  const graph = buildGraph(files);
  const cycles = detectCycles(graph);
  if (cycles.length === 0) {
    console.log('[cycle-scan] No simple relative import cycles detected. (NFC)');
  } else {
    console.log(`[cycle-scan] WARNING: Detected ${cycles.length} potential cycle(s):`);
    for (const c of cycles) {
      console.log('  - ' + relativeCycle(c).join(' -> '));
    }
    console.log(
      '\nRecommendation: Evaluate if any cycle impacts layering or test flakiness before refactor.'
    );
  }
  // Always exit 0 to avoid CI failure during NFC investigative phase.
  process.exit(0);
}

if (require.main === module) {
  main();
}
