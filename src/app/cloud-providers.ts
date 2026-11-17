/**
 * Which cloud services WorkCraft offers, and what the simplest way to each one is on THIS device. Pure (no DOM, no network), so
 * tests/server/cloud-providers.test.ts keeps the rules; src/app/cloud-guide.ts draws the guide.
 *
 * Every service works the same way: it syncs a folder (its desktop app does that), WorkCraft keeps a copy of the project inside that
 * folder. No account is typed into WorkCraft and nothing needs an API key. Where a folder cannot be reached (iPad, Safari, Firefox)
 * the project goes out as a ZIP through the share sheet ("Save to Files" lists iCloud Drive and every cloud app that is installed),
 * and the ZIP is also the way out for any service that is not in the list.
 */

export interface Provider {
  id: string;
  name: string;
  /** One or two letters, shown where the icon cannot be (and for a service without one) */
  mark: string;
  /** The icon of the service, a local file in public/assets/cloud/ (CC0 icon set, see its ATTRIBUTION.txt); none for "another service" */
  logo?: string;
  /** Where to get the desktop app or the app (the page of the service) */
  site: string;
  /** The service shows up in the Files app of an iPad once its app is installed (iCloud Drive is built in) */
  inFiles: boolean;
  /** Built in on Apple devices */
  builtIn?: boolean;
}

export const PROVIDERS: readonly Provider[] = [
  { id: 'gdrive', name: 'Google Drive', mark: 'G', logo: 'gdrive.svg', site: 'https://www.google.com/drive/download/', inFiles: true },
  { id: 'icloud', name: 'iCloud Drive', mark: 'iC', logo: 'icloud.svg', site: 'https://www.apple.com/icloud/', inFiles: true, builtIn: true },
  { id: 'onedrive', name: 'OneDrive', mark: 'O', logo: 'onedrive.svg', site: 'https://www.microsoft.com/microsoft-365/onedrive/download', inFiles: true },
  { id: 'dropbox', name: 'Dropbox', mark: 'D', logo: 'dropbox.svg', site: 'https://www.dropbox.com/install', inFiles: true },
  { id: 'mega', name: 'MEGA', mark: 'M', logo: 'mega.svg', site: 'https://mega.io/desktop', inFiles: true },
  { id: 'proton', name: 'Proton Drive', mark: 'P', logo: 'proton.svg', site: 'https://proton.me/drive/download', inFiles: true },
  { id: 'other', name: 'Another service', mark: '+', site: '', inFiles: true },
];

export const providerById = (id: string): Provider | undefined => PROVIDERS.find((p) => p.id === id);

/** What the device can do. `detected` is whether the folder of this service was found on the computer (desktop with a backend only). */
export interface Ctx {
  /** No way to a folder of the computer from here (iPad, iPhone, Safari, Firefox, or a paired desktop seen from another device): the ZIP is the way */
  noFolder: boolean;
  /** No desktop backend: the project lives in this browser */
  browserMode: boolean;
  /** showDirectoryPicker exists (Chrome, Edge on a computer) */
  canPick: boolean;
  /** The folder of this service was found on the computer that runs WorkCraft */
  detected: boolean;
}

/**
 * The ways to connect, best first. 'folder-found' (one button, the folder was found), 'folder-pick' (the browser's folder picker),
 * 'folder-path' (type or paste the folder, desktop backend), 'zip' (ZIP through the share sheet or a download). 'zip' is always last, so
 * there is always a way.
 */
export type Route = 'folder-found' | 'folder-pick' | 'folder-path' | 'zip';

export function routesFor(p: Provider, c: Ctx): Route[] {
  const out: Route[] = [];
  if (!c.noFolder) {
    if (c.browserMode) {
      if (c.canPick) out.push('folder-pick');
    } else if (c.detected && p.id !== 'other') out.push('folder-found');
    else out.push('folder-path');
  }
  out.push('zip');
  return out;
}

/** The steps of the short tutorial, English source text with {name}; the guide translates them. */
export function stepsFor(p: Provider, route: Route): string[] {
  switch (route) {
    case 'folder-found':
      return ['{name} is installed on this computer.', 'Press Use this folder. WorkCraft keeps a copy of the project in a folder called WorkCraft inside it.', '{name} syncs it to the cloud by itself. Changes go both ways.'];
    case 'folder-path':
      return p.id === 'other'
        ? ['Install the app of your service for desktop and sign in. It creates a folder that it syncs.', 'Paste the path of that folder below.', 'Press Use this folder. WorkCraft keeps a copy of the project in a folder called WorkCraft inside it.']
        : ['Install {name} for desktop and sign in (the button below). It creates a folder that it syncs.', 'Press Check again, or paste the path of that folder below.', 'Press Use this folder. WorkCraft keeps a copy of the project in a folder called WorkCraft inside it.'];
    case 'folder-pick':
      return p.id === 'other'
        ? ['Install the app of your service for desktop and sign in. It creates a folder that it syncs.', 'Press Choose the folder and pick it. The browser asks you to allow it once.', 'WorkCraft keeps a copy of the project in a folder called WorkCraft inside it.']
        : ['Install {name} for desktop and sign in (the button below). It creates a folder that it syncs.', 'Press Choose the folder and pick the {name} folder. The browser asks you to allow it once.', 'WorkCraft keeps a copy of the project in a folder called WorkCraft inside it.'];
    case 'zip':
      return p.builtIn
        ? ['{name} is part of this device. Nothing to install.', 'Press Save ZIP and choose {name} in the list that opens.', 'Do it again whenever you want a fresh copy. The project also stays here.']
        : p.id === 'other'
          ? ['Install the app of your service and sign in. It then shows up in Files.', 'Press Save ZIP and choose your service in the list that opens.', 'Do it again whenever you want a fresh copy. The project also stays here.']
          : ['Install the {name} app and sign in. It then shows up in Files.', 'Press Save ZIP and choose {name} in the list that opens.', 'Do it again whenever you want a fresh copy. The project also stays here.'];
  }
}

/** Every text the guide shows from the steps, so the German dictionary can be checked against it. */
export const ALL_STEPS: readonly string[] = [...new Set(PROVIDERS.flatMap((p) => (['folder-found', 'folder-path', 'folder-pick', 'zip'] as Route[]).flatMap((r) => stepsFor(p, r))))];

/** A ZIP name for the project: letters, digits and dashes, the date at the end. */
export function zipName(project: string, now = new Date()): string {
  const base = project.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'project';
  return `${base}-${now.toISOString().slice(0, 10)}.zip`;
}
