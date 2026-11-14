# WorkCraft Legal Notices, Upstream Attribution, and Disclaimers

This document sets forth the legal notices, trademark disclaimers, upstream third-party app attributions, statutory warranty disclaimers, limitation of liability, and intellectual property takedown procedures for the WorkCraft project, WorkCraft, the WorkCraft companion server, the WorkCraft website, and associated distributions.

---

## 1. Trademark and Compatibility Disclaimers

### 1.1 Independent Community Project
WorkCraft is an independent open-source community project initiated and maintained by visoire. It has the workspace (WorkCraft Workspace), an optional desktop app (WorkCraft AI), both in alpha, and a website. The public wording is the same everywhere (homepage, footer, `/terms/` section 11, `/independence/`):

> This site and these projects are not affiliated with, endorsed by or sponsored by Microsoft, Adobe, Apple, Google, Anthropic, OpenAI, DeepSeek, Autodesk, Avid, Image-Line, Ableton, dotPDN, Blackmagic Design, Figma, Inc., Corel Corporation, or any other commercial company mentioned. Product names appear only to indicate which proprietary software or service an open-source feature is an alternative to or works with.

WorkCraft is also **not an official product of the ArtCraft team**. It is **not affiliated with, endorsed by, sponsored by, or associated with Adobe Inc., Microsoft Corporation, Apple Inc., or any of their subsidiaries or affiliates**.

### 1.2 Ownership of Product Names, Logos, and Brands
All product names, logos, trademarks, and registered trademarks mentioned in the WorkCraft codebase, user interface, documentation, websites, or promotional materials are the property of their respective owners:
- **Microsoft Corporation**: Microsoft, Microsoft 365, Microsoft Office, Microsoft Word, Microsoft Excel, Microsoft PowerPoint, Windows, and associated logos are trademarks or registered trademarks of Microsoft Corporation in the United States and/or other countries.
- **Adobe Inc.**: Adobe, Adobe Acrobat, Adobe Photoshop, and associated logos are trademarks or registered trademarks of Adobe Inc. in the United States and/or other countries.
- **Autodesk, Avid, Image-Line, Ableton, dotPDN, Blackmagic Design, Figma, Inc., Corel Corporation**: their product names and logos are trademarks of their respective owners and are named only to say which proprietary software an open-source feature is an alternative to.
- **Apple Inc.**: Apple, iPad, iPadOS, Safari, Apple Pencil, Magic Keyboard and Stage Manager are trademarks of Apple Inc., registered in the United States and other countries.
- **Third-Party AI Providers and Services**: Anthropic, Claude, OpenAI, ChatGPT, Google, Gemini, Google Drive, DeepSeek, xAI, Grok, Z.ai, GLM, Mistral, Groq, OpenRouter, Together AI, Ollama, LM Studio, Apple, iCloud, Microsoft, OneDrive, and Dropbox are trademarks or registered trademarks of their respective owners.
- **ArtCraft Team / storytold**: ArtCraft and the names and logos of its apps (WordCraft, GridCraft, DeckCraft, PdfCraft, PhotoCraft, LightCraft, VectorCraft, FilmCraft, EffectCraft, SoundCraft, DesignCraft, FigCraft, CADCraft, TextureCraft, MaterialCraft, AniCraft, Craft Anything) are the property of storytold and the ArtCraft team.
- **Other app authors**: the names and logos of the community and independent apps in Appendix A (for example SolidCraft, MailCraft, Paint.RS, Honeydew) belong to their respective authors.

The use of any trade name, trademark, or logo within WorkCraft is solely for identification, compatibility, and descriptive purposes, and does not imply any affiliation, sponsorship, endorsement, or approval by the respective trademark owners.

### 1.3 Technical File Format Compatibility
All references to file formats—including, but not limited to, Microsoft Word document files (`.docx`, `.doc`), Microsoft Excel spreadsheet files (`.xlsx`, `.xls`, `.xlsb`), Microsoft PowerPoint presentation files (`.pptx`), and Portable Document Format files (`.pdf`)—are used **solely for technical compatibility and interoperability descriptions**. WorkCraft and its embedded apps implement independent, clean-room parsing, rendering, and generation mechanisms for these standard file formats under established principles of fair use and interoperability.

---

## 2. Upstream Apps: Separation and License Attribution

### 2.1 Workspace and App Separation
WorkCraft maintains a strict architectural, operational, and organizational separation between the WorkCraft workspace and the apps it hosts. The workspace has **44 apps** in its catalog: 17 from the ArtCraft team, 2 community apps from other teams (SolidCraft by tangency-labs, MailCraft by UCS-Care-Group) and 25 apps by independent developers. Appendix A lists every one with its licence and source repository.

