// stadium/stands.js — 관중석 볼(1층·스위트·3층 오버행·외야석·백스크린), 지붕 캔틸레버, 외벽 파사드, 끝 마개
// 각 층은 단면 함수(layout.js)를 phi 따라 훑는 리본 → 같은 재질끼리 나중에 한 덩어리로 병합
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FOUL, WALL_FOUL, BEYE, UPPER_A0, ROOF_A0, LOWER_ROWS, lowerAt, upperAt, roofAt, outfieldAt, outerAt, deg } from './layout.js';
import { DEG, lerp, range, ribbon, capAt } from './util.js';

// 좌석 구역 (|phi| 도, 중견수 0 ~ 홈 뒤 180) — 잠실 느낌 색 배치를 고급스럽게 톤다운
export const SEAT_ZONES = [
  { name: '프리미엄석', from: 162, to: 180, color: '#262c3f' },
  { name: '블루석', from: 138, to: 162, color: '#2c5bb5' },
  { name: '오렌지석(응원)', from: 104, to: 138, color: '#e2752a' },
  { name: '레드석', from: 46, to: 104, color: '#b8323a' },
  { name: '네이비석(3층)', from: 0, to: 0, color: '#243464' },
  { name: '외야 그린석', from: 0, to: 46, color: '#3a7f4a' },
];
const zc = SEAT_ZONES.map((z) => ({ ...z, c: new THREE.Color(z.color) }));
function zoneColor(phi) { const a = deg(phi); for (const z of zc) if (z.to > z.from && a >= z.from && a <= z.to) return z.c; return zc[3].c; }
const NAVY = new THREE.Color('#243464'), GREEN = new THREE.Color('#3a7f4a');

// 계단식 좌석 리본: 행마다 수평(발판)+수직(챔판) 면
function stepRibbon(parent, phis, T, rows, mat, colorFn) {
  const rFn = (p, t) => { const j = Math.round(t * rows * 2); const st = Math.floor((j + 1) / 2); return T.r0(p) + T.depth(p) * st / rows; };
  const yFn = (p, t) => { const j = Math.round(t * rows * 2); const st = Math.floor(j / 2); return T.y0(p) + T.rise(p) * st / rows; };
  return ribbon(parent, phis, rFn, yFn, rows * 2, mat, { colorFn, uvFn: (arc, t) => [arc / 2.2, t * rows], tag: 'stand' });
}
// 앞줄 반지름 기준 누적 호 길이(리본 uv 와 같은 방식) → 관중 배치에서 통로 피하기
function arcTable(phis, r0) {
  const arcs = [0];
  for (let i = 1; i < phis.length; i++) arcs.push(arcs[i - 1] + Math.abs(phis[i] - phis[i - 1]) * r0((phis[i] + phis[i - 1]) / 2));
  return (phi) => {
    const s = Math.sign(phis[phis.length - 1] - phis[0]) || 1;
    let lo = 0, hi = phis.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if ((phi - phis[mid]) * s >= 0) lo = mid; else hi = mid; }
    const k = (phi - phis[lo]) / ((phis[hi] - phis[lo]) || 1);
    return arcs[lo] + (arcs[hi] - arcs[lo]) * Math.min(1, Math.max(0, k));
  };
}
// 좌석 위치 목록: [x, y(발판), z, flags] flags: 1=응원석, 2=3층, 4=외야, 8=3루쪽(+x)
function seatsFor(out, phis, T, rows, aislePer, vom, flagFn) {
  const arcAt = arcTable(phis, T.r0);
  const a0 = phis[0], a1 = phis[phis.length - 1], s = Math.sign(a1 - a0);
  for (let j = 0; j < rows; j++) {
    let phi = a0;
    while ((a1 - phi) * s > 0) {
      const r = T.r0(phi) + T.depth(phi) * (j + 0.62) / rows;
      const arc = arcAt(phi), ai = Math.floor(arc / aislePer + 0.5), da = Math.abs(arc - ai * aislePer);
      const inVom = ai % 3 === 0 && da < 1.7 && j >= vom[0] - 1 && j <= vom[1];
      if (da > 0.75 && !inVom) {
        const y = T.y0(phi) + T.rise(phi) * j / rows;
        out.push(Math.sin(phi) * r, y, Math.cos(phi) * r, flagFn(phi));
      }
      phi += s * 0.56 / r;
    }
  }
}

