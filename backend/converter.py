"""Thin wrapper around MarkItDown. Calls the engine and nothing else."""

import io
import re
from importlib.metadata import PackageNotFoundError, version
from pathlib import PurePath
from urllib.parse import urlparse

from markitdown import MarkItDown, StreamInfo

try:
    from markitdown import UnsupportedFormatException
except ImportError:  # older layouts keep it in a private module
    from markitdown._exceptions import UnsupportedFormatException  # type: ignore

_md = MarkItDown(enable_plugins=False)


def engine_version() -> str:
    try:
        return version("markitdown")
    except PackageNotFoundError:
        return "unknown"


def _sanitize(name: str) -> str:
    name = re.sub(r"[\\/:*?\"<>|\x00-\x1f]+", "-", name)
    name = re.sub(r"\s+", " ", name).strip(" .-")
    return name[:180] or "document"


def output_name_for_file(file_name: str) -> str:
    stem = PurePath(file_name).stem if file_name else ""
    return _sanitize(stem) + ".md"


def output_name_for_url(url: str) -> str:
    parsed = urlparse(url)
    host = parsed.hostname or "url"
    if host.startswith("www."):
        host = host[4:]
    parts = [p for p in parsed.path.split("/") if p]
    if parsed.query and "youtube" in host:
        # keep the video id so two videos don't collide
        match = re.search(r"(?:^|&)v=([\w-]+)", parsed.query)
        if match:
            parts.append(match.group(1))
    slug = "-".join([host, *parts])
    slug = re.sub(r"\.(html?|php|aspx?)$", "", slug, flags=re.IGNORECASE)
    slug = re.sub(r"[^\w.-]+", "-", slug)
    return _sanitize(slug) + ".md"


def convert_bytes(data: bytes, file_name: str, mimetype: str | None = None) -> str:
    suffix = PurePath(file_name).suffix.lower() if file_name else ""
    info = StreamInfo(filename=file_name or None, extension=suffix or None, mimetype=mimetype or None)
    result = _md.convert_stream(io.BytesIO(data), stream_info=info)
    return result.markdown


def convert_url(url: str) -> str:
    result = _md.convert(url)
    return result.markdown


__all__ = [
    "UnsupportedFormatException",
    "convert_bytes",
    "convert_url",
    "engine_version",
    "output_name_for_file",
    "output_name_for_url",
]
