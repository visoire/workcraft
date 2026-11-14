# Theming: light and dark mode for every app

How WorkCraft treats the light and dark mode of its 44 apps, and exactly what to do when you add an app or change the theme code.
Written for people and for AI agents. When this file and the code disagree, the code wins: fix this file in the same change.

## The three rules

1. **The switch of the workspace is the single source of truth.** `prefs.theme` (`system`, `light` or `dark`) in
   `src/app/settings.ts`, changed by the round switch in the top bar and by Settings, Appearance and layout, Color scheme.
2. **An app that supports both modes follows the switch**, in place, without a reload and without losing the open document.
3. **An app that has only one look keeps it**: only light stays light, only dark stays dark, and its panel is painted to match,
   so there is no light frame around a dark app and no dark frame around a light one.

An app is never blocked, patched or hidden because of its theme. If WorkCraft cannot drive an app, it says so (Settings shows it) and
leaves the app as it is.

## Two theme scopes, never mixed

| Scope | Where | Storage | Used by |
| :--- | :--- | :--- | :--- |
| `ide` | the workspace: shell, chat, PiP and every app inside a panel | `oc-ide-theme` (+ `-at`), cookie `oc_ide_theme`, channel `oc-ide-theme-channel` | `src/app/main.ts` (`applyTheme`) |
| `home` | the website, the docs page and an app opened on its own | `oc-home-theme` (+ `-at`), cookie `oc_home_theme`, channel `oc-home-theme-channel` | `src/docs/main.ts`, the website |

Use `readTheme(scope)`, `writeTheme(theme, scope)` and `watchTheme(fn, scope)` from `src/app/theme-store.js`. Changing one scope never changes the
other. `public/craft-theme.js` (inside every app) knows both: inside a panel the parent window says `ide`.

## How an app is classified

Every app in `src/ecosystems/catalog.json` has a `theme` object (read through `src/ecosystems/theme.ts`):

```json
"theme": { "modes": "both", "via": "own", "look": "dark", "evidence": "Settings, Appearance: Sync with System, Dark Mode, Light Mode (default Dark)" }
```

| Field | Meaning |
| :--- | :--- |
| `modes` | `both`, `light` or `dark`: the looks the app has |
| `via` | how WorkCraft reaches it (table below) |
| `look` | the look an `own` app shows until its user changes it |
| `evidence` | where the fact comes from (measured in a browser, or the place in the source): never leave it out |

| `via` | What it is | Follows the switch | Where it is handled |
| :--- | :--- | :---: | :--- |
| `media` | the app reads `prefers-color-scheme` through `matchMedia` (egui apps with the System theme, CSS-in-JS) | yes | `public/craft-theme.js` replaces `window.matchMedia` with an answer from the WorkCraft theme and fires `change` |
| `switch` | the app has a switch of its own that can be pressed from outside (WordCraft, DeckCraft) | yes | `public/craft-theme.js` sets WordCraft to "Use system setting" once and presses DeckCraft's switch |
| `css` | the app styles its dark mode with a CSS `@media (prefers-color-scheme: ...)` rule (Align) | yes | the CSS bridge in `public/craft-theme.js` rewrites those rules |
| `own` | the app has a light and dark choice of its own that cannot be set from outside | no | the app shows `look`; the panel frame is painted for it |
| `fixed` | the app has one look (`modes` says which) | no | the script tells the app that look, whatever the workspace shows; the panel frame is painted for it |

`media`, `switch` and `css` need `modes: "both"`. `fixed` needs `modes: "light"` or `"dark"`. `tests/server/theme.test.ts` checks this.

### Why not make every app follow?

