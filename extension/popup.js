const api = globalThis.browser ?? chrome;
const defaults = ['https://sbxh9.com', 'https://newtoki1.org', 'https://toki32.com',
  'https://wankyo83.github.io', 'https://dc-toki-mangayomi-total-toki-manga-test.pages.dev',
  'https://dc-toki-mangayomi-media.pages.dev', 'https://dc-toki-mangayomi-novel.pages.dev'];
const status = document.querySelector('#status');
async function render() {
  const { pending = {} } = await api.storage.local.get('pending');
  const origins = [...new Set([...Object.keys(pending), ...defaults])];
  const root = document.querySelector('#sites'); root.replaceChildren();
  for (const origin of origins) {
    const row = document.createElement('section'), name = document.createElement('div'); name.textContent = origin; row.append(name);
    const allowed = await api.permissions.contains({ origins: [origin + '/*'] });
    if (pending[origin]?.denied) { const note = document.createElement('small'); note.textContent = '접근이 거부됐습니다. 원본 사이트 접속을 확인하세요.'; row.append(note); }
    const button = document.createElement('button'); button.textContent = allowed ? '허용 취소' : '사이트 허용';
    button.onclick = () => {
      // Must start synchronously in the actual popup user gesture (Safari/Firefox requirement).
      const operation = allowed ? api.permissions.remove({ origins: [origin + '/*'] }) : api.permissions.request({ origins: [origin + '/*'] });
      operation.then(() => render()).catch(error => { status.textContent = '권한을 변경하지 못했습니다.'; });
    };
    row.append(button);
    if (allowed) {
      const open = document.createElement('button'); open.textContent = '사이트 열기';
      open.onclick = () => api.runtime.sendMessage({ type: 'open-auth', origin }).then(result => { if (result?.error) status.textContent = '사이트를 열지 못했습니다.'; });
      row.append(open);
    }
    root.append(row);
  }
}
render().catch(() => { status.textContent = '설정을 읽지 못했습니다.'; });
