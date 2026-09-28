// Loading placeholders and screen transitions. The previous screen stays in place
// underneath, so cancelling a slow request returns to it without losing scroll.
const $ = id => document.getElementById(id);
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let hint = null;

/** Describe the destination of the next foreground request (title, cover, chapter). */
export function expectScreen(value) { hint = value || null; }

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}
const lines = (count, className = 'skeleton-line') => Array.from({length:count}, () => node('span', className));

function detailSkeleton({ title, imageUrl, source } = {}) {
  const root = node('div', 'pending-detail');
  const hero = node('div', 'pending-hero');
  const cover = node('div', 'pending-cover skeleton-block');
  if (imageUrl && !imageUrl.startsWith('moya-image:')) {
    const image = node('img'); image.alt = ''; image.src = imageUrl;
    image.onerror = () => image.remove();
    cover.append(image);
  }
  const copy = node('div', 'pending-copy');
  if (source) copy.append(node('span', 'pending-eyebrow', source));
  copy.append(title ? node('h2', 'pending-title', title) : node('span', 'skeleton-line is-title'), ...lines(3));
  hero.append(cover, copy);
  const rows = node('div', 'pending-rows');
  for (let index = 0; index < 6; index++) rows.append(node('span', 'skeleton-row'));
  root.append(hero, rows);
  return root;
}
function listSkeleton() {
  const root = node('div', 'pending-list');
  root.append(node('span', 'skeleton-line is-search'));
  const grid = node('div', 'pending-grid');
  for (let index = 0; index < 12; index++) {
    const card = node('div', 'pending-card');
    card.append(node('span', 'skeleton-block pending-card-cover'), ...lines(2));
    grid.append(card);
  }
  root.append(grid);
  return root;
}
function readerSkeleton({ title, chapter, direction } = {}) {
  const root = node('div', 'pending-reader');
  const card = node('div', `pending-chapter${direction ? ` is-${direction}` : ''}`);
  if (direction) card.append(node('span', 'pending-eyebrow', direction === 'next' ? '다음 화' : '이전 화'));
  if (chapter) card.append(node('strong', 'pending-chapter-title', chapter));
  if (title) card.append(node('span', 'pending-chapter-work', title));
  const status = node('span', 'pending-chapter-status');
  status.append(node('span', 'loading-spinner'), node('span', '', '불러오는 중'));
  card.append(status);
  root.append(card);
  return root;
}

/**
 * Show a placeholder for a foreground request. `kind` follows the source action;
 * requests that refresh the screen already on display only dim what changes.
 */
export function showPending(kind, currentView) {
  const layer = $('pendingView');
  const expected = hint; hint = null;
  const screen = expected?.screen || (kind === 'detail' ? 'detail' : kind === 'pages' || kind === 'html' ? 'reader' : kind === 'list' || kind === 'catalog' ? 'browse' : '');
  // Chapter changes inside the reader get a title card; other same-screen requests only dim.
  const overlay = Boolean(screen) && (screen !== currentView || (screen === 'reader' && expected));
  document.body.dataset.pending = overlay ? screen : screen ? 'refresh' : 'task';
  if (!overlay) { layer.hidden = true; layer.replaceChildren(); delete layer.dataset.kind; return; }
  if (layer.dataset.kind === screen && !layer.hidden) return;
  layer.dataset.kind = screen;
  layer.replaceChildren(screen === 'detail' ? detailSkeleton(expected) : screen === 'reader' ? readerSkeleton(expected) : listSkeleton());
  layer.hidden = false;
}
export function hidePending() {
  delete document.body.dataset.pending;
  const layer = $('pendingView');
  layer.hidden = true; layer.replaceChildren(); delete layer.dataset.kind;
}

const order = { login: 0, recent: 1, browse: 1, error: 1, detail: 2, reader: 3 };
/** Animate the section that just became visible; direction follows the navigation depth. */
export function enterScreen(name, previous) {
  if (reduced.matches || !previous || previous === name || previous === 'login') return;
  const section = $(name);
  const direction = order[name] > order[previous] ? 'forward' : order[name] < order[previous] ? 'back' : 'swap';
  section.classList.remove('screen-enter');
  section.dataset.enter = direction;
  void section.offsetWidth;
  section.classList.add('screen-enter');
  section.addEventListener('animationend', () => section.classList.remove('screen-enter'), { once:true });
}

/** Fade images in once decoded instead of popping in line by line. */
export function fadeInImages(root) {
  for (const image of root.querySelectorAll('img')) {
    if (image.complete && image.naturalWidth) continue;
    image.classList.add('img-fade');
    const done = () => image.classList.add('is-loaded');
    image.addEventListener('load', done, { once:true });
    image.addEventListener('error', () => image.classList.remove('img-fade'), { once:true });
  }
}

/** Short relative time for "last checked" labels, full timestamp in the tooltip. */
export function checkedLabel(time) {
  const minutes = Math.floor((Date.now() - time) / 60_000);
  if (minutes < 1) return '방금 확인';
  if (minutes < 60) return `${minutes}분 전 확인`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전 확인`;
  return `${new Date(time).toLocaleDateString('ko-KR')} 확인`;
}
