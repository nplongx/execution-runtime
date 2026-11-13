import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  DeterministicRunnerProvider,
  ExecutionPersistenceStore,
  createExecutionPersistencePort,
  createExecutionRequest
} from '../index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('DeterministicRunnerProvider is package-owned and has no Workflow/database dependency', async () => {
  const source = fs.readFileSync(path.join(root, 'src/deterministic-runner-provider.js'), 'utf8');
  assert.doesNotMatch(source, /workflow-state-port|createWorkflowStatePort|WorkflowStore|statePort|this\.store/u);
  assert.match(source, /assertExecutionPersistencePort/u);
  assert.match(source, /this\.execution\?\.persistProviderRun/u);

  const database = new DatabaseSync(':memory:');
  try {
    const owner = new ExecutionPersistenceStore(database);
    const port = createExecutionPersistencePort(owner);
    const provider = new DeterministicRunnerProvider({ runnerId: 'test-deterministic-runner', executionPersistencePort: port });
    const request = createExecutionRequest({
      job_id: 'job_deterministic', task_id: 'task_deterministic', lease_id: 'lease_deterministic',
      attempt: 1, owner_epoch: 1, role: 'engineer', input_commit: 'a'.repeat(40),
      task_payload_ref: '.worker/tasks/task_deterministic.json', workspace: 'ephemeral',
      required_evidence: ['task-payload.json', 'execution.json', 'stdout.txt', 'stderr.txt', 'git-status.txt']
    });
    const dispatch = await provider.dispatch(request);
    const persisted = port.getProviderRun(dispatch.provider_run_id);
    assert.equal(persisted.provider, 'test-deterministic-runner');
    assert.equal(persisted.workflow, 'test-deterministic-runner');
    assert.equal(persisted.state, 'COMPLETED');
    assert.equal(persisted.conclusion, 'success');
    assert.equal(provider.state, undefined);
    assert.equal(provider.store, undefined);
    assert.equal(provider.db, undefined);
    assert.equal((await provider.getStatus(dispatch.provider_run_id)).state, 'COMPLETED');
    assert.equal((await provider.collectResult(dispatch.provider_run_id)).status, 'SUCCEEDED');
    await assert.rejects(() => provider.getStatus('missing-run'), /run not found/u);
  } finally {
    database.close();
  }
});

test('DeterministicRunnerProvider can run as an in-memory fixture without a persistence port', async () => {
  const provider = new DeterministicRunnerProvider();
  const request = createExecutionRequest({
    job_id: 'job_ephemeral', task_id: 'task_ephemeral', lease_id: 'lease_ephemeral',
    attempt: 1, owner_epoch: 1, role: 'researcher', input_commit: 'b'.repeat(40),
    task_payload_ref: '.worker/tasks/task_ephemeral.json', workspace: 'ephemeral',
    required_evidence: ['task-payload.json', 'execution.json', 'stdout.txt', 'stderr.txt', 'git-status.txt']
  });
  const dispatch = await provider.dispatch(request);
  assert.equal((await provider.collectResult(dispatch.provider_run_id)).status, 'SUCCEEDED');
  assert.equal(provider.execution, null);
});
