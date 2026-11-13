import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  GitHubActionsProvider,
  ExecutionPersistenceStore,
  createExecutionPersistencePort
} from '../index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('GitHub Actions provider is package-owned and consumes only the explicit Workflow/Execution ports', async () => {
  const source = fs.readFileSync(path.join(root, 'src/github-actions-provider.js'), 'utf8');
  assert.doesNotMatch(source, /createWorkflowStatePort|workflow-state-port\.js/);
  assert.doesNotMatch(source, /store\s*=\s*null/);
  assert.match(source, /statePort\.version !== 2/);
  assert.match(source, /resolveExecutionPersistencePort\(executionPersistencePort, this\.state\)/);

  assert.throws(() => new GitHubActionsProvider({
    token: 'test-token', owner: 'example', repo: 'repo',
    statePort: { version: 1 }
  }), /WorkflowStatePort v2/);

  const database = new DatabaseSync(':memory:');
  try {
    const persistenceStore = new ExecutionPersistenceStore(database);
    const persistencePort = createExecutionPersistencePort(persistenceStore);
    const statePort = Object.freeze({ version: 2, isDurable: false });
    const provider = new GitHubActionsProvider({
      token: 'test-token', owner: 'example', repo: 'repo', workflow: 'p2-provider-smoke.yml', statePort,
      executionPersistencePort: persistencePort,
      fetchImpl: async () => new Response(JSON.stringify({
        id: 303, status: 'completed', conclusion: 'cancelled', run_attempt: 1
      }), { status: 200 })
    });
    assert.equal(provider.state, statePort);
    assert.equal(provider.execution, persistencePort);
    assert.equal(Object.hasOwn(provider, 'store'), false);
    assert.equal(Object.hasOwn(provider, 'db'), false);
    assert.equal(await provider.getStatus('303').then(result => result.provider_run_id), '303');
  } finally {
    database.close();
  }
});
