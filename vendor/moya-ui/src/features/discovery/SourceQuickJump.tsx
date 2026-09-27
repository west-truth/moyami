import { useRef, useState } from 'react';
import { ArrowRight, Search, Pin } from 'lucide-react';
import { Dialog } from '../../shared/ui/Dialog';
import type { ExternalSourceView } from '../external-sources/useExternalSourceController';
import type { ExternalSourceListInput } from '../../external-sources/contracts';

export function SourceQuickJump({
  sources,
  close,
  open,
  error,
  pinned,
  togglePin,
  saving, repositories, repository, selectRepository, loading, retry,
}: {
  repositories?: readonly string[];
  repository?: string;
  selectRepository?(url: string): void;
  loading?: boolean;
  retry?(): void;
  sources: readonly ExternalSourceView[];
  error?: string;
  saving?: boolean;
  pinned: readonly string[];
  togglePin(source: ExternalSourceView): void;
  close(): void;
  open(source: string, input: ExternalSourceListInput): void | boolean | Promise<void | boolean>;
}) {
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const matches = sources.filter((source) =>
    source.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <Dialog
      open
      title="소스 빠른 이동"
      onClose={close}

      className="discovery-quick-jump"
      closeLabel="빠른 이동 닫기"
    >
      {repositories && <label className="quick-jump-repository">저장소
        <select aria-label="빠른 이동 저장소" value={repository} disabled={saving}
          onChange={event => { setQuery(''); selectRepository?.(event.target.value); }}>
          {repositories.map(url => <option key={url} value={url}>{new URL(url).host + new URL(url).pathname}</option>)}
        </select>
      </label>}
      <label className="discovery-search">
        <Search size={18} aria-hidden="true" />
        <input
          ref={search}
          type="search"
          aria-label="이동할 소스 검색"
          placeholder="소스 이름으로 찾기"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {error && <p role="status">{error} {retry && <button onClick={retry}>다시 시도</button>}</p>}
      {loading && <p role="status"><span className="loading-spinner" aria-hidden="true" /> 소스를 불러오는 중…</p>}
      <div className="discovery-quick-jump-list">
        {matches.map((source) => (
          <div className="discovery-quick-jump-row" key={source.id}>
            <button
              type="button"
              className="ghost-btn"
              disabled={saving || source.connection.state !== 'connected'}
              onClick={async () => {
                if ((await open(source.id, source.kind === 'cloud_file' ? {} : { browseMode: 'popular' })) !== false)
                  close();
              }}
            >
              <span>
                {source.title}
                {source.connection.state !== 'connected' && <small>소스 설정에서 연결해 주세요</small>}
              </span>
              <ArrowRight size={18} aria-hidden="true" />
            </button>
            {source.kind === 'catalog' && (
              <button
                type="button"
                className="ghost-btn discovery-pin"
                disabled={saving}
                aria-label={`${source.title} ${pinned.includes(source.id) ? '고정 해제' : '탭에 고정'}`}
                aria-pressed={pinned.includes(source.id)}
                onClick={() => togglePin(source)}
              >
                <Pin size={18} aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
        {!loading && !error && !matches.length && (
          <p>{sources.length ? '일치하는 소스가 없습니다.' : '콘텐츠 소스 설정에서 소스를 추가해 주세요.'}</p>
        )}
      </div>
    </Dialog>
  );
}
