const install = document.getElementById('installApp');
const status = document.getElementById('installStatus');
let prompt;
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function installed() {
  install.hidden = true;
  status.textContent = '앱으로 실행 중입니다.';
}
if (standalone()) installed();
addEventListener('beforeinstallprompt', event => {
  event.preventDefault(); prompt = event;
  if (!standalone()) { install.hidden = false; status.textContent = '홈 화면에 추가해 모야를 앱처럼 열 수 있습니다.'; }
});
install.onclick = async () => {
  if (!prompt) return;
  const pending = prompt; prompt = undefined; install.hidden = true;
  try { await pending.prompt(); const result = await pending.userChoice; if (result.outcome === 'accepted') status.textContent = '설치 후 홈 화면이나 앱 목록에서 모야를 열어 주세요.'; }
  catch { status.textContent = '브라우저 메뉴에서 앱 설치 또는 홈 화면에 추가를 선택하세요.'; }
};
addEventListener('appinstalled', () => { prompt = undefined; install.hidden = true; status.textContent = '모야가 설치되었습니다.'; });
if ('serviceWorker' in navigator && isSecureContext) {
  navigator.serviceWorker.register('/sw.js', { scope:'/', updateViaCache:'none' }).then(registration => {
    const updated = () => {
      if (!registration.waiting || !navigator.serviceWorker.controller) return;
      const message = document.getElementById('appUpdateStatus');
      message.hidden = false; message.textContent = '새 버전이 준비됐습니다. 모야의 창과 탭을 모두 닫고 다시 열면 적용됩니다.';
    };
    updated(); registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', updated));
  }).catch(() => { /* Installation and normal online reading remain available. */ });
}