```
+---------------------------------------------------------------------------------+
|                                  WorkCraft                                      |
|  Workspace shell, window manager, split & picture-in-picture layouts, project   |
|  tree, local companion server (Hono on 127.0.0.1), terminal, snapshots, and the  |
|  Model Context Protocol (MCP) orchestration layer. Also built for the browser    |
|  (workcraft.cc/app) without the server.                                         |
|  License: MIT OR Apache-2.0 (github.com/visoire/workcraft)                      |
+---------------------------------------------------------------------------------+
                                      |
                  Each app runs as a separate page in an isolated iframe
                                      v
+-----------+ +-----------+ +-----------+ +-----------+     +--------------------+
| WordCraft | | GridCraft | | DeckCraft | | PdfCraft  | ... | 40 more apps       |
| (Rust ->  | | (Rust ->  | | (Rust ->  | | (Rust ->  |     | each with its own  |
|  Wasm)    | |  Wasm)    | |  Wasm)    | |  Wasm)    |     | author and licence |
+-----------+ +-----------+ +-----------+ +-----------+     +--------------------+
  The four office apps and 13 more by storytold and the ArtCraft team (MIT OR Apache-2.0, github.com/storytold);
  the others by their own authors under the licences in Appendix A.
```

1. **WorkCraft Workspace Layer**:
   - WorkCraft provides the workspace shell, window management, split/dock layout, floating picture-in-picture frames, project file tree, local companion server (Node.js/Hono on `127.0.0.1`), integrated terminal, project snapshot manager, and the Model Context Protocol (MCP) orchestration layer that coordinates automated workflows across applications.
   - WorkCraft is open-source software licensed under either the MIT License or the Apache License 2.0 (`MIT OR Apache-2.0`).

2. **The apps**:
   - The apps are independent programs. Each is developed and licensed by its own authors. The licence of each is the one named in Appendix A and in the app's own repository; 10 of the apps are licensed under the GNU General Public License v3.0 (Paint.RS, Picasso Suite, Align, HumanMotionCraft, Retake, Lemon Studio, Honeydew, Suhina, Pro Wave, OxiGuitar).
   - WorkCraft distributes and embeds the **official release builds** of the apps, as their authors publish them. WorkCraft drops files that belong to the hosting setup of the upstream build and not to the app (host configuration files, compressed duplicates), rewrites start-up paths where an app needs it to run from a sub folder, and adds two small scripts to the app's `index.html` (display and theme handling). Each change is documented in `public/web-builds.json` and `docs/ECOSYSTEMS.md`. Earlier, a DeckCraft 0.9.0 start-up fix is described in the project documentation; current builds of the four office apps need none.
   - WorkCraft treats the apps as separate programs: each runs in its own page or iframe and exchanges only documented messages and project files with the workspace. This describes the design; it is not legal advice, and each licence applies to its app as its authors wrote it.

3. **Where the apps are distributed from**:
   - **The public repository** (`github.com/visoire/workcraft`) contains the builds of the **four office apps** only (WordCraft, GridCraft, DeckCraft, PdfCraft), with their licence files. It does not contain the other apps.
   - **The hosted browser version** (`workcraft.cc/app`) serves the official web builds of all 44 apps, so that they can be used in a browser. Every app folder (`/app/apps/<app>/`) holds the app's own licence files where the build includes them and a `NOTICE-WorkCraft.txt` that names the app, its version, its licence and its source repository. The source code of every app is in the repository named there.
   - **On your own computer**, `npm run apps:fetch` downloads the official web build of an app from that app's own GitHub release, on request (`--yes`), after listing it. The build comes from its author under its author's licence.

4. **Maintenance of Copyright and License Notices**:
   - All upstream copyright notices, author credits, and license files are preserved intact within each application package, in each application folder and when served via `/app/apps/<app>/`.
   - WorkCraft makes no claim of ownership or copyright over any upstream app.
   - If you are an author of an app listed in Appendix A and want a notice changed or a build removed from the hosted version, write to the contact in section 5. It will be done.

---

## 3. As-Is Provision and Statutory Limitation of Liability

