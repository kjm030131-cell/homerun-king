// 캐주얼 모드: 멈춤 없음 · 짧은 판 · 득점/장타 범위 · 규칙(승부치기·콜드·시간제) · 리얼보다 타격 쉬움
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, RULES, inZone } from '../shared/sim.js';

// 결정적 난수 (사람 흉내 테스트가 CI에서 운에 따라 깨지지 않게)
const seeded = (s) => () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const withSeed = (seed, fn) => { const r = Math.random; Math.random = seeded(seed); try { return fn(); } finally { Math.random = r; } };

function aiGames(n, rules = 'casual', set = {}) {
  let runs = 0, hr = 0, stuck = 0, maxMin = 0, lc = 0, inn = 0;
  for (let g = 0; g < n; g++) {
    const game = new Game({ rules }); game.applySettings(set); game.start();
    let i = 0, lead = 0;
    while (game.phase !== 'over' && i < 30 * 60 * 60) {
      game.tick(1 / 30); i++;
      for (const e of game.takeEvents()) {
        if (e.e === 'hr') hr++;
        if (e.e === 'score') { const d = Math.sign(e.sc[0] - e.sc[1]); if (d && lead && d !== lead) lc++; if (d) lead = d; }
      }
    }
    if (game.phase !== 'over') stuck++;
    runs += game.score[0] + game.score[1]; maxMin = Math.max(maxMin, game.now / 60); inn += game.inning;
  }
  return { runs: runs / n / 2, hr: hr / n / 2, stuck, maxMin, lc: lc / n, inn: inn / n };
}

test('캐주얼 AI 3이닝 40판: 멈춤 없음 · 팀당 득점 1.6~5.5 · 홈런 팀당 0.4개 이상 · 가장 긴 판 30분 이내', () => {
  const r = aiGames(40);
  assert.equal(r.stuck, 0, '끝나지 않은 경기');
  assert.ok(r.runs > 1.6 && r.runs < 5.5, `팀당 득점 ${r.runs.toFixed(2)}`);
  assert.ok(r.hr > 0.4, `팀당 홈런 ${r.hr.toFixed(2)}`);
  assert.ok(r.maxMin < 30, `가장 긴 경기 ${r.maxMin.toFixed(1)}분`);
  assert.ok(r.inn <= 4.01, `평균 ${r.inn}이닝 (연장 최대 1회)`);
});

test('캐주얼 설정: 기본 3이닝 · 수비 자동 전환 · 판정 폭(hx)이 리얼보다 넓음', () => {
  const g = new Game({}); g.addPlayer('a', 'A');
  const real = g.snapshot().hx ?? null;
  g.applySettings({ rules: 'casual' });
  assert.equal(g.set.innings, RULES.casual.innings);
  assert.equal(g.set.fieldCtl, 'auto');
  g.start(); for (let i = 0; i < 200; i++) g.tick(1 / 60);
  const s = g.snapshot();
  assert.equal(s.ru, 'casual');
  const g2 = new Game({}); g2.addPlayer('a', 'A'); g2.applySettings({ rules: 'real', innings: 3 }); g2.start(); g2.tick(1 / 60);
  assert.ok(s.hx > g2.snapshot().hx * 1.04, `casual ${s.hx} vs real ${g2.snapshot().hx}`);
  void real;
});

test('승부치기: 캐주얼 연장 이닝은 무사 1·2루에서 시작', () => {
  const g = new Game({ rules: 'casual' }); g.start();
  g.inning = 4; g.half = 0; g.score = [2, 2];
  g.startHalf();
  const bases = g.runners.map((r) => r.b).sort();
  assert.deepEqual(bases, RULES.casual.ghost);
});

test('콜드게임: 캐주얼 2회 끝에 10점 차면 종료', () => {
  const g = new Game({ rules: 'casual' }); g.applySettings({ innings: 5 }); g.start();
  g.inning = 2; g.half = 1; g.score = [12, 1]; g.halfRuns = 0;
  g.endHalf();
  assert.equal(g.phase, 'over');
  const ev = g.takeEvents().map((e) => e.e);
  assert.ok(ev.includes('gameEnd'));
});

test('시간제: 제한 시간이 지나면 다음 이닝이 마지막 이닝', () => {
  const g = new Game({ rules: 'casual' }); g.applySettings({ innings: 9, timeLim: 3 }); g.start();
  let i = 0;
  while (g.phase !== 'over' && i < 30 * 60 * 60) { g.tick(1 / 30); i++; }
  assert.equal(g.phase, 'over');
  assert.ok(g.inning < 9, `${g.inning}회에 끝남`);
});

test('같은 스윙 실력이면 캐주얼 타율이 리얼보다 높음', () => {
  // 서툰 사람 흉내(타이밍 σ 140ms, 커서 오차 σ 20cm) — 공마다 한 번만 스윙 여부 결정
  const gs = (s) => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const avg = (rules, games, innings) => {
    let h = 0, ab = 0;
    for (let n = 0; n < games; n++) {
      const game = new Game({ rules }); game.addPlayer('me', 'me'); game.players.get('me').team = 'away';
      game.applySettings({ innings, diff: 1, hitEase: 1 }); game.start();
      let steps = 0;
      while (game.phase !== 'over' && steps < 30 * 60 * 90) {
        game.tick(game.phase === 'pitching' ? 1 / 120 : 1 / 30); steps++;
        const p = game.pitch;
        if (p && p._sw && !p.swung && game.phase === 'pitching' && game.now >= p.arrive + p._sw.dt) { const w = p._sw; p._sw = null; game.handle('me', { ...w.m, dt: game.now - p.arrive }); }
        if (game.phase === 'pitching' && game.batter.id === 'me' && !p.swung && !p._d && game.now >= p.arrive - 0.3) {
          p._d = 1;
          const z = inZone(p.tx, p.ty);
          if ((z && Math.random() < 0.8) || (!z && Math.random() < 0.3)) p._sw = { dt: gs(0.14), m: { t: 'swing', pid: p.id, ax: gs(0.2), ay: gs(0.2), mode: 'contact' } };
        }
        game.events.length = 0;
      }
      const st = game.stats.get('me'); if (st) { h += st.h; ab += st.pa - st.bb; }
    }
    return h / ab;
  };
  const r = withSeed(11, () => avg('real', 12, 9)), c = withSeed(12, () => avg('casual', 30, 3)); // [qa 11-19] 6/15판은 표본이 작아 송구 궤적만 바뀌어도 흔들림(큰 표본에선 차이 0.06~0.07)
  assert.ok(c > r + 0.03, `캐주얼 ${c.toFixed(3)} vs 리얼 ${r.toFixed(3)}`);
  assert.ok(c > 0.18 && c < 0.5, `캐주얼 타율 ${c.toFixed(3)}`);
});
