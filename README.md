# Reference Frame

**See your dancing the way a coach would.** Reference Frame is a desktop app for West Coast Swing dancers that analyzes your practice or competition videos — pose extraction, 3D motion reconstruction, and movement metrics — and shows you exactly where your dancing diverges from a library of pro baselines. Point it at a local video file or a YouTube link; get a report with objective numbers (frame, connection, floor use, timing) and a gap analysis against the pros, plus an optional AI coach that reads the report and gives you a written coaching take.

## Download

**[Get the latest release (Windows)](https://github.com/ajay-phatak/reference-frame/releases/latest)** — download the `-setup.exe` under Assets and run it.

> The installer is large (roughly 600–800 MB) because it bundles a full CPU build of PyTorch and the computer-vision engine — no separate Python install is needed.

> **Windows SmartScreen note:** the installer isn't code-signed, so Windows will warn about an unknown publisher. Click **More info → Run anyway**.

Windows-only for now.

## First run

On first launch, onboarding walks you through a couple of quick preferences (your role, your usual starting side, partner name) and then downloads the analysis model weights — YOLO (person detector), RTMPose (pose refiner), and VideoPose3D (3D lifter), about 260 MB total. This is required and one-time; you can defer it and it'll download automatically the first time you run an analysis instead.

## Features

- **Analyze a video or a YouTube URL.** Point Reference Frame at a local file or paste a YouTube link and it runs the full pipeline: pose extraction, keypoint refinement, 3D lift, and metrics computation.
- **Crowded-floor seed picker.** If your video has other dancers in frame, a two-step flow lets you pick yourself and your partner out of a detected-people frame before the full analysis runs.
- **Report + gap analysis vs. pros.** Every run produces a report of your movement metrics alongside a comparison against bundled pro baselines, so you can see specific, numeric gaps rather than vague notes.
- **Library.** Every analyzed run is saved locally with its report, status, and options, so you can revisit past sessions.
- **Swap dancers.** If the analysis picked up the wrong person as "you," re-run against the other detected dancer without redoing pose extraction from scratch.
- **AI coach (optional).** Generate a written coaching read on any analyzed run, then chat about the details. Two backends:
  - **Anthropic API key** — bring your own key, stored encrypted via Windows DPAPI (never in plaintext config); you pay Anthropic directly, a report costs a few cents.
  - **Local Claude Code CLI** — if you have Claude Code installed and logged into a Pro/Max plan, the coach runs through it instead, billed against your existing plan with no API key needed.
- **Practice notes (optional).** Point Settings at a folder of your own markdown lesson notes and the coach will cite relevant bullets from your own instructors when discussing a gap — it's read-only, nothing is written there.

## Expectations

The engine runs entirely on CPU — no GPU required, none used. As a rough guide, a 3-minute video takes about 10–20 minutes to analyze, depending on your hardware. Windows-only for now.

## Licensing

Reference Frame is **AGPL-3.0** (a consequence of bundling [ultralytics](https://github.com/ultralytics/ultralytics), which is itself AGPL). The app is free to use and strictly non-commercial.

The VideoPose3D pretrained weights are licensed **CC-BY-NC-4.0** by their authors. They are **never bundled with the installer or committed to this repository** — they're downloaded directly from their source on first run (or first analysis) only, straight to your machine. Reference Frame does not redistribute them through any channel it controls.

## How it works

Reference Frame is an Electron + React shell around a stateless Python analysis engine, shipped as a frozen PyInstaller sidecar (no Python install required). The app spawns the engine per job and speaks NDJSON over stdout — one JSON event per line (progress, log, result, error) — so the UI can show live per-stage progress without the engine holding any state between runs. All engine state (model weights, caches) lives under the app's own data directory.

### Dev quickstart

```
npm install
npm run dev
```

The Python engine is built separately and expected to exist before packaging:

```
scripts/build-engine.ps1   # PyInstaller build -> engine/dist/refframe-engine/
npm run build:win          # packages the installer, engine included
```
