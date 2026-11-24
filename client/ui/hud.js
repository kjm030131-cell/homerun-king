// [ui] 경기 HUD: 스코어버그, 매치업, 역할 안내, 와인드업 신호, 볼카운트, 구종, 게이지, 키 안내, 핑/fps, 스윙 분석, 등장 카드
// 성능: 매 프레임 부르지만 DOM은 값이 바뀔 때만 건드린다(setText/cls 캐시). 바 길이는 transform(scale)로만 → 레이아웃 재계산 없음.
import { $, esc, show, setText, setHTML, cls, style, replay } from './dom.js';
import { cfg, TOUCH } from './settings.js';
import { career, avgStr, eraStr, ipStr } from './career.js';
import { teamColor } from './results.js';
import { clubOf, emblemURL } from '../emblem.js';
import { PITCHES, PITCH_KEYS, POS_KO, WINDUP } from '../../shared/sim.js';
import { pciPath } from '../game/batting.js'; // [gameplay] PCI 모양

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const OF = ['LF', 'CF', 'RF'];

// 와인드업 단계 (sim WINDUP 1.85s 기준, anim pitchK 시간표와 같은 구간)
const CUE = [[0, '셋 포지션'], [0.35, '다리 들기'], [1.25, '정점, 준비'], [1.45, '스트라이드']];
export function initHUD() {
  // 단계 경계 눈금
  const b = $('pcue').querySelector('.pc-b');
  b.insertAdjacentHTML('beforeend', CUE.slice(1).map(([t]) => `<u style="left:${(t / WINDUP * 100).toFixed(1)}%"></u>`).join(''));
}

// ── 수비 중 '지금 내 역할' (서버가 정한 추격자/베이스 커버 기준). 카메라 코드도 k를 쓴다 ──
export function myDuty(s, role) {
  if (s.ph !== 'live' || role.fi < 0) return null;
  if (role.holding) return { k: 'hold', txt: s.rl && OF.includes(role.pos) ? '공 잡았다. R = 커트맨에게 중계 (멀면 Space도 자동 중계)' : '공 잡았다. 송구할 베이스 선택', col: 'var(--turf-t)' };
  if (s.ch === role.fi) return { k: 'chase', txt: '네 타구! 주황 원 쪽으로 가서 잡아', col: 'var(--bulb)' };
  if (s.rl && s.rl[0] === role.fi) return { k: 'relay', txt: `중계! 파란 원에서 외야 송구 받고 ${s.rl[3] === 4 ? '홈' : s.rl[3] + '루'}로`, col: 'var(--sky)' };
  const cv = s.cv || [], bi = cv.indexOf(role.fi);
  if (bi >= 0) return { k: 'cover', base: bi, txt: `${['1루', '2루', '3루', '홈'][bi]} 커버! 베이스로 가서 송구 받기`, col: 'var(--sky)' };
  return { k: 'idle', txt: role.pos === 'P' ? '투수는 대기, 다른 야수가 처리 중' : '대기, 다른 야수가 처리 중', col: 'var(--steel)' };
}

// ── 구단 → 스코어버그 엠블럼·띠 색 ──
let clubsKey = '';
export function paintClubs(cl) {
  if (!cl) return; const k = cl.join(','); if (k === clubsKey) return; clubsKey = k;
  $('bEmA').src = emblemURL(cl[0], 48); $('bEmH').src = emblemURL(cl[1], 48);
  $('trA').style.setProperty('--tc', teamColor(cl[0])); $('trH').style.setProperty('--tc', teamColor(cl[1]));
}

// ── 이벤트 버스 연결 (gameplay가 sim에 이벤트를 넣으면 자동으로 이쪽이 쓰임, 없으면 스냅샷 비교로 대신) ──
const busOn = {};
export function onBus(kind) { busOn[kind] = true; }
export function pulseCount(which) { // which: 'b' | 's' | 'o'
  replay(document.querySelector(`#bug .dots.${which}`), 'pulse');
  const bc = document.querySelector(`#bigcount .bc-${which}`); if (bc) replay(bc, 'pulse');
}
export function flashScore(side) { replay(side === 'home' ? 'trH' : 'trA', 'flash'); }

