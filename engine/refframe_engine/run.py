"""Analysis orchestrator — rewritten from wcs-analyze-skill/scripts/analyze.py.

This is the packaged glue that ties the vendored pipeline modules together.
Golden-diff invariant: WITHOUT --ndjson, running on the SAME refined+lifted
poses cache must produce a byte-identical `<stem>_report.txt` to the source
analyze.py. To guarantee that, the report path here mirrors the source main()
step-for-step: it feeds `dr.build_report` a poses object obtained by
`_normalise_poses(json.loads(<cache>))` — exactly as the source does — and the
six helper functions below (`_normalise_poses`, `_parse_kps`, `_dancer_on_side`,
`_orient_lead_first`, `_cols_for`, `_gap_report`) are preserved VERBATIM from
the source.

Differences vs the source (all documented in the packaging plan):
  (a) the poses cache lives in the run's --out-dir, written atomically
      (tmp + os.replace) with a `<stem>_poses_pass1.json` backup;
  (b) the cache is always refined (RTMPose Halpe-26) + lifted (VideoPose3D),
      absorbing reextract_all.py's sequencing — a fully refined+lifted cache is
      reused as-is and skips extraction entirely;
  (c) `_load_pro_metrics` can load a precomputed metrics JSON;
  (d) YouTube download is in-process (download.py);
  (e) NDJSON progress per stage + a final `result` event kind "analysis";
  (f) the metrics dict is also dumped as `<stem>_metrics.json`.
"""

import json
import os
import re
import sys

import numpy as np

# Vendored sibling modules. cli.py inserts this package dir onto sys.path so the
# vendored cross-imports (`import pose_extraction as pe`, etc.) resolve; repeat
# the insert here defensively so run.py is importable on its own.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import dance_metrics as dm      # noqa: E402
import dance_review as dr       # noqa: E402
import pose_extraction as pe    # noqa: E402
import pose_lift as pl          # noqa: E402
import pose_refine as pr        # noqa: E402

from . import events, paths     # noqa: E402


# ═════════════════════════════════════════════════════════════════════════════
# VERBATIM from analyze.py — do not edit (golden-diff invariant).
# ═════════════════════════════════════════════════════════════════════════════

def _parse_kps(raw):
    """Convert keypoints from JSON (list, numpy-string repr, or ndarray) to ndarray."""
    if isinstance(raw, np.ndarray):
        return raw
    if isinstance(raw, str):
        nums = [float(x) for x in re.findall(r"[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?", raw)]
        return np.array(nums, dtype=float).reshape(-1, 3)
    arr = np.array(raw, dtype=float)
    return arr.reshape(-1, 3) if arr.ndim == 1 else arr


def _normalise_poses(poses: dict) -> dict:
    """Fix JSON round-trip issues: string dancer keys → int, kps → ndarray."""
    for f in poses["frames"]:
        d = f.get("dancers", {})
        if not d:
            continue
        if isinstance(next(iter(d)), str):
            f["dancers"] = {int(k): v for k, v in d.items()}
        for did, kps in list(f["dancers"].items()):
            if not isinstance(kps, np.ndarray):
                f["dancers"][did] = _parse_kps(kps)
    return poses


