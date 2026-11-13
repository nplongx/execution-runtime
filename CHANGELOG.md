# Changelog

## 0.1.1

- Export `resolveExecutionPersistencePort` from the package root so compatibility consumers can select the explicit or WorkflowStatePort-backed provider persistence adapter.

## 0.1.0

- Initial standalone extraction of Execution state and provider-ledger persistence primitives, ports, participants, dispatch identity and COS-AP execution contracts.
- Explicit shared-connection composition; no independent database or process is implied.