// ── 프레임마다 ──
let slowKey = '', pingT = 0, prevCnt = null, prevSc = null;
export function hudFrame(c, role, f) {
  const s = c.S;
  const pitchPhase = s.ph === 'pitch' || s.ph === 'pitching';
  const t = c.simNow();
  const derby = s.mode === 'derby';

  // 투구 시계 (투수)
  const clockOn = s.ph === 'pitch' && role.pitcher && s.dl != null;
  show('clock', clockOn);
  if (clockOn) { const v = Math.max(0, Math.ceil(s.dl)); setText('clock', v); cls('clock', 'warn', v <= 5); }

  // 와인드업 신호 (타자): 셋 → 다리 들기 → 정점 → 스트라이드 → 온다
  let cueOn = false;
  if (role.batter && s.ph === 'pitching' && s.p && !derby) {
    const p = s.p, tau = t - (p.t0 - WINDUP);
    if (tau >= 0 && t < p.t0 + 0.3) {
      cueOn = true;
      const go = t >= p.t0;
      cls('pcue', 'go', go);
      let lab = CUE[0][1]; for (const [k, l] of CUE) if (tau >= k) lab = l;
      setText($('pcue').firstElementChild, go ? '온다!' : lab);
      style($('pcue').querySelector('i'), 'transform', `scaleX(${Math.min(1, tau / WINDUP).toFixed(3)})`);
    }
  }
  show('pcue', cueOn);

  // 큰 볼카운트 (타석/투구 중)
  const bigOn = (role.batter || role.pitcher) && pitchPhase && s.cnt && !derby;
  show('bigcount', bigOn);
  if (bigOn) { setDots('bigcount', s.cnt); cls('bigcount', 'pit', !!role.pitcher); } // [bugs] 투수일 땐 왼쪽으로 — 오른쪽 구종 바와 겹쳐 S·O 가 가려졌음(창 높이 800 이하)

  // 구종 표시: 쉬움은 던지자마자, 그 외엔 공이 지나간 뒤 (학습용)
  let pt = '';
  if (role.batter && s.p && PITCHES[s.p.type] && !derby && (s.ph === 'pitching' || s.ph === 'result')) {
    const early = (s.he ?? 1) === 0;
    if ((early && t >= s.p.t0 + 0.08) || t >= s.p.arrive + 0.15) pt = `<i style="background:${PITCHES[s.p.type].col}"></i>${PITCHES[s.p.type].name}<b>${s.p.kmh}</b><small>km/h</small>`;
  }
  show('ptype', !!pt); if (pt) setHTML('ptype', pt);

  // 타격 모드 태그 · 번트 버튼
  show('modeTag', f.aimOn && f.swingMode !== 'contact');
  if (f.aimOn) { $('modeTag').className = f.swingMode; setText('modeTag', f.swingMode === 'bunt' ? '번트' : '강타'); }
  const showBunt = role.batter && pitchPhase && !derby;
  show('buntBtn', showBunt);
  if (showBunt) { cls('buntBtn', 'on', f.bunt); setHTML('buntBtn', f.bunt ? '<span class="kbd">B</span>번트 해제' : '<span class="kbd">B</span>번트 자세'); }

  // 투구 게이지
  const gOn = !!f.gauge && role.pitcher;
  show('gauge', gOn); show('gaugeLbl', gOn);
  if (gOn) {
    style($('gauge').querySelector('.fill'), 'transform', `scaleY(${clamp(f.gauge.lv / 1.15, 0, 1).toFixed(3)})`);
    if (f.gauge.band) { const [b0, b1] = f.gauge.band; style($('gauge').querySelector('.band'), 'bottom', `${(b0 / 1.15 * 100).toFixed(1)}%`); style($('gauge').querySelector('.band'), 'height', `${((b1 - b0) / 1.15 * 100).toFixed(1)}%`); } // 모드별 퍼펙트 구간
    setText('gaugeLbl', `${Math.round(PITCHES[f.gauge.type].v * (0.86 + 0.15 * Math.min(1, f.gauge.lv)))}km`);
  }
  show('pitchbar', role.pitcher && s.ph === 'pitch' && !f.gauge);
  if (role.pitcher && s.ph === 'pitch') renderPitchBar(f.pitchType, false, c.setPitchType, s.sq);

  // 화면 키 버튼 (송구 베이스 · 주루)
  let keysHtml = '', soft = false;
  if (s.ph === 'live' && role.holding) keysHtml = [['1', '1루'], ['2', '2루'], ['3', '3루'], ['4', '홈'], ['F', '투수']].map(([k, l]) => `<button data-k="${k.toLowerCase()}"><span class="kbd">${k}</span>${l}</button>`).join('');
  else if (role.offense && s.ph === 'live') { keysHtml = '<button data-k="e"><span class="kbd">E</span>추가 진루</button><button data-k="q"><span class="kbd">Q</span>귀루</button>'; soft = true; }
  else if (role.offense && s.ph === 'pitch' && (s.rn || []).length && !role.batter) { keysHtml = '<button data-k="r"><span class="kbd">R</span>도루</button>'; soft = true; }
  const kb = $('keys');
  if (kb._h !== keysHtml) {
    kb._h = keysHtml; kb.innerHTML = keysHtml;
    kb.querySelectorAll('button').forEach((b) => (b.onpointerdown = (e) => { e.stopPropagation(); dispatchEvent(new KeyboardEvent('keydown', { key: b.dataset.k })); }));
  }
  cls(kb, 'soft', soft);
  show(kb, !!keysHtml && !(role.pitcher && s.ph === 'pitch'));

  // 송구 세기 바
  show('tbar', f.throwPow != null);
  if (f.throwPow != null) style($('tbar').querySelector('i'), 'transform', `scaleX(${f.throwPow.toFixed(3)})`);

  // 타구 정보
  const hiOn = !!(s.lh && (s.ph === 'live' || s.ph === 'result') && s.p && s.lh.id === s.p.id && s.p.res === 'hit');
  // [hud 11-24] 홈런이면 작은 타구 정보 대신 왼쪽에서 밀려 들어오는 홈런 패널
  const hrOn = !!(hiOn && s.hr && s.hr.id && s.ph === 'result' && s.msg && /홈런/.test(s.msg[1]));
  cls('hitinfo', 'show', hiOn && !hrOn);
  cls('hrCard', 'show', hrOn);
  if (hrOn) { setText('hrEv', s.lh.ev); setText('hrLa', s.lh.la); setText('hrD', s.hr.dist); }
  if (hiOn) {
    setText('hiEv', s.lh.ev); setText('hiLa', s.lh.la);
    setText('hiD', hrOn ? s.hr.dist : f.ballDist != null ? Math.round(f.ballDist) : '-');
  }

  // 핑 · fps (0.5초마다)
  const now = performance.now();
  if (now - pingT > 500) {
    pingT = now;
    const fc = (v) => (v >= 50 ? 'ok' : v >= 35 ? 'mid' : 'bad'), pc = (ms) => (ms < 80 ? 'ok' : ms < 160 ? 'mid' : 'bad');
    let h = cfg.fps && f.fps ? `<span class="${fc(f.fps)}">${f.fps}<small>fps</small></span>` : '';
    if (!c.local) {
      h += `<span class="${pc(f.rtt)}">${f.rtt}<small>ms 내 핑</small></span>` + (f.jit > 0.05 ? '<span class="bad">연결 불안정</span>' : '');
      const others = (f.pgList || []).filter((x) => x[0] !== c.myName);
      if (others.length) h += '<div>' + others.map((x) => `<span class="${pc(x[1])}">${esc(x[0])} ${x[1]}</span>`).join('') + '</div>';
    }
    setHTML('ping', h);
  }

  // 볼카운트·점수 변화 연출 (버스 이벤트가 오면 그쪽이 담당)
  if (s.cnt) {
    if (prevCnt && !busOn.count) {
      if (s.cnt[0] > prevCnt[0]) pulseCount('b');
      if (s.cnt[1] > prevCnt[1]) pulseCount('s');
      if (s.cnt[2] > prevCnt[2]) pulseCount('o');
    }
    prevCnt = s.cnt;
  }
  if (s.sc) {
    if (prevSc && !busOn.score) { if (s.sc[0] > prevSc[0]) flashScore('away'); if (s.sc[1] > prevSc[1]) flashScore('home'); }
    prevSc = s.sc;
  }

  // [guess] 구종 예측 패널 (타석·투구 전)
  { const on = role.batter && s.mode === 'game' && (s.ph === 'pitch' || s.ph === 'pitching');
    show('guessBox', on);
    if (on && $('guessBox')._g !== (s.gs || '')) { $('guessBox')._g = s.gs || ''; $('guessBox').querySelectorAll('[data-g]').forEach((b) => b.classList.toggle('on', b.dataset.g === s.gs)); } }
  // [ABS 챌린지] 주심 콜 직후 3초: 손해 본 팀에게 'C · ABS 챌린지' (남은 횟수·시간 막대)
  { const ch = s.ch2, myT = role.offense ? s.bt : role.defense ? (s.bt === 'home' ? 'away' : 'home') : null;
    const on = !!(ch && !ch[4] && ch[5] > 0 && myT === ch[2] && ch[3] > 0.05 && (!ch[6] || ch[6].includes(c.myId))) && !$('absRev').classList.contains('show');
    show('chalBar', on);
    if (on) { setHTML('chalTxt', `주심 <b>${ch[1] ? '스트라이크' : '볼'}</b> · 억울하면 <span class="kbd">C</span> ABS 챌린지 <small>남은 ${ch[5]}회</small>`); style($('chalBar').querySelector('i'), 'transform', `scaleX(${clamp(ch[3] / 3.2, 0, 1).toFixed(3)})`); }
    const cl = s.cl2; if (cl && myT) setText('chalLeft', `챌린지 ${cl[myT === 'away' ? 0 : 1]}`); }
  // ── 이하 값이 바뀔 때만 ──
  const dy = s.dy, bat = s.bat || {};
  const key = `${s.sc}|${s.inn}|${s.half}|${s.cnt}|${s.occ}|${bat.id}|${bat.name}|${bat.n}|${s.bt}|${role.pos}|${role.batter}|${role.pitcher}|${s.ph}|${role.holding}|${role.offense}|${role.fi}|${s.tn}|${s.sta}|${s.pc}|${dy ? [dy.sw, dy.xh, dy.idx, dy.outs, dy.pp, dy.list[dy.idx]?.[2]] : ''}|${c.nPlayers}|${s.mode}|${f.bunt}|${s.ch}|${s.cv}|${s.rl}|${f.landChase}|${s.fc}|${c.rules}|${s.cl}`;
  if (key === slowKey) return;
  slowKey = key;
  paintClubs(s.cl);
  const bugName = (i) => (s.cl && s.tn[i] === clubOf(s.cl[i]).name ? clubOf(s.cl[i]).short : s.tn[i]);
  setText('nA', bugName(0)); setText('nH', bugName(1));
  setText('sA', s.sc[0]); setText('sH', s.sc[1]);
  cls('trA', 'bat', s.bt === 'away'); cls('trH', 'bat', s.bt === 'home');
  setText('half', s.half === 0 ? '초' : '말'); cls('bugInn', 'bot', s.half !== 0);
  setText('innN', s.inn);
  ['d1', 'd2', 'd3'].forEach((id, i) => cls(id, 'on', s.occ && s.occ[i]));
  setDots('bug', s.cnt);
  setText('bugRules', c.rules === 'casual' ? '캐주얼' : '리얼'); cls('bugRules', 'casual', c.rules === 'casual');
  // [physics] 바람: 화면 위 = 중견수 쪽, 왼쪽 = 좌익수 쪽(+x). 외야로 불면 뜬공이 더 뻗음
  const wd = s.wd || [0, 0], wsp = Math.hypot(wd[0], wd[1]);
  show('muW', !derby);
  if (!derby && $('muW')._k !== wd.join()) {
    $('muW')._k = wd.join();
    const out = wd[1] / (wsp || 1);
    setText('windTxt', wsp < 0.5 ? '무풍' : out > 0.55 ? (wsp >= 2 ? '외야로 (타자 유리)' : '외야로') : out < -0.55 ? (wsp >= 2 ? '홈 쪽으로 (투수 유리)' : '홈 쪽으로') : wd[0] > 0 ? '우→좌' : '좌→우');
    setText('windSp', wsp < 0.5 ? '' : `${wsp.toFixed(1)}m/s`);
    style($('windArr'), 'transform', `rotate(${(Math.atan2(-wd[0], wd[1]) * 180 / Math.PI).toFixed(0)}deg)`);
    style($('windArr'), 'visibility', wsp < 0.5 ? 'hidden' : 'visible');
  }
  // 매치업
  setText('muBat', bat.name || '-');
  if (derby && dy) {
    const cur = dy.list[dy.idx];
    setText('muBatS', dy.pr ? `연습 ${dy.sw}타구 · 홈런 ${cur ? cur[2] : 0} · 평균 예상타율 ${dy.sw ? (dy.xh / dy.sw).toFixed(3).slice(1) : '-'}` : cur ? `홈런 ${cur[2]} · 아웃 ${dy.outs}/${dy.n}` : '');
    show('muP', false);
  } else {
    const myst = (s.st || []).find((r) => bat && ((r[0] && r[0] === bat.id) || (!r[0] && r[1] === bat.name)));
    setText('muBatS', myst ? `${myst[3] - myst[9]}타수 ${myst[4]}안타${myst[5] ? ' ' + myst[5] + '홈런' : ''}` : '첫 타석');
    show('muP', true);
    const pf = s.fl.find((x) => x[0] === 'P');
    setText('muPit', (pf && c.nameOf(pf[4])) || (pf && pf[4] === c.myId ? c.myName : 'CPU'));
    style('staBar', 'transform', `scaleX(${((s.sta ?? 100) / 100).toFixed(2)})`);
    cls('staBar', 'low', (s.sta ?? 100) < 35);
    setText('muPc', `${s.pc || 0}구`);
  }
  // 내 역할
  const team = c.myTeam;
  let r = '관전 중', sub = '';
  if (team && team !== 'spec') {
    sub = derby ? (dy && dy.pr ? '타격 연습' : '홈런 더비') : `${s.tn[team === 'away' ? 0 : 1]} ${role.offense ? '공격' : '수비'}`;
    if (role.batter) r = '타석';
    else if (role.pos) r = POS_KO[role.pos];
    else if (role.offense) r = '공격 대기';
    else r = derby ? '대기' : '수비 (CPU 담당)';
  }
  setHTML('role', `<b>${esc(r)}</b><small>${esc(sub)}</small>`);
  cls('role', 'off', role.offense); cls('role', 'def', role.defense);
  // 수비 역할 안내
  const du = myDuty(s, role), el = $('duty');
  const dh = du ? `<span style="color:${du.col}">${esc(du.txt)}</span>` : '';
  if (el._h !== dh) { el._h = dh; el.innerHTML = dh; if (du && du.k !== 'idle' && du.k !== el._k) replay(el, 'pop'); el._k = du ? du.k : ''; }
  show(el, !!du);
  // 조작 안내: 역할 이름 + 키 칩 + 상황 팁
  let keysL = [], tip = '', title = '';
  const runnersOn = (s.occ || []).some(Boolean);
  if (s.mo && role.batter && pitchPhase) { // [motion] 모션 경기: 핸드폰·웹캠 안내
    title = '모션 타격'; keysL = [['배트 끝 기울이기', '조준'], ['휘두르기', '스윙'], ['세게', '강타'], ['멈추기', '체크스윙'], ['V', '시점']];
    tip = '배트 끝을 기울여 커서를 공 오는 곳에 맞추고, 공이 오는 순간 휘둘러';
  } else if (s.mo && role.pitcher && s.ph === 'pitch') {
    title = '모션 투구'; keysL = [['핸드폰 존 끌기', '조준'], ['손 떼기', '조준 고정'], ['팔 휘두르기', '투구 (세기 = 구속)']];
  } else if (role.batter && pitchPhase) {
    title = f.bunt ? '번트' : '타격';
    keysL = f.bunt ? [['클릭', '번트 대기'], ['마우스 좌우', '방향'], ['B', '강공 전환']]
      : [['마우스', 'PCI 커서'], ['좌클릭', '정타'], ['우클릭 · F', '강타(잘 뜸)'], ['공이 커서 위쪽', '뜬공 · 아래쪽은 땅볼'], ...(dy && dy.pr ? [['1~6', `구종 고정${dy.pp && dy.pp !== 'MIX' && PITCHES[dy.pp] ? '(' + PITCHES[dy.pp].name + ')' : ''}`], ['0', '섞어서']] : derby ? [] : [['B', '번트']]), ['V', '시점']];
    tip = f.bunt ? '' : '타이밍이 먼저. 커서 테두리가 초록일 때 스윙하면 커서가 조금 빗나가도 맞아';
  } else if (role.pitcher && s.ph === 'pitch') {
    title = '투구'; keysL = [['1~6', '구종'], ['마우스', '코스'], ['클릭', '게이지 시작'], ['클릭', '초록에서 투구']];
    if (runnersOn) keysL.push(['Q', '견제']);
  } else if (role.pos && s.ph === 'live') {
    title = POS_KO[role.pos] || '수비';
    keysL = role.holding ? [['Space', '추천 베이스(금색) 송구'], ['1 2 3 4', '베이스 지정'], ...(OF.includes(role.pos) ? [['R', '중계(커트맨)']] : []), ['꾹 누르기', '강송구']]
      : [['WASD', '이동'], ['Shift', '질주'], ['Space', '점프'], ['C', '다이빙'], ...(s.fc === 'auto' ? [['Q', '선수 전환']] : []), ['드래그', '시점 회전'], ['V', '시점']];
    tip = role.holding ? '' : f.landChase ? '주황 원(낙구 지점)에 들어가면 초록, 자동으로 잡아요' : '가만히 있으면 CPU가 알아서 이동, 키 누르면 직접 조작';
  } else if (role.pos && pitchPhase) {
    title = POS_KO[role.pos] || '수비';
    keysL = role.pos === 'C' ? [] : [['WASD', '수비 위치 이동'], ['드래그', '시점 회전'], ['V', '시점']];
    tip = role.pos === 'C' ? '포수, 투수 공 받는 중' : '';
  } else if (role.offense && s.ph === 'live') { title = '주루'; keysL = [['E', '추가 진루'], ['Q', '귀루'], ['Space', '슬라이딩']]; tip = '베이스 앞 4m 안에서 Space = 슬라이딩'; }
  else if (role.offense) { title = '공격 대기'; keysL = [['R', '도루'], ['T', '빠른 채팅'], ['Tab', '기록']]; tip = runnersOn ? '도루는 투구 직전에. 너무 일찍 누르면 견제당해요' : ''; }
  else keysL = [['Tab', '기록'], ['T', '빠른 채팅'], ['Esc', '메뉴']];
  if (TOUCH) keysL = []; // 터치 기기는 화면 버튼으로
  setHTML('hint', (title ? `<b class="ht">${title}</b>` : '') + keysL.map(([k, l]) => `<span class="hk"><span class="kbd">${k}</span>${l}</span>`).join('') + (tip ? `<span class="tip">${tip}</span>` : ''));
  show('hint', !!(title || keysL.length || tip));
}
function setDots(root, cnt) {
  const r = $(root), k = String(cnt);
  if (r._cnt === k) return; r._cnt = k;
  for (const [sel, n] of [['b', cnt[0]], ['s', cnt[1]], ['o', cnt[2]]]) r.querySelectorAll(`.${root === 'bug' ? 'dots.' : 'bc-'}${sel} i`).forEach((e, i) => e.classList.toggle('on', i < n));
}

