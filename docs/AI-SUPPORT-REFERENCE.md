# AI support reference

The working reference for how WorkCraft talks to models. It condenses the offline provider snapshot of
25.10.2026 (`artifical-intelligence/documentation/documentations 25.10.2026`: Claude, OpenAI, Gemini, Grok,
DeepSeek, GLM, MCP, local LLM) and ties it to the code in `src/chat/` and `src/server/`. For setup steps and
privacy see [AI-PROVIDERS.md](AI-PROVIDERS.md).

Read this with two cautions. The snapshot names models of its time (Claude 3.7, GPT-4o, o3); WorkCraft's
defaults are newer (`claude-sonnet-5-5`, `gpt-5`, `gemini-2.5-flash`, `deepseek-flash`). Treat model names and prices
as examples and check the provider before shipping a change. The snapshot's `local-llm/README.md` also lists an
`ollama/` folder (API reference, Modelfile guide, hardware page) that is not in the snapshot; the Ollama facts below
come from `local-llm/a.txt` (context length), the other local-llm pages and measurements on this machine.

## 1. One architecture for every provider

| Layer | Rule | Where |
| :--- | :--- | :--- |
| Transport | plain `fetch`, no SDKs, one adapter per wire format | `src/chat/adapters/`, `providers.ts` |
| Stream | every adapter yields the same events: start, text, reasoning, tool_start, tool_call, usage, done | `providers.ts` |
| Tools | one Zod schema list, compiled per provider, sorted so the prompt cache hits | `src/mcp/schemas.ts`, `compileToolSchema` |
| Reasoning | one effort scale (Off, Low, Medium, High, Max) mapped per model | `src/chat/models.ts` |
| Budget | the backend shortens a request to fit the window instead of failing | `src/chat/budget.ts` |
| Usage | one record shape: input, output, cached, cache miss, reasoning, timing | `src/server/usage.ts` |
| Privacy | cloud providers blocked in Local-only mode, every outgoing request audited | `src/server/ai.ts`, `audit.ts` |

Request order is fixed for cache hits: core system prompt, tool schemas (sorted), project context, then the
conversation. Never reorder tools or put volatile text (time, ids) before the conversation.

## 2. Wire formats side by side

| | Claude | ChatGPT | Gemini | DeepSeek, Grok, GLM, Ollama |
| :--- | :--- | :--- | :--- | :--- |
| Endpoint | `/v1/messages` | `/v1/responses` (chat completions fallback) | `:streamGenerateContent?alt=sse` | `/chat/completions` |
| Auth | `x-api-key`, `anthropic-version` | Bearer | `x-goog-api-key` | Bearer (Ollama: none) |
| System prompt | top-level `system` | `developer` role | `systemInstruction` | `system` message |
| Tool result | `user` message, `tool_result` block | `tool` role | `user` message, `functionResponse` part | `tool` role |
| Max output | `max_tokens` (required) | `max_completion_tokens` | `generationConfig.maxOutputTokens` | `max_tokens` |
| Reasoning in | `thinking` / `output_config.effort` | `reasoning.effort` | `thinkingLevel` (3.x) or `thinkingBudget` (2.5) | DeepSeek `thinking`; Ollama `reasoning_effort` |
| Reasoning out | `thinking_delta` + `signature` | summaries (encrypted items) | parts with `thought: true` | `reasoning_content` (DeepSeek), `reasoning` (Ollama) |
| Cache | explicit `cache_control` | automatic, `prompt_cache_key` | implicit, explicit `cachedContents` | automatic prefix (Ollama: local) |

## 3. Provider notes

### Claude
- `max_tokens` is mandatory and must exceed `thinking.budget_tokens` (minimum 1,024).
- With extended thinking, `temperature` must be 1 or omitted; `top_p` and `top_k` must not be changed.
- **Thinking blocks and their `signature` go back unchanged** in tool loops, otherwise the API answers 400.
  Interleaved thinking: expect a new thinking block after every tool result.
