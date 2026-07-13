"""Stdout capture for NDJSON mode.

The vendored pipeline modules (pose_extraction, pose_refine, pose_lift,
dance_metrics, dance_review) `print()` freely. In NDJSON mode that raw text
would corrupt the one-JSON-object-per-line contract the Electron shell relies
on. `capture()` redirects sys.stdout to a line-buffered shim that forwards each
COMPLETED line to events.log() on the REAL stdout (events._stdout), so vendored
prints become well-formed {"event":"log",...} lines.

Without --ndjson this is never entered, so prints pass through untouched and the
golden-diff invariant (byte-identical _report.txt vs the source pipeline) holds.
"""
import contextlib
import sys

from . import events


class _LineShim:
    """File-like object: buffers writes and flushes complete lines to events.log."""

    def __init__(self, level="info"):
        self._buf = ""
        self._level = level

    def write(self, s):
        if not s:
            return
        self._buf += s
        while "\n" in self._buf:
            line, self._buf = self._buf.split("\n", 1)
            events.log(line, level=self._level)

    def flush(self):
        # Forward any trailing partial line (no newline) as its own log entry.
        if self._buf:
            line, self._buf = self._buf, ""
            events.log(line, level=self._level)

    def isatty(self):
        return False


@contextlib.contextmanager
def capture(level="info"):
    """Redirect stdout to a line→events.log shim for the duration of the block.

    No-op passthrough when NDJSON mode is disabled (events.enabled is False):
    the vendored prints then reach the real stdout exactly as the source does.
    """
    if not events.enabled:
        yield
        return
    shim = _LineShim(level=level)
    with contextlib.redirect_stdout(shim):
        try:
            yield
        finally:
            shim.flush()