### 3.1 Disclaimer of Warranty ("As Is")
THE WORKCRAFT SOFTWARE, WORKSPACE, LOCAL COMPANION SERVER, DOCUMENTATION, WEBSITE, AND EMBEDDED CRAFTING ENGINES ARE PROVIDED **"AS IS" AND "AS AVAILABLE", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED**, INCLUDING BUT NOT LIMITED TO:
- THE IMPLIED WARRANTIES OF MERCHANTABILITY;
- FITNESS FOR A PARTICULAR PURPOSE;
- TITLE AND NON-INFRINGEMENT;
- ANY WARRANTY THAT THE SOFTWARE WILL BE UNINTERRUPTED, TIMELY, SECURE, ACCURATE, OR ERROR-FREE;
- ANY WARRANTY REGARDING DATA LOSS, CORRUPTION, OR ROUND-TRIP FORMAT ACCURACY OF COMPLEX DOCUMENT FILES.

### 3.2 Limitation of Liability
TO THE MAXIMUM EXTENT PERMITTED UNDER APPLICABLE LAW, IN NO EVENT SHALL VISOIRE, THE ARTCRAFT TEAM, STORYTOLD, OR ANY CONTRIBUTORS, COPYRIGHT HOLDERS, OR DISTRIBUTORS BE LIABLE FOR ANY CLAIM, DAMAGES, OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT (INCLUDING NEGLIGENCE), STRICT LIABILITY, OR OTHERWISE, ARISING FROM, OUT OF, OR IN CONNECTION WITH THE SOFTWARE, THE USE OF THE SOFTWARE, OR OTHER DEALINGS IN THE SOFTWARE.

THIS LIMITATION ENCOMPASSES ALL DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, PUNITIVE, OR CONSEQUENTIAL DAMAGES, INCLUDING BUT NOT LIMITED TO:
- LOSS OF DATA, LOSS OF SAVED WORK, OR FILE CORRUPTION;
- LOSS OF PROFITS, REVENUE, GOODWILL, OR BUSINESS OPPORTUNITIES;
- BUSINESS INTERRUPTION, COMPUTER FAILURE, OR SYSTEM MALFUNCTION;
- UNAPPROVED ACTIONS EXECUTED VIA USER-CONFIGURED SHELL TOOLS OR MCP AUTOMATIONS;
- THIRD-PARTY AI PROVIDER ACTIONS, BILLING DISPUTES, OR API KEY EXPOSURES RESULTING FROM USER CONFIGURATION.

---

## 4. Data Privacy, Local Storage, and AI Providers

### 4.1 Strict Local Execution
- **Zero Document Uploads**: WorkCraft is designed as a local-first workspace. Local document data, spreadsheet formulas, presentation slides, code files, and PDF content remain strictly on the user's local device. They are **never sent to external servers or telemetries by WorkCraft**.
- **Local Companion Server**: The local companion server binds strictly to the loopback interface (`127.0.0.1` by default) and only serves local client sessions. When local-only mode is enabled in Settings, all external outbound network requests to cloud AI providers are blocked at the engine layer.

### 4.1a The Hosted Browser Version
- `workcraft.cc/app` is the workspace built for the browser. It is a set of static files: there is no WorkCraft server behind it. Your projects, settings and chats are stored in **your browser** (IndexedDB and the Origin Private File System) and are never sent to workcraft.cc.
- An AI key you type stays in the memory of the page until you reload it, unless you choose to store it in the browser. A request to an AI provider goes from your browser to that provider.
- The website is delivered through a content delivery network (Cloudflare), which sees the technical data of a page request, such as the IP address, like any network provider does.

### 4.2 Optional Third-Party AI Providers
- **Direct Client-to-Provider Communication**: WorkCraft does not provide or broker hosted AI services. Any connection to cloud AI providers (including Anthropic, OpenAI, Google, DeepSeek, xAI, Z.ai, Mistral, Groq, OpenRouter, Together AI, or custom OpenAI-compatible endpoints) is strictly optional.
- **User-Configured API Keys**: Third-party AI providers process only data explicitly submitted by the user through the user's configured API keys. The user's relationship with third-party AI providers is governed entirely by the terms of service, acceptable use policies, and privacy notices of those respective providers.
- **Audit Logging**: WorkCraft maintains a local audit log (`~/workcraft/audit.jsonl`) recording the destination, timestamp, and metadata of all outgoing AI requests for user inspection.

### 4.3 Optional Cloud Storage
- **User-Configured Accounts**: Keeping a project in Google Drive is strictly optional and uses an OAuth client created by the user in their own Google Cloud project. WorkCraft shares no credentials and brokers no hosted service. iCloud Drive, OneDrive, Dropbox and network drives are used only as folders on the user's own computer that their own sync client keeps up to date.
- **Data Handling**: Files of a project that is kept in the cloud are sent to the chosen service only. The relationship with that service is governed by its own terms and privacy notice. Local-only mode blocks Google Drive. Requests to Google are recorded in the local audit log (destination and size, never contents).
- **Release Check**: The optional release check sends repository names and version numbers to GitHub (api.github.com) and nothing else; it is off by default.

