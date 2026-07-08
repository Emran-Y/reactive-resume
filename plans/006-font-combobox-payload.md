# Plan 006: Stop re-mapping the font list per combobox instance; defer the font-metadata payload

> **Executor instructions**: Follow step by step. Confirm each verification.
> Honor "STOP conditions". When done, update the status row in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 73daf22b2..HEAD -- apps/web/src/components/typography/combobox.tsx apps/web/src/routes/builder/$resumeId/-sidebar/right/sections/typography.tsx packages/fonts/src/index.ts`
> If any changed, compare "Current state" excerpts against live code; on
> mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `73daf22b2`, 2026-07-08

## Why this matters

`packages/fonts/src/webfontlist.json` is a **476 KB** metadata file (7,526
lines). `packages/fonts/src/index.ts:7` imports it statically and derives
`fontList` (~506 entries). The typography combobox
(`apps/web/src/components/typography/combobox.tsx:11-24`) maps that full list
into option objects inside a `useMemo(..., [])` — which memoizes **per component
instance**, not globally. Two instances render (body + heading font pickers), so
the 506-entry map runs twice at mount for identical output.

Two honest, bounded improvements:
1. **Guaranteed win**: hoist the options mapping to module scope so it runs
   once per process regardless of instance count. Small but free and correct.
2. **Payload win (conditional)**: the font metadata only matters where the font
   picker renders (the builder typography panel). Deferring it keeps it out of
   any route/panel that never opens the picker — *if* the bundler isn't already
   forced to load it there for another reason (PDF font registration also
   consumes `@reactive-resume/fonts`). Step 3 measures before changing, and
   reports back rather than forcing a change that yields nothing.

Scope this realistically: #1 is certain; #2 is worth doing only if the build
shows the payload actually lands on a route that doesn't need it.

## Current state

- `apps/web/src/components/typography/combobox.tsx:1-27` — `FontFamilyCombobox`:

  ```ts
  import { fontList, getFont, getFontDisplayName, getFontSearchKeywords, sortFontWeights } from "@reactive-resume/fonts";
  // ...
  export function FontFamilyCombobox({ className, ...props }: FontFamilyComboboxProps) {
    const options = useMemo(() => {
      return fontList.map((font) => ({
        value: font.family,
        keywords: getFontSearchKeywords(font.family),
        label: <FontDisplay family={font.family} label={getFontDisplayName(font.family)} type={font.type}
                 url={"preview" in font ? font.preview : undefined} />,
      }));
    }, []);
    return <Combobox {...props} options={options} className={cn("w-full", className)} />;
  }
  ```

  The `label` is JSX (`<FontDisplay .../>`), so the mapped array holds React
  elements — hoisting must keep the elements' props static (they are: derived
  purely from `font`). Nothing in the map depends on component props.

- **Single usage site**:
  `apps/web/src/routes/builder/$resumeId/-sidebar/right/sections/typography.tsx:14`
  imports and renders `FontFamilyCombobox` (line ~106) and `FontWeightCombobox`
  (line ~133). No other file uses these components.

- `packages/fonts/src/index.ts` — statically imports `webfontlist.json` (line 7)
  and exports `fontList`, `getFont`, `getFontDisplayName`,
  `getFontSearchKeywords`, `sortFontWeights` (used by the combobox) plus
  registration helpers used by `packages/pdf`
  (`packages/pdf/src/hooks/use-register-fonts.ts`).

- Bundler note: TanStack Router has `autoCodeSplitting`; per prior analysis the
  font metadata resolves into the `pdf-document` chunk, not the main entry.
  This is exactly why Step 3 measures before assuming a payload win exists.

## Commands you will need

| Purpose         | Command                                           | Expected            |
|-----------------|---------------------------------------------------|---------------------|
| Typecheck (web) | `pnpm --filter web typecheck`                    | exit 0              |
| Web tests       | `pnpm --filter web test -- typography`           | all pass (or none)  |
| Build (Step 3)  | `pnpm --filter web build`                        | exit 0; chunk sizes printed |

(Do NOT run `pnpm check`.)

## Scope

**In scope**:
- `apps/web/src/components/typography/combobox.tsx`
- `apps/web/src/routes/builder/$resumeId/-sidebar/right/sections/typography.tsx`
  (only if Step 3 justifies lazy-loading)
- `plans/README.md` (status row)

**Out of scope**:
- `packages/fonts/*` — do not restructure the fonts package or change what
  `@reactive-resume/fonts` exports. The win here is on the web-app consumer side.
- `packages/pdf` font registration — unrelated consumer.
- The 476 KB JSON content itself.

## Git workflow

- Branch: `advisor/006-font-combobox`
- Commit: `perf(web): compute font-picker options once at module scope`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Hoist the font options to module scope

In `combobox.tsx`, move the `fontList.map(...)` computation out of the component
into a module-level constant (e.g. `const FONT_FAMILY_OPTIONS = fontList.map(...)`)
and pass that constant to `<Combobox options={FONT_FAMILY_OPTIONS} />`. Remove
the now-unnecessary `useMemo` for `FontFamilyCombobox` (its dep array is empty
and the value is now module-constant). Leave `FontWeightCombobox` unchanged —
its options depend on the `fontFamily` prop and must stay per-instance.

**Verify**: `pnpm --filter web typecheck` → exit 0.

### Step 2: Confirm the picker still renders

If a typography test exists, run it; otherwise this is verified by typecheck +
the build in Step 3. Ensure `FontDisplay` still receives the same props.

**Verify**: `pnpm --filter web test -- typography` → passes or reports no tests.

### Step 3: Measure, then decide on deferral (investigate — may end in a report)

Run `pnpm --filter web build` and note the chunk that contains the font
metadata (search the build output / `apps/web/dist/assets` for the large
chunk; the 476 KB JSON shows up as a ~400–500 KB contribution). Determine
whether that chunk loads on a route that does **not** need the font picker
(e.g. the dashboard or a public resume page).

- **If the font metadata already only loads with the PDF/preview chunk that the
  builder needs anyway** → deferring the combobox yields ~nothing. STOP and
  report this finding in `plans/README.md`'s status note; do not add lazy
  loading. Step 1 stands on its own as the deliverable.
- **If the font metadata loads on a route with no font picker** → wrap
  `FontFamilyCombobox`/`FontWeightCombobox` at the `typography.tsx` usage site in
  `React.lazy` + `Suspense` (import the combobox module via dynamic `import()`),
  so `@reactive-resume/fonts` is fetched only when the typography panel mounts.
  Keep the fallback minimal (the existing field skeleton or a small spinner).

**Verify**: `pnpm --filter web build` → exit 0; record the before/after chunk
observation in the PR description.

## Test plan

- Step 1 is behavior-preserving; typecheck + build are the gates.
- If Step 3 adds lazy loading, manually confirm (or via an existing e2e that
  opens the typography panel) that the font picker still populates.
- No new unit test is required for a pure hoist; if `typography.tsx` gains a
  Suspense boundary, ensure any existing builder e2e still passes.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n "FONT_FAMILY_OPTIONS\|const .*= fontList.map" apps/web/src/components/typography/combobox.tsx` shows a module-scope constant
- [ ] `FontFamilyCombobox` no longer wraps the family options in `useMemo`
- [ ] `pnpm --filter web typecheck` exits 0
- [ ] `pnpm --filter web build` exits 0
- [ ] `git status --porcelain` lists only in-scope files + `plans/README.md`
- [ ] `plans/README.md` status row for 006 updated (note whether Step 3 added
      lazy loading or reported it unnecessary)

## STOP conditions

Stop and report if:

- Hoisting breaks the `FontDisplay` label rendering (elements need per-instance
  data) — re-check; the current props are purely `font`-derived, so this should
  not happen. If it does, the component drifted.
- Step 3's measurement is ambiguous or the build doesn't surface chunk sizes —
  report what you observed rather than guessing; do not add lazy loading on a
  hunch.

## Maintenance notes

- This is the lowest-leverage item in the current batch; Step 1 is the sure
  thing. Do not over-engineer a fonts-package split — that has broad blast
  radius (PDF registration depends on the same exports) and isn't justified by
  the payload analysis.
- If the fonts list ever grows substantially or becomes user-configurable,
  revisit a proper lazy/virtualized font source.
