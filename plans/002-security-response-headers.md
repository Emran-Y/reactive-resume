# Plan 002: Add CSP + framing headers to web pages; gate the uploads CORS header

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report. When done, update the
> status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 73daf22b2..HEAD -- apps/server/src/static/web.ts apps/server/src/static/uploads.ts`
> If either file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on mismatch, STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `73daf22b2`, 2026-07-08

## Why this matters

The Hono server serves every HTML page (public resumes, the auth/dashboard/
builder shells) through `handleWebApp` in `apps/server/src/static/web.ts`, and
that response sets only `Content-Type` and (sometimes) `X-Robots-Tag`. There is
**no `Content-Security-Policy` and no `X-Frame-Options`**. Consequences:
- Any page can be framed by an attacker's site → clickjacking against
  authenticated actions and public resume views.
- No script-source restriction → a single injected-content bug becomes a much
  larger XSS blast radius than it needs to be.

Separately, the file-serving endpoint in `apps/server/src/static/uploads.ts`
sets `Access-Control-Allow-Origin: env.APP_URL` **unconditionally** on a GET
endpoint whose only real consumers are same-origin. `Cross-Origin-Resource-Policy:
same-site` is already set, so the ACAO header adds cross-origin exposure for no
functional benefit.

This plan adds the missing headers to web responses and removes the
unnecessary ACAO header. It is deliberately conservative: **CSP ships in
report-only mode first** so it cannot break the app on rollout.

## Current state

- `apps/server/src/static/web.ts:55-65` — `getFallbackResponseHeaders` returns
  a plain object of headers per path (or `null` for a 404):

  ```ts
  function getFallbackResponseHeaders(pathname: string) {
    if (pathname === "/") return { "Content-Type": "text/html; charset=UTF-8" };
    if (isNoindexShellPath(pathname) || isPublicResumePath(pathname)) {
      return {
        "Content-Type": "text/html; charset=UTF-8",
        "X-Robots-Tag": "noindex, follow",
      };
    }
    return null;
  }
  ```

  These objects are spread into the `Response` at `web.ts:86-92` (both the HEAD
  `new Response(null, { status: 200, headers })` path and the GET
  `new Response(html, { headers })` path).

- `apps/server/src/static/uploads.ts:28-46` — the file response already sets a
  strong header set as a model to follow, and ends with the ACAO line to remove:

  ```ts
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("ETag", etag);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  headers.set("Cross-Origin-Resource-Policy", "same-site");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Download-Options", "noopen");
  headers.set("Access-Control-Allow-Origin", env.APP_URL);  // <-- remove this line
  ```

- **Existing test files that assert headers** (follow their style, they are
  your regression net):
  - `apps/server/src/static/web.test.ts`
  - `apps/server/src/static/uploads.test.ts`

- **Design constraint** — the app has no known legitimate need to be iframed,
  and the builder preview is a same-origin pdf.js canvas (not a cross-origin
  frame). So `X-Frame-Options: DENY` is safe. The app does load web fonts and
  images from same origin and inline styles/scripts from the Vite bundle, which
  is why CSP starts **report-only**: do not enforce a policy you have not
  observed the app satisfy.

## Commands you will need

| Purpose   | Command                                | Expected on success |
|-----------|----------------------------------------|---------------------|
| Typecheck | `pnpm --filter server typecheck`       | exit 0              |
| Test      | `pnpm --filter server test -- static`  | all pass            |

(The server package is named `server` in `apps/server/package.json`, not
`@reactive-resume/server`.)

(Do NOT run `pnpm check`.)

## Scope

**In scope**:
- `apps/server/src/static/web.ts`
- `apps/server/src/static/web.test.ts`
- `apps/server/src/static/uploads.ts`
- `apps/server/src/static/uploads.test.ts`
- `plans/README.md` (status row)

**Out of scope** (do NOT touch):
- The oRPC / auth / MCP / OpenAPI handlers — they return API responses, not
  HTML pages; header policy for those is a separate concern.
- Enforcing (non-report-only) CSP — an enforced policy requires collecting
  violation reports first; that is explicit follow-up, not this plan.
- Any web-app (`apps/web`) source — headers are set at the server layer.

## Git workflow

- Branch: `advisor/002-security-headers`
- Commit style: conventional commits, e.g.
  `feat(server): add CSP report-only and framing headers to web responses`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add framing + hardening headers to web responses

In `apps/server/src/static/web.ts`, extend the header objects returned by
`getFallbackResponseHeaders` so that every non-null branch (the `/` branch and
the noindex/public branch) also includes:

```
"X-Frame-Options": "DENY",
"X-Content-Type-Options": "nosniff",
"Referrer-Policy": "strict-origin-when-cross-origin",
```

Keep the existing `Content-Type` and `X-Robots-Tag` values unchanged. Prefer
adding a small shared constant (e.g. `const BASE_SECURITY_HEADERS = { ... }`)
and spreading it into both branches, so the two paths cannot drift.

**Verify**: `pnpm --filter @reactive-resume/server typecheck` → exit 0.

### Step 2: Add a report-only CSP header to web responses

Add to the same shared header set:

```
"Content-Security-Policy-Report-Only":
  "default-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
