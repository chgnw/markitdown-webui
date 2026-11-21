// Input preview for queued files, before converting.
import { icon } from './icons.js';
import { escapeHtml, formatBytes, loadScript } from './util.js';

const TEXT = new Set(['txt', 'csv', 'tsv', 'json', 'xml', 'html', 'htm', 'md', 'markdown', 'log']);
const SHEET = new Set(['xlsx', 'xls']);
const TEXT_LIMIT = 200_000;
const PDF_PAGES = 3;
const SHEET_ROWS = 200;

/** Icon + short label per input type (shared with the row "type" tile). */
export function typeInfo(item) {
  const ext = item.ext;
  if (item.kind === 'url') {
    return /youtube\.com|youtu\.be/i.test(item.url) ? { icon: 'video', label: 'YouTube' } : { icon: 'globe', label: 'URL' };
  }
  if (ext === 'pdf') return { icon: 'pdf', label: 'PDF' };
  if (ext === 'docx' || ext === 'doc') return { icon: 'doc', label: 'Word' };
  if (ext === 'pptx' || ext === 'ppt') return { icon: 'slides', label: 'PowerPoint' };
  if (SHEET.has(ext)) return { icon: 'table', label: 'Excel' };
  if (ext === 'csv' || ext === 'tsv') return { icon: 'table', label: ext.toUpperCase() };
  if (ext === 'msg') return { icon: 'mail', label: 'Outlook' };
  if (ext === 'epub') return { icon: 'book', label: 'EPUB' };
  if (ext === 'zip') return { icon: 'zip', label: 'ZIP' };
  if (ext === 'html' || ext === 'htm' || ext === 'json' || ext === 'xml') return { icon: 'code', label: ext.toUpperCase() };
  if (TEXT.has(ext)) return { icon: 'file', label: ext === 'md' || ext === 'markdown' ? 'Markdown' : 'Text' };
  return { icon: 'file', label: ext ? ext.toUpperCase() : 'File' };
}

function noPreview(body, item, reason) {
  body.innerHTML = `
    <div class="pv-none">
      ${icon(typeInfo(item).icon)}
      <b>${escapeHtml(item.name)}</b>
      <span>${escapeHtml(formatBytes(item.size))}</span>
      <span>${escapeHtml(reason)}</span>
    </div>`;
}

async function previewText(body, item) {
  const blob = item.file.size > TEXT_LIMIT ? item.file.slice(0, TEXT_LIMIT) : item.file;
  const text = await blob.text();
  const pre = document.createElement('pre');
  pre.className = 'pv-text';
  pre.textContent = text;
  body.replaceChildren(pre);
  if (item.file.size > TEXT_LIMIT) {
    const note = document.createElement('p');
    note.className = 'pv-note';
    note.textContent = `Showing the first ${formatBytes(TEXT_LIMIT)} of ${formatBytes(item.file.size)}.`;
    body.append(note);
  }
}

let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('../vendor/pdf.min.mjs').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

async function previewPdf(body, item, isCurrent) {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await item.file.arrayBuffer());
  const task = pdfjs.getDocument({ data, isEvalSupported: false });
  try {
    await renderPdfPages(body, await task.promise, isCurrent);
  } finally {
    task.destroy();
  }
}

async function renderPdfPages(body, pdf, isCurrent) {
  if (!isCurrent()) return;
  const wrap = document.createElement('div');
  wrap.className = 'pv-pdf';
  const width = Math.max(280, body.clientWidth - 4);
  const pages = Math.min(pdf.numPages, PDF_PAGES);
  for (let n = 1; n <= pages; n += 1) {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const ratio = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: (width / base.width) * ratio });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.setAttribute('aria-label', `Page ${n}`);
    await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
    if (!isCurrent()) return;
    wrap.append(canvas);
    if (n === 1) body.replaceChildren(wrap);
  }
  if (pdf.numPages > pages) {
    const note = document.createElement('p');
    note.className = 'pv-note';
    note.textContent = `Showing ${pages} of ${pdf.numPages} pages.`;
    body.append(note);
  }
}

async function previewDocx(body, item, isCurrent) {
  await loadScript('vendor/jszip.min.js');
  await loadScript('vendor/docx-preview.min.js');
  if (!isCurrent()) return;
  const host = document.createElement('div');
  host.className = 'pv-docx';
  await window.docx.renderAsync(await item.file.arrayBuffer(), host, null, {
    inWrapper: true,
    ignoreWidth: true,
    ignoreHeight: true,
    ignoreLastRenderedPageBreak: true,
    breakPages: false,
    renderHeaders: false,
    renderFooters: false,
    experimental: false,
  });
  if (isCurrent()) body.replaceChildren(host);
}

let xlsxPromise = null;
async function previewSheet(body, item, isCurrent) {
  if (!xlsxPromise) xlsxPromise = import('../vendor/xlsx.mjs');
  const [XLSX, { default: DOMPurify }] = await Promise.all([xlsxPromise, import('../vendor/purify.es.mjs')]);
  const workbook = XLSX.read(await item.file.arrayBuffer(), { type: 'array', sheetRows: SHEET_ROWS + 1 });
  if (!isCurrent()) return;
  const sheetName = workbook.SheetNames[0];
  const html = XLSX.utils.sheet_to_html(workbook.Sheets[sheetName], { header: '', footer: '' });
  const wrap = document.createElement('div');
  wrap.className = 'pv-sheet';
  wrap.innerHTML = DOMPurify.sanitize(html);
  const note = document.createElement('p');
  note.className = 'pv-note';
  const more = workbook.SheetNames.length > 1 ? ` · ${workbook.SheetNames.length - 1} more sheet${workbook.SheetNames.length > 2 ? 's' : ''} not shown` : '';
  note.textContent = `Sheet “${sheetName}”, first ${SHEET_ROWS} rows at most${more}.`;
  body.replaceChildren(wrap, note);
}

function previewUrl(body, item) {
  body.innerHTML = `
    <div class="pv-none">
      ${icon(typeInfo(item).icon)}
      <b>${escapeHtml(item.url)}</b>
      <span>The page is fetched when you convert it.</span>
    </div>`;
}

/** Render a preview of a queued item into body. */
export async function renderInputPreview(body, item, isCurrent = () => true) {
  if (item.kind === 'url') return previewUrl(body, item);
  const ext = item.ext;
  if (!item.size) return noPreview(body, item, 'This file is empty.');
  if (TEXT.has(ext)) return previewText(body, item);
  if (ext === 'pdf') return previewPdf(body, item, isCurrent);
  if (ext === 'docx') return previewDocx(body, item, isCurrent);
  if (SHEET.has(ext)) return previewSheet(body, item, isCurrent);
  return noPreview(body, item, 'No preview for this format. It will still be converted.');
}
