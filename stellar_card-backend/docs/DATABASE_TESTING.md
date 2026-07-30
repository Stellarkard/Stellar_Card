# Database Test Strategy (`test/unit/db.test.js`)

`src/db.js` is not a repository layer — it exports a raw `better-sqlite3`
handle after running the schema DDL, the migration chain, and a set of
connection pragmas at require time. Everything else in the backend
(`api/orders.js`, `api/dashboard.js`, `api/agent-claim.js`, `policy.js`,
`jobs.js`) prepares statements directly against that handle.

That shape means the interesting failure modes are not "does this
function return the right value" but:

- a migration that stops running and leaves a column missing,
- a pragma that silently fails to apply,
- an index that gets dropped and turns a hot query into a table scan,
- a constraint that stops being enforced,
- a transaction that no longer rolls back.

None of those change any function signature, and most of them keep every
query returning correct results — they just get slower, or start
accepting data they should reject. The tests are organised around
catching exactly those.

## Suites

| Suite                               | What it pins                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| `schema initialization`             | Every table and every `ALTER TABLE` column the migration chain declares      |
| `schema_migrations bookkeeping`     | Versions 1..N recorded exactly once, no gaps, `applied_at` stamped           |
| `system_state seed rows`            | `frozen` and `consecutive_failures` seeded to `'0'`                          |
| `orders table queries`              | CRUD round-trips, column defaults, `NOT NULL` and `PRIMARY KEY` enforcement  |
| `orders aggregate queries`          | The exact `SUM(CASE WHEN ...)` shapes `/status` and `/v1/usage` depend on    |
| `api_keys table queries`            | `UNIQUE(key_hash)`, defaults for `mode` / `suspended` / `enabled`            |
| `idempotency_keys table queries`    | Composite primary key `(key, api_key_id)`                                    |
| `foreign key enforcement`           | `ON DELETE CASCADE` for sessions and dashboards, dangling-reference rejects  |
| `unique and partial indexes`        | MPP challenge/receipt uniqueness, NULL-tolerant partial indexes, plan check  |
| `transaction semantics`             | Rollback on throw, rollback on constraint violation, commit on return        |
| `pragma settings`                   | `foreign_keys`, `busy_timeout` on the shared handle                          |
| `fresh on-disk instance`            | WAL mode, migration idempotency, seed rows, the schema-drift kill switch     |
| `users` / `auth_codes` / `sessions` | Uniqueness, role defaults, cascade on user deletion                          |
| `audit_log` / `webhook_deliveries`  | Append-only ordering and the dashboard feed query                            |
| `webhook_queue table queries`       | The retry scan predicate, the abandoned-delivery counter, the index plan     |
| `credential expiry semantics`       | The shared `used_at IS NULL AND datetime(expires_at) > datetime('now')` gate |
| `system_state upsert semantics`     | Cursor advance-in-place, TEXT coercion, the missing-key case                 |
| `stellar_dead_letter table queries` | Replay-safe `tx_hash` primary key, the 24h `/status` window                  |
| `unmatched_payments table queries`  | The un-refunded backlog query and its partial index                          |
| `policy_decisions table queries`    | Per-key history scoping, the composite index plan, nullable `order_id`       |

## Three SQLite behaviours worth knowing before adding a test

These are the ones that have actually bitten this schema. Each has a
dedicated test, and each fails silently rather than raising.

### `datetime()` returns NULL, and NULL comparisons are NULL

Every single-use credential — login codes, agent claim codes, MPP
challenges — is gated on:

```sql
WHERE used_at IS NULL AND datetime(expires_at) > datetime('now')
```

`datetime()` yields `NULL` for anything it cannot parse, and `NULL > x` is
`NULL`, not false. So a malformed `expires_at` makes the credential
permanently **unredeemable** — the safe direction, but not an obvious one.
Rewriting the predicate as `expires_at > datetime('now')` looks equivalent
and is not: that is a lexical string comparison, and `'next tuesday'` sorts
above every ISO-8601 timestamp, so the credential would become permanently
**valid** instead. The `credential expiry semantics` suite pins both halves.

### TEXT columns compare lexically

`next_attempt`, `created_at`, `updated_at` and `expires_at` are all TEXT.
Range queries against them only sort chronologically for well-formed
ISO-8601. A row written with `'Jan 1 2026 11:00'` is either permanently due
or permanently invisible depending on which side of the comparison it lands
on. This is why every writer goes through `toISOString()`.

### TEXT affinity stringifies whatever you bind

better-sqlite3 binds a JS number as REAL, so
`INSERT INTO system_state (key, value) VALUES ('x', 42)` stores `'42.0'`,
not `'42'`. `sysStateInt` survives that through `parseInt`, but a reader
comparing `=== '42'` would not — which is why the writers bind
`String(value)`.

## Why some tests spawn a child process

Most tests run against the shared `:memory:` database the test helper
boots (`test/helpers/app.js`). Three db.js behaviours are structurally
unobservable there:

1. **WAL journal mode.** SQLite refuses to put an in-memory database into
   WAL and silently reports `journal_mode = memory` instead. A test
   asserting `'wal'` against the in-memory handle can only ever fail —
   which is exactly what it did before this suite was reworked.
2. **Migration idempotency.** Proving a second boot re-applies nothing
   requires the database to survive a process boundary.
3. **The schema-drift kill switch.** `db.js` calls `process.exit(1)` when
   the on-disk schema version is ahead of `EXPECTED_SCHEMA_VERSION`. That
   cannot be exercised in-process without killing the test runner.

### `bootFreshDb(dbPath, expression)`

```js
const journalMode = bootFreshDb(dbPath, `db.pragma('journal_mode', { simple: true })`);
```

Spawns `node -e` in a child process with `DB_PATH` pointed at `dbPath`,
requires `src/db.js` there, evaluates `expression` with the database
handle in scope as `db`, and returns the JSON-parsed result.

A child process rather than a second in-process `new Database(...)` is
deliberate: `db.js` is a singleton whose schema and migration side
effects run at require time and is already cached by the parent. Re-
requiring it in-process hands back the `:memory:` handle and tests
nothing. The child gets a clean module registry and a `DB_PATH` of our
choosing, so it walks the identical code path a real boot takes.

Because `execFileSync` throws on a non-zero exit, the drift test asserts
on the thrown error's `status` and `stderr` rather than on stdout.

Temporary databases are created under `os.tmpdir()` via `fs.mkdtemp` and
removed in an `after` hook — WAL leaves `-wal` and `-shm` siblings, so
the whole directory is removed rather than the single file.

## Adding a migration

When you add `applyMigration(N, ...)` to `src/db.js`:

1. Bump `EXPECTED_SCHEMA_VERSION` in `src/db.js`.
2. Bump the `EXPECTED_SCHEMA_VERSION` constant at the top of
   `test/unit/db.test.js` to match.
3. Add any new table to the table-set assertion, any new column to the
   `PRAGMA table_info` assertion, and any new index to the index-set
   assertion.

Step 2 is the tripwire: the two constants drifting apart is precisely the
condition db.js refuses to boot on in production, so the test suite fails
first.
