// replay.js — 화면 기록·슬로모션 리플레이 (홈런, 호수비)
// 매 프레임 선수 관절/위치 + 공을 링버퍼에 저장 → 리플레이 땐 그 값을 다시 입혀서 시네마틱 카메라로 보여줌.
// 게임 진행(서버/시뮬)과 무관한 '보는 것'만 다루므로 멀티플레이 동기화에 영향 없음.
import * as THREE from 'three';
import { JOINTS } from './player.js';

const KEEP = 9; // 초
const NJ = JOINTS.length;
const SZ = 3 + 1 + 1 + 3 + 4 + NJ * 4 + 3 + 4 + 3; // root pos, rotY, vis, body pos, body quat, joints, bat pos, bat quat, flags
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

export class Replay {
  constructor() { this.buf = []; this.active = null; this.pending = null; this.pool = []; this.cpool = []; this.fpool = []; }

  record(t, players, ballMesh) {
    if (this.active) return;
    // [qa] 9초 링버퍼에서 밀려난 프레임의 배열을 다시 씀 (전엔 프레임마다 선수 18명 × Float32Array 새로 → 초당 수 MB 쓰레기, GC 멈춤 원인)
    const fr = this.fpool.pop() || { t: 0, items: [], ball: null, bv: [0, 0, 0] };
    fr.t = t; fr.items.length = 0;
    fr.ball = ballMesh.visible ? ballMesh.position.toArray(fr.bv) : null;
    for (const p of players) {
      if (!p || !p.root.parent) continue;
      const a = this.pool.pop() || new Float32Array(SZ); let o = 0;
      const r = p.root, b = p.body;
      a[o++] = r.position.x; a[o++] = r.position.y; a[o++] = r.position.z; a[o++] = r.rotation.y; a[o++] = r.visible ? 1 : 0;
      a[o++] = b.position.x; a[o++] = b.position.y; a[o++] = b.position.z;
      a[o++] = b.quaternion.x; a[o++] = b.quaternion.y; a[o++] = b.quaternion.z; a[o++] = b.quaternion.w;
      if (p.char) { a[o++] = p.bat.visible ? 1 : 0; a[o++] = p.ball.visible ? 1 : 0; a[o++] = p.glove.visible ? 1 : 0; fr.items.push([p, a, p.char.snapshot(this.cpool.pop())]); continue; } // 새 캐릭터: 클립 상태만 기록(가벼움)
      for (const j of JOINTS) { const q = p.J[j].quaternion; a[o++] = q.x; a[o++] = q.y; a[o++] = q.z; a[o++] = q.w; }
      a[o++] = p.bat.position.x; a[o++] = p.bat.position.y; a[o++] = p.bat.position.z;
      a[o++] = p.bat.quaternion.x; a[o++] = p.bat.quaternion.y; a[o++] = p.bat.quaternion.z; a[o++] = p.bat.quaternion.w;
      a[o++] = p.bat.visible ? 1 : 0; a[o++] = p.ball.visible ? 1 : 0; a[o++] = p.glove.visible ? 1 : 0;
      fr.items.push([p, a]);
    }
    this.buf.push(fr);
    while (this.buf.length && this.buf[0].t < t - KEEP) {
      const f = this.buf.shift();
      for (const it of f.items) { this.pool.push(it[1]); if (it[2]) this.cpool.push(it[2]); }
      f.items.length = 0; this.fpool.push(f);
    }
  }

  // 일정 시간 뒤 리플레이 예약: tEvent(기록 시각 기준), 앞뒤 구간, 속도, 카메라 종류
  schedule(at, opts) { this.pending = { at, ...opts }; }

  tick(now) {
    if (this.pending && now >= this.pending.at && !this.active) { const o = this.pending; this.pending = null; this.start(o); }
  }

