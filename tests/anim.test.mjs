// 캐릭터 애니메이션(anim 파트): 가짜 Mixamo 뼈대로 Character·로더·시간표를 검사 (GPU 없이 three 수학만)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { canon, prepTemplate, prepClip, fallbackItem } from '../client/anim/loader.js';
import { Character, twoBoneIK } from '../client/anim/character.js';
import { PITCH_TL, pitchClipTime, kClipTime, tauFromPitchK, onWindup } from '../client/anim/timing.js';
import { pitchK } from '../client/anim.js';
import { CLIPS } from '../client/anim/clips.js';
import { bus } from '../client/core/bus.js';

// GLTFLoader 처럼 ':' 가 지워진 이름, cm 단위(Armature 0.01)
const DEF = [
  ['Hips', null, 0, 100, 0], ['Spine', 'Hips', 0, 10, 0], ['Spine2', 'Spine', 0, 25, 0], ['Neck', 'Spine2', 0, 15, 0], ['Head', 'Neck', 0, 10, 0], ['HeadTop_End', 'Head', 0, 22, 0],
  ['LeftArm', 'Spine2', 18, 10, 0], ['LeftForeArm', 'LeftArm', 28, 0, 0], ['LeftHand', 'LeftForeArm', 26, 0, 0],
  ['RightArm', 'Spine2', -18, 10, 0], ['RightForeArm', 'RightArm', -28, 0, 0], ['RightHand', 'RightForeArm', -26, 0, 0],
  ['LeftUpLeg', 'Hips', 9, -5, 0], ['LeftLeg', 'LeftUpLeg', 0, -45, 0], ['LeftFoot', 'LeftLeg', 0, -42, 0],
  ['RightUpLeg', 'Hips', -9, -5, 0], ['RightLeg', 'RightUpLeg', 0, -45, 0], ['RightFoot', 'RightLeg', 0, -42, 0],
];
function fakeRig() {
  const arm = new THREE.Group(); arm.name = 'Armature'; arm.scale.setScalar(0.01);
  const bones = {}, list = [];
  for (const [n, p, x, y, z] of DEF) { const b = new THREE.Bone(); b.name = 'mixamorig' + n; b.position.set(x, y, z); (p ? bones[p] : arm).add(b); bones[n] = b; list.push(b); }
  arm.updateMatrixWorld(true);
  // 몸통 상자(0~150cm, Hips) + 머리 상자(150~182cm, Head)
  const pos = [], si = [], sw = [];
  const box = (x0, x1, y0, y1, z0, z1, bi) => { for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) { pos.push(x, y, z); si.push(bi, 0, 0, 0); sw.push(1, 0, 0, 0); } };
  box(-20, 20, -2, 150, -12, 12, 0); box(-9, 9, 150, 182, -11, 10, DEF.findIndex((d) => d[0] === 'Head'));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map(() => 0), 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex([0, 1, 2, 4, 5, 6, 8, 9, 10]);
  const mesh = new THREE.SkinnedMesh(g, new THREE.MeshStandardMaterial());
  arm.add(mesh); arm.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton(list));
  const scene = new THREE.Group(); scene.add(arm);
  return scene;
}
// 가짜 클립: 오른손이 t=0.6 에 가장 빨리 움직이고(릴리스), 왼발이 t=0.35 에 가장 높음(레그킥), 엉덩이 cm 단위로 앞으로 이동
function fakeClip(name, dur = 1.2) {
  const n = 61, times = [], rq = [], lq = [], hp = [];
  const q = new THREE.Quaternion();
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) * dur; times.push(t);
    const a = 2.6 / (1 + Math.exp(-(t - 0.6) * 25)); q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), a); rq.push(q.x, q.y, q.z, q.w);
    const b = Math.exp(-((t - 0.35) ** 2) / 0.01) * 1.2; q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -b); lq.push(q.x, q.y, q.z, q.w);
    hp.push(0, 100 - 10 * Math.sin(t), 40 * t);
  }
  return new THREE.AnimationClip(name, dur, [
    new THREE.QuaternionKeyframeTrack('mixamorigRightArm.quaternion', times, rq),
    new THREE.QuaternionKeyframeTrack('mixamorigLeftUpLeg.quaternion', times, lq),
    new THREE.VectorKeyframeTrack('mixamorigHips.position', times, hp),
    new THREE.VectorKeyframeTrack('mixamorigHips.scale', times, times.flatMap(() => [1, 1, 1])),
    new THREE.QuaternionKeyframeTrack('mixamorigSpine.quaternion', times, times.flatMap(() => [0, 0, 0, 1])),
    new THREE.QuaternionKeyframeTrack('mixamorigNeck.quaternion', times, times.flatMap(() => [0, 0, 0, 1])),
    new THREE.QuaternionKeyframeTrack('mixamorigHead.quaternion', times, times.flatMap(() => [0, 0, 0, 1])),
    new THREE.QuaternionKeyframeTrack('Unknown_Bone.quaternion', times, times.flatMap(() => [0, 0, 0, 1])),
  ]);
}
function fakeLib() {
  const T = prepTemplate(fakeRig());
  const lib = { ...T, clips: new Map(), clipList: [], acc: {}, loGeo: null, maskTex: null, decal: null };
  for (const n of ['idle', 'run', 'pitch', 'swing', 'throw', 'batStance']) { const e = prepClip(n, [fakeClip(n)], T); e.index = lib.clipList.length; lib.clipList.push(e); lib.clips.set(n, e); }
  for (const k of ['cap', 'helmet', 'bat', 'glove']) lib.acc[k] = fallbackItem(k, T);
  lib.acc.gloveC = lib.acc.glove;
  return lib;
}