- Cache with `cache_control` on the last tool, the system prompt, the largest document and the last block. Minimum
  1,024 tokens (2,048 for Haiku). Count exactly with `/v1/messages/count_tokens`.
- Best for: careful multi-file edits and long tool chains.

### ChatGPT
- Reasoning models reject `max_tokens` (use `max_completion_tokens`) and any `temperature` other than 1. A low limit
  can be spent entirely on hidden reasoning and leave an empty answer (`finish_reason: length`).
- The Responses API keeps reasoning items; Chat Completions hides them. Replay encrypted reasoning items in tool loops.
- Cache is automatic from 1,024 tokens; use a stable `prompt_cache_key` per chat.
- Count locally with `o200k_base`; add about 3 tokens per message.
- Best for: structured outputs (`strict: true`), predicted outputs on quick edits, vision.

### Gemini
- **Return `thoughtSignature` verbatim** with its function call, or the API answers 400 INVALID_ARGUMENT.
- Parallel calls: answer all of them in one `user` turn, and match every `functionResponse` to the call `id`.
  There is no `tool` role.
- Count with `models.countTokens` (the tokenizer differs by up to 25% from BPE; media has fixed costs).
- Cache: implicit from 2,048 tokens (4,096 on Gemini 3), explicit `cachedContents` for big fixed documents.
- Best for: very long documents, PDFs, audio and video, cheap Flash runs.

### DeepSeek
- Reasoning arrives as `reasoning_content`. In thinking mode **send the `reasoning_content` of every earlier assistant
  turn back**, with an empty string when there is none, or the API answers 400.
- A named `tool_choice` is rejected in thinking mode, so WorkCraft turns thinking off for forced tools.
- Effort accepts low, high and max (medium maps to high). Prefix cache starts at 64 tokens.
- Count exactly with the built-in V4 tokenizer. `finish_reason: length` drops the tool calls (arguments may be cut).
- Best for: low-cost coding and long agent runs; FIM for inline completion.

### Grok (xAI)
- Preset **Grok**: `https://api.x.ai/v1`, `/chat/completions`, Bearer key, model `grok-4.7` (code and chat, 500k context,
  long-prompt pricing doubles from 200k tokens). The snapshot's quick start uses the Responses API; Chat Completions is
  the documented OpenAI-compatible path and carries tools, streaming and `reasoning_content` the same way.
- No reasoning parameter is sent (the snapshot lists `reasoning_effort` only for the small reasoning models). Usage,
  including cached tokens, is read from `usage.prompt_tokens_details.cached_tokens`. Cache is automatic from 1,024 tokens.
- Count locally with `o200k_base` (WorkCraft estimates and marks the number as an estimate for endpoints without usage).
- Best for: real-time data (web search tool), fast long agent runs, vision.

### GLM (Z.ai / Zhipu)
- Preset **GLM**: `https://api.z.ai/api/paas/v4`, `/chat/completions`, Bearer key, model `glm-5.3` (reasoning, 1M context);
  `glm-5.3-flash` is the cheap native multimodal model, `glm-5.3-flashx` the fast one, `glm-4.7` (128k) the economy
  one. The snapshot names two base URLs (`https://api.z.ai/v1` in the overview, `https://api.z.ai/api/paas/v4` in the
  SDK examples and for the mainland platform `https://open.bigmodel.cn/api/paas/v4`); the preset uses the `paas/v4`
  form, change it in Settings if your key needs another one.
- Reasoning is a switch plus an effort: `thinking: {type: "enabled" | "disabled"}` and `reasoning_effort` low, high or
  max (medium maps to high; Off sends `disabled`). A forced tool call turns thinking off, as for DeepSeek.
  Thinking streams as `delta.reasoning_content` and shows as a Thought process card.
- Cache is automatic prefix caching (`prompt_tokens_details.cached_tokens`; $0.26 per million on GLM-5.3, $0.03 on Flash).
- Official MCP servers for Vision, Web Search, Reader and Zread exist and can be added under MCP servers.

