// stadium/layout.js — 구장 단면 규격 (모든 파트가 같은 숫자를 쓰도록 한 곳에)
// 좌표: 홈 원점, +z = 중견수, +x = 3루/좌익. phi = atan2(x, z) (중견수 0, 홈 뒤 ±π). a = |phi| (도)
// 펜스(fenceR)·관중석 경계(standR)는 shared/sim.js 물리와 같아야 하므로 거기서 가져온다 (바꾸지 말 것)
import { fenceR, standR, FOUL, WALL_H } from '../../shared/sim.js';
import { DEG, lerp, smooth } from './util.js';

export { fenceR, standR, FOUL, WALL_H };
export const deg = (phi) => Math.abs(phi) / DEG;

// ── 덕아웃: 파울라인에서 22m 떨어진 벽, 홈에서 라인 따라 17~37m (a ≈ 76°~98°) ──
export const DUGOUT = { t0: 17, t1: 37, wall: 22.2, depth: 3.4 };
export function dugoutSpan() {
  const pa = (t, d) => Math.atan2((t + d) * Math.SQRT1_2, (t - d) * Math.SQRT1_2) / DEG;
  return [pa(DUGOUT.t1, DUGOUT.wall), pa(DUGOUT.t0, DUGOUT.wall)]; // [76, 98]
}
const [DG0, DG1] = dugoutSpan();
// 덕아웃 구간에서 1층 앞줄을 뒤로 물림 (0~1)
export const dugK = (a) => smooth(DG0 - 3, DG0 + 1, a) * (1 - smooth(DG1 - 1, DG1 + 3, a));

// ── 1층(내야·파울 지역 관중석) ──
export const WALL_FOUL = 1.25; // 파울 지역 벽 높이
export function lowerAt(phi) {
  const a = deg(phi), dk = dugK(a);
  const wallR = standR(phi);
  const r0 = wallR + 1.0 + dk * (DUGOUT.depth + 0.4);
  const y0 = lerp(3.0, 1.35, smooth(46, 56, a)) + dk * 0.75; // 폴 근처는 외야석 높이에 맞춤
  const depth = lerp(15.5, 21, smooth(55, 135, a));
  const rows = Math.round(depth / 0.86);
  const rise = depth * 0.5; // 약 26.5°
  return { a, wallR, r0, y0, depth, rows, rise, rT: r0 + depth, yT: y0 + rise };
}
export const LOWER_ROWS = 24; // 리본 행 수(가장 깊은 곳 기준, 얕은 곳은 같은 행 수로 촘촘)

// ── 스위트(2층 유리 띠) + 3층(윗 관중석, 오버행) ──
export const UPPER_A0 = 56; // 이 각도(도)부터 3층 시작 (폴 쪽 끝은 마개 벽)
export function upperAt(phi) {
  const L = lowerAt(phi);
  const suiteR = L.rT + 3.0, suiteY0 = L.yT, suiteY1 = L.yT + 3.6;
  const r0 = L.rT - 4.5, y0 = L.yT + 6.8; // 1층 뒷줄 위로 4.5m 튀어나옴
  const depth = 18, rows = 21, rise = depth * 0.6; // 약 31°
  return { L, suiteR, suiteY0, suiteY1, r0, y0, depth, rows, rise, rT: r0 + depth, yT: y0 + rise, fasciaY: y0 - 1.7 };
}
// ── 지붕(홈 뒤 3층 위 캔틸레버) ──
export const ROOF_A0 = 104;
export function roofAt(phi) {
  const U = upperAt(phi);
  return { U, rBack: U.rT + 1.5, yBack: U.yT + 5.5, rFront: U.r0 + 1.0, yFront: U.yT + 9.0 };
}

// ── 외야석 ──
export const BEYE = 10 * DEG; // 백스크린(타자 시야) 반폭
export function outfieldAt(phi) {
  const f = fenceR(phi);
  const r0 = f + 1.2, y0 = 3.1, depth = 16.5, rows = 18, rise = depth * 0.5;
  return { f, r0, y0, depth, rows, rise, rT: r0 + depth, yT: y0 + rise };
}

// 경기장 바깥 외벽 반지름·높이 (외야 / 3층 구간 / 사이 구간)
export function outerAt(phi) {
  const a = deg(phi);
  if (a <= 45) { const O = outfieldAt(phi); return { r: O.rT + 1.2, h: O.yT + 3.4 }; }
  if (a >= UPPER_A0) { const U = upperAt(phi); return { r: U.rT + 1.0, h: U.yT + 3.2 }; }
  const L = lowerAt(phi); const O = outfieldAt(Math.sign(phi) * FOUL);
  const k = smooth(45, UPPER_A0, a);
  return { r: Math.max(L.rT + 1.2, O.rT + 1.2), h: lerp(O.yT + 3.4, L.yT + 3.6, k) };
}

// 전광판 (main.js 가 SB 를 씀 — 이름·필드 유지)
export const SB = { w: 62, h: 19.4, y: 25, z: fenceR(0) + 21 };
