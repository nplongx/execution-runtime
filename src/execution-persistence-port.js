import {
  EXECUTION_PERSISTENCE_STORE_VERSION
} from './execution-persistence-store.js';

export const EXECUTION_PERSISTENCE_PORT_VERSION = 1;

/** Provider-ledger operations owned exclusively by ExecutionPersistenceStore. */
export const EXECUTION_PERSISTENCE_PORT_METHODS = Object.freeze([
  'ensureSchema',
  'hasProviderRunLedger',
  'hasProviderDispatchIntentLedger',
  'listProviderRunsForJob',
  'getDispatchLedgerForLease',
  'hasUnresolvedProviderDispatchForJob',
  'hasUnresolvedProviderRunForJob',
  'getProviderRun',
  'listProviderDispatchIntentsForProviderRun',
  'listProviderDispatchIntentsForDispatchKey',
  'getProviderDispatchIntent',
  'getProviderDispatchIntentForRun',
  'listProviderDispatchIntents',
  'listSiblingProviderDispatchIntents',
  'reserveProviderDispatchIntent',
  'recordProviderDispatchOutcome',
  'bindReconciledProviderRun',
  'releaseProviderDispatchSendClaim',
  'persistProviderRun',
  'bindProviderDispatchRun'
]);

function makePort(owner, { legacy = false } = {}) {
  const port = {
    kind: 'execution-persistence-port',
    version: EXECUTION_PERSISTENCE_PORT_VERSION,
    compatibilityAdapter: legacy
  };
  for (const method of EXECUTION_PERSISTENCE_PORT_METHODS) {
    const ownerMethod = legacy && method === 'ensureSchema' ? 'ensureProviderExecutionSchema' : method;
    if (typeof owner?.[ownerMethod] !== 'function') {
      throw new TypeError(`Execution persistence owner must provide ${ownerMethod}()`);
    }
    Object.defineProperty(port, method, {
      enumerable: true,
      configurable: false,
      writable: false,
      value: owner[ownerMethod].bind(owner)
    });
  }
  return Object.freeze(port);
}

/** Immutable provider-ledger API. Store keeps its database connection private. */
export function createExecutionPersistencePort(store) {
  if (!store || typeof store !== 'object' || store.version !== EXECUTION_PERSISTENCE_STORE_VERSION ||
      typeof store.assertSharedConnection !== 'function') {
    throw new TypeError('ExecutionPersistencePort v1 requires ExecutionPersistenceStore v1');
  }
  return makePort(store);
}

export function assertExecutionPersistencePort(port) {
  if (!port || typeof port !== 'object' || port.kind !== 'execution-persistence-port' ||
      port.version !== EXECUTION_PERSISTENCE_PORT_VERSION || !Object.isFrozen(port) ||
      Object.hasOwn(port, 'db') || typeof port.transaction === 'function') {
    throw new TypeError('ExecutionPersistencePort v1 must be a frozen provider-persistence contract without a database handle or transaction callback');
  }
  for (const method of EXECUTION_PERSISTENCE_PORT_METHODS) {
    if (typeof port[method] !== 'function') throw new TypeError(`ExecutionPersistencePort v1 must provide ${method}()`);
  }
  return port;
}

/**
 * Temporary adapter for existing consumers/tests that still receive the
 * aggregate WorkflowStatePort. Production host composition should inject the
 * ExecutionPersistencePort explicitly; remove this adapter after migration.
 */
export function createLegacyExecutionPersistencePort(workflowStatePort) {
  if (!workflowStatePort || typeof workflowStatePort !== 'object' || workflowStatePort.version !== 2) {
    throw new TypeError('legacy ExecutionPersistencePort adapter requires WorkflowStatePort v2');
  }
  const owner = Object.create(null);
  for (const method of EXECUTION_PERSISTENCE_PORT_METHODS) {
    const sourceMethod = method === 'ensureSchema' ? 'ensureProviderExecutionSchema' : method;
    if (typeof workflowStatePort[sourceMethod] !== 'function') {
      throw new TypeError(`legacy WorkflowStatePort v2 does not provide ${sourceMethod}()`);
    }
    owner[sourceMethod] = workflowStatePort[sourceMethod].bind(workflowStatePort);
  }
  return makePort(owner, { legacy: true });
}

export function resolveExecutionPersistencePort(explicitPort, workflowStatePort) {
  if (explicitPort) return assertExecutionPersistencePort(explicitPort);
  return workflowStatePort ? createLegacyExecutionPersistencePort(workflowStatePort) : null;
}
