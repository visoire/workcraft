# CLAUDE.md

Claude Code reads this file at the start of a session. The project context lives in AGENTS.md (shared
with other coding agents), imported here:

@AGENTS.md

## Short version

- Alpha phase (`0.1.0-alpha.N`, first public release `0.1.0-alpha.1`): no stable release yet. With every change, add it under
  `## [Unreleased]` in `CHANGELOG.md` and update every affected Markdown file (README, AGENTS.md, `docs/`,
  `src/docs/content.md`) and `SOURCES.md`. Do it without being asked. The version number is raised only when the
  maintainer cuts a release (list in AGENTS.md), never in an ordinary change.

- Six checks before a change is done: `npm run typecheck`, `npm test`, `npm run test:e2e`,
  `npm run check:clean`, `npm run check:docs`, `npm run build`.
- Theme scopes: `oc-ide-theme` for the workspace and the apps in its panels, `oc-home-theme` for the docs
  page and standalone apps. Always pass the scope to the theme-store functions.
- English is the default language; German strings go into `src/app/i18n-de.ts`.
- Tools are Zod schemas in `src/mcp/schemas.ts`; never reorder them.
- Never run tests against the dev server on ports 5175 and 5176 (real user data).
