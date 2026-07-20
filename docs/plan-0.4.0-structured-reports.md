# v0.4.0 plan — structured reports, gap viz, run comparison, analyze queue

Goal: the app stands on its own without the coach. Today a run's riches
(the metrics JSON) are invisible — Report.tsx dumps `reportText` into a
`<pre>` and only the gap text gets structure. 0.4.0 renders the metrics
themselves: metric cards with plain-language explainers, visual gap bars
against pro baselines, A/B comparison of any two library runs, and a
batch queue so multiple videos can be analyzed unattended. Everything is
app-side TypeScript — **zero engine changes, no golden-diff pass needed**.

## Current state (verified 2026-07-19 — do not rebuild)

- Metrics JSON: `run.py` writes `<stem>_metrics.json` per run;
  `RunRecord.resultPaths.metricsPath` stores the path but **nothing in
  main or renderer ever reads it**. Shape: flat dict of section keys
  (`leg_action_lead/follow`, `body_action_lead/follow`,
  `weight_countering`, `travel*`, `musicality`,
  `movement_quality_detail`, `tracking_quality`, `camera_setup`), each a
  nested dict of scalars plus some raw time arrays (`step_data`).
  Serialized with `default=_json_default` — expect nulls, and expect
  fields to be absent on older runs.
- Gap: engine emits plain text; `src/renderer/src/gap.ts` already parses
  it into `ParsedGap { couples → sections → rows {label, you, pro,
  favorable, delta, note} }` and Report.tsx renders tables. Favorability
  comes from the engine's ▲/▼ markers — the renderer has no independent
  notion of "which direction is good".
- Analyze: single `activeJob` slot in `src/main/index.ts`; a second
  request while busy returns `{ok:false, reason:'busy'}`. No queue.
- No charting dependency in package.json.

## Design

### 1. Metric registry — `src/renderer/src/metrics/registry.ts`

One static registry keyed by metric field name is the backbone of the
whole release. Each entry:

```ts
{ key, section, label, unit, format,        // display
  direction: 'higher' | 'lower' | 'target' | 'neutral',  // for deltas
  explainer: { what, how, goodLooksLike, commonCauses } } // static prose
```

- Powers metric cards (label/format), explainers (prose), and run
  comparison (delta favorability) from a single source of truth.
- `direction` is OUR metadata, renderer-side only — it does NOT feed the
  engine gap report, whose ▲/▼ stays authoritative for pro comparisons.
  Where the two could disagree, the gap view always shows the engine's
  marker.
- Explainer prose is bundled static content: what it measures, how it's
  computed (plain language, cite the body landmarks), what good looks
  like, common causes when it's off. Source material:
  `dance_review.py`'s report wording and the wcs-analyze skill's docs
  (`C:\Users\wizar\Projects\Dance Analysis\wcs-analyze-skill\SKILL.md`).
  This is the coach-replacement for users without an API key, and the
  content pass is real work — budget it like a feature, not a footnote,
  and the user reviews every explainer before release.
- Registry covers the report-worthy scalars, not every JSON field.
  Unregistered fields simply don't render — safe for engine drift in
  either direction.

### 2. Metrics access — main-side reader + IPC

