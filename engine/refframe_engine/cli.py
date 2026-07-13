"""Single CLI entry point for the Reference Frame engine.

Subcommands (spawn-per-job; the Electron shell always passes --ndjson and
--data-dir):

    refframe-engine analyze <path-or-url> --out-dir P --data-dir P [options]
    refframe-engine seed-preview <path-or-url> --at SEC --out-dir P --data-dir P
    refframe-engine setup --data-dir P [--pose-model m] [--refine-mode balanced]
    refframe-engine doctor --data-dir P [--pro-refs P]
    refframe-engine export-baseline <video> <poses> --label L --couple C --lead-id N --out P

Global --ndjson (any position) switches stdout to one-JSON-object-per-line
events for the shell; without it the commands keep their human-facing output,
which is how engine behaviour is golden-diffed against the source pipeline.

Runtime setup done BEFORE any heavy import (ultralytics/torch/numba pull in on
first vendored import): YOLO_CONFIG_DIR, NUMBA_CACHE_DIR, an attempted rtmlib
cache redirect (XDG_CACHE_HOME), sys.path insertion for the vendored sibling
imports, and a pose_lift.CHECKPOINT_DIR monkeypatch — all pointed under
--data-dir.
"""

import argparse
import os
import sys

from . import events, paths, stdio

COMMANDS = ("analyze", "seed-preview", "setup", "doctor", "export-baseline")


# ── runtime environment setup ───────────────────────────────────────────────

def _configure_env(data_dir):
    """Point model/cache dirs under --data-dir and make vendored imports work.

    Must run before importing any vendored module (they transitively import
    ultralytics → torch and, via librosa, numba)."""
    ucfg = paths.ensure_dir(paths.ultralytics_config_dir(data_dir))
    ncache = paths.ensure_dir(paths.numba_cache_dir(data_dir))
    mdir = paths.ensure_dir(paths.models_dir(data_dir))
    os.environ["YOLO_CONFIG_DIR"] = ucfg
    os.environ["NUMBA_CACHE_DIR"] = ncache
    # rtmlib / torch-hub honour XDG_CACHE_HOME on some platforms; harmless where
    # ignored (Windows). Verified-cosmetic per the plan.
    os.environ.setdefault("XDG_CACHE_HOME", mdir)

    pkg_dir = os.path.dirname(os.path.abspath(__file__))
    if pkg_dir not in sys.path:
        sys.path.insert(0, pkg_dir)


def _patch_checkpoint_dir(data_dir):
    """Redirect VideoPose3D's checkpoint dir into --data-dir without editing the
    byte-identical pose_lift.py (CHECKPOINT_DIR is a module global)."""
    import pathlib
    import pose_lift as pl
    pl.CHECKPOINT_DIR = pathlib.Path(paths.videopose3d_dir(data_dir))


def _capture():
    """stdio.capture() in NDJSON mode; a no-op passthrough otherwise."""
    return stdio.capture()


# ── argument parsing ─────────────────────────────────────────────────────────

def _build_parser():
    p = argparse.ArgumentParser(prog="refframe-engine", description="Reference Frame WCS analysis engine")
    sub = p.add_subparsers(dest="command")

    a = sub.add_parser("analyze", help="Analyse a WCS clip and write report/gap/metrics")
    a.add_argument("input", help="Video file path or YouTube URL")
    a.add_argument("--out-dir", required=True, help="Run output directory")
    a.add_argument("--data-dir", default=None, help="Engine data dir (models/caches)")
    a.add_argument("--me", choices=["left", "right"], default="left")
    a.add_argument("--me-id", type=int, choices=[1, 2], default=None)
    a.add_argument("--role", choices=["lead", "follow"], default="lead")
    a.add_argument("--partner", action="store_true")
    a.add_argument("--spotlight", action="store_true")
    a.add_argument("--pose-model", choices=list(paths.POSE_LETTERS), default="m")
    a.add_argument("--refine-mode", choices=["lightweight", "balanced", "performance"],
                   default="balanced")
    a.add_argument("--seed-me-idx", type=int, default=None)
    a.add_argument("--seed-partner-idx", type=int, default=None)
    a.add_argument("--compare-pros", action="store_true")
    a.add_argument("--pro-refs", default=None, help="Path to a baselines.json manifest")

    s = sub.add_parser("seed-preview", help="Crowd mode: numbered-people preview at a timestamp")
    s.add_argument("input", help="Video file path or YouTube URL")
    s.add_argument("--at", type=float, required=True, help="Seconds into the clip")
    s.add_argument("--out-dir", required=True)
    s.add_argument("--data-dir", default=None)
    s.add_argument("--pose-model", choices=list(paths.POSE_LETTERS), default="m")

    st = sub.add_parser("setup", help="Download model weights (idempotent)")
    st.add_argument("--data-dir", default=None)
    st.add_argument("--pose-model", choices=list(paths.POSE_LETTERS), default="m")
    st.add_argument("--refine-mode", choices=["lightweight", "balanced", "performance"],
                    default="balanced")

    d = sub.add_parser("doctor", help="Environment / weights health check")
    d.add_argument("--data-dir", default=None)
    d.add_argument("--pro-refs", default=None)
    d.add_argument("--pose-model", choices=list(paths.POSE_LETTERS), default="m")

    e = sub.add_parser("export-baseline", help="(dev) Poses JSON → pro metrics JSON")
    e.add_argument("video")
    e.add_argument("poses")
    e.add_argument("--label", required=True)
    e.add_argument("--couple", required=True)
    e.add_argument("--lead-id", type=int, required=True)
    e.add_argument("--out", required=True)

    return p


