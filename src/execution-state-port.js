import {
  ExecutionStateStore,
  EXECUTION_STATE_STORE_VERSION,
  EXECUTION_STATE_READ_METHODS
} from './execution-state-store.js';

export const EXECUTION_STATE_PORT_VERSION = 1;

/** Immutable, read-only API for Execution-owned attempt/result/batch state. */
export function createExecutionStatePort(store) {
  if (!store || typeof store !== 'object' || store.version !== EXECUTION_STATE_STORE_VERSION ||
      typeof store.assertSharedConnection !== 'function') {
    throw new TypeError('ExecutionStatePort v1 requires ExecutionStateStore v1');
  }
  const port = { kind: 'execution-state-port', version: EXECUTION_STATE_PORT_VERSION };
  for (const method of EXECUTION_STATE_READ_METHODS) {
    if (typeof store[method] !== 'function') throw new TypeError(`ExecutionStateStore must provide ${method}()`);
    Object.defineProperty(port, method, {
      enumerable: true,
      configurable: false,
      writable: false,
      value: store[method].bind(store)
    });
  }
  return Object.freeze(port);
}

/** Temporary facade for older WorkflowStore-shaped consumers and test doubles. */
export function createLegacyExecutionStatePort(workflowStore) {
  if (!workflowStore || typeof workflowStore !== 'object' || !workflowStore.db ||
      typeof workflowStore.db.prepare !== 'function') {
    throw new TypeError('legacy ExecutionStatePort adapter requires a WorkflowStore with a query-capable database');
  }
  const executionStore = new ExecutionStateStore(workflowStore.db);
  const port = { kind: 'execution-state-port', version: EXECUTION_STATE_PORT_VERSION, compatibilityAdapter: true };
  for (const method of EXECUTION_STATE_READ_METHODS) {
    const owner = typeof workflowStore[method] === 'function' ? workflowStore : executionStore;
    if (typeof owner[method] !== 'function') throw new TypeError(`legacy ExecutionStatePort adapter cannot provide ${method}()`);
    Object.defineProperty(port, method, {
      enumerable: true,
      configurable: false,
      writable: false,
      value: owner[method].bind(owner)
    });
  }
  return Object.freeze(port);
}

export function assertExecutionStatePort(port) {
  if (!port || typeof port !== 'object' || port.kind !== 'execution-state-port' ||
      port.version !== EXECUTION_STATE_PORT_VERSION || !Object.isFrozen(port) ||
      Object.hasOwn(port, 'db') || Object.hasOwn(port, 'transaction')) {
    throw new TypeError('ExecutionStatePort v1 must be a frozen read-only contract without a database handle');
  }
  for (const method of EXECUTION_STATE_READ_METHODS) {
    if (typeof port[method] !== 'function') throw new TypeError(`ExecutionStatePort v1 must provide ${method}()`);
  }
  return port;
}