---

## 5. Intellectual Property, DMCA & Takedown Notices

WorkCraft respects the intellectual property rights of all content creators and rights holders, and complies with applicable copyright and trademark laws, including the Digital Millennium Copyright Act (17 U.S.C. § 512, "DMCA") and international equivalents.

If you are a copyright or trademark owner, or an authorized agent thereof, and believe that any software code, media asset, or documentation hosted or distributed by the WorkCraft project infringes upon your rights, please submit a written notification to our designated intellectual property and takedown agent:

### Designated IP & Takedown Contact
- **Recipient**: WorkCraft Legal & IP Inquiries (visoire)
- **Email**: [visoire@proton.me](mailto:visoire@proton.me)
- **Subject Line**: `[IP Notice] WorkCraft / <Entity or Brand Name>`

### Required Notice Contents
To ensure prompt processing, your written notice must include:
1. **Identification of Work**: A description of the copyrighted work, trademark, or intellectual property claimed to have been infringed.
2. **Identification of Infringing Material**: A description of where the allegedly infringing material is located within WorkCraft repositories, distributions, or websites (including exact file paths, URLs, or Git commit hashes).
3. **Contact Information**: Your full legal name, mailing address, telephone number, and email address.
4. **Good Faith Statement**: A statement that you have a good faith belief that the disputed use of the material is not authorized by the copyright/trademark owner, its agent, or the law.
5. **Accuracy and Authorization Statement**: A statement, made under penalty of perjury, that the information in the notification is accurate and that you are the owner, or authorized to act on behalf of the owner, of the exclusive right that is allegedly infringed.
6. **Signature**: A physical or electronic signature of the intellectual property owner or an authorized representative.

Upon receipt of a valid notice, we will act expeditiously to investigate, remove, disable access to, or correct the relevant material in accordance with applicable statutory procedures.

---

## 6. Repository Scope and Synchronization

This legal specification applies across all official WorkCraft repositories:
- `visoire/workcraft-monorepo` (monorepo holding website and workspace sources)
- `visoire/workcraft` (open-source WorkCraft repository)
- `visoire/workcraft-ai` (open-source WorkCraft AI repository)
- `visoire/workcraft-home` (website repository, private)

Last updated: November 14, 2026

---

## Appendix A. The 44 Apps: Authors, Licences and Sources

Taken from the app catalog of the workspace (`src/ecosystems/catalog.json`). The licence column is what the catalog records; the licence of an app is always the one in its own repository. 10 apps are GPL-3.0. To correct an entry, open an issue or write to the contact in section 5.

