import { assignImage, disposeImages } from '/connector-images.js';
import { coverKey, readCover, saveCover } from '/cover-cache.js';

const $ = id => document.getElementById(id);
function cover(item) {
  const root = document.createElement('span'); root.className = 'history-cover';
  const fallback = document.createElement('span'); fallback.textContent = item.title || 'MOYA'; root.append(fallback);
  const key = coverKey(`${item.repositoryUrl}\n${item.sourceId}`, item.url);
  const image = document.createElement('img'); image.alt = ''; image.loading = 'lazy';
  let cachedUrl;
  image.onload = () => {
    fallback.hidden = true; image.hidden = false;
    if (cachedUrl) { URL.revokeObjectURL(cachedUrl); cachedUrl = undefined; }
    else void saveCover(key, image);
  };
  image.onerror = () => {
    if (cachedUrl) { URL.revokeObjectURL(cachedUrl); cachedUrl = undefined; if (item.imageUrl) { assignImage(image, item.imageUrl); return; } }
    image.hidden = true; fallback.hidden = false;
  };
  root.append(image);
  void readCover(key).then(blob => {
    if (!image.isConnected) return;
    if (blob) { cachedUrl = URL.createObjectURL(blob); image.src = cachedUrl; }
    else if (item.imageUrl) assignImage(image, item.imageUrl);
    else image.hidden = true;
  });
  return root;
}
const text = (tag, value, className) => {
  const node = document.createElement(tag); node.textContent = value; if (className) node.className = className; return node;
};
function removeButton(item, remove) {
  const button = text('button', '×', 'history-remove');
  button.type = 'button'; button.title = '최근 읽기에서 삭제';
  button.setAttribute('aria-label', `${item.title} 최근 읽기에서 삭제`);
  button.onclick = event => { event.stopPropagation(); remove(item); };
  return button;
}
function date(value) {
  return Number.isFinite(value) ? new Intl.DateTimeFormat('ko', {month:'short',day:'numeric'}).format(value) : '';
}
export function renderLibraryHome(items, { open, resume, remove }) {
  for (const id of ['recentFeatured', 'recentWorks']) { disposeImages($(id)); $(id).replaceChildren(); }
  const query = $('recentQuery').value.trim().toLocaleLowerCase();
  const visible = items.filter(item => `${item.title} ${item.author || ''} ${item.sourceName || ''}`.toLocaleLowerCase().includes(query));
  $('recentCount').textContent = `${items.length}개 작품`;
  $('recentEmpty').hidden = visible.length > 0;
  $('recentEmptyTitle').textContent = query ? '검색 결과가 없습니다' : '아직 읽은 작품이 없습니다';
  $('recentEmptyHint').textContent = query ? '다른 작품명이나 소스 이름으로 검색해 보세요.' : '탐색에서 작품을 읽으면 이곳에서 이어 읽을 수 있습니다.';
  const latest = items[0];
  $('recentFeatured').hidden = !latest || Boolean(query);
  if (latest) {
    const copy = document.createElement('div'); copy.className = 'recent-copy';
    copy.append(text('span','최근 읽던 작품','eyebrow'), text('h2', latest.title), text('p', [latest.chapterTitle,latest.sourceName].filter(Boolean).join(' · ')));
    const button = text('button', '이어 읽기', 'primary-btn'); button.onclick = () => resume(latest);
    const artwork = document.createElement('div'); artwork.className = 'recent-artwork';
    artwork.append(cover(latest), removeButton(latest, remove));
    $('recentFeatured').append(artwork, copy, button);
  }
  for (const item of visible) {
    const card = document.createElement('article'); card.className = 'history-card';
    const main = document.createElement('button'); main.className = 'history-card-open'; main.setAttribute('aria-label',`${item.title} 상세 보기`);
    const copy = document.createElement('span'); copy.className = 'history-card-copy';
    copy.append(text('strong',item.title), text('span',item.chapterTitle || '읽던 회차'), text('small',[item.sourceName,date(item.updatedAt)].filter(Boolean).join(' · ')));
    main.append(cover(item),copy); main.onclick = () => open(item);
    const resumeButton = text('button','이어 읽기','ghost-btn'); resumeButton.setAttribute('aria-label',`${item.title} 이어 읽기`); resumeButton.onclick = () => resume(item);
    card.append(main,resumeButton,removeButton(item,remove)); $('recentWorks').append(card);
  }
}
