// Output preview: markdown → sanitized HTML, the popup content, and the read-only new tab.
import { marked } from '../vendor/marked.esm.js';
import DOMPurify from '../vendor/purify.es.mjs';

marked.setOptions({ gfm: true, breaks: false });

// Links in rendered markdown open outside the app tab.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('href')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

const PREVIEW_LIMIT = 60_000;
export const EMPTY_HTML = '<p><em>The engine returned no text. A scanned PDF, for example, has no text layer to extract.</em></p>';

export function renderMarkdown(markdown) {
  const html = marked.parse(markdown || '');
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input', 'button'] });
}

/** Render into a popup body; long documents are cut for the popup only. */
export function renderInto(body, markdown) {
  const text = markdown || '';
  const cut = text.length > PREVIEW_LIMIT;
  const wrapper = document.createElement('div');
  wrapper.className = 'md';
  wrapper.innerHTML = text.trim()
    ? renderMarkdown(cut ? text.slice(0, PREVIEW_LIMIT) : text)
    : EMPTY_HTML;
  body.replaceChildren(wrapper);
  if (cut) {
    const note = document.createElement('p');
    note.className = 'pv-note';
    note.textContent = 'Preview shows the first part only. Open it in a new tab to read everything.';
    body.append(note);
  }
}

// ---------- new tab ----------
// A self-contained, script-free HTML document built here and opened as a blob URL:
// no backend endpoint, and it doesn't depend on the opener staying reachable.
let cssPromise = null;
function loadCss() {
  if (!cssPromise) {
    const base = new URL('../css/', import.meta.url);
    cssPromise = Promise.all(['style.css', 'view.css'].map((name) => fetch(new URL(name, base)).then((r) => r.text())))
      .then((parts) => parts.join('\n').replace(/url\("\.\.\/([^"]+)"\)/g, (_, path) => `url("${new URL(`../${path}`, import.meta.url).href}")`))
      .catch((error) => {
        cssPromise = null;
        throw error;
      });
  }
  return cssPromise;
}

const MARK = '<svg class="brand__mark" viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="4.5" width="19" height="15" rx="3"/><path d="M6.5 15V9l2.5 3 2.5-3v6M15.5 9v6m-2-2 2 2 2-2"/></svg>';

function escapeText(value) {
  return String(value).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
}

async function buildDocument(fileName, markdown) {
  const css = await loadCss();
  const chars = markdown.length.toLocaleString('en-US');
  const content = markdown.trim() ? renderMarkdown(markdown) : EMPTY_HTML;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src ${window.location.origin}; img-src * data: blob:">
<title>${escapeText(fileName)} · MarkItDown Web UI</title>
<style>${css}</style></head>
<body class="viewer">
<header class="viewer__bar"><div class="viewer__inner">${MARK}
<h1 class="viewer__name">${escapeText(fileName)}</h1>
<span class="viewer__meta">${chars} characters</span>
<span class="viewer__badge">Read-only</span></div></header>
<main class="viewer__page"><article class="md viewer__doc">${content}</article></main>
</body></html>`;
}

// One blob URL per result, kept until the result is removed or cleared, so an open tab
// still loads when it's reloaded (or when a phone browser restores it).
const tabUrls = new Map(); // key → Promise<blob URL>

function documentUrl(key, fileName, markdown) {
  if (!tabUrls.has(key)) {
    const pending = buildDocument(fileName, markdown)
      .then((html) => URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' })));
    pending.catch(() => tabUrls.delete(key));
    tabUrls.set(key, pending);
  }
  return tabUrls.get(key);
}

/**
 * Open the rendered markdown in a new tab. The tab is opened synchronously (so popup
 * blockers allow it), then pointed at the finished document.
 */
export async function openInNewTab(key, fileName, markdown) {
  const tab = window.open('', '_blank');
  if (!tab) return false;
  try {
    tab.location.replace(await documentUrl(key, fileName, markdown));
  } catch {
    tab.close();
    return false;
  }
  return true;
}

/** Free the new-tab document of a result that is gone. */
export function releaseTab(key) {
  const pending = tabUrls.get(key);
  if (!pending) return;
  tabUrls.delete(key);
  pending.then((url) => URL.revokeObjectURL(url), () => {});
}
