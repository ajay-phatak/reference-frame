"""NDJSON contract tests — lightweight, no heavy deps at collection time.

Verifies the Electron-facing stdout protocol without touching the vendored
pipeline (torch/ultralytics/librosa are never imported here; the one command
exercised end-to-end is `doctor`, whose heavy imports are try/except'd):

  * every stdout line in --ndjson mode parses as a JSON object,
  * vendored-style print() output is captured into log events,
  * error paths emit a single terminal error event with a typed code,
  * without --ndjson, prints pass through untouched (golden-diff mode).

Full pipeline tests happen in a later phase against a real venv.
"""

import argparse
import io
import json
import sys
import types
from pathlib import Path

import pytest

# Make the engine package importable when running pytest from engine/.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from refframe_engine import events, stdio  # noqa: E402
from refframe_engine import cli            # noqa: E402
import refframe_engine                     # noqa: E402


@pytest.fixture()
def ndjson_out(monkeypatch):
    """Enable NDJSON mode and capture the event stream; restore afterwards."""
    buf = io.StringIO()
    monkeypatch.setattr(events, "_stdout", buf)
    monkeypatch.setattr(events, "enabled", True)
    return buf


def _lines(buf):
    return [ln for ln in buf.getvalue().splitlines() if ln.strip()]


def _parsed(buf):
    out = []
    for ln in _lines(buf):
        obj = json.loads(ln)          # raises → test fails: line wasn't JSON
        assert isinstance(obj, dict) and "event" in obj
        out.append(obj)
    return out


# ── events.py ────────────────────────────────────────────────────────────────

def test_every_event_is_one_json_line(ndjson_out):
    events.progress("extract", 25, 100, detail="frame 25")
    events.log("hello")
    events.log("warn line", level="warning")
    events.result(kind="analysis", report_path="r.txt", you_id=1)
    events.error("boom", code="extraction_failed")

    objs = _parsed(ndjson_out)
    assert [o["event"] for o in objs] == ["progress", "log", "log", "result", "error"]
    assert objs[0] == {"event": "progress", "stage": "extract",
                       "current": 25, "total": 100, "detail": "frame 25"}
    assert objs[3]["kind"] == "analysis"
    assert objs[4]["code"] == "extraction_failed"


def test_disabled_mode_prints_plainly(monkeypatch, capsys):
    monkeypatch.setattr(events, "enabled", False)
    events.progress("extract", 1, 2)          # silent no-op
    events.result(kind="analysis")            # silent no-op
    events.log("plain text")                  # plain print
    captured = capsys.readouterr()
    assert captured.out == "plain text\n"
    with pytest.raises(json.JSONDecodeError):
        json.loads(captured.out.strip() + "x")  # sanity: it's not JSON we rely on


# ── stdio.capture ────────────────────────────────────────────────────────────

def test_capture_turns_prints_into_log_events(ndjson_out):
    with stdio.capture():
        print("  vendored progress line")
        print("multi\nline")
        sys.stdout.write("partial without newline")
    objs = _parsed(ndjson_out)
    assert all(o["event"] == "log" for o in objs)
    assert [o["msg"] for o in objs] == [
        "  vendored progress line", "multi", "line", "partial without newline"]


def test_capture_is_passthrough_when_disabled(monkeypatch, capsys):
    monkeypatch.setattr(events, "enabled", False)
    with stdio.capture():
        print("raw output")
    assert capsys.readouterr().out == "raw output\n"


def test_events_bypass_capture_shim(ndjson_out):
    # An event emitted INSIDE a capture block must go to the real stream,
    # not be swallowed and re-wrapped as a log line.
    with stdio.capture():
        events.progress("refine", 200, 400)
        print("a vendored print")
    objs = _parsed(ndjson_out)
    kinds = [o["event"] for o in objs]
    assert kinds.count("progress") == 1
    assert kinds.count("log") == 1


# ── CLI error paths (heavy modules stubbed) ──────────────────────────────────

def _stub_run(monkeypatch, analyze_side_effect):
    """Install fake refframe_engine.run and pose_lift modules so cli handlers
    never import the heavy vendored chain (pose_lift → pose_refine → cv2 →
    pose_extraction → ultralytics/torch)."""
    # cli._patch_checkpoint_dir does `import pose_lift` — stub it out.
    pl_stub = types.ModuleType("pose_lift")
    pl_stub.CHECKPOINT_DIR = Path(".")
    monkeypatch.setitem(sys.modules, "pose_lift", pl_stub)

    stub = types.ModuleType("refframe_engine.run")

    class _WeightsMissing(Exception):
        def __init__(self, path):
            super().__init__(path)
            self.path = path

    def analyze(*a, **k):
        raise analyze_side_effect

    stub._WeightsMissing = _WeightsMissing
    stub.analyze = analyze
    monkeypatch.setitem(sys.modules, "refframe_engine.run", stub)
    monkeypatch.setattr(refframe_engine, "run", stub, raising=False)
    return stub


