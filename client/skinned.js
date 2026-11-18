// skinned.js — 리깅된 매끈한 인체 모델(GLB, Mixamo 리그)을 기존 절차형 리그(Player)가 '구동'하도록 리타깃
// · Player(관절 그룹 + 포즈 + IK)는 그대로 두고 몸 메시는 숨김 → 같은 관절 위치/회전을 스킨 메시 뼈대에 복사
// · 유니폼 색은 정점별 '부위(zone)' + 셰이더 유니폼으로 칠함(지오메트리 공유, 선수마다 머티리얼만 다름)
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { BONES, BIND_POS } from './rig.js';
import { Character } from './anim/character.js';

const MAP = { // driver 관절 → 스킨 뼈
  hips: 'Hips', spine: 'Spine', chest: 'Spine2', neck: 'Neck', head: 'Head',
  uaL: 'LeftArm', faL: 'LeftForeArm', hL: 'LeftHand', uaR: 'RightArm', faR: 'RightForeArm', hR: 'RightHand',
  thL: 'LeftUpLeg', shinL: 'LeftLeg', ftL: 'LeftFoot', thR: 'RightUpLeg', shinR: 'RightLeg', ftR: 'RightFoot',
};
// 부위(셰이더에서 바인드 위치로 판정): 0 피부 1 상의 2 언더셔츠 3 바지 4 스타킹 5 신발 6 벨트 7 손(장갑) 8 트림 9 밑창 10 머리카락
const ZR = [0.55, 0.82, 0.78, 0.86, 0.8, 0.38, 0.42, 0.62, 0.72, 0.85, 0.9];

let SRC = null, loading = null;
const pending = new Set(), live = new Set();
const BIND = Object.fromEntries(Object.entries(BIND_POS).map(([k, v]) => [k, new THREE.Vector3(...v)]));

function parseGeo(buf) {
  const h = new Uint32Array(buf, 0, 3);
  if (h[0] !== 0x31425248) throw new Error('bad body.bin');
  const nv = h[1], ni = h[2]; let o = 12;
  const pos = new Float32Array(buf, o, nv * 3); o += nv * 12;
  const nrm = new Int16Array(buf, o, nv * 3); o += nv * 6;
  const jn = new Uint8Array(buf, o, nv * 4); o += nv * 4;
  const wt = new Uint8Array(buf, o, nv * 4); o += nv * 4;
  const idx = new Uint16Array(buf, o, ni);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3, true));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(jn, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(wt, 4, true));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}
// 고/저 폴리 두 몸체가 같은 뼈대를 공유 → 카메라 거리로 보이는 쪽만 바꿈(LOD)
function build(buf, bufLo) {
  const bones = {}, list = [];
  for (const [n, par, x, y, z] of BONES) {
    const b = new THREE.Bone(); b.name = n;
    const pp = par ? BIND_POS[par] : [0, 0, 0];
    b.position.set(x - pp[0], y - pp[1], z - pp[2]);
    if (par) bones[par].add(b);
    bones[n] = b; list.push(b);
  }
  const scene = new THREE.Group();
  scene.add(bones.Hips);
  scene.updateMatrixWorld(true);
  const sk = new THREE.Skeleton(list);
  const hi = new THREE.SkinnedMesh(parseGeo(buf), new THREE.MeshStandardMaterial()); hi.name = 'bodyHi';
  scene.add(hi); hi.bind(sk);
  if (bufLo) { const lo = new THREE.SkinnedMesh(parseGeo(bufLo), new THREE.MeshStandardMaterial()); lo.name = 'bodyLo'; lo.visible = false; scene.add(lo); lo.bind(sk); }
  SRC = scene;
}

export function loadSkin(url, urlLo) {
  if (loading) return loading;
  const get = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); });
  loading = Promise.all([get(url), urlLo ? get(urlLo).catch(() => null) : null])
    .then(([b, lo]) => { build(b, lo); for (const p of pending) if (p.root.parent) attachSkin(p); pending.clear(); return true; })
    .catch((e) => { console.warn('skin load', e); SRC = null; return false; });
  return loading;
}

