# Voice input

A microphone button next to Send turns speech into text in the chat input. The text goes into the draft: it is never sent,
you can edit it first, and `@gridcraft`, `/read-sheet`, Team Mode and the other chat features work on it like on typed text.

## Handy 0.10 and quiet microphones

- WorkCraft is built for Handy **0.10.1** (November 2026: GGUF models, language detection, long recordings with voice activity detection). A real transcription through the command line (`--list-models --json`, `--transcribe-file --json`) was run with 0.10.1 on Windows and the answers parse; 0.10.1 only adds options (`--device-index`, `--list-devices`) that WorkCraft does not need. 0.9.8 still works. WorkCraft reads the installed version from the program file (it never starts Handy just to ask) and Settings says when a newer release exists. It does not download or install Handy.
- Before a recording goes to Handy it is brought to a healthy level (at most 16 times) and padded with half a second of silence on each side. Handy's voice activity detection drops quiet speech and the first syllable of a recording that starts at once; that showed up as No speech was heard.
- The messages say what happened: too short, the microphone picked up almost nothing, or the recording was heard but no words came out. While you speak, a hint appears when the microphone delivers silence for a few seconds.
- Blip listens (headset, sound arcs) while the microphone is open and shows the error face when a recording fails.

## How to use it

1. Tap the microphone (or run *Voice input* from the command palette). The button turns red, a strip above the toolbar shows a
   waveform, the time and the engine. Tap again to stop. Escape or the cross cancels.
2. With Handy the text appears about a second after you stop; with the browser engine the words appear while you speak.
3. The words go in at the caret, with spacing that fits ("Sum" + "@gridcraft totals" gives `Sum @gridcraft totals`).

States of the button: idle (microphone), listening (red, pulsing ring, stop mark), processing (turning ring), error (crossed
microphone, the strip says what to do and goes away after nine seconds).

Say **"at gridcraft"** for `@gridcraft`, **"at finances dot xlsx"** for `@finances.xlsx`, **"at grid agent"** for `@grid-agent`,
and **"slash read sheet"** at the start of a sentence for `/read-sheet`. Only names the workspace knows are converted
(apps, agents, the files of the project, tools and chat commands), so "meet at five" stays as it is.

## Engines

