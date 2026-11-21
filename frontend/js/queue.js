// Queue state: one list of items (files and URLs) plus the conversion runner.
import { convertFile, convertUrl } from './api.js';

export const MAX_PARALLEL = 3;

// Images aren't converted: this app is for documents, and without OCR or an LLM
// the engine returns no text for them anyway.
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'jfif', 'gif', 'webp', 'bmp', 'avif', 'svg', 'tif', 'tiff', 'heic', 'heif', 'ico']);

const listeners = new Set();
let items = [];
let nextId = 1;
let completedSeq = 0;
let maxFileBytes = 0; // 0 = not known yet (comes from /api/health)
let run = null; // { claimed: Set<id>, active, stopping, promise, resolve } while converting
const controllers = new Map(); // id → AbortController of its in-flight request

export const STATUS = Object.freeze({
  pending: 'pending',
  processing: 'processing',
  success: 'success',
  failed: 'failed',
});

function emit(change) {
  for (const fn of listeners) fn(change);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getItems() {
  return items;
}

export function getItem(id) {
  return items.find((item) => item.id === id);
}

export function isRunning() {
  return run !== null;
}

export function isStopping() {
  return Boolean(run && run.stopping);
}

/** Items still waiting in the queue (anything not converted successfully). */
export function queued() {
  return items.filter((item) => item.status !== STATUS.success);
}

/** Converted items, in the order they finished. */
export function results() {
  return items
    .filter((item) => item.status === STATUS.success)
    .sort((a, b) => a.doneSeq - b.doneSeq);
}

export function extensionOf(name) {
  const match = /\.([^./\\]+)$/.exec(name || '');
  return match ? match[1].toLowerCase() : '';
}

export function isImage(file) {
  return String(file.type || '').startsWith('image/') || IMAGE_EXT.has(extensionOf(file.name));
}

/** Per-file limit in bytes, from the server's MAX_FILE_MB. 0 turns the check off. */
export function setMaxFileBytes(bytes) {
  const value = Number(bytes);
  maxFileBytes = Number.isFinite(value) && value > 0 ? value : 0;
}

export function getMaxFileBytes() {
  return maxFileBytes;
}

function sizeError() {
  const mb = Number((maxFileBytes / 1024 / 1024).toFixed(2));
  return `File exceeds MAX_FILE_MB (${mb} MB)`;
}

/**
 * Add files to the queue. Images and files over the size limit are turned away.
 * → { added: [item], rejected: [{ file, reason: 'image' | 'size' }] }
 */
export function addFiles(files) {
  const added = [];
  const rejected = [];
  for (const file of files) {
    if (isImage(file)) {
      rejected.push({ file, reason: 'image' });
      continue;
    }
    if (maxFileBytes && file.size > maxFileBytes) {
      rejected.push({ file, reason: 'size' });
      continue;
    }
    added.push({
      id: `i${nextId++}`,
      kind: 'file',
      file,
      name: file.name,
      size: file.size,
      ext: extensionOf(file.name),
      status: STATUS.pending,
    });
  }
  if (added.length) {
    items = [...items, ...added];
    emit({ type: 'add', ids: added.map((item) => item.id) });
    pump();
  }
  return { added, rejected };
}

export function addUrls(urls) {
  const added = urls.map((url) => ({
    id: `i${nextId++}`,
    kind: 'url',
    url,
    name: url.replace(/^https?:\/\//i, '').replace(/\/$/, ''),
    ext: 'url',
    status: STATUS.pending,
  }));
  if (added.length) {
    items = [...items, ...added];
    emit({ type: 'add', ids: added.map((item) => item.id) });
    pump();
  }
  return added;
}

/** Remove an item. One that is converting has its request cancelled. */
export function remove(id) {
  if (!getItem(id)) return;
  items = items.filter((entry) => entry.id !== id);
  controllers.get(id)?.abort();
  emit({ type: 'remove', ids: [id] });
}

export function clearAll() {
  if (run) return;
  const ids = items.map((item) => item.id);
  items = [];
  emit({ type: 'clear', ids });
}

function uniqueName(desired) {
  const taken = new Set(results().map((item) => item.result.fileName.toLowerCase()));
  if (!taken.has(desired.toLowerCase())) return desired;
  const dot = desired.toLowerCase().endsWith('.md') ? desired.length - 3 : desired.length;
  const stem = desired.slice(0, dot);
  const ext = desired.slice(dot);
  for (let n = 1; ; n += 1) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

function update(item, patch) {
  Object.assign(item, patch);
  if (getItem(item.id)) emit({ type: 'update', ids: [item.id] });
}

async function convertOne(item) {
  // The limit may have arrived after the file was queued: fail it here instead of uploading it.
  if (item.kind === 'file' && maxFileBytes && item.size > maxFileBytes) {
    update(item, { status: STATUS.failed, elapsedMs: 0, error: sizeError(), errorStatus: 413 });
    return;
  }
  const controller = new AbortController();
  controllers.set(item.id, controller);
  update(item, { status: STATUS.processing, startedAt: performance.now(), elapsedMs: null, error: null, errorStatus: null });
  try {
    const data = item.kind === 'file'
      ? await convertFile(item.file, controller.signal)
      : await convertUrl(item.url, controller.signal);
    if (!getItem(item.id)) return; // removed while converting
    const fileName = uniqueName(data.szFileName || `${item.name}.md`);
    completedSeq += 1;
    update(item, {
      status: STATUS.success,
      doneSeq: completedSeq,
      elapsedMs: performance.now() - item.startedAt,
      result: { fileName, markdown: data.szMarkdown || '' },
    });
  } catch (error) {
    if (!getItem(item.id)) return;
    if (error.name === 'AbortError') {
      // Stopped: back in line as if it never started.
      update(item, { status: STATUS.pending, startedAt: null, elapsedMs: null });
      return;
    }
    update(item, {
      status: STATUS.failed,
      elapsedMs: performance.now() - item.startedAt,
      error: error.message || 'Conversion failed',
      errorStatus: error.status ?? null,
    });
  } finally {
    controllers.delete(item.id);
  }
}

// ---------- runner ----------
// Up to MAX_PARALLEL requests at a time. Items added while a run is going join it.

function nextPending() {
  return items.find((item) => item.status === STATUS.pending && !run.claimed.has(item.id));
}

function finishRun() {
  const finished = run;
  run = null;
  emit({ type: 'run', running: false });
  finished.resolve();
}

function settle() {
  run.active -= 1;
  pump();
}

function pump() {
  if (!run) return;
  while (!run.stopping && run.active < MAX_PARALLEL) {
    const item = nextPending();
    if (!item) break;
    run.claimed.add(item.id);
    run.active += 1;
    convertOne(item).finally(settle);
  }
  if (run.active === 0) finishRun();
}

/** Convert every item that isn't done yet (pending, plus failed ones as a retry). */
export function convertAll() {
  if (run) return run.promise;
  const todo = items.filter((item) => item.status === STATUS.pending || item.status === STATUS.failed);
  if (!todo.length) return Promise.resolve();
  for (const item of todo) {
    if (item.status === STATUS.failed) update(item, { status: STATUS.pending, error: null, errorStatus: null });
  }
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  run = { claimed: new Set(), active: 0, stopping: false, promise, resolve };
  emit({ type: 'run', running: true });
  pump();
  return promise;
}

/**
 * Stop the run: cancel in-flight requests and start nothing new. Cancelled items go back
 * to Pending. The server may still finish an engine call it already started.
 */
export function stop() {
  if (!run || run.stopping) return;
  run.stopping = true;
  emit({ type: 'run', running: true, stopping: true });
  for (const controller of controllers.values()) controller.abort();
}

/** { done, total } for the current run (items added during it included), or null. */
export function runProgress() {
  if (!run) return null;
  let done = 0;
  let total = 0;
  for (const item of items) {
    if (run.claimed.has(item.id)) {
      total += 1;
      if (item.status === STATUS.success || item.status === STATUS.failed) done += 1;
    } else if (item.status === STATUS.pending) {
      total += 1;
    }
  }
  return { done, total };
}
