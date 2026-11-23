// procedural.js — [motion2] Mixamo FBX 가 없는 동작을 '받은 클립의 자세 + 뼈 방향 키프레임'으로 만든 절차적 클립
//   umpireSafe(세이프 콜: 가슴 앞에서 팔 교차 → 양옆으로 쫙), catchHigh(머리 위 포구 → 가슴으로 내림), catchLow(땅볼: 무릎·허리 숙여 글러브 바닥 → 일어나며 가슴)
//   · 바탕 자세는 이미 받은 클립(idle / ready)의 첫 프레임 → 몸 비율·뼈 축이 실제 캐릭터와 같음
//   · 팔·몸통은 '월드 방향으로 뼈를 겨누기(aim)', 다리는 발을 땅에 붙인 채 2본 IK(무릎은 앞·바깥)
//   · 로딩 때 한 번 만들고(클립당 수 ms) 모든 선수가 공유 — 프레임 비용 0. 진짜 FBX(anim/<이름>.glb)가 있으면 그게 우선(이건 없을 때만)
//   좌표: 캐릭터 공간(+z 정면, +x = 캐릭터 왼쪽, y 위)
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _t = new THREE.Quaternion();

function makeProbe(T) {
  const model = SkeletonUtils.clone(T.tpl), b = {};
  model.traverse((o) => { if (o.isBone) b[o.name] = o; });
  return { model, b, mixer: new THREE.AnimationMixer(model), names: Object.keys(b) };
}
// 클립 시각 t 의 자세를 probe 에 입힘
//  (mixer 는 액션을 멈추면 바인드 자세로 되돌리므로 읽어 둔 값을 다시 씀)
function sampleBase(P, e, t) {
  const act = P.mixer.clipAction(e.clip); act.reset(); act.play(); act.timeScale = 0; act.time = Math.min(t, e.clip.duration - 1e-3);
  P.mixer.update(0); const g = grab(P); act.stop(); P.mixer.uncacheClip(e.clip); return g;
}
function setPose(P, g) { for (const n of P.names) P.b[n].quaternion.copy(g.q[n]); P.b.Hips.position.copy(g.hips); P.model.updateMatrixWorld(true); }
// 뼈에 월드 회전 q 를 더함(뼈 위치 기준)
function rotW(P, name, q) {
  const bone = P.b[name]; if (!bone) return;
  bone.parent.getWorldQuaternion(_pq);
  _t.copy(_pq).invert().multiply(q).multiply(_pq);
  bone.quaternion.premultiply(_t).normalize();
  bone.updateMatrixWorld(true);
}
// 뼈(name → child) 방향을 월드 dir 로 (w: 0~1 만큼만)
function aim(P, name, child, dir, w = 1) {
  const b = P.b[name], c = P.b[child]; if (!b || !c) return;
  b.getWorldPosition(_a); c.getWorldPosition(_b); _b.sub(_a).normalize();
  _q.setFromUnitVectors(_b, dir); if (w < 1) _q.slerp(_t.identity(), 1 - w);
  rotW(P, name, _q.clone());
}
// 축(월드) 기준 회전(도)
function bend(P, name, axis, deg) { rotW(P, name, new THREE.Quaternion().setFromAxisAngle(axis, deg * Math.PI / 180)); }
// 엉덩이를 월드 y 로 dy 만큼
function hipsY(P, dy) {
  const h = P.b.Hips; h.getWorldPosition(_a); _a.y += dy; h.parent.worldToLocal(_a); h.position.copy(_a); P.model.updateMatrixWorld(true);
}
// 다리 2본 IK: 발목을 target(월드)에, 무릎은 pole 쪽으로
function legIK(P, side, target, pole) {
  const U = P.b[side + 'UpLeg'], L = P.b[side + 'Leg'], F = P.b[side + 'Foot']; if (!U || !L || !F) return;
  const hp = U.getWorldPosition(new THREE.Vector3()), kp = L.getWorldPosition(new THREE.Vector3()), fp = F.getWorldPosition(new THREE.Vector3());
  const a = hp.distanceTo(kp), b = kp.distanceTo(fp);
  const d = Math.min(a + b - 1e-3, Math.max(1e-3, hp.distanceTo(target)));
  const u = _a.copy(target).sub(hp).normalize();
  const v = _b.copy(pole).addScaledVector(u, -pole.dot(u)).normalize();
  const cosA = (a * a + d * d - b * b) / (2 * a * d), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const knee = hp.clone().addScaledVector(u, a * cosA).addScaledVector(v, a * sinA);
  aim(P, side + 'UpLeg', side + 'Leg', knee.clone().sub(hp).normalize());
  const kp2 = L.getWorldPosition(new THREE.Vector3());
  aim(P, side + 'Leg', side + 'Foot', target.clone().sub(kp2).normalize());
}
// 지금 probe 자세 → 키 하나
function grab(P) { const q = {}; for (const n of P.names) q[n] = P.b[n].quaternion.clone(); return { q, hips: P.b.Hips.position.clone() }; }
function toClip(name, keys) {
  const times = keys.map((k) => k.t), tracks = [];
  for (const n of Object.keys(keys[0].p.q)) {
    const vals = []; let moved = false; const q0 = keys[0].p.q[n];
    for (const k of keys) { const q = k.p.q[n]; if (Math.abs(q.dot(q0)) < 0.99999) moved = true; vals.push(q.x, q.y, q.z, q.w); }
    if (moved || n === 'Hips' || n === 'Spine') tracks.push(new THREE.QuaternionKeyframeTrack(n + '.quaternion', times, vals));
    else tracks.push(new THREE.QuaternionKeyframeTrack(n + '.quaternion', [0], [q0.x, q0.y, q0.z, q0.w]));
  }
  const hv = []; for (const k of keys) hv.push(k.p.hips.x, k.p.hips.y, k.p.hips.z);
  tracks.push(new THREE.VectorKeyframeTrack('Hips.position', times, hv));
  return new THREE.AnimationClip(name, -1, tracks);
}
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);

