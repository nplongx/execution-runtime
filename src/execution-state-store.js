/**
 * Physical schema owner for durable Execution attempts, results, batches and
 * task checkpoints. Rows keep Workflow foreign keys and remain on the shared
 * SQLite connection; WorkflowStore still owns cross-domain lifecycle writes.
 */
export const EXECUTION_STATE_STORE_VERSION = 1;

export const EXECUTION_STATE_TABLES = Object.freeze([
  'attempts',
  'results',
  'execution_batches',
  'execution_batch_items',
  'task_checkpoints'
]);

export const EXECUTION_STATE_READ_METHODS = Object.freeze([
  'getExecutionBatch',
  'listExecutionBatchItems',
  'getExecutionBatchItemForTask',
  'getMandatoryBatchItemForTask',
  'hasTaskAttemptHistory',
  'hasTaskBatchItemHistory',
  'getResult',
  'hasSuccessfulTaskResult',
  'listSuccessfulResultsForTask',
  'listResultsForTask',
  'listActiveLocalAttemptsForTask',
  'countTaskAttempts',
  'countTaskBatchItems',
  'getAttempt',
  'listActiveExecutionBatchesForJob',
  'getLatestTaskResult',
  'getLatestTaskCheckpoint',
  'listAttemptsForTaskIds',
  'listResultsForTaskIds',
  'listAttemptStatusCounts'
]);

export const EXECUTION_STATE_WRITE_METHODS = Object.freeze([
  'insertAttempt',
  'insertResult',
  'insertTaskCheckpoint',
  'updateResultContent',
  'updateAttemptStatusByIdentity',
  'updateActiveAttemptsForTask',
  'updateAttemptStatusBefore',
  'bindAttemptRunIdIfUnbound',
  'bindStartedAttemptRunId',
  'setAttemptRunId',
  'insertExecutionBatch',
  'insertExecutionBatchItem',
  'reserveExecutionBatchForRetry',
  'reserveExecutionBatchForAttempt',
  'reserveExecutionBatchForCancellation',
  'claimExecutionBatchItem',
  'retryExecutionBatch',
  'resetIncompleteExecutionBatchItemsForRetry',
  'failUnstartedExecutionBatchItem',
  'finishExecutionBatchItem',
  'failRunningExecutionBatchItem',
  'markExecutionBatchWaiting',
  'finishExecutionBatch',
  'cancelIncompleteExecutionBatchItems',
  'cancelExecutionBatch'
]);

