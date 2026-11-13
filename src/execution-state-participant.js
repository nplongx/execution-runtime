import {
  EXECUTION_STATE_STORE_VERSION,
  EXECUTION_STATE_WRITE_METHODS
} from './execution-state-store.js';

export const EXECUTION_STATE_PARTICIPANT_VERSION = 1;

/** Internal write participant. Caller owns the surrounding Workflow transaction. */
export function createExecutionStateParticipant(store) {
  if (!store || typeof store !== 'object' || store.version !== EXECUTION_STATE_STORE_VERSION ||
      typeof store.assertSharedConnection !== 'function') {
    throw new TypeError('ExecutionStateParticipant v1 requires ExecutionStateStore v1');
  }
  const participant = {
    kind: 'execution-state-participant',
    version: EXECUTION_STATE_PARTICIPANT_VERSION
  };
  for (const method of EXECUTION_STATE_WRITE_METHODS) {
    if (typeof store[method] !== 'function') throw new TypeError(`ExecutionStateStore must provide ${method}()`);
    Object.defineProperty(participant, method, {
      enumerable: true,
      configurable: false,
      writable: false,
      value: store[method].bind(store)
    });
  }
  return Object.freeze(participant);
}

export function assertExecutionStateParticipant(participant) {
  if (!participant || typeof participant !== 'object' ||
      participant.kind !== 'execution-state-participant' ||
      participant.version !== EXECUTION_STATE_PARTICIPANT_VERSION ||
      !Object.isFrozen(participant) || Object.hasOwn(participant, 'db') ||
      typeof participant.transaction === 'function' || typeof participant.exec === 'function' ||
      typeof participant.prepare === 'function') {
    throw new TypeError('ExecutionStateParticipant v1 must be a frozen typed-write contract without database or transaction controls');
  }
  for (const method of EXECUTION_STATE_WRITE_METHODS) {
    if (typeof participant[method] !== 'function') throw new TypeError(`ExecutionStateParticipant v1 must provide ${method}()`);
  }
  return participant;
}
