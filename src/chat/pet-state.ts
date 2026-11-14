// What Blip, the chat companion, is doing. Pure: a snapshot of the chat in, a mascot state out.
// The mascot kit (blip.js) has the poses; this decides which one fits the moment and keeps it calm:
// no pose changes twice a second, and after a minute without activity Blip falls asleep.
//
//   offline      nothing answers (no backend or no model)
//   thinking     the model is in a thinking round
//   working      a tool reads; coding: a tool writes or runs something
//   listening    the microphone is open (voice input)
//   error        the last answer or the voice input failed
//   success      an answer just finished
//   sleep / idle

import type { BlipState } from './blip.js';

export interface PetSnapshot {
  /** An answer is being produced (single agent or team) */
  busy: boolean;
  /** The model is in a thinking round and has not started to answer or call a tool */
  thinking: boolean;
  /** Name of the tool that runs right now, if one does */
  tool: string | null;
  /** The last answer ended with an error (or the voice input failed) */
  error: boolean;
  /** The microphone is open and Blip is listening */
  listening?: boolean;
  /** No AI model or backend is reachable */
  offline: boolean;
  /** Milliseconds since the last answer finished without error (null: none yet) */
  sinceDoneMs: number | null;
  /** Milliseconds without any activity in the chat */
  idleMs: number;
}

/** After an answer: how long Blip celebrates */
export const SUCCESS_MS = 2600;
/** Without activity for this long Blip sleeps */
export const SLEEP_MS = 90_000;

/** Tools that write or run something: Blip types. Reading tools get the calmer working pose. */
const WRITES = /^(run-command|write-|create-|sign-pdf|images-to-pdf|cloud-export|remember)/;

export function petStateFor(s: PetSnapshot): BlipState {
  if (s.offline) return 'offline';
  if (s.busy) {
    if (s.error) return 'error';
    if (s.tool) return WRITES.test(s.tool) ? 'coding' : 'working';
    if (s.thinking) return 'thinking';
    return 'working';
  }
  // The microphone is open: Blip listens, and a failed recording is a plain error
  if (s.listening) return 'listening';
  if (s.error) return 'error';
  if (s.sinceDoneMs !== null && s.sinceDoneMs < SUCCESS_MS) return 'success';
  if (s.idleMs >= SLEEP_MS) return 'sleep';
  return 'idle';
}
