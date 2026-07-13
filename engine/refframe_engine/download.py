"""In-process YouTube download.

The source analyze.py shells out to `[sys.executable, "-m", "yt_dlp"]`, which is
impossible in a frozen (PyInstaller) build — there is no python interpreter to
`-m` into. This uses the `yt_dlp.YoutubeDL` Python API directly, with the same
format selection and ffmpeg location the source used, and streams download
progress as NDJSON `progress` events on the "download" stage.
"""
import pathlib
import re

from . import events

# Same stream selection the source _download_youtube used.
_FORMAT = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"


def _stem_for(url: str) -> str:
    """Derive a stable filename stem from a YouTube URL (the 11-char video id)."""
    m = re.search(r"(?:v=|youtu\.be/)([A-Za-z0-9_-]{11})", url)
    return m.group(1) if m else "yt_video"


def _ffmpeg_exe() -> str:
    # yt-dlp only discovers binaries literally named ffmpeg.exe inside an
    # ffmpeg_location directory, and imageio_ffmpeg's binary is versioned
    # (ffmpeg-win-x86_64-*.exe) — so pass the exe path itself, never its parent.
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def download_youtube(url: str, out_dir: pathlib.Path):
    """Download a YouTube video+audio and merge into a single mp4 in out_dir.

    Returns (local mp4 path, video title or None). Reuses an existing download
    when present — the title isn't refetched on a cache hit (no extra network
    round trip just for metadata); callers should fall back to a previously
    stored title in that case. Raises RuntimeError on failure (cli maps this
    to a `download_failed` error).
    """
    import yt_dlp

    out_dir = pathlib.Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = _stem_for(url)
    mp4_path = out_dir / f"{stem}.mp4"

    if mp4_path.exists():
        events.log(f"Already downloaded: {mp4_path.name}")
        return mp4_path, None

    def _hook(d):
        status = d.get("status")
        if status == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            current = d.get("downloaded_bytes") or 0
            detail = d.get("_percent_str", "").strip() or None
            events.progress("download", int(current), int(total), detail=detail)
        elif status == "finished":
            events.progress("download", 1, 1, detail="merging")

    ydl_opts = {
        "format": _FORMAT,
        "outtmpl": str(out_dir / f"{stem}.%(ext)s"),
        "merge_output_format": "mp4",
        "ffmpeg_location": _ffmpeg_exe(),
        "progress_hooks": [_hook],
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
    }

    events.log(f"Downloading {url} …")
    title = None
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            # extract_info(download=True) both downloads and returns yt-dlp's
            # info dict, so the title comes off the same request instead of a
            # second network round trip (the source used the download-only
            # `ydl.download([url])` call, which returns no info).
            info = ydl.extract_info(url, download=True)
        if isinstance(info, dict):
            title = info.get("title")
    except Exception as e:                       # noqa: BLE001 — surface as typed error upstream
        raise RuntimeError(f"YouTube download failed: {e}") from e

    if not mp4_path.exists():
        # yt-dlp may have produced a differently-suffixed container; take the
        # newest file that matches the stem as a fallback.
        candidates = sorted(out_dir.glob(f"{stem}.*"),
                            key=lambda p: p.stat().st_mtime, reverse=True)
        candidates = [c for c in candidates if c.suffix.lower() in (".mp4", ".mkv", ".webm")]
        if candidates:
            return candidates[0], title
        raise RuntimeError("Download completed but no output file was found.")

    events.log(f"Saved → {mp4_path.name}")
    return mp4_path, title
