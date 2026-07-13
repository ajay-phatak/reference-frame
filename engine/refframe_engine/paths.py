"""Data-directory resolution for the Reference Frame engine.

All persistent state (downloaded model weights, caches, per-run library
folders) lives under one data directory. The app always passes --data-dir
explicitly; the defaults below only matter for running the engine by hand.

Frozen (PyInstaller) builds must never derive paths from __file__ — the
package is unpacked into a temp/resources dir that isn't writable or stable.

Layout under <data-dir>:
    models/
        yolov8{n,s,m,l,x}-pose.pt   YOLOv8 pose weights (pass 1)
        rtmlib/                     RTMPose ONNX cache (pass 2)
        videopose3d/                VideoPose3D checkpoint (pass 3, CC-BY-NC)
        ultralytics-config/         ultralytics settings (YOLO_CONFIG_DIR)
        numba-cache/                numba JIT cache (NUMBA_CACHE_DIR, librosa)
    library/<run_id>/               per-run outputs (report/gap/metrics/seed)
"""
import os
import sys

# Valid YOLOv8 pose model letters, smallest → largest / most accurate.
POSE_LETTERS = ("n", "s", "m", "l", "x")


def default_data_dir():
    if getattr(sys, "frozen", False):
        base = os.environ.get("APPDATA") or os.path.expanduser("~")
        return os.path.join(base, "reference-frame")
    # Dev fallback: engine/ directory (sibling of the package), so hand-run
    # commands keep their state in the repo checkout, gitignored.
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def resolve_data_dir(data_dir=None):
    d = os.path.abspath(data_dir) if data_dir else default_data_dir()
    return d


# ── model / cache subdirectories ────────────────────────────────────────────

def models_dir(data_dir=None):
    return os.path.join(resolve_data_dir(data_dir), "models")


def pose_model_filename(letter):
    """Map a pose-model letter (n|s|m|l|x) to its weight filename."""
    letter = (letter or "m").lower()
    if letter.endswith("-pose.pt"):            # already a filename
        return letter
    if letter.startswith("yolov8"):            # e.g. "yolov8m-pose.pt" or "yolov8m"
        return letter if letter.endswith(".pt") else letter + "-pose.pt"
    if letter not in POSE_LETTERS:
        raise ValueError(f"invalid pose model letter: {letter!r} (expected one of {POSE_LETTERS})")
    return f"yolov8{letter}-pose.pt"


def yolo_weights_path(data_dir=None, letter="m"):
    return os.path.join(models_dir(data_dir), pose_model_filename(letter))


def videopose3d_dir(data_dir=None):
    return os.path.join(models_dir(data_dir), "videopose3d")


def rtmlib_cache_dir(data_dir=None):
    return os.path.join(models_dir(data_dir), "rtmlib")


def ultralytics_config_dir(data_dir=None):
    return os.path.join(models_dir(data_dir), "ultralytics-config")


def numba_cache_dir(data_dir=None):
    return os.path.join(models_dir(data_dir), "numba-cache")


# ── library / run directories ───────────────────────────────────────────────

def library_dir(data_dir=None):
    return os.path.join(resolve_data_dir(data_dir), "library")


def run_dir(run_id, data_dir=None):
    return os.path.join(library_dir(data_dir), run_id)


def ensure_dir(path):
    os.makedirs(path, exist_ok=True)
    return path
