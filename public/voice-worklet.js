// Microphone capture for voice input (src/chat/voice.ts). Runs on the audio thread: copies each block of
// samples (128 frames) into bigger chunks and posts them to the page, with a loudness level for the waveform.
// Plain script, no imports: AudioWorklet modules load from the same origin (CSP script-src 'self').
class VoiceRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(2048);
    this.n = 0;
    this.active = true;
    this.port.onmessage = (e) => {
      if (e.data === 'stop') this.active = false;
    };
  }

  process(inputs) {
    if (!this.active) {
      if (this.n) this.flush();
      return false;
    }
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === this.buf.length) this.flush();
    }
    return true;
  }

  flush() {
    const chunk = this.buf.slice(0, this.n);
    this.n = 0;
    this.port.postMessage(chunk, [chunk.buffer]);
  }
}
registerProcessor('voice-recorder', VoiceRecorder);