// 팔 자세: L/R 위팔·아래팔 방향(왼쪽 기준으로 적고 오른쪽은 x 반전)
function arms(P, la, lf, ra, rf) {
  if (la) aim(P, 'LeftArm', 'LeftForeArm', la); if (lf) aim(P, 'LeftForeArm', 'LeftHand', lf);
  if (ra) aim(P, 'RightArm', 'RightForeArm', ra); if (rf) aim(P, 'RightForeArm', 'RightHand', rf);
}
// 발을 지금 자리(바탕 자세)에 붙인 채 엉덩이를 내림
function squat(P, dy, out = 0.35) {
  const fl = P.b.LeftFoot.getWorldPosition(new THREE.Vector3()), fr = P.b.RightFoot.getWorldPosition(new THREE.Vector3());
  hipsY(P, -dy);
  legIK(P, 'Left', fl, V(out, 0, 1)); legIK(P, 'Right', fr, V(-out, 0, 1));
}

const RECIPES = {
  // 세이프: 서서(idle) → 0.16s 가슴 앞 팔 교차(살짝 숙임) → 0.36s 양팔 수평으로 쫙(손바닥 아래) → 1.05s 까지 유지 → 1.5s 내림
  umpireSafe: { base: 'idle', keys: [
    [0, () => {}],
    [0.16, (P) => { bend(P, 'Spine1', X, 10); squat(P, 0.05); arms(P, V(-0.35, -0.3, 0.9), V(-0.95, 0.12, 0.25), V(0.35, -0.2, 0.92), V(0.95, 0.2, 0.25)); }],
    [0.36, (P) => { bend(P, 'Spine1', X, 12); squat(P, 0.08, 0.5); arms(P, V(1, 0.04, 0.12), V(1, 0.02, 0.06), V(-1, 0.04, 0.12), V(-1, 0.02, 0.06)); }],
    [1.05, (P) => { bend(P, 'Spine1', X, 12); squat(P, 0.08, 0.5); arms(P, V(1, 0.02, 0.18), V(1, 0, 0.1), V(-1, 0.02, 0.18), V(-1, 0, 0.1)); }],
    [1.5, () => {}],
  ] },
  // 높은 공: 준비 자세 → 0.27s 글러브(왼손) 머리 위 앞, 오른손이 덮음 → 0.6s 가슴으로 내림. 'catch' 마커 = 왼손 최고점(자동)
  catchHigh: { base: 'ready', keys: [
    [0, () => {}],
    [0.27, (P) => { bend(P, 'Spine1', X, -6); bend(P, 'Neck', X, -18); squat(P, -0.02); arms(P, V(0.18, 0.92, 0.35), V(-0.05, 0.85, 0.5), V(-0.12, 0.85, 0.5), V(0.3, 0.75, 0.6)); }],
    [0.6, (P) => { bend(P, 'Spine1', X, 4); arms(P, V(0.3, -0.55, 0.78), V(-0.45, 0.55, 0.7), V(-0.3, -0.6, 0.74), V(0.5, 0.45, 0.72)); }],
  ] },
  // 땅볼: 준비 자세 → 0.3s 무릎·허리 숙여 글러브 바닥(주머니 앞), 오른손 위에서 덮음 → 0.6s 반쯤 일어나며 글러브를 배꼽으로 (k 1 에서 유지)
  catchLow: { base: 'ready', keys: [
    [0, () => {}],
    [0.3, (P) => { squat(P, 0.33, 0.55); bend(P, 'Spine', X, 28); bend(P, 'Spine1', X, 18); bend(P, 'Spine2', X, 8); bend(P, 'Neck', X, -30); arms(P, V(0.2, -0.85, 0.5), V(-0.05, -0.9, 0.42), V(-0.22, -0.72, 0.66), V(0.2, -0.8, 0.56)); }],
    [0.6, (P) => { squat(P, 0.16, 0.45); bend(P, 'Spine', X, 14); bend(P, 'Spine1', X, 8); bend(P, 'Neck', X, -14); arms(P, V(0.25, -0.75, 0.6), V(-0.5, 0.25, 0.83), V(-0.25, -0.75, 0.6), V(0.55, 0.3, 0.78)); }],
  ] },
};
export const PROC_NAMES = Object.keys(RECIPES);

