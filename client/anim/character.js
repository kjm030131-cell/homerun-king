// character.js — Mixamo 스켈레톤을 그대로 쓰는 선수 캐릭터 (REBUILD.md 4-3)
//   const c = new Character(lib, { colors, num, name, scale });
//   c.play('run', { fade: 0.2, speed: 1.1, loop: true });   // 클립 크로스페이드
//   c.scrub('swing', t);                                      // 진행도로 긁기(게임 시각에 맞출 때)
//   c.attach('head', capMesh);                                // head | handR | handL | chest | legL | legR
//   c.setUniform({ jersey, pants, sock, num, ... });          // 흰 유니폼 → 팀 색
//   c.update(dt);                                             // 매 프레임
// 가볍게: 지오메트리·클립·셰이더 프로그램은 모든 선수가 공유(SkeletonUtils.clone), 화면 밖/먼 선수는 애니메이션 갱신을 건너뜀,
//         먼 선수는 저폴리 인덱스(같은 정점 버퍼)로 그림. 매 프레임 할당 없음.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { BODY, CLIPS, SLOT_BONE } from './clips.js';
import { PITCH_TL, pitchClipTime, kClipTime } from './timing.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const DEG = Math.PI / 180;

// ── 프레임 공용 상태(카메라 절두체) — Character.frame(camera) 를 렌더 직전에 한 번 ──
const FR = { n: 0, frustum: new THREE.Frustum(), cam: new THREE.Vector3(), has: false };
const _pm = new THREE.Matrix4(), _sph = new THREE.Sphere();

