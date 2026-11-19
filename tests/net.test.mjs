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
