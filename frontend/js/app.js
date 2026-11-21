// Entry point: wires the page to queue state, previews and downloads.
import { getHealth } from './api.js';
import { hydrateIcons, icon } from './icons.js';
import { renderInputPreview, typeInfo } from './inputPreview.js';
import { openInNewTab, releaseTab, renderInto } from './outputPreview.js';
import { attachPeek, closePeek, closeSheet, openSheet } from './popover.js';
import * as queue from './queue.js';
import { copyText, escapeHtml, formatBytes, formatCount, formatSeconds, isTouch, parseUrls } from './util.js';
import { downloadMarkdown, downloadZip } from './zip.js';

const $ = (id) => document.getElementById(id);
const el = {
  engine: $('engine'),
  engineText: $('engine-text'),
  tally: $('tally'),
  drop: $('drop'),
  fileInput: $('file-input'),
  dropNotice: $('drop-notice'),
  urlForm: $('url-form'),
  urlInput: $('url-input'),
  urlError: $('url-error'),
  queueList: $('queue-list'),
  queueEmpty: $('queue-empty'),
  queueCount: $('queue-count'),
  queueActions: $('queue-actions'),
  convert: $('convert'),
  convertLabel: $('convert-label'),
  stop: $('stop'),
  clear: $('clear'),
  resultsList: $('results-list'),
  resultsEmpty: $('results-empty'),
  resultsCount: $('results-count'),
  zip: $('zip'),
  toast: $('toast'),
};

hydrateIcons();

// ---------- engine version + limits ----------
// Re-checked every minute while the tab is visible, sooner when offline or when a
// request couldn't reach the server, so the badge doesn't keep saying "ok" after a crash.
const HEALTH_OK_MS = 60_000;
const HEALTH_RETRY_MS = 15_000;
let healthTimer = 0;
let healthRequest = null;

function scheduleHealth(ms) {
  clearTimeout(healthTimer);
  healthTimer = setTimeout(() => { if (!document.hidden) checkHealth(); }, ms);
}

async function refreshHealth() {
  try {
    const data = await getHealth();
    el.engine.dataset.state = 'ok';
    el.engineText.textContent = `markitdown ${data.szMarkItDownVersion}`;
    el.engine.title = 'Engine version from /api/health';
    queue.setMaxFileBytes(data.nMaxFileBytes);
    scheduleHealth(HEALTH_OK_MS);
  } catch (error) {
    el.engine.dataset.state = 'error';
    el.engineText.textContent = 'Engine offline';
    el.engine.title = error.message;
    scheduleHealth(HEALTH_RETRY_MS);
  }
}

function checkHealth() {
  if (!healthRequest) healthRequest = refreshHealth().finally(() => { healthRequest = null; });
  return healthRequest;
}
checkHealth();
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkHealth(); });

// ---------- toast ----------
let toastTimer = 0;
function toast(message) {
  clearTimeout(toastTimer);
  el.toast.textContent = message;
  el.toast.hidden = false;
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3600);
}

// ---------- adding files ----------
let noticeTimer = 0;
function notice(message) {
  clearTimeout(noticeTimer);
  el.dropNotice.textContent = message;
  el.dropNotice.hidden = false;
  noticeTimer = setTimeout(() => { el.dropNotice.hidden = true; }, 8000);
}

function nameList(labels) {
  const shown = labels.slice(0, 3).join(', ');
  return labels.length > 3 ? `${shown} and ${labels.length - 3} more` : shown;
}

