import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  parseCanonicalExecutionExitMarker,
  readCanonicalExecutionExitMarkerFile,
  assertExecutionBatchRetryLineage
} from '../index.js';

test('canonical exit marker parser rejects normalization and unsafe integer representations', () => {
  for (const marker of ['-0', '00', '-00', '+0', ' 0', '0\n', '9007199254740992', '-9007199254740992']) {
    assert.throws(() => parseCanonicalExecutionExitMarker(marker), /malformed|canonical safe integer/u);
  }
  assert.equal(parseCanonicalExecutionExitMarker(''), null);
  assert.equal(parseCanonicalExecutionExitMarker('0'), 0);
  assert.equal(parseCanonicalExecutionExitMarker('7'), 7);
  assert.equal(parseCanonicalExecutionExitMarker('-7'), -7);
  assert.equal(parseCanonicalExecutionExitMarker(String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
});

test('exit marker file reader is bounded, no-follow, stable-identity and absent-safe', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'execution-observation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const valid = path.join(root, 'valid.exit');
  const empty = path.join(root, 'empty.exit');
  const oversized = path.join(root, 'oversized.exit');
  const malformed = path.join(root, 'malformed.exit');
  const link = path.join(root, 'link.exit');
  fs.writeFileSync(valid, '0', { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(empty, '', { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(oversized, '1'.repeat(65), { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(malformed, '-0', { flag: 'wx', mode: 0o600 });
  fs.symlinkSync(valid, link);
  assert.equal(await readCanonicalExecutionExitMarkerFile(valid), 0);
  assert.equal(await readCanonicalExecutionExitMarkerFile(empty), null);
  assert.equal(await readCanonicalExecutionExitMarkerFile(path.join(root, 'absent.exit')), null);
  await assert.rejects(() => readCanonicalExecutionExitMarkerFile(oversized), /bounded regular file/u);
  await assert.rejects(() => readCanonicalExecutionExitMarkerFile(malformed), /malformed/u);
  await assert.rejects(() => readCanonicalExecutionExitMarkerFile(link), error =>
    ['ELOOP', 'EINVAL', 'ENOTSUP'].includes(error?.code) || /symbolic|symlink|regular file/i.test(error.message));
});

function validRetryLineage() {
  const batchId = 'batch-observation-1';
  const items = [
    { task_id: 'task-a', status: 'COMPLETED', exit_code: 0 },
    { task_id: 'task-b', status: 'COMPLETED', exit_code: 0 }
  ];
  const creationEvents = [{ type: 'execution.batch.created', payload: {
    batchId, attempt: 1, taskIds: ['task-a', 'task-b']
  } }];
  const retryEvents = [{ type: 'execution.batch.retry_started', payload: { batchId, attempt: 2 } }];
  const terminalEvents = [
    { type: 'execution.batch.failed', payload: {
      batchId, attempt: 1, status: 'FAILED', itemCount: 2, failedCount: 1
    } },
    { type: 'execution.batch.completed', payload: {
      batchId, attempt: 2, status: 'COMPLETED', itemCount: 2, failedCount: 0
    } }
  ];
  return { batchId, creationEvents, retryEvents, terminalEvents, finalAttempt: 2, items };
}

test('batch retry lineage verifier accepts genuine contiguous retry history', () => {
  assert.deepEqual(assertExecutionBatchRetryLineage(validRetryLineage()), {
    initialAttempt: 1, finalAttempt: 2, retryCount: 1, itemCount: 2
  });
});

test('batch retry lineage verifier rejects missing, duplicate, mismatched or false-success evidence', () => {
  const valid = validRetryLineage();
  assert.throws(() => assertExecutionBatchRetryLineage({
    ...valid, retryEvents: []
  }), /retry history is missing/u);
  assert.throws(() => assertExecutionBatchRetryLineage({
    ...valid, terminalEvents: valid.terminalEvents.slice(1)
  }), /terminal event history does not cover/u);
  assert.throws(() => assertExecutionBatchRetryLineage({
    ...valid, terminalEvents: [...valid.terminalEvents, valid.terminalEvents[1]]
  }), /terminal event history does not cover|duplicate attempt/u);
  assert.throws(() => assertExecutionBatchRetryLineage({
    ...valid, items: [{ ...valid.items[0], task_id: 'other' }, valid.items[1]]
  }), /task set does not match/u);
  assert.throws(() => assertExecutionBatchRetryLineage({
    ...valid, items: [{ ...valid.items[0], exit_code: 1 }, valid.items[1]]
  }), /conflicts with durable item statuses/u);
  assert.throws(() => assertExecutionBatchRetryLineage({
    ...valid, retryEvents: [{ ...valid.retryEvents[0], payload: { batchId: 'other', attempt: 2 } }]
  }), /mismatched event/u);
});

test('execution observation module remains independent of SQLite and process-launch APIs', async () => {
  const source = await fs.promises.readFile(new URL('../src/execution-observation.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /node:sqlite|DatabaseSync|spawn\s*\(|WorkflowStore|transaction\s*\(/u);
});
