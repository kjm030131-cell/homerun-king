// stadium.js — 잠실야구장 (2026 시즌 기준) + 잠실 주변 야경
// 좌표: 홈 원점, +z = 중견수, +x = 3루/좌익 쪽. 방위: 중견수 방향 ≈ 북쪽(한강), +x ≈ 서쪽, -x ≈ 동쪽(올림픽주경기장), 롯데월드타워는 남동쪽.
// 좌석 구역: 테이블석(홈 뒤) · 블루석 · 오렌지석(응원석) · 레드석 · 네이비석(3층) · 외야 그린석, 외야 중앙 백스크린 + 전광판
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fenceR, standR, BASES, MOUND, FOUL, WALL_H } from '../shared/sim.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const range = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => a + (b - a) * i / n);
const DEG = Math.PI / 180;

export function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.userData.draw = draw; t.userData.canvas = c;
  return t;
}
function redraw(t) { const c = t.userData.canvas; const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height); t.userData.draw(g, c.width, c.height); t.needsUpdate = true; }
const textTexes = [];
// 글자 텍스처: 글자 폭에 맞춰 캔버스 크기 결정 → 늘어나거나 잘리지 않음
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
  const m = new THREE.Mesh(new THREE.PlaneGeometry(heightM * w / h, heightM), new THREE.MeshBasicMaterial({ map: tex, transparent: !bg, depthWrite: !!bg, toneMapped: false }));
  return m;
}
function noise(g, w, h, amt, chroma = [1, 1, 1]) {
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) { const n = (Math.random() - 0.5) * amt; img.data[i] += n * chroma[0]; img.data[i + 1] += n * chroma[1]; img.data[i + 2] += n * chroma[2]; }
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
// 창문 텍스처 (밤 건물)
// 한 타일 = 가로 16칸 x 세로 16층. 세대(2칸) 단위로 불이 켜짐
function windowTex(seed = 1, lit = 0.45) {
  const t = windowTex0(seed, lit); t.userData.win = true; return t;
}
function windowTex0(seed = 1, lit = 0.45) {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#121824'; g.fillRect(0, 0, w, h);
    let s = seed;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    const cw = w / 16, ch = h / 16;
    for (let r = 0; r < 16; r++) {
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, r * ch + ch - 3, w, 3);
      for (let c = 0; c < 16; c += 2) {
        const on = rnd() < lit, warm = rnd() < 0.8, a = 0.55 + rnd() * 0.4;
        g.fillStyle = on ? (warm ? `rgba(255,214,150,${a})` : `rgba(200,225,255,${a})`) : 'rgba(46,58,80,.9)';
        g.fillRect(c * cw + 2, r * ch + 3, cw * 2 - 4, ch - 7);
      }
    }
  }, true);
}
// 낮용 건물 외벽: 밝은 콘크리트 + 하늘 비친 유리
let _dayWin = null;
function dayWindowTex() {
  if (_dayWin) return _dayWin;
  _dayWin = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#b9c0ca'; g.fillRect(0, 0, w, h);
    let s = 77; const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    const cw = w / 16, ch = h / 16;
    for (let r = 0; r < 16; r++) for (let c = 0; c < 16; c += 2) {
      const v = 70 + rnd() * 50;
      g.fillStyle = `rgb(${v * 0.75 | 0},${v * 0.9 | 0},${v * 1.15 | 0})`;
      g.fillRect(c * cw + 2, r * ch + 3, cw * 2 - 4, ch - 7);
    }
  }, true);
  return _dayWin;
}

// 좌석 구역 (|phi| 기준, phi = 중견수 0 ~ 홈 뒤 π)
export const SEAT_ZONES = [
  { name: '테이블석', from: 163, to: 180, color: '#2b3550' },
  { name: '블루석', from: 138, to: 163, color: '#2f63c4' },
  { name: '오렌지석', from: 104, to: 138, color: '#ef7d2c' },
  { name: '레드석', from: 46, to: 104, color: '#c8343c' },
  { name: '외야 그린석', from: 0, to: 46, color: '#3f8a4f' },
];
function zoneColor(phi) {
  const a = Math.abs(phi) / DEG;
  for (const z of SEAT_ZONES) if (a >= z.from && a <= z.to) return new THREE.Color(z.color);
  return new THREE.Color('#888');
}

