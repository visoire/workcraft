# AI providers

The assistant is a core part of WorkCraft and private by default: until you add a model, nothing is
sent anywhere. It runs fully local with Ollama (air-gapped, no key, no cost per request), or with your
own API key for Claude, ChatGPT, Gemini, DeepSeek, Grok, GLM, Mistral, Groq, OpenRouter, Together AI, LM Studio and any OpenAI-compatible endpoint. This guide covers
setup, where keys are kept, what each provider receives, and how reasoning, caching and token counts
work.

Local-only mode blocks every cloud provider with one switch, and the audit log lists every request that
leaves the machine (destination, model, size and file names, never contents).

## Supported providers

| Provider | You need | API used | Reasoning | Prompt cache |
| :--- | :--- | :--- | :--- | :--- |
| **Claude** (Anthropic) | an Anthropic API key | Messages | adaptive thinking with `output_config.effort`, `budget_tokens` on older models | `cache_control` on the last tool, the system prompt, the largest document and the last block |
| **ChatGPT** (OpenAI) | an OpenAI API key | Responses (`/v1/responses`), Chat Completions as a fallback | `reasoning.effort` with summaries | `prompt_cache_key` per chat |
| **Gemini** (Google) | a Google AI API key | `streamGenerateContent` (SSE) | `thinkingLevel` (3.x) or `thinkingBudget` (2.5) | implicit |
| **DeepSeek** | a DeepSeek API key | Chat Completions | `reasoning_content`, shown as **Thought process** | prefix cache |
| **Grok** (xAI) | an xAI API key | Chat Completions (`https://api.x.ai/v1`) | `reasoning_content` when the model sends it | automatic prefix cache |
| **GLM** (Z.ai) | a Z.ai API key | Chat Completions (`https://api.z.ai/api/paas/v4`) | `thinking` plus `reasoning_effort` low, high, max; `reasoning_content` | automatic prefix cache |
| **Mistral**, **Groq**, **OpenRouter**, **Together AI** | the host's API key | Chat Completions | depends on the model | depends on the host |
| **Ollama** | Ollama on your computer or home network | native `/api/chat` | `think` on or off, for models that think | local (prefix cache of the model) |
| **LM Studio** | LM Studio on your computer (local server) | Chat Completions (`http://127.0.0.1:1234/v1`) | depends on the model | local |
| **Custom** | a base URL, an optional key and a model name | OpenAI-compatible | depends on the endpoint | depends on the endpoint |

The adapters live in `src/chat/adapters/` and use plain `fetch`, no SDKs. They all stream into one
event format, so the chat, the tool cards and the Thought process card behave the same for every
provider. Per-model rules (families, effort mapping, context windows) are in `src/chat/models.ts`.

**Tools per request.** With the 44-app catalog and up to 19 Craft apps connected, a broad question could name many apps at once.
Providers refuse a request with too many tools (OpenAI stops at 128), so the tool router (`src/chat/economy.ts`) sends at most
120: WorkCraft's own tools, tools the model used earlier in the chat and a tool forced with `/` always stay, the others fill up in
name order, and the rest is one `find-tools` call away. The tool list stays sorted, so the provider's prompt cache keeps hitting.
Claude model ids are matched by family (`claude-fable-*`, `claude-opus-5-5`, `claude-sonnet-5-5` and the other Claude 5 and 4.x
ids, with their context windows and effort levels); the default Claude model is `claude-sonnet-5-5`.

## Set up a provider

1. Open **Settings, AI models**.
2. Paste your API key for Claude, ChatGPT, Gemini or DeepSeek, or add a custom endpoint with its base
   URL, key and model name.
3. Press **Test connection**. It checks the key and lists the models the endpoint offers.
4. Pick the default provider and model. You can switch for a single chat with `/model` or the model
   menu in the chat header.

For fully local work, install [Ollama](https://ollama.com), pull a model with tool support (for
example `ollama pull qwen2.5:7b`) and make Ollama the default.

## Ollama (local models)

- **Models.** Pull a model with tool support (`ollama pull qwen2.5:7b`, `qwen3.5:4b`). Test connection lists what is
  installed. WorkCraft reads what each model can do (tools, thinking, images) from Ollama and only sends what it
  supports.