function requiredId(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

export class ExecutionStateStore {
  #db;

  constructor(database) {
    if (!database || typeof database.prepare !== 'function') {
      throw new TypeError('ExecutionStateStore requires an injected DatabaseSync-compatible connection');
    }
    this.#db = database;
    this.ensureSchema();
  }

  get version() { return EXECUTION_STATE_STORE_VERSION; }

  assertSharedConnection(database) {
    if (!database || database !== this.#db) {
      throw new TypeError('Execution state participants must share the ExecutionStateStore SQLite connection');
    }
    return true;
  }

  // Write primitives deliberately do not create/release transactions. The
  // Workflow coordinator owns the surrounding atomic unit whenever these
  // rows share a commit with tasks, leases, artifacts or events.
  insertAttempt({ attemptId, taskId, status, openClawRunId = null, startedAt, finishedAt = null, error = null } = {}) {
    requiredId(attemptId, 'attemptId');
    requiredId(taskId, 'taskId');
    if (!['started', 'completed', 'failed', 'timeout', 'cancelled'].includes(status)) {
      throw new TypeError('attempt status is invalid');
    }
    if (typeof startedAt !== 'string' || !startedAt) throw new TypeError('startedAt must be a non-empty string');
    if (openClawRunId !== null && (typeof openClawRunId !== 'string' || !openClawRunId)) throw new TypeError('openClawRunId must be a non-empty string or null');
    if (finishedAt !== null && (typeof finishedAt !== 'string' || !finishedAt)) throw new TypeError('finishedAt must be a non-empty string or null');
    if (error !== null && typeof error !== 'string') throw new TypeError('error must be a string or null');
    return this.#db.prepare(`INSERT INTO attempts(attempt_id,task_id,status,openclaw_run_id,started_at,finished_at,error)
      VALUES(?,?,?,?,?,?,?)`).run(attemptId, taskId, status, openClawRunId, startedAt, finishedAt, error);
  }

  insertResult({ resultId, taskId, outcome, content, createdAt } = {}) {
    requiredId(resultId, 'resultId');
    requiredId(taskId, 'taskId');
    if (!['success', 'failure', 'partial'].includes(outcome)) throw new TypeError('result outcome is invalid');
    if (typeof content !== 'string') throw new TypeError('result content must be a string');
    if (typeof createdAt !== 'string' || !createdAt) throw new TypeError('createdAt must be a non-empty string');
    return this.#db.prepare('INSERT INTO results(result_id,task_id,outcome,content,created_at) VALUES(?,?,?,?,?)')
      .run(resultId, taskId, outcome, content, createdAt);
  }

  insertTaskCheckpoint({ checkpointId, taskId, jobId, attempt, checkpointCommit, checkpointRef = null,
    providerRunId = null, evidenceArtifact = null, createdAt } = {}) {
    requiredId(checkpointId, 'checkpointId');
    requiredId(taskId, 'taskId');
    requiredId(jobId, 'jobId');
    requiredId(checkpointCommit, 'checkpointCommit');
    if (!Number.isSafeInteger(attempt) || attempt < 1) throw new TypeError('checkpoint attempt must be a positive safe integer');
    for (const [value, label] of [[checkpointRef, 'checkpointRef'], [providerRunId, 'providerRunId'], [evidenceArtifact, 'evidenceArtifact']]) {
      if (value !== null && (typeof value !== 'string' || !value)) throw new TypeError(`${label} must be a non-empty string or null`);
    }
    if (typeof createdAt !== 'string' || !createdAt) throw new TypeError('createdAt must be a non-empty string');
    return this.#db.prepare(`INSERT INTO task_checkpoints(
      checkpoint_id,task_id,job_id,attempt,checkpoint_commit,checkpoint_ref,provider_run_id,evidence_artifact,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?)`).run(checkpointId, taskId, jobId, attempt, checkpointCommit, checkpointRef,
      providerRunId, evidenceArtifact, createdAt);
  }

  updateResultContent({ resultId, content } = {}) {
    requiredId(resultId, 'resultId');
    if (typeof content !== 'string') throw new TypeError('result content must be a string');
    return this.#db.prepare('UPDATE results SET content=? WHERE result_id=?').run(content, resultId);
  }

  updateAttemptStatusByIdentity({ attemptId, taskId = null, expectedStatus = 'started', status,
    finishedAt, error = undefined } = {}) {
    requiredId(attemptId, 'attemptId');
    if (taskId !== null) requiredId(taskId, 'taskId');
    if (!['started', 'completed', 'failed', 'timeout', 'cancelled'].includes(expectedStatus) ||
        !['started', 'completed', 'failed', 'timeout', 'cancelled'].includes(status)) {
      throw new TypeError('attempt expected/next status is invalid');
    }
    if (finishedAt !== null && (typeof finishedAt !== 'string' || !finishedAt)) throw new TypeError('finishedAt must be a non-empty string or null');
    if (error !== undefined && error !== null && typeof error !== 'string') throw new TypeError('error must be a string or null');
    const assignments = error === undefined
      ? 'status=?,finished_at=?'
      : 'status=?,finished_at=?,error=?';
    const predicates = `attempt_id=?${taskId === null ? '' : ' AND task_id=?'} AND status=?`;
    const values = [status, finishedAt];
    if (error !== undefined) values.push(error);
    values.push(attemptId);
    if (taskId !== null) values.push(taskId);
    values.push(expectedStatus);
    return this.#db.prepare(`UPDATE attempts SET ${assignments} WHERE ${predicates}`).run(...values);
  }

  updateActiveAttemptsForTask({ taskId, expectedStatus = 'started', status, finishedAt, error = undefined } = {}) {
    requiredId(taskId, 'taskId');
    if (!['started', 'completed', 'failed', 'timeout', 'cancelled'].includes(expectedStatus) ||
        !['started', 'completed', 'failed', 'timeout', 'cancelled'].includes(status)) {
      throw new TypeError('attempt expected/next status is invalid');
    }
    if (finishedAt !== null && (typeof finishedAt !== 'string' || !finishedAt)) throw new TypeError('finishedAt must be a non-empty string or null');
    if (error !== undefined && error !== null && typeof error !== 'string') throw new TypeError('error must be a string or null');
    const assignments = error === undefined
      ? 'status=?,finished_at=?'
      : 'status=?,finished_at=?,error=?';
    const values = [status, finishedAt];
    if (error !== undefined) values.push(error);
    values.push(taskId, expectedStatus);
    return this.#db.prepare(`UPDATE attempts SET ${assignments} WHERE task_id=? AND status=?`).run(...values);
  }

  updateAttemptStatusBefore({ attemptId, cutoff, status, finishedAt, error = null } = {}) {
    requiredId(attemptId, 'attemptId');
    if (typeof cutoff !== 'string' || !cutoff || typeof finishedAt !== 'string' || !finishedAt) {
      throw new TypeError('attempt stale cutoff and finish time must be non-empty strings');
    }
    if (!['completed', 'failed', 'timeout', 'cancelled'].includes(status)) throw new TypeError('attempt terminal status is invalid');
    if (error !== null && typeof error !== 'string') throw new TypeError('error must be a string or null');
    return this.#db.prepare(`UPDATE attempts SET status=?,finished_at=?,error=?
      WHERE attempt_id=? AND status='started' AND started_at<?`).run(status, finishedAt, error, attemptId, cutoff);
  }

  bindAttemptRunIdIfUnbound({ attemptId, taskId = null, runId } = {}) {
    requiredId(attemptId, 'attemptId');
    if (taskId !== null) requiredId(taskId, 'taskId');
    requiredId(runId, 'runId');
    return this.#db.prepare(`UPDATE attempts SET openclaw_run_id=? WHERE attempt_id=?${taskId === null ? '' : ' AND task_id=?'}
      AND status='started' AND openclaw_run_id IS NULL`)
      .run(...(taskId === null ? [runId, attemptId] : [runId, attemptId, taskId]));
  }

  bindStartedAttemptRunId({ attemptId, taskId, runId } = {}) {
    requiredId(attemptId, 'attemptId');
    requiredId(taskId, 'taskId');
    requiredId(runId, 'runId');
    return this.#db.prepare(`UPDATE attempts SET openclaw_run_id=? WHERE attempt_id=? AND task_id=?
      AND status='started' AND (openclaw_run_id IS NULL OR openclaw_run_id=?)`)
      .run(runId, attemptId, taskId, runId);
  }

  setAttemptRunId({ attemptId, runId } = {}) {
    requiredId(attemptId, 'attemptId');
    requiredId(runId, 'runId');
    return this.#db.prepare('UPDATE attempts SET openclaw_run_id=? WHERE attempt_id=?').run(runId, attemptId);
  }

  insertExecutionBatch({ batchId, jobId, parentTaskId = null, role, attempt = 1, createdAt, startedAt } = {}) {
    requiredId(batchId, 'batchId');
    requiredId(jobId, 'jobId');
    if (parentTaskId !== null) requiredId(parentTaskId, 'parentTaskId');
    requiredId(role, 'role');
    if (!Number.isSafeInteger(attempt) || attempt < 1) throw new TypeError('batch attempt must be a positive safe integer');
    if (typeof createdAt !== 'string' || !createdAt || typeof startedAt !== 'string' || !startedAt) {
      throw new TypeError('batch timestamps must be non-empty strings');
    }
    return this.#db.prepare(`INSERT INTO execution_batches(batch_id,job_id,parent_task_id,role,status,attempt,created_at,started_at)
      VALUES(?,?,?,?, 'RUNNING',?,?,?)`).run(batchId, jobId, parentTaskId, role, attempt, createdAt, startedAt);
  }

  insertExecutionBatchItem({ batchId, itemId, taskId, command, cwd = null, timeoutMs = null, attempt = 1 } = {}) {
    requiredId(batchId, 'batchId');
    requiredId(itemId, 'itemId');
    requiredId(taskId, 'taskId');
    if (typeof command !== 'string' || !command) throw new TypeError('batch item command must be a non-empty string');
    if (cwd !== null && (typeof cwd !== 'string' || !cwd)) throw new TypeError('batch item cwd must be a non-empty string or null');
    if (timeoutMs !== null && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)) throw new TypeError('batch item timeoutMs must be a positive safe integer or null');
    if (!Number.isSafeInteger(attempt) || attempt < 1) throw new TypeError('batch item attempt must be a positive safe integer');
    return this.#db.prepare(`INSERT INTO execution_batch_items(batch_id,item_id,task_id,command,cwd,timeout_ms,status,attempt)
      VALUES(?,?,?,?,?,?,'PENDING',?)`).run(batchId, itemId, taskId, command, cwd, timeoutMs, attempt);
  }

  reserveExecutionBatchForRetry(batchId) {
    requiredId(batchId, 'batchId');
    return this.#db.prepare('UPDATE execution_batches SET status=status WHERE batch_id=?').run(batchId);
  }

  reserveExecutionBatchForAttempt({ batchId, attempt, statuses = ['RUNNING', 'WAITING'] } = {}) {
    requiredId(batchId, 'batchId');
    if (!Number.isSafeInteger(attempt) || attempt < 1) throw new TypeError('batch attempt must be a positive safe integer');
    if (!Array.isArray(statuses) || !statuses.length || statuses.some(status => !['RUNNING', 'WAITING'].includes(status))) {
      throw new TypeError('batch reservation statuses must be a non-empty RUNNING/WAITING list');
    }
    const placeholders = statuses.map(() => '?').join(',');
    return this.#db.prepare(`UPDATE execution_batches SET status=status
      WHERE batch_id=? AND attempt=? AND status IN (${placeholders})`).run(batchId, attempt, ...statuses);
  }

  reserveExecutionBatchForCancellation(batchId) {
    requiredId(batchId, 'batchId');
    return this.#db.prepare("UPDATE execution_batches SET status=status WHERE batch_id=? AND status IN ('RUNNING','WAITING')").run(batchId);
  }

  claimExecutionBatchItem({ batchId, itemId, expectedAttempt, startedAt } = {}) {
    requiredId(batchId, 'batchId');
    requiredId(itemId, 'itemId');
    if (!Number.isSafeInteger(expectedAttempt) || expectedAttempt < 1) throw new TypeError('item attempt must be a positive safe integer');
    requiredId(startedAt, 'startedAt');
    return this.#db.prepare(`UPDATE execution_batch_items SET status='RUNNING',started_at=?
      WHERE batch_id=? AND item_id=? AND status='PENDING' AND attempt=?
        AND EXISTS (SELECT 1 FROM execution_batches b WHERE b.batch_id=execution_batch_items.batch_id
          AND b.status IN ('RUNNING','WAITING') AND b.attempt=?)`)
      .run(startedAt, batchId, itemId, expectedAttempt, expectedAttempt);
  }

  retryExecutionBatch({ batchId, expectedAttempt, nextAttempt, startedAt } = {}) {
    requiredId(batchId, 'batchId');
    if (!Number.isSafeInteger(expectedAttempt) || expectedAttempt < 1 ||
        !Number.isSafeInteger(nextAttempt) || nextAttempt !== expectedAttempt + 1) {
      throw new TypeError('batch retry must advance exactly one positive attempt');
    }
    if (typeof startedAt !== 'string' || !startedAt) throw new TypeError('batch retry timestamp must be a non-empty string');
    return this.#db.prepare(`UPDATE execution_batches SET status='RUNNING',attempt=?,started_at=?,finished_at=NULL
      WHERE batch_id=? AND status='FAILED' AND attempt=?`).run(nextAttempt, startedAt, batchId, expectedAttempt);
  }

  resetIncompleteExecutionBatchItemsForRetry(batchId) {
    requiredId(batchId, 'batchId');
    return this.#db.prepare(`UPDATE execution_batch_items SET status='PENDING',attempt=attempt+1,execution_session_id=NULL,
      execution_pid=NULL,exit_code=NULL,stdout='',stderr='',error=NULL,started_at=NULL,finished_at=NULL
      WHERE batch_id=? AND status <> 'COMPLETED'`).run(batchId);
  }

  failUnstartedExecutionBatchItem({ batchId, itemId, taskId, expectedAttempt, startedBefore,
    reason, finishedAt } = {}) {
    requiredId(batchId, 'batchId');
    requiredId(itemId, 'itemId');
    requiredId(taskId, 'taskId');
    if (!Number.isSafeInteger(expectedAttempt) || expectedAttempt < 1) throw new TypeError('item attempt must be a positive safe integer');
    requiredId(startedBefore, 'startedBefore');
    requiredId(reason, 'reason');
    requiredId(finishedAt, 'finishedAt');
    return this.#db.prepare(`UPDATE execution_batch_items SET status='FAILED',error=?,stderr=?,finished_at=?
      WHERE batch_id=? AND item_id=? AND task_id=? AND status='RUNNING' AND attempt=? AND started_at<=?
        AND EXISTS (SELECT 1 FROM execution_batches b WHERE b.batch_id=execution_batch_items.batch_id
          AND b.attempt=? AND b.status IN ('RUNNING','WAITING'))`)
      .run(reason, reason, finishedAt, batchId, itemId, taskId, expectedAttempt, startedBefore, expectedAttempt);
  }

  finishExecutionBatchItem({ batchId, itemId, expectedAttempt, status, executionSessionId = null,
    executionPid = null, exitCode = null, stdout = '', stderr = '', error = null, finishedAt } = {}) {
    requiredId(batchId, 'batchId');
    requiredId(itemId, 'itemId');
    if (!Number.isSafeInteger(expectedAttempt) || expectedAttempt < 1) throw new TypeError('item attempt must be a positive safe integer');
    if (!['COMPLETED', 'FAILED', 'TIMEOUT', 'CANCELLED'].includes(status)) throw new TypeError('item terminal status is invalid');
    if (executionSessionId !== null && (typeof executionSessionId !== 'string' || !executionSessionId)) throw new TypeError('executionSessionId must be a non-empty string or null');
    if (executionPid !== null && (!Number.isSafeInteger(executionPid) || executionPid < 1)) throw new TypeError('executionPid must be a positive safe integer or null');
    if (exitCode !== null && (!Number.isSafeInteger(exitCode) || Object.is(exitCode, -0))) throw new TypeError('exitCode must be a canonical safe integer or null');
    if (typeof stdout !== 'string' || typeof stderr !== 'string' || (error !== null && typeof error !== 'string')) throw new TypeError('item output/error fields must use exact string types');
    requiredId(finishedAt, 'finishedAt');
    return this.#db.prepare(`UPDATE execution_batch_items SET status=?,execution_session_id=?,execution_pid=?,
      exit_code=?,stdout=?,stderr=?,error=?,finished_at=?
      WHERE batch_id=? AND item_id=? AND status='RUNNING' AND attempt=?
        AND EXISTS (SELECT 1 FROM execution_batches b WHERE b.batch_id=? AND b.status IN ('RUNNING','WAITING'))`)
      .run(status, executionSessionId, executionPid, exitCode, stdout, stderr, error, finishedAt,
        batchId, itemId, expectedAttempt, batchId);
  }

  failRunningExecutionBatchItem({ batchId, itemId, taskId, expectedAttempt, reason, finishedAt } = {}) {
    requiredId(batchId, 'batchId');
    requiredId(itemId, 'itemId');
    requiredId(taskId, 'taskId');
    requiredId(reason, 'reason');
    requiredId(finishedAt, 'finishedAt');
    if (!Number.isSafeInteger(expectedAttempt) || expectedAttempt < 1) throw new TypeError('item attempt must be a positive safe integer');
    return this.#db.prepare(`UPDATE execution_batch_items SET status='FAILED',error=?,stderr=?,finished_at=?
      WHERE batch_id=? AND item_id=? AND task_id=? AND status='RUNNING' AND attempt=?`)
      .run(reason, reason, finishedAt, batchId, itemId, taskId, expectedAttempt);
  }

  markExecutionBatchWaiting(batchId) {
    requiredId(batchId, 'batchId');
    return this.#db.prepare("UPDATE execution_batches SET status='WAITING' WHERE batch_id=? AND status='RUNNING'").run(batchId);
  }

  finishExecutionBatch({ batchId, expectedAttempt, status, finishedAt, aggregateContent } = {}) {
    requiredId(batchId, 'batchId');
    if (!Number.isSafeInteger(expectedAttempt) || expectedAttempt < 1) throw new TypeError('batch attempt must be a positive safe integer');
    if (!['COMPLETED', 'FAILED'].includes(status)) throw new TypeError('batch terminal status is invalid');
    requiredId(finishedAt, 'finishedAt');
    if (typeof aggregateContent !== 'string') throw new TypeError('aggregateContent must be a string');
    return this.#db.prepare(`UPDATE execution_batches SET status=?,finished_at=?,aggregate_content=?
      WHERE batch_id=? AND status IN ('RUNNING','WAITING') AND attempt=?`)
      .run(status, finishedAt, aggregateContent, batchId, expectedAttempt);
  }

  cancelIncompleteExecutionBatchItems({ batchId, reason, finishedAt } = {}) {
    requiredId(batchId, 'batchId');
    requiredId(reason, 'reason');
    requiredId(finishedAt, 'finishedAt');
    return this.#db.prepare(`UPDATE execution_batch_items SET status='CANCELLED',error=?,finished_at=?
      WHERE batch_id=? AND status IN ('PENDING','RUNNING')`).run(reason, finishedAt, batchId);
  }

  cancelExecutionBatch({ batchId, reason, finishedAt } = {}) {
    requiredId(batchId, 'batchId');
    requiredId(reason, 'reason');
    requiredId(finishedAt, 'finishedAt');
    return this.#db.prepare(`UPDATE execution_batches SET status='CANCELLED',finished_at=?,aggregate_content=?
      WHERE batch_id=? AND status IN ('RUNNING','WAITING')`).run(finishedAt, reason, batchId);
  }

  ensureSchema() {
    const db = this.#db;
    if (db.__p6Fake || typeof db.exec !== 'function') return;

    db.exec(`
      CREATE TABLE IF NOT EXISTS attempts (
        attempt_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(task_id),
        status TEXT NOT NULL CHECK (status IN ('started','completed','failed','timeout','cancelled')),
        openclaw_run_id TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        error TEXT
      );
      CREATE TABLE IF NOT EXISTS results (
        result_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(task_id),
        outcome TEXT NOT NULL CHECK (outcome IN ('success','failure','partial')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS execution_batches (
        batch_id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(job_id),
        parent_task_id TEXT REFERENCES tasks(task_id),
        role TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('RUNNING','WAITING','COMPLETED','FAILED','CANCELLED')),
        attempt INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        aggregate_content TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_execution_batches_job ON execution_batches(job_id, created_at);
      CREATE TABLE IF NOT EXISTS execution_batch_items (
        batch_id TEXT NOT NULL REFERENCES execution_batches(batch_id),
        item_id TEXT NOT NULL,
        task_id TEXT NOT NULL REFERENCES tasks(task_id),
        command TEXT NOT NULL,
        cwd TEXT,
        timeout_ms INTEGER,
        attempt INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL CHECK (status IN ('PENDING','RUNNING','COMPLETED','FAILED','TIMEOUT','CANCELLED')),
        execution_session_id TEXT,
        execution_pid INTEGER,
        exit_code INTEGER,
        stdout TEXT NOT NULL DEFAULT '',
        stderr TEXT NOT NULL DEFAULT '',
        started_at TEXT,
        finished_at TEXT,
        error TEXT,
        PRIMARY KEY (batch_id, item_id),
        UNIQUE (batch_id, task_id)
      );
      CREATE INDEX IF NOT EXISTS idx_execution_batch_items_task ON execution_batch_items(task_id, batch_id);
      CREATE TABLE IF NOT EXISTS task_checkpoints (
        checkpoint_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(task_id),
        job_id TEXT NOT NULL REFERENCES jobs(job_id),
        attempt INTEGER NOT NULL,
        checkpoint_commit TEXT NOT NULL,
        checkpoint_ref TEXT,
        provider_run_id TEXT,
        evidence_artifact TEXT,
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_task_checkpoints_attempt ON task_checkpoints(task_id, attempt);
      CREATE INDEX IF NOT EXISTS idx_task_checkpoints_latest ON task_checkpoints(task_id, created_at DESC);
    `);

    try { db.exec("ALTER TABLE execution_batch_items ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1"); }
    catch (error) {
      if (!/duplicate column name:\s*attempt/i.test(String(error?.message || error))) throw error;
    }
    for (const [column, type] of [['cwd', 'TEXT'], ['timeout_ms', 'INTEGER']]) {
      try { db.exec(`ALTER TABLE execution_batch_items ADD COLUMN ${column} ${type}`); }
      catch (error) {
        if (!new RegExp(`duplicate column name:\\s*${column}`, 'i').test(String(error?.message || error))) throw error;
      }
    }
  }

  // Read-only Execution-owned projections. Cross-domain reads that join
  // Workflow tasks/jobs/events deliberately remain in WorkflowStatePort.
  getExecutionBatch(batchId) {
    const id = requiredId(batchId, 'batchId');
    return this.#db.prepare('SELECT * FROM execution_batches WHERE batch_id=?').get(id) || null;
  }

  listExecutionBatchItems(batchId) {
    const id = requiredId(batchId, 'batchId');
    return this.#db.prepare('SELECT * FROM execution_batch_items WHERE batch_id=? ORDER BY rowid ASC').all(id);
  }

  getExecutionBatchItemForTask(taskId) {
    const id = requiredId(taskId, 'taskId');
    return this.#db.prepare(`SELECT b.batch_id,b.status,i.status AS item_status
      FROM execution_batch_items i JOIN execution_batches b ON b.batch_id=i.batch_id
      WHERE i.task_id=? ORDER BY b.created_at DESC,b.rowid DESC LIMIT 1`).get(id) || null;
  }

  getMandatoryBatchItemForTask(jobId, taskId) {
    const job = requiredId(jobId, 'jobId');
    const task = requiredId(taskId, 'taskId');
    return this.#db.prepare(`SELECT i.batch_id,i.task_id,i.command,i.cwd,i.timeout_ms,i.status AS item_status,
        i.execution_session_id,i.execution_pid,i.exit_code,i.attempt AS item_attempt,
        b.job_id AS batch_job_id,b.parent_task_id AS batch_parent_task_id,b.status AS batch_status,b.attempt AS batch_attempt
      FROM execution_batch_items i JOIN execution_batches b ON b.batch_id=i.batch_id
      WHERE i.task_id=? AND b.job_id=?`).all(task, job);
  }

  hasTaskAttemptHistory(taskId) {
    const task = requiredId(taskId, 'taskId');
    return Boolean(this.#db.prepare('SELECT 1 FROM attempts WHERE task_id=? LIMIT 1').get(task));
  }

  hasTaskBatchItemHistory(taskId) {
    const task = requiredId(taskId, 'taskId');
    return Boolean(this.#db.prepare('SELECT 1 FROM execution_batch_items WHERE task_id=? LIMIT 1').get(task));
  }

  getResult(resultId) {
    const id = requiredId(resultId, 'resultId');
    return this.#db.prepare('SELECT result_id,task_id,outcome,content,created_at FROM results WHERE result_id=?').get(id) || null;
  }

  hasSuccessfulTaskResult(resultId, taskId) {
    const result = requiredId(resultId, 'resultId');
    const task = requiredId(taskId, 'taskId');
    return Boolean(this.#db.prepare("SELECT 1 FROM results WHERE result_id=? AND task_id=? AND outcome='success'").get(result, task));
  }

  listSuccessfulResultsForTask(taskId) {
    const task = requiredId(taskId, 'taskId');
    return this.#db.prepare("SELECT result_id,task_id,outcome,content,created_at FROM results WHERE task_id=? AND outcome='success' ORDER BY created_at ASC,rowid ASC")
      .all(task);
  }

  listResultsForTask(taskId) {
    const task = requiredId(taskId, 'taskId');
    return this.#db.prepare('SELECT result_id,task_id,outcome,content,created_at FROM results WHERE task_id=? ORDER BY created_at ASC,rowid ASC')
      .all(task);
  }

  listActiveLocalAttemptsForTask(taskId) {
    const task = requiredId(taskId, 'taskId');
    return this.#db.prepare("SELECT attempt_id,task_id,status,openclaw_run_id,started_at,finished_at,error FROM attempts WHERE task_id=? AND status='started' ORDER BY started_at ASC,rowid ASC")
      .all(task);
  }

  countTaskAttempts(taskId) {
    const task = requiredId(taskId, 'taskId');
    return Number(this.#db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE task_id=?').get(task)?.n || 0);
  }

  countTaskBatchItems(taskId) {
    const task = requiredId(taskId, 'taskId');
    return Number(this.#db.prepare('SELECT COUNT(*) AS n FROM execution_batch_items WHERE task_id=?').get(task)?.n || 0);
  }

  getAttempt(attemptId, taskId = null) {
    const attempt = requiredId(attemptId, 'attemptId');
    if (taskId !== null) requiredId(taskId, 'taskId');
    return this.#db.prepare(`SELECT attempt_id,task_id,status,openclaw_run_id,started_at,finished_at,error
      FROM attempts WHERE attempt_id=?${taskId === null ? '' : ' AND task_id=?'}`)
      .get(...(taskId === null ? [attempt] : [attempt, taskId])) || null;
  }

  listActiveExecutionBatchesForJob(jobId) {
    const job = requiredId(jobId, 'jobId');
    return this.#db.prepare("SELECT batch_id FROM execution_batches WHERE job_id=? AND status IN ('RUNNING','WAITING')")
      .all(job);
  }

  getLatestTaskResult(taskId) {
    const task = requiredId(taskId, 'taskId');
    return this.#db.prepare('SELECT outcome,content FROM results WHERE task_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(task) || null;
  }

  getLatestTaskCheckpoint(taskId) {
    const task = requiredId(taskId, 'taskId');
    return this.#db.prepare('SELECT * FROM task_checkpoints WHERE task_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(task) || null;
  }

  listAttemptsForTaskIds(taskIds) {
    if (!Array.isArray(taskIds) || taskIds.some(taskId => typeof taskId !== 'string' || !taskId.trim())) {
      throw new TypeError('taskIds must be an array of non-empty task IDs');
    }
    if (!taskIds.length) return [];
    return this.#db.prepare(`SELECT * FROM attempts WHERE task_id IN (${taskIds.map(() => '?').join(',')}) ORDER BY started_at,rowid`)
      .all(...taskIds);
  }

  listResultsForTaskIds(taskIds) {
    if (!Array.isArray(taskIds) || taskIds.some(taskId => typeof taskId !== 'string' || !taskId.trim())) {
      throw new TypeError('taskIds must be an array of non-empty task IDs');
    }
    if (!taskIds.length) return [];
    return this.#db.prepare(`SELECT rowid AS durable_rowid,* FROM results WHERE task_id IN (${taskIds.map(() => '?').join(',')}) ORDER BY created_at,rowid`)
      .all(...taskIds);
  }

  listAttemptStatusCounts() {
    return this.#db.prepare('SELECT status,COUNT(*) AS count FROM attempts GROUP BY status ORDER BY status').all();
  }
}
