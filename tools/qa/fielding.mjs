// 수비 이상 징후 검사기 — 게임 엔진(shared/sim.js)만 node 에서 돌리며 매 틱 수비 불변식을 확인한다.
//   node tools/qa/fielding.mjs [경기 수=40] [--rules=real|casual] [--seed=N] [--v]
// 찾는 것: 공 방치(아무도 안 주움) · 플레이가 안 끝남 · 수비수 경기장 밖/NaN · 공 들고 멍 · 송구가 빈 베이스로 ·
//          순간이동 포구 · 뜬공 낙구 지점 근처에서 구경 · 같은 공에 여러 명 몰림 · 주자 겹침 · 볼데드 후 주자 이동
import { Game, fenceR, BASES } from '../../shared/sim.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)=?(.*)$/); return m ? [m[1], m[2] || '1'] : ['n', a]; }));
const N = +(args.n || 40), RULES = args.rules || 'real', V = !!args.v;
let seed = +(args.seed || 1);
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
Math.random = rnd; // 재현 가능하게

const found = new Map(); // kind → { n, ex: [] }
function flag(kind, g, msg) {
  const e = found.get(kind) || { n: 0, ex: [] }; e.n++;
  if (e.ex.length < 4) e.ex.push(`${msg} | 회${g.inning}${g.half ? '말' : '초'} ${g.outs}아웃 t=${(g.now - (g.play?.t0 ?? g.now)).toFixed(1)}s`);
  found.set(kind, e);
}
const d2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

