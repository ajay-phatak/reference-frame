// Metric registry — the backbone of the structured report/gap/comparison
// views (plan-0.4.0 §1). One static entry per report-worthy metric field:
// label/format for display, `direction` for delta favorability (our own
// renderer-side metadata — it does NOT feed the engine's gap ▲/▼, which
// stays authoritative for pro comparisons), and a plain-language explainer.
//
// `section` is a FAMILY, not a literal top-level JSON key: 'leg_action'
// matches both `leg_action_lead` and `leg_action_follow`; 'travel' matches
// `travel`, `travel_lead` and `travel_follow`. Resolving a family + role to
// the concrete MetricsSummary path is a rendering-layer concern (phase 2+),
// not this module's job.
//
// Coverage: every row of the engine's gap table (`_gap_report` in
// engine/refframe_engine/run.py) plus a modest set of additional scalars
// dance_review.py's `build_report` surfaces in the text report. Direction
// is ported directly from the gap table's higher-is-better column where a
// metric appears there; for build_report-only metrics, direction is a
// judgment call inferred from that function's own `_flag()` thresholds
// (documented per-entry below) or 'neutral' where genuinely ambiguous.
// Unregistered JSON fields simply don't render — safe for engine drift.

export type MetricDirection = 'higher' | 'lower' | 'target' | 'neutral'

export interface MetricExplainer {
  what: string
  how: string
  goodLooksLike: string
  commonCauses: string
}

export interface MetricDef {
  key: string
  section: string
  label: string
  unit?: string
  format: (v: number) => string
  direction: MetricDirection
  explainer: MetricExplainer
}

// ---- formatters -------------------------------------------------------

const f =
  (d: number) =>
  (v: number): string =>
    v.toFixed(d)
const signed =
  (d: number) =>
  (v: number): string =>
    `${v >= 0 ? '+' : ''}${v.toFixed(d)}`
const pctv =
  (d = 1) =>
  (v: number): string =>
    `${v.toFixed(d)}%`
// For 0-1 fractions the report shows as a percent bar (bounce_match, song
// bounciness) rather than as a raw ratio.
const fracPct =
  (d = 0) =>
  (v: number): string =>
    `${(v * 100).toFixed(d)}%`
const degv =
  (d = 1) =>
  (v: number): string =>
    `${v.toFixed(d)}°`
