// stadium/field.js — 그라운드: 한 장으로 굽는 바닥 텍스처(흙·라인·박스) + 셰이더 예초 무늬 + 마운드·베이스
// 예초 무늬는 텍스처가 아니라 셰이더에서 월드 좌표로 계산 → 해상도와 무관하게 선명하고, 보는 방향에 따라 밝기가 뒤집힘(실제 잔디처럼)
import * as THREE from 'three';
import { BASES, MOUND, FOUL } from '../../shared/sim.js';
import { fenceR, standR } from './layout.js';
import { canvasTex, noise, rng, inject } from './util.js';

const FX0 = -80, FZ0 = -28, FS = 160; // 텍스처가 덮는 영역(m)
const GRASS = '#3a8a3b', DIRT = '#b9784b', TRACK = '#a5683f', CHALK = '#f7f7f2';

function paintField(g, W) {
  const k = W / FS, R = rng(11);
  g.setTransform(k, 0, 0, k, -FX0 * k, -FZ0 * k);
  const H = BASES[1][1]; // 2루 중심까지의 z/2 (= 19.4)
  // 흙 패턴(작은 캔버스 반복) — 갈퀴 자국 + 알갱이
  const dirtPat = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128; const d = c.getContext('2d');
    d.fillStyle = DIRT; d.fillRect(0, 0, 128, 128); noise(d, 128, 128, 26, [1, 0.8, 0.6], R);
    for (let i = 0; i < 260; i++) { d.fillStyle = R() < 0.5 ? 'rgba(120,70,40,.32)' : 'rgba(220,170,125,.28)'; d.fillRect(R() * 128, R() * 128, 1.5, 1.5); }
    d.globalAlpha = 0.08; d.strokeStyle = '#5a3420'; for (let y = 0; y < 128; y += 5) { d.beginPath(); d.moveTo(0, y + R()); d.lineTo(128, y + R() * 2); d.stroke(); } d.globalAlpha = 1;
    const p = g.createPattern(c, 'repeat'); if (p && p.setTransform) p.setTransform(new DOMMatrix().scale(1 / 36)); return p || DIRT;
  })();
  // 잔디 바탕
  g.fillStyle = GRASS; g.fillRect(FX0, FZ0, FS, FS);
  // 워닝트랙 (펜스 앞 4.5m = sim 의 지면 판정과 같은 폭) + 파울 지역 벽 앞 2.8m
  {
    const p = new Path2D(), N = 360;
    for (let i = 0; i <= N; i++) { const phi = -Math.PI + i / N * Math.PI * 2, r = standR(phi) + 0.6; const x = Math.sin(phi) * r, z = Math.cos(phi) * r; i ? p.lineTo(x, z) : p.moveTo(x, z); }
    for (let i = N; i >= 0; i--) { const phi = -Math.PI + i / N * Math.PI * 2, r = Math.abs(phi) <= FOUL ? fenceR(phi) - 4.5 : standR(phi) - 2.8; p.lineTo(Math.sin(phi) * r, Math.cos(phi) * r); }
    p.closePath();
    g.fillStyle = dirtPat; g.fill(p); g.fillStyle = 'rgba(80,45,25,.22)'; g.fill(p);
  }
  // 내야 흙: 투수판 중심 반지름 29m 원호 ∩ 파울라인 바깥 1.8m 까지 (실제 구장처럼 라인을 따라 흙이 조금 넘어감)
  {
    g.save();
    const wedge = new Path2D(); wedge.moveTo(0, -2.55); wedge.lineTo(90, 87.45); wedge.lineTo(-90, 87.45); wedge.closePath();
    g.clip(wedge);
    const arc = new Path2D(); arc.arc(MOUND[0], MOUND[1], 28.96, 0, Math.PI * 2);
    g.fillStyle = dirtPat; g.fill(arc);
    // 잔디 경계 쪽 젖은 흙(진하게)
    g.lineWidth = 0.9; g.strokeStyle = 'rgba(95,55,30,.35)'; g.stroke(arc);
    g.restore();
  }
  // 내야 잔디(베이스 사각형 안쪽 86%) — 베이스 주변은 원으로 파냄
  {
    const c = [0, H], kq = 0.86;
    const pts = BASES.map(([x, z]) => [c[0] + (x - c[0]) * kq, c[1] + (z - c[1]) * kq]);
    const q = new Path2D(); q.moveTo(...pts[0]); for (let i = 1; i < 4; i++) q.lineTo(...pts[i]); q.closePath();
    g.fillStyle = GRASS; g.fill(q);
    g.lineWidth = 0.18; g.strokeStyle = 'rgba(40,70,25,.45)'; g.stroke(q); // 잔디 립(경계 그늘)
    for (const [x, z] of BASES.slice(1)) { const b = new Path2D(); b.arc(x, z, 3.0, 0, Math.PI * 2); g.fillStyle = dirtPat; g.fill(b); g.lineWidth = 0.35; g.strokeStyle = 'rgba(95,55,30,.3)'; g.stroke(b); }
    const hp = new Path2D(); hp.arc(0, 0, 3.96, 0, Math.PI * 2); g.fillStyle = dirtPat; g.fill(hp); g.lineWidth = 0.4; g.strokeStyle = 'rgba(95,55,30,.32)'; g.stroke(hp);
    // 마운드: 바깥 흙 + 위쪽 밝은 점토판
    const md = new Path2D(); md.arc(MOUND[0], MOUND[1], 2.74, 0, Math.PI * 2); g.fillStyle = dirtPat; g.fill(md);
    g.lineWidth = 0.3; g.strokeStyle = 'rgba(95,55,30,.32)'; g.stroke(md);
    g.fillStyle = 'rgba(210,150,105,.35)'; g.beginPath(); g.ellipse(MOUND[0], MOUND[1] + 0.25, 0.9, 1.2, 0, 0, Math.PI * 2); g.fill();
    // 1·3루 주로 흙길
    for (const kk of [1, 3]) { g.save(); g.strokeStyle = dirtPat; g.lineWidth = 1.7; g.beginPath(); g.moveTo(0, 0); g.lineTo(...BASES[kk]); g.stroke(); g.restore(); }
  }
  // 타석·포수석 밟힌 흙(진하게)
  g.fillStyle = 'rgba(90,50,28,.28)';
  for (const s of [-1, 1]) g.fillRect(s * 0.92 - 0.61, -0.92, 1.22, 1.83);
  g.fillRect(-0.55, -3.0, 1.1, 2.0);
  // ── 라인 ──
  g.strokeStyle = CHALK; g.lineCap = 'butt';
  const line = (x1, z1, x2, z2, w = 0.1) => { g.lineWidth = w; g.beginPath(); g.moveTo(x1, z1); g.lineTo(x2, z2); g.stroke(); };
  const s45 = Math.sin(FOUL);
  line(0.32, 0.32, 100 * s45, 100 * s45, 0.1); line(-0.32, 0.32, -100 * s45, 100 * s45, 0.1);
  const box = (cx, cz, w, l) => { g.lineWidth = 0.076; g.strokeRect(cx - w / 2, cz - l / 2, w, l); };
  box(0.92, 0, 1.22, 1.83); box(-0.92, 0, 1.22, 1.83);
  g.lineWidth = 0.076; g.beginPath(); g.moveTo(-0.55, -0.92); g.lineTo(-0.55, -3.0); g.lineTo(0.55, -3.0); g.lineTo(0.55, -0.92); g.stroke();
  { // 1루 3피트 주루 라인
    const [x, z] = BASES[1]; const d = Math.hypot(x, z), ux = x / d, uz = z / d, nx = -uz, nz = ux;
    line(ux * d * 0.5 - nx * 0.91, uz * d * 0.5 - nz * 0.91, x - nx * 0.91, z - nz * 0.91, 0.076);
    line(ux * d * 0.5 - nx * 0.91, uz * d * 0.5 - nz * 0.91, ux * d * 0.5, uz * d * 0.5, 0.076);
  }
  for (const s of [-1, 1]) { g.lineWidth = 0.076; g.save(); g.translate(s * 26, 22); g.rotate(-s * Math.PI / 4); g.strokeRect(-1, -3, 2, 6); g.restore(); } // 코치 박스
  for (const s of [-1, 1]) { // 대기 타석 원
    const c = new Path2D(); c.arc(s * 11, -5, 1.4, 0, Math.PI * 2);
    g.fillStyle = '#6f7d4e'; g.fill(c); g.lineWidth = 0.08; g.strokeStyle = CHALK; g.stroke(c);
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
}