| App | Origin | Licence | Source |
| :--- | :--- | :--- | :--- |
| WordCraft | ArtCraft team | MIT OR Apache-2.0 | [storytold/wordcraft](https://github.com/storytold/wordcraft) |
| GridCraft | ArtCraft team | MIT OR Apache-2.0 | [storytold/gridcraft](https://github.com/storytold/gridcraft) |
| DeckCraft | ArtCraft team | MIT OR Apache-2.0 | [storytold/deckcraft](https://github.com/storytold/deckcraft) |
| PdfCraft | ArtCraft team | MIT OR Apache-2.0 | [storytold/pdfcraft](https://github.com/storytold/pdfcraft) |
| PhotoCraft | ArtCraft team | MIT OR Apache-2.0 | [storytold/photocraft](https://github.com/storytold/photocraft) |
| LightCraft | ArtCraft team | MIT OR Apache-2.0 | [storytold/lightcraft](https://github.com/storytold/lightcraft) |
| VectorCraft | ArtCraft team | MIT OR Apache-2.0 | [storytold/vectorcraft](https://github.com/storytold/vectorcraft) |
| FilmCraft | ArtCraft team | MIT OR Apache-2.0 | [storytold/filmcraft](https://github.com/storytold/filmcraft) |
| EffectCraft | ArtCraft team | MIT OR Apache-2.0 | [storytold/effectcraft](https://github.com/storytold/effectcraft) |
| SoundCraft | ArtCraft team | MIT OR Apache-2.0 | [storytold/soundcraft](https://github.com/storytold/soundcraft) |
| DesignCraft | ArtCraft team | MIT OR Apache-2.0 | [storytold/designcraft](https://github.com/storytold/designcraft) |
| FigCraft | ArtCraft team | MIT OR Apache-2.0 | [storytold/figcraft](https://github.com/storytold/figcraft) |
| CADCraft | ArtCraft team | MIT OR Apache-2.0 | [storytold/cadcraft](https://github.com/storytold/cadcraft) |
| TextureCraft | ArtCraft team | MIT OR Apache-2.0 | [storytold/texturecraft](https://github.com/storytold/texturecraft) |
| MaterialCraft | ArtCraft team | MIT OR Apache-2.0 | [storytold/materialcraft](https://github.com/storytold/materialcraft) |
| SolidCraft | Community (another team) | MIT OR Apache-2.0 | [tangency-labs/solidcraft](https://github.com/tangency-labs/solidcraft) |
| MailCraft | Community (another team) | MIT OR Apache-2.0 | [UCS-Care-Group/mailcraft](https://github.com/UCS-Care-Group/mailcraft) |
| AniCraft | ArtCraft team | MIT OR Apache-2.0 | [storytold/anicraft](https://github.com/storytold/anicraft) |
| Craft Anything | ArtCraft team | MIT OR Apache-2.0 | [storytold/craft-anything](https://github.com/storytold/craft-anything) |
| TraceDraw | Independent developer | MIT OR Apache-2.0 | [tracedraw/tracedraw](https://github.com/tracedraw/tracedraw) |
| LightCraft Classic | Independent developer | MIT | [emmertex/chromaforge](https://github.com/emmertex/chromaforge) |
| FireCraft | Independent developer | MIT OR Apache-2.0 | [aliasfoxkde/FireCraft](https://github.com/aliasfoxkde/FireCraft) |
| PaintCraft | Independent developer | MIT | [replicraft/PaintCraft](https://github.com/replicraft/PaintCraft) |
| Paint.RS | Independent developer | GPL-3.0-or-later | [daijro/paint.rs](https://github.com/daijro/paint.rs) |
| ProCraft | Independent developer | MIT OR Apache-2.0 | [artcraft-android/procraft](https://github.com/artcraft-android/procraft) |
| PixelCraft | Independent developer | MIT | [asad-albadi/PixelCraft](https://github.com/asad-albadi/PixelCraft) |
| NoteCraft | Independent developer | MIT OR Apache-2.0 | [AlienTechSoftware/notecraft](https://github.com/AlienTechSoftware/notecraft) |
| TextCraft | Independent developer | MIT | [cmspeedau/NoteCraft](https://github.com/cmspeedau/NoteCraft) |
| MatCraft | Independent developer | MIT OR Apache-2.0 | [NibrasAz7/matcraft](https://github.com/NibrasAz7/matcraft) |
| Picasso Suite | Independent developer | GPL-3.0-or-later | [fabox-os/Picasso-Suite](https://github.com/fabox-os/Picasso-Suite) |
| Align | Independent developer | GPL-3.0-only | [FedyaLight/align](https://github.com/FedyaLight/align) |
| SubCraft | Independent developer | MIT OR Apache-2.0 | [Aalzard/subcraft](https://github.com/Aalzard/subcraft) |
| ClothCraft | Independent developer | MIT | [erythrofr/ClothCraft](https://github.com/erythrofr/ClothCraft) |
| HumanMotionCraft | Independent developer | GPL-3.0-or-later | [YalKouassi/HumanMotionCraft](https://github.com/YalKouassi/HumanMotionCraft) |
| OxyBrush | Independent developer | MIT OR Apache-2.0 | [crisprintsstuff/OxyBrush](https://github.com/crisprintsstuff/OxyBrush) |
| Retake | Independent developer | GPL-3.0-or-later | [geekcastradio/altered-audio-editor](https://github.com/geekcastradio/altered-audio-editor) |
| Lemon Studio | Independent developer | GPL-3.0-or-later | [daijro/Lemon-Studio-web](https://github.com/daijro/Lemon-Studio-web) |
| Honeydew | Independent developer | GPL-3.0-or-later | [daijro/honeydew](https://github.com/daijro/honeydew) |
| Suhina | Independent developer | GPL-3.0-or-later | [suhina-daw/suhina-daw](https://github.com/suhina-daw/suhina-daw) |
| Pro Wave | Independent developer | GPL-3.0-or-later | [fabox-os/Pro-Wave](https://github.com/fabox-os/Pro-Wave) |
| OxiGuitar | Independent developer | GPL-3.0-or-later | [mateusrdp/oxiguitar](https://github.com/mateusrdp/oxiguitar) |
| Transit | Independent developer | MIT OR Apache-2.0 | [transit-audio/transit](https://github.com/transit-audio/transit) |
| MixStudio | Independent developer | MIT | [soulspin/MixStudio](https://github.com/soulspin/MixStudio) |
| EarthCraft | Independent developer | MIT | [therichronicles/EarthCraft](https://github.com/therichronicles/EarthCraft) |