/** Queue files and explain, in one notice, anything that was skipped. */
function addFiles(files, folders = []) {
  const { rejected } = queue.addFiles(files);
  const images = rejected.filter((entry) => entry.reason === 'image').map((entry) => `“${entry.file.name}”`);
  const big = rejected.filter((entry) => entry.reason === 'size').map((entry) => `“${entry.file.name}” (${formatBytes(entry.file.size)})`);
  const parts = [];
  if (folders.length) {
    parts.push(`Skipped ${folders.length === 1 ? 'folder' : 'folders'} ${nameList(folders.map((name) => `“${name}”`))}. Folders aren't supported; open the folder and drop the files instead.`);
  }
  if (images.length) {
    parts.push(`Skipped ${images.length === 1 ? 'image' : 'images'} ${nameList(images)}. Images aren't converted; this app is for documents.`);
  }
  if (big.length) {
    const limit = formatBytes(queue.getMaxFileBytes());
    parts.push(`Skipped ${nameList(big)}. Files over ${limit} aren't accepted (MAX_FILE_MB).`);
  }
  if (parts.length) notice(parts.join(' '));
}

el.fileInput.addEventListener('change', () => {
  addFiles([...el.fileInput.files]);
  el.fileInput.value = '';
});

let dragDepth = 0;
function hasFiles(event) {
  return [...(event.dataTransfer?.types || [])].includes('Files');
}
function hasLink(event) {
  return [...(event.dataTransfer?.types || [])].includes('text/uri-list');
}
function inUrlField(event) {
  return event.target instanceof Element && Boolean(event.target.closest('#url-input'));
}

window.addEventListener('dragenter', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dragDepth += 1;
  el.drop.classList.add('is-over');
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) el.drop.classList.remove('is-over');
});
window.addEventListener('dragover', (event) => {
  // A link dragged onto the URL box is just text going into it; elsewhere it joins the queue.
  if (!hasFiles(event) && !(hasLink(event) && !inUrlField(event))) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('drop', (event) => {
  if (!hasFiles(event)) {
    if (!hasLink(event) || inUrlField(event)) return;
    // Links dragged in from another tab. Without this the browser would navigate away.
    event.preventDefault();
    const lines = event.dataTransfer.getData('text/uri-list').split(/\r?\n/).filter((line) => !line.startsWith('#'));
    queue.addUrls(parseUrls(lines.join('\n'), { requireScheme: true }).valid);
    return;
  }
  event.preventDefault();
  dragDepth = 0;
  el.drop.classList.remove('is-over');

  const files = [];
  const folders = [];
  const entries = [...(event.dataTransfer.items || [])];
  if (entries.length && typeof entries[0].webkitGetAsEntry === 'function') {
    for (const entry of entries) {
      if (entry.kind !== 'file') continue;
      const fsEntry = entry.webkitGetAsEntry();
      if (fsEntry && fsEntry.isDirectory) {
        folders.push(fsEntry.name);
        continue;
      }
      const file = entry.getAsFile();
      if (file) files.push(file);
    }
  } else {
    for (const file of event.dataTransfer.files) {
      // Folders show up as empty, typeless entries without the entries API.
      if (!file.type && file.size % 4096 === 0 && !/\.[^.]+$/.test(file.name)) folders.push(file.name);
      else files.push(file);
    }
  }
  addFiles(files, folders);
});

// Paste anywhere outside a text field: copied files, or lines that are full http(s) links.
document.addEventListener('paste', (event) => {
  if (event.target instanceof Element && event.target.closest('input, textarea, [contenteditable]')) return;
  const data = event.clipboardData;
  if (!data) return;
  const files = [...data.files];
  if (files.length) {
    event.preventDefault();
    addFiles(files);
    return;
  }
  const { valid } = parseUrls(data.getData('text/plain'), { requireScheme: true });
  if (valid.length) {
    event.preventDefault();
    queue.addUrls(valid);
  }
});

// ---------- adding URLs ----------
function setUrlError(message) {
  el.urlError.textContent = message || '';
  el.urlError.hidden = !message;
  el.urlInput.setAttribute('aria-invalid', message ? 'true' : 'false');
}

el.urlForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const { valid, invalid } = parseUrls(el.urlInput.value);
  if (!valid.length && !invalid.length) {
    setUrlError('Paste at least one URL, one per line.');
    el.urlInput.focus();
    return;
  }
  queue.addUrls(valid);
  el.urlInput.value = invalid.join('\n');
  if (invalid.length) {
    setUrlError(`${invalid.length === 1 ? "This line isn't" : `${invalid.length} lines aren't`} a valid web address. Use a full link like https://example.com/page.`);
    el.urlInput.focus();
  } else {
    setUrlError('');
  }
});
el.urlInput.addEventListener('input', () => { if (!el.urlError.hidden) setUrlError(''); });
el.urlInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) el.urlForm.requestSubmit();
});

