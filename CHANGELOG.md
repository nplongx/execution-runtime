# Changelog

## 0.1.2

- Extract the bounded Provider Admission controller and its provider-owned `provider_admission*` schema behind an injected WorkflowStatePort v2 task/event API.
- Export the controller, frozen provider state vocabulary and rate-limit classifier from the package root.
- Preserve shared SQLite transaction behavior; Workflow task/event interactions remain named host ports.

## 0.1.1

- Export `resolveExecutionPersistencePort` from the package root so compatibility consumers can select the explicit or WorkflowStatePort-backed provider persistence adapter.

## 0.1.0

- Initial standalone extraction of Execution state and provider-ledger persistence primitives, ports, participants, dispatch identity and COS-AP execution contracts.
- Explicit shared-connection composition; no independent database or process is implied.
