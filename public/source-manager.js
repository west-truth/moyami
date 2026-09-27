const $ = id => document.getElementById(id);
const button = (label, action, className = 'ghost-btn') => {
  const node = document.createElement('button'); node.type = 'button'; node.className = className; node.textContent = label; node.onclick = action; return node;
};
export function createSourceManager({ repositories, saveRepositories, selected, fetchCatalog, activate, editOptions, pin, pinned, notice, removed }) {
  let catalog, controller, pending = false;
  function tab(name) {
    $('sourceOptions').hidden = true;
    $('managedSources').hidden = name !== 'sources'; $('managedRepositories').hidden = name !== 'repositories';
    $('manageSources').setAttribute('aria-pressed',String(name === 'sources'));
    $('manageRepositories').setAttribute('aria-pressed',String(name === 'repositories'));
  }
  function status(message, loading = false) {
    $('repositoryStatus').textContent = message; $('repositoryStatus').classList.toggle('loading-inline',loading);
  }
  function renderRepositories() {
    const values = repositories(), current = catalog?.repositoryUrl || selected().repositoryUrl;
    $('repositorySelect').replaceChildren(...values.map(value => new Option(new URL(value).hostname,value)));
    $('repositorySelect').value = current;
    $('repositoryCards').replaceChildren();
    values.forEach((url,index) => {
      const row = document.createElement('article'); row.className = 'repository-card';
      const copy = document.createElement('div'), title = document.createElement('strong'), address = document.createElement('small');
      title.textContent = new URL(url).hostname; address.textContent = url;
      copy.append(title,address); row.append(copy,button('소스 보기',() => {tab('sources'); void browse(url);}));
      row.append(button('제거',() => {
        if (!confirm('이 저장소를 목록에서 제거할까요? 읽기 기록과 저장한 설정은 유지됩니다.')) return;
        const remaining = repositories().filter(value => value !== url); saveRepositories(remaining); removed?.(url); renderRepositories();
        if (catalog?.repositoryUrl === url) void browse(remaining[0]);
        notice('저장소 목록에서 제거했습니다.');
      }));
      $('repositoryCards').append(row);
    });
  }
  function draw() {
    $('sourceCards').replaceChildren();
    if (!catalog) { $('sourceCards').textContent = '저장소 주소를 추가한 뒤 사용할 소스를 선택하세요.'; $('addRepository').open = true; return; }
    const query = $('sourceSearch').value.trim().toLocaleLowerCase();
    const sources = catalog.sources.filter(source => source.name.toLocaleLowerCase().includes(query));
    for (const source of sources) {
      const target = {repositoryUrl:catalog.repositoryUrl,sourceId:source.id,sourceName:source.name,itemType:source.itemType};
      const current = selected().repositoryUrl === target.repositoryUrl && selected().sourceId === target.sourceId;
      const row = document.createElement('article'); row.className = `source-card${current ? ' is-selected' : ''}`;
      const copy = document.createElement('div'), title = document.createElement('strong'), meta = document.createElement('small');
      title.textContent = source.name; meta.textContent = `${source.itemType === 2 ? '소설' : '만화'} · ${source.lang || '언어 정보 없음'}${current ? ' · 사용 중' : ''}`;
      copy.append(title,meta); row.append(copy);
      const actions = document.createElement('div'); actions.className = 'source-card-actions';
      actions.append(button('탐색하기',async () => {
        if (pending) return;
        pending = true; draw(); status(`${source.name} 불러오는 중…`,true);
        try { await activate(target); $('settingsDialog').close(); }
        catch (error) { notice(/^[a-z_]+$/.test(error.message) ? '소스를 불러오지 못했습니다. 연결 설정을 확인하고 다시 시도하세요.' : error.message || '소스를 불러오지 못했습니다.'); }
        finally { pending = false; draw(); status(`${catalog.sources.length}개 소스`); }
      },current ? 'primary-btn' : 'ghost-btn'));
      if (current) actions.append(button('옵션',() => {
        $('managedSources').hidden = true; $('sourceOptions').hidden = false;
        $('sourceOptionsTitle').textContent = source.name; editOptions();
      }));
      const pinnedButton = button(pinned(target) ? '고정 해제' : '탭 고정',() => {pin(target);draw();});
      pinnedButton.setAttribute('aria-pressed',String(pinned(target))); actions.append(pinnedButton);
      row.append(actions); row.querySelectorAll('button').forEach(node => {node.disabled = pending;}); $('sourceCards').append(row);
    }
    if (!sources.length) { const empty = document.createElement('p'); empty.textContent = '일치하는 소스가 없습니다.'; $('sourceCards').append(empty); }
  }
  async function browse(url, install = false) {
    controller?.abort();
    if (!url) { catalog = undefined; renderRepositories(); draw(); status('저장소가 없습니다.'); return; }
    const request = new AbortController(); controller = request;
    status('저장소의 소스를 확인하는 중…',true); $('sourceCards').replaceChildren();
    const submit = $('repositoryForm').querySelector('button');
    submit.disabled = true; submit.textContent = '확인 중…';
    try {
      const value = await fetchCatalog(url, request.signal); request.signal.throwIfAborted();
      if (!value.sources?.length) throw new Error('이 저장소에는 지원하는 JS 소스가 없습니다.');
      if (install) {
        const values = repositories();
        if (!values.includes(value.repositoryUrl)) { if (values.length >= 20) throw new Error('저장소는 최대 20개까지 추가할 수 있습니다.'); saveRepositories([...values,value.repositoryUrl]); }
        $('repositoryForm').reset(); $('addRepository').open = false; tab('sources'); notice('저장소를 추가했습니다. 사용할 소스를 선택하세요.');
      }
      catalog = value; renderRepositories(); draw(); status(`${catalog.sources.length}개 소스${catalog.skipped ? ` · 미지원 ${catalog.skipped}개` : ''}`);
    } catch (error) {
      if (error.name === 'AbortError') return;
      status('저장소를 불러오지 못했습니다. 주소와 연결을 확인하세요.');
      $('sourceCards').replaceChildren(button('다시 시도',() => browse(url)));
      notice(/^[a-z_]+$/.test(error.message) ? '저장소를 불러오지 못했습니다. 주소와 연결을 확인하세요.' : error.message || '저장소를 추가하지 못했습니다.');
    } finally {
      if (controller === request) { submit.disabled = false; submit.textContent = '추가하고 소스 확인'; }
    }
  }
  $('manageSources').onclick = () => tab('sources'); $('manageRepositories').onclick = () => { tab('repositories'); renderRepositories(); };
  $('sourceSearch').oninput = draw;
  $('repositorySelect').onchange = () => browse($('repositorySelect').value);
  $('repositoryForm').onsubmit = event => {event.preventDefault(); void browse($('repositoryUrl').value.trim(),true);};
  $('closeSourceOptions').onclick = () => tab('sources');
  return {
    update(value) { controller?.abort(); catalog = value; renderRepositories(); draw(); status(`${catalog.sources.length}개 소스`); },
    open() { tab(repositories().length ? 'sources' : 'repositories'); renderRepositories(); draw(); if (!catalog && repositories().length) void browse(repositories()[0]); },
  };
}