def _dancer_on_side(poses: dict, side: str) -> int:
    """Return the Dancer ID (1 or 2) on the given side ("left"/"right") near the start
    of the dancing.

    The tracker's Dancer 1 is NOT guaranteed to be the left dancer (it's whoever was
    detected first), so we resolve the user's stated starting side to an actual ID by
    looking at real positions. We deliberately skip the very first frames: early on the
    floor is often empty / mid-walk-on, and reflections or bystanders get detected, so
    the first two-person frame is unreliable. Instead we use the earliest frame where
    BOTH dancers are at near-full size (≥ 70% of each one's median body height), i.e.
    both are actually on the floor dancing.
    """
    frames = poses.get("frames", [])

    bhs = {1: [], 2: []}
    for f in frames:
        d = f.get("dancers", {})
        for did in (1, 2):
            if did in d:
                h = pe.body_height(d[did])
                if h > 10:
                    bhs[did].append(h)
    med = {did: (float(np.median(v)) if v else 0.0) for did, v in bhs.items()}

    def _resolve(d):
        x1 = float(pe.get_center(d[1])[0])
        x2 = float(pe.get_center(d[2])[0])
        left_id = 1 if x1 <= x2 else 2
        return left_id if side == "left" else (2 if left_id == 1 else 1)

    # Preferred: first frame where both dancers are near full size (truly on the floor)
    if med[1] > 0 and med[2] > 0:
        for f in frames:
            d = f.get("dancers", {})
            if 1 in d and 2 in d \
               and pe.body_height(d[1]) >= 0.7 * med[1] \
               and pe.body_height(d[2]) >= 0.7 * med[2]:
                return _resolve(d)

    # Fallback: first two-person frame at all
    for f in frames:
        d = f.get("dancers", {})
        if 1 in d and 2 in d:
            return _resolve(d)

    return 1 if side == "left" else 2   # last resort: assume left == Dancer 1


def _orient_lead_first(poses: dict) -> None:
    """Swap tracked Dancer 1 <-> 2 in place so the actual LEAD becomes Dancer 1.

    The tracker numbers the two dancers arbitrarily. Once we know which tracked dancer
    is the lead (from --me/--me-id + --role), relabelling so the lead is Dancer 1 makes
    every positional 'lead'/'follow' metric and report section reflect the TRUE roles
    rather than tracker order. Keys are ints here (poses already normalised).
    """
    for f in poses.get("frames", []):
        d = f.get("dancers")
        if not d:
            continue
        f["dancers"] = {(2 if k == 1 else 1 if k == 2 else k): v for k, v in d.items()}
    if poses.get("dancer_ids"):
        poses["dancer_ids"] = sorted(int(i) for i in poses["dancer_ids"])


def _cols_for(dancer_id: int) -> tuple:
    """Map a tracked Dancer ID to its metric column keys: ('lead','a') or ('follow','b').

    compute_all_metrics labels Dancer 1 → 'lead'/'a' and Dancer 2 → 'follow'/'b'.
    """
    return ("lead", "a") if dancer_id == 1 else ("follow", "b")


