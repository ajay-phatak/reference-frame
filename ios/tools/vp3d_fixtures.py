"""VideoPose3D parity fixtures for the iOS port (spike #1, step 1).

Runs the desktop engine's pose_lift.lift_poses() UNCHANGED (imported
read-only; only CHECKPOINT_DIR is monkeypatched, exactly as cli.py does)
and dumps what the Swift lifter must reproduce:

  input_poses.json        the 2D input, in the engine's poses.json schema
  d<id>_model_in.f32      (2, T+242, 17, 2)  normalised, edge-padded, [orig, flip]
  d<id>_<layer>.f32       (2, 1024, L)       pre-ReLU output of each conv+BN pair
                                             (= the fused conv after BN folding)
  d<id>_shrink.f32        (2, 51, T)
  d<id>_model_out.f32     (2, T, 17, 3)      raw net output, flip branch not yet undone
  d<id>_pos.i32           (N,)               span-relative positions actually tracked
  d<id>_pose3d.f32        (N, 17, 3)         final flip-averaged 3D (unrounded) at those positions
  manifest.json           shapes/dtypes + provenance (checkpoint sha, torch/numpy versions)

Arrays are raw little-endian, C order. Everything written here is derived from
the CC-BY-NC weights or from personal video, so the output dir is gitignored —
NEVER commit fixtures. Regenerate locally instead.

Usage (from the repo root, with the desktop engine venv):
  engine/.venv/Scripts/python.exe ios/tools/vp3d_fixtures.py synthetic
  engine/.venv/Scripts/python.exe ios/tools/vp3d_fixtures.py real --poses <run>_poses.json
Add --no-layers to skip the per-layer dumps (they dominate the size).
"""

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[2]
ENGINE_PKG = REPO / "engine" / "refframe_engine"
DEFAULT_OUT = Path(__file__).resolve().parent / "fixtures" / "vp3d"
CHECKPOINT_NAME = "pretrained_h36m_detectron_coco.bin"
CHECKPOINT_SHA256 = "d3219e005b50591f694da5cbaf6849f060d6b2cf895864a779f8a992ac63a232"

# Layer names in forward order. Each is the pre-ReLU output of a BN module,
# i.e. exactly what a BN-folded conv produces.
LAYER_NAMES = ["expand"] + [f"block{b}_{k}" for b in range(4) for k in ("dil", "pw")]


def default_weights() -> Path:
    appdata = os.environ.get("APPDATA", "")
    return Path(appdata) / "reference-frame" / "data" / "models" / "videopose3d" / CHECKPOINT_NAME


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# --- synthetic input ---------------------------------------------------------

# Rough standing COCO-17 pose, in units of body height, origin at the pelvis,
# y down. Rows 17-25 fill out Halpe-26 (unused by the lift, but present in real
# input, so the [:17] slice gets exercised).
_COCO = np.array([
    [0.00, -0.88], [-0.03, -0.91], [0.03, -0.91], [-0.07, -0.89], [0.07, -0.89],
    [-0.13, -0.70], [0.13, -0.70], [-0.17, -0.45], [0.17, -0.45],
    [-0.18, -0.22], [0.18, -0.22], [-0.09, 0.00], [0.09, 0.00],
    [-0.10, 0.27], [0.10, 0.27], [-0.10, 0.52], [0.10, 0.52],
])
_HALPE_EXTRA = np.array([
    [0.00, -1.00], [0.00, -0.74], [0.00, 0.00],
    [-0.12, 0.56], [0.12, 0.56], [-0.08, 0.56], [0.08, 0.56], [-0.10, 0.54], [0.10, 0.54],
])


def _dancer_kps(t: int, cx: float, phase: float, height: float) -> np.ndarray:
    """(26, 3) Halpe-26 keypoints for frame t: sway, knee bend, arm swing."""
    s = 2 * np.pi * t / 30.0 + phase
    base = np.vstack([_COCO, _HALPE_EXTRA]).copy()
    base[:, 0] += 0.04 * np.sin(s)                     # hip sway
    base[[13, 14, 15, 16], 1] -= 0.03 * (1 + np.sin(2 * s))   # knee/ankle bend
    base[[7, 9], 0] -= 0.08 * np.sin(s)                # left arm swing
    base[[8, 10], 0] += 0.08 * np.sin(s + 0.7)         # right arm swing
    xy = base * height + np.array([cx, 600.0])
    return np.hstack([xy, np.full((26, 1), 0.9)])


