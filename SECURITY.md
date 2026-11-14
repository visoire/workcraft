# Security policy

## Supported versions

| Version | Supported |
| :--- | :--- |
| 0.1.0-alpha.N (latest alpha) | yes |
| earlier alphas and development builds | no |

WorkCraft is in its alpha phase; only the newest alpha receives fixes. The hosted browser version at
[workcraft.cc/app](https://workcraft.cc/app/) always runs the newest release.

## Reporting a vulnerability

Please do not open a public issue for security problems.

Report them privately through [GitHub security advisories](https://github.com/visoire/workcraft/security/advisories/new).
Include the version or commit, your system and browser, the steps to reproduce and what an attacker
could do. You get an answer within a few days; WorkCraft is a small project, so fixes are made as
fast as one person can.

## Security model in short

- The server listens on `127.0.0.1` only. Home network mode (`npm run dev:lan`, `npm run start:lan`)
  needs a pairing token; other devices without it are refused.
- Requests from other origins are rejected (DNS rebinding and cross-site protection); WorkCraft pages
  and the apps get a strict Content Security Policy.
- API keys stay in `~/workcraft/config.json` on your machine; the browser sees masked values only.
  In browser mode without a desktop, keys stay in memory until a reload, and keeping them in the
  browser's storage is an opt-in behind a warning. Local-only mode blocks every cloud provider.
- MCP tools that change things outside the project or run commands ask for approval; external MCP
  servers run in a sandbox with an approval rule.
- Cloud storage is opt-in. Google Drive uses your own OAuth client (PKCE, loopback redirect); the tokens stay in
  `~/workcraft/config.json`, and Local-only mode blocks the connection. Files removed in Drive go to its trash.
- The Craft apps found on the computer run as MCP servers with an approval rule (default: changes ask first).
- No third-party scripts and no CDN.

- The hosted browser version has no server behind it: your files stay in your browser, and an API key you type is
  kept in memory until you reload (storing it in the browser is an opt-in behind a warning).

In scope: WorkCraft frontend (also the hosted browser version), the Node server, the MCP server and tools, home network pairing.
Out of scope: the four engines themselves (report to their repositories under
[github.com/storytold](https://github.com/storytold)) and models or providers you connect.
