// loader.js — GLB 에셋을 읽어 모든 선수가 공유하는 '라이브러리'를 만든다
//   몸(player.glb) → 키 1.85m·발바닥 y=0·+z 정면으로 맞춘 템플릿, 뼈 이름 'mixamorig:Hips' → 'Hips'
//   클립(anim/<이름>.glb) → 뼈 이름 정리, 필요 없는 트랙(스케일·Hips 외 위치) 제거, 제자리(lockXZ), 단위 보정, 구간 자르기, 마커 자동 추정
//   장비(cap/helmet/bat/glove.glb) → 머리·손 크기에 자동으로 맞춘 자리(T포즈 캐릭터 공간)
// 파일이 없거나 깨졌으면 reject → 호출 쪽(actor.js)이 옛 몸(body.bin)으로 계속 간다.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { decalTex } from '../skinned.js';
import { MODEL_DIR, FILES, CLIPS, REQUIRED, EARLY, FIT, BODY, mergeManifest } from './clips.js';
import { buildProcClips } from './procedural.js';

const DEG = Math.PI / 180;
// 'mixamorig:Hips'(FBX) / 'mixamorigHips'(GLTFLoader 가 ':' 를 지움) / 'mixamorig1:Hips' → 'Hips'
export const canon = (n) => String(n || '').replace(/^mixamorig\d*[:_]?/i, '');

// ── 몸 템플릿 ──
export function prepTemplate(scene) {
  scene.traverse((o) => { if (o.isBone) o.name = canon(o.name); });
  scene.updateMatrixWorld(true);
  const meshes = []; scene.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
  if (!meshes.length) throw new Error('player.glb 에 스킨 메시가 없음(Mixamo With Skin 으로 받았는지 확인)');
  const box = new THREE.Box3();
  for (const m of meshes) { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld)); }
  const H = box.max.y - box.min.y;
  if (!(H > 1e-4)) throw new Error('player.glb 크기를 읽을 수 없음');
  const s = BODY.height / H;
  const fit = new THREE.Group(); fit.name = 'fit';
  fit.scale.setScalar(s);
  fit.position.set(-(box.min.x + box.max.x) / 2 * s, -box.min.y * s, -(box.min.z + box.max.z) / 2 * s);
  fit.add(scene);
  const tpl = new THREE.Group(); tpl.name = 'charTpl'; tpl.add(fit);
  tpl.updateMatrixWorld(true);
  const bones = new Map(); tpl.traverse((o) => { if (o.isBone) bones.set(o.name, o); });
  if (!bones.has('Hips')) throw new Error('Mixamo 뼈(Hips)를 못 찾음 — 뼈 이름: ' + [...bones.keys()].slice(0, 5).join(','));
  const rest = new Map(); for (const [n, b] of bones) rest.set(n, b.matrixWorld.clone());
  const meshInfo = meshes.map((m) => {
    const r = m.matrixWorld.clone(), inv = r.clone().invert();
    const sc = r.getMaxScaleOnAxis();
    return { rest: r, sphere: new THREE.Sphere(new THREE.Vector3(0, 1.0, 0).applyMatrix4(inv), 2.2 / sc) };
  });
  // 머리 범위: 머리 뼈에 가중치 0.5 이상인 정점들(캐릭터 공간). 모자·헬멧 자동 맞춤에 씀
  const headBox = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const m of meshes) {
    const bi = m.skeleton.bones.findIndex((b) => b.name === 'Head');
    const bt = m.skeleton.bones.findIndex((b) => b.name === 'HeadTop_End');
    if (bi < 0) continue;
    const P = m.geometry.attributes.position, SI = m.geometry.attributes.skinIndex, SW = m.geometry.attributes.skinWeight;
    if (!SI || !SW) continue;
    for (let i = 0; i < P.count; i++) {
      let w = 0;
      for (let k = 0; k < 4; k++) { const j = SI.getComponent(i, k); if (j === bi || j === bt) w += SW.getComponent(i, k); }
      if (w >= 0.5) headBox.expandByPoint(v.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld));
    }
  }
  const headP = new THREE.Vector3().setFromMatrixPosition(rest.get('Head'));
  if (headBox.isEmpty() || headBox.max.y - headBox.min.y < 0.08) headBox.setFromCenterAndSize(headP.clone().add(new THREE.Vector3(0, 0.1, 0.01)), new THREE.Vector3(0.18, 0.24, 0.22));
  // [model] 머리 타원체(눈썹 높이 위 = 모자·헬멧 안쪽): 눈썹 높이 단면의 폭·깊이 + 정수리. 이 밖으로 삐져나온 머리카락은
  //         셰이더에서 타원체 표면으로 눌러 넣음(모자 뚫고 나오는 머리 방지, character.js bodyMaterial). 모자·헬멧 맞춤도 이 값 기준
  const brow = headBox.min.y + (headBox.max.y - headBox.min.y) * BODY.hatBrow;
  const sl = new THREE.Box3();
  for (const m of meshes) {
    const bi = m.skeleton.bones.findIndex((b) => b.name === 'Head'), bt = m.skeleton.bones.findIndex((b) => b.name === 'HeadTop_End');
    const P = m.geometry.attributes.position, SI = m.geometry.attributes.skinIndex, SW = m.geometry.attributes.skinWeight;
    if (bi < 0 || !SI || !SW) continue;
    for (let i = 0; i < P.count; i++) {
      let w = 0;
      for (let k = 0; k < 4; k++) { const j = SI.getComponent(i, k); if (j === bi || j === bt) w += SW.getComponent(i, k); }
      if (w < 0.5) continue;
      v.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld);
      if (Math.abs(v.y - brow) < 0.015) sl.expandByPoint(v);
    }
  }
  if (sl.isEmpty()) sl.copy(headBox);
  const hcx = (headBox.min.x + headBox.max.x) / 2;
  const headE = {
    c: new THREE.Vector3(hcx, brow, (sl.min.z + sl.max.z) / 2),
    r: new THREE.Vector3(Math.max(sl.max.x - hcx, hcx - sl.min.x), headBox.max.y - brow, (sl.max.z - sl.min.z) / 2),
  };
  const qh = new THREE.Quaternion(); new THREE.Matrix4().extractRotation(rest.get('Head')).decompose(new THREE.Vector3(), qh, new THREE.Vector3());
  const faceLocal = new THREE.Vector3(0, 0, 1).applyQuaternion(qh.clone().invert());
  const hips = bones.get('Hips');
  const pq = new THREE.Quaternion(); hips.parent.getWorldQuaternion(pq);
  return {
    tpl, scale: s, meshInfo, rest, headBox, headE, faceLocal, boneSet: new Set(bones.keys()),
    hipsRest: hips.position.clone(), hipsUp: new THREE.Vector3(0, 1, 0).applyQuaternion(pq.invert()).normalize(),
    srcGeo: meshes[0].geometry,
  };
}

