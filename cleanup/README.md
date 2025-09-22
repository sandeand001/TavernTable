# Cleanup Workspace

Organizes all NFC cleanup documentation, scripts, and their artifact outputs:

- docs/: detailed plan & risk register.
- scripts/: ad-hoc scan and orchestration helpers (minimal stubs; see git history for full logic).
- artifacts/: ephemeral scan outputs and temp files (safe to delete/regenerate).

`npm run cycle:scan` updated to `node cleanup/scripts/cycle-scan.js`.