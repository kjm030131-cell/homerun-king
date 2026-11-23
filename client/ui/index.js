// [ui] 화면 흐름: 타이틀 → 모드 선택(리얼/캐주얼) → 로비(혼자·방 만들기·방 목록·코드 참가) → 대기실 → 경기(HUD) → 결과
// main.js는 createUI(ctx) 하나만 부르고, 게임 상태는 ctx 게터로만 읽는다. UI는 게임 상태를 바꾸지 않고 서버/Game에 메시지만 보낸다.
import { $, esc, show, isShown, segVal, setSeg, bindSegs, replay } from './dom.js';
import { cfg, store, bindSettings, fillSettings, emitVolume, TOUCH } from './settings.js';
import { banner, feedback, toast, castLine, stopSpeech, clearBanner, gradeFeedback } from './announce.js';
import { RULES } from '../../shared/rules.js';
import { initChat, addChat, sysChat, openChat, closeChat, toggleQuick, sendQuick, quickOpen } from './chat.js';
import { bindRoom, renderRoom, clubGrid, rulesOf, RULES_KO } from './room.js';
import { fillOver, renderTab } from './results.js';
import { refreshCareer, saveLocalCareer } from './career.js';
import { initHUD, hudFrame, myDuty, paintClubs, swingReport, updateCoach, introCard, introHide, walkup, renderPitchBar, resetHUD, onBus, pulseCount, flashScore } from './hud.js';
import { CLUBS, clubOf, emblemURL } from '../emblem.js';
import { bus } from '../core/bus.js';

export { cfg, store, TOUCH, banner, feedback, toast, castLine, addChat, sysChat, myDuty, paintClubs, swingReport, introCard, introHide, walkup, renderPitchBar, saveLocalCareer };

const SCREENS = ['title', 'modes', 'lobby', 'room'];

/* ctx (main.js가 넘김):
   get S / lobby / myId / myName / net / roomCode / local
   setMyName(n), getRole(), myTeam(), nameOf(id), simNow()
   startLocal(name, opts), connect(code, name, pw), leave()   ← 네트워크 정리는 main
   applyQuality(), applyTimeOfDay(tod), applyClubs(cl), setVolume(v), stopReplay(), sound(name), unlockAudio()
   setPitchType(k), setPaused(on), onScreen(sc) */
