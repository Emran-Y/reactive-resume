# Plan 003: Fix silent-success mutations and bound bulk-operation inputs

> **Executor instructions**: Follow step by step. Run every verification
> command and confirm the expected result before moving on. Honor "STOP
> conditions". When done, update the status row in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 73daf22b2..HEAD -- packages/api/src/features/resume/service.ts packages/api/src/dto/application.ts packages/api/src/features/applications/service.ts`
> If any changed since this plan was written, compare "Current state" excerpts
> against live code; on mismatch, STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 001 (its Step 3 tests characterize the current silent-return
  behavior this plan changes — update them here). Not a hard blocker, but if
  001 is DONE you must update its assertions in the same PR.
- **Category**: bug
- **Planned at**: commit `73daf22b2`, 2026-07-08

## Why this matters

Two small, independent correctness/robustness fixes on the API layer:

1. **Silent-success mutations.** `setLocked`, `setPassword`, and
   `removePassword` in `packages/api/src/features/resume/service.ts` run an
   `UPDATE ... WHERE id = ? AND userId = ? RETURNING`, and when no row matches
   they do `if (!resume) return;` — returning HTTP 200 success. Every other
   mutation in this file (`update`, `delete`) throws `ORPCError("NOT_FOUND")` in
   the same situation. The inconsistency means a client calling these on a
   resume that doesn't exist (or isn't theirs) is told it succeeded, so the UI
   updates its state as if the lock/password change took effect. Ownership is
   still enforced (the `WHERE` includes `userId`), so this is not an auth
   bypass — it's a misleading false-success that hides not-found/not-owned.

2. **Unbounded bulk inputs.** `bulkUpdate` and `bulkDelete` DTOs in
   `packages/api/src/dto/application.ts` accept `ids: z.array(z.string()).min(1)`
   with **no `.max()`**. `bulkDelete`'s service loads all target rows into
   memory before deleting. A single API call with a very large `ids` array is
   unbounded memory/DB work. A `.max()` cap is a one-line defensive fix.

## Current state

### Part A — silent-success (resume/service.ts)

`setLocked` (~663–679), `setPassword` (~681–699), `removePassword` (~726–742)
each look like this (setLocked shown; the other two differ only in the `.set`
and the `mutation` label):

```ts
setLocked: async (input: { id: string; userId: string; isLocked: boolean }) => {
  const [resume] = await db
    .update(schema.resume)
    .set({ isLocked: input.isLocked })
    .where(and(eq(schema.resume.id, input.id), eq(schema.resume.userId, input.userId)))
    .returning({ id: schema.resume.id, updatedAt: schema.resume.updatedAt });

  if (!resume) return;   // <-- silent no-op; should throw NOT_FOUND

  await notifyResumeUpdated({ /* ... mutation: "lock" ... */ });
},
```

The reference behavior to match is `update` (~603) and `delete` (~751):
`if (!resume) throw new ORPCError("NOT_FOUND");`. `ORPCError` is already imported
at the top of `service.ts` (used throughout).

The routers that call these (for context; **do not change them**):
- `crud.ts:187` `setLocked` — `protectedProcedure`, does not currently declare a
  `NOT_FOUND` error in `.errors({...})`.
- `sharing.ts:29` `setPassword`, `sharing.ts:80` `removePassword` — likewise.

oRPC will surface a thrown `ORPCError("NOT_FOUND")` as a 404 regardless of
whether it's declared in `.errors()`, matching how `update`/`delete` already
behave (they throw the same without special router declarations). So no router
change is required.

### Part B — unbounded bulk inputs (dto/application.ts)

`packages/api/src/dto/application.ts:163-176`:

```ts
bulkUpdate: {
  input: z.object({
    ids: z.array(z.string()).min(1),
    status: applicationStatusSchema.optional(),
    archived: z.boolean().optional(),
    addTags: z.array(z.string()).optional(),
  }),
  output: z.object({ updated: z.number() }),
},

bulkDelete: {
  input: z.object({ ids: z.array(z.string()).min(1) }),
  output: z.object({ deleted: z.number() }),
},
```

The consuming service is `packages/api/src/features/applications/service.ts`
(`bulkUpdate` ~340–381, `bulkDelete` ~383–396; `bulkDelete` fetches all target
rows into memory before deleting).

## Commands you will need

| Purpose   | Command                                                                 | Expected           |
|-----------|-------------------------------------------------------------------------|--------------------|
| Typecheck | `pnpm --filter @reactive-resume/api typecheck`                          | exit 0             |
| Test A    | `pnpm --filter @reactive-resume/api test -- resume/service.test.ts`     | all pass           |
| Test B    | `pnpm --filter @reactive-resume/api test -- applications`               | all pass           |
| All api   | `pnpm --filter @reactive-resume/api test`                               | all pass           |

(Do NOT run `pnpm check`.)

## Scope

**In scope**:
- `packages/api/src/features/resume/service.ts` (Part A)
- `packages/api/src/features/resume/service.test.ts` (update if 001 is DONE; else
  the tests may not exist yet — see Step 3)
