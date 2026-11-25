// player.js — 사람 비율 야구선수 모델 + 관절 리그 + 2관절 IK
import * as THREE from 'three';
import { logoOf, drawContain } from './emblem.js'; // [logo] 모자 로고: 직접 넣은 이미지가 있으면 그걸로

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const SEG = 18;

export const UNIFORMS = {
  home: { jersey: '#f4f2ec', pants: '#f4f2ec', accent: '#14254a', cap: '#14254a', sock: '#14254a', num: '#14254a', pin: '#bcc6d9', word: 'HOME' },
  away: { jersey: '#5a6681', pants: '#a3aabb', accent: '#b0232c', cap: '#b0232c', sock: '#b0232c', num: '#ffffff', pin: null, word: 'AWAY' },
  ump: { jersey: '#1c1f27', pants: '#565b68', accent: '#1c1f27', cap: '#1c1f27', sock: '#1c1f27', num: '#1c1f27', pin: null, word: '' },
};
const SKINS = ['#f1c7a0', '#e8b48b', '#d9a178', '#c68a62', '#efc39a', '#e2ae86'];
const HAIRS = ['#1b1714', '#231c16', '#2e241c', '#141210'];

const matCache = new Map();
function std(color, rough = 0.75, metal = 0) {
  const k = color + rough + metal;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
  return matCache.get(k);
}
const texCache = new Map();
function jerseyTex(u, num, name) {
  const key = JSON.stringify([u.jersey, u.num, u.pin, u.word, u.accent, u.trim, num, name]);
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = u.jersey; g.fillRect(0, 0, 512, 256);
  if (u.pin) { g.fillStyle = u.pin; for (let x = 0; x < 512; x += 14) g.fillRect(x, 0, 2, 256); }
  // 앞면(u=0 근처, 양 끝) 워드마크
  g.fillStyle = u.accent;
  g.font = '700 italic 54px Oswald, "Arial Narrow", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if (u.word) { let fs = 54; while (fs > 30 && g.measureText(u.word).width > 170) { fs -= 2; g.font = `700 italic ${fs}px Oswald, "Arial Narrow", sans-serif`; } }
  if (u.word) { g.save(); g.translate(0, 120); g.scale(1, 1); g.fillText(u.word, 0, 0); g.fillText(u.word, 512, 0); g.restore(); }
  // 앞 단추선
  g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(0, 150, 3, 106); g.fillRect(509, 150, 3, 106);
  // 등(u=0.5) 이름 + 번호
  if (name) { g.fillStyle = u.num; g.font = '700 30px Oswald, sans-serif'; g.fillText(String(name).slice(0, 10).toUpperCase(), 256, 70); }
  if (num !== '' && num != null) {
    g.font = '700 116px Oswald, "Arial Narrow", sans-serif';
    g.lineWidth = 8; g.strokeStyle = u.accent === u.num ? '#ffffff' : u.accent;
    g.strokeText(String(num), 256, 160);
    g.fillStyle = u.num; g.fillText(String(num), 256, 160);
  }
  // 옷깃(위쪽) 트림 + 앞 단추 라인 파이핑
  g.fillStyle = u.trim || u.accent; g.fillRect(0, 0, 512, 7);
  g.fillStyle = u.accent; g.fillRect(0, 7, 512, 3);
  g.globalAlpha = 0.85; g.fillRect(0, 10, 4, 246); g.fillRect(508, 10, 4, 246); g.globalAlpha = 1;
  // 옆구리 패널 살짝 어둡게(입체감)
  const sg = g.createLinearGradient(0, 0, 512, 0);
  sg.addColorStop(0, 'rgba(0,0,0,0)'); sg.addColorStop(0.2, 'rgba(0,0,0,.10)'); sg.addColorStop(0.25, 'rgba(0,0,0,0)');
  sg.addColorStop(0.75, 'rgba(0,0,0,0)'); sg.addColorStop(0.8, 'rgba(0,0,0,.10)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = sg; g.fillRect(0, 0, 512, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}

const logoCache = new Map();
function logoTex(k, fg, stroke) {
  const im = logoOf(k), key = k + fg + stroke + (im ? ':img' : '');
  if (logoCache.has(key)) return logoCache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = im ? 128 : 64;
  const g = c.getContext('2d');
  if (im) { drawContain(g, im, 4, 4, 120, 120); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; logoCache.set(key, t); return t; }
  g.font = `700 italic ${k.length > 2 ? 30 : k.length > 1 ? 40 : 54}px Oswald, "Arial Narrow", Impact, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = stroke; g.strokeText(k, 32, 35); g.fillStyle = fg; g.fillText(k, 32, 35);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  logoCache.set(key, t); return t;
}
function mesh(geo, mat, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  return m;
}
const geoCache = new Map();
function geo(key, make) { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); }
const capsule = (r, l) => geo(`c${r}_${l}`, () => new THREE.CapsuleGeometry(r, l, 5, SEG));
const sphere = (r, ws = SEG, hs = 10) => geo(`s${r}_${ws}_${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
const cyl = (a, b, h) => geo(`y${a}_${b}_${h}`, () => new THREE.CylinderGeometry(a, b, h, SEG));
const torsoGeo = () => geo('torso', () => {
  const pts = [[0.15, -0.02], [0.158, 0.03], [0.176, 0.09], [0.193, 0.15], [0.202, 0.2], [0.2, 0.245], [0.182, 0.275], [0.14, 0.3], [0.09, 0.313], [0.055, 0.318]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, 32);
  g.scale(1.22, 1, 0.68);
  return g;
});

// 해부학적으로 가늘어지는 팔다리 (위→아래 반지름 프로파일, 타원 단면)
function limb(key, prof, sx = 1, sz = 1, seg = 16) {
  return geo('limb_' + key, () => {
    const pts = prof.map(([r, y]) => new THREE.Vector2(Math.max(0.001, r), y)).reverse();
    const g = new THREE.LatheGeometry(pts, seg); g.scale(sx, 1, sz); g.computeVertexNormals(); return g;
  });
}
// 얼굴 디테일(눈·눈썹·코 그림자·입) 텍스처 — 머리 앞쪽 데칼
const faceCache = new Map();
function faceTex(skinHex, browHex, v) {
  const key = skinHex + browHex + v;
  if (faceCache.has(key)) return faceCache.get(key);
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  const sk = new THREE.Color(skinHex);
  g.fillStyle = skinHex; g.fillRect(0, 0, 256, 256);
  // 볼·턱 음영
  const sh = g.createRadialGradient(128, 130, 40, 128, 140, 150); sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(60,30,20,.22)'); g.fillStyle = sh; g.fillRect(0, 0, 256, 256);
  const dark = (k) => `rgb(${(sk.r * 255 * k) | 0},${(sk.g * 255 * k) | 0},${(sk.b * 255 * k) | 0})`;
  // 눈두덩 그림자
  for (const x of [88, 168]) { const gr = g.createRadialGradient(x, 110, 4, x, 110, 34); gr.addColorStop(0, dark(0.78) .replace('rgb', 'rgba').replace(')', ',.55)')); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - 40, 70, 80, 80); }
  // 눈
  for (const x of [88, 168]) {
    g.fillStyle = '#f2efe8'; g.beginPath(); g.ellipse(x, 114, 17, 8.5, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = v < 0.5 ? '#2b1d14' : '#3a2a1c'; g.beginPath(); g.arc(x + 1, 114, 7.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#0b0807'; g.beginPath(); g.arc(x + 1, 114, 3.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.arc(x + 4, 111, 1.8, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(25,15,10,.9)'; g.lineWidth = 3.2; g.beginPath(); g.ellipse(x, 114, 18, 9.5, 0, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
  }
  // 눈썹
  g.strokeStyle = browHex; g.lineCap = 'round'; g.lineWidth = 7;
  for (const x of [88, 168]) { g.beginPath(); g.moveTo(x - 21, 95); g.quadraticCurveTo(x, 83, x + 21, 93); g.stroke(); }
  // 코 그림자/콧볼
  g.fillStyle = dark(0.72).replace('rgb', 'rgba').replace(')', ',.5)');
  g.beginPath(); g.ellipse(118, 158, 6, 4, 0, 0, Math.PI * 2); g.fill(); g.beginPath(); g.ellipse(138, 158, 6, 4, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = dark(0.8).replace('rgb', 'rgba').replace(')', ',.45)'); g.lineWidth = 3; g.beginPath(); g.moveTo(122, 120); g.quadraticCurveTo(116, 145, 120, 156); g.stroke();
  // 입
  g.strokeStyle = 'rgba(110,55,45,.85)'; g.lineWidth = 4; g.beginPath(); g.moveTo(108, 190); g.quadraticCurveTo(128, 196, 148, 190); g.stroke();
  g.fillStyle = 'rgba(150,80,70,.35)'; g.beginPath(); g.ellipse(128, 197, 14, 4, 0, 0, Math.PI * 2); g.fill();
  // 수염 자국(일부)
  if (v > 0.6) { g.fillStyle = 'rgba(40,30,25,.12)'; g.beginPath(); g.ellipse(128, 205, 46, 26, 0, 0, Math.PI); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  faceCache.set(key, t); return t;
}

// AI로 만든 얼굴 텍스처(정면) — main에서 등록. [{url, skin}] 
let FACE_SET = [];
const faceTexCache = new Map();
export function setFaceTextures(list) { FACE_SET = list || []; }
function photoFace(i) {
  const f = FACE_SET[i]; if (!f) return null;
  if (!faceTexCache.has(i)) { const t = new THREE.TextureLoader().load(f.url); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; faceTexCache.set(i, t); }
  return faceTexCache.get(i);
}
// 머리: 두개골+얼굴 한 덩어리(선반 곡면) + 정면 투영 UV (얼굴 텍스처용)
const headGeo = () => geo('headV2', () => {
  const prof = [[0.0, -0.035], [0.03, -0.032], [0.052, -0.018], [0.068, 0.005], [0.08, 0.035], [0.089, 0.07], [0.095, 0.105], [0.098, 0.14], [0.097, 0.17], [0.09, 0.2], [0.074, 0.226], [0.045, 0.243], [0.0, 0.25]];
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 40, 0, Math.PI * 2);
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    x *= 0.9; z *= z > 0 ? 1.04 : 1.06; // 앞뒤로 약간 긴 두상
    if (z > 0 && y < 0.07) x *= 0.9 + 0.1 * (y + 0.035) / 0.105; // 턱선 좁게
    pos.setXYZ(i, x, y, z);
    uv.setXY(i, 0.5 + x / 0.205, (y + 0.035) / 0.27);
  }
  g.computeVertexNormals();
  return g;
});

// 관절 이름
export const JOINTS = ['hips', 'spine', 'chest', 'neck', 'head', 'uaL', 'faL', 'hL', 'uaR', 'faR', 'hR', 'thL', 'shinL', 'ftL', 'thR', 'shinR', 'ftR'];

export class Player {
  // role: 'fielder' | 'batter' | 'runner' | 'catcher' | 'ump' | 'pitcher'
  constructor({ team = 'home', num = '', name = '', role = 'fielder', seed = Math.random() } = {}) {
    const u = UNIFORMS[team] || UNIFORMS.home;
    this.team = team; this.role = role;
    const rnd = (k) => { const x = Math.sin(seed * 9301 + k * 49297) * 233280; return x - Math.floor(x); };
    const skin = std(SKINS[Math.floor(rnd(1) * SKINS.length)], 0.62);
    const hair = std(HAIRS[Math.floor(rnd(2) * HAIRS.length)], 0.9);
    const jerseyM = new THREE.MeshStandardMaterial({ map: jerseyTex(u, num, name), roughness: 0.82 });
    const jersey = std(u.jersey, 0.82);
    const pants = std(u.pants, 0.85);
    const accent = std(u.accent, 0.7);
    const sock = std(u.sock, 0.8);
    const shoe = std('#16181d', 0.45);
    const belt = std('#121418', 0.5);
    const leather = std('#7b4a25', 0.6);
    const leatherDark = std('#4d2d17', 0.65);
    const batGlove = std(team === 'away' ? '#d7d9de' : '#1d2a4a', 0.6);
    this.mats = { skin, jersey, jerseyM, pants, accent };
    this.look = { u, num, name, skin: skin.color, hair: hair.color, batGlove: batGlove.color, under: null, seed: rnd(12), sockY: 0.3 + rnd(13) * 0.14 };
    this.armA = 0.29; this.armB = 0.31;
    this.scale = 0.96 + rnd(3) * 0.08;

    const J = {};
    const root = new THREE.Group();
    const body = new THREE.Group(); // 루트 오프셋(점프/다이빙)
    root.add(body);
    const hips = J.hips = new THREE.Group(); hips.position.y = 0.97; body.add(hips);
    const pelvis = mesh(sphere(0.165, 24, 16), pants, 0, 0.01, 0); pelvis.scale.set(1.1, 0.66, 0.76); hips.add(pelvis);
    for (const sx of [-1, 1]) { const gl = mesh(sphere(0.09, 16, 12), pants, sx * 0.07, -0.04, -0.06); gl.scale.set(1, 1.05, 0.9); hips.add(gl); }
    const beltM = mesh(cyl(0.163, 0.163, 0.034), belt, 0, 0.068, 0); beltM.scale.set(1.04, 1, 0.75); hips.add(beltM);
    hips.add(mesh(geo('buckle', () => new THREE.BoxGeometry(0.04, 0.03, 0.01)), std('#c9ced6', 0.3, 0.8), 0, 0.068, 0.124, false));
    const spine = J.spine = new THREE.Group(); spine.position.y = 0.06; hips.add(spine);
    const abd = mesh(limb('abd', [[0.152, 0.22], [0.156, 0.12], [0.16, 0.0]], 1.14, 0.74, 28), jersey, 0, 0, 0); spine.add(abd);
    const chest = J.chest = new THREE.Group(); chest.position.y = 0.19; spine.add(chest);
    chest.add(mesh(torsoGeo(), jerseyM, 0, 0, 0));
    // 목/머리
    const neck = J.neck = new THREE.Group(); neck.position.y = 0.29; chest.add(neck);
    neck.add(mesh(limb('neck', [[0.048, 0.1], [0.052, 0.04], [0.06, -0.01]], 1, 1.05, 16), skin, 0, 0, 0.005));
    const trap = mesh(sphere(0.1, 20, 12), jersey, 0, 0.27, -0.025); trap.scale.set(1.45, 0.42, 0.8); chest.add(trap);
    const head = J.head = new THREE.Group(); head.position.y = 0.085; neck.add(head);
    // 얼굴: AI 얼굴 텍스처(있으면) 아니면 그린 얼굴
    const fi = FACE_SET.length ? Math.floor(rnd(11) * FACE_SET.length) : -1;
    const pf = fi >= 0 ? photoFace(fi) : null;
    if (pf && FACE_SET[fi].skin) skin.color.set(FACE_SET[fi].skin);
    const fmap = pf || faceTex('#' + skin.color.getHexString(), '#' + hair.color.getHexString(), rnd(9));
    const headMat = new THREE.MeshStandardMaterial({ map: fmap, roughness: 0.6, emissive: '#ffffff', emissiveMap: fmap, emissiveIntensity: 0.22 }); // 모자 그늘에서도 얼굴이 보이게
    const headM = mesh(headGeo(), headMat, 0, -0.02, 0.008); head.add(headM); this._faceM = headMat;
    for (const s of [-1, 1]) {
      const ear = mesh(sphere(0.026, 10, 8), skin, s * 0.088, 0.105, -0.008); ear.scale.set(0.45, 1, 0.75); head.add(ear);

    }
    // 머리카락: 얼굴은 가리지 않게 옆·뒤통수만
    const hairM = mesh(geo('hairV2', () => new THREE.SphereGeometry(0.103, 24, 14, Math.PI * 0.92, Math.PI * 1.16, 0, Math.PI * 0.58)), hair, 0, 0.112, -0.004);
    hairM.scale.set(0.93, 1.06, 1.08); head.add(hairM);
    // 모자/헬멧
    this.capG = new THREE.Group(); head.add(this.capG);
    const capCrown = mesh(geo('cap', () => new THREE.SphereGeometry(0.118, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2)), std(u.cap, 0.7), 0, 0.15, -0.005);
    capCrown.scale.set(0.97, 0.78, 1.05); this.capG.add(capCrown);
    const brim = mesh(geo('brim', () => { const g = new THREE.CylinderGeometry(0.1, 0.1, 0.012, 20, 1, false, -Math.PI / 2, Math.PI); g.scale(1, 1, 0.9); return g; }), std(u.cap, 0.7), 0, 0.152, 0.075);
    this.capG.add(brim);
    if (u.k) {
      const lm = new THREE.MeshBasicMaterial({ map: logoTex(u.k, u.logoFg || '#ffffff', u.logoSt || 'rgba(0,0,0,.35)'), transparent: true, depthWrite: false, toneMapped: true });
      const capLogo = mesh(geo('logoP', () => new THREE.PlaneGeometry(0.075, 0.075)), lm, 0, 0.198, 0.098, false); capLogo.rotation.x = -0.5; this.capG.add(capLogo);
      this._logoM = lm;
    }
    this.helmetG = new THREE.Group(); this.helmetG.visible = false; head.add(this.helmetG);
    const hm = std(u.cap, 0.25, 0.1);
    const shell = mesh(geo('helm', () => new THREE.SphereGeometry(0.132, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.56)), hm, 0, 0.12, -0.01);
    shell.scale.set(0.98, 0.95, 1.06); this.helmetG.add(shell);
    const flap = mesh(geo('flap', () => new THREE.SphereGeometry(0.135, 12, 8, 0, Math.PI * 0.55, Math.PI * 0.45, Math.PI * 0.3)), hm, 0, 0.12, -0.01);
    flap.rotation.y = Math.PI * 0.2; this.helmetG.add(flap);
    this.helmetG.add(mesh(geo('hbrim', () => new THREE.CylinderGeometry(0.105, 0.105, 0.012, 16, 1, false, -Math.PI / 2.4, Math.PI / 1.2)), hm, 0, 0.13, 0.07));
    if (this._logoM) { const hl = mesh(geo('logoP2', () => new THREE.PlaneGeometry(0.08, 0.08)), this._logoM, 0, 0.205, 0.112, false); hl.rotation.x = -0.55; this.helmetG.add(hl); }
    // 포수/심판 마스크
    this.maskG = new THREE.Group(); this.maskG.visible = false; head.add(this.maskG);
    const cage = std('#202228', 0.4, 0.6);
    for (let i = 0; i < 4; i++) {
      const bar = mesh(geo('bar', () => new THREE.TorusGeometry(0.11, 0.006, 4, 16, Math.PI)), cage, 0, 0.04 + i * 0.035, 0.035);
      bar.rotation.set(Math.PI / 2, 0, 0); bar.scale.set(1, 1.15, 1); this.maskG.add(bar);
    }
    const pad = mesh(sphere(0.12, 14, 10), std('#2a2c33', 0.8), 0, 0.12, -0.01); pad.scale.set(1.02, 1.05, 1.02); this.maskG.add(pad);

    // 팔
    const arms = {};
    for (const [s, k] of [[1, 'L'], [-1, 'R']]) {
      const sh = new THREE.Group(); sh.position.set(s * 0.198, 0.236, -0.005); chest.add(sh);
      const ua = J['ua' + k] = new THREE.Group(); sh.add(ua);
      ua.add(mesh(sphere(0.084, 20, 14), jersey, 0, -0.01, 0));
      const slv = mesh(limb('sleeve', [[0.084, 0.0], [0.083, -0.08], [0.08, -0.155]], 1, 0.95, 20), jersey, 0, 0, 0); ua.add(slv);
      const trim = mesh(cyl(0.071, 0.071, 0.02), accent, 0, -0.155, 0); ua.add(trim);
      const under = rnd(7) < 0.62 && role !== 'ump' ? std(u.under || u.accent, 0.85) : skin; // 언더셔츠 긴팔(팀 색)
      this.look.under = under.color;
      ua.add(mesh(limb('uarm', [[0.066, -0.06], [0.064, -0.16], [0.056, -0.26], [0.05, -0.3]], 1, 0.92, 18), under, 0, 0, 0));
      const fa = J['fa' + k] = new THREE.Group(); fa.position.y = -0.29; ua.add(fa);
      fa.add(mesh(sphere(0.052, 16, 12), under, 0, 0, 0));
      fa.add(mesh(limb('farm', [[0.05, 0.0], [0.054, -0.06], [0.046, -0.15], [0.036, -0.235]], 1, 0.85, 18), under, 0, 0, 0));
      if (under !== skin) fa.add(mesh(cyl(0.043, 0.043, 0.035), skin, 0, -0.235, 0)); // 손목
      const hand = J['h' + k] = new THREE.Group(); hand.position.y = -0.265; fa.add(hand);
      const hm_ = role === 'batter' || role === 'runner' ? batGlove : skin;
      const palm = new THREE.Group(); hand.add(palm);
      const pm = mesh(sphere(0.04, 14, 10), hm_, 0, -0.04, 0.004); pm.scale.set(1.0, 1.15, 0.6); palm.add(pm);
      const fing = mesh(geo('fingers', () => { const g = new THREE.CapsuleGeometry(0.03, 0.035, 4, 10); g.scale(1.25, 1, 0.62); return g; }), hm_, 0, -0.095, 0.012); fing.rotation.x = 0.35; palm.add(fing);
      const thumb = mesh(sphere(0.018, 8, 6), role === 'batter' || role === 'runner' ? batGlove : skin, s * -0.03, -0.035, 0.022); thumb.scale.set(1, 1.6, 1); hand.add(thumb);
      arms[k] = { sh, ua, fa, hand, palm };
    }
    // 글러브 (왼손)
    this.glove = new THREE.Group();
    // 글러브: 손바닥 포켓 + 손가락 4개(부채꼴) + 엄지 + 웹 + 끈 디테일
    const gBody = mesh(sphere(0.07, 18, 14), leather, 0, -0.07, 0.03); gBody.scale.set(1.3, 1.45, 0.62); this.glove.add(gBody);
    for (let f = 0; f < 4; f++) {
      const fg = mesh(capsule(0.021, 0.1), f % 2 ? leatherDark : leather, 0.045 - f * 0.026, -0.17 - Math.abs(f - 1.5) * -0.008, 0.032);
      fg.rotation.z = (f - 1.5) * 0.12; fg.scale.set(1, 1, 0.8); this.glove.add(fg);
    }
    const web = mesh(sphere(0.042, 12, 8), leatherDark, -0.072, -0.165, 0.035); web.scale.set(0.9, 1.4, 0.35); this.glove.add(web);
    const gThumb = mesh(capsule(0.022, 0.11), leather, -0.088, -0.11, 0.04); gThumb.rotation.z = 0.42; this.glove.add(gThumb);
    const lace = std('#3b2412', 0.8);
    for (let k = 0; k < 4; k++) { const l = mesh(geo('lace', () => new THREE.TorusGeometry(0.014, 0.003, 4, 10)), lace, 0.052 - k * 0.032, -0.235, 0.032, false); l.rotation.x = Math.PI / 2; this.glove.add(l); }
    const cuff = mesh(cyl(0.05, 0.054, 0.04), leatherDark, 0, -0.01, 0.01); this.glove.add(cuff);
    if (role === 'catcher') { this.glove.scale.set(1.35, 1.1, 1.5); gBody.material = std('#5d371b', 0.6); }
    this.glove.userData.acc = true;
    arms.L.hand.add(this.glove);
    this.glove.visible = !['batter', 'runner', 'ump'].includes(role);
    if (this.glove.visible) arms.L.palm.visible = false;

    // 다리
    for (const [s, k] of [[1, 'L'], [-1, 'R']]) {
      const th = J['th' + k] = new THREE.Group(); th.position.set(s * 0.094, -0.025, 0); hips.add(th);
      const thM = mesh(limb('thigh', [[0.104, 0.04], [0.112, -0.04], [0.106, -0.16], [0.092, -0.3], [0.082, -0.42]], 1, 0.98, 20), pants, 0, 0, 0.006); th.add(thM);
      const shin = J['shin' + k] = new THREE.Group(); shin.position.y = -0.44; th.add(shin);
      shin.add(mesh(sphere(0.083, 18, 12), pants, 0, 0, 0.006));
      shin.add(mesh(limb('shinP', [[0.082, 0.0], [0.08, -0.1], [0.072, -0.2], [0.066, -0.235]], 1, 0.98, 20), pants, 0, 0, 0)); // 바지 밑단(종아리 위)
      shin.add(mesh(limb('calf', [[0.064, -0.2], [0.066, -0.25], [0.052, -0.34], [0.043, -0.42]], 1, 1.05, 18), sock, 0, 0, -0.006)); // 스타킹(종아리 근육)
      const ft = J['ft' + k] = new THREE.Group(); ft.position.y = -0.425; shin.add(ft);
      const shoeM = mesh(geo('shoe', () => { const g = new THREE.CapsuleGeometry(0.046, 0.17, 4, 10); g.rotateX(Math.PI / 2); g.scale(1, 0.85, 1); return g; }), shoe, 0, -0.038, 0.055);
      ft.add(shoeM);
      const sole = mesh(geo('sole', () => new THREE.BoxGeometry(0.085, 0.014, 0.25)), std('#e8e8e8', 0.7), 0, -0.073, 0.055); ft.add(sole);
      for (const sx of [-1, 1]) { const st = mesh(geo('sstripe', () => new THREE.BoxGeometry(0.006, 0.022, 0.12)), std(u.shoeAcc || '#f0f0f0', 0.6), sx * 0.047, -0.045, 0.05, false); st.rotation.x = -0.25; ft.add(st); }
      if (role === 'catcher' || role === 'ump') {
        const guard = mesh(capsule(0.072, 0.22), std(role === 'ump' ? '#2a2c33' : u.accent, 0.4), 0, -0.2, 0.03); shin.add(guard); guard.userData.acc = true;
      }
    }
    if (role === 'catcher' || role === 'ump') {
      const prot = mesh(geo('prot', () => { const g = new THREE.SphereGeometry(0.2, 16, 12, 0, Math.PI, 0.25, Math.PI * 0.6); g.scale(1.05, 1.15, 0.7); return g; }), std(role === 'ump' ? '#2a2c33' : u.accent, 0.5), 0, 0.12, 0.02);
      chest.add(prot); prot.userData.acc = true; this.prot = prot;
      this.maskG.visible = true;
      this.capG.visible = role === 'ump';
      if (role === 'catcher') { this.capG.visible = false; }
    }

    // 배트
    this.bat = new THREE.Group();
    const batProfile = [[0.0, 0], [0.024, 0], [0.026, 0.012], [0.015, 0.03], [0.0125, 0.1], [0.013, 0.3], [0.024, 0.52], [0.032, 0.68], [0.033, 0.82], [0.03, 0.855], [0.0, 0.86]].map(([r, y]) => new THREE.Vector2(r, y));
    const batM = mesh(geo('bat', () => new THREE.LatheGeometry(batProfile, 14)), std('#caa06a', 0.45), 0, 0, 0);
    this.bat.add(batM);
    const grip = mesh(cyl(0.0145, 0.0145, 0.2), std('#1c1c1c', 0.8), 0, 0.12, 0); this.bat.add(grip);
    this.bat.visible = false; this.bat.userData.acc = true;
    root.add(this.bat);

    root.scale.setScalar(this.scale);
    this.root = root; this.body = body; this.J = J; this.arms = arms;
    this.base = {}; for (const k of JOINTS) this.base[k] = J[k].rotation.clone();
    this.ball = mesh(sphere(0.037, 10, 8), std('#f7f5ef', 0.5), 0, -0.07, 0.04); this.ball.visible = false; this.ball.userData.acc = true;
    for (const g of [this.capG, this.helmetG, this.maskG]) g.userData.acc = true;
    arms.R.hand.add(this.ball);
    this.pose = {};
    this.root.traverse((o) => { if (o.isMesh) o.receiveShadow = false; });
  }

  setRole(role) {
    this.role = role;
    this.helmetG.visible = role === 'batter' || role === 'runner';
    if (role !== 'catcher' && role !== 'ump') this.capG.visible = !this.helmetG.visible;
    this.bat.visible = role === 'batter';
    if (!['catcher', 'ump'].includes(this.role)) {
      this.glove.visible = role !== 'batter' && role !== 'runner';
      this.arms.L.palm.visible = !this.glove.visible;
    }
  }

  // pose: {joint: [x,y,z]}, root: [x,y,z] 오프셋, k: 블렌드(0~1)
  applyPose(pose, k = 1) {
    for (const j of JOINTS) {
      const t = pose[j] || ZERO;
      const r = this.J[j].rotation;
      r.x += (t[0] - r.x) * k; r.y += (t[1] - r.y) * k; r.z += (t[2] - r.z) * k;
    }
    const ro = pose.root || ZERO, b = this.body.position;
    b.x += (ro[0] - b.x) * k; b.y += (ro[1] - b.y) * k; b.z += (ro[2] - b.z) * k;
    const rr = pose.rootR || ZERO, br = this.body.rotation;
    br.x += (rr[0] - br.x) * k; br.y += (rr[1] - br.y) * k; br.z += (rr[2] - br.z) * k;
  }

  // 2관절 IK: 손(side 'L'|'R')을 월드 좌표 target으로, pole은 팔꿈치가 향할 월드 좌표
  ik(side, target, pole, weight = 1) {
    const ua = this.J['ua' + side], fa = this.J['fa' + side];
    ua.parent.updateWorldMatrix(true, false);
    ua.updateWorldMatrix(false, false);
    const s = this.scale;
    const a = this.armA * s, b = this.armB * s;
    ua.getWorldPosition(_S);
    _d.subVectors(target, _S);
    const dist = clamp(_d.length(), 0.08 * s, (a + b) * 0.999);
    _d.normalize();
    const A = Math.acos(clamp((a * a + dist * dist - b * b) / (2 * a * dist), -1, 1));
    _p.subVectors(pole, _S);
    _perp.copy(_p).addScaledVector(_d, -_p.dot(_d));
    if (_perp.lengthSq() < 1e-8) _perp.set(0, -1, 0).addScaledVector(_d, -_d.y);
    _perp.normalize();
    _E.copy(_S).addScaledVector(_d, a * Math.cos(A)).addScaledVector(_perp, a * Math.sin(A));
    _T.copy(_S).addScaledVector(_d, dist);
    _y.subVectors(_S, _E).normalize();
    _f.subVectors(_T, _E).normalize();
    _z.copy(_f).addScaledVector(_y, -_f.dot(_y));
    if (_z.lengthSq() < 1e-8) _z.copy(_perp);
    _z.normalize();
    _x.crossVectors(_y, _z);
    _m.makeBasis(_x, _y, _z);
    _q.setFromRotationMatrix(_m);
    ua.parent.getWorldQuaternion(_pq);
    _pq.invert().multiply(_q);
    const bend = Math.acos(clamp(-_y.dot(_f), -1, 1));
    _q2.setFromAxisAngle(_X, -bend);
    if (weight >= 1) { ua.quaternion.copy(_pq); fa.quaternion.copy(_q2); }
    else { ua.quaternion.slerp(_pq, weight); fa.quaternion.slerp(_q2, weight); }
    ua.updateWorldMatrix(false, true);
  }

  // 머리가 월드 점을 보도록 (가중치)
  lookAt(target, w = 1, maxYaw = 1.3, maxPitch = 0.6) {
    const neck = this.J.neck, head = this.J.head;
    neck.updateWorldMatrix(true, false);
    _v.copy(target);
    neck.worldToLocal(_v);
    _v.y -= 0.18;
    const yaw = clamp(Math.atan2(_v.x, _v.z), -maxYaw, maxYaw);
    const pitch = clamp(-Math.atan2(_v.y, Math.hypot(_v.x, _v.z)), -maxPitch, maxPitch);
    head.rotation.y += (yaw * 0.7 - head.rotation.y) * w;
    neck.rotation.y += (yaw * 0.3 - neck.rotation.y) * w;
    head.rotation.x += (pitch - head.rotation.x) * w;
  }

  // 배트를 루트 로컬 기준 knob 위치와 방향으로
  placeBat(knob, dir) {
    this.bat.position.copy(knob);
    _q.setFromUnitVectors(_Y, _v.copy(dir).normalize());
    this.bat.quaternion.copy(_q);
  }
  batPoint(t, out) { // 배트 위 거리 t(m) 지점의 월드 좌표
    return this.bat.localToWorld(out.set(0, t, 0));
  }

  dispose() {
    this.root.traverse((o) => { if (o.isMesh && o.material === this.mats.jerseyM) o.material.dispose(); });
  }
}
const ZERO = [0, 0, 0];
const _S = V(), _T = V(), _E = V(), _d = V(), _p = V(), _perp = V(), _x = V(), _y = V(), _z = V(), _f = V(), _v = V();
const _X = V(1, 0, 0), _Y = V(0, 1, 0);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _pq = new THREE.Quaternion();
