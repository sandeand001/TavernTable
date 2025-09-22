#!/usr/bin/env node
/*
  Update Codebase Map for TavernTable
  - Scans src/, docs/src/, tests/
  - Generates docs/AI_CODEBASE_MAP.json, docs/AI_DEP_GRAPH.mmd, updates overview in docs/AI_CODEBASE_MAP.md
  Constraints: read-only to runtime; only writes under docs/ and ai/
*/

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const DOCS_SRC = path.join(ROOT, 'docs', 'src');
const TESTS = path.join(ROOT, 'tests');

const IGNORE_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git']);

function hashId(p) {
    return crypto.createHash('sha1').update(p).digest('hex').slice(0, 12);
}

function walk(dir, files = []) {
    if (!fs.existsSync(dir)) return files;
    for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
            if (IGNORE_DIRS.has(entry)) continue;
            files = walk(full, files);
        } else {
            if (/\.(js|mjs|cjs)$/i.test(entry)) files.push(full);
        }
    }
    return files;
}

function parseImports(code) {
    const re = /import\s+[^'"`]*from\s+['"]([^'"`]+)['"];?|import\(['"]([^'"`]+)['"]\)/g;
    const out = [];
    let m;
    while ((m = re.exec(code))) {
        out.push(m[1] || m[2]);
    }
    return out;
}

function classifyLayer(p) {
    if (p.includes(path.sep + 'ui' + path.sep)) return 'ui';
    if (p.includes(path.sep + 'coordinators' + path.sep) || p.includes(path.sep + 'core' + path.sep) || p.includes(path.sep + 'managers' + path.sep) || p.includes(path.sep + 'systems' + path.sep)) return 'app';
    if (p.includes(path.sep + 'entities' + path.sep) || p.includes(path.sep + 'terrain' + path.sep)) return 'domain';
    if (p.includes(path.sep + 'config' + path.sep)) return 'infra';
    if (p.includes(path.sep + 'tests' + path.sep)) return 'test';
    return 'app';
}

function buildModules(filePaths) {
    const modules = [];
    const byPath = new Map();
    for (const fp of filePaths) {
        const rel = path.relative(ROOT, fp).replace(/\\/g, '/');
        const id = hashId(rel);
        const code = fs.readFileSync(fp, 'utf8');
        const imports = parseImports(code);
        const exports = Array.from(code.matchAll(/export\s+(?:const|function|class|default)\s+([A-Za-z0-9_]+)/g)).map(m => m[1]).slice(0, 20);
        const mod = {
            id,
            path: rel,
            layer: classifyLayer(rel),
            exports,
            imports_internal: imports.filter(x => x.startsWith('.') || x.startsWith('/')),
            imports_external: imports.filter(x => !x.startsWith('.') && !x.startsWith('/')),
            depends_on: [],
            used_by: [],
            public_api: rel.startsWith('src/') && /index\.js$/.test(rel),
            responsibilities: [],
            invariants: [],
            data_models: [],
            errors: [],
            logging: code.includes('Logger') ? 'Logger' : 'none',
            config: code.includes('process.env') ? ['process.env'] : [],
            tests: { files: [], coverage_hint: 'none' },
            smells: [],
            todo: []
        };
        modules.push(mod);
        byPath.set(rel, mod);
    }
    // Build used_by and depends_on by resolving relative imports
    const pathIndex = new Map(modules.map(m => [m.path.replace(/\.js$/, ''), m.id]));
    for (const m of modules) {
        const deps = [];
        for (const imp of m.imports_internal) {
            const base = path.posix.normalize(path.posix.join(path.posix.dirname(m.path), imp)).replace(/\.js$/, '');
            const id = pathIndex.get(base) || pathIndex.get(base + '.js');
            if (id) deps.push(id);
        }
        m.depends_on = Array.from(new Set(deps));
    }
    const byId = new Map(modules.map(m => [m.id, m]));
    for (const m of modules) {
        for (const d of m.depends_on) {
            const dep = byId.get(d);
            if (dep) dep.used_by.push(m.id);
        }
    }
    return modules;
}

function generateGraph(modules) {
    const lines = [
        '%% Auto-generated Mermaid dependency graph',
        'flowchart LR'
    ];
    for (const m of modules) {
        lines.push(`  ${m.id}[${m.path}]`);
    }
    for (const m of modules) {
        for (const d of m.depends_on) lines.push(`  ${m.id} --> ${d}`);
    }
    return lines.join('\n');
}