def synthetic_pose_data() -> dict:
    """Two dancers plus a degenerate third, covering every lift_poses branch:
    interior / leading / trailing low-confidence gaps (interp + edge hold),
    frames inside a dancer's span where it isn't tracked at all (seq zeros
    then interpolated), a joint that is never confident (raw coords kept,
    zeros in untracked frames), and a 1-frame dancer (skipped)."""
    fps, n_frames = 30.0, 150
    frames = []
    for t in range(n_frames):
        dancers = {}
        k1 = _dancer_kps(t, cx=700.0 + 2.0 * t, phase=0.0, height=640.0)
        if 40 <= t <= 55:
            k1[9, 2] = 0.05            # left wrist: interior gap
        if t < 10:
            k1[15, 2] = 0.05           # left ankle: leading edge held
        if t >= n_frames - 8:
            k1[16, 2] = 0.05           # right ankle: trailing edge held
        dancers[1] = k1

        if 30 <= t <= 129 and not (70 <= t <= 79):     # span 30..129, untracked 70..79
            k2 = _dancer_kps(t, cx=1250.0 - 1.5 * t, phase=1.3, height=580.0)
            k2[3, 2] = 0.0             # left ear: never confident
            dancers[2] = k2

        if t == 12:
            dancers[3] = _dancer_kps(t, cx=300.0, phase=0.0, height=500.0)   # 1 frame → skipped

        frames.append({"frame_idx": t, "time_sec": t / fps, "dancers": dancers})
    return {"video": "synthetic", "fps": fps, "width": 1920, "height": 1080,
            "dancer_ids": [1, 2, 3], "keypoint_format": "halpe26", "frames": frames}


def poses_json(pose_data: dict) -> dict:
    out = {k: v for k, v in pose_data.items() if k != "frames"}
    out["frames"] = [{"frame_idx": f["frame_idx"], "time_sec": f["time_sec"],
                      "dancers": {str(d): np.asarray(k, dtype=np.float64).tolist()
                                  for d, k in f["dancers"].items()}}
                     for f in pose_data["frames"]]
    return out


# --- capture -----------------------------------------------------------------

def run_lift(pose_data: dict, weights: Path, want_layers: bool):
    sys.path.insert(0, str(ENGINE_PKG))
    import torch
    import pose_lift as pl

    pl.CHECKPOINT_DIR = weights.parent     # same monkeypatch as cli.py; file untouched
    calls = []                             # one dict per model() call == per lifted dancer
    model_ref = {}
    orig_load = pl._load_model

    def hooked_load():
        m = orig_load()
        model_ref["m"] = m
        layers = [m.expand_bn] + list(m.layers_bn)

        def grab(name):
            def hook(_mod, _inp, out):
                calls[-1][name] = out.detach().numpy().copy()
            return hook

        def on_model(_mod, inp):
            calls.append({"model_in": inp[0].detach().numpy().copy()})

        def on_model_out(_mod, _inp, out):
            calls[-1]["model_out"] = out.detach().numpy().copy()

        m.register_forward_pre_hook(on_model)
        m.register_forward_hook(on_model_out)
        m.shrink.register_forward_hook(grab("shrink"))
        if want_layers:
            for name, mod in zip(LAYER_NAMES, layers):
                mod.register_forward_hook(grab(name))
        return m

    pl._load_model = hooked_load
    try:
        result = pl.lift_poses(pose_data)
    finally:
        pl._load_model = orig_load
    return result, calls, model_ref["m"], torch.__version__


def numpy_folded_reference(model, x: np.ndarray) -> dict:
    """Independent float64 re-implementation of the net with BN folded into the
    convs — the algorithm the Swift backend will use. x: (B, T, 17, 2).
    Returns pre-ReLU layer outputs keyed like LAYER_NAMES plus shrink/model_out."""
    sd = {k: v.detach().numpy().astype(np.float64) for k, v in model.state_dict().items()}

    def fold(conv_w, bn):
        g, b = sd[f"{bn}.weight"], sd[f"{bn}.bias"]
        mu, var = sd[f"{bn}.running_mean"], sd[f"{bn}.running_var"]
        s = g / np.sqrt(var + 1e-5)
        return conv_w * s[:, None, None], b - mu * s

    def conv(h, w, bias, dilation):
        # h: (B, Cin, L); w: (Cout, Cin, K); valid conv with dilation
        k = w.shape[2]
        L = h.shape[2] - (k - 1) * dilation
        y = sum(np.einsum("oc,bcl->bol", w[:, :, j], h[:, :, j * dilation: j * dilation + L])
                for j in range(k))
        return y + bias[None, :, None]

    B, T = x.shape[:2]
    h = x.reshape(B, T, -1).transpose(0, 2, 1).astype(np.float64)
    out = {}
    w, b = fold(sd["expand_conv.weight"], "expand_bn")
    pre = conv(h, w, b, 1)
    out["expand"] = pre
    h = np.maximum(pre, 0)
    dilation = 3
    for blk in range(4):
        res = h[:, :, dilation: h.shape[2] - dilation]
        w, b = fold(sd[f"layers_conv.{2*blk}.weight"], f"layers_bn.{2*blk}")
        pre = conv(h, w, b, dilation)
        out[f"block{blk}_dil"] = pre
        w, b = fold(sd[f"layers_conv.{2*blk+1}.weight"], f"layers_bn.{2*blk+1}")
        pre = conv(np.maximum(pre, 0), w, b, 1)
        out[f"block{blk}_pw"] = pre
        h = res + np.maximum(pre, 0)
        dilation *= 3
    s = conv(h, sd["shrink.weight"], sd["shrink.bias"], 1)
    out["shrink"] = s
    out["model_out"] = s.transpose(0, 2, 1).reshape(B, -1, 17, 3)
    return out