export function buildField(world, opt, Q) {
  const RES = Q.fieldRes;
  const fieldTex = canvasTex(RES, RES, (g, W) => paintField(g, W));
  fieldTex.anisotropy = 16;
  // 선택: 홈 뒤 잔디 로고(field_logo.png, 투명 배경) — 캔버스에 덧그림
  const logo = opt.tex && opt.tex.fieldLogo;
  if (logo && logo.url) {
    const img = new Image();
    img.onload = () => { const g = fieldTex.userData.canvas.getContext('2d'), k = RES / FS; g.save(); g.globalAlpha = 0.85; g.setTransform(k, 0, 0, k, -FX0 * k, -FZ0 * k); g.drawImage(img, -4.5, -13.5, 9, 9); g.restore(); fieldTex.needsUpdate = true; };
    img.src = logo.url;
  }
  // 작은 무늬(잔디 결·흙 알갱이) 반복 텍스처
  const R = rng(5);
  const detailTex = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#808080'; g.fillRect(0, 0, w, h); noise(g, w, h, 70, [1, 1, 1], R); g.globalAlpha = 0.25; for (let i = 0; i < 3000; i++) { g.fillStyle = R() < 0.5 ? '#4a4a4a' : '#b8b8b8'; g.fillRect(R() * w, R() * h, 1, 2.5); } }, true);
  detailTex.colorSpace = THREE.NoColorSpace;
  const fieldMat = new THREE.MeshStandardMaterial({ map: fieldTex, roughness: 0.92, metalness: 0 });
  fieldMat.name = 'field';
  // 사진 디테일 텍스처(assets/tex: AI로 만든 흙·잔디) — 평균색으로 나눠서 '무늬'만 입힘
  const U = {
    detail: { value: detailTex }, pGrass: { value: detailTex }, pDirt: { value: detailTex },
    gAvg: { value: new THREE.Vector3(0.5, 0.5, 0.5) }, dAvg: { value: new THREE.Vector3(0.5, 0.5, 0.5) }, hasG: { value: 0 }, hasD: { value: 0 },
    uMow: { value: 0.11 }, // 예초 무늬 세기
  };
  const loader = new THREE.TextureLoader();
  for (const [k, info] of Object.entries(opt.tex || {})) {
    if (!info || !info.url || (k !== 'grass' && k !== 'dirt')) continue;
    loader.load(info.url, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8; t.needsUpdate = true;
      if (k === 'grass') { U.pGrass.value = t; U.gAvg.value.set(...(info.avg || [0.5, 0.5, 0.5])); U.hasG.value = 1; }
      else { U.pDirt.value = t; U.dAvg.value.set(...(info.avg || [0.5, 0.5, 0.5])); U.hasD.value = 1; }
    }, undefined, () => {});
  }
  const H = BASES[1][1];
  const onCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = inject(sh.vertexShader, '#include <common>', '#include <common>\nvarying vec2 vWxz;');
    sh.vertexShader = inject(sh.vertexShader, '#include <fog_vertex>', '#include <fog_vertex>\nvWxz = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = inject(sh.fragmentShader, '#include <common>', `#include <common>
uniform sampler2D detail; uniform sampler2D pGrass; uniform sampler2D pDirt; uniform vec3 gAvg; uniform vec3 dAvg; uniform float hasG; uniform float hasD; uniform float uMow;
varying vec2 vWxz;
// 안티에일리어싱 사각파: 멀어서 줄무늬가 픽셀보다 작아지면 저절로 0으로 수렴 (모아레 없음)
float hrSq(float x) { float fw = max(fwidth(x), 1e-4); return clamp(sin(3.14159265 * x) / (3.14159265 * fw * 1.2), -1.0, 1.0); }`);
    sh.fragmentShader = inject(sh.fragmentShader, '#include <map_fragment>', `#include <map_fragment>
{
 vec2 p = vWxz;
 float dt1 = texture2D(detail, p * 0.35).r; float dt2 = texture2D(detail, p * 0.045).r;
 vec3 bc = diffuseColor.rgb;
 float isDirt = smoothstep(0.0, 0.06, bc.r - bc.g);
 float isLine = smoothstep(0.5, 0.7, min(bc.r, min(bc.g, bc.b)));
 float isGrass = (1.0 - isDirt) * (1.0 - isLine);
 vec3 g1 = texture2D(pGrass, p * 0.42).rgb / gAvg, g2 = texture2D(pGrass, p * 0.11 + 0.37).rgb / gAvg;
 vec3 d1 = texture2D(pDirt, p * 0.55).rgb / dAvg, d2 = texture2D(pDirt, p * 0.13 + 0.61).rgb / dAvg;
 vec3 gm = mix(vec3(0.8 + 0.3 * dt1), mix(g1, g2, 0.35), hasG);
 vec3 dm = mix(vec3(0.8 + 0.3 * dt1), mix(d1, d2, 0.3), hasD);
 vec3 m = mix(gm, dm, isDirt);
 m = mix(m, vec3(0.95 + 0.06 * dt1), isLine);
 diffuseColor.rgb *= clamp(m, 0.45, 1.7) * (1.0 + 0.16 * (dt2 - 0.5));
 // 예초 무늬: 파울라인과 평행한 두 방향 줄 → 다이아몬드 체크. 내야는 더 잘게
 float inIn = 1.0 - smoothstep(-0.5, 0.5, abs(p.x) + abs(p.y - ${H.toFixed(3)}) - ${(H * 0.86).toFixed(3)});
 float w = mix(6.1, 3.81, inIn);
 vec2 d1v = vec2(0.70710678, 0.70710678), d2v = vec2(-0.70710678, 0.70710678);
 float s1 = hrSq(dot(p, d1v) / w), s2 = hrSq(dot(p, d2v) / w);
 vec2 vd = cameraPosition.xz - p; vd /= max(length(vd), 1e-3);
 float f1 = dot(vd, d1v), f2 = dot(vd, d2v);
 // 같은 줄이라도 보는 방향(잔디가 누운 방향과의 각)에 따라 밝기가 바뀜 — 연속 함수라 이음새 없음
 float mow = s1 * (0.25 + 0.75 * f1) + 0.7 * s2 * (0.25 + 0.75 * f2);
 diffuseColor.rgb *= 1.0 + uMow * mow * isGrass;
}`);
  };
  fieldMat.onBeforeCompile = onCompile;
  fieldMat.customProgramCacheKey = () => 'hr-field';
  { // 그라운드 = 관중석 경계선 안쪽만
    const pts = [], N = 360;
    for (let i = 0; i < N; i++) { const phi = -Math.PI + i / N * Math.PI * 2; const r = Math.abs(phi) <= FOUL ? fenceR(phi) + 2.3 : standR(phi) + 1.1; pts.push(new THREE.Vector2(Math.sin(phi) * r, -Math.cos(phi) * r)); }
    const fg = new THREE.ShapeGeometry(new THREE.Shape(pts), 1); fg.rotateX(-Math.PI / 2);
    const uv = fg.attributes.uv, pos = fg.attributes.position;
    for (let i = 0; i < uv.count; i++) { const x = pos.getX(i), z = pos.getZ(i); uv.setXY(i, (x - FX0) / FS, 1 - (z - FZ0) / FS); }
    const field = new THREE.Mesh(fg, fieldMat); field.userData.sh = 'ground'; field.userData.keep = true; world.add(field);
  }
  // 흙 재질(마운드·불펜) — 같은 셰이더, 단색 흙
  const dirtMat = new THREE.MeshStandardMaterial({ color: DIRT, roughness: 1 });
  dirtMat.onBeforeCompile = onCompile; dirtMat.customProgramCacheKey = () => 'hr-field';
  const chalk = new THREE.MeshStandardMaterial({ color: CHALK, roughness: 0.8 });
  { // 마운드 (높이 25cm)
    const prof = [[0, 0.254], [0.6, 0.254], [1.0, 0.24], [1.6, 0.17], [2.2, 0.07], [2.74, 0.0]].map(([r, y]) => new THREE.Vector2(r, y));
    const m = new THREE.Mesh(new THREE.LatheGeometry(prof, 40), dirtMat);
    m.position.set(MOUND[0], 0.005, MOUND[1]); m.userData.sh = 'ground'; world.add(m);
    const rubber = new THREE.Mesh(new THREE.BoxGeometry(0.61, 0.04, 0.15), chalk); rubber.position.set(0, 0.27, MOUND[1]); rubber.userData.sh = 'ground'; world.add(rubber);
  }
  { // 베이스 + 홈플레이트
    const bag = new THREE.BoxGeometry(0.381, 0.1, 0.381, 2, 1, 2);
    const p = bag.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * 0.93); p.setZ(i, p.getZ(i) * 0.93); }
    bag.computeVertexNormals();
    for (const [x, z] of BASES.slice(1)) { const b = new THREE.Mesh(bag, chalk); b.position.set(x, 0.05, z); b.rotation.y = Math.PI / 4; b.userData.sh = 'ground'; world.add(b); }
    const s = new THREE.Shape([new THREE.Vector2(-0.216, 0), new THREE.Vector2(0.216, 0), new THREE.Vector2(0.216, 0.216), new THREE.Vector2(0, 0.432), new THREE.Vector2(-0.216, 0.216)]);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: false }); g.rotateX(Math.PI / 2);
    const hp = new THREE.Mesh(g, chalk); hp.position.set(0, 0.022, 0.216); hp.rotation.y = Math.PI; hp.userData.sh = 'ground'; world.add(hp);
  }
  return { fieldMat, dirtMat, chalk, fieldTex, U, canvas: fieldTex.userData.canvas, toCanvas: (x, z) => [(x - FX0) / FS * RES, (z - FZ0) / FS * RES] };
}
