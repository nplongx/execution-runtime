import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  ExecutionStateStore,
  EXECUTION_STATE_TABLES,
  createExecutionStatePort,
  assertExecutionStatePort,
  createExecutionStateParticipant,
  assertExecutionStateParticipant,
  ExecutionPersistenceStore,
  createExecutionPersistencePort,
  assertExecutionPersistencePort,
  createExecutionPersistenceParticipant,
  createExecutionRequest,
  createExecutionResult,
  providerDispatchConfig,
  providerDispatchRequestSha256,
} from '../index.js';

function createWorkflowTables(db) {
  db.exec(`
    CREATE TABLE jobs (job_id TEXT PRIMARY KEY);
    CREATE TABLE tasks (task_id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(job_id));
  `);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec("INSERT INTO jobs(job_id) VALUES('job-1')");
  db.exec("INSERT INTO tasks(task_id,job_id) VALUES('task-1','job-1')");
}

test('Execution state store owns bounded tables, queries and writes on the injected connection', () => {
  const db = new DatabaseSync(':memory:');
  try {
    createWorkflowTables(db);
    const store = new ExecutionStateStore(db);
    assert.deepEqual(EXECUTION_STATE_TABLES, [
      'attempts', 'results', 'execution_batches', 'execution_batch_items', 'task_checkpoints'
    ]);
    assert.equal(store.assertSharedConnection(db), true);
    assert.equal(Object.hasOwn(store, 'db'), false);
    const names = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x => x.name));
    for (const table of EXECUTION_STATE_TABLES) assert.ok(names.has(table), `missing ${table}`);

    const startedAt = '2026-11-13T00:00:00.000Z';
    store.insertAttempt({ attemptId: 'attempt-1', taskId: 'task-1', status: 'started', startedAt });
    assert.equal(store.getAttempt('attempt-1').status, 'started');
    const finishedAt = '2026-11-13T00:00:01.000Z';
    assert.equal(store.updateAttemptStatusByIdentity({ attemptId: 'attempt-1', taskId: 'task-1',
      expectedStatus: 'started', status: 'completed', finishedAt }).changes, 1);
    assert.equal(store.getAttempt('attempt-1').status, 'completed');

    const reads = assertExecutionStatePort(createExecutionStatePort(store));
    const writes = assertExecutionStateParticipant(createExecutionStateParticipant(store));
    assert.equal(assertExecutionStatePort(reads), reads);
    assert.equal(assertExecutionStateParticipant(writes), writes);
    assert.equal(Object.isFrozen(reads), true);
    assert.equal(Object.isFrozen(writes), true);
    assert.equal(Object.hasOwn(reads, 'db'), false);
    assert.equal(Object.hasOwn(writes, 'db'), false);
    assert.equal(typeof reads.transaction, 'undefined');
    assert.equal(typeof writes.transaction, 'undefined');
    assert.equal(reads.getAttempt('attempt-1').status, 'completed');
    assert.throws(() => store.assertSharedConnection(new DatabaseSync(':memory:')), /SQLite connection/);
  } finally { db.close(); }
});

test('Execution provider ledger owns provider tables and bounded provider methods', () => {
  const db = new DatabaseSync(':memory:');
  try {
    createWorkflowTables(db);
    const store = new ExecutionPersistenceStore(db);
    assert.equal(store.assertSharedConnection(db), true);
    assert.equal(store.hasProviderRunLedger(), true);
    assert.equal(store.hasProviderDispatchIntentLedger(), true);
    const names = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x => x.name));
    assert.ok(names.has('provider_runs'));
    assert.ok(names.has('provider_dispatch_intents'));
    const port = assertExecutionPersistencePort(createExecutionPersistencePort(store));
    assert.equal(Object.isFrozen(port), true);
    assert.equal(Object.hasOwn(port, 'db'), false);
    assert.equal(typeof port.transaction, 'undefined');
    const participant = createExecutionPersistenceParticipant(store, db);
    assert.equal(Object.isFrozen(participant), true);
    assert.equal(Object.hasOwn(participant, 'db'), false);
    assert.equal(participant.hasProviderRunLedger(), true);
    assert.deepEqual(participant.listProviderRunsForJob('job-1'), []);
    assert.throws(() => createExecutionPersistenceParticipant(store, new DatabaseSync(':memory:')), /SQLite connection/);
  } finally { db.close(); }
});

test('Execution request/result contracts and provider identity helpers are exported', () => {
  const request = createExecutionRequest({
    job_id: 'job-1', task_id: 'task-1', lease_id: 'lease-1', attempt: 1,
    role: 'qa', input_commit: 'a'.repeat(40), task_payload_ref: 'artifact://task-input',
    workspace: '/tmp/workspace', required_evidence: ['qa-report']
  });
  assert.equal(request.schema_version, 1);
  assert.equal(Object.isFrozen(request), true);
  const result = createExecutionResult({
    job_id: 'job-1', task_id: 'task-1', lease_id: 'lease-1', attempt: 1,
    status: 'FAILED', input_commit: 'a'.repeat(40), provider_run_id: 'run-1',
    evidence_refs: [], started_at: '2026-11-13T00:00:00.000Z',
    finished_at: '2026-11-13T00:00:01.000Z', error: 'test failure'
  });
  assert.equal(result.schema_version, 1);
  const config = providerDispatchConfig({ owner: 'nplongx', repo: 'execution-runtime', ref: 'main' });
  assert.equal(config.repository, 'nplongx/execution-runtime');
  assert.match(providerDispatchRequestSha256(request), /^[a-f0-9]{64}$/);
});