- `packages/api/src/dto/application.ts` (Part B)
- `packages/api/src/dto/application.test.ts` if one exists, else add a focused
  test near the applications service tests (Step 4)
- `plans/README.md` (status row)

**Out of scope**:
- `crud.ts` / `sharing.ts` routers — no change needed (see Current state).
- The applications service body — a `.max()` on input is sufficient; do not
  also rewrite the in-memory `bulkDelete` scan in this plan (that's a separate
  perf concern tracked elsewhere).
- Any other service method.

## Git workflow

- Branch: `advisor/003-api-quick-fixes`
- Commit style: conventional commits, e.g.
  `fix(api): throw NOT_FOUND on lock/password mutations for missing resume` and
  `fix(api): cap bulk application operation id arrays`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Throw NOT_FOUND in the three mutations

In `resume/service.ts`, change `if (!resume) return;` to
`if (!resume) throw new ORPCError("NOT_FOUND");` in **all three** of `setLocked`,
`setPassword`, `removePassword`. Match the exact form used by `update`/`delete`
in the same file.

**Verify**: `pnpm --filter @reactive-resume/api typecheck` → exit 0.

### Step 2: Cap the bulk id arrays

In `dto/application.ts`, add `.max(200, "Too many items in a single bulk
operation")` to the `ids` array in **both** `bulkUpdate` and `bulkDelete`
inputs (i.e. `z.array(z.string()).min(1).max(200)`). 200 comfortably exceeds
the UI's page size (~25) while bounding abuse; if a comment nearby documents a
different intended cap, use that number and note it.

**Verify**: `pnpm --filter @reactive-resume/api typecheck` → exit 0.

### Step 3: Update / add tests for Part A

- If Plan 001 is DONE (`resume/service.test.ts` exists): update its `setLocked`
  / `setPassword` / `removePassword` "not-found path" cases to now assert the
  method **rejects with `NOT_FOUND`** (previously they asserted a silent
  resolve). This test diff is the intended proof the behavior changed.
- If Plan 001 is NOT done (no test file): add a minimal
  `resume/service.test.ts` covering just these three methods' not-found →
  `NOT_FOUND` behavior and success path, using
  `packages/api/src/features/applications/service.test.ts` as the mock pattern.

**Verify**: `pnpm --filter @reactive-resume/api test -- resume/service.test.ts`
→ all pass; the three not-found cases assert `NOT_FOUND`.

### Step 4: Test for Part B

Add a small test that `bulkUpdate`/`bulkDelete` input schemas reject an `ids`
array longer than the cap and accept one at the cap. If
`packages/api/src/dto/application.test.ts` exists, add there; otherwise create
it. Example shape:

```ts
import { describe, expect, it } from "vitest";
import { applicationDto } from "./application"; // confirm the real export name

it("rejects oversized bulk id arrays", () => {
  const ids = Array.from({ length: 201 }, (_, i) => String(i));
  expect(applicationDto.bulkDelete.input.safeParse({ ids }).success).toBe(false);
});
```

Confirm the actual export name/shape by reading the top and bottom of
`dto/application.ts` before writing the import.

**Verify**: `pnpm --filter @reactive-resume/api test -- applications` and
`pnpm --filter @reactive-resume/api test` → all pass.

## Test plan

- Part A: three methods now reject with `NOT_FOUND` on no-match (updated or new
  cases in `resume/service.test.ts`).
- Part B: bulk input schemas reject arrays over the cap, accept at the cap.
- Verification: `pnpm --filter @reactive-resume/api test` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n "if (!resume) return;" packages/api/src/features/resume/service.ts` returns **no** matches
- [ ] `grep -c "throw new ORPCError(\"NOT_FOUND\")" packages/api/src/features/resume/service.ts` is ≥ 5 (update, delete, + the 3 new)
- [ ] `grep -n ".max(" packages/api/src/dto/application.ts` shows the cap on both bulk inputs
- [ ] `pnpm --filter @reactive-resume/api typecheck` exits 0
- [ ] `pnpm --filter @reactive-resume/api test` exits 0
- [ ] `git status --porcelain` lists only in-scope files + `plans/README.md`
- [ ] `plans/README.md` status row for 003 updated

## STOP conditions

Stop and report if:

- The three methods no longer contain `if (!resume) return;` (already fixed by
  someone else, or drifted) — reconcile against live code before editing.
- Throwing `NOT_FOUND` breaks an e2e or unit test that *depended on* the silent
  success (a client that fires these against unknown ids and expects 200) —
  report the caller; do not revert the fix without confirming intent.
- The applications DTO export name differs from `applicationDto` — read the file
  and use the real name; do not guess.

## Maintenance notes

- The `.max(200)` cap is an input guard, not a fix for `bulkDelete`'s O(n)
  in-memory scan — that remains a known, separate perf item. If bulk operations
  ever need to exceed the cap, revisit both the cap and the scan together.
- If the routers later add explicit `.errors({ NOT_FOUND: ... })` declarations
  for these procedures (for nicer OpenAPI docs), that's compatible with this
  change but not required by it.
