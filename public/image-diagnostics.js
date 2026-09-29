// Opt-in, in-memory diagnostics. Never retain image addresses, tickets or work names.
let enabled = false, generation = 0, startedAt, counts, rows = [];
const listeners = new Set();
const routes = { direct: '직접 경로', relay: '서버 중계', connector: '연결 확장', cache: '확장 메모리 캐시' };
const reasons = { normal: '일반 요청', required: '중계 경로로 제공됨', disabled: '직접 받기 꺼짐', error: '직접 받기 오류', timeout: '직접 받기 5초 초과', crop: '자동 여백 분석', retry: '이전 중계 경로 재사용' };
const outcomes = { pending: '받는 중', loaded: '완료', failed: '실패', timeout: '시간 초과', cancelled: '취소' };
function notify() { for (const listener of listeners) listener(); }
export function resetImageDiagnostics() {
  generation++; startedAt = new Date().toISOString(); rows = [];
  counts = { direct: 0, relay: 0, connector: 0, cache: 0, pending: 0, failed: 0, cancelled: 0, error: 0, timeout: 0, crop: 0 };
  notify();
}
export function setImageDiagnostics(value) { enabled = Boolean(value); resetImageDiagnostics(); }
export function imageDiagnosticsSnapshot() {
  return { enabled, startedAt: enabled ? startedAt : null, counts: { ...counts }, recent: rows.map(row => ({ ...row })) };
}
export function beginImageDiagnostic(route, reason = 'normal', prefetch = false) {
  if (!enabled || !routes[route]) return () => {};
  const current = generation, start = performance.now();
  const row = { time: new Date().toISOString(), route, reason, prefetch: Boolean(prefetch), outcome: 'pending' };
  rows.unshift(row); rows.length = Math.min(rows.length, 40); counts.pending++;
  if (route === 'relay' && ['error', 'timeout', 'crop'].includes(reason)) counts[reason]++;
  notify();
  return outcome => {
    if (!enabled || current !== generation || row.outcome !== 'pending') return;
    row.outcome = outcome; row.durationMs = Math.round(performance.now() - start); counts.pending--;
    if (outcome === 'loaded') counts[route]++;
    else if (outcome === 'cancelled') counts.cancelled++;
    else counts.failed++;
    notify();
  };
}
resetImageDiagnostics();

export function initializeImageDiagnostics() {
  const toggle = document.getElementById('imageDiagnosticsEnabled');
  const panel = document.getElementById('imageDiagnosticsPanel');
  const summary = document.getElementById('imageDiagnosticsSummary');
  const list = document.getElementById('imageDiagnosticsRecent');
  let frame;
  function draw() {
    frame = undefined; toggle.checked = enabled; panel.hidden = !enabled;
    if (!enabled) { summary.replaceChildren(); list.replaceChildren(); return; }
    const stats = [
      ['직접 경로 완료', counts.direct], ['서버 중계 완료', counts.relay],
      ['연결 확장 완료', counts.connector], ['확장 캐시 재사용', counts.cache],
      ['오류로 중계 전환', counts.error], ['시간 초과로 중계 전환', counts.timeout],
      ['자동 여백 분석 재요청', counts.crop], ['받는 중', counts.pending],
      ['실패·시간 초과', counts.failed], ['취소', counts.cancelled],
    ];
    summary.replaceChildren(...stats.map(([label, value]) => {
      const cell = document.createElement('div'), term = document.createElement('dt'), detail = document.createElement('dd');
      term.textContent = label; detail.textContent = `${value}건`; cell.append(term, detail); return cell;
    }));
    document.getElementById('imageDiagnosticsSince').textContent = `${new Date(startedAt).toLocaleTimeString()}부터 · 최근 요청 최대 40건`;
    list.replaceChildren(...rows.map(row => {
      const item = document.createElement('li');
      item.textContent = `${new Date(row.time).toLocaleTimeString()} · ${routes[row.route]} · ${outcomes[row.outcome]}${row.prefetch ? ' · 미리 받기' : ''} · ${reasons[row.reason]}${row.durationMs === undefined ? '' : ` · ${row.durationMs} ms`}`;
      return item;
    }));
    if (!rows.length) { const item = document.createElement('li'); item.textContent = '진단을 켠 뒤 새로 불러오는 회차 이미지부터 기록합니다.'; list.append(item); }
  }
  function schedule() {
    if (frame === undefined && document.getElementById('settingsDialog').open && !document.getElementById('downloadSettings').hidden) frame = requestAnimationFrame(draw);
  }
  listeners.add(schedule);
  toggle.addEventListener('change', () => { setImageDiagnostics(toggle.checked); draw(); });
  document.getElementById('imageDiagnosticsReset').addEventListener('click', resetImageDiagnostics);
  addEventListener('moya-settings-open', event => { if (event.detail === 'downloads') draw(); });
  draw();
}
