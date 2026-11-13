import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  ExecutionPersistenceStore,
  ProviderDispatchScheduler,
  createExecutionPersistencePort
} from '../index.js';

function workflowPort(overrides = {}) {
  const events = [];
  const task = {
    task_id: 'task-scheduler', job_id: 'job-scheduler', role: 'engineer',
    payload_ref: '.worker/tasks/task-scheduler.json', metadata_json: '{}'
  };
  return {
    events,
    task,
    port: Object.freeze({
      version: 2,
      isDurable: false,
      countActiveTaskLeases: () => 0,
      getActiveTaskLease: () => null,
      acquireTaskLease: (taskId, options) => ({
        lease_id: options.leaseId, task_id: taskId, job_id: task.job_id,
        attempt: 1, owner_epoch: 4, state: 'ACTIVE'
      }),
      listRunnableTasks: () => [task],
      getTaskLease: () => null,
      getJob: () => ({ job_id: task.job_id, status: 'active', state: 'RUNNING' }),
      getTask: () => ({ ...task, status: 'running' }),
      expireTaskLease: () => ({ state: 'EXPIRED' }),
      clearTaskLeaseError: () => ({ changes: 1 }),
      recordEvent: (...args) => events.push(args),
      clockNow: () => Date.now(),
      ...overrides
    })
  };
}

test('ProviderDispatchScheduler is package-owned and requires both versioned state ports', async () => {
  const database = new DatabaseSync(':memory:');
  try {
    const ledger = new ExecutionPersistenceStore(database);
    const executionPort = createExecutionPersistencePort(ledger);
    const state = workflowPort();
    const dispatched = [];
    const provider = {
      owner: 'example', repo: 'repo', workflow: 'p3-worker.yml', ref: 'main',
      dispatch: async request => { dispatched.push(request); return { provider_run_id: '12345' }; }
    };
    const scheduler = new ProviderDispatchScheduler({
      statePort: state.port,
      executionPersistencePort: executionPort,
      provider,
      maxParallel: 2
    });
    assert.equal(scheduler.state, state.port);
    assert.equal(scheduler.execution, executionPort);
    assert.equal(Object.hasOwn(scheduler, 'store'), false);
    assert.equal(Object.hasOwn(scheduler, 'db'), false);

    const result = await scheduler.dispatchTask(state.task, { inputCommit: 'a'.repeat(40) });
    assert.equal(result.run.provider_run_id, '12345');
    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].job_id, 'job-scheduler');
    assert.equal(dispatched[0].task_id, 'task-scheduler');
    assert.equal(dispatched[0].lease_id, result.lease.lease_id);
    assert.equal(state.events.length, 1);
    assert.equal(state.events[0][1], 'task.provider.dispatched');

    assert.throws(() => new ProviderDispatchScheduler({
      statePort: { version: 1 }, executionPersistencePort: executionPort, provider
    }), /WorkflowStatePort v2/u);
    assert.throws(() => new ProviderDispatchScheduler({
      statePort: state.port, provider
    }), /explicit ExecutionPersistencePort v1/u);
  } finally {
    database.close();
  }
});

test('ProviderDispatchScheduler supports reconciliation-only providers without exposing a store adapter', async () => {
  const database = new DatabaseSync(':memory:');
  try {
    const executionPort = createExecutionPersistencePort(new ExecutionPersistenceStore(database));
    const state = workflowPort();
    const provider = { reconcileDispatchIntent: async () => null };
    const scheduler = new ProviderDispatchScheduler({ statePort: state.port, executionPersistencePort: executionPort, provider });
    await assert.rejects(() => scheduler.dispatchTask(state.task, { inputCommit: 'b'.repeat(40) }),
      /does not support new dispatch/u);
    assert.equal(state.events.length, 0);
  } finally {
    database.close();
  }
});