export function buildStands(world, M, ads, Q) {
  const seats = [];
  const AISLE = 9.4;
  // ═══ 1층 ═══
  const LV = [10, 12]; // 출입구(보미토리) 행
  const lowerMat = M.seat('lower', { aislePer: AISLE, vom: LV });
  const T1 = { r0: (p) => lowerAt(p).r0, depth: (p) => lowerAt(p).depth, y0: (p) => lowerAt(p).y0, rise: (p) => lowerAt(p).rise };
  for (const s of [-1, 1]) {
    const phis = range(s * (FOUL + 0.012), s * Math.PI, Q.standSeg);
    stepRibbon(world, phis, T1, LOWER_ROWS, lowerMat, (p) => zoneColor(p));
    seatsFor(seats, phis, T1, LOWER_ROWS, AISLE, LV, (p) => { const a = deg(p); return (a > 104 && a < 138 ? 1 : 0) | (p > 0 ? 8 : 0); });
    // 파울 벽 위 ~ 앞줄 통로 바닥까지 (덕아웃 구간에선 덕아웃 지붕 앞면이 됨)
    const fr = range(s * (FOUL + 0.012), s * Math.PI, Math.round(Q.standSeg / 2));
    ribbon(world, fr, (p) => lowerAt(p).wallR + 0.01, (p, t) => lerp(WALL_FOUL, lowerAt(p).y0, t), 1, M.concreteDark, { tag: 'struct' });
    ribbon(world, fr, (p, t) => lerp(lowerAt(p).wallR, lowerAt(p).r0, t), (p) => lowerAt(p).y0, 1, M.concrete, { tag: 'struct' });
    // 앞 난간(윗 레일)
    ribbon(world, fr, (p) => lowerAt(p).wallR + 0.06, (p, t) => lowerAt(p).y0 + 0.95 + t * 0.07, 1, M.rail);
    // 1층 뒤: 3층이 없는 폴 쪽은 뒷벽, 3층 구간은 콘코스 바닥 + 스위트 유리 + 3층 밑면
    const back = range(s * (FOUL + 0.012), s * UPPER_A0 * DEG, 12);
    ribbon(world, back, (p) => lowerAt(p).rT, (p, t) => t * (lowerAt(p).yT + 3.6), 1, M.concreteDark, { tag: 'big' });
    const up = range(s * UPPER_A0 * DEG, s * Math.PI, Math.round(Q.standSeg * 0.6));
    ribbon(world, up, (p, t) => lerp(lowerAt(p).rT, upperAt(p).suiteR, t), (p) => lowerAt(p).yT, 1, M.concrete, { tag: 'big' });
    ribbon(world, up, (p) => upperAt(p).suiteR, (p, t) => lerp(upperAt(p).suiteY0, upperAt(p).suiteY1, t), 1, M.suite, { uvFn: (arc, t) => [arc / 8, t] });
    ribbon(world, up, (p, t) => lerp(upperAt(p).suiteR, upperAt(p).r0, t), (p, t) => lerp(upperAt(p).suiteY1, upperAt(p).fasciaY, t), 1, M.downlight,
      { uvFn: (arc, t, p) => [arc / 6, t * (upperAt(p).suiteR - upperAt(p).r0) / 6], tag: 'big' });
    // 1층 끝(폴 쪽) 마개
    { const p = s * (FOUL + 0.012), L = lowerAt(p); capAt(world, p, [[L.wallR, 0], [L.wallR, L.y0], [L.r0, L.y0], [L.rT, L.yT], [L.rT, L.yT + 3.6], [L.rT + 0.6, L.yT + 3.6], [L.rT + 0.6, 0]], M.concreteDark, 'big'); }
  }
  // ═══ 3층 (오버행) ═══
  const upperMat = M.seat('upper', { aislePer: AISLE * 1.15 });
  const T3 = { r0: (p) => upperAt(p).r0, depth: (p) => upperAt(p).depth, y0: (p) => upperAt(p).y0, rise: (p) => upperAt(p).rise };
  for (const s of [-1, 1]) {
    const phis = range(s * UPPER_A0 * DEG, s * Math.PI, Math.round(Q.standSeg * 0.75));
    stepRibbon(world, phis, T3, 21, upperMat, () => NAVY);
    seatsFor(seats, phis, T3, 21, AISLE * 1.15, [-9, -9], (p) => 2 | (p > 0 ? 8 : 0));
    const fr = range(s * UPPER_A0 * DEG, s * Math.PI, Math.round(Q.standSeg * 0.4));
    // 3층 앞 난간 벽(페시아) + LED 리본 (회전 광고 ad12~22)
    ribbon(world, fr, (p) => upperAt(p).r0 - 0.12, (p, t) => lerp(upperAt(p).fasciaY, upperAt(p).y0 + 1.0, t), 1, M.trim, { tag: 'big' });
    ads.panels(world, { from: s * (UPPER_A0 * DEG + 0.003), to: s * (Math.PI - 0.002), rFn: (p) => upperAt(p).r0 - 0.2, y0: (p) => upperAt(p).fasciaY + 0.2, h: 1.25, panelW: 6.2, slot0: s > 0 ? 2 : 7, led: true, gap: 0 });
    // 뒷벽 + 윗면 + 외벽(파사드)
    ribbon(world, fr, (p) => upperAt(p).rT, (p, t) => lerp(upperAt(p).yT, upperAt(p).yT + 3.2, t), 1, M.concreteDark, { tag: 'big' });
    ribbon(world, fr, (p, t) => lerp(upperAt(p).rT, upperAt(p).rT + 1.0, t), (p) => upperAt(p).yT + 3.2, 1, M.trim, { tag: 'big' });
    // 3층 끝 마개 (외벽 높이 차이까지 덮음)
    { const p = s * UPPER_A0 * DEG, U = upperAt(p), L = U.L; capAt(world, p, [[L.rT + 1.2, 0], [L.rT + 1.2, L.yT], [U.r0, U.fasciaY], [U.r0, U.y0 + 1.0], [U.rT, U.yT + 3.2], [U.rT + 1.0, U.yT + 3.2], [U.rT + 1.0, 0]], M.concreteDark, 'big'); }
  }
  // ═══ 지붕 (홈 뒤 캔틸레버) ═══
  {
    const rib = [];
    for (const s of [-1, 1]) {
      const phis = range(s * ROOF_A0 * DEG, s * Math.PI, 40);
      ribbon(world, phis, (p, t) => { const R = roofAt(p); return lerp(R.rFront, R.rBack, t); }, (p, t) => { const R = roofAt(p); return lerp(R.yFront, R.yBack, t); }, 2, M.roof, { tag: 'big' });
      // 앞 페시아(남색 띠) + 조명 띠
      ribbon(world, phis, (p) => roofAt(p).rFront - 0.05, (p, t) => roofAt(p).yFront - 2.0 + t * 2.3, 1, M.trim, { tag: 'big' });
      ribbon(world, phis, (p) => roofAt(p).rFront + 0.25, (p, t) => roofAt(p).yFront - 2.25 + t * 0.25, 1, M.lightStrip);
      // 리브(보) + 뒤 기둥
      for (const p of range(s * (ROOF_A0 + 2) * DEG, s * 178 * DEG, Q.roofRibs)) {
        const R = roofAt(p), len = R.rBack - R.rFront, dy = R.yBack - R.yFront;
        const b = new THREE.BoxGeometry(0.45, 1.1, Math.hypot(len, dy));
        b.rotateX(Math.atan2(dy, len)); b.translate(0, -0.7, 0);
        const mid = (R.rFront + R.rBack) / 2, my = (R.yFront + R.yBack) / 2;
        b.rotateY(p); b.translate(Math.sin(p) * mid, my, Math.cos(p) * mid);
        rib.push(b);
        const h = R.yBack;
        const c = new THREE.CylinderGeometry(0.4, 0.55, h, 8); c.translate(Math.sin(p) * (R.rBack - 0.3), h / 2, Math.cos(p) * (R.rBack - 0.3));
        rib.push(c);
      }
    }
    const m = new THREE.Mesh(mergeGeometries(rib), M.steel);
    m.userData.sh = 'big'; world.add(m);
  }
  // ═══ 외야석 + 백스크린 ═══
  const ofMat = M.seat('outfield', { aislePer: AISLE });
  const TO = { r0: (p) => outfieldAt(p).r0, depth: (p) => outfieldAt(p).depth, y0: (p) => outfieldAt(p).y0, rise: (p) => outfieldAt(p).rise };
  for (const s of [-1, 1]) {
    const phis = range(s * BEYE, s * FOUL, Math.round(Q.standSeg * 0.45));
    stepRibbon(world, phis, TO, 18, ofMat, () => GREEN);
    seatsFor(seats, phis, TO, 18, AISLE, [-9, -9], (p) => 4 | (p > 0 ? 8 : 0));
    const p = s * FOUL, O = outfieldAt(p);
    capAt(world, p, [[O.f, 0], [O.r0, 0], [O.r0, O.y0], [O.rT, O.yT], [O.rT, O.yT + 3.4], [O.rT + 1.2, O.yT + 3.4], [O.rT + 1.2, 0]], M.concreteDark, 'big');
  }
  {
    const all = range(-FOUL, FOUL, 90);
    ribbon(world, all, (p) => outfieldAt(p).r0, (p, t) => t * outfieldAt(p).y0, 1, M.concreteDark, { tag: 'struct' }); // 외야석 앞벽
    ribbon(world, all, (p) => outfieldAt(p).rT, (p, t) => lerp(outfieldAt(p).yT, outfieldAt(p).yT + 3.4, t), 1, M.concreteDark, { tag: 'big' }); // 뒷벽
    ribbon(world, all, (p, t) => outfieldAt(p).rT + t * 1.2, (p) => outfieldAt(p).yT + 3.4, 1, M.trim, { tag: 'big' });
    // 백스크린: 어두운 경사면 + 위 가로 띠
    const be = range(-BEYE, BEYE, 16);
    ribbon(world, be, (p, t) => outfieldAt(p).r0 + t * outfieldAt(p).depth, (p, t) => outfieldAt(p).y0 + t * outfieldAt(p).rise, 1, M.beye, { tag: 'stand' });
    ribbon(world, be, (p) => outfieldAt(p).r0 + 0.05, (p, t) => outfieldAt(p).y0 - 0.25 + t * 0.25, 1, M.trim);
  }
  // ═══ 외벽 파사드 (밖에서 보이는 경기장 둘레) ═══
  {
    const fUV = (arc, t, p) => [arc / 16, t * outerAt(p).h / 16];
    ribbon(world, range(-FOUL, FOUL, 90), (p) => outerAt(p).r, (p, t) => t * outerAt(p).h, 1, M.facade, { uvFn: fUV, tag: 'big' });
    for (const s of [-1, 1]) {
      ribbon(world, range(s * FOUL, s * UPPER_A0 * DEG, 10), (p) => outerAt(p).r, (p, t) => t * outerAt(p).h, 1, M.facade, { uvFn: fUV, tag: 'big' });
      ribbon(world, range(s * UPPER_A0 * DEG, s * Math.PI, 60), (p) => outerAt(p).r, (p, t) => t * outerAt(p).h, 1, M.facade, { uvFn: fUV, tag: 'big' });
      // 폴 쪽: 1층 뒷벽 ~ 외벽 사이 윗면
      ribbon(world, range(s * FOUL, s * UPPER_A0 * DEG, 10), (p, t) => lerp(lowerAt(p).rT, outerAt(p).r, t), (p) => Math.min(outerAt(p).h, lowerAt(p).yT + 3.6), 1, M.trim, { tag: 'big' });
    }
  }
  return { seats };
}