// ---------- rows ----------
const rows = new Map(); // id → { queueRow, resultRow }

function pill(item) {
  switch (item.status) {
    case 'processing': return `<span class="pill pill--processing">${icon('loader')}Processing</span>`;
    case 'success': return `<span class="pill pill--success">${icon('check')}Success</span>`;
    case 'failed': return `<span class="pill pill--failed">${icon('alert')}Failed</span>`;
    default: return '<span class="pill pill--pending">Pending</span>';
  }
}

function queueMeta(item) {
  const parts = [typeInfo(item).label];
  if (item.kind === 'file') parts.push(formatBytes(item.size));
  if (item.status === 'processing' && item.startedAt) parts.push(formatSeconds(performance.now() - item.startedAt));
  if (item.status === 'failed' && item.elapsedMs) parts.push(`after ${formatSeconds(item.elapsedMs)}`);
  return parts.join(' · ');
}

function errorLabel(item) {
  const status = item.errorStatus ? `<b>${item.errorStatus}</b> · ` : '';
  return `${status}${escapeHtml(item.error)}`;
}

function inputSpec(item) {
  return {
    title: item.name,
    meta: queueMeta(item),
    hint: 'Original file, before converting',
    hintIcon: 'eye',
    render: (body, isCurrent) => renderInputPreview(body, item, isCurrent),
  };
}

function buildQueueRow(item) {
  const li = document.createElement('li');
  li.className = 'row';
  li.dataset.id = item.id;
  li.innerHTML = `
    <span class="row__type">${icon(typeInfo(item).icon)}</span>
    <div class="row__main">
      <button type="button" class="row__name" title="${escapeHtml(item.kind === 'url' ? item.url : item.name)}">${escapeHtml(item.name)}</button>
      <span class="row__meta"></span>
    </div>
    <div class="row__side">
      <span class="row__pill"></span>
      <button type="button" class="icon-btn row__remove">${icon('x')}</button>
    </div>`;
  li.querySelector('.row__remove').addEventListener('click', () => {
    closePeek();
    queue.remove(item.id);
  });
  li.querySelector('.row__name').addEventListener('click', () => {
    closePeek();
    openSheet({ ...inputSpec(item), actions: [] });
  });
  attachPeek(li, () => inputSpec(item));
  return li;
}

function updateQueueRow(li, item) {
  li.classList.toggle('is-failed', item.status === 'failed');
  li.querySelector('.row__meta').textContent = queueMeta(item);
  const pillHost = li.querySelector('.row__pill');
  if (pillHost.dataset.status !== item.status) {
    pillHost.innerHTML = pill(item);
    pillHost.dataset.status = item.status;
  }
  const removeButton = li.querySelector('.row__remove');
  const converting = item.status === 'processing';
  removeButton.title = converting ? 'Cancel and remove' : 'Remove';
  removeButton.setAttribute('aria-label', `${converting ? 'Cancel and remove' : 'Remove'} ${item.name} from the queue`);
  let err = li.querySelector('.row__error');
  if (item.status === 'failed') {
    if (!err) {
      err = document.createElement('p');
      err.className = 'row__error';
      li.append(err);
    }
    err.innerHTML = errorLabel(item);
  } else if (err) {
    err.remove();
  }
}

function isEmptyResult(item) {
  return !item.result.markdown.trim();
}

function resultMeta(item) {
  const size = isEmptyResult(item) ? 'no text found' : `${formatCount(item.result.markdown.length)} chars`;
  const parts = [`from ${typeInfo(item).label}`, size];
  if (item.elapsedMs) parts.push(formatSeconds(item.elapsedMs));
  return parts.join(' · ');
}

