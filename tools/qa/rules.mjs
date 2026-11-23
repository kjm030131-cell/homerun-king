// 규칙 검사기 — 게임 엔진(shared/sim.js)만 node 에서 AI끼리(+선택: 무작위 사람 입력) 돌리며 매 틱·매 이벤트 야구 규칙 불변식을 확인한다.
//   node tools/qa/rules.mjs [경기 수=100] [--rules=real|casual|both] [--seed=N] [--fuzz] [--time=분] [--inn=N] [--v]
//   --fuzz : 양 팀에 '사람' 1명씩 넣고 무작위 입력(스윙·투구·도루·견제·진루/귀루·송구·슬라이딩)을 섞음
//   --time : 시간제(분) 켜기 (캐주얼)
// 위반은 종류별로 묶어 시드와 함께 출력 → `--seed=<시드> 1` 로 그 경기만 재현.
// 다른 테스트에서 쓰려고 runGame / checkMany 를 export 한다 (tests/rules.test.mjs).
import { Game, BASES } from '../../shared/sim.js';

const seeded = (s) => () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const isInt = (v) => Math.abs(v - Math.round(v)) < 1e-9;

// 한 경기를 돌리며 위반 목록을 돌려준다
export function runGame({ seed = 1, rules = 'real', innings, fuzz = false, timeLim = 0, maxSec = 3 * 3600, trace = null } = {}) {
  const R0 = Math.random; const rnd = seeded(seed); Math.random = rnd;
  const V = []; // {kind, msg}
  const st = { seed, rules };
  try {
    const g = new Game({ emit: () => {}, sendTo: () => {} });
    if (fuzz) { g.addPlayer('A', '원정사람'); g.addPlayer('H', '홈사람'); g.players.get('A').team = 'away'; g.players.get('H').team = 'home'; }
    g.applySettings({ mode: 'game', rules, innings: innings ?? (rules === 'casual' ? 3 : 9), diff: 1, pitRot: fuzz ? 'inning' : 'fixed', timeLim });
    const where = () => `${g.inning}회${g.half ? '말' : '초'} ${g.balls}-${g.strikes} ${g.outs}아웃 주자[${g.alive().map((r) => r.b.toFixed(2) + (r.target !== r.b ? '>' + r.target : '')).join(',')}] t=${g.now.toFixed(1)} ph=${g.phase}`;
    const flag = (kind, msg = '') => { if (V.length < 400) V.push({ kind, msg: `${msg} | ${where()}` }); };

    // ── 이벤트 훅: 상태를 볼 수 있게 즉시 검사 ──
    const H = { // 반 이닝 단위 장부
      ghosts: 0, ks: 0, fa: 0, sp: 0, fouls: 0, voidRuns: 0, outKinds: [], scoreEv: 0,
    };
    const T = { paDone: { away: 0, home: 0 }, hitEv: [0, 0], errEv: [0, 0] }; // 경기 누적
    let playScore0 = null, playRunsScored = 0, playOuts = [], playFly = false, brokenFrom = 99, lastOutKind = null, liveSince = 0, play = null;
    let prev = { b: 0, s: 0, o: 0, sc: [0, 0], inn: 1, half: 0 };
    let started = false;
    const oEv = g.ev.bind(g);
    g.ev = (e, d = {}) => {
      const o = oEv(e, d);
      if (trace && g.now >= trace[0] && g.now <= trace[1] && !/^(windup|release)$/.test(e) && !(e === 'catch' && d.pitch)) console.log(g.now.toFixed(2), e, JSON.stringify(d).slice(0, 180));
      switch (e) {
        case 'inningStart': {
          if (started) {
            const exp = prev.half === 0 ? [prev.inn, 1] : [prev.inn + 1, 0];
            if (g.inning !== exp[0] || g.half !== exp[1]) flag('이닝 순서 이상', `이전 ${prev.inn}${prev.half} → ${g.inning}${g.half}`);
          } else if (g.inning !== 1 || g.half !== 0) flag('첫 이닝이 1회초가 아님');
          started = true;
          if (g.outs !== 0) flag('이닝 시작 아웃카운트가 0이 아님', `${g.outs}`);
          Object.assign(H, { closed: false, ghosts: 0, ks: 0, fa: 0, sp: 0, fouls: 0, voidRuns: 0, outKinds: [], scoreEv: 0, runs0: g.score[g.half] });
          prev.inn = g.inning; prev.half = g.half;
          break;
        }
        case 'batterUp': {
          const t = d.team; const last = st.lastN?.[t];
          if (last != null) {
            const want = st.pendingPA?.[t] ? last : last + 1;
            if (d.n !== want) flag('타순 건너뜀/반복', `${t} 이전 ${last}번째 → ${d.n}번째 (기대 ${want}${st.pendingPA?.[t] ? ', 앞 타석이 도루사·견제사로 끝나 같은 타자가 다시 나와야 함' : ''})`);
          }
          (st.lastN ||= {})[t] = d.n; st.paEnded = false; (st.pendingPA ||= {})[t] = false;
          if ((d.cnt || [0, 0]).join() !== g.R.startCount.join()) flag('타석 시작 볼카운트 이상', d.cnt.join('-'));
          break;
        }
        case 'ballCall':
          if (!d.hbp && d.b !== prev.b + 1) flag('볼 카운트 증가 이상', `${prev.b} → ${d.b}`);
          if (!d.hbp && !!d.walk !== (d.b >= 4)) flag('볼넷 판정 이상', `b=${d.b} walk=${d.walk}`);
          break;
        case 'strikeCall':
          if (d.s !== Math.min(3, prev.s + 1)) flag('스트라이크 카운트 증가 이상', `${prev.s} → ${d.s}`);
          if (!!d.k !== (d.s >= 3)) flag('삼진 판정 이상', `s=${d.s} k=${d.k}`);
          break;
        case 'foul':
          if (d.kind !== 'tip' && g.strikes > 2) flag('파울로 3스트라이크(번트 제외)', `s=${g.strikes}`);
          break;
        case 'score':
          H.scoreEv++; playRunsScored++;
          if (d.sc[g.half] !== prev.sc[g.half] + 1 && d.sc[g.half] !== g.score[g.half]) flag('득점 이벤트와 점수 불일치');
          prev.sc = [...g.score];
          if (g.phase === 'over') flag('경기 끝난 뒤 득점');
          break;
        case 'scoreVoid': if (!d.foul) H.voidRuns += d.runs; prev.sc = [...g.score]; st.voidAt = g.now; break;
        case 'out': {
          H.outKinds.push(d.kind); lastOutKind = d.kind; if (d.kind === 'k') st.paEnded = true;
          if (d.outs !== g.outs) flag('out 이벤트 아웃카운트 불일치', `${d.outs} vs ${g.outs}`);
          if (d.outs > 3) flag('아웃카운트 3 초과', `${d.outs}`);
          if (d.kind === 'k') { H.ks++; st.kAt = g.now; }
          if (g.play && g.play === play) {
            const r = d.rid != null ? g.runners.find((x) => x.rid === d.rid) : null;
            const s0 = r ? (r.batter || r.start == null ? (r.batter ? 0 : r.start) : r.start) : null;
            if (d.kind === 'fly') { playFly = true; if (g.outs < 3 && playRunsScored > 0) flag('뜬공 포구 전에 출발한 주자 득점 인정(태그업 위반)', `득점 ${playRunsScored}`); }
            if (d.kind === 'force' && r && !playFly && !r.mustReturn && s0 > brokenFrom) flag('역포스: 뒤 주자가 이미 아웃됐는데 포스아웃', `주자 ${s0}루 출발, 이미 ${brokenFrom}루 출발 주자 아웃`);
            if (r && s0 != null && !playFly) brokenFrom = Math.min(brokenFrom, s0);
            playOuts.push(d.kind);
          }
          break;
        }
        case 'error': T.errEv[g.half === 0 ? 1 : 0]++; break;
        case 'hit': if (g.mode === 'game') T.hitEv[g.half]++; break;
        case 'hr': if (g.mode === 'game') T.hitEv[g.half]++; break;
        case 'playEnd': {
          const delta = g.score[g.half] - (playScore0 ?? g.score[g.half]);
          if (d.runs !== delta) flag('플레이 득점(타점 기준)과 실제 점수 변화 불일치', `play.runs=${d.runs} 점수 변화=${delta} 아웃종류=${playOuts.join(',')}`);
          break;
        }
        case 'inningEnd': case 'gameEnd': {
          if (e === 'inningEnd') {
            if (g.outs < 3 && !g.walkoff) flag('3아웃 전에 이닝 종료', `${g.outs}아웃`);
            const L = g.line[d.half] || [];
            if (L[d.inning - 1] !== g.halfRuns) flag('라인스코어 이번 이닝 ≠ 이닝 득점', `${L[d.inning - 1]} vs ${g.halfRuns}`);
          }
          if (e === 'gameEnd' && d.derby) break;
          if (H.closed) { if (e === 'gameEnd') gameEndCheck(); break; }
          H.closed = true;
          // 보존 법칙: (끝난 타석 + 승부치기 주자) = 아웃 + 득점 + 잔루 + 무효 득점 주자
          const pa = H.ks + H.fa + H.sp - H.fouls;
          const lob = g.alive().filter((r) => !r.trot).length, runs = g.score[g.half] - (H.runs0 ?? 0);
          T.paDone[g.batTeam] += pa;
          if (pa + H.ghosts !== g.outs + runs + lob + H.voidRuns + (g.woExtra || 0)) flag('타석·아웃·득점·잔루 보존 깨짐', `타석 ${pa}+승부치기 ${H.ghosts} ≠ 아웃 ${g.outs}+득점 ${runs}+잔루 ${lob}+무효 ${H.voidRuns}`);
          // 이닝 마지막 아웃이 도루사·견제사면 그 타자 타석은 안 끝남 → 다음 이닝 첫 타자
          (st.pendingPA ||= {})[g.batTeam] = g.outs >= 3 && (lastOutKind === 'cs' || lastOutKind === 'pick') && !st.paEnded; // 삼진 + 도루사면 타석은 이미 끝남
          // 3아웃이 뜬공 포구·포스아웃·타자주자 아웃이면 그 플레이 득점은 무효여야 함
          if (g.outs >= 3 && play && playScore0 != null && ['fly', 'force'].includes(lastOutKind) && g.score[g.half] > playScore0) flag('3아웃(뜬공·포스) 플레이에서 득점 인정', `${lastOutKind} 득점 ${g.score[g.half] - playScore0}`);
          if (e === 'gameEnd') gameEndCheck();
          break;
        }
      }
      return o;
    };
    function gameEndCheck() {
          { const d = g.events[g.events.length - 1] || {};
            const [aw, hm] = g.score, inn = g.innings, R = g.R;
            if (d.mercy) { if (Math.abs(aw - hm) < R.mercy || g.inning < 2) flag('콜드게임 조건 아님', `${aw}:${hm} ${g.inning}회`); }
            else if (d.walkoff) { if (!(g.half === 1 && g.inning >= inn && hm > aw)) flag('끝내기 조건 아님', `${aw}:${hm}`); if (hm - aw > 4) flag('끝내기 점수 차가 너무 큼(결승점 이후 득점 인정)', `${aw}:${hm}`); }
            else if (g.inning < inn) flag('정규 이닝 전에 경기 끝', `${g.inning}/${inn}`);
            else if (g.half === 0 && !(hm > aw)) flag('초 공격 뒤 경기 끝인데 홈팀이 안 이김', `${aw}:${hm}`);
            else if (g.half === 1 && aw === hm && g.inning < inn + R.maxExtra) flag('동점인데 연장 안 하고 끝', `${g.inning}회`);
            if (aw === hm && !(g.inning >= inn + R.maxExtra)) flag('무승부 조건 아님', `${g.inning}회`);
            if (g.inning > inn + R.maxExtra) flag('연장 한도 초과', `${g.inning}회`);
            const sum = (a) => (a || []).reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0);
            if (sum(g.line[0]) !== aw || sum(g.line[1]) !== hm) flag('라인스코어 합 ≠ 점수', `${sum(g.line[0])}:${sum(g.line[1])} vs ${aw}:${hm}`);
          }
    }
    // 메서드 훅 (타석 보존 장부)
    const wrap = (name, fn) => { const f = g[name].bind(g); g[name] = (...a) => fn(f, ...a); };
    wrap('forceAdvance', (f, ...a) => { H.fa++; st.paEnded = true; return f(...a); });
    wrap('startPlay', (f, ...a) => { if (g.mode === 'game') H.sp++; return f(...a); });
    wrap('foulBall', (f, ...a) => { if (g.mode === 'game') H.fouls++; return f(...a); });
    wrap('startHalf', (f, ...a) => { const r = f(...a); if (g.inning > g.innings && g.R.ghost) { H.ghosts = g.R.ghost.length; const on = g.alive().map((x) => x.b).sort().join(); if (on !== [...g.R.ghost].sort().join() || g.outs) flag('승부치기 주자 배치 이상', on); } return r; });

    // ── 상태 불변식 (매 틱) ──
    let phase = g.phase, since = g.now, order = null, ballFree = 0;
    g.start();
    const dt = 1 / 60;
    let fz = { nextAct: 0 };
    for (let i = 0; i < maxSec * 60 && g.phase !== 'over'; i++) {
      if (fuzz) fuzzInput(g, fz, rnd);
      const b0 = g.balls, s0 = g.strikes, o0 = g.outs, sc0 = [...g.score], inn0 = g.inning, half0 = g.half;
      prev.b = b0; prev.s = s0; prev.o = o0;
      const trotPend = g.phase === 'result' ? g.runners.filter((r) => r.trot && !r.scored) : null; // [trot]
      g.tick(dt);
      if (trotPend && trotPend.length && g.phase !== 'result' && g.phase !== 'over') { const r = trotPend.find((q) => !q.scored); if (r) flag('홈런 트롯이 홈에 오기 전에 결과 시간이 끝남', `b=${r.b.toFixed(2)}`); }
      if (trace && g.now >= trace[0] && g.now <= trace[1]) { const b = g.ball, t = `${g.phase} ${g.alive().map((r) => `${r.rid}:${r.b.toFixed(1)}>${r.target}${r.forced ? 'F' : ''}${r.batter ? 'B' : ''}${r.mustReturn ? 'M' : ''}`).join(' ')}${b ? ` ball ${b.state} h${b.holder} (${b.x.toFixed(0)},${b.z.toFixed(0)})` : ''} ctrl[${g.fielders.map((f, i) => (f.ctrl ? i + (g.isHumanActive(f) ? '*' : '') : '')).join('')}] ${g.msg}`; if (t !== st.lastT) { st.lastT = t; console.log(g.now.toFixed(2), t); } }
      if (g.phase !== phase) {
        // 국면 전환
        if (g.phase === 'live' && phase !== 'live') { playScore0 = sc0[g.half]; playRunsScored = 0; playOuts = []; playFly = false; brokenFrom = 99; play = g.play; liveSince = g.now; order = g.alive().slice().sort((a, c) => c.b - a.b); }
        if (phase === 'live') { order = null; settleCheck(g, flag); }
        if (g.phase === 'pitch') pitchCheck(g, flag);
        phase = g.phase; since = g.now;
      }
      if (g.play && g.play !== play && g.phase === 'live') { play = g.play; playScore0 = g.score[g.half]; playOuts = []; playFly = false; brokenFrom = 99; order = g.alive().slice().sort((a, c) => c.b - a.b); }
      // 카운트 범위
      if (g.mode === 'game') {
        if (g.balls < 0 || g.balls > 4 || g.strikes < 0 || g.strikes > 3 || g.outs < 0 || g.outs > 3) flag('카운트 범위 밖', `${g.balls}-${g.strikes} ${g.outs}`);
        if ((g.phase === 'pitch' || g.phase === 'pitching') && (g.balls > 3 || g.strikes > 2 || g.outs > 2)) flag('투구 중 카운트가 끝난 상태', `${g.balls}-${g.strikes} ${g.outs}아웃`);
        if (g.outs < o0 && g.inning === inn0 && g.half === half0 && g.phase !== 'over') flag('아웃카운트 감소');
        for (const k of [0, 1]) if (g.score[k] < sc0[k] && st.voidAt !== g.now) flag('점수 감소(무효 처리 없이)');
        if (g.score[0] < 0 || g.score[1] < 0) flag('음수 점수');
      }
      // 주자
      const al = g.alive();
      if (al.length > 4) flag('주자 5명 이상', `${al.length}`);
      for (const r of al) {
        if (!(r.b >= 0 && r.b <= 4) || !(r.target >= 0 && r.target <= 4) || !isFinite(r.b)) { flag('주자 위치 범위 밖', `b=${r.b} target=${r.target}`); break; }
        if (!Number.isInteger(r.target)) { flag('주자 목표 베이스가 정수가 아님(클라 BASES[target] 오류)', `target=${r.target}`); break; }
      }
      if (g.phase === 'live' && order) {
        const live = order.filter((r) => !r.out && !r.scored);
        for (let k = 0; k + 1 < live.length; k++) if (live[k + 1].b > live[k].b + 0.02 && !live[k].trot) { flag('뒤 주자가 앞 주자 추월', `${live[k].b.toFixed(2)} < ${live[k + 1].b.toFixed(2)}`); order = null; break; }
        for (let a = 0; a < al.length; a++) for (let c = a + 1; c < al.length; c++) if (al[a].b === al[c].b && al[a].b >= 1 && isInt(al[a].b) && al[a].b === al[a].target && al[c].b === al[c].target) { flag('한 베이스에 주자 둘 (멈춘 상태)', `${al[a].b}루`); a = 99; break; }
      }
      // 공
      const b = g.ball;
      if (b && (!isFinite(b.x) || !isFinite(b.y) || !isFinite(b.z))) flag('공 위치 NaN');
      if (g.phase === 'live' && b && b.holder < 0 && b.state === 'ground' && Math.hypot(b.vx, b.vz) < 0.3) { ballFree += dt; if (ballFree > 12) { flag('공이 멈춘 채 12초 넘게 아무도 안 주움', `ball(${b.x.toFixed(1)},${b.z.toFixed(1)}) r=${Math.hypot(b.x, b.z).toFixed(1)}`); ballFree = -1e9; } } else if (ballFree > 0) ballFree = 0;
      if (g.phase !== 'live') ballFree = 0;
      // 체력
      for (const s of g.stam.values()) if (!(s.sta >= 0 && s.sta <= 100)) flag('투수 체력 범위 밖', `${s.sta}`);
      // 멈춤
      const lim = { pitch: 18, pitching: 6, live: 30, result: 12, starting: 5 } /* [trot] 홈런 결과 최대 11.2초 */[g.phase];
      if (lim && g.now - since > lim) { flag(`'${g.phase}' 상태가 ${lim}초 넘게 지속(멈춤)`, g.phase === 'live' ? `ball=${b?.state} holder=${b?.holder}` : ''); since = g.now + 1e6; }
    }
    if (g.phase !== 'over') flag('경기가 안 끝남', `${(g.now / 60).toFixed(0)}분`);
    // 경기 누적 일관성
    const errs = g.errs || [0, 0], hits = g.hits || [0, 0];
    if (errs[0] !== T.errEv[0] || errs[1] !== T.errEv[1]) flag('실책 기록 ≠ 실책 이벤트 수', `${errs} vs ${T.errEv}`);
    if (hits[0] !== T.hitEv[0] || hits[1] !== T.hitEv[1]) flag('안타 기록 ≠ 안타 이벤트 수', `${hits} vs ${T.hitEv}`);
    // 타석(PA) 기록: 팀별 합 = 실제 끝난 타석 (파울 타구마다 타석이 늘던 버그 확인)
    const paT = { away: 0, home: 0 }; let rbi = [0, 0];
    for (const s of g.stats.values()) { paT[s.team] = (paT[s.team] || 0) + s.pa; rbi[s.team === 'away' ? 0 : 1] += s.rbi; }
    st.paStat = paT;
    for (const t of ['away', 'home']) if ((paT[t] || 0) !== T.paDone[t]) flag('타석(PA) 기록 합 ≠ 실제 끝난 타석', `${t} 기록 ${paT[t] || 0} vs 실제 ${T.paDone[t]}`);
    if (rbi[0] > g.score[0] || rbi[1] > g.score[1]) flag('타점 합 > 득점', `${rbi} vs ${g.score}`);
    st.ends = { sc: [...g.score], inning: g.inning, min: g.now / 60 };
    st.g = g;
  } finally { Math.random = R0; }
  return { violations: V, info: st };
}