def _run_cli(argv, buf):
    rc = cli.main(argv)
    return rc, _parsed(buf)


def test_analyze_missing_file_emits_single_error(ndjson_out, monkeypatch, tmp_path):
    _stub_run(monkeypatch, FileNotFoundError(str(tmp_path / "nope.mp4")))
    rc, objs = _run_cli(["analyze", str(tmp_path / "nope.mp4"),
                         "--out-dir", str(tmp_path), "--data-dir", str(tmp_path)],
                        ndjson_out)
    assert rc != 0
    errors = [o for o in objs if o["event"] == "error"]
    assert len(errors) == 1
    assert errors[0]["code"] == "file_not_found"
    assert not any(o["event"] == "result" for o in objs)


def test_analyze_missing_seed_emits_no_seed(ndjson_out, monkeypatch, tmp_path):
    _stub_run(monkeypatch, FileNotFoundError(str(tmp_path / "clip_seed.json")))
    rc, objs = _run_cli(["analyze", "clip.mp4", "--out-dir", str(tmp_path),
                         "--data-dir", str(tmp_path),
                         "--seed-me-idx", "0", "--seed-partner-idx", "1"],
                        ndjson_out)
    assert rc != 0
    errors = [o for o in objs if o["event"] == "error"]
    assert len(errors) == 1
    assert errors[0]["code"] == "no_seed"


def test_analyze_weights_missing_code(ndjson_out, monkeypatch, tmp_path):
    stub = _stub_run(monkeypatch, RuntimeError("placeholder"))

    def analyze(*a, **k):
        raise stub._WeightsMissing(str(tmp_path / "models" / "yolov8m-pose.pt"))

    stub.analyze = analyze
    rc, objs = _run_cli(["analyze", "clip.mp4", "--out-dir", str(tmp_path),
                         "--data-dir", str(tmp_path)], ndjson_out)
    assert rc != 0
    errors = [o for o in objs if o["event"] == "error"]
    assert len(errors) == 1
    assert errors[0]["code"] == "weights_missing"


def test_download_failure_code(ndjson_out, monkeypatch, tmp_path):
    _stub_run(monkeypatch, RuntimeError("YouTube download failed: 403"))
    rc, objs = _run_cli(["analyze", "https://youtu.be/abcdefghijk",
                         "--out-dir", str(tmp_path), "--data-dir", str(tmp_path)],
                        ndjson_out)
    assert rc != 0
    errors = [o for o in objs if o["event"] == "error"]
    assert len(errors) == 1
    assert errors[0]["code"] == "download_failed"


def test_unexpected_exception_is_terminal_typed_error(ndjson_out, monkeypatch, tmp_path):
    _stub_run(monkeypatch, KeyError("frames"))
    rc, objs = _run_cli(["analyze", "clip.mp4", "--out-dir", str(tmp_path),
                         "--data-dir", str(tmp_path)], ndjson_out)
    assert rc != 0
    errors = [o for o in objs if o["event"] == "error"]
    assert len(errors) == 1
    assert errors[0]["code"] == "internal"


# ── analyze: pro-baseline comparison degrades gracefully ─────────────────────
#
# Unlike the CLI-error-path tests above (which stub the whole `refframe_engine
# .run` module so the real one is never imported), this test exercises the
# real run.analyze() to verify its compare_pros branch specifically. Importing
# the real run.py unconditionally imports dance_metrics/dance_review/
# pose_extraction/pose_lift/pose_refine at module scope, which transitively
# pull in torch/ultralytics/cv2/librosa and (for pose weights) real network
# setup — exactly the past bug this suite guards against. So every one of
# those five vendored siblings is planted in sys.modules as a lightweight fake
# BEFORE the first `from refframe_engine import run`, the same trick
# `_stub_run` above uses for the single `pose_lift` import in cli.py.

