"""FastAPI app: three API routes plus the static frontend."""

import asyncio
import mimetypes
import os
from pathlib import Path, PurePath
from urllib.parse import urlparse

from fastapi import FastAPI, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

import converter

MAX_FILE_MB = float(os.getenv("MAX_FILE_MB", "50"))
CONVERT_TIMEOUT_S = float(os.getenv("CONVERT_TIMEOUT_S", "120"))
FRONTEND_DIR = Path(os.getenv("FRONTEND_DIR", Path(__file__).resolve().parent.parent / "frontend"))

MAX_BYTES = int(MAX_FILE_MB * 1024 * 1024)
CHUNK = 1024 * 1024
UPLOAD_PATH = "/api/convert/file"
# Room for the multipart boundary and part headers on top of the file itself.
MULTIPART_SLACK = 64 * 1024

# Images aren't converted: the app is for documents, and without OCR or an LLM the
# engine returns no text for them. Same list as the frontend's queue.js.
IMAGE_EXTENSIONS = {
    "png", "jpg", "jpeg", "jfif", "gif", "webp", "bmp", "avif", "svg", "tif", "tiff", "heic", "heif", "ico",
}
IMAGE_MESSAGE = "Images aren't converted; this app is for documents"
SIZE_MESSAGE = f"File exceeds MAX_FILE_MB ({MAX_FILE_MB:g} MB)"

mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("font/woff2", ".woff2")


class UploadSizeLimit:
    """Answer 413 from the Content-Length header, before the body is read.

    Without this, the multipart parser spools the whole upload into /tmp (a RAM-backed
    tmpfs in the container) before the route ever gets to count bytes.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"] == UPLOAD_PATH:
            length = dict(scope["headers"]).get(b"content-length", b"")
            if length.isdigit() and int(length) > MAX_BYTES + MULTIPART_SLACK:
                response = JSONResponse({"szError": SIZE_MESSAGE}, status_code=413, headers={"Connection": "close"})
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)


app = FastAPI(title="MarkItDown Web UI", docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(UploadSizeLimit)


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        self.message = message


@app.exception_handler(ApiError)
async def _api_error(_: Request, exc: ApiError):
    return JSONResponse({"szError": exc.message}, status_code=exc.status)


@app.exception_handler(StarletteHTTPException)
async def _http_error(_: Request, exc: StarletteHTTPException):
    # Framework errors (405, a body that won't parse, ...) keep the { szError } shape.
    return JSONResponse({"szError": str(exc.detail)}, status_code=exc.status_code, headers=exc.headers)


@app.exception_handler(RequestValidationError)
async def _validation_error(_: Request, exc: RequestValidationError):
    errors = exc.errors()
    if not errors:
        return JSONResponse({"szError": "Invalid request"}, status_code=400)
    first = errors[0]
    where = ".".join(str(part) for part in first.get("loc", ()) if part != "body")
    message = first.get("msg", "invalid value")
    return JSONResponse({"szError": f"Invalid request: {where + ': ' if where else ''}{message}"}, status_code=400)


async def _run_engine(fn, *args) -> str:
    try:
        return await asyncio.wait_for(asyncio.to_thread(fn, *args), timeout=CONVERT_TIMEOUT_S)
    except asyncio.TimeoutError:
        raise ApiError(504, f"Conversion took longer than {CONVERT_TIMEOUT_S:g} s (CONVERT_TIMEOUT_S)")
    except converter.UnsupportedFormatException as exc:
        raise ApiError(415, str(exc) or "Format not supported by MarkItDown")
    except Exception as exc:  # engine failure, message passed through
        message = str(exc).strip() or exc.__class__.__name__
        raise ApiError(500, message)


def _is_image(file_name: str, content_type: str | None) -> bool:
    extension = PurePath(file_name).suffix.lower().lstrip(".")
    return (content_type or "").lower().startswith("image/") or extension in IMAGE_EXTENSIONS


@app.post(UPLOAD_PATH)
async def convert_file(file: UploadFile):
    file_name = file.filename or "document"
    if _is_image(file_name, file.content_type):
        await file.close()
        raise ApiError(415, IMAGE_MESSAGE)

    data = bytearray()
    while chunk := await file.read(CHUNK):
        data.extend(chunk)
        if len(data) > MAX_BYTES:
            await file.close()
            raise ApiError(413, SIZE_MESSAGE)
    await file.close()
    if not data:
        raise ApiError(400, "The file is empty")

    # A generic type says nothing; let the engine guess from the name and the bytes.
    mimetype = file.content_type if file.content_type not in (None, "", "application/octet-stream") else None
    markdown = await _run_engine(converter.convert_bytes, bytes(data), file_name, mimetype)
    return {"szFileName": converter.output_name_for_file(file_name), "szMarkdown": markdown}


class UrlRequest(BaseModel):
    szUrl: str


@app.post("/api/convert/url")
async def convert_url(body: UrlRequest):
    url = body.szUrl.strip()
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ApiError(400, "Invalid URL: use a full http:// or https:// address")

    markdown = await _run_engine(converter.convert_url, url)
    return {"szFileName": converter.output_name_for_url(url), "szMarkdown": markdown}


@app.get("/api/health")
async def health():
    return {
        "szStatus": "ok",
        "szMarkItDownVersion": converter.engine_version(),
        "nMaxFileBytes": MAX_BYTES,
    }


@app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def api_not_found(rest: str):
    raise ApiError(404, f"Unknown endpoint: /api/{rest}")


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
