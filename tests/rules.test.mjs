// 야구 규칙 회귀 테스트 — tools/qa/rules.mjs(규칙 검사기)로 찾은 버그들 (docs/rebuild/qa.md "규칙 검사기")
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, battedBall, BASES } from '../shared/sim.js';
import { runGame } from '../tools/qa/rules.mjs';

const seeded = (s) => () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const withSeed = (seed, fn) => { const r = Math.random; Math.random = seeded(seed); try { return fn(); } finally { Math.random = r; } };

// 투구 직전까지 진행한 경기 (CPU끼리)
function atPitch(set = {}) {
  const g = new Game({}); g.applySettings({ mode: 'game', innings: 9, pitRot: 'fixed', ...set }); g.start();
  for (let i = 0; i < 60 * 30 && g.phase !== 'pitch'; i++) g.tick(1 / 60);
  return g;
}
const runner = (g, b, extra = {}) => ({ ...g.mkRunner(b, false), b, target: b, start: b, ...extra });
// 투구 중간에 타구를 직접 만들어 인플레이 시작 (스윙 판정 난수 없이)
function hit(g, res) {
  g.pitchDeadline = g.now; g.pickTried = true;
  for (let i = 0; i < 600 && g.phase !== 'pitching'; i++) g.tick(1 / 60);
  g.aiSwing = null; const p = g.pitch; p.swung = true; p.res = 'hit';
  g.ball = Object.assign(battedBall(0, 0.85, res), { batted: true, bounced: false, touched: false, fair: null, holder: -1, thrower: -1, throwAt: 0, ev: Math.round(res.v * 3.6), bunt: false });
  g.startPlay();
}
const until = (g, cond, sec = 30) => { for (let i = 0; i < sec * 60 && !cond(); i++) g.tick(1 / 60); };

test('규칙 검사기: AI끼리 리얼 9이닝·캐주얼 경기에서 규칙 위반 0', () => {
  const bad = [];
  for (const [rules, seeds] of [['real', [1, 3, 5, 13, 99]], ['casual', [1, 2, 3, 4, 5, 6, 7, 8]]]) {
    for (const seed of seeds) { const r = runGame({ seed, rules }); for (const v of r.violations) bad.push(`${rules} seed ${seed}: ${v.kind} ${v.msg}`); }
  }
  assert.deepEqual(bad.slice(0, 8), []);
});

test('규칙 검사기: 사람 무작위 입력(도루·진루/귀루·송구) 섞어도 위반 0', () => {
  const bad = [];
  for (const seed of [100, 101, 102, 103, 104, 105]) { const r = runGame({ seed, rules: 'casual', fuzz: true }); for (const v of r.violations) bad.push(`seed ${seed}: ${v.kind} ${v.msg}`); }
  assert.deepEqual(bad.slice(0, 8), []);
});

test('파울 판정 전에 홈을 밟은 3루 주자 득점은 파울이면 취소', () => withSeed(5, () => {
  const g = atPitch(); g.outs = 2; g.runners = [runner(g, 3)];
  hit(g, { v: 44, launch: 42, spray: 52, q: 0.5 }); // 높이 뜬 파울 플라이 (체공 6초+)
  let scored = 0; const o = g.ev.bind(g); g.ev = (e, d) => { if (e === 'score') scored++; return o(e, d); };
  until(g, () => g.phase !== 'live');
  assert.ok(scored >= 1, '주자가 파울 확정 전에 홈을 밟는 상황이어야 함');
  assert.equal(g.score[0], 0, '파울이면 득점 없음');
  assert.equal(g.runners.filter((r) => !r.out && !r.scored && !r.ghostBack).map((r) => r.target).join(), '3', '주자는 3루로 복귀(걸어서 돌아가는 중일 수 있음)');
}));

test('2아웃 뜬공 포구(3아웃): 포구 전에 들어온 주자 득점은 무효', () => {
  let caught = 0;
  for (let s = 1; s <= 12; s++) withSeed(s, () => {
    const g = atPitch(); g.outs = 2; g.runners = [runner(g, 3)];
    hit(g, { v: 37, launch: 34, spray: 2, q: 0.6 }); // 중견수 앞 깊은 뜬공 (체공 ~5초)
    until(g, () => g.phase !== 'live');
    if (g.outs === 3 && /플라이|무효|직선타|캐치/.test(g.msg + (g.events.find((e) => e.e === 'out' && e.kind === 'fly') ? '플라이' : ''))) { caught++; assert.equal(g.score[0], 0, `seed ${s}: 3아웃 뜬공인데 득점 ${g.score[0]}`); }
  });
  assert.ok(caught >= 3, `잡힌 뜬공 ${caught}개`);
});

test('타자주자가 1루에서 아웃되면 앞 주자 포스가 풀림 (역포스 금지)', () => {
  const g = atPitch(); g.runners = [runner(g, 1)];
  hit(g, { v: 30, launch: -8, spray: -30, q: 0.4 });
  const br = g.runners.find((r) => r.batter), r1 = g.runners.find((r) => r.start === 1);
  assert.ok(r1.forced, '처음엔 1루 주자 포스 상태');
  br.b = 0.7; r1.b = 1.4; g.ball.holder = 2; g.ball.state = 'held';
  g.outRunner(br, 'force');
  assert.equal(r1.forced, false, '타자 아웃 뒤엔 태그해야 아웃');
});

