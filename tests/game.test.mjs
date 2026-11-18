// AI끼리 경기: 멈추지 않고 끝나는지, 결과 분포가 실제 야구 범위인지
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../shared/sim.js';

const CAT = { K: /삼진/, BB: /볼넷/, HR: /홈런!|만루 홈런|점 홈런|솔로 홈런/, '2B': /2루타/, E: /실책/ };
function playGames(n, innings = 9) {
  const tot = {}; let runs = 0, stuck = 0;
  for (let g = 0; g < n; g++) {
    const game = new Game({}); game.set.innings = innings; game.start();
    let last = -1, steps = 0;
    while (game.phase !== 'over' && steps < 30 * 60 * 90) {
      game.tick(1 / 30); steps++;
      if (game.msgId !== last) { last = game.msgId; for (const [k, re] of Object.entries(CAT)) if (re.test(game.msg)) tot[k] = (tot[k] || 0) + 1; }
    }
    if (game.phase !== 'over') stuck++;
    runs += game.score[0] + game.score[1];
  }
  const per = (k) => (tot[k] || 0) / n / 2;
  return { per, runs: runs / n / 2, stuck };
}

test('AI 9이닝 경기 12판: 멈춤 없음 + 팀당 기록이 실제 범위', () => {
  const r = playGames(12);
  assert.equal(r.stuck, 0, '끝나지 않은 경기');
  assert.ok(r.runs > 1.8 && r.runs < 7, `팀당 득점 ${r.runs.toFixed(2)} (MLB 4.5)`);
  assert.ok(r.per('K') > 5 && r.per('K') < 12, `삼진 ${r.per('K')} (MLB 8.5)`);
  assert.ok(r.per('HR') > 0.3 && r.per('HR') < 2.5, `홈런 ${r.per('HR')} (MLB 1.1)`);
  assert.ok(r.per('E') < 1.6, `실책 ${r.per('E')} (MLB 0.5)`);
});

test('스냅샷 크기: 30Hz 기준 평균 1.5KB 이하', () => {
  const g = new Game({ emit: () => {}, sendTo: () => {} });
  g.addPlayer('a', 'A'); g.addPlayer('b', 'B'); g.applySettings({ mode: 'game', innings: 3 }); g.start();
  let sum = 0, n = 0;
  for (let i = 0; i < 60 * 120; i++) { g.tick(1 / 60); if (i % 2 === 0) { sum += JSON.stringify(g.snapshot()).length; n++; } }
  assert.ok(sum / n < 1500, `평균 ${(sum / n) | 0}B`);
});
