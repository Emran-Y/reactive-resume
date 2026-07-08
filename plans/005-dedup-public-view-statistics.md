# Plan 005: Deduplicate public-resume view-count writes

> **Executor instructions**: Follow step by step. Run every verification and
> confirm before moving on. Honor "STOP conditions". When done, update the
> status row in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 73daf22b2..HEAD -- packages/api/src/features/resume/service.ts packages/api/src/features/resume/access-policy.ts`
> If either changed since this plan, compare "Current state" excerpts against
> live code; on mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: 001 recommended (its Step 5 test characterizes
  `statistics.increment`, giving you a safety net that this plan changes the
  *caller*, not the write body).
- **Category**: perf
- **Planned at**: commit `73daf22b2`, 2026-07-08

## Why this matters

Every public-resume view triggers a database write. `getBySlug`
(`packages/api/src/features/resume/service.ts:475`) calls
`statistics.increment(...)` whenever `shouldCountForStatistics` is true, and
`increment` (lines 199–237) runs a transaction with **two** `INSERT ... ON
CONFLICT DO UPDATE` statements (`resumeStatistics` + `resumeStatisticsDaily`).
This fires on every non-owner load — bots, crawlers, and refreshes included.
TanStack Query's 60s `staleTime` only suppresses within-session refetches; it
does nothing for distinct sessions or server-side crawlers. A popular public
resume therefore drives continuous write traffic to two tables for what is
functionally the same view counted many times.

This plan adds a short-window per-viewer dedup so a burst of views from the
same client within a window counts once, cutting write volume without changing
what the counters mean to users (roughly "unique-ish views per window").

## Current state

- `packages/api/src/features/resume/service.ts:475` — `getBySlug` receives
  `input.requestHeaders: Headers`, resolves the resume, and at lines 505–507:

  ```ts
  if (shouldCountForStatistics(resume, viewer)) {
    await resumeService.statistics.increment({ id: resume.id, views: true });
  }
  ```

- `packages/api/src/features/resume/access-policy.ts:76` —
  `shouldCountForStatistics(resume, viewer)` decides *whether* a view counts
  (e.g. skip the owner). This plan adds an orthogonal *"have we already counted
  this viewer recently?"* gate; it does **not** change `shouldCountForStatistics`.

- `increment` (`service.ts:199-237`) — the two-table transactional write. **Do
  not change its body**; this plan changes only whether it is called.

- **Reusable client-identity helper**: `packages/utils/src/rate-limit.ts`
  exports `TRUSTED_IP_HEADERS` (the ordered list of proxy IP headers the app
  trusts). The rate-limit middleware already derives a client key from these
  headers the same way. Reuse `TRUSTED_IP_HEADERS` to read the viewer IP from
  `input.requestHeaders`; fall back to a `user-agent`-based key when no trusted
  IP header is present (mirror the middleware's fallback so behavior is
  consistent).

- **Environment**: `REDIS_URL` exists in `packages/env/src/server.ts` and
  `turbo.json` globalEnv, but the app runs as a single Node process by default
  and the existing rate limiter uses an **in-memory** store
  (`@orpc/experimental-ratelimit/memory`). Match that: an in-memory TTL cache
  is the right default here.

## Commands you will need

| Purpose   | Command                                                             | Expected  |
|-----------|--------------------------------------------------------------------|-----------|
| Typecheck | `pnpm --filter @reactive-resume/api typecheck`                     | exit 0    |
| Test      | `pnpm --filter @reactive-resume/api test -- resume`                | all pass  |
| All api   | `pnpm --filter @reactive-resume/api test`                          | all pass  |

(Do NOT run `pnpm check`.)

## Scope

**In scope**:
- A new small helper module, e.g.
  `packages/api/src/features/resume/view-dedup.ts` (create) — an in-memory
  TTL set keyed by `${resumeId}:${clientKey}` with a `shouldCountView(...)`
  function that returns `true` at most once per key per window.
- `packages/api/src/features/resume/view-dedup.test.ts` (create)
- `packages/api/src/features/resume/service.ts` — gate the `increment` call
  (lines 505–507) on the new helper.
- `plans/README.md` (status row)

**Out of scope**:
- `increment`'s write body and the DB schema — unchanged.
- `shouldCountForStatistics` in `access-policy.ts` — unchanged.
- Any Redis / distributed-cache implementation — an in-memory window is the
  agreed default; a distributed store is a documented future upgrade, not this
  plan.
- Download counting (`downloads: true`) — this plan is about view writes only;
  do not alter download increments.

## Git workflow

- Branch: `advisor/005-stats-view-dedup`
- Commit: `perf(api): dedup public-resume view increments within a short window`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Write the dedup helper

Create `view-dedup.ts` exporting a pure-ish, testable function. Suggested
shape (keep it small — this is not a cache library):

```ts
// ponytail: in-memory per-process dedup window. Single-instance is the default
// deploy; for multi-instance, swap the Map for a Redis SETNX+EXPIRE keyed the
// same way (REDIS_URL already exists in env). Upgrade only if you scale out.
const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const seen = new Map<string, number>(); // key -> expiry timestamp

