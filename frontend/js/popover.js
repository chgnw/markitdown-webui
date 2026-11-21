// Shared preview surfaces: a hover "peek" for mouse users, a bottom sheet for touch.
import { icon, hydrateIcons } from './icons.js';
import { escapeHtml } from './util.js';

const OPEN_DELAY = 320;
const CLOSE_DELAY = 140;
const GAP = 12;

const peek = document.getElementById('peek');
const sheet = document.getElementById('sheet');
const sheetTitle = document.getElementById('sheet-title');
const sheetMeta = document.getElementById('sheet-meta');
const sheetBody = document.getElementById('sheet-body');
const sheetActions = document.getElementById('sheet-actions');

let openTimer = 0;
let closeTimer = 0;
let activeRow = null;
let renderToken = 0;

function place(row) {
  const rowRect = row.getBoundingClientRect();
  const panel = row.closest('.panel') || row;
  const panelRect = panel.getBoundingClientRect();
  const width = peek.offsetWidth;
  const height = peek.offsetHeight;
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;

  let left;
  let origin = 'top left';
  if (panelRect.right + GAP + width <= vw - 16) {
    left = panelRect.right + GAP;
  } else if (panelRect.left - GAP - width >= 16) {
    left = panelRect.left - GAP - width;
    origin = 'top right';
  } else {
    left = Math.min(Math.max(16, rowRect.left + 40), vw - width - 16);
  }

  const topBar = 64;
  let top = rowRect.top - 8;
  top = Math.max(topBar, Math.min(top, vh - height - 16));
  peek.style.left = `${Math.round(left)}px`;
  peek.style.top = `${Math.round(top)}px`;
  peek.style.setProperty('--peek-origin', origin);
}

function hidePeek() {
  clearTimeout(openTimer);
  clearTimeout(closeTimer);
  if (activeRow) activeRow.classList.remove('is-peeking');
  activeRow = null;
  renderToken += 1;
  peek.classList.remove('is-open');
  peek.hidden = true;
  peek.innerHTML = '';
}

function scheduleClose() {
  clearTimeout(closeTimer);
  closeTimer = setTimeout(hidePeek, CLOSE_DELAY);
}

async function showPeek(row, spec) {
  clearTimeout(closeTimer);
  if (activeRow === row) return;
  if (activeRow) activeRow.classList.remove('is-peeking');
  activeRow = row;
  row.classList.add('is-peeking');
  const token = ++renderToken;

  peek.setAttribute('aria-label', `Preview of ${spec.title}`);
  peek.innerHTML = `
    <div class="peek__head">
      <span class="peek__title">${escapeHtml(spec.title)}</span>
      <span class="peek__meta">${escapeHtml(spec.meta || '')}</span>
    </div>
    <div class="peek__body"><div class="pv-loading" aria-hidden="true"><i></i><i></i><i></i><i></i></div></div>
    ${spec.hint ? `<div class="peek__foot">${icon(spec.hintIcon || 'external')}<span>${escapeHtml(spec.hint)}</span></div>` : ''}`;
  peek.hidden = false;
  place(row);
  requestAnimationFrame(() => peek.classList.add('is-open'));

  const body = peek.querySelector('.peek__body');
  try {
    await spec.render(body, () => token === renderToken);
  } catch (error) {
    if (token === renderToken) body.innerHTML = `<p class="pv-error">${escapeHtml(error.message || 'Preview failed')}</p>`;
  }
  if (token === renderToken && activeRow === row) place(row);
}

/**
 * Wire hover/focus preview for a row (mouse/keyboard only).
 * getSpec() → { title, meta, hint, render(bodyEl, isCurrent) }
 */
export function attachPeek(row, getSpec) {
  const focusTarget = row.querySelector('.row__name');
  row.addEventListener('pointerenter', (event) => {
    if (event.pointerType !== 'mouse') return;
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    const delay = activeRow ? 0 : OPEN_DELAY;
    openTimer = setTimeout(() => showPeek(row, getSpec()), delay);
  });
  row.addEventListener('pointerleave', (event) => {
    if (event.pointerType !== 'mouse') return;
    clearTimeout(openTimer);
    scheduleClose();
  });
  if (focusTarget) {
    focusTarget.addEventListener('focus', () => {
      if (focusTarget.matches(':focus-visible')) showPeek(row, getSpec());
    });
    focusTarget.addEventListener('blur', scheduleClose);
  }
}

peek.addEventListener('pointerenter', () => clearTimeout(closeTimer));
peek.addEventListener('pointerleave', scheduleClose);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && activeRow) hidePeek();
});
window.addEventListener('scroll', () => { if (activeRow) hidePeek(); }, { passive: true });
window.addEventListener('resize', () => { if (activeRow) hidePeek(); });

export function closePeek() {
  hidePeek();
}

/**
 * Touch preview sheet.
 * spec: { title, meta, render(bodyEl, isCurrent), actions: [{ label, icon, primary, onClick(button) }] }
 */
export async function openSheet(spec) {
  const token = ++renderToken;
  sheetTitle.textContent = spec.title;
  sheetMeta.textContent = spec.meta || '';
  sheetBody.innerHTML = '<div class="pv-loading" aria-hidden="true"><i></i><i></i><i></i><i></i></div>';
  sheetActions.innerHTML = '';
  for (const action of spec.actions || []) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `btn ${action.primary ? 'btn--primary' : 'btn--secondary'}`;
    button.innerHTML = `${icon(action.icon)}<span>${escapeHtml(action.label)}</span>`;
    button.addEventListener('click', () => action.onClick(button));
    sheetActions.append(button);
  }
  sheetActions.hidden = !(spec.actions && spec.actions.length);
  if (!sheet.open) sheet.showModal();
  sheetBody.scrollTop = 0;
  try {
    await spec.render(sheetBody, () => token === renderToken && sheet.open);
  } catch (error) {
    if (token === renderToken) sheetBody.innerHTML = `<p class="pv-error">${escapeHtml(error.message || 'Preview failed')}</p>`;
  }
}

export function closeSheet() {
  if (sheet.open) sheet.close();
}

document.getElementById('sheet-close').addEventListener('click', closeSheet);
sheet.addEventListener('click', (event) => {
  if (event.target === sheet) closeSheet();
});
sheet.addEventListener('close', () => {
  // 'close' fires async; ignore it if the sheet was reopened in the meantime.
  if (sheet.open) return;
  renderToken += 1;
  sheetBody.innerHTML = '';
});
hydrateIcons(sheet);