// ── 구종 선택 막대 ──
// sq: 이번 타석 최근 구종(스냅샷 S.sq, 오래된 것 → 최근). 같은 공을 연달아 던졌으면 그 구종에 '연속 n' 표시 (리얼은 타자가 익숙해짐)
let lastSq = [];
export function renderPitchBar(pitchType, force, onPick, sq) {
  const bar = $('pitchbar');
  if (sq !== undefined) lastSq = sq || [];
  const key = pitchType + '|' + lastSq.join(',');
  if (!force && bar._k === key) return;
  bar._k = key;
  let run = 0; const lastT = lastSq[lastSq.length - 1];
  for (let i = lastSq.length - 1; i >= 0 && lastSq[i] === lastT; i--) run++;
  bar.innerHTML = (lastSq.length ? `<div class="sq">이번 타석 ${lastSq.map((k) => `<i class="pc" style="background:${PITCHES[k] ? PITCHES[k].col : '#888'}" title="${PITCHES[k] ? PITCHES[k].name : k}"></i>`).join('')}</div>` : '') +
    PITCH_KEYS.map((k, i) => `<button data-p="${k}" class="${k === pitchType ? 'on' : ''}"><span class="kbd">${i + 1}</span><i class="pc" style="background:${PITCHES[k].col}"></i>${PITCHES[k].name}${k === lastT && run >= 2 ? `<b class="rep">연속 ${run}</b>` : ''}<em>${PITCHES[k].v}</em></button>`).join('');
  bar.querySelectorAll('button').forEach((b) => (b.onpointerdown = (e) => { e.stopPropagation(); onPick(b.dataset.p); }));
}

