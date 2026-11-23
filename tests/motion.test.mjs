// [motion] 모션 모드: 수비 자동(autoD) · 투구 세기 변환 · QR
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../shared/sim.js';
import { padPower, camPower } from '../client/motion/index.js';
import { qrMatrix } from '../client/motion/qr.js';

function soloDefense(autoD) {
  const g = new Game({ emit: () => {}, sendTo: () => {} });
  g.addPlayer('me', '나');
  const me = g.players.get('me'); me.team = 'home'; me.pos = 'any';
  g.applySettings({ mode: 'game', innings: 2, fieldCtl: 'auto' });
  g.start();
  if (autoD) g.handle('me', { t: 'autoD', on: true });
  return g;
}

test('모션 모드(autoD): 사람은 투구만, 수비수 조작은 안 넘어오고 CPU가 바로 처리', () => {
  for (const autoD of [true, false]) {
    const g = soloDefense(autoD);
    let stolen = 0, maxHold = 0, holdI = -1, holdT = 0, pitches = 0;
    for (let i = 0; i < 60 * 60 * 6 && g.fieldTeam === 'home'; i++) {
      if (g.phase === 'pitch' && g.pitcherCtrl() === 'me' && Math.random() < 0.05) { g.handle('me', { t: 'pitch', type: 'FB', tx: 0, ty: 0.8, power: 0.9 }); pitches++; }
      g.tick(1 / 60);
      if (g.phase === 'live') for (const f of g.fielders) if (f.ctrl === 'me' && f.pos !== 'P') stolen++;
      const h = g.ball ? g.ball.holder : -1;
      if (g.phase === 'live' && h >= 0 && g.fielders[h].ctrl === 'me') { /* 내 선수(투수)가 공을 잡았을 때 사람 입력을 기다리는지만 */ if (h !== holdI) { holdI = h; holdT = g.now; } maxHold = Math.max(maxHold, g.now - holdT); } else holdI = -1;
    }
    assert.ok(pitches > 3, `투구 ${pitches}`);
    if (autoD) {
      assert.equal(stolen, 0, '수비수 조작이 사람에게 넘어옴');
      assert.ok(maxHold < 1.3, `내 투수가 공 들고 기다린 시간 ${maxHold.toFixed(2)}s (사람 기다리면 1.6s)`);
    } else assert.ok(stolen > 0, '비교용: autoD 끄면 자동 전환으로 조작이 넘어와야 함');
  }
});

test('핸드폰 휘두른 세기 → 게이지: 약하면 힘 빠진 공, 1000~1700°/s 퍼펙트, 센서 한계면 과투구', () => {
  assert.ok(padPower(200) < 0.6);
  let prev = 0; for (let pk = 100; pk <= 1900; pk += 50) { const v = padPower(pk); assert.ok(v >= prev - 1e-9, `단조 증가 ${pk}`); prev = v; }
  for (const pk of [1050, 1300, 1650]) { const v = padPower(pk); assert.ok(v >= 0.84 && v <= 0.97, `${pk} → ${v}`); }
  assert.ok(padPower(2000) > 1);
  assert.ok(camPower(0.2) >= 0.5 && camPower(3) <= 0.96);
});

test('QR: 주소 길이에 맞춰 버전 선택 · 세 귀퉁이 위치 표시', () => {
  for (const [t, n] of [['hi', 21], ['https://homerun-king.jaemin-poker.workers.dev/pad.html#K7QX2M', 33]]) {
    const M = qrMatrix(t); assert.equal(M.length, n);
    for (const [x, y] of [[0, 0], [n - 7, 0], [0, n - 7]]) { assert.ok(M[y][x] && M[y + 6][x + 6] && M[y + 3][x + 3] && !M[y + 1][x + 1]); }
  }
  assert.throws(() => qrMatrix('x'.repeat(200)));
});
