// Queue runner tests with a fake fetch. Run: node --test tests/frontend/
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

// Every request waits until the test answers it, so tests control timing exactly.
const calls = [];
globalThis.fetch = (url, options = {}) => new Promise((resolve, reject) => {
  const isFile = String(url).endsWith('convert/file');
  const name = isFile ? options.body.get('file').name : JSON.parse(options.body).szUrl;
  const call = { url: String(url), name, signal: options.signal, resolve, reject };
  calls.push(call);
  options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
});

const queue = await import('../../frontend/js/queue.js');

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
};
const file = (name, size = 4, type = '') => new File(['x'.repeat(size)], name, { type });
const ok = (call, fileName = call.name.replace(/\.[^.]+$/, '.md'), markdown = '# ok') => call.resolve(
  new Response(JSON.stringify({ szFileName: fileName, szMarkdown: markdown }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
);
const fail = (call, status, message) => call.resolve(
  new Response(JSON.stringify({ szError: message }), { status, headers: { 'Content-Type': 'application/json' } }),
);
const open = () => calls.filter((call) => !call.done);
async function answerAll() {
  while (queue.isRunning()) {
    for (const call of open()) {
      call.done = true;
      ok(call);
    }
    await flush();
  }
}

afterEach(async () => {
  if (queue.isRunning()) {
    queue.stop();
    await flush();
  }
  queue.clearAll();
  queue.setMaxFileBytes(0);
  calls.length = 0;
});

test('images and files over the limit are turned away', () => {
  queue.setMaxFileBytes(10);
  const { added, rejected } = queue.addFiles([
    file('report.pdf'),
    file('photo.JPG'),
    file('clipboard', 4, 'image/png'),
    file('huge.docx', 11),
  ]);
  assert.deepEqual(added.map((item) => item.name), ['report.pdf']);
  assert.deepEqual(rejected.map((entry) => [entry.file.name, entry.reason]), [
    ['photo.JPG', 'image'],
    ['clipboard', 'image'],
    ['huge.docx', 'size'],
  ]);
});

test('at most three requests run at once', async () => {
  queue.addFiles(['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf', 'e.pdf'].map((name) => file(name)));
  const run = queue.convertAll();
  await flush();
  assert.equal(calls.length, 3);
  calls[0].done = true;
  ok(calls[0]);
  await flush();
  assert.equal(calls.length, 4, 'a finished request frees a slot');
  await answerAll();
  await run;
  assert.equal(queue.results().length, 5);
});

test('duplicate output names get (1), (2)', async () => {
  queue.addFiles([file('report.pdf'), file('report.docx'), file('Report.xlsx')]);
  const run = queue.convertAll();
  await answerAll();
  await run;
  assert.deepEqual(queue.results().map((item) => item.result.fileName), ['report.md', 'report (1).md', 'Report (2).md']);
});

test('progress counts items added during a run, and they join it', async () => {
  queue.addFiles([file('a.pdf'), file('b.pdf'), file('c.pdf')]);
  const run = queue.convertAll();
  await flush();
  assert.deepEqual(queue.runProgress(), { done: 0, total: 3 });

  queue.addFiles(['d.pdf', 'e.pdf', 'f.pdf', 'g.pdf', 'h.pdf'].map((name) => file(name)));
  assert.deepEqual(queue.runProgress(), { done: 0, total: 8 });

  for (const call of calls) {
    call.done = true;
    ok(call);
  }
  await flush();
  assert.deepEqual(queue.runProgress(), { done: 3, total: 8 });
  assert.equal(open().length, 3, 'the added items start without pressing Convert again');

  await answerAll();
  await run;
  assert.equal(queue.runProgress(), null);
  assert.equal(queue.results().length, 8);
});

test('Stop cancels in-flight requests and puts those items back to Pending', async () => {
  queue.addFiles(['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf'].map((name) => file(name)));
  const run = queue.convertAll();
  await flush();
  queue.stop();
  assert.ok(queue.isStopping());
  await run;
  assert.equal(queue.isRunning(), false);
  assert.equal(calls.length, 3, 'nothing new starts after Stop');
  assert.ok(calls.every((call) => call.signal.aborted));
  assert.deepEqual(queue.getItems().map((item) => item.status), ['pending', 'pending', 'pending', 'pending']);
});

test('removing a converting item cancels its request', async () => {
  const { added } = queue.addFiles([file('a.pdf')]);
  const run = queue.convertAll();
  await flush();
  assert.equal(added[0].status, 'processing');
  queue.remove(added[0].id);
  await run;
  assert.ok(calls[0].signal.aborted);
  assert.equal(queue.getItems().length, 0);
});

test('a file queued before the limit was known fails without uploading', async () => {
  const { added } = queue.addFiles([file('big.pdf', 20)]);
  queue.setMaxFileBytes(10);
  await queue.convertAll();
  assert.equal(calls.length, 0);
  assert.equal(added[0].status, 'failed');
  assert.equal(added[0].errorStatus, 413);
});

test('failed items show the engine error and are retried on the next run', async () => {
  const { added } = queue.addFiles([file('locked.pdf')]);
  const first = queue.convertAll();
  await flush();
  fail(calls[0], 500, 'PDF is encrypted');
  await first;
  assert.equal(added[0].status, 'failed');
  assert.equal(added[0].error, 'PDF is encrypted');
  assert.equal(added[0].errorStatus, 500);

  const second = queue.convertAll();
  await flush();
  assert.equal(added[0].status, 'processing');
  assert.equal(added[0].error, null);
  ok(calls[1]);
  await second;
  assert.equal(added[0].status, 'success');
});

test('URLs go through the same queue', async () => {
  queue.addUrls(['https://example.com/a']);
  const run = queue.convertAll();
  await flush();
  assert.equal(calls[0].url, 'api/convert/url');
  assert.equal(calls[0].name, 'https://example.com/a');
  ok(calls[0], 'example.com-a.md');
  await run;
  assert.equal(queue.results()[0].result.fileName, 'example.com-a.md');
});
