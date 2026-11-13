# Changelog

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
