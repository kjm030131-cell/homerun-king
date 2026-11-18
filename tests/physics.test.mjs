// 타구 물리: 비거리·체공시간이 스탯캐스트 평균(실제 메이저리그)과 맞는지
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { integrate, battedBall } from '../shared/sim.js';

function fly(mph, la) {
  const rnd = Math.random; Math.random = () => 0.5; // 스핀 랜덤 고정
  const b = battedBall(0, 0.9, { v: mph * 0.44704, launch: la, spray: 0 });
  Math.random = rnd;
  let t = 0;
  while (b.y > 0 && t < 12) { integrate(b, 1 / 240, false); t += 1 / 240; }
  return { d: Math.hypot(b.x, b.z), t };
}

// [mph, 발사각, 목표 비거리 m, 목표 체공 s]
const REF = [[100, 15, 92, 2.7], [100, 28, 122, 5.0], [95, 30, 113, 5.0], [105, 27, 130, 5.1], [90, 25, 98, 4.4], [110, 25, 140, 5.0], [85, 35, 88, 4.9]];
for (const [mph, la, d0, t0] of REF) {
  test(`타구 ${mph}mph ${la}° → 비거리 ${d0}m±8%, 체공 ${t0}s±12%`, () => {
    const { d, t } = fly(mph, la);
    assert.ok(Math.abs(d - d0) / d0 < 0.08, `비거리 ${d.toFixed(1)}m`);
    assert.ok(Math.abs(t - t0) / t0 < 0.12, `체공 ${t.toFixed(2)}s`);
  });
}