// ── 클립 ──
function trimTrack(tr, a, b) {
  const T = tr.times, n = T.length, sz = tr.getValueSize();
  if (n < 2) return tr;
  const interp = tr.createInterpolant(new tr.ValueBufferType(sz));
  const times = [a], vals = Array.from(interp.evaluate(a));
  for (let i = 0; i < n; i++) if (T[i] > a + 1e-5 && T[i] < b - 1e-5) { times.push(T[i]); for (let k = 0; k < sz; k++) vals.push(tr.values[i * sz + k]); }
  times.push(b); vals.push(...interp.evaluate(b));
  const out = new tr.constructor(tr.name, times.map((t) => t - a), vals);
  return out;
}
export function prepClip(name, animations, T) {
  const cfg = CLIPS[name] || (CLIPS[name] = { loop: false, optional: true });
  const src = (animations || []).reduce((a, b) => (!a || b.duration > a.duration ? b : a), null);
  if (!src) throw new Error(name + ': 애니메이션이 없음');
  let tracks = [], hipsPos = null;
  for (const tr of src.tracks) {
    const dot = tr.name.lastIndexOf('.');
    const node = canon(tr.name.slice(0, dot)), prop = tr.name.slice(dot + 1);
    if (!T.boneSet.has(node)) continue;
    if (prop === 'quaternion') { const t = tr.clone(); t.name = node + '.quaternion'; tracks.push(t); }
    else if (prop === 'position' && node === 'Hips') { const t = tr.clone(); t.name = 'Hips.position'; tracks.push(t); hipsPos = t; }
  }
  if (tracks.length < 5) throw new Error(name + ': 뼈 이름이 몸과 안 맞음(같은 캐릭터로 받았는지 확인)');
  if (hipsPos) {
    const V = hipsPos.values, r = T.hipsRest, rl = r.length();
    // 단위 보정(cm ↔ m): 첫 프레임 엉덩이 거리와 몸의 엉덩이 거리 비율을 10의 거듭제곱으로 맞춤
    const l0 = Math.hypot(V[0], V[1], V[2]);
    if (rl > 1e-4 && l0 > 1e-6) { const f = Math.pow(10, Math.round(Math.log10(l0 / rl))); if (f !== 1) for (let i = 0; i < V.length; i++) V[i] /= f; }
    if (cfg.lockXZ) {
      const up = T.hipsUp;
      for (let i = 0; i < V.length; i += 3) {
        const dx = V[i] - r.x, dy = V[i + 1] - r.y, dz = V[i + 2] - r.z, d = dx * up.x + dy * up.y + dz * up.z;
        V[i] = r.x + up.x * d; V[i + 1] = r.y + up.y * d; V[i + 2] = r.z + up.z * d;
      }
    }
  }
  const tr = cfg.trim;
  if (Array.isArray(tr) && tr[1] > tr[0]) tracks = tracks.map((t) => trimTrack(t, tr[0], Math.min(tr[1], src.duration)));
  // [motion] anchor: 걸어 들어오기/나가기처럼 루트가 움직이는 클립 — 끝(또는 첫) 프레임 엉덩이 수평 위치를 제자리(몸 바인드 위치)로 옮김
  //  → 'end' 면 걸어 들어와 멈춘 자리가 정확히 타석(대기 자세와 같은 자리), 'start' 면 대기 자세 자리에서 출발
  const hp = (cfg.anchor === 'end' || cfg.anchor === 'start') && tracks.find((t) => t.name === 'Hips.position');
  if (hp) {
    const V = hp.values, r = T.hipsRest, up = T.hipsUp, i = cfg.anchor === 'end' ? V.length - 3 : 0;
    let dx = V[i] - r.x, dy = V[i + 1] - r.y, dz = V[i + 2] - r.z; const d = dx * up.x + dy * up.y + dz * up.z;
    dx -= up.x * d; dy -= up.y * d; dz -= up.z * d;
    for (let k = 0; k < V.length; k += 3) { V[k] -= dx; V[k + 1] -= dy; V[k + 2] -= dz; }
  }
  const clip = new THREE.AnimationClip(name, -1, tracks);
  clip.optimize();
  const markers = { ...autoMarkers(name, clip, T), ...(cfg.markers || {}) };
  return { name, clip, cfg, markers, index: -1 };
}

