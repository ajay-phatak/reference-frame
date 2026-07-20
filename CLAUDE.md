# Reference Frame — dev notes

Electron + React (electron-vite) shell around a vendored Python video-analysis
engine (pose extraction → refine → 3D lift → WCS metrics), shipped as a
PyInstaller sidecar. Windows-first. AGPL-3.0.

## Commands

- `npm run dev` — dev app. The `-w` flag is load-bearing: without it, main/
  preload changes don't restart Electron and the window calls IPC handlers
  that don't exist yet (symptom: blank screen).
- `npm run typecheck` — run after any TS change.
- `npm test` — vitest.
- `scripts/build-engine.ps1` — PyInstaller build → `engine/dist/refframe-engine/`.
  Pinned to Python 3.12. Build venv must install CPU-only torch
  (`--index-url .../whl/cpu`) or the bundle balloons with CUDA. Dev engine
  venv lives at `engine/.venv/` (created manually, not by this script).
- `npm run build:win` — installer; expects the engine build to exist first.
- Release: complete the human pass in `docs/release-checklist.md` FIRST
  (the user walks the packaged app end-to-end — never tag without it),
  then bump `package.json` version, tag `v*`, push the tag — GitHub
  Actions builds and drafts the release. electron-builder often leaves a
  duplicate partial draft: publish the one WITH `latest.yml`, delete the stub.

## Architecture invariants

- Engine is a STATELESS spawn-per-job CLI (`engine/refframe_engine/`, entry
  `cli.py`: analyze | seed-preview | setup | doctor | export-baseline). The
  app always passes `--ndjson` (one JSON event per line on stdout:
  progress/log/result/error) and `--data-dir` (all engine state — model
  weights, caches — lives under the app's userData). Engine stays stateless
  and arg-driven — config lives only in the app. Multi-step flows (e.g. seed
  picking) are TWO invocations, never one long-lived process.
- Without `--ndjson` the engine keeps its original human CLI behavior — keep
  it that way; it's how engine changes get golden-diffed against the source
  pipeline.
- The engine is VENDORED from the private pipeline at
  `C:\Users\wizar\Projects\Dance Analysis`. Vendoring contract:
  - `dance_metrics.py`, `dance_review.py`, `videopose3d_model.py`,
    `pose_lift.py` stay BYTE-IDENTICAL to the source (pose_lift's
    CHECKPOINT_DIR is monkeypatched from cli.py, never edited in-file).
  - `pose_extraction.py`, `pose_refine.py` carry exactly one additive
    `progress_cb=None` kwarg each — the only allowed deviation.
  - When engine analysis behavior changes, verify with a golden diff: run
    the source pipeline and the vendored engine on the same video with
    identical flags; the report txt must stay byte-identical.
- Pro baselines are precomputed METRICS JSON (KB-scale) — never pro videos
  or pose files. They are USER-SUPPLIED (0.2.0+): the app manages
  `userData/pro_baselines/` (manifest + metrics files, `src/main/pros.ts`)
  and passes `--pro-refs` only when ≥1 pro exists; nothing is bundled.
  Both sides of a gap comparison must go through the same metrics code
  path. A manifest entry's `lead_id` is the RAW track id in the saved
  poses cache (written pre-orientation) — the add-pro flow gets it from
  the analyze result's `you_id_raw` with the lead seeded as "me",
  role=lead.
- Renderer never sees secrets or spawns processes; all engine/IPC work is in
  `src/main/`, typed in `src/preload/index.d.ts`.
- Anthropic API key lives ONLY as safeStorage (DPAPI) ciphertext in
  `userData/coach.key` — deliberately NOT in config.json so the renderer can
  never see or clobber it. The renderer sees `{configured, last4}` only;
  plaintext crosses IPC only inbound on set.
- Coach CLI backend (`src/main/coach/cli.ts`): spawns the user's local
  Claude Code headless; ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN are
  STRIPPED from the child env so it can't silently bill API credits; the
  prompt goes over stdin (never argv); cwd is an isolated directory. Never
  lift Claude Code's OAuth token for direct API calls (ToS).

## Licensing invariants (load-bearing — do not "optimize" these away)

- VideoPose3D pretrained weights are CC-BY-NC-4.0: download-on-first-run
  ONLY (`setup` subcommand). NEVER bundle them in the installer, commit
  them, or redistribute them through any channel we control.
- All model weights (YOLO, RTMPose, VideoPose3D) follow the same uniform
  first-run download policy into `--data-dir` — no exceptions, so no
  redistribution questions arise.
- ultralytics is AGPL → this repo is AGPL-3.0. The app stays free and
  non-commercial.

## Gotchas

- PowerShell 5.1: native stderr + `$ErrorActionPreference=Stop` = spurious
  failures — use the Invoke-Step pattern (see scripts/build-engine.ps1).
  Also: no `&&`/`||` chaining, `Out-File` defaults to UTF-16 — pass
  `-Encoding utf8` for files other tools read.
- Vendored pipeline modules `print()` freely — NDJSON mode must keep stdout
  clean (stdout shim redirects prints to log events). Any new engine code
  must never print to raw stdout in NDJSON mode.
- yt-dlp cannot be shelled out to (`[sys.executable, -m yt_dlp]` is
  impossible frozen) — it runs in-process via the `yt_dlp.YoutubeDL` API
  with `ffmpeg_location` from `imageio_ffmpeg`.
- Biggest PyInstaller risk is librosa → numba/llvmlite; keep the frozen
  `beat_track` smoke test working.
- Runtime env for the frozen engine: `YOLO_CONFIG_DIR`, `NUMBA_CACHE_DIR`
  point into `--data-dir` (ultralytics/numba otherwise write to protected
  or roaming locations).
- Never commit personal data: videos, pose caches, run outputs. The
  .gitignore blocks the file types. (Pro baselines are no longer in the
  repo at all — they live in each user's userData.)

## Roadmap state

v0.1.0/v0.2.0/v0.3.0 tagged 2026-07-16 (full app → user-managed Pros
tab → notes-folder write side per docs/plan-0.3.0-practice-notes.md:
marker-block writer + opt-in notesWriteEnabled toggle, Sessions/ +
Progress.md blocks, reader skips own `run` blocks). v0.3.1 tagged
2026-07-17: macOS build, Apple Silicon dmg, unsigned/ad-hoc
(docs/plan-0.3.1-mac.md; build-engine.sh is the mac twin of the ps1;
arm64 reports not promised byte-identical to Windows). v0.4.0 planned
(docs/plan-0.4.0-structured-reports.md): metric registry + structured
report cards with explainers, gap bars with multi-pro bands, run A/B
comparison, analyze queue — app-side only, no engine changes. Backlog:
video playback with beat-synced seeking (target 0.5.0); cross-run
trends dashboard + Progress.md metrics trend table (post-0.5.0); real
mac signing/notarization; hub-backlink retrieval upgrade (0.3.0 plan
§prior art).
