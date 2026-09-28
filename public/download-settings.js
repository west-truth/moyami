import { localStorage } from '/account-storage.js';

const key = 'moyami-download-settings';
export function downloadSettings() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(key)); } catch {}
  return {
    prefetch: saved?.prefetch !== false,
    pages: [2, 8, 16].includes(saved?.pages) ? saved.pages : 8,
    cacheMiB: [16, 32, 64].includes(saved?.cacheMiB) ? saved.cacheMiB : 32,
  };
}
export function initializeDownloads({ changed, clear }) {
  const enabled = document.getElementById('downloadPrefetch');
  const pages = document.getElementById('downloadPages');
  const capacity = document.getElementById('downloadCacheSize');
  const status = document.getElementById('downloadStatus');
  const draw = () => {
    const value = downloadSettings();
    enabled.checked = value.prefetch; pages.value = String(value.pages);
    pages.disabled = !value.prefetch; capacity.value = String(value.cacheMiB);
  };
  for (const field of [enabled, pages, capacity]) field.addEventListener('change', async () => {
    localStorage.setItem(key, JSON.stringify({prefetch:enabled.checked, pages:Number(pages.value), cacheMiB:Number(capacity.value)}));
    draw();
    await changed();
    status.textContent = '이 기기에 설정을 저장했습니다.';
  });
  const button = document.getElementById('downloadClear');
  button.addEventListener('click', async () => {
    button.disabled = true; status.textContent = '캐시를 비우는 중…';
    try { await clear(); status.textContent = '캐시를 비웠습니다. 읽기 기록과 읽던 위치는 유지됩니다.'; }
    catch { status.textContent = '일부 캐시를 비우지 못했습니다. 다시 시도해 주세요.'; }
    finally { button.disabled = false; }
  });
  addEventListener('moya-settings-open', event => { if (event.detail === 'downloads') draw(); });
  draw();
}
