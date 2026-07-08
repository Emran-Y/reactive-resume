# Plan 007: Extract a shared template page-shell — spike + one-template pilot

> **Executor instructions**: This is a **spike + pilot**, not a 15-file
> rewrite. You will build a parity net, refactor exactly ONE template behind it,
> and then STOP and report. Do NOT migrate the other templates in this plan.
> Run every verification. Honor "STOP conditions". When done, update the status
> row in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 73daf22b2..HEAD -- packages/pdf/src/templates/`
> If the templates changed since this plan, compare "Current state" against
> live code before proceeding; on mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: 001 recommended as the characterization-testing exemplar/
  discipline (not a technical blocker — the PDF layer needs its own parity net,
  which is Step 1 here).
- **Category**: tech-debt
- **Planned at**: commit `73daf22b2`, 2026-07-08

## Why this matters

All 15 resume templates
(`packages/pdf/src/templates/<name>/<Name>Page.tsx`) independently reimplement
the **same page-shell orchestration**: compute `getTemplateMetrics`,
`getTemplatePageSize`, `getTemplatePageMinHeightStyle`, `shouldShowResumeHeader`,
`hasTemplatePicture`, `filterSections(page.main/sidebar)`, then render
`<Page>` → `<TemplateProvider>` → a two-column `layout` → sidebar/main columns
that `.map` over `<Section>`. Git history proves the cost: a single header
line-height change touched 14 template files (commit `1b0bb067b`); the free-form
layout feature touched 14 (`2cd774dab`). Every new template copies this again,
and drift between copies is invisible until someone diffs all 15.

The goal is a shared, prop-/callback-driven `TemplatePageShell` that owns the
orchestration while each template keeps its own styles and decorative choices.
**Because the visual risk is high and no render-parity test net exists for
templates today, this plan proves the abstraction on ONE template (Pikachu)
behind a characterization snapshot, then stops for review before any rollout.**

## Current state

- `packages/pdf/src/templates/pikachu/PikachuPage.tsx` — the pilot. Structure
  (lines 58–110): the `PikachuPage` component computes the shared metrics/flags
  and renders the shell; a local `Header` component (lines 112–161) renders
  `basics.name`/`headline` + the shared contact-item components; a
  `usePikachuTemplate` hook (lines 163–292) builds the per-template `StyleSheet`.
  The orchestration block, verbatim:

  ```tsx
  export const PikachuPage = ({ page, pageIndex }: TemplatePageProps) => {
    const data = useRender();
    const { metadata, picture } = data;
    const { colors, styles } = usePikachuTemplate();
    const metrics = getTemplateMetrics(metadata.page);
    const pageSize = getTemplatePageSize(metadata.page.format);
    const pageMinHeightStyle = getTemplatePageMinHeightStyle(metadata.page.format);
    const showHeader = shouldShowResumeHeader(data, pageIndex);
    const showSidebar = !page.fullWidth;
    const hasPicture = hasTemplatePicture(picture);
    const mainSections = filterSections(page.main, data);
    const sidebarSections = filterSections(page.sidebar, data);

    return (
      <Page size={pageSize} style={composeStyles(styles.page, pageMinHeightStyle)}>
        <TemplateProvider styles={styles} colors={colors} features={pikachuFeatures}>
          <View style={styles.layout}>
            {showSidebar && (
              <View style={composeStyles(styles.sidebarColumn, { width: `${metadata.layout.sidebarWidth}%`, rowGap: metrics.sectionGap })}>
                {showHeader && showSidebar && hasPicture && <Image src={picture.url} style={styles.picture} />}
                <View style={composeStyles(styles.sidebarContent, { rowGap: metrics.sectionGap })}>
                  {sidebarSections.map((s) => <Section key={s} section={s} placement="sidebar" />)}
                </View>
              </View>
            )}
            <View style={composeStyles(styles.mainColumn, { rowGap: metrics.sectionGap })}>
              {showHeader && (
                <View style={styles.headerRow}>
                  {showHeader && !showSidebar && hasPicture && <Image src={picture.url} style={styles.picture} />}
                  <Header styles={styles} colors={colors} />
                </View>
              )}
              <View style={{ rowGap: metrics.sectionGap }}>
                {mainSections.map((s) => <Section key={s} section={s} placement="main" />)}
              </View>
            </View>
          </View>
        </TemplateProvider>
      </Page>
    );
  };
  ```

  **Template-specific variation you must preserve** (this is why extraction is
  risky — the shell cannot assume one layout): Pikachu wraps its `Header` in a
  colored box and places the picture *beside* the header in the main column when
  there's no sidebar, but *above* the sidebar sections when there is. Other
  templates differ: Azurill (`AzurillPage.tsx`) uses `flexBasis` for sidebar
  width instead of a `width` percentage; Onyx (`OnyxPage.tsx`) is single-column
  header-on-top; Gengar (`GengarPage.tsx`) calls `getFeaturedSummaryLayout`.
  The shared shell must expose enough seams (render callbacks / slots) that each
  template keeps these differences — do not flatten them into one hardcoded
  layout.

- Shared helpers already exist under `packages/pdf/src/templates/shared/`:
  `metrics.ts`, `page-size.ts`, `cover-letter.ts` (`shouldShowResumeHeader`),
  `filtering.ts`, `picture.ts`, `contact-item.tsx`, `context.tsx`
  (`TemplateProvider`), `sections.tsx` (`Section`), `styles.ts` (`composeStyles`).
  The extraction consolidates the *orchestration that wires these together*, not
  the helpers themselves.

- **No render-parity test exists per template.** The only per-template test is
  `templates/scizor/ScizorPage.test.ts`, which greps source text — not a
  structural snapshot. You will build a real parity net in Step 1.

- `packages/pdf/src/document.ts` — defines `TemplatePageProps` and
  `TemplatePage`; `templates/index.ts` maps template name → page component.

## Commands you will need

| Purpose        | Command                                                        | Expected           |
|----------------|---------------------------------------------------------------|--------------------|
| Typecheck      | `pnpm --filter @reactive-resume/pdf typecheck`               | exit 0             |
| PDF tests      | `pnpm --filter @reactive-resume/pdf test`                    | all pass           |
| Pilot snapshot | `pnpm --filter @reactive-resume/pdf test -- pikachu`         | all pass           |

(Do NOT run `pnpm check`.)

## Scope

**In scope**:
- A new shared shell, e.g. `packages/pdf/src/templates/shared/page-shell.tsx`
  (create) and its type additions in `shared/types.ts` if needed.
- `packages/pdf/src/templates/pikachu/PikachuPage.tsx` (the ONE pilot migration)
- A new parity snapshot test:
  `packages/pdf/src/templates/pikachu/PikachuPage.test.tsx` (create)
- `plans/README.md` (status row + a note on the pilot outcome)

**Out of scope (hard stop)**:
- The other 14 `*Page.tsx` templates — **do not touch them in this plan.** Their
  migration is explicit follow-up, gated on this pilot's review.
- The shared helpers' internals (`metrics.ts`, `filtering.ts`, etc.).
- `templates/index.ts` mapping — Pikachu's export name/signature must not change.
- Any visual/styling change — this is a pure structural extraction; the pilot's
  rendered output must be byte-identical to before.

## Git workflow

- Branch: `advisor/007-template-shell-spike`
- Commit style: conventional commits, e.g.
  `refactor(pdf): extract shared template page-shell; pilot on pikachu`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Build the parity net for Pikachu (BEFORE refactoring)

Create `packages/pdf/src/templates/pikachu/PikachuPage.test.tsx` that renders
`PikachuPage` with a fixed sample resume and metadata and snapshots the produced
element tree. Approach:

- Use `react-test-renderer` (already available transitively; if not, use the
  approach the existing `packages/pdf/src/browser.test.tsx` / `server.test.tsx`
  use to exercise components) to render the template wrapped in whatever context
  `useRender()` needs. Read `packages/pdf/src/context.tsx` to see how to provide
  the render context in a test (there may be a provider/helper the existing
  tests use — reuse it).
- Feed it `sampleResumeData` from `@reactive-resume/schema/resume/sample` (used
  by `server.test.tsx`) and a representative `page` prop (one with a sidebar,
  one full-width — two snapshots).
- Snapshot the tree with `expect(tree.toJSON()).toMatchSnapshot()`.

Run it to generate the baseline snapshot **against the current, un-refactored
PikachuPage**.

**Verify**: `pnpm --filter @reactive-resume/pdf test -- pikachu` → passes and
writes a `__snapshots__` file. Commit this snapshot as the baseline.

> If you cannot render the template in a test without excessive/fragile mocking
> (react-pdf host primitives don't cooperate with the test renderer), STOP and
> report — a structural refactor with no parity net is exactly what this plan
> refuses to ship. Do not proceed to Step 2 without a working baseline.

### Step 2: Extract the shared shell

Create `shared/page-shell.tsx` exporting a `TemplatePageShell` component (or a
hook + component pair) that encapsulates the orchestration from the excerpt:
computing `metrics`/`pageSize`/`pageMinHeightStyle`/`showHeader`/`showSidebar`/
`hasPicture`/`mainSections`/`sidebarSections`, and rendering the
`<Page><TemplateProvider>...<View layout>` scaffold. Expose the per-template
variation through props/render-callbacks, at minimum:
- `styles`, `colors`, `features` (passed through to `TemplateProvider` and used
  by the scaffold).
- `renderHeader` / `renderPicture` callbacks (or slot props) so Pikachu can keep
  its colored-box header and beside/above picture placement.
- The sidebar-width strategy as data (Pikachu passes a `width` %; Azurill will
  later pass `flexBasis`) — model it so both fit without the shell hardcoding one.

Keep the shell's public surface minimal and documented with a short comment.

**Verify**: `pnpm --filter @reactive-resume/pdf typecheck` → exit 0.

### Step 3: Migrate Pikachu onto the shell

Rewrite `PikachuPage.tsx` so `PikachuPage` delegates its orchestration to
`TemplatePageShell`, passing `usePikachuTemplate()`'s styles/colors, the
`pikachuFeatures`, and its `Header`/picture rendering via the callbacks. Keep
`usePikachuTemplate` and the `Header` component in the Pikachu file (styles stay
template-owned). The export name and `TemplatePageProps` signature must not
change.

**Verify**:
- `pnpm --filter @reactive-resume/pdf test -- pikachu` → the Step 1 snapshot
  **still matches** (identical tree). If the snapshot changed, the refactor
  altered output — investigate and reconcile; do NOT blindly update the
  snapshot.
- `pnpm --filter @reactive-resume/pdf test` → the full PDF suite passes.
- `pnpm --filter @reactive-resume/pdf typecheck` → exit 0.

### Step 4: STOP and report — do not roll out

Write a short note in `plans/README.md`'s status area (or the PR description)
covering: whether the shell's seams were sufficient for Pikachu without style
regressions, what the shell's public API ended up being, and which of the other
14 templates look like clean fits vs. which have layouts (e.g. Onyx single
column, Gengar featured-summary) that will need extra seams. This note is the
input for the reviewed rollout plans. **Do not migrate any other template.**

## Test plan

- New `PikachuPage.test.tsx` with two snapshots (with-sidebar, full-width),
  established as a baseline in Step 1 and asserted unchanged after Step 3.
- Full `packages/pdf` suite must remain green.
- Verification: `pnpm --filter @reactive-resume/pdf test` → all pass; the
  Pikachu snapshot is unchanged between baseline and post-refactor.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `packages/pdf/src/templates/shared/page-shell.tsx` exists and is imported by `PikachuPage.tsx`
- [ ] `packages/pdf/src/templates/pikachu/PikachuPage.test.tsx` + its `__snapshots__` exist
- [ ] `pnpm --filter @reactive-resume/pdf test` exits 0 (snapshot unchanged post-refactor)
- [ ] `pnpm --filter @reactive-resume/pdf typecheck` exits 0
- [ ] `git diff --name-only` shows **exactly one** `*Page.tsx` changed (pikachu); no other template file modified
- [ ] `plans/README.md` status row for 007 updated with the pilot-outcome note
- [ ] `grep -rL page-shell packages/pdf/src/templates/*/[A-Z]*Page.tsx` still lists 14 templates (i.e. only Pikachu adopted it)

## STOP conditions

Stop and report back (do not improvise) if:

- You cannot build a working render-parity snapshot in Step 1 (Step 1's own
  stop clause) — no net, no refactor.
- The Pikachu snapshot changes after Step 3 and you cannot make it identical —
  the extraction is not behavior-preserving; report the diff instead of
  updating the snapshot to match.
- Making the shell fit Pikachu forces the abstraction to also encode a second
  template's layout (you find yourself designing for Onyx/Gengar mid-pilot) —
  stop; the pilot's job is to prove one clean seam set, not to pre-solve all 15.
- Any change would touch a template other than Pikachu — that's the rollout,
  which is out of scope.

## Maintenance notes

- Rollout is deliberately deferred. After this pilot is reviewed and merged,
  create follow-up plans that migrate the remaining templates in small reviewed
  batches (group by layout family: full-width/single-column like Onyx; sidebar-%
  like Pikachu; flexBasis like Azurill; featured-summary like Gengar). Each
  batch gets its own baseline snapshot first.
- The shell's public API is load-bearing for 14 future migrations — a reviewer
  should scrutinize its seam design (are the render callbacks expressive enough?)
  more than the Pikachu diff itself.
- Prior maintainer guidance: template rewrites should be spike-gated and must
  not break the react-pdf/DOCX/JSON export pipeline. This plan honors that by
  keeping styles template-owned and asserting identical render output.