- **Native API.** Chats go to `/api/chat`, not to the OpenAI-compatible `/v1`. That endpoint cannot set the context
  of a request, switch thinking off or keep a model loaded, and Ollama's own guidance for agents is the native API.
  Every request sends `options.num_ctx`, `keep_alive` (15 minutes) and `truncate: false`, so a prompt that is too
  long fails with a clear message instead of silently losing the start of the chat.
- **Context window.** Ollama starts every model with 4096 tokens. Settings, AI models, Ollama, **Context window**
  offers:
  - **Automatic (default).** The largest of 64k, 32k and 16k that keeps the model in GPU memory. Each step loads the
    model once, so the first request after a start takes a few seconds longer; the result is remembered for six hours.
  - A fixed size from 8k up to the limit of the model, or **Maximum of the model**.
- **Why not simply the maximum.** A larger context needs more memory for the KV cache. When the model no longer fits
  into GPU memory the rest runs on the CPU and answers get several times slower. Measured on a GTX 1660 Ti (6 GB),
  Qwen3.5 4B: 59 tokens/s at 8k, 33 at 32k (77% on the GPU), 17 at 64k (60%). Settings shows the GPU share when a
  model spills over. Agents and coding tools work best from 64k, so choose a fixed 64k if you accept the speed.
- **Thinking.** Models such as Qwen3.5 think before they answer; the reasoning appears as a Thought process card.
  The reasoning menu of the prompt bar switches it: **Off** sends `think: false`, **Auto** leaves the model default.
  On a 6 GB card Qwen3.5 4B needs 0.2 s for a short answer with thinking off and about 3 s with it on. gpt-oss cannot
  be switched off and offers Low, Medium and High. Models that do not report the capability never receive `think`.
- **Old copies.** Earlier WorkCraft versions made `wc-<model>-ctx<size>` copies to carry the context. They are deleted
  once, the first time Ollama is used.
- **Embeddings.** Semantic search uses `/api/embed`. Search queries get the retrieval prefix the model expects
  (`nomic-embed-text`, `mxbai-embed-large`, `qwen3-embedding`); indexed text stays raw, so existing indexes stay valid.
- **Local-only mode** and the audit log treat Ollama as local: nothing leaves the machine.

## Where your key is kept

| Setup | Storage | Who can read it |
| :--- | :--- | :--- |
| Desktop with the backend running | `~/workcraft/config.json` (mode `0600` on macOS and Linux) | the backend only; the page sees a masked hint |
| iPad in browser mode | memory, until you reload | the open page |
| iPad in browser mode, after you opt in | the browser's `localStorage`, unencrypted | anything with access to that browser profile; WorkCraft warns you first |

On the desktop, requests go from the backend straight to the provider. They never pass through an
WorkCraft server. Only browser mode on the iPad sends requests from the browser itself.

## What a provider receives

When you send a chat to a cloud model, that provider receives:

- your message and the earlier messages of the chat;
- the text of files you mention with `@` or attach, and images you attach;
- the results of tools the model called in that answer, for example the rows of a sheet it read;
- passages from the project memory and your personal context;
- the list of tool definitions.

The **audit log** (Settings, Audit log) records every outgoing request with its destination, model,
size and the names of attached files, never their content. **Local-only mode** (Settings, Privacy)
blocks every cloud provider; Ollama and endpoints on `localhost`, `127.x`, `10.x`, `172.16-31.x`,
`192.168.x` and `.local` names keep working.

## Effort and reasoning

The model chip in the prompt bar sets the effort per provider: **Auto, Off, Low, Medium, High, Max**.
`src/chat/models.ts` maps it to each API: for example Off becomes `minimal` on GPT-5 and Gemini 3, and
stays on for Claude models that always think.

Reasoning streams into a collapsible **Thought process** card above the answer. In tool chains, the
reasoning of earlier turns is replayed to the API with its signature or encrypted content, as each
API requires.

## Attachments

PDFs and images attached with `@` go to Claude, Gemini and ChatGPT as native document and image
blocks (up to 8 per message, 20 MB each). DeepSeek, Ollama and custom endpoints receive the extracted
text. Images reach a model only if it reads images.

## Token counts, cache and costs

