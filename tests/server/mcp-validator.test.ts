// The schema validator of the backend's MCP clients (src/server/mcp-validator.ts): Rust number formats do not print
// warnings, they still validate, and warnings about anything else still reach the console.
//   npx tsx --test tests/server/mcp-validator.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mcpSchemaValidator } from '../../src/server/mcp-validator.js';

const schema = { type: 'object', properties: { index: { type: 'integer', format: 'uint' }, quality: { type: 'integer', format: 'uint8', maximum: 100 } }, required: ['index'] };

function capture(fn: () => void): string[] {
  const seen: string[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => void seen.push(String(a[0]));
  try {
    fn();
  } finally {
    console.warn = warn;
  }
  return seen;
}

test('Rust number formats (uint, uint8, uint32, uint64) are compiled without a warning', () => {
  const seen = capture(() => {
    mcpSchemaValidator.getValidator({ ...schema, properties: { ...schema.properties, w: { type: 'integer', format: 'uint32' }, job: { type: 'integer', format: 'uint64' } } });
  });
  assert.deepEqual(seen, []);
});

test('the schema still validates: required fields, types and ranges', () => {
  const v = mcpSchemaValidator.getValidator<{ index: number }>(schema);
  assert.equal(v({ index: 3, quality: 90 }).valid, true);
  assert.equal(v({ quality: 90 }).valid, false);
  assert.equal(v({ index: 'x' }).valid, false);
  assert.equal(v({ index: 1, quality: 400 }).valid, false);
});

test('console.warn is restored afterwards, and another warning is passed on', () => {
  const before = console.warn;
  mcpSchemaValidator.getValidator(schema);
  assert.equal(console.warn, before);
  const seen = capture(() => console.warn('something else is wrong'));
  assert.deepEqual(seen, ['something else is wrong']);
});
