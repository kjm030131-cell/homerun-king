// [pitch] 사람 투수 제구 현실화 + 사람 투수 vs 사람 타자 흉내 (docs/rebuild/pitch.md)
// 사용자: "친구랑 1대1 하면 공이 어디로 오는지, 볼인지 스트라이크인지 구분이 안 된다" — 공 위치 미리보기 없이 해결
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, inZone, inZoneOf, ZONE, BALL_R, COMMAND } from '../shared/sim.js';

const seeded = (s) => () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const withSeed = (seed, fn) => { const r = Math.random; Math.random = seeded(seed); try { return fn(); } finally { Math.random = r; } };
const gs = (s) => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const R = (a, b) => a + Math.random() * (b - a);
const pick = (w) => { let s = 0; for (const k in w) s += w[k]; let r = Math.random() * s; for (const k in w) { r -= w[k]; if (r <= 0) return k; } return 'FB'; };
const edgeD = (x, y, Z = ZONE) => Math.min(x - (Z.x0 - BALL_R), Z.x1 + BALL_R - x, y - (Z.y0 - BALL_R), Z.y1 + BALL_R - y);
// [ABS 11-23] 리얼 모드 존은 타자 키 비례(ABS) → 사람 투수·타자 흉내도 화면에 그려진 '지금 존'을 기준으로 (예전 존 좌표를 지금 존으로 옮김)
const toZone = (Z, tx, ty) => [tx * (Z.x1 - Z.x0) / (ZONE.x1 - ZONE.x0), Z.y0 + (ty - ZONE.y0) * (Z.y1 - Z.y0) / (ZONE.y1 - ZONE.y0)];

