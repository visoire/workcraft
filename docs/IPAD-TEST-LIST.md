# iPad test list

What to try on a real iPad, in the order that finds the most with the least work. WorkCraft was built and tested in WebKit at iPad sizes and the
maintainer has used it on a real iPad (touch and tap and hold work); **everything below that says "not tried" has not been seen on a real device.**
Write down the iPad model, the iPadOS version and the Pencil (1st, 2nd generation, USB-C or Pro) next to every result, and keep a screen recording of
anything that looks wrong. Report in a [GitHub issue](https://github.com/visoire/workcraft/issues/new/choose).

The format follows the device checks of the iPad notes app [OwlLuna](https://github.com/owaisazmal/OwlLuna) (MIT), see [SOURCES.md](../SOURCES.md): each check says what to do and what you should see.

You need: an iPad (iPadOS 17 or newer, an M-series iPad for the heavy apps), an Apple Pencil, ideally a Magic Keyboard, the same Wi-Fi as a computer that runs
WorkCraft for sections 8 and 9, and a sheet of paper with some print on it for section 3. Use Safari first; repeat sections 1 and 2 from the Home Screen.

| Section | Time | Tried on a real iPad? |
| :--- | :--- | :--- |
| 1 First start | 5 min | partly (touch, tap and hold) |
| 2 Add to Home Screen | 5 min | not tried |
| 3 Scan a document | 15 min | not tried |
| 4 Apple Pencil in the apps | 20 min | not tried |
| 5 Focus mode and the side chat | 10 min | not tried |
| 6 Voice input | 15 min | not tried |
| 7 Back up and restore | 10 min | not tried |
| 8 Pair with the computer | 15 min | not tried |
| 9 Cloud and files | 15 min | not tried |
| 10 Heavy apps and memory | 20 min | not tried |
| 11 Windows and keyboard | 10 min | not tried |

## 1. First start

1. Open <https://workcraft.cc/app/?onboarding=1> in Safari (portrait, then landscape).
2. Tap Continue, then look at the second page (Choose your workspace).

Expect: the second page starts at the top, exactly where the first one did, Continue and the workspace tiles are reachable, only the card scrolls, and rotating the iPad
keeps it so. The card must not be pushed down by the Safari address bar. A long press on a panel header opens the panel menu.

## 2. Add to Home Screen

1. In Safari, open <https://workcraft.cc/app/> (clear the site data first so it counts as a first visit).
2. After about three seconds a notice offers **Show me how**. Tap it.
3. Follow the four steps: Share, Add to Home Screen, Add, then open WorkCraft from the new icon.

Expect: the notice does not sit on top of the chat's Send button for long (it leaves after about 20 seconds) and does not come back for two weeks; the guide shows four
steps; the installed app opens full screen without the Safari bars; the notice never shows inside the installed app. Check the main menu entry **Add to Home Screen** too.

## 3. Scan a document

1. Open the **+** menu, tap **Scan a document**, allow the camera.
2. Hold the iPad over a printed page on a table. Wait for the outline, drag a corner if it is wrong.
3. Try the looks Grey, Black and white, Colour. Add a second page. Tap **Save as PDF**.
4. Open the **+** menu again, tap **Upload files**, choose **Choose Files**, tap the three dots, and look for **Scan Documents** (Apple's own scanner).

Expect: the rear camera starts (not the front one), the page outline follows the paper, the straightened page is readable, the PDF lands in the folder `/Scans`, opens, and has both
pages. If the camera is refused or missing, the scanner offers "Take or choose a photo". Apple's Scan Documents is reachable through Upload files. Tell us how good the
page detection was on a dark table, a white table and a page under a lamp.

## 4. Apple Pencil in the apps

In PdfCraft, then in an app with a canvas (PaintCraft, VectorCraft, PixelCraft):

1. Hold the Pencil just above the screen (Pencil Pro and M2 iPads): a **hover circle** should appear, an empty circle in the tool's colour.
2. Swipe across the screen with the Pencil: the **trail** should be one smooth line with a soft highlight, not a row of beads.
3. Rest the palm on the screen while writing. Write with the Pencil, then tap with a finger: the keyboard must not pop up while the Pencil writes.
4. Pencil Pro: squeeze, and barrel-roll. Pencil 2: double-tap. Check what each does in Settings, Apple Pencil and touch.
5. Scribble over ink in PdfCraft (it should delete it). Scribble into a text field of the chat (Scribble writes text).

Expect: no ghost lines from the palm, pressure changes the line width in the brush apps, nothing freezes. Not tried: pressure and tilt in the brush apps.

## 5. Focus mode and the side chat

1. Settings, Interface, switch on **Focus mode**. The round button is now in the **top right corner**, away from the Pencil tools of an app.
2. Open two apps side by side: the panel titles must not run under that button.
3. In the side chat look at the bar above the keyboard: the model button shows only the provider mark, there is one shield or bolt button for the approval, and there is **no @ and no /
   button**. Tap it and see that only models that are ready are listed (a key saved, or Ollama running).
4. Type `@` in the message box, then `/`: the menus must still open.

Expect: nothing overlaps, every button is at least 44 points tall, the font in the menus is the interface font.

## 6. Voice input

Use the HTTPS address (the microphone needs a secure page: `workcraft.cc/app`, or your computer over HTTPS, see the [iPadOS guide](IPADOS-GUIDE.md)).

1. Tap the microphone, allow it, say "Open the finances sheet", tap again.
2. With a speech server entered (Settings, Voice input, Speech server: Groq or OpenAI with your key, or a Whisper server on your network): repeat, and use **Test the speech server**.
3. Paired to a desktop that has Handy: repeat; the text should come from Handy (the strip says so).

Expect: Safari's own recognizer works on its own (words appear while you speak); a speech server returns text after you stop; the error messages say what to do (microphone blocked, insecure page, server unreachable).

## 7. Back up and restore

1. Project menu (the project name in the tree), **Back up everything (ZIP)**. The share sheet opens: choose **Save to Files**, then iCloud Drive.
2. Delete nothing. Project menu, **Restore from a backup**, pick the file from Files, confirm.

Expect: the ZIP is saved, the restore adds every project as a copy (names that exist get "(restored date)"), nothing is overwritten. Also try **Export as ZIP** of one project and **Import project (ZIP)**.

## 8. Pair with the computer

1. On the computer run WorkCraft (`Start WorkCraft.cmd` / `start-workcraft.sh --lan`, or `npm run dev`). Allow Node.js on private networks in the firewall prompt.
2. On the iPad scan the QR code under Settings, iPad and network, or open the pairing link once.
3. Open a project, edit a document on the iPad and look at it on the computer, and the other way round.

Expect: the iPad shows the computer's projects, a change shows on the other side within seconds, the terminal and Ollama of the computer are usable, and the pairing survives locking the iPad.

## 9. Cloud and files

1. Main menu, **Save in the cloud**: Google Drive from the browser with your own OAuth client (see [docs/AI-SUPPORT-REFERENCE.md](AI-SUPPORT-REFERENCE.md)), and **Save a ZIP** for iCloud Drive.
2. Add a file from the Files app with **Upload files**, and share a file out with **Share or save to Files** after an export.

Expect: ZIP files land in Files, a Drive project syncs both ways, a large number of deleted files at once is **held back** and the notice asks before anything is deleted.

## 10. Heavy apps and memory

1. Open the Video, Motion and Audio workspace and start FilmCraft, then SoundCraft. Open PhotoCraft with a large picture.
2. Watch the memory badge (Settings, Status, engine report). Leave WorkCraft for a minute and come back.
3. Switch to another app for five minutes and return (Safari may have closed the tab).

Expect: heavy apps start one at a time with a longer timeout, hidden saved panels are unloaded to make room, the crash notice offers to reopen what was open, sound starts after the first tap
("Sound is off. Tap the app once to turn it on."). Report the iPad model and which app made it stop.

## 11. Windows and keyboard

1. Stage Manager: resize the WorkCraft window, add a second one with another app. Split View and Slide Over: open WorkCraft next to Safari or Files.
2. External display: connect it and open a panel in its own window (panel menu, Open in a window).
3. Magic Keyboard: `Cmd K` (command palette), `Cmd Shift K` (search), `Cmd Z`, `Tab` and arrow keys in the `@` menu.

Expect: the layout reflows without a reload, the top bar does not hide behind the status bar, and shortcuts use Cmd on the iPad.

## What to send back

For every check that did not behave: what you did, what you saw, the iPad model, iPadOS version, Pencil, Safari or Home Screen app, WorkCraft version (Settings, Status), and a screen recording.
The engine report (Settings, Status) lists the iPad measures that ran and the ones that failed.
