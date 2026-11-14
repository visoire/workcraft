// Sounds: WAV files of the project, short Web Audio tones for closing and errors.
import { prefs } from './settings.js';
import { ROOT } from './util.js';

const FILES: Record<string, string> = { notify: 'notify.wav', open: 'message.wav', sent: 'sent.wav' };
const TONES: Record<string, [number, number][]> = { close: [[740, 0.05], [520, 0.07]], error: [[300, 0.09], [220, 0.12]] };
let ctx: AudioContext | null = null;
const audio = new Map<string, HTMLAudioElement>();

function synth(name: string) {
  ctx ||= new AudioContext();
  let t = ctx.currentTime;
  for (const [freq, dur] of TONES[name] || TONES.close!) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
    t += dur * 0.8;
  }
}

export function play(name: string): void {
  if (!prefs.get('sounds')) return;
  const file = FILES[name];
  try {
    if (file) {
      if (!audio.has(name)) audio.set(name, new Audio(`${ROOT}assets/sounds/${file}`));
      const a = audio.get(name)!;
      a.volume = 0.5;
      a.currentTime = 0;
      void a.play().catch(() => {});
    } else synth(name);
  } catch {
    /* audio not available */
  }
}