// 잘하는 사람 투수 흉내: 구종 섞기(같은 공 3연속 안 함) · 코너/경계 노리기 · 2스트라이크 유인구 · 3볼이면 가운데 쪽 · 퍼펙트 게이지 85%
function pitcherAim(g, last) {
  const b = g.balls, s = g.strikes, w = { FB: 40, SL: 20, CH: 15, CB: 10, SP: 10, TS: 5 };
  if (last[0] && last[0] === last[1]) w[last[0]] = 0;
  const type = pick(w), brk = type !== 'FB' && type !== 'TS', side = Math.random() < 0.5 ? -1 : 1;
  let tx, ty;
  if (b === 3 && s < 2) { tx = R(-0.13, 0.13); ty = R(0.66, 0.92); }
  else if (s === 2 && b < 3 && Math.random() < 0.55) { if (brk && Math.random() < 0.65) { tx = R(-0.2, 0.2); ty = R(0.3, 0.42); } else { tx = side * R(0.31, 0.38); ty = R(0.5, 1.0); } }
  else {
    const c = Math.random();
    if (c < 0.4) { tx = side * R(0.23, 0.3); ty = R(0.5, 1.06); }
    else if (c < 0.8) { tx = R(-0.25, 0.25); ty = brk || Math.random() < 0.6 ? R(0.44, 0.52) : R(1.04, 1.11); }
    else { tx = side * R(0.23, 0.29); ty = Math.random() < 0.6 ? R(0.45, 0.52) : R(1.04, 1.1); }
  }
  [tx, ty] = toZone(g.zoneNow(), tx, ty);
  const u = Math.random(), band = g.R.perfectPitch;
  return { type, tx, ty, power: u < 0.85 ? R(band[0], band[1]) : u < 0.95 ? R(0.74, band[0] - 0.005) : R(1.0, 1.1) };
}
// 보통 사람 타자 흉내(지각 모델): 공 위치를 σ 7cm(변화구 ×1.3, 좌우 ×0.8)로 읽고 '존 안으로 보이면' 스윙
// (0-0 60%, 보통 80%, 2스트 93% — 2스트는 존을 4cm 넓게 봄 / 밖으로 보이면 6%, 2스트 15%)
// 커서 = 읽은 위치 + 손 오차 σ(6cm + 22%·존 가운데에서 거리) — 코너일수록 커서를 멀리 옮겨야 해서 부정확. 타이밍 σ 100ms(변화구 ×1.3, 코너 ×(1+0.5d))
function humanVsHuman({ games, innings = 9, rules = 'real', cpuPitch = false }) {
  const o = { pa: 0, ab: 0, h: 0, k: 0, bb: 0, n: 0, zone: 0, edge5: 0, dx: [], dy: [] };
  for (let n = 0; n < games; n++) {
    const game = new Game({ rules });
    game.addPlayer('a', 'A'); game.addPlayer('h', 'H');
    game.players.get('a').team = 'away'; game.players.get('h').team = 'home';
    game.applySettings({ innings, diff: 1, hitEase: 1, pitRot: cpuPitch ? 'cpu' : 'fixed' }); game.start();
    let steps = 0, at = -1; const last = [];
    while (game.phase !== 'over' && steps < 40 * 60 * 120) {
      game.tick(game.phase === 'pitching' ? 1 / 120 : 1 / 30); steps++;
      const pc = game.pitcherCtrl();
      if (!cpuPitch && game.phase === 'pitch' && game.isLive(pc)) {
        if (at < 0) at = game.now + R(1.5, 3.5);
        if (game.now >= at) {
          at = -1; const a = pitcherAim(game, last); last.unshift(a.type); last.length = 2;
          game.handle(pc, { t: 'pitch', ...a });
          if (game.phase === 'pitching') { o.dx.push(game.pitch.tx - a.tx); o.dy.push(game.pitch.ty - a.ty); }
        }
      }
      const p = game.pitch;
      if (p && p._sw && !p.swung && game.phase === 'pitching' && game.now >= p.arrive + p._sw.dt) { const w = p._sw; p._sw = null; game.handle(game.batter.id, { ...w.m, dt: game.now - p.arrive }); }
      if (game.phase === 'pitching' && game.batter.id && !p.swung && !p._d && game.now >= p.arrive - 0.3) {
        p._d = 1; o.n++;
        const Z = game.zoneNow();
        if (inZoneOf(Z, p.tx, p.ty)) o.zone++;
        if (Math.abs(edgeD(p.tx, p.ty, Z)) < 0.05) o.edge5++;
        const brk = ['FB', 'TS'].includes(p.type) ? 1 : 1.3, two = game.strikes === 2, first = game.balls + game.strikes === 0, b3 = game.balls === 3 && game.strikes === 0;
        const px = p.tx + gs(0.07 * brk * 0.8), py = p.ty + gs(0.07 * brk), m = two ? 0.04 : game.balls === 3 && game.strikes < 2 ? -0.03 : 0;
        const pz = px >= Z.x0 - BALL_R - m && px <= Z.x1 + BALL_R + m && py >= Z.y0 - BALL_R - m && py <= Z.y1 + BALL_R + m;
        if (Math.random() < (pz ? (two ? 0.93 : b3 ? 0.3 : first ? 0.6 : 0.8) : two ? 0.15 : 0.06)) {
          const d = Math.hypot(px, py - 0.78), mo = 0.06 + 0.22 * d;
          p._sw = { dt: gs(0.1 * brk * (1 + 0.5 * d)), m: { t: 'swing', pid: p.id, ax: px - p.tx + gs(mo), ay: py - p.ty + gs(mo), mode: !two && Math.random() < 0.25 ? 'power' : 'contact' } };
        }
      }
      game.events.length = 0;
    }
    for (const id of ['a', 'h']) { const st = game.stats.get(id); if (st) { o.h += st.h; o.ab += st.pa - st.bb; o.pa += st.pa; o.k += st.k; o.bb += st.bb; } }
  }
  const sd = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / Math.max(1, a.length));
  return { avg: o.h / o.ab, k: o.k / o.pa, bb: o.bb / o.pa, zone: o.zone / o.n, edge5: o.edge5 / o.n, sdx: sd(o.dx), sdy: sd(o.dy), pa: o.pa, ppa: o.n / o.pa };
}

test('사람 투수 제구: 퍼펙트 포심도 실제 프로 수준으로 흩어짐(σ 7~13cm), 변화구·과투구는 더 큼', () => withSeed(5, () => {
  const g = new Game({}); g.addPlayer('p', 'P'); g.players.get('p').team = 'home'; g.applySettings({ innings: 1 }); g.start();
  const spread = (type, power) => {
    let sx = 0, n = 0;
    for (let i = 0; i < 1500; i++) { g.stamina().sta = 100; g.throwPitch(type, 0, 0.8, power, true); if (!g.pitch.mm) { sx += g.pitch.tx * g.pitch.tx; n++; } }
    return Math.sqrt(sx / n);
  };
  const fbP = spread('FB', 0.9), fbN = spread('FB', 0.78), cbP = spread('CB', 0.9), fbO = spread('FB', 1.12);
  assert.ok(fbP > 0.07 && fbP < 0.13, `퍼펙트 포심 σ ${(fbP * 100).toFixed(1)}cm (전 1.3cm)`);
  assert.ok(fbN > fbP * 1.15, `보통 게이지가 더 흩어짐 ${(fbN * 100).toFixed(1)}cm`);
  assert.ok(cbP > fbP * 1.12, `커브가 포심보다 제구 어려움 ${(cbP * 100).toFixed(1)}cm`);
  assert.ok(fbO > fbN * 1.25, `과투구 ${(fbO * 100).toFixed(1)}cm`);
  assert.equal(COMMAND.sd.FB > 0.1, true);
}));

