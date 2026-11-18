// stadium/util.js — 구장 공용 도구: 캔버스 텍스처, 글자 판, 리본(곡선 띠) 생성기, 시드 난수
import * as THREE from 'three';

export const DEG = Math.PI / 180;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const range = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => a + (b - a) * i / n);
export const absDeg = (phi) => Math.abs(phi) / DEG;
export function rng(seed = 1) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// 그린 함수를 기억해 두는 캔버스 텍스처 (폰트가 늦게 뜨면 refreshText로 다시 그림)
export function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.userData.draw = draw; t.userData.canvas = c;
  return t;
}
export function redraw(t) { const c = t.userData.canvas; if (!c || !t.userData.draw) return; const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height); t.userData.draw(g, c.width, c.height); t.needsUpdate = true; }
export const textTexes = [];
// 글자 판: 글자 폭에 맞춰 캔버스 크기 결정 → 늘어나거나 잘리지 않음
export function textMesh(text, heightM, { color = '#fff', font = '700 {s}px Oswald, "Noto Sans KR", sans-serif', bg = null, pad = 0.18, px = 96 } = {}) {
  const f = font.replace('{s}', px);
  const meas = document.createElement('canvas').getContext('2d'); meas.font = f;
  const w = Math.ceil(meas.measureText(text).width + px * pad * 2);
  const h = Math.ceil(px * 1.3);
  const tex = canvasTex(w, h, (g, W, H) => {
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, W, H); }
    g.font = f; g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, W / 2, H / 2 + px * 0.04);
  });
  textTexes.push(tex);
  return new THREE.Mesh(new THREE.PlaneGeometry(heightM * w / h, heightM), new THREE.MeshBasicMaterial({ map: tex, transparent: !bg, depthWrite: !!bg, toneMapped: false }));
}
export function noise(g, w, h, amt, chroma = [1, 1, 1], rnd = Math.random) {
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) { const n = (rnd() - 0.5) * amt; img.data[i] += n * chroma[0]; img.data[i + 1] += n * chroma[1]; img.data[i + 2] += n * chroma[2]; }
  g.putImageData(img, 0, 0);
}
export function glowTex() {
  if (glowTex.t) return glowTex.t;
  glowTex.t = canvasTex(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,245,215,.55)'); gr.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  return glowTex.t;
}

// 리본: phis(각도 배열)를 따라 (r(phi,t), y(phi,t))로 띠를 만든다. t = 0..1 (rows 칸)
// uvFn(arc, t, phi) → [u, v], colorFn(phi, t) → THREE.Color. arc = 앞쪽(t=0) 반지름 기준 누적 호 길이(m)
export function ribbon(parent, phis, rFn, yFn, rows, mat, { colorFn = null, uvFn = null, tag = 'none' } = {}) {
  const pos = [], uvs = [], col = [], idx = [];
  let arc = 0;
  for (let i = 0; i < phis.length; i++) {
    const phi = phis[i];
    if (i) arc += Math.abs(phi - phis[i - 1]) * rFn((phi + phis[i - 1]) / 2, 0);
    for (let j = 0; j <= rows; j++) {
      const t = j / rows, r = rFn(phi, t), y = yFn(phi, t);
      pos.push(Math.sin(phi) * r, y, Math.cos(phi) * r);
      const [u, v] = uvFn ? uvFn(arc, t, phi) : [arc, t];
      uvs.push(u, v);
      if (colorFn) { const c = colorFn(phi, t); col.push(c.r, c.g, c.b); }
    }
  }
  for (let i = 0; i < phis.length - 1; i++) for (let j = 0; j < rows; j++) { const a = i * (rows + 1) + j, b = a + rows + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (colorFn) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.userData.sh = tag; parent.add(m);
  return m;
}
// (r, y) 단면 다각형을 phi 방향 평면에 세운 마개(관중석 끝 벽 등)
export function capAt(parent, phi, pts, mat, tag = 'none') {
  const shape = new THREE.Shape(pts.map(([r, y]) => new THREE.Vector2(r, y)));
  const g = new THREE.ShapeGeometry(shape, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const r = p.getX(i), y = p.getY(i); p.setXYZ(i, Math.sin(phi) * r, y, Math.cos(phi) * r); }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.userData.sh = tag; parent.add(m);
  return m;
}
// 박스를 (x,y,z)에 놓고 yaw(ry)만큼 돌린 지오메트리 (병합용)
export function boxAt(w, h, d, x, y, z, ry = 0, rx = 0) {
  const b = new THREE.BoxGeometry(w, h, d);
  if (rx) b.rotateX(rx);
  if (ry) b.rotateY(ry);
  b.translate(x, y, z);
  return b;
}
// 셰이더 주입 도우미: 문자열이 실제로 바뀌었는지 확인 (three 버전 차이로 조용히 실패하는 것 방지)
export function inject(src, find, repl) {
  if (!src.includes(find)) { console.warn('[stadium] shader chunk not found:', find); return src; }
  return src.replace(find, repl);
}