// 등번호/이름/워드마크 데칼 (왼쪽 절반 = 앞, 오른쪽 절반 = 등)
const decalCache = new Map();
export function decalTex(u, num, name) {
  const key = JSON.stringify([u.word, u.num, u.accent, u.jersey, num, name]);
  if (decalCache.has(key)) return decalCache.get(key);
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const stroke = u.accent === u.num ? (u.jersey === '#ffffff' ? '#222' : '#ffffff') : u.accent;
  if (u.word) {
    let fs = 118; g.font = `700 italic ${fs}px Oswald, "Arial Narrow", sans-serif`;
    while (fs > 50 && g.measureText(u.word).width > 330) { fs -= 4; g.font = `700 italic ${fs}px Oswald, "Arial Narrow", sans-serif`; }
    g.save(); g.translate(256, 220); g.rotate(-0.05);
    g.lineWidth = 10; g.strokeStyle = u.num === u.accent ? 'rgba(255,255,255,.9)' : u.num; g.strokeText(u.word, 0, 0);
    g.fillStyle = u.accent; g.fillText(u.word, 0, 0); g.restore();
  }
  if (num !== '' && num != null) {
    g.font = '700 74px Oswald, "Arial Narrow", sans-serif';
    g.lineWidth = 7; g.strokeStyle = stroke; g.strokeText(String(num), 330, 330); g.fillStyle = u.num; g.fillText(String(num), 330, 330);
    g.font = '700 250px Oswald, "Arial Narrow", sans-serif';
    g.lineWidth = 14; g.strokeStyle = stroke; g.strokeText(String(num), 768, 300); g.fillStyle = u.num; g.fillText(String(num), 768, 300);
  }
  if (name) { g.fillStyle = u.num; g.font = '700 64px Oswald, sans-serif'; g.fillText(String(name).slice(0, 10).toUpperCase(), 768, 112); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  decalCache.set(key, t); return t;
}

function skinMaterial(P) {
  const L = P.look, u = L.u;
  const C = (x) => new THREE.Color(x);
  const zc = [C(L.skin), C(u.jersey), C(L.under || L.skin), C(u.pants), C(u.sock), C('#15171c'), C('#111317'), C(L.skin), C(u.trim || u.accent), C('#e9e9e6'), C(L.hair)];
  const uni = {
    zc: { value: zc }, zr: { value: ZR.slice() },
    decal: { value: decalTex(u, P.team === 'ump' ? '' : L.num, L.name) },
    pinC: { value: C(u.pin || u.jersey) }, pinOn: { value: u.pin ? 1 : 0 },
    stir: { value: u.sock === u.pants ? 0 : 1 },
  };
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, metalness: 0 });
  m.userData.uni = uni;
  m.customProgramCacheKey = () => 'hrSkinV2';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vBP; varying vec3 vBN;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vBP = position; vBN = normal;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vBP; varying vec3 vBN; uniform vec3 zc[11]; uniform float zr[11]; uniform sampler2D decal; uniform vec3 pinC; uniform float pinOn; uniform float stir;
