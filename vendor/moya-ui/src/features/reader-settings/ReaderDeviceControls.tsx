import { Lock, MonitorUp, Unlock } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface WakeLockSentinelLike {
  readonly released: boolean;
  release(): Promise<void>;
}

interface OrientationLike {
  lock?: (orientation: 'portrait' | 'landscape') => Promise<void>;
  unlock?: () => void;
}

export function ReaderDeviceControls() {
  const sentinelRef = useRef<WakeLockSentinelLike>();
  const [error, setError] = useState('');
  const [wakeLocked, setWakeLocked] = useState(false);
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>();
  const wakeLockAvailable = Boolean((navigator as Navigator & { wakeLock?: unknown }).wakeLock);
  const orientationApi = screen.orientation as ScreenOrientation & OrientationLike;
  const orientationAvailable = typeof orientationApi.lock === 'function';

  useEffect(
    () => () => {
      void sentinelRef.current?.release();
      orientationApi.unlock?.();
    },
    [orientationApi],
  );

  if (!wakeLockAvailable && !orientationAvailable) return null;

  const toggleWakeLock = async () => {
    if (sentinelRef.current && !sentinelRef.current.released) {
      await sentinelRef.current.release();
      sentinelRef.current = undefined;
      setWakeLocked(false);
      return;
    }
    const wakeLock = (navigator as Navigator & { wakeLock: { request(type: 'screen'): Promise<WakeLockSentinelLike> } })
      .wakeLock;
    sentinelRef.current = await wakeLock.request('screen');
    setWakeLocked(true);
  };

  const setOrientationLock = async (next?: 'portrait' | 'landscape') => {
    if (!next) {
      orientationApi.unlock?.();
      setOrientation(undefined);
      return;
    }
    await orientationApi.lock?.(next);
    setOrientation(next);
  };

  return (
    <section className="reader-settings-group reader-device-settings">
      <h3>화면 유지</h3>{error && <p role="status">{error}</p>}
      <div className="reader-device-controls">
        {wakeLockAvailable && (
          <button
            type="button"
            className={`ghost-btn${wakeLocked ? ' active' : ''}`}
            onClick={() => { setError(''); void toggleWakeLock().catch(() => setError('화면 유지 권한을 사용할 수 없습니다.')); }}
          >
            {wakeLocked ? <Lock size={16} /> : <Unlock size={16} />} 화면 항상 켜기
          </button>
        )}
        {orientationAvailable && (
          <label>
            <MonitorUp size={16} />
            <select
              value={orientation ?? ''}
              onChange={(event) =>
                void setOrientationLock((event.target.value || undefined) as 'portrait' | 'landscape' | undefined).catch(() => setError('이 브라우저에서는 전체 화면에서만 회전을 고정할 수 있거나 지원하지 않습니다.'))
              }
            >
              <option value="">회전 자동</option>
              <option value="portrait">세로 고정</option>
              <option value="landscape">가로 고정</option>
            </select>
          </label>
        )}
      </div>
    </section>
  );
}