// ── 스윙 분석: 타이밍(빠름/늦음)과 위치(PCI 커서 vs 공) 중 뭐가 문제였는지 + 최근 스윙 경향 코칭 ──
// J = shared/sim.js pciJudge 결과 (W 타이밍 반폭, RX/RY 그려진 커서, g 타이밍 보너스 배율, nx/ny/n 커서 안 위치) [gameplay]
const swHist = [];
let swaT = 0;
export function swingReport(dt, a, p, J, contact) {
  const el = $('swa'); if (!el) return;
  const ex = a[0] - p.tx, ey = a[1] - p.ty;
  swHist.push({ dt, ex, ey, n: J.n, contact, W: J.W, tq: J.tq }); if (swHist.length > 12) swHist.shift();
  // 타이밍 바: ±0.2초 범위, 초록 = 맞는 구간
  const span = 0.2, pos = clamp(dt / span, -1, 1);
  el.querySelector('.sw-win').style.cssText = `left:${50 - J.W / span * 50}%;width:${J.W / span * 100}%`;
  const tOk = J.tq >= 0, lOk = J.n <= 1;
  const mk = el.querySelector('.sw-mk'); mk.style.left = `${50 + pos * 50}%`; mk.classList.toggle('bad', !tOk);
  const tv = el.querySelector('.sw-tv'); tv.textContent = Math.abs(dt) < 0.02 ? '딱 맞음' : `${Math.round(Math.abs(dt) * 1000)}ms ${dt < 0 ? '빠름(당김)' : '늦음(밀어침)'}`; tv.classList.toggle('bad', !tOk);
  // 위치 그림: 공(흰 점) 기준으로 PCI 커서가 어디 있었나. 점선 = 타이밍 보너스로 넓어진 판정
  const cv = el.querySelector('canvas'), g = cv.getContext('2d'), S0 = 60, k = 60 / 0.3;
  g.clearRect(0, 0, 120, 120);
  g.strokeStyle = 'rgba(255,255,255,.16)'; g.lineWidth = 1; g.strokeRect(10.5, 10.5, 99, 99);
  g.beginPath(); g.moveTo(60, 12); g.lineTo(60, 108); g.moveTo(12, 60); g.lineTo(108, 60); g.strokeStyle = 'rgba(255,255,255,.07)'; g.stroke();
  const cx = S0 + ex * k, cy = S0 - ey * k;
  if (J.g > 1.01) { pciPath(g, cx, cy, J.RX * J.g * k, J.RY * J.g * k); g.setLineDash([3, 3]); g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; g.stroke(); g.setLineDash([]); }
  pciPath(g, cx, cy, J.RX * k, J.RY * k); g.fillStyle = lOk ? 'rgba(47,174,106,.28)' : 'rgba(229,54,58,.24)'; g.fill(); g.strokeStyle = lOk ? '#3fd187' : '#ff5a55'; g.lineWidth = 2; g.stroke();
  g.beginPath(); g.arc(S0, S0, 5, 0, 7); g.fillStyle = '#fff'; g.fill();
  const lv = el.querySelector('.sw-lv');
  lv.textContent = !lOk ? `커서 밖 ${Math.round(Math.hypot(ex, ey) * 100)}cm` : J.ny > 0.33 ? '커서 아래쪽 (땅볼)' : J.ny < -0.33 ? '커서 위쪽 (뜬공)' : '커서 가운데 (라인드라이브)';
  lv.classList.toggle('bad', !lOk);
  // 경향 코칭 (최근 4번 이상)
  let tip = '';
  const last = swHist.slice(-6);
  if (last.length >= 4) {
    const mT = last.reduce((q, h) => q + h.dt, 0) / last.length;
    const badT = last.filter((h) => h.tq < 0).length, badL = last.filter((h) => h.tq >= 0 && h.n > 1).length;
    const mY = last.reduce((q, h) => q + h.ey, 0) / last.length;
    if (badT >= badL && badT >= 2) tip = mT > 0 ? `타이밍이 늦는 편 (평균 ${Math.round(mT * 1000)}ms). '스트라이드' 뜰 때 미리 준비` : `타이밍이 빠른 편 (평균 ${Math.round(-mT * 1000)}ms). 공이 존 앞에 올 때까지 참기`;
    else if (badL >= 2) tip = Math.abs(mY) > 0.06 ? `커서가 공보다 ${mY > 0 ? '위' : '아래'}에 있는 편. ${mY > 0 ? '조금 낮게' : '조금 높게'}` : '커서가 좌우로 흔들림. 공 따라 끝까지 옮기기';
    else tip = '좋아요, 타이밍만 맞으면 커서는 대충 맞아도 맞아';
  }
  el.querySelector('.sw-tip').textContent = tip;
  el.classList.add('show'); clearTimeout(swaT); swaT = setTimeout(() => el.classList.remove('show'), 5200);
}

