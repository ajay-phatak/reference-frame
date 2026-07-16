# Release checklist — human pass

Run this against the **packaged app** (installer build, not `npm run dev`)
before tagging a release. Steps are ordered so each one's output feeds the
next; a full pass takes ~45-60 min, most of it waiting on analyses you can
leave unattended. Check items off as you go.

## 0. Install

- [ ] `npm run build:win`, then run the NSIS installer from `dist/`
      (on the dev machine is fine for the pre-tag pass; the clean-machine
      install is a separate post-tag step).
- [ ] Installer and installed app show the Reference Frame icon (viewfinder
      + dancer skeleton), not the No Johns icon — check the installer exe,
      the Start Menu entry, the taskbar while running, and the window title
      bar.

## 1. Onboarding (fresh state)

If the app has run before: delete `%APPDATA%\reference-frame` first so
onboarding triggers. (This wipes your library and coach key — expected.)

- [ ] Onboarding appears; role/side/partner questions save correctly
      (verify later in Settings).
- [ ] Weight download shows per-model progress and completes (~260 MB).
      If your network hiccups, progress should resume, not restart from 0%.
- [ ] "Set up later" path: if testing it, an analyze afterwards must
      trigger the download instead of failing.

## 2. Analyze — local file (normal path)

Use a practice video with just you and your partner in frame.

- [ ] File picker opens, options (side, role, partner name, spotlight,
      pose model) reflect your onboarding defaults.
- [ ] Per-stage progress bars advance through extract → refine → lift →
      metrics → report (first run also compiles numba — a long quiet
      stretch on the first analyze ever is expected).
- [ ] Report renders: report text, colorized gap table vs pros, coverage
      banner only if coverage < 80%.
- [ ] **Cancel check**: start a second analyze of the same file and cancel
      mid-extract. Re-running afterwards must work (no corrupt cache) and
      should be *faster* (poses cache reused) if cancel came after extract
      finished.

## 3. Analyze — YouTube URL

- [ ] Paste a YouTube URL (a short two-dancer WCS clip). Download progress
      shows, then the same pipeline as step 2.
- [ ] Report header shows the video's real YouTube title, not the bare id.

## 4. Crowded floor — seed picker

Use social-dance footage with other couples in frame.

- [ ] "Crowded floor" toggle → timestamp entry → numbered-people frame
      appears; clicking boxes (or entering numbers) selects you + partner.
- [ ] Analysis with the seed completes and tracks the right people.

## 5. Report actions

- [ ] "Not me? Swap dancers" re-runs quickly (cached poses) and the report
      flips to the other dancer.
- [ ] "Open folder" opens the run's library folder.
- [ ] "Ask the coach" jumps to the Coach view with this run pre-selected.

## 6. Library

- [ ] All runs from steps 2-5 are listed; opening one shows its report.
- [ ] Delete a run; it disappears and its folder is gone from
      `%APPDATA%\reference-frame\data\library`.

## 7. Coach (both backends)

- [ ] **CLI backend**: with Claude Code installed and no API key set,
      generate a coach report on a real run. It streams, cites actual
      numbers from the report, and ends with editable focus cards.
      "Save focuses" persists them (check they show as "previous focuses"
      context on the next coach run).
- [ ] **API backend**: set an API key in Settings (shows `last4` only),
      generate a report, and verify the cost readout is sane (a few cents).
- [ ] Chat follow-up works after a report (session context retained).
- [ ] Practice notes: point Settings at a markdown notes folder, coach a
      run, and confirm citations only reference real bullets from your
      notes (never invented lessons/instructors).

## 8. Settings

- [ ] Defaults changed here stick across an app restart.
- [ ] Clearing the API key reverts coach to CLI/unconfigured state.

## 9. Pre-tag hygiene

- [ ] `npm run typecheck`, `npm test`, and `engine\.venv\Scripts\python.exe
      -m pytest engine\tests -q` all green.
- [ ] `git status` clean; version bumped in `package.json`.
- [ ] README install instructions match what you just experienced
      (installer size, SmartScreen wording, weight-download size).

Only tag `v*` after every box above is checked. The post-tag steps
(publish the draft release with `latest.yml`, clean-machine install test,
SmartScreen "Run anyway" walkthrough) live in CLAUDE.md's release notes.
