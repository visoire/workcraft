---
name: lightcraft
description: Use this skill whenever the user mentions LightCraft, or asks about its capabilities, supported file formats, keyboard shortcuts, library/catalog files, MCP server, lightcraft-cli, or control channel — and whenever photos should be imported, culled (rate/flag/label), developed (raw sliders, masks, crop, HDR/panorama merge, presets), exported (JPEG/PNG/TIFF/WebP/AVIF/JXL/DNG/PSD), or a photo library must be automated, scripted, verified or troubleshot with it. Trigger even without the app's name when the task is "develop this raw", "cull this shoot", "make a contact sheet", "why won't this CR3/HEIC open", "batch-export with edits", or "drive a photo editor from an agent" — LightCraft is the ArtCraft photo app.
---

# LightCraft

## Overview

LightCraft is a clean-room, open-source **photo library and non-destructive raw developer** — a reimplementation of Adobe Lightroom (Classic-style modules) written from scratch in pure Rust (README.md:21, docs/architecture.md). It is a native desktop app for macOS/Windows/Linux (plus a WebAssembly browser build) built as an engine-first Cargo workspace of ~24 crates with enforced layering (docs/architecture.md:Layers; `cargo xtask layers`). Source: https://github.com/storytold/lightcraft (org `storytold`), dual-licensed MIT OR Apache-2.0 (Cargo.toml:8). Maturity: **alpha** — the repo measures ~81% of Lightroom's feature checklist but only ~61% "ready for real work"; the honest gaps are quality and coverage, not missing buttons (ROADMAP.md:3,11-21). The installed app on the authoring Mac is **0.7.1**, while repo HEAD is **0.8.0** — verify against your installed version (see Verification protocol).

## Capabilities (verified)

### Library and catalog (implemented)
- Photos live in a **library folder** (default `~/Pictures/LightCraft Library`) whose catalog is an append-only, crash-safe journal: `catalog.snap` (JSON snapshot) + `catalog.log` (JSON lines of operations), compacted in the background, guarded by `catalog.lock` — one program at a time (crates/catalog/src/journal.rs:1-30; crates/engine/src/library.rs:1-15,50-56; docs/mcp.md:19-22).
- Albums, folders, smart albums, stacks (incl. auto-stack), virtual copies, versions/history, ratings 0–5, pick/reject flags, color labels, keywords, search with fields (`rating:>3 flag:pick iso:>800 camera:x2 date:2026-04 keyword:mountains`), sort, justified/square grids (README.md:204-220; crates/engine/src/cmd/library.rs, organize.rs, keywords.rs).
- Trash is **Recently Deleted**; deleting does not remove originals until emptied (crates/engine/src/cmd/library.rs:780,791; docs/parity-checklist.md).

### Import (implemented)
- Import modes: reference in place, copy into the library's `Originals/`, or move; duplicate detection (content hash), rename/folder templates, watched folders (README.md:337; crates/engine/src/import.rs:48-76).
- Importable extensions (crates/engine/src/import.rs:36-45): `jpg jpeg png tif tiff webp dng cr2 cr3 nef nrw arw raf orf rw2 rwl raw pef srw psd jxl gif bmp heic heif avif iiq crw mrw x3f kdc mos erf 3fr fff` — note some open as embedded previews only, and AVIF/heic-without-feature report a clear failure (see Limitations).
- Lightroom Classic `.lrcat` import: `library.importLightroom {path}` (also `library.inspectLightroom`), pure-Rust read-only SQLite incl. committed `-wal` pages; ratings, flags, labels, keywords, collections, virtual copies and mapped develop settings; one-way by design, best-effort recovery archives in `Interop/` (crates/engine/src/cmd/library.rs:1363; docs/lightroom-catalog-import.md).

