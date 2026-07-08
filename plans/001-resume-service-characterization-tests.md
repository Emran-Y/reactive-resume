# Plan 001: Characterization tests for the resume service

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 73daf22b2..HEAD -- packages/api/src/features/resume/service.ts`
> If `service.ts` changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `73daf22b2`, 2026-07-08

## Why this matters

`packages/api/src/features/resume/service.ts` is 772 lines and owns every
resume mutation — `create`, `update`, `patch` (JSON Patch application),
`delete`, `duplicate`, `setLocked`, `setPassword`, `removePassword`,
`verifyPassword`, `getBySlug`, plus version-history snapshotting. It has **no
`service.test.ts`**. The only coverage is Playwright e2e, which exercises the
happy path through the UI and cannot assert error codes, lock enforcement, or
snapshot throttling in isolation. This service also has high churn (v5.2.0
added undo/redo + version history). Characterization tests here (a) catch
regressions in CRUD/patch/lock/password behavior before users do, and (b) are
a prerequisite for Plan 003 (which changes not-found behavior in this file)
and Plan 007 (template refactor) — you cannot safely refactor code that has no
behavioral net under it.

The goal is **characterization tests**: capture what the code does today,
locking in current behavior so later changes are deliberate, not accidental.

## Current state

- `packages/api/src/features/resume/service.ts` — the service under test.
  Exports a `resumeService` object literal whose methods each take an `input`
  object and call the mocked `db`. Key behaviors to pin down:
  - `update` (lines ~555–635): reads `isLocked`; throws `ORPCError("RESUME_LOCKED")`
    if locked; on a successful `UPDATE ... RETURNING`, if `!resume` throws
    `ORPCError("NOT_FOUND")`; maps a unique-constraint violation on
    `resume_slug_user_id_unique` to `ORPCError("RESUME_SLUG_ALREADY_EXISTS")`.
  - `setLocked` (lines ~663–679), `setPassword` (~681–699), `removePassword`
    (~726–742): each runs an `UPDATE ... RETURNING`, then `if (!resume) return;`
    (silent no-op when no row matches — **this is today's behavior; capture it
    as-is. Plan 003 will change it.**), else calls `notifyResumeUpdated`.
  - `delete` (lines ~744–769): transaction that throws `NOT_FOUND` when the row
    is missing and `RESUME_LOCKED` when locked, then deletes and cleans storage.
  - `statistics.increment` (lines ~199–237): two `INSERT ... ON CONFLICT DO
    UPDATE` writes inside a transaction.

- **Test convention to follow** — model the new test after the existing
  sibling `packages/api/src/features/applications/service.test.ts`. It mocks
  the DB layer with `vi.hoisted` + `vi.mock`, then dynamically imports the
  service. The exact shape to copy (from that file, lines 1–68):

  ```ts
  import { beforeEach, describe, expect, it, vi } from "vitest";

  const dbMock = vi.hoisted(() => ({
    select: vi.fn(), insert: vi.fn(), update: vi.fn(),
    delete: vi.fn(), transaction: vi.fn(),
  }));
  vi.mock("@reactive-resume/db/client", () => ({ db: dbMock }));
  vi.mock("@reactive-resume/db/schema", () => ({ /* stub the tables used */ }));
  vi.mock("drizzle-orm", () => ({
    and: (...a: unknown[]) => a, eq: (...a: unknown[]) => a,
    isNotNull: (...a: unknown[]) => a, sql: Object.assign(
      (s: TemplateStringsArray, ...v: unknown[]) => ({ s, v }),
      { join: (v: unknown[]) => v },
    ),
  }));

  const { resumeService } = await import("./service");
  ```

  Note the `applications/service.test.ts` helpers `createSelectChain(rows)` and
  `setSelectResults(...)` — reuse that pattern to script what each `db.select`
  / `db.update().returning()` call resolves to.

- **Mocks this service needs beyond the applications example** (grep the
  imports at the top of `service.ts` and mock each):
  - `bcrypt` (`hash`, `compare`) — used by `setPassword`/`verifyPassword`.
    (The real import specifier in `service.ts` is `bcrypt`, not `bcryptjs` —
    mock that exact module path.) Mock `hash` to return a fixed string and
    `compare` to return a boolean you control.
  - The snapshot/patch helpers imported into `service.ts` (e.g.
    `applyResumePatchTx`, `maybeSnapshotOnSave`, `writeResumeVersion`,
    `notifyResumeUpdated`, `getStorageService`) — mock them so the service's
    own branching is what's under test, not their internals. Read the top of
    `service.ts` to get the exact import specifiers and mock each module path
    the same way the applications test mocks `../storage/service`.

- **ORPCError assertions** — errors are `ORPCError` instances from
  `@orpc/server` with a `.code` (e.g. `"NOT_FOUND"`, `"RESUME_LOCKED"`). Assert
  with `await expect(fn()).rejects.toThrow()` and, where you can, check the
  code: `await fn().catch((e) => expect(e.code).toBe("RESUME_LOCKED"))`, or
  assert on `.message`. Confirm the real shape by reading how
  `access-policy.test.ts` or `access.test.ts` in the same folder assert on
  `ORPCError` and copy that style.

## Commands you will need

| Purpose   | Command                                                              | Expected on success |
|-----------|---------------------------------------------------------------------|---------------------|
| Typecheck | `pnpm --filter @reactive-resume/api typecheck`                      | exit 0, no errors   |
| Run test  | `pnpm --filter @reactive-resume/api test -- resume/service.test.ts` | all pass            |
| All api tests | `pnpm --filter @reactive-resume/api test`                       | all pass            |

(These are the repo's real commands — package-scoped Vitest via Turborepo.
Do NOT run `pnpm check`; it rewrites files.)

## Scope

**In scope** (the only files you should create/modify):
- `packages/api/src/features/resume/service.test.ts` (create)
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch):
- `packages/api/src/features/resume/service.ts` — this plan adds tests that
  characterize its *current* behavior. Do not "fix" anything you find here,
  even the silent `if (!resume) return;` no-ops in `setLocked`/`setPassword`/
  `removePassword` — those are Plan 003's job, and this test must assert the
  current silent-return behavior so Plan 003's change is visible as a test diff.
- Any router file (`crud.ts`, `sharing.ts`) — router tests are a separate
  future effort.
- The real database or migrations — this is a pure unit test with a mocked db.

## Git workflow

- Branch: `advisor/001-resume-service-tests`
- Commit style: conventional commits (repo uses them — e.g.
  `test(api): add characterization tests for resume service`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Scaffold the test file and mocks

Create `packages/api/src/features/resume/service.test.ts`. Copy the mock
scaffolding pattern from `applications/service.test.ts` (lines 1–68). Read the
top-of-file imports in `service.ts` and add a `vi.mock(...)` for every module
it imports that touches I/O (db, schema, drizzle-orm, bcryptjs, storage
service, and the patch/snapshot/notify helpers). Stub `@reactive-resume/db/schema`
with the table/column objects the service references (`resume`,
`resumeStatistics`, `resumeStatisticsDaily`, `user`).

**Verify**: `pnpm --filter @reactive-resume/api test -- resume/service.test.ts`
→ the file is picked up (even with zero real tests it should not error on
import; add one `it("imports", () => expect(resumeService).toBeDefined())` to
confirm wiring). Expected: 1 passing test.

### Step 2: Characterize `update`

Add a `describe("update")` block with these cases, asserting **current**
behavior:
- Throws `RESUME_LOCKED` when the pre-read returns `{ isLocked: true }`.
- Returns the updated row on success (script `db.update().set().where().returning()`
  to resolve `[{ id, name, slug, ... }]`).
- Throws `NOT_FOUND` when the `RETURNING` resolves to `[]` (no row matched).
- Maps a thrown error whose `cause.constraint === "resume_slug_user_id_unique"`
  to `RESUME_SLUG_ALREADY_EXISTS`.

**Verify**: `pnpm --filter @reactive-resume/api test -- resume/service.test.ts`
→ all cases pass.

### Step 3: Characterize `setLocked`, `setPassword`, `removePassword`

Add a `describe` for each. For every method assert **both** paths:
- Success path: `RETURNING` resolves to `[{ id, updatedAt }]` → the method
  resolves (returns `undefined`) and `notifyResumeUpdated` was called once with
  the expected `mutation` value (`"lock"` / `"password"`).
- **Not-found path: `RETURNING` resolves to `[]` → the method resolves
  `undefined` and `notifyResumeUpdated` is NOT called** (this pins the current
  silent no-op; Plan 003 will flip this to throwing `NOT_FOUND`).
- For `setPassword`, assert `hash` (mocked bcrypt) was called with the input
  password before the update.

**Verify**: `pnpm --filter @reactive-resume/api test -- resume/service.test.ts`
→ all pass.

### Step 4: Characterize `verifyPassword` and `delete`

- `verifyPassword`: throws `INVALID_PASSWORD` when no matching row; throws
  `INVALID_PASSWORD` when `compare` (mocked) returns `false`; returns `true`
  and calls `grantResumeAccess` when `compare` returns `true`.
- `delete`: script the transaction mock (see how `applications/service.test.ts`
  handles `db.transaction` — if it doesn't, make `dbMock.transaction` invoke
  its callback with a `tx` object exposing the same `select`/`delete` chain).
  Assert `NOT_FOUND` when the row is missing, `RESUME_LOCKED` when locked, and
  storage `delete` called for both screenshot and pdf keys on success.

**Verify**: `pnpm --filter @reactive-resume/api test -- resume/service.test.ts`
→ all pass.

### Step 5: Characterize `statistics.increment`

Assert that a `views: true` call runs `db.transaction`, and inside it inserts
into both `resumeStatistics` and `resumeStatisticsDaily` with an
`onConflictDoUpdate`. You do not need to assert SQL text — assert that both
`tx.insert(...)` calls happen (spy on the tx insert). This case is the safety
net for Plan 005, which changes when `increment` is *called* (not its body).

**Verify**: `pnpm --filter @reactive-resume/api test` → the whole api package
test suite passes (no regressions in sibling tests from your new mocks).

## Test plan

- New file: `packages/api/src/features/resume/service.test.ts`, structured as
  one `describe` per method, following `applications/service.test.ts` as the
  structural pattern.
- Cases per method are listed in Steps 2–5 (happy path + each error/edge branch
  the code contains today).
- Verification: `pnpm --filter @reactive-resume/api test` → all pass, including
  the new tests. Count the new tests in the output; expect ≥ 14 new cases.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `packages/api/src/features/resume/service.test.ts` exists
- [ ] `pnpm --filter @reactive-resume/api test -- resume/service.test.ts` exits 0 with ≥ 14 passing cases
- [ ] `pnpm --filter @reactive-resume/api test` exits 0 (no sibling regressions)
- [ ] `pnpm --filter @reactive-resume/api typecheck` exits 0
- [ ] `git status --porcelain` shows only `service.test.ts` (new) and `plans/README.md` modified
- [ ] `plans/README.md` status row for 001 updated to DONE

## STOP conditions

Stop and report back (do not improvise) if:

- `service.ts` has drifted from the excerpts above (method line ranges or error
  codes differ materially) — the codebase changed since this plan was written.
- The mocking approach fights the service: e.g. the service imports something
  that runs real I/O at module load and can't be cleanly mocked. Report what
  and where; do not weaken the test into a no-op.
- You find a genuine bug while characterizing (behavior that looks wrong). Do
  NOT fix it here — write the test to capture current behavior, add a
  `// NOTE: characterizes current behavior; see finding` comment, and report it.

## Maintenance notes

- Plan 003 changes `setLocked`/`setPassword`/`removePassword` to throw
  `NOT_FOUND` instead of silently returning. When that lands, the "not-found
  path" assertions from Step 3 must be updated in the same PR — that test diff
  is the intended signal that behavior changed on purpose.
- Plan 005 changes the *caller* of `statistics.increment` (dedup), not its body,
  so Step 5's test should keep passing; if it breaks, 005 changed more than
  intended.
- A reviewer should check the mocks assert real branching, not tautologies
  (e.g. that `NOT_FOUND` comes from an empty `RETURNING`, not from a mock that
  always throws).
