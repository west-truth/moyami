import { localStorage, indexedDB } from "/account-storage.js";
import {
  mountComicScrollBoundary, DEFAULT_COMIC_READING_PROFILE, buildComicSpreads, comicSpreadForPage, comicSpreadPages,
  fixedDocumentTapStep, handleFixedDocumentKeyDown, isFixedDocumentInteractiveTarget,
  parseFixedDocumentPageDraft, mountSliders, detectComicContentBounds, captureViewportFocalAnchor, focalAnchorScrollDelta, continuousPageNearestViewportCenter, mountReaderGestures, DEFAULT_GESTURE_BINDINGS, gestureAction, dispatchReaderAction,
} from '/moya-ui.js';
import { setImagePriority, flushImageQueue, assignImage, disposeImages } from '/connector-images.js';
const $ = id => document.getElementById(id);
const modes = ['single', 'spread', 'continuous', 'continuous-seamless'];
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

// Source images stay in the connector's bounded cache. This adapter supplies Moya's
// layout and input algorithms with page dimensions instead of an imported archive.
export function createComicReader({ root, total, initial, storageKey, chapterUrl, changed, openChapter, nextChapterTitle }) {
  let saved;
  try { saved = JSON.parse(localStorage.getItem('moya-comic-settings') || localStorage.getItem(storageKey) || '{}'); } catch { saved = {}; }
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) saved = {};
  const profile = { ...DEFAULT_COMIC_READING_PROFILE, ...saved };
  let mode = profile.mode === 'vertical' ? (profile.seamlessVertical ? 'continuous-seamless' : 'continuous') : profile.mode;
  if (!modes.includes(mode)) mode = 'single';
  if (!['ltr', 'rtl'].includes(profile.direction)) profile.direction = 'ltr';
  if (!['page', 'width', 'height', 'original'].includes(profile.fit)) profile.fit = 'page';
  if (!['single', 'pair'].includes(profile.coverBehavior)) profile.coverBehavior = 'single';
  profile.rotation=[0,90,180,270].includes(saved.rotation)?saved.rotation:0;
  const crops=new WeakMap();
  let frame, pinch, pointers=new Map();
  const rows = [...root.querySelectorAll('.page')], hints = new Map();
  const boundaryHost = document.createElement('div');
  boundaryHost.hidden = true;root.append(boundaryHost);
  let current = clamp(initial, 1, total), zoom = clamp(Number(saved.zoom) || 1, .5, 3), disposed = false, pointer, previousMode;
  const bookmarkKey = `${storageKey}:marks:${chapterUrl}`;
  let bookmarks = [];
  try { bookmarks = JSON.parse(localStorage.getItem(bookmarkKey) || '[]').filter(n => Number.isInteger(n) && n > 0 && n <= total).slice(0, 128); } catch {}
  const paged = () => mode === 'single' || mode === 'spread';
  const spreads = () => buildComicSpreads(total, profile, hints);
  function persist() {
    profile.mode = paged() ? mode : 'vertical';
    profile.seamlessVertical = mode === 'continuous-seamless';
    profile.zoom = zoom;
    localStorage.setItem('moya-comic-settings', JSON.stringify(profile));
  }
  function updateMarks() {
    $('pageBookmark').setAttribute('aria-pressed', String(bookmarks.includes(current)));
    $('pageBookmark').setAttribute('aria-label', bookmarks.includes(current) ? '북마크 해제' : '북마크');
    $('pageBookmark').title = $('pageBookmark').getAttribute('aria-label');
    $('comicBookmarks').replaceChildren(new Option('북마크로 이동', ''));
    for (const page of bookmarks) $('comicBookmarks').append(new Option(`${page} 페이지`, String(page)));
    $('comicBookmarks').disabled = bookmarks.length === 0;
  }
  function sizeImages() {
    if (disposed) return;
    const viewport = window.visualViewport;
    if (!viewport || viewport.scale === 1) {
      root.style.setProperty('--comic-viewport-height', `${viewport?.height || innerHeight}px`);
      root.style.setProperty('--comic-viewport-top', `${viewport?.offsetTop || 0}px`);
    }
    const slots = mode === 'spread' && root.dataset.standalone !== 'true' ? 2 : 1;
    const gap = clamp(Number(profile.gap) || 0, 0, 40);
    const width = Math.max(1, (root.clientWidth - gap * (slots - 1)) / slots);
    const height = paged() ? root.clientHeight : Math.max(100, innerHeight);
    for (const row of rows) {
      const image = row.querySelector('img');
      if (!image?.naturalWidth) continue;
      let crop=profile.crop==='manual'?profile.manualCrop:undefined;
      if(profile.crop==='auto') {
        if(!crops.has(image)) {try {const canvas=document.createElement('canvas'),ratio=Math.min(1,512/Math.max(image.naturalWidth,image.naturalHeight));canvas.width=Math.max(4,Math.round(image.naturalWidth*ratio));canvas.height=Math.max(4,Math.round(image.naturalHeight*ratio));const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,canvas.width,canvas.height);crops.set(image,detectComicContentBounds(ctx.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height)||{});}catch{crops.set(image,{});$('comicCropStatus').textContent='이 이미지의 자동 분석은 원본 접근 제한으로 사용할 수 없습니다. 직접 조절할 수 있습니다.';}}
        crop=crops.get(image);
      }
      const c={top:0,right:0,bottom:0,left:0,...crop};
      const originalW=image.naturalWidth,originalH=image.naturalHeight;
      const cw=originalW*(1-c.left-c.right),ch=originalH*(1-c.top-c.bottom),rotated=profile.rotation%180!==0;
      const displayW=rotated?ch:cw,displayH=rotated?cw:ch;
      const widthScale = width / displayW, heightScale = height / displayH;
      const fit = !paged() && profile.fit === 'page' ? 'width' : profile.fit;
      const scale = (fit === 'width' ? widthScale : fit === 'height' ? heightScale : fit === 'original' ? 1 : Math.min(widthScale, heightScale)) * zoom;
      let frame=image.parentElement;
      if(!frame.classList.contains('comic-image-frame')) {frame=document.createElement('div');frame.className='comic-image-frame';image.replaceWith(frame);frame.append(image);}
      frame.style.width=`${displayW*scale}px`;frame.style.height=`${displayH*scale}px`;
      image.style.width=`${originalW*scale}px`;image.style.height=`${originalH*scale}px`;image.style.maxWidth='none';
      image.style.clipPath=`inset(${c.top*100}% ${c.right*100}% ${c.bottom*100}% ${c.left*100}%)`;
      image.style.left='50%';image.style.top='50%';
      image.style.transform=`translate(-50%,-50%) rotate(${profile.rotation}deg) translate(${(c.right-c.left)*originalW*scale/2}px,${(c.bottom-c.top)*originalH*scale/2}px)`;
      const naturalFlow = !paged() && profile.rotation === 0 && !Object.values(c).some(value => value !== 0);
      frame.classList.toggle('natural-flow', naturalFlow);
      if (naturalFlow) {
        frame.style.height='auto'; image.style.height='auto'; image.style.left='0'; image.style.top='0';
        image.style.transform='none'; image.style.clipPath='none';
      }
    }
  }
  function render() {
    if (disposed) return;
    root.classList.toggle('paged', paged());
    root.dataset.comicMode = mode;
    root.dataset.direction = profile.direction;
    root.style.setProperty('--comic-gap', `${mode === 'continuous-seamless' ? 0 : clamp(Number(profile.gap) || 0, 0, 40)}px`);
    root.style.setProperty('--comic-filter', `brightness(${clamp(Number(profile.brightness) || 1, .5, 1.5)}) contrast(${clamp(Number(profile.contrast) || 1, .5, 2)}) saturate(${profile.grayscale ? 0 : clamp(Number(profile.saturation) || 1, 0, 2)}) invert(${profile.invert ? 1 : 0})`);
    let visible = [current - 1];
    root.dataset.standalone = 'false';
    if (mode === 'spread') {
      const all = spreads(), spread = all[comicSpreadForPage(all, current - 1)];
      visible = comicSpreadPages(spread);
      root.dataset.standalone = String(visible.length === 1 && !spread.syntheticBlank);
    }
    for (const [index, row] of rows.entries()) {
      row.classList.toggle('active', visible.includes(index));
      row.style.order = String(visible.indexOf(index));
      const neighbour = visible.some(page => Math.abs(index - page) <= (navigator.connection?.saveData ? 1 : 4));
      setImagePriority(row.querySelector('img'), paged() ? (visible.includes(index) ? 3 : neighbour ? 2 : 0) : undefined);
    }
    flushImageQueue();
    $('comicMode').value = mode;
    $('comicDirection').value = profile.direction;
    $('comicFit').value = profile.fit;
    $('comicCover').value = profile.coverBehavior;
    $('comicRotation').value=String(profile.rotation);$('comicParity').value=profile.pageParity;$('comicCrop').value=profile.crop;$('comicMotion').value=profile.pageTurnMotion;
    $('comicGray').checked = Boolean(profile.grayscale);
    $('comicInvert').checked = Boolean(profile.invert);
    $('readerPage').value = String(current);
    $('readerPage').max = String(total);
    $('readerPageTotal').textContent = String(total);
    $('readerSeek').value = String(current);
    $('readerSeek').max = String(total);
    $('readerSeek').setAttribute('aria-valuetext', `${current} / ${total} 페이지 (${Math.round(current / total * 100)}%)`);
    $('readerZoom').textContent = `${Math.round(zoom * 100)}%`;
    updateMarks(); sizeImages(); changed(current);
    boundaryHost.hidden = paged() || !nextChapterTitle;
    mountComicScrollBoundary(boundaryHost, boundaryHost.hidden ? null : {
      content:root,chapterId:chapterUrl,title:nextChapterTitle,
      // Earlier images can be skipped, fail, or be unloaded by the bounded image cache.
      // Only the final image must settle before a scroll gesture can leave the chapter.
      ready:rows.at(-1)?.dataset.loaded==='true'&&!rows.at(-1).classList.contains('errorPage'),
      onNextChapter:()=>openAdjacentChapter(1),
    });
    if (previousMode !== mode) {
      previousMode = mode;
      queueMicrotask(() => { if (!disposed) dispatchEvent(new Event('moya-reader-layout')); });
    }
  }
  function go(next, scroll = true) {
    const previous=current;current = clamp(next, 1, total); render();
    if(previous!==current&&paged()&&profile.pageTurnMotion!=='none'&&!matchMedia('(prefers-reduced-motion: reduce)').matches)for(const row of rows.filter(r=>r.classList.contains('active')))row.animate(profile.pageTurnMotion==='fade'?[{opacity:.2},{opacity:1}]:[{transform:`translateX(${next>previous?24:-24}px)`,opacity:.5},{transform:'translateX(0)',opacity:1}],{duration:180});
    if (!paged() && scroll) rows[current - 1]?.scrollIntoView({ block: 'start' });
  }
  let chapterOpening = false;
  async function openAdjacentChapter(step) {
    if(disposed || chapterOpening || !openChapter || document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]'))return;
    chapterOpening = true;
    try { await openChapter(step); } finally { chapterOpening = false; }
  }
  function turn(step, allowChapter = true) {
    if (disposed || chapterOpening) return;
    if (!paged()) {
      const scroller = document.scrollingElement;
      const atEdge = step > 0
        ? scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 2
        : scroller.scrollTop <= 2;
      if (atEdge) {
        if (allowChapter) void openAdjacentChapter(step);
      } else {
        window.scrollBy({top:step * Math.max(100, innerHeight * .8),behavior:'instant'});
      }
      return;
    }
    const all = mode === 'spread' ? spreads() : undefined;
    const index = all ? comicSpreadForPage(all,current-1) : current-1;
    const target = index + step, count = all?.length ?? total;
    if (paged() && (target < 0 || target >= count)) {
      if (allowChapter) void openAdjacentChapter(step);
      return;
    }
    if (mode === 'spread') {
      const all = spreads(), next = clamp(comicSpreadForPage(all, current - 1) + step, 0, all.length - 1);
      go(all[next].readingOrder[0] + 1);
    } else go(current + step);
  }
  function immersive() { document.body.classList.toggle('immersive'); sizeImages(); }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { $('activity').textContent = '이 브라우저에서 전체 화면을 사용할 수 없습니다.'; }
  }
  function zoomBy(delta,clientX,clientY) {
    const viewport=paged()?root.getBoundingClientRect():{left:0,top:0,width:innerWidth,height:innerHeight};
    const anchor=captureViewportFocalAnchor({viewport,pages:rows.filter(r=>r.querySelector('img')?.naturalWidth).map((r,i)=>({pageIndex:Number(r.dataset.page)-1,...rect(r.querySelector('.comic-image-frame')||r)})),preferredPageIndex:current-1,clientX,clientY});
    zoom=clamp(zoom+delta,.5,3);persist();render();
    if(anchor){const target=rows[anchor.pageIndex].querySelector('.comic-image-frame');if(target){const delta=focalAnchorScrollDelta(anchor,viewport,target.getBoundingClientRect());(paged()?root:window).scrollBy(delta.left,delta.top);}}
  }
  function rect(node){const r=node.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height};}
  function updateProfile(key, value) { profile[key] = value; persist(); render(); sliders(); }
  function sliders() {
    mountSliders($('comicSliders'), [
      { key: 'brightness', label: '밝기', value: Number(profile.brightness) || 1, min: .5, max: 1.5, step: .05 },
      { key: 'contrast', label: '대비', value: Number(profile.contrast) || 1, min: .5, max: 2, step: .05 },
      { key: 'gap', label: '페이지 간격', value: Number(profile.gap) || 0, min: 0, max: 40, step: 1, suffix: 'px' },
    ], updateProfile);
    $('comicCropSliders').hidden=profile.crop!=='manual';
    mountSliders($('comicCropSliders'),['top','right','bottom','left'].map((key,i)=>({key,label:['위 여백','오른쪽 여백','아래 여백','왼쪽 여백'][i],value:(profile.manualCrop?.[key]||0)*100,min:0,max:30,step:1,suffix:'%'})),(key,value)=>updateProfile('manualCrop',{...profile.manualCrop,[key]:value/100}));
  }
  $('comicMode').onchange = () => { mode = $('comicMode').value; persist(); render(); if (!paged()) go(current); };
  for (const [id, key] of [['comicDirection','direction'],['comicFit','fit'],['comicCover','coverBehavior'],['comicParity','pageParity'],['comicCrop','crop'],['comicMotion','pageTurnMotion']]) $(id).onchange = () => updateProfile(key, $(id).value);
  for (const [id, key] of [['comicGray','grayscale'],['comicInvert','invert']]) $(id).onchange = () => updateProfile(key, $(id).checked);
  $('comicRotation').onchange=()=>updateProfile('rotation',Number($('comicRotation').value));
  $('readerPage').onchange = () => { const value = parseFixedDocumentPageDraft($('readerPage').value, total); if (value !== undefined) go(value + 1); else render(); };
  $('readerSeek').oninput = () => go(Number($('readerSeek').value));
  $('readerZoom').onclick = () => { zoom = 1; persist(); render(); };
  $('readerZoomOut').onclick = () => zoomBy(-.1);
  $('readerZoomIn').onclick = () => zoomBy(.1);
  $('readerFullscreen').onclick = fullscreen;
  $('pageBookmark').onclick = () => {
    bookmarks = bookmarks.includes(current) ? bookmarks.filter(n => n !== current) : [...bookmarks, current].sort((a, b) => a - b).slice(0, 128);
    localStorage.setItem(bookmarkKey, JSON.stringify(bookmarks)); updateMarks();
  };
  $('comicBookmarks').onchange = () => { if ($('comicBookmarks').value) go(Number($('comicBookmarks').value)); };
  const keydown = event => {
    if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return;
    if (!paged() && ['ArrowDown','ArrowUp'].includes(event.key)) {
      if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || isFixedDocumentInteractiveTarget(event.target)) return;
      event.preventDefault();
      turn(event.key === 'ArrowDown' ? 1 : -1, !event.repeat);
      return;
    }
    handleFixedDocumentKeyDown(event, { rtl: profile.direction === 'rtl',
      dismiss: () => { if (!document.body.classList.contains('immersive')) return false; immersive(); return true; },
      turnPage: step => turn(step, !event.repeat), toggleImmersive: immersive, toggleFullscreen: fullscreen, zoomBy });
  };
  let bindings;try{bindings={...DEFAULT_GESTURE_BINDINGS,...JSON.parse(localStorage.getItem('moya-comic-gestures')||'{}')};}catch{bindings={...DEFAULT_GESTURE_BINDINGS};}
  const gestures=()=>mountReaderGestures($('readerGestures'),bindings,patch=>{bindings={...bindings,...patch};localStorage.setItem('moya-comic-gestures',JSON.stringify(bindings));gestures();},false);gestures();
  const dispatch=action=>dispatchReaderAction(profile.direction==='rtl'&&!localStorage.getItem('moya-comic-gestures')?(action==='next_page'?'previous_page':action==='previous_page'?'next_page':action):action,{previousPage:()=>turn(-1),nextPage:()=>turn(1),toggleChrome:immersive,openToc:()=> $('comicThumbnails').click(),openSettings:()=> $('readerSettingsTab').click(),toggleTTS:()=>{}});
  const down = event => {
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(pointers.size===2&&paged()){const [a,b]=[...pointers.values()];pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),zoom};pointer=null;return;}
    if (!event.isPrimary || isFixedDocumentInteractiveTarget(event.target)) return;
    pointer = { x: event.clientX, y: event.clientY,at:performance.now(),left:root.scrollLeft,top:root.scrollTop };
    if(paged())root.setPointerCapture(event.pointerId);
  };
  const up = event => {
    pointers.delete(event.pointerId);if(pinch){if(!pointers.size)pinch=null;pointer=null;return;}
    if (!pointer || !event.isPrimary || isFixedDocumentInteractiveTarget(event.target)) { pointer = null; return; }
    const start=pointer,deltaX = event.clientX - pointer.x, deltaY = event.clientY - pointer.y; pointer = null;
    if (Math.abs(deltaX) > 40 && Math.abs(deltaX) > Math.abs(deltaY) * 1.4 && paged() && zoom === 1) {
      dispatch(bindings[deltaX<0?'swipeLeft':'swipeRight']);return;
    }
    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) > 8 || window.getSelection()?.toString()) return;
    const action=gestureAction({bindings,viewportWidth:innerWidth,startX:start.x,startY:start.y,endX:event.clientX,endY:event.clientY,durationMs:performance.now()-start.at});if(action&&(paged()||action!=='next_page'&&action!=='previous_page'))dispatch(action);
  };
  const move=event=>{
    if(pointers.has(event.pointerId))pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(pinch&&pointers.size===2){const[a,b]=[...pointers.values()];zoomBy(pinch.zoom*Math.hypot(a.x-b.x,a.y-b.y)/pinch.distance-zoom,(a.x+b.x)/2,(a.y+b.y)/2);event.preventDefault();}
    else if(pointer&&paged()&&zoom>1){root.scrollLeft=pointer.left-(event.clientX-pointer.x);root.scrollTop=pointer.top-(event.clientY-pointer.y);}
  };
  const cancelPointer = () => { pointer = null;pointers.clear();pinch=null; };
  const wheel=event=>{if(!paged())return;if(event.ctrlKey){event.preventDefault();zoomBy(event.deltaY<0?.1:-.1,event.clientX,event.clientY);}else if(zoom<=1&&Math.abs(event.deltaY)>20){event.preventDefault();if(!wheel.last||performance.now()-wheel.last>220){turn(event.deltaY>0?1:-1);wheel.last=performance.now();}}};
  const thumbnails=$('comicThumbnailGrid'),dialog=$('comicThumbnailDialog');
  $('comicThumbnails').onclick=()=>{disposeImages(thumbnails);thumbnails.replaceChildren();for(const [index,row] of rows.entries()){const button=document.createElement('button'),image=document.createElement('img'),label=document.createElement('span');button.className='comic-thumbnail';image.alt=`${index+1} 페이지`;image.loading='lazy';assignImage(image,row.dataset.imageUrl);label.textContent=String(index+1);button.append(image,label);button.onclick=()=>{dialog.close();$('settingsDialog').close();go(index+1);};thumbnails.append(button);}dialog.showModal();};
  const closeThumbnails=()=>{disposeImages(thumbnails);thumbnails.replaceChildren();};dialog.addEventListener('close',closeThumbnails);
  function continuousPosition(){if(disposed||paged())return;const index=continuousPageNearestViewportCenter(rows.map((r,i)=>({index:i,start:r.getBoundingClientRect().top+scrollY,size:r.getBoundingClientRect().height})),scrollY,innerHeight);if(index!==undefined&&current!==index+1)go(index+1,false);}
  const scroll=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(continuousPosition);};addEventListener('scroll',scroll,{passive:true});
  const chromeObserver = new ResizeObserver(sizeImages);
  chromeObserver.observe($('appHeader')); chromeObserver.observe(document.querySelector('.reader-bottombar'));
  addEventListener('keydown', keydown);
  addEventListener('resize', sizeImages);
  window.visualViewport?.addEventListener('resize', sizeImages);
  window.visualViewport?.addEventListener('scroll', sizeImages);
  root.addEventListener('pointermove',move);root.addEventListener('wheel',wheel,{passive:false});
  root.addEventListener('pointerdown', down); root.addEventListener('pointerup', up); root.addEventListener('pointercancel', cancelPointer);
  persist(); sliders(); render();
  function settled() {
    const visible = paged() ? rows.filter(row => row.classList.contains('active')) : rows.filter(row => {
      const rect = row.getBoundingClientRect(); return rect.bottom > 0 && rect.top < innerHeight;
    });
    if (visible.some(row => row.classList.contains('errorPage'))) return 'failed';
    return visible.length && visible.every(row => row.querySelector('img')?.naturalWidth > 0) ? 'moving' : 'waiting';
  }
  const autoViewport = {
    get flow() { return paged() ? 'paginated' : 'scroll'; },
    advanceAutoScroll(pixels) {
      const state = settled(); if (state !== 'moving') return state;
      const end = Math.max(0, root.getBoundingClientRect().bottom + scrollY - innerHeight);
      if (scrollY >= end - 1) return 'end';
      scrollTo(0, Math.min(end, scrollY + pixels)); return 'moving';
    },
    advanceAutoReading(mode, amount) {
      if (mode !== 'page-turn' || disposed) return 'failed';
      const state = settled(); if (state !== 'moving') return state;
      const all = spreads();
      if (current >= total || (mode === 'page-turn' && root.dataset.comicMode === 'spread' && comicSpreadForPage(all, current - 1) === all.length - 1)) return 'end';
      if (amount > 0) turn(1); return 'moving';
    },
  };
  return {
    autoViewport,
    get paged() { return paged(); },
    go, refresh: render, observePage: continuousPosition,
    imageLoaded(index, image) { rows[index].dataset.loaded = 'true'; if (image.naturalWidth > image.naturalHeight * 1.2) hints.set(index, {doublePage:true}); render(); },
    dispose() {
      disposed = true;mountComicScrollBoundary(boundaryHost,null);boundaryHost.remove();mountReaderGestures($('readerGestures'),null);cancelAnimationFrame(frame);removeEventListener('scroll',scroll);dialog.close();closeThumbnails();dialog.removeEventListener('close',closeThumbnails);root.removeEventListener('pointermove',move);root.removeEventListener('wheel',wheel); chromeObserver.disconnect();
      removeEventListener('keydown', keydown); removeEventListener('resize', sizeImages);
      window.visualViewport?.removeEventListener('resize', sizeImages);
      window.visualViewport?.removeEventListener('scroll', sizeImages);
      root.removeEventListener('pointerdown', down); root.removeEventListener('pointerup', up); root.removeEventListener('pointercancel', cancelPointer);
    },
  };
}
