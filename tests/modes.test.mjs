// 견제·타격 연습·사람 타자 판정
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, inZone } from '../shared/sim.js';

function pickoffOdds(steal, trials = 150) {
  let out = 0, stuck = 0;
  for (let k = 0; k < trials; k++) {
    const g = new Game({ emit: () => {}, sendTo: () => {} });
    g.applySettings({ mode: 'game', innings: 3 }); g.start();
    for (let i = 0; i < 400 && g.phase !== 'pitch'; i++) g.tick(1 / 60);
    g.runners = [{ ...g.mkRunner(1, false), b: 1, target: 1, start: 1, pid: 'h', steal }];
    g.pitchDeadline = g.now + 99; g.pickTried = true;
    for (let i = 0; i < 90; i++) g.tick(1 / 60);
    g.onPick('cpu', { base: 1 });
    const o0 = g.outs; let t = 0;
    while (g.phase === 'live' && t < 15) { g.tick(1 / 60); t += 1 / 60; }
    if (t >= 15) stuck++; else if (g.outs > o0) out++;
  }
  return { rate: out / trials, stuck };
}

test('견제: 평소 리드는 가끔(2~25%), 도루 스타트 끊은 주자는 자주(35~85%) 아웃', () => {
  const a = pickoffOdds(false), b = pickoffOdds(true);
  assert.equal(a.stuck + b.stuck, 0);
  assert.ok(a.rate > 0.02 && a.rate < 0.25, `평소 ${a.rate}`);
  assert.ok(b.rate > 0.35 && b.rate < 0.85, `도루 ${b.rate}`);
});

test('타격 연습 모드: 아웃 없이 계속 진행 + 구종 고정', () => {
  const g = new Game({ emit: () => {}, sendTo: () => {} });
  g.addPlayer('me', '나'); g.applySettings({ mode: 'practice' }); g.start();
  g.handle('me', { t: 'ppick', type: 'SL' });
  const types = new Set();
  for (let i = 0; i < 60 * 90; i++) {
    g.tick(1 / 60);
    if (g.phase === 'pitching' && g.pitch && !g.pitch.swung && g.now > g.pitch.arrive - 0.02) {
      types.add(g.pitch.type);
      g.handle('me', { t: 'swing', pid: g.pitch.id, dt: 0, ax: 0, ay: 0.02, mode: 'contact' });
    }
  }
  assert.notEqual(g.phase, 'over');
  assert.ok(g.dy.sw >= 5, `타구 ${g.dy.sw}개`);
  assert.deepEqual([...types], ['SL']);
});

test('사람 타자(초보 흉내) 타율이 너무 낮거나 높지 않음 (.18~.45)', () => {
  const gs = (s) => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  let h = 0, ab = 0;
  for (let n = 0; n < 4; n++) {
    const game = new Game({}); game.addPlayer('me', 'me'); game.players.get('me').team = 'away';
    game.applySettings({ innings: 9, diff: 1, hitEase: 1 }); game.start();
    let steps = 0;
    while (game.phase !== 'over' && steps < 30 * 60 * 90) {
      game.tick(1 / 30); steps++;
      const p = game.pitch;
      if (game.phase === 'pitching' && game.batter.id === 'me' && !p.swung && game.now >= p.arrive - 0.03) {
        const z = inZone(p.tx, p.ty), brk = !['FB', 'TS'].includes(p.type);
        if ((z && Math.random() < 0.8) || (!z && Math.random() < 0.35)) game.handle('me', { t: 'swing', pid: p.id, dt: gs(0.1 * (brk ? 1.25 : 1)), ax: gs(0.14), ay: gs(0.14 * (brk ? 1.3 : 1)), mode: 'contact' });
      }
    }
    const st = game.stats.get('me'); if (st) { h += st.h; ab += st.pa - st.bb; }
  }
  const avg = h / ab;
  assert.ok(avg > 0.18 && avg < 0.45, `타율 ${avg.toFixed(3)}`);
});
