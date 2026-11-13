import crypto from 'node:crypto';
import { createExecutionResult, validateExecutionRequest } from '@runalith/execution-evidence';
import { assertExecutionPersistencePort } from './execution-persistence-port.js';

const ROLE_OUTPUTS = Object.freeze({
  'product-owner': {
    scope: 'deterministic runner-owned product scope',
    acceptance_criteria: ['provider dispatch is recorded', 'no local specialist session is created'],
    non_goals: ['local child-process spawning']
  },
  researcher: {
    findings: ['workflow task is executed by the deterministic provider'],
    sources: ['durable workflow plan'],
    limitations: ['deterministic fixture provider; not a remote execution claim']
  },
  architect: {
    components: ['workflow coordinator', 'deterministic runner'],
    interfaces: ['durable execution request'],
    failure_modes: ['provider failure'],
    implementation_boundary: 'provider execution is simulated; workflow orchestration remains host-owned'
  },
  engineer: {
    summary: 'Deterministic runner execution completed.',
    files_changed: [],
    verification: ['runner contract verified'],
    execution: { session_id: 'runner-session', exit_code: 0, command: 'deterministic-runner', verified_at: null }
  },
  security: { threats: [], findings: [], decision: 'accept' },
  qa: { checks: ['provider dispatch'], results: ['passed'], decision: 'accept' },
  platform: { runtime: { status: 'reviewed' }, deployment: { status: 'reviewed' }, recovery: { status: 'reviewed' } },
  writer: { summary: 'Runner-owned workflow documentation is complete.', user_facing_changes: [], verification: ['runner contract verified'] },
  reviewer: {
    review: {
      requirementsSatisfied: true, architectureConformant: true, securityAccepted: true,
      qaAccepted: true, platformAccepted: true, documentationAccepted: true,
      implementationIssues: [], evidenceIssues: [], securityIssues: [], blockingIssues: [], decision: 'accept'
    }
  },
  cto: {
    decision: 'approve', summary: 'Deterministic runner execution accepted.',
    accepted_requirements: ['runner owns the simulated execution result'],
    unresolved_risks: [], follow_up_actions: [], evidence_refs: []
  }
});

/** Deterministic in-memory runner fixture. Not a process supervisor or remote runner. */
export class DeterministicRunnerProvider {
  constructor({ now = () => Date.now(), runnerId = 'deterministic-runner', executionPersistencePort = null } = {}) {
    if (typeof now !== 'function') throw new TypeError('DeterministicRunnerProvider now must be a function');
    if (typeof runnerId !== 'string' || !runnerId.trim()) throw new TypeError('DeterministicRunnerProvider runnerId must be a non-empty string');
    this.now = now;
    this.runnerId = runnerId;
    this.runs = new Map();
    this.execution = executionPersistencePort ? assertExecutionPersistencePort(executionPersistencePort) : null;
    this.execution?.ensureSchema();
  }

  async dispatch(request) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new TypeError('DeterministicRunnerProvider request must be an object');
    }
    const { dispatch_key: _dispatchKey, ...executionRequest } = request;
    validateExecutionRequest(executionRequest);
    const providerRunId = `runner-${crypto.randomUUID()}`;
    const output = { ...(ROLE_OUTPUTS[request.role] || { summary: `Deterministic provider completed role ${request.role}` }) };
    const started = new Date(this.now()).toISOString();
    const finished = new Date(this.now() + 1).toISOString();
    if (request.role === 'engineer') output.execution = { ...output.execution, verified_at: finished };
    const result = createExecutionResult({
      job_id: executionRequest.job_id,
      task_id: executionRequest.task_id,
      lease_id: executionRequest.lease_id,
      attempt: executionRequest.attempt,
      status: 'SUCCEEDED',
      input_commit: executionRequest.input_commit,
      output_commit: request.input_commit,
      exit_code: 0,
      provider_run_id: providerRunId,
      evidence_artifact: `runner-${providerRunId}`,
      evidence_refs: ['runner-output.json'],
      started_at: started,
      finished_at: finished,
      error: null,
      agent_output: JSON.stringify(output),
      runner_id: this.runnerId
    });
    this.runs.set(providerRunId, { request, result, state: 'COMPLETED' });
    this.execution?.persistProviderRun({
      provider_run_id: providerRunId,
      job_id: executionRequest.job_id,
      task_id: executionRequest.task_id,
      lease_id: executionRequest.lease_id,
      attempt: executionRequest.attempt,
      owner_epoch: null,
      input_commit: executionRequest.input_commit,
      workflow: this.runnerId,
      ref: 'local',
      state: 'COMPLETED',
      conclusion: 'success',
      html_url: null,
      artifact_id: result.evidence_artifact,
      output_commit: request.input_commit,
      run_attempt: null,
      created_at: started
    }, { provider: this.runnerId, updatedAt: finished });
    return {
      provider_run_id: providerRunId,
      job_id: request.job_id,
      task_id: request.task_id,
      lease_id: request.lease_id,
      attempt: request.attempt,
      input_commit: request.input_commit,
      workflow: this.runnerId,
      ref: 'local',
      state: 'COMPLETED',
      conclusion: 'success',
      created_at: started
    };
  }

  async getStatus(providerRunId) {
    const run = this.runs.get(String(providerRunId));
    if (!run) throw new Error(`Deterministic runner run not found: ${providerRunId}`);
    return {
      provider_run_id: String(providerRunId),
      state: 'COMPLETED',
      status: 'COMPLETED',
      conclusion: 'success',
      created_at: run.result.started_at,
      updated_at: run.result.finished_at
    };
  }

  async collectResult(providerRunId) {
    const run = this.runs.get(String(providerRunId));
    if (!run) throw new Error(`Deterministic runner run not found: ${providerRunId}`);
    return run.result;
  }

  async reconcileDispatchIntent() { return null; }
}