int zoneAt(vec3 p) {
  float ax = abs(p.x);
  if (ax > 0.2 && p.y > 1.3) return ax < 0.3 ? 1 : ax < 0.312 ? 8 : ax < 0.692 ? 2 : 7;
  float nr = length(vec2(p.x, (p.z + 0.022) * 1.1));
  if (p.y > 1.53 || (p.y > 1.468 && nr < 0.08)) {
    if (p.y > 1.64 && p.z < -0.012 + (p.y - 1.64) * 0.62 && !(ax > 0.079 && p.y < 1.712)) return 10;
    return 0;
  }
  if (p.y > 1.45 && nr < 0.098) return 8;
  if (p.y > 1.086) return 1;
  if (p.y > 1.042) return 6;
  if (p.y < 0.019) return 9;
  if (p.y < 0.128) return 5;
  if (p.y < 0.345) return 4;
  return 3;
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
int zk = zoneAt(vBP);
vec3 zcol = zc[zk];
float ax = abs(vBP.x);
if ((zk == 1 || zk == 3) && pinOn > 0.5) { float s = abs(fract((abs(vBN.z) > abs(vBN.x) ? vBP.x : vBP.z) * 40.0) - 0.5); zcol = mix(zcol, pinC, smoothstep(0.43, 0.47, s)); }
if (zk == 1 && ax < 0.2 && vBP.y > 1.1 && vBP.y < 1.5) {
  float fz = vBN.z;
  vec2 duv = vec2((vBP.x + 0.2) / 0.4 * 0.5, (vBP.y - 1.1) / 0.4);
  if (fz < 0.0) duv.x = 0.5 + (0.2 - vBP.x) / 0.4 * 0.5;
  vec4 d = texture2D(decal, duv);
  zcol = mix(zcol, d.rgb, d.a * smoothstep(0.25, 0.5, abs(fz)));
  if (vBN.z > 0.5 && ax < 0.003 && vBP.y < 1.45) zcol *= 0.8; // 단추선
}
if (zk == 4 && stir > 0.5 && vBP.y > 0.2 && vBP.y < 0.235) zcol = mix(zcol, zc[1], 0.9); // 스타킹 띠
if (zk == 6 && vBN.z > 0.85 && ax < 0.022) zcol = vec3(0.62, 0.64, 0.67); // 버클
// 얼굴(눈·눈썹·입) — 단순한 게임 캐릭터 스타일
if (zk == 0 && vBN.z > 0.35 && vBP.y > 1.6 && vBP.y < 1.75) {
  vec2 e = vec2((ax - 0.032) / 0.0088, (vBP.y - 1.697) / 0.0052);
  float eye = 1.0 - smoothstep(0.8, 1.05, length(e));
  zcol = mix(zcol, vec3(0.06, 0.045, 0.04), eye);
  vec2 hl = vec2((ax - 0.0295) / 0.0025, (vBP.y - 1.6985) / 0.0025);
  zcol = mix(zcol, vec3(0.9), (1.0 - smoothstep(0.6, 1.0, length(hl))) * eye * 0.8);
  float bx = (ax - 0.033) / 0.02, by = vBP.y - (1.7115 + 0.0015 * (1.0 - bx * bx) + (ax - 0.033) * 0.06);
  float brow = (1.0 - smoothstep(0.85, 1.0, abs(bx))) * (1.0 - smoothstep(0.003, 0.0045, abs(by)));
  zcol = mix(zcol, zc[10] * 0.8, brow);
  float mo = (1.0 - smoothstep(0.016, 0.02, ax)) * (1.0 - smoothstep(0.0012, 0.0024, abs(vBP.y - 1.637 + ax * ax * 2.0)));
  zcol = mix(zcol, zcol * vec3(0.62, 0.45, 0.42), mo * 0.8);
}
diffuseColor.rgb *= zcol;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = zr[zoneAt(vBP)];`);
  };
  return m;
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3();
const QZp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
const QZm = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2);
const OFF = { // O = inv(driver 보정 자세 회전) — mixamo 바인드는 T포즈(뼈 회전 = 단위)
  uaL: QZp.clone().invert(), faL: QZp.clone().invert(), hL: QZp.clone().invert(),
  uaR: QZm.clone().invert(), faR: QZm.clone().invert(), hR: QZm.clone().invert(),
};
const CURL_L = [], CURL_R = [];
for (let i = 0; i <= 12; i++) {
  const a = i / 10;
  CURL_L.push(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -a));
  CURL_R.push(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a));
}
const THUMB = []; for (let i = 0; i <= 12; i++) THUMB.push(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.15 + i * 0.05));

// ── 야구모자: 머리(스킨 몸체)에 맞춘 6패널 크라운 + 휘어진 챙 + 단추 ──
let CAPGEO = null;
const CX = 1.0, CY = 1.12, CZ = 1.2; // 머리 앞뒤가 길어서 앞뒤로 늘림
function capGeos() {
  if (CAPGEO) return CAPGEO;
  // 크라운: 띠(이마) → 볼록 → 평평한 정수리. 앞이 조금 높게 기울임
  const prof = [[0.0985, 0.0], [0.1005, 0.02], [0.0995, 0.045], [0.094, 0.066], [0.082, 0.083], [0.062, 0.094], [0.035, 0.1], [0.0, 0.102]].map(([r, y]) => new THREE.Vector2(r, y));
  const crown = new THREE.LatheGeometry(prof, 36);
  crown.scale(CX, CY, CZ); crown.computeVertexNormals();
  // 패널 솔기(얇은 어두운 띠 6줄)
  const seamPts = [];
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * Math.PI * 2 + Math.PI / 6;
    for (let i = 0; i < prof.length - 1; i++) {
      const p0 = prof[i], p1 = prof[i + 1];
      seamPts.push(new THREE.Vector3(Math.sin(a) * p0.x * CX * 1.004, p0.y * CY + 0.0004, Math.cos(a) * p0.x * CZ * 1.004), new THREE.Vector3(Math.sin(a) * p1.x * CX * 1.004, p1.y * CY + 0.0004, Math.cos(a) * p1.x * CZ * 1.004));
    }
  }
  const seams = new THREE.BufferGeometry().setFromPoints(seamPts);
  // 챙: 앞쪽 반타원, 양옆이 아래로 휘고 끝이 살짝 내려감
  const sh = new THREE.Shape();
  const W = 0.096, L = 0.078;
  sh.moveTo(-W, 0);
  for (let i = 0; i <= 24; i++) { const t = Math.PI - i / 24 * Math.PI; sh.lineTo(Math.cos(t) * W, Math.sin(t) * L); }
  sh.lineTo(-W, 0);
  const brim = new THREE.ExtrudeGeometry(sh, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1, curveSegments: 24 });
  brim.rotateX(Math.PI / 2);
  const pos = brim.attributes.position;
  for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), z = pos.getZ(i); pos.setY(i, pos.getY(i) - (x * x) * 1.3 - z * 0.2); }
  brim.computeVertexNormals();
  const button = new THREE.SphereGeometry(0.009, 10, 6);
  CAPGEO = { crown, seams, brim, button };
  return CAPGEO;
}
function rebuildCap(P) {
  const g = P.capG; if (!g) return;
  const old = g.children.find((c) => c.isMesh && c.material && !c.material.map);
  const mat = old ? old.material : new THREE.MeshStandardMaterial({ color: P.look.u.cap, roughness: 0.7 });
  const lm = P._logoM;
  g.clear(); g.position.set(0, 0, 0); g.scale.set(1, 1, 1); g.rotation.set(0, 0, 0);
  const G = capGeos();
  const tilt = new THREE.Group(); tilt.position.set(0, 0.101, 0.012); tilt.rotation.x = -0.05; g.add(tilt);
  const crown = new THREE.Mesh(G.crown, mat); crown.castShadow = true; tilt.add(crown);
  const seamM = new THREE.LineBasicMaterial({ color: new THREE.Color(P.look.u.cap).multiplyScalar(0.55) });
  tilt.add(new THREE.LineSegments(G.seams, seamM));
  const brim = new THREE.Mesh(G.brim, mat); brim.position.set(0, 0.008, 0.108); brim.castShadow = true; tilt.add(brim);
  const under = new THREE.Mesh(G.brim, new THREE.MeshStandardMaterial({ color: '#2b3a2e', roughness: 0.9 })); under.position.set(0, 0.002, 0.108); under.scale.set(0.985, 1, 0.985); tilt.add(under);
  tilt.add(new THREE.Mesh(G.button, mat).translateY(0.102 * CY));
  if (lm) { const lg = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.06), lm); lg.position.set(0, 0.055, 0.1155); lg.rotation.x = -0.2; tilt.add(lg); }
}
export function attachSkin(P) {
  if (P.skin) return true;
  if (!SRC) { pending.add(P); return false; }
  const model = SkeletonUtils.clone(SRC);
  const bones = {}; const order = [];
  model.traverse((o) => { if (o.isBone) { bones[o.name] = o; order.push(o); } });
  // driver 관절 위치를 모델 뼈 위치에 맞춤(비율 일치 → IK 손 위치 = 모델 손 위치)
  const J = P.J, W = BIND, d = (a, b) => _v.subVectors(W[a], W[b]).clone();
  J.hips.position.copy(W.Hips);
  J.spine.position.copy(d('Spine', 'Hips'));
  J.chest.position.copy(d('Spine2', 'Spine'));
  J.neck.position.copy(d('Neck', 'Spine2'));
  J.head.position.copy(d('Head', 'Neck'));
  for (const [k, n] of [['L', 'Left'], ['R', 'Right']]) {
    P.arms[k].sh.position.copy(d(n + 'Arm', 'Spine2'));
    J['fa' + k].position.set(0, -W[n + 'ForeArm'].distanceTo(W[n + 'Arm']), 0);
    J['h' + k].position.set(0, -W[n + 'Hand'].distanceTo(W[n + 'ForeArm']), 0);
    J['th' + k].position.copy(d(n + 'UpLeg', 'Hips'));
    J['shin' + k].position.copy(d(n + 'Leg', n + 'UpLeg'));
    J['ft' + k].position.copy(d(n + 'Foot', n + 'Leg'));
  }
  P.armA = W.LeftForeArm.distanceTo(W.LeftArm);
  P.armB = W.LeftHand.distanceTo(W.LeftForeArm) + 0.05;
  // 글러브: 모델 손바닥(차렷 시 몸쪽)을 향하게 손 축으로 90° 돌림 / 공은 손바닥 쪽
  rebuildCap(P); P.helmetG.position.y = 0.012; P.maskG.position.y = -0.01;
  if (P.prot) { P.prot.position.set(0, -0.02, 0.05); P.prot.scale.set(1.0, 1.1, 0.62); }
  P.glove.rotation.y = -Math.PI / 2; P.glove.position.set(0, 0.01, 0);
  P.ball.position.set(0.035, -0.075, 0.0);
  // 기존 몸 메시 숨김(장비만 남김)
  P.root.traverse((o) => {
    if (!o.isMesh) return;
    let a = o, acc = false; while (a && a !== P.root) { if (a.userData.acc) { acc = true; break; } a = a.parent; }
    if (!acc) o.visible = false;
  });
  const mat = skinMaterial(P);
  model.traverse((o) => { if (o.isSkinnedMesh) { o.material = mat; o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false; } });
  P.root.add(model);
  const info = order.map((b) => {
    const n = b.name;
    const drv = Object.keys(MAP).find((k) => MAP[k] === n) || null;
    let curl = 0; if (/(Index|Middle|Ring|Pinky)[123]$/.test(n)) curl = 1; else if (/Thumb[123]$/.test(n)) curl = 2;
    return { b, n, drv, par: b.parent && b.parent.isBone ? order.indexOf(b.parent) : -1, left: n.startsWith('Left'), curl, wq: new THREE.Quaternion() };
  });
  const hipsI = info.findIndex((x) => x.n === 'Hips'), sp = info.findIndex((x) => x.n === 'Spine'), sp2 = info.findIndex((x) => x.n === 'Spine2');
  P.skin = { model, mat, info, hipsI, sp, sp2, bones, dq: {}, hi: model.getObjectByName('bodyHi'), lo: model.getObjectByName('bodyLo') };
  P.syncSkin = () => syncSkin(P);
  live.add(P);
  return true;
}

// driver 관절의 루트 공간 회전
const CH = [['hips', null], ['spine', 'hips'], ['chest', 'spine'], ['neck', 'chest'], ['head', 'neck'],
  ['uaL', 'chest'], ['faL', 'uaL'], ['hL', 'faL'], ['uaR', 'chest'], ['faR', 'uaR'], ['hR', 'faR'],
  ['thL', 'hips'], ['shinL', 'thL'], ['ftL', 'shinL'], ['thR', 'hips'], ['shinR', 'thR'], ['ftR', 'shinR']];
function syncSkin(P) {
  const S = P.skin, J = P.J, dq = S.dq;
  const bodyQ = P.body.quaternion;
  for (const [k, par] of CH) {
    const q = dq[k] || (dq[k] = new THREE.Quaternion());
    if (!par) q.copy(bodyQ).multiply(J.hips.quaternion);
    else {
      q.copy(dq[par]);
      if (k[0] === 'u') q.multiply(P.arms[k[2]].sh.quaternion);
      q.multiply(J[k].quaternion);
    }
  }
  // 손가락 쥐기 정도
  const role = P.role;
  const gripR = role === 'batter' ? 12 : P.ball.visible ? 9 : role === 'runner' ? 7 : 3;
  const gripL = role === 'batter' ? 12 : role === 'runner' ? 7 : 3;
  const gloveOn = P.glove.visible;
  const zc = S.mat.userData.uni.zc.value;
  zc[7].copy(role === 'batter' || role === 'runner' ? P.look.batGlove : P.look.skin);
  for (let i = 0; i < S.info.length; i++) {
    const it = S.info[i], b = it.b;
    const pq = it.par >= 0 ? S.info[it.par].wq : null;
    if (it.drv) {
      it.wq.copy(dq[it.drv]); const o = OFF[it.drv]; if (o) it.wq.multiply(o);
    } else if (it.n === 'Spine1') {
      it.wq.copy(dq.spine).slerp(dq.chest, 0.5);
    } else {
      // 바인드 로컬(단위) + 손가락 쥐기
      if (it.curl === 1) b.quaternion.copy((it.left ? CURL_L : CURL_R)[it.left ? gripL : gripR]);
      else if (it.curl === 2) b.quaternion.copy(THUMB[it.left ? gripL : gripR]);
      else b.quaternion.identity();
      it.wq.copy(pq || _q2.identity()).multiply(b.quaternion);
      continue;
    }
    if (pq) b.quaternion.copy(_q.copy(pq).invert().multiply(it.wq)); else b.quaternion.copy(it.wq);
  }
  // 엉덩이 위치
  const hb = S.info[S.hipsI].b;
  _v.copy(J.hips.position).applyQuaternion(bodyQ).add(P.body.position);
  hb.position.copy(_v);
  // 글러브 낀 손은 접어 넣음
  const lh = S.bones.LeftHand; if (lh) lh.scale.setScalar(gloveOn ? 0.55 : 1);
}

const _cp = new THREE.Vector3();
export function syncAllSkins(camera) {
  Character.frame(camera); // 새 캐릭터: 다음 프레임 화면 밖·먼 거리 판단(애니메이션 갱신 건너뛰기, LOD)
  if (camera) camera.getWorldPosition(_cp);
  for (const P of live) {
    if (!P.root.parent) { live.delete(P); continue; }
    if (!P.root.visible) continue;
    const S = P.skin;
    if (camera && S.lo) { const far = _cp.distanceToSquared(P.root.position) > 26 * 26; S.hi.visible = !far; S.lo.visible = far; }
    P.syncSkin();
  }
}
export const skinReady = () => !!SRC;
