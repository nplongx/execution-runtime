import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  ProviderAdmissionController,
  ProviderStates,
  isProviderRateLimitError
} from '../index.js';

function fixture() {
  const db = new DatabaseSync(':memory:');
  const tasks = new Map();
  const events = [];
  const workflowStatePort = Object.freeze({
    version: 2,
    getTask: taskId => tasks.get(taskId) || null,
    getLatestChildTaskForRole: () => null,
    recordEvent: (jobId, type, payload) => {
      events.push({ jobId, type, payload });
      return `event-${events.length}`;
    }
  });
  const admission = new ProviderAdmissionController(db, {
    workflowStatePort,
    hardBlockMs: 60_000,
    leaseMs: 30_000
  });
  return { db, tasks, events, admission, close: () => db.close() };
}

test('Provider Admission owns only provider tables and rejects unversioned Workflow adapters', () => {
  const value = fixture();
  try {
    const tables = value.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
    assert.deepEqual(tables.filter(name => name.startsWith('provider_admission')).sort(),
      ['provider_admission', 'provider_admission_leases']);
    assert.equal(value.admission.workflowState.version, 2);
    assert.throws(() => new ProviderAdmissionController(value.db, {
      workflowStatePort: { getTask() {}, getLatestChildTaskForRole() {}, recordEvent() {} }
    }), /requires WorkflowStatePort v2/);
    assert.equal(isProviderRateLimitError('HTTP 429 too many requests'), true);
    assert.equal(isProviderRateLimitError('connection reset'), false);
  } finally { value.close(); }
});

test('capacity, cooldown, probe and global gates preserve durable admission events', () => {
  const value = fixture();
  try {
    const providers = ['chatgpt:account:1', 'chatgpt:account:2'];
    value.admission.syncProviders(providers);
    const first = value.admission.admit({ providerIds: providers, jobId: 'job-1', taskId: 'task-1', role: 'cto' });
    const second = value.admission.admit({ providerIds: providers, jobId: 'job-1', taskId: 'task-2', role: 'qa' });
    assert.ok(first.leaseId && second.leaseId);
    assert.throws(() => value.admission.admit({ providerIds: providers, jobId: 'job-1', role: 'writer' }),
      error => error.code === 'PROVIDER_UNAVAILABLE' && error.admissionReason === 'capacity');
    assert.equal(value.events.filter(event => event.type === 'provider.capacity_wait').length, 1);
    assert.equal(value.admission.getMetrics().capacityWaits, 1);
    value.admission.release(first.leaseId);
    value.admission.release(second.leaseId);
    assert.equal(value.admission.all().every(row => row.state === ProviderStates.READY), true);

    value.admission.markRateLimited(providers[0], 'hard-block', 60_000);
    assert.equal(value.admission.status(providers[0]).state, ProviderStates.COOLDOWN);
    const probe = value.db.prepare('UPDATE provider_admission SET cooldown_until=?,probe_after=? WHERE provider_id=?');
    const past = new Date(Date.now() - 1000).toISOString();
    probe.run(past, past, providers[0]);
    const probeLease = value.admission.admit({ providerIds: [providers[0]], jobId: 'job-1', role: 'qa' });
    assert.equal(probeLease.providerId, providers[0]);
    value.admission.release(probeLease.leaseId);

    value.admission.syncProviders(['chatgpt:global']);
    value.admission.markRateLimited('chatgpt:global', 'global-quota', 60_000);
    assert.throws(() => value.admission.admit({ providerIds: ['chatgpt:global', ...providers], jobId: 'job-1', role: 'cto' }),
      error => error.code === 'PROVIDER_UNAVAILABLE');
  } finally { value.close(); }
});

test('lease expiry repairs in-flight counts and terminal task reconciliation releases orphan leases', () => {
  const value = fixture();
  try {
    value.admission.syncProviders(['provider:expiry', 'provider:terminal']);
    const expired = value.admission.admit({ providerIds: ['provider:expiry'], jobId: 'job-1', taskId: 'task-expired', role: 'qa' });
    value.db.prepare("UPDATE provider_admission_leases SET expires_at=? WHERE lease_id=?")
      .run(new Date(Date.now() - 1000).toISOString(), expired.leaseId);
    assert.equal(value.admission.expireLeases(), 1);
    assert.equal(value.admission.status('provider:expiry').in_flight, 0);

    value.tasks.set('task-terminal', { task_id: 'task-terminal', status: 'completed' });
    const terminal = value.admission.admit({ providerIds: ['provider:terminal'], jobId: 'job-1', taskId: 'task-terminal', role: 'qa' });
    assert.equal(value.admission.reconcileOrphanLeases(), 1);
    assert.equal(value.admission.findActiveLease({ jobId: 'job-1', taskId: 'task-terminal', role: 'qa' }), null);
    assert.equal(value.admission.status('provider:terminal').in_flight, 0);
    assert.ok(terminal.leaseId);
  } finally { value.close(); }
});
