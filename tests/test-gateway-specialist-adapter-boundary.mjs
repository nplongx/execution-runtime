import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { GatewaySpecialistAdapter, TERMINAL_SPECIALIST_STATES } from '../index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'ensureM12NativeSpecialistStartIntentSchema',
  'getTask',
  'getJob',
  'getTaskLease',
  'listM12NativeSpecialistRuntimesForLease',
  'getM12NativeSpecialistRuntime',
  'reserveM12NativeSpecialistStart',
  'claimM12NativeSpecialistStartForSend',
  'attachM12NativeSpecialistRuntime',
  'reconcileM12NativeSpecialistResult'
];

test('Gateway Specialist Adapter consumes injected WorkflowStatePort v2 and a node-role Gateway client', () => {
  const source = fs.readFileSync(path.join(root, 'src/gateway-specialist-adapter.js'), 'utf8');
  assert.doesNotMatch(source, /createWorkflowStatePort|WorkflowStore|this\.store|node:sqlite|DatabaseSync/u);
  assert.match(source, /statePort\.version !== 2/u);
  assert.match(source, /claimM12NativeSpecialistStartForSend/u);
  assert.match(source, /RPC outcome becomes unknown/u);

  let schemaChecks = 0;
  const statePort = { version: 2 };
  for (const method of required) statePort[method] = () => { if (method === 'ensureM12NativeSpecialistStartIntentSchema') schemaChecks++; };
  const gateway = { role: 'node', scopes: [], async request() { throw new Error('not invoked by constructor test'); } };
  const adapter = new GatewaySpecialistAdapter({ statePort, gateway });
  assert.equal(adapter.state, statePort);
  assert.equal(adapter.store, undefined);
  assert.equal(adapter.db, undefined);
  assert.equal(schemaChecks, 1);
  assert.ok(TERMINAL_SPECIALIST_STATES.has('SUCCEEDED'));
  assert.ok(TERMINAL_SPECIALIST_STATES.has('TIMED_OUT'));
});

test('Gateway Specialist Adapter rejects unversioned Workflow access and operator Gateway credentials', () => {
  const gateway = { role: 'node', scopes: [], request: async () => ({}) };
  assert.throws(() => new GatewaySpecialistAdapter({ store: {}, gateway }), /WorkflowStatePort v2/u);
  assert.throws(() => new GatewaySpecialistAdapter({ statePort: { version: 1 }, gateway }), /WorkflowStatePort v2/u);
  const missingMethod = { version: 2 };
  for (const method of required.slice(1)) missingMethod[method] = () => {};
  assert.throws(() => new GatewaySpecialistAdapter({ statePort: missingMethod, gateway }),
    /must provide ensureM12NativeSpecialistStartIntentSchema/u);
  const statePort = { version: 2 };
  for (const method of required) statePort[method] = () => {};
  assert.throws(() => new GatewaySpecialistAdapter({
    statePort, gateway: { role: 'operator', scopes: ['operator.admin'], request: async () => ({}) }
  }), /node-role Gateway client/u);
});
