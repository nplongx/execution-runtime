#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'execution-runtime-packed-consumer-'));
const consumerRoot = path.join(temporaryRoot, 'consumer');
const env = { ...process.env, npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false' };

function run(command, args, cwd, label) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${label} failed: ${result.stdout || ''}\n${result.stderr || ''}\n${result.error?.message || ''}`);
  return result.stdout.trim();
}

try {
  fs.mkdirSync(consumerRoot, { mode: 0o700 });
  const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', temporaryRoot], root, 'npm pack'));
  assert.equal(packed.length, 1);
  assert.equal(packed[0].name, '@runalith/execution-runtime');
  assert.equal(packed[0].version, '0.1.8');
  const tarball = path.join(temporaryRoot, packed[0].filename);
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', consumerRoot, tarball], root,
    'install packed Execution Runtime into clean consumer');
  const smoke = `
    import assert from 'node:assert/strict';
    const api = await import('@runalith/execution-runtime');
    for (const key of ['ExecutionStateStore','createExecutionStatePort','createExecutionStateParticipant',
      'ExecutionPersistenceStore','createExecutionPersistencePort','resolveExecutionPersistencePort','createExecutionPersistenceParticipant',
      'createExecutionRequest','createExecutionResult','providerDispatchKey','ProviderAdmissionController',
      'isProviderRateLimitError','GitHubOidcVerifier','RunnerAdmissionBroker','createRunnerAdmissionBroker',
      'GitHubActionsProvider','DeterministicRunnerProvider','GatewaySpecialistAdapter','ProviderDispatchScheduler',
      'parseCanonicalExecutionExitMarker','readCanonicalExecutionExitMarkerFile','assertExecutionBatchRetryLineage']) {
      assert.equal(typeof api[key], 'function', key + ' must be exported by packed artifact');
    }
    console.log('packed Execution Runtime public API PASS');
    const runner = await import('@runalith/execution-runtime/runner-admission');
    assert.equal(runner.RunnerAdmissionBroker, api.RunnerAdmissionBroker);
    assert.equal(runner.GitHubOidcVerifier, api.GitHubOidcVerifier);
    console.log('packed Runner Admission subpath PASS');
    const githubProvider = await import('@runalith/execution-runtime/github-actions-provider');
    assert.equal(githubProvider.GitHubActionsProvider, api.GitHubActionsProvider);
    console.log('packed GitHub Actions Provider subpath PASS');
    const deterministicRunner = await import('@runalith/execution-runtime/deterministic-runner-provider');
    assert.equal(deterministicRunner.DeterministicRunnerProvider, api.DeterministicRunnerProvider);
    console.log('packed Deterministic Runner Provider subpath PASS');
    const gatewaySpecialist = await import('@runalith/execution-runtime/gateway-specialist-adapter');
    assert.equal(gatewaySpecialist.GatewaySpecialistAdapter, api.GatewaySpecialistAdapter);
    assert.ok(gatewaySpecialist.TERMINAL_SPECIALIST_STATES instanceof Set);
    console.log('packed Gateway Specialist Adapter subpath PASS');
    const scheduler = await import('@runalith/execution-runtime/provider-dispatch-scheduler');
    assert.equal(scheduler.ProviderDispatchScheduler, api.ProviderDispatchScheduler);
    console.log('packed Provider Dispatch Scheduler subpath PASS');
    const observations = await import('@runalith/execution-runtime/execution-observation');
    assert.equal(observations.parseCanonicalExecutionExitMarker, api.parseCanonicalExecutionExitMarker);
    assert.equal(observations.readCanonicalExecutionExitMarkerFile, api.readCanonicalExecutionExitMarkerFile);
    assert.equal(observations.assertExecutionBatchRetryLineage, api.assertExecutionBatchRetryLineage);
    console.log('packed Execution Observation subpath PASS');
  `;
  run(process.execPath, ['--input-type=module', '-e', smoke], consumerRoot, 'packed consumer API smoke');
  console.log(`Execution Runtime packed consumer PASS: ${packed[0].filename} (${packed[0].entryCount} files)`);
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
