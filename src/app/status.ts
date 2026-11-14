// Version and live status of the workspace (offline cache, backend). The Status page in the
// settings and the optional status bar read from here, so neither needs the other.
import { bus } from './bus.js';

export { VERSION } from '../core/version.js';

export interface AppStatus {
  /** Offline cache (service worker) */
  cache: string;
}

const state: AppStatus = { cache: '' };

export const appStatus = {
  get: (): Readonly<AppStatus> => state,
  set(patch: Partial<AppStatus>): void {
    Object.assign(state, patch);
    bus.emit('status:change');
  },
};
