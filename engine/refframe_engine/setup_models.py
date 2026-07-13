"""First-run model download (the `setup` subcommand).

All three model families are downloaded on first run — none are redistributed in
the installer (YOLOv8 is AGPL; VideoPose3D weights are CC-BY-NC-4.0, so they must
NEVER be bundled). Everything here is idempotent: present files are skipped.

  * YOLOv8 pose weights (pass 1)      → <data-dir>/models/yolov8{letter}-pose.pt
  * RTMPose Halpe-26 ONNX (pass 2)    → rtmlib cache (env-redirected in cli.py)
  * VideoPose3D checkpoint (pass 3)   → <data-dir>/models/videopose3d/

cli.py is expected to have already set YOLO_CONFIG_DIR / NUMBA_CACHE_DIR /
rtmlib cache env and monkeypatched pose_lift.CHECKPOINT_DIR before calling here.
"""

import os
import time
import urllib.error
import urllib.request

from . import events, paths

# ultralytics publishes pose weights as GitHub release assets on the
# `ultralytics/assets` repo. Pinned to the exact tag ultralytics 8.4.39's
# `attempt_download_asset` uses by default for this release line (verified:
# `ultralytics.utils.downloads.attempt_download_asset` default `release="v8.4.0"`
# in the pinned venv, and a HEAD request against
# .../releases/download/v8.4.0/yolov8m-pose.pt resolves 200). One older tag is
# kept as a fallback in case the v8.4.0 release assets ever move.
_ASSET_TAGS = ("v8.4.0", "v8.3.0")
_ASSET_BASE = "https://github.com/ultralytics/assets/releases/download"

# Transient network failures (e.g. WinError 10054 connection resets against
# dl.fbaipublicfiles.com / GitHub release assets) get retried before giving up.
_DOWNLOAD_ATTEMPTS = 3
_RETRY_BACKOFF_SEC = 2.0


def _download(url, dest, stage, attempts=_DOWNLOAD_ATTEMPTS):
    """urlretrieve with an NDJSON progress reporthook and retry-with-backoff.
    Writes to a .part file then renames, so an interrupted download never
    leaves a truncated weight.

    Network failures (URLError/OSError — urlretrieve raises these for DNS,
    connection-reset, and timeout errors alike) are retried `attempts` times
    with a short backoff, then re-raised as a RuntimeError so callers (and the
    CLI's `download_failed` error code) see a typed failure instead of a bare
    OSError, which would otherwise bypass the RuntimeError handler."""
    tmp = f"{dest}.part"

    def _hook(count, block_size, total_size):
        if total_size > 0:
            events.progress(stage, min(count * block_size, total_size), total_size)

    last_err = None
    for attempt in range(1, attempts + 1):
        try:
            urllib.request.urlretrieve(url, tmp, reporthook=_hook)
            os.replace(tmp, dest)
            return
        except (OSError, urllib.error.URLError) as e:
            last_err = e
            try:
                os.remove(tmp)
            except OSError:
                pass
            if attempt < attempts:
                events.log(f"Download attempt {attempt}/{attempts} failed ({e}); retrying …",
                           level="warning")
                time.sleep(_RETRY_BACKOFF_SEC * attempt)
    raise RuntimeError(f"Download failed after {attempts} attempts: {url} ({last_err})") from last_err


def ensure_yolo_weights(data_dir, pose_letter="m"):
    """Download the YOLOv8 pose weights for `pose_letter` into the models dir."""
    dest = paths.yolo_weights_path(data_dir, pose_letter)
    filename = os.path.basename(dest)
    if os.path.exists(dest):
        events.log(f"YOLO weights present: {filename}")
        return {"component": "yolo", "path": dest, "downloaded": False}

    paths.ensure_dir(paths.models_dir(data_dir))
    last_err = None
    for tag in _ASSET_TAGS:
        url = f"{_ASSET_BASE}/{tag}/{filename}"
        try:
            events.log(f"Downloading {filename} ({tag}) …")
            _download(url, dest, "weights")
            return {"component": "yolo", "path": dest, "downloaded": True, "tag": tag}
        except Exception as e:                 # noqa: BLE001 — try the next tag
            last_err = e
            continue
    raise RuntimeError(f"Could not download {filename}: {last_err}")


def ensure_rtmpose(data_dir, refine_mode="balanced"):
    """Trigger rtmlib's RTMPose fetch by instantiating the wrapper the same way
    pose_refine does. rtmlib downloads+caches the ONNX on first construction."""
    import pose_refine as pr
    events.progress("weights", 0, 1, detail="rtmpose")
    events.log(f"Fetching RTMPose ({refine_mode}) via rtmlib …")
    # Building the model downloads the checkpoint into the rtmlib cache dir
    # (redirected by cli.py's env setup). Idempotent — rtmlib skips if cached.
    # rtmlib downloads via plain urllib too, so the same transient-failure
    # retry treatment applies here as in _download.
    last_err = None
    for attempt in range(1, _DOWNLOAD_ATTEMPTS + 1):
        try:
            pr._load_pose_model(refine_mode, "cpu")
            break
        except (OSError, urllib.error.URLError) as e:
            last_err = e
            if attempt < _DOWNLOAD_ATTEMPTS:
                events.log(f"RTMPose fetch attempt {attempt}/{_DOWNLOAD_ATTEMPTS} failed "
                           f"({e}); retrying …", level="warning")
                time.sleep(_RETRY_BACKOFF_SEC * attempt)
    else:
        raise RuntimeError(f"Could not fetch RTMPose weights: {last_err}") from last_err
    events.progress("weights", 1, 1, detail="rtmpose")
    return {"component": "rtmpose", "mode": refine_mode, "cache": paths.rtmlib_cache_dir(data_dir)}


def ensure_videopose3d(data_dir):
    """Download the VideoPose3D checkpoint into the models dir (CC-BY-NC — never
    bundled). Relies on cli.py having monkeypatched pose_lift.CHECKPOINT_DIR."""
    import pose_lift as pl
    dest = pl.CHECKPOINT_DIR / os.path.basename(pl.CHECKPOINT_URL)
    if dest.exists():
        events.log(f"VideoPose3D checkpoint present: {dest.name}")
        return {"component": "videopose3d", "path": str(dest), "downloaded": False}

    events.progress("weights", 0, 1, detail="videopose3d")
    events.log("Downloading VideoPose3D checkpoint …")
    pl.CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)
    _download(pl.CHECKPOINT_URL, str(dest), "weights")
    events.progress("weights", 1, 1, detail="videopose3d")
    return {"component": "videopose3d", "path": str(dest), "downloaded": True}


def setup(data_dir, pose_letter="m", refine_mode="balanced"):
    """Download every model needed for a run. Emits a result event kind "setup"."""
    paths.ensure_dir(paths.models_dir(data_dir))
    results = {}
    results["yolo"] = ensure_yolo_weights(data_dir, pose_letter)
    results["rtmpose"] = ensure_rtmpose(data_dir, refine_mode)
    results["videopose3d"] = ensure_videopose3d(data_dir)
    events.result(kind="setup", data_dir=paths.resolve_data_dir(data_dir), components=results)
    if not events.enabled:
        print("Setup complete.")
        for name, r in results.items():
            print(f"  {name}: {r}")
    return results