function main() {
    const srcFiles = walk(SRC);
    const docsFiles = walk(DOCS_SRC);
    const testFiles = walk(TESTS);
    const modules = buildModules([...srcFiles, ...docsFiles]);

    // map tests to modules heuristically
    for (const t of testFiles) {
        const rel = path.relative(ROOT, t).replace(/\\/g, '/');
        for (const m of modules) {
            if (rel.toLowerCase().includes(path.basename(m.path, '.js').toLowerCase())) {
                m.tests.files.push(rel);
                m.tests.coverage_hint = 'ok';
            }
        }
    }

    const map = {
        meta: {
            project: 'TavernTable',
            generated_at: new Date().toISOString(),
            languages: ['JavaScript', 'HTML', 'CSS'],
            package_managers: ['npm'],
            entry_points: ['index.html', 'docs/index.html', 'src/core/GameManager.js'],
            test_commands: ['npm run test'],
            lint_commands: ['npm run lint'],
            typecheck_commands: []
        },
        structure: {
            directories: [
                { path: 'src/ui', purpose: 'UI and DOM controllers', layer: 'ui', notes: 'Sidebar tabs, UI bootstrapping' },
                { path: 'src/coordinators', purpose: 'App orchestration and state', layer: 'app', notes: 'State/Render/Input/Terrain' },
                { path: 'src/core', purpose: 'Game bootstrap and sprite/animation managers', layer: 'app', notes: 'GameManager, SpriteManager' },
                { path: 'src/managers', purpose: 'Managers for grid, interaction, tokens, terrain', layer: 'app', notes: 'May import utils and config' },
                { path: 'src/systems', purpose: 'System utilities like dragging and dice', layer: 'app', notes: 'Lower-level helpers' },
                { path: 'src/entities', purpose: 'Domain entities such as creatures', layer: 'domain', notes: 'Factories and tokens' },
                { path: 'src/terrain', purpose: 'Terrain/biome logic', layer: 'domain', notes: 'Painter, faces, data store' },
                { path: 'src/config', purpose: 'Constants and palettes', layer: 'infra', notes: 'Game constants and colors' },
                { path: 'src/utils', purpose: 'Utilities, validation, logging', layer: 'domain', notes: 'Shared helpers' },
                { path: 'docs/src', purpose: 'Deployed mirror for GitHub Pages', layer: 'ui', notes: 'Should mirror src/' },
                { path: 'tests', purpose: 'Unit tests', layer: 'test', notes: 'Jest tests' }
            ],
            modules
        },
        architecture: {
            layers: ['ui', 'app', 'domain', 'infra', 'test'],
            rules: ['ui -> app only', 'app -> domain, infra', 'domain -> stdlib/utils only', 'infra -> may not import ui'],
            approved_patterns: ['Split internals/ by concern', 'Event/callback decoupling'],
            anti_patterns: ['God module > 1000 LOC', 'Business logic in UI controllers']
        },
        conventions: {
            naming: ['PascalCase classes', 'camelCase functions', 'CONSTANT_CASE for config keys'],
            errors: ['Use ErrorHandler and typed enums in utils/error'],
            logging: ['Structured logs via utils/Logger with context and stage'],
            formatting: ['ESLint + Stylelint via tools configs'],
            testing: ['Unit tests in tests/unit; terrain tests under tests/terrain']
        },
        risks: {
            cycles: [],
            dead_files: [],
            duplication: ['docs/src mirrors src/**/*; keep in sync']
        }
    };

    fs.writeFileSync(path.join(ROOT, 'docs', 'AI_CODEBASE_MAP.json'), JSON.stringify(map, null, 2));
    fs.writeFileSync(path.join(ROOT, 'docs', 'AI_DEP_GRAPH.mmd'), generateGraph(modules));

    // Update overview title timestamp in AI_CODEBASE_MAP.md
    const mdPath = path.join(ROOT, 'docs', 'AI_CODEBASE_MAP.md');
    if (fs.existsSync(mdPath)) {
        const md = fs.readFileSync(mdPath, 'utf8');
        if (!md.includes('AI Codebase Map')) {
            fs.writeFileSync(mdPath, 'AI Codebase Map — TavernTable\n\n' + md);
        }
    }
}

main();