// ── 처음 몇 번은 상황별 짧은 도움말 카드 (브라우저마다 종류별 2번까지) ──
const COACH = {
  bat: ['타격', '투수가 다리를 들었다 <b>멈춘 뒤</b> 내딛을 때 공이 나와. 사각 커서(PCI)를 공 길목에 두고, 테두리가 <b class="g">초록</b>일 때 클릭. <b>타이밍이 맞으면 커서는 대충 맞아도 맞아</b>.'],
  pitch: ['투구', '<b>1~6</b> 구종 고르고, 마우스로 코스, 클릭해서 게이지 시작, <b class="g">초록 구간</b>에서 한 번 더 클릭.'],
  field: ['수비', '노란 링이 내 선수. <b>WASD</b>로 공 밑으로 가면 자동 포구. 잡으면 <b>Space</b> = 금색 베이스로 송구.'],
  run: ['주루', '주자 있으면 투구 전 <b>R</b> 도루. 타구 후 <b>E</b> 추가 진루 / <b>Q</b> 귀루. 접전은 자동 슬라이딩.'],
};
let coachT = -1e9, coachSeen = {}, coachLast = '';
try { coachSeen = JSON.parse(localStorage.getItem('hr_coach') || '{}'); } catch { }
function coach(kind) {
  const t = performance.now() / 1000;
  if ((coachSeen[kind] || 0) >= 2 || t - coachT < 6) return;
  coachSeen[kind] = (coachSeen[kind] || 0) + 1; try { localStorage.setItem('hr_coach', JSON.stringify(coachSeen)); } catch { }
  const [ti, h] = COACH[kind]; const e = $('coach');
  e.querySelector('b').textContent = ti; e.querySelector('span').innerHTML = h;
  e.classList.add('show'); coachT = t; setTimeout(() => e.classList.remove('show'), 6500);
}
export function updateCoach(S, role) {
  const k = role.batter && S.ph === 'pitch' ? 'bat' : role.pitcher && S.ph === 'pitch' ? 'pitch' : role.fi >= 0 && S.ph === 'live' && !role.pitcher ? 'field' : role.offense && !role.batter && (S.occ || []).some(Boolean) && S.ph === 'pitch' ? 'run' : '';
  if (k && k !== coachLast) coach(k);
  coachLast = k;
}

