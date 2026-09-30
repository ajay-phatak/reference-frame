"""First-run model download (the `setup` subcommand).

All three model families are downloaded on first run — none are redistributed in
the installer (YOLOv8 is AGPL; VideoPose3D weights are CC-BY-NC-4.0, so they must
NEVER be bundled). Everything here is idempotent: present files are skipped.

  * YOLOv8 pose weights (pass 1)      → <data-dir>/models/yolov8{letter}-pose.pt
  * RTMPose Halpe-26 ONNX (pass 2)    → rtmlib cache (env-redirected in cli.py)
  * VideoPose3D checkpoint (pass 3)   → <data-dir>/models/videopose3d/

cli.py is expected to have already set YOLO_CONFIG_DIR / NUMBA_CACHE_DIR /
rtmlib cache env and monkeypatched pose_lift.CHECKPOINT_DIR before calling here.

Every download goes through `_download` (tmp .part + Content-Length check +
retries + resume) — including RTMPose, whose zip we fetch ourselves into the
exact path rtmlib checks, so rtmlib's own unchecked downloader never runs. The
analyze preflight (`ensure_all`) uses the same functions so the vendored
pose_lift never has to do its non-atomic urlretrieve.
"""

import errno
import http.client
import os
import shutil
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

from . import events, paths
from .download import DownloadError

# A stalled connection must never hang a download forever. Our own urlopen
# passes a timeout, but rtmlib / other libs rely on the socket default. Applied
# only on the setup / analyze paths (see set_download_timeout).
DOWNLOAD_SOCKET_TIMEOUT = 60.0

# Sanity floors for "obviously truncated" detection (doctor + preflight). The
# VideoPose3D checkpoint is ~67.9 MB; RTMPose ONNX files are tens of MB.
VIDEOPOSE3D_MIN_BYTES = 50_000_000
RTMPOSE_ONNX_MIN_BYTES = 1_000_000

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

_NO_SPACE_MSG = "Not enough disk space to download model files. Free up space and try again."


def set_download_timeout(seconds=DOWNLOAD_SOCKET_TIMEOUT):
    socket.setdefaulttimeout(seconds)


def _remove_quiet(path):
    try:
        os.remove(path)
    except OSError:
        pass


def _crange_total(headers):
    """Total byte size out of a Content-Range header ("bytes 0-99/1234" or
    "bytes */1234"), or 0 when absent/unknown ("bytes */*")."""
    crange = headers.get("Content-Range", "") if headers else ""
    try:
        return int(crange.rsplit("/", 1)[1]) if "/" in crange else 0
    except ValueError:
        return 0


def _fetch_with_resume(url, tmp, stage):
    """Stream url into tmp, resuming from tmp's current size via a Range
    request when the server supports it (dl.fbaipublicfiles.com does — it
    answers 206). A connection cut mid-transfer therefore costs only the
    remainder, not a from-zero restart of a 170 MB file. Raises OSError (or a
    urllib/http.client error) on any failure, including a body shorter than
    the advertised length, so the caller's retry loop fires."""
    have = os.path.getsize(tmp) if os.path.exists(tmp) else 0
    req = urllib.request.Request(url)
    if have:
        req.add_header("Range", f"bytes={have}-")
    with urllib.request.urlopen(req, timeout=60) as resp:
        if resp.status == 206:
            total = _crange_total(resp.headers)
            mode = "ab"
        else:
            # Server ignored the range (or fresh download): start over.
            have = 0
            total = int(resp.headers.get("Content-Length") or 0)
            mode = "wb"
        done = have
        with open(tmp, mode) as fh:
            while True:
                chunk = resp.read(1 << 20)
                if not chunk:
                    break
                fh.write(chunk)
                done += len(chunk)
                if total > 0:
                    events.progress(stage, min(done, total), total)
    if total > 0 and done < total:
        raise OSError(f"connection closed early ({done}/{total} bytes)")