export function shouldCountView(key: string, now: number): boolean {
  const expiry = seen.get(key);
  if (expiry !== undefined && expiry > now) return false;
  seen.set(key, now + WINDOW_MS);
  return true;
}

export function clientKeyFromHeaders(headers: Headers): string { /* uses TRUSTED_IP_HEADERS, UA fallback */ }
```

Take `now` as a parameter (don't call `Date.now()` inside the predicate) so the
test can drive the clock deterministically. Add a lightweight size guard: if
`seen.size` exceeds a cap (e.g. 50_000), prune entries whose expiry has passed
before inserting, so the Map can't grow unbounded. Reuse `TRUSTED_IP_HEADERS`
from `@reactive-resume/utils/rate-limit` inside `clientKeyFromHeaders`.

**Verify**: `pnpm --filter @reactive-resume/api typecheck` → exit 0.

### Step 2: Test the helper

Create `view-dedup.test.ts`:
- `shouldCountView(key, t)` returns `true` the first time, `false` for the same
  key within the window, and `true` again once `now` is past the window.
- Two different keys are independent.
- `clientKeyFromHeaders` derives distinct keys for distinct trusted-IP headers
  and a stable key for the UA fallback when no IP header is present.

**Verify**: `pnpm --filter @reactive-resume/api test -- view-dedup` → all pass.

### Step 3: Gate the increment call

In `service.ts` `getBySlug`, wrap the existing count so it fires only when both
the policy allows it AND the viewer hasn't been counted this window:

```ts
if (shouldCountForStatistics(resume, viewer)) {
  const key = `${resume.id}:${clientKeyFromHeaders(input.requestHeaders)}`;
  if (shouldCountView(key, Date.now())) {
    await resumeService.statistics.increment({ id: resume.id, views: true });
  }
}
```

Do not change anything else in `getBySlug`.

**Verify**: `pnpm --filter @reactive-resume/api typecheck` → exit 0.

### Step 4: Confirm no regression in existing resume tests

**Verify**: `pnpm --filter @reactive-resume/api test -- resume` → all pass. In
particular, if Plan 001's `statistics.increment` characterization test exists,
it should still pass (this plan didn't touch `increment`'s body). If a
`getBySlug` test asserts increment-on-view, it may now need the test to pass a
fresh header/clock so the first view still counts — update it to reflect the
dedup (first view counts, immediate repeat does not).

## Test plan

- `view-dedup.test.ts`: window behavior + key derivation (Step 2 cases).
- If an existing `getBySlug` test asserts view counting, extend it: first call
  with a given client key increments; an immediate second call with the same
  key does not; a call with a different key does.
- Verification: `pnpm --filter @reactive-resume/api test` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `packages/api/src/features/resume/view-dedup.ts` and its `.test.ts` exist
- [ ] `pnpm --filter @reactive-resume/api test -- view-dedup` passes with ≥ 4 cases
- [ ] `grep -n "shouldCountView" packages/api/src/features/resume/service.ts` shows the gate around the increment call
- [ ] `pnpm --filter @reactive-resume/api typecheck` exits 0
- [ ] `pnpm --filter @reactive-resume/api test` exits 0
- [ ] `git status --porcelain` lists only in-scope files + `plans/README.md`
- [ ] `plans/README.md` status row for 005 updated

## STOP conditions

Stop and report if:

- `getBySlug` no longer calls `statistics.increment` at lines ~505–507, or its
  signature no longer exposes `requestHeaders` — the code drifted.
- You cannot derive a client key from `input.requestHeaders` because headers
  aren't actually populated at this layer in practice (check a real request
  path / existing rate-limit middleware usage) — report it; a dedup keyed on an
  empty header is worthless.
- You find that view counting must remain exact (product decision that every
  raw hit counts) — the dedup changes counter semantics slightly; if unsure,
  stop and confirm before shipping.

## Maintenance notes

- **Semantics change**: counters become "unique-ish views per 1h window per
  client" rather than "raw hits". Document this near the helper. If the product
  wants raw hit counts back, this gate is the single place to remove.
- **Multi-instance ceiling**: the in-memory Map is per-process. If the app is
  ever horizontally scaled, each instance dedups independently (still a large
  reduction, but not global). The ponytail comment names Redis as the upgrade
  path; do it only if scale-out happens.
- Reviewer should confirm `Date.now()` is only called at the call site (Step 3),
  not inside the predicate, so the helper stays testable.