| Provider | Token count |
| :--- | :--- |
| DeepSeek | exact, with the built-in V4 tokenizer (`src/core/bpe.ts`) |
| ChatGPT | exact, with `o200k_base` or `cl100k_base` (`gpt-tokenizer`, backend only) |
| Claude, Gemini | estimated (marked ≈), or exact with **Remote counting**, which asks their counting endpoints and sends the text to the provider (off by default) |

- The **chat footer** shows the tokens of the chat, the cache hit ratio and the size of the next
  request while you type. The bar shows the share of the model's context window; it turns orange when
  the backend will shorten the request to fit, red when even that is not enough.
- **Settings, Usage and telemetry** shows per provider and model: requests, input, cache hits and
  misses, output, thinking tokens, estimated cost, cache savings, tokens per second and time to the
  first token. Costs appear once you enter your provider's rates; WorkCraft ships no price list.
  Local models always cost $0.00.
- Everything is stored in `~/workcraft/usage.json` (numbers only) and never sent anywhere.

## DeepSeek

WorkCraft is tuned for the DeepSeek API (`deepseek-flash`, `deepseek-v4-pro`, base URL
`https://api.deepseek.com`):

- **Exact counts** with a TypeScript port of the V4 tokenizer, checked against the reference
  implementation on 9,866 texts.
- **Context budget**: a request that would not fit is shortened instead of failing: first
  `max_tokens`, then old tool results, then large attachments, then the oldest turns. The stored chat
  stays complete.
- **Prefix caching**: every request starts the same way (system prompt, sorted tools, frozen project
  context), so earlier parts are served from DeepSeek's cache.
- **Presets**: Standard chat, Thinking, Deep thinking, and Coding and FIM. The last one powers
  `Alt+\` completions in the code editor.

## Team Mode

The **Single / Team** switch in the chat header turns on Team Mode: a Team Leader plans the prompt as a
task graph and specialist agents work in parallel.

| Role | Mention | Tools |
| :--- | :--- | :--- |
| Team Leader | `@leader` | none: plans, reviews, writes the answer |
| Data and Sheet Specialist | `@grid-agent` | GridCraft |
| Document and Copy Specialist | `@word-agent` | WordCraft |
| Presentation Specialist | `@deck-agent` | DeckCraft |
| PDF and Compliance Specialist | `@pdf-agent` | PdfCraft |
| Code and System Specialist | `@dev-agent` | code, terminal, external MCP servers |

Each role can use its own provider, model and effort, so you can mix a cloud leader with local Ollama
specialists. Configure it with `/roster` or **Settings, Team Mode**; presets include Full Studio Team,
Financial Audit Team, Fullstack Dev Team and Fast Local/Hybrid Team, plus one team per workspace (ten built in,
and **This workspace** for one you made). Usage is tracked per role.

**One specialist for every app.** Every app of the catalog has its own specialist, `@<app>-agent` (`@photocraft-agent`,
`@soundcraft-agent`, `@oxybrush-agent`; `@gridcraft-agent` and the other office names reach the four specialists above).
The roles are generated from `src/ecosystems/catalog.json` (`src/chat/app-roles.ts`). A specialist of an app with a CLI gets
the `ext-<app>-*` tools of that app's MCP server and nothing else; the Code and System Specialist keeps the MCP servers
that are not Craft apps. A specialist of a web-only app (independent app) has no tools of its own: it reads and writes the
app's files in the project, opens the app with `open-in-app` and says what only you can do inside it.

## "Model or endpoint not found"

A 404 on a chat request means the model name does not exist at the provider, or the address is wrong. Before it reports
anything, the router asks the provider for its model list (`src/chat/model-recovery.ts`) and then
- repeats the request once with the closest listed model (same name with another tag or date, the same family, the best chat
  model of the family; embedding, speech and image models are never chosen). The stream carries a `notice` event and a second
  `start` event with the model that answers; the interface offers **Keep** to save it as the setting;
- keeps the original error when the model is listed (the address is right, something else is wrong);
- says "does not answer the models endpoint" when the list is a 404 too (wrong address, usually a missing `/v1`), or
  "reports no models" when there is nothing to choose from (for Ollama: `ollama pull qwen3:4b`).

It runs in the backend and in browser mode alike, once per request and only before the first byte of the answer.

`@team`, `@leader` or `/team <prompt>` run the whole team. One specialist mentioned alone works
directly, without planning.
