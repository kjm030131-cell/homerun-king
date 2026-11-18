// stadium/fence.js — 외야 펜스(패딩+고정 광고+홈런 라인), 파울 지역 벽(+LED), 백네트, 폴대, 거리 표시
import * as THREE from 'three';
import { fenceR, standR, FOUL, WALL_H, WALL_FOUL, BEYE, dugoutSpan } from './layout.js';
import { DEG, lerp, smooth, range, ribbon, textMesh, canvasTex, boxAt } from './util.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function buildFence(world, M, ads) {
  const fencePhis = range(-FOUL, FOUL, 180);
  // 패딩 (홈런 라인 아래까지)
  ribbon(world, fencePhis, (p) => fenceR(p), (p, t) => t * (WALL_H - 0.12), 1, M.pad, { uvFn: (arc, t) => [arc / 4, t], tag: 'struct' });
  // 노란 홈런 라인 + 위 캡
  ribbon(world, fencePhis, (p) => fenceR(p) - 0.02, (p, t) => WALL_H - 0.12 + t * 0.14, 1, M.yellow);
  ribbon(world, fencePhis, (p, t) => fenceR(p) + t * 0.4, () => WALL_H + 0.02, 1, M.steelDark);
  // 고정 광고 (ad01~11): 좌측(+x)·우측 펜스. 백스크린 앞(±10°)은 비움(타자 시야)
  const panelW = 8.1, adH = 1.62, adY = 0.62;
  const L = ads.panels(world, { from: FOUL - 0.004, to: BEYE + 0.002, rFn: (p) => fenceR(p) - 0.03, y0: adY, h: adH, panelW, slot0: 0 });
  ads.panels(world, { from: -BEYE - 0.002, to: -FOUL + 0.004, rFn: (p) => fenceR(p) - 0.03, y0: adY, h: adH, panelW, slot0: L.count });
  // 거리 표시 (펜스 숫자)
  for (const d of [43, 22.5, 0, -22.5, -43]) {
    const phi = d * DEG, r = fenceR(phi) - 0.06;
    const l = textMesh(String(Math.round(fenceR(phi))), 0.95, { color: '#ffffff', bg: '#1b4d3a', px: 120, pad: 0.3, font: '700 {s}px Oswald, sans-serif' });
    const y = d === 0 ? 1.45 : 2.05;
    l.position.set(Math.sin(phi) * r, y, Math.cos(phi) * r); l.lookAt(0, y, 0);
    world.add(l);
  }
  // 파울 지역 벽 (1.25m 남색 패딩 + LED 회전 광고). 덕아웃 앞은 비움
  const [dg0, dg1] = dugoutSpan();
  for (const s of [-1, 1]) {
    const segs = [[FOUL + 0.004, (dg0 - 0.3) * DEG], [(dg1 + 0.3) * DEG, Math.PI]];
    segs.forEach(([a, b], si) => {
      const phis = range(s * a, s * b, Math.max(8, Math.round((b - a) / DEG * 1.4)));
      ribbon(world, phis, (p) => standR(p), (p, t) => t * WALL_FOUL, 1, M.padNavy, { tag: 'struct' });
      ribbon(world, phis, (p, t) => standR(p) + t * 0.35, () => WALL_FOUL + 0.01, 1, M.trim);
      ads.panels(world, { from: s * (a + 0.004), to: s * (b - 0.003), rFn: (p) => standR(p) - 0.03, y0: 0.28, h: 0.82, panelW: 4.1, slot0: (s > 0 ? 0 : 5) + si * 3, led: true, gap: 0 });
    });
  }
  // 백네트 + 내야 보호망 (홈 뒤 ~ 덕아웃 끝)
  {
    const netTex = canvasTex(64, 64, (g, w, h) => { g.strokeStyle = 'rgba(230,236,248,.8)'; g.lineWidth = 1; for (let i = 0; i <= w; i += 8) { g.beginPath(); g.moveTo(i + 0.5, 0); g.lineTo(i + 0.5, h); g.stroke(); g.beginPath(); g.moveTo(0, i + 0.5); g.lineTo(w, i + 0.5); g.stroke(); } }, true);
    const netM = new THREE.MeshBasicMaterial({ map: netTex, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.38, name: 'net' });
    const poles = [];
    for (const s of [-1, 1]) {
      const a0 = (dg1 + 1) * DEG;
      const phis = range(s * Math.PI, s * a0, 44);
      const h = (p) => lerp(8.5, 3.6, smooth(165 * DEG, a0, Math.abs(p)));
      const m = ribbon(world, phis, (p) => standR(p) + 0.12, (p, t) => WALL_FOUL + t * h(p), 1, netM, { uvFn: (arc, t, p) => [arc / 1.4, t * h(p) / 1.4] });
      m.renderOrder = 2;
      for (const p of range(s * Math.PI, s * a0, 6)) { const r = standR(p) + 0.2, hh = h(p) + WALL_FOUL; const c = new THREE.CylinderGeometry(0.06, 0.06, hh, 6); c.translate(Math.sin(p) * r, hh / 2, Math.cos(p) * r); poles.push(c); }
      // 그물 위 가로 케이블
      const top = range(s * Math.PI, s * a0, 30);
      ribbon(world, top, (p) => standR(p) + 0.12, (p, t) => WALL_FOUL + h(p) - 0.03 + t * 0.06, 1, M.steelDark);
    }
    const pm = new THREE.Mesh(mergeGeometries(poles), M.steelDark); pm.userData.sh = 'none'; world.add(pm);
  }
  // 폴대 (높이 26m, 그물 날개)
  {
    const finM = new THREE.MeshStandardMaterial({ color: '#ffd23a', transparent: true, opacity: 0.5, side: THREE.DoubleSide, name: 'poleFin' });
    for (const s of [-1, 1]) {
      const x = s * 100 * Math.sin(FOUL), z = 100 * Math.cos(FOUL);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.24, 26, 12), M.pole); pole.position.set(x + s * 0.18, 13, z + 0.18); world.add(pole);
      const fin = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 20), finM);
      fin.position.set(x + s * 0.6, 15, z - 0.2); fin.rotation.y = s * Math.PI / 4; world.add(fin);
      const cap = new THREE.Mesh(boxAt(0.6, 0.25, 0.6, 0, 0, 0), M.pole); cap.position.set(x + s * 0.18, 26.1, z + 0.18); world.add(cap);
    }
  }
}
