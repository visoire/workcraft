// The pairing code for the iPad: every code decodes to the exact address, independent of the encoder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { qrEncode, qrSvg } from '../../src/core/qr.ts';

const decode = (text: string): string | null => {
  const q = qrEncode(text);
  const scale = 6;
  const quiet = 4;
  const dim = (q.size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(dim * dim * 4).fill(255);
  q.modules.forEach((row, y) => row.forEach((dark, x) => {
    if (!dark) return;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const i = (((y + quiet) * scale + dy) * dim + (x + quiet) * scale + dx) * 4;
      data[i] = data[i + 1] = data[i + 2] = 0;
    }
  }));
  return jsQR(data, dim, dim)?.data ?? null;
};

test('pairing addresses, umlauts and the largest size decode exactly', () => {
  const token = 'AbC-_9xYz0123456789AbC-_9xYz012';
  for (const text of ['a', `http://192.168.178.20:5175/pair?token=${token}`, `http://10.0.0.5:5175/pair?token=${token}`, 'ä ö ü € 日本語 ' + 'y'.repeat(60), 'z'.repeat(120), 'q'.repeat(213)]) assert.equal(decode(text), text, `version for ${text.length} bytes`);
});

test('too long text is refused and the SVG is a self-contained image', () => {
  assert.throws(() => qrEncode('x'.repeat(214)), /too long/);
  const svg = qrSvg('http://192.168.1.2:5175/pair?token=abc', { label: 'Pairing "code"' });
  assert.ok(svg.startsWith('<svg ') && svg.includes('viewBox') && !svg.includes('"code"'));
});