| Engine | Where the speech is understood | Words while speaking | Languages | Needs |
| :--- | :--- | :--- | :--- | :--- |
| **Handy** (default when ready) | on your computer, offline, with the models of [Handy](https://github.com/cjpais/Handy) | no, when you stop | the model's (Parakeet: English; Nemotron Streaming 3.5: 28 languages; Whisper: many) | the desktop version of WorkCraft, Handy installed, one model downloaded in Handy |
| **Speech server** (OpenAI transcription API) | on the server you entered: a Whisper server on your computer or network, or Groq and OpenAI with your key | no, when you stop | those of the model | an address in Settings, Voice input. Works in browser mode and on an iPad on its own |
| **Browser speech** (Web Speech API) | in the browser maker's service (Chrome and Edge: Google or Microsoft; Safari: Apple) | yes | those of the browser | a browser that has it (Chrome, Edge, Safari) |

Settings, Interface, *Voice input* chooses: automatic (Handy when it has a model, otherwise the browser), Handy only, or browser
only. The same block shows whether Handy was found, which models it has, and lets you enter the path of the program or pick a
model. The browser engine takes a language such as `de-DE`; Handy uses the language of its model.

### Speech server: voice input in the browser and on an iPad

Handy is a program on the computer, so it cannot run in a browser tab or on an iPad that works alone. For those, Settings, Voice input has a **Speech server**: any service that
speaks the OpenAI transcription API (`POST <address>/audio/transcriptions`, multipart with the recording, the model and an optional language, answer `{"text": "..."}`).

- **A Whisper server of your own** (faster-whisper-server, Speaches, LocalAI, whisper.cpp started with an OpenAI compatible path) on your computer or network: the recording goes only there. Preset "A server on this computer or network".
- **Groq or OpenAI** with your own key (presets): the recording goes to that service. The key is kept in memory until you reload the page and is never saved.
- The same recording that goes to Handy is sent (16 kHz mono WAV, made louder if it is quiet). **Test the speech server** sends half a second of silence and says whether the address, the model and the key work.
- On the desktop version the backend forwards the request (`POST /api/voice/remote`), so a server without CORS headers works. In browser mode the page calls the server itself: the server must allow it (CORS), and a page on https cannot call plain http on another machine (the field says so).
- Automatic picks: Handy when it is ready, then the speech server if one is entered, otherwise the browser's recognizer. Choose "Speech server" to force it.

The microphone itself needs a secure page (https or localhost). On an iPad paired with a desktop over plain http, serve HTTPS (`npm run lan:cert`, see the [iPadOS guide](IPADOS-GUIDE.md)).

### Why Handy

Handy is a free, open source, offline speech-to-text application with Whisper, Parakeet and Nemotron models, and it has a
headless command line: `handy --transcribe-file speech.wav --json` runs the same transcription path as the app and prints the
text as JSON (`--list-models --json` lists the models). WorkCraft records the microphone in the browser, writes a 16 kHz mono
16-bit WAV (what Handy requires) and sends it to its own backend, which runs that command next to the models. The audio never
leaves the computer, which fits a local-first workspace; a cloud recognizer cannot say that.

### Why the browser engine stays

It works without installing anything and shows words live, which Handy's file mode cannot. It is the fallback when Handy is
missing or has no model (automatic mode picks it then), and the only engine of browser mode (no backend). The price is privacy:
read the table above.

### Nemotron Streaming 3.5

Handy lists *Nemotron Streaming 3.5* (28 languages, 0.6 B parameters, streaming capable) next to Parakeet and Whisper.
WorkCraft uses it through Handy: pick it as the Handy model in Settings (or in Handy) and it is the model that runs. Its
streaming mode needs a live audio feed into the engine, which the command line of Handy does not offer (it takes a finished
file), so inside WorkCraft it behaves like the other models: text when you stop. On the development PC a two second recording
was transcribed in about 1.3 seconds including the model load. Running it directly in the browser is not practical: the model
is 700 MB of GGUF for a native runtime, and downloading models from a CDN is something the workspace does not do.

### Other options that were looked at

- **Whisper in the browser (WebAssembly, WebGPU).** Works offline after a model download of 40 to 250 MB, but the download has
  to come from a CDN or be bundled, the first start is slow on an iPad, and the memory budget of Safari is shared with the apps.
  Handy on the desktop PC does the same job with GPU acceleration. Not chosen.
- **Handy's own hotkey.** Handy can type into any focused field by itself (press its shortcut with the chat input focused). That
  works without any WorkCraft code and stays available; the button adds a visible state, the `@` and `/` conversion, and iPad.

## iPad

- The microphone needs a secure page: HTTPS or localhost. Over `http://192.168.x.x` Safari refuses it; use `npm run lan:cert`
  and `--https` (see the iPadOS guide). The first use asks for permission; if it was refused, Settings, Safari, Microphone
  (or the site settings) turns it on again. The error message says this.
- Paired with a desktop (hybrid mode) the recording goes to the Handy of the desktop PC over the home network, and the text
  comes back: no cloud, and no model on the iPad.
- Without a desktop (browser mode) the browser engine is used.
- While the Apple Pencil is the writing tool, a finger tap does not open the keyboard (see the Apple Pencil section of the
  iPadOS guide). Dictated text is put in without it, so the draft is ready to edit with the pencil.

## For developers

| Part | File |
| :--- | :--- |
| Button, strip, dictation into the draft | `src/chat/sidebar.ts` (micBtn, voiceStrip, `dictation*`) |
| State machine, recording (AudioWorklet), Web Speech | `src/chat/voice.ts` |
| Resampling to 16 kHz, WAV, levels, engine choice, error sentences | `src/chat/voice-audio.ts` |
| "at gridcraft" to `@gridcraft`, insertion at the caret | `src/chat/voice-text.ts` |
| Microphone capture on the audio thread | `public/voice-worklet.js` |
| Handy bridge: find, list models, transcribe, queue | `src/server/voice.ts` |
| Routes | `GET /api/voice` (status), `PUT /api/voice` (path, model; desktop only), `POST /api/voice/transcribe` (body: WAV) |
| Setting | `voice.handyPath`, `voice.model` in `config.json`; prefs `voiceEngine`, `voiceLang` |
| Tests | `tests/server/voice.test.ts` (conversion, text rules, a stand-in program with Handy's command line) |

The page policy allows the microphone for the page itself (`Permissions-Policy: microphone=(self)`, set by the server and
the Vite dev server); the engine frames do not get it. Recordings are written to a temporary folder for the run of Handy and
removed afterwards. One transcription runs at a time. A recording is limited to about five minutes in the interface and 24 MB
on the server. `HANDY_PATH` in the environment, or a path ending in `.mjs`, lets a test use a stand-in program.

## Troubleshooting

| What you see | What to do |
| :--- | :--- |
| "The microphone is blocked" | Allow the microphone for the site (lock icon; on iPad Settings, Safari, Microphone) and reload |
| "The browser only allows the microphone on a secure page" | Open WorkCraft over HTTPS or on localhost |
| "Handy has no speech model yet" | Open Handy, Models, download one (Parakeet or Whisper small is a good start), try again |
| "Handy was not found" | Install Handy, or enter the path of `handy.exe` in Settings, Voice input |
| "This version of Handy cannot transcribe files from the command line" | Update Handy to 0.9.8 or newer |
| "No speech was heard" | Speak closer, check the right microphone is selected in the system |
| "The browser could not reach its speech service" | Chrome and Edge send the audio to Google or Microsoft and need internet (check VPN, firewall, proxy). With Handy installed and a model downloaded, WorkCraft now **switches to Handy automatically** and says so; otherwise install Handy and set Voice engine to Handy |
| Browser engine used although Handy is installed | The first check of Handy takes a few seconds; WorkCraft waits for it (up to 15 s) before it picks an engine. If Voice engine is set to Browser in Settings, change it to Automatic or Handy |
| "The browser does not support the chosen voice language" | Change Voice language in Settings |