let plays = 0, ticks = 0, covT = 0; const cov = {}; const flips = { chaser: 0, cov: 0 }; const dec = { throws: 0, late: 0, empty: 0, dpChance: 0, dpTo2: 0, dpOther: [] };
for (let k = 0; k < N; k++) {
  const evs = [];
  const g = new Game({ emit: (m) => { if (m && m.t === 'ev' && m.ev) evs.push(...[].concat(m.ev)); }, sendTo: () => {} });
  if (args.human) { g.addPlayer('me', '나'); const p = g.players.get('me'); p.team = 'home'; p.pos = args.pos || 'any'; }
  g.applySettings({ mode: 'game', innings: RULES === 'casual' ? 3 : 9, rules: RULES, diff: 1, fieldCtl: args.fc || 'auto', pitRot: 'fixed' });
  g.start();
  let st = null; // 플레이별 상태
  const origEv = g.ev.bind(g);
  g.ev = (type, data) => { evs.push({ type, ...data }); return origEv(type, data); };
  for (let i = 0; i < 60 * 60 * 120 && g.phase !== 'over'; i++) {
    g.tick(1 / 60); ticks++;
    const b = g.ball, P = g.play;
    if (g.phase === 'live' && P && b) {
      if (!st || st.P !== P) { st = { P, t0: g.now, rest: 0, hold: 0, holder: -2, thrown: null, flyChk: false, crowd: 0, lastB: { x: b.x, z: b.z } }; plays++; }
      const t = g.now - st.t0;
      // 담당 뒤집힘: 쫓는 사람·베이스 커버 담당이 플레이 중 몇 번 바뀌나
      const ck = P.chaser + '', cv = P.cov ? [1, 2, 3, 4].map((k) => P.cov[k]).join(',') : '';
      if (st.ck != null && ck !== st.ck && b.holder < 0 && b.state !== 'thrown') flips.chaser++;
      if (st.cv && cv && cv !== st.cv) flips.cov++;
      st.ck = ck; st.cv = cv || st.cv;
      // 쓸데없이 뛰는 수비수: 공·베이스와 무관하게 10m 넘게 움직이는 사람 수(플레이당 최대)
      if (!st.start) st.start = g.fielders.map((f) => [f.x, f.z]);
      if (t > 25 && !st.long) { st.long = 1; flag('플레이가 25초 넘게 안 끝남', g, `kind=${P.kind} ball=${b.state} holder=${b.holder} runners=${g.alive().map((r) => r.b.toFixed(2) + '→' + r.target).join(',')}`); }
      // 수비수 위치
      for (const [fi, f] of g.fielders.entries()) {
        if (!isFinite(f.x) || !isFinite(f.z)) flag('수비수 위치 NaN', g, f.pos);
        const r = Math.hypot(f.x, f.z), phi = Math.atan2(f.x, f.z);
        if (r > fenceR(phi) + 0.5 && Math.abs(phi) < 0.8 && !st.fenceF) st.fenceF = 1, flag('수비수가 펜스 밖', g, `${f.pos} r=${r.toFixed(1)} fence=${fenceR(phi).toFixed(1)}`);
      }
      // 공 방치: 땅에 굴러 멈췄는데(속도<0.6) 아무도 안 듦
      const sp = Math.hypot(b.vx || 0, b.vz || 0);
      if (b.holder < 0 && b.state === 'ground' && sp < 0.6 && b.y < 0.4) {
        st.rest += 1 / 60;
        const near = g.fielders.map((f, fi) => [f.pos, d2(f.x, f.z, b.x, b.z)]).sort((a, c) => a[1] - c[1])[0];
        if (st.nearD != null && near[1] < st.nearD - 0.02) st.closing = g.now; st.nearD = near[1];
        if (st.rest > 2 && g.now - (st.closing || 0) > 1 && !st.restF) { st.restF = 1; flag('공이 멈췄는데 가장 가까운 수비수가 안 다가감(1초+)', g, `ball(${b.x.toFixed(1)},${b.z.toFixed(1)}) ${near[0]} ${near[1].toFixed(1)}m ctrl=${g.fielders.find((f) => f.pos === near[0]).ctrl || '-'}`); }
      } else { st.rest = 0; st.nearD = null; }
      // 공 들고 멍: 주자가 진루 중인데 4초 넘게 들고만 있음
      if (b.holder >= 0) {
        if (st.holder !== b.holder) { st.holder = b.holder; st.hold = 0; }
        st.hold += 1 / 60;
        const moving = g.alive().some((r) => !r.trot && Math.abs(r.target - r.b) > 0.02);
        if (st.hold > 4 && moving && !st.holdF) { st.holdF = 1; const f = g.fielders[b.holder]; flag('주자가 뛰는데 공 들고 4초 넘게 가만', g, `${f.pos} at(${f.x.toFixed(1)},${f.z.toFixed(1)}) runners=${g.alive().map((r) => r.b.toFixed(2) + '→' + r.target).join(',')}`); }
      } else st.holder = -2;
      // 송구: 던지는 순간 목표 근처(3m)에 받을 수비수가 도착 가능한지
      if (b.state === 'thrown' && !st.thrown) {
        st.thrown = { tx: b.tx, tz: b.tz, t: g.now, thrower: b.thrower };
      }
      if (st.thrown && b.state !== 'thrown') {
        const T = st.thrown; st.thrown = null;
        if (b.holder < 0 && b.state !== 'dead' && g.phase === 'live') {
          const near = g.fielders.map((f, fi) => [f.pos, d2(f.x, f.z, T.tx, T.tz), fi]).filter((x) => x[2] !== T.thrower).sort((a, c) => a[1] - c[1])[0];
          if (near && near[1] > 3) flag('송구가 아무도 없는 곳으로', g, `목표(${T.tx?.toFixed(1)},${T.tz?.toFixed(1)}) 가장 가까운 ${near[0]} ${near[1].toFixed(1)}m 던진사람 ${g.fielders[T.thrower]?.pos}`);
          else st.miss = { t: g.now, who: near && near[2], info: `state=${b.state} 받을 사람 ${near ? near[0] + ' ' + near[1].toFixed(1) + 'm' : '-'} v=${Math.hypot(b.vx||0,b.vy||0,b.vz||0).toFixed(1)} y=${b.y.toFixed(2)} 던진사람 ${g.fielders[T.thrower]?.pos} 경과 ${(g.now-T.t).toFixed(2)}s` };
        }
      }
      if (st.miss) { if (b.holder >= 0) st.miss = null; else if (g.now - st.miss.t > 1.5) { flag('송구가 받을 사람 바로 앞에서 빠짐(1.5초 안에 못 잡음)', g, st.miss.info); st.miss = null; } }
      // 뜬공이 떨어지는데 근처(4m) 수비수가 안 움직임
      if (b.state === 'air' && b.batted && !b.bounced && b.y < 1.2 && b.vy < 0 && !st.flyChk && t > 1.2) {
        st.flyChk = true;
        const cand = g.fielders.map((f) => [f, d2(f.x, f.z, b.x, b.z)]).sort((a, c) => a[1] - c[1])[0];
        const r = Math.hypot(b.x, b.z), phi = Math.atan2(b.x, b.z);
        if (cand && cand[1] < 4.5 && cand[1] > 1.6 && r < fenceR(phi) - 2 && (cand[0].mv || 0) < 0.3 && g.now - cand[0].dv > 1.2) flag('뜬공 낙구 지점 근처인데 서서 구경', g, `${cand[0].pos} ${cand[1].toFixed(1)}m mv=${(cand[0].mv || 0).toFixed(2)}`);
      }
      // 같은 공으로 3명 이상 몰림(공 3m 안, 움직이는 중)
      const crowd = g.fielders.filter((f) => d2(f.x, f.z, b.x, b.z) < 3 && (f.mv || 0) > 1).length;
      if (b.holder < 0 && crowd >= 3) { st.crowd += 1 / 60; if (st.crowd > 1 && !st.crowdF) { st.crowdF = 1; flag('공 하나에 3명 이상 몰림', g, g.fielders.filter((f) => d2(f.x, f.z, b.x, b.z) < 3).map((f) => f.pos).join(',')); } }
      // 베이스 커버: 공이 외야(반지름 40m+)에 있고 플레이 2.5초가 지난 뒤 각 베이스 3m 안에 수비수가 있나 (공 든 사람·쫓는 사람 제외)
      if (t > 2.5 && Math.hypot(b.x, b.z) > 40) {
        st.covT = (st.covT || 0) + 1 / 60;
        for (let k = 1; k <= 4; k++) {
          const B = BASES[k % 4];
          const has = g.fielders.some((f, fi) => fi !== b.holder && d2(f.x, f.z, B[0], B[1]) < 3); const live = g.alive().some((r) => !r.trot && r.b < k && r.target >= k - 1);
          if (!has && live) { cov[k] = (cov[k] || 0) + 1 / 60; if (!st['cv' + k] && t > 4) { st['cv' + k] = 1; flag(`${k === 4 ? '홈' : k + '루'} 베이스가 빔(공이 외야, 4초+)`, g, g.fielders.map((f) => f.pos + '(' + d2(f.x, f.z, B[0], B[1]).toFixed(0) + ')').join(' ') + ' holder=' + (b.holder >= 0 ? g.fielders[b.holder].pos : '-') + ' chaser=' + (P.chaser >= 0 ? g.fielders[P.chaser].pos : '-')); } }
        }
        covT += 1 / 60;
      }
      // 주자 겹침(같은 위치 두 명)
      const al = g.alive();
      for (let a = 0; a < al.length; a++) for (let c = a + 1; c < al.length; c++) if (Math.abs(al[a].b - al[c].b) < 0.03 && al[a].b > 0.2 && !st.overF) { st.overF = 1; flag('주자 두 명이 같은 자리', g, `${al[a].b.toFixed(2)} / ${al[c].b.toFixed(2)} target ${al[a].target}/${al[c].target}`); }
    }
    // 포구 이벤트: 공과 수비수 거리 / 송구 판단
    while (evs.length) {
      const e = evs.shift();
      if (e.type === 'throw' && !e.pick && e.base > 0 && g.play && g.play.kind === 'bip') {
        const k = e.base, al = g.alive().filter((r) => !r.trot);
        const going = al.filter((r) => r.target === k && r.b < k - 0.01);
        const arrived = al.filter((r) => r.target === k && r.b >= k - 0.01);
        const backTo = al.filter((r) => r.mustReturn && r.target === k);
        dec.throws++;
        if (!going.length && !backTo.length) { if (arrived.length) { dec.late++; flag('이미 도착한 주자 베이스로 송구', g, `${e.pos}→${k === 4 ? '홈' : k + '루'} 주자 ${al.map((r) => r.b.toFixed(2) + '>' + r.target).join(',')}`); } else if (al.some((r) => r.b < r.target - 0.05)) { dec.empty++; flag('주자가 안 가는 베이스로 송구(다른 주자는 뛰는 중)', g, `${e.pos}→${k === 4 ? '홈' : k + '루'} 주자 ${al.map((r) => r.b.toFixed(2) + '>' + r.target).join(',')}`); } }
      }
      if (e.type === 'catch' && !e.pitch && !e.fly && !e.thrown && g.play && g.play.kind === 'bip' && g.fielders[e.i] && e.i >= 1 && e.i <= 5) {
        const on1 = g.alive().some((r) => r.start === 1 && r.forced), t = g.now - g.play.t0;
        if (on1 && g.outs < 2 && t < 2.6) { dec.dpChance++; st.dpWatch = g.play; }
      }
      if (e.type === 'throw' && st && st.dpWatch === g.play) { st.dpWatch = null; if (e.base === 2) dec.dpTo2++; else dec.dpOther.push(e.pos + '→' + e.base); }
      if (e.type === 'catch' && !e.pitch && e.i != null) {
        const f = g.fielders[e.i]; if (f && e.x != null) { const d = d2(f.x, f.z, e.x, e.z); if (d > 2.6) flag('먼 거리에서 포구(순간이동처럼 보임)', g, `${f.pos} ${d.toFixed(1)}m dive=${e.dive}`); }
      }
    }
  }
  if (g.phase !== 'over') flag('경기가 안 끝남(2시간)', g, `phase=${g.phase}`);
  if (V) process.stdout.write(`\r경기 ${k + 1}/${N} 플레이 ${plays}`);
}
if (V) process.stdout.write('\n');
console.log(`== 수비 검사 (${RULES}, ${N}경기, 플레이 ${plays}개)`);
if (covT) console.log('공이 외야에 있을 때 베이스가 빈 시간 비율: ' + [1, 2, 3, 4].map((k) => (k === 4 ? '홈' : k + '루') + ' ' + (100 * (cov[k] || 0) / covT).toFixed(0) + '%').join(' · '));
console.log(`담당 뒤집힘(플레이당): 쫓는 사람 ${(flips.chaser / plays).toFixed(2)}회 · 베이스 커버 ${(flips.cov / plays).toFixed(2)}회`);
console.log(`송구 판단: 송구 ${dec.throws}회 · 이미 도착한 베이스로 ${dec.late} · 주자 안 가는 베이스로 ${dec.empty} | 1루 주자+땅볼(병살 기회) ${dec.dpChance}회 중 2루 송구 ${dec.dpTo2} (그 외 ${dec.dpOther.slice(0, 8).join(' ')})`);
if (!found.size) console.log('이상 없음');
for (const [k, e] of [...found.entries()].sort((a, c) => c[1].n - a[1].n)) {
  console.log(`- ${k}: ${e.n}회 (${(100 * e.n / plays).toFixed(1)}%)`);
  for (const x of e.ex) console.log('    ' + x);
}