### RAW decoding (implemented, with caveats)
- Containers decoded by the repo's own decoders: DNG, CR2, CR3 (CRX lossless + version 0x100/0x200 C-RAW), NEF/NRW (incl. lossless/lossy compressed), ARW, RAF (Bayer + X-Trans, uncompressed + compressed), RW2/RWL, PEF, ORF (uncompressed 12.8bpp), SRW (uncompressed), plus container-by-container embedded previews (crates/raw/src/lib.rs:90-116,376-386; README.md:331).
- Concrete limits: CR3 verified on four Canon bodies (M50/R100/R8/R5 Mark II), other CR3 variants fall back to preview; compressed ORF and Nikon HE/HE★ NEF are preview-only; camera colour is estimated from camera JPEGs / a few profiles, not measured (docs/gaps.md:18-27; docs/raw-parity.md).

### Standard formats (implemented)
- Decode: JPEG, PNG, TIFF (incl. BigTIFF, float, CCITT), WebP, PSD/PSB composite, JPEG XL, GIF, BMP; HEIC/HEIF in release builds (`--features heif`, enabled by all packaging scripts) (crates/codecs/src/sniff.rs:7-88; packaging/macos/package.sh:61).
- AVIF: recognised but **not decodable** — "no pure-Rust, permissively licensed AV1 decoder yet" (crates/codecs/src/sniff.rs:77-79).
- Export/write formats (`ExportFormat::parse`, crates/engine/src/export.rs:36-63): `jpeg/jpg png tiff/tif psd webp avif jxl original dng rendereddng` (`.psd` = flat 8/16-bit, no layers).

### Develop (implemented)
- Non-destructive, resolution-independent slider pipeline: Light, Color (WB temp/tint in Kelvin for matrix raws, eyedropper `develop.wbPick`), Effects (texture/clarity/dehaze/vignette/grain), Tone Curve, 8-band Color Mixer, Point Color, Color Grading, Calibration, B&W mix, Detail (sharpening, luminance/colour NR), Optics, Geometry/Upright, HDR headroom limit (README.md:83-105,321-343; crates/develop, crates/pipeline).
- Every slider is a registered control with id/range/default; query them with `develop.controls {section?}` and set them with `develop.set {values}` / `develop.adjust {control, delta}` (crates/engine/src/cmd/query.rs:183; docs/control-protocol.md:160-198). White-balance `scale` semantics matter: `wb.temp` from `develop.set` is Kelvin on raws with colour matrices, but a partial `settings.wb` without `"scale":"kelvin"` is relative (6500 = as shot) (docs/control-protocol.md:89-96).
- Masks: brush (add/subtract, erase), linear/radial gradients, luminance/colour range, and AI-ish Subject/Sky/Background via classical heuristics; SAM 3 powers Object/Describe masks with an optional model download; 15 local adjustments per mask plus Amount (crates/engine/src/cmd/masks.rs:164; docs/gaps.md:22; docs/ai-masks.md).
- Crop/straighten/transform (`crop` MCP tool; `develop.set` `crop.*`), flip/rotate, aspect ratios, overlays (README.md:182-184; docs/mcp.md:172).
- Presets and profiles: built-in presets, user presets saved in the library, `.lcpreset` JSON files, XMP presets, classic `.lrtemplate`, Luminar `.lmp`/`.mplumpack`, `.cube` LUTs; Adobe `.dcp`/`.lcp` deliberately unsupported (crates/engine/src/presets.rs:1-16, crates/engine/src/preset_luminar.rs; docs/file-format-parity.md).
- XMP sidecars: read/write `<stem>.xmp` or `<file>.xmp`, manual (`photo.saveMetadataToFile`, ⌘S) or auto-write; owns its properties, preserves other apps' `crs:`/`xmpMM:` byte-for-byte, maps Lightroom `crs:` edits on read (crates/engine/src/sidecar.rs; docs/xmp-interop.md).