// 투구 대기 상태: 주자는 1~3루 정수 위치, 겹치지 않음
function pitchCheck(g, flag) {
  if (g.mode !== 'game') return;
  const al = g.alive(), seen = new Set();
  for (const r of al) {
    if (!isInt(r.b) || r.b < 1 || r.b > 3) flag('투구 대기 중 주자가 베이스 밖', `b=${r.b}`);
    if (r.b !== r.target) flag('투구 대기 중 주자 목표≠위치', `${r.b}>${r.target}`);
    if (seen.has(r.b)) flag('한 베이스에 주자 둘 (투구 대기)', `${r.b}루`);
    seen.add(r.b);
    if (r.batter) flag('투구 대기 중 타자주자 표시가 남음');
  }
}
// 플레이 끝: 남은 주자는 베이스 위, 겹치지 않음
function settleCheck(g, flag) {
  if (g.mode !== 'game' || g.phase === 'over' || g.outs >= 3) return;
  const al = g.alive().filter((r) => !r.trot), seen = new Set();
  for (const r of al) {
    if (!isInt(r.b) || r.b < 1 || r.b > 3) flag('플레이 끝났는데 주자가 베이스 밖', `b=${r.b} target=${r.target}`);
    if (seen.has(r.b)) flag('플레이 끝 한 베이스에 주자 둘', `${r.b}루`);
    seen.add(r.b);
  }
}