// ── 유니폼 머티리얼 ──
// 원본(Tripo) 머티리얼을 복제하고 셰이더에 '흰/옅은 회색 텍셀 → 팀 색' 을 끼워 넣는다.
// 부위 판정은 T포즈 바인드 위치(캐릭터 공간, 발=0 m)의 높이로: 목 위 = 안 칠함, 벨트 위 = 상의, 그 아래 = 바지, 종아리 아래 = 스타킹.
function bodyMaterial(src, restMatrix, U) {
  const m = src.clone();
  m.userData.uni = U;
  m.customProgramCacheKey = () => 'hrChar1' + (U.uMaskOn.value ? 'm' : '');
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
uniform mat4 uRest; uniform mat4 uRestInv; uniform vec4 uHatC; uniform vec3 uHatR; varying vec3 vRP; varying vec3 vRN;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vRP = (uRest * vec4(position, 1.0)).xyz; vRN = normalize(mat3(uRest) * normal);
// [model] 모자·헬멧 밑 머리카락 누르기: 눈썹 높이 위에서 머리 타원체 밖 정점 → 타원체 표면 (캐릭터 공간에서 계산 후 메시 공간으로)
if (uHatC.w > 0.5 && vRP.y > uHatC.y - 0.01) {
  vec3 q = (vRP - uHatC.xyz) / uHatR; float L = length(q);
  if (L > 1.0) {
    float t = smoothstep(uHatC.y - 0.01, uHatC.y + 0.02, vRP.y);
    vec3 pc = mix(vRP, uHatC.xyz + (vRP - uHatC.xyz) / L, t);
    transformed = (uRestInv * vec4(pc, 1.0)).xyz; vRP = pc;
  }
}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vRP; varying vec3 vRN;
uniform vec3 uJersey; uniform vec3 uPants; uniform vec3 uSock; uniform vec4 uTintP; uniform float uSockH; uniform float uTintOn;
uniform sampler2D uMask; uniform float uMaskOn; uniform sampler2D uDecal; uniform vec4 uDecalP;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
if (uTintOn > 0.5) {
  vec3 c0 = diffuseColor.rgb;
  float mx = max(c0.r, max(c0.g, c0.b)), mn = min(c0.r, min(c0.g, c0.b));
  float sat = mx > 1e-3 ? (mx - mn) / mx : 0.0;
  float lum = dot(c0, vec3(0.299, 0.587, 0.114));
  float h = vRP.y;
  vec3 zc = h > uTintP.w ? uJersey : (h > uSockH ? uPants : uSock);
  float msk = (1.0 - smoothstep(uTintP.x * 0.6, uTintP.x, sat)) * smoothstep(uTintP.y * 0.7, uTintP.y, lum) * (1.0 - step(uTintP.z, h));
#ifdef USE_MAP
  if (uMaskOn > 0.5) { vec3 mk = texture2D(uMask, vMapUv).rgb; float s = mk.r + mk.g + mk.b; msk = clamp(s, 0.0, 1.0); zc = s > 0.01 ? (uJersey * mk.r + uPants * mk.g + uSock * mk.b) / s : zc; }
#endif
  vec3 tinted = min(zc * (lum / 0.82), vec3(1.0));
  diffuseColor.rgb = mix(c0, tinted, msk);
  // 등번호(뒤)·워드마크(앞): 가슴 높이 평면 투영. 데칼 텍스처 왼쪽 절반 = 앞, 오른쪽 = 등
  if (uDecalP.w > 0.5 && msk > 0.3 && h > uDecalP.x && h < uDecalP.y && abs(vRP.x) < uDecalP.z) {
    float u = (vRP.x / uDecalP.z + 1.0) * 0.5, v = (h - uDecalP.x) / (uDecalP.y - uDecalP.x);
    vec2 duv = vRN.z >= 0.0 ? vec2(u * 0.5, v) : vec2(0.5 + (1.0 - u) * 0.5, v);
    vec4 d = texture2D(uDecal, duv);
    diffuseColor.rgb = mix(diffuseColor.rgb, d.rgb, d.a * smoothstep(0.2, 0.45, abs(vRN.z)));
  }
}`);
  };
  return m;
}
// 먼 거리용: 같은 유니폼 셰이더(uniform 공유)에서 노멀맵·거칠기/금속 맵만 뺀 복제
function lightMaterial(m) {
  const U = m.userData.uni;
  const src = m.clone();
  src.normalMap = null; src.roughnessMap = null; src.metalnessMap = null; src.roughness = 0.85; src.metalness = 0;
  const lm = bodyMaterial(src, U.uRest.value, U);
  lm.side = THREE.FrontSide;
  lm.customProgramCacheKey = () => 'hrChar1lo' + (U.uMaskOn.value ? 'm' : '');
  return lm;
}
function uniforms(restMatrix, lib) {
  const T = BODY.tint, H = BODY.height;
  return {
    uRest: { value: restMatrix.clone() }, uRestInv: { value: restMatrix.clone().invert() },
    uHatC: { value: lib.headE ? new THREE.Vector4(lib.headE.c.x, lib.headE.c.y, lib.headE.c.z, 1) : new THREE.Vector4(0, 9, 0, 0) },
    uHatR: { value: lib.headE ? lib.headE.r.clone().multiplyScalar(BODY.hatSquash) : new THREE.Vector3(1, 1, 1) },
    uJersey: { value: new THREE.Color('#f4f2ec') }, uPants: { value: new THREE.Color('#f4f2ec') }, uSock: { value: new THREE.Color('#14254a') },
    uTintP: { value: new THREE.Vector4(T.satMax, T.lumMin, T.neck * H, T.belt * H) }, uSockH: { value: T.sock * H }, uTintOn: { value: 1 },
    uMask: { value: lib.maskTex || null }, uMaskOn: { value: lib.maskTex ? 1 : 0 },
    uDecal: { value: null }, uDecalP: { value: new THREE.Vector4(BODY.decal.y0 * H, BODY.decal.y1 * H, BODY.decal.halfW * H, 0) },
  };
}

// 장비 머티리얼(모자·헬멧 팀 색): 'all' = 밝기만 남기고 전부 팀 색 / 'white' = 흰·회색 부분만
const accMatCache = new Map();
export function tintedMaterial(src, color, mode = 'all') {
  const key = src.uuid + color + mode;
  if (accMatCache.has(key)) return accMatCache.get(key);
  const m = src.clone();
  const U = { uTint: { value: new THREE.Color(color) } };
  m.customProgramCacheKey = () => 'hrAcc' + mode;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uTint;')
      .replace('#include <map_fragment>', `#include <map_fragment>
{ vec3 c0 = diffuseColor.rgb; float lum = dot(c0, vec3(0.299, 0.587, 0.114));
  float mx = max(c0.r, max(c0.g, c0.b)), mn = min(c0.r, min(c0.g, c0.b)); float sat = mx > 1e-3 ? (mx - mn) / mx : 0.0;
  float k = ${mode === 'white' ? '(1.0 - smoothstep(0.1, 0.18, sat)) * smoothstep(0.15, 0.25, lum)' : '1.0'};
  diffuseColor.rgb = mix(c0, min(uTint * (0.35 + lum * 1.1), vec3(1.0)), k); }`);
  };
  accMatCache.set(key, m);
  return m;
}

// ── IK·시선 보조 ──
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _t = new THREE.Vector3();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _ax0 = new THREE.Vector3(), _ax1 = new THREE.Vector3();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _qOa = new THREE.Quaternion(), _qOb = new THREE.Quaternion(), _m4 = new THREE.Matrix4();
const ang = (u, v) => Math.acos(clamp(u.dot(v) / Math.max(1e-9, u.length() * v.length()), -1, 1));

// 2관절 해석 IK(위팔·아래팔): 월드 목표점으로 손을 보냄. 팔꿈치 방향은 지금(클립) 자세의 굽힘 평면을 유지.
export function twoBoneIK(upper, lower, end, target, w = 1) {
  if (w <= 0) return;
  upper.getWorldPosition(_a); lower.getWorldPosition(_b); end.getWorldPosition(_c);
  const lab = _a.distanceTo(_b), lcb = _b.distanceTo(_c);
  const lat = clamp(_t.subVectors(target, _a).length(), 0.01, (lab + lcb) * 0.999);
  const ac = _v1.subVectors(_c, _a), ab = _v2.subVectors(_b, _a);
  const ac_ab0 = ang(ac, ab);
  const ba_bc0 = ang(_ax1.subVectors(_a, _b), _ax0.subVectors(_c, _b));
  const ac_ab1 = Math.acos(clamp((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat), -1, 1));
  const ba_bc1 = Math.acos(clamp((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb), -1, 1));
  _ax0.crossVectors(ac, ab);
  if (_ax0.lengthSq() < 1e-10) _ax0.set(0, 0, 1).applyQuaternion(upper.getWorldQuaternion(_q1));
  _ax0.normalize();
  upper.getWorldQuaternion(_qa); lower.getWorldQuaternion(_qb);
  _qOa.copy(upper.quaternion); _qOb.copy(lower.quaternion);
  // 1) 굽힘: 위팔·아래팔을 굽힘 평면 축으로 돌려 어깨-손 거리를 목표 거리로
  _q1.setFromAxisAngle(_v1.copy(_ax0).applyQuaternion(_q3.copy(_qa).invert()), ac_ab1 - ac_ab0);
  upper.quaternion.multiply(_q1);
  _q1.setFromAxisAngle(_v1.copy(_ax0).applyQuaternion(_q3.copy(_qb).invert()), ba_bc1 - ba_bc0);
  lower.quaternion.multiply(_q1);
  upper.updateMatrixWorld(true);
  // 2) 조준: 어깨→손 방향을 어깨→목표 방향으로 (월드 회전을 위팔에)
  end.getWorldPosition(_c);
  _v1.subVectors(_c, _a).normalize(); _v2.subVectors(target, _a).normalize();
  _q1.setFromUnitVectors(_v1, _v2);
  upper.getWorldQuaternion(_qa); if (upper.parent) upper.parent.getWorldQuaternion(_qb); else _qb.identity();
  upper.quaternion.copy(_q3.copy(_qb).invert().multiply(_q1).multiply(_qa));
  if (w < 1) { upper.quaternion.slerpQuaternions(_qOa, upper.quaternion, w); lower.quaternion.slerpQuaternions(_qOb, lower.quaternion, w); }
  upper.updateMatrixWorld(true);
}

// ── 발밑 접지 그림자(아주 싼 원형 그림자) — 실시간 그림자가 없거나(먼 선수·'낮음') 약할 때 '붕 뜬' 느낌을 없앰 ──
let BLOB = null;
function blobAssets() {
  if (BLOB) return BLOB;
  let tex = null;
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.9)'); gr.addColorStop(0.45, 'rgba(0,0,0,0.62)'); gr.addColorStop(0.75, 'rgba(0,0,0,0.22)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    tex = new THREE.CanvasTexture(c);
  }
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: tex ? 0xffffff : 0x000000, transparent: true, opacity: 0.62, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: true });
  // main.js 가 타자 메시를 돌며 material.transparent = false 로 덮어씀(공용 재질이라 전원 사각형 그림자가 됨) → 항상 투명으로 고정
  Object.defineProperty(mat, 'transparent', { get: () => true, set: () => {}, configurable: true });
  const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
  BLOB = { geo, mat }; return BLOB;
}

// ── 캐릭터 ──
const POST = ['LeftArm', 'LeftForeArm', 'RightArm', 'RightForeArm', 'Neck', 'Head']; // IK/시선이 건드리는 뼈(리플레이에 같이 기록)

export class Character {
  constructor(lib, { colors = null, num = '', name = '', scale = 1 } = {}) {
    this.lib = lib;
    this.root = new THREE.Group(); this.root.name = 'char';
    this.body = new THREE.Group(); this.root.add(this.body);
    this.facing = new THREE.Group(); this.body.add(this.facing);
    this.model = SkeletonUtils.clone(lib.tpl);
    this.facing.add(this.model);
    this.root.scale.setScalar(scale);
    this.bones = {};
    this.meshes = [];
    this.model.traverse((o) => { if (o.isBone) this.bones[o.name] = o; if (o.isSkinnedMesh) this.meshes.push(o); });
    // 머티리얼(선수마다 유니폼 색이 달라서 복제, 셰이더 프로그램은 공유)
    this.mats = [];
    this.meshes.forEach((mesh, i) => {
      const info = lib.meshInfo[i] || lib.meshInfo[0];
      const U = uniforms(info.rest, lib);
      const src = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      mesh.material = bodyMaterial(src, info.rest, U);
      mesh.material.side = THREE.FrontSide; // Tripo 원본이 양면(doubleSided) → 뒷면까지 그리던 것 제거(조각 셰이더·그림자 부담 절반)
      this.mats.push(mesh.material);
      mesh.castShadow = true; mesh.receiveShadow = false;
      // 고정 경계구(애니메이션으로 팔다리가 뻗어도 잘리지 않게 넉넉히) → 일반 절두체 컬링 그대로 사용
      mesh.boundingSphere = info.sphere.clone();
    });
    // 저폴리(먼 거리): 같은 정점 버퍼 + 줄인 인덱스, 같은 뼈대
    this.hi = this.meshes[0] || null; this.lo = null;
    if (this.hi && lib.loGeo) {
      // 먼 선수: 저폴리 + 가벼운 재질(노멀·거칠기 맵 없음, 유니폼 색 uniform 은 공유) + 그림자 없음
      const loMat = lightMaterial(this.hi.material);
      this.mats.push(loMat);
      const lo = new THREE.SkinnedMesh(lib.loGeo, loMat);
      lo.name = 'bodyLo'; lo.position.copy(this.hi.position); lo.quaternion.copy(this.hi.quaternion); lo.scale.copy(this.hi.scale);
      lo.castShadow = false; lo.visible = false; lo.boundingSphere = this.hi.boundingSphere.clone();
      this.hi.parent.add(lo); lo.bind(this.hi.skeleton, this.hi.bindMatrix);
      this.lo = lo;
    }
    // 접지 그림자: root(땅 높이)에 붙이고 매 갱신 때 엉덩이 바로 아래로
    const B = blobAssets();
    this.blob = new THREE.Mesh(B.geo, B.mat); this.blob.name = 'blob'; this.blob.position.y = 0.012; this.blob.scale.set(0.95, 1, 0.95);
    this.blob.renderOrder = 1; this.blob.castShadow = false; this.blob.receiveShadow = false;
    this.root.add(this.blob);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.layers = new Map(); // clipName → { e(클립 항목), action, w, target, rate, scrub }
    this.acc = 0; this.phase = (Math.random() * 64) | 0; this.ran = false;
    this.ikReq = { L: null, R: null }; this.ikW = { L: 0, R: 0 }; this.ikT = { L: new THREE.Vector3(), R: new THREE.Vector3() };
    this.lookReq = null; this.lookW = 0; this.lookT = new THREE.Vector3();
    this.post = POST.map((n) => this.bones[n] || null);
    this.yaw = 0;
    if (colors) this.setUniform(colors, num, name);
    this.play('idle', { fade: 0 });
  }

  has(name) { return this.lib.clips.has(name); }
  // 없는 클립은 fallback 사슬을 따라감(게임이 깨지지 않게)
  resolve(name) {
    for (let i = 0, n = name; i < 6 && n; i++) { const e = this.lib.clips.get(n); if (e) return e; n = CLIPS[n] && CLIPS[n].fallback; }
    return this.lib.clips.get('idle') || null;
  }
  current() { let best = null, bw = -1; for (const L of this.layers.values()) if (L.target > bw) { bw = L.target; best = L; } return best; }

  // 클립 재생(크로스페이드). 같은 클립을 다시 부르면 속도만 바뀜(restart: true 면 처음부터)
  duration(name) { const e = this.resolve(name); return e ? e.clip.duration : 0; }
  play(name, { fade = 0.2, speed = 1, loop, restart = false, sync = false } = {}) {
    const e = this.resolve(name); if (!e) return null;
    const cur = this.current();
    let L = this.layers.get(e.name);
    const isNew = !L || L.target < 1;
    if (!L) { L = { e, action: this.mixer.clipAction(e.clip), w: 0, target: 0, rate: 0, scrub: -1 }; this.layers.set(e.name, L); }
    const a = L.action;
    const lp = loop ?? e.cfg.loop;
    if (isNew || restart || L.scrub >= 0) {
      a.setLoop(lp ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = !lp;
      if (L.w <= 0.001 || restart) { a.reset(); if (sync && cur && cur !== L && cur.e.cfg.loop && lp) a.time = (cur.action.time / cur.e.clip.duration) * e.clip.duration; }
      a.enabled = true; a.play();
      L.scrub = -1;
      this._fadeTo(L, fade);
    }
    a.timeScale = speed;
    return a;
  }
  // 진행도로 긁기: 시간(초)을 직접 지정. timeScale 0 → 게임이 준 시각 그대로
  scrub(name, time, { fade = 0.12 } = {}) {
    const e = this.resolve(name); if (!e) return null;
    let L = this.layers.get(e.name);
    if (!L) { L = { e, action: this.mixer.clipAction(e.clip), w: 0, target: 0, rate: 0, scrub: -1 }; this.layers.set(e.name, L); }
    const a = L.action;
    if (L.target < 1 || L.scrub < 0) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.reset(); a.enabled = true; a.play(); this._fadeTo(L, fade); }
    a.timeScale = 0; a.paused = false;
    L.scrub = clamp(time, 0, e.clip.duration - 1e-4);
    a.time = L.scrub;
    return a;
  }
  // 진행도 k(클립 kmap 기준) — kmap 없는 클립(대체 클립 등)은 그냥 반복 재생
  scrubK(name, k, opts) {
    const e = this.resolve(name); if (!e) return null;
    if (!e.cfg.kmap) return e.cfg.loop ? this.play(e.name, opts) : this.scrub(e.name, clamp(k, 0, 1) * e.clip.duration, opts);
    return this.scrub(e.name, kClipTime(k, e.cfg.kmap, e.markers), opts);
  }
  // 투구: 와인드업 시작부터 tau 초(timing.js 시간표 ↔ 클립 마커)
  scrubPitch(tau, opts) {
    const e = this.resolve('pitch'); if (!e) return null;
    if (e.name !== 'pitch') return this.scrubK(e.name, clamp(tau / (PITCH_TL.release / 0.55), 0, 1.2), opts);
    return this.scrub('pitch', pitchClipTime(tau, e.markers), opts);
  }
  _fadeTo(L, fade) {
    for (const o of this.layers.values()) {
      const tgt = o === L ? 1 : 0;
      if (fade <= 0) { o.w = tgt; o.target = tgt; o.rate = 0; continue; }
      o.target = tgt; o.rate = 1 / fade;
    }
  }

  // 팔 IK/시선 요청(이번 프레임만). update 에서 클립 위에 덧입힘
  reach(side, worldPos, w = 1) { if (!worldPos) return; this.ikReq[side] = w; this.ikT[side].copy(worldPos); }
  look(worldPos, w = 1) { if (!worldPos) return; this.lookReq = w; this.lookT.copy(worldPos); }

  update(dt) {
    // 페이드
    let sum = 0;
    for (const [k, L] of this.layers) {
      if (L.w !== L.target) { const s = L.rate > 0 ? dt * L.rate : 1; L.w = L.target > L.w ? Math.min(L.target, L.w + s) : Math.max(L.target, L.w - s); }
      if (L.w <= 0 && L.target <= 0) { L.action.stop(); L.action.enabled = false; this.layers.delete(k); continue; }
      sum += L.w;
    }
    let yaw = 0;
    for (const L of this.layers.values()) { const w = sum > 0 ? L.w / sum : 0; L.action.setEffectiveWeight(w); yaw += w * (L.e.cfg.yaw || 0) * DEG; if (L.scrub >= 0) L.action.time = L.scrub; }
    if (Math.abs(yaw - this.yaw) > 1e-4) { this.yaw = yaw; this.facing.rotation.y = yaw; }
    // 컬링·LOD: 화면 밖은 hiddenUpdate 프레임마다, 멀면 farUpdate 프레임마다 (시간은 모아서 한 번에)
    this.acc += dt;
    let every = 1;
    if (FR.has) {
      const r = this.root;
      _sph.center.setFromMatrixPosition(r.matrixWorld); _sph.center.y += 1; _sph.radius = 2.2 * r.scale.x;
      const inView = FR.frustum.intersectsSphere(_sph);
      const far = _sph.center.distanceToSquared(FR.cam) > BODY.lodDist * BODY.lodDist;
      if (this.lo) { this.lo.visible = far; this.hi.visible = !far; }
      every = !inView ? BODY.hiddenUpdate : far ? BODY.farUpdate : 1;
    }
    // [net] 'N 프레임마다'는 fps 가 30 근처로 떨어지면(맥북 에어) 먼 선수 동작이 15Hz·화면 밖이 5Hz 로 뚝뚝 끊겼음 →
    //       fps 에 맞춰 N 을 줄임(60fps 에선 전과 같음, 30fps 면 먼 선수 매 프레임·화면 밖 3프레임마다 = 둘 다 같은 초당 횟수)
    if (every > 1 && FR.fk < 1) every = Math.max(1, Math.round(every * FR.fk));
    const run = every <= 1 || ((FR.n + this.phase) % every) === 0 || !this.ran;
    if (run) {
      this.mixer.update(this.acc); this.acc = 0; this.ran = true;
      this._post(dt * every);
      this._blob();
    }
    this.ikReq.L = this.ikReq.R = null; this.lookReq = null;
    return run;
  }
  _post(dt) {
    const k = 1 - Math.exp(-14 * dt);
    let any = false;
    for (const s of ['L', 'R']) { const tw = this.ikReq[s] ?? 0; this.ikW[s] += (tw - this.ikW[s]) * k; if (this.ikW[s] > 0.01) any = true; }
    this.lookW += ((this.lookReq ?? 0) - this.lookW) * (1 - Math.exp(-8 * dt));
    if (this.lookW > 0.01) any = true;
    if (!any) return;
    // [net] root.updateMatrixWorld(true)(뼈 53개+장비 전체)를 지움 — twoBoneIK·_look 의 getWorldPosition/Quaternion 이 필요한 부모 사슬만 갱신함 (qa 요청: 심판 look 이 상시라 매 프레임 전체 갱신이었음)
    const B = this.bones;
    for (const [s, n] of [['L', 'Left'], ['R', 'Right']]) {
      const w = this.ikW[s]; if (w <= 0.01) continue;
      const u = B[n + 'Arm'], l = B[n + 'ForeArm'], h = B[n + 'Hand'];
      if (u && l && h) twoBoneIK(u, l, h, this.ikT[s], w);
    }
    if (this.lookW > 0.01 && B.Head) this._look(B.Head, this.lookT, this.lookW);
  }
  _blob() {
    const h = this.bones.Hips; if (!h || !this.blob) return;
    // [qa] root.updateMatrixWorld(true) 를 지움 — 선수마다 매 프레임 뼈 53개+장비 전체 행렬 갱신(렌더가 또 함) → 프레임 JS 시간 최대 원인.
    //      getWorldPosition 이 Hips 위쪽 부모 사슬만 갱신하므로 결과는 같음
    // [model] 발 두 개를 덮는 타원(발 사이 가운데, 발 방향으로 길게) — 전엔 엉덩이 밑 원(지름 0.95m, 가운데 34%)이라 흐려서 신발 밑이 비어 보였음('떠 보임')
    const s = this.root.scale.x || 1;
    h.getWorldPosition(_t); this.root.worldToLocal(_t);
    const hy = _t.y * s; // 엉덩이 높이(m): 서 있으면 ~1, 점프하면 높고, 다이빙·슬라이딩이면 낮음
    const fl = this.bones.LeftFoot, fr = this.bones.RightFoot, B = this.blob;
    if (hy < 0.5 || !fl || !fr) { // 누운 자세(다이빙·슬라이딩): 몸통 밑 큰 타원
      B.position.set(_t.x, B.position.y, _t.z); B.rotation.y = 0; B.scale.set(1.3, 1, 1.7); B.visible = true; return;
    }
    fl.getWorldPosition(_a); this.root.worldToLocal(_a); fr.getWorldPosition(_b); this.root.worldToLocal(_b);
    const dx = _b.x - _a.x, dz = _b.z - _a.z, d = Math.hypot(dx, dz);
    const lift = Math.max(0, Math.min(_a.y, _b.y) * s - 0.1); // 두 발 다 뜨면(점프) 작아짐
    const k = clamp(1 - lift * 1.6, 0.35, 1);
    B.position.set((_a.x + _b.x) / 2, B.position.y, (_a.z + _b.z) / 2);
    B.rotation.y = d > 1e-3 ? Math.atan2(dx, dz) : 0; // 로컬 z 축을 발→발 방향으로
    B.scale.set(0.5 * k, 1, (d + 0.5) * k);
    B.visible = true;
  }
  // 머리가 목표를 보게(최대 65°). 얼굴 앞 방향(머리 뼈 로컬)은 T포즈에서 미리 계산(lib.faceLocal)
  _look(head, target, w) {
    head.getWorldQuaternion(_qa); head.getWorldPosition(_a);
    const face = _v1.copy(this.lib.faceLocal).applyQuaternion(_qa).normalize();
    const want = _v2.subVectors(target, _a); if (want.lengthSq() < 1e-6) return; want.normalize();
    const a = ang(face, want), lim = 65 * DEG;
    if (a > lim) want.lerpVectors(face, want, lim / a).normalize();
    _q1.setFromUnitVectors(face, want);
    _q2.identity().slerp(_q1, w);
    // 월드 회전 → 로컬: local' = inv(parentWorld) * q * world
    if (head.parent) head.parent.getWorldQuaternion(_qb); else _qb.identity();
    _q3.copy(_qb).invert().multiply(_q2).multiply(_qa);
    head.quaternion.copy(_q3);
    head.updateMatrixWorld(true);
  }

  // 장비 붙이기. obj.userData.rest(16개 숫자 = T포즈 캐릭터 공간 행렬)가 있으면 그 자리에 정확히 붙임
  attach(slot, obj) {
    const bn = SLOT_BONE[slot] || slot, bone = this.bones[bn];
    if (!bone || !obj) return null;
    const rest = obj.userData && obj.userData.rest;
    bone.add(obj);
    if (rest) {
      const boneRest = this.lib.rest.get(bn);
      _m4.fromArray(rest);
      if (boneRest) _m4.premultiply(_pm.copy(boneRest).invert());
      _m4.decompose(obj.position, obj.quaternion, obj.scale);
    }
    return obj;
  }

  // 유니폼 색. colors: { jersey, pants, sock, (num, accent, word, …: 데칼용) }
  setUniform(colors, num = this._num, name = this._name) {
    this._num = num; this._name = name;
    const done = new Set(); // 저폴리 재질은 같은 uniform 을 공유 → 데칼 텍스처를 두 번 만들지 않게
    for (const m of this.mats) {
      const U = m.userData.uni;
      if (done.has(U)) continue; done.add(U);
      if (colors.jersey) U.uJersey.value.set(colors.jersey);
      if (colors.pants) U.uPants.value.set(colors.pants);
      if (colors.sock) U.uSock.value.set(colors.sock);
      if (this.lib.decal && (num !== '' && num != null || colors.word)) { const t = this.lib.decal(colors, num, name); if (t) { U.uDecal.value = t; U.uDecalP.value.w = 1; } }
      else U.uDecalP.value.w = 0;
    }
  }

  // 리플레이: 지금 재생 상태(클립·시각·가중치) + IK 뼈 회전 → 숫자 배열
  snapshot(out) { // [qa] out: 재사용 버퍼(리플레이 링버퍼가 넘김) — 전엔 매 프레임 선수마다 배열 2개 할당 → GC 멈춤
    const need = 1 + this.layers.size * 3 + this.post.length * 4;
    const a = out && out.length >= need ? out : new Float32Array(need + 6);
    let o = 0, sum = 0; a[o++] = this.layers.size;
    for (const L of this.layers.values()) sum += L.w;
    for (const L of this.layers.values()) { a[o++] = L.e.index; a[o++] = L.action.time; a[o++] = sum > 0 ? L.w / sum : 0; }
    for (const b of this.post) { if (b) { a[o++] = b.quaternion.x; a[o++] = b.quaternion.y; a[o++] = b.quaternion.z; a[o++] = b.quaternion.w; } else { a[o++] = 0; a[o++] = 0; a[o++] = 0; a[o++] = 1; } }
    return a;
  }
  restore(A, B, u = 0) {
    const list = this.lib.clipList, st = new Map();
    const read = (S, f) => { const n = S[0]; for (let i = 0; i < n; i++) f(S[1 + i * 3] | 0, S[2 + i * 3], S[3 + i * 3]); return 1 + n * 3; };
    const offA = read(A, (ci, t, w) => st.set(ci, { t, w: w * (1 - u), ta: t }));
    const offB = B ? read(B, (ci, t, w) => { const s = st.get(ci); if (s) { s.w += w * u; if (t >= s.ta && t - s.ta < 0.5) s.t = s.ta + (t - s.ta) * u; } else st.set(ci, { t, w: w * u }); }) : 0;
    for (const L of this.layers.values()) { L.action.stop(); L.action.enabled = false; }
    this.layers.clear();
    for (const [ci, s] of st) {
      const e = list[ci]; if (!e || s.w <= 1e-4) continue;
      const a = this.mixer.clipAction(e.clip);
      a.enabled = true; a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.play(); a.timeScale = 0; a.time = Math.min(s.t, e.clip.duration - 1e-4);
      a.setEffectiveWeight(s.w);
      this.layers.set(e.name, { e, action: a, w: s.w, target: s.w, rate: 0, scrub: a.time });
    }
    this.mixer.update(0);
    for (let i = 0; i < this.post.length; i++) {
      const b = this.post[i]; if (!b) continue;
      const o = offA + i * 4; _q1.set(A[o], A[o + 1], A[o + 2], A[o + 3]);
      if (B) { const p = offB + i * 4; _q2.set(B[p], B[p + 1], B[p + 2], B[p + 3]); _q1.slerp(_q2, u); }
      b.quaternion.copy(_q1);
    }
    this.ran = true; this.acc = 0;
  }

  dispose() {
    this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.model);
    for (const m of this.mats) m.dispose();
  }

  // 렌더 직전 한 번(skinned.js syncAllSkins 에서 부름): 다음 프레임 컬링·LOD 판단용
  static frame(camera) {
    FR.n++;
    { const t = performance.now(), d = FR.t0 ? Math.min(0.1, (t - FR.t0) / 1000) : 1 / 60; FR.t0 = t; FR.dtE = (FR.dtE || 1 / 60) + (d - (FR.dtE || 1 / 60)) * 0.05; FR.fk = Math.min(1, (1 / 60) / FR.dtE); } // [net] 프레임 시간 평균 → 갱신 간격 배율
    if (!camera) { FR.has = false; return; }
    camera.updateMatrixWorld();
    _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    FR.frustum.setFromProjectionMatrix(_pm);
    camera.getWorldPosition(FR.cam);
    FR.has = true;
  }
}