// ── 등장 카드 (컷씬 중 하단 lower-third) ──
const statOf = (s, bat) => (s.st || []).find((r) => (r[0] && r[0] === bat.id) || (!r[0] && r[1] === bat.name));
export function introCard(kind, s, c) {
  const el = $('intro');
  const ci = (s.cl || [0, 1])[kind === 'b' ? (s.half === 0 ? 0 : 1) : (s.half === 0 ? 1 : 0)];
  const club = clubOf(ci) || {};
  el.style.setProperty('--cc', teamColor(ci));
  const q = (sel, v) => (el.querySelector(sel).textContent = v);
  if (kind === 'b') {
    const st = statOf(s, s.bat);
    const nm = s.bat.id ? (c.nameOf(s.bat.id) || s.bat.name) : s.bat.name;
    const slot = s.bat.slot || ((s.bat.n - 1) % 9) + 1;
    const cr = career[nm];
    q('.in-tag', `${slot}번 타자 · ${club.name || ''}`); q('.in-nm', nm);
    let today = '오늘 첫 타석';
    if (st && st[3]) { const ab = st[3] - st[9]; today = `오늘 ${ab}타수 ${st[4]}안타` + (st[5] ? ` ${st[5]}홈런` : '') + (st[6] ? ` ${st[6]}타점` : '') + (st[9] ? ` ${st[9]}볼넷` : '') + (st[8] ? ` ${st[8]}삼진` : ''); }
    q('.in-today', today);
    if (cr && cr.pa) { q('.in-big', avgStr(cr.h || 0, cr.pa - (cr.bb || 0))); q('.in-bigl', '통산 타율'); q('.in-car', `${cr.g || 0}경기 · ${cr.h || 0}안타 · ${cr.hr || 0}홈런 · ${cr.rbi || 0}타점 · 최장 ${cr.max || 0}m`); }
    else if (st && st[3]) { q('.in-big', avgStr(st[4], st[3] - st[9])); q('.in-bigl', '오늘 타율'); q('.in-car', s.bat.id ? '통산 기록은 경기가 끝나면 쌓여요' : 'CPU 타자'); }
    else { q('.in-big', s.bat.id ? '-.---' : 'CPU'); q('.in-bigl', s.bat.id ? '타율' : ''); q('.in-car', s.bat.id ? '첫 기록 도전' : ''); }
    const n = (s.occ || []).filter(Boolean).length;
    q('.in-sit', n === 3 ? '만루 찬스' : (s.occ && (s.occ[1] || s.occ[2])) ? '득점권 찬스' : (s.cnt ? `${s.cnt[2]}아웃` : ''));
    // 내 타석 오르간은 사운드 매니저가 서버 batterUp으로 처리
  } else {
    const cp = s.cp || ['', 0, 0, 0, 0, 0, 0, null];
    const cr = career[cp[0]];
    q('.in-tag', `투수 · ${club.name || ''}`); q('.in-nm', cp[0]);
    q('.in-today', cp[1] || cp[6] ? `오늘 ${ipStr(cp[1])}이닝 · ${cp[4]}탈삼진 · ${cp[2]}실점 · ${cp[6]}구` : '오늘 첫 등판');
    if (cr && cr.outs) { q('.in-big', eraStr(cr.r || 0, cr.outs)); q('.in-bigl', '통산 평균자책'); q('.in-car', `${ipStr(cr.outs)}이닝 · ${cr.pk || 0}탈삼진 · 볼넷 ${cr.pbb || 0}`); }
    else { q('.in-big', cp[1] ? eraStr(cp[2], cp[1]) : '-.--'); q('.in-bigl', cp[1] ? '오늘 평균자책' : '평균자책'); q('.in-car', cp[7] ? '' : 'CPU 투수'); }
    q('.in-sit', '');
  }
  replay(el, 'show');
}
export function introHide() { $('intro').classList.remove('show'); }

