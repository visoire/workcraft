# Publishing WorkCraft on GitHub

A step-by-step guide for the maintainer. **Nothing in this repository uploads anything by itself.** Every script prints what it would do
(a *dry run*) until you add `-Execute` (PowerShell) or `--execute` (bash). No token or key is stored anywhere: the GitHub CLI (`gh`) keeps its own sign-in.

Target repository: **`visoire/workcraft`** (public, MIT OR Apache-2.0). Its sibling is `visoire/workcraft-ai` (the Rust desktop AI chat), which has
the same scripts and its own guide. The website (`visoire/workcraft-home`, private) is never published; its `SETUP.md` (only
in that private checkout) explains how both are deployed together.

## 0. What is ready

| Part | Where |
| :--- | :--- |
| README with the two ways in (use it in the browser, or run it yourself), license (`LICENSE`, `LICENSE-MIT`, `LICENSE-APACHE`) | `README.md` |
| Community files | `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `SUPPORT.md`, `CONTRIBUTORS.md` |
| Issue forms (bug, feature, task, documentation), PR template, labels, code owners, Dependabot | `.github/ISSUE_TEMPLATE/*`, `.github/pull_request_template.md`, `.github/labels.yml`, `.github/CODEOWNERS`, `.github/dependabot.yml` |
| Description, topics, features | `.github/repo.json` (single source for the scripts; `npm run github:metadata` is the older, equivalent helper) |
| CI and release workflows | `.github/workflows/ci.yml` (type check, tests, clean check, docs check, build; Linux and Windows), `.github/workflows/release.yml` |
| Changelog and release notes | `CHANGELOG.md` (the first public entry is `0.1.0-alpha.1`), `docs/releases/<version>.md` |
| Documentation map and the self-hosting guide | `docs/README.md`, `docs/SELF-HOSTING.md` |
| Scripts | `scripts/publish.ps1` (Windows PowerShell) and `scripts/publish.sh` (bash) |

`publish.ps1 check`, `status` and the dry runs were run on Windows. `publish.sh` has the same commands but was **not run** (no bash on the machine it was written on).

## 1. The git history

This repository starts with a **fresh history**: one commit, "first public alpha". The project's earlier history (five commits from its first days under the
former name OpenCraft, a `v1.0.0` tag, a remote called `opencraft-ide`, and the author address of the maintainer's private identity) was **moved, not deleted**, to a
folder outside this repository (`archive/workcraft-git-history-before-public` next to the two project folders), so it cannot be published by accident.

What was prepared, and how to check it before you push:

```powershell
git log --stat -1          # the one commit
git ls-files | Measure-Object   # the files that would be published (the same set `publish.ps1 check` scans)
git remote -v              # origin = https://github.com/visoire/workcraft.git (nothing is pushed)
git log -1 --format="%an <%ae>"  # the author shown on GitHub
```

The author is `visoire <visoire@users.noreply.github.com>`, set in this repository's own git config only (never in your global config). If you prefer another name or
address, change it before the first push: `git config user.email <address>` then `git commit --amend --reset-author --no-edit`. Do not use a private address you do not
want in a public history: it is part of every commit for good.

Other things to know:

- Line endings: `.gitattributes` stores text files with LF (`* text=auto`) and keeps `versions/` byte for byte (`-text`), because the four web apps there are loaded with
  Subresource Integrity checks. A warning "LF will be replaced by CRLF" on Windows is normal.
- Files that are local scratch and must not be published are listed in `.gitignore` (`scripts/gen-fahrschule.mjs`, `scripts/read-all-pdfs.mjs`: private
  documents of one person; they were never committed). `publish.ps1 check` also looks for personal home paths, keys and tokens.
- This repository is written from the private monorepo `visoire/workcraft-monorepo` (`scripts/split-repos.mjs`). Changes made here must be carried back
  there, or the next split overwrites them.
- `versions/` holds the four engine web builds (about 190 MB in total, the largest file 58 MB) and is tracked on purpose. Every file is under GitHub's 100 MB
  limit; the first push is large, so use a good connection. The other web builds, source trees and archives are git-ignored local data.
- The old internal changelog (alpha 1 to 20) is not in the public `CHANGELOG.md`. A copy is kept in the `archive/` folder next to the two project folders.

## 2. One-time setup on your computer

```powershell
winget install --id GitHub.cli
gh auth login          # GitHub.com, HTTPS, "Login with a web browser": no token is pasted anywhere
gh auth status
```

## 3. Before the first push

1. Screenshots: `docs/images/` holds real screenshots of the workspace (light and dark); the README shows them. Replace them when the interface changes. No private files in them.
2. Run the project checks: `npm run typecheck`, `npm test`, `npm run check:clean`, `npm run check:docs`, `npm run build` (and `npm run test:e2e`, `npm run test:ipad` when you changed the interface).
3. Run the publish check:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/publish.ps1 check
   ```

   It scans every file that would be published for API keys, tokens, private keys, personal home paths, binaries and files over 10 MB, and checks that the
   community files, the changelog entry and the alpha wording exist. Fix every `FAIL`. A real key found anywhere must be **revoked at the provider**.
4. Check the hosted browser version: build, serve `dist/` from any static host and open it (see [SELF-HOSTING.md](SELF-HOSTING.md), "Check it").

## 4. Create the empty repository and push

In the browser: <https://github.com/new>, owner `visoire`, name `workcraft`, **Public**, with *no* README, .gitignore or license. Or:
`powershell -ExecutionPolicy Bypass -File scripts/publish.ps1 create -Execute`. If the name `workcraft` already holds an older repository, rename or archive it first.

```powershell
# (the repository and its origin are already set up, see section 1)
powershell -ExecutionPolicy Bypass -File scripts/publish.ps1 push -Message "WorkCraft 0.1.0-alpha.1: first public alpha"             # dry run
powershell -ExecutionPolicy Bypass -File scripts/publish.ps1 push -Message "WorkCraft 0.1.0-alpha.1: first public alpha" -Execute    # asks you to type yes
```

## 5. Settings

```powershell
powershell -ExecutionPolicy Bypass -File scripts/publish.ps1 meta -Execute      # description, homepage, topics, Issues and Discussions on
powershell -ExecutionPolicy Bypass -File scripts/publish.ps1 labels -Execute
```

`.github/repo.json` has the description, the homepage (set it to `https://workcraft.cc/` so the repository page links to the browser version) and the topics.

By hand: *Settings > General > Social preview* (1280x640 image), *Settings > Code security* (Dependabot alerts, secret scanning, push protection), and branch protection for `main` once you have collaborators.
Turn on *Discussions*: `SUPPORT.md` and the issue chooser point to them.

## 6. Publish the alpha pre-release

```powershell
powershell -ExecutionPolicy Bypass -File scripts/publish.ps1 release -Execute
```

This tags `v0.1.0-alpha.1` and pushes the tag. `.github/workflows/release.yml` creates the **pre-release** with the notes from `docs/releases/0.1.0-alpha.1.md`; GitHub adds the source
archives. There are no binaries: the workspace runs from source (`npm install`, `npm run build`, `npm start`) or as the browser version. Check the release page afterwards.

## 7. Every later release

Contributors and agents add their changes under `## [Unreleased]` in `CHANGELOG.md`. To cut a release:

1. Turn `[Unreleased]` into `## [0.1.0-alpha.N] - YYYY-MM-DD` (`publish.ps1 changelog -New -Execute` makes an empty entry) and add a fresh empty `## [Unreleased]`.
2. Raise the number in `package.json`, `package-lock.json` (two places), `src/core/version.ts` and the version line of `README.md`.
3. Write `docs/releases/<version>.md`.
4. Keep the website in step: the same version in its `public/workspace.json` and a new release in `public/changelog.json`.
5. `check`, `push -Execute`, `release -Execute`. Then build the workspace and the website and upload the website, so `workcraft.cc/app` runs the new release.

## 8. If a secret was committed

Revoke or rotate the key at the provider first. That is the only fix that counts. Then remove it from the files, commit, and consider a fresh history. GitHub push protection blocks most keys before they leave your computer.

## 9. Troubleshooting

| Problem | Fix |
| :--- | :--- |
| `gh: command not found` | Open a new terminal after installing |
| `gh auth status` says not logged in | `gh auth login` |
| `remote origin already exists` or points at another repository | `git remote set-url origin https://github.com/visoire/workcraft.git` |
| Push rejected (the remote has commits) | The new repository was created with a README. Recreate it empty, or `git pull --rebase origin main` once |
| `check` flags a path like `C:\Users\<name>\` | A personal path: replace it with `<home>` or `%USERPROFILE%` |
| A file is "not published" but you want it | `git check-ignore -v <file>` names the `.gitignore` rule |
