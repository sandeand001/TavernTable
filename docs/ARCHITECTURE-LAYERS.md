# Architecture Layering Rules

Enforced by `npm run lint:layers` (see `tools/check-layering.js`).

## Rule Set (v1)
Non-UI layers (everything outside `src/ui/`) must not import from `src/ui/`.
The UI layer can import downward. This keeps core/game logic DOM & presentation agnostic.

## How Violations Are Detected
`tools/check-layering.js` parses every `src/**/*.js` (excluding `src/ui/**`).
For each relative import it resolves the file (adding `.js` / `index.js` if missing). If the resolved path is inside `src/ui/` a violation is reported.

## Remediation Pattern
Replace direct UI imports with one of:
1. Constructor/manager provided `domPorts` (dependency injection object).
2. Module-level `setXDomPorts({...})` setter used by the UI bootstrap.
3. Safe fallback access (`typeof document !== 'undefined' && document.getElementById(...)`).

## CI / Pre-commit
Hook added to run `npm run lint:layers` so violations fail fast locally. Add it to any CI job after `npm install`.

## Future Extensions
Planned stricter graph segmentation (e.g. `core` cannot import `managers`, etc.). Script is structured for extension.
