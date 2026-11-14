// Approval modes of the chat, and the cleanup of PowerShell's CLIXML in run-command output.
//   npx tsx --test tests/server/approval.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { needsConfirmation, failureAction } from '../../src/chat/approval.js';

process.env.WORKCRAFT_HOME = mkdtempSync(join(tmpdir(), 'wc-approval-'));
const { cleanClixml } = await import('../../src/server/terminal.js');

test('manual asks before tools that need approval, auto approval does not', () => {
  assert.equal(needsConfirmation('manual', { approval: true }), true);
  assert.equal(needsConfirmation('manual', { approval: false }), false);
  assert.equal(needsConfirmation('auto', { approval: true }), false);
  assert.equal(needsConfirmation('auto', { approval: false }), false);
});

test('a failed step waits for the user in manual mode and goes back to the model in auto mode', () => {
  assert.equal(failureAction('manual'), 'ask');
  assert.equal(failureAction('auto'), 'report');
});

test('CLIXML: progress records vanish, error text comes back as text', () => {
  assert.equal(cleanClixml('plain output'), 'plain output');
  const progress = '#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><Obj S="progress" RefId="0"><TN RefId="0"><T>System.Management.Automation.PSCustomObject</T></TN><MS><I64 N="SourceId">1</I64><PR N="Record"><AV>Preparing modules for first use.</AV></PR></MS></Obj></Objs>';
  assert.equal(cleanClixml(progress), '');
  const error = '#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><S S="Error">boom : it &lt;failed&gt;_x000D__x000A_</S><S S="Error">    + CategoryInfo : NotSpecified_x000D__x000A_</S></Objs>';
  assert.equal(cleanClixml(error), 'boom : it <failed>\n    + CategoryInfo : NotSpecified');
});