test('뼈 이름 정리 (mixamorig:Hips / mixamorigHips / mixamorig1:Hips)', () => {
  assert.equal(canon('mixamorig:Hips'), 'Hips'); assert.equal(canon('mixamorigLeftHand'), 'LeftHand'); assert.equal(canon('mixamorig1:Head'), 'Head'); assert.equal(canon('Spine'), 'Spine');
});

test('몸 템플릿: 키 1.85m, 발 y=0, 머리 범위', () => {
  const T = prepTemplate(fakeRig());
  const b = new THREE.Box3();
  T.tpl.traverse((o) => { if (o.isSkinnedMesh) b.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)); });
  assert.ok(Math.abs(b.max.y - b.min.y - 1.85) < 1e-3, `키 ${b.max.y - b.min.y}`);
  assert.ok(Math.abs(b.min.y) < 1e-3);
  assert.ok(T.headBox.max.y > 1.8 && T.headBox.min.y > 1.4, `머리 ${T.headBox.min.y}~${T.headBox.max.y}`);
  assert.ok(T.faceLocal.z > 0.99);
});

test('클립 정리: 이름 맞춤·불필요 트랙 제거·cm→m·제자리·마커 자동', () => {
  const T = prepTemplate(fakeRig());
  const e = prepClip('pitch', [fakeClip('pitch')], T);
  const names = e.clip.tracks.map((t) => t.name);
  assert.ok(names.includes('RightArm.quaternion') && names.includes('Hips.position'));
  assert.ok(!names.some((n) => /scale|Unknown/.test(n)));
  const hp = e.clip.tracks.find((t) => t.name === 'Hips.position');
  assert.ok(hp.values[1] > 50 && hp.values[1] < 150, '엉덩이 단위 그대로(템플릿 뼈와 같은 단위)');
  assert.ok(Math.abs(e.markers.release - 0.6) < 0.06, `release ${e.markers.release}`);
  assert.ok(Math.abs(e.markers.peak - 0.35) < 0.06, `peak ${e.markers.peak}`);
  assert.ok(e.markers.lift < e.markers.peak && e.markers.set <= e.markers.lift);
  const r = prepClip('run', [fakeClip('run')], T);
  const rp = r.clip.tracks.find((t) => t.name === 'Hips.position');
  for (let i = 0; i < rp.values.length; i += 3) assert.ok(Math.abs(rp.values[i + 2]) < 1e-3, '제자리(lockXZ)');
  // cm 단위로 들어온 클립을 m 몸에 맞춤
  const T2 = { ...T, hipsRest: T.hipsRest.clone().multiplyScalar(0.01) };
  const c2 = prepClip('swing', [fakeClip('swing')], T2);
  assert.ok(c2.clip.tracks.find((t) => t.name === 'Hips.position').values[1] < 1.5);
  // 구간 자르기
  CLIPS.throw.trim = [0.2, 0.9];
  const tr = prepClip('throw', [fakeClip('throw')], T);
  delete CLIPS.throw.trim;
  assert.ok(Math.abs(tr.clip.duration - 0.7) < 1e-3, `trim ${tr.clip.duration}`);
});