// 클립을 한 번 훑어서 단계 마커를 추정(손 속도 최대 = 릴리스/컨택, 앞발 최고점 = 레그킥 정점 …)
let PROBE = null;
export function autoMarkers(name, clip, T) {
  const dur = clip.duration, m = { start: 0, end: dur };
  const kind = (CLIPS[name] && CLIPS[name].kind) || (name === 'powerSwing' ? 'swing' : name); // [motion] kind: swing2·pitch2·catcherThrow 도 같은 방식
  if (!['pitch', 'swing', 'throw', 'catchLow', 'catchHigh', 'dive', 'slide'].includes(kind)) return m;
  if (!PROBE || PROBE.T !== T) { const model = SkeletonUtils.clone(T.tpl); const b = {}; model.traverse((o) => { if (o.isBone) b[o.name] = o; }); PROBE = { T, model, b, mixer: new THREE.AnimationMixer(model) }; }
  const { model, b, mixer } = PROBE;
  const act = mixer.clipAction(clip); act.reset(); act.play(); act.timeScale = 0;
  const N = Math.max(2, Math.ceil(dur * 60)), dt = dur / N;
  const S = { rh: [], lh: [], lf: [], hip: [], bat: [] }, p = new THREE.Vector3();
  // [motion] 배트 방향(오른손 뼈 기준, FIT.bat.dir 을 손 로컬로) — 스윙 컨택 = 배트가 투구 선(±x)에 수직이 되는 순간
  let batLocal = null;
  if (kind === 'swing' && b.RightHand && T.rest && T.rest.get('RightHand')) {
    const qr = new THREE.Quaternion(); T.rest.get('RightHand').decompose(new THREE.Vector3(), qr, new THREE.Vector3());
    batLocal = new THREE.Vector3(...FIT.bat.dir).normalize().applyQuaternion(qr.invert());
  }
  const qh = new THREE.Quaternion();
  for (let i = 0; i <= N; i++) {
    act.time = i * dt; mixer.update(0); model.updateMatrixWorld(true);
    if (batLocal) S.bat.push(batLocal.clone().applyQuaternion(b.RightHand.getWorldQuaternion(qh)));
    S.rh.push((b.RightHand || b.Hips).getWorldPosition(p).clone());
    S.lh.push((b.LeftHand || b.Hips).getWorldPosition(p).clone());
    S.lf.push((b.LeftFoot || b.Hips).getWorldPosition(p).clone());
    S.hip.push(b.Hips.getWorldPosition(p).clone());
  }
  act.stop(); mixer.uncacheClip(clip);
  const spd = (arr) => arr.map((q, i) => (i === 0 ? 0 : q.distanceTo(arr[i - 1]) / dt));
  const argmax = (a, i0 = 0, i1 = a.length - 1) => { let k = i0; for (let i = i0; i <= i1; i++) if (a[i] > a[k]) k = i; return k; };
  const argmin = (a, i0 = 0, i1 = a.length - 1) => { let k = i0; for (let i = i0; i <= i1; i++) if (a[i] < a[k]) k = i; return k; };
  const edge = Math.min(3, (N / 4) | 0);
  if (kind === 'pitch') {
    const rel = argmax(spd(S.rh), edge, N - edge);
    const fy = S.lf.map((q) => q.y), pk = argmax(fy, 0, rel);
    const y0 = fy[0], rise = fy[pk] - y0;
    let lift = 0, peak = pk;
    if (rise > 0.1) { lift = pk; while (lift > 0 && fy[lift] > y0 + rise * 0.12) lift--; }
    else { lift = (rel * 0.3) | 0; peak = (rel * 0.7) | 0; }
    m.release = rel * dt; m.peak = peak * dt; m.lift = lift * dt; m.set = Math.max(0, m.lift - 0.35);
  } else if (kind === 'swing') {
    const c = argmax(spd(S.rh), edge, N - edge);
    m.contact = c * dt;
    // [motion] 손 속도 최대는 배트가 아직 포수 쪽(-x)으로 누워 있는 '채찍 전' 순간(실측 0.04~0.07초 이름). 공을 맞히는 건 그 뒤
    //  배트 수평 방향이 -x → +x 로 넘어가는(투구 선에 수직, 홈플레이트 위) 순간을 컨택으로. 못 찾으면 손 속도 최대 그대로
    if (S.bat.length) {
      const i1 = Math.min(N, c + Math.ceil(0.3 / dt));
      for (let i = Math.max(1, c - 2); i <= i1; i++) {
        const a = S.bat[i - 1], q = S.bat[i];
        if (a.x < 0 && q.x >= 0 && q.z > 0.2) { m.contact = (i - 1 + (-a.x) / Math.max(1e-6, q.x - a.x)) * dt; break; }
      }
    } m.launch = Math.max(0, m.contact - 0.12); m.load = Math.max(0, m.contact - 0.35); m.start = Math.max(0, m.load - 0.5);
  } else if (kind === 'throw') {
    const r = argmax(spd(S.rh), edge, N - edge);
    m.release = r * dt; m.start = Math.max(0, m.release - 0.45); m.end = Math.min(dur, m.release + 0.5);
  } else if (kind === 'catchLow') {
    m.catch = argmin(S.lh.map((q) => q.y)) * dt;
  } else if (kind === 'catchHigh') {
    m.catch = argmax(S.lh.map((q) => q.y)) * dt;
  } else if (kind === 'dive' || kind === 'slide') {
    const hy = S.hip.map((q) => q.y), lo = argmin(hy, 0, (N * 0.85) | 0);
    // 가장 낮은 곳까지 '처음 떨어지는' 시각(착지)
    let land = lo; const thr = hy[lo] + (hy[0] - hy[lo]) * 0.15; while (land > 0 && hy[land - 1] < thr) land--;
    m.land = Math.max(dt, land * dt);
  }
  for (const k in m) m[k] = Math.round(m[k] * 1000) / 1000;
  return m;
}

