// [motion+] 모션 인식 필터: 떨림 제거·빠른 동작 추종·꼭짓점 시각 보정
import test from 'node:test';
import assert from 'node:assert/strict';
import { OneEuro, peakTime } from '../client/motion/filter.js';

// 결정적 난수
let s = 7; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };

test('정지 + 떨림(±1.5cm): 출력 흔들림이 1/3 이하', () => {
  const f = new OneEuro(1.0, 8); let raw = 0, out = 0, prevR = 0, prevO = 0;
  for (let i = 0; i < 300; i++) { const v = rnd() * 0.03; const o = f.filter(v, 0.05); if (i > 20) { raw += Math.abs(v - prevR); out += Math.abs(o - prevO); } prevR = v; prevO = o; }
  assert.ok(out < raw / 3, `raw ${raw.toFixed(3)} out ${out.toFixed(3)}`);
});

test('빠른 스윙(5m/s): 지연 3cm 이하로 따라감', () => {
  const f = new OneEuro(1.0, 8); let lag = 0;
  for (let i = 0; i < 40; i++) { const t = i * 0.033, v = t < 0.5 ? 0 : (t - 0.5) * 5; const o = f.filter(v, 0.033); if (t > 0.75) lag = Math.max(lag, v - o); }
  assert.ok(lag < 0.03, `lag ${lag.toFixed(3)}m`);
});

test('안 보이는 관절(w 낮음)은 엉뚱한 값으로 튀지 않음', () => {
  const f = new OneEuro(1.0, 8); for (let i = 0; i < 20; i++) f.filter(0.5, 0.05);
  const o = f.filter(2.5, 0.05, 0.04);
  assert.ok(Math.abs(o - 0.5) < 0.15, `o ${o}`);
});

test('꼭짓점 시각: 16ms 표본에서도 실제 꼭짓점 ±3ms', () => {
  for (const tp of [100.0, 104.0, 108.0, 111.0]) {
    const v = (t) => 1000 - 0.8 * (t - tp) ** 2;
    const t1 = 96 + Math.round((tp - 96) / 16) * 16; // 꼭짓점에 가장 가까운 표본
    const est = peakTime(t1 - 16, v(t1 - 16), t1, v(t1), t1 + 16, v(t1 + 16));
    assert.ok(Math.abs(est - tp) < 3, `tp ${tp} est ${est.toFixed(1)} (t1 ${t1})`);
  }
});