test('파울은 타석 수(pa)를 안 올림 · 스리번트 파울 삼진은 1타석', () => withSeed(3, () => {
  const g = atPitch(); const key = () => g.stats.get('cpu:away' + g.batter.name);
  hit(g, { v: 30, launch: -5, spray: 70, q: 0.3 }); // 3루 쪽 파울 땅볼
  until(g, () => g.phase !== 'live');
  assert.equal(g.strikes, 1);
  assert.equal(key().pa, 0, '파울 뒤 타석 0');
}));

test('견제사·도루사로 3아웃이면 그 타자가 다음 이닝 첫 타자', () => {
  const g = atPitch(); g.outs = 2; const n0 = g.batter.n, name = g.batter.name;
  g.runners = [runner(g, 1)];
  g.onPick('cpu', { base: 1 }); g.runners[0].b = 1.6; g.runners[0].pickWait = g.now + 9; // 리드가 커서 못 돌아옴
  until(g, () => g.phase !== 'live', 10);
  assert.equal(g.outs, 3, '견제사');
  until(g, () => g.half === 1 && g.phase === 'pitch', 60);
  until(g, () => g.half === 0 && g.inning === 2 && g.phase === 'pitch', 900);
  assert.equal(g.batter.n, n0, `같은 타순(${name})이 다시 나와야 함`);
});

test('타자주자는 홈으로 귀루하지 않음 (진루 포기 시 1루에 멈춤) · 사람 귀루 명령도', () => {
  const g = atPitch(); g.addPlayer('A', 'A'); g.players.get('A').team = 'away';
  hit(g, { v: 30, launch: -8, spray: 20, q: 0.4 });
  const br = g.runners.find((r) => r.batter);
  br.b = 0.6; br.target = 2; br.forced = false; g.now = g.play.t0 + 1;
  g.handle('A', { t: 'run', go: false });
  assert.equal(br.target, 2, '타자주자는 귀루 명령 무시');
  g.runAI(1 / 60); g.ball.holder = 5; g.ball.state = 'held'; br.manual = 0;
  for (let i = 0; i < 5; i++) g.runAI(1 / 60);
  assert.ok(br.target >= 1, `타자주자 목표 ${br.target}`);
});

test('사람 진루 명령: 한 베이스로 두 주자가 가지 않음', () => {
  const g = atPitch(); g.addPlayer('A', 'A'); g.players.get('A').team = 'away'; g.runners = [runner(g, 1)];
  hit(g, { v: 30, launch: -8, spray: 20, q: 0.4 });
  const br = g.runners.find((r) => r.batter), r1 = g.runners.find((r) => r.start === 1);
  br.b = 1; br.target = 1; r1.b = 1.5; r1.target = 2; g.now = g.play.t0 + 2;
  g.handle('A', { t: 'run', go: true });
  assert.notEqual(br.target, r1.target, `타자 ${br.target} / 1루 주자 ${r1.target}`);
});

test('끝내기: 라인스코어 마지막 이닝 채움 · 결승점 뒤 득점은 인정 안 함', () => withSeed(2, () => {
  const g = atPitch({ innings: 1 });
  until(g, () => g.half === 1 && g.phase === 'pitch', 600);
  g.score = [0, 0]; g.outs = 0; g.runners = [runner(g, 2), runner(g, 3)];
  // 3루 주자 득점(결승점) 뒤 2루 주자까지 들어와도 1점만
  g.addRun(g.runners[1]); g.runners[1].scored = true;
  g.addRun(g.runners[0]); g.runners[0].scored = true;
  assert.deepEqual(g.score, [0, 1]);
  g.pause(0.1, 'next'); until(g, () => g.phase === 'over', 5);
  assert.equal(g.line[1][0], 1, '끝내기 이닝 라인스코어');
}));

test('송구가 관중석으로 나가면 악송구 실책 기록', () => {
  const g = atPitch(); g.runners = [runner(g, 1)];
  hit(g, { v: 30, launch: -8, spray: 20, q: 0.4 });
  g.ball.state = 'thrown'; g.ball.batted = false; g.ball.thrower = 5; g.ball.holder = -1;
  const e0 = g.errs[1];
  g.groundRule('악송구 · 안전진루');
  assert.equal(g.errs[1], e0 + 1);
});

test('이미 그 베이스 위에서 같은 베이스로 송구 = 무시(공을 떨어뜨리지 않음)', () => {
  const g = atPitch(); g.addPlayer('H', 'H'); g.players.get('H').team = 'home';
  hit(g, { v: 30, launch: -8, spray: -20, q: 0.4 });
  const f = g.fielders[2]; f.x = BASES[1][0]; f.z = BASES[1][1]; f.ctrl = 'H';
  g.ball.holder = 2; g.ball.state = 'held'; g.play.holderSince = g.now - 1;
  g.handle('H', { t: 'throw', base: 1, p: 0.5 });
  assert.equal(g.ball.state, 'held');
});
