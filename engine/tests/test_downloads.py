"""Download robustness + setup error mapping. No network, no heavy imports."""

import errno
import io
import json
import os
import sys
import types
import urllib.error
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from refframe_engine import cli, events, setup_models as sm  # noqa: E402
from refframe_engine.download import DownloadError            # noqa: E402


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    monkeypatch.setattr(sm.time, "sleep", lambda s: None)


@pytest.fixture(autouse=True)
def _restore_env(monkeypatch):
    # cli._configure_env mutates os.environ; make monkeypatch undo it.
    for k in ("XDG_CACHE_HOME", "YOLO_CONFIG_DIR", "NUMBA_CACHE_DIR", "TORCH_HOME"):
        if k in os.environ:
            monkeypatch.setenv(k, os.environ[k])
        else:
            monkeypatch.delenv(k, raising=False)


@pytest.fixture()
def ndjson_out(monkeypatch):
    buf = io.StringIO()
    monkeypatch.setattr(events, "_stdout", buf)
    monkeypatch.setattr(events, "enabled", True)
    return buf


def _events(buf):
    return [json.loads(ln) for ln in buf.getvalue().splitlines() if ln.strip()]


def _http416(content_range):
    hdrs = {"Content-Range": content_range} if content_range else {}
    return urllib.error.HTTPError("http://x/f", 416, "Range Not Satisfiable", hdrs, None)


# ── 416 promotion rule ───────────────────────────────────────────────────────

def _run_416(tmp_path, monkeypatch, content_range, part_bytes=b"abcd"):
    dest = str(tmp_path / "w.bin")
    Path(dest + ".part").write_bytes(part_bytes)
    Path(dest + ".part.url").write_text("http://x/f")
    calls = {"n": 0}

    def fake_fetch(url, tmp, stage):
        calls["n"] += 1
        if calls["n"] == 1:
            raise _http416(content_range)
        Path(tmp).write_bytes(b"FRESHDOWNLOAD")

    monkeypatch.setattr(sm, "_fetch_with_resume", fake_fetch)
    sm._download("http://x/f", dest, "weights")
    return dest, calls["n"]


def test_416_promotes_part_when_total_known_and_equal(tmp_path, monkeypatch):
    dest, n = _run_416(tmp_path, monkeypatch, "bytes */4")
    assert n == 1 and Path(dest).read_bytes() == b"abcd"


def test_416_unknown_total_does_not_promote(tmp_path, monkeypatch):
    dest, n = _run_416(tmp_path, monkeypatch, None)
    assert n == 2 and Path(dest).read_bytes() == b"FRESHDOWNLOAD"


def test_416_size_mismatch_does_not_promote(tmp_path, monkeypatch):
    dest, n = _run_416(tmp_path, monkeypatch, "bytes */999")
    assert n == 2 and Path(dest).read_bytes() == b"FRESHDOWNLOAD"


# ── ENOSPC fails fast ────────────────────────────────────────────────────────

def test_enospc_fails_fast(tmp_path, monkeypatch):
    calls = {"n": 0}

    def fake_fetch(url, tmp, stage):
        calls["n"] += 1
        raise OSError(errno.ENOSPC, "No space left on device")

    monkeypatch.setattr(sm, "_fetch_with_resume", fake_fetch)
    with pytest.raises(DownloadError, match="disk space"):
        sm._download("http://x/f", str(tmp_path / "w.bin"), "weights")
    assert calls["n"] == 1


def test_stale_part_from_other_url_is_dropped(tmp_path, monkeypatch):
    dest = str(tmp_path / "w.bin")
    Path(dest + ".part").write_bytes(b"OLD")
    Path(dest + ".part.url").write_text("http://other/f")
    seen = {}

    def fake_fetch(url, tmp, stage):
        seen["have"] = os.path.exists(tmp)
        Path(tmp).write_bytes(b"new")

    monkeypatch.setattr(sm, "_fetch_with_resume", fake_fetch)
    sm._download("http://x/f", dest, "weights")
    assert seen["have"] is False


# ── .part cleanup on YOLO tag switch ─────────────────────────────────────────

def test_yolo_tag_fallback_deletes_leftover_part(tmp_path, monkeypatch):
    dest = sm.paths.yolo_weights_path(str(tmp_path), "m")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    state = []

    def fake_download(url, d, stage):
        state.append((url, os.path.exists(d + ".part")))
        if len(state) == 1:
            Path(d + ".part").write_bytes(b"bytes-from-first-asset")
            raise DownloadError("boom")
        Path(d).write_bytes(b"ok")

    monkeypatch.setattr(sm, "_download", fake_download)
    res = sm.ensure_yolo_weights(str(tmp_path), "m")
    assert res["tag"] == sm._ASSET_TAGS[1]
    assert state[1][1] is False           # .part gone before second URL started
    assert not os.path.exists(dest + ".part")


# ── RTMPose recovery ─────────────────────────────────────────────────────────

def _fake_pose_refine(monkeypatch, load):
    fake = types.ModuleType("pose_refine")
    fake._load_pose_model = load
    monkeypatch.setitem(sys.modules, "pose_refine", fake)


def _write_zip(dest):
    with zipfile.ZipFile(dest, "w") as z:
        z.writestr("a.txt", "x")