def test_analyze_compare_pros_missing_manifest_is_non_fatal(ndjson_out, monkeypatch, tmp_path):
    def _boom(*a, **k):
        raise AssertionError("heavy vendored code path must not run in this test")

    dm_stub = types.ModuleType("dance_metrics")
    dm_stub.compute_all_metrics = lambda poses: {
        "tracking_quality": {"lead": {"coverage_pct": 90.0},
                             "follow": {"coverage_pct": 88.0}},
    }

    dr_stub = types.ModuleType("dance_review")
    dr_stub.build_report = lambda *a, **k: "FAKE REPORT\n"

    pe_stub = types.ModuleType("pose_extraction")
    for name in ("extract_poses", "poses_to_serialisable", "detect_single_frame",
                "get_center", "body_height", "torso_angle", "shoulder_angle", "hip_angle"):
        setattr(pe_stub, name, _boom)

    pl_stub = types.ModuleType("pose_lift")
    pl_stub.CHECKPOINT_DIR = Path(".")
    pl_stub.lift_poses = _boom
    pl_stub.save_poses = _boom

    prf_stub = types.ModuleType("pose_refine")
    prf_stub.load_pass1 = _boom
    prf_stub.refine_poses = _boom

    monkeypatch.setitem(sys.modules, "dance_metrics", dm_stub)
    monkeypatch.setitem(sys.modules, "dance_review", dr_stub)
    monkeypatch.setitem(sys.modules, "pose_extraction", pe_stub)
    monkeypatch.setitem(sys.modules, "pose_lift", pl_stub)
    monkeypatch.setitem(sys.modules, "pose_refine", prf_stub)
    monkeypatch.delenv("REFFRAME_BASELINES", raising=False)

    try:
        from refframe_engine import run   # first real import: resolves to the stubs above

        # _prepare_poses does the real extract/refine/lift work; bypass it too
        # so this test only exercises analyze()'s own orchestration + the new
        # compare_pros/missing-manifest branch.
        monkeypatch.setattr(run, "_prepare_poses", lambda *a, **k: {"video_path": None})

        video = tmp_path / "clip.mp4"
        video.write_bytes(b"fake")
        out_dir = tmp_path / "out"

        with stdio.capture():
            run.analyze(str(video), str(out_dir), str(tmp_path),
                       me_id=1, role="lead", compare_pros=True,
                       pro_refs=str(tmp_path / "does_not_exist.json"))
    finally:
        # Don't leave the real (stub-backed) run module cached for later tests.
        sys.modules.pop("refframe_engine.run", None)
        if hasattr(refframe_engine, "run"):
            delattr(refframe_engine, "run")

    objs = _parsed(ndjson_out)
    assert not any(o["event"] == "error" for o in objs)
    logs = [o["msg"] for o in objs if o["event"] == "log"]
    assert any("No pro baselines configured" in m for m in logs)
    results = [o for o in objs if o["event"] == "result"]
    assert len(results) == 1
    assert results[0]["kind"] == "analysis"
    assert results[0]["gap_path"] is None


# ── export-baseline: NDJSON result shape ──────────────────────────────────────

def test_export_baseline_ndjson_result_shape(ndjson_out, monkeypatch, tmp_path):
    """Cheap smoke test: baselines.py itself has no heavy top-level imports
    (json/os/pathlib only — `from . import run` / `import dance_metrics` are
    lazy, inside export_baseline's body), so it's safe to import for real and
    only stub its export_baseline function (avoiding the real compute path)
    plus pose_lift (cli._patch_checkpoint_dir imports it directly). Calls
    _cmd_export_baseline directly with a hand-built Namespace rather than via
    cli.main()/argv, since the export-baseline subparser has no --data-dir
    flag and would otherwise resolve+create directories under the dev default
    data dir instead of tmp_path."""
    pl_stub = types.ModuleType("pose_lift")
    pl_stub.CHECKPOINT_DIR = Path(".")
    monkeypatch.setitem(sys.modules, "pose_lift", pl_stub)

    from refframe_engine import baselines, cli

    out_path = tmp_path / "pro.metrics.json"

    def fake_export_baseline(video, poses_path, *, label, couple, lead_id, out):
        return {"out": str(out),
                "entry": {"label": label, "couple": couple,
                         "lead_id": int(lead_id), "metrics": Path(out).name}}

    monkeypatch.setattr(baselines, "export_baseline", fake_export_baseline)

    args = argparse.Namespace(video="clip.mp4", poses="poses.json",
                              label="Semion & Maria", couple="semion_maria",
                              lead_id=1, out=str(out_path), data_dir=str(tmp_path))
    rc = cli._cmd_export_baseline(args)

    assert rc == 0
    objs = _parsed(ndjson_out)
    results = [o for o in objs if o["event"] == "result"]
    assert len(results) == 1
    r = results[0]
    assert r["kind"] == "export_baseline"
    assert {"out", "entry"} <= set(r)
    assert set(r["entry"]) == {"label", "couple", "lead_id", "metrics"}


# ── doctor end-to-end (no heavy deps required: imports are try/except'd) ─────

# ── setup_models.py: retry + resume + typed network-failure errors ───────────
# setup_models.py only imports os/time/urllib/paths/events at module level (no
# torch/ultralytics/cv2), so it's safe to import directly here without the
# heavy-dep stubbing the analyze tests above need. _download streams via
# urllib.request.urlopen, so that's the seam these tests fake.

