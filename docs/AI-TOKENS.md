# Tokens: where they go, what WorkCraft saves, what each provider does

The assistant works in a loop: the model answers, calls a tool, gets the result, answers again. Every round sends the
whole request again, so what is in the request is paid for once per round. This page says what is in it, what WorkCraft
leaves out, and what each provider does with the part that repeats. The provider facts come from the reference snapshot
in `artifical-intelligence/documentation` (README, section 2 and 3); the code is in `src/chat/economy.ts`.

## What a request is made of

| Part | Size (about) | Repeats every round? | Changes between questions? |
| :--- | :--- | :--- | :--- |
| System prompt (rules, skills index, persona) | 1 to 2k | yes | no |
| Tool definitions | WorkCraft's own 24 tools: 2.9k. Each connected Craft app adds 10 to 30 tools at 150 to 250 each: five apps are 14k | yes | only when the set changes |
| Project context (file list, frozen per chat) | 0.2 to 1k | yes | no |
| History: questions, answers, tool results, attachments | grows | yes | grows at the end |
| The new question with its `<context>` and `<session>` blocks | small to large | once, then it is history | yes |

The tool definitions are the biggest fixed cost, and the history is the biggest one that grows. Both are what WorkCraft works on.

## What WorkCraft does

1. **Tools for this question** (`routeTools`). The model gets the workspace tools and the tools of the apps the question is
   about: an app named in the text (`@photocraft`, "in PhotoCraft", "craft anything"), a file type (a `.dxf` names CADCraft, an
   `.eml` MailCraft; the types come from `src/ecosystems/catalog.json`), a word from a tool's own name ("crop", "histogram"), a
   tool used earlier in the chat, or a `/` command. One request never carries more than 120 tools (`MAX_TOOLS`; OpenAI stops at
   128): workspace tools, tools used before and the forced one stay, the others fill up in name order, and what does not fit is
   one `find-tools` call away. Everything else stays out of the
   request, and one extra tool, `find-tools`, lists what is withheld. The model calls `find-tools` with a few words and the
   matching tools are in the next request. The cloud tools come with words like drive, cloud, sync. The set only grows within
   a chat (`prefix.sent`), and it is sorted, so the prompt prefix stays the same from round to round and the providers' prefix
   caches keep hitting. With five Craft apps connected a question about a spreadsheet sends about 3k instead of 17k tokens
   of tool definitions; the answer's footer says `saved ≈ 14k`.
2. **Shorter definitions of foreign tools** (`compactSchema`). Schemas from other MCP servers lose titles, examples and
   descriptions beyond 140 characters (300 for the tool). WorkCraft's own tools are untouched.
3. **A history that shrinks behind the question** (`compactTurns`). When a new question starts, what the questions before
   the last one left behind is cut: tool results over 1,500 characters keep their head and tail with a note saying how many
   characters were left out and which tool to call again; attached file text over 900 characters is cut the same way; the
   `<session>` block (open panels, project memory of that moment) is dropped, because the next question brings a fresh one;
   images and PDF attachments are not sent again. The latest question with its answer stays whole, because "and the second
   row?" needs what the last answer read. Running it twice changes nothing more.
4. **Team Mode** (`src/chat/team.ts`). *Smart review* (the default): the leader model reviews a result only when the automatic
   checks found a problem, or the agent neither called a tool nor changed a file; a clean run is accepted, which saves one
   model call per task. *Straight to one specialist*: a short request about exactly one app (one file type, one app word, no
   "and then", "also", "compare") goes to that specialist alone, with no plan, no review and no summary: three or more model
   calls less. Mission Control says so and offers *Plan with the whole team*. Results passed on between agents are capped at
   4,000 characters (the shared memory carries 400 characters per task). Sub-agents only see the tools of their role.
5. **Cost where you can read it.** The footer shows tokens and the context window with the exact count of the provider when it
   has one; every answer shows input, output, cache hit rate and what was saved; Settings, Usage has the per-provider and
   per-role tables with the cost.

## What each provider does with the part that repeats

| Provider | Cache | From | Discount on cached input | Counting in WorkCraft | What helps |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Anthropic Claude | explicit `cache_control` on the prefix | 1,024 tokens (2,048 for smaller models) | 90 % | server `count_tokens` (optional, sends the draft) | stable system prompt and tool order; the router never reorders |
| OpenAI (ChatGPT) | automatic prefix cache | 1,024 tokens | 50 % | local `o200k_base` | the same |
| Google Gemini | implicit prefix cache (explicit `cachedContents` exists) | 2,048 to 4,096 tokens | up to 90 % | server `countTokens` (optional) | the same |
| xAI Grok | automatic prefix cache | 1,024 tokens | discounted rate | local `o200k_base` | the same |
| DeepSeek | automatic prefix cache | 64 tokens | 80 to 90 % | local tokenizer | reasoning goes back within a tool chain (the API needs it) |
| Z.ai GLM | automatic prefix cache | automatic | up to 81 % | local | thinking and effort per request |
| Ollama (local) | KV cache of the loaded model | per session | no cost, but time | native counts | context size (`num_ctx`, Automatic) decides what fits on the GPU |

What this means in practice: the prefix (system prompt, tool definitions, project context, early history) must not change
between rounds, or the cache is lost. That is why the tool set only grows and is sorted, why the project context is frozen when
a chat starts, why per-question state goes into the user turn (`<session>`), and why the history is compacted once per question
and not in the middle of a tool loop. A compaction costs one cache miss on the changed part, then the new history is stable again.

## Choosing models for a team

A team does not need the strongest model everywhere. The leader plans and reviews (short outputs, needs judgment); the
specialists mostly read and write files through tools (long inputs, simple decisions). Settings, Team lets you set a
provider, model and effort per agent. Two patterns that work: a strong cloud leader with fast local specialists on Ollama
(the preset *Fast Local/Hybrid Team*), and a cheap fast cloud model for the specialists with effort *Off* or *Low*. Reasoning
effort costs output tokens: leave it on *Auto* or *Low* for specialists.

## Settings that matter

| Where | What |
| :--- | :--- |
| Team, Review | Smart (default), Team Leader reviews each result, Automatic checks only |
| Team, Straight to one specialist | on by default |
| Chat, reasoning chip | thinking effort per provider |
| Chat footer | live count of the next request; a red bar means the context window is nearly full |
| Settings, Usage | tokens, cache hits, cost per provider and per role |

## Limits

- Savings are estimates (characters divided by 3.6) until the provider's own count arrives; the footer shows both.
- The router decides from words. A question that needs a hidden tool without naming it works through `find-tools`, which costs
  one extra round. The model can also call a withheld tool by name when it knows it; that works too.
- Old tool results are cut at the next question: when the model needs the full text again it calls the tool again.
