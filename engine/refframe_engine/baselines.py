"""Pro-baseline manifest loading + export.

The packaged app ships precomputed pro *metrics* JSON (KB-scale), never pro
videos or pose files (25-48 MB each) — the gap analysis only needs metrics
dicts. The manifest (`baselines.json`) lists entries:

    [{"label": "...", "couple": "...", "lead_id": 2,
      "metrics": "semion_maria_wotp_2024.metrics.json"}, ...]

`metrics` (and, for the dev recompute fallback, `poses`/`video`) are resolved
relative to the manifest file's directory.

`export_baseline` is the dev-only tool that turns a poses file into one of those
metrics JSONs, via the same compute_all_metrics code path the pipeline uses.
"""

import json
import os
import pathlib


# Candidate locations for the bundled manifest when --pro-refs isn't given.
def _candidate_manifests():
    import sys
    cands = []
    env = os.environ.get("REFFRAME_BASELINES")
    if env:
        cands.append(pathlib.Path(env))
    if getattr(sys, "frozen", False):
        exe_dir = pathlib.Path(sys.executable).parent
        # electron-builder places extraResources next to / near the exe.
        cands += [
            exe_dir / "resources" / "pro_baselines" / "baselines.json",
            exe_dir / "pro_baselines" / "baselines.json",
            pathlib.Path(getattr(sys, "_MEIPASS", exe_dir)) / "pro_baselines" / "baselines.json",
        ]
    # Repo dev layout: reference-frame/resources/pro_baselines/baselines.json
    here = pathlib.Path(__file__).resolve()
    repo_root = here.parents[2]          # refframe_engine → engine → reference-frame
    cands.append(repo_root / "resources" / "pro_baselines" / "baselines.json")
    return cands


def default_manifest_path():
    for c in _candidate_manifests():
        if c.exists():
            return str(c)
    return None


def load_manifest(pro_refs=None):
    """Load a baselines manifest. Returns {"dir": <manifest dir>, "entries": [...]}.

    `pro_refs` may be a path to a baselines.json; if None, the bundled/dev
    default is used. Raises FileNotFoundError if nothing resolves.
    """
    path = pro_refs or default_manifest_path()
    if not path or not os.path.exists(path):
        raise FileNotFoundError(path or "baselines.json (no default manifest found)")
    path = pathlib.Path(path)
    entries = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(entries, dict) and "entries" in entries:
        entries = entries["entries"]
    return {"dir": str(path.parent), "entries": entries}


def export_baseline(video, poses_path, *, label, couple, lead_id, out):
    """Compute metrics from a poses file and write a float-cast metrics JSON.

    Same code path as run._load_pro_metrics' recompute branch: load + normalise
    the poses, attach the video path (for beat extraction), run
    compute_all_metrics, then dump JSON-safe (numpy scalars/arrays → Python).

    The output file is the RAW metrics dict — exactly what
    run._load_pro_metrics expects to load from a manifest entry's "metrics"
    file. The returned `entry` is the ready-to-paste baselines.json line.
    """
    from . import run
    import dance_metrics as dm

    poses = run._normalise_poses(
        json.loads(pathlib.Path(poses_path).read_text(encoding="utf-8")))
    poses["video_path"] = str(video)
    metrics = dm.compute_all_metrics(poses)

    out = pathlib.Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(metrics, default=run._json_default), encoding="utf-8")

    entry = {"label": label, "couple": couple,
             "lead_id": int(lead_id), "metrics": out.name}
    return {"out": str(out), "entry": entry}
