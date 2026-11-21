// Stroke icons, 24x24 grid, drawn to one weight (stroke set in CSS).
const PATHS = {
  upload: '<path d="M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  play: '<path d="M7 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L8.5 4.64A1 1 0 0 0 7 5.5Z"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9"/><path d="M10 13h4"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  download: '<path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5"/><path d="M4 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/>',
  doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
  markdown: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M6 15V9l2.5 3L11 9v6M16 9v6m-2-2 2 2 2-2"/>',
  pdf: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M8.5 17.5c2-1 4.5-5 4-7.5-.3-1.5-2-1.5-2 0 0 2.5 3.5 6 6 6.5 1.3.2 1.3-1.3 0-1.5-2.5-.3-6 1-8 2.5Z"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>',
  slides: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M12 16v4M8 20h8"/><path d="M8 12V9m4 3V8m4 4v-2"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
  book: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5Z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5Z"/>',
  zip: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M10 4v2m0 2v2m0 2v2"/><rect x="8.75" y="14" width="2.5" height="3" rx=".6"/>',
  code: '<path d="m9 8-4 4 4 4m6-8 4 4-4 4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3Z"/>',
  video: '<rect x="3" y="6" width="18" height="12" rx="3"/><path d="m10.5 9.5 4 2.5-4 2.5Z"/>',
  loader: '<path d="M12 3a9 9 0 1 0 9 9"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5m0 3.5v.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  retry: '<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5"/><path d="M20 4v4.5h-4.5"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.5"/><path d="M4 20v-4.5h4.5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.75"/>',
};

export function icon(name, extraClass = '') {
  const body = PATHS[name] || PATHS.file;
  return `<svg class="icon ${extraClass}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** Replace every [data-icon] placeholder under root with its SVG. */
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    // A placeholder with its own class is a styled wrapper: fill it, keep it.
    if (el.classList.length) {
      el.innerHTML = icon(el.dataset.icon);
      el.removeAttribute('data-icon');
    } else {
      el.outerHTML = icon(el.dataset.icon);
    }
  }
}