test('투구 시간표: 단계 시각이 클립 마커에 맞음, pitchK 역함수', () => {
  const m = { set: 0.1, lift: 0.4, peak: 1.0, release: 1.6, end: 2.4 };
  assert.ok(Math.abs(pitchClipTime(PITCH_TL.lift, m) - 0.4) < 1e-6);
  assert.ok(Math.abs(pitchClipTime(PITCH_TL.peak, m) - 1.0) < 1e-6);
  assert.ok(Math.abs(pitchClipTime((PITCH_TL.peak + PITCH_TL.hold) / 2, m) - 1.0) < 1e-6, '정점 멈춤');
  assert.ok(Math.abs(pitchClipTime(PITCH_TL.release, m) - 1.6) < 1e-6, '릴리스 = sim WINDUP');
  assert.ok(Math.abs(pitchClipTime(PITCH_TL.release + 0.3, m) - 1.9) < 1e-6, '팔로스루는 자연 속도');
  let prev = -1; for (let t = 0; t < 3; t += 0.01) { const c = pitchClipTime(t, m); assert.ok(c >= prev - 1e-9); prev = c; }
  onWindup({ at: 10, set: 0.35, kick: 1.25, peak: 1.45, dur: 1.85 });
  assert.equal(PITCH_TL.peak, 1.25); assert.equal(PITCH_TL.hold, 1.45); assert.equal(PITCH_TL.release, 1.85);
  for (const tau of [0.5, 0.9, 1.2, 1.5, 1.7, 1.85, 2.2]) assert.ok(Math.abs(tauFromPitchK(pitchK(tau)) - tau) < 2e-3, `tau ${tau}`);
  assert.ok(Math.abs(kClipTime(0.5, CLIPS.swing.kmap, { start: 0, load: 0.3, launch: 0.5, contact: 0.62, end: 1.2 }) - 0.62) < 1e-6);
});

test('Character: 크로스페이드·긁기·장비·IK·리플레이 스냅샷', () => {
  const lib = fakeLib();
  const c = new Character(lib, { colors: { jersey: '#ff0000', pants: '#00ff00', sock: '#0000ff' } });
  assert.equal(c.mats[0].userData.uni.uJersey.value.getHex(), 0xff0000);
  c.play('run', { fade: 0.2 });
  c.update(0.1);
  const ws = [...c.layers.values()].map((L) => L.w);
  assert.ok(ws.length === 2 && Math.abs(ws[0] + ws[1] - 1) < 1e-6, `페이드 중 가중치 ${ws}`);
  for (let i = 0; i < 5; i++) c.update(0.1);
  assert.equal(c.layers.size, 1, '다 섞이면 이전 클립 정리');
  // 없는 클립 → 대체(sprint→run, catcherSquat→ready→idle)
  assert.equal(c.resolve('sprint').name, 'run'); assert.equal(c.resolve('catcherSquat').name, 'idle');
  // 긁기: 투구 릴리스 시각
  c.scrubPitch(PITCH_TL.release, { fade: 0 }); c.update(0.016);
  const L = c.layers.get('pitch');
  assert.ok(Math.abs(L.action.time - lib.clips.get('pitch').markers.release) < 1e-3);
  // 장비: 모자가 머리 위에(기본 자세), 캐릭터를 따라 움직임
  const c2 = new Character(lib); c2.update(0.016);
  const cap = c2.attach('head', lib.acc.cap.clone());
  c2.root.updateMatrixWorld(true);
  const p = new THREE.Box3().setFromObject(cap);
  assert.ok(p.max.y > 1.84 && p.max.y < 1.9, `모자 위 ${p.max.y}`);
  c2.root.position.set(5, 0, 3); c2.root.updateMatrixWorld(true);
  assert.ok(Math.abs(new THREE.Box3().setFromObject(cap).getCenter(new THREE.Vector3()).x - 5) < 0.2);
  // 스냅샷 → 복원
  const s = c.snapshot();
  c.play('idle', { fade: 0 }); c.update(0.5);
  c.restore(s, null, 0);
  assert.ok(Math.abs(c.layers.get('pitch').action.time - L.action.time) < 1e-4);
});

