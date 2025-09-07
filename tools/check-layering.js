/**
 * Layering enforcement script.
 *
 * Rule (current): Any file outside src/ui/ MAY NOT import anything inside src/ui/.
 * UI layer can import downward freely. This protects architectural boundary defined
 * in AGENT_PLAYBOOK: lower layers (config, core, managers, systems, terrain, utils,
 * coordinators, entities) stay pure and framework/DOM agnostic.
 *
 * Exit code: 0 = success, 1 = violations found, 2 = internal error.
 * Optional flag: --json outputs machine readable JSON summary.
 */
/* eslint-disable no-console */
const path = require('path');
const fs = require('fs');
const fg = require('fast-glob');
const acorn = require('acorn');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(PROJECT_ROOT, 'src');
const UI_DIR = path.join(SRC_DIR, 'ui');

function isInUi(resolved) {
  return resolved.startsWith(UI_DIR + path.sep);
}

function resolveImport(fromFile, rawSource) {
  if (!rawSource.startsWith('.')) return null; // only handle relative for now
  const base = path.resolve(path.dirname(fromFile), rawSource);
  // If source already has extension treat directly
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  if (fs.existsSync(base + '.js')) return base + '.js';
  // index.js resolution
  if (fs.existsSync(path.join(base, 'index.js'))) return path.join(base, 'index.js');
  // Even if not found, still return the path so startsWith check can work (directory import)।
  return base;
}

function collectViolations() {
  const patterns = ['src/**/*.js', '!src/ui/**'];
  const files = fg.sync(patterns, { cwd: PROJECT_ROOT, absolute: true });
  const violations = [];

  for (const file of files) {
    let code;
    try {
      code = fs.readFileSync(file, 'utf8');
    } catch (e) {
      console.error('Failed to read', file, e.message);
      continue;
    }
    let ast;
    try {
      ast = acorn.parse(code, { sourceType: 'module', ecmaVersion: 'latest' });
    } catch (e) {
      // Skip non-module / parse issues quietly; layering relevance minimal.
      continue;
    }
    for (const node of ast.body) {
      if (
        node.type === 'ImportDeclaration' &&
        node.source &&
        typeof node.source.value === 'string'
      ) {
        const source = node.source.value;
        const resolved = resolveImport(file, source);
        if (resolved && isInUi(resolved)) {
          violations.push({
            file: path.relative(PROJECT_ROOT, file),
            importSource: source,
            resolved: path.relative(PROJECT_ROOT, resolved),
          });
        }
      }
    }
  }
  return violations;
}

function main() {
  try {
    const violations = collectViolations();
    const asJson = process.argv.includes('--json');
    if (violations.length === 0) {
      if (asJson) {
        console.log(JSON.stringify({ ok: true, violations: [] }, null, 2));
      } else {
        console.log('Layering check passed (no forbidden src/ui imports from lower layers).');
      }
      return 0;
    }
    if (asJson) {
      console.log(JSON.stringify({ ok: false, violations }, null, 2));
    } else {
      console.error('\nLayering violations detected:');
      for (const v of violations) {
        console.error(`  ${v.file} -> ${v.importSource} (resolves to ${v.resolved})`);
      }
      console.error(`\nTotal: ${violations.length} violation(s).`);
      console.error(
        '\nFix: Replace direct UI imports with injected domPorts or module-level setters with safe fallbacks.'
      );
    }
    return 1;
  } catch (e) {
    console.error('Layering check internal error:', e);
    return 2;
  }
}

process.exit(main());
