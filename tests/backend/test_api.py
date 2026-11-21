import asyncio
import time

import pytest
from fastapi.testclient import TestClient

import converter
import main

client = TestClient(main.app)
LIMIT = 1024 * 1024  # MAX_FILE_MB=1 from conftest.py


def upload(name, data, content_type="application/octet-stream"):
    return client.post("/api/convert/file", files={"file": (name, data, content_type)})


def test_health_reports_engine_version_and_size_limit():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {
        "szStatus": "ok",
        "szMarkItDownVersion": converter.engine_version(),
        "nMaxFileBytes": LIMIT,
    }


def test_converts_a_text_file_with_the_real_engine():
    response = upload("notes.txt", b"Hello from a test", "text/plain")
    assert response.status_code == 200
    body = response.json()
    assert body["szFileName"] == "notes.md"
    assert "Hello from a test" in body["szMarkdown"]


def test_empty_file_is_400():
    response = upload("empty.pdf", b"")
    assert response.status_code == 400
    assert response.json() == {"szError": "The file is empty"}


@pytest.mark.parametrize(
    ("name", "content_type"),
    [("photo.JPG", "application/octet-stream"), ("scan", "image/png"), ("logo.svg", "image/svg+xml")],
)
def test_images_are_415(name, content_type):
    response = upload(name, b"not really an image", content_type)
    assert response.status_code == 415
    assert response.json() == {"szError": main.IMAGE_MESSAGE}


def test_upload_over_the_limit_is_413():
    response = upload("big.pdf", b"x" * (LIMIT + 200 * 1024))
    assert response.status_code == 413
    assert response.json() == {"szError": "File exceeds MAX_FILE_MB (1 MB)"}


def test_upload_just_over_the_limit_is_caught_by_the_route():
    # Inside the multipart slack, so Content-Length alone doesn't reject it.
    response = upload("big.pdf", b"x" * (LIMIT + 1))
    assert response.status_code == 413


def test_size_limit_answers_before_reading_the_body():
    reached_app = False

    async def app(scope, receive, send):
        nonlocal reached_app
        reached_app = True

    async def receive():
        raise AssertionError("the body was read")

    sent = []

    async def send(message):
        sent.append(message)

    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/convert/file",
        "headers": [(b"content-length", str(500 * LIMIT).encode())],
    }
    asyncio.run(main.UploadSizeLimit(app)(scope, receive, send))
    assert not reached_app
    assert sent[0]["status"] == 413


def test_unsupported_format_is_415(monkeypatch):
    def unsupported(*_):
        raise converter.UnsupportedFormatException("No converter attempted a conversion")

    monkeypatch.setattr(converter, "convert_bytes", unsupported)
    response = upload("thing.bin", b"\x00\x01")
    assert response.status_code == 415
    assert response.json() == {"szError": "No converter attempted a conversion"}


def test_engine_errors_are_500_with_the_message_passed_through(monkeypatch):
    def broken(*_):
        raise RuntimeError("PDF is encrypted")

    monkeypatch.setattr(converter, "convert_bytes", broken)
    response = upload("locked.pdf", b"%PDF-1.7")
    assert response.status_code == 500
    assert response.json() == {"szError": "PDF is encrypted"}


def test_slow_conversions_are_504(monkeypatch):
    monkeypatch.setattr(main, "CONVERT_TIMEOUT_S", 0.1)
    monkeypatch.setattr(converter, "convert_bytes", lambda *_: time.sleep(0.5) or "late")
    response = upload("slow.pdf", b"%PDF-1.7")
    assert response.status_code == 504
    assert "CONVERT_TIMEOUT_S" in response.json()["szError"]


def test_upload_type_is_passed_to_the_engine_unless_generic(monkeypatch):
    seen = []
    monkeypatch.setattr(converter, "convert_bytes", lambda data, name, mimetype: seen.append(mimetype) or "ok")
    upload("a.pdf", b"%PDF", "application/pdf")
    upload("b", b"data", "application/octet-stream")
    assert seen == ["application/pdf", None]


def test_url_conversion_names_the_result(monkeypatch):
    monkeypatch.setattr(converter, "convert_url", lambda url: f"# {url}")
    response = client.post("/api/convert/url", json={"szUrl": "https://www.example.com/blog/post.html"})
    assert response.status_code == 200
    assert response.json() == {
        "szFileName": "example.com-blog-post.md",
        "szMarkdown": "# https://www.example.com/blog/post.html",
    }


@pytest.mark.parametrize("url", ["ftp://example.com/file", "example.com", "not a url", ""])
def test_invalid_urls_are_400(url):
    response = client.post("/api/convert/url", json={"szUrl": url})
    assert response.status_code == 400
    assert response.json()["szError"].startswith("Invalid URL")


def test_missing_fields_give_a_readable_400():
    response = client.post("/api/convert/file")
    assert response.status_code == 400
    assert response.json() == {"szError": "Invalid request: file: Field required"}


def test_unknown_api_paths_are_404_json():
    response = client.get("/api/nope")
    assert response.status_code == 404
    assert response.json() == {"szError": "Unknown endpoint: /api/nope"}


def test_frontend_is_served():
    response = client.get("/")
    assert response.status_code == 200
    assert "MarkItDown Web UI" in response.text
