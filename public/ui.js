import { localStorage, indexedDB } from "/account-storage.js";
// Moya's navigation and settings presentation, bound to the lite source controller.
const $ = (id) => document.getElementById(id);
const icons = {
  previous: '<path d="m15 5-7 7 7 7"/>',
  next: '<path d="m9 5 7 7-7 7"/>',
  bookmark: '<path d="M6 4h12v17l-6-4-6 4z"/>',
  play: '<path d="m8 4 12 8-12 8z"/>',
  fullscreen: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-3 5-5 3 3-5z"/>',
  book: '<path d="M12 5v15M3 4c4-1 7 0 9 1 2-1 5-2 9-1v15c-4-1-7 0-9 1-2-1-5-2-9-1z"/>',
  plug: '<path d="M8 3v5m8-5v5M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/>',
  settings: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  back: '<path d="m14 5-7 7 7 7"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  refresh: '<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',
  swap: '<path d="M4 8h14m-4-4 4 4-4 4M20 16H6m4-4-4 4 4 4"/>',
};
export function hydrateIcons(root = document) {
  for (const node of root.querySelectorAll('[data-icon]')) {
    node.classList.add('ui-icon');
    node.setAttribute('aria-hidden', 'true');
    node.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons[node.dataset.icon] || ''}</svg>`;
  }
}
export function updateSourceTitle(title) {
  $('sourceName').textContent = title;
  $('browseSourceName').textContent = title;
  const mobile = $('mobileSourceName');
  if (mobile) mobile.textContent = title;
}
export function updateScreen(name) {
  document.body.dataset.screen = name;
  $('refreshList').hidden = !['browse', 'detail'].includes(name);
  $('refreshList').setAttribute('aria-label', name === 'detail' ? '작품 정보와 회차 새로고침' : '탐색 목록 새로고침');
  $('readerTitle').hidden = name !== 'reader';
  $('readerSettingsTab').hidden = name !== 'reader';
  $('screenTitle').textContent = ({ recent: '최근 읽기', browse: '탐색', detail: '작품 상세', login: '로그인', error: '연결 확인', reader: '읽기' })[name] || '탐색';
  $('headingIcon').hidden = name !== 'browse';
  if (name !== 'reader') $('readerSearchToggle').hidden = true;
  for (const button of document.querySelectorAll('[data-nav]')) {
    const current = button.dataset.nav === name && !button.hasAttribute('data-nav-passive');
    button.classList.toggle('active',current);
    if (current) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
  }
}
export function initializeUI({ navigate, refresh }) {
  hydrateIcons();
  const chromeSize = new ResizeObserver(() => {
    document.body.style.setProperty('--reader-header-height', `${$('appHeader').offsetHeight}px`);
    document.body.style.setProperty('--reader-controls-height', `${document.querySelector('.reader-bottombar').offsetHeight}px`);
  });
  chromeSize.observe($('appHeader'));
  chromeSize.observe(document.querySelector('.reader-bottombar'));
  const navigation = $('sidebar').querySelector('.library-sidebar-scroll').cloneNode(true);
  navigation.querySelector('#sourceName').id = 'mobileSourceName';
  $('mobileNavigation').append(navigation);
  const savedTheme = localStorage.getItem('moya-app-theme');
  const theme = ['light', 'dark', 'sepia', 'midnight'].includes(savedTheme) ? savedTheme : 'dark';
  document.documentElement.dataset.theme = theme;
  $('appTheme').value = theme;
  $('appTheme').onchange = () => {
    document.documentElement.dataset.theme = $('appTheme').value;
    localStorage.setItem('moya-app-theme', $('appTheme').value);
  };
  $('menuButton').onclick = () => $('navigationDialog').showModal();
  $('refreshList').onclick = refresh;
  $('readerSearchToggle').onclick = () => {
    const open = $('novelSearchToolbar').hidden; $('novelSearchToolbar').hidden = !open;
    $('readerSearchToggle').setAttribute('aria-expanded',String(open));
    if (open) $('novelSearch').focus();
  };
  let settingsTrigger;
  $('settingsDialog').addEventListener('close', () => {
    if (settingsTrigger?.getClientRects().length) settingsTrigger.focus();
    else if ($('menuButton').getClientRects().length) $('menuButton').focus();
  });
  document.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.close) $(button.dataset.close).close();
    if (button.dataset.settings) {
      const wasOpen = $('settingsDialog').open;
      if (!wasOpen) settingsTrigger = button;
      $('navigationDialog').close();
      $('settingsDialog').showModal();
      const key = button.dataset.settings;
      const section = $(({ sources: 'sourceSettings', connection: 'connectionSettings', appearance: 'appearanceSettings', reader: 'readerSettings', account: 'accountSettings' })[key]);
      for (const panel of document.querySelectorAll('.settings-section')) panel.hidden = panel !== section;
      for (const tab of document.querySelectorAll('.settings-tabs button')) tab.setAttribute('aria-current',String(tab.dataset.settings === key));
      $('settingsTitle').textContent = ({sources:'확장 소스 관리',connection:'연결 설정',appearance:'화면 설정',reader:'읽기 설정',account:'계정'})[key];
      $('settingsDialog').scrollTop = 0;
      dispatchEvent(new CustomEvent('moya-settings-open',{detail:key}));
      if (!wasOpen) $('settingsTitle').focus({preventScroll:true});
    }
    if (button.dataset.nav) {
      void navigate(button.dataset.nav, () => $('navigationDialog').close());
    }
  });
  for (const dialog of [$('navigationDialog'), $('settingsDialog')]) {
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    });
  }
}