// ── 장비 ──
const _box = new THREE.Box3(), _v = new THREE.Vector3(), _q = new THREE.Quaternion();
function measure(o) { o.updateMatrixWorld(true); return _box.setFromObject(o).clone(); }
function hold(name, inner) { const h = new THREE.Group(); h.name = name; h.add(inner); h.userData.rest = new THREE.Matrix4().toArray(); return h; }
function restPos(T, bone) { return new THREE.Vector3().setFromMatrixPosition(T.rest.get(bone)); }

export function prepHeadItem(kind, raw, T) {
  const F = FIT[kind];
  const g = new THREE.Group(); g.add(raw); g.rotation.set(F.rot[0] * DEG, F.rot[1] * DEG, F.rot[2] * DEG);
  const hb = T.headBox;
  let b = measure(g);
  const s = (hb.max.x - hb.min.x) * F.width / Math.max(1e-6, b.max.x - b.min.x) * (F.scale || 1);
  const st = F.stretch || [1, 1, 1]; // [model] 축별 배율(Tripo 모자는 머리보다 넓고 얕음 → 깊이를 늘리고 높이를 줄여 머리에 맞춤)
  g.scale.set(s * st[0], s * st[1], s * st[2]); b = measure(g);
  g.position.x += (hb.min.x + hb.max.x) / 2 - (b.min.x + b.max.x) / 2 + F.pos[0];
  g.position.y += hb.max.y + F.top - b.max.y + F.pos[1];
  g.position.z += hb.min.z + F.back - b.min.z + F.pos[2];
  return hold(kind, g);
}
export function prepGlove(raw, T, catcher = false) {
  const F = FIT.glove;
  const g = new THREE.Group(); g.rotation.set(F.rot[0] * DEG, F.rot[1] * DEG, F.rot[2] * DEG);
  if (F.mirror) { const mg = new THREE.Group(); mg.scale.x = -1; mg.add(raw); g.add(mg); } else g.add(raw); // 오른손용 모델 → 왼손 (three 가 음수 행렬식이면 앞면 방향을 뒤집어 그림)
  let b = measure(g); const sz = b.getSize(_v);
  g.scale.setScalar(F.fit / Math.max(1e-6, sz.x, sz.y, sz.z) * (F.scale || 1) * (catcher ? F.catcher : 1));
  b = measure(g);
  const c = b.getCenter(new THREE.Vector3()), h = b.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const anchor = c.add(h.multiply(new THREE.Vector3(...F.anchor)));
  g.position.add(restPos(T, 'LeftHand').add(new THREE.Vector3(...F.pos)).sub(anchor));
  return hold('glove', g);
}
// 배트: 가장 긴 축 = 배트 축, 끝부분 평균 굵기가 가는 쪽 = 손잡이(knob). 원점 = 손잡이 끝, +y = 배럴 쪽인 'batFrame' 을 만든다
export function prepBat(raw, T) {
  const F = FIT.bat;
  raw.updateMatrixWorld(true);
  const b = measure(raw), sz = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
  const ax = sz.x >= sz.y && sz.x >= sz.z ? 'x' : sz.y >= sz.z ? 'y' : 'z';
  const L = sz[ax], lo = b.min[ax], o1 = ax === 'x' ? 'y' : 'x', o2 = ax === 'z' ? 'y' : 'z';
  let r0 = 0, n0 = 0, r1 = 0, n1 = 0;
  raw.traverse((o) => {
    if (!o.isMesh) return; const P = o.geometry.attributes.position;
    for (let i = 0; i < P.count; i += Math.max(1, (P.count / 4000) | 0)) {
      _v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld);
      const u = (_v[ax] - lo) / L, r = Math.hypot(_v[o1] - c[o1], _v[o2] - c[o2]);
      if (u < 0.2) { r0 += r; n0++; } else if (u > 0.8) { r1 += r; n1++; }
    }
  });
  const knobAtMin = (n0 ? r0 / n0 : 0) <= (n1 ? r1 / n1 : 0);
  const dir = new THREE.Vector3(); dir[ax] = knobAtMin ? 1 : -1;
  const knob = c.clone(); knob[ax] = knobAtMin ? b.min[ax] : b.max[ax];
  const inner = new THREE.Group(); inner.add(raw);
  inner.quaternion.setFromUnitVectors(dir, new THREE.Vector3(0, 1, 0));
  const s = F.fit / L; inner.scale.setScalar(s);
  inner.position.copy(knob).applyQuaternion(inner.quaternion).multiplyScalar(-s);
  const frame = new THREE.Group(); frame.name = 'batFrame'; frame.add(inner);
  placeBatFrame(frame, T);
  return hold('bat', frame);
}
function placeBatFrame(frame, T) {
  const F = FIT.bat;
  frame.position.copy(restPos(T, 'RightHand')).add(new THREE.Vector3(...F.knob));
  frame.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...F.dir).normalize());
}