# ── command handlers ─────────────────────────────────────────────────────────

def _cmd_analyze(args):
    _patch_checkpoint_dir(args.data_dir)
    from . import run
    try:
        with _capture():
            run.analyze(
                args.input, args.out_dir, args.data_dir,
                me=args.me, me_id=args.me_id, role=args.role,
                partner=args.partner, spotlight=args.spotlight,
                pose_model=args.pose_model, refine_mode=args.refine_mode,
                seed_me_idx=args.seed_me_idx, seed_partner_idx=args.seed_partner_idx,
                compare_pros=args.compare_pros, pro_refs=args.pro_refs,
            )
    except run._WeightsMissing as ex:
        events.error(f"Pose weights not found: {ex.path}. Run `setup` first.",
                     code="weights_missing", path=ex.path)
        return 2
    except FileNotFoundError as ex:
        # Either the input video or the seed sidecar is missing.
        if str(ex).endswith("_seed.json"):
            events.error(f"No seed preview found: {ex}. Run seed-preview first.",
                         code="no_seed")
        else:
            events.error(f"File not found: {ex}", code="file_not_found")
        return 2
    except ValueError as ex:
        events.error(f"Invalid seed indices: {ex}", code="seed_idx_invalid")
        return 2
    except RuntimeError as ex:
        msg = str(ex)
        if "download" in msg.lower():
            events.error(msg, code="download_failed")
        else:
            events.error(msg, code="extraction_failed")
        return 1
    return 0


def _cmd_seed_preview(args):
    _patch_checkpoint_dir(args.data_dir)
    import pathlib
    from . import run
    try:
        with _capture():
            video_path, _ = run.resolve_input(args.input, args.out_dir, args.data_dir)
            run.seed_preview(pathlib.Path(video_path), args.at, args.out_dir,
                             args.data_dir, pose_letter=args.pose_model)
    except run._WeightsMissing as ex:
        events.error(f"Pose weights not found: {ex.path}. Run `setup` first.",
                     code="weights_missing", path=ex.path)
        return 2
    except FileNotFoundError as ex:
        events.error(f"File not found: {ex}", code="file_not_found")
        return 2
    except RuntimeError as ex:
        msg = str(ex)
        code = "download_failed" if "download" in msg.lower() else "extraction_failed"
        events.error(msg, code=code)
        return 1
    return 0


def _cmd_setup(args):
    _patch_checkpoint_dir(args.data_dir)
    from . import setup_models
    try:
        with _capture():
            setup_models.setup(args.data_dir, pose_letter=args.pose_model,
                               refine_mode=args.refine_mode)
    except RuntimeError as ex:
        events.error(str(ex), code="download_failed")
        return 1
    return 0


def _cmd_doctor(args):
    from . import doctor
    return doctor.run(args.data_dir, pro_refs=args.pro_refs, pose_letter=args.pose_model)


def _cmd_export_baseline(args):
    _patch_checkpoint_dir(args.data_dir if hasattr(args, "data_dir") else None)
    from . import baselines
    with _capture():
        res = baselines.export_baseline(
            args.video, args.poses, label=args.label, couple=args.couple,
            lead_id=args.lead_id, out=args.out)
    events.result(kind="export_baseline", **res)
    if not events.enabled:
        print(f"Wrote {res['out']}")
        print(f"Manifest entry: {res['entry']}")
    return 0


_HANDLERS = {
    "analyze": _cmd_analyze,
    "seed-preview": _cmd_seed_preview,
    "setup": _cmd_setup,
    "doctor": _cmd_doctor,
    "export-baseline": _cmd_export_baseline,
}


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)

    if "--ndjson" in argv:
        argv.remove("--ndjson")
        events.enabled = True

    parser = _build_parser()
    if not argv or argv[0] in ("-h", "--help"):
        parser.print_help()
        return 0

    args = parser.parse_args(argv)
    if not args.command:
        parser.print_help()
        return 2

    # data-dir is optional on the CLI (defaults for hand-runs); resolve now so
    # env configuration and all path helpers agree on one location.
    data_dir = getattr(args, "data_dir", None)
    args.data_dir = paths.resolve_data_dir(data_dir)
    _configure_env(args.data_dir)

    handler = _HANDLERS.get(args.command)
    if handler is None:
        events.error(f"Unknown command: {args.command}", code="unknown_command")
        return 2

    try:
        return handler(args)
    except Exception as ex:                    # noqa: BLE001 — final safety net
        events.error(f"{type(ex).__name__}: {ex}", code="internal")
        return 1


if __name__ == "__main__":
    sys.exit(main())