export function buildStadium(scene, opt = {}) {
  const world = new THREE.Group();
  const todRefs = { glows: [], winMats: [], nightOnly: [] };
  scene.add(world);
  const hiQ = opt.quality !== 'low';

  // ═════════ 1. 그라운드 (한 장으로 굽기 → 겹침 깜빡임 없음) ═════════
  const FX0 = -80, FZ0 = -28, FS = 160;
  const RES = hiQ ? 4096 : 2048;
  const fieldTex = canvasTex(RES, RES, (g, W, H) => {
    const k = W / FS;
    g.setTransform(k, 0, 0, k, -FX0 * k, -FZ0 * k);
    const P = (x, z) => [x, z];
    // 잔디 기본
    g.fillStyle = '#2f7a35'; g.fillRect(FX0, FZ0, FS, FS);
    // 예초 패턴: 베이스라인과 평행한 체크무늬 (6m)
    g.save();
    g.rotate(Math.PI / 4);
    const st = 6.1;
    for (let i = -40; i < 40; i++) for (let j = -40; j < 40; j++) {
      if ((i + j) & 1) continue;
      g.fillStyle = 'rgba(120,200,110,.11)'; g.fillRect(i * st, j * st, st, st);
    }
    g.restore();
    // 외야 동심 줄무늬(살짝)
    for (let r = 50; r < 128; r += 6) { g.strokeStyle = 'rgba(0,0,0,.035)'; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, r, Math.PI / 4, Math.PI * 3 / 4); g.stroke(); }
    // 흙 패턴
    const dirt = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const d = c.getContext('2d'); d.fillStyle = '#b57549'; d.fillRect(0, 0, 128, 128); noise(d, 128, 128, 30, [1, 0.8, 0.6]); for (let i = 0; i < 220; i++) { d.fillStyle = Math.random() < 0.5 ? 'rgba(120,70,40,.35)' : 'rgba(215,160,115,.3)'; d.fillRect(Math.random() * 128, Math.random() * 128, 1.5, 1.5); } return g.createPattern(c, 'repeat'); })();
    dirt.setTransform(new DOMMatrix().scale(1 / 40));
    const fillDirt = (path) => { g.fillStyle = dirt; g.fill(path); g.strokeStyle = 'rgba(70,40,20,.35)'; g.lineWidth = 0.12; g.stroke(path); };
    // 워닝트랙 (페어 + 파울 경계)
    {
      const p = new Path2D();
      const N = 300;
      for (let i = 0; i <= N; i++) { const phi = -Math.PI + i / N * Math.PI * 2; const r = standR(phi) + 0.5; i ? p.lineTo(Math.sin(phi) * r, Math.cos(phi) * r) : p.moveTo(Math.sin(phi) * r, Math.cos(phi) * r); }
      for (let i = N; i >= 0; i--) { const phi = -Math.PI + i / N * Math.PI * 2; const r = Math.abs(phi) <= FOUL ? fenceR(phi) - 4.6 : standR(phi) - 2.8; p.lineTo(Math.sin(phi) * r, Math.cos(phi) * r); }
      p.closePath();
      g.fillStyle = dirt; g.fill(p, 'nonzero');
      g.fillStyle = 'rgba(90,55,35,.18)'; g.fill(p, 'nonzero');
    }
    // 내야 흙 (마운드 중심 반지름 29m 원호 + 홈 쪽)
    {
      const p = new Path2D();
      p.arc(MOUND[0], MOUND[1], 29, 0, Math.PI * 2);
      fillDirt(p);
      // 내야 잔디 (베이스 사각형보다 약간 안쪽, 모서리 둥글게)
      const H2 = BASES[1][1], c = [0, H2];
      const q = new Path2D();
      const kq = 0.86;
      const pts = BASES.map(([x, z]) => [c[0] + (x - c[0]) * kq, c[1] + (z - c[1]) * kq]);
      q.moveTo(...pts[0]); for (let i = 1; i < 4; i++) q.lineTo(...pts[i]); q.closePath();
      g.save(); g.clip(q);
      g.fillStyle = '#2f7a35'; g.fillRect(FX0, FZ0, FS, FS);
      g.rotate(Math.PI / 4);
      for (let i = -12; i < 12; i++) for (let j = -12; j < 12; j++) { if ((i + j) & 1) continue; g.fillStyle = 'rgba(120,200,110,.12)'; g.fillRect(i * 4.57, j * 4.57, 4.57, 4.57); }
      g.restore();
      g.strokeStyle = 'rgba(40,25,10,.4)'; g.lineWidth = 0.1; g.stroke(q);
      // 베이스 주변 흙, 홈 원, 마운드
      for (const [x, z] of BASES.slice(1)) { const b = new Path2D(); b.arc(x, z, 3.0, 0, Math.PI * 2); fillDirt(b); }
      const hp = new Path2D(); hp.arc(0, 0, 4.0, 0, Math.PI * 2); fillDirt(hp);
      const md = new Path2D(); md.arc(MOUND[0], MOUND[1], 2.74, 0, Math.PI * 2); fillDirt(md);
      // 1루·3루 주로 흙길
      for (const k of [1, 3]) { g.save(); g.strokeStyle = dirt; g.lineWidth = 1.6; g.beginPath(); g.moveTo(0, 0); g.lineTo(...BASES[k]); g.stroke(); g.restore(); }
      // 홈→마운드 흙길 없음(잠실은 일반형)
    }
    // 흙/잔디 경계 그림자
    g.strokeStyle = 'rgba(30,60,25,.25)'; g.lineWidth = 0.25; g.beginPath(); g.arc(MOUND[0], MOUND[1], 29.1, 0, Math.PI * 2); g.stroke();
    // 라인
    g.strokeStyle = '#f6f6f1'; g.lineCap = 'butt';
    const line = (x1, z1, x2, z2, w = 0.1) => { g.lineWidth = w; g.beginPath(); g.moveTo(x1, z1); g.lineTo(x2, z2); g.stroke(); };
    const s45 = Math.sin(FOUL);
    line(0.3, 0.3, 100 * s45, 100 * s45); line(-0.3, 0.3, -100 * s45, 100 * s45);
    const box = (cx, cz, w, l) => { g.lineWidth = 0.075; g.strokeRect(cx - w / 2, cz - l / 2, w, l); };
    box(0.92, 0, 1.22, 1.83); box(-0.92, 0, 1.22, 1.83);
    g.lineWidth = 0.075; g.beginPath(); g.moveTo(-0.55, -0.92); g.lineTo(-0.55, -3.0); g.lineTo(0.55, -3.0); g.lineTo(0.55, -0.92); g.stroke();
    // 1루 주루 라인 (3피트)
    { const [x, z] = BASES[1]; const d = Math.hypot(x, z), ux = x / d, uz = z / d, nx = -uz, nz = ux; line(ux * d * 0.5 - nx * 0.91, uz * d * 0.5 - nz * 0.91, x - nx * 0.91, z - nz * 0.91, 0.075); line(ux * d * 0.5 - nx * 0.91, uz * d * 0.5 - nz * 0.91, ux * d * 0.5, uz * d * 0.5, 0.075); }
    // 코치 박스
    for (const s of [-1, 1]) { g.lineWidth = 0.075; g.save(); g.translate(s * 26, 22); g.rotate(-s * Math.PI / 4); g.strokeRect(-1, -3, 2, 6); g.restore(); }
    // 대기 타석 원
    for (const s of [-1, 1]) {
      const c = new Path2D(); c.arc(s * 11, -5, 1.4, 0, Math.PI * 2);
      g.fillStyle = '#7e8a5a'; g.fill(c); g.lineWidth = 0.08; g.strokeStyle = '#f6f6f1'; g.stroke(c);
    }
    // 디테일 노이즈 한 겹
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 0.05; noise(g, W, H, 40, [0.7, 1, 0.6]); g.globalAlpha = 1;
  });
  fieldTex.anisotropy = 16;
  const detailTex = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#808080'; g.fillRect(0, 0, w, h); noise(g, w, h, 70); g.globalAlpha = 0.25; for (let i = 0; i < 3000; i++) { g.fillStyle = Math.random() < 0.5 ? '#4a4a4a' : '#b8b8b8'; g.fillRect(Math.random() * w, Math.random() * h, 1, 2.5); } }, true);
  detailTex.colorSpace = THREE.NoColorSpace;
  const fieldMat = new THREE.MeshStandardMaterial({ map: fieldTex, roughness: 0.95 });
  // 사진 디테일 텍스처 (assets/tex: AI로 만든 흙·잔디). 평균색으로 나눠서 '무늬'만 입힘
  const photo = { grass: { value: detailTex }, dirt: { value: detailTex }, gAvg: { value: new THREE.Vector3(0.5, 0.5, 0.5) }, dAvg: { value: new THREE.Vector3(0.5, 0.5, 0.5) }, hasG: { value: 0 }, hasD: { value: 0 } };
  const texLoader = new THREE.TextureLoader();
  for (const [k, info] of Object.entries(opt.tex || {})) {
    if (!info || !info.url || !photo[k]) continue;
    texLoader.load(info.url, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8; t.needsUpdate = true;
      photo[k].value = t; photo[k === 'grass' ? 'gAvg' : 'dAvg'].value.set(...info.avg); photo[k === 'grass' ? 'hasG' : 'hasD'].value = 1;
    });
  }
  fieldMat.onBeforeCompile = (sh) => {
    sh.uniforms.detail = { value: detailTex };
    Object.assign(sh.uniforms, { pGrass: photo.grass, pDirt: photo.dirt, gAvg: photo.gAvg, dAvg: photo.dAvg, hasG: photo.hasG, hasD: photo.hasD });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vWxz;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWxz = (modelMatrix * vec4(position,1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D detail; uniform sampler2D pGrass; uniform sampler2D pDirt; uniform vec3 gAvg; uniform vec3 dAvg; uniform float hasG; uniform float hasD; varying vec2 vWxz;')
      .replace('#include <map_fragment>', `#include <map_fragment>
 float dt1 = texture2D(detail, vWxz * 0.35).r; float dt2 = texture2D(detail, vWxz * 0.045).r;
 vec3 bc = diffuseColor.rgb;
 float isDirt = smoothstep(0.0, 0.08, bc.r - bc.g);
 float isLine = smoothstep(0.55, 0.75, min(bc.r, min(bc.g, bc.b)));
 // 두 스케일로 섞어서 반복 티 안 나게
 vec3 g1 = texture2D(pGrass, vWxz * 0.42).rgb / gAvg, g2 = texture2D(pGrass, vWxz * 0.11 + 0.37).rgb / gAvg;
 vec3 d1 = texture2D(pDirt, vWxz * 0.55).rgb / dAvg, d2 = texture2D(pDirt, vWxz * 0.13 + 0.61).rgb / dAvg;
 vec3 gm = mix(vec3(0.78 + 0.32 * dt1), mix(g1, g2, 0.35), hasG);
 vec3 dm = mix(vec3(0.78 + 0.32 * dt1), mix(d1, d2, 0.3), hasD);
 vec3 m = mix(gm, dm, isDirt);
 m = mix(m, vec3(0.94 + 0.08 * dt1), isLine);
 diffuseColor.rgb *= clamp(m, 0.45, 1.7) * (1.0 + 0.18 * (dt2 - 0.5));`);
  };
  {
    // 그라운드 = 관중석 경계선 안쪽만 (경기장 밖으로 삐져나오지 않게)
    const pts = [];
    const N = 360;
    for (let i = 0; i < N; i++) { const phi = -Math.PI + i / N * Math.PI * 2; const r = (Math.abs(phi) <= FOUL ? fenceR(phi) + 2.3 : standR(phi) + 1.1); pts.push(new THREE.Vector2(Math.sin(phi) * r, -Math.cos(phi) * r)); }
    const fg = new THREE.ShapeGeometry(new THREE.Shape(pts), 1); fg.rotateX(-Math.PI / 2);
    const uv = fg.attributes.uv, pos = fg.attributes.position;
    for (let i = 0; i < uv.count; i++) { const x = pos.getX(i), z = pos.getZ(i); uv.setXY(i, (x - FX0) / FS, 1 - (z - FZ0) / FS); }
    const field = new THREE.Mesh(fg, fieldMat);
    field.receiveShadow = true; world.add(field);
  }
  // 바깥 바닥 (경기장 주변 광장/도로)
  const plazaTex = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#1b1f27'; g.fillRect(0, 0, w, h); noise(g, w, h, 14); g.strokeStyle = 'rgba(255,255,255,.04)'; for (let i = 0; i < w; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); } }, true);
  plazaTex.repeat.set(160, 160);
  const outer = new THREE.Mesh(new THREE.CircleGeometry(3200, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: plazaTex, roughness: 1, color: '#7c8394' }));
  outer.position.y = -0.4; world.add(outer);

  // 마운드 (높이 25cm)
  const dirtMat = new THREE.MeshStandardMaterial({ color: '#b57549', roughness: 1 });
  dirtMat.onBeforeCompile = fieldMat.onBeforeCompile;
  {
    const prof = [[0, 0.254], [0.6, 0.254], [1.0, 0.24], [1.6, 0.17], [2.2, 0.07], [2.74, 0.0]].map(([r, y]) => new THREE.Vector2(r, y));
    const m = new THREE.Mesh(new THREE.LatheGeometry(prof, 48), dirtMat);
    m.position.set(MOUND[0], 0.005, MOUND[1]); m.receiveShadow = true; world.add(m);
  }
  const chalk = new THREE.MeshStandardMaterial({ color: '#f7f7f2', roughness: 0.8 });
  { const rubber = new THREE.Mesh(new THREE.BoxGeometry(0.61, 0.04, 0.15), chalk); rubber.position.set(0, 0.27, MOUND[1]); rubber.receiveShadow = true; world.add(rubber); }
  // 베이스 + 홈플레이트
  {
    const bag = new THREE.BoxGeometry(0.381, 0.1, 0.381, 2, 1, 2);
    const p = bag.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * 0.93); p.setZ(i, p.getZ(i) * 0.93); }
    bag.computeVertexNormals();
    for (const [x, z] of BASES.slice(1)) { const b = new THREE.Mesh(bag, chalk); b.position.set(x, 0.05, z); b.rotation.y = Math.PI / 4; b.castShadow = b.receiveShadow = true; world.add(b); }
    const s = new THREE.Shape([new THREE.Vector2(-0.216, 0), new THREE.Vector2(0.216, 0), new THREE.Vector2(0.216, 0.216), new THREE.Vector2(0, 0.432), new THREE.Vector2(-0.216, 0.216)]);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: false }); g.rotateX(Math.PI / 2);
    const hp = new THREE.Mesh(g, chalk); hp.position.set(0, 0.022, 0.216); hp.rotation.y = Math.PI; hp.receiveShadow = true; world.add(hp);
  }

  // ═════════ 2. 리본 생성기 ═════════
  // phis 배열을 따라 (r(phi,t), y(phi,t))로 띠를 만든다. uvFn(arcLen, t) → [u, v]
  function ribbon(phis, rFn, yFn, rows, mat, colorFn, uvFn, parent = world) {
    const pos = [], uvs = [], col = [], idx = [];
    let arc = 0;
    for (let i = 0; i < phis.length; i++) {
      const phi = phis[i];
      if (i) arc += Math.abs(phi - phis[i - 1]) * rFn(phi, 0);
      for (let j = 0; j <= rows; j++) {
        const t = j / rows, r = rFn(phi, t), y = yFn(phi, t);
        pos.push(Math.sin(phi) * r, y, Math.cos(phi) * r);
        const [u, v] = uvFn ? uvFn(arc, t, phi) : [arc, t];
        uvs.push(u, v);
        const c = colorFn ? colorFn(phi, t) : null; col.push(c ? c.r : 1, c ? c.g : 1, c ? c.b : 1);
      }
    }
    for (let i = 0; i < phis.length - 1; i++) for (let j = 0; j < rows; j++) { const a = i * (rows + 1) + j, b = a + rows + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; parent.add(m);
    return m;
  }
  const concrete = new THREE.MeshStandardMaterial({ color: '#6d717c', roughness: 0.95, side: THREE.DoubleSide });
  const concreteDark = new THREE.MeshStandardMaterial({ color: '#3a3f4b', roughness: 0.95, side: THREE.DoubleSide });
  const steel = new THREE.MeshStandardMaterial({ color: '#8a93a3', roughness: 0.45, metalness: 0.6 });
  const steelDark = new THREE.MeshStandardMaterial({ color: '#3d4554', roughness: 0.5, metalness: 0.5 });

  // ═════════ 3. 펜스 · 광고 ═════════
  // 광고판: 각 광고 칸 비율 = 칸 길이 / 높이 → 글자가 늘어나지 않음
  function adStrip(ads, heightM, segAspect = 5) {
    const H = 96, segW = Math.round(H * segAspect), W = segW * ads.length;
    const tex = canvasTex(W, H, (g) => {
      ads.forEach(([bg, fg, t, sub], i) => {
        const x = i * segW;
        const gr = g.createLinearGradient(x, 0, x, H); gr.addColorStop(0, bg); gr.addColorStop(1, shade(bg, -0.25));
        g.fillStyle = gr; g.fillRect(x, 0, segW, H);
        g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(x, 0, 2, H);
        g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
        let size = 54; g.font = `900 ${size}px "Noto Sans KR", Oswald, sans-serif`;
        while (g.measureText(t).width > segW * 0.86 && size > 20) { size -= 2; g.font = `900 ${size}px "Noto Sans KR", Oswald, sans-serif`; }
        g.fillText(t, x + segW / 2, sub ? H * 0.42 : H / 2 + 3);
        if (sub) { g.font = `700 22px Oswald, "Noto Sans KR", sans-serif`; g.globalAlpha = 0.8; g.fillText(sub, x + segW / 2, H * 0.78); g.globalAlpha = 1; }
      });
    }, true);
    textTexes.push(tex);
    tex.userData.repeatLen = heightM * segAspect * ads.length; // 한 바퀴 길이(m)
    return tex;
  }
  function shade(hex, k) { const c = new THREE.Color(hex); c.multiplyScalar(1 + k); return '#' + c.getHexString(); }
  // ── 광고 아틀라스: assets/ads/adNN.jpg (5:1) 를 한 장에 모아 펜스·LED에 사용 ──
  const AD_COLS = 4, AD_ROWS = 16, CW = 512, CH = 102;
  const adCanvas = document.createElement('canvas'); adCanvas.width = CW * AD_COLS; adCanvas.height = CH * AD_ROWS;
  const adG = adCanvas.getContext('2d');
  const adTex = new THREE.CanvasTexture(adCanvas); adTex.colorSpace = THREE.SRGBColorSpace; adTex.anisotropy = 8;
  const fallbackAds = [['#0f3d2a', '#ffd23a', 'JAMSIL'], ['#1e4f8c', '#ffffff', 'HOMERUN KING'], ['#b52a2f', '#ffffff', 'PLAY BALL'], ['#202835', '#ff9b3d', 'SEOUL NIGHT']];
  let AD_N = 0;
  const adURLs = opt.ads || [];
  function drawFallback(i) {
    const [bg, fg, t] = fallbackAds[i % fallbackAds.length], x = (i % AD_COLS) * CW, y = Math.floor(i / AD_COLS) * CH;
    adG.fillStyle = bg; adG.fillRect(x, y, CW, CH); adG.fillStyle = fg; adG.font = '900 46px Oswald, sans-serif'; adG.textAlign = 'center'; adG.textBaseline = 'middle'; adG.fillText(t, x + CW / 2, y + CH / 2 + 2);
  }
  AD_N = Math.max(4, adURLs.length);
  for (let i = 0; i < AD_N; i++) drawFallback(i);
  adURLs.forEach((u, i) => { const img = new Image(); img.onload = () => { adG.drawImage(img, (i % AD_COLS) * CW, Math.floor(i / AD_COLS) * CH, CW, CH); adTex.needsUpdate = true; }; img.src = u; });
  const cellUV = (k) => { k = ((k % AD_N) + AD_N) % AD_N; const c = k % AD_COLS, r = Math.floor(k / AD_COLS); return [c / AD_COLS, 1 - (r + 1) / AD_ROWS, (c + 1) / AD_COLS, 1 - r / AD_ROWS]; };
  // 회전 LED 셰이더: 슬롯 번호 + 시간 단계로 칸을 골라 그림
  const ledUni = { uStep: { value: 0 }, uFlash: { value: 0 }, uN: { value: AD_N } };
  function ledMaterial(bright = 1.15) {
    return new THREE.ShaderMaterial({
      uniforms: { map: { value: adTex }, uStep: ledUni.uStep, uFlash: ledUni.uFlash, uN: ledUni.uN, uB: { value: bright } },
      vertexShader: 'attribute float aSlot; attribute vec2 aLuv; varying vec2 vL; varying float vS; void main(){ vL = aLuv; vS = aSlot; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform sampler2D map; uniform float uStep; uniform float uFlash; uniform float uN; uniform float uB; varying vec2 vL; varying float vS;
        void main(){ float k = mod(floor(vS + uStep + 0.5), uN); float c = mod(k, ${AD_COLS}.0); float r = floor(k / ${AD_COLS}.0);
          vec2 uv = vec2((c + vL.x) / ${AD_COLS}.0, 1.0 - (r + 1.0 - vL.y) / ${AD_ROWS}.0);
          vec3 col = texture2D(map, uv).rgb;
          float dots = 0.82 + 0.18 * step(0.35, fract(vL.y * 34.0)) * step(0.3, fract(vL.x * 170.0));
          col = col * dots * uB + vec3(uFlash * 0.6);
          gl_FragColor = vec4(col, 1.0); }`,
      side: THREE.DoubleSide, toneMapped: false,
    });
  }
  // 곡선을 따라 광고 판넬(직사각형) 나열. 필드 쪽에서 보면 글자가 바로 읽히도록 UV 배치
  function adPanels({ from, to, rFn, y0, h, panelW, slot0 = 0, mat, gap = 0.04, led = false }) {
    const pos = [], uv = [], slots = [], luv = [], idx = [];
    const dir = Math.sign(to - from);
    let phi = from, k = slot0, n = 0;
    while (dir > 0 ? phi < to : phi > to) {
      const r = rFn(phi);
      const p2 = phi + dir * panelW / r;
      if (dir > 0 ? p2 > to + 1e-6 : p2 < to - 1e-6) break;
      const pe = p2 - dir * gap / r;
      const ra = rFn(phi), rb = rFn(pe);
      const ax = Math.sin(phi) * ra, az = Math.cos(phi) * ra, bx = Math.sin(pe) * rb, bz = Math.cos(pe) * rb;
      // 필드에서 볼 때 phi가 큰 쪽이 왼쪽
      const [L, Rr] = dir > 0 ? [[bx, bz], [ax, az]] : [[ax, az], [bx, bz]];
      const base = n * 4;
      const ya = typeof y0 === 'function' ? y0(phi) : y0, yb = typeof y0 === 'function' ? y0(pe) : y0;
      const [yL, yR] = dir > 0 ? [yb, ya] : [ya, yb];
      pos.push(L[0], yL, L[1], Rr[0], yR, Rr[1], Rr[0], yR + h, Rr[1], L[0], yL + h, L[1]);
      const [u0, v0, u1, v1] = cellUV(k);
      uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
      luv.push(0, 0, 1, 0, 1, 1, 0, 1);
      slots.push(k, k, k, k);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      phi = p2; k++; n++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aLuv', new THREE.Float32BufferAttribute(luv, 2));
    g.setAttribute('aSlot', new THREE.Float32BufferAttribute(slots, 1));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat || (led ? ledMaterial() : new THREE.MeshStandardMaterial({ map: adTex, roughness: 0.75, side: THREE.DoubleSide })));
    world.add(m);
    return { mesh: m, count: n };
  }
  const fencePhis = range(-FOUL, FOUL, 180);
  const padTex = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#1b5a40'; g.fillRect(0, 0, w, h);
    const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, 'rgba(0,0,0,.28)'); gr.addColorStop(0.06, 'rgba(255,255,255,.05)'); gr.addColorStop(0.94, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.28)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h); noise(g, w, h, 8);
  }, true);
  const padM = new THREE.MeshStandardMaterial({ map: padTex, roughness: 0.85, side: THREE.DoubleSide });
  // 펜스 = 아래 패딩(1.6m) + 광고(0.9m) + 노란 라인
  ribbon(fencePhis, (p) => fenceR(p), (p, t) => t * (WALL_H - 1.0), 1, padM, null, (arc, t) => [arc / 1.2, t]);
  // 외야 펜스 광고 판넬 (실제 구장처럼 패딩 위에 큰 광고). 중앙 백스크린 앞은 비움
  adPanels({ from: -FOUL + 0.004, to: -9 * DEG, rFn: (p) => fenceR(p) - 0.03, y0: 0.55, h: 1.45, panelW: 7.25, slot0: 0 });
  adPanels({ from: 9 * DEG, to: FOUL - 0.004, rFn: (p) => fenceR(p) - 0.03, y0: 0.55, h: 1.45, panelW: 7.25, slot0: 11 });
  ribbon(fencePhis, (p) => fenceR(p) - 0.02, (p, t) => WALL_H - 0.1 + t * 0.12, 1, new THREE.MeshBasicMaterial({ color: '#ffd23a', side: THREE.DoubleSide }));
  // 펜스 두께(위 캡)
  ribbon(fencePhis, (p, t) => fenceR(p) + t * 0.35, () => WALL_H + 0.02, 1, steelDark);
  // 거리 표시
  for (const [deg, txt] of [[-45, '100'], [-22.5, '120'], [0, '125'], [22.5, '120'], [45, '100']]) {
    const phi = deg * DEG, r = fenceR(phi) - 0.05;
    const l = textMesh(txt + 'm', 0.62, { color: '#ffffff', px: 110 });
    l.position.set(Math.sin(phi) * r, 0.75, Math.cos(phi) * r); l.lookAt(0, 0.75, 0); world.add(l);
  }
  // 파울 지역 벽 (1.2m, 남색 패딩 + LED 광고)
  const foulWall = new THREE.MeshStandardMaterial({ color: '#17244a', roughness: 0.8, side: THREE.DoubleSide });
  for (const s of [-1, 1]) {
    const phis = range(s * FOUL, s * Math.PI, 140);
    ribbon(phis, (p) => standR(p), (p, t) => t * 1.25, 1, foulWall);
    // 파울 지역·백네트 아래 회전 LED 광고
    adPanels({ from: s * (FOUL + 0.01), to: s * (Math.PI - 0.002), rFn: (p) => standR(p) - 0.03, y0: 0.32, h: 0.8, panelW: 4.0, slot0: s > 0 ? 3 : 9, led: true, gap: 0 });
  }
  // 백스톱 그물 + 내야 보호망 (홈 뒤 ~ 덕아웃 끝까지)
  {
    const netTex = canvasTex(64, 64, (g, w, h) => { g.strokeStyle = 'rgba(225,232,245,.7)'; g.lineWidth = 1; for (let i = 0; i <= w; i += 8) { g.beginPath(); g.moveTo(i + 0.5, 0); g.lineTo(i + 0.5, h); g.stroke(); g.beginPath(); g.moveTo(0, i + 0.5); g.lineTo(w, i + 0.5); g.stroke(); } }, true);
    const netM = new THREE.MeshBasicMaterial({ map: netTex, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.45 });
    for (const s of [-1, 1]) {
      const phis = range(s * Math.PI, s * 115 * DEG, 50);
      const h = (p) => lerp(7, 4.2, smooth(160 * DEG, 125 * DEG, Math.abs(p)));
      const m = ribbon(phis, (p) => standR(p) + 0.15, (p, t) => 1.25 + t * h(p), 1, netM, null, (arc, t, p) => [arc / 1.6, t * h(p) / 1.6]);
      m.receiveShadow = false; m.renderOrder = 2;
      for (const p of range(s * Math.PI, s * 115 * DEG, 6)) { const r = standR(p) + 0.2; const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, h(p) + 1.3, 6), steelDark); pole.position.set(Math.sin(p) * r, (h(p) + 1.3) / 2, Math.cos(p) * r); world.add(pole); }
    }
  }
  // 폴대
  const poleMat = new THREE.MeshStandardMaterial({ color: '#ffd23a', emissive: '#5a4500', roughness: 0.5 });
  for (const s of [-1, 1]) {
    const x = s * 100 * Math.sin(FOUL), z = 100 * Math.cos(FOUL);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 24, 12), poleMat); pole.position.set(x + s * 0.2, 12, z + 0.2); world.add(pole);
    const fin = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 19), new THREE.MeshStandardMaterial({ color: '#ffd23a', transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    fin.position.set(x + s * 0.65, 13.5, z - 0.25); fin.rotation.y = s * Math.PI / 4; world.add(fin);
  }

  // ═════════ 4. 관중석 ═════════
  const seatTex = canvasTex(64, 64, (g, w, h) => {
    // 한 줄(행) = 텍스처 세로 1칸. 좌석 등받이 + 통로 그림자
    g.fillStyle = '#d7d9de'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x, 0, 2, h * 0.62); g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(x + 3, 4, 10, 3); }
    g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, h * 0.62, w, h * 0.38);
  }, true);
  const seatMat = new THREE.MeshStandardMaterial({ map: seatTex, vertexColors: true, roughness: 0.7, side: THREE.DoubleSide });
  const tiers = [];
  // 계단식 스탠드: 행마다 수평+수직 면
  // 사진 관중 텍스처(AI 생성): 계단 위에 비스듬히 깔아서 3D 관중 사이를 꽉 채움
  const crowdMat = new THREE.MeshStandardMaterial({ color: '#d8d8d8', roughness: 1, side: THREE.DoubleSide, transparent: false });
  if (opt.tex && opt.tex.crowd) new THREE.TextureLoader().load(opt.tex.crowd.url, (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; crowdMat.map = t; crowdMat.color.set('#ffffff'); crowdMat.needsUpdate = true; });
  else crowdMat.visible = false;
  function stand(T) {
    const rows = T.rows;
    if (crowdMat.visible) ribbon(T.phis, (p, t) => T.r0(p) + T.depth(p) * (0.02 + t * 0.98), (p, t) => T.y0(p) + T.rise(p) * t + 0.42, 1, crowdMat, null, (arc, t) => [arc / 15, t * rows / 9]);
    const rFn = (p, t) => { const j = Math.round(t * rows * 2); const step = Math.floor((j + 1) / 2); return T.r0(p) + T.depth(p) * step / rows; };
    const yFn = (p, t) => { const j = Math.round(t * rows * 2); const step = Math.floor(j / 2); return T.y0(p) + T.rise(p) * step / rows; };
    ribbon(T.phis, rFn, yFn, rows * 2, seatMat, T.color, (arc, t) => [arc / 0.55 / 4, t * rows]);
    tiers.push(T);
  }
  const absd = (p) => Math.abs(p) / DEG;
  // 1층 (내야 블루·오렌지·레드 + 테이블석)
  const gap1 = (p) => (Math.abs(p) <= FOUL ? 2.0 : 1.0);
  const lower = {
    phis: range(-Math.PI, Math.PI, 420).filter((p) => Math.abs(p) > FOUL + 0.01),
    r0: (p) => standR(p) + gap1(p), depth: (p) => lerp(18, 22, smooth(60, 120, absd(p))), y0: (p) => 1.6, rise: (p) => lerp(8, 10.5, smooth(60, 120, absd(p))),
    rows: 24, color: (p) => zoneColor(p), lower: true,
  };
  // 왼쪽(+)·오른쪽(-) 구간을 나눠 만들기 (홈 뒤 이음새 처리)
  for (const s of [-1, 1]) {
    const phis = range(s * (FOUL + 0.012), s * Math.PI, 210);
    stand({ ...lower, phis });
    ribbon(phis, (p) => lower.r0(p), (p, t) => t * 1.65, 1, concreteDark); // 1열 앞 벽
  }
  // 외야 그린석 (백스크린 구간 제외)
  const BEYE = 9 * DEG;
  for (const s of [-1, 1]) {
    const phis = range(s * BEYE, s * (FOUL + 0.012), 80);
    stand({ phis, r0: (p) => fenceR(p) + 2.2, depth: () => 17, y0: () => 2.4, rise: () => 8.5, rows: 20, color: (p) => zoneColor(p), outfield: true });
    ribbon(phis, (p) => fenceR(p) + 2.2, (p, t) => t * 2.45, 1, concreteDark);
  }
  // 백스크린 (타자 시야)
  ribbon(range(-BEYE, BEYE, 16), (p, t) => fenceR(p) + 2.2 + t * 17, (p, t) => 2.4 + t * 8.5, 1, new THREE.MeshStandardMaterial({ color: '#0e1a14', roughness: 1, side: THREE.DoubleSide }));
  // 외야 스탠드 뒷벽 / 외벽
  for (const s of [-1, 1]) ribbon(range(s * 0, s * (FOUL + 0.012), 80), (p) => fenceR(p) + 19.4, (p, t) => t * 13, 1, concreteDark);
  // 1층 앞 벽 (그라운드 레벨 ~ 첫 줄)
  // 2층 = 1층 뒤 콘코스·스카이박스 띠 + LED 리본
  const upperR0 = (p) => standR(p) + gap1(p) + lower.depth(p) + 3.0;
  const upY0 = (p) => 1.6 + lower.rise(p) + 4.2;
  const upperSpan = (p) => smooth(58, 70, absd(p));
  for (const s of [-1, 1]) {
    const phis = range(s * 58 * DEG, s * Math.PI, 150);
    // 스카이박스 유리 띠
    const glassTex = windowTex(7 + s, 0.75);
    ribbon(phis, (p) => upperR0(p) - 0.2, (p, t) => 1.6 + lower.rise(p) + 0.3 + t * 3.0, 1, new THREE.MeshBasicMaterial({ map: glassTex, color: '#ffe7c4', side: THREE.DoubleSide }), null, (arc, t) => [arc / 30, t * 0.3]);
    // 네이비석 (3층)
    stand({ phis, r0: (p) => upperR0(p), depth: (p) => 17 * upperSpan(p) + 0.01, y0: upY0, rise: (p) => 13 * upperSpan(p) + 0.01, rows: 20, color: () => new THREE.Color('#25356b'), upper: true });
    // 3층 앞 LED 리본보드
    // 3층 앞 리본 LED: 한 칸 6.2m 슬롯이 몇 초마다 돌아감 (높이는 구간마다 다르니 판넬을 평균 높이에)
    adPanels({ from: s * 58 * DEG, to: s * (Math.PI - 0.002), rFn: (p) => upperR0(p) - 0.14, y0: (p) => upY0(p) - 1.42, h: 1.22, panelW: 6.1, slot0: s > 0 ? 5 : 15, led: true, gap: 0 });
    // 뒷벽
    ribbon(phis, (p) => upperR0(p) + 17 * upperSpan(p) + 0.3, (p, t) => (t < 0.5 ? 0 : upY0(p) + 13 * upperSpan(p) + 3) * (t > 0 ? 1 : 0), 1, concreteDark);
  }
  // 지붕: 홈 뒤 3층 위 (잠실 특유의 내야 지붕)
  const roofSpan = (p) => smooth(118, 135, absd(p));
  for (const s of [-1, 1]) {
    const phis = range(s * 112 * DEG, s * Math.PI, 90);
    const roofY = (p, t) => (upY0(p) + 13 + 9 - t * 3) * 1;
    const roofR = (p, t) => upperR0(p) + lerp(-5 * roofSpan(p), 21, t);
    const roofMat = new THREE.MeshStandardMaterial({ color: '#9ea5b2', roughness: 0.6, metalness: 0.4, side: THREE.DoubleSide });
    ribbon(phis, roofR, (p, t) => roofY(p, t) - (1 - roofSpan(p)) * 0.01, 1, roofMat);
    // 지붕 밑면 트러스 / 조명 띠
    ribbon(phis, (p, t) => roofR(p, 0) + 0.3 + t * 0.2, (p, t) => roofY(p, 0) - 0.9 + t * 0.6, 1, new THREE.MeshBasicMaterial({ color: '#fff3d6', side: THREE.DoubleSide }));
    for (const p of range(s * 114 * DEG, s * 178 * DEG, 8)) {
      // 지붕 기둥 (뒷면)
      const r = upperR0(p) + 17.5, x = Math.sin(p) * r, z = Math.cos(p) * r;
      const h = roofY(p, 0.85);
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, h, 8), steel); col.position.set(x, h / 2, z); world.add(col);
      // 트러스 보
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 26), steelDark);
      beam.position.set(Math.sin(p) * (upperR0(p) + 8), roofY(p, 0.45) - 0.6, Math.cos(p) * (upperR0(p) + 8));
      beam.lookAt(0, beam.position.y, 0); beam.rotateX(-0.12); world.add(beam);
    }
  }
  // 외부 파사드 (밖에서 보이는 경기장 외벽)
  {
    const faTex = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#4b5160'; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 32) { g.fillStyle = '#5e6575'; g.fillRect(x, 0, 14, h); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x + 14, 0, 2, h); }
      for (let y = 40; y < h; y += 86) { g.fillStyle = 'rgba(255,214,150,.55)'; g.fillRect(0, y, w, 6); }
      noise(g, w, h, 10);
    }, true);
    const faM = new THREE.MeshStandardMaterial({ map: faTex, roughness: 0.9, side: THREE.DoubleSide, color: '#7c8292' });
    const phis = range(-Math.PI, Math.PI, 240);
    const outerR = (p) => (Math.abs(p) > 58 * DEG ? upperR0(p) + 17 * upperSpan(p) + 1.2 : fenceR(Math.min(Math.abs(p), FOUL)) + 19.6);
    const outerH = (p) => (Math.abs(p) > 58 * DEG ? upY0(p) + 13 * upperSpan(p) + 3 : 13);
    ribbon(phis, outerR, (p, t) => t * outerH(p), 1, faM, null, (arc, t, p) => [arc / 18, t * outerH(p) / 18]);
  }

  // 응원단상 (오렌지석 1·3루, 각 1개)
  const cheer = [];
  for (const s of [-1, 1]) {
    const p = s * 118 * DEG, r = standR(p) + 1.0;
    const g = new THREE.Group();
    g.position.set(Math.sin(p) * r, 0, Math.cos(p) * r);
    g.lookAt(0, 0, 0);
    // 무대: 첫 줄 위에 돌출
    const deck = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.3, 3.0), new THREE.MeshStandardMaterial({ color: s > 0 ? '#c42b3a' : '#1c3b8a', roughness: 0.6 }));
    deck.position.set(0, 2.6, 1.6); g.add(deck);
    const skirt = textMesh('응원단', 0.55, { color: '#ffffff', font: '900 {s}px "Noto Sans KR", sans-serif', bg: s > 0 ? '#9e1f2c' : '#142d6b', px: 80 });
    skirt.position.set(0, 2.15, 0.08 + 3.1); g.add(skirt);
    world.add(g);
    cheer.push(g);
  }

  // ═════════ 5. 관중 (인스턴싱) ═════════
  let crowd = null;
  {
    // 관중은 30m 넘게 떨어져 있어서 저폴리로 충분 (1명당 378 → 약 56 삼각형, 만 오천 명이라 프레임당 약 500만 삼각형 절약)
    const torso = new THREE.CylinderGeometry(0.16, 0.2, 0.72, 6, 1); torso.translate(0, 0.52, 0);
    const head = new THREE.SphereGeometry(0.12, 5, 3); head.translate(0, 0.98, 0);
    const arms = new THREE.BoxGeometry(0.62, 0.1, 0.1); arms.translate(0, 0.7, 0.05);
    for (const x of [torso, head, arms]) { x.deleteAttribute('uv'); }
    const g = mergeGeometries([torso, head, arms]);
    const list = [];
    const step = hiQ ? 1 : 2;
    for (const T of tiers) {
      const n = T.phis.length;
      for (let i = 0; i < n - 1; i += step) {
        for (let row = 0; row < T.rows; row++) {
          for (let k = 0; k < 2; k++) {
            const phi = lerp(T.phis[i], T.phis[i + 1], (k + 0.2 + Math.random() * 0.6) / 2);
            const a = absd(phi);
            if (T.upper && upperSpan(phi) < 0.7) continue;
            let occ = T.outfield ? 0.55 : T.upper ? 0.62 : a > 104 && a < 138 ? 0.92 : a > 138 ? 0.8 : 0.66;
            if (crowdMat.visible && !(a > 104 && a < 138)) occ *= 0.45; // 사진 관중이 채우니까 3D 관중은 덜
            if (Math.random() > occ) continue;
            const r = T.r0(phi) + T.depth(phi) * (row + 0.45) / T.rows;
            const y = T.y0(phi) + T.rise(phi) * row / T.rows;
            list.push(Math.sin(phi) * r, y, Math.cos(phi) * r, a);
          }
        }
      }
    }
    const count = list.length / 4;
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    const uni = { uTime: { value: 0 }, uExcite: { value: 0 } };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uni.uTime; sh.uniforms.uExcite = uni.uExcite;
      sh.vertexShader = 'uniform float uTime; uniform float uExcite; attribute float aRnd; attribute float aCheer;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float ph = uTime * (5.0 + aRnd * 3.0) + aRnd * 40.0;
        float act = clamp(aCheer * 0.55 + uExcite, 0.0, 1.0) * step(0.3, aRnd + uExcite * 0.8 + aCheer * 0.4);
        transformed.y += max(0.0, sin(ph)) * 0.32 * act + sin(uTime * 1.1 + aRnd * 20.0) * 0.015;
        if (position.y > 0.6 && abs(position.x) > 0.15) transformed.y += (0.25 + 0.2 * sin(ph * 2.0)) * act * abs(position.x) * 1.6;`);
    };
    // 관중을 각도 구역(10개)으로 나눠 따로 그림 → 화면 밖 구역은 통째로 안 그림(절두체 컬링)
    const SECT = 10, buckets = Array.from({ length: SECT }, () => []);
    for (let i = 0; i < count; i++) { const x = list[i * 4], z = list[i * 4 + 2]; const ang = Math.atan2(x, z); buckets[Math.min(SECT - 1, Math.max(0, Math.floor((ang + Math.PI) / (2 * Math.PI) * SECT)))].push(i); }
    crowd = new THREE.Group();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const shirtsHome = ['#e8e1d3', '#c8323a', '#f4f4f4', '#7c8aa8', '#14254a', '#b0232c', '#ffffff', '#202330', '#e2486a', '#3a5fa8'];
    for (const ids of buckets) {
      if (!ids.length) continue;
      const gg = g.clone();
      const im = new THREE.InstancedMesh(gg, mat, ids.length);
      const rndAttr = new Float32Array(ids.length), cheerAttr = new Float32Array(ids.length);
      ids.forEach((i, j) => {
        const x = list[i * 4], y = list[i * 4 + 1], z = list[i * 4 + 2], a = list[i * 4 + 3];
        q.setFromAxisAngle(v.set(0, 1, 0), Math.atan2(-x, -(z - 35)));
        const s = 0.92 + Math.random() * 0.16;
        m.compose(v.set(x, y, z), q, sc.set(s, s, s));
        im.setMatrixAt(j, m);
        // 1루쪽(-x) 원정 팬은 빨강 계열 많게, 3루쪽(+x) 홈 팬은 남색 계열
        let col = shirtsHome[(Math.random() * shirtsHome.length) | 0];
        if (a > 95 && a < 145 && Math.random() < 0.55) col = x > 0 ? '#1d2f63' : '#c2323b';
        im.setColorAt(j, c.set(col).multiplyScalar(0.78 + Math.random() * 0.2));
        rndAttr[j] = Math.random();
        cheerAttr[j] = a > 104 && a < 138 ? 1 : 0;
      });
      gg.setAttribute('aRnd', new THREE.InstancedBufferAttribute(rndAttr, 1));
      gg.setAttribute('aCheer', new THREE.InstancedBufferAttribute(cheerAttr, 1));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere(); if (im.boundingSphere) im.boundingSphere.radius += 2; // 응원 동작 여유
      crowd.add(im);
    }
    crowd.uni = uni;
    world.add(crowd);
  }

  // ═════════ 6. 덕아웃 · 불펜 ═════════
  for (const s of [-1, 1]) {
    // 파울라인에서 22m 떨어진 스탠드 경계, 홈에서 라인 따라 16~38m 구간
    const t = 27, ux = s * Math.SQRT1_2, uz = Math.SQRT1_2, ox = s * Math.SQRT1_2, oz = -Math.SQRT1_2;
    const cx = ux * t + ox * 22.2, cz = uz * t + oz * 22.2;
    const g = new THREE.Group(); g.position.set(cx, 0, cz);
    g.rotation.y = Math.atan2(-ox, -oz); // 그라운드(라인 쪽)를 바라봄
    const len = 20;
    const darkIn = new THREE.MeshStandardMaterial({ color: '#141a26', roughness: 0.9 });
    const roofM = new THREE.Mesh(new THREE.BoxGeometry(len, 0.3, 3.4), new THREE.MeshStandardMaterial({ color: s > 0 ? '#16244a' : '#5a1820', roughness: 0.6 })); roofM.position.set(0, 1.9, -1.0); g.add(roofM);
    const back = new THREE.Mesh(new THREE.BoxGeometry(len, 3.0, 0.3), darkIn); back.position.set(0, 0.6, -2.7); g.add(back);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, 3.0), concrete); floor.position.set(0, -0.85, -1.3); g.add(floor);
    const bench = new THREE.Mesh(new THREE.BoxGeometry(len - 1, 0.45, 0.5), new THREE.MeshStandardMaterial({ color: '#2a3550', roughness: 0.6 })); bench.position.set(0, -0.6, -2.2); g.add(bench);
    for (const e of [-1, 1]) { const side = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.0, 3.4), darkIn); side.position.set(e * len / 2, 0.6, -1.0); g.add(side); }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.07, 0.07), steel); rail.position.set(0, 0.95, 0.55); g.add(rail);
    for (let i = -5; i <= 5; i++) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.0, 0.06), steel); post.position.set(i * 1.95, 0.45, 0.55); g.add(post); }
    const sign = textMesh(s > 0 ? 'HOME' : 'VISITOR', 0.32, { color: '#ffd23a', bg: '#0b0f18', px: 72 }); sign.position.set(0, 1.9, 0.72); g.add(sign);
    // 앉아있는 선수 실루엣
    for (let i = 0; i < 7; i++) { const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.45, 3, 6), new THREE.MeshStandardMaterial({ color: s > 0 ? '#e8e6df' : '#6b7690' })); b.position.set(-8 + i * 2.4 + Math.random(), -0.05, -2.1); g.add(b); }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    world.add(g);
  }
  // 불펜 (파울 지역, 좌·우 외야 쪽)
  for (const s of [-1, 1]) {
    for (let i = 0; i < 2; i++) {
      const prof = [[0, 0.2], [0.5, 0.2], [1.4, 0.05], [1.7, 0]].map(([r, y]) => new THREE.Vector2(r, y));
      const mm = new THREE.Mesh(new THREE.LatheGeometry(prof, 24), dirtMat);
      mm.position.set(s * (49 + i * 2.5), 0.01, 60 + i * 3.5); world.add(mm);
    }
  }

  // ═════════ 7. 조명 ═════════
  const lightMat = new THREE.MeshBasicMaterial({ color: '#fffbea' });
  todRefs.lightMat = lightMat;
  const towers = [];
  function lightBank(x, y, z, w = 16, h = 7, n = [5, 3]) {
    const head = new THREE.Group(); head.position.set(x, y, z);
    head.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.9), steelDark));
    for (let i = 0; i < n[0]; i++) for (let j = 0; j < n[1]; j++) { const L = new THREE.Mesh(new THREE.BoxGeometry(w / n[0] * 0.8, h / n[1] * 0.75, 0.35), lightMat); L.position.set(-w / 2 + (i + 0.5) * w / n[0], -h / 2 + (j + 0.5) * h / n[1], -0.55); head.add(L); }
    head.lookAt(0, -40, 55);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#fff3c4', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85 }));
    glow.scale.set(w * 2.6, h * 3.4, 1); head.add(glow); todRefs.glows.push(glow);
    world.add(head); towers.push(head);
    return head;
  }
  // 지붕 위 조명 (홈 뒤 양쪽)
  for (const deg of [-150, 150, -126, 126]) { const p = deg * DEG, r = upperR0(p) + 6; lightBank(Math.sin(p) * r, upY0(p) + 13 + 13, Math.cos(p) * r, 14, 6); }
  // 독립 조명탑 (파울폴 뒤, 외야 좌·우중간)
  for (const deg of [-58, 58, -24, 24]) {
    const p = deg * DEG, r = (Math.abs(p) > FOUL ? standR(p) + 30 : fenceR(p) + 26);
    const x = Math.sin(p) * r, z = Math.cos(p) * r;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.5, 50, 10), steel); mast.position.set(x, 25, z); world.add(mast);
    lightBank(x, 54, z);
  }

  // ═════════ 8. 전광판 ═════════
  const sbCanvas = document.createElement('canvas'); sbCanvas.width = 1920; sbCanvas.height = 600;
  const sbTex = new THREE.CanvasTexture(sbCanvas); sbTex.colorSpace = THREE.SRGBColorSpace; sbTex.anisotropy = 8;
  const SB = { w: 62, h: 19.4, y: 25, z: fenceR(0) + 21 };
  {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(SB.w + 3, SB.h + 3, 2.6), new THREE.MeshStandardMaterial({ color: '#0f131c', roughness: 0.6 }));
    frame.position.set(0, SB.y, SB.z + 1.4); world.add(frame);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(SB.w, SB.h), new THREE.MeshBasicMaterial({ map: sbTex, toneMapped: false }));
    scr.position.set(0, SB.y, SB.z); scr.rotation.y = Math.PI; world.add(scr);
    for (const sx of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(2.2, SB.y - SB.h / 2, 2.2), steelDark); leg.position.set(sx * SB.w * 0.36, (SB.y - SB.h / 2) / 2, SB.z + 1.4); world.add(leg); }
    const top = textMesh('JAMSIL BASEBALL STADIUM', 2.2, { color: '#ffd23a', bg: '#0b0f18', px: 96 }); top.position.set(0, SB.y + SB.h / 2 + 2.6, SB.z - 0.1); top.rotation.y = Math.PI; world.add(top);
    // 좌우 보조 전광판 (볼카운트·구속)
    for (const sx of [-1, 1]) {
      const sub = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 1.2), new THREE.MeshStandardMaterial({ color: '#0f131c' }));
      const p = sx * 30 * DEG, r = fenceR(p) + 20.2;
      sub.position.set(Math.sin(p) * r, 14.5, Math.cos(p) * r); sub.lookAt(0, 14.5, 0); world.add(sub);
    }
  }
  let sbKey = '';
  function drawScoreboard(s, extra = {}) {
    const key = JSON.stringify([s && s.ls, s && s.sc, s && s.cnt, s && s.bat && s.bat.name, s && s.hits, s && s.errs, s && s.inn, s && s.half, s && s.tn, extra.big, extra.sub, extra.lp && extra.lp.id, extra.force]);
    if (key === sbKey) return; sbKey = key;
    const g = sbCanvas.getContext('2d'), W = sbCanvas.width, H = sbCanvas.height;
    g.fillStyle = '#04060a'; g.fillRect(0, 0, W, H);
    g.textBaseline = 'middle';
    // LED 도트 느낌
    if (extra.big) {
      const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#2a0b02'); gr.addColorStop(0.5, '#ff6a2b'); gr.addColorStop(1, '#2a0b02');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff'; g.textAlign = 'center';
      let size = 260; g.font = `${size}px "Black Han Sans", "Noto Sans KR", sans-serif`;
      while (g.measureText(extra.big).width > W * 0.9 && size > 80) { size -= 10; g.font = `${size}px "Black Han Sans", "Noto Sans KR", sans-serif`; }
      g.fillText(extra.big, W / 2, H * 0.42);
      if (extra.sub) { g.font = '700 84px Oswald, "Noto Sans KR", sans-serif'; g.fillStyle = '#ffe9a8'; g.fillText(extra.sub, W / 2, H * 0.82); }
    } else {
      // 라인스코어
      g.fillStyle = '#0d2a1a'; g.fillRect(0, 0, W, 70);
      g.fillStyle = '#ffd23a'; g.font = '700 44px Oswald, sans-serif'; g.textAlign = 'left'; g.fillText('JAMSIL', 30, 37);
      const inns = Math.max(9, s && s.ls ? Math.max(s.ls[0].length, s.ls[1].length) : 9);
      const x0 = 300, cw = Math.min(78, (W * 0.62 - x0) / inns);
      g.font = '700 38px Oswald, sans-serif'; g.fillStyle = '#8fa1c4'; g.textAlign = 'center';
      for (let i = 0; i < inns; i++) g.fillText(String(i + 1), x0 + i * cw + cw / 2, 112);
      const rx = x0 + inns * cw + 40;
      g.fillText('R', rx, 112); g.fillText('H', rx + 80, 112); g.fillText('E', rx + 160, 112);
      const tn = (s && s.tn) || ['원정', '홈'];
      for (const r of [0, 1]) {
        const y = 185 + r * 82;
        g.textAlign = 'left'; g.fillStyle = r ? '#7aa6ff' : '#ff7b7b';
        let size = 54; g.font = `900 ${size}px "Noto Sans KR", sans-serif`;
        while (g.measureText(tn[r]).width > x0 - 70 && size > 26) { size -= 2; g.font = `900 ${size}px "Noto Sans KR", sans-serif`; }
        g.fillText(tn[r], 50, y);
        if (s && s.half === r && s.ph !== 'over') { g.fillStyle = '#ffd23a'; g.beginPath(); g.arc(26, y, 9, 0, 7); g.fill(); }
        g.textAlign = 'center'; g.font = '700 50px Oswald, sans-serif'; g.fillStyle = '#fff';
        for (let i = 0; i < inns; i++) { const v = s && s.ls && s.ls[r][i]; if (v !== undefined && v !== null) g.fillText(String(v), x0 + i * cw + cw / 2, y); }
        g.fillStyle = '#ffd23a'; g.fillText(String(s && s.sc ? s.sc[r] : 0), rx, y);
        g.fillStyle = '#fff'; g.fillText(String(s && s.hits ? s.hits[r] : 0), rx + 80, y); g.fillText(String(s && s.errs ? s.errs[r] : 0), rx + 160, y);
      }
      // 오른쪽: 타자 · 카운트 · 구속
      const px = W * 0.66;
      g.fillStyle = '#16203a'; g.fillRect(px - 20, 80, 3, H - 100);
      g.textAlign = 'left';
      if (s && s.bat) {
        g.fillStyle = '#8fa1c4'; g.font = '700 38px "Noto Sans KR", sans-serif'; g.fillText('타자', px + 10, 125);
        g.fillStyle = '#fff'; let size = 70; g.font = `900 ${size}px "Noto Sans KR", sans-serif`;
        while (g.measureText(s.bat.name).width > W - px - 140 && size > 30) { size -= 3; g.font = `900 ${size}px "Noto Sans KR", sans-serif`; }
        g.fillText(s.bat.name, px + 110, 125);
        const [b, st, o] = s.cnt || [0, 0, 0];
        const dot = (x, y, n, max, c) => { for (let i = 0; i < max; i++) { g.fillStyle = i < n ? c : '#1a2130'; g.beginPath(); g.arc(x + i * 52, y, 19, 0, 7); g.fill(); } };
        g.font = '700 44px Oswald'; g.fillStyle = '#8fa1c4';
        g.fillText('B', px + 10, 215); dot(px + 80, 215, b, 3, '#4fd18b');
        g.fillText('S', px + 10, 285); dot(px + 80, 285, st, 2, '#ffcf3f');
        g.fillText('O', px + 10, 355); dot(px + 80, 355, o, 2, '#ff4d4d');
      }
      if (extra.lp) {
        g.textAlign = 'right'; g.fillStyle = '#ffd23a'; g.font = '700 150px Oswald, sans-serif'; g.fillText(String(extra.lp.kmh), W - 170, 300);
        g.font = '700 46px Oswald'; g.fillStyle = '#8fa1c4'; g.fillText('km/h', W - 40, 330);
        g.fillStyle = '#fff'; g.font = '900 50px "Noto Sans KR", sans-serif'; g.fillText(extra.lp.name || '', W - 40, 420);
      }
      // 하단 띠
      g.fillStyle = '#0b1120'; g.fillRect(0, H - 70, W, 70);
      g.fillStyle = '#9fb0d0'; g.font = '700 34px "Noto Sans KR", sans-serif'; g.textAlign = 'left';
      g.fillText(extra.ticker || '잠실야구장 · 홈런왕 리그', 30, H - 35);
    }
    // LED 격자
    g.fillStyle = 'rgba(0,0,0,.18)'; for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1); for (let x = 0; x < W; x += 4) g.fillRect(x, 0, 1, H);
    sbTex.needsUpdate = true;
  }
  drawScoreboard(null);

  // ═════════ 9. 주변 환경 (잠실) ═════════
  const envFog = false;
  // 9-1. 아파트 단지·빌딩 (남·서쪽 = -z, +x)
  {
    const geos = [];
    const mats = [];
    const winTexs = [windowTex(3, 0.42), windowTex(11, 0.55), windowTex(23, 0.3)];
    winTexs.forEach((t) => (t.repeat.set(1, 1)));
    const groups = winTexs.map(() => []);
    const placeBox = (x, z, w, h, d, ry, gi) => {
      const b = new THREE.BoxGeometry(w, h, d);
      const uv = b.attributes.uv; const nrm = b.attributes.normal;
      for (let k = 0; k < uv.count; k++) { const side = Math.abs(nrm.getX(k)) > 0.5 ? d : w; uv.setXY(k, uv.getX(k) * side / 40, Math.abs(nrm.getY(k)) > 0.5 ? 0.01 : uv.getY(k) * h / 46); }
      b.rotateY(ry); b.translate(x, h / 2 - 0.4, z);
      groups[gi].push(b);
    };
    let seed = 5; const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    // 아파트 판상형: 정렬된 단지
    const complexes = [[420, -300, 0.3], [700, -120, -0.2], [180, -620, 0.1], [-260, -700, 0.2], [-700, -420, -0.4], [650, 380, 0.5], [950, -600, 0.15], [-1100, -900, 0.3], [300, -1100, 0]];
    for (const [cx, cz, rot] of complexes) {
      for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) {
        const lx = (i - 2) * 70, lz = (j - 1) * 80;
        const x = cx + lx * Math.cos(rot) - lz * Math.sin(rot), z = cz + lx * Math.sin(rot) + lz * Math.cos(rot);
        if (Math.hypot(x, z - 40) < 330) continue;
        placeBox(x, z, 48 + rnd() * 18, 70 + rnd() * 40, 15, rot, (i + j) % 3);
      }
    }
    // 흩어진 빌딩
    for (let i = 0; i < 90; i++) {
      const a = rnd() * Math.PI * 2, r = 900 + rnd() * 900;
      placeBox(Math.cos(a) * r, Math.sin(a) * r + 40, 30 + rnd() * 40, 30 + Math.pow(rnd(), 2) * 120, 25 + rnd() * 20, rnd() * 3, i % 3);
    }
    groups.forEach((gs, i) => { if (gs.length) { const m = new THREE.Mesh(mergeGeometries(gs), new THREE.MeshBasicMaterial({ map: winTexs[i], color: '#c0c6d4', fog: true })); world.add(m); } });
  }
  // 9-2. 올림픽주경기장 (동쪽 = -x)
  {
    const g = new THREE.Group();
    g.position.set(-560, -14, 70); g.scale.set(1, 0.55, 1); // 구장 안에서는 거의 안 보이게(실제로 내부에선 안 보임)
    const rx = 150, rz = 115;
    const N = 96;
    const ringPts = (s) => Array.from({ length: N + 1 }, (_, i) => { const a = i / N * Math.PI * 2; return [Math.cos(a) * rx * s, Math.sin(a) * rz * s]; });
    // 외벽: 가운데가 낮고 양 끝이 솟는 곡선(백자 곡선 지붕선)
    const roofY = (a) => 32 + 14 * Math.pow(Math.abs(Math.cos(a)), 2);
    const pos = [], idx = [], uvs = [];
    for (let i = 0; i <= N; i++) {
      const a = i / N * Math.PI * 2, x = Math.cos(a) * rx, z = Math.sin(a) * rz;
      pos.push(x, 0, z, x * 1.0, roofY(a) - 6, z * 1.0, x * 0.83, roofY(a), z * 0.83);
      uvs.push(i / N * 30, 0, i / N * 30, 0.7, i / N * 30, 1);
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < 2; j++) { const a = i * 3 + j, b = a + 3; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geo.setIndex(idx); geo.computeVertexNormals();
    const facade = canvasTex(256, 256, (c, w, h) => { c.fillStyle = '#3b4252'; c.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 16) { c.fillStyle = '#4b5364'; c.fillRect(x, 0, 8, h); } c.fillStyle = 'rgba(255,220,160,.6)'; c.fillRect(0, h * 0.35, w, 4); c.fillRect(0, h * 0.68, w, 3); }, true);
    g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: facade, side: THREE.DoubleSide, roughness: 0.9 })));
    // 지붕 테두리 조명선
    const rim = []; for (let i = 0; i <= N; i++) { const a = i / N * Math.PI * 2; rim.push(new THREE.Vector3(Math.cos(a) * rx * 0.83, roofY(a) + 0.3, Math.sin(a) * rz * 0.83)); }
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(rim), new THREE.LineBasicMaterial({ color: '#ffe2a8' })));
    world.add(g);
  }
  // 9-3. 잠실 실내체육관/아레나 (북서쪽)
  {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(70, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2.6).scale(1, 0.45, 1), new THREE.MeshStandardMaterial({ color: '#9aa2b2', roughness: 0.6, metalness: 0.3 }));
    dome.position.set(330, 8, 360); world.add(dome);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(66, 68, 9, 32), concreteDark); base.position.set(330, 4.5, 360); world.add(base);
  }
  // 9-4. 롯데월드타워 (남동쪽 약 2.3km, 555m)
  {
    const tw = new THREE.Group();
    const prof = [[48, 0], [46, 60], [43, 160], [38, 260], [31, 360], [21, 450], [11, 520], [3, 552], [0.6, 556]].map(([r, y]) => new THREE.Vector2(r, y));
    const body = new THREE.LatheGeometry(prof, 4); body.rotateY(Math.PI / 4);
    const strips = canvasTex(64, 512, (g, w, h) => { g.fillStyle = '#0a0e17'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 5) { g.fillStyle = `rgba(255,225,170,${0.3 + Math.random() * 0.5})`; g.fillRect(2, y, w - 4, 2); } g.fillStyle = 'rgba(160,210,255,.85)'; g.fillRect(0, 0, 3, h); g.fillRect(w - 3, 0, 3, h); });
    tw.add(new THREE.Mesh(body, new THREE.MeshBasicMaterial({ map: strips, fog: false, color: '#c9d3e6' })));
    // 꼭대기 랜턴
    const lantern = new THREE.Mesh(new THREE.ConeGeometry(6, 40, 4, 1, true), new THREE.MeshBasicMaterial({ color: '#cfe6ff', fog: false, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    lantern.position.y = 520; lantern.rotation.y = Math.PI / 4; tw.add(lantern);
    const beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#ff5a4a', transparent: true, blending: THREE.AdditiveBlending, fog: false, depthWrite: false }));
    beacon.scale.set(40, 40, 1); beacon.position.y = 560; tw.add(beacon);
    tw.position.set(-1620, -2, -1640);
    world.add(tw);
    // 롯데월드몰 저층부
    const mall = new THREE.Mesh(new THREE.BoxGeometry(260, 45, 140), new THREE.MeshBasicMaterial({ map: windowTex(31, 0.6), fog: false, color: '#9aa3b8' }));
    mall.position.set(-1520, 22, -1500); mall.rotation.y = 0.8; world.add(mall);
  }
  // 9-5. 한강 (북쪽 = +z) + 다리 + 강 건너 야경
  {
    const riverTex = canvasTex(512, 512, (g, w, h) => {
      g.fillStyle = '#060b16'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${Math.random() < 0.7 ? '255,210,150' : '170,200,255'},${0.08 + Math.random() * 0.25})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 14 + Math.random() * 40); }
    }, true);
    riverTex.repeat.set(6, 1);
    const river = new THREE.Mesh(new THREE.PlaneGeometry(6000, 900).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: riverTex, color: '#8fa0c0' }));
    todRefs.river = river.material;
    river.position.set(0, -0.3, 1050); world.add(river);
    // 다리 (잠실대교·청담대교 느낌): 강을 남북으로 가로지름
    for (const bx of [520, -1350]) {
      const deck = new THREE.Mesh(new THREE.BoxGeometry(26, 2, 920), steelDark); deck.position.set(bx, 10, 1050); world.add(deck);
      const pts = []; for (let z = 600; z <= 1500; z += 18) { pts.push(bx - 12, 11.5, z, bx + 12, 11.5, z); }
      const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const bl = new THREE.Points(lg, new THREE.PointsMaterial({ color: '#ffd59a', size: 3, sizeAttenuation: false })); world.add(bl); todRefs.nightOnly.push(bl);
      for (let z = 640; z <= 1460; z += 70) { const pier = new THREE.Mesh(new THREE.BoxGeometry(14, 10, 6), concreteDark); pier.position.set(bx, 4.5, z); world.add(pier); }
    }
    // 강변 도로 불빛
    const road = []; for (let x = -3000; x <= 3000; x += 14) road.push(x, 2, 590, x, 2, 1515);
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(road, 3));
    const rl = new THREE.Points(rg, new THREE.PointsMaterial({ color: '#ffcf8a', size: 2.2, sizeAttenuation: false })); world.add(rl); todRefs.nightOnly.push(rl);
    // 강 건너 스카이라인
    const geos = [];
    let seed = 77; const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let i = 0; i < 120; i++) {
      const x = -2600 + rnd() * 5200, z = 1560 + rnd() * 600, w = 30 + rnd() * 50, h = 30 + Math.pow(rnd(), 2) * 140;
      const b = new THREE.BoxGeometry(w, h, 30); const uv = b.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * w / 40, uv.getY(k) * h / 46);
      b.translate(x, h / 2, z); geos.push(b);
    }
    world.add(new THREE.Mesh(mergeGeometries(geos), new THREE.MeshBasicMaterial({ map: windowTex(51, 0.5), color: '#aab2c4', fog: false })));
  }
  // 9-6. 경기장 주변 가로등
  {
    const pts = [];
    for (let i = 0; i < 70; i++) { const a = i / 70 * Math.PI * 2, r = 210 + (i % 2) * 18; pts.push(Math.cos(a) * r, 7, Math.sin(a) * r + 40); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const ll = new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffe3b0', size: 4, sizeAttenuation: false })); world.add(ll); todRefs.nightOnly.push(ll);
  }
  // 9-7. 먼 서울 스카이라인 파노라마 (AI로 만든 낮/밤 사진, 원통에 감음)
  {
    // 위쪽은 하늘과 자연스럽게 섞이도록 알파 그라데이션
    const am = canvasTex(4, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#000'); gr.addColorStop(0.42, '#000'); gr.addColorStop(0.62, '#fff'); gr.addColorStop(1, '#fff'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
    const pano = new THREE.Mesh(new THREE.CylinderGeometry(3000, 3000, 640, 96, 1, true), new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.BackSide, fog: false, transparent: true, opacity: 0, depthWrite: false, alphaMap: am }));
    pano.position.y = 250; pano.renderOrder = -1; world.add(pano);
    const L = new THREE.TextureLoader();
    for (const k of ['skyDay', 'skyNight']) {
      const info = opt.tex && opt.tex[k]; if (!info) continue;
      L.load(info.url, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.MirroredRepeatWrapping; t.repeat.set(6, 1); t.anisotropy = 4; todRefs[k] = t; if (todRefs.cur) setTimeOfDay(todRefs.cur, true); });
    }
    todRefs.pano = pano;
  }

  // ═════════ 10. 하늘 ═════════
  {
    const skyGeo = new THREE.SphereGeometry(3600, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color('#050a1a') }, mid: { value: new THREE.Color('#111f44') }, hor: { value: new THREE.Color('#3d3a5c') } },
      vertexShader: 'varying vec3 vp; void main(){ vp = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 hor; varying vec3 vp; void main(){ float h = normalize(vp).y; vec3 c = mix(hor, mid, smoothstep(-0.02, 0.16, h)); c = mix(c, top, smoothstep(0.16, 0.7, h)); gl_FragColor = vec4(c, 1.0); }',
    });
    world.add(new THREE.Mesh(skyGeo, skyMat));
    todRefs.sky = skyMat;
    const n = 500, p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const th = Math.random() * Math.PI * 2, ph = Math.random() * 1.0; p[i * 3] = Math.cos(th) * Math.sin(ph) * 3300; p[i * 3 + 1] = Math.cos(ph) * 3300 * 0.7 + 400; p[i * 3 + 2] = Math.sin(th) * Math.sin(ph) * 3300; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: '#c8d4ff', size: 1.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.6 }));
    world.add(stars); todRefs.stars = stars;
    // 달
    const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#fff7e0', fog: false, transparent: true, depthWrite: false }));
    moon.scale.set(160, 160, 1); moon.position.set(1400, 1300, 2200); world.add(moon); todRefs.moon = moon;
    const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#fff2c8', fog: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    sun.scale.set(700, 700, 1); sun.position.set(2200, 1500, -900); sun.visible = false; world.add(sun); todRefs.sun = sun;
  }

  world.traverse((o) => { if (o.isMesh && !o.material?.transparent && o.castShadow === undefined) o.castShadow = false; });
  world.traverse((o) => { if (o.isMesh && o.material && o.material.isMeshBasicMaterial && o.material.map && o.material.map.userData.win) { o.material.userData.nightCol = o.material.color.clone(); todRefs.winMats.push(o.material); } });
  // 낮/밤 전환 (구장 쪽: 하늘·별·달/해·조명 불빛·주변 건물 창문)
  // ═════════ 정적 메시 합치기: 같은 재질을 쓰는 고정 구조물(관중석·기둥·광고판 등)을 하나로 → 드로우콜 수백 개 절약 ═════════
  {
    world.updateMatrixWorld(true);
    const skip = new Set();
    const mark = (o) => o && o.traverse && o.traverse((c) => skip.add(c));
    [todRefs.pano, todRefs.stars, todRefs.moon, todRefs.sun, ...todRefs.nightOnly, ...todRefs.glows].forEach(mark);
    if (crowd) crowd.traverse((c) => skip.add(c));
    const inv = new THREE.Matrix4().copy(world.matrixWorld).invert(), mtx = new THREE.Matrix4();
    const groups = new Map();
    world.traverse((o) => {
      if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || skip.has(o) || Array.isArray(o.material) || !o.visible) return;
      const m = o.material; if (!m || m.transparent || o.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender || o.userData.keep) return;
      let p = o.parent, ok = true; while (p && p !== world) { if (!p.visible || skip.has(p)) { ok = false; break; } p = p.parent; } if (!ok) return;
      const g = o.geometry; if (!g || !g.attributes.position || g.morphAttributes.position) return;
      const sig = Object.keys(g.attributes).sort().join(',') + '|' + (g.index ? 1 : 0);
      const key = m.uuid + '|' + sig + '|' + o.castShadow + o.receiveShadow + '|' + o.renderOrder;
      if (!groups.has(key)) groups.set(key, { mat: m, list: [], cast: o.castShadow, recv: o.receiveShadow, ro: o.renderOrder });
      groups.get(key).list.push(o);
    });
    let merged = 0;
    for (const G of groups.values()) {
      if (G.list.length < 2) continue;
      const geos = G.list.map((o) => { const c = o.geometry.clone(); mtx.multiplyMatrices(inv, o.matrixWorld); c.applyMatrix4(mtx); for (const k of Object.keys(c.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) c.deleteAttribute(k); return c; });
      let mg = null; try { mg = mergeGeometries(geos, false); } catch (e) { mg = null; }
      geos.forEach((c) => c.dispose());
      if (!mg) continue;
      const mesh = new THREE.Mesh(mg, G.mat); mesh.castShadow = G.cast; mesh.receiveShadow = G.recv; mesh.renderOrder = G.ro; mesh.name = 'merged';
      world.add(mesh);
      for (const o of G.list) { o.parent && o.parent.remove(o); merged++; }
    }
    world.userData.merged = merged;
  }
  function setTimeOfDay(mode) {
    const day = mode === 'day';
    todRefs.cur = mode;
    const pt = todRefs[day ? 'skyDay' : 'skyNight'];
    if (pt) { todRefs.pano.material.map = pt; todRefs.pano.material.opacity = 1; todRefs.pano.material.needsUpdate = true; }
    for (const o of todRefs.nightOnly) o.visible = !day;
    if (!todRefs.riverNightMap) todRefs.riverNightMap = todRefs.river.map;
    todRefs.river.map = day ? null : todRefs.riverNightMap; todRefs.river.color.set(day ? '#5d7f9e' : '#8fa0c0'); todRefs.river.needsUpdate = true;
    const U = todRefs.sky.uniforms;
    if (day) { U.top.value.set('#2f6fcf'); U.mid.value.set('#86b4e6'); U.hor.value.set('#dde7ef'); }
    else { U.top.value.set('#050a1a'); U.mid.value.set('#111f44'); U.hor.value.set('#3d3a5c'); }
    todRefs.stars.visible = !day; todRefs.moon.visible = !day; todRefs.sun.visible = day;
    todRefs.lightMat.color.set(day ? '#cfd3da' : '#fffbea');
    for (const g of todRefs.glows) g.visible = !day;
    for (const m of todRefs.winMats) {
      if (!m.userData.nightMap) m.userData.nightMap = m.map;
      const dt = dayWindowTex(); dt.wrapS = dt.wrapT = THREE.RepeatWrapping; dt.repeat.copy(m.userData.nightMap.repeat);
      m.map = day ? dt : m.userData.nightMap; m.color.copy(m.userData.nightCol).multiplyScalar(day ? 1.0 : 1); m.needsUpdate = true;
    }
  }
  return {
    world, crowd, drawScoreboard, SB, setTimeOfDay,
    refreshText() { for (const t of textTexes) redraw(t); sbKey = ''; },
    update(t, excite) {
      if (crowd) { crowd.uni.uTime.value = t; crowd.uni.uExcite.value = excite; }
      // LED 광고: 8초마다 한 칸씩, 바뀔 때 잠깐 번쩍
      const step = Math.floor(t / 8), ph = t / 8 - step;
      ledUni.uStep.value = step; ledUni.uFlash.value = ph < 0.04 ? 1 - ph / 0.04 : 0;
    },
  };
}