test('2관절 IK: 손이 닿는 목표점에 도달', () => {
  const s = new THREE.Bone(), e = new THREE.Bone(), h = new THREE.Bone();
  s.add(e); e.add(h); e.position.set(0.3, 0, 0); h.position.set(0.28, 0, 0);
  e.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.3);
  s.updateMatrixWorld(true);
  const tgt = new THREE.Vector3(0.2, 0.35, 0.15);
  twoBoneIK(s, e, h, tgt, 1); s.updateMatrixWorld(true);
  assert.ok(h.getWorldPosition(new THREE.Vector3()).distanceTo(tgt) < 0.005);
});

test('배우(새 몸): 옛 호출 그대로 클립으로 + 동작 시작 이벤트', async () => {
  const { CharPlayer, ClipAnimator } = await import('../client/anim/actor.js');
  const lib = fakeLib();
  const P = new CharPlayer(lib, { team: 'home', num: 7, role: 'batter', seed: 1 }); P.setRole('batter');
  const A = new ClipAnimator(P);
  const got = []; const off = ['cue:swing', 'cue:dive', 'cue:slide'].map((e) => bus.on(e, (d) => got.push([e, d])));
  A.batter(0.016, { swingK: -1, loadK: 0 }); A.batter(0.016, { swingK: 0.3, loadK: 1 }); A.batter(0.016, { swingK: 0.5, loadK: 1 });
  P.root.position.set(3, 0, 4);
  A.fielder(0.016, { speed: 0, diveK: 0, throwK: -1, jumpK: -1, ground: false });
  A.runner(0.016, { speed: 6, slideK: 0.1 });
  off.forEach((f) => f());
  assert.deepEqual(got.map((g) => g[0]), ['cue:swing', 'cue:dive', 'cue:slide']);
  assert.equal(got[1][1].x, 3); assert.equal(got[1][1].z, 4);
  const v = new THREE.Vector3(); P.root.updateMatrixWorld(true);
  assert.ok(P.batPoint(0.86, v).distanceTo(P.batPoint(0, new THREE.Vector3())) > 0.8, '배트 길이');
  for (let i = 0; i < 30; i++) A.pitcher(1 / 30, { k: pitchK(i / 30 * 2), speed: 0 });
  A.fielder(0.016, { speed: 5, ground: false, diveK: -1, throwK: -1, jumpK: -1 }); assert.equal(A.loco, 'run');
});

test('GLB 읽기(LOD 도구): 스킨 메시 첫 primitive 인덱스·정점', async () => {
  const { readGlb, accessor, firstSkinPrim } = await import('../tools/glb-lod.mjs');
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), idx = new Uint16Array([0, 1, 2, 0]);
  const bin = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(idx.buffer)]);
  const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'Armature', children: [1, 2] }, { name: 'mixamorig:Hips' }, { mesh: 0, skin: 0 }], skins: [{ joints: [1] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }], buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 6 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }, { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }] };
  let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - js.length % 4) % 4, 0x20)]);
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
  const ch = (type, b) => { const h = Buffer.alloc(8); h.writeUInt32LE(b.length, 0); h.writeUInt32LE(type, 4); return Buffer.concat([h, b]); };
  const g = readGlb(Buffer.concat([head, ch(0x4e4f534a, js), ch(0x004e4942, bin)]));
  const p = firstSkinPrim(g.json);
  assert.deepEqual([...accessor(g, p.indices)], [0, 1, 2]);
  assert.deepEqual([...accessor(g, p.attributes.POSITION)], [...pos]);
});
