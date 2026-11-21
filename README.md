# MarkItDown Web UI

A small self-hosted web page that converts documents and web pages to Markdown. Drop in PDF, Word, PowerPoint, Excel, Outlook, EPUB, HTML or text files, or paste URLs, then preview, copy or download the result. Images aren't supported.

The conversion engine is [MarkItDown](https://github.com/microsoft/markitdown) by Microsoft, used unmodified under its MIT license. This project only adds the web interface around it and isn't affiliated with Microsoft.

## Run

```bash
docker compose up -d --build
```

Then open `http://<server>:8080`.

## Update

```bash
git pull && docker compose up -d --build
```

## Settings

In `docker-compose.yml`:

- `MAX_FILE_MB` (default 50): the largest file you can upload
- `CONVERT_TIMEOUT_S` (default 120): how long one conversion may take