### More presets
Mistral (`https://api.mistral.ai/v1`), Groq (`https://api.groq.com/openai/v1`), OpenRouter
(`https://openrouter.ai/api/v1`), Together AI (`https://api.together.xyz/v1`) and LM Studio (`http://127.0.0.1:1234/v1`,
local) are plain Chat Completions presets. `stream_options.include_usage` goes only to hosts known to accept it
(Mistral gets none), so no unknown field reaches a strict endpoint. Anything else is a **Custom** endpoint.

### MCP
JSON-RPC 2.0 over stdio, SSE or Streamable HTTP. WorkCraft is both sides: its **server** at `/mcp` (Streamable HTTP)
carries the project tools plus every connected external tool, and its **client** (`src/server/mcp.ts`) starts or
reaches other servers: your own, plugins, and the Craft apps found on the computer (section 8). The same Zod
definitions are converted to each provider's tool format. Validate every call, send invalid arguments back once for
self-correction, serialize writes to one file, stop after three identical failing calls. External tools are named
`ext-<server>-<tool>`, carry an approval rule (`ask`, `read`, `all`) and run in a sandbox (clean environment).

## 4. Choosing a model

| Task | First choice | Local or low cost |
| :--- | :--- | :--- |
| Editing documents, sheets, slides with many tool calls | Claude Sonnet | Qwen2.5 7B or Qwen3.5 4B through Ollama |
| Hard reasoning, math, formula audits | ChatGPT reasoning model, Claude with high effort | DeepSeek-R1 distill (14B+ needs more than 6 GB) |
| Long PDFs and mixed media | Gemini Flash or Pro | none on small GPUs |
| Bulk work, background agents, Team Mode workers | DeepSeek Flash, GLM-5.3-Flash | Ollama workers (Fast Local/Hybrid Team) |
| Coding agents with a big repository in context | GLM-5.3 (1M), Grok 4.7 (500k), Claude Sonnet | Qwen2.5-Coder 32B on 24 GB |
| Screenshots, UI review, visual loops | GLM-5.3-Flash, Gemini Flash, Claude | Qwen2.5-VL through Ollama |
| One key for many hosted models | OpenRouter | |
| Inline code completion | DeepSeek FIM | Qwen2.5-Coder 7B |
| Fully private work | Ollama, Local-only mode | |

## 5. Ollama in WorkCraft

What the code does today:

1. **Native API.** Chats go to `http://127.0.0.1:11434/api/chat` (`src/chat/adapters/ollama.ts`), newline-delimited
   JSON, no key. The OpenAI-compatible `/v1` is not used: OpenClaw's Ollama docs warn that it breaks tool calling for
   some models (tool JSON arrives as plain text) and it cannot set the context, thinking or keep-alive per request.
   (Checked here: both models called tools correctly through `/v1` too, so the main reasons to prefer the native API
   are the controls below.)
2. **Per request.** `options.num_ctx` (the context), `think` (true, false, or low/medium/high for gpt-oss),
   `keep_alive` (15 minutes), `truncate: false` (an overlong prompt is an error with a message, not a silent cut of
   the history), and tools as parsed objects. `think` is only sent when `/api/show` lists the `thinking` capability,
   tools only when it lists `tools`, images only for `vision`; servers that report no capabilities get no `think`.
3. **Context window.** Ollama starts every model with 4096 tokens unless VRAM allows more (under 24 GiB: 4k,
   24 to 48 GiB: 32k, from 48 GiB: 256k). Ollama's own guidance: agents and coding tools want at least 64k.
   Every request to one model must send the same size, otherwise Ollama reloads the model.
4. **Automatic size (default).** Loads the model at 64k, 32k, 16k and keeps the largest that stays at least 97% in
   GPU memory; 16k is the floor. Remembered six hours. Settings shows the GPU share when a model spills to the CPU.
