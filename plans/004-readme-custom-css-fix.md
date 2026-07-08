# Plan 004: Correct the README "Custom CSS" feature claim

> **Executor instructions**: Follow step by step. Confirm each verification.
> Honor "STOP conditions". When done, update the status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 73daf22b2..HEAD -- README.md`
> If `README.md` changed, re-locate the line described below before editing.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `73daf22b2`, 2026-07-08

## Why this matters

The README advertises a feature that no longer exists. Raw custom CSS was
removed and replaced by a structured Style Rules system — a decision recorded
in `docs/adr/0002-structured-style-rules-for-react-pdf.md` (React PDF accepts
style objects, not arbitrary browser selectors, so user CSS would be a
misleading contract). A user reading the README expects a CSS code editor and
instead finds structured form controls. Fixing the line keeps the public
feature list truthful and consistent with the ADR.

## Current state

- `README.md:63` — under the **Templates** feature list:

  ```
  - Custom CSS for advanced styling
  ```

- `docs/adr/0002-structured-style-rules-for-react-pdf.md` — states raw CSS is
  intentionally out; appearance customization is modeled as structured Style
  Rules targeting semantic section/rich-text slots.

- The actual UI lives at
  `apps/web/src/routes/builder/$resumeId/-sidebar/right/sections/custom-styles.tsx`
  (structured controls: color pickers, number inputs, dropdowns — not a CSS
  editor). You do not need to modify it; it is cited only to confirm the fix
  wording matches reality.

## Commands you will need

| Purpose        | Command                              | Expected            |
|----------------|--------------------------------------|---------------------|
| Locate line    | `grep -n "Custom CSS" README.md`     | one match (~line 63)|
| Docs lint (opt)| `pnpm lint:docs`                     | exit 0              |

(Do NOT run `pnpm check` — it rewrites files. This is a one-line docs edit.)

## Scope

**In scope**:
- `README.md` (the single feature-list line)
- `plans/README.md` (status row)

**Out of scope**:
- The Style Rules implementation or ADR.
- Any other README line, unless the drift check shows the feature list moved.
- The Mintlify docs under `docs/` — a separate concern.

## Git workflow

- Branch: `advisor/004-readme-custom-css`
- Commit: `docs: correct README custom-CSS claim to Style Rules`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Replace the line

Change `README.md:63` from:

```
- Custom CSS for advanced styling
```

to:

```
- Structured Style Rules for section and text styling
```

Match the surrounding list's capitalization and punctuation (no trailing
period — the sibling bullets have none).

**Verify**: `grep -n "Custom CSS" README.md` → **no** matches;
`grep -n "Structured Style Rules" README.md` → one match.

## Test plan

No code tests. Optional: `pnpm lint:docs` → exit 0 (markdownlint clean).

## Done criteria

- [ ] `grep -n "Custom CSS" README.md` returns no matches
- [ ] `grep -n "Style Rules" README.md` returns the new line
- [ ] `git status --porcelain` lists only `README.md` and `plans/README.md`
- [ ] `plans/README.md` status row for 004 updated

## STOP conditions

Stop and report if:

- The "Custom CSS" line is already gone or already reworded (someone fixed it).
- The drift check shows the Templates feature list was substantially
  restructured — re-locate the correct line before editing.

## Maintenance notes

- If Style Rules ever gains a raw-CSS escape hatch (ADR 0002 lists it as
  possible future work), revisit this line.