function flash(button, label) {
  button.classList.add('is-done');
  const original = button.innerHTML;
  const hasText = button.classList.contains('btn');
  button.innerHTML = hasText ? `${icon('check')}<span>${label}</span>` : icon('check');
  setTimeout(() => {
    button.classList.remove('is-done');
    button.innerHTML = original;
  }, 1400);
}

async function doCopy(item, button) {
  try {
    await copyText(item.result.markdown);
    flash(button, 'Copied');
  } catch {
    toast("Couldn't copy to the clipboard. Download the .md instead.");
  }
}

async function doOpen(item) {
  if (!(await openInNewTab(item.id, item.result.fileName, item.result.markdown))) {
    toast("Couldn't open a new tab. Allow pop-ups for this site and try again.");
  }
}

function outputSpec(item) {
  return {
    title: item.result.fileName,
    meta: resultMeta(item),
    hint: 'Click to open in a new tab',
    render: (body) => renderInto(body, item.result.markdown),
  };
}

function buildResultRow(item) {
  const li = document.createElement('li');
  li.className = 'row is-new';
  li.classList.toggle('is-empty', isEmptyResult(item));
  li.dataset.id = item.id;
  const name = escapeHtml(item.result.fileName);
  li.innerHTML = `
    <span class="row__type">${icon(typeInfo(item).icon)}</span>
    <div class="row__main">
      <button type="button" class="row__name">${name}</button>
      <span class="row__meta">${escapeHtml(resultMeta(item))}</span>
    </div>
    <div class="row__side">
      <button type="button" class="icon-btn" data-act="copy" aria-label="Copy markdown of ${name}" title="Copy markdown">${icon('copy')}</button>
      <button type="button" class="icon-btn" data-act="download" aria-label="Download ${name}" title="Download .md">${icon('download')}</button>
      <button type="button" class="icon-btn" data-act="remove" aria-label="Remove ${name} from the results" title="Remove">${icon('x')}</button>
    </div>`;
  li.querySelector('.row__name').title = isTouch() ? 'Preview' : 'Open in a new tab';
  li.querySelector('[data-act="copy"]').addEventListener('click', (event) => doCopy(item, event.currentTarget));
  li.querySelector('[data-act="download"]').addEventListener('click', () => downloadMarkdown(item.result.fileName, item.result.markdown));
  li.querySelector('[data-act="remove"]').addEventListener('click', () => {
    closePeek();
    queue.remove(item.id);
  });
  li.querySelector('.row__name').addEventListener('click', () => {
    closePeek();
    if (isTouch()) {
      openSheet({
        ...outputSpec(item),
        actions: [
          { label: 'Copy', icon: 'copy', onClick: (button) => doCopy(item, button) },
          { label: '.md', icon: 'download', onClick: () => downloadMarkdown(item.result.fileName, item.result.markdown) },
          { label: 'Open in new tab', icon: 'external', primary: true, onClick: () => { closeSheet(); doOpen(item); } },
        ],
      });
    } else {
      doOpen(item);
    }
  });
  attachPeek(li, () => outputSpec(item));
  li.addEventListener('animationend', () => li.classList.remove('is-new'), { once: true });
  return li;
}

// ---------- render ----------
function syncList(listEl, wanted, key, build, updateFn) {
  const wantedIds = new Set(wanted.map((item) => item.id));
  for (const [id, entry] of rows) {
    if (entry[key] && !wantedIds.has(id)) {
      entry[key].remove();
      entry[key] = null;
    }
  }
  let previous = null;
  for (const item of wanted) {
    const entry = rows.get(item.id) || {};
    rows.set(item.id, entry);
    if (!entry[key]) entry[key] = build(item);
    if (updateFn) updateFn(entry[key], item);
    const expectedPosition = previous ? previous.nextSibling : listEl.firstChild;
    if (entry[key] !== expectedPosition) listEl.insertBefore(entry[key], expectedPosition);
    previous = entry[key];
  }
  for (const [id, entry] of rows) {
    if (!entry.queueRow && !entry.resultRow) rows.delete(id);
  }
}

