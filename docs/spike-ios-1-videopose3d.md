# iOS spike #1 — VideoPose3D on iPhone from the upstream checkpoint

Parent: [plan-ios.md](plan-ios.md) §P0. Go/no-go for the whole on-device
plan: if the 3D lift can't run on the phone without us redistributing the
CC-BY-NC weights, the 3D metrics (articulation, rotation/dissociation)
don't exist on iOS.

## Question

Can an iPhone download `pretrained_h36m_detectron_coco.bin` from
**upstream** (`https://dl.fbaipublicfiles.com/video-pose-3d/…`, same URL
as `pose_lift.py:48`), load it **without torch**, and produce the same
3D poses as desktop `lift_poses()`, fast enough and within memory?

## Constraints

- Never host, bundle, convert-and-publish, or commit the weights or any
  derivative (a CoreML file holding them counts). Conversion happens on
  the device, into the app's own container.
- Attribution: CC-BY needs credit — an About/licenses screen naming
  VideoPose3D (Pavllo et al., Facebook Research) and the license.
- The spike's code is meant to survive into P2, so build it properly
  rather than as a throwaway.

## What we're porting (from `pose_lift.py` / `videopose3d_model.py`)

- `TemporalModel(17, 2, 17, filter_widths=[3,3,3,3,3], channels=1024)`,
  non-causal, dense=False. Receptive field 243, pad 121 each side.
- Graph (eval mode, dropout is identity):
  1. `expand_conv` (34→1024, k=3, no bias) → BN → ReLU.
  2. Then 4 residual blocks, with dilations 3, 9, 27, 81. Each block: a
     k=3 dilated conv (no bias) → BN → ReLU, then a 1×1 conv (no bias)
     → BN → ReLU. The residual is the input centre-cropped by
     `pad = dilation` frames on each side.
  3. `shrink`: a 1×1 conv (1024→51, with bias).
- ~17M params in float32 (≈68 MB, matches the file). At load time, fold
  BN into the preceding conv (`w' = w·γ/√(σ²+ε)`,
  `b' = β − μ·γ/√(σ²+ε)`, with `ε = 1e-5`), so inference is only convs
  + ReLU + adds.
- Wrapper logic to port 1:1 (this is part of the parity surface):
  - Take the first 17 COCO rows. Treat `conf < 0.1` as missing, and
    linearly interpolate missing frames per joint over the dancer's
    tracked span, holding the edge values.
  - Normalise: `x/w·2 − [1, h/w]`.
  - Edge-pad by 121 on both sides.
  - Build a flip copy: negate x and swap `KPS_LEFT`/`KPS_RIGHT`.
  - Run both, un-flip the second (negate x, swap
    `JOINTS_LEFT`/`JOINTS_RIGHT`), then average.
  - Do this per dancer, independently. Attach the result only to frames
    where that dancer was tracked.

## Steps

**0. Inspect the checkpoint (desktop, ~30 min).** In `engine/.venv`:
`zipfile.is_zipfile` (old torch-pickle vs post-1.6 zip format, since the
file is from 2019), top-level keys (expect `model_pos`, maybe others),
every tensor's name/shape/dtype/stride, SHA-256. Record the results here.
That decides the loader's design.

**1. Fixture generator — `ios/tools/vp3d_fixtures.py`.** It uses
`engine/.venv` and imports the engine read-only (no edits to `engine/`).
It dumps raw little-endian float32 + a JSON manifest:
- *(Revised in step 1: NO fixtures are committed. Every output is
  derived from the NC weights or personal video. Only the generator is
  committed; `ios/tools/fixtures/` is gitignored and regenerated locally.
  The Swift tests need the weights locally anyway.)*
- **Synthetic**: deterministic sinusoidal
  COCO-17 tracks with a few confidence dropouts. Store the input, the
  normalised/padded tensor, each intermediate block activation (for
  debugging), the two raw model outputs, and the final flip-averaged
  pose3d.
- **Real clip** (local only, gitignored): the same dumps from a refined
  `<stem>_poses.json` of one of your practice runs. Use the unrounded
  outputs, not `dancers3d` from the json (that is rounded to 4 dp).

