# Contributing to WorkCraft

Thanks for helping. WorkCraft is a small community project, so clear issues and focused pull requests
go a long way.

## Before you start

- Look through the [open issues](https://github.com/visoire/workcraft/issues). For anything larger
  than a fix, open an issue or a discussion first so the direction is agreed.
- Problems inside WordCraft, GridCraft, DeckCraft or PdfCraft themselves belong to their repositories
  under [github.com/storytold](https://github.com/storytold).
- Read [AGENTS.md](AGENTS.md): it explains the layout, the state rules and the MCP tool rules. It is
  written for AI coding agents and works just as well for people.

## Run it locally

You need **Node.js 22 or newer** and Git. Nothing else: no database, no account, no API key (an AI model is optional).

```sh
git clone https://github.com/visoire/workcraft.git
cd workcraft
npm install
git config core.hooksPath .githooks   # runs check:clean before every commit
npm run dev                           # http://localhost:5175/  (the backend is on 127.0.0.1:5176)
```

You start in an empty project; **Load sample data** opens a sample project with a document, a sheet, a deck and a PDF. Your own data lives in `~/workcraft` and is never part of the repository. Set `WORKCRAFT_HOME` to another folder to keep a test setup apart.

Want to see the browser version, without a backend? `npm run build` and serve `dist/` from any static HTTPS host ([docs/SELF-HOSTING.md](docs/SELF-HOSTING.md)), or try [workcraft.cc/app](https://workcraft.cc/app/).

## Where things are

[docs/README.md](docs/README.md) is the map of the documentation. For the code, [AGENTS.md](AGENTS.md) has the directory map and the rules. In short: `src/app/` is the shell, `src/workspace/` the window manager and the app panels, `src/chat/` the assistant, `src/mcp/` the tools (one schema each), `src/server/` the local backend, `src/ecosystems/` the workspaces and the app catalog, `src/ipados/` the iPad layer, `tests/` the tests.

## Good first contributions

- A fix to a guide or a typo: any Markdown file under `docs/`, or `src/docs/content.md` (the in-app documentation).
- A German string in `src/app/i18n-de.ts` that reads awkwardly.
- A bug report with exact steps, a screenshot and your system: it is a contribution too.
- Issues labelled [good first issue](https://github.com/visoire/workcraft/labels/good%20first%20issue) or [help wanted](https://github.com/visoire/workcraft/labels/help%20wanted).
- Testing on a device the maintainers do not have (a physical iPad, Linux, macOS) and writing down what you saw.

## Making a change

1. Branch from `main`: `git switch -c fix/short-description`.
2. Keep the change focused. Strict TypeScript, English code and comments, the existing style.
3. Interface strings go through `t()`; add the German entry to `src/app/i18n-de.ts`.
4. Interface changes follow the design rules in AGENTS.md (light paper and dark carbon, accents only
   on app marks, DM Mono labels, 44 px touch targets). Attach light and dark screenshots.
5. New MCP tools: schema in `src/mcp/schemas.ts`, implementation, a test, and a line in
   `src/docs/content.md` and [docs/MCP-TOOLS.md](docs/MCP-TOOLS.md).
6. Behavior changes: update the README, `AGENTS.md` and the guide in `docs/` that covers it, and add a line under
   `## [Unreleased]` at the top of `CHANGELOG.md` in plain words (what changed and why it matters to a user). The
   maintainer picks the version number when a release is cut; you do not need to change it. Add any new source
   repository to `SOURCES.md`.
7. Run the checks:

```sh
npm run typecheck
npm test
npm run test:e2e        # needs Playwright and a browser, see the README; say in the PR if you could not run it
npm run check:clean
npm run check:docs      # every relative link and #anchor in the Markdown files resolves
npm run build
```

8. Open the pull request with the template filled in.

## Reviews

A maintainer replies within a few days; WorkCraft is a small project, so please be patient. Small, focused pull requests are reviewed fastest. If the direction is not clear, open an issue or a discussion first. A review comment is about the code, not you. You do not have to be an expert in the whole code base: say what you tried and where you got stuck.

If an AI coding agent helped you, that is fine. You are responsible for the change: read it, run the checks and describe it in your own words. [AGENTS.md](AGENTS.md) is written for agents too.

## Versions

WorkCraft is in its alpha phase. Pre-release versions look like `0.1.0-alpha.N`; the maintainer raises the number when a release is cut, and `CHANGELOG.md` has one entry per release. See the note at the top of [CHANGELOG.md](CHANGELOG.md) for why the numbering starts at `0.1.0-alpha.1`.

## Commit messages

Short imperative subject (under 72 characters), a blank line, then what changed and why. One topic
per commit.

## License of contributions

By contributing you agree that your contribution is licensed under MIT OR Apache-2.0, like the rest
of WorkCraft (see [LICENSE](LICENSE)), without any additional terms.

## Upstream Attribution and Engine Separation

1. **Workspace vs. Crafting Engines:** WorkCraft provides the workspace shell, window management, project tree, local companion server, and MCP orchestration layer. WordCraft, GridCraft, DeckCraft, and PdfCraft are independent open-source engines created by storytold and the ArtCraft team ([github.com/storytold](https://github.com/storytold)) under `MIT OR Apache-2.0`.
2. **Notice Preservation:** All upstream copyright notices, author credits, and license files in `versions/` must remain completely intact.
3. **Trademark & Compatibility Disclaimers:** WorkCraft is independent and is not affiliated with Adobe Inc. or Microsoft Corporation. References to `.docx`, `.xlsx`, `.pptx`, and `.pdf` formats are used solely for technical compatibility descriptions.
4. **As-Is Provision & IP Inquiries:** WorkCraft is provided "as is" without warranty of any kind. Rights holders may direct intellectual property or takedown inquiries to `visoire@proton.me`. Comprehensive legal notices are available in [docs/LEGAL.md](docs/LEGAL.md).

## Conduct

Be kind and specific. Critique code, not people. Maintainers may edit or close anything that does not
fit this.
