import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';

/**
 * Parses the exact exit marker written by the local execution supervisor.
 * Missing/empty markers are pending observations, not successful exits.
 */
export function parseCanonicalExecutionExitMarker(marker, label = 'execution exit marker') {
  if (typeof marker !== 'string' || marker.length === 0) return null;
  if (!/^(?:0|-[1-9]\d*|[1-9]\d*)$/.test(marker)) {
    throw new Error(label + ' is malformed; preserve the open attempt for reconciliation');
  }
  const code = Number(marker);
  if (!Number.isSafeInteger(code) || Object.is(code, -0)) {
    throw new Error(label + ' is not a canonical safe integer; preserve the open attempt for reconciliation');
  }
  return code;
}

/**
 * Reads a supervisor-written exit marker without following symlinks or
 * accepting files whose identity/metadata changes during the bounded read.
 */
export async function readCanonicalExecutionExitMarkerFile(exitPath, label = 'execution exit marker') {
  let handle;
  try {
    handle = await fs.open(exitPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > 64n) {
      throw new Error(label + ' is not a bounded regular file; preserve the open attempt for reconciliation');
    }
    if (before.size === 0n) return null;
    const buffer = Buffer.alloc(65);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const after = await handle.stat({ bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs ||
        bytesRead !== Number(after.size) || bytesRead > 64) {
      throw new Error(label + ' changed during bounded read; preserve the open attempt for reconciliation');
    }
    return parseCanonicalExecutionExitMarker(buffer.subarray(0, bytesRead).toString('utf8'), label);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

/**
 * Verifies successful execution-batch evidence: one creation, contiguous
 * retries, exactly one terminal outcome per aggregate attempt and a final
 * all-success item set. Pure verifier; callers own event reads and transactions.
 */
export function assertExecutionBatchRetryLineage({
  batchId, creationEvents, retryEvents, terminalEvents, finalAttempt, items
}) {
  if (typeof batchId !== 'string' || !batchId || !Array.isArray(creationEvents) || creationEvents.length !== 1 ||
      !Array.isArray(retryEvents) || !Array.isArray(terminalEvents) || !Array.isArray(items) || items.length < 1 ||
      !Number.isSafeInteger(finalAttempt) || finalAttempt < 1) {
    throw new Error('durable batch retry lineage input is incomplete or malformed');
  }
  const payloadOf = (event, type) => {
    const payload = event && event.payload;
    if (!event || event.type !== type || !payload || typeof payload !== 'object' ||
        Array.isArray(payload) || payload.batchId !== batchId) {
      throw new Error('durable batch retry lineage contains a mismatched event: ' + type);
    }
    return payload;
  };
  const created = payloadOf(creationEvents[0], 'execution.batch.created');
  if (!Number.isSafeInteger(created.attempt) || created.attempt < 1 || created.attempt > finalAttempt ||
      !Array.isArray(created.taskIds) || created.taskIds.some(id => typeof id !== 'string' || !id) ||
      new Set(created.taskIds).size !== created.taskIds.length) {
    throw new Error('durable batch creation event has an invalid task set or initial attempt');
  }
  const actualTaskIds = items.map(item => item && item.task_id);
  if (actualTaskIds.some(id => typeof id !== 'string' || !id) || new Set(actualTaskIds).size !== actualTaskIds.length ||
      actualTaskIds.length !== created.taskIds.length ||
      JSON.stringify([...actualTaskIds].sort()) !== JSON.stringify([...created.taskIds].sort())) {
    throw new Error('durable batch creation task set does not match the durable item rows');
  }
  const retryAttempts = retryEvents.map(event =>
    payloadOf(event, 'execution.batch.retry_started').attempt);
  const expectedRetries = Array.from({ length: finalAttempt - created.attempt },
    (_, index) => created.attempt + index + 1);
  if (retryAttempts.some(attempt => !Number.isSafeInteger(attempt)) ||
      JSON.stringify(retryAttempts) !== JSON.stringify(expectedRetries)) {
    throw new Error('durable batch retry history is missing, duplicated, or non-contiguous');
  }
  if (terminalEvents.length !== finalAttempt - created.attempt + 1) {
    throw new Error('durable batch terminal event history does not cover each aggregate attempt exactly once');
  }
  const terminalsByAttempt = new Map();
  for (const event of terminalEvents) {
    if (!event || !['execution.batch.completed', 'execution.batch.failed'].includes(event.type)) {
      throw new Error('durable batch terminal history contains an unsupported event type');
    }
    const payload = payloadOf(event, event.type);
    if (!Number.isSafeInteger(payload.attempt) || payload.attempt < created.attempt || payload.attempt > finalAttempt ||
        terminalsByAttempt.has(payload.attempt) || payload.itemCount !== items.length ||
        !Number.isSafeInteger(payload.failedCount) || payload.failedCount < 0 || payload.failedCount > items.length) {
      throw new Error('durable batch terminal history has a duplicate attempt or inconsistent item counts');
    }
    terminalsByAttempt.set(payload.attempt, { type: event.type, payload });
  }
  for (let attempt = created.attempt; attempt <= finalAttempt; attempt++) {
    const terminal = terminalsByAttempt.get(attempt);
    const final = attempt === finalAttempt;
    if (!terminal || (final
      ? terminal.type !== 'execution.batch.completed' || terminal.payload.status !== 'COMPLETED' || terminal.payload.failedCount !== 0
      : terminal.type !== 'execution.batch.failed' || terminal.payload.status !== 'FAILED' || terminal.payload.failedCount < 1)) {
      throw new Error('durable batch terminal event does not match the expected attempt outcome: ' + attempt);
    }
  }
  if (items.some(item => item.status !== 'COMPLETED' || item.exit_code !== 0)) {
    throw new Error('final successful batch terminal event conflicts with durable item statuses');
  }
  return { initialAttempt: created.attempt, finalAttempt, retryCount: retryAttempts.length, itemCount: items.length };
}
