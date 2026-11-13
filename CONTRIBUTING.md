# Contributing

Keep public exports explicit and versioned. Add isolated SQLite tests for schema, idempotency, concurrency and crash-recovery behavior. Never weaken Workflow approval, lease, task or event invariants to make package tests pass. Changes to persisted schema or provider dispatch identity require compatibility review and migration notes.

Run `npm ci`, `npm run check`, `npm run test:packed-consumer` and `npm pack --dry-run` before proposing a change. Do not include credentials, database contents or generated runtime state in commits.