export function createUI(ctx) {
  const OFFLINE = !!window.HR_OFFLINE;
  let screen = 'title', pendingSettings = null, roomsIv = 0, soloRules = 'real';
  const send = (m) => ctx.net && ctx.net.send(m);

  bindSegs();
  // 버튼 클릭 소리는 사운드 파트가 bus 'ui:click'으로 받음 (UI는 sfx를 직접 부르지 않음)
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('button')) bus.emit('ui:click', {}); }, true);
  initChat((text) => send({ t: 'chat', text }));
  bindSettings({ applyQuality: ctx.applyQuality, setVolume: ctx.setVolume, stopReplay: ctx.stopReplay, stopSpeech });
  bindRoom({ lobby: () => ctx.lobby, myId: () => ctx.myId, send });
  initHUD();
  if (OFFLINE) document.querySelectorAll('.mp').forEach((e) => e.classList.add('hide'));

  // ── 화면 전환 ──
  // [ui] 화면 전환 연출: 중계 화면 전환처럼 비스듬한 띠(남색·실밥 빨강·분필)가 쓸고 지나가며 새 화면이 드러남
  //  setScreen 은 동기 그대로(상태는 즉시 바뀜) — 띠가 이미 화면을 덮은 상태에서 시작해 걷히기만 하므로 로직 영향 없음
  function wipe(kind) {
    const w = $('wipe'); if (!w || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    w.className = ''; void w.offsetWidth; w.className = 'go ' + kind;
    clearTimeout(w._t); w._t = setTimeout(() => { w.className = ''; }, kind === 'game' ? 1300 : 800);
  }
  function enter(id) { const e = $(id); if (!e) return; e.classList.remove('enter'); void e.offsetWidth; e.classList.add('enter'); }
  function setScreen(sc) {
    if (sc === 'browser') sc = 'lobby';
    const prev = screen;
    if (prev !== sc && prev && sc !== 'over' && !(prev === 'over' && sc === 'game')) { wipe(sc === 'game' ? 'game' : 'menu'); if (SCREENS.includes(sc)) enter(sc); }
    screen = sc;
    for (const id of SCREENS) show(id, sc === id);
    show('hud', sc === 'game' || sc === 'over'); show('over', sc === 'over');
    show('touch', TOUCH && sc === 'game');
    document.body.dataset.screen = sc;
    clearInterval(roomsIv);
    if (sc === 'lobby' && !OFFLINE) { loadRooms(); roomsIv = setInterval(() => { if (!document.hidden) loadRooms(true); }, 6000); }
    if (sc !== 'game' && sc !== 'over') { closeModal('menuM'); show('tab', false); clearBanner(); resetHUD(); }
    ctx.onScreen(sc);
    bus.emit('ui:screen', { name: sc }); // [ui] 사운드 파트용
  }
  requestAnimationFrame(() => enter('title'));
  const ui = {
    get screen() { return screen; }, setScreen,
    get quickOpen() { return quickOpen; },
  };

  // ── 모달 ──
  const onClose = { menuM: () => ctx.setPaused(false) };
  function openModal(id) { show(id, true); if (id === 'menuM') ctx.setPaused(true); }
  function closeModal(id) { if (!isShown(id)) return; show(id, false); onClose[id] && onClose[id](); }
  document.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => closeModal(b.closest('.modal').id)));
  document.querySelectorAll('.modal').forEach((m) => m.addEventListener('pointerdown', (e) => { if (e.target === m) closeModal(m.id); }));
  function openSettings() { fillSettings(); openModal('setM'); }
  ui.openModal = openModal; ui.closeModal = closeModal;
  ui.modalOpen = () => !!document.querySelector('.modal:not(.hide)');

  // ── 오류 문구 ──
  function showErr(t) { for (const id of ['err', 'lobbyErr']) $(id).textContent = t || ''; }
  ui.showErr = showErr;

  // ── 타이틀 ──
  $('nick').value = store.get('name', '');
  const urlRoom = new URLSearchParams(location.search).get('room');
  if (urlRoom && !OFFLINE) $('code').value = urlRoom.toUpperCase();
  function getName() {
    const n = $('nick').value.trim();
    if (!n) { showErr('닉네임을 먼저 적어줘'); setScreen('title'); $('nick').focus(); return null; }
    store.set('name', n); ctx.setMyName(n); $('lbName').textContent = n; return n;
  }
  $('bPlay').onclick = () => {
    if (!getName()) return;
    ctx.unlockAudio(); showErr('');
    if (urlRoom && !OFFLINE && /^[A-Z0-9]{4}$/i.test(urlRoom)) { setScreen('lobby'); tryJoin(urlRoom.toUpperCase()); return; } // 초대 링크로 왔으면 바로 그 방
    setScreen('modes');
  };
  $('nick').onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') $('bPlay').click(); };
  for (const id of ['bSettings', 'lbSettings']) $(id).onclick = openSettings;
  for (const id of ['bHelp', 'lbHelp']) $(id).onclick = () => openModal('helpM');

  // ── 모드 선택 ──
  function paintRules() {
    $('lbRules').textContent = RULES_KO[cfg.rules] + ' 모드';
    document.body.dataset.rules = cfg.rules;
    document.querySelectorAll('#modes .mode').forEach((m) => m.classList.toggle('cur', m.dataset.rules === cfg.rules));
  }
  document.querySelectorAll('#modes [data-rules]').forEach((m) => (m.onclick = () => {
    cfg.rules = m.dataset.rules; store.set('rules', cfg.rules); paintRules(); setScreen('lobby');
  }));
  $('mBack').onclick = () => setScreen('title');
  $('lbRules').onclick = () => setScreen('modes');
  $('lbName').onclick = () => setScreen('title');
  $('lbName').textContent = store.get('name', '') || '닉네임';
  paintRules();

  // ── 혼자 하기 ──
  const soloClub = { me: +(store.get('club', 0)) || 0, op: 1 };
  if (soloClub.op === soloClub.me) soloClub.op = (soloClub.me + 1) % CLUBS.length;
  function paintSoloClubs() {
    for (const [k, id] of [['me', 'oClubMe'], ['op', 'oClubOp']]) { const b = $(id); b.querySelector('img').src = emblemURL(soloClub[k], 72); b.querySelector('span').textContent = clubOf(soloClub[k]).name; }
  }
  document.querySelectorAll('[data-solo]').forEach((b) => (b.onclick = () => openClubPicker({ solo: b.dataset.solo })));
  // [ui] 지난번 혼자 하기 설정 기억 (규칙은 모드 선택 화면 값을 따름)
  const oMode = (m) => { $('oInnLbl').textContent = m === 'derby' ? '아웃 수 (×3)' : '이닝'; show('oInnWrap', m !== 'practice'); };
  const oLoad = () => {
    const o = store.get('solo', null);
    setSeg('oRules', cfg.rules); oDefaults(cfg.rules);
    setSeg('oHit', store.get('hitEase', cfg.rules === 'casual' ? 0 : 1)); setSeg('oTod', store.get('tod', 'night'));
    if (o) {
      if (o.mode) setSeg('oMode', o.mode);
      if (o.inn && o.rules === cfg.rules) setSeg('oInn', o.inn);
      if (o.diff != null) setSeg('oDiff', o.diff);
      if (o.team) setSeg('oTeam', o.team);
      if (o.fld) setSeg('oFld', o.fld);
      if (o.pos) $('oPos').value = o.pos;
    }
    oMode(segVal('oMode'));
    paintPreset();
  };
  // 빠른 설정: 누르면 해당 값으로 맞춤 (그대로 '플레이 볼' 누르면 됨)
  const PRESETS = { quick: { mode: 'game', inn: 3 }, full: { mode: 'game', inn: 9 }, derby: { mode: 'derby', inn: 3 }, practice: { mode: 'practice' } };
  function paintPreset() {
    const m = segVal('oMode'), inn = +segVal('oInn');
    document.querySelectorAll('#oPresets button').forEach((b) => { const p = PRESETS[b.dataset.p]; b.classList.toggle('on', p.mode === m && (p.inn == null || p.inn === inn)); });
  }
  document.querySelectorAll('#oPresets button').forEach((b) => (b.onclick = () => {
    const p = PRESETS[b.dataset.p]; setSeg('oMode', p.mode); if (p.inn) setSeg('oInn', p.inn); oMode(p.mode); paintPreset();
    replay(b, 'tap');
  }));
  for (const id of ['oMode', 'oInn']) $(id).addEventListener('click', () => setTimeout(paintPreset, 0));
  $('bSolo').onclick = () => { if (!getName()) return; ctx.unlockAudio(); paintSoloClubs(); oLoad(); openModal('soloM'); };
  $('oMode').addEventListener('change', (e) => oMode(e.detail));
  const oDefaults = (r) => { setSeg('oHit', r === 'casual' ? 0 : 1); setSeg('oInn', RULES[r].innings); };
  $('oRules').addEventListener('change', (e) => oDefaults(e.detail));
  $('oGo').onclick = () => {
    if (!ctx.myName && !getName()) return;
    closeModal('soloM'); ctx.unlockAudio(); showErr('');
    store.set('tod', segVal('oTod')); store.set('hitEase', +segVal('oHit'));
    store.set('solo', { rules: segVal('oRules'), mode: segVal('oMode'), inn: +segVal('oInn'), diff: +segVal('oDiff'), team: segVal('oTeam'), fld: segVal('oFld'), pos: $('oPos').value });
    const rules = soloRules = segVal('oRules') || cfg.rules;
    ctx.startLocal(ctx.myName, { rules, fld: segVal('oFld'), hitEase: +segVal('oHit'), tod: segVal('oTod'), mode: segVal('oMode'), inn: +segVal('oInn'), diff: +segVal('oDiff'), team: segVal('oTeam'), pos: $('oPos').value, clubs: segVal('oTeam') === 'away' ? [soloClub.me, soloClub.op] : [soloClub.op, soloClub.me] });
    setScreen('game');
  };

  // ── 방 만들기 ──
  $('bCreate').onclick = () => { if (!getName()) return; ctx.unlockAudio(); setSeg('cRules', cfg.rules); cDefaults(cfg.rules); $('cName').value = `${ctx.myName}의 방`; setTimeout(cPaint, 0); openModal('createM'); };
  // 규칙을 바꾸면 그 모드 기본값으로 (이닝은 shared/rules.js RULES.innings — 리얼 9, 캐주얼 3)
  const cDefaults = (r) => { setSeg('cHit', r === 'casual' ? 0 : 1); if (segVal('cMode') === 'game') $('cInn').value = String(RULES[r].innings); };
  $('cRules').addEventListener('change', (e) => cDefaults(e.detail));
  $('cMode').addEventListener('change', (e) => { $('cInn').value = e.detail === 'derby' ? '10' : '3'; });
  $('cSize').addEventListener('change', (e) => show('cMaxWrap', e.detail === '0'));
  // [ui] 방 만들기 빠른 설정
  const CPRE = { quick: { mode: 'game', inn: '3', size: '2' }, full: { mode: 'game', inn: '9', size: '3' }, duel: { mode: 'game', inn: '3', size: '1' }, derby: { mode: 'derby', inn: '10', size: '0' } };
  const cPaint = () => document.querySelectorAll('#cPresets button').forEach((b) => { const p = CPRE[b.dataset.p]; b.classList.toggle('on', p.mode === segVal('cMode') && p.inn === $('cInn').value && p.size === segVal('cSize')); });
  document.querySelectorAll('#cPresets button').forEach((b) => (b.onclick = () => {
    const p = CPRE[b.dataset.p]; setSeg('cMode', p.mode); $('cInn').value = p.inn; setSeg('cSize', p.size); show('cMaxWrap', p.size === '0'); cPaint(); replay(b, 'tap');
  }));
  for (const id of ['cMode', 'cSize', 'cInn']) $(id).addEventListener(id === 'cInn' ? 'change' : 'click', () => setTimeout(cPaint, 0));
  $('cGo').onclick = async () => {
    closeModal('createM');
    try {
      const r = await fetch('/api/new', { method: 'POST' }); const j = await r.json();
      const mode = segVal('cMode'), n = +$('cInn').value;
      pendingSettings = { rules: segVal('cRules') || cfg.rules, name: $('cName').value.trim(), mode, innings: mode === 'game' ? Math.min(9, n) : 3, derbyOuts: mode === 'derby' ? n : 10, max: +$('cMax').value, size: +segVal('cSize'), tod: segVal('cTod'), hitEase: +segVal('cHit'), pw: $('cPw').value, pub: segVal('cPub') === '1', timeLim: +segVal('cTime') || 0 };
      enterRoom(j.code);
    } catch { showErr('서버에 연결할 수 없어. 잠시 뒤 다시 해봐'); }
  };

  // ── 코드 참가 · 비밀번호 ──
  $('bJoin').onclick = () => {
    if (!getName()) return;
    const c = $('code').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(c)) return showErr('방 코드는 영문·숫자 4자리야');
    tryJoin(c);
  };
  $('code').onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') $('bJoin').click(); };
  async function tryJoin(code) {
    try {
      const r = await fetch('/api/room/' + code); const j = await r.json();
      if (!j.exists) return showErr(`${code} 방이 없어. 코드를 다시 확인해봐`);
      if (j.locked) return openPw(code);
      enterRoom(code);
    } catch { showErr('서버에 연결할 수 없어. 잠시 뒤 다시 해봐'); }
  }
  let pwCode = null;
  function openPw(code) { pwCode = code; $('pwIn').value = ''; $('pwCode').textContent = code; openModal('pwM'); setTimeout(() => $('pwIn').focus(), 50); }
  ui.openPw = openPw;
  $('pwGo').onclick = () => { closeModal('pwM'); enterRoom(pwCode, $('pwIn').value); };
  $('pwIn').onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') $('pwGo').click(); };
  function enterRoom(code, pw = '') {
    ctx.unlockAudio(); showErr('');
    $('rchat').innerHTML = '';
    ctx.connect(code, ctx.myName, pw);
    history.replaceState(null, '', `?room=${code}`);
    $('rCode').textContent = code;
    setScreen('room');
  }

  // ── 공개 방 목록 ──
  let roomsBusy = false;
  async function loadRooms(quiet) {
    if (roomsBusy) return; roomsBusy = true;
    if (!quiet) $('rlist').innerHTML = '<div class="empty">방 목록 불러오는 중</div>';
    try {
      const r = await fetch('/api/rooms'); const j = await r.json();
      if (screen !== 'lobby') return;
      const rooms = j.rooms || [];
      $('rcount').textContent = rooms.length ? `${rooms.length}개` : '';
      if (!rooms.length) { $('rlist').innerHTML = '<div class="empty"><b>열린 방이 없어</b>왼쪽에서 방을 만들고 친구한테 코드를 보내봐</div>'; return; }
      // 지금 고른 모드의 방을 위로
      rooms.sort((a, b) => (rulesOf(b) === cfg.rules) - (rulesOf(a) === cfg.rules) || (a.phase === 'lobby' ? -1 : 1) - (b.phase === 'lobby' ? -1 : 1));
      $('rlist').innerHTML = rooms.map((x) => {
        const ru = rulesOf(x), wait = x.phase === 'lobby';
        return `<button class="ritem ${wait ? '' : 'live'}" data-code="${esc(x.code)}" data-locked="${x.locked ? 1 : 0}"><span class="rr ${ru}">${RULES_KO[ru]}</span><b>${esc(x.name)}${x.locked ? ' <i class="lock">비밀번호</i>' : ''}</b><span class="tag">${x.mode === 'derby' ? '홈런 더비' : '정규 경기'}</span><span class="tag st">${wait ? '대기 중' : x.mode === 'game' ? `${x.inn}회 진행 중` : '진행 중'}</span><span class="cnt"><b>${x.players}</b>/${x.max}</span></button>`;
      }).join('');
      $('rlist').querySelectorAll('.ritem').forEach((b) => (b.onclick = () => { if (!getName()) return; b.dataset.locked === '1' ? openPw(b.dataset.code) : enterRoom(b.dataset.code); }));
    } catch { if (!quiet) $('rlist').innerHTML = '<div class="empty"><b>방 목록을 불러오지 못했어</b>새로고침을 눌러 다시 해봐</div>'; }
    finally { roomsBusy = false; }
  }
  $('bRefresh').onclick = () => loadRooms();

  // ── 대기실 ──
  $('bCopy').onclick = () => {
    const url = `${location.origin}${location.pathname}?room=${ctx.roomCode}`;
    const done = () => { $('bCopy').textContent = '복사됨'; setTimeout(() => ($('bCopy').textContent = '초대 링크 복사'), 1500); };
    navigator.clipboard?.writeText(url).then(done, () => toast(url));
  };
  $('bLeave').onclick = () => ctx.leave();
  document.querySelectorAll('[data-club]').forEach((b) => (b.onclick = () => openClubPicker({ side: b.dataset.club })));
  function openClubPicker(o) {
    let cur, other, can = true;
    if (o.solo) { cur = soloClub[o.solo]; other = soloClub[o.solo === 'me' ? 'op' : 'me']; $('clubT').textContent = o.solo === 'me' ? '내 구단' : '상대 구단'; }
    else {
      const L = ctx.lobby; if (!L) return;
      const ti = o.side === 'home' ? 1 : 0; cur = L.set.clubs[ti]; other = L.set.clubs[1 - ti];
      can = L.host === ctx.myId || ctx.myTeam() === o.side;
      $('clubT').textContent = `${o.side === 'home' ? '홈' : '원정'}팀 구단`;
    }
    $('clubNote').textContent = can ? '홈런왕 오리지널 구단이야. 실제 프로구단과는 상관없어.' : '그 팀 선수나 방장만 바꿀 수 있어.';
    clubGrid(cur, other, can, (i) => {
      if (o.solo) { soloClub[o.solo] = i; if (o.solo === 'me') store.set('club', i); paintSoloClubs(); }
      else send({ t: 'club', side: o.side, club: i });
      closeModal('clubM');
    });
    openModal('clubM');
  }
  ui.renderLobby = () => {
    const L = ctx.lobby; if (!L) return;
    if (pendingSettings && L.host === ctx.myId) { send({ t: 'set', ...pendingSettings }); pendingSettings = null; }
    const cl = renderRoom(L, ctx.myId, send);
    ctx.applyClubs(cl); ctx.applyTimeOfDay(L.set.tod || 'night');
    show('mLobby', L.host === ctx.myId && !ctx.local);
    if (L.phase === 'lobby' && (screen === 'game' || screen === 'over') && !ctx.local) setScreen('room');
    if (L.phase !== 'lobby' && screen === 'room') setScreen('game');
  };

  // ── 경기 결과 ──
  $('bAgain').onclick = () => send({ t: 'start' });
  $('bToLobby').onclick = () => send({ t: 'lobby' });
  $('bQuit').onclick = () => ctx.leave();
  ui.showOver = (s) => {
    setTimeout(() => career(true), 1500);
    setScreen('over');
    return fillOver(s, { myId: ctx.myId, mySide: ctx.myTeam(), isHost: ctx.local || (ctx.lobby && ctx.lobby.host === ctx.myId), local: ctx.local });
  };
  const career = (force) => refreshCareer(ctx.local, (ctx.lobby?.players || []).map((p) => p.name), force);
  ui.refreshCareer = career;

  // ── 일시정지 메뉴 ──
  $('mSettings').onclick = () => { closeModal('menuM'); openSettings(); };
  $('mHelp').onclick = () => { closeModal('menuM'); openModal('helpM'); };
  $('mLobby').onclick = () => { closeModal('menuM'); send({ t: 'lobby' }); };
  $('mQuit').onclick = () => { closeModal('menuM'); ctx.leave(); };
  function openMenu() {
    $('menuNote').textContent = ctx.local ? '혼자 하기는 메뉴를 여는 동안 경기가 멈춰.' : '멀티 경기는 메뉴를 열어도 계속 진행돼.';
    $('menuT').textContent = ctx.local ? '일시정지' : '메뉴';
    openModal('menuM');
  }

  // ── 키보드 (main.js keydown 맨 앞에서 부름. true = UI가 처리함) ──
  ui.handleKey = (e, k) => {
    if (e.key === 'Escape') {
      for (const id of ['helpM', 'setM', 'clubM', 'pwM', 'soloM', 'createM']) if (isShown(id)) { closeModal(id); return true; }
      if (screen === 'game' || screen === 'over') { isShown('menuM') ? closeModal('menuM') : openMenu(); return true; }
      if (screen === 'modes') { setScreen('title'); return true; }
      return false;
    }
    if (screen !== 'game' && screen !== 'over') return false;
    if (e.key === 'Enter') { openChat(); e.preventDefault(); return true; }
    if (e.key === 'Tab') { e.preventDefault(); show('tab', true); career(); renderTab(ctx.S, ctx.myId); return true; }
    if (k === 'h') { isShown('helpM') ? closeModal('helpM') : openModal('helpM'); return true; }
    if (quickOpen && /^[1-8]$/.test(k)) { sendQuick(+k - 1); return true; }
    if (k === 't') { toggleQuick(); return true; }
    return false;
  };
  ui.handleKeyUp = (e) => { if (e.key === 'Tab') show('tab', false); };
  ui.onBlur = () => show('tab', false);
  ui.closeChat = closeChat;

  // ── 프레임 ──
  ui.frame = (role, f) => {
    const S = ctx.S;
    if (!S || !S.fl || (screen !== 'game' && screen !== 'over')) return;
    hudFrame({ S, simNow: ctx.simNow, local: ctx.local, myId: ctx.myId, myName: ctx.myName, myTeam: ctx.myTeam(), nameOf: ctx.nameOf, setPitchType: ctx.setPitchType, nPlayers: ctx.lobby ? ctx.lobby.players.length : 0, rules: S.ru || (ctx.local ? soloRules : rulesOf(ctx.lobby && ctx.lobby.set)) }, role, f);
    if (screen === 'game') updateCoach(S, role);
  };
  ui.introCard = (kind, s) => introCard(kind, s, { nameOf: ctx.nameOf, myId: ctx.myId, sound: ctx.sound });
  ui.introHide = introHide; // [fix] main.js endIntro 가 부르는데 빠져 있어서 예외 → 프레임 루프가 멈추던(화면 정지) 버그
  ui.walkup = (s) => walkup(s, { nameOf: ctx.nameOf, myId: ctx.myId, sound: ctx.sound });
  ui.renderPitchBar = (pt) => renderPitchBar(pt, true, ctx.setPitchType);

  // ── 게임 이벤트 구독 (REBUILD.md 4-1). 아직 sim이 안 보내면 hud.js가 스냅샷 비교로 같은 연출을 한다 ──
  bus.on('ballCall', () => { onBus('count'); pulseCount('b'); });
  bus.on('strikeCall', () => { onBus('count'); pulseCount('s'); });
  bus.on('out', () => { onBus('count'); pulseCount('o'); });
  bus.on('score', (d) => { onBus('score'); flashScore(d && d.half === 1 ? 'home' : 'away'); }); // half 0 = 초(원정 공격)
  bus.on('contact', (d) => { if (d && d.grade) gradeFeedback(d.grade, d.pow); });
  bus.on('modeChange', () => { resetHUD(); paintRules(); });

  setScreen('title');
  emitVolume(); // 저장된 음량을 사운드 파트에 처음 한 번 알림
  return ui;
}