**2. `RefFrameKit` / `VideoPose3D` module (Swift package, built on the Mac):**
- `CheckpointReader`: a restricted parser for the torch **legacy**
  format (step 0 showed it isn't zip): five pickle streams followed by
  the appended storages. Exact layout is under Results. It is a whitelist unpickler, the
  equivalent of `weights_only=True`: only the opcodes needed, plus the
  globals `collections.OrderedDict`, `torch._utils._rebuild_tensor_v2`
  and `torch.FloatStorage`. Anything else is a hard error.
- Check the pinned SHA-256 before parsing. Check the shape of every
  expected key, and reject unexpected or missing keys.
- `TemporalModelCPU`: BN fold + inference via Accelerate (`cblas_sgemm`).
  A dilated k=3 conv is 3 GEMMs (1024×1024 · 1024×T) on shifted views.
  This is the reference backend: simple, float32, the same op order class
  as torch CPU.
- `Lifter`: the wrapper logic above.
- Tests: run against the synthetic fixtures (using locally downloaded
  weights; the test is skipped if they're absent), checking per-layer
  activations, then the raw output, then the final pose3d.

**3. On-device harness — a minimal SwiftUI test app on your iPhone**
(free provisioning is fine):
- Download from upstream with HTTP Range resume, then check size
  (≥50 MB, like `VIDEOPOSE3D_MIN_BYTES`) and the hash.
- Optionally cache the BN-folded weights as a raw float blob in
  Application Support, so later launches skip parsing. It stays local,
  so it isn't redistribution.
- Run the synthetic fixture (correctness on device) and a synthetic
  3-minute, 2-dancer workload (5400 frames × 2 dancers × flip).
- Report wall time, peak memory (`os_proc_available_memory` /
  Instruments), and `ProcessInfo.thermalState`.

**4. Only if step 3 misses the budget — a GPU backend.** Build the same
graph in MPSGraph (dilated conv as conv2d with height 1) and fill it with
the folded weights at runtime. If it's still too slow, the fallback is
the ANE route: ship a CoreML `.mlpackage` converted from a
**randomly-initialised** TemporalModel (architecture only, no NC
weights), patch its `weight.bin` with the folded weights on device, then
`MLModel.compileModel(at:)`. It's fragile (it depends on CoreML's blob
layout), so it's the last resort.

## Exit criteria

| | Go | No-go / rethink |
|---|---|---|
| Correctness (synthetic + real clip) | final pose3d max abs diff vs torch ≤ 1e-4 (metres); per-layer diffs explainable by float32 summation order | systematic drift, or any layer off by more than float noise |
| Runtime (3-min 2-dancer workload, target iPhone) | ≤ 30 s CPU backend, or ≤ 30 s after step 4 | > 2 min with every backend |
| Peak memory | ≤ 400 MB during the lift (process chunks of the sequence with 121-frame overlap if needed — results must be identical to unchunked) | can't fit without changing outputs |
| Load | parse + fold ≤ 5 s first launch; cached blob ≤ 1 s | — |
| Licensing | weights only ever fetched from upstream; nothing NC leaves the device | needs any hosted derivative |

A go here locks the 3D approach for P2. A no-go means falling back to
2D-only metrics on iOS: 3D articulation and rotation metrics get hidden
or replaced with their existing 2D fallbacks (`_articulation_per_step`
already has one). That should be decided explicitly, not drifted into.

## Open inputs

- Which iPhone (chip) you'll test on. It sets the runtime budget, and the
  target device floor in the parent plan.
- Which practice clip to use for the real-clip comparison (local only).
- Repo layout confirmation: this spike assumes `ios/` in this repo
  (`ios/RefFrameKit`, `ios/tools`, `ios/SpikeHarness`); `.gitignore`
  needs entries for local fixtures and any `*.bin` weights under `ios/`.

## Results

### Step 0 — checkpoint inspection (2026-10-01, Windows, engine/.venv)

- **File:** 67,892,577 bytes. SHA-256
  `d3219e005b50591f694da5cbaf6849f060d6b2cf895864a779f8a992ac63a232`.
  The app's data-dir copy and the golden-diff temp copy match. Pin this
  hash in the iOS downloader.
- **Format: LEGACY torch serialisation (not zip).** It is five
  back-to-back pickle streams (protocol 2), then raw storages:
  1. magic number `0x1950a86a20f9469cfc6c`
  2. protocol version `1001`
  3. sys_info `{little_endian: True, type_sizes: {short:2, int:4, long:4}}`
  4. the checkpoint object
  5. the list of 56 storage keys

  The storage blobs start at byte **8845**. Each blob is a little-endian
  int64 element count followed by raw data, in the order of the
  **storage-key list** (not the state_dict order). The last blob ends
  exactly at EOF.
- **Opcodes used:** PROTO, GLOBAL, REDUCE, BUILD, BINPERSID,
  MARK/TUPLE/TUPLE1/TUPLE3/EMPTY_TUPLE, EMPTY_DICT/SETITEM/SETITEMS,
  BININT/BININT1/BININT2/LONG1, BINFLOAT, BINUNICODE,
  BINPUT/LONG_BINPUT/BINGET/LONG_BINGET, NONE/NEWTRUE/NEWFALSE, STOP.
  That's ~25 opcodes, so the whitelist parser is small.
- **Globals used:** exactly `collections.OrderedDict`,
  `torch._utils._rebuild_tensor_v2`, `torch.FloatStorage` and
  `torch.LongStorage` (the last for `num_batches_tracked`, which we
  ignore). Anything else is rejected.
- **Persistent IDs:** `('storage', <type>, <key>, 'cuda:0', <numel>)`.
  The location tag is `cuda:0`; ignore it (we always load to CPU).
- **Top-level keys:** `epoch` (80), `lr` (1.65e-5), `model_pos`. There
  is no `model_traj` and no optimizer state.
- **`model_pos`:** 56 tensors, 16,970,812 parameters, all float32
  (except the 9 int64 `num_batches_tracked`).
  - Every tensor is contiguous, with storage offset 0 and its own
    storage (none are shared).
  - Shapes match the architecture: `expand_conv` (1024,34,3);
    `layers_conv.{0,2,4,6}` (1024,1024,3);
    `layers_conv.{1,3,5,7}` (1024,1024,1); `shrink` (51,1024,1) + bias
    (51); `expand_bn` and `layers_bn.0–7` each have
    weight/bias/running_mean/running_var of size (1024).
- **BN eps:** not stored. The model uses the `BatchNorm1d` default
  1e-5 (`videopose3d_model.py` only sets momentum).

**Conclusion:** the loader is a fixed-shape, whitelist-only parser for a
fully known layout. There's no zip support to write and no aliasing or
offset cases to handle. Step 0 is a go; next up is step 1 (the fixture
generator).

### Step 1 — fixtures (2026-10-01, Windows, torch CPU)

Generator: `ios/tools/vp3d_fixtures.py`.
- It runs the unmodified `pose_lift.lift_poses()`, monkeypatching only
  `CHECKPOINT_DIR` (as cli.py does), and captures tensors through forward
  hooks. It refuses a checkpoint whose SHA-256 differs from the pinned one.
- It asserts that the dumped `model_out`, after undoing the flip branch
  and averaging, reproduces the final pose3d **bit-for-bit**, which
  proves the capture is the real data path.
- Format: raw little-endian `.f32`/`.i32` files plus `manifest.json`
  (shapes, provenance, torch/numpy versions).
- The input goes into `input_poses.json`, in the engine's poses.json
  schema.

**Synthetic case** (42.9 MB with per-layer dumps):
- Dancer 1: 150 frames.
- Dancer 2: span 30–129, with frames 70–79 untracked.
- Dancer 3: a single frame, which is correctly skipped.
- It also covers interior, leading and trailing low-confidence gaps, and
  a joint that is never confident.

**Real case**: `ajay-betty-06032026` (run 20260930-145847), 2750 frames,
both dancers tracked across the full span; 7.2 MB with `--no-layers`.
- The fixture's pose3d vs the `dancers3d` that production saved in that
  run's poses.json: max raw diff is **5.0e-5**, i.e. within the 4-dp
  rounding of the saved file.
- So the fixtures reproduce what the shipping engine produced.

**Fold design proven ahead of Swift:**
- A float64 numpy re-implementation (BN folded into the convs with
  eps 1e-5, dilated valid convs, centre-cropped residuals) is built into
  the generator.
- Its max abs diff vs torch:

  | | Final output (metres) | Per-layer |
  |---|---|---|
  | Synthetic | ≤ 5.9e-7 | ≤ 1.3e-5 |
  | Real clip | ≤ 8.0e-7 | — |

- The spike's correctness gate is 1e-4, so there's two orders of
  magnitude of headroom for Swift's float32 GEMMs.

**Port detail found while writing this** (it must be replicated):
`_interp_gaps` leaves a joint that is **never** confident untouched. It
does NOT zero it, despite the comment. So such a joint keeps its raw
low-confidence coordinates on tracked frames, and is 0 only on frames
where the dancer wasn't tracked at all (and that 0 is then normalised
to `[-1, -h/w]`). The synthetic case's dancer 2, left ear, covers this.

Next: step 2 (Swift package, on the Mac). Before starting there, copy the
weights to the Mac and regenerate fixtures (or copy `ios/tools/fixtures/`).
