# WorkCraft documentation

Start here. Pick the line that matches you.

## I want to use WorkCraft

| I want to | Read |
| :--- | :--- |
| try it in the browser without installing anything | [workcraft.cc/app](https://workcraft.cc/app/) |
| run it on my computer | [README, Quick start](../README.md#quick-start) |
| use it on an iPad or with the Apple Pencil | [IPADOS-GUIDE.md](IPADOS-GUIDE.md) |
| connect an AI model (Ollama, Claude, ChatGPT, Gemini, DeepSeek and more) | [AI-PROVIDERS.md](AI-PROVIDERS.md) |
| use voice input | [VOICE.md](VOICE.md) |
| learn every feature | the in-app documentation: the WorkCraft menu, Documentation, or `http://localhost:5175/docs/` (source: [src/docs/content.md](../src/docs/content.md)) |
| host the browser version for my team, or run the server at home | [SELF-HOSTING.md](SELF-HOSTING.md) |

## I want to contribute

| I want to | Read |
| :--- | :--- |
| make my first pull request | [CONTRIBUTING.md](../CONTRIBUTING.md) |
| find my way around the code | [AGENTS.md](../AGENTS.md) (the directory map and the rules; written for AI coding agents and just as useful for people) |
| understand how the pieces fit | [ARCHITECTURE.md](ARCHITECTURE.md) |
| add or change an MCP tool | [MCP-TOOLS.md](MCP-TOOLS.md) |
| work on workspaces and apps | [ECOSYSTEMS.md](ECOSYSTEMS.md), then [UPDATING.md](UPDATING.md) to update an app or add one |
| work on light and dark mode | [THEMING.md](THEMING.md) |
| work on iPadOS | [IPADOS-COMPAT.md](IPADOS-COMPAT.md) (the register of compatibility measures and the engine contract) |
| understand where the tokens of an AI request go | [AI-TOKENS.md](AI-TOKENS.md), [AI-SUPPORT-REFERENCE.md](AI-SUPPORT-REFERENCE.md) |
| report a bug, an idea or a documentation problem | [open an issue](https://github.com/visoire/workcraft/issues/new/choose) |

## I maintain the project

| I want to | Read |
| :--- | :--- |
| publish or release on GitHub | [PUBLISHING.md](PUBLISHING.md) |
| see where an idea or a dependency came from | [SOURCES.md](../SOURCES.md) |
| check licences, trademarks and notices | [LEGAL.md](LEGAL.md) |
| see what changed | [CHANGELOG.md](../CHANGELOG.md) |

## Keeping the docs true

Docs change with the code, in the same pull request. `npm run check:docs` checks that every relative link and `#anchor` in the Markdown files points at something that exists (it also runs in CI). The in-app documentation lives in one file, `src/docs/content.md`; German interface strings live in `src/app/i18n-de.ts`.
