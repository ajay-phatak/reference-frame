# v0.3.0 plan — practice-notes folder: read AND write

Goal: the coach is informed by the dancer's own practice notes, and the app
contributes back to them. The user points the app at a notes folder (their
Obsidian vault or any markdown folder); the coach references it for fixes and
focuses, and the app writes session/practice notes into it.

## Current state (already shipped — do not rebuild)

The READ side exists end-to-end as of 0.2.x:

- `notesFolder` config key (`src/main/config.ts`), set in Settings.
- `src/main/notes/excerpts.ts` — read-only: parses the run's gap rows (or
  SUMMARY FLAGS fallback), ranks the top unfavorable gaps, maps each to
  search terms via `src/main/notes/hubmap.ts` (ported from the wcs-analyze
  skill's metric_hub_map), greps the folder's `*.md` for matching bullet
  lines (±1 line context, byte-budgeted), and returns an excerpt block.
- `coach:report` in `src/main/index.ts` (~line 582) feeds that block into the
  prompt as `<practice_notes>`; `prompts/coach-system.md` instructs the coach
  to weave excerpts into matching gaps and NEVER invent a lesson/instructor/
  date. `excerpts.test.ts` covers the reader.
- Focus loop: `src/main/coach/focuses.ts` persists agreed focuses to
  `userData/data/coach/focuses.json`; last 3 groups go into
  `<previous_focuses>`.

What 0.3.0 adds is the WRITE side, mirroring the proven nojohns notes-tier
conventions (see `C:\Users\wizar\Projects\nojohns-test-vault` for a live
example of the target shapes).

## Prior art — the wcs-analyze skill (read this before implementing)

`C:\Users\wizar\Projects\Dance Analysis\wcs-analyze-skill\SKILL.md`, section
"Bridging gaps to your notes", is the product spec the app's read side was
ported from, and it documents the REAL environment the notes folder will be:

- The author's actual notes are an Obsidian vault; WCS lesson notes live
  under `West Coast Swing/` with filenames `<Instructor> <date>.md`
  (`Keerigan 6-20-25.md`, `keerigan and mia 2-27-26.md`) — instructor + date
  for citations are parsed FROM THE FILENAME. The user will point the app at
  that subtree (scoping = whichever folder they pick; the app never needs
  the skill's "exclude Ballroom/" rule because the user just points deeper).
- The skill retrieves via Obsidian MCP (search_vault_simple + get_backlinks
  on hub notes like `Movement - Concepts.md` + get_vault_file);
  `excerpts.ts`/`hubmap.ts` is the deliberate MCP-free grep port of the same
  hub map. Hub-backlink expansion is the one retrieval trick the app lacks —
  possible future upgrade, not 0.3.0 scope.
- Recommendation shape (already reflected in prompts/coach-system.md):
  stat finding → cited instruction (quoted/paraphrased) with lesson + date →
  suggested practice focus. Same never-invent guardrails.
- The skill WRITES `<video_stem>_practice_notes.txt` next to the report —
  not into the vault. 0.3.0's writer is exactly the "write it back" step the
  skill never had.

Real-vault consequences for the writer: app-written files must not
masquerade as lesson notes (keep them under `Sessions/` + `generator:
refframe` frontmatter — never `<Instructor> <date>.md`-shaped names), and
plain atomic file writes are Obsidian-sync-safe (Obsidian picks up external
edits; no vault index to maintain).

## Design

### 1. Writer engine — `src/main/notes/writer.ts`

Marker-delimited managed blocks, namespaced `refframe` (nojohns pattern):

```
<!-- refframe:begin <kind> <key> -->
...app-owned content...
<!-- refframe:end <kind> <key> -->
```

Rules (all unit-testable with temp dirs, no Electron imports — same
`baseDir`-parameter pattern as `src/main/pros.ts`):

- **Upsert by (kind, key)**: if the block exists anywhere in the file,
  replace its contents in place; else append to the end. Idempotent —
  re-analyzing the same run updates its block, never duplicates it.
- **Everything outside our markers is untouchable.** Preserve foreign
  content byte-for-byte (the test vault's README doubles as the canary).
- Atomic writes (tmp + rename, like `_atomic_write_text` / pros.ts).
- New files get YAML frontmatter with `generator: refframe` plus date.
- Never delete or rename files; never write outside the configured folder.

### 2. What gets written, and when

- **`Sessions/YYYY-MM-DD.md`** (date = the run's analyzed-at date):
  - kind `run`, key = runId — written after an analysis completes (in the
    `engine:analyze` handler, post-result): video title, options
    (role/partner/spotlight), coverage, the compact metrics/gap summary
    (reuse the report's SUMMARY FLAGS + top gap rows; keep it a short
    markdown table like nojohns' session block, not the whole report).
  - kind `coach`, key = runId — written after `coach:report` resolves:
    headline + the per-gap advice prose (the parsed `prose`/`gaps` from
    `parseAdvice`), like nojohns' coach block.
- **`Progress.md`**:
  - kind `focuses`, key `current` — mirror of the last focuses.json groups,
    rewritten whenever the user saves focuses. focuses.json stays the source
    of truth (the coach prompt keeps reading it, not the notes file).
  - (Optional, phase 2) kind `progress`, key `trend` — small
    metrics-over-time table across library runs. Cut if effort runs long.

### 3. Opt-in write toggle

New config key `notesWriteEnabled` (boolean, default **false**). Reading is
implicit whenever `notesFolder` is set (unchanged); writing only happens when
the toggle is on. Settings: checkbox under the notes-folder field, copy along
the lines of "Also write session summaries and coach notes into this folder".
Rationale: users may point the app at a precious real vault — read-only must
be the safe default. Config migration: absent key → false.

### 4. Reader adjustment (avoid self-echo)

`excerpts.ts` must skip lines inside `refframe:begin run` blocks — otherwise
the coach gets our own metric tables quoted back as if they were the
dancer's notes. Lines inside `coach` and `focuses` blocks stay ELIGIBLE:
prior advice and commitments are exactly the "fixes and focuses" the coach
should build on (the bullet filter already excludes most prose anyway).
Add a test.

### 5. UI

- Settings: the write toggle (above).
- Coach view already surfaces `notesConfigured` via `coach:status` — extend
  the status line to distinguish read-only vs read+write if trivial.
- No in-app notes browser/editor. Out of scope.

## Test vault

`C:\Users\wizar\Projects\refframe-test-notes` (sibling of the repo, NOT
committed — the app writes into it during testing; nojohns-test-vault is the
precedent). Created 2026-07-16 with: README canary, `Lessons/` and
`Practice/` markdown containing bullets that hit hubmap terms (sink,
compression, anchor, roll through the foot, hip hinge, …) so `<practice_notes>`
actually fires. The app's `Sessions/` + `Progress.md` should appear there
once the writer lands. Never point dev builds at the real vault until the
writer has proven itself here (upsert idempotence + canary intact).

## Phases

1. `writer.ts` + unit tests (upsert, preservation, atomicity, frontmatter).
2. Wire writes: analyze-complete `run` block; coach-report `coach` block;
   focuses-save `focuses` block. Config key + Settings toggle + migration.
3. Reader skip-own-blocks + test.
4. Live pass against the test vault: analyze (writes appear) → re-analyze
   (upserted, not duplicated) → coach report (coach block + excerpts cite the
   seeded lesson bullets) → README canary untouched.
5. (Stretch) Progress.md trend table.

Bump `package.json` to 0.3.0 when work starts. Release flow unchanged
(checklist → tag → CI builds/drafts → publish with latest.yml).

## Out of scope

Obsidian MCP/plugin integration, in-app note editing, notes sync/conflict
handling beyond atomic single-file writes, reading non-markdown formats.
