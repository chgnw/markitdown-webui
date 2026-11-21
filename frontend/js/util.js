// Small shared helpers.

const scriptLoads = new Map();

/** Load a classic (UMD) script once. */
export function loadScript(src) {
  if (!scriptLoads.has(src)) {
    scriptLoads.set(src, new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.onload = () => resolve();
      el.onerror = () => {
        scriptLoads.delete(src);
        reject(new Error(`Could not load ${src}`));
      };
      document.head.append(el);
    }));
  }
  return scriptLoads.get(src);
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch]);
}

export function formatBytes(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function formatCount(n) {
  if (n < 1000) return String(n);
  if (n < 100_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.round(n / 1000)}k`;
}

export function formatSeconds(ms) {
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(1)} s` : `${Math.round(s)} s`;
}

/**
 * Split text into web addresses, one per line. A line without a scheme gets https:// and
 * then needs a dotted host, a port or "localhost", so a stray word isn't taken for a host.
 * With an explicit http:// or https://, any host counts (Tailscale short names, IPs).
 * requireScheme: only lines that start with http:// or https:// count (for pastes and drops).
 */
export function parseUrls(text, { requireScheme = false } = {}) {
  const valid = [];
  const invalid = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(line);
    if (requireScheme && !/^https?:\/\//i.test(line)) {
      invalid.push(line);
      continue;
    }
    try {
      const url = new URL(hasScheme ? line : `https://${line}`);
      const web = url.protocol === 'http:' || url.protocol === 'https:';
      const host = url.hostname;
      const hostOk = hasScheme
        ? Boolean(host)
        : host.includes('.') || host === 'localhost' || host.startsWith('[') || Boolean(url.port);
      if (web && hostOk) valid.push(url.href);
      else invalid.push(line);
    } catch {
      invalid.push(line);
    }
  }
  return { valid, invalid };
}

export function isTouch() {
  return window.matchMedia('(pointer: coarse)').matches;
}

export async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Plain-HTTP fallback (Tailscale IPs without HTTPS aren't a secure context).
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  area.setSelectionRange(0, text.length);
  const ok = document.execCommand('copy');
  area.remove();
  if (!ok) throw new Error('Copy failed');
}
