import { localStorage, indexedDB } from "/account-storage.js";
import {
  normalizeReadingProfile, resolveReaderThemeColors, mountReaderLayout, isFixedDocumentInteractiveTarget,
  DEFAULT_GESTURE_BINDINGS, legacyReaderSettings, persistentId128, ReaderDecorationStore,
  mountNovelViewport, mountNovelSelection,
  mountReaderGestures,
} from '/moya-ui.js';
import { fonts } from '/reader-fonts.js';
const $ = id => document.getElementById(id);
const readJSON = (key, fallback = {}) => { try { return JSON.parse(localStorage.getItem(key) || 'null') || fallback; } catch { return fallback; } };

// The original Moya viewports receive a chapter repository backed by the validated source text.
export async function createNovelReader({ text, initial, initialAnchor, initialReaderAnchor, workKey, chapterUrl, title, chapterNumber = 1, save, chapters, openChapter, isCurrent = ()=>true }) {
  const root = $('novelText'); root.className = 'source-novel-reader reader-screen';
  const revision = persistentId128('source_chapter', [workKey, chapterUrl, text]);
  const paragraphs = text.split(/\n\s*\n/).map((text,index) => ({id:`${revision}:${index}`,chapterId:chapterUrl,novelId:workKey,index:index+1,text}));
  const offsets=[];let totalCharacters=0;for(const p of paragraphs){offsets.push(totalCharacters);totalCharacters+=p.text.length;}
  const ratioAt=(index,offset,atEnd=false)=>atEnd?1:Math.max(0,Math.min(1,((offsets[index]||0)+(offset||0))/Math.max(1,totalCharacters)));
  const chapter = {id:chapterUrl,novelId:workKey,index:chapterNumber,title:title||'본문',documentSectionId:chapterUrl,paragraphCount:paragraphs.length,textHash:revision};
  const novel = {id:workKey,title,titleFormat:'text',format:'text',totalChapters:chapters?.length||chapterNumber,activeContentRevisionId:revision};
  const overrideKey = `moya-novel-profile:${workKey}`, notesKey = `moya-novel-notes:${workKey}`;
  let perWork = Boolean(localStorage.getItem(overrideKey));
  let profile = normalizeReadingProfile(perWork ? readJSON(overrideKey) : readJSON('moya-novel-settings'));
  const fontFamilies=new Map();
  if(!profile.fontId.startsWith('builtin-'))try {fontFamilies.set(profile.fontId,await fonts.family(profile.fontId));}catch{}
  if(!isCurrent())return null;
  let flow = profile.modeLock === 'paginated' ? 'paginated' : 'scroll', disposed = false, currentApi, lastLocation, pending, searchQuery = '', selection;

  let matches = [], matchIndex = -1, frame, sequence = 0;
  const apiRef = {current:undefined}, decorations = new ReaderDecorationStore();
  let notes = readJSON(notesKey, []); if (!Array.isArray(notes)) notes = [];
  const anchorAt = (index, offset=0) => ({bookId:workKey,contentRevisionId:revision,sectionId:chapterUrl,blockIndex:index,blockId:paragraphs[index]?.id||'',offset});
  const initialIndex = Math.max(0,Math.min(paragraphs.length-1,(initialReaderAnchor?.start?0:initialReaderAnchor?.end?paragraphs.length-1:initialReaderAnchor?.blockIndex) ?? initialAnchor?.paragraph ?? Math.floor((initial||0)*paragraphs.length)));
  const startingAnchor = initialReaderAnchor?.contentRevisionId === revision ? initialReaderAnchor : anchorAt(initialIndex,
    initialReaderAnchor?.end?(paragraphs[initialIndex]?.text.length||0):Math.round((initialAnchor?.fraction||0)*(paragraphs[initialIndex]?.text.length||0)));
  let openRequest = {sequence:++sequence,chapterId:chapterUrl,restore:true,preserveSearch:false,fallbackScrollTop:0,position:{chapterId:chapterUrl,paragraphIndex:startingAnchor.blockIndex+1,paragraphId:startingAnchor.blockId,offsetInParagraph:startingAnchor.offset,chapterProgress:initial||0,scrollTop:0}};
  const savePosition = async value => {
    const readerAnchor=anchorAt(Math.max(0,(value.paragraphIndex||1)-1),value.offsetInParagraph||0);
    await save({ratio:ratioAt(readerAnchor.blockIndex,readerAnchor.offset,value.chapterProgress===1),readerAnchor});
  };
  const repository = {
    getParagraphPage: async (id,page) => id === chapterUrl ? {chapterId:id,pageIndex:page,paragraphs:paragraphs.slice(page*120,(page+1)*120)} : undefined,
    getParagraph: async id => paragraphs.find(p=>p.id===id),
    saveReadingPosition: savePosition,
  };
  const update = location => {
    if (disposed || !location) return;
    lastLocation=location;
    const ratio=ratioAt(Math.max(0,(location.paragraphIndex||1)-1),location.offsetInParagraph,location.progress===1);
    const percent=Math.round(ratio*100);
    $('readerProgress').textContent=`${percent}%`;
    $('readerProgress').setAttribute('aria-label',`읽기 ${percent}% · ${flow==='paginated'?'페이지':'스크롤'}`);
    $('novelSeek').value=String(Math.round(ratio*1000));$('novelSeek').setAttribute('aria-valuetext',`${percent}%`);
  };
  const clearSelection = () => {selection=undefined;getSelection()?.removeAllRanges();mountNovelSelection($('novelSelectionRoot'),null);};
  const refreshNotes = () => {
    decorations.update({segments:[],characters:[],highlights:notes.filter(n=>n.kind==='highlight'&&n.chapterUrl===chapterUrl),reviewSegmentIds:new Set()});
    localStorage.setItem(notesKey,JSON.stringify(notes.slice(-500)));
  };
  function remember(kind, chosen=selection, color='yellow', note='') {
    const anchor=currentApi?.getAnchor();if (!anchor) return;
    const parts=chosen?.parts?.length?chosen.parts:[{paragraphId:chosen?.paragraphId||anchor.blockId,text:chosen?.text||lastLocation?.paragraph?.text||''}];
    for(const part of parts) notes.push({id:crypto.randomUUID(),kind,chapterUrl,chapterTitle:title,paragraphId:part.paragraphId,quote:part.text,color,note,anchor:{...anchor,blockId:part.paragraphId,blockIndex:paragraphs.findIndex(p=>p.id===part.paragraphId)},updatedAt:new Date().toISOString()});
    refreshNotes();clearSelection();
  }
  function speak(value) {
    if (!('speechSynthesis' in window)) { $('notice').hidden=false;$('notice').textContent='이 브라우저는 음성 읽기를 지원하지 않습니다.';return; }
    speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(value);utterance.lang='ko-KR';speechSynthesis.speak(utterance);
  }
  let chapterOpening = false;
  const actions = {
    locationCommitted:()=>{},locationPersistenceFailed:()=>{$('readerProgress').textContent+=' · 위치 저장 실패';},
    openChapter:async (value,opts)=>{
      if(disposed||chapterOpening)return;
      chapterOpening=true;
      try {await currentApi?.flushPosition();if(!disposed)await openChapter?.(value.id,opts?.position?.chapterProgress===1?{end:true}:{start:true});}
      finally {chapterOpening=false;}
    },
    openSettings:()=>$('readerSettingsTab').click(),openAddon:()=>openNotes(),
    toggleTTS:()=>{if(window.speechSynthesis?.speaking){if(speechSynthesis.paused)speechSynthesis.resume();else speechSynthesis.pause();}else $('novelSpeak').click();},selectCorrectionSegment:()=>{},
    previewSelectionTTS:chosen=>speak(chosen.text),
    highlightSelection:async (_location,chosen,color)=>{
      if(color==='remove') {notes=notes.filter(n=>n.kind!=='highlight'||n.chapterUrl!==chapterUrl||!(chosen.parts||[chosen]).some(p=>p.paragraphId===n.paragraphId&&p.text.includes(n.quote)));refreshNotes();}
      else remember('highlight',chosen,color);
    },
    openSelectionNote:chosen=>openNoteEditor(chosen),
  };
  const screenHandle = {decorations,getActions:()=>actions,acknowledgeOpen:seq=>{if(openRequest?.sequence===seq)openRequest=undefined;}};
  const onSelectionChanged = next => {
    if (!root.classList.contains('selecting')) return;
    selection=next;
    mountNovelSelection($('novelSelectionRoot'),next?{selection:next,location:lastLocation,screenHandle,onClear:clearSelection}:null);
  };
  const onApiReady = api => {
    if(disposed)return;currentApi=api;
    if(!api)return;
    dispatchEvent(new Event('moya-reader-layout'));
    const target=pending;
    if(target&&target.flow===api.flow) {
      pending=undefined;
      void api.scrollToAnchor(target.anchor,undefined,target.placement).then(ok=>{if(ok&&!disposed&&currentApi===api){if(target.delta)api.scrollByPixels(target.delta);update(api.getLocation());}});
    }
  };
  function render() {
    if(disposed)return;
    mountNovelViewport(root,{repository,novel,chapter,chapters:chapters||[chapter],settings:{...legacyReaderSettings(profile),readingProfile:profile,gestureBindings:readJSON('moya-reader-gestures',DEFAULT_GESTURE_BINDINGS)},readingFlow:flow,mode:'read',search:{highlightQuery:searchQuery},screenHandle,openRequest,apiRef,onApiReady,onVisualLocation:update,onSelectionChanged,
      onToggleImmersive:immersive,onRevealChrome:()=>{},
      onPageIntent:pageIntent,onScrollIntent:scrollIntent,onDocumentLink:()=>{},
    });
  }
  function switchFlow(next, anchor=currentApi?.getAnchor(), delta=0, placement='contain') {
    if(anchor)pending={flow:next,anchor,delta,placement};
    void currentApi?.flushPosition();flow=next;clearSelection();render();
  }
  async function pageIntent(step) {
    if(root.classList.contains('selecting'))return;
    if(flow==='paginated') {currentApi?.pageJump(step);return;}
    if(profile.modeLock==='scroll') {currentApi?.scrollPageJump(step);return;}
    const api=currentApi,anchor=await api?.getPageTurnAnchor(step);
    if(disposed||api!==currentApi)return;
    switchFlow('paginated',anchor||api?.getAnchor(),0,step<0?'previous-page':'page-start');
  }
  function scrollIntent(delta) {
    if(flow==='scroll')currentApi?.scrollByPixels(delta);
    else if(profile.modeLock==='paginated')currentApi?.pageJump(delta>0?1:-1);
    else switchFlow('scroll',currentApi?.getAnchor(),delta);
  }
  function viewportSize() {
    if(disposed)return;
    const viewport=window.visualViewport;
    if(!viewport||viewport.scale===1) {root.style.setProperty('--text-viewport-height',`${viewport?.height||innerHeight}px`);root.style.setProperty('--text-viewport-top',`${viewport?.offsetTop||0}px`);}
  }
  function apply(patch={}) {
    const anchor=currentApi?.getAnchor();
    profile=normalizeReadingProfile({...profile,...patch});
    localStorage.setItem(perWork?overrideKey:'moya-novel-settings',JSON.stringify(profile));
    const colors=resolveReaderThemeColors(profile);
    const variables={
      'reading-font-family':({'builtin-serif':'var(--font-serif)','builtin-sans':'var(--font-sans)','builtin-mono':'var(--font-mono)'})[profile.fontId]||fontFamilies.get(profile.fontId)||'var(--font-serif)',
      'reading-font-size':`${profile.fontSize}px`,'reading-font-weight':profile.fontWeight,'reading-line-height':profile.lineHeight,
      'reading-letter-spacing':`${profile.letterSpacing}em`,'reading-word-spacing':`${profile.wordSpacing}em`,'reading-paragraph-spacing':`${profile.paragraphSpacing}em`,
      'reading-first-line-indent':`${profile.firstLineIndent}em`,'reading-text-align':profile.textAlign,'reading-font-style':profile.fontStyle,'reading-text-decoration':profile.textDecoration,
      'reading-word-break':profile.lineBreak==='anywhere'?'break-all':profile.lineBreak==='keep_words'?'keep-all':'normal','reading-overflow-wrap':profile.lineBreak==='keep_words'?'break-word':'anywhere',
      'reading-width':`${profile.contentWidth}px`,'reading-margin-x':`${profile.marginX}vw`,'reader-layout-margin-x':`${profile.marginX}vw`,'reading-margin-y':`${profile.marginY}vh`,
      'reading-foreground':colors.foreground,'reading-background':colors.background,'reading-brightness':profile.brightness,
    };
    for(const [key,value]of Object.entries(variables))root.style.setProperty(`--${key}`,String(value));
    root.style.fontSize=`${profile.fontSize}px`;
    $('reader').style.background=colors.background;$('novelFont').value=profile.fontId;$('novelThemeSelect').value=profile.theme;
    $('novelPerWork').checked=perWork;
    $('novelForeground').value=colors.foreground;$('novelBackground').value=colors.background;
    mountReaderLayout($('novelLayout'),profile,apply);
    const next=profile.modeLock==='auto'?flow:profile.modeLock;
    if(next!==flow)switchFlow(next,anchor);else {render();cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(!disposed&&anchor)void currentApi?.scrollToAnchor(anchor);});}
  }
  function immersive() { document.body.classList.toggle('immersive');viewportSize(); }
  async function stepMatch(step) {
    if(!matches.length){$('novelSearchStatus').textContent=searchQuery?'검색 결과 없음':'';return;}
    matchIndex=(matchIndex+step+matches.length)%matches.length;
    const match=matches[matchIndex];
    $('novelSearchStatus').textContent=`${matchIndex+1} / ${matches.length}${matches.length===500?'+':''}`;
    await currentApi?.scrollToAnchor(anchorAt(match.index,match.offset));
  }
  function search() {
    searchQuery=$('novelSearch').value.trim();matches=[];matchIndex=-1;
    if(searchQuery)for(const [index,paragraph]of paragraphs.entries()) {
      let offset=0,found;while(matches.length<500&&(found=paragraph.text.toLocaleLowerCase().indexOf(searchQuery.toLocaleLowerCase(),offset))>=0){matches.push({index,offset:found});offset=found+searchQuery.length;}
    }
    render();void stepMatch(1);
  }
  function openNotes() {
    $('novelNotesList').replaceChildren();
    for(const note of [...notes].reverse()) {
      const row=document.createElement('li'),jump=document.createElement('button'),remove=document.createElement('button');
      jump.className='ghost-btn';jump.textContent=`${note.kind==='bookmark'?'북마크':note.kind==='note'?'메모':'하이라이트'} · ${note.chapterTitle||''} · ${(note.note||note.quote).slice(0,100)}`;

      jump.onclick=()=>{$('novelNotesDialog').close();if(note.chapterUrl===chapterUrl)void currentApi?.scrollToAnchor(note.anchor);else void openChapter?.(note.chapterUrl,note.anchor);};
      remove.className='ghost-btn';remove.textContent='삭제';remove.onclick=()=>{notes=notes.filter(n=>n.id!==note.id);refreshNotes();openNotes();};row.append(jump,remove);$('novelNotesList').append(row);
    }
    $('novelNotesEmpty').hidden=notes.length>0;
    if(!$('novelNotesDialog').open)$('novelNotesDialog').showModal();
  }
  function openNoteEditor(chosen) {
    $('novelNoteQuote').textContent=chosen.text;$('novelNoteText').value='';$('novelNoteDialog').showModal();
    $('novelNoteForm').onsubmit=event=>{event.preventDefault();remember('note',chosen,'yellow',$('novelNoteText').value.trim());$('novelNoteDialog').close();};
  }
  $('novelSelect').onclick=()=>{$('settingsDialog').close();root.classList.toggle('selecting');$('novelSelectionDone').hidden=!root.classList.contains('selecting');$('novelSelect').setAttribute('aria-pressed',String(root.classList.contains('selecting')));clearSelection();};
  $('novelSelectionDone').onclick=()=>{root.classList.remove('selecting');$('novelSelectionDone').hidden=true;$('novelSelect').setAttribute('aria-pressed','false');clearSelection();};
  $('novelBookmark').onclick=()=>{remember('bookmark');$('novelBookmark').textContent='북마크 저장됨';};
  $('novelNotes').onclick=openNotes;
  $('novelPerWork').onchange=()=>{perWork=$('novelPerWork').checked;if(!perWork){localStorage.removeItem(overrideKey);profile=normalizeReadingProfile(readJSON('moya-novel-settings'));}apply();};
  const refreshFonts=async()=>{const list=await fonts.list();if(disposed)return;for(const option of [...$('novelFont').options])if(!option.value.startsWith('builtin-'))option.remove();for(const font of list)$('novelFont').append(new Option(font.name,font.id));$('novelFont').value=profile.fontId;};
  void refreshFonts().catch(()=>{$('novelFontStatus').textContent='글꼴 저장소를 열 수 없습니다.';});
  $('novelFontUpload').onchange=async()=>{try{const id=await fonts.add($('novelFontUpload').files[0]);if(!disposed){await refreshFonts();fontFamilies.set(id,await fonts.family(id));apply({fontId:id});$('novelFontStatus').textContent='이 브라우저에 글꼴을 저장했습니다.';}}catch(error){$('novelFontStatus').textContent=error.message;}$('novelFontUpload').value='';};
  $('novelFontDelete').onclick=async()=>{if(profile.fontId.startsWith('builtin-'))return;try{await fonts.remove(profile.fontId);await refreshFonts();apply({fontId:'builtin-serif'});}catch{$('novelFontStatus').textContent='글꼴을 삭제하지 못했습니다.';}};
  $('novelForeground').oninput=()=>apply({theme:'custom',foreground:$('novelForeground').value});$('novelBackground').oninput=()=>apply({theme:'custom',background:$('novelBackground').value});$('novelColorReset').onclick=()=>apply({theme:'dark',foreground:undefined,background:undefined});
  let speaking=false;
  $('novelSpeak').onclick=()=>{if(speaking){speechSynthesis.cancel();speaking=false;$('novelSpeak').textContent='음성 읽기';return;}if(!('speechSynthesis' in window))return;
    speaking=true;$('novelSpeak').textContent='음성 읽기 중지';$('settingsDialog').close();
    let index=currentApi?.getAnchor()?.blockIndex||0;
    const next=()=>{if(disposed||!speaking)return;if(index>=paragraphs.length){speaking=false;$('novelSpeak').textContent='음성 읽기';return;}const utterance=new SpeechSynthesisUtterance(paragraphs[index].text);utterance.lang='ko-KR';void currentApi?.scrollToAnchor(anchorAt(index++));utterance.onend=next;utterance.onerror=()=>{speaking=false;$('novelSpeak').textContent='음성 읽기';};speechSynthesis.speak(utterance);};next();};
  $('novelSpeak').disabled=!('speechSynthesis' in window);
  const gestures=()=>mountReaderGestures($('readerGestures'),readJSON('moya-reader-gestures',DEFAULT_GESTURE_BINDINGS),patch=>{localStorage.setItem('moya-reader-gestures',JSON.stringify({...readJSON('moya-reader-gestures',DEFAULT_GESTURE_BINDINGS),...patch}));gestures();render();});gestures();
  $('novelFont').onchange=async()=>{const id=$('novelFont').value;try{if(!id.startsWith('builtin-'))fontFamilies.set(id,await fonts.family(id));if(!disposed)apply({fontId:id});}catch{$('novelFontStatus').textContent='글꼴을 불러오지 못했습니다.';}};$('novelThemeSelect').onchange=()=>apply({theme:$('novelThemeSelect').value});
  $('novelFontDown').onclick=()=>apply({fontSize:profile.fontSize-1});$('novelFontUp').onclick=()=>apply({fontSize:profile.fontSize+1});
  $('novelLine').onclick=()=>apply({lineHeight:profile.lineHeight>=2.4?1.6:profile.lineHeight+.2});$('novelTheme').onclick=()=>apply({theme:profile.theme==='dark'?'light':'dark'});
  $('novelSeek').oninput=()=>{const ratio=Number($('novelSeek').value)/1000,target=ratio*totalCharacters;let index=offsets.findLastIndex(offset=>offset<=target);index=Math.max(0,index);void currentApi?.scrollToAnchor(anchorAt(index,Math.floor(target-offsets[index])));};
  $('novelSearchForm').onsubmit=event=>{event.preventDefault();search();};$('novelSearchNext').onclick=()=>void stepMatch(1);$('novelSearchPrevious').onclick=()=>void stepMatch(-1);
  $('novelSearch').value='';$('novelSearchStatus').textContent='';$('novelSelect').setAttribute('aria-pressed','false');$('novelBookmark').textContent='북마크';
  $('readerFullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{}};
  const keydown=event=>{
    if(document.querySelector('dialog[open]')||event.defaultPrevented||event.isComposing||event.ctrlKey||event.metaKey||event.altKey||isFixedDocumentInteractiveTarget(event.target))return;
    const step=['PageDown','ArrowRight',' '].includes(event.key)?1:['PageUp','ArrowLeft'].includes(event.key)?-1:0;
    if(step){event.preventDefault();void pageIntent(step);}
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();scrollIntent(event.key==='ArrowDown'?80:-80);}
    if(event.key.toLowerCase()==='i'||(event.key==='Escape'&&document.body.classList.contains('immersive')))immersive();
  };
  const contextMenu=event=>{if(!root.classList.contains('selecting'))event.preventDefault();};
  const flush=()=>{void currentApi?.flushPosition();};
  const selectionGesture=event=>{if(root.classList.contains('selecting'))event.stopPropagation();};root.addEventListener('pointerup',selectionGesture,true);
  root.addEventListener('contextmenu',contextMenu);addEventListener('keydown',keydown);addEventListener('pagehide',flush);addEventListener('resize',viewportSize);window.visualViewport?.addEventListener('resize',viewportSize);window.visualViewport?.addEventListener('scroll',viewportSize);
  refreshNotes();viewportSize();apply();
  const cleanup=()=>{
    flush();window.speechSynthesis?.cancel();$('novelNotesDialog').close();$('novelNoteDialog').close();disposed=true;cancelAnimationFrame(frame);mountReaderGestures($('readerGestures'),null);mountNovelViewport(root,null);mountNovelSelection($('novelSelectionRoot'),null);
    removeEventListener('keydown',keydown);removeEventListener('pagehide',flush);removeEventListener('resize',viewportSize);window.visualViewport?.removeEventListener('resize',viewportSize);window.visualViewport?.removeEventListener('scroll',viewportSize);root.removeEventListener('contextmenu',contextMenu);
    root.removeEventListener('pointerup',selectionGesture,true);$('novelSelectionDone').hidden=true;
    root.classList.remove('selecting');$('reader').style.background='';
  };
  cleanup.autoViewport={get flow(){return currentApi?.flow||flow;},advanceAutoScroll:pixels=>currentApi?.advanceAutoScroll?.(pixels)||'waiting',advanceAutoReading:(mode,amount)=>currentApi?.advanceAutoReading?.(mode,amount)||'waiting',resetAutoReading:()=>currentApi?.resetAutoReading?.()};
  return cleanup;
}