// GLB 가 없을 때 쓰는 단순 장비(머리 크기에 맞춤) — 새 몸에 옛 장비가 둥둥 뜨지 않게
const STD = new Map();
const std = (c, r = 0.7, mt = 0) => { const k = c + r + mt; if (!STD.has(k)) STD.set(k, new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: mt })); return STD.get(k); };
export function fallbackItem(kind, T) {
  const hb = T.headBox, W = hb.max.x - hb.min.x, D = hb.max.z - hb.min.z;
  const c = hb.getCenter(new THREE.Vector3());
  const g = new THREE.Group();
  if (kind === 'cap' || kind === 'helmet') {
    const big = kind === 'helmet' ? 1.14 : 1.06, mat = std('#ffffff', kind === 'helmet' ? 0.3 : 0.75);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    const ch = (hb.max.y - hb.min.y) * (kind === 'helmet' ? 0.55 : 0.42); // 머리 위쪽을 덮는 높이
    crown.scale.set(W * big, ch * 2, D * big); // 반구 반지름 0.5 → 높이 = scale.y/2
    crown.position.set(c.x, hb.max.y + (kind === 'helmet' ? 0.02 : 0.012) - ch, c.z);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.01, 20, 1, false, -Math.PI / 2, Math.PI), mat);
    brim.scale.set(W * 1.0, 1, D * (kind === 'helmet' ? 0.55 : 0.75)); brim.position.set(c.x, crown.position.y + 0.004, c.z + D * 0.32);
    g.add(crown, brim); g.userData.tint = 'all';
  } else if (kind === 'bat') {
    const prof = [[0, 0], [0.024, 0], [0.026, 0.012], [0.015, 0.03], [0.0125, 0.1], [0.013, 0.3], [0.024, 0.52], [0.032, 0.68], [0.033, 0.82], [0.03, 0.855], [0, 0.86]].map(([r, y]) => new THREE.Vector2(r, y));
    const frame = new THREE.Group(); frame.name = 'batFrame';
    frame.add(new THREE.Mesh(new THREE.LatheGeometry(prof, 14), std('#caa06a', 0.45)));
    placeBatFrame(frame, T); g.add(frame);
  } else if (kind === 'glove') {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), std('#7b4a25', 0.6));
    m.scale.set(0.27, 0.07, 0.17); m.position.copy(restPos(T, 'LeftHand')).add(new THREE.Vector3(0.1, -0.02, 0)); g.add(m);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return hold(kind, g);
}