### Output (implemented)
- Photo Merge: `merge.hdr`, `merge.panorama`, `merge.hdrPanorama` (align, deghost, projections, boundary warp, auto crop, fill edges) → 16-bit float DNG next to the first file; `lightcraft-cli merge …` and `synth-merge` for synthetic inputs (crates/engine/src/cmd/merge.rs:46-70; docs/merge.md).
- Export options include resize modes (long/short edge, width/height, megapixels, percent, dontEnlarge, 512 MP cap), quality, PPI, file-size limit, naming templates (`{name}`, `{seq}`, `{date:…}`), conflict policies (unique/overwrite/skip), output sharpening, metadata policy, text or image watermark, colour spaces (sRGB, Display P3, Adobe RGB-compatible, ProPhoto, Rec.2020) with generated ICC, and bit depths (crates/engine/src/export.rs:891-1041,172-181).
- HDR: ISO 21496-1 gain-map JPEG, PQ AVIF, PQ JPEG XL, 32-bit float TIFF for photos edited in HDR; on-screen HDR display is not implemented (crates/engine/src/export.rs:701-721,1418-1442; docs/gaps.md:31).
- Contact-sheet PDF: `export.contactSheet` (A4/Letter, rows/columns, captions; ≤1,000 photos, 100 pages, 256 MiB) (crates/engine/src/cmd/export.rs:151-158; README.md:256-268).
- macOS only: `addToPhotos: true` + `photosAlbum` hands exported files to Apple Photos via AppleScript (crates/engine/src/apple_photos.rs; docs/mcp.md:286-301).

### Automation surface (implemented — the reason this skill exists)
- **Everything is a command**: 313 engine command definitions assembled in `command_specs()` plus UI commands (`view.*`, `panel.*`, `tool.*`, `dialog.*`); each has an id, label, menu path, default shortcut, param doc and `enabled()` (crates/engine/src/cmd/mod.rs:1-5,133-171; crates/ui-egui/src/menus.rs:53+).
- **Control channel**: `lightcraft --control PORT` serves JSON-lines on 127.0.0.1 (loopback only, no auth), with `engine.execute`, `ui.inspect`, `ui.widgets`, `ui.clickWidget`/`ui.pointer`/`ui.key`/`ui.text`, `ui.screenshot {headless}`, `ui.dock`, and more; a malformed line closes the connection (apps/lightcraft/src/control_server.rs:28; crates/ui-egui/src/control.rs; docs/control-protocol.md).
- **MCP server**: `lightcraft-cli mcp` (headless session) or `mcp --connect 127.0.0.1:PORT` (drives the running app), JSON-RPC over stdio, protocol 2025-06-18; helper tools (`command_list/run/batch`, `doc_inspect`, `render_preview`, `import`, `query_photos`, `select_photos`, `list_controls`, `get_develop`, `set_develop`, `apply_preset`, `crop`, `render_photo`, `export`) plus one `cmd_*` tool per command and `lightcraft://…` resources (crates/mcp/src/tools.rs; docs/mcp.md:124-224).
- **CLI**: `lightcraft-cli run|mcp|render|snapshot|merge|synth-merge|commands|controls|calibrate|denoise-serve|--version|--help` — `run` chains any commands and prints one JSON line per step; `render` is the one-shot develop+export; `snapshot` runs the whole UI headlessly on CPU (apps/lightcraft-cli/src/main.rs:28-112).
- **WebAssembly web build**: same UI via `cargo xtask web`, WebGL2, persistent library in OPFS/IndexedDB (apps/lightcraft-web; docs/web.md).
- **Undo covers agent actions**: a scripted burst of `develop.set` can be grouped with `develop.beginInteraction`/`endInteraction` into one undo step (docs/control-protocol.md:194-197).

## Known limitations and not-implemented

Do not assign these to LightCraft:

- **Camera colour is estimated, not measured** (per-file fit to the camera JPEG, 4 bundled profiles: ILCE-7CR, ILCE-7M4, X-H2S, X-T4 — crates/engine/src/camera_profiles.rs:25-31; docs/gaps.md:18). Lightroom-imported edits can look different; render fidelity vs Lightroom is unmeasured (docs/gaps.md:20).
- **RAW coverage gaps**: CR3 beyond four verified bodies, CR3 sRAW/mRAW, compressed ORF (all Olympus/OM since ~2008 preview-only), Nikon HE/HE★ NEF, lossy DNG read, long-tail formats (IIQ, X3F, CRW, MRW, ERF…) (docs/gaps.md:19-24,37; docs/raw-parity.md).
- **AI features are partial**: Subject/Sky/People/Background masks are classical heuristics; **AI Denoise ships no model weights** (user installs an ONNX model + manifest; Bayer only, no X-Trans); Super Resolution and generative/content-aware remove are missing (docs/denoise.md:19-29; docs/gaps.md:22,28-29).
- **No lens profile database** (only DNG opcodes, some Panasonic/Leica/Sony/Nikon in-file distortion data) — docs/gaps.md:25.
- **AVIF import unsupported** (crates/codecs/src/sniff.rs:78); PSD writes are flat composites only; no lossy DNG.
- **Classic modules absent**: Print (except contact-sheet PDF), Book, Map, Slideshow, publish services, tethered capture, video (clips are catalogued with kind/duration but not played, trimmed or exported), Lightroom-style plug-ins (docs/gaps.md:32-36; docs/file-format-parity.md).
- **HDR display (EDR/Windows HDR) missing** — HDR editing works but is blind on HDR monitors (docs/gaps.md:31).
- **Localization partial**: English 100%; other shipped languages 74–99% of catalog messages; lower-layer errors remain English; Hindi/Arabic/Korean/Vietnamese absent; no RTL shaping (ROADMAP.md:79-99; docs/gaps.md:38).
- **Test/CI thinness**: `cargo xtask ci` (fmt, clippy, tests, layers, assets, parity, wasm) runs locally; CI only runs the full test suite on FreeBSD — regressions can reach macOS/Windows/Linux users (docs/gaps.md:26).
- **One library, one program**: a library open in the desktop app cannot be opened by `lightcraft-cli --library` (lock file); use `mcp --connect` or the control channel instead (docs/mcp.md:19-22).
- **`.pcraft`**: packaging declares a "LightCraft Document" UTI with extension `pcraft` (packaging/macos/Info.plist.in:70) and the MSI mentions it (packaging/windows/lightcraft.wxs:10), but no code reads or writes `.pcraft`, the plist has no `CFBundleDocumentTypes`, and the real project format is the library folder — uncertain/stale, do not build workflows on it.
- Roadmap items "claimed but unverified" for agents: on-screen HDR display, full-resolution overlay/proof rendering at 1:1, AI masks beyond heuristics.

## How to operate

### Launch on macOS
- GUI: `open -a LightCraft` (bundle `/Applications/LightCraft.app`, identifier `ai.storyteller.lightcraft`, installed here at 0.7.1).
- For automation, launch the binary directly so flags apply:
  `"/Applications/LightCraft.app/Contents/MacOS/LightCraft" --control 7980 [--library DIR] [FILES/FOLDERS…]`
- Desktop flags are only: `--library DIR`, `--no-demo`, `--memory` (alias `--demo`; writes nothing), `--control PORT`, `--version`, `--help` (apps/lightcraft/src/main.rs:663-687,748-774). Files/folders given at launch are imported (duplicates skipped).
- Env: `LIGHTCRAFT_LIBRARY`, `LIGHTCRAFT_CONTROL_PORT`, `LIGHTCRAFT_CONFIG_DIR` (isolate automation prefs/logs), `LIGHTCRAFT_GPU_BACKEND=metal|vulkan|dx12|auto|off`, `LIGHTCRAFT_GPU=0`, `LIGHTCRAFT_LOG=info|debug` / `RUST_LOG` (apps/lightcraft/src/main.rs:676-687; docs/control-protocol.md:31-39).
- Logs: `~/Library/Application Support/LightCraft/logs/lightcraft.log` (rotated `.1`/`.2`, 16 MiB cap) (README.md:411-425).
- **The `lightcraft-cli` binary is NOT inside the .app** — on macOS it ships as a separate release asset `lightcraft-cli-<ver>-macos-universal.zip`, or build with `cargo build --release -p lightcraft-cli` (docs/mcp.md:88-103). `which lightcraft-cli` is empty on the authoring machine.