def _gap_report(am_metrics: dict, pro_entries: list, you_id: int = 1,
                include_partner: bool = False, spotlight: bool = False,
                my_role: str = "lead") -> str:
    """Build a concise gap-comparison table, broken out PER COUPLE.

    `you_id` is the tracked Dancer ID that is YOU in this video, and `my_role`
    ("lead"/"follow") is the role you dance. Clips are grouped by couple; each couple
    gets its own section with its clips averaged together. Role-specific rows compare
    YOU against that couple's dancer of the SAME role. When `include_partner` is set,
    the same metrics are also shown for your PARTNER (the other role) vs that couple's
    other-role dancer. Partnership rows are role-agnostic.

    pro_entries items are (label, metrics, lead_id, couple) where lead_id is which
    Dancer ID is that clip's lead and couple is the grouping key.
    """

    partner_role             = "follow" if my_role == "lead" else "lead"
    you_side, you_ab         = _cols_for(you_id)
    partner_id               = 2 if you_id == 1 else 1
    partner_side, partner_ab = _cols_for(partner_id)

    def _dig(m, category, subkey, kind, side, ab):
        """Pull one value, resolving how the metric encodes the dancer role."""
        if kind == "pair":                       # role-agnostic (partnership)
            node = m.get(category, {})
            v = node.get(subkey) if isinstance(node, dict) else None
        elif kind == "side":                     # leg_action_/body_action_<side>
            node = m.get(f"{category}_{side}", {})
            v = node.get(subkey) if isinstance(node, dict) else None
        else:                                     # "ab" — musicality, keyed _a / _b
            node = m.get("musicality", {})
            v = node.get(f"{subkey}_{ab}") if isinstance(node, dict) else None
        return float(v) if isinstance(v, (int, float)) else None

    def _am(category, subkey, kind, role):
        side = you_side if role == "you" else partner_side
        ab   = you_ab   if role == "you" else partner_ab
        return _dig(am_metrics, category, subkey, kind, side, ab)

    def _pro_avg(entries, category, subkey, kind, role):
        # Average one couple's clips, comparing against the pro of the SAME role as
        # whoever this row is about. `entries` are this couple's (label, metrics, lead_id).
        want_role = my_role if role == "you" else partner_role
        vals = []
        for _lbl, pm, lead_id in entries:
            follow_id = 2 if lead_id == 1 else 1
            target_id = lead_id if want_role == "lead" else follow_id
            p_side, p_ab = _cols_for(target_id)
            v = _dig(pm, category, subkey, kind, p_side, p_ab)
            if v is not None:
                vals.append(v)
        return float(np.mean(vals)) if vals else None

    # Role-specific metrics, emitted once per role — (label, category, subkey, kind, hib, fmt)
    role_checks = [
        ("Rise/fall typical (bounce on avg steps)",  "leg_action",  "rise_fall_typical",                "side", True,  ".4f"),
        ("Rise/fall dynamic (biggest level changes)","leg_action",  "rise_fall_dynamic",                "side", True,  ".3f"),
        ("1-foot balance %",                         "leg_action",  "one_foot_pct",                     "side", True,  ".1f"),
        ("1-foot airborne % (true single-leg)",      "leg_action",  "one_foot_airborne_pct",            "side", True,  ".1f"),
        ("Ball-of-foot % (rolling action)",          "leg_action",  "ball_foot_pct",                    "side", True,  ".1f"),
        ("Toe-first landings % (roll thru foot)",    "leg_action",  "art_toe_first_pct",                "side", True,  ".1f"),
        ("Weight-only traveling (lower=better)",     "leg_action",  "step_count_weight_only_traveling", "side", False, ".0f"),
        ("Articulated traveling",                    "leg_action",  "step_count_articulated_traveling", "side", True,  ".0f"),
        ("Slotted movement range (BH)",              "travel",      "slot_travel_range_bh",             "side", True,  ".3f"),
        ("Art. free-leg prep knee flex (deg)",       "leg_action",  "art_free_knee_flex_deg",           "side", True,  ".1f"),
        ("Art. free-leg prep hip flex (deg)",        "leg_action",  "art_free_hip_flex_deg",            "side", True,  ".1f"),
        ("Art. standing-leg knee flex med (deg)",    "leg_action",  "art_weighted_knee_flex_deg",       "side", True,  ".1f"),
        ("Art. standing-leg knee flex p90 (ceiling)","leg_action",  "art_weighted_knee_p90",            "side", True,  ".1f"),
        ("Art. free-leg knee flex p90 (ceiling)",    "leg_action",  "art_free_knee_p90",                "side", True,  ".1f"),
        ("Art. free knee-hip coordination",          "leg_action",  "art_knee_hip_coord",               "side", True,  ".2f"),
        ("Art. bend smoothness",                     "leg_action",  "art_smoothness",                   "side", True,  ".3f"),
        ("Art. straighten recovery %",               "leg_action",  "art_straighten_pct",               "side", True,  ".1f"),
        ("Art. prep→arrival sequencing %",           "leg_action",  "art_prep_pct",                     "side", True,  ".1f"),
        ("Motion smoothness",                        "body_action", "motion_smoothness",                "side", True,  ".3f"),
        ("Torso pitch range (deg)",                  "body_action", "pitch_range_deg",                  "side", True,  ".1f"),
        ("Upper/lower rotation dissoc (deg)",        "body_action", "upper_lower_rotation_mean_deg",    "side", True,  ".1f"),
        ("Texture match (move vs song)",             "musicality",  "texture_match",                    "ab",   True,  ".3f"),
        ("Bounce match (beat rhythm)",               "musicality",  "bounce_match",                     "ab",   True,  ".3f"),
        ("On-beat articulated steps %",              "musicality",  "on_beat_pct",                      "ab",   True,  ".1f"),
        ("Timing consistency (ms, lower=better)",    "musicality",  "timing_ms",                        "ab",   False, ".0f"),
        ("Syncopation %",                            "musicality",  "syncopation_pct",                  "ab",   True,  ".1f"),
        ("Accent response % (any channel)",          "musicality",  "accent_response_pct",              "ab",   True,  ".1f"),
        ("Accent hit intensity",                     "musicality",  "accent_hit_mean",                  "ab",   True,  ".2f"),
    ]
    # Role-agnostic partnership metrics, emitted once — (label, category, subkey, hib, fmt)
    pair_checks = [
        ("Partner distance variance",          "weight_countering", "partner_distance_std",   True, ".3f"),
        ("Posts detected",                     "weight_countering", "post_count",             True, ".0f"),
        ("Stretch-leading posts",              "weight_countering", "post_stretch_leading",   True, ".0f"),
        ("Compression-leading posts",          "weight_countering", "post_compression_leading",True, ".0f"),
        ("Stretch range after post (BH)",      "weight_countering", "post_max_stretch_mean",  True, ".3f"),
        ("Floor travel range (BH)",            "travel",            "couple_travel_range_bh", True, ".3f"),
        ("Accent coverage % (either)",         "musicality",        "accent_covered_pct",     True, ".1f"),
    ]

    roles = ["you", "partner"] if include_partner else ["you"]

    # Group clips by couple (insertion order preserved), so each couple gets its own
    # section with its clips averaged together — rather than one pooled pro average.
    groups = {}
    for lbl, pm, lead_id, couple in pro_entries:
        groups.setdefault(couple, []).append((lbl, pm, lead_id))

    header = f"  you = Dancer {you_id} ({my_role}); rows compare you vs each couple's {my_role.upper()}"
    if include_partner:
        header += (f"\n  partner = the {partner_role}; partner rows compare vs each "
                   f"couple's {partner_role.upper()}")
    lines = [
        "",
        "=" * 72,
        "  GAP ANALYSIS vs PRO REFERENCES  (broken out per couple)",
        header,
        "=" * 72,
    ]

    def _emit(label, am_val, pa, hib, fmt, suffix, vlabel, note=""):
        if am_val is None or pa is None:
            return
        delta = am_val - pa
        arrow = "▲" if (delta > 0) == hib else "▼"
        sign  = "+" if delta >= 0 else ""
        lines.append(
            f"  {label + suffix:<46s}  {vlabel}={am_val:{fmt}}  pro avg={pa:{fmt}}  "
            f"{arrow} {sign}{delta:{fmt}}{note}"
        )

    for couple, entries in groups.items():
        clips = ", ".join(lbl for lbl, _pm, _lid in entries)
        n = len(entries)
        lines += [
            "",
            "-" * 72,
            f"  vs {couple}  —  averaged over {n} clip{'s' if n != 1 else ''}: {clips}",
            "-" * 72,
        ]
        for role in roles:
            if include_partner:
                disp = my_role if role == "you" else partner_role
                lines.append(f"  -- {role.upper()} ({disp.upper()}) --")
            for label, category, subkey, kind, hib, fmt in role_checks:
                _emit(label, _am(category, subkey, kind, role),
                      _pro_avg(entries, category, subkey, kind, role),
                      hib, fmt, f" — {role}", role)

        if include_partner:
            lines.append("  -- PARTNERSHIP (both) --")
        for label, category, subkey, hib, fmt in pair_checks:
            note = ""
            if subkey == "couple_travel_range_bh" and not spotlight:
                note = "   (not spotlight — lower expected)"
            _emit(label, _am(category, subkey, "pair", "you"),
                  _pro_avg(entries, category, subkey, "pair", "you"),
                  hib, fmt, "", "you", note=note)

    lines += ["", "=" * 72]
    return "\n".join(lines)