```

Use `Report-Only` (not the enforcing header) so nothing breaks on rollout.
`'unsafe-inline'` for style/script is intentional for the first pass — the Vite
bundle and inline theme script need it; tightening to nonces is future work.
`frame-ancestors 'none'` is the CSP-level equivalent of `X-Frame-Options: DENY`.

**Verify**: `pnpm --filter @reactive-resume/server typecheck` → exit 0.

### Step 3: Remove the unconditional CORS header from uploads

In `apps/server/src/static/uploads.ts`, delete the line:

```ts
headers.set("Access-Control-Allow-Origin", env.APP_URL);
```

Leave every other header untouched. If, after removal, `env` is no longer
referenced anywhere in the file, remove its now-unused import (check with the
grep in Done criteria); if `env` is still used, keep the import.

**Verify**: `pnpm --filter @reactive-resume/server typecheck` → exit 0
(no unused-import or undefined-symbol errors).

### Step 4: Update/extend tests

- In `web.test.ts`: add assertions that a GET to `/` and to a public resume
  path returns `X-Frame-Options: DENY` and a `Content-Security-Policy-Report-Only`
  header. Follow the existing test's request/response style in that file.
- In `uploads.test.ts`: if an existing test asserts the presence of
  `Access-Control-Allow-Origin`, change it to assert the header is **absent**
  (`response.headers.get("Access-Control-Allow-Origin")` is `null`). Keep the
  assertions for `Cross-Origin-Resource-Policy` and the others.

**Verify**: `pnpm --filter @reactive-resume/server test -- static` → all pass.

## Test plan

- Extend `web.test.ts` with two cases: `/` and a public-resume path each carry
  the new framing + CSP-report-only headers.
- Update `uploads.test.ts` so the ACAO header is asserted absent (and the other
  security headers still present).
- Verification: `pnpm --filter @reactive-resume/server test -- static` → all
  pass, including the new/updated assertions.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm --filter @reactive-resume/server typecheck` exits 0
- [ ] `pnpm --filter @reactive-resume/server test -- static` exits 0
- [ ] `grep -n "X-Frame-Options" apps/server/src/static/web.ts` returns a match
- [ ] `grep -n "Content-Security-Policy-Report-Only" apps/server/src/static/web.ts` returns a match
- [ ] `grep -n "Access-Control-Allow-Origin" apps/server/src/static/uploads.ts` returns **no** matches
- [ ] `git status --porcelain` lists only the four in-scope source/test files and `plans/README.md`
- [ ] `plans/README.md` status row for 002 updated

## STOP conditions

Stop and report back if:

- `web.ts`/`uploads.ts` have drifted from the excerpts above.
- Removing the ACAO header breaks an existing test that documents a *legitimate*
  cross-origin consumer of `/uploads/*` you were unaware of (read the test's
  intent before assuming it's stale) — report it instead of forcing the change.
- You are tempted to ship an **enforcing** CSP (not report-only) — that is out
  of scope and can break the app; stop and confirm.

## Maintenance notes

- The CSP is report-only. Follow-up (separate plan): wire a report endpoint or
  read browser console CSP reports, confirm the app fully satisfies the policy,
  then promote `Content-Security-Policy-Report-Only` → `Content-Security-Policy`
  and drop `'unsafe-inline'` in favor of nonces where feasible.
- If a future feature legitimately needs the app embeddable (e.g. an official
  embed widget), `frame-ancestors`/`X-Frame-Options` must be relaxed for that
  route only, not globally.
- Reviewer should confirm the header set is shared between both `web.ts`
  branches (no drift) and that no API/JSON responses accidentally inherit the
  HTML CSP.
