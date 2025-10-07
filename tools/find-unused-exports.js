#!/usr/bin/env node
/**
 * find-unused-exports.js (NFC tooling)
 * Passive analysis script: prints potential unused exports and orphan modules.
 * It DOES NOT fail or modify files.
 *
 * Heuristics:
 * 1. Parses JS files in src/ (not tests) to collect named & default exports.
 * 2. Builds a simple import graph by regexing import statements (ESM only).
 * 3. Flags exports never imported anywhere else (excluding their own file).
 * 4. Flags modules not imported by any other module (orphans) excluding entry-like files (index.js) and known singletons (Logger, ErrorHandler) and test-only helpers.
 * 5. Skips files in patterns that are clearly side-effect or config modules (e.g., polyfills, env, config constants, pixi setup) — these may intentionally have 0 imports.
 *
 * Limitations:
 * - Regex parsing is approximate; false positives possible for dynamic imports or commented code.
 * - Does not follow re-export chains (export { X } from './Y').
 * - Does not attempt tree-shaking semantics; only direct textual import usage.
 *
 * Output sections:
 *   UNUSED_EXPORTS: <file>: <export1, export2>
 *   ORPHAN_MODULES: <file>
 *
 * Suggested workflow: Review findings manually; do NOT delete automatically.
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(process.cwd(), 'src');

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      walk(full, files);
    } else if (entry.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

function rel(p) {
  return path.relative(process.cwd(), p).replace(/\\/g, '/');
}

function shouldSkipFile(file) {
  const relPath = rel(file);
  if (!relPath.startsWith('src/')) return true; // only src
  if (relPath.includes('/__mocks__/')) return true;
  // Skip test files (though they are outside src/ typically)
  if (/\.test\.js$/.test(relPath)) return true;
  // Skip style / css modules if any
  if (relPath.endsWith('.css.js')) return true;
  // Skip obvious side-effect modules that may expose globals or patch libs
  const sideEffectHints = ['env.js', 'polyfill', 'config/', 'GameConstants', 'index.js'];
  if (sideEffectHints.some((h) => relPath.includes(h))) return false; // allow index.js but treat separately
  return false;
}

// Collect exports & imports
const exportMap = new Map(); // file -> Set(exports)
const importGraph = new Map(); // file -> Set(importedFiles)
const reverseImports = new Map(); // file -> Set(importingFiles)

const files = walk(SRC_DIR).filter((f) => !shouldSkipFile(f));

const exportRegexes = [
  /export function (\w+)/g,
  /export class (\w+)/g,
  /export const (\w+)/g,
  /export let (\w+)/g,
  /export var (\w+)/g,
  /export default function (\w+)/g,
  /export default class (\w+)/g,
  /export default (?:function|class)?\s*(\w+)/g,
  /export {([^}]+)}/g,
];

const importRegex = /import\s+(?:[^'";]+)from\s+['"]([^'";]+)['"];?|import\s+['"]([^'";]+)['"];?/g;

function recordExport(file, name) {
  if (!name) return;
  const set = exportMap.get(file) || new Set();
  set.add(name.trim());
  exportMap.set(file, set);
}

for (const file of files) {
  const code = fs.readFileSync(file, 'utf8');
  // Exports
  for (const regex of exportRegexes) {
    let m;
    while ((m = regex.exec(code))) {
      if (regex === exportRegexes[exportRegexes.length - 1]) {
        // export {...}
        const names = m[1]
          .split(',')
          .map((s) => s.replace(/as.+$/, '').trim())
          .filter(Boolean);
        names.forEach((n) => recordExport(file, n));
      } else {
        recordExport(file, m[1]);
      }
    }
  }
  // Imports
  importGraph.set(file, importGraph.get(file) || new Set());
  let im;
  while ((im = importRegex.exec(code))) {
    const target = im[1] || im[2];
    if (!target) continue;
    if (target.startsWith('.')) {
      // Resolve relative
      let resolved = path.resolve(path.dirname(file), target);
      if (fs.existsSync(resolved + '.js')) resolved = resolved + '.js';
      else if (fs.existsSync(path.join(resolved, 'index.js')))
        resolved = path.join(resolved, 'index.js');
      if (files.includes(resolved)) {
        importGraph.get(file).add(resolved);
        const rev = reverseImports.get(resolved) || new Set();
        rev.add(file);
        reverseImports.set(resolved, rev);
      }
    }
  }
}

// Determine unused exports (exported but never imported elsewhere)
const unused = [];
for (const [file, exports] of exportMap.entries()) {
  const relFile = rel(file);
  const importingFiles = reverseImports.get(file) || new Set();
  // If module only re-exports others we might mislabel; allow manual review.
  for (const ex of exports) {
    let used = false;
    // Heuristic: if any importing file contains the identifier, treat as used.
    for (const importer of importingFiles) {
      const code = fs.readFileSync(importer, 'utf8');
      if (code.includes(ex)) {
        used = true;
        break;
      }
    }
    if (!used) unused.push({ file: relFile, export: ex });
  }
}

// Orphan modules: no one imports them, but they have exports.
const orphans = [];
for (const [file] of exportMap.entries()) {
  const relFile = rel(file);
  const importingFiles = reverseImports.get(file) || new Set();
  if (importingFiles.size !== 0) continue;
  const base = path.basename(file);
  // Exclusions: entrypoints & known singletons / side-effect style modules.
  if (base === 'index.js') continue;
  if (/Logger|ErrorHandler|SeededRNG|Validation|Coordinate|ColorUtils/i.test(base)) continue;
  orphans.push(relFile);
}

function groupByFile(list) {
  const map = new Map();
  for (const item of list) {
    const arr = map.get(item.file) || [];
    arr.push(item.export);
    map.set(item.file, arr);
  }
  return map;
}

const groupedUnused = groupByFile(unused);

console.log('=== UNUSED_EXPORTS (heuristic) ===');
if (groupedUnused.size === 0) console.log('None detected');
else {
  for (const [file, exs] of groupedUnused.entries()) {
    console.log(`${file}: ${exs.join(', ')}`);
  }
}
console.log('\n=== ORPHAN_MODULES (heuristic) ===');
if (orphans.length === 0) console.log('None detected');
else orphans.sort().forEach((f) => console.log(f));

console.log('\nNOTE: This script is heuristic. Review before acting. (NFC)');