function render() {
  const all = queue.getItems();
  const waiting = queue.queued();
  const done = queue.results();
  const running = queue.isRunning();
  const stopping = queue.isStopping();
  const processing = all.filter((item) => item.status === 'processing').length;
  const failed = all.filter((item) => item.status === 'failed').length;
  const pending = all.filter((item) => item.status === 'pending').length;

  syncList(el.queueList, waiting, 'queueRow', buildQueueRow, updateQueueRow);
  syncList(el.resultsList, done, 'resultRow', buildResultRow, null);

  el.queueCount.textContent = waiting.length;
  el.resultsCount.textContent = done.length;
  el.queueEmpty.hidden = waiting.length > 0;
  el.resultsEmpty.hidden = done.length > 0;

  const convertible = pending + failed;
  el.convert.disabled = running || convertible === 0;
  el.convert.classList.toggle('is-busy', running);
  el.convert.querySelector('.icon').outerHTML = icon(running ? 'loader' : failed && !pending ? 'retry' : 'play');
  if (running) {
    const progress = queue.runProgress();
    el.convertLabel.textContent = stopping ? 'Stopping…' : `Converting ${progress.done} of ${progress.total}`;
  } else if (failed && !pending) {
    el.convertLabel.textContent = failed === 1 ? 'Retry failed item' : `Retry ${failed} failed`;
  } else {
    el.convertLabel.textContent = convertible > 1 ? `Convert all ${convertible}` : convertible === 1 ? 'Convert' : 'Convert all';
  }
  // Stop takes Clear's place while a run is going.
  el.stop.hidden = !running;
  el.stop.disabled = stopping;
  el.clear.hidden = running;
  el.clear.disabled = all.length === 0;
  el.zip.disabled = done.length === 0;

  if (!all.length) {
    el.tally.textContent = '';
  } else {
    const bits = [`<b>${all.length}</b> ${all.length === 1 ? 'item' : 'items'}`];
    if (done.length) bits.push(`${done.length} done`);
    if (processing) bits.push(`${processing} converting`);
    if (failed) bits.push(`<span class="tally__bad">${failed} failed</span>`);
    el.tally.innerHTML = bits.join(' · ');
  }
}

queue.subscribe((change) => {
  if (change.type === 'clear') closePeek();
  if (change.type === 'remove' || change.type === 'clear') change.ids.forEach(releaseTab);
  if (change.type === 'update') {
    // A request that couldn't reach the server: let the badge say so now, not in a minute.
    const unreachable = change.ids.some((id) => {
      const item = queue.getItem(id);
      return item && item.status === 'failed' && item.errorStatus === 0;
    });
    if (unreachable) checkHealth();
  }
  render();
});
render();

// Elapsed time on processing rows.
setInterval(() => {
  for (const item of queue.getItems()) {
    if (item.status !== 'processing') continue;
    const row = rows.get(item.id)?.queueRow;
    if (row) row.querySelector('.row__meta').textContent = queueMeta(item);
  }
}, 1000);

// ---------- actions ----------
el.convert.addEventListener('click', () => queue.convertAll());
el.stop.addEventListener('click', () => queue.stop());

el.clear.addEventListener('click', () => {
  const done = queue.results().length;
  if (done && !window.confirm(`Clear everything? ${done} converted ${done === 1 ? 'result' : 'results'} will be discarded. Nothing is kept on the server.`)) return;
  queue.clearAll();
});

el.zip.addEventListener('click', async () => {
  const results = queue.results().map((item) => item.result);
  if (!results.length) return;
  el.zip.disabled = true;
  el.zip.classList.add('is-busy');
  try {
    await downloadZip(results);
  } catch (error) {
    toast(`Couldn't build the ZIP: ${error.message}`);
  } finally {
    el.zip.classList.remove('is-busy');
    el.zip.disabled = queue.results().length === 0;
  }
});

window.addEventListener('beforeunload', (event) => {
  if (queue.results().length || queue.isRunning()) {
    event.preventDefault();
    event.returnValue = '';
  }
});