  start({ tEvent, pre = 1, post = 1, speed = 0.5, cam = 'hr', focus = null, scene }) {
    const frames = this.buf.filter((f) => f.t >= tEvent - pre && f.t <= tEvent + post);
    if (frames.length < 5) return false;
    // 기록에 있던 선수 모음 (현재 장면에서 빠진 선수는 잠깐 다시 넣음)
    const set = new Set(); for (const f of frames) for (const it of f.items) set.add(it[0]);
    const added = [], hidden = [], sprites = [];
    for (const p of set) if (!p.root.parent && scene) { scene.add(p.root); added.push(p); }
    for (const p of set) p.root.traverse((o) => { if (o.isSprite && o.visible) { o.visible = false; sprites.push(o); } });
    this.active = { frames, t: frames[0].t, t0: frames[0].t, t1: frames[frames.length - 1].t, tEvent, speed, cam, focus, added, hidden, sprites, set, scene };
    return true;
  }

  stop() {
    const A = this.active; if (!A) return;
    for (const p of A.added) A.scene.remove(p.root);
    for (const o of A.sprites) o.visible = true;
    for (const p of A.hidden) p.root.visible = true;
    this.active = null;
  }

  // 리플레이 진행: 선수/공 상태를 입힘. 반환: 현재 리플레이 시각 정보(카메라용) 또는 null(끝)
  update(dt, ballMesh, allPlayers) {
    const A = this.active; if (!A) return null;
    const slow = A.speed * (A.cam === 'hr' && A.t > A.tEvent + 0.35 ? 1.6 : 1);
    A.t += dt * slow;
    if (A.t >= A.t1) { this.stop(); return null; }
    const F = A.frames;
    let i = 0; while (i < F.length - 2 && F[i + 1].t < A.t) i++;
    const f0 = F[i], f1 = F[i + 1];
    const u = Math.max(0, Math.min(1, (A.t - f0.t) / Math.max(1e-4, f1.t - f0.t)));
    const m1 = new Map(f1.items.map((x) => [x[0], x]));
    const present = new Set();
    for (const [p, a, cs] of f0.items) {
      const it1 = m1.get(p), b = it1 ? it1[1] : a; present.add(p);
      const L = (k) => a[k] + (b[k] - a[k]) * u;
      let o = 0;
      p.root.position.set(L(0), L(1), L(2)); o = 3;
      let dy = b[3] - a[3]; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); p.root.rotation.y = a[3] + dy * u; o = 4;
      p.root.visible = a[4] > 0.5; o = 5;
      p.body.position.set(L(5), L(6), L(7)); o = 8;
      _q.set(a[8], a[9], a[10], a[11]); _q2.set(b[8], b[9], b[10], b[11]); p.body.quaternion.copy(_q).slerp(_q2, u); o = 12;
      if (cs && p.char) { p.bat.visible = a[12] > 0.5; p.ball.visible = a[13] > 0.5; p.glove.visible = a[14] > 0.5; p.char.restore(cs, it1 && it1[2], u); continue; }
      for (const j of JOINTS) { _q.set(a[o], a[o + 1], a[o + 2], a[o + 3]); _q2.set(b[o], b[o + 1], b[o + 2], b[o + 3]); p.J[j].quaternion.copy(_q).slerp(_q2, u); o += 4; }
      p.bat.position.set(L(o), L(o + 1), L(o + 2)); o += 3;
      _q.set(a[o], a[o + 1], a[o + 2], a[o + 3]); _q2.set(b[o], b[o + 1], b[o + 2], b[o + 3]); p.bat.quaternion.copy(_q).slerp(_q2, u); o += 4;
      p.bat.visible = a[o] > 0.5; p.ball.visible = a[o + 1] > 0.5; p.glove.visible = a[o + 2] > 0.5;
    }
    // 기록에 없는 현재 선수는 숨김
    for (const p of allPlayers) if (p && p.root.parent && !present.has(p) && p.root.visible) { p.root.visible = false; if (!A.hidden.includes(p)) A.hidden.push(p); }
    if (f0.ball && f1.ball) { ballMesh.visible = true; ballMesh.position.set(...f0.ball).lerp(_v.set(...f1.ball), u); }
    else if (f0.ball) { ballMesh.visible = true; ballMesh.position.set(...f0.ball); }
    else ballMesh.visible = false;
    return { t: A.t, t0: A.t0, rel: A.t - A.tEvent, k: (A.t - A.t0) / (A.t1 - A.t0), cam: A.cam, focus: A.focus };
  }
}
const _v = new THREE.Vector3();