// ── 타석 소개 (더비·컷씬 없을 때) ──
let wuT = 0;
export function walkup(s, c) {
  const st = statOf(s, s.bat);
  const me = !!(s.bat.id && s.bat.id === c.myId);
  const e = $('walkup');
  e.querySelector('.wu-no').textContent = s.bat.slot || ((s.bat.n - 1) % 9) + 1;
  e.querySelector('.wu-nm').textContent = (me ? '내 타석 · ' : '') + (s.bat.id ? (c.nameOf(s.bat.id) || s.bat.name) : s.bat.name);
  let line = '오늘 첫 타석';
  if (st && st[3]) { line = `오늘 ${st[3] - st[9]}타수 ${st[4]}안타` + (st[5] ? ` · ${st[5]}홈런` : '') + (st[6] ? ` · ${st[6]}타점` : '') + (st[9] ? ` · ${st[9]}볼넷` : ''); }
  const n = (s.occ || []).filter(Boolean).length;
  if (n && s.inn >= 1) line += n === 3 ? ' · 만루 찬스' : (s.occ[1] || s.occ[2]) ? ' · 득점권' : '';
  e.querySelector('.wu-st').textContent = line;
  e.classList.toggle('me', me);
  replay(e, 'show');
  // 오르간: 사운드 매니저(batterUp)
  clearTimeout(wuT); wuT = setTimeout(() => e.classList.remove('show'), 4000);
}
export function resetHUD() { cls('hrCard', 'show', false); slowKey = ''; prevCnt = null; prevSc = null; clubsKey = ''; $('bug')._cnt = ''; $('bigcount')._cnt = ''; }

