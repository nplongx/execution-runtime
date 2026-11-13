# Security Policy

Report vulnerabilities privately to the repository owner through GitHub's private vulnerability reporting where enabled. Do not include credentials, signing keys, provider tokens, live database contents or personal data in public issues.

The package treats its injected SQLite connection as host-owned. It does not authenticate callers, establish trust roots, authorize workflow dispatch, execute processes or claim remote execution has stopped. Consumers must retain Workflow's approval, lease, task-state and event consistency fences. Do not expose private database handles from application adapters.