5. **Reasoning menu.** Off sends `think: false`, Auto leaves the model default. Reasoning streams in the `thinking`
   field and appears as a Thought process card; within a running tool chain it is sent back with the assistant turn.
6. **Usage.** `prompt_eval_count` and `eval_count` are exact, and the prompt count stays the full prompt size when
   the model's prefix cache is hit (423 tokens on every repeat, prompt time 2.9 s then 0.06 s).
7. **Old copies.** Versions before this one made `wc-<model>-ctx<size>` models; they are deleted once.
8. **Local-only mode** treats Ollama and private-network endpoints as local; cost is always $0.

Measured on this PC (GTX 1660 Ti 6 GB, 32 GB RAM, Ollama 0.40.11), generation speed in tokens per second:

| Model | 8k | 16k | 32k | 64k | Automatic picks |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Qwen3.5 4B (Q4_K_M, 3.1 GB) | 59 (100% GPU) | 61 | 33 (77% GPU) | 17 (60% GPU) | 16k, fully on the GPU |
| Qwen2.5 7B (Q4_K_M, 4.4 GB) | 23 (79% GPU) | 12 at 32k | | | 16k, 73% on the GPU (does not fit) |

Thinking, same machine, Qwen3.5 4B: "name three colors" takes 2.9 s with the default (about 150 thinking tokens) and
0.2 s with `think: false`. "17*23" with a 300-token limit gave an empty answer by default because thinking used
the whole budget. WorkCraft's first 19 tools and the system prompt used about 2,500 tokens (measured); there are 24 tools now, so check the number before you shrink a window.

Pitfalls:
- A bigger context is not free: KV cache grows with it, and a split model runs several times slower.
- The model's own limit still applies (Qwen2.5 stops at 32k).
- Sending `think` to a model without the capability makes Ollama answer 400, so it is gated on `/api/show`.
- Four parallel Team Mode workers on one local model queue behind each other on a small GPU; raising
  `OLLAMA_NUM_PARALLEL` multiplies the KV cache by the same factor.
- The snapshot suggests `@modelcontextprotocol/server-ollama` for Claude Desktop; that package name is not verified.
  WorkCraft does not need it.

Ideas taken from the other material in `artcraft/artifical-intelligence` and not built yet:
- **Tool Search / schema pruning** (OpenClaw Tool Search, MCPHub smart routing, the context-enrichment guide): give
  small models a short tool list and a search tool once external MCP servers push the schemas past a quarter of the
  window. Not needed with the 24 built-in tools.
- **Repeated-failure stop** (OpenClaw): built since this section was written (`src/chat/loop-guard.ts`, three
  identical failing calls end the turn).
- **Repetition stop** for models up to 32B that loop on long output.
- **Memory guard** (local-llm-mcp): refuse a local call when free RAM is low. Ollama already offloads layers, so this
  only matters for machines with little RAM.
- **Fallback model** (OpenClaw model failover): when Ollama is down, continue on a cloud model if the user allows it;
  Local-only mode must keep blocking it.
Model sizing for other machines (snapshot, Q4_K_M): 8 GB runs a 7B model, 12 GB a 14B, 24 GB a 32B (Qwen2.5-Coder
32B is the usual agent pick). Prefer Q4_K_M; use Q5 or Q8 only when VRAM is spare.

## 6. Single mode and Team mode

The chat header switches between **Single** (one assistant with tools) and **Team** (an orchestrated group).
`src/chat/team.ts` holds the model (no DOM), `team-runner.ts` drives it with real models, `team-ui.ts` and
`agents-ui.ts` draw it.

