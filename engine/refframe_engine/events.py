"""NDJSON event stream for the Reference Frame app.

When enabled (--ndjson on the CLI), every event is one JSON object per line
on stdout, so the Electron shell can stream progress without scraping text:

    {"event": "progress", "stage": "extract", "current": 300, "total": 5400, "detail": "..."}
    {"event": "log", "level": "info", "msg": "..."}
    {"event": "result", "kind": "analysis", ...}
    {"event": "error", "code": "file_not_found", "msg": "..."}

When disabled (default), progress/result are silent no-ops and log() falls
back to plain print, preserving the original human-facing CLI behavior that
the golden-diff invariant depends on.

Ported near-verbatim from nojohns_engine.events; `result` grows a `kind` and
`_stdout` captures the real stdout so stdio.capture() can forward vendored
print() output as log events without recursing through a redirect.
"""
import json
import sys

enabled = False

# The real process stdout, captured at import time. stdio.capture() redirects
# sys.stdout to a shim; events must still write to the true fd so their JSON
# lines aren't themselves swallowed and re-wrapped as log events.
_stdout = sys.stdout


def _write(obj):
    _stdout.write(json.dumps(obj) + "\n")
    _stdout.flush()


def progress(stage, current, total, detail=None):
    if not enabled:
        return
    obj = {"event": "progress", "stage": stage, "current": current, "total": total}
    if detail is not None:
        obj["detail"] = detail
    _write(obj)


def log(msg, level="info"):
    if enabled:
        _write({"event": "log", "level": level, "msg": msg})
    else:
        print(msg)


def result(kind=None, **fields):
    if not enabled:
        return
    obj = {"event": "result"}
    if kind is not None:
        obj["kind"] = kind
    obj.update(fields)
    _write(obj)


def error(msg, code=None, **fields):
    if enabled:
        obj = {"event": "error", "msg": msg}
        if code:
            obj["code"] = code
        obj.update(fields)
        _write(obj)
    else:
        print(msg, file=sys.stderr)