let _led = null;
export function ledTex() {
  if (_led) return _led;
  const segs = [['#0b1a3a', '#ffd23a', '잠실 · JAMSIL'], ['#b3262d', '#ffffff', '홈런왕'], ['#17264a', '#9fd0ff', 'PLAY BALL'], ['#101010', '#ff6a2b', '오늘도 직관'], ['#0c2d22', '#ffffff', '서울의 밤'], ['#2b1a52', '#ffd23a', '응원 열기 MAX']];
  const H = 72, segW = H * 7, W = segW * segs.length; // 칸 비율 7:1
  _led = canvasTex(W, H, (g) => {
    segs.forEach(([bg, fg, tx], i) => {
      const x = i * segW;
      const gr = g.createLinearGradient(x, 0, x + segW, 0); gr.addColorStop(0, bg); gr.addColorStop(1, '#05070c');
      g.fillStyle = gr; g.fillRect(x, 0, segW, H);
      g.fillStyle = fg; g.font = '900 40px "Noto Sans KR", Oswald, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'center';
      g.fillText(tx, x + segW / 2, H / 2 + 2);
    });
    g.fillStyle = 'rgba(0,0,0,.28)'; for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
  }, true);
  _led.userData.repeatLen = 1.25 * 7 * segs.length; // 띠 높이 1.25m 기준 한 바퀴 길이
  textTexes.push(_led);
  return _led;
}