// 무작위 사람 입력 (사람이 할 수 있는 이상한 조작 섞기)
function fuzzInput(g, fz, rnd) {
  if (g.now < fz.nextAct && !(g.phase === 'pitching' && g.pitch && !g.pitch.swung && g.batter.id && fz.swingFor !== g.pitch.id)) return;
  fz.nextAct = g.now + 0.1 + rnd() * 0.4;
  const bat = g.batTeam === 'away' ? 'A' : 'H', fld = bat === 'A' ? 'H' : 'A';
  if (g.phase === 'pitch') {
    if (g.pitcherCtrl() === fld && rnd() < 0.3) g.handle(fld, { t: 'pitch', type: ['FB', 'SL', 'CB', 'CH', 'TS', 'SP'][(rnd() * 6) | 0], tx: (rnd() - 0.5) * 0.7, ty: 0.4 + rnd() * 0.9, power: 0.6 + rnd() * 0.5 });
    if (rnd() < 0.03) g.handle(bat, { t: 'steal' });
    if (rnd() < 0.02) g.handle(fld, { t: 'pick' });
    if (rnd() < 0.02) g.handle(bat, { t: 'bunt', on: rnd() < 0.5 });
  }
  if (g.phase === 'pitching' && g.pitch && g.batter.id === bat && fz.swingFor !== g.pitch.id) {
    if (!fz.plan || fz.plan.pid !== g.pitch.id) fz.plan = { pid: g.pitch.id, go: rnd() < 0.55, dt: (rnd() - 0.5) * 0.3, ax: (rnd() - 0.5) * 0.3, ay: (rnd() - 0.5) * 0.25, mode: rnd() < 0.2 ? 'power' : 'contact' };
    const P = fz.plan;
    if (!P.go) fz.swingFor = g.pitch.id;
    else if (g.now >= g.pitch.arrive + P.dt) { fz.swingFor = g.pitch.id; g.handle(bat, { t: 'swing', pid: g.pitch.id, dt: P.dt, ax: P.ax, ay: P.ay, mode: P.mode }); }
  }
  if (g.phase === 'live') {
    const x = rnd();
    if (x < 0.05) g.handle(bat, { t: 'run', go: rnd() < 0.6 });
    else if (x < 0.07) g.handle(bat, { t: 'slide' });
    // 사람처럼: 잡을 때마다 한 번만 던짐 (계속 공을 돌리면 플레이가 끝없이 이어지는 건 사람 선택이라 검사 대상 아님)
    const b = g.ball; if (b && b.holder >= 0 && g.fielders[b.holder].ctrl === fld && fz.thrownFor !== g.play?.holderSince && rnd() < 0.4) { fz.thrownFor = g.play?.holderSince; if (rnd() < 0.7) g.handle(fld, { t: 'throw', base: 1 + ((rnd() * 5) | 0), p: rnd() }); }
    if (rnd() < 0.03) g.handle(fld, { t: 'sw' });
  }
}

