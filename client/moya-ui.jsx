import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { WorkViewControl } from '../vendor/moya-ui/src/components/WorkViewControl';
import { readWorkView, saveWorkView } from '../vendor/moya-ui/src/components/work-view';
import { SourceFilterControl } from '../vendor/moya-ui/src/features/external-sources/SourceFilterControl';
import { SettingsSlider } from '../vendor/moya-ui/src/features/reader-settings/SettingsSlider';
import { SourceReleasePanel } from '../vendor/moya-ui/src/features/external-sources/SourceReleasePanel';
import { SourceReleaseMenu } from '../vendor/moya-ui/src/features/external-sources/SourceReleaseMenu';
import { ReaderSettingsLayout } from '../vendor/moya-ui/src/features/reader-settings/ReaderSettingsLayout';
import { CompatibilityPreferencesPanel } from '../vendor/moya-ui/src/features/extensions/CompatibilityPreferencesPanel';
import { SourceQuickJump } from '../vendor/moya-ui/src/features/discovery/SourceQuickJump';
import { useAutoScroll } from '../vendor/moya-ui/src/features/reader/use-auto-scroll';
import { AutoScrollControls } from '../vendor/moya-ui/src/features/reader/AutoScrollControls';
export { AutoReadingPresentation } from '../vendor/moya-ui/src/features/reader/auto-reading-modes';
export { DEFAULT_READING_PROFILE, normalizeReadingProfile } from '../vendor/moya-ui/src/features/reader-settings/reading-profile';
export { resolveReaderThemeColors } from '../vendor/moya-ui/src/features/reader-settings/reader-theme-colors';
export { BrowserNavigation } from '../vendor/moya-ui/src/features/navigation/browser-navigation';
export * from '../vendor/moya-ui/src/features/fixed-document/comic-layout';
export * from '../vendor/moya-ui/src/features/fixed-document/fixed-document-input';

const roots = new WeakMap();
function render(node, content) {
  let root = roots.get(node);
  if (!root) { root = createRoot(node); roots.set(node, root); }
  flushSync(() => root.render(content));
}

function WorkView({ storageKey, onChange }) {
  const [value, setValue] = useState(() => readWorkView(storageKey));
  return <WorkViewControl value={value} onChange={next => {
    saveWorkView(storageKey, next); setValue(next); onChange(next);
  }} label="탐색 보기 방식" />;
}
export function mountWorkView(node, storageKey, onChange) {
  onChange(readWorkView(storageKey));
  render(node, <WorkView key={storageKey} storageKey={storageKey} onChange={onChange} />);
}

function Filters({ definitions, current, onChange }) {
  const [values, setValues] = useState(current);
  useEffect(() => setValues(current), [current]);
  return <>{definitions.map((definition, index) => {
    const key = `${definition.groupPosition ?? ''}:${definition.position ?? index}`;
    return <SourceFilterControl key={key} definition={definition} compactChoices
      value={values[key]} setValue={value => {
        setValues(previous => ({ ...previous, [key]: value }));
        onChange({ position: definition.position, ...(definition.groupPosition === undefined ? {} : { groupPosition: definition.groupPosition }), value });
      }} />;
  })}</>;
}
export function mountFilters(node, definitions, filters, onChange) {
  const current = Object.fromEntries(filters.map(row => [`${row.groupPosition ?? ''}:${row.position}`, row.value]));
  render(node, <Filters key={JSON.stringify([definitions, current])} definitions={definitions} current={current} onChange={onChange} />);
}
export function mountSliders(node, fields, onChange) {
  render(node, <>{fields.map(field => <SettingsSlider key={field.key} {...field} onChange={value => onChange(field.key, value)} />)}</>);
}
export function mountReleases(node, { sourceKey, workUrl, items, open, actions }) {
  const controller = { activeSourceId: sourceKey, breadcrumbs: [{ parentRef: workUrl }], busy: false, loading: false, ...actions };
  render(node, <SourceReleasePanel key={`${sourceKey}:${workUrl}`} controller={controller} items={items} selectionEnabled={false}
    renderItem={item => <div key={item.key.remoteId} className={`chapter-row is-${item.readingState || 'unread'}`}>
      <button className="chapter" onClick={() => open(item.sourceIndex)}>
        <span className="chapter-title">{item.title}{item.subtitle && <small>{item.subtitle}</small>}</span>
        <small className="chapter-state">{item.readingState === 'current' ? '읽는 중' : item.readingState === 'read' ? '읽음' : '안 읽음'}</small>
      </button><SourceReleaseMenu item={item} controller={controller} />
    </div>} />);
}
export function mountReaderLayout(node, profile, onChange) {
  render(node, <ReaderSettingsLayout profile={profile} updateProfile={onChange} />);
}
let preferenceVisit = 0;
export function mountPreferences(node, pkg, manager) {
  if (!manager) { render(node, null); return; }
  render(node, <CompatibilityPreferencesPanel key={`${pkg}:${++preferenceVisit}`} pkg={pkg} manager={manager} onSaved={() => {}}
    storageNotice="확장 옵션은 이 기기의 브라우저에 저장합니다. 원본 사이트 쿠키는 연결 확장에서 관리합니다." />);
}
export function mountQuickJump(node, options) {
  render(node, options ? <SourceQuickJump {...options} /> : null);
}
function AutoReading({ adapter, scope, kind, nextChapter }) {
  const viewport = useRef(adapter);
  viewport.current = adapter;
  const controller = useAutoScroll(viewport, scope, true, Boolean(adapter), nextChapter, kind);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const button = document.getElementById('readerAuto');
    button.onclick = () => { controller.stop(); setOpen(true); };
    return () => { button.onclick = null; };
  }, [controller]);
  return <AutoScrollControls controller={controller} open={open} onClose={() => setOpen(false)} allowed={Boolean(adapter) && controller.modeAllowed} />;
}
export function mountAutoReading(node, options) {
  render(node, options ? <AutoReading key={options.workKey} {...options} /> : null);
}