const msv = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(0)} ms`
const bhv =
  (d = 3) =>
  (v: number): string =>
    `${v.toFixed(d)} BH`
const countv = (v: number): string => v.toFixed(0)
const perMin = (v: number): string => `${v.toFixed(0)}/min`
const bpmv = (v: number): string => `${v.toFixed(1)} BPM`
const timesv = (v: number): string => `${v.toFixed(2)}×`

// ---- explainer helper ---------------------------------------------------
// Phase-6 content pass is done: every explainer below is real user-facing
// prose (plan-0.4.0 §1, phase 6). Still pending a user review pass before
// release — flag anything that reads wrong or overclaims.

function ex(what: string, how: string, goodLooksLike: string, commonCauses: string): MetricExplainer {
  return { what, how, goodLooksLike, commonCauses }
}

// Canonical section display order (plan-0.4.0 §3).
export const SECTION_ORDER = [
  'musicality',
  'leg_action',
  'body_action',
  'weight_countering',
  'travel',
  'tracking_quality'
] as const

// ---- registry -----------------------------------------------------------

export const METRIC_REGISTRY: MetricDef[] = [
  // ---- musicality ----
  {
    key: 'tempo_bpm',
    section: 'musicality',
    label: 'Detected tempo',
    format: bpmv,
    direction: 'neutral',
    explainer: ex(
      "The tempo of the song, in beats per minute, as detected from the audio track of your video.",
      "The app extracts the audio and runs beat-tracking on it to estimate a steady beat rate — it doesn't look at your steps at all.",
      "N/A — this describes the song, not your dancing. It exists so the timing metrics below have a beat to measure against.",
      "A number that looks far too fast or slow (often exactly double or half of what you'd expect) usually means a tempo-detection octave error, not a real tempo change."
    )
  },
  {
    key: 'song_bounciness',
    section: 'musicality',
    label: 'Song bounciness',
    format: fracPct(0),
    direction: 'neutral',
    explainer: ex(
      "How punchy and percussive the song feels versus smooth and legato — the musical texture your dancing is meant to respond to.",
      "Computed from transients in the audio's energy: sharp, punchy hits push this up; sustained, smooth passages push it down.",
      "N/A — it's a property of the song. It exists to be compared against your texture-match score, not judged on its own.",
      "Driven entirely by song choice, not by anything you or your partner did."
    )
  },
  {
    key: 'texture_match_a',
    section: 'musicality',
    label: 'Texture match — leader',
    format: signed(3),
    direction: 'higher',
    explainer: ex(
      "Whether the leader's movement quality actually changes with the song's texture — getting bouncier in punchy sections and smoother in legato ones.",
      "The app correlates the song's texture curve against the leader's movement-quality curve over time.",
      "A clearly positive value means their movement is tracking what the music is doing; near zero or negative means it isn't.",
      "Dancing the same texture all the way through regardless of the music, or not listening for the shift between punchy and smooth sections."
    )
  },
  {
    key: 'texture_match_b',
    section: 'musicality',
    label: 'Texture match — follower',
    format: signed(3),
    direction: 'higher',
    explainer: ex(
      "Whether the follower's movement quality actually changes with the song's texture — getting bouncier in punchy sections and smoother in legato ones.",
      "The app correlates the song's texture curve against the follower's movement-quality curve over time.",
      "A clearly positive value means their movement is tracking what the music is doing; near zero or negative means it isn't.",
      "Dancing the same texture all the way through regardless of the music, or not listening for the shift between punchy and smooth sections."
    )
  },
  {
    key: 'bounce_match_a',
    section: 'musicality',
    label: 'Bounce match (beat rhythm) — leader',
    format: fracPct(1),
    direction: 'higher',
    explainer: ex(
      "How well the leader's rise-and-fall rhythm — the up-down bounce of their body — lines up with the beat of the music.",
      'The app checks whether their bounce frequency matches the beat frequency, or a clean half-time or double-time relationship to it (×0.5, ×1, ×2).',
      'Above roughly 70% is a strong lock to the beat; below about 40% the bounce and the music are drifting apart.',
      "Rushing or dragging the beat, or bouncing at a rhythm that doesn't relate cleanly to the song's tempo."
    )
  },
  {
    key: 'bounce_match_b',
    section: 'musicality',
    label: 'Bounce match (beat rhythm) — follower',
    format: fracPct(1),
    direction: 'higher',
    explainer: ex(
      "How well the follower's rise-and-fall rhythm — the up-down bounce of their body — lines up with the beat of the music.",
      'The app checks whether their bounce frequency matches the beat frequency, or a clean half-time or double-time relationship to it (×0.5, ×1, ×2).',
      'Above roughly 70% is a strong lock to the beat; below about 40% the bounce and the music are drifting apart.',
      "Rushing or dragging the beat, or bouncing at a rhythm that doesn't relate cleanly to the song's tempo."
    )
  },
  {
    key: 'on_beat_pct_a',
    section: 'musicality',
    label: 'On-beat articulated steps — leader',
    unit: '%',
    format: pctv(1),
    direction: 'higher',
    explainer: ex(
      "The percentage of the leader's articulated (heel-lift) steps that land right on a musical beat.",
      'The app compares the timestamp of each articulated step against the nearest detected beat time.',
      'Above about 80% is solid; below 55% steps are frequently landing off the beat, and the report flags anything under 50%.',
      "Rushing ahead of or dragging behind the music, or the song's tempo shifting in a way that's hard to track."
    )
  },
  {
    key: 'on_beat_pct_b',
    section: 'musicality',
    label: 'On-beat articulated steps — follower',
    unit: '%',
    format: pctv(1),
    direction: 'higher',
    explainer: ex(
      "The percentage of the follower's articulated (heel-lift) steps that land right on a musical beat.",
      'The app compares the timestamp of each articulated step against the nearest detected beat time.',
      'Above about 80% is solid; below 55% steps are frequently landing off the beat, and the report flags anything under 50%.',
      "Rushing ahead of or dragging behind the music, or the song's tempo shifting in a way that's hard to track."
    )
  },
  {
    key: 'timing_ms_a',
    section: 'musicality',
    label: 'Timing consistency — leader',
    unit: 'ms',
    format: msv,
    direction: 'lower',
    explainer: ex(
      "How consistent the leader's step timing is relative to the beat — a small number means every step lands the same distance from the beat; a large one means it varies step to step.",
      "The app measures the offset between each step and its nearest beat, then takes the standard deviation of those offsets across the clip.",
      "Under about 80 ms is tight and repeatable. A wide spread matters even if some steps land dead on, since it means the timing is unpredictable.",
      "Inconsistent tempo tracking by the dancer, or a song with a tempo that shifts or drifts during the clip."
    )
  },
  {
    key: 'timing_ms_b',
    section: 'musicality',
    label: 'Timing consistency — follower',
    unit: 'ms',
    format: msv,
    direction: 'lower',
    explainer: ex(
      "How consistent the follower's step timing is relative to the beat — a small number means every step lands the same distance from the beat; a large one means it varies step to step.",
      "The app measures the offset between each step and its nearest beat, then takes the standard deviation of those offsets across the clip.",
      "Under about 80 ms is tight and repeatable. A wide spread matters even if some steps land dead on, since it means the timing is unpredictable.",
      "Inconsistent tempo tracking by the dancer, or a song with a tempo that shifts or drifts during the clip."
    )
  },
  {
    key: 'syncopation_pct_a',
    section: 'musicality',
    label: 'Syncopation % — leader',
    unit: '%',
    format: pctv(1),
    direction: 'higher',
    explainer: ex(
      "The percentage of the leader's weight changes that fall off the base count structure — extra or delayed weight changes rather than plain on-count steps.",
      "The app compares weight-change timing against the detected count structure of the song and flags changes that don't line up with a plain count.",
      "N/A — some syncopation is expected WCS styling (holds, delays, extra weight changes). It's a stylistic choice, not a defect in either direction.",
      "Deliberate styling choices, or, if higher than intended, footwork that's genuinely landing off-time rather than choosing to."
    )
  },
  {
    key: 'syncopation_pct_b',
    section: 'musicality',
    label: 'Syncopation % — follower',
    unit: '%',
    format: pctv(1),
    direction: 'higher',
    explainer: ex(
      "The percentage of the follower's weight changes that fall off the base count structure — extra or delayed weight changes rather than plain on-count steps.",
      "The app compares weight-change timing against the detected count structure of the song and flags changes that don't line up with a plain count.",
      "N/A — some syncopation is expected WCS styling (holds, delays, extra weight changes). It's a stylistic choice, not a defect in either direction.",
      "Deliberate styling choices, or, if higher than intended, footwork that's genuinely landing off-time rather than choosing to."
    )
  },
  {
    key: 'accent_response_pct_a',
    section: 'musicality',
    label: 'Accent response % — leader',
    unit: '%',
    format: pctv(1),
    direction: 'higher',
    explainer: ex(
      "The percentage of musical accents — hits, breaks, stabs — that the leader marks with a noticeably bigger move somewhere in their body.",
      "The app looks for a burst of motion in the feet, chest, hands, or head around each detected accent, whichever channel is strongest.",
      "A clear majority answered (above roughly 65%) shows they're catching the accents; below about 35% most are passing unmarked.",
      "Not listening for hits and breaks in the music, or a dominant channel (e.g. feet-only) that doesn't fire on every kind of accent."
    )
  },
  {
    key: 'accent_response_pct_b',
    section: 'musicality',
    label: 'Accent response % — follower',
    unit: '%',
    format: pctv(1),
    direction: 'higher',
    explainer: ex(
      "The percentage of musical accents — hits, breaks, stabs — that the follower marks with a noticeably bigger move somewhere in their body.",
      "The app looks for a burst of motion in the feet, chest, hands, or head around each detected accent, whichever channel is strongest.",
      "A clear majority answered (above roughly 65%) shows they're catching the accents; below about 35% most are passing unmarked.",
      "Not listening for hits and breaks in the music, or a dominant channel (e.g. feet-only) that doesn't fire on every kind of accent."
    )
  },
  {
    key: 'accent_hit_mean_a',
    section: 'musicality',
    label: 'Accent hit intensity — leader',
    format: timesv,
    direction: 'higher',
    explainer: ex(
      "How much bigger the leader's strongest response to a musical accent is compared to their typical movement — the size of the punctuation, not just whether they responded.",
      "The app takes the peak motion energy in their strongest channel near each accent and expresses it as a multiple of their baseline movement energy.",
      "Clearly above 1× means real punctuation on the accents; close to 1× means their movement barely changes when an accent hits.",
      "Flat, evenly-paced movement throughout the clip with no dynamic contrast to spend on the big moments."
    )
  },
  {
    key: 'accent_hit_mean_b',
    section: 'musicality',
    label: 'Accent hit intensity — follower',
    format: timesv,
    direction: 'higher',
    explainer: ex(
      "How much bigger the follower's strongest response to a musical accent is compared to their typical movement — the size of the punctuation, not just whether they responded.",
      "The app takes the peak motion energy in their strongest channel near each accent and expresses it as a multiple of their baseline movement energy.",
      "Clearly above 1× means real punctuation on the accents; close to 1× means their movement barely changes when an accent hits.",
      "Flat, evenly-paced movement throughout the clip with no dynamic contrast to spend on the big moments."
    )
  },
  {
    key: 'accent_covered_pct',
    section: 'musicality',
    label: 'Accent coverage % (either partner)',
    unit: '%',
    format: pctv(1),
    direction: 'higher',
    explainer: ex(
      "Whether a musical accent lands for the couple at all — credited if either partner expresses it, even if the other stays framing/still.",
      "The app takes the union of both dancers' individual accent responses, so a leader going still to set up the follower still counts as the accent landing.",
      "High coverage (above about 75%) means the moment is rarely missed by both of you at once — that matters more than a low individual score when your partner covered it.",
      "Both partners going still or unresponsive on the same accents, so nobody catches the moment."
    )
  },

  // ---- leg_action (family: leg_action_lead / leg_action_follow) ----
  {
    key: 'steps_per_minute',
    section: 'leg_action',
    label: 'Steps per minute',
    format: perMin,
    direction: 'neutral',
    explainer: ex(
      "How many weight changes you make per minute, overall.",
      "A straight count of detected weight changes divided by the clip's duration.",
      "N/A — this depends heavily on the song's tempo and the pattern content in the clip, not on skill.",
      "Faster or slower songs, or pattern choices with more or fewer weight changes packed in."
    )
  },
  {
    key: 'knee_flex_mean',
    section: 'leg_action',
    label: 'Knee flexion (overall mean)',
    format: f(3),
    direction: 'higher',
    // Judgment call: inferred from _flag(kf_mean, 0.2, 0.35) in dance_review.py
    // (non-inverted — only low values are flagged).
    explainer: ex(
      "How bent your knees are on average across the whole clip — your baseline level of compression.",
      "The app measures knee joint angle every frame, normalized so 0 is a straight leg and 0.5 is a deep bend, then averages it.",
      "Comfortably above roughly 0.35 reads as healthy compression; under about 0.2 is flagged as notably straight-legged.",
      "Standing tall and stiff-legged instead of sitting into a bend between steps."
    )
  },
  {
    key: 'triple_step_count',
    section: 'leg_action',
    label: 'Triple-step sequences',
    format: countv,
    direction: 'higher',
    // Judgment call: build_report's _flags_section flags <3 as notable.
    explainer: ex(
      "How many triple-step sequences (the classic WCS ta-ta-ta footwork) the app found in the clip.",
      "Pattern-matching against the timing of your detected weight changes for the characteristic triple-step rhythm.",
      "Several across a full clip is typical; the report calls out fewer than 3 as notably light on triples.",
      "A pattern mix that's basics-heavy, or a clip too short to contain many triples."
    )
  },
  {
    key: 'one_foot_pct',
    section: 'leg_action',
    label: '1-foot balance %',
    unit: '%',
    format: pctv(1),
    direction: 'higher',
    explainer: ex(
      "The percentage of frames where one ankle is clearly elevated relative to the other — everything from a full lift down to a heel raise or toe touch.",
      "Per-frame ankle-height comparison: one ankle sitting ≥5% of your body height above the other counts as one-foot.",
      "A healthy share of the clip; flat-footed dancing with both ankles level throughout reads low here.",
      "Minimal heel lifts, brushes, or toe-touches — weight changes that stay flat-footed rather than articulated."
    )
  },
  {
    key: 'one_foot_airborne_pct',
    section: 'leg_action',
    label: '1-foot airborne % (true single-leg)',
    unit: '%',
    format: pctv(1),
    direction: 'higher',
    explainer: ex(
      "The stricter version of one-foot balance: the percentage of frames where the free foot is genuinely off the floor, not just a heel raised.",
      "Uses the foot keypoints (heel and toes) rather than the ankle, comparing the free foot's lowest point against the grounded foot to confirm full clearance.",
      "Present in reasonable amounts on a leg-action-heavy clip; a near-zero number means articulated steps aren't fully clearing the floor.",
      "The heel or ball of the free foot staying in light contact with the floor instead of lifting all the way clear."
    )
  },
  {
    key: 'ball_foot_pct',
    section: 'leg_action',
    label: 'Ball-of-foot % (rolling action)',
    unit: '%',
    format: pctv(1),
    direction: 'higher',
    explainer: ex(
      "The percentage of frames spent dancing on the ball of the foot — heel released, toes still grounded.",
      "Uses the foot keypoints to detect a heel raised clear of the floor line while the toes stay down.",
      "A visible share, especially on triples and anchors, shows rolling action through the foot rather than a flat heel.",
      "Flat-footed weight changes where the heel stays planted the whole time instead of releasing."
    )
  },
  {
    key: 'art_toe_first_pct',
    section: 'leg_action',
    label: 'Toe-first landings %',
    unit: '%',
    format: pctv(1),
    direction: 'higher',
    explainer: ex(
      "Of your articulated (heel-lift) steps, the percentage that land toe- or ball-first and roll through to the heel, rather than landing flat or heel-first.",
      "The app sequences the foot keypoints at the moment of landing to see which part of the foot touches down first, at roughly 33 ms resolution.",
      "A clear majority rolling through is the goal; a low number means most landings are flat or heel-first instead.",
      "Landing flat-footed or heel-first rather than rolling through the foot, often from rushing the weight transfer."
    )
  },
  {
    key: 'step_count_weight_only_traveling',
    section: 'leg_action',
    label: 'Weight-only traveling steps',
    format: countv,
    direction: 'lower',
    explainer: ex(
      "Weight changes with no heel lift where you still moved across the floor — sliding a flat foot into the new position instead of stepping onto it.",
      "The app flags a weight change as 'traveling' when the stance center shifts more than 5% of body height, and checks whether the heel ever lifted during that shift.",
      "Rare is the goal — at higher levels, traveling should come from clean articulated steps, not slides.",
      "Sliding or shuffling into a new position rather than picking the foot up and placing it."
    )
  },
  {
    key: 'step_count_articulated_traveling',
    section: 'leg_action',
    label: 'Articulated traveling steps',
    format: countv,
    direction: 'higher',
    explainer: ex(
      "Weight changes with a heel lift where you also traveled across the floor — the clean, articulated version of moving your feet.",
      "The same traveling test (stance center shift over 5% of body height), counted only on steps where the heel lifted clear.",
      "The majority of your traveling steps should be this kind, not weight-only slides.",
      "A low count usually means traveling is coming from slides instead — compare against the weight-only traveling count to see the balance."
    )
  },
  {
    key: 'art_free_knee_flex_deg',
    section: 'leg_action',
    label: 'Free-leg prep knee flex',
    unit: '°',
    format: degv(1),
    direction: 'higher',
    explainer: ex(
      "How much your moving (free) leg bends at the knee while its foot is off the floor, gathering to prepare the step.",
      "Knee angle measured on the free leg during the free-swing phase of each articulated step, in degrees.",
      "A clear, visible prep bend is the goal; a near-zero number means the leg is swinging through stiff and straight instead of gathering.",
      "Straight-legged stepping with little collection under the body before the foot lands."
    )
  },
  {
    key: 'art_free_hip_flex_deg',
    section: 'leg_action',
    label: 'Free-leg prep hip flex',
    unit: '°',
    format: degv(1),
    direction: 'higher',
    explainer: ex(
      "How much your moving leg's hip flexes during that same gathering phase, alongside the knee.",
      "Hip angle measured on the free leg during the free-swing phase of each articulated step.",
      "Visible hip engagement alongside the knee bend shows a coordinated chain, not just a knee hinge.",
      "Gathering the leg from the knee only, without the hip joining in."
    )
  },
  {
    key: 'art_weighted_knee_flex_deg',
    section: 'leg_action',
    label: 'Standing-leg knee flex (median)',
    unit: '°',
    format: degv(1),
    direction: 'higher',
    explainer: ex(
      "How much your standing (weighted) leg typically sinks and loads on articulated steps — this is the leg that actually lowers your body, not the moving one.",
      "Knee angle on the standing leg at the moment of each articulated step, taking the median (the typical step) across the clip.",
      "A visible sink into the standing leg, not a locked-out straight leg standing tall.",
      "Locking the standing leg straight instead of sitting into and loading it as weight arrives."
    )
  },
  {
    key: 'art_weighted_knee_p90',
    section: 'leg_action',
    label: 'Standing-leg knee flex (ceiling, p90)',
    unit: '°',
    format: degv(1),
    direction: 'higher',
    explainer: ex(
      "How deep your standing leg goes on your biggest steps — the 90th-percentile bend, not the typical one.",
      "The same standing-leg knee angle as the median version, but taken at the 90th percentile across all articulated steps to capture your ceiling.",
      "Meaningfully deeper than the median value shows you have dynamic range to call on for bigger moments; a ceiling close to the median means you never go deeper even when the step calls for it.",
      "A compressed range where even your biggest steps don't sink much further than an average one."
    )
  },
  {
    key: 'art_free_knee_p90',
    section: 'leg_action',
    label: 'Free-leg knee flex (ceiling, p90)',
    unit: '°',
    format: degv(1),
    direction: 'higher',
    explainer: ex(
      "How much your free leg gathers on your biggest steps — the 90th-percentile knee bend, not the typical one.",
      "The same free-leg knee angle as the median version, taken at the 90th percentile to capture your ceiling.",
      "Meaningfully deeper than the median shows real variation step to step; a ceiling close to the median means every step gathers about the same amount.",
      "A compressed range with little step-to-step variation in how much the leg gathers."
    )
  },
  {
    key: 'art_knee_hip_coord',
    section: 'leg_action',
    label: 'Free knee-hip coordination',
    format: signed(2),
    direction: 'higher',
    explainer: ex(
      "Whether your gathering leg's knee and hip bend together, proportionally, rather than one moving without the other.",
      "The app correlates knee flexion and hip flexion on the free leg across all your articulated steps.",
      "A clearly positive value (roughly above 0.3–0.6) shows a coordinated chain; near zero means the knee and hip are moving independently.",
      "Gathering from the knee only (a hinge with a stiff hip) or the hip only, instead of a stacked, coordinated bend."
    )
  },
  {
    key: 'art_smoothness',
    section: 'leg_action',
    label: 'Bend smoothness',
    format: f(3),
    direction: 'higher',
    explainer: ex(
      "Whether your moving leg's prep-then-rise reads as one clean motion, or as several distinct, jittery segments.",
      "The app measures how smooth the free-leg's flexion curve is across the prep-to-landing sequence of each articulated step.",
      "Close to 1.0 is one clean prep and rise; the report flags values under about 0.5 as notably jittery.",
      "Segmented or hesitant leg action — pausing mid-bend, or the gather and the rise reading as separate moves instead of one continuous one."
    )
  },
  {
    key: 'art_straighten_pct',
    section: 'leg_action',
    label: 'Straighten recovery %',
    unit: '%',
    format: pctv(1),
    direction: 'higher',
    explainer: ex(
      "How much of your moving leg's prep bend re-straightens as weight arrives on the new foot — the rise that finishes the step.",
      "The app compares the knee angle at the deepest point of the prep bend to the knee angle once weight has landed.",
      "A high recovery percentage (above roughly 75%) means the leg rises to meet the landing; under 50% the leg is staying bent through the landing instead.",
      "The leg staying loaded and bent through the landing rather than rising to receive weight."
    )
  },
  {
    key: 'art_prep_pct',
    section: 'leg_action',
    label: 'Prep-to-arrival sequencing %',
    unit: '%',
    format: pctv(1),
    direction: 'higher',
    explainer: ex(
      "Of your articulated steps, the percentage sequenced correctly: the bend happens while the foot is still free, then straightens after it's grounded — not the other way around.",
      "The app checks the timing of the knee bend relative to when the foot actually makes contact with the floor.",
      "A high percentage (above roughly 65%) means most steps prep before landing; under about 40% the bend is often happening after the foot is already down.",
      "Bending the leg after the foot has already grounded, rather than during the free-swing prep before it lands."
    )
  },
  {
    key: 'slot_travel_range_bh',
    section: 'travel',
    label: 'Slotted movement range',
    unit: 'BH',
    format: bhv(3),
    direction: 'higher',
    explainer: ex(
      "How far you personally travel down the slot — the line the pattern runs along — over the course of the clip, measured in body heights.",
      "The app tracks your position along the slot axis (found by fitting a line through both dancers' movement) and measures the range it spans.",
      "A healthy range for the pattern content shown; the follower typically covers more slot distance than the leader across a clip.",
      "Staying anchored near one spot in the slot rather than committing to travel down it on patterns that call for it."
    )
  },

  // ---- body_action (family: body_action_lead / body_action_follow) ----
  {
    key: 'motion_smoothness',
    section: 'body_action',
    label: 'Motion smoothness',
    format: f(3),
    direction: 'higher',
    explainer: ex(
      "How fluid your overall body movement is — smooth and connected versus choppy and staccato.",
      "The app measures what fraction of your movement's energy sits below 2 Hz (slower, flowing motion) versus faster, jerkier motion.",
      "Higher values (above roughly 0.75) read as smooth flow; the report flags under about 0.55 as possibly choppy or staccato.",
      "Sharp, disconnected transitions between movements, or tension that breaks the flow between steps."
    )
  },
  {
    key: 'pitch_range_deg',
    section: 'body_action',
    label: 'Torso pitch range',
    unit: '°',
    format: degv(1),
    direction: 'higher',
    explainer: ex(
      "How much your torso leans forward and back along the slot over the clip — your use of pitch as a shaping tool.",
      "The app measures the sagittal (forward/back) angle of your torso every frame and takes the range across the clip.",
      "A visible range (above roughly 15°) shows real forward/back engagement; under 5° reads as staying rigidly upright.",
      "Staying upright throughout the clip with little forward or backward body engagement into the connection or the music."
    )
  },
  {
    key: 'upper_lower_rotation_mean_deg',
    section: 'body_action',
    label: 'Upper/lower rotation dissociation',
    unit: '°',
    format: degv(1),
    direction: 'higher',
    explainer: ex(
      "How much your shoulder line turns against your hip line — the dissociation behind swivels and body-led movement.",
      "Using the 3-D pose, the app measures the rotation of your shoulder line relative to your hip line about the vertical axis, averaged across the clip.",
      "A visible dissociation on patterns that call for it (swivels, body leads) is the goal; near zero means shoulders and hips are turning together as one block.",
      "Turning the whole torso as a single unit instead of letting the shoulders and hips rotate independently."
    )
  },
  {
    key: 'hip_shoulder_lag_ms',
    section: 'body_action',
    label: 'Hip → shoulder lag',
    unit: 'ms',
    format: msv,
    direction: 'higher',
    // Judgment call: inferred from _flag(hs_lag, 20, 80) (non-inverted).
    explainer: ex(
      "Whether your shoulders follow your hips in a bottom-up wave (positive), move together as a block (near zero), or lead ahead of the hips (negative).",
      "The app cross-correlates hip motion against shoulder motion to find the time lag between them.",
      "A positive lag (roughly 20–80 ms) shows sequential, bottom-up propagation through the body.",
      "Block-body movement, where the torso moves as one unit with near-zero lag, or the upper body initiating ahead of the hips."
    )
  },
  {
    key: 'shoulder_head_lag_ms',
    section: 'body_action',
    label: 'Shoulder → head lag',
    unit: 'ms',
    format: msv,
    direction: 'higher',
    // Judgment call: inferred from _flag(sh_lag, 10, 60) (non-inverted).
    explainer: ex(
      "Whether your head continues the same bottom-up wave that starts at the hips and passes through the shoulders.",
      "The app cross-correlates shoulder motion against head motion to find the lag between them.",
      "A positive lag (roughly 10–60 ms) shows the wave continuing upward into the head.",
      "The head staying fixed and block-like relative to the shoulders instead of continuing the sequence."
    )
  },
  {
    key: 'shoulder_tilt_range_deg',
    section: 'body_action',
    label: 'Shoulder tilt range',
    unit: '°',
    format: degv(1),
    direction: 'higher',
    // Judgment call: inferred from _flag(sh_tilt, 5, 15) (non-inverted).
    explainer: ex(
      "How much your shoulder line tilts side to side over the clip — your use of sway through the upper body.",
      "The app tracks the angle of your shoulder line every frame and takes the range across the clip.",
      "A visible range (above roughly 15°) shows real sway usage; under 5° reads as minimal upper-body tilt.",
      "Little side-to-side sway usage — the shoulders staying level throughout."
    )
  },
  {
    key: 'hip_tilt_range_deg',
    section: 'body_action',
    label: 'Hip tilt range',
    unit: '°',
    format: degv(1),
    direction: 'higher',
    // Judgment call: inferred from _flag(hi_tilt, 5, 15) (non-inverted).
    explainer: ex(
      "How much your hip line tilts side to side over the clip — your use of sway through the lower body.",
      "The app tracks the angle of your hip line every frame and takes the range across the clip.",
      "A visible range (above roughly 15°) shows real sway usage; under 5° reads as minimal lower-body tilt.",
      "Little side-to-side sway usage — the hips staying level throughout."
    )
  },
  {
    key: 'upper_lower_sway_dissoc',
    section: 'body_action',
    label: 'Upper/lower sway dissociation',
    unit: '°',
    format: degv(1),
    direction: 'higher',
    // Judgment call: inferred from _flag(sway_diss, 3, 10) (non-inverted).
    explainer: ex(
      "How much your shoulder tilt and hip tilt differ from each other — whether sway moves through the body in layers or all at once.",
      "The app takes the difference between the shoulder-tilt signal and the hip-tilt signal across the clip.",
      "A visible dissociation (above roughly 10°) shows the sway is layered rather than uniform; under 3° the torso is swaying as one solid block.",
      "Sway that moves the whole torso together rather than shoulders and hips tilting independently."
    )
  },

  // ---- weight_countering (partnership, single section) ----
  {
    key: 'partner_distance_std',
    section: 'weight_countering',
    label: 'Partner distance variance',
    format: f(3),
    direction: 'lower',
    explainer: ex(
      "How much the distance between you and your partner varies over the clip — the amount of stretch-and-compression movement in the connection.",
      "The app tracks the normalized distance between partners frame by frame and takes its standard deviation.",
      "A modest, consistent variance reads as a live elastic connection; the report flags variance above roughly 0.3 as an uneven, unpredictable dynamic.",
      "An erratic connection with big, uneven swings in distance, or the opposite — a connection so static there's little variance at all."
    )
  },
  {
    key: 'counter_balance_pct',
    section: 'weight_countering',
    label: 'Counter-balance %',
    unit: '%',
    format: pctv(1),
    direction: 'higher',
    // Judgment call: inferred from _flag(counter, 20, 50) plus the explicit
    // "low counter-balance" flag in build_report's _flags_section.
    explainer: ex(
      "The percentage of frames where both partners are leaning into each other for shared resistance — true counterbalance, not just standing near each other.",
      "The app checks each frame for both dancers leaning toward the shared connection point at the same time.",
      "A healthy share of the clip (above roughly 50%) shows real shared resistance; the report flags under 20% as low counter-balance.",
      "A limited or purely elastic connection, or dancing more side-by-side than genuinely leaning into a shared point of resistance."
    )
  },
  {
    key: 'lean_toward_conn_a',
    section: 'weight_countering',
    label: 'Leader lean toward connection',
    unit: '°',
    format: degv(1),
    direction: 'lower',
    // Judgment call: inferred from _flag(lean_a, 0, 45, invert=True).
    explainer: ex(
      "How far the leader leans their body toward the connection point, rather than staying balanced over their own feet.",
      "The app measures the lean angle of the torso toward the shared connection, averaged across the clip.",
      "Staying moderate is the goal; the report flags anything above 45° as an extreme lean, and any meaningful lean at all is worth watching.",
      "Over-leaning or hanging on the connection instead of holding their own balance and frame."
    )
  },
  {
    key: 'lean_toward_conn_b',
    section: 'weight_countering',
    label: 'Follower lean toward connection',
    unit: '°',
    format: degv(1),
    direction: 'lower',
    // Judgment call: inferred from _flag(lean_b, 0, 45, invert=True).
    explainer: ex(
      "How far the follower leans their body toward the connection point, rather than staying balanced over their own feet.",
      "The app measures the lean angle of the torso toward the shared connection, averaged across the clip.",
      "Staying moderate is the goal; the report flags anything above 45° as an extreme lean, and any meaningful lean at all is worth watching.",
      "Over-leaning or hanging on the connection instead of holding their own balance and frame."
    )
  },
  {
    key: 'stretch_pct',
    section: 'weight_countering',
    label: 'Stretch %',
    unit: '%',
    format: pctv(1),
    direction: 'neutral',
    explainer: ex(
      "The percentage of frames the connection is stretched — partners further apart than the neutral resting distance.",
      "The app measures normalized partner distance and buckets frames above the neutral band as 'stretch'.",
      "N/A — this is a stylistic, pattern-dependent mix with compression and neutral time, not a score to maximize.",
      "Driven by pattern content and personal style rather than technique quality on its own."
    )
  },
  {
    key: 'compression_pct',
    section: 'weight_countering',
    label: 'Compression %',
    unit: '%',
    format: pctv(1),
    direction: 'neutral',
    explainer: ex(
      "The percentage of frames the connection is compressed — partners closer together than the neutral resting distance.",
      "The app measures normalized partner distance and buckets frames below the neutral band as 'compression'.",
      "N/A — this is a stylistic, pattern-dependent mix with stretch and neutral time, not a score to maximize.",
      "Driven by pattern content and personal style rather than technique quality on its own."
    )
  },
  {
    key: 'post_count',
    section: 'weight_countering',
    label: 'Posts detected',
    format: countv,
    direction: 'higher',
    explainer: ex(
      "How many 'posts' the app detected — moments where the connection holds still along the slot, giving both of you a fixed point to stretch or compress from.",
      "The app looks for the connection staying steady along the slot axis for at least 0.18 seconds; vertical movement from stretch/compression is still allowed during a post.",
      "Several per clip on pattern content that calls for anchors is typical.",
      "Constant motion with no settled anchor points — moving through patterns without a moment of stillness to post off of."
    )
  },
  {
    key: 'post_stretch_leading',
    section: 'weight_countering',
    label: 'Stretch-leading posts',
    format: countv,
    // The wcs-analyze skill doc calls this descriptive, not a score — the mix
    // of stretch- vs compression-leading posts is stylistic; only "neither"
    // (posts that settle) is a gap, and that reads off post_count + the
    // explainer, not off a delta color.
    direction: 'neutral',
    explainer: ex(
      "Of the posts detected, how many are followed mainly by a stretch — the couple moving apart from that anchor point.",
      "The app looks at how the couple's center moves in the moments right after each post and classifies the direction.",
      "Having a healthy share of these is fine, but read it alongside compression-leading posts — a real gap is having neither kind, i.e. posts that just settle without leading anywhere.",
      "Posting but then settling in place instead of committing to the stretch that follows."
    )
  },
  {
    key: 'post_compression_leading',
    section: 'weight_countering',
    label: 'Compression-leading posts',
    format: countv,
    // Descriptive, same reasoning as post_stretch_leading above.
    direction: 'neutral',
    explainer: ex(
      "Of the posts detected, how many are followed mainly by compression — the couple closing in toward each other from that anchor point.",
      "The app looks at how the couple's center moves in the moments right after each post and classifies the direction.",
      "Having a healthy share of these is fine, but read it alongside stretch-leading posts — a real gap is having neither kind, i.e. posts that just settle without leading anywhere.",
      "Posting but then settling in place instead of committing to the compression that follows."
    )
  },
  {
    key: 'post_max_stretch_mean',
    section: 'weight_countering',
    label: 'Stretch range after post',
    unit: 'BH',
    format: bhv(3),
    direction: 'higher',
    explainer: ex(
      "How far apart you and your partner move after a post, on average — the payoff distance of the stretch.",
      "The app measures the peak distance the couple's centers reach following each post and averages it, in body heights.",
      "A clear, committed stretch is the goal; the report flags average stretch under roughly 0.05 BH as timid.",
      "A small, tentative move away from the post instead of committing to the elastic payoff."
    )
  },

  // ---- travel (family: travel / travel_lead / travel_follow) ----
  {
    key: 'couple_travel_range_bh',
    section: 'travel',
    label: 'Floor travel range',
    unit: 'BH',
    format: bhv(3),
    direction: 'higher',
    explainer: ex(
      "How far the couple's shared center of mass spans across the floor — movement OF the slot around the room, not down it.",
      "The app tracks the combined centroid of both dancers, smooths it heavily, and measures the range it covers, in body heights.",
      "Large in a full-floor spotlight or showcase clip; naturally lower in a contained clip, and that's expected, not a defect.",
      "Contained practice or prelim clips legitimately score low here — the couple is meant to stay put. In a spotlight clip, low travel means the couple is parked instead of using the floor."
    )
  },
  {
    key: 'couple_travel_path_bh',
    section: 'travel',
    label: 'Floor travel path (cumulative)',
    unit: 'BH',
    format: bhv(3),
    direction: 'neutral',
    explainer: ex(
      "The total distance the couple's shared center actually walked across the floor, including any back-and-forth, rather than just the straight-line range it covered.",
      "The app sums up frame-to-frame movement of the smoothed, combined centroid across the clip.",
      "N/A — this is a secondary number to floor travel range, mainly useful for spotting meandering vs. direct floor use.",
      "A winding or indirect path across the floor, or simply the pattern content and song length."
    )
  },

  // ---- tracking_quality (nested per dancer: tracking_quality.lead/.follow) ----
  {
    key: 'coverage_pct',
    section: 'tracking_quality',
    label: 'Tracking coverage',
    unit: '%',
    format: pctv(1),
    direction: 'higher',
    // Judgment call: this is a reliability/QA metric, not a dance-quality
    // one, but more coverage always means more trustworthy numbers above.
    explainer: ex(
      "The percentage of frames in which this dancer was reliably tracked by the pose model.",
      "The app counts frames where it found a valid, confident pose for this dancer against the total frame count of the clip.",
      "Comfortably above 60% is reliable; below that, the report marks the run's other numbers as estimates only, and below 30% they're flagged unreliable.",
      "Occlusion by a partner or other people in frame, poor lighting, tight or cropped camera framing, or a crowded floor."
    )
  }
]
