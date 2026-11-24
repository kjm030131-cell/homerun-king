// stadium/materials.js — 구장 공용 재질 (같은 재질을 공유해야 정적 병합으로 드로우콜이 줄어든다)
// nightK: 밤에 색을 몇 배로 어둡게 할지 (조명탑이 그라운드를 비추고 관중석·구조물은 상대적으로 어두운 실제 야구장 느낌)
import * as THREE from 'three';
import { canvasTex, noise, rng } from './util.js';

export function createMaterials(opt) {
  const R = rng(21);
  const dim = []; // { m, base, nightK }
  const reg = (m, nightK = 0.62) => { dim.push({ m, base: m.color.clone(), nightK }); return m; };
  const concTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, w, h); noise(g, w, h, 34, [1, 1, 1], R);
    g.globalAlpha = 0.18; g.fillStyle = '#5a5a5a'; for (let i = 0; i < 40; i++) g.fillRect(R() * w, R() * h, 2 + R() * 30, 1); // 거푸집 자국
    g.globalAlpha = 0.5; g.fillStyle = '#6e6e6e'; g.fillRect(0, h - 3, w, 3); g.fillRect(w - 3, 0, 3, h); g.globalAlpha = 1; // 줄눈
  }, true);
  const M = {
    concrete: reg(new THREE.MeshStandardMaterial({ color: '#a9adb5', map: concTex, roughness: 0.92, side: THREE.DoubleSide })),
    concreteDark: reg(new THREE.MeshStandardMaterial({ color: '#4a505c', map: concTex, roughness: 0.95, side: THREE.DoubleSide })),
    soffit: reg(new THREE.MeshStandardMaterial({ color: '#2a2f39', roughness: 0.9, side: THREE.DoubleSide }), 0.8),
    steel: reg(new THREE.MeshStandardMaterial({ color: '#b9c0cc', roughness: 0.4, metalness: 0.65 })),
    steelDark: reg(new THREE.MeshStandardMaterial({ color: '#39414f', roughness: 0.5, metalness: 0.5 })),
    roof: reg(new THREE.MeshStandardMaterial({ color: '#d9dde4', roughness: 0.45, metalness: 0.35, side: THREE.DoubleSide }), 0.5),
    trim: reg(new THREE.MeshStandardMaterial({ color: '#1c2a4a', roughness: 0.55, metalness: 0.2, side: THREE.DoubleSide })), // 남색 띠(구장 포인트 색)
    pad: reg(new THREE.MeshStandardMaterial({ color: '#1b4d3a', roughness: 0.85, side: THREE.DoubleSide }), 0.85),
    padNavy: reg(new THREE.MeshStandardMaterial({ color: '#16264a', roughness: 0.8, side: THREE.DoubleSide }), 0.85),
    beye: new THREE.MeshStandardMaterial({ color: '#0c1611', roughness: 1, side: THREE.DoubleSide }),
    yellow: new THREE.MeshBasicMaterial({ color: '#ffd23a', side: THREE.DoubleSide }),
    pole: new THREE.MeshStandardMaterial({ color: '#ffd23a', emissive: '#4a3a00', roughness: 0.5 }),
    rail: reg(new THREE.MeshStandardMaterial({ color: '#c9ced6', roughness: 0.35, metalness: 0.7 })),
  };
  M.concTex = concTex;
  // 외부 파사드: 세로 핀 + 층 띠(밤에 불 켜짐 = emissiveMap)
  const faTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#7d8494'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 32) { g.fillStyle = '#a3aab8'; g.fillRect(x, 0, 12, h); g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(x + 12, 0, 3, h); }
    for (let y = 36; y < h; y += 86) { g.fillStyle = '#2b3240'; g.fillRect(0, y, w, 16); }
    noise(g, w, h, 8, [1, 1, 1], R);
  }, true);
  const faEmi = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); for (let y = 36; y < h; y += 86) { g.fillStyle = '#ffd9a0'; g.fillRect(0, y + 3, w, 10); } for (let x = 0; x < w; x += 32) { g.fillStyle = '#000'; g.fillRect(x, 0, 12, h); } }, true);
  M.facade = reg(new THREE.MeshStandardMaterial({ map: faTex, emissiveMap: faEmi, emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.85, side: THREE.DoubleSide }), 0.75);
  // 좌석: 한 텍스처 칸 = 4석 x 1줄. 등받이 + 앞줄 그림자
  const seatTex = canvasTex(64, 64, (g, w, h) => {
    g.fillStyle = '#d9dbe0'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) { g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(x, 0, 2, h * 0.6); g.fillStyle = 'rgba(255,255,255,.3)'; g.fillRect(x + 3, 4, 10, 3); g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(x + 3, 10, 10, 14); }
    g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(0, h * 0.6, w, h * 0.4);
  }, true);
  M.seatTex = seatTex;
  // 관중석 재질: 통로(계단)와 출입구(보미토리)를 셰이더에서 호 길이로 그림 → 지오메트리 추가 없음
  M.seat = (name, { aislePer = 9.4, vom = [-1, -1] } = {}) => {
    const m = new THREE.MeshStandardMaterial({ map: seatTex, vertexColors: true, roughness: 0.65, side: THREE.DoubleSide });
    m.name = 'seat-' + name;
    const U = { uAisle: { value: aislePer }, uVom: { value: new THREE.Vector2(vom[0], vom[1]) } };
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uAisle; uniform vec2 uVom;')
        .replace('#include <color_fragment>', `#include <color_fragment>
{
  float arc = vMapUv.x * 2.2; float row = vMapUv.y;
  float ai = floor(arc / uAisle + 0.5); float da = abs(arc - ai * uAisle);
  float aisle = 1.0 - smoothstep(0.55, 0.68, da);
  float stair = 0.8 + 0.2 * step(0.5, fract(row * 2.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.31, 0.33) * stair, aisle);
  float vom = step(mod(ai, 3.0), 0.5) * (1.0 - smoothstep(1.5, 1.65, da)) * step(uVom.x, row) * step(row, uVom.y);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.015), vom);
}`);
    };
    m.customProgramCacheKey = () => 'hr-seat';
    return reg(m, 0.55);
  };
  // 스위트룸 유리 (밤에 안쪽 불빛)
  const suiteTex = canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#1a2230'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 32) { const on = R() < 0.8; g.fillStyle = on ? `rgba(255,${200 + (R() * 30) | 0},${140 + (R() * 40) | 0},.9)` : '#2a3446'; g.fillRect(x + 2, 6, 28, h - 14); g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(x + 2, h * 0.62, 28, 3); }
  }, true);
  const suiteDay = canvasTex(256, 64, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#9fb6cf'); gr.addColorStop(1, '#3d4c60'); g.fillStyle = gr; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 32) { g.fillStyle = '#232a35'; g.fillRect(x, 0, 2, h); } }, true);
  M.suite = new THREE.MeshBasicMaterial({ map: suiteTex, side: THREE.DoubleSide });
  M.suite.userData.maps = { night: suiteTex, day: suiteDay };
  // 지붕 밑면 다운라이트(밤)
  const downTex = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#20252e'; g.fillRect(0, 0, w, h); for (let y = 16; y < h; y += 32) for (let x = 16; x < w; x += 32) { const gr = g.createRadialGradient(x, y, 0, x, y, 9); gr.addColorStop(0, '#fff6dc'); gr.addColorStop(1, 'rgba(255,240,210,0)'); g.fillStyle = gr; g.fillRect(x - 10, y - 10, 20, 20); } }, true);
  M.downlight = new THREE.MeshStandardMaterial({ color: '#3a3f48', map: concTex, emissiveMap: downTex, emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.9, side: THREE.DoubleSide });
  // 조명 램프 (밤 = HDR 흰색 → 블룸)
  M.lamp = new THREE.MeshBasicMaterial({ color: '#cfd3da', side: THREE.DoubleSide });
  M.lightStrip = new THREE.MeshBasicMaterial({ color: '#d8dce4', side: THREE.DoubleSide }); // 지붕 앞단·콘코스 조명 띠
  for (const [k, m] of Object.entries(M)) if (m && m.isMaterial && !m.name) m.name = k;
  // 선택 텍스처(사용자 GPT 이미지) — 있으면 덮어씀
  const L = new THREE.TextureLoader();
  const opt2 = (opt.tex || {});
  const load = (key, fn) => { const info = opt2[key]; if (!info || !info.url) return; L.load(info.url, (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; fn(t); }, undefined, () => {}); };
  load('facade', (t) => { M.facade.map = t; M.facade.needsUpdate = true; });
  load('concrete', (t) => { for (const m of [M.concrete, M.concreteDark, M.downlight]) { m.map = t; m.needsUpdate = true; } });
  load('roof', (t) => { M.roof.map = t; M.roof.needsUpdate = true; });
  // [stadium 11-24] 외야 펜스 패딩 사진: 펜스 uv = (호 길이/4m, 높이) → 사진 한 장(패널 6개)이 8m
  load('wallpad', (t) => { t.repeat.set(0.5, 1); t.wrapT = THREE.ClampToEdgeWrapping; M.pad.map = t; M.pad.color.set('#ffffff'); const d = dim.find((x) => x.m === M.pad); if (d) d.base.set('#ffffff'); M.pad.needsUpdate = true; });
  M.setNight = (night) => {
    for (const d of dim) d.m.color.copy(d.base).multiplyScalar(night ? d.nightK : 1);
    M.facade.emissiveIntensity = night ? 0.9 : 0;
    M.downlight.emissiveIntensity = night ? 1.3 : 0;
    M.suite.map = night ? M.suite.userData.maps.night : M.suite.userData.maps.day; M.suite.needsUpdate = true;
    M.lamp.color.setRGB(...(night ? [7, 6.7, 6.0] : [0.62, 0.65, 0.7]));
    M.lightStrip.color.setRGB(...(night ? [2.4, 2.25, 2.0] : [0.7, 0.72, 0.76]));
    M.pole.emissive.set(night ? '#6a5400' : '#2a2000');
  };
  return M;
}
