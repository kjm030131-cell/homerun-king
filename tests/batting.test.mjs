// 사람 타자 PCI + 타이밍 위주 타격 (docs/rebuild/gameplay.md 5절) · 바운드/경계 (6절)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, inZone, PCI, pciJudge, evalSwing, integrate, surface, standR, FOUL, WALL_FOUL, handOf, cpuBats } from '../shared/sim.js';

// 결정적 난수 (사람 흉내 테스트가 CI에서 운에 따라 깨지지 않게)
const seeded = (s) => () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const withSeed = (seed, fn) => { const r = Math.random; Math.random = seeded(seed); try { return fn(); } finally { Math.random = r; } };

test('PCI 판정: 타이밍 창 밖이면 커서가 정확해도 헛스윙, 안이면 빠름/늦음으로 구분', () => {
  const W = PCI.contact.W;
  assert.equal(pciJudge('contact', -W * 1.05, 0, 0).why, 'early');
  assert.equal(pciJudge('contact', W * 1.05, 0, 0).why, 'late');
  assert.equal(pciJudge('contact', 0, 0, 0).contact, true);
});

test('PCI 판정: 타이밍이 맞을수록 커서 판정이 넓어짐 (대충 맞춰도 맞음)', () => {
  const ax = PCI.contact.RX * 1.3; // 그려진 커서 밖 30%
  assert.equal(pciJudge('contact', 0, ax, 0).contact, true, '딱 맞는 타이밍이면 맞음');
  assert.equal(pciJudge('contact', PCI.contact.W * 0.8, ax, 0).contact, false, '타이밍이 끝자락이면 헛스윙');
  assert.ok(pciJudge('power', 0, ax, 0).contact === false, '강타는 커서가 작음');
});

test('PCI 판정은 결정적 (클라 즉시 판정 = 서버 판정)', () => {
  for (let i = 0; i < 200; i++) {
    const dt = (Math.random() - 0.5) * 0.25, ax = (Math.random() - 0.5) * 0.5, ay = (Math.random() - 0.5) * 0.5, e = 0.8 + Math.random() * 0.5;
    const a = pciJudge('contact', dt, ax, ay, e), b = pciJudge('contact', dt, ax, ay, e);
    assert.equal(a.contact, b.contact);
    const r = evalSwing('contact', dt, ax, ay, 40, e, true);
    assert.equal(!!r, a.contact, '서버 evalSwing 맞음 여부 = pciJudge');
  }
});

test('공이 커서 아래쪽 → 땅볼, 가운데 → 라인드라이브, 위쪽 → 뜬공 / 빠름 → 당겨치기', () => {
  const avg = (ay, dt = 0) => { let la = 0, sp = 0, n = 0; for (let i = 0; i < 600; i++) { const r = evalSwing('contact', dt, 0, ay, 40, 1, true, 1, 0); if (r && !r.foul) { la += r.launch; sp += r.spray; n++; } } return [la / n, sp / n]; };
  const RY = PCI.contact.RY;
  assert.ok(avg(RY * 0.8)[0] < 0, `커서가 공 위(공은 커서 아래쪽): ${avg(RY * 0.8)[0].toFixed(1)}°`);
  const mid = avg(0)[0]; assert.ok(mid > 5 && mid < 22, `가운데 ${mid.toFixed(1)}°`);
  assert.ok(avg(-RY * 0.8)[0] > 24, `커서가 공 아래(공은 커서 위쪽): ${avg(-RY * 0.8)[0].toFixed(1)}°`);
  assert.ok(avg(0, -PCI.contact.W * 0.6)[1] > 15, '빠르면 당겨서 좌측(+)');
  assert.ok(avg(0, PCI.contact.W * 0.6)[1] < -10, '늦으면 밀어서 우측(-)');
});