**Specialists per app.** Besides the five historic roles (grid, word, deck, pdf, dev) every other app of
`src/ecosystems/catalog.json` has a generated specialist (`src/chat/app-roles.ts`, role id = app id, mention `<app>-agent`).
`toolAllowed` (`src/chat/team.ts`) gives it the `ext-<app>-*` tools of its own MCP server; `dev` keeps only the servers that
are not Craft apps. A web-only app (`origin: independent`) gets `open-in-app`, `read-file`, `write-file` and `file-history`
instead. `ecosystemTeam()` builds the team of a workspace (one preset per built-in ecosystem, `eco-<id>`, and one for the
workspace in use). Routing (`rolesOfRequest`, `autoRoute`) reads file types from the catalog and app names from the prompt.
The role of a chat request is any id (`^[\w-]{1,40}$`): the server used to accept only the five historic roles.

**Agents.** Five built-in specialists (GridCraft, WordCraft, DeckCraft, PdfCraft, Code) and any number of agents you
create (Settings, Team Mode, New agent): name, a role line the leader reads, a system prompt, provider, model, effort,
tool patterns, a color and an icon. Agents live in `config.team.agents`, teams refer to them by id (`a-<slug>`), and a
deleted agent leaves every team. Tool patterns: `*`, `read-*`, `ext-photocraft-*`, `app:gridcraft` (all tools of an
app). Skills are always readable. Address one directly with `@name`; `@team` runs the whole team.

**Patterns** (`TeamConfig.pattern`):

| Pattern | What happens |
| :--- | :--- |
| Supervisor and workers | The leader plans a task graph, independent tasks run in parallel up to the concurrency limit, the leader reviews each result (or automatic checks only) and writes the answer |
| Sequential | The plan's tasks are chained in order; each agent receives the results before it |
| Parallel | Every dependency is dropped; all agents start at once |
| Human in the loop | Like supervisor, but the plan waits for your Approve or Reject; a refusal stops the run before any agent starts. Tool calls that need approval are asked per agent either way |

**Shared memory.** What a finished task reported (400 characters, files changed) is written to `TeamState.memory` and
handed to every agent that starts later in a `<team-memory>` block, next to the `<dependencies>` of its own tasks.
Switch it off per team.

**Status.** Each agent card shows one of idle (queued), thinking, using `<tool>` (with the app icon for Craft tools),
waiting for you (approval or review), finished or failed, plus the live line of what it writes. Lanes carry the
agent's color and icon; usage is counted per role. Saved teams and presets are in the team editor; presets include
a sequential Document Pipeline and an Approved Launch Team.

**Rules that keep runs safe:** at most 10 tasks, no cycles (repaired once), a task whose dependency failed is
skipped, writes to one file are serialized, Stop All Agents ends every stream, and Undo covers every file a team wrote.

## 7. Skills

Skills use the open agentskills.io layout: a folder with `SKILL.md` (front matter `name`, `description`) and optional
`references/`. The prompt carries one line per skill; the model reads one with `read-skill` (and `list-skills`) when it
needs it, so skills cost nothing until used. WorkCraft ships the 13 artcraft-skills in `skills/`, and scans in this
order (first name wins): `~/workcraft/skills`, `~/.agents/skills`, `~/.claude/skills`, the bundled folder. Settings,
Connect other IDEs installs the bundled ones for other agents without overwriting yours. Paths inside a skill cannot
climb out of its folder.

## 8. Craft apps as MCP servers

`src/server/craft.ts` finds the 19 apps that ship a CLI (WordCraft, GridCraft, DeckCraft, PdfCraft, PhotoCraft, VectorCraft,
LightCraft, DesignCraft, FilmCraft, EffectCraft, SoundCraft, CADCraft, FigCraft, MailCraft, TextureCraft,
MaterialCraft, SolidCraft, AniCraft, Craft Anything) by their `<app>-cli` in Program Files, the
Applications folder and the PATH, and connects `<app>-cli mcp` over stdio. The independent apps of the catalog have no
CLI; the AI reaches their files through the project and opens them with `open-in-app`. A server that fails to start is retried
with a growing delay, and a call that finds the connection gone reconnects once (see MCP-TOOLS.md, "Reliability of external servers"). The document suite is on by default, the
others are switched on in Settings, Craft apps. When the desktop app runs with `--control <port>` (Open in Settings does
that), its live flag (`--connect`, `--bridge`, `--attach`, per app) drives the open window instead of working on files.
The approval rule for their tools defaults to *read*: reads run freely, changes ask first. Tool cards, the `/` list and
the team lanes show the app icon (`public/assets/craft/<app>.png`).