// [AAA] 공수 교대 카드: 중계 '이닝 종료' 그래픽 (가운데 아래, 3.2초) — 이번 이닝 득점 + 현재 스코어
let innT = 0;
export function inningCard(d, S) {
  const e = $('innCard'); if (!e) return;
  const tn = S.tn || ['원정', '홈'], cl = S.cl || [0, 1], sc = d.sc || S.sc || [0, 0];
  const half = d.half === 0 ? '초' : '말', bat = d.half === 0 ? 0 : 1;
  const runs = d.runs | 0;
  const row = (i) => `<div class="ic-row ${i === bat ? 'bat' : ''}" style="--tc:${teamColor(cl[i])}"><img src="${emblemURL(cl[i], 64)}" alt=""><span>${esc(tn[i])}</span><b>${sc[i]}</b></div>`;
  e.innerHTML = `<div class="ic-top"><b>${d.inning}회${half}</b> 종료</div><div class="ic-body">${row(0)}${row(1)}</div><div class="ic-foot">${runs ? `이번 이닝 <b>${runs}</b>점` : '이번 이닝 무득점'}</div>`;
  e.classList.remove('show'); void e.offsetWidth; e.classList.add('show');
  clearTimeout(innT); innT = setTimeout(() => e.classList.remove('show'), 3200);
}

// [ABS] KBO 자동 투구 판정 그래픽 — 판정마다 오른쪽 아래에 존(3×3)과 공 위치, STRIKE/BALL (2.4초)
let absT = 0;
export function absCall(a, bat) {
  const e = $('absCard'); if (!e || !a || !a.z) return;
  const [x0, x1, y0, y1] = a.z, W = 120, H = 150, padX = 34, padY = 30;
  const sx = W / (x1 - x0), sy = H / (y1 - y0);
  const px = padX + (-(a.x) - x0) * sx, py = padY + (y1 - a.y) * sy; // 포수 시점(중계 화면과 같은 방향)
  const r = Math.max(5, 0.037 * sx);
  const st = a.s ? 'strike' : 'ball';
  const grid = [1, 2].map((i) => `<line x1="${padX + W * i / 3}" y1="${padY}" x2="${padX + W * i / 3}" y2="${padY + H}"/><line x1="${padX}" y1="${padY + H * i / 3}" x2="${padX + W}" y2="${padY + H * i / 3}"/>`).join('');
  const ht = bat && bat.ht ? ` · ${Math.round(bat.ht * 100)}cm` : '';
  e.className = 'abs-' + st;
  e.innerHTML = `<div class="ab-top"><b>ABS</b><span>투구 판정${ht}</span></div>
    <svg viewBox="0 0 ${W + padX * 2} ${H + padY * 2}" aria-hidden="true"><rect x="${padX}" y="${padY}" width="${W}" height="${H}" class="zb"/><g class="zg">${grid}</g>
    <circle cx="${clamp(px, 6, W + padX * 2 - 6)}" cy="${clamp(py, 6, H + padY * 2 - 6)}" r="${r.toFixed(1)}" class="pt"/></svg>
    <div class="ab-call">${a.s ? 'STRIKE' : 'BALL'}</div>`;
  e.classList.remove('show'); void e.offsetWidth; e.classList.add('show');
  clearTimeout(absT); absT = setTimeout(() => e.classList.remove('show'), 2400);
}

// [ABS 챌린지] 판독 화면 오버레이: 0 = 판독 중(신청자·원심), 1 = 결과(번복/유지 + ABS 카드), null = 끝
export function absReview(ab, stage) {
  const e = $('absRev'); if (!e) return;
  if (!ab) { e.classList.remove('show', 'done'); $('absCard') && $('absCard').classList.remove('rv'); return; }
  if (stage === 0) {
    show('chalBar', false);
    e.className = 'show';
    e.innerHTML = `<div class="ar-top"><b>ABS</b> CHALLENGE</div><div class="ar-sub">${esc(ab.by || '')} 신청 · 원심 <b>${ab.c ? '스트라이크' : '볼'}</b></div><div class="ar-res"></div>`;
  } else {
    const over = !!ab.over;
    e.classList.add('done', over ? 'over' : 'keep');
    e.querySelector('.ar-res').innerHTML = `<b>${over ? '판정 번복' : '원심 유지'}</b><span>${ab.s ? 'STRIKE' : 'BALL'}</span>`;
    absCall({ ...ab }, null); $('absCard').classList.add('rv');
  }
}