// [lefty] 좌타자: 판정은 같고 방향만 거울 — 빠르면 당겨서 우측(-), 늦으면 밀어서 좌측(+). CPU 타자 분포도 반전
test('좌타자: 당겨치기/밀어치기 방향 반전 + 타석·몸에 맞는 공 쪽 + 스위치는 투수 반대', () => {
  const avg = (hand, dt, human = true) => { let sp = 0, n = 0; for (let i = 0; i < 800; i++) { const r = evalSwing('contact', dt, 0, 0, 40, 1, human, 1, 0, hand); if (r && !r.foul && !r.bunt) { sp += r.spray; n++; } } return sp / n; };
  const W = PCI.contact.W;
  assert.ok(avg(-1, -W * 0.6) < -15, `좌타 빠름 → 우측(-): ${avg(-1, -W * 0.6).toFixed(1)}`);
  assert.ok(avg(-1, W * 0.6) > 10, `좌타 늦음 → 좌측(+): ${avg(-1, W * 0.6).toFixed(1)}`);
  assert.ok(avg(-1, -0.03, false) < -5 && avg(1, -0.03, false) > 5, 'CPU 타자도 반전');
  assert.equal(handOf('R'), 1); assert.equal(handOf('L'), -1); assert.equal(handOf('S'), -1); assert.equal(handOf(undefined), 1);
  // 경기: 사람 타자 좌타 설정 → s.bat.h = -1, CPU 타자는 구단·타순으로 정해진 값
  const g = new Game({}); g.addPlayer('me', 'me'); g.players.get('me').team = 'away'; g.applySettings({ innings: 1 });
  g.handle('me', { t: 'bats', v: 'L' }); g.start();
  assert.equal(g.batter.id, 'me'); assert.equal(g.snapshot().bat.h, -1);
  let L = 0; for (let s = 1; s <= 9; s++) if (handOf(cpuBats(3, 'home', s)) < 0) L++;
  assert.ok(L >= 1 && L <= 5, `CPU 좌타 ${L}/9`);
});

// 보통 사람 흉내(옛 '초보 흉내' 테스트와 같은 오차): 타이밍 σ 100ms(변화구 ×1.25), 커서 오차 σ 14cm(변화구 세로 ×1.25), 존 안 78%/밖 30% 스윙(2스트 90%/42%), 강타 25%
function human(rules, games, innings) {
  const gs = (s) => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  let h = 0, ab = 0, pa = 0, k = 0;
  for (let n = 0; n < games; n++) {
    const game = new Game({ rules }); game.addPlayer('me', 'me'); game.players.get('me').team = 'away';
    game.applySettings({ innings, diff: 1, hitEase: 1 }); game.start();
    let steps = 0;
    while (game.phase !== 'over' && steps < 30 * 60 * 120) {
      game.tick(game.phase === 'pitching' ? 1 / 120 : 1 / 30); steps++;
      const p = game.pitch;
      if (p && p._sw && !p.swung && game.phase === 'pitching' && game.now >= p.arrive + p._sw.dt) { const w = p._sw; p._sw = null; game.handle('me', { ...w.m, dt: game.now - p.arrive }); }
      if (game.phase === 'pitching' && game.batter.id === 'me' && !p.swung && !p._d && game.now >= p.arrive - 0.3) {
        p._d = 1;
        const z = inZone(p.tx, p.ty), brk = ['FB', 'TS'].includes(p.type) ? 1 : 1.25, two = game.strikes === 2;
        if ((z && Math.random() < (two ? 0.9 : 0.78)) || (!z && Math.random() < (two ? 0.42 : 0.3))) {
          p._sw = { dt: gs(0.1 * brk), m: { t: 'swing', pid: p.id, ax: gs(0.14), ay: gs(0.14 * brk), mode: !two && Math.random() < 0.25 ? 'power' : 'contact' } };
        }
      }
      game.events.length = 0;
    }
    const st = game.stats.get('me'); if (st) { h += st.h; ab += st.pa - st.bb; pa += st.pa; k += st.k; }
  }
  return { avg: h / ab, k: k / pa };
}
// [bugs 11-19] 파울 타구가 타석(pa)으로 세지던 버그를 고친 뒤 같은 흉내의 '진짜' 타율: 리얼 .281 → .341, 캐주얼 .354 → .463 (판정 수치는 그대로, 측정만 바로잡음)
test('보통 사람 흉내: 리얼 타율 .26~.41 · 삼진율 15~29% (파울 타석 버그 수정 후 기준)', () => {
  const r = withSeed(21, () => human('real', 24, 9)); // [qa 11-19] 12판은 시드 하나가 삼진율 14%대로 튐(5개 시드 평균 17.6%)
  assert.ok(r.avg > 0.26 && r.avg < 0.41, `리얼 타율 ${r.avg.toFixed(3)}`);
  assert.ok(r.k > 0.15 && r.k < 0.29, `리얼 삼진율 ${(r.k * 100).toFixed(1)}%`);
});
test('보통 사람 흉내: 캐주얼 타율 .36~.55 (파울 타석 버그 수정 후 기준)', () => {
  const r = withSeed(22, () => human('casual', 18, 3));
  assert.ok(r.avg > 0.36 && r.avg < 0.55, `캐주얼 타율 ${r.avg.toFixed(3)}`);
});