// lib 에 없는 것만 만들어 돌려줌: [{ name, clip }]
export function buildProcClips(lib, T, names = PROC_NAMES) {
  const out = []; let P = null;
  for (const name of names) {
    const R = RECIPES[name]; if (!R || lib.clips.has(name)) continue;
    const base = lib.clips.get(R.base) || lib.clips.get('idle'); if (!base) continue;
    P = P || makeProbe(T);
    const g0 = sampleBase(P, base, 0);
    const keys = R.keys.map(([t, f]) => { setPose(P, g0); f(P); P.model.updateMatrixWorld(true); return { t, p: grab(P) }; });
    out.push({ name, clip: toClip(name, keys) });
  }
  if (P) P.mixer.uncacheRoot(P.model);
  return out;
}

// ── [lefty] 좌타자 클립: 우타 클립을 캐릭터 좌우(로컬 x)로 거울 ──
//   프레임마다 뼈 월드 회전 G 를 바인드 대비 차이 D = G·B⁻¹ 로 보고, 짝 뼈(Left↔Right)에 거울 차이 (x, −y, −z, w)·B짝 을 입힌 뒤 로컬로 되돌림.
//   좌우 뼈 축 규약이 달라도(Mixamo 는 좌우 축이 비대칭) 바인드 대비 차이로 계산하므로 맞음. 엉덩이 위치는 x 반전.
//   게임은 좌타자 루트를 x −0.95·반대 방향(ry +90°)으로 두므로 '로컬 x 거울 + 180° 회전' = 홈플레이트 기준 좌우 거울.
//   처음 필요할 때 클립마다 한 번(30fps 샘플, 수 ms) → 이름 '<클립>_L' 로 라이브러리에 등록, 모든 선수 공유.
export const MIRROR_CLIPS = ['batStance', 'batStance2', 'batStance3', 'swing', 'powerSwing', 'swing2', 'buntStance', 'batStepIn', 'batWalkIn', 'batWalkOut', 'batStrike'];
const partner = (n) => (n.startsWith('Left') ? 'Right' + n.slice(4) : n.startsWith('Right') ? 'Left' + n.slice(5) : n);
const MP = new WeakMap();
function mirrorClip(lib, e) {
  let M = MP.get(lib);
  if (!M) {
    const P = makeProbe(lib), B = {};
    for (const n of P.names) { const r = lib.rest.get(n); const q = new THREE.Quaternion(); if (r) r.decompose(_a, q, _b); B[n] = q; }
    P.model.updateMatrixWorld(true);
    M = { P, B, Pa: P.b.Hips.parent.getWorldQuaternion(new THREE.Quaternion()) }; MP.set(lib, M);
  }
  const { P, B, Pa } = M, names = P.names, dur = e.clip.duration;
  const N = Math.max(1, Math.ceil(dur * 30)), times = [], vals = {}, hv = [], G = {}, Gp = {}, prev = {};
  for (const n of names) vals[n] = [];
  const act = P.mixer.clipAction(e.clip); act.reset(); act.play(); act.timeScale = 0;
  const inv = new THREE.Quaternion(), D = new THREE.Quaternion(), L = new THREE.Quaternion(), hw = new THREE.Vector3();
  for (const n of names) { G[n] = new THREE.Quaternion(); Gp[n] = new THREE.Quaternion(); }
  for (let i = 0; i <= N; i++) {
    const t = Math.min(dur, (i / N) * dur); times.push(t);
    act.time = Math.min(t, dur - 1e-4); P.mixer.update(0); P.model.updateMatrixWorld(true);
    for (const n of names) P.b[n].getWorldQuaternion(G[n]);
    for (const n of names) {
      const m = partner(n); if (!B[m] || !G[n]) continue;
      D.copy(G[n]).multiply(inv.copy(B[n]).invert());
      D.set(D.x, -D.y, -D.z, D.w);
      Gp[m].copy(D).multiply(B[m]);
    }
    for (const n of names) {
      const par = P.b[n].parent;
      L.copy(par && par.isBone && Gp[par.name] ? inv.copy(Gp[par.name]).invert() : inv.copy(Pa).invert()).multiply(Gp[n]);
      if (prev[n] && prev[n].dot(L) < 0) L.set(-L.x, -L.y, -L.z, -L.w);
      (prev[n] || (prev[n] = new THREE.Quaternion())).copy(L);
      vals[n].push(L.x, L.y, L.z, L.w);
    }
    P.b.Hips.getWorldPosition(hw); hw.x = -hw.x; P.b.Hips.parent.worldToLocal(hw); hv.push(hw.x, hw.y, hw.z);
  }
  act.stop(); P.mixer.uncacheClip(e.clip);
  const tracks = names.map((n) => new THREE.QuaternionKeyframeTrack(n + '.quaternion', times, vals[n]));
  tracks.push(new THREE.VectorKeyframeTrack('Hips.position', times, hv));
  const clip = new THREE.AnimationClip(e.name + '_L', dur, tracks); clip.optimize();
  return clip;
}
// 좌타 클립 이름 (없으면 만들어 등록). 실패하면 원래 이름
export function mirrorName(lib, CLIPS, name) {
  const nm = name + '_L';
  if (lib.clips.has(nm)) return nm;
  const e = lib.clips.get(name); if (!e || !MIRROR_CLIPS.includes(name)) return name;
  try {
    const cfg = { ...e.cfg, optional: true, fallback: e.cfg.fallback && MIRROR_CLIPS.includes(e.cfg.fallback) ? e.cfg.fallback + '_L' : e.cfg.fallback };
    CLIPS[nm] = cfg;
    const m = { name: nm, clip: mirrorClip(lib, e), cfg, markers: { ...e.markers }, index: lib.clipList.length, mirror: true };
    lib.clipList.push(m); lib.clips.set(nm, m);
    return nm;
  } catch (err) { console.warn('[anim] 좌타 클립', name, err.message); return name; }
}