# --- output ------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("case", choices=["synthetic", "real"])
    ap.add_argument("--poses", type=Path, help="refined <stem>_poses.json (case=real)")
    ap.add_argument("--weights", type=Path, default=default_weights())
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--no-layers", action="store_true")
    ap.add_argument("--no-numpy-ref", action="store_true",
                    help="skip the float64 folded-BN cross-check")
    args = ap.parse_args()

    if not args.weights.is_file() or args.weights.name != CHECKPOINT_NAME:
        sys.exit(f"checkpoint not found: {args.weights}")
    ck_sha = sha256(args.weights)
    if ck_sha != CHECKPOINT_SHA256:
        sys.exit(f"checkpoint sha256 mismatch: {ck_sha}")

    if args.case == "synthetic":
        pose_data = synthetic_pose_data()
        source = {"kind": "synthetic"}
    else:
        if not args.poses:
            sys.exit("--poses is required for case=real")
        sys.path.insert(0, str(ENGINE_PKG))
        import pose_refine as pr
        pose_data = pr.load_pass1(args.poses)
        if pose_data.get("keypoint_format") != "halpe26":
            print("WARNING: input is not refined (halpe26) poses", file=sys.stderr)
        source = {"kind": "real", "poses_file": args.poses.name, "poses_sha256": sha256(args.poses)}

    out_dir = args.out or (DEFAULT_OUT / args.case)
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in list(out_dir.glob("*.f32")) + list(out_dir.glob("*.i32")):
        old.unlink()

    input_json = poses_json(pose_data)
    (out_dir / "input_poses.json").write_text(json.dumps(input_json), encoding="utf-8")

    result, calls, model, torch_version = run_lift(pose_data, args.weights, not args.no_layers)

    arrays = {}

    def dump(name, arr, dtype):
        a = np.ascontiguousarray(arr, dtype=dtype)
        ext = "f32" if dtype == np.float32 else "i32"
        (out_dir / f"{name}.{ext}").write_bytes(a.astype(a.dtype.newbyteorder("<")).tobytes())
        arrays[name] = {"file": f"{name}.{ext}", "dtype": a.dtype.name, "shape": list(a.shape)}

    # Recompute which dancers were lifted, in lift_poses' order (sorted ids,
    # >= 2 tracked frames), to label the per-call captures.
    frames = result["frames"]
    dids = sorted({d for f in frames for d in f["dancers"]})
    lifted = []
    for did in dids:
        pos = [i for i, f in enumerate(frames) if did in f["dancers"]]
        if len(pos) >= 2:
            lifted.append((did, pos))
    assert len(lifted) == len(calls), (len(lifted), len(calls))

    report = {}
    for (did, pos), cap in zip(lifted, calls):
        p = f"d{did}_"
        dump(p + "model_in", cap["model_in"], np.float32)
        for name in LAYER_NAMES:
            if name in cap:
                dump(p + name, cap[name], np.float32)
        dump(p + "shrink", cap["shrink"], np.float32)
        dump(p + "model_out", cap["model_out"], np.float32)
        rel = np.array([i - pos[0] for i in pos], dtype=np.int32)
        dump(p + "pos", rel, np.int32)
        final = np.stack([np.asarray(frames[i]["dancers3d"][did]) for i in pos])
        dump(p + "pose3d", final, np.float32)

        # Sanity: the dumped model_out, un-flipped and averaged, reproduces the
        # final pose3d bit-for-bit (proves the capture is the real data path).
        import pose_lift as pl
        o = cap["model_out"].copy()
        o[1, :, :, 0] *= -1
        o[1, :, pl.JOINTS_LEFT + pl.JOINTS_RIGHT] = o[1, :, pl.JOINTS_RIGHT + pl.JOINTS_LEFT]
        recon = o.mean(axis=0)[rel]
        assert np.array_equal(recon, final), "model_out does not reproduce pose3d"

        info = {"span": [pos[0], pos[-1]], "tracked": len(pos),
                "model_in_frames": int(cap["model_in"].shape[1])}
        if not args.no_numpy_ref:
            ref = numpy_folded_reference(model, cap["model_in"])
            diffs = {k: float(np.max(np.abs(ref[k] - cap[k]))) for k in ref if k in cap}
            info["numpy_folded_maxabs"] = diffs
        report[str(did)] = info

    manifest = {
        "case": args.case, "source": source,
        "width": pose_data["width"], "height": pose_data["height"],
        "lifted_dancers": [d for d, _ in lifted],
        "skipped_dancers": [d for d in dids if d not in [x for x, _ in lifted]],
        "receptive_field": int(model.receptive_field()),
        "layer_names": [n for n in LAYER_NAMES if not args.no_layers],
        "checkpoint_sha256": ck_sha, "torch": torch_version, "numpy": np.__version__,
        "arrays": arrays, "report": report,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    total = sum((out_dir / a["file"]).stat().st_size for a in arrays.values())
    print(f"wrote {len(arrays)} arrays ({total / 1e6:.1f} MB) + manifest to {out_dir}")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