test('지면 재질이 새 경기장 그림과 같음 (내야 흙 = 29m 원 ∩ 파울라인 바깥 1.8m)', () => {
  assert.equal(surface(0, 18.44), 'dirt', '마운드');
  assert.equal(surface(0, 24), 'grass', '내야 잔디');
  assert.equal(surface(-10, 38), 'dirt', '2루 뒤 내야 흙');
  // 3루 라인 바깥 1m 는 흙, 4m 는 잔디 (예전 sim은 둘 다 흙)
  const along = 20, out = (d) => [along * Math.SQRT1_2 + d * Math.SQRT1_2, along * Math.SQRT1_2 - d * Math.SQRT1_2];
  assert.equal(surface(...out(1)), 'dirt');
  assert.equal(surface(...out(4)), 'grass');
  assert.equal(surface(0, 121), 'dirt', '워닝트랙');
});

test('파울 지역 벽(1.25m)에 맞으면 튀어나옴 · 벽보다 높으면 넘어감', () => {
  const phi = FOUL + 0.3, R = standR(phi), ux = Math.sin(phi), uz = Math.cos(phi);
  const roll = (y, vy) => { const b = { x: ux * (R - 3), y, z: uz * (R - 3), vx: ux * 12, vy, vz: uz * 12, sx: 0, sy: 0, sz: 0, state: y > 0.1 ? 'air' : 'ground' }; let hit = false; for (let i = 0; i < 120; i++) { const e = integrate(b, 1 / 120); if (e.fwall) hit = true; } return { hit, r: Math.hypot(b.x, b.z) }; };
  const low = roll(0.037, 0); assert.ok(low.hit && low.r < R, `땅볼: 벽 맞고 안쪽 (r ${low.r.toFixed(1)} < ${R.toFixed(1)})`);
  const high = roll(WALL_FOUL + 1.2, 3); assert.ok(!high.hit && high.r > R, '높은 공은 관중석으로');
});

test('사람 타구는 스윙 순간부터 굴려서 시작 (핑 지연만큼 뒤처지지 않음)', () => {
  const rnd = Math.random; Math.random = () => 0.5;
  const g = new Game({}); g.addPlayer('me', 'me'); g.players.get('me').team = 'away'; g.applySettings({ innings: 1 }); g.start();
  let i = 0; while (!(g.phase === 'pitching' && g.batter.id === 'me') && i < 30 * 60 * 10) { g.tick(1 / 30); i++; }
  while (g.phase === 'pitching' && g.now < g.pitch.arrive + 0.08) g.tick(1 / 120);
  Math.random = rnd;
  if (g.phase !== 'pitching') return; // 드물게 견제 등
  g.handle('me', { t: 'swing', pid: g.pitch.id, dt: 0, ax: 0, ay: 0, mode: 'contact' }); // 0.08초 늦게 도착한 '딱 맞는' 스윙
  if (g.phase !== 'live' || !g.ball || g.ball.holder >= 0) return;
  const d = Math.hypot(g.ball.x - g.pitch.tx, g.ball.y - Math.max(0.3, g.pitch.ty), g.ball.z - 0.3), v = Math.hypot(g.ball.vx, g.ball.vy, g.ball.vz);
  assert.ok(d > v * 0.08 * 0.6, `0.08초만큼 앞에서 출발 (${d.toFixed(2)}m, 속도 ${v.toFixed(1)}m/s)`);
});
