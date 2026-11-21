import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatBytes, parseUrls } from '../../frontend/js/util.js';
import { todayStamp } from '../../frontend/js/zip.js';

test('bare addresses get https:// when the host looks like one', () => {
  const { valid, invalid } = parseUrls('example.com/page\nlocalhost:3000\nnas:8080/wiki\n192.168.1.5\nnas\nhello world');
  assert.deepEqual(valid, [
    'https://example.com/page',
    'https://localhost:3000/',
    'https://nas:8080/wiki',
    'https://192.168.1.5/',
  ]);
  assert.deepEqual(invalid, ['nas', 'hello world']);
});

test('an explicit http(s):// accepts any host, including Tailscale short names', () => {
  const { valid, invalid } = parseUrls('http://nas/page\nhttps://homeserver:8443\nftp://example.com/file');
  assert.deepEqual(valid, ['http://nas/page', 'https://homeserver:8443/']);
  assert.deepEqual(invalid, ['ftp://example.com/file']);
});

test('blank lines are ignored', () => {
  assert.deepEqual(parseUrls('\n  \nexample.com\n'), { valid: ['https://example.com/'], invalid: [] });
});

test('requireScheme only takes full links (pastes and drops)', () => {
  const { valid } = parseUrls('notes.md\nsee https://example.com\nhttps://example.com/a', { requireScheme: true });
  assert.deepEqual(valid, ['https://example.com/a']);
});

test('formatBytes', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(50 * 1024 * 1024), '50 MB');
});

test('ZIP and folder name is YYYYMMDD_markitdown', () => {
  assert.equal(todayStamp(new Date(2026, 10, 17)), '20261117_markitdown');
});