- `src/main/metrics.ts`: reads `metricsPath`, JSON-parses, prunes to a
  typed summary payload (scalar sections only — drop `step_data` and
  other raw arrays for now; a future video-sync feature will want them,
  but that's a payload decision to make then). Defensive: missing file,
  missing sections, nulls all yield partial results, never throw.
  `baseDir`-free pure function over a path → unit-testable like pros.ts.
- New IPC `library:metrics (runId) → MetricsSummary | null`, typed in
  `src/preload/index.d.ts`. Renderer never touches the filesystem
  (invariant unchanged).
- RunDetail stays as-is; metrics load lazily when the Report view wants
  them, so old runs and metrics-less runs degrade to today's behavior.

### 3. Structured report view (Report.tsx)

- Metric cards grouped by section, ordered: musicality/timing → leg
  action → body action → connection (weight_countering) → travel →
  tracking quality. Per-dancer sections show the analyzed dancer's role
  prominently; partner data (when tracked) secondary.
- Each card: formatted value, unit, ⓘ expander with the registry
  explainer. No arbitrary judgment coloring on solo numbers — a value
  alone isn't good or bad without a reference; color only appears where
  we have one (gap view, comparison view).
- The raw `reportText` stays available in a collapsible "full report"
  section — it is the golden-diff artifact and some users will want the
  exact text the source pipeline produces.
- Visuals are hand-rolled SVG (bars, simple distributions). **No
  charting dependency in 0.4.0** — nothing here needs axes/zoom/legends,
  and staying dep-free keeps the bundle small and the future trends
  feature free to pick a library on its own merits.

### 4. Gap visualization upgrade

- Builds on the existing `ParsedGap` — no reparse. Each gap row renders
  as a horizontal bar pair (you vs pro avg) with the engine's ▲/▼
  favorability coloring and the delta annotated. Table view remains as a
  toggle.
- Multi-pro band: when `couples.length > 1`, aggregate per row label
  across couples into min–max band + per-couple ticks, "you" marker on
  top. Rows missing from some couples aggregate over those present
  (n shown). Single pro degrades to the plain pair.
- Pure functions in `gap.ts` (`aggregateGap(parsed): BandRows`) with
  tests alongside the existing gap.test.ts.

### 5. Run comparison (A/B)

- New view `Compare.tsx`, entered from Library (select run A, "compare
  with…" picker for run B; both must be status done with metricsPath).
- Loads both `MetricsSummary`s, walks the registry, renders per-section
  delta rows: A value, B value, delta colored by `direction`
  (`neutral`/`target` metrics show the delta uncolored).
- Guardrails in copy, not code: warn (don't block) when the two runs
  differ in role or spotlight mode — numbers are still shown, with a
  banner that they may not be apples-to-apples. Different videos/songs
  are the normal case (before/after a lesson), not a warning.
- No new IPC — reuses `library:metrics` twice.

### 6. Analyze queue

- `src/main/queue.ts`: in-memory FIFO of pending analyze requests,
  drained sequentially through the existing single `activeJob` path —
  the engine's spawn-per-job/stateless invariant is untouched; we only
  stop REJECTING while busy. Extracted as a plain class (enqueue,
  cancel, drain-next callback) with unit tests, no Electron imports.
- `engine:analyze` while busy → enqueue instead of `reason:'busy'`;
  create the RunRecord immediately with new status `'queued'` so the
  Library shows it. New IPC: `queue:list`, `queue:cancel (runId)`
  (cancel = remove from queue + mark record error 'canceled'; the
  RUNNING job keeps its existing cancel path).
- Queue events forwarded to the renderer alongside `engine:event` so
  Analyze/Library show position ("2 queued"). URL-source runs queue the
  same as path runs (download happens inside the job as today).
- Restart policy: queue is not persisted. On startup, sweep library for
  leftover `status:'queued'` records → mark error "app closed before
  this run started". Simple, honest, no resume machinery.
- Only `engine:analyze` gets queueing. Seed-preview, setup, pros add,
  export stay busy-rejecting — they're interactive flows where a queue
  would be surprising.

## Out of scope (0.4.0)

- Video playback / beat-synced seeking (target: 0.5.0 — this is why
  `step_data` arrays stay out of the IPC payload for now).
- Cross-run trends dashboard and Progress.md trend table (post-0.5.0;
  comparison view is the deliberate stepping stone).
- Any coach changes; any engine changes; charting libraries.
- Queue persistence/resume across restarts.

## Stretch (cut without ceremony if effort runs long)

- Shareable HTML export: self-contained one-file export of the
  structured report + gap viz (inline SVG/CSS, no external assets) to
  send to a human teacher. Reuses the card/bar components; renderer
  generates the HTML string, main writes it via save dialog.

## Phases

1. Metric registry skeleton + `src/main/metrics.ts` reader + IPC +
   types + tests. (Registry starts with labels/format/direction;
   explainer prose stubs.)
2. Structured Report view on the registry; raw report collapsible.
3. Gap bars + multi-pro band aggregation + tests.
4. Compare view.
5. Queue module + tests; wire `engine:analyze`, statuses, Library UI,
   startup sweep.
6. Explainer content pass — write and user-review all registry prose.
7. Packaged-app pass per release checklist, PLUS: old-version run
   (pre-0.4.0 library entry) renders degraded-but-fine; queue with 3
   videos including one URL source; kill app mid-queue → orphan sweep.

Bump `package.json` to 0.4.0 when work starts. Release flow unchanged
(checklist → tag → CI builds/drafts → publish the draft with latest.yml).
