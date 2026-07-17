# v0.3.1 plan — macOS build (Apple Silicon)

Goal: ship a mac dmg alongside the Windows installer from the same tag.
Decisions locked 2026-07-16: **arm64 only** (Intel Macs are EOL and the pose
pipeline would crawl on them), **unsigned** (ad-hoc signature; no Apple
Developer account yet — document the right-click → Open step), and the
maintainer has a Mac for the human checklist pass.

## Current state — what's already cross-platform

- Renderer/preload entirely; safeStorage maps to Keychain on mac (the DPAPI
  invariant in CLAUDE.md is Windows wording, same guarantee).
- coach/cli.ts detection already branches on `process.platform`.
- notes writer/excerpts are pure path ops; `window-all-closed` already
  special-cases darwin; the passive update check is version-string only.
- The PyInstaller spec is platform-neutral: on mac the exe is named
  `refframe-engine` (no suffix) automatically, and PyInstaller ad-hoc signs
  arm64 binaries by default — nothing in the spec needs forking.

## What's Windows-only today

- `src/main/engine.ts` — hardcoded `refframe-engine.exe` (packaged) and
  `engine/.venv/Scripts/python.exe` (dev).
- `scripts/build-engine.ps1` — PowerShell, `py -3.12` launcher, `+cpu` torch
  wheel tags (those local-version tags don't exist for mac wheels),
  `Scripts\` venv layout, `.exe` existence checks.
- `.github/workflows/release.yml` — single `windows-latest` job.
- `electron-builder.yml` — no `mac` section.
- `docs/release-checklist.md` — Windows paths/wording only.
- `build/` — icon.ico + icon.png only (no icns; electron-builder converts
  icon.png if it's ≥512px — verify, regenerate if smaller).

## Design

1. **engine.ts platform branch.** Packaged: binary name without `.exe` on
   non-win32. Dev: try `engine/.venv/bin/python` on posix,
   `engine/.venv/Scripts/python.exe` on Windows, fall back to `python`.
2. **`scripts/build-engine.sh`** — bash port of build-engine.ps1 with the
   SAME step order and assertions: build venv (python3.12), torch/torchvision
   pinned 2.11.0/0.26.0 (default PyPI — mac wheels are already CPU/MPS, no
   CUDA variant exists, so the `--index-url whl/cpu` dance is Windows-only),
   engine + pyinstaller install, the opencv-contrib repair + `cv2 == 4.13.0`
   assert, pyinstaller freeze, and the doctor smoke that tolerates exit 0/1
   but fails on anything else (frozen-import canary, incl. numba/llvmlite).
   Keep the ps1 untouched — two scripts, one per build OS.
3. **electron-builder.yml `mac` section** — `target: dmg` on `arm64`,
   `artifactName: reference-frame-${version}-${arch}.${ext}`. Do NOT set
   `identity` — leaving it unset lets electron-builder fall back to ad-hoc
   signing, which arm64 REQUIRES to launch at all (`identity: null` would
   skip signing entirely and the kernel kills unsigned arm64 binaries).
4. **release.yml `build-mac` job** — `macos-latest` (arm64 runners), python
   3.12 + node 20, `bash scripts/build-engine.sh`, `npm ci`, `npm test`,
   `npm run build:mac` with GH_TOKEN (publishes the dmg + latest-mac.yml
   into the same draft on tag builds; skips publish on workflow_dispatch).
   Align `build:mac` in package.json to run typecheck like `build:win` does.
5. **Gatekeeper docs** — README install section + release-notes snippet:
   unsigned app, first launch is right-click → Open (or
   `xattr -cr "/Applications/Reference Frame.app"`).
6. **Release checklist mac addendum** — dmg mount + Gatekeeper step, fresh
   state dir is `~/Library/Application Support/reference-frame`, engine
   spawn + weights download + one full analyze on the Mac.

## Parity caveat (accepted)

The golden-diff contract (byte-identical reports vs the source pipeline) is
defined on Windows. arm64 float ops/BLAS may differ in the last bit, so mac
reports are NOT promised byte-identical to Windows reports of the same video.
The mac build is validated by the CI doctor smoke + the human checklist pass
instead. Engine code itself stays byte-identical (vendoring contract is about
source, not output platform).

## Validation path (dev machine is Windows)

1. Local: typecheck/tests, `bash -n` the new script.
2. CI: push a branch, `workflow_dispatch` the release workflow against it —
   proves the macos engine build + dmg packaging end-to-end without tagging
   (electron-builder only publishes on tag builds).
3. Maintainer: dev-mode spot check + full release-checklist pass on the Mac
   (packaged dmg) before tagging v0.3.1.

## Out of scope

Intel/universal builds, real signing/notarization, electron-updater
auto-update (mac needs signing for it anyway), MPS acceleration, Linux.