// Original text viewports: this boundary adapts source chapters, not the server library.
import { ReaderViewport } from '../vendor/moya-ui/src/features/reader/ReaderViewport';
import { ReaderSelectionToolbar } from '../vendor/moya-ui/src/features/reader/ReaderSelectionToolbar';
import '../vendor/moya-ui/src/styles/reader-shell.css';
import '../vendor/moya-ui/src/styles/reader-content.css';
export { ReaderDecorationStore } from '../vendor/moya-ui/src/features/reader/reader-decoration-store';
export { DEFAULT_GESTURE_BINDINGS, legacyReaderSettings } from '../vendor/moya-ui/src/features/reader-settings/reading-profile';
export { persistentId128 } from '../vendor/moya-ui/packages/text-core/hash';
export function mountNovelViewport(node, props) {
  render(node, props ? <ReaderViewport key={props.chapter.id} {...props} /> : null);
}
export function mountNovelSelection(node, props) {
  render(node, props ? <ReaderSelectionToolbar {...props} /> : null);
}
export { loadUserFont, unloadUserFont } from '../vendor/moya-ui/src/features/reader-settings/user-font-runtime';
export * from '../vendor/moya-ui/src/features/fixed-document/comic-auto-crop';
export * from '../vendor/moya-ui/src/features/fixed-document/viewport-focal-anchor';
export { gestureAction, dispatchReaderAction } from '../vendor/moya-ui/src/features/reader/reader-action-dispatcher';
import { ReaderGestureSettings } from '../vendor/moya-ui/src/features/reader-settings/ReaderGestureSettings';
export function mountReaderGestures(node,bindings,update,ttsEnabled=true) { render(node,bindings?<ReaderGestureSettings bindings={bindings} update={update} ttsEnabled={ttsEnabled}/>:null); }
export { continuousPageNearestViewportCenter } from '../vendor/moya-ui/src/features/fixed-document/continuous-scroll';

// Use Moya's same end-of-chapter gesture policy for comics that scroll the window.
import { useScrollChapterBoundary } from '../vendor/moya-ui/src/features/reader/use-scroll-chapter-boundary';
import { isFixedDocumentInteractiveTarget } from '../vendor/moya-ui/src/features/fixed-document/fixed-document-input';
function ComicScrollBoundary({ content, chapterId, title, ready, onNextChapter }) {
  const rootRef = useRef(document.scrollingElement), contentRef = useRef(content);
  const boundary = useScrollChapterBoundary({rootRef, contentRef, eventRootRef:contentRef, chapterId, enabled:ready, onNextChapter});
  useEffect(() => {
    const blocked = event => document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]') || isFixedDocumentInteractiveTarget(event.target);
    let startY;
    const wheel = event => { if (!blocked(event)) boundary.onWheel(event); };
    const down = event => {
      if (!event.isPrimary || blocked(event)) return;
      startY = event.clientY;
      if (boundary.onPointerDown(event.clientY,event.pointerType)) content.setPointerCapture(event.pointerId);
    };
    const move = event => { if (boundary.onPointerMove(event.clientY,event.pointerType)) event.preventDefault(); };
    const end = event => {
      if (startY !== undefined) boundary.onVerticalGesture(startY-event.clientY,event.pointerType);
      startY=undefined;boundary.onPointerEnd();
    };
    const cancel = () => { startY=undefined;boundary.onPointerEnd(); };
    window.addEventListener('scroll',boundary.onScroll,{passive:true});
    content.addEventListener('wheel',wheel,{passive:false});
    content.addEventListener('pointerdown',down);content.addEventListener('pointermove',move);
    content.addEventListener('pointerup',end);content.addEventListener('pointercancel',cancel);
    return () => {
      window.removeEventListener('scroll',boundary.onScroll);content.removeEventListener('wheel',wheel);
      content.removeEventListener('pointerdown',down);content.removeEventListener('pointermove',move);
      content.removeEventListener('pointerup',end);content.removeEventListener('pointercancel',cancel);
    };
  },[content,boundary.onScroll,boundary.onWheel,boundary.onPointerDown,boundary.onPointerMove,boundary.onVerticalGesture,boundary.onPointerEnd]);
  return <div className={`reader-next-chapter-boundary${boundary.armed?' is-armed':''}`} data-scroll-chapter-boundary="true" data-scroll-chapter-boundary-armed={String(boundary.armed)} aria-live="polite">
    <span>다음 화</span><strong>{title}</strong><small>{boundary.armed?'한 번 더 아래로 스크롤':'마지막까지 읽었습니다'}</small>
  </div>;
}
export function mountComicScrollBoundary(node,options) {
  render(node,options?<ComicScrollBoundary key={options.chapterId} {...options}/>:null);
}