class _FakeResponse:
    """Minimal stand-in for urlopen's response: status, headers, chunked
    read(), context manager. `cut_after` truncates the body mid-stream to
    simulate a connection dropped before Content-Length bytes arrived."""

    def __init__(self, body, status=200, headers=None, cut_after=None):
        self._body = body if cut_after is None else body[:cut_after]
        self.status = status
        self.headers = headers or {}
        self._pos = 0

    def read(self, n):
        chunk = self._body[self._pos:self._pos + n]
        self._pos += n
        return chunk

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def test_setup_download_resumes_across_retries(tmp_path, monkeypatch):
    from refframe_engine import setup_models as sm

    body = b"weights"
    ranges = []

    def fake_urlopen(req, timeout=None):
        ranges.append(req.get_header("Range"))
        if len(ranges) == 1:
            # Full-file attempt dies after 3 of 7 bytes (short body).
            return _FakeResponse(body, headers={"Content-Length": "7"}, cut_after=3)
        # Retry must ask for the remainder and get a 206 with just that.
        assert ranges[-1] == "bytes=3-"
        return _FakeResponse(body[3:], status=206,
                             headers={"Content-Range": "bytes 3-6/7"})

    monkeypatch.setattr(sm.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(sm.time, "sleep", lambda s: None)  # skip real backoff in tests

    dest = tmp_path / "yolov8m-pose.pt"
    sm._download("https://example.invalid/yolov8m-pose.pt", str(dest), "weights")

    assert ranges == [None, "bytes=3-"]
    assert dest.read_bytes() == b"weights"
    assert not dest.with_suffix(dest.suffix + ".part").exists()


def test_setup_download_exhausts_retries_raises_runtime_error(tmp_path, monkeypatch):
    from refframe_engine import setup_models as sm

    def always_fail(req, timeout=None):
        # urlopen raises URLError (an OSError subclass) for connection resets
        # like WinError 10054 — this is exactly the case that used to bypass
        # cli.py's RuntimeError handler and land as code "internal".
        raise OSError(10054, "An existing connection was forcibly closed")

    monkeypatch.setattr(sm.urllib.request, "urlopen", always_fail)
    monkeypatch.setattr(sm.time, "sleep", lambda s: None)

    dest = tmp_path / "yolov8m-pose.pt"
    with pytest.raises(RuntimeError):
        sm._download("https://example.invalid/yolov8m-pose.pt", str(dest), "weights")
    assert not dest.exists()
    # The connection died before any body bytes, so no .part accumulates
    # (when bytes HAVE landed, the .part deliberately survives for resume).
    assert not (tmp_path / "yolov8m-pose.pt.part").exists()


def test_setup_network_failure_emits_download_failed(ndjson_out, monkeypatch, tmp_path):
    """End-to-end through cli.py: a network failure during `setup` (now always
    surfaced as a RuntimeError by setup_models, per the two tests above) must
    produce a single typed download_failed error event, not fall through to
    the generic "internal" catch-all in cli.main()."""
    # Patch the real module's setup attribute rather than planting a stub
    # module in sys.modules: cli.py's `from . import setup_models` resolves
    # via the package attribute once any earlier test has imported the real
    # module, silently bypassing a sys.modules stub — and then this test runs
    # a REAL network setup.
    from refframe_engine import setup_models as sm

    def setup(*a, **k):
        raise RuntimeError(
            "Download failed after 3 attempts: "
            "https://github.com/ultralytics/assets/releases/download/v8.4.0/yolov8m-pose.pt "
            "([WinError 10054] An existing connection was forcibly closed by the remote host)"
        )

    monkeypatch.setattr(sm, "setup", setup)

    rc, objs = _run_cli(["setup", "--data-dir", str(tmp_path)], ndjson_out)
    assert rc != 0
    errors = [o for o in objs if o["event"] == "error"]
    assert len(errors) == 1
    assert errors[0]["code"] == "download_failed"


# ── doctor end-to-end (no heavy deps required: imports are try/except'd) ─────

def test_doctor_streams_json_and_one_result(ndjson_out, tmp_path):
    rc = cli.main(["doctor", "--data-dir", str(tmp_path)])
    objs = _parsed(ndjson_out)
    results = [o for o in objs if o["event"] == "result"]
    assert len(results) == 1
    r = results[0]
    assert r["kind"] == "doctor"
    for field in ("data_dir_writable", "yolo_weights", "videopose3d_checkpoint",
                  "ffmpeg", "torch", "onnxruntime", "baselines_manifest",
                  "rtmpose_cache"):
        assert field in r, f"doctor result missing check: {field}"
    assert r["data_dir_writable"]["ok"] is True
    # On a clean data dir, weights are absent → doctor must fail overall.
    assert r["yolo_weights"]["ok"] is False
    assert rc == 1
