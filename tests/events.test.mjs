// 게임 이벤트(Game.events → 스냅샷 ev): REBUILD.md 4-1 이름 전부 발생 + 필드 + 공 위치 미리보기 없음
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../shared/sim.js';

const REQUIRED = ['windup', 'release', 'swing', 'contact', 'foul', 'miss', 'ballCall', 'strikeCall', 'catch', 'throw', 'tag', 'out', 'safe', 'hr', 'score', 'steal', 'slide', 'dive', 'inningEnd', 'gameEnd', 'modeChange'];

// AI 경기를 돌리며 Room DO 처럼 2틱마다 snapshot(true)로 이벤트를 꺼냄
function collect(maxGames = 10) {
  const seen = new Map(); let games = 0;
  const all = [];
  while (games < maxGames && REQUIRED.some((e) => !seen.has(e))) {
    const g = new Game({ rules: 'real' }); g.set.innings = 9; g.start();
    let i = 0;
    while (g.phase !== 'over' && i < 60 * 60 * 90) {
      g.tick(1 / 60);
      if (++i % 2 === 0) { const s = JSON.parse(JSON.stringify(g.snapshot(true))); for (const e of s.ev || []) { if (!seen.has(e.e)) seen.set(e.e, e); if (all.length < 4000) all.push(e); } }
    }
    for (const e of g.takeEvents()) if (!seen.has(e.e)) seen.set(e.e, e);
    games++;
  }
  return { seen, all, games };
}
const R = collect();

test('이벤트 이름 21개 전부 AI 경기에서 발생', () => {
  const miss = REQUIRED.filter((e) => !R.seen.has(e));
  assert.deepEqual(miss, [], `안 나온 이벤트 (${R.games}경기)`);
});

test('이벤트 공통 필드(e, at)와 주요 데이터 필드', () => {
  for (const e of R.all) { assert.equal(typeof e.e, 'string'); assert.equal(typeof e.at, 'number'); }
  const w = R.seen.get('windup');
  for (const k of ['pid', 'rel', 'arr', 'set', 'kick', 'peak', 'dur']) assert.ok(k in w, `windup.${k}`);
  assert.ok(Math.abs(w.rel - w.at - w.dur) < 0.02, '릴리스 = windup 시각 + WINDUP');
  const c = R.seen.get('contact');
  for (const k of ['pid', 'grade', 'kind', 'ev', 'la', 'pow', 'dt']) assert.ok(k in c, `contact.${k}`);
  assert.ok(['perfect', 'good', 'ok', 'weak', 'tip', 'bunt'].includes(c.grade));
  for (const k of ['type', 'kmh', 'arr']) assert.ok(k in R.seen.get('release'), `release.${k}`);
  for (const k of ['sc', 'half']) assert.ok(k in R.seen.get('score'), `score.${k}`);
  for (const k of ['kind', 'outs']) assert.ok(k in R.seen.get('out'), `out.${k}`);
  for (const k of ['i', 'pos', 'to']) assert.ok(k in R.seen.get('throw'), `throw.${k}`);
  for (const k of ['sc', 'win']) assert.ok(k in R.seen.get('gameEnd'), `gameEnd.${k}`);
  // 사운드 파트 요청 필드
  for (const k of ['pid', 'q', 'ev', 'la', 'mode', 'foul']) assert.ok(k in c, `contact.${k}`);
  for (const k of ['b', 's', 'o', 'on', 'sc']) assert.ok(k in w, `windup.${k}`);
  for (const k of ['pitch', 'kmh', 'x', 'z', 'dive']) assert.ok(k in R.seen.get('catch'), `catch.${k}`);
  for (const n of ['out', 'safe']) for (const k of ['call', 'x', 'z', 'k']) assert.ok(k in R.seen.get(n), `${n}.${k}`);
  for (const k of ['dist', 'n', 'walkoff']) assert.ok(k in R.seen.get('hr'), `hr.${k}`);
  assert.ok(R.all.some((e) => e.e === 'catch' && e.pitch === 1), '포수 투구 포구 이벤트');
  assert.ok('rules' in R.seen.get('modeChange'));
});

test('투구 전 이벤트(windup·release)에 코스가 없음 — 공 위치 미리보기 금지', () => {
  for (const e of R.all) if (e.e === 'windup' || e.e === 'release') for (const k of ['tx', 'ty', 'x', 'y', 'bx', 'by']) assert.ok(!(k in e), `${e.e}.${k}`);
});

test('이벤트 순서: windup → release → (swing) → 결과, 시각은 단조 증가', () => {
  let last = -1;
  for (const e of R.all) { if (e.e === 'modeChange' && e.start) last = -1; assert.ok(e.at >= last - 1e-9, `${e.e} 시각 역행`); last = e.at; } // 경기마다 시계 새로 시작
  const byPid = new Map();
  for (const e of R.all) if (e.pid) { if (!byPid.has(e.pid)) byPid.set(e.pid, []); byPid.get(e.pid).push(e.e); }
  let n = 0;
  for (const seq of byPid.values()) {
    if (seq[0] !== 'windup') continue;
    if (seq.length === 1 && R.all.length >= 4000) continue; // [pitch] 수집 상한(4000개)에서 잘린 마지막 투구 (예전부터 가끔 깨지던 원인)
    assert.equal(seq[1], 'release', seq.join(','));
    if (seq.includes('contact')) assert.ok(seq.indexOf('swing') < seq.indexOf('contact'));
    n++;
  }
  assert.ok(n > 50, `투구 ${n}개`);
});

test('snapshot(false)는 이벤트를 비우지 않고, snapshot(true)는 비움', () => {
  const g = new Game({}); g.addPlayer('a', 'A'); g.applySettings({ mode: 'game', innings: 1 }); g.start();
  for (let i = 0; i < 600; i++) g.tick(1 / 60);
  const n = g.events.length;
  assert.ok(n > 0);
  assert.equal(g.snapshot().ev, undefined);
  assert.equal(g.events.length, n);
  assert.equal(g.snapshot(true).ev.length, n);
  assert.equal(g.events.length, 0);
});

test('사람 도루·견제 명령도 이벤트로 나옴', () => {
  const g = new Game({}); g.addPlayer('h', 'H'); g.players.get('h').team = 'away';
  g.applySettings({ mode: 'game', innings: 3 }); g.start();
  for (let i = 0; i < 400 && g.phase !== 'pitch'; i++) g.tick(1 / 60);
  g.runners = [{ ...g.mkRunner(1, false), b: 1, target: 1, start: 1 }];
  g.takeEvents();
  g.handle('h', { t: 'steal' });
  const ev = g.takeEvents().map((e) => e.e);
  assert.ok(ev.includes('steal'), ev.join(','));
});
