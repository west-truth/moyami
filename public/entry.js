import { startSync, flushSync } from '/account-sync.js';
import { selectAccount } from '/account-storage.js';
const $ = id => document.getElementById(id);
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('moyami-auth') : null;
let registration = false, initialized = true, account, invite;
const errors = {
  login_failed:'아이디 또는 비밀번호를 확인하세요.', signup_key_invalid:'가입 키가 올바르지 않거나 이미 사용·만료되었습니다.',
  username_unavailable:'이미 사용 중인 아이디입니다.', invalid_credentials_format:'아이디 형식과 비밀번호 길이를 확인하세요.',
  auth_rate_limited:'시도 횟수가 많습니다. 10분 뒤 다시 시도하세요.', runtime_store_unavailable:'계정 저장소에 연결하지 못했습니다. 잠시 뒤 다시 시도하세요.',
  configuration_required:'서버 설정이 필요합니다.', access_denied:'로그인 시간이 만료됐습니다. 다시 로그인하세요.',
};
function message(error) { return errors[error.message] || '요청을 완료하지 못했습니다. 연결 상태를 확인하고 다시 시도하세요.'; }
async function request(path, data) {
  const response = await fetch('/api/auth/' + path, { cache:'no-store', ...(data === undefined ? {} : {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
function expired() {
  // Hide private content immediately, including dialogs, before the next document loads.
  document.body.dataset.auth = 'pending'; document.querySelectorAll('dialog[open]').forEach(dialog => { dialog.style.visibility = 'hidden'; });
  location.reload();
}
channel?.addEventListener('message', expired);
addEventListener('moyami-session-expired', expired);
addEventListener('pageshow', event => { if (event.persisted) expired(); });
// Cookies are shared between tabs: check again when a suspended tab resumes.
addEventListener('visibilitychange', async () => {
  if (!account || document.hidden) return;
  try { const status = await request('status'); if (status.user?.id !== account.id) expired(); } catch { /* Keep the page usable during a temporary outage. */ }
});
function draw() {
  $('signupKeyField').hidden = !registration; $('signupKey').required = registration;
  $('password').autocomplete = registration ? 'new-password' : 'current-password';
  $('authSubmit').textContent = registration ? (initialized ? '가입하기' : '관리자 계정 만들기') : '로그인';
  $('authToggle').textContent = registration ? '이미 계정이 있어요 · 로그인' : '가입 키로 회원가입';
  $('authIntro').textContent = registration ? (initialized ? '관리자에게 받은 가입 키로 계정을 만드세요.' : '배포할 때 만든 가입 키로 첫 관리자 계정을 만드세요.') : '계정으로 로그인하고 읽기를 이어가세요.';
  $('authError').hidden = true;
}
$('authToggle').onclick = () => { registration = !registration; draw(); };
$('authRetry').onclick = () => location.reload();
$('loginForm').onsubmit = async event => {
  event.preventDefault(); $('authSubmit').disabled = true; $('authError').hidden = true;
  try {
    await request(registration ? 'register' : 'login', {username:$('username').value.trim(),password:$('password').value,...(registration ? {key:$('signupKey').value.trim()} : {})});
    $('password').value = ''; $('signupKey').value = ''; channel?.postMessage('changed'); location.reload();
  } catch(error) { $('authError').textContent = message(error); $('authError').hidden = false; }
  finally { $('authSubmit').disabled = false; }
};
$('logoutButton').onclick = async () => {
  $('logoutButton').disabled = true;
  try { await flushSync(); await request('logout', {}); channel?.postMessage('changed'); expired(); }
  catch(error) { $('accountStatus').textContent = message(error); }
  finally { $('logoutButton').disabled = false; }
};
$('createInvite').onclick = async () => {
  $('createInvite').disabled = true;
  try {
    invite = await request('invites', {}); $('inviteKey').value = invite.key; $('inviteResult').hidden = false;
    $('inviteExpiry').textContent = `유효 기간: ${new Date(invite.expires).toLocaleString()}`;
    $('accountStatus').textContent = '가입할 사람에게만 전달하세요. 창을 닫으면 이 키를 다시 조회할 수 없습니다.';
  } catch(error) { $('accountStatus').textContent = message(error); }
  finally { $('createInvite').disabled = false; }
};
$('copyInvite').onclick = async () => {
  try { await navigator.clipboard.writeText($('inviteKey').value); $('accountStatus').textContent = '가입 키를 복사했습니다.'; }
  catch { $('inviteKey').select(); $('accountStatus').textContent = '선택된 키를 복사하세요.'; }
};
$('revokeInvite').onclick = async () => {
  if (!invite) return; $('revokeInvite').disabled = true;
  try { await request('invites/revoke', {id:invite.id}); invite=null; $('inviteKey').value=''; $('inviteResult').hidden=true; $('accountStatus').textContent='가입 키를 취소했습니다.'; }
  catch(error) { $('accountStatus').textContent = message(error); }
  finally { $('revokeInvite').disabled=false; }
};
try {
  const status = await request('status'); initialized = status.initialized;
  document.title = status.name || 'moyami'; $('siteName').textContent = status.name || 'moyami';
  if (!status.configured) {
    const needsStorage=status.missing.some(item=>item.includes('Redis'));
    $('authIntro').textContent = needsStorage ? '계정과 읽기 기록을 보관할 저장 공간 연결이 필요합니다. 아래 안내에서 Vercel에 저장 공간을 연결하는 순서를 확인하세요.' : '첫 가입 키가 아직 설정되지 않았습니다. 아래 안내에서 키를 만들고 내 Vercel 프로젝트에 등록하세요.';
    $('setupLink').href='/deploy.html#storage-help';
    $('setupLink').textContent='설정 방법을 단계별로 보기';
    $('setupLink').hidden = false; $('authRetry').hidden = false;
  } else if (status.user) {
    account = status.user; selectAccount(account.id);
    $('accountName').textContent = `${account.username}${account.role === 'admin' ? ' · 관리자' : ''}`;
    $('adminInvites').hidden = account.role !== 'admin';
    await startSync();
    await import('/app.js'); document.body.dataset.auth = 'ready';
  } else {
    registration = !initialized; draw(); $('loginForm').hidden = false; $('authToggle').hidden = false;
    document.body.dataset.auth = 'signed-out';
  }
} catch(error) {
  $('authIntro').textContent = message(error); $('authRetry').hidden = false;
}
