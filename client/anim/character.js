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
      // [model 11-19] 몸 색이 정점 색(COLOR_0)이라 팀 색 입히기는 정점 색이 곱해진 뒤(color_fragment)에
      .replace('#include <color_fragment>', `#include <color_fragment>
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
const _gp = new THREE.Vector3();
// [motion] 몸 연동용 임시값
const m_UP = new THREE.Vector3(0, 1, 0), m_Y = new THREE.Vector3(0, 1, 0);
const m_qa = new THREE.Quaternion(), m_qb = new THREE.Quaternion(), m_qd = new THREE.Quaternion(), m_q0w = new THREE.Quaternion();
const m_d = new THREE.Vector3(), m_d0 = new THREE.Vector3(), m_ax = new THREE.Vector3(), m_p0 = new THREE.Vector3(), m_p1 = new THREE.Vector3(), m_cur = new THREE.Vector3(), m_tgt = new THREE.Vector3();
// 뼈를 월드 축 기준으로 돌림 (부모 기준으로 바꿔서 로컬 회전 앞에 곱함)
function rotWorld(bone, axisW, ang) { bone.parent.updateWorldMatrix(true, false); bone.parent.getWorldQuaternion(m_qa); m_ax.copy(axisW).applyQuaternion(m_qa.invert()).normalize(); bone.quaternion.premultiply(m_qb.setFromAxisAngle(m_ax, ang)); bone.updateWorldMatrix(false, false); }
// 뼈 → 끝점(tip) 방향을 월드 방향 dir 로 맞춤 (w: 섞는 정도)
function aimBone(bone, tip, dir, w = 1, maxA = Math.PI) { // [fix] maxA: 클립 자세에서 최대 이만큼만 돌림(인식이 튀어도 관절이 기괴하게 안 꺾임)
  if (!bone || !tip || w <= 0.01) return;
  tip.updateWorldMatrix(true, false); bone.getWorldPosition(m_p0); tip.getWorldPosition(m_p1); // [perf] 부모 사슬만
  m_cur.subVectors(m_p1, m_p0); if (m_cur.lengthSq() < 1e-8 || dir.lengthSq() < 1e-8) return;
  m_cur.normalize(); m_tgt.copy(dir).normalize();
  m_qd.setFromUnitVectors(m_cur, m_tgt); { const a = Math.acos(Math.max(-1, Math.min(1, m_cur.dot(m_tgt)))); if (a > maxA) w *= maxA / a; } if (w < 1) m_qd.slerp(m_qb.identity(), 1 - w);
  bone.parent.getWorldQuaternion(m_qa); bone.getWorldQuaternion(m_q0w);
  m_q0w.premultiply(m_qd); bone.quaternion.copy(m_qa.invert().multiply(m_q0w)); bone.updateWorldMatrix(false, false);
}
// MediaPipe 관절 → 월드 방향: 카메라 = 투수 쪽(+z), 위 = +y, 사람 왼쪽 = 이미지 오른쪽(+x)
const _P = Array.from({ length: 33 }, () => new THREE.Vector3());
const mpv = (out, l, mir) => out.set(mir ? -l[0] : l[0], -l[1], -l[2]);
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
  constructor(lib, { colors = null, num = '', name = '', scale = 1, seed = Math.random() * 1e4 } = {}) {
    this.lib = lib;
    // [motion] 선수별 난수(반복 클립 시작 위치를 흩뜨려 18명이 같은 박자로 숨쉬지 않게)
    let rs = (Math.floor(seed * 7919) ^ 0x9e3779b9) >>> 0 || 1;
    this.rng = () => { rs ^= rs << 13; rs >>>= 0; rs ^= rs >>> 17; rs ^= rs << 5; rs >>>= 0; return rs / 4294967296; };
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
    // [smooth] 관성 블렌딩(inertialization): 동작이 바뀌는 순간 '직전에 화면에 보이던 자세'에서 새 동작으로 뼈마다 부드럽게 넘어감
    //  · 크로스페이드가 짧거나(0) 진행도가 튀어도(네트워크 보정·반복 진행도) 자세가 순간이동하지 않음
    //  · 감쇠 (1-x)^3: 새 동작이 바로 움직이기 시작하고, 끝은 속도 0으로 붙음
    this.bl = [];
    this.model.traverse((o) => { if (o.isBone) this.bl.push(o); });
    this.ibLast = this.bl.map(() => new THREE.Quaternion()); this.ibOff = this.bl.map(() => new THREE.Quaternion());
    this.ibHips = this.bones.Hips || null; this.ibHipsI = this.ibHips ? this.bl.indexOf(this.ibHips) : -1;
    this.ibLastP = new THREE.Vector3(); this.ibOffP = new THREE.Vector3(); this.ibPOn = false;
    this.ibT = 1; this.ibDur = 0.2; this.ibReq = 0; this.ibHave = false; this.ibN = -1e9; this.ibYawLast = 0; this.ibYawOff = 0;
    if (colors) this.setUniform(colors, num, name);
    this.play('idle', { fade: 0, from: 0 });
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
  // [motion] from: 처음 시작할 때 이 클립 시각(초)부터 / 반복 클립을 새로 틀면 시작 위치를 선수마다 무작위로(sync·from 이 없을 때)
  play(name, { fade = 0.2, speed = 1, loop, restart = false, sync = false, from = null } = {}) {
    const e = this.resolve(name); if (!e) return null;
    const cur = this.current();
    let L = this.layers.get(e.name);
    const isNew = !L || L.target < 1;
    if (!L) { L = { e, action: this.mixer.clipAction(e.clip), w: 0, target: 0, rate: 0, scrub: -1 }; this.layers.set(e.name, L); }
    const a = L.action;
    const lp = loop ?? e.cfg.loop;
    if (isNew || restart || L.scrub >= 0) {
      fade = this._outFade(cur, L, fade);
      this.blend(Math.max(0.16, Math.min(0.32, fade + 0.06)));
      a.setLoop(lp ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = !lp;
      if (L.w <= 0.001 || restart) {
        a.reset();
        if (sync && cur && cur !== L && cur.e.cfg.loop && lp) a.time = (cur.action.time / cur.e.clip.duration) * e.clip.duration;
        else if (from != null) a.time = clamp(from, 0, e.clip.duration - 1e-3);
        else if (lp && !sync) a.time = this.rng() * e.clip.duration;
      }
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
    const nt = clamp(time, 0, e.clip.duration - 1e-4);
    if (L.target < 1 || L.scrub < 0) { fade = this._outFade(this.current(), L, fade); this.blend(Math.max(0.16, Math.min(0.32, fade + 0.06))); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.reset(); a.enabled = true; a.play(); this._fadeTo(L, fade); }
    else if (nt < L.scrub - 0.04 || nt > L.scrub + 0.4) this.blend(0.22); // [smooth] 진행도가 튀면(뒤로 감기·크게 건너뜀) 자세를 이어 붙임
    a.timeScale = 0; a.paused = false;
    L.scrub = nt;
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
  // [motion] name: 투구 변주(pitch·pitch2) — 어떤 클립이든 같은 시간표(릴리스 = 와인드업 + 1.85초)로 구간마다 늘이고 줄임
  scrubPitch(tau, opts, name = 'pitch') {
    const e = this.resolve(name); if (!e) return null;
    if (!(e.cfg.kind === 'pitch' || e.name === 'pitch')) return this.scrubK(e.name, clamp(tau / (PITCH_TL.release / 0.55), 0, 1.2), opts);
    return this.scrub(e.name, pitchClipTime(tau, e.markers), opts);
  }
  // [motion] 지금 재생 중인 클립 시각(초) — 없으면 -1 (한 번 재생 클립이 끝났는지 볼 때)
  clipTime(name) { const e = this.resolve(name); const L = e && this.layers.get(e.name); return L && L.target > 0 ? L.action.time : -1; }
  // [smooth] 지금 자세에서 dur 초 동안 새 동작으로 이어 붙이기(다음 갱신 때 적용)
  blend(dur = 0.2) { this.ibReq = Math.max(this.ibReq, dur); }
  // [smooth] 누운 자세(다이빙·슬라이딩)·큰 동작(세리머니·삼진 반응)에서 빠져나올 땐 페이드를 길게 — 갑자기 벌떡 서지 않게
  _outFade(cur, L, fade) { if (!cur || cur === L) return fade; const of = cur.e.cfg.outFade || 0; return of > fade && cur.w > 0.5 ? of : fade; }
  // [smooth] 다른 캐릭터의 지금 자세를 '직전 자세'로 가져와 거기서부터 이어서(타자 → 주자로 바뀌는 순간 등). 루트 방향 차이는 엉덩이 회전에 보정
  adoptPose(o, dur = 0.35) {
    if (!o || !o.bl || o.bl.length !== this.bl.length) return;
    for (let i = 0; i < this.bl.length; i++) this.ibLast[i].copy(o.bl[i].quaternion);
    this.root.updateWorldMatrix(true, false); o.root.updateWorldMatrix(true, false);
    const ya = new THREE.Euler().setFromQuaternion(o.root.getWorldQuaternion(_q1), 'YXZ').y + o.yaw;
    const yb = new THREE.Euler().setFromQuaternion(this.root.getWorldQuaternion(_q2), 'YXZ').y;
    this.ibYawLast = ya - yb; // facing 보정으로 처리(엉덩이 회전 대신)
    if (this.ibHips && o.ibHips) { o.ibHips.getWorldPosition(_t); this.ibHips.parent.updateWorldMatrix(true, false); this.ibHips.parent.worldToLocal(this.ibLastP.copy(_t)); }
    this.ibHave = true; this.ibN = FR.n; this.ibReq = Math.max(this.ibReq, dur); this._adopt = true;
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
  // [model 11-23] 두 손 그립: 배트(bat, +y 축)를 쥔 손(top) 바로 아래(손잡이 쪽 gap m)로 다른 손(side)을 IK — 클립이 한 손만 배트에 붙어 있어 다른 손이 떠 있던 것
  // [motion] 핸드폰 배트 방향 → 상체 전체: 배트 방향 바뀐 만큼 척추를 비틀고, 손이 따라가고, 배트는 핸드폰 방향 그대로
  motionBody(bat, top, w = 1) { if (bat && w > 0.01) this.bodyReq = { bat, top, w }; }
  // [motion] 웹캠 전신: MediaPipe worldLandmarks(33개, m) → 몸통·팔·다리·머리 뼈 방향 맞춤
  motionPose(lm, w = 1, mir = false) { if (lm && lm.length >= 33 && w > 0.01) this.poseReq = { lm, w, mir }; }
  grip(bat, side, top, w = 1, gap = 0.085) { if (!bat || w <= 0.01) return; this.gripReq = { bat, side, top, w, gap }; }
  look(worldPos, w = 1) { if (!worldPos) return; this.lookReq = w; this.lookT.copy(worldPos); }

  update(dt) {
    // 페이드
    let sum = 0;
    for (const [k, L] of this.layers) {
      if (L.w !== L.target) { const s = L.rate > 0 ? dt * L.rate : 1; L.w = L.target > L.w ? Math.min(L.target, L.w + s) : Math.max(L.target, L.w - s); }
      if (L.w <= 0 && L.target <= 0) { L.action.stop(); L.action.enabled = false; this.layers.delete(k); continue; }
      sum += L.w;
    }
    let yaw = 0, es = 0;
    // [smooth] 크로스페이드 가중치를 smoothstep 으로 — 선형이면 시작·끝에서 속도가 툭 바뀜
    for (const L of this.layers.values()) { const x = sum > 0 ? L.w / sum : 0; L._ew = x * x * (3 - 2 * x); es += L._ew; }
    for (const L of this.layers.values()) { const w = es > 0 ? L._ew / es : 0; L.action.setEffectiveWeight(w); yaw += w * (L.e.cfg.yaw || 0) * DEG; if (L.scrub >= 0) L.action.time = L.scrub; }
    this.yaw = yaw;
    // 컬링·LOD: 화면 밖은 hiddenUpdate 프레임마다, 멀면 farUpdate 프레임마다 (시간은 모아서 한 번에)
    this.acc += dt;
    let every = 1;
    if (FR.has) {
      const r = this.root;
      _sph.center.setFromMatrixPosition(r.matrixWorld); _sph.center.y += 1; _sph.radius = 2.2 * r.scale.x;
      const inView = FR.frustum.intersectsSphere(_sph);
      const far = !window.__noLod && _sph.center.distanceToSquared(FR.cam) > BODY.lodDist * BODY.lodDist; // __noLod: qa 클로즈업
      if (this.lo) { this.lo.visible = far; this.hi.visible = !far; }
      // [smooth] 멀어도 움직이는(뛰는·걷는) 선수는 매 프레임 — 몸은 60Hz 로 이동하는데 동작만 30Hz 라 뚝뚝 끊겨 보였음(TV 시점 수비수 대부분이 22m 밖)
      const px = _sph.center.x, pz = _sph.center.z, moving = this._lpx !== undefined && (Math.abs(px - this._lpx) + Math.abs(pz - this._lpz)) > 0.004; this._lpx = px; this._lpz = pz;
      every = !inView ? BODY.hiddenUpdate : far && !moving ? BODY.farUpdate : 1;
    }
    // [net] 'N 프레임마다'는 fps 가 30 근처로 떨어지면(맥북 에어) 먼 선수 동작이 15Hz·화면 밖이 5Hz 로 뚝뚝 끊겼음 →
    //       fps 에 맞춰 N 을 줄임(60fps 에선 전과 같음, 30fps 면 먼 선수 매 프레임·화면 밖 3프레임마다 = 둘 다 같은 초당 횟수)
    if (every > 1 && FR.fk < 1) every = Math.max(1, Math.round(every * FR.fk));
    const run = every <= 1 || ((FR.n + this.phase) % every) === 0 || !this.ran;
    if (run) {
      const de = this.acc;
      this.mixer.update(this.acc); this.acc = 0; this.ran = true;
      this._inert(de, every);
      this._post(dt * every);
      this._blob();
    }
    this.ikReq.L = this.ikReq.R = null; this.lookReq = null;
    return run;
  }
  _inert(de, every) {
    // [fix] 관성 블렌딩은 끔(window.__ib = 1 로만 켬): 특정 전환에서 몸이 뒤집히고 꺾이는 버그(헛스윙·삼진 반응 등) — 크로스페이드(smoothstep)만으로 이어 붙임
    if (typeof window === 'undefined' || !window.__ib) { this.ibReq = 0; this.ibT = 1; if (Math.abs(this.yaw - this.facing.rotation.y) > 1e-5) this.facing.rotation.y = this.yaw; return; }
    const n = this.bl.length, H = this.ibHipsI;
    // 오래 안 그려졌으면(주자 재사용·화면 밖 오래) 이어 붙일 '직전 자세'가 없음
    if (!this._adopt && FR.n - this.ibN > every * 3 + 6) this.ibHave = false;
    this._adopt = false;
    let req = this.ibReq; this.ibReq = 0;
    // 자동 감지: 한 갱신 사이 엉덩이·척추가 너무 많이 돌거나 엉덩이가 튀면(순간이동) 이어 붙임
    if (!req && this.ibHave && de < 0.25) {
      const lim = 0.55 + de * 6;
      let jump = H >= 0 && this.bl[H].quaternion.angleTo(this.ibLast[H]) > lim;
      if (this.ibSpI === undefined) this.ibSpI = this.bones.Spine1 ? this.bl.indexOf(this.bones.Spine1) : -1;
      const si = this.ibSpI; if (!jump && si >= 0) jump = this.bl[si].quaternion.angleTo(this.ibLast[si]) > lim;
      if (!jump && this.ibHips) { const d = this.ibHips.position.distanceTo(this.ibLastP) * (this.ibHips.parent ? this.ibHips.parent.getWorldScale(_t).x : 1); jump = d > 0.2 + de * 4 && d < 3; }
      if (jump) req = 0.2;
    }
    if (req && this.ibHave) {
      for (let i = 0; i < n; i++) { const o = this.ibOff[i].copy(this.ibLast[i]).normalize().multiply(_q1.copy(this.bl[i].quaternion).normalize().invert()).normalize(); if (o.w < 0) o.set(-o.x, -o.y, -o.z, -o.w); } // 짧은 쪽으로
      if (this.ibHips) {
        this.ibOffP.subVectors(this.ibLastP, this.ibHips.position);
        const ws = this.ibHips.parent ? this.ibHips.parent.getWorldScale(_t).x : 1;
        this.ibPOn = this.ibOffP.length() * ws < 0.7; // 일부러 옮긴 것(1m 넘는 입장 위치 등)은 미끄러지게 하지 않음
      }
      let dy = this.ibYawLast - this.yaw; this.ibYawOff = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.ibT = 0; this.ibDur = req;
    } else if (this.ibT < 1) this.ibT = Math.min(1, this.ibT + de / this.ibDur);
    let fy = this.yaw;
    if (this.ibT < 1) {
      const x = this.ibT, w = (1 - x) * (1 - x) * (1 - x);
      for (let i = 0; i < n; i++) this.bl[i].quaternion.premultiply(_q2.identity().slerp(this.ibOff[i], w)).normalize();
      if (this.ibHips && this.ibPOn) this.ibHips.position.addScaledVector(this.ibOffP, w);
      fy += this.ibYawOff * w;
    }
    if (Math.abs(fy - this.facing.rotation.y) > 1e-5) this.facing.rotation.y = fy;
    // 이번에 보인 자세(IK 전) 기억
    for (let i = 0; i < n; i++) this.ibLast[i].copy(this.bl[i].quaternion);
    if (this.ibHips) this.ibLastP.copy(this.ibHips.position);
    this.ibYawLast = fy; this.ibHave = true; this.ibN = FR.n;
  }
  _post(dt) {
    const k = 1 - Math.exp(-14 * dt);
    let any = false;
    for (const s of ['L', 'R']) { const tw = this.ikReq[s] ?? 0; this.ikW[s] += (tw - this.ikW[s]) * k; if (this.ikW[s] > 0.01) any = true; }
    this.lookW += ((this.lookReq ?? 0) - this.lookW) * (1 - Math.exp(-8 * dt));
    if (this.lookW > 0.01) any = true;
    // [motion+] 웹캠 자세 가중치를 서서히: 인식이 켜지거나 끊길 때 선수 몸이 클립 자세 ↔ 내 자세로 '툭' 바뀌지 않게 (마지막 자세를 들고 0.3초에 걸쳐 놓음)
    { const PRq = this.poseReq; const tw = PRq ? PRq.w : 0;
      if (PRq) this._poseLast = { lm: PRq.lm.map((p) => p.slice()), mir: PRq.mir };
      this.poseW = (this.poseW || 0) + (tw - (this.poseW || 0)) * (1 - Math.exp(-(tw > (this.poseW || 0) ? 9 : 7) * dt));
      if (this.poseW < 0.01) { this.poseW = 0; if (!PRq) this._poseLast = null; }
      this.poseReq = this._poseLast && this.poseW > 0 ? { lm: PRq ? PRq.lm : this._poseLast.lm, w: this.poseW, mir: this._poseLast.mir } : null; }
    if (!any && !this.gripReq && !this.bodyReq && !this.poseReq) return;
    // [net] root.updateMatrixWorld(true)(뼈 53개+장비 전체)를 지움 — twoBoneIK·_look 의 getWorldPosition/Quaternion 이 필요한 부모 사슬만 갱신함 (qa 요청: 심판 look 이 상시라 매 프레임 전체 갱신이었음)
    const B = this.bones;
    const PR = this.poseReq; this.poseReq = null;
    if (PR) this._pose(PR);
    const BR = this.bodyReq; this.bodyReq = null;
    if (BR && !PR) this._body(BR);
    const G = this.gripReq; this.gripReq = null;
    if (G) { // 클립 자세가 나온 뒤 배트 위치로 목표 계산 → IK
      const th = B[G.top === 'L' ? 'LeftHand' : 'RightHand'];
      if (th) {
        G.bat.updateWorldMatrix(true, false);
        th.getWorldPosition(_gp); G.bat.worldToLocal(_gp);
        _gp.set(0, _gp.y - G.gap, 0); G.bat.localToWorld(_gp);
        this.ikT[G.side].copy(_gp); this.ikW[G.side] = Math.max(this.ikW[G.side], G.w * 0.999);
        const u = B[(G.side === 'L' ? 'Left' : 'Right') + 'Arm'], l = B[(G.side === 'L' ? 'Left' : 'Right') + 'ForeArm'], h = B[(G.side === 'L' ? 'Left' : 'Right') + 'Hand'];
        if (u && l && h) twoBoneIK(u, l, h, _gp, G.w);
      }
    }
    for (const [s, n] of [['L', 'Left'], ['R', 'Right']]) {
      if (G && s === G.side) continue;
      const w = this.ikW[s]; if (w <= 0.01) continue;
      const u = B[n + 'Arm'], l = B[n + 'ForeArm'], h = B[n + 'Hand'];
      if (u && l && h) twoBoneIK(u, l, h, this.ikT[s], w);
    }
    if (this.lookW > 0.01 && B.Head) {
      // [anim 11-19] 목·머리에 나눠서 돌림(목 45% → 머리 나머지, 전체 최대 45°). 머리 뼈 하나로 65°까지 돌리면 목 피부가 늘어나 얼굴이 일그러져 보였음
      if (B.Neck) this._look(B.Neck, this.lookT, this.lookW * 0.45, 45, B.Head);
      this._look(B.Head, this.lookT, this.lookW, 30);
    }
  }
  _body(R) {
    const B = this.bones, bat = R.bat; if (!bat.parent || !bat.userData.q0) return;
    bat.updateWorldMatrix(true, false);
    bat.getWorldQuaternion(m_qd); const want = m_qd.clone(); // 핸드폰이 정한 배트 방향(월드)
    bat.parent.getWorldQuaternion(m_q0w); m_q0w.multiply(bat.userData.q0); // 핸드폰 없이 클립만의 배트 방향
    m_d.copy(m_Y).applyQuaternion(want); m_d0.copy(m_Y).applyQuaternion(m_q0w);
    // 1) 몸통 비틀기: 배트 끝의 수평 방향 변화 × 배트가 누운 정도
    const horiz = 1 - Math.min(1, Math.abs(m_d.y));
    let yaw = Math.atan2(m_d.x, m_d.z) - Math.atan2(m_d0.x, m_d0.z); yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    yaw = THREE.MathUtils.clamp(yaw * horiz * 0.6, -0.7, 0.7) * R.w; // [11-24] 비틀기 범위 줄임 (±72° → ±40°)
    for (const n of ['Spine', 'Spine1', 'Spine2']) if (B[n]) rotWorld(B[n], m_UP, yaw / 3);
    // 2) 손: 몸통과 같이 돈 자리에서, 배트 끝이 간 반대쪽으로 조금(배트 손잡이가 몸 쪽으로) + 배트가 내려가면 손도 내려감
    const th = B[R.top === 'L' ? 'LeftHand' : 'RightHand'];
    if (th) {
      th.getWorldPosition(m_p0); m_p0.addScaledVector(m_d0, 0.16).addScaledVector(m_d, -0.16); m_p0.y += (m_d.y - m_d0.y) * 0.18;
      const n = R.top === 'L' ? 'Left' : 'Right';
      if (B[n + 'Arm'] && B[n + 'ForeArm']) twoBoneIK(B[n + 'Arm'], B[n + 'ForeArm'], th, m_p0, R.w);
    }
    // 3) 배트는 핸드폰 방향 그대로 (손이 움직여도)
    bat.parent.updateWorldMatrix(true, false); bat.parent.getWorldQuaternion(m_qa);
    bat.quaternion.copy(m_qa.invert().multiply(want)); bat.updateWorldMatrix(false, true);
  }
  _pose(R) {
    const B = this.bones, L = R.lm, w = R.w;
    for (let i = 0; i < 33; i++) mpv(_P[i], L[i], R.mir);
    const vis = (i) => (L[i].length > 3 ? L[i][3] : 1);
    // [11-24] 몸 방향 맞춤: 내가 평소 서 있는 방향(골반선, 천천히 따라가는 평균)을 선수 타격 자세 방향에 맞추고, 스윙처럼 빠르게 도는 것만 반영 → 카메라 위치가 달라도 선수가 통째로 돌아가지 않음
    {
      const hp = Math.min(vis(23), vis(24)) >= 0.55, la = hp ? 23 : 11, ra = hp ? 24 : 12; // [fix] 골반이 안 보이면 어깨선으로 방향
      const hx = _P[la].x - _P[ra].x, hz = _P[la].z - _P[ra].z, uy = Math.atan2(hx, hz);
      if (this._pyU == null) this._pyU = uy; else { let d = uy - this._pyU; d = Math.atan2(Math.sin(d), Math.cos(d)); this._pyU += d * 0.02; }
      if (B.LeftUpLeg && B.RightUpLeg) { /* 매 프레임 클립 자세의 골반선 (좌/우타 바뀌어도 맞음) */ B.LeftUpLeg.updateWorldMatrix(true, false); B.RightUpLeg.updateWorldMatrix(true, false); B.LeftUpLeg.getWorldPosition(m_p1); B.RightUpLeg.getWorldPosition(m_p0); this._pyC = Math.atan2(m_p1.x - m_p0.x, m_p1.z - m_p0.z); }
      if (this._pyC != null) { const rot = this._pyC - this._pyU; m_qa.setFromAxisAngle(m_UP, rot); for (let i = 0; i < 33; i++) _P[i].applyQuaternion(m_qa); }
    }
    // [fix] 어깨가 안 보이면 웹캠 자세는 아예 안 씀, 골반이 안 보이면(가까이 서서 상반신만) 골반·몸통·다리는 클립 그대로 — 팔·고개만
    const shQ = Math.min(vis(11), vis(12)), hpQ = Math.min(vis(23), vis(24));
    if (shQ < 0.5) return;
    const torsoOK = hpQ >= 0.55;
    const v = (a, b) => new THREE.Vector3().subVectors(_P[b], _P[a]);
    const mid = (a, b) => new THREE.Vector3().addVectors(_P[a], _P[b]).multiplyScalar(0.5);
    // 엉덩이 방향: 골반 좌우선(오른쪽→왼쪽)을 수평으로 맞춤
    if (torsoOK && B.Hips && B.LeftUpLeg && B.RightUpLeg) {
      B.RightUpLeg.updateWorldMatrix(true, false); B.LeftUpLeg.updateWorldMatrix(true, false); B.RightUpLeg.getWorldPosition(m_p0); B.LeftUpLeg.getWorldPosition(m_p1);
      const cur = m_cur.subVectors(m_p1, m_p0).setY(0), tg = v(24, 23).setY(0);
      if (cur.lengthSq() > 1e-6 && tg.lengthSq() > 1e-6) { let a = Math.atan2(tg.x, tg.z) - Math.atan2(cur.x, cur.z); a = Math.atan2(Math.sin(a), Math.cos(a)); rotWorld(B.Hips, m_UP, clamp(a, -1.1, 1.1) * w); } // [fix] 골반 최대 63°
    }
    // 몸통: 골반 가운데 → 어깨 가운데
    const torso = new THREE.Vector3().subVectors(mid(11, 12), mid(23, 24));
    if (torsoOK) aimBone(B.Spine, B.Neck, torso, w, 0.6);
    // 어깨 비틀기(몸통 축 기준): 어깨선 수평 방향
    if (B.Spine2 && B.LeftArm && B.RightArm) {
      B.RightArm.getWorldPosition(m_p0); B.LeftArm.getWorldPosition(m_p1);
      const cur = m_cur.subVectors(m_p1, m_p0).setY(0), tg = v(12, 11).setY(0);
      if (cur.lengthSq() > 1e-6 && tg.lengthSq() > 1e-6) { let a = Math.atan2(tg.x, tg.z) - Math.atan2(cur.x, cur.z); a = Math.atan2(Math.sin(a), Math.cos(a)); rotWorld(B.Spine2, m_UP, clamp(a, -0.8, 0.8) * w); } // [fix] 어깨 비틀기 최대 46°
    }
    if (vis(0) > 0.5) aimBone(B.Neck, B.Head, new THREE.Vector3().subVectors(_P[0], mid(11, 12)), w * 0.6, 0.6);
    // 팔·다리
    for (const [bn, tn, a, b] of [['LeftArm', 'LeftForeArm', 11, 13], ['LeftForeArm', 'LeftHand', 13, 15], ['RightArm', 'RightForeArm', 12, 14], ['RightForeArm', 'RightHand', 14, 16], // 팔·다리 모두 잘 보일 때만
      ['LeftUpLeg', 'LeftLeg', 23, 25], ['LeftLeg', 'LeftFoot', 25, 27], ['RightUpLeg', 'RightLeg', 24, 26], ['RightLeg', 'RightFoot', 26, 28]]) { const vv = Math.min(vis(a), vis(b)), leg = a >= 23, th = leg ? 0.75 : 0.45; if (leg && !torsoOK) continue; if (vv > th) { const d = v(a, b); d.z *= 0.7; /* 깊이는 인식이 제일 부정확 */ aimBone(B[bn], B[tn], d, w * (leg ? 0.55 : 1) * Math.min(1, (vv - th) / 0.2), leg ? 0.9 : 1.6); } } // [11-24] 다리는 잘 보일 때만 절반 세기로 (어색했음) // 안 보이는 관절(화면 밖 다리 등)은 원래 동작
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
  // bone 을 돌려 얼굴(머리 뼈 기준 faceLocal)이 목표를 보게. faceBone 을 주면 그 뼈(머리)의 얼굴 방향을 기준으로 bone(목)을 돌림
  _look(head, target, w, limDeg = 45, faceBone = null) {
    head.getWorldQuaternion(_qa); head.getWorldPosition(_a);
    const fq = faceBone ? faceBone.getWorldQuaternion(_qb) : _qa;
    const face = _v1.copy(this.lib.faceLocal).applyQuaternion(fq).normalize();
    if (faceBone) faceBone.getWorldPosition(_a);
    const want = _v2.subVectors(target, _a); if (want.lengthSq() < 1e-6) return; want.normalize();
    // 위아래는 덜 돌게(고개를 과하게 젖히면 턱·목이 늘어남)
    want.y = face.y + (want.y - face.y) * 0.55; want.normalize();
    const a = ang(face, want), lim = limDeg * DEG;
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
    this.ran = true; this.acc = 0; this.ibHave = false; this.ibT = 1;
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