def _download(url, dest, stage, attempts=_DOWNLOAD_ATTEMPTS):
    """Streaming download with NDJSON progress, retry-with-backoff, and
    Range-resume across retries. Writes to a .part file then renames, so an
    interrupted download never leaves a truncated weight; the .part survives
    failed attempts (and even a failed run) precisely so resume has something
    to build on — only bytes from 200/206 responses are ever written to it.
    A `<dest>.part.url` sidecar records which URL the .part came from, so
    bytes from a different asset are never resumed into.

    Network failures (URLError/OSError/HTTPException — DNS, connection-reset,
    timeout, and short-body errors alike) are retried `attempts` times with a
    short backoff, then raised as DownloadError. A full disk (ENOSPC) fails
    fast — retrying can't help."""
    tmp = f"{dest}.part"
    marker = f"{tmp}.url"

    # Drop a leftover .part that belongs to a different URL.
    if os.path.exists(tmp):
        try:
            with open(marker, "r", encoding="utf-8") as fh:
                same = fh.read().strip() == url
        except OSError:
            same = False
        if not same:
            _remove_quiet(tmp)
    try:
        with open(marker, "w", encoding="utf-8") as fh:
            fh.write(url)
    except OSError as e:
        if e.errno == errno.ENOSPC:
            raise DownloadError(_NO_SPACE_MSG) from e
        raise DownloadError(f"Cannot write to the models folder: {e}") from e

    last_err = None
    for attempt in range(1, attempts + 1):
        try:
            _fetch_with_resume(url, tmp, stage)
            os.replace(tmp, dest)
            _remove_quiet(marker)
            return
        except urllib.error.HTTPError as e:
            if e.code == 416 and os.path.exists(tmp):
                # Requested range not satisfiable: usually the .part already
                # holds the whole file (a previous run finished the stream but
                # died before the rename). A 416 carries "Content-Range:
                # bytes */<total>" — promote ONLY if the total is known and
                # equals the .part size; otherwise the .part is bogus, drop it
                # and retry fresh.
                total = _crange_total(e.headers)
                if total > 0 and total == os.path.getsize(tmp):
                    os.replace(tmp, dest)
                    _remove_quiet(marker)
                    return
                os.remove(tmp)
            last_err = e
        except (OSError, urllib.error.URLError, http.client.HTTPException) as e:
            if getattr(e, "errno", None) == errno.ENOSPC:
                raise DownloadError(_NO_SPACE_MSG) from e
            last_err = e
        if attempt < attempts:
            events.log(f"Download attempt {attempt}/{attempts} failed ({last_err}); retrying …",
                       level="warning")
            time.sleep(_RETRY_BACKOFF_SEC * attempt)
    raise DownloadError(f"Download failed after {attempts} attempts: {url} ({last_err})") from last_err


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
        # Never let bytes from one release asset be resumed into another's.
        _remove_quiet(f"{dest}.part")
        _remove_quiet(f"{dest}.part.url")
        try:
            events.log(f"Downloading {filename} ({tag}) …")
            _download(url, dest, "weights")
            return {"component": "yolo", "path": dest, "downloaded": True, "tag": tag}
        except Exception as e:                 # noqa: BLE001 — try the next tag
            last_err = e
            if "disk space" in str(e):         # ENOSPC: another tag can't help
                break
            continue
    raise DownloadError(f"Could not download {filename}: {last_err}") from last_err


# ── RTMPose ──────────────────────────────────────────────────────────────────

def _rtmpose_paths(refine_mode):
    """(url, zip_path, onnx_path, tmp_dir) exactly as rtmlib's
    download_checkpoint derives them: dst_dir = <hub>/checkpoints where
    hub = $TORCH_HOME/hub, TORCH_HOME defaulting to $XDG_CACHE_HOME/rtmlib
    (cli.py assigns XDG_CACHE_HOME=<data-dir>/models and pops TORCH_HOME); the
    zip is the URL basename; the extracted model is <basename up to first
    '.'>.onnx; zips are unpacked via a sibling `tmp` dir and then deleted."""
    import pose_refine as pr
    from rtmlib.tools.file import _get_rtmhub_dir
    url = pr.POSE_MODELS[refine_mode]["url"]
    dst_dir = os.path.join(_get_rtmhub_dir(), "checkpoints")
    filename = os.path.basename(urllib.parse.urlparse(url).path)
    return (url,
            os.path.join(dst_dir, filename),
            os.path.join(dst_dir, filename.split(".")[0] + ".onnx"),
            os.path.join(dst_dir, "tmp"))


def _purge_rtmpose(zip_path, onnx_path, tmp_dir):
    for p in (zip_path, f"{zip_path}.part", f"{zip_path}.part.url", onnx_path):
        _remove_quiet(p)
    shutil.rmtree(tmp_dir, ignore_errors=True)