Most pro apps (PhotoCraft, LightCraft, FilmCraft, EffectCraft, SoundCraft, VectorCraft, DesignCraft, CADCraft, TextureCraft, MaterialCraft
and others) have a light and dark theme of their own and ship on one of them (usually dark). Their choice is a preference inside the app
(PhotoCraft: Preferences, Interface, Appearance Mode: Auto, Dark, Light). The workspace cannot set it from outside:
the web build of PhotoCraft reads its preferences from somewhere other than `localStorage` and overwrites the key at startup (verified
by writing `interface.appearanceMode = "auto"` before the start: the app wrote `"dark"` back). Until an app offers a way in, it is `own`.
If an app's user picks "Sync with System" or Auto inside the app, the app should follow the workspace like a `media` app, because it then
reads `matchMedia`, which the script answers. This is the expected behavior of egui's System theme and was seen with PdfCraft; it has not been
checked app by app, so check it with the audit before you rely on it.

**What would make them follow** (ask the app's repository): a startup parameter (`?theme=system`) or a documented `localStorage` key that
the app honors, or a default of Auto. Then change `via` to `media` and run the audit below.

## What the workspace does around an app

`src/workspace/app-theme.ts` resolves the workspace look (`workspaceLook()`) and puts three attributes on every app panel (`.ca`):

- `data-look`: the look the panel shows (`light` or `dark`)
- `data-theme-kind`: `follows`, `own`, `always-light` or `always-dark`
- `data-differs`: `true` when the app keeps a look that differs from the workspace

`src/styles/ecosystems.css` paints the frame (`#121214` or `#f3f3f3`, the same colors as `BG` in `craft-theme.js`) when `data-differs` is `true`.
`bindPanelLook` keeps it current when the switch or the system theme changes and is removed with the panel.

The workspace posts `{ type: 'workcraft:theme', scope: 'ide', theme }` to every app iframe on each change (`applyTheme` in `src/app/main.ts`)
and the script re-applies it. A theme change never reloads an app.

## The CSS bridge

`matchMedia` can be replaced, CSS media queries cannot: the browser evaluates `@media (prefers-color-scheme: dark)` itself, from the operating
system. An app that styles its dark mode that way follows the OS and clashes with the workspace. `public/craft-theme.js` therefore walks the
same-origin stylesheets, remembers every media rule that names the color scheme, and rewrites its media text: the clause becomes
`(min-width: 0px)` (true) when the rule should apply and `(max-width: 0px)` (false) when not, other clauses stay. It runs when the
page loads, when a stylesheet or `<style>` element is added, and on every theme change. Cross-origin stylesheets cannot be read and are left alone.

## Apps with a button of their own: the button driver 

The rule is that the workspace switch drives every app, also an app that has a switch of its own. Most apps follow `prefers-color-scheme`
(the bridge above). An app with its own explicit Dark/Light setting does not, and its web build gives no way to set it from outside
(PhotoCraft's saved preferences are mirrored into `localStorage` but never read back at start: seeding them, in an init script or from
the page, changes nothing; no hook, no URL parameter). What the apps do have is a button in the top bar. **PhotoCraft, FilmCraft and
EffectCraft** (one design family) have a moon button that cycles **Dark, Auto, Light** and start on Dark every time. `public/craft-theme.js`
presses it (`OWN_BUTTONS`: the distance from the right edge and the top in points, and the narrowest canvas the top bar keeps its layout at)
until the app is on **Auto**; from then on the app follows the switch live, like GridCraft. PhotoCraft mirrors its mode into
`localStorage "photocraft.preferences"` (`interface.appearanceMode`), so the script presses until it reads `auto`; the other two have no
readable state and get one press from the Dark start. The press waits for a canvas wide enough (a narrow panel is left alone until there is
room, full screen brings it) and uses the same synthetic pointer sequence as the DeckCraft switch. The catalog says `via: switch` for them.

Checked in Edge (headless, software GL) with the app in a full-screen panel: light workspace, light app; dark workspace, dark app, for
PhotoCraft, FilmCraft and EffectCraft. **LightCraft** has the same button, but its Welcome dialog covers it at the first start, so it is not
driven (`own`); press its button once to Auto. **The other apps with a setting of their own** (SoundCraft, VectorCraft, DesignCraft, CADCraft,
TextureCraft, MaterialCraft, SolidCraft, TraceDraw, PaintCraft and so on) have no known button or readable state; they keep their look and
their panel is painted for it. To add a driver for an app: find its button and the order of its cycle, measure the offsets from the right
edge at two widths, add it to `OWN_BUTTONS` and set `via: switch` in the catalog; verify with a screenshot in a light and a dark workspace.

## The per-app table (from the catalog)

| App | Id | Modes | Via | Result | Evidence |
| :--- | :--- | :--- | :--- | :--- | :--- |
| WordCraft | `wordcraft` | both | `switch` | Follows the switch | Interface theme in Options; the script sets "Use system setting" once |
| GridCraft | `gridcraft` | both | `media` | Follows the switch | egui follows prefers-color-scheme |
| DeckCraft | `deckcraft` | both | `switch` | Follows the switch | own switch in the title bar; the script presses it |
| PdfCraft | `pdfcraft` | both | `media` | Follows the switch | theme pinned to System by public/craft-theme.js |
| PhotoCraft | `photocraft` | both | `switch` | Follows the switch | a moon button in the top bar cycles Dark, Auto, Light and the app starts on Dark every time; the script presses it once to Auto (PhotoCraft: until its saved mode says auto), then it follows the workspace switch. Measured in a panel: light workspace, light app; dark workspace, dark app |
| LightCraft | `lightcraft` | both | `own` | Own setting, shows dark | Settings, Appearance: Sync with System, Dark Mode, Light Mode (default Dark). It has the same moon button, but its Welcome dialog covers it at the first start, so the script leaves it alone: press the button once to Auto yourself |
| VectorCraft | `vectorcraft` | both | `own` | Own setting, shows dark | named themes with a dark flag; default dark |
| FilmCraft | `filmcraft` | both | `switch` | Follows the switch | a moon button in the top bar cycles Dark, Auto, Light and the app starts on Dark every time; the script presses it once to Auto (PhotoCraft: until its saved mode says auto), then it follows the workspace switch. Measured in a panel: light workspace, light app; dark workspace, dark app |
| EffectCraft | `effectcraft` | both | `switch` | Follows the switch | a moon button in the top bar cycles Dark, Auto, Light and the app starts on Dark every time; the script presses it once to Auto (PhotoCraft: until its saved mode says auto), then it follows the workspace switch. Measured in a panel: light workspace, light app; dark workspace, dark app |
| SoundCraft | `soundcraft` | both | `own` | Own setting, shows dark | named themes with a light flag; default dark |
| DesignCraft | `designcraft` | both | `own` | Own setting, shows dark | named themes with a dark flag; default dark |
| FigCraft | `figcraft` | both | `media` | Follows the switch | measured: follows |
| CADCraft | `cadcraft` | both | `own` | Own setting, shows dark | Interface theme: system, light or dark; ships on dark |
| TextureCraft | `texturecraft` | both | `own` | Own setting, shows dark | named themes with a dark flag; default dark |
| MaterialCraft | `materialcraft` | both | `own` | Own setting, shows dark | named themes with a dark flag; default dark |
| SolidCraft | `solidcraft` | both | `own` | Own setting, shows dark | theme crate with light and dark; measured in a panel: dark (the standalone page was still loading and looked light) |
| MailCraft | `mailcraft` | both | `media` | Follows the switch | measured: follows |
| AniCraft | `anicraft` | dark | `fixed` | Always dark | Visuals::dark only |
| Craft Anything | `craft-anything` | dark | `fixed` | Always dark | viewer sets ThemePreference::Dark |
| TraceDraw | `tracedraw` | both | `own` | Own setting, shows light | theme module with Light and Dark; ships on light |
| LightCraft Classic | `lightcraft-classic` | both | `own` | Own setting, shows dark | light and dark themes in the source; default dark; the build panics at startup in the panel (std::process::id), so the look was not measured |
| FireCraft | `firecraft` | dark | `fixed` | Always dark | measured in a panel: dark only; no dark or light switch in the source (the standalone page was still loading) |
| PaintCraft | `paintcraft` | both | `own` | Own setting, shows dark | settings theme preference (system, light, dark); ships on dark; did not finish starting within 60 s in the panel, so the look was not measured |
| Paint.RS | `paintrs` | both | `media` | Follows the switch | measured: follows |
| ProCraft | `procraft` | dark | `fixed` | Always dark | measured on a real GPU (WebGPU) in a panel: starts in about 10 s, dark only; no light theme in the source |
| PixelCraft | `pixelcraft` | both | `media` | Follows the switch | measured: follows |
| NoteCraft | `notecraft` | both | `media` | Follows the switch | measured: follows |
| TextCraft | `textcraft` | both | `own` | Own setting, shows dark | palette with a dark flag; default dark |
| MatCraft | `matcraft` | light | `fixed` | Always light | measured: light only |
| Picasso Suite | `picasso-suite` | both | `own` | Own setting, shows dark | light and dark visuals in the source; the web build stops at startup (std::time), so only the source was read; the build panics at startup in the panel too |
| Align | `align` | both | `css` | Follows the switch | CSS @media (prefers-color-scheme): followed the OS until the CSS bridge |
| SubCraft | `subcraft` | dark | `fixed` | Always dark | measured: dark only; no light theme in the source |
| ClothCraft | `clothcraft` | both | `own` | Own setting, shows light | prefs.theme; default light |
| HumanMotionCraft | `humanmotioncraft` | both | `own` | Own setting, shows dark | Theme enum Dark and Light; default dark |
| OxyBrush | `oxybrush` | both | `own` | Own setting, shows dark | Visuals light and dark in the settings; default dark; not measurable in the headless test browser (no WebGPU adapter); the panel offers Load with WebGL2 |
| Retake | `retake` | dark | `fixed` | Always dark | measured: dark only; no light theme in the source |
| Lemon Studio | `lemon-studio` | dark | `fixed` | Always dark | measured: dark only; not measurable in the headless test browser (needs cross-origin isolation; the panel offers Enable and reload) |
| Honeydew | `honeydew` | dark | `fixed` | Always dark | measured: dark only; no light theme in the source |
| Suhina | `suhina` | dark | `fixed` | Always dark | measured: dark only |
| Pro Wave | `prowave` | dark | `fixed` | Always dark | measured: dark only; no light theme in the source |
| OxiGuitar | `oxiguitar` | both | `media` | Follows the switch | measured: follows |
| Transit | `transit` | both | `media` | Follows the switch | measured: follows |
| MixStudio | `mixstudio` | dark | `fixed` | Always dark | measured: dark only; no light theme in the source |
| EarthCraft | `earthcraft` | dark | `fixed` | Always dark | measured: dark only; no light theme in the source; the build panics at startup in the panel and its map data needs the internet, which the workspace blocks |

## Adding an app, or changing how one behaves

1. Add the app to `src/ecosystems/catalog.json` with a `theme` object. Start with `{ "modes": "dark", "via": "fixed", "evidence": "not checked" }`.
2. Build or fetch the web build (`npm run apps:fetch` or `apps:import`), then measure it:
   ```sh
   npm run apps:audit -- --app <id>          # the app on its own, 1280 x 800, OS set to the opposite of the WorkCraft theme
   npm run apps:audit-panels -- --app <id>   # inside the workspace panel at 1440 x 900, needs the dev server on 5185 and a temporary data folder
   ```
   Both need `PLAYWRIGHT_MODULE` (a playwright-core folder) and `CHROMIUM` (a Chrome or Edge executable). The first prints a verdict
   (`follows`, `dark only`, `light only`, `unclear`, `no picture`) and compares it with the catalog; the second also checks that the panel
   frame matches and that the app comes back when the switch goes back.
3. Set `modes`, `via`, `look` and `evidence` from what you measured:
   - the picture gets clearly darker in dark: `media` (or `css` when the app uses a CSS media rule and only the CSS bridge made it follow)
   - the picture does not change: look in the source for a light and dark choice. A choice exists: `own` with the `look` it ships on.
     None: `fixed` with the one look
   - an app with its own switch that a script can press: `switch`, and add the driver to `public/craft-theme.js` (see WordCraft and DeckCraft)
4. `npm run themes:sync` writes the map that `public/craft-theme.js` embeds. Commit the catalog and the script together.
5. `npm test` (the theme test fails when the map is stale), then update the table above (generated from the catalog), `CHANGELOG.md`
   and `src/docs/content.md` (the page "Light and dark mode").

Rules that keep this working:

- **Never patch an engine for its theme.** Add a measure to `public/craft-theme.js` (a capability check), document it here, and let the engine win.
- **Do not hard-code app ids** in the script or the panel. Everything is read from the catalog (the script gets it through `themes:sync`).
- **Always test with the OS set to the opposite of the WorkCraft theme.** An app that follows the OS instead of the switch is the bug this
  guide exists for. The audit scripts do this.
- **Do not store a theme per app.** There is one choice, the switch. Do not add a second toggle in a panel.
- The website has its own switch (scope `home`); it must never change the workspace and the other way round.

## Traps

- An iframe whose `color-scheme` differs from the page around it gets an opaque canvas background from the browser. The script sets
  `color-scheme` on the app's root to the look it resolved; do not remove that.
- `<meta name="color-scheme" content="dark">` in an engine's `index.html` is static. It does not make the app dark-only; measure.
- The first frames of an app can be drawn before the script has applied the theme (a short flash). The panel keeps its loading overlay until the
  app has started, and WordCraft waits for `__ocThemeReady`.
- DeckCraft and WordCraft are driven with synthetic clicks at fixed positions in the canvas. A new release can move them (see `docs/IPADOS-COMPAT.md`
  for the same family of problems); re-measure after an engine update.
- egui remembers a theme preference in `egui_memory_ron` (localStorage). PdfCraft is pinned to System by the script; other apps keep what the
  user chose inside the app.

## Files

| File | Role |
| :--- | :--- |
| `src/ecosystems/catalog.json` | the `theme` of every app (the data) |
| `src/ecosystems/theme.ts` | pure rules: `themeOf`, `lookIn`, `appLook`, `kindOf`, `describeTheme`, `scriptMap` |
| `src/workspace/app-theme.ts` | `workspaceLook()`, `panelLook()`, `bindPanelLook()` (the DOM side) |
| `src/workspace/panels/craftapp.ts` | binds the look to every app panel |
| `src/styles/ecosystems.css` | the frame colors for an app that keeps a look that differs |
| `src/workspace/panels/settings.ts` | Settings, Appearance and layout: the list of apps and what each does |
| `public/craft-theme.js` | runs inside every app: `matchMedia` answer, switches, CSS bridge, forced look; embeds the map |
| `scripts/sync-themes.mjs` | `npm run themes:sync`: writes the map from the catalog |
| `scripts/audit-apps.mjs`, `scripts/audit-panels.mjs` | measure every app in a real browser |
| `tests/server/theme.test.ts` | the data, the rules, the embedded map and the bridge |

## What was measured (2026-11-12)

All 44 apps were loaded in Edge with the OS set to the opposite of the WorkCraft theme. 15 apps follow the switch (three of them because the script presses their own button to Auto), 16 have a setting of their own and 13 have one look. Then every app was opened in a full-screen panel on a 1440 x 900 desktop screen (`npm run apps:audit-panels`) with the workspace in light, dark and light again: the apps that follow got clearly darker and came back, the others kept their look and their frame. 39 of the 44 apps started within 10 s in the panel (TextureCraft needed 46 s, SubCraft and MixStudio 25 s). Not judged on this machine: OxyBrush (no WebGPU adapter in the headless browser; the panel offers Load with WebGL2), Lemon Studio (needs cross-origin isolation; the panel offers Enable and reload), and four builds that stop at startup by themselves: Picasso Suite (std::time), LightCraft Classic (std::process::id), EarthCraft (panic, and its map data needs the internet) and MailCraft (a panic after start; it still draws and follows the switch). PaintCraft did not finish starting within 60 s. ProCraft did not either in that headless run, which has no WebGPU; opened later in a browser with a real GPU it starts in about 10 s and is dark only. The standalone page of SolidCraft and FireCraft looked light only because it was still loading: in a panel both are dark. A page that is still loading is not a measurement, which is why the panel audit waits for the start signal of the app.