def test_rtmpose_badzip_purges_and_retries_once(tmp_path, monkeypatch):
    hub = tmp_path / "hub"
    monkeypatch.setattr(sm, "_rtmpose_paths", lambda mode: (
        "http://x/m.zip", str(hub / "m.zip"), str(hub / "m.onnx"), str(hub / "tmp")))
    downloads = []

    def fake_download(u, dest, stage):
        downloads.append(dest)
        _write_zip(dest)

    monkeypatch.setattr(sm, "_download", fake_download)
    loads = {"n": 0}

    def load(mode, dev):
        loads["n"] += 1
        if loads["n"] == 1:
            raise zipfile.BadZipFile("File is not a zip file")

    _fake_pose_refine(monkeypatch, load)
    res = sm.ensure_rtmpose(str(tmp_path), "balanced")
    assert res["component"] == "rtmpose"
    assert loads["n"] == 2 and len(downloads) == 2


def test_rtmpose_persistent_badzip_becomes_download_error(tmp_path, monkeypatch):
    monkeypatch.setattr(sm, "_rtmpose_paths", lambda mode: (
        "http://x/m.zip", str(tmp_path / "m.zip"), str(tmp_path / "m.onnx"), str(tmp_path / "tmp")))
    monkeypatch.setattr(sm, "_download", lambda u, dest, stage: _write_zip(dest))

    def load(mode, dev):
        raise zipfile.BadZipFile("bad")

    _fake_pose_refine(monkeypatch, load)
    with pytest.raises(DownloadError):
        sm.ensure_rtmpose(str(tmp_path), "balanced")


def test_rtmpose_corrupt_cached_zip_is_redownloaded(tmp_path, monkeypatch):
    zip_path = tmp_path / "m.zip"
    zip_path.write_bytes(b"truncated")
    got = []

    def fake_download(u, dest, stage):
        got.append(dest)
        _write_zip(dest)

    monkeypatch.setattr(sm, "_download", fake_download)
    sm._predownload_rtmpose("http://x/m.zip", str(zip_path), str(tmp_path / "m.onnx"),
                            str(tmp_path / "tmp"))
    assert got == [str(zip_path)] and zipfile.is_zipfile(zip_path)


# ── CLI error mapping ────────────────────────────────────────────────────────

def test_setup_download_error_maps_to_download_failed(ndjson_out, tmp_path, monkeypatch):
    def boom(*a, **k):
        raise DownloadError("Download failed after 3 attempts")

    monkeypatch.setattr(sm, "setup", boom)
    monkeypatch.setattr(cli, "_patch_checkpoint_dir", lambda d: None)
    rc = cli.main(["--ndjson", "setup", "--data-dir", str(tmp_path)])
    err = [e for e in _events(ndjson_out) if e["event"] == "error"]
    assert rc == 1 and err[-1]["code"] == "download_failed"


def test_setup_other_exception_maps_to_setup_failed(ndjson_out, tmp_path, monkeypatch):
    def boom(*a, **k):
        raise zipfile.BadZipFile("File is not a zip file")

    monkeypatch.setattr(sm, "setup", boom)
    monkeypatch.setattr(cli, "_patch_checkpoint_dir", lambda d: None)
    rc = cli.main(["--ndjson", "setup", "--data-dir", str(tmp_path)])
    err = [e for e in _events(ndjson_out) if e["event"] == "error"][-1]
    assert rc == 1 and err["code"] == "setup_failed"
    assert "BadZipFile" in err["detail"] and "BadZipFile" not in err["msg"]


def test_runtimeerror_mentioning_download_is_not_download_failed(ndjson_out, tmp_path, monkeypatch):
    def analyze(*a, **k):
        raise RuntimeError("could not download frame")

    fake_run = types.SimpleNamespace(_WeightsMissing=type("W", (Exception,), {}), analyze=analyze)
    monkeypatch.setitem(sys.modules, "refframe_engine.run", fake_run)
    monkeypatch.setattr(cli, "_patch_checkpoint_dir", lambda d: None)
    rc = cli.main(["--ndjson", "analyze", "x.mp4", "--out-dir", str(tmp_path / "o"),
                   "--data-dir", str(tmp_path)])
    err = [e for e in _events(ndjson_out) if e["event"] == "error"][-1]
    assert rc == 1 and err["code"] == "extraction_failed"


def test_unwritable_data_dir_emits_typed_error(ndjson_out, tmp_path):
    blocker = tmp_path / "afile"
    blocker.write_text("x")                    # a file where a directory is needed
    rc = cli.main(["--ndjson", "doctor", "--data-dir", str(blocker / "sub")])
    err = [e for e in _events(ndjson_out) if e["event"] == "error"]
    assert rc == 1 and err[-1]["code"] == "data_dir_unwritable"


def test_configure_env_assigns_caches_and_disables_sync(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path / "elsewhere"))
    monkeypatch.setenv("TORCH_HOME", str(tmp_path / "torch"))
    cli._configure_env(str(tmp_path / "d"))
    assert os.environ["XDG_CACHE_HOME"] == str(tmp_path / "d" / "models")
    assert "TORCH_HOME" not in os.environ
    settings = json.loads((tmp_path / "d" / "models" / "ultralytics-config" /
                           "Ultralytics" / "settings.json").read_text())
    assert settings["sync"] is False
