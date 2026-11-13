# Execution Runtime

[![CI](https://github.com/nplongx/execution-runtime/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/nplongx/execution-runtime/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**@runalith/execution-runtime** owns local Execution persistence primitives and bounded state APIs: attempts, results, checkpoints, execution batches/items, provider runs and provider dispatch intents. It also exports versioned read-only ports, typed write/read participants and COS-AP execution request/result contracts.

This package is an in-process source/runtime boundary, not a separate service or database. It accepts a caller-owned `node:sqlite` connection. In the current integration, Workflow owns the `jobs`, `tasks`, event journal and surrounding cross-domain transactions; Execution owns its tables and bounded SQL methods. Foreign keys to Workflow-owned rows intentionally remain. A package split does not imply a process split or remove same-connection atomicity requirements.

## Install

~~~sh
npm install github:nplongx/execution-runtime
~~~

Requirements: Node.js >=22.13.0 and built-in `node:sqlite`. Runtime dependencies are pinned GitHub source packages: COS-AP v1 and Workflow Contracts.

## Composition

~~~js
import { DatabaseSync } from 'node:sqlite';
import {
  ExecutionStateStore,
  createExecutionStatePort,
  createExecutionStateParticipant,
  ExecutionPersistenceStore,
  createExecutionPersistencePort,
  resolveExecutionPersistencePort,
  createExecutionPersistenceParticipant,
} from '@runalith/execution-runtime';

const db = new DatabaseSync('workflow.db'); // Workflow creates jobs/tasks first.
const executionState = new ExecutionStateStore(db);
const executionStateReads = createExecutionStatePort(executionState);
const executionStateWrites = createExecutionStateParticipant(executionState);
const providerLedger = new ExecutionPersistenceStore(db);
const providerReadsAndWrites = createExecutionPersistencePort(providerLedger);
const providerReadParticipant = createExecutionPersistenceParticipant(providerLedger, db);
~~~

Provider admission can be composed on the same caller-owned SQLite connection while using a narrow WorkflowStatePort v2 only for task/event operations:

~~~js
import { ProviderAdmissionController } from '@runalith/execution-runtime';

const admission = new ProviderAdmissionController(db, {
  workflowStatePort,
  hardBlockMs: 20 * 60_000,
  leaseMs: 10 * 60_000,
});
~~~

The controller owns only `provider_admission` and `provider_admission_leases`. It does not read or write Workflow tables. Admission/cooldown state and lease transitions are atomic on the injected connection; workflow task status and event recording remain delegated to WorkflowStatePort v2. This is an in-process owner split, not an independent database.

`resolveExecutionPersistencePort(explicitPort, workflowStatePort)` validates and returns an explicitly supplied port, or builds the frozen legacy adapter for an older WorkflowStatePort v2 consumer. Use the explicit package port in new host composition; the compatibility adapter exists to preserve older callers while they migrate.

The ports and participants do not expose a database handle or transaction callback. A composing Workflow transaction owner may invoke typed participants while holding its existing writer reservation. The read-only `ExecutionStatePort` exposes only named queries. The provider-ledger port exposes only named provider persistence methods. `assertSharedConnection` checks identity without returning the connection.

## Ownership boundary

| Data | Owner | Current transaction coordinator |
|---|---|---|
| `attempts`, `results`, `task_checkpoints`, `execution_batches`, `execution_batch_items` | `ExecutionStateStore` | WorkflowStore for cross-domain task/job/event consistency |
| `provider_runs`, `provider_dispatch_intents` | `ExecutionPersistenceStore` | Execution methods own provider-only mutations; WorkflowStatePort coordinates cross-domain send/result/lease fences |
| `jobs`, `tasks`, `task_leases`, shared `events` | Workflow Runtime | Workflow Runtime |

This package does not own OS process creation, local execution supervision, remote provider transport, scheduling, M12 Gateway reconciliation, Workflow approval authority, trust roots or filesystem write authorization. Those remain host/provider/Workflow concerns until their own contracts and recovery protocols are extracted.

## Validation

`npm run check` runs the package tests. `npm run test:packed-consumer` installs the exact generated tarball in an isolated consumer and tests the public root exports. CI runs Node 22 and 24. This evidence proves package/API behavior only; it does not certify a deployed host or independent database operation.

## Status

Version `0.1.0` is experimental and GitHub-first. Not published to npm. Storage/schema compatibility remains pre-1.0.

## License

MIT. See [LICENSE](LICENSE).