def _predownload_rtmpose(url, zip_path, onnx_path, tmp_dir):
    """Put a verified RTMPose zip at the exact path rtmlib checks, via the
    robust _download, so rtmlib finds it cached and never runs its own
    unchecked download."""
    if os.path.exists(onnx_path):
        if os.path.getsize(onnx_path) >= RTMPOSE_ONNX_MIN_BYTES:
            return                              # already extracted; rtmlib uses it as-is
        _remove_quiet(onnx_path)                # zero-size / stub model
    shutil.rmtree(tmp_dir, ignore_errors=True)  # stale half-extraction
    if os.path.exists(zip_path) and not zipfile.is_zipfile(zip_path):
        events.log("Cached RTMPose archive is corrupt; re-downloading …", level="warning")
        _remove_quiet(zip_path)
    if not os.path.exists(zip_path):
        paths.ensure_dir(os.path.dirname(zip_path))
        _download(url, zip_path, "weights")
        if not zipfile.is_zipfile(zip_path):
            _remove_quiet(zip_path)
            raise DownloadError(f"Downloaded RTMPose archive is not a valid zip: {url}")


def _is_model_load_error(e):
    return (isinstance(e, (zipfile.BadZipFile, shutil.Error))
            or type(e).__module__.startswith("onnxruntime"))


def ensure_rtmpose(data_dir, refine_mode="balanced"):
    """Make the RTMPose ONNX for `refine_mode` available in the rtmlib cache.
    The zip is fetched with our own _download into the path rtmlib checks;
    building the model then only extracts it. If building fails on a corrupt
    zip / unloadable ONNX, purge the cached files and retry once."""
    import pose_refine as pr
    events.progress("weights", 0, 1, detail="rtmpose")
    events.log(f"Fetching RTMPose ({refine_mode}) …")
    url, zip_path, onnx_path, tmp_dir = _rtmpose_paths(refine_mode)
    try:
        for attempt in (1, 2):
            _predownload_rtmpose(url, zip_path, onnx_path, tmp_dir)
            try:
                pr._load_pose_model(refine_mode, "cpu")
                break
            except Exception as e:             # noqa: BLE001
                if attempt == 2 or not _is_model_load_error(e):
                    raise
                events.log(f"RTMPose model failed to load ({type(e).__name__}: {e}); "
                           "discarding cache and re-downloading …", level="warning")
                _purge_rtmpose(zip_path, onnx_path, tmp_dir)
    except DownloadError:
        raise
    except (OSError, urllib.error.URLError) as e:
        raise DownloadError(f"Could not fetch RTMPose weights: {e}") from e
    except Exception as e:                     # noqa: BLE001
        if _is_model_load_error(e):
            raise DownloadError(f"RTMPose weights are corrupt or unloadable: {e}") from e
        raise
    events.progress("weights", 1, 1, detail="rtmpose")
    return {"component": "rtmpose", "mode": refine_mode, "cache": paths.rtmlib_cache_dir(data_dir)}


def ensure_videopose3d(data_dir):
    """Download the VideoPose3D checkpoint into the models dir (CC-BY-NC — never
    bundled). Relies on cli.py having monkeypatched pose_lift.CHECKPOINT_DIR."""
    import pose_lift as pl
    dest = pl.CHECKPOINT_DIR / os.path.basename(pl.CHECKPOINT_URL)
    if dest.exists() and dest.stat().st_size < VIDEOPOSE3D_MIN_BYTES:
        events.log(f"VideoPose3D checkpoint looks truncated ({dest.stat().st_size} bytes); "
                   "re-downloading …", level="warning")
        _remove_quiet(str(dest))
    if dest.exists():
        events.log(f"VideoPose3D checkpoint present: {dest.name}")
        return {"component": "videopose3d", "path": str(dest), "downloaded": False}

    events.progress("weights", 0, 1, detail="videopose3d")
    events.log("Downloading VideoPose3D checkpoint …")
    pl.CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)
    _download(pl.CHECKPOINT_URL, str(dest), "weights")
    events.progress("weights", 1, 1, detail="videopose3d")
    return {"component": "videopose3d", "path": str(dest), "downloaded": True}


def ensure_all(data_dir, pose_letter="m", refine_mode="balanced", yolo=True):
    """Guarantee every model an analysis needs is present (idempotent), so no
    downstream library ever runs its own unchecked download. Used by setup and
    by the analyze preflight."""
    set_download_timeout()
    paths.ensure_dir(paths.models_dir(data_dir))
    results = {}
    if yolo:
        results["yolo"] = ensure_yolo_weights(data_dir, pose_letter)
    results["rtmpose"] = ensure_rtmpose(data_dir, refine_mode)
    results["videopose3d"] = ensure_videopose3d(data_dir)
    return results


def setup(data_dir, pose_letter="m", refine_mode="balanced"):
    """Download every model needed for a run. Emits a result event kind "setup"."""
    results = ensure_all(data_dir, pose_letter, refine_mode)
    events.result(kind="setup", data_dir=paths.resolve_data_dir(data_dir), components=results)
    if not events.enabled:
        print("Setup complete.")
        for name, r in results.items():
            print(f"  {name}: {r}")
    return results
