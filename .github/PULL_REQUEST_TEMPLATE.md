## Summary

Describe the change and the user-facing impact.

## Motivation

Why is this change needed? What problem does it solve?

## Changes

- (bullet list of key modifications)

## Layer & Architecture

- [ ] Imports obey layering rules (`npm run lint:layers` passes)
- Affected layer(s): (ui | systems | managers | coordinators | terrain | scene | core | config | utils)

## Depth / Rendering (if applicable)

- [ ] Terrain/token world positions and picking verified when affected
- [ ] Editing mode, biome coloring, and asset loading verified when affected

## Tests

- [ ] Added / updated unit tests
- [ ] Coverage not reduced meaningfully

## Documentation (if affected)

- [ ] [README](../README.md) reflects setup or command changes
- [ ] [TODO](../TODO.md) reflects resolved issues and follow-ups
- [ ] Relevant [architecture decisions](../docs/adr/) remain accurate

## Checklist

- [ ] Lint passes (`npm run lint:all`)
- [ ] Tests pass (`npm run test:stable -- --watch=false`)
- [ ] No new unvetted dependencies
- [ ] Commit messages clear / scoped

## Screenshots / Visual Proof (if UI)

(attach or describe)

## Notes

(architecture decisions, trade-offs, follow-ups)