### lightcraft-cli subcommands (HEAD 0.8.0; apps/lightcraft-cli/src/main.rs:28-112)
- `run [--demo|--library DIR|--connect [ADDR]] [--import PATH]… CMD [key=value|'{json}']… [--script F] [--keep-going]`
- `mcp [--connect [ADDR]] [--demo] [--library DIR] [--compact] [FILES…]`
- `render IN -o OUT [--set control=value] [--settings F.json] [--preset ID] [--size N] [--quality Q] [--opt K=V]`
- `snapshot [--demo|--library DIR] [--script FILE.jsonl] [-o OUT.png] [--size WxH] [--scale S] [FILES…]`
- `merge hdr|panorama|hdr-panorama [--deghost …|--no-align|--projection …|--boundary-warp …|--auto-crop|--fill-edges|--preview OUT.png] FILES…`
- `synth-merge hdr|panorama -o DIR` · `commands [--json]` · `controls [--json]` · `calibrate [--max N] [--out DIR] FOLDERS…` · `denoise-serve [--model ID] [--listen ADDR] [--token-env VAR] [--run-on auto|gpu|cpu]` (denoise feature is on by default).

### Document model and workflow
- There is **one window and one library session per process; no tabs**. Views: Photo Grid, Square Grid, Detail/Loupe (Edit, Crop, Masking, Remove, Red Eye tools), Compare, Survey, People, Reference, Slideshow, full-screen preview (crates/ui-egui/src/menus.rs:57-115; README.md:204-220).
- Workflow concepts: import → rate/flag/label and cull → develop (sliders, masks, crop) → optional XMP sidecar → export/merge/contact sheet. Edits are non-destructive `DevelopSettings` in the catalog; sliders are normalized to image coordinates so previews and exports match (docs/architecture.md:Data model).
- **There is no save command for the library**: every command journal-writes (fsync) before replying; a failed write returns `ok:false` with "saved in memory but not written to disk… LightCraft will retry" and `ui.inspect` → `unsaved` reports it (docs/control-protocol.md:118-128).
- Export flow: File → Export… or `app.export` with format by extension/`format` key; "Original + Settings" copies the file plus an XMP sidecar; "DNG" writes edits embedded into a DNG of the raw. Never export over an original — the engine refuses writes to catalogued originals and their sidecars (crates/engine/src/export.rs; crates/engine/src/cmd/export.rs; docs/mcp.md:174).

