# Changelog

## 0.1.7

- Extract provider dispatch scheduling, durable dispatch-intent reconciliation, pre-send retry and bounded task fan-out into `ProviderDispatchScheduler`.
- Require explicit WorkflowStatePort v2 and ExecutionPersistencePort v1; package code no longer constructs WorkflowStatePort or provides a legacy store adapter.
- Add root and `./provider-dispatch-scheduler` exports plus packed-consumer coverage. The host keeps `DistributedScheduler` as a compatibility wrapper for legacy `store` callers.
- Preserve Workflow-owned task leases, task/job checks, event writes and cross-domain transaction fences on the same injected SQLite connection.

## 0.1.6

- Extract the Gateway specialist RPC adapter behind an explicit WorkflowStatePort v2 and node-role Gateway client contract.
- Keep task/lease/start-intent/send-claim/attachment/result reconciliation operations delegated to WorkflowStatePort; no Workflow database or transaction ownership moved.
- Preserve one-way M12 start claims and fail-closed unknown-outcome quarantine. Automated external Gateway lookup/reconciliation remains unimplemented.
- Add public root and `./gateway-specialist-adapter` exports with packed-consumer coverage.

## 0.1.5

- Extract the deterministic in-memory runner fixture behind ExecutionPersistencePort v1; no Workflow Store, WorkflowStatePort or database handle is accepted.
- Keep the legacy M11 host constructor as a compatibility composition. The package API is named `DeterministicRunnerProvider` and makes no M11 product-specific contract claim.
- Add public root and `./deterministic-runner-provider` exports and packed-consumer coverage.

## 0.1.4

- Extract the GitHub Actions provider transport, dispatch/reconciliation logic and bounded artifact/evidence reader behind explicit ExecutionPersistencePort and injected WorkflowStatePort v2 contracts.
- Add public root and `./github-actions-provider` exports; retain host environment/store composition as a compatibility facade.
- The package implementation does not open or own Workflow state. Lease, one-way send-claim, task/event and fenced result transactions remain Workflow-owned operations on the caller-supplied shared connection.
- Add the immutable Execution Evidence package dependency for request/result validation and artifact verification.

## 0.1.3

- Extract GitHub Actions OIDC verification and the stateless Runner Admission broker behind injected binding-authority and Gateway provisioner interfaces.
- Export Runner Admission from the package root and `./runner-admission` subpath; retain host compatibility imports during migration.
- Keep Gateway provisioning authority in the Gateway host. Broker replay/idempotency maps remain process-local and are not a durable replay ledger.
- No change to shared Workflow/Execution database or transaction ownership.

## 0.1.2

- Extract the bounded Provider Admission controller and its provider-owned `provider_admission*` schema behind an injected WorkflowStatePort v2 task/event API.
- Export the controller, frozen provider state vocabulary and rate-limit classifier from the package root.
- Preserve shared SQLite transaction behavior; Workflow task/event interactions remain named host ports.

## 0.1.1

- Export `resolveExecutionPersistencePort` from the package root so compatibility consumers can select the explicit or WorkflowStatePort-backed provider persistence adapter.

## 0.1.0

- Initial standalone extraction of Execution state and provider-ledger persistence primitives, ports, participants, dispatch identity and COS-AP execution contracts.
- Explicit shared-connection composition; no independent database or process is implied.
