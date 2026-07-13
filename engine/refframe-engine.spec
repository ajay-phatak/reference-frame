# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the Reference Frame engine (onedir, console).

The heavy CV/DSP stack needs explicit data/submodule collection that
PyInstaller's static analysis misses:

  * ultralytics  — reads bundled YAML/config data files at import & run time,
    and pulls torch/torchvision (hooks-contrib covers the torch binaries).
  * librosa      — ships example data + lazy submodules; numba JITs its
    beat_track at runtime (the top freeze risk per the packaging plan).
  * rtmlib       — RTMPose wrapper; onnxruntime provider DLLs come via
    hooks-contrib, but rtmlib's own package data must be collected.
  * imageio_ffmpeg — bundles ffmpeg.exe as a package data file; download.py
    and the audio path resolve it via get_ffmpeg_exe(), so it MUST land in
    the dist (verified post-build).
  * yt_dlp       — lazy extractor registry: extractors are imported by name
    at runtime, invisible to static analysis → collect_submodules.

torch / torchvision / cv2 / onnxruntime / numba / llvmlite / soundfile /
scipy are handled by pyinstaller-hooks-contrib's bundled hooks; extra
hiddenimports below were added as frozen smoke tests flagged missing modules
(each annotated with why).
"""

from PyInstaller.utils.hooks import (
    collect_all,
    collect_data_files,
    collect_submodules,
)

datas = []
binaries = []
hiddenimports = []

# ── collect_all for the packages whose data + submodules PyInstaller misses ──
for _pkg in ("ultralytics", "librosa", "rtmlib"):
    _d, _b, _h = collect_all(_pkg)
    datas += _d
    binaries += _b
    hiddenimports += _h

# ── imageio_ffmpeg: the bundled ffmpeg.exe is a package data file ────────────
datas += collect_data_files("imageio_ffmpeg")

# ── yt_dlp: lazy extractor registry (imported by name at runtime) ────────────
hiddenimports += collect_submodules("yt_dlp")

# ── vendored sibling modules, imported bare (import pose_lift as pl) ─────────
# cli.py inserts the package dir onto sys.path at runtime; pathex below lets
# PyInstaller discover them, and naming them as hiddenimports guarantees the
# bare top-level names are frozen (they are NOT reached as refframe_engine.*).
hiddenimports += [
    "pose_extraction",
    "pose_refine",
    "pose_lift",
    "dance_metrics",
    "dance_review",
    "videopose3d_model",
]

# ── extra hiddenimports discovered via frozen smoke tests ────────────────────
hiddenimports += [
    # soundfile / audioread backends for librosa (dynamically imported).
    "soundfile",
    "audioread",
    # scipy special/signal submodules ultralytics + librosa reach lazily.
    "scipy.special._cdflib",
    "scipy._lib.array_api_compat.numpy.fft",
    # sklearn is imported lazily by librosa (feature clustering paths).
    "sklearn.utils._typedefs",
    "sklearn.neighbors._partition_nodes",
]

# ── excludes: GUI / notebook / training baggage the pipeline never touches ───
# NOT excluding pandas: ultralytics imports it in some utility paths and the
# cost of a runtime ImportError outweighs the ~40 MB saved.
excludes = [
    "matplotlib",
    "tkinter",
    "PyQt5",
    "PyQt6",
    "PySide2",
    "PySide6",
    "torch.utils.tensorboard",
    "tensorboard",
    "IPython",
    "notebook",
    "pytest",
]


a = Analysis(
    ["engine_entry.py"],
    pathex=["refframe_engine"],  # vendored sibling imports (import pose_lift as pl)
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="refframe-engine",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="refframe-engine",
)
