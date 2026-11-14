## What and why

<!-- What does this change, and which problem does it solve? Link the issue: Fixes #123 -->

## How it was tested

<!-- Commands you ran, the browser and system, screenshots for interface changes (light and dark). -->

## Checklist

- [ ] `npm run typecheck` passes (strict TypeScript, frontend and backend)
- [ ] `npm test` passes
- [ ] `npm run test:e2e` passes, or the PR says why it could not run
- [ ] `npm run check:clean` passes (no keys, no private files, no brand assets)
- [ ] `npm run check:docs` passes (every relative link and anchor in the Markdown files resolves)
- [ ] `npm run build` passes
- [ ] Interface changes follow the design rules in AGENTS.md: light paper and dark carbon themes, quiet `.frame` and `.well` surfaces, app accents only on app marks (`#335CFF`, `#3B82F6`, `#10B981`, `#F97316`, `#14B8A6`), DM Mono for labels, touch targets of 44 px on iPad
- [ ] Interface text is English; new strings that WorkCraft shows have a German entry in `src/app/i18n-de.ts`
- [ ] `CHANGELOG.md` has a line for this change under `## [Unreleased]` (you do not need to change the version number)
- [ ] Docs updated where behavior changed (README, AGENTS.md, the guides in `docs/`, `src/docs/content.md`) and `SOURCES.md` lists any new repository

- [ ] I agree that my contribution is licensed under MIT OR Apache-2.0 (open-source parts)