# ═════════════════════════════════════════════════════════════════════════════
# Packaged orchestration (new).
# ═════════════════════════════════════════════════════════════════════════════

VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm"}


def _json_default(o):
    """default= serializer making the metrics dict JSON-safe (numpy → Python)."""
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.floating):
        return float(o)
    if isinstance(o, np.bool_):
        return bool(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    return str(o)


def _atomic_write_text(path, text):
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(text)
    os.replace(tmp, path)


def _save_poses_atomic(data, poses_path):
    """pl.save_poses to a tmp file, then os.replace — cancel-safe cache write."""
    import pathlib
    tmp = pathlib.Path(f"{poses_path}.tmp")
    pl.save_poses(data, tmp)
    os.replace(tmp, poses_path)


def _is_refined_lifted(raw: dict) -> bool:
    """Mirror reextract_all's refinement-state detection, plus lift state."""
    return raw.get("keypoint_format") == "halpe26" and raw.get("kps3d_format") == "h36m17"


def _weights_for(data_dir, pose_letter):
    """Absolute path to the downloaded pose weights. Raises _WeightsMissing when
    absent — passing a bare filename would let ultralytics auto-download into
    cwd, which is wrong (and unwritable) in a frozen build."""
    abspath = paths.yolo_weights_path(data_dir, pose_letter)
    if not os.path.exists(abspath):
        raise _WeightsMissing(abspath)
    return abspath


def resolve_input(input_str, out_dir, data_dir):
    """Resolve a path-or-URL to a local video Path (downloading if a URL).

    Returns (video_path, is_url, video_title). video_title is the YouTube
    title (None for local files, or for a URL whose download reused an
    existing cached mp4 — see download.download_youtube). Raises
    RuntimeError('file_not_found'/...) on a missing local file; download
    failures propagate as RuntimeError.
    """
    import pathlib
    is_url = input_str.startswith("http://") or input_str.startswith("https://")
    video_title = None
    if is_url:
        from . import download
        video_path, video_title = download.download_youtube(input_str, pathlib.Path(out_dir))
    else:
        video_path = pathlib.Path(input_str)
        if not video_path.exists():
            raise FileNotFoundError(str(video_path))
    return video_path, is_url, video_title


def _load_seed(out_dir, stem, me_idx, partner_idx):
    """Read the seed sidecar (<stem>_seed.json in the run dir) written by
    seed_preview, and build the extraction seed (dancer 1 = you, 2 = partner)."""
    import pathlib
    js = pathlib.Path(out_dir) / f"{stem}_seed.json"
    if not js.exists():
        raise FileNotFoundError(str(js))
    sj = json.loads(js.read_text(encoding="utf-8"))
    by_idx = {d["idx"]: d["center"] for d in sj["dets"]}
    if me_idx not in by_idx or partner_idx not in by_idx:
        raise ValueError(f"seed indices not found; available: {sorted(by_idx)}")
    return {"frame_idx": sj["frame_idx"],
            "points": [tuple(by_idx[me_idx]), tuple(by_idx[partner_idx])]}


def seed_preview(video_path, t_sec, out_dir, data_dir, pose_letter="m"):
    """Crowd-mode step 1: detect everyone in one frame, save a numbered preview PNG
    and a sidecar JSON of detection centres in the run dir. Mirrors analyze.py's
    _seed_preview but writes into out_dir and returns the seed dict for a result event.
    """
    import pathlib
    import cv2
    out_dir = pathlib.Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = video_path.stem
    model_name = _weights_for(data_dir, pose_letter)

    events.progress("seed", 0, 1, detail="detecting")
    frame_idx, img, dets = pe.detect_single_frame(str(video_path), t_sec, model_name=model_name)
    seed_json = {"frame_idx": int(frame_idx), "t_sec": float(t_sec), "dets": []}
    for k, d in enumerate(dets):
        x0, y0, x1, y1 = (int(v) for v in d["box"])
        col = (0, 200, 255)
        cv2.rectangle(img, (x0, y0), (x1, y1), col, 3)
        cv2.rectangle(img, (x0, max(0, y0 - 36)), (x0 + 96, max(0, y0 - 36) + 36), col, -1)
        cv2.putText(img, f"#{k}", (x0 + 6, max(0, y0 - 36) + 28),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.95, (0, 0, 0), 2)
        seed_json["dets"].append({"idx": k,
                                  "center": [float(d["center"][0]), float(d["center"][1])],
                                  "box": [x0, y0, x1, y1],
                                  "conf": round(float(d["conf"]), 3)})
    png = out_dir / f"{stem}_seed.png"
    js  = out_dir / f"{stem}_seed.json"
    cv2.imwrite(str(png), img)
    js.write_text(json.dumps(seed_json, indent=2), encoding="utf-8")
    events.log(f"Seed preview → {png.name}  ({len(dets)} people detected at {t_sec:.1f}s)")
    events.progress("seed", 1, 1)

    events.result(
        kind="seed_preview",
        video_path=str(video_path),
        seed_png=str(png),
        seed_json=str(js),
        frame_idx=int(frame_idx),
        t_sec=float(t_sec),
        dets=seed_json["dets"],
    )
    return seed_json


def _prepare_poses(video_path, out_dir, data_dir, pose_letter, refine_mode, seed):
    """Return a poses object (loaded-from-JSON form, _normalise_poses applied),
    ensuring the on-disk cache is refined (Halpe-26) + lifted (VideoPose3D).

    Cache reuse mirrors reextract_all.py: a fully refined+lifted cache is loaded
    as-is; a partial cache resumes from the missing pass; otherwise a fresh
    extraction runs. Seeded (crowd-mode) runs always re-extract.
    """
    import pathlib
    out_dir = pathlib.Path(out_dir)
    stem = video_path.stem
    poses_path = out_dir / f"{stem}_poses.json"
    pass1_path = out_dir / f"{stem}_poses_pass1.json"

    data = None          # numpy-form working dict for the refine/lift passes
    need_extract = seed is not None

    if not need_extract and poses_path.exists():
        raw = json.loads(poses_path.read_text(encoding="utf-8"))
        if _is_refined_lifted(raw):
            events.log(f"Loading cached refined+lifted poses from {poses_path.name} …")
            return _normalise_poses(raw)
        # Partial cache (pass-1 only, or refined-not-lifted): resume from it.
        events.log(f"Resuming from partial cache {poses_path.name} …")
        data = pr.load_pass1(poses_path)
    elif not need_extract and pass1_path.exists():
        # An interrupted earlier run left only the pass-1 backup — resume from it.
        events.log(f"Resuming from pass-1 backup {pass1_path.name} …")
        data = pr.load_pass1(pass1_path)
    else:
        need_extract = True

    if need_extract:
        weights = _weights_for(data_dir, pose_letter)
        why = "seeded re-extraction" if seed is not None else "pose extraction"
        events.log(f"Running {why} on {video_path.name} …")
        events.progress("extract", 0, 1)

        def _extract_cb(cur, total):
            events.progress("extract", cur, total)

        data = pe.extract_poses(
            str(video_path), model_name=weights,
            seed_frame_idx=(seed or {}).get("frame_idx"),
            seed_points=(seed or {}).get("points"),
            progress_cb=_extract_cb,
        )

    # ── pass-1 backup (reextract_all convention: keep the pre-refine poses) ──
    if not pass1_path.exists() and data.get("keypoint_format") != "halpe26":
        _atomic_write_text(str(pass1_path),
                           json.dumps(pe.poses_to_serialisable(data)))

    # ── pass 2: refine (skip if the cache is already Halpe-26) ──────────────
    if data.get("keypoint_format") != "halpe26":
        events.progress("refine", 0, 1)

        def _refine_cb(cur, total):
            events.progress("refine", cur, total)

        data = pr.refine_poses(str(video_path), data, mode=refine_mode,
                               progress_cb=_refine_cb)

    # ── pass 3: lift (skip if already lifted) ───────────────────────────────
    if data.get("kps3d_format") != "h36m17":
        events.progress("lift", 0, 1)
        data = pl.lift_poses(data)
        events.progress("lift", 1, 1)

    # Persist the refined+lifted cache atomically, then reload from JSON so the
    # object fed to build_report is structurally identical to the source path
    # (which always reads a refined+lifted cache) — the golden-diff guarantee.
    _save_poses_atomic(data, poses_path)
    return _normalise_poses(json.loads(poses_path.read_text(encoding="utf-8")))


def _load_pro_metrics(entry: dict, manifest_dir):
    """Return a pro clip's metrics dict, or None.

    Precomputed-metrics branch (packaged path): if the entry names a "metrics"
    JSON, load it directly (KB-scale, no pose files shipped). Otherwise fall back
    to the source behaviour — recompute from a poses file via compute_all_metrics.
    """
    import pathlib
    manifest_dir = pathlib.Path(manifest_dir)

    if entry.get("metrics"):
        mp = pathlib.Path(entry["metrics"])
        if not mp.is_absolute():
            mp = manifest_dir / mp
        if not mp.exists():
            return None
        return json.loads(mp.read_text(encoding="utf-8"))

    # Recompute-from-poses fallback (same code path as export_baseline).
    pp = entry.get("poses")
    if not pp:
        return None
    pp = pathlib.Path(pp)
    if not pp.is_absolute():
        pp = manifest_dir / pp
    if not pp.exists():
        return None
    poses = _normalise_poses(json.loads(pp.read_text(encoding="utf-8")))
    if entry.get("video"):
        vp = pathlib.Path(entry["video"])
        poses["video_path"] = str(vp if vp.is_absolute() else manifest_dir / vp)
    return dm.compute_all_metrics(poses)


def analyze(input_str, out_dir, data_dir, *, me="left", me_id=None, role="lead",
            partner=False, spotlight=False, pose_model="m", refine_mode="balanced",
            seed_me_idx=None, seed_partner_idx=None, compare_pros=False,
            pro_refs=None):
    """Full analysis pipeline. Mirrors analyze.py main() for the report path so the
    `<stem>_report.txt` stays byte-identical (outside NDJSON mode) on a refined+
    lifted cache. Emits progress per stage and a final result event kind "analysis".
    """
    import pathlib
    out_dir = pathlib.Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # ── step 1: resolve input to a local video file ─────────────────────────
    if input_str.startswith("http://") or input_str.startswith("https://"):
        events.progress("download", 0, 1)
    video_path, _is_url, video_title = resolve_input(input_str, out_dir, data_dir)

    stem = video_path.stem

    # ── crowd mode: load the seed sidecar if seed indices were given ─────────
    seeded = seed_me_idx is not None and seed_partner_idx is not None
    seed = _load_seed(out_dir, stem, seed_me_idx, seed_partner_idx) if seeded else None

    # ── step 2: poses (extract → refine → lift, cached) ─────────────────────
    events.log(f"Analysing: {video_path.name}")
    poses = _prepare_poses(video_path, out_dir, data_dir, pose_model, refine_mode, seed)
    poses["video_path"] = str(video_path)

    # Resolve which tracked Dancer ID is the user (their role is set by `role`).
    # This is the RAW, pre-orientation tracked id from the poses cache — i.e.
    # exactly what --me-id selects (--me-id is consumed here, before
    # _orient_lead_first runs). It's preserved as `you_id_raw` below because
    # `you_id` itself gets overwritten to a post-orientation constant (1 for
    # lead / 2 for follow) a few lines down, which is useless for picking the
    # COMPLEMENTARY physical dancer on a "swap" rerun.
    if seeded:
        you_id = 1   # seed step 2 pins dancer 1 = you, dancer 2 = partner
        events.log(f"You ({role}) = Dancer 1 (seeded as the person you picked, #{seed_me_idx})")
    elif me_id is not None:
        you_id = me_id
        events.log(f"You ({role}) = Dancer {you_id} (set explicitly via --me-id)")
    else:
        you_id = _dancer_on_side(poses, me)
        events.log(f"You ({role}) start on the {me} → Dancer {you_id}")
    you_id_raw = you_id

    # Orient tracking so the actual LEAD is Dancer 1 (true roles, not tracker order).
    partner_tracked = 2 if you_id == 1 else 1
    lead_tracked    = you_id if role == "lead" else partner_tracked
    if lead_tracked != 1:
        _orient_lead_first(poses)
        events.log("(Oriented tracking so the lead is Dancer 1 — metrics reflect true roles.)")
    you_id = 1 if role == "lead" else 2

    # ── step 3: metrics ─────────────────────────────────────────────────────
    events.progress("metrics", 0, 1)
    events.log("Computing metrics …")
    metrics = dm.compute_all_metrics(poses)
    metrics["spotlight"] = bool(spotlight)
    events.progress("metrics", 1, 1)

    # (f) dump the metrics dict as <stem>_metrics.json (JSON-safe).
    metrics_path = out_dir / f"{stem}_metrics.json"
    _atomic_write_text(str(metrics_path),
                       json.dumps(metrics, default=_json_default))

    # ── step 4: report ──────────────────────────────────────────────────────
    events.progress("report", 0, 1)
    events.log("Building report …\n")
    report = dr.build_report(str(video_path), poses, metrics, you_id=you_id,
                             me=(None if me_id is not None else me),
                             spotlight=spotlight, my_role=role)

    report_path = out_dir / f"{stem}_report.txt"
    report_path.write_text(report, encoding="utf-8")
    # In human mode, print the report exactly like the source (golden-diff parity);
    # in NDJSON mode stdio.capture() forwards these lines as log events.
    print(report)
    print(f"\n  Report saved → {report_path}")
    events.progress("report", 1, 1)

    # ── step 5: pro comparison (optional) ───────────────────────────────────
    gap_path = None
    if compare_pros:
        events.progress("gap", 0, 1)
        from . import baselines
        try:
            manifest = baselines.load_manifest(pro_refs)
        except FileNotFoundError:
            manifest = None
        if manifest is None:
            events.log("(No pro baselines configured — skipping comparison)")
        else:
            pro_entries = []
            for entry in manifest["entries"]:
                pm = _load_pro_metrics(entry, manifest["dir"])
                if pm:
                    pro_entries.append((entry.get("label", entry.get("couple", "pro")),
                                        pm, int(entry.get("lead_id", 1)),
                                        entry.get("couple", entry.get("label", "pro"))))
            if pro_entries:
                gap = _gap_report(metrics, pro_entries, you_id=you_id,
                                  include_partner=partner, spotlight=spotlight,
                                  my_role=role)
                print(gap)
                gap_path = out_dir / f"{stem}_gap_analysis.txt"
                gap_path.write_text(gap, encoding="utf-8")
                print(f"  Gap analysis saved → {gap_path}")
            else:
                print("  (No pro reference metrics found — skipping comparison)")
        events.progress("gap", 1, 1)

    tq = metrics.get("tracking_quality", {})
    coverage = {label: tq.get(label, {}).get("coverage_pct") for label in ("lead", "follow")}

    events.result(
        kind="analysis",
        report_path=str(report_path),
        gap_path=(str(gap_path) if gap_path else None),
        metrics_path=str(metrics_path),
        poses_path=str(out_dir / f"{stem}_poses.json"),
        video_path=str(video_path),
        video_title=video_title,
        you_id=you_id,
        you_id_raw=you_id_raw,
        role=role,
        coverage=coverage,
    )
    return {"report_path": str(report_path),
            "gap_path": (str(gap_path) if gap_path else None),
            "metrics_path": str(metrics_path)}


class _WeightsMissing(Exception):
    """Raised when a fresh extraction is needed but the pose weights aren't present."""
    def __init__(self, path):
        super().__init__(path)
        self.path = path
