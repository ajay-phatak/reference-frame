"""Environment health check (the `doctor` subcommand).

One spawn tells the app whether the engine can actually run before any real
analysis starts. Checks (one result field per check, so the UI can render a
checklist):

  * data_dir_writable      — --data-dir exists / can be created and written
  * yolo_weights           — pose weights present (path + size)
  * rtmpose_cache          — rtmlib ONNX cache dir has content
  * videopose3d_checkpoint — VideoPose3D checkpoint present (path + size)
  * ffmpeg                 — imageio-ffmpeg's bundled ffmpeg resolvable
  * torch / onnxruntime    — heavy runtimes importable (frozen-build canary)
  * baselines_manifest     — pro baselines manifest readable (+ entry count);
                             no manifest configured is a normal ok=true state
                             (fresh installs / users with no pros added yet),
                             a manifest that exists but is broken is ok=false

Exit code 0 when every REQUIRED check passes (baselines are optional — the
free tier can run without --compare-pros), 1 otherwise.
"""

import os

from . import events, paths


def _check_data_dir(data_dir):
    try:
        paths.ensure_dir(data_dir)
        probe = os.path.join(data_dir, ".doctor-probe")
        with open(probe, "w", encoding="utf-8") as fh:
            fh.write("ok")
        os.remove(probe)
        return {"ok": True, "path": data_dir}
    except OSError as e:
        return {"ok": False, "path": data_dir, "error": str(e)}


def _check_yolo(data_dir, pose_letter):
    path = paths.yolo_weights_path(data_dir, pose_letter)
    if os.path.exists(path):
        return {"ok": True, "path": path, "size_bytes": os.path.getsize(path)}
    return {"ok": False, "path": path, "error": "not downloaded — run setup"}


def _check_rtmpose(data_dir):
    # rtmlib caches under its own hash-named layout; presence of ANY files in
    # the redirected cache dir is the best cheap signal without importing rtmlib.
    cache = paths.rtmlib_cache_dir(data_dir)
    files = []
    if os.path.isdir(cache):
        for root, _dirs, names in os.walk(cache):
            files += [os.path.join(root, n) for n in names]
    if files:
        total = sum(os.path.getsize(f) for f in files)
        return {"ok": True, "path": cache, "files": len(files), "size_bytes": total}
    return {"ok": False, "path": cache, "error": "empty — run setup",
            "note": "rtmlib may also use its default cache; setup verifies properly"}


def _check_videopose3d(data_dir):
    d = paths.videopose3d_dir(data_dir)
    ckpt = os.path.join(d, "pretrained_h36m_detectron_coco.bin")
    if os.path.exists(ckpt):
        return {"ok": True, "path": ckpt, "size_bytes": os.path.getsize(ckpt)}
    return {"ok": False, "path": ckpt, "error": "not downloaded — run setup"}


def _check_ffmpeg():
    try:
        import imageio_ffmpeg
        exe = imageio_ffmpeg.get_ffmpeg_exe()
        return {"ok": os.path.exists(exe), "path": exe}
    except Exception as e:                     # noqa: BLE001
        return {"ok": False, "error": str(e)}


def _check_import(module):
    try:
        mod = __import__(module)
        return {"ok": True, "version": getattr(mod, "__version__", "unknown")}
    except Exception as e:                     # noqa: BLE001
        return {"ok": False, "error": str(e)}


def _check_baselines(pro_refs):
    from . import baselines
    try:
        manifest = baselines.load_manifest(pro_refs)
    except FileNotFoundError:
        # Normal state for a fresh install / a user with no pros configured yet.
        return {"ok": True, "entries": 0,
                "note": "no pro baselines configured (optional — add pros in the Pros tab)"}
    except Exception as e:                     # noqa: BLE001
        return {"ok": False, "error": str(e)}
    entries = manifest["entries"]
    missing = []
    for entry in entries:
        mf = entry.get("metrics")
        if mf:
            mp = mf if os.path.isabs(mf) else os.path.join(manifest["dir"], mf)
            if not os.path.exists(mp):
                missing.append(mf)
    return {"ok": not missing, "path": manifest["dir"], "entries": len(entries),
            **({"missing_metrics": missing} if missing else {})}


def run(data_dir, pro_refs=None, pose_letter="m"):
    checks = {
        "data_dir_writable":      _check_data_dir(data_dir),
        "yolo_weights":           _check_yolo(data_dir, pose_letter),
        "rtmpose_cache":          _check_rtmpose(data_dir),
        "videopose3d_checkpoint": _check_videopose3d(data_dir),
        "ffmpeg":                 _check_ffmpeg(),
        "torch":                  _check_import("torch"),
        "onnxruntime":            _check_import("onnxruntime"),
        "baselines_manifest":     _check_baselines(pro_refs),
    }

    required = ("data_dir_writable", "yolo_weights", "videopose3d_checkpoint",
                "ffmpeg", "torch", "onnxruntime")
    all_ok = all(checks[k]["ok"] for k in required)

    events.result(kind="doctor", ok=all_ok, **checks)
    if not events.enabled:
        for name, c in checks.items():
            mark = "OK  " if c["ok"] else "FAIL"
            detail = c.get("path") or c.get("version") or c.get("error", "")
            print(f"  [{mark}] {name:<24s} {detail}")
        print(f"\n  doctor: {'all required checks passed' if all_ok else 'REQUIRED CHECKS FAILED'}")

    return 0 if all_ok else 1