// ── 불러오기 ──
let LIB = null, LOADING = null;
export const getLib = () => LIB;
const ext = () => (typeof window !== 'undefined' && window.HR_ASSETS && window.HR_ASSETS.glb) || null;
async function exists(url) {
  if (url.startsWith('data:')) return true;
  try { const r = await fetch(url, { method: 'HEAD', cache: 'no-cache' }); return r.ok && !/text\/html/.test(r.headers.get('content-type') || ''); } catch { return false; }
}
export function loadLib({ dir = MODEL_DIR, onClip = null } = {}) {
  if (LOADING) return LOADING;
  LOADING = (async () => {
    const X = ext();
    const url = (k, f) => (X && X[k]) || dir + f;
    const m = X ? X.manifest : await fetch(dir + 'manifest.json', { cache: 'no-cache' }).then((r) => (r.ok && /json/.test(r.headers.get('content-type') || 'json') ? r.json() : null)).catch(() => null);
    mergeManifest(m);
    const pu = url('player', FILES.player);
    if (!(await exists(pu))) throw new Error('no-model');
    const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([import('three/addons/loaders/GLTFLoader.js'), import('three/addons/libs/meshopt_decoder.module.js')]);
    const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
    const T = prepTemplate((await loader.loadAsync(pu)).scene);
    const lib = { ...T, clips: new Map(), clipList: [], acc: {}, loGeo: null, maskTex: null, missing: [],
      decal: typeof document !== 'undefined' ? (u, num, name) => decalTex(u, num, name) : null };
    // 저폴리 인덱스(선택)
    try {
      const r = await fetch(url('playerLod', FILES.playerLod)); const buf = r.ok ? await r.arrayBuffer() : null;
      if (buf && new Uint32Array(buf, 0, 1)[0] === 0x314c5248) {
        const n = new Uint32Array(buf, 4, 1)[0], idx = new Uint32Array(buf, 8, n), g = T.srcGeo, nv = g.attributes.position.count;
        let ok = n > 0 && n % 3 === 0; for (let i = 0; ok && i < n; i++) if (idx[i] >= nv) ok = false;
        if (ok) { const lo = new THREE.BufferGeometry(); for (const k in g.attributes) lo.setAttribute(k, g.attributes[k]); lo.setIndex(new THREE.BufferAttribute(idx, 1)); lib.loGeo = lo; }
      }
    } catch { /* 없으면 LOD 없이 */ }
    if (FILES.mask) try { const t = await new THREE.TextureLoader().loadAsync(url('mask', FILES.mask)); t.flipY = false; t.colorSpace = THREE.NoColorSpace; lib.maskTex = t; } catch { /* 자동 판정 */ }
    // [motion] 원본 애니메이션(e.src)은 ?animlab(구간 다시 자르기)에서만 들고 있음 — 게임에선 잘라 만든 클립만 남겨 클립 메모리 절반
    const keepSrc = typeof location !== 'undefined' && /[?&]animlab\b/.test(location.search);
    const addClip = (name, gltf) => { try { const e = prepClip(name, gltf.animations, T); if (keepSrc) e.src = gltf.animations; e.index = lib.clipList.length; lib.clipList.push(e); lib.clips.set(name, e); if (onClip) onClip(e); return e; } catch (err) { console.warn('[anim] 클립', name, err.message); return null; } };
    const getClip = (name) => loader.loadAsync(X && X.anim && X.anim[name] ? X.anim[name] : dir + 'anim/' + name + '.glb').then((g) => addClip(name, g)).catch(() => { lib.missing.push(name); return null; });
    await Promise.all(EARLY.map(getClip));
    // 필수 클립이 빠지면 게임은 옛 몸 유지(LIB 를 비워 둠) — 그래도 ?animlab 에서 있는 클립은 볼 수 있게 lib 는 돌려준다
    lib.incomplete = REQUIRED.filter((n) => !lib.clips.has(n));
    // 장비
    const getAcc = (k) => loader.loadAsync(url(k, FILES[k])).then((g) => g.scene).catch(() => null);
    const [cap, helmet, bat, glove] = await Promise.all(['cap', 'helmet', 'bat', 'glove'].map(getAcc));
    const shadowBig = (h) => { h.traverse((o) => { if (o.isMesh) { const gg = o.geometry, n = gg.index ? gg.index.count / 3 : gg.attributes.position.count / 3; o.castShadow = n > 400; } }); return h; };
    lib.acc.cap = shadowBig(cap ? prepHeadItem('cap', cap, T) : fallbackItem('cap', T));
    lib.acc.helmet = shadowBig(helmet ? prepHeadItem('helmet', helmet, T) : fallbackItem('helmet', T));
    lib.acc.bat = shadowBig(bat ? prepBat(bat, T) : fallbackItem('bat', T));
    lib.acc.glove = shadowBig(glove ? prepGlove(glove, T) : fallbackItem('glove', T));
    lib.acc.gloveC = shadowBig(glove ? prepGlove(glove.clone(), T, true) : fallbackItem('glove', T));
    lib.raw = { cap, helmet, bat, glove };
    if (!lib.incomplete.length) LIB = lib;
    // 나머지 클립은 뒤에서(게임 시작을 막지 않음)
    (async () => {
      for (const n of Object.keys(CLIPS)) if (!lib.clips.has(n) && !EARLY.includes(n)) await getClip(n);
      // [motion2] FBX 가 없는 동작(세이프 콜·높은 공·땅볼 포구)은 받은 클립 자세로 만든 절차적 클립 (procedural.js) — 파일이 있으면 그게 우선
      try {
        for (const { name, clip } of buildProcClips(lib, T)) {
          const cfg = CLIPS[name] || (CLIPS[name] = { loop: false, optional: true });
          const e = { name, clip, cfg, markers: { ...autoMarkers(name, clip, T), ...(cfg.markers || {}) }, index: lib.clipList.length, proc: true };
          lib.clipList.push(e); lib.clips.set(name, e); if (onClip) onClip(e);
        }
      } catch (err) { console.warn('[anim] 절차적 클립', err.message); }
    })();
    return lib;
  })();
  return LOADING;
}
