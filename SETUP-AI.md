# Set up WorkCraft: for AI assistants

This page is written for an AI assistant or coding agent (Claude Code, Codex, Cursor, Gemini, Antigravity or any other) whose user
said **"set up WorkCraft"** (or "install WorkCraft", "start WorkCraft", "make WorkCraft start by itself"). Do the steps below, one after the
other, and tell the user the result at the end. The user does not need to know anything technical.

> A user who wants to do it by hand: double-click **Start WorkCraft.cmd** (Windows) or **Start WorkCraft.command** (macOS), or run
> `sh start-workcraft.sh` (Linux). That does the same as this page.

## What WorkCraft is, in one line

A local-first workspace in the browser (documents, spreadsheets, presentations, PDFs and dozens of other apps, with an AI assistant). Setting it
up means: a small local server that serves it on `http://127.0.0.1:5175/`, started now and, if the user wants, every time they sign in.
It needs **no administrator rights**, no Docker and no account. Without any setup it also runs at <https://workcraft.cc/app/> (browser only).

## Rules for you

- Never use `sudo`, "Run as administrator" or any change to system settings. Everything below works as the normal user.
- Never write an API key, a password or a token into a file or into the chat. Keys are typed by the user in WorkCraft, Settings, AI models.
- Do not push, tag or publish anything. Do not touch other repositories.
- Do not run tests against ports 5175 and 5176 of a development setup: that is the user's real data.
- Say what you did in plain words. If a step fails, show the last lines of the error and what you will try next.

## Step 1: get WorkCraft

If you are already inside a folder that has `scripts/setup.mjs`, skip to step 2.

Download the newest **workcraft-local** file from the releases page <https://github.com/visoire/workcraft/releases> (the releases are pre-releases while
WorkCraft is in alpha, so the "latest" button may be empty: take the top one). Unpack it into a folder the user owns, for example
`~/WorkCraft` (macOS, Linux) or `%USERPROFILE%\WorkCraft` (Windows).

```powershell
# Windows PowerShell
$rel = (Invoke-RestMethod https://api.github.com/repos/visoire/workcraft/releases)[0]
$asset = $rel.assets | Where-Object name -like 'workcraft-local-*.zip' | Select-Object -First 1
Invoke-WebRequest $asset.browser_download_url -OutFile "$env:TEMP\$($asset.name)"
Expand-Archive "$env:TEMP\$($asset.name)" -DestinationPath "$env:USERPROFILE\WorkCraft" -Force
cd "$env:USERPROFILE\WorkCraft"
```

```sh
# macOS and Linux
url=$(curl -fsSL https://api.github.com/repos/visoire/workcraft/releases | grep -o '"browser_download_url": *"[^"]*workcraft-local-[^"]*\.zip"' | head -n 1 | sed 's/.*"\(https[^"]*\)"/\1/')
mkdir -p ~/WorkCraft && curl -fsSL "$url" -o /tmp/workcraft-local.zip && unzip -oq /tmp/workcraft-local.zip -d ~/WorkCraft && cd ~/WorkCraft
```

Developers can also `git clone https://github.com/visoire/workcraft` (then step 2 builds it, which takes a few minutes more).

## Step 2: run the setup

Run it with `--yes` so that it asks nothing. It sets up what is missing, starts the server, writes a shortcut, switches autostart on and opens the browser.

| System | Command (in the WorkCraft folder) |
| :--- | :--- |
| Any system with Node 22 or newer | `node scripts/setup.mjs --yes` |
| Windows, whether or not Node is installed | `.\"Start WorkCraft.cmd" --yes` |
| macOS, Linux, whether or not Node is installed | `sh start-workcraft.sh --yes` |

If the computer has no Node 22 or newer, the launchers download a private copy of Node from nodejs.org into the folder `.runtime`, check it against
nodejs.org's checksum file and use it. Nothing is installed on the system. The first start also fetches the components WorkCraft needs (`npm ci`,
a few minutes, needs the internet once).

Useful flags: `--no-autostart` (do not start at sign-in), `--no-open` (do not open the browser), `--lan` (also share on the home network, for an iPad),
`--port 5180` (another port), `--dry-run` (show what would happen), `--json` (machine readable answer).

## Step 3: check it

```sh
node scripts/setup.mjs --status --json
```

`"running": true` and `"autostart": true` mean it works. You can also fetch `http://127.0.0.1:5175/api/health` (HTTP 200). The log is in `~/workcraft/logs/server.log`.

## Step 4: tell the user

Say, in plain words: WorkCraft is running at `http://127.0.0.1:5175/` (it opened in the browser), their files are in `~/workcraft/projects`, it starts by itself when they
sign in (unless they said no), and how to stop it (`node scripts/setup.mjs --stop`) or remove the autostart (`node scripts/setup.mjs --remove-autostart`). Then offer the
next steps, each only if the user wants it:

- **An AI model.** In WorkCraft, Settings, AI models: install Ollama for private local models, or enter an API key themselves. Do not ask them to paste a key to you.
- **Voice input.** Install Handy from <https://github.com/cjpais/Handy> and download one speech model in it (WorkCraft finds it by itself), or enter a speech server in
  Settings, Voice input.
- **iPad.** Run the setup again with `--lan`, then open Settings, iPad and network and scan the QR code with the iPad. See `docs/IPADOS-GUIDE.md`.
- **Back up.** Project menu, Back up everything (ZIP).

## If something goes wrong

| Symptom | What to do |
| :--- | :--- |
| `npm ci` fails | The internet connection or a proxy. Run the setup again; on a company network ask for the npm proxy settings. |
| The server does not answer within a minute | Read `~/workcraft/logs/server.log`. A port that is taken: run with `--port 5180`. |
| "WorkCraft needs Node 22" | Use the launcher (`Start WorkCraft.cmd` or `start-workcraft.sh`), it brings its own Node. |
| macOS blocks the file | Right-click `Start WorkCraft.command`, choose Open, then Open. Or run `sh start-workcraft.sh`. |
| The terminal panel does not open | The optional `node-pty` component could not be built on this machine. Everything else works. |
| The user wants it gone | `node scripts/setup.mjs --stop`, `--remove-autostart`, then delete the WorkCraft folder. Their files stay in `~/workcraft` until they delete that too. |

## Updating later

Download the newest `workcraft-local` file, unpack it over the same folder, run `node scripts/setup.mjs --yes` again. The user's files in `~/workcraft` are not touched.