## 9. Other IDEs and agent platforms

`GET /api/bridge` builds copy-and-paste snippets for the MCP address (`http://127.0.0.1:<port>/mcp`, Streamable HTTP;
other computers on the home network add the pairing token header). Formats follow `ide_documentations`: Antigravity
`mcp_config.json`, Cursor `mcp.json` (`url`), Claude Code `claude mcp add --transport http`, OpenCode `opencode.jsonc`
(`type: remote`), and `npx mcp-remote <url>` as the stdio bridge for Trae, Windsurf, Claude Desktop, ZCode and any
client that only starts local processes.

## 10. Cloud storage (Google Drive, iCloud Drive, synced folders)

`src/server/cloud.ts`. A project can be bound to a provider; it then syncs both ways with the three-way sync of
`src/core/sync.ts` (the one that connects two desktops): a few seconds after a change by you or the AI, every five
minutes, on Sync now. A file changed on both sides keeps both versions, deletes of unchanged files follow, nothing is
overwritten silently. The local copy stays, because the apps and the AI work on real files.

- **Google Drive:** OAuth 2.0 for desktop apps, PKCE and a loopback redirect, with **your own** OAuth client (Desktop
  app, Drive API enabled); nothing of WorkCraft is shared. Scope `drive.file` (only files WorkCraft created) by
  default, `drive` to reach existing Google Docs. Tokens stay in `config.json`. Files are mirrored under
  `WorkCraft/<project>` with the content hash in `appProperties.sha256` (the fallback is Drive's md5); remote deletes go to
  the Drive trash. Google-native Docs, Sheets and Slides are not mirrored: the tools `cloud-list`, `cloud-import`
  (exports to .docx, .xlsx, .pptx) and `cloud-export` (needs approval; `convert` makes a native Google file) handle them.
- **iCloud Drive:** Apple has no public file API for other platforms. iCloud for Windows and macOS keep a normal folder
  (`iCloudDrive`, `~/Library/Mobile Documents/com~apple~CloudDocs`), which WorkCraft mirrors into; placeholder files
  (`*.icloud`) are skipped. On an iPad open the same folder in Files.
- **Synced folders:** OneDrive, Dropbox or a network drive, same mechanism.
- Local-only mode blocks Google Drive; every Google request that leaves the computer is in the audit log.

## 11. Release check (apicraft logic)

`src/server/apicraft.ts` is a function-by-function port of apicraft's `github_client.py` (version parsing with the
PEP 440 rules of `packaging`, `fetch_latest_release`, `check_repo`, `check_batch_item`, rate-limit guard, error cache,
`verify_token`) and of its changelog route. WorkCraft asks GitHub directly: no apicraft server, no apicraft key; an
optional GitHub token lifts the 60 requests per hour limit. The website has the same port in PHP
(`public/api/_apicraft.php`). When apicraft changes its release logic, port the changed function and update the date
in both file headers.

## 12. Checklist for a new provider or model

1. Which wire format, and does a Custom endpoint already work? Add an adapter only for reasoning replay or cache data.
2. Reasoning: how is it switched on and off, how does it stream, and what must be sent back in tool loops?
3. Limits: `max` parameter name, window, temperature rules while reasoning.
4. Tool calls: role of the result, parallel calls, truncated arguments (drop, never run).
5. Cache: automatic or explicit, minimum size, which usage fields report hits.
6. Token counting: exact tokenizer, remote endpoint, or estimate (mark it).
7. Add the model rules to `src/chat/models.ts`, a test to `tests/server/`, and the line to `AI-PROVIDERS.md`.