### Keyboard shortcuts (verified defaults, all from crates/ui-egui/src/menus.rs:53-218)
- Views: `G` grid toggle · `D` detail · `E` Edit panel · `C` Crop · `M` Masking · `H` Remove · `I` Info · `K` Keywords · `Shift+P` Presets · `Shift+V` Versions · `N` Survey · `Shift+C` Compare · `Shift+R` Reference · `F` full-screen preview · `Shift+L` Lights Out.
- Compare: `\` show original (hold) · `Y` before/after · `Shift+Y` split · `Alt+Y` top/bottom · `Alt+Shift+Y` split top/bottom.
- Zoom/display: `Z` toggle zoom · `Cmd+=`/`Cmd+-` zoom in/out · `Cmd+0` fit · `Cmd+Alt+0` 100% · `J` clipping · `S` soft proof · `O` mask overlay · `Cmd+Shift+O` all mask overlays · `A` visualize spots · `Cmd+Shift+H` histogram · `Cmd+I` info overlay.
- Tools: `B` brush · `L` linear · `R` radial · `W` WB picker · `[`/`]` brush size · `Shift+[`/`Shift+]` feather · `Cmd+1..5` Edit sections (Light/Color/Effects/Detail/Optics).
- Library culling: `0`–`5` rating · `6`–`9` label · `P` pick · `X` reject · `U` unflag · `[`/`]` rating ∓1 (grid views) · `Cmd+Shift+D` select only active (docs/library-shortcuts.md:5-19).
- Edit/File: `Cmd+Z`/`Cmd+Shift+Z` undo/redo · `Cmd+A` select all · `Cmd+F` find · `Cmd+N` new album · `Cmd+Shift+N` new folder · `Cmd+Shift+C`/`Cmd+Shift+V` copy/paste settings · `Cmd+S` save metadata to file · `Cmd+/` all shortcuts (crates/engine/src/cmd/edit.rs:7; crates/engine/src/cmd/xmp.rs; crates/ui-egui/src/menus.rs:143-168,216).
- Shortcuts are **user-remappable** (Help → Keyboard Shortcuts, `app.setShortcut`, `app.resetShortcuts`); on macOS the native menu only executes AppKit-delivered accelerators — prefer `ui.menu.invoke`/command ids over synthesizing keys (crates/ui-egui/src/shortcuts.rs:2; docs/control-protocol.md:46-50).

### Headless operation (the safe path for agents)
- Whole-UI snapshots without a window or GPU: `lightcraft-cli snapshot --demo -o out.png --size 1600x1000` or `--script tour.jsonl` with control-protocol requests per line (`docs/showcase/run.py` is a reference driver for a live socket; `docs/control-protocol.md:223-263` for the script form).
- In a running app: `ui.screenshot {"path": …, "headless": true}` draws the UI on the CPU and keeps working when the display sleeps; windowed captures fall back to headless after 2 s (docs/control-protocol.md:223-235).
- Wait for renders before judging a screenshot: poll `ui.inspect` until `loupe.pending` is false and queues are empty, or accept `loupe.failed` (docs/control-protocol.md:52-58).

## Working with an AI agent

Legitimate agent work:
- **Prepare inputs**: batch-convert sources into formats LightCraft reads with any tool, or generate procedural demo/test images (`lightcraft-cli synth-merge`, `crates/scenes`); write XMP sidecars carrying ratings/`crs:` edits for import; build folder templates for import (`organize`, `rename`).
- **Drive headless**: `lightcraft-cli mcp` (persistent library with `--library`) or `lightcraft-cli run` chains — import → cull (`photo.rate`, `photo.flag`) → develop (`develop.set`, `develop.auto`, `mask.add`, `crop`) → export (`app.export` / `render`); discover ids via `engine.commands` and `develop.controls` instead of hard-coding labels (docs/control-protocol.md:151-156).
- **Drive the live app** via `--control PORT` + `lightcraft-cli … --connect`/`mcp --connect`, using `ui.widgets` → `ui.clickWidget` and `ui.pointer` (normalized image coordinates) — operate the real UI, not a side door (README.md:224-274).
- **Interpret the catalog**: `catalog.snap` and each `catalog.log` line are human-readable JSON (journal.rs:1-30) — read them to diagnose, but change state through commands so the journal stays consistent; do not hand-edit. Damaged logs/snapshots are repaired with `.damaged-<seq>` backups on open (crates/catalog/src/journal.rs:20-30).
- **Verify exports**: trust the command's structured result — `app.export` returns `{files:[{path,width,height,bytes,sidecars}], gpuFallback?}`; `render` prints dimensions to stderr; for visual checks use MCP `render_preview`/`render_photo` (image content) or `ui.screenshot` (docs/control-protocol.md:83; docs/mcp.md:171-174).
- **Troubleshoot**: read `~/Library/Application Support/LightCraft/logs/lightcraft.log` (and `lightcraft.1/2.log` for a crashed run); `--version`/`--help` write no log (README.md:411-425).

Must NOT:
- Send OS-level synthetic input (osascript/cliclick/accessibility) to the app — drive only the control channel/MCP (repo AGENTS.md:Running and looking at the app; the control channel exists precisely for this).
- Open one library from two processes; use `mcp --connect` for a library the app already has open.
- Assume `.pcraft`, `.lcp`, `.dcp`, lossy DNG or AVIF read/write support, video, print/book/map modules, or Lightroom plug-ins — none are implemented (see Limitations).
- Rely on photo ids across libraries/sessions — ids are library-local; re-read `library.state` after reconnecting (docs/control-protocol.md:204-207).
- Expect bit-identical Lightroom rendering; colour and tone are approximations (docs/gaps.md:18-20).

## Verification protocol

Alpha discipline, in order:
1. **Throwaway round-trip first**: copy test files to a scratch folder, run `lightcraft-cli render in.<ext> -o out.jpg --set light.exposure=0.5`, reopen the output elsewhere (`sips -g pixelWidth -g pixelHeight`, or re-import). Do this before trusting any pipeline change.
2. **Never trust a silent export**: check the JSON `ok`/`files` result, verify the file exists and has the expected dimensions; exports can legitimately finish with `gpuFallback` set — read it (docs/control-protocol.md:83).
3. **Screenshots must settle**: poll `ui.inspect` (`loupe.pending == false`, queues empty) before comparing against `plan/lightroom`-style references; a presented frame may still contain a rendering placeholder (docs/control-protocol.md:52-58).
4. **Version and back up per session**: the catalog is append-only but compaction rewrites `catalog.snap`; copy the library folder (or at least `catalog.snap`/`catalog.log`/`presets.json`) before bulk scripted edits, and record `git rev-parse HEAD`/app version in test notes. `lightcraft-cli --memory` and `snapshot --demo` write nothing — use them for dry runs.
5. **Update the app only between projects**: the installed 0.7.1 vs repo 0.8.0 gap means flags/formats can differ from this document; re-check `lightcraft --help`, `lightcraft-cli commands` and `/Applications/LightCraft.app/Contents/Info.plist` (`LightCraftVersion`) on the machine you automate.
6. **Measure, don't guess**: `LIGHTCRAFT_PROFILE=1` prints per-stage timings; budgets are slider ≤16 ms draft / loupe ≤60 ms on ~2.5 MP, export ≤1 s per 24 MP JPEG (repo AGENTS.md:Testing & performance; README.md:288-298).

## Sources & evidence

- Repo: https://github.com/storytold/lightcraft — HEAD inspected: `16dbb90499d3c63a6582fcbba1b2550a6e2da032` ("Release 0.8.0", workspace version 0.8.0, Cargo.toml:5-6), date 2026-10-14. Installed app: `/Applications/LightCraft.app`, version 0.7.1, build commit `701f78ea2e586d4748705f10fdf5c4181dc1fd49` (Contents/Info.plist).
- Key files read: `README.md`, `Cargo.toml`, `ROADMAP.md`, `AGENTS.md`, `docs/architecture.md`, `docs/control-protocol.md`, `docs/mcp.md`, `docs/gaps.md`, `docs/parity-checklist.md`, `docs/file-format-parity.md`, `docs/xmp-interop.md`, `docs/library-shortcuts.md`, `docs/denoise.md`, `docs/merge.md`, `docs/lightroom-catalog-import.md`, `docs/web.md`, `docs/showcase/README.md`.
- Code: `apps/lightcraft/src/main.rs`, `apps/lightcraft/src/control_server.rs`, `apps/lightcraft-cli/src/main.rs`, `crates/engine/src/{export.rs,library.rs,import.rs,sidecar.rs,camera_profiles.rs,cmd/*}`, `crates/catalog/src/journal.rs`, `crates/codecs/src/sniff.rs`, `crates/raw/src/lib.rs`, `crates/ui-egui/src/{menus.rs,control.rs}`, `crates/mcp/src/*`, `packaging/macos/Info.plist.in`, `packaging/macos/package.sh`.
- Shared libraries: `craft-libs` (https://github.com/storytold/craft-libs) supplies `craft-ui` (docking, SVG icons, themes) at the revision pinned in Cargo.toml:13 — consult it for shared UI/docking behavior, not for LightCraft formats.
- Every capability pointer in this skill is a repo-relative path; see `evidence.md` next to this file for the spot-check table.
