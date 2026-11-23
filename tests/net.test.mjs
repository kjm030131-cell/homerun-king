// [net] 스냅샷 델타(src/index.js packSnap ↔ client/net/snap.js) 왕복이 원래 스냅샷과 똑같은지, 보간 버퍼가 바닥나면 짧게 외삽하는지
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../shared/sim.js';
import { packSnap } from '../src/index.js';
import { createSnapMerger } from '../client/net/snap.js';
import { createNetInterp, NET } from '../client/net/interp.js';

const seeded = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };

test('스냅샷 델타 왕복: 합친 결과가 원래 스냅샷과 같고, 평균 크기는 1/3 이하', () => {
  const r = Math.random; Math.random = seeded(11);
  try {
    const g = new Game({ emit: () => { }, sendTo: () => { } });
    g.addPlayer('a', '가'); g.addPlayer('b', '나'); g.players.get('a').team = 'away'; g.players.get('b').team = 'home';
    g.applySettings({ innings: 2, pitRot: 'cpu' }); g.start();
    const st = { last: null, n: 0 }, M = createSnapMerger();
    let full = 0, packed = 0, n = 0;
    for (let i = 0; i < 60 * 400 && g.phase !== 'over'; i++) {
      g.tick(1 / 60);
      if (i % 2) continue;
      const s = g.snapshot(true), raw = JSON.stringify(s), pk = packSnap(st, s);
      const got = M.merge(JSON.parse(pk));
      assert.deepEqual(got, JSON.parse(raw), `스냅샷 ${n} 다름`);
      full += Buffer.byteLength(raw); packed += Buffer.byteLength(pk); n++;
    }
    assert.ok(n > 1000);
    assert.ok(packed < full / 3, `델타 ${packed} / 통째 ${full}`);
  } finally { Math.random = r; }
});

test('보간: 스냅샷이 늦으면 마지막 구간 속도로 최대 EXT_MAX 외삽, 지연은 늦음에 맞춰 늘어남', () => {
  const N = createNetInterp();
  const snap = (t, x) => ({ t: 's', now: t, ph: 'live', fl: [['P', x, 0, 0]], rn: [] });
  // 1초 동안 33ms 간격, 도착 지연 50ms + 가끔 40ms 더
  let x = 0;
  for (let k = 0; k < 30; k++) { const t = k / 30; x = t * 6; N.onSnap(snap(t, x), t + 0.05 + (k % 5 === 0 ? 0.04 : 0)); }
  assert.ok(N.want > 1 / 30 + 0.03 && N.want < 0.12, `지연 목표 ${N.want}`);
  for (let i = 0; i < 200; i++) N.sample(N.simNow(1.0), 1 / 60, false); // 지연이 목표까지 따라가게
  // 마지막 스냅샷(0.967) 이후 한참 아무것도 안 옴 → 외삽은 EXT_MAX 까지만
  const r = N.sample(N.simNow(1.6), 1 / 60, false);
  assert.ok(r.under);
  const q = r.fl(0, 'P');
  assert.ok(Math.abs(q[0] - (x + 6 * NET.EXT_MAX)) < 0.05, `외삽 ${q[0]} 기대 ${x + 6 * NET.EXT_MAX}`);
  // 새 방(서버 시각이 0부터 다시) → 버퍼 비우고 새 스냅샷 받음
  N.onSnap(snap(0.1, 1), 1.7); N.onSnap(snap(0.133, 1.2), 1.73);
  const r2 = N.sample(N.simNow(1.8), 1 / 60, false);
  assert.ok(r2 && r2.fl(0, 'P')[0] >= 1, '새 방 스냅샷이 버려짐');
});

// [net] 2차: 주자 앞당기기(목표 베이스에서 멈춤), 남이 조작하는 수비수(보낸 시각대로 고르게), 내 조작 예측(투구 와인드업 합류)
import { runnerXZ, WINDUP } from '../shared/sim.js';
import { pitchPred, windupTau, throwOk, jumpOk, diveOk } from '../client/net/predict.js';

test('보간: 라이브 주자는 지연만큼 베이스 경로를 따라 앞으로, 목표 베이스를 넘지 않음', () => {
  const N = createNetInterp();
  const rn = (b, tg) => { const [x, z] = runnerXZ(b); return [Math.round(x * 100) / 100, Math.round(z * 100) / 100, '가', Math.round(b * 100) / 100, null, 0, tg, 7]; };
  const v = 8 / 27.43; // 8m/s
  const tArr = 0.5 / v; // 1루 도착 1.71초
  for (let k = 0; k < 75; k++) {
    const t = k / 30; N.onSnap({ t: 's', now: t, ph: 'live', fl: [['P', 0, 18, 0]], rn: [rn(Math.min(1, 0.5 + v * t), 1)] }, t + 0.06);
    if (k === 45) { // 1.5초: 지금 받은 것까지로 화면 — 앞당긴 위치 = 지금(ti + 지연) 진짜 위치
      for (let i = 0; i < 300; i++) N.sample(N.simNow(t + 0.06), 1 / 60, true);
      const r = N.sample(N.simNow(t + 0.06), 1 / 60, true), q = r.rn('r7'), want = runnerXZ(Math.min(1, 0.5 + v * (r.ti + r.delay)));
      assert.ok(r.ti < t - 0.03 && Math.hypot(q[0] - want[0], q[1] - want[1]) < 0.12, `주자 ${q} 기대 ${want}`);
    }
  }
  // 보간 시각은 도착 직전인데 앞당기면 1루를 넘을 때: 1루에서 멈춤
  let r2 = null; for (let tt = 1.6; tt < 2.4; tt += 0.005) { const r = N.sample(N.simNow(tt), 1 / 60, true); if (r.ti > tArr - 0.03) { r2 = r; break; } }
  assert.ok(r2 && r2.ti < tArr && r2.ti + r2.delay > tArr + 0.005, `시각 ${r2 && r2.ti} 지연 ${r2 && r2.delay}`);
  const q2 = r2.rn('r7'), b1 = runnerXZ(1);
  assert.ok(Math.hypot(q2[0] - b1[0], q2[1] - b1[1]) < 0.03, `1루 넘음 ${q2}`);
});

