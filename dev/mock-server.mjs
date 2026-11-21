// Dev-only stand-in for the FastAPI backend, so the frontend can run without Python/Docker.
// Same API contract, fake markdown, random delays. Not shipped in the image.
// Usage: node dev/mock-server.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'frontend');
const port = Number(process.argv[2] || 8765);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const IMAGE = /\.(png|jpe?g|jfif|gif|webp|bmp|avif|svg|tiff?|heic|heif|ico)$/i;

function sampleMarkdown(title) {
  return `# ${title}\n\nConverted by the **mock** backend. The real engine returns the document's content here.\n\n## Summary\n\n- Revenue grew 12% quarter on quarter\n- Hosting costs held flat at Rp 450.000/month\n- Two open items for December\n\n| Item | Qty | Amount |\n| --- | ---: | ---: |\n| Server maintenance | 12 | Rp 3.600.000 |\n| Backup storage 2 TB | 1 | Rp 350.000 |\n\n> Notes are kept in memory only and discarded after download.\n\n\`\`\`\nmarkitdown laporan.pdf > laporan.md\n\`\`\`\n`;
}

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/health') return json(res, 200, { szStatus: 'ok', szMarkItDownVersion: '0.1.9', nMaxFileBytes: MAX_FILE_BYTES });
  if (url.pathname === '/api/convert/file' && req.method === 'POST') {
    if (Number(req.headers['content-length']) > MAX_FILE_BYTES + 64 * 1024) return json(res, 413, { szError: 'File exceeds MAX_FILE_MB (50 MB)' });
    const raw = await body(req);
    const name = /filename="([^"]+)"/.exec(raw.subarray(0, 2000).toString('latin1'))?.[1] || 'file';
    await wait(800 + Math.random() * 2500);
    if (IMAGE.test(name)) return json(res, 415, { szError: "Images aren't converted; this app is for documents" });
    if (/scan/i.test(name)) return json(res, 200, { szFileName: `${name.replace(/\.[^.]+$/, '')}.md`, szMarkdown: '' });
    if (/zip$/i.test(name)) return json(res, 413, { szError: 'File exceeds MAX_FILE_MB (50 MB)' });
    if (/\.(exe|bin)$/i.test(name)) return json(res, 415, { szError: `Could not convert stream to Markdown. No converter attempted a conversion, suggesting that the filetype is simply not supported.` });
    const stem = name.replace(/\.[^.]+$/, '');
    return json(res, 200, { szFileName: `${stem}.md`, szMarkdown: sampleMarkdown(stem) });
  }
  if (url.pathname === '/api/convert/url' && req.method === 'POST') {
    const { szUrl } = JSON.parse((await body(req)).toString() || '{}');
    await wait(1200 + Math.random() * 2000);
    const u = new URL(szUrl);
    if (u.hostname.includes('timeout')) return json(res, 504, { szError: 'Conversion took longer than 120 s (CONVERT_TIMEOUT_S)' });
    const slug = [u.hostname.replace(/^www\./, ''), ...u.pathname.split('/').filter(Boolean)].join('-');
    return json(res, 200, { szFileName: `${slug}.md`, szMarkdown: sampleMarkdown(u.hostname + u.pathname) });
  }
  if (url.pathname.startsWith('/api/')) return json(res, 404, { szError: 'Unknown endpoint' });
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path.endsWith('/')) path += 'index.html';
  try {
    const data = await readFile(join(root, path));
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}).listen(port, () => console.log(`mock MarkItDown Web UI on http://localhost:${port}`));
