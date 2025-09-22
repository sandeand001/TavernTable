## Summary
Describe the change and the user-facing impact.

## Motivation
Why is this change needed? What problem does it solve?

## Changes
- (bullet list of key modifications)

## Layer & Architecture
- [ ] Imports obey layering rules (`npm run lint:layers` passes)
- Affected layer(s): (ui | systems | managers | core | config | utils)

## Depth / Rendering (if applicable)
- [ ] zIndex formula preserved (`(gridX + gridY) * 100 + bandOffset`)
- [ ] terrainContainer sorting verified

## Tests
- [ ] Added / updated unit tests
- [ ] Coverage not reduced meaningfully

## AI Docs Updated (if structural)
- [ ] `docs/AI_CODEBASE_MAP.json`
- [ ] `docs/AI_DEP_GRAPH.mmd`
- [ ] `docs/ai-index.json`
- [ ] `docs/AI_GLOSSARY.md`

## Checklist
- [ ] Lint passes (`npm run lint:all`)
- [ ] Map updated (`npm run map:update`)
- [ ] No new unvetted dependencies
- [ ] Commit messages clear / scoped

## Screenshots / Visual Proof (if UI)
(attach or describe)

## Notes
(architecture decisions, trade-offs, follow-ups)