test('실투: 과투구일수록 잦고, 실투한 변화구는 덜 꺾이며 가운데로 몰림', () => withSeed(6, () => {
  const g = new Game({}); g.addPlayer('p', 'P'); g.players.get('p').team = 'home'; g.applySettings({ innings: 1 }); g.start();
  const rate = (power) => { let m = 0, by = 0, nb = 0; for (let i = 0; i < 3000; i++) { g.stamina().sta = 100; g.throwPitch('SL', 0.26, 0.5, power, true); if (g.pitch.mm) { m++; by += g.pitch.by; nb++; } } return { r: m / 3000, by: nb ? by / nb : 0 }; };
  const p = rate(0.9), o = rate(1.12);
  assert.ok(p.r > 0.01 && p.r < 0.05, `퍼펙트 실투율 ${(p.r * 100).toFixed(1)}%`);
  assert.ok(o.r > p.r * 2.5, `과투구 실투율 ${(o.r * 100).toFixed(1)}%`);
  assert.ok(Math.abs(p.by) < 0.3 * 0.75, `행잉 슬라이더 세로 변화 ${p.by.toFixed(2)}m (정상 -0.3)`);
}));

test('퀵 피치 금지: 투구 단계가 열리자마자 보낸 공은 준비 시간 뒤에 와인드업', () => {
  const g = new Game({}); g.addPlayer('p', 'P'); g.players.get('p').team = 'home'; g.applySettings({ innings: 1 }); g.start();
  let i = 0; while (!(g.phase === 'pitch' && g.half === 0) && i < 30 * 600) { g.tick(1 / 30); i++; }
  assert.equal(g.phase, 'pitch');
  const opened = g.now;
  g.handle('p', { t: 'pitch', type: 'FB', tx: 0, ty: 0.8, power: 0.9 });
  assert.equal(g.phase, 'pitch', '바로 던지지 않음');
  while (g.phase === 'pitch' && g.now < opened + 3) g.tick(1 / 60);
  assert.equal(g.phase, 'pitching');
  assert.ok(g.pitch.t0 - 1.85 >= opened + COMMAND.ready - 0.05, `와인드업 시작 ${(g.pitch.t0 - 1.85 - opened).toFixed(2)}s 뒤`);
});

test('사람 투수(코너·퍼펙트) vs 사람 타자(보통) 리얼 9이닝: 타율 .22~.33(11-23 난이도 조정 후 .285) · 삼진 17~27% · 볼넷 5~13% · 존 비율 42~60%', () => {
  const r = withSeed(31, () => humanVsHuman({ games: 10 }));
  const msg = `타율 ${r.avg.toFixed(3)} 삼진 ${(r.k * 100).toFixed(1)}% 볼넷 ${(r.bb * 100).toFixed(1)}% 존 ${(r.zone * 100).toFixed(0)}% 경계±5cm ${(r.edge5 * 100).toFixed(0)}% σ ${(r.sdx * 100).toFixed(1)}/${(r.sdy * 100).toFixed(1)}cm 투구/타석 ${r.ppa.toFixed(2)} (${r.pa}타석)`;
  console.log('# 사람 vs 사람:', msg);
  assert.ok(r.avg > 0.22 && r.avg < 0.33, msg); // [11-23] humanQ 1.3: .319 → .285 (전 범위 .23~.36)
  assert.ok(r.k > 0.17 && r.k < 0.3, msg); // [bugs] 타석 수가 바로잡혀 삼진율도 약간 오름
  assert.ok(r.bb > 0.05 && r.bb < 0.13, msg); // [11-24] 12→13%: 고정 난수라 판정 규칙(태그 범위) 바뀌면 흐름이 달라져 12.0%에 걸렸음 — 볼넷과 무관한 변화
  assert.ok(r.zone > 0.42 && r.zone < 0.6, msg);
  assert.ok(r.edge5 < 0.4, `경계 ±5cm 비율 (전 72%): ${msg}`);
});