export function checkMany({ n = 100, rules = 'real', seed = 1, fuzz = false, timeLim = 0, innings, onGame } = {}) {
  const found = new Map(); let games = 0; const sum = { runs: 0, min: 0 };
  for (let k = 0; k < n; k++) {
    const sd = seed + k;
    const { violations, info } = runGame({ seed: sd, rules, fuzz, timeLim, innings });
    games++; sum.runs += info.ends ? info.ends.sc[0] + info.ends.sc[1] : 0; sum.min += info.ends ? info.ends.min : 0;
    for (const v of violations) { const e = found.get(v.kind) || { n: 0, seeds: new Set(), ex: [] }; e.n++; e.seeds.add(sd); if (e.ex.length < 3) e.ex.push(`[seed ${sd}] ${v.msg}`); found.set(v.kind, e); }
    if (onGame) onGame(k, info);
  }
  return { found, games, runs: sum.runs / games / 2, min: sum.min / games };
}

// ── CLI ──
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)=?(.*)$/); return m ? [m[1], m[2] || '1'] : ['n', a]; }));
  const N = +(args.n || 100), seed = +(args.seed || 1), fuzz = !!args.fuzz, timeLim = +(args.time || 0);
  if (args.trace) { const [a, b] = args.trace.split('-').map(Number); const r = runGame({ seed, rules: args.rules || 'real', fuzz, timeLim, trace: [a, b], maxSec: b + 1 }); for (const v of r.violations) console.log('!!', v.kind, v.msg); process.exit(0); }
  const sets = args.rules === 'both' || !args.rules ? ['real', 'casual'] : [args.rules];
  let total = 0;
  for (const rules of sets) {
    const t0 = Date.now();
    const r = checkMany({ n: N, rules, seed, fuzz, timeLim, innings: args.inn ? +args.inn : undefined, onGame: args.v ? (k) => process.stdout.write(`\r${rules} ${k + 1}/${N}`) : null });
    if (args.v) process.stdout.write('\n');
    console.log(`== 규칙 검사 ${rules}${fuzz ? ' +사람입력' : ''}${timeLim ? ` 시간제 ${timeLim}분` : ''}: ${r.games}경기 (시드 ${seed}~${seed + N - 1}) · 팀당 득점 ${r.runs.toFixed(2)} · 평균 ${r.min.toFixed(1)}분 · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    if (!r.found.size) console.log('위반 0');
    for (const [k, e] of [...r.found.entries()].sort((a, c) => c[1].n - a[1].n)) {
      total += e.n;
      console.log(`- ${k}: ${e.n}회 · ${e.seeds.size}경기`);
      for (const x of e.ex) console.log('    ' + x);
    }
  }
  process.exitCode = total ? 1 : 0;
}