test('보간: 남이 조작하는 수비수 — 서버 도착이 들쭉날쭉해도 보낸 시각(fl[9]) 간격대로 고르게', () => {
  const N = createNetInterp();
  let seed = 5; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  // 사람이 30Hz 로 6m/s 등속 이동을 보냄. 서버 도착 = 보낸 시각 + 40ms + 지터(0~60ms, 순서 유지) → 스냅샷(30Hz)엔 그때까지 도착한 마지막 위치
  const sends = []; let last = 0;
  for (let k = 0; k < 120; k++) { const c = k / 30; const arr = Math.max(last, c + 0.04 + rnd() * 0.06); last = arr; sends.push([c, arr]); }
  for (let j = 0; j < 115; j++) {
    const t = 0.1 + j / 30; let got = null;
    for (const s of sends) if (s[1] <= t) got = s;
    if (!got) continue;
    const x = Math.round(got[0] * 6 * 100) / 100;
    N.onSnap({ t: 's', now: t, ph: 'live', fl: [['SS', x, 30, 0, 'p1', 2, -1, -1, -1, Math.round(got[0] * 1000) + 777000]], rn: [] }, t + 0.03);
  }
  // 화면 속도가 일정해야: 프레임마다 이동량의 흔들림
  const xs = [];
  for (let i = 0; i < 200; i++) N.sample(N.simNow(3.3), 1 / 60, false);
  for (let i = 0; i < 30; i++) { const r = N.sample(N.simNow(3.4 + i / 60 + 0.03), 1 / 60, false); xs.push(r.fl(0, 'SS')[0]); }
  const d = xs.slice(1).map((x, i) => x - xs[i]), m = d.reduce((a, b) => a + b, 0) / d.length;
  const dev = Math.max(...d.map((x) => Math.abs(x - m)));
  assert.ok(Math.abs(m - 0.1) < 0.01, `평균 이동 ${m}`);
  assert.ok(dev < 0.02, `프레임 이동 흔들림 ${dev}`);
});

test('예측: 내 투구 와인드업은 클릭 순간 시작, 서버 투구가 오면 1.2초 지점까지 서버 시간표로 합류', () => {
  const s0 = { now: 10, ph: 'pitch', dl: 12, p: { id: 3 } }; // 단계 시작 7초 → 준비(1.1초) 지남
  const P = pitchPred(s0, 10, 0.15);
  assert.equal(windupTau(P, s0, 10.1).toFixed(3), '0.100');
  // 서버 투구(왕복 0.15 뒤 시작): t0 = 10.15 + WINDUP
  const sp = { now: 10.2, ph: 'pitching', p: { id: 4, t0: 10.15 + WINDUP } };
  const a = windupTau(P, sp, 10.2); assert.ok(Math.abs(a - 0.2) < 1e-9, `합류 순간 연속 ${a}`);
  let prev = a;
  for (let t = 10.21; t < 10.15 + 1.25; t += 0.01) { const v = windupTau(P, sp, t); assert.ok(v > prev, '되감김'); prev = v; }
  const rel = windupTau(P, sp, 10.15 + WINDUP); assert.ok(Math.abs(rel - WINDUP) < 1e-9, `릴리스 시각 ${rel}`);
  // 퀵 피치 금지: 단계 열리고 1.1초 전 클릭이면 그 시각(왕복만큼 앞)부터
  const s1 = { now: 20, ph: 'pitch', dl: 14.6, p: null }; // 단계 시작 19.6 → 준비 20.7
  const P1 = pitchPred(s1, 20, 0.1);
  assert.ok(windupTau(P1, s1, 20.3) < 0 && Math.abs(windupTau(P1, s1, 20.7) - 0.1) < 1e-9);
});

test('예측: 송구·점프·다이빙은 서버가 받아들일 때만', () => {
  const s = { ph: 'live', b: [0, 1, 0, 0, 0, 0, 2], fl: [['P', 0, 18, 0, null, 0, -1, -1, -1], ['C', 0, -1, 0, null, 0, -1, -1, -1], ['1B', -19.2, 19.6, 0, 'me', 0, 0.5, -1, -1]] };
  assert.equal(throwOk(s, 2, 1), false, '서 있는 1루로 송구');
  assert.equal(throwOk(s, 2, 2), true);
  assert.equal(throwOk(s, 1, 2), false, '공 안 든 선수');
  assert.equal(jumpOk(s, 2, -9, 5), false, '지난 점프 0.5초');
  s.fl[2][6] = 1.0; assert.equal(jumpOk(s, 2, -9, 5), true);
  assert.equal(jumpOk(s, 2, 4.5, 5), false, '내가 0.5초 전에 점프');
  assert.equal(diveOk(s, 2, -9, 5), false, '공 들고 다이빙');
  s.b[6] = -1; assert.equal(diveOk(s, 2, -9, 5), true);
  assert.equal(diveOk({ ...s, ph: 'result' }, 2, -9, 5), false);
});
