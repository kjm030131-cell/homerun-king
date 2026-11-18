// actor.js — main.js 가 쓰는 '배우' 만들기. 새 캐릭터(GLB)가 준비됐으면 Character, 아니면 옛 몸(body.bin + 절차 애니메이션).
// · main.js 는 지금처럼 A.p(root·ball·bat·glove·capG·helmetG·maskG·batPoint)와 A.a.fielder/pitcher/batter/… 만 쓴다.
// · 새 GLB 가 늦게 도착하면, 이미 만든 옛 배우들도 그 자리에서 새 캐릭터로 바꿔 끼운다(upgrade).
// · 동작 시작 이벤트(사운드용, 화면에서 모션이 시작되는 순간): cue:swing {power, bunt} / cue:dive {x,z} / cue:slide {x,z}
//   (서버 판정 이벤트 swing/dive/slide 는 gameplay 가 같은 이름으로 보내므로 겹치지 않게 'cue:' 접두사(총괄 지정))
import * as THREE from 'three';
import { Player, UNIFORMS } from '../player.js';
import { attachSkin } from '../skinned.js';
import { Animator } from '../anim.js';
import { bus } from '../core/bus.js';
import { Character, tintedMaterial } from './character.js';
import { loadLib, getLib } from './loader.js';
import { CLIPS, FIT } from './clips.js';
import { PITCH_TL, tauFromPitchK } from './timing.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

// ── 동작 시작 이벤트(옛 몸·새 몸 공통) ──
function motionEvents(S, P, kind, c) {
  if (kind === 'batter') {
    const on = c.swingK >= 0;
    if (on && !S.sw) bus.emit('cue:swing', { power: !!c.power, bunt: !!c.bunt, src: 'anim' });
    S.sw = on;
  } else if (kind === 'fielder') {
    const on = c.diveK >= 0;
    if (on && !S.dv) bus.emit('cue:dive', { x: P.root.position.x, z: P.root.position.z, src: 'anim' });
    S.dv = on;
  } else if (kind === 'runner') {
    const on = c.slideK >= 0;
    if (on && !S.sl) bus.emit('cue:slide', { x: P.root.position.x, z: P.root.position.z, src: 'anim' });
    S.sl = on;
  }
}
class LegacyAnimator extends Animator {
  constructor(p) { super(p); this.ev = {}; }
  fielder(dt, c) { motionEvents(this.ev, this.p, 'fielder', c); return super.fielder(dt, c); }
  batter(dt, c) { motionEvents(this.ev, this.p, 'batter', c); return super.batter(dt, c); }
  runner(dt, c) { motionEvents(this.ev, this.p, 'runner', c); return super.runner(dt, c); }
}

// ── 새 몸: main.js 가 기대하는 Player 모양의 껍데기 ──
let MASK_GEO = null;
function maskGroup(lib) {
  const hb = lib.headBox, W = hb.max.x - hb.min.x, c = hb.getCenter(new THREE.Vector3());
  if (!MASK_GEO) MASK_GEO = { bar: new THREE.TorusGeometry(0.5, 0.03, 4, 16, Math.PI), pad: new THREE.SphereGeometry(0.5, 14, 10) };
  const g = new THREE.Group(); g.name = 'mask';
  const cage = new THREE.MeshStandardMaterial({ color: '#202228', roughness: 0.4, metalness: 0.6 });
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(MASK_GEO.bar, cage); b.rotation.set(Math.PI / 2, 0, 0); b.scale.set(W * 1.15, W * 1.25, W);
    b.position.set(c.x, hb.min.y + (hb.max.y - hb.min.y) * (0.18 + i * 0.16), c.z + 0.02); g.add(b);
  }
  const pad = new THREE.Mesh(MASK_GEO.pad, new THREE.MeshStandardMaterial({ color: '#2a2c33', roughness: 0.8 }));
  pad.scale.set(W * 1.12, (hb.max.y - hb.min.y) * 1.05, (hb.max.z - hb.min.z) * 1.08); pad.position.copy(c).add(_v.set(0, 0.01, -0.012)); g.add(pad);
  g.userData.rest = new THREE.Matrix4().toArray();
  return g;
}
function protGroup(lib, color) {
  const p = new THREE.Vector3().setFromMatrixPosition(lib.rest.get('Spine2'));
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12, 0, Math.PI, 0.25, Math.PI * 0.6), new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
  m.scale.set(1.05, 1.15, 0.7); m.position.set(p.x, p.y - 0.06, p.z + 0.04); m.castShadow = true; g.add(m);
  g.userData.rest = new THREE.Matrix4().toArray();
  return g;
}
function guardGroup(lib, side, color) {
  const a = new THREE.Vector3().setFromMatrixPosition(lib.rest.get(side + 'Leg')), b = new THREE.Vector3().setFromMatrixPosition(lib.rest.get(side + 'Foot') || lib.rest.get(side + 'Leg'));
  const L = Math.max(0.2, a.distanceTo(b));
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, L * 0.75, 4, 10), new THREE.MeshStandardMaterial({ color, roughness: 0.4 }));
  m.position.copy(a).lerp(b, 0.5).add(_v.set(0, 0, 0.05));
  m.quaternion.setFromUnitVectors(_v.set(0, 1, 0), _w.subVectors(a, b).normalize());
  const g = new THREE.Group(); g.add(m); g.userData.rest = new THREE.Matrix4().toArray();
  return g;
}
function tint(h, color, mode) {
  h.traverse((o) => { if (o.isMesh && o.material) o.material = Array.isArray(o.material) ? o.material.map((x) => tintedMaterial(x, color, mode)) : tintedMaterial(o.material, color, mode); });
  return h;
}

export class CharPlayer {
  constructor(lib, { team = 'home', num = '', name = '', role = 'fielder', seed = Math.random() } = {}) {
    const u = UNIFORMS[team] || UNIFORMS.home;
    const rnd = (k) => { const x = Math.sin(seed * 9301 + k * 49297) * 233280; return x - Math.floor(x); };
    this.team = team; this.role = role; this.isChar = true;
    this.scale = 0.96 + rnd(3) * 0.08;
    this.look = { u, num, name };
    this.char = new Character(lib, { colors: u, num: team === 'ump' ? '' : num, name, scale: this.scale });
    this.root = this.char.root; this.body = this.char.body; this.J = {};
    const C = this.char;
    this.capG = C.attach('head', tint(lib.acc.cap.clone(), u.cap, FIT.cap.tint || 'all'));
    this.helmetG = C.attach('head', tint(lib.acc.helmet.clone(), u.cap, FIT.helmet.tint || 'all')); this.helmetG.visible = false;
    this.maskG = C.attach('head', maskGroup(lib)); this.maskG.visible = false;
    this.glove = C.attach('handL', (role === 'catcher' ? lib.acc.gloveC : lib.acc.glove).clone());
    const bh = C.attach('handR', lib.acc.bat.clone());
    this.bat = bh.getObjectByName('batFrame') || bh; this.bat.visible = false;
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.037, 10, 8), new THREE.MeshStandardMaterial({ color: '#f7f5ef', roughness: 0.5 }));
    this.ball.visible = false;
    const bp = new THREE.Vector3().setFromMatrixPosition(lib.rest.get('RightHand')).add(_v.set(...FIT.ball.pos));
    this.ball.userData.rest = new THREE.Matrix4().makeTranslation(bp.x, bp.y, bp.z).toArray();
    C.attach('handR', this.ball);
    for (const g of [this.capG, this.helmetG, this.maskG, this.glove, this.bat, this.ball]) g.userData.acc = true;
    if (role === 'catcher' || role === 'ump') {
      const col = role === 'ump' ? '#2a2c33' : u.accent;
      C.attach('chest', protGroup(lib, col));
      C.attach('legL', guardGroup(lib, 'Left', col)); C.attach('legR', guardGroup(lib, 'Right', col));
      this.maskG.visible = true;
      this.capG.visible = role === 'ump';
    }
    this.glove.visible = !['batter', 'runner', 'ump'].includes(role);
  }
  setRole(role) {
    this.role = role;
    this.helmetG.visible = role === 'batter' || role === 'runner';
    if (role !== 'catcher' && role !== 'ump') this.capG.visible = !this.helmetG.visible;
    this.bat.visible = role === 'batter';
    if (!['catcher', 'ump'].includes(role)) this.glove.visible = role !== 'batter' && role !== 'runner';
  }
  placeBat() { /* 배트는 오른손 뼈에 붙어 있음 */ }
  batPoint(t, out) { return this.bat.localToWorld(out.set(0, t, 0)); }
  ik() {} lookAt() {} applyPose() {}
  dispose() { this.char.dispose(); }
}

// ── 새 몸 애니메이터: 옛 Animator 와 같은 호출 → 클립 재생 ──
export class ClipAnimator {
  constructor(p) { this.p = p; this.c = p.char; this.ev = {}; this.loco = 'idle'; this.gk = 0; this.pk0 = -1; this.call = null; this.t = 0; }
  _loco(speed, base) {
    const C = this.c; let st = this.loco;
    if (st === 'sprint') { if (speed < 5.4) st = speed > 0.35 ? 'run' : base; }
    else if (st === 'run') { if (speed > 6.2 && C.has('sprint')) st = 'sprint'; else if (speed < 0.35) st = base; }
    else st = speed > 0.6 ? 'run' : base;
    if (st === 'run' || st === 'sprint') C.play(st, { fade: 0.22, speed: clamp(speed / (CLIPS[st].speed || 4), 0.55, 1.7), sync: true });
    else C.play(st, { fade: 0.3 });
    this.loco = st;
  }
  fielder(dt, c) {
    motionEvents(this.ev, this.p, 'fielder', c);
    const C = this.c, P = this.p;
    if (c.clip) C.play(c.clip);
    else if (c.celebrate || (c.ground === undefined && c.jumpK >= 0 && !c.ballW && !c.reachW)) C.play('celebrate', { fade: 0.3 });
    else if (c.diveK >= 0) C.scrubK('dive', c.diveK);
    else if (c.throwK >= 0) C.scrubK('throw', c.throwK);
    else if (c.jumpK >= 0) C.scrubK('catchHigh', c.jumpK);
    else if (c.ground && c.speed < 3) { this.gk = Math.min(1, this.gk + dt / 0.5); C.scrubK('catchLow', this.gk); }
    else this._loco(c.speed || 0, c.ready || c.knees ? 'ready' : 'idle');
    if (!(c.ground && c.speed < 3)) this.gk = 0;
    P.ball.visible = c.throwK >= 0 ? c.throwK < 0.55 : !!c.hasBall;
    if (c.reachW && !(c.throwK >= 0)) C.reach('L', c.reachW, c.reachWeight ?? 1);
    if (c.ballW && !(c.diveK >= 0) && !(c.throwK >= 0)) C.look(c.ballW, 0.8);
    C.update(dt);
  }
  // c.k = anim.js pitchK(tau) (옛 호출) 또는 c.tau = 와인드업 시작부터 초(있으면 우선)
  pitcher(dt, c) {
    const C = this.c, P = this.p;
    let tau = Number.isFinite(c.tau) && c.tau >= 0 ? c.tau : -1;
    if (tau < 0 && c.k >= 0) {
      if (this.pk0 < 0) this.pk0 = 0;
      if (c.k === 0) { this.pk0 += dt; tau = Math.min(this.pk0, PITCH_TL.lift); } else tau = tauFromPitchK(c.k);
    }
    if (tau >= 0) { C.scrubPitch(tau); P.ball.visible = tau < PITCH_TL.release; }
    else {
      this.pk0 = -1;
      if ((c.speed || 0) > 0.5) this._loco(c.speed, 'idle');
      else { C.scrubPitch(0, { fade: 0.3 }); this.loco = 'idle'; }
      P.ball.visible = false;
      if (c.catchW && (c.speed || 0) < 0.5) C.reach('L', c.catchW, 1);
      if (c.lookW) C.look(c.lookW, 0.6);
    }
    C.update(dt);
  }
  batter(dt, c) {
    motionEvents(this.ev, this.p, 'batter', c);
    const C = this.c;
    // 타자마다 대기 자세를 조금씩 다르게(등번호로 고정) — 9명이 똑같이 서 있으면 어색함
    const who = String(c.who ?? this.p.look.num ?? '');
    if (!this.stance || this.who !== who) {
      this.who = who;
      const opts = ['batStance', 'batStance2', 'batStance3'].filter((n) => C.has(n));
      const h = [...who].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7);
      this.stance = opts[Math.abs(h) % opts.length] || 'batStance';
    }
    // 등장(인트로): 타석에 걸어 들어와 자리 잡기 → 끝나면 대기 자세
    if (c.intro && !this.stepT && C.has('batStepIn')) { this.stepT = 1e-6; C.play('batStepIn', { fade: 0.2, restart: true }); }
    if (this.stepT) { this.stepT += dt; if (!c.intro && this.stepT > 0.3) this.stepT = 0; }
    const stepping = this.stepT > 0 && this.stepT < (C.duration ? C.duration('batStepIn') : 3.7) - 0.25;
    if (c.bunt) C.play('buntStance', { fade: 0.25 });
    else if (c.swingK >= 0) C.scrubK(c.power ? 'powerSwing' : 'swing', c.swingK, { fade: 0.06 });
    else if (c.loadK > 0.02) C.scrubK('swing', 0.25 * clamp(c.loadK, 0, 1), { fade: 0.2 });
    else if (stepping) { /* 등장 동작 계속 */ }
    else C.play(this.stance, { fade: 0.35 });
    if (c.lookW && !(c.swingK >= 0)) C.look(c.lookW, 0.4);
    C.update(dt);
  }
  catcher(dt, c) {
    const C = this.c, P = this.p;
    if ((c.speed || 0) > 0.5) this._loco(c.speed, 'ready');
    else { C.play('catcherSquat', { fade: 0.3 }); this.loco = 'catcherSquat'; if (c.gloveW) C.reach('L', c.gloveW, 1); }
    P.ball.visible = !!c.hasBall;
    if (c.lookW) C.look(c.lookW, 0.7);
    C.update(dt);
  }
  ump(dt, c) {
    const C = this.c;
    const call = c.call || null;
    if (call && call !== this.call) C.play(call === 'safe' ? 'umpireSafe' : 'umpireCall', { fade: 0.15, restart: true });
    else if (!call) C.play(c.stand ? 'idle' : 'ready', { fade: 0.35 });
    this.call = call;
    if (c.lookW && !call) C.look(c.lookW, 0.6);
    C.update(dt);
  }
  runner(dt, c) {
    motionEvents(this.ev, this.p, 'runner', c);
    const C = this.c, sp = c.speed || 0;
    if (c.clip) C.play(c.clip);
    else if (c.slideK >= 0) C.scrubK('slide', c.slideK);
    else if (c.cheer && sp < 0.5) C.play('celebrate', { fade: 0.3 });
    else if (sp < 0.4 && c.lead) { C.play('ready', { fade: 0.3 }); this.loco = 'ready'; }
    else this._loco(sp, 'idle');
    if (c.lookW) C.look(c.lookW, 0.5);
    C.update(dt);
  }
  idle(dt, c = {}) { this.c.play(c.clip || 'idle', { fade: 0.3 }); this.c.update(dt); }
}

// ── 배우 만들기 + 늦게 온 새 몸으로 바꿔 끼우기 ──
const legacy = new Set();
let started = false, failed = false;
const qs = () => (typeof location !== 'undefined' ? location.search : '');
function wantNew() {
  if (/[?&](noskin|legacy)\b/.test(qs())) return false;
  if (typeof window !== 'undefined' && window.HR_OFFLINE && !(window.HR_ASSETS && window.HR_ASSETS.glb)) return false;
  return true;
}
function startLoading() {
  if (started) return; started = true;
  if (!wantNew()) return;
  loadLib().then((lib) => {
    if (lib.incomplete && lib.incomplete.length) throw new Error('필수 클립 없음: ' + lib.incomplete.join(', ') + ' (?animlab 에서는 있는 클립을 볼 수 있음)');
    console.info('[anim] 새 캐릭터 사용 — 클립', lib.clips.size, '개'); upgradeAll();
  })
    .catch((e) => { if (e.message !== 'no-model') console.warn('[anim] 새 캐릭터 못 씀 → 옛 몸 유지:', e.message); failed = true; legacy.clear(); });
  if (/[?&]animlab\b/.test(qs())) import('./lab.js').then((m) => m.openLab()).catch((e) => console.warn('[anim] lab', e));
}
function shadows(p) { p.root.traverse((o) => { if (o.isMesh) { const g = o.geometry, n = g ? (g.index ? g.index.count : g.attributes.position.count) / 3 : 0; o.castShadow = o.isSkinnedMesh || n > 400; } }); }
function buildNew(lib, opts) { const p = new CharPlayer(lib, opts); p.setRole(opts.role || 'fielder'); return { p, a: new ClipAnimator(p) }; }
// 작은 장식(모자 실밥·밴드 등)은 그림자 생략 → 그림자 패스 드로우콜 절반 (옛 main.js mkActor 와 같음)
export function makeActor(opts, scene) {
  startLoading();
  const lib = getLib();
  const A = { init: false, spd: 0, px: 0, pz: 0, opts };
  if (lib) { Object.assign(A, buildNew(lib, opts)); }
  else {
    const p = new Player(opts); p.setRole(opts.role || 'fielder'); attachSkin(p);
    A.p = p; A.a = new LegacyAnimator(p);
    for (const x of legacy) if (!x.p.root.parent) legacy.delete(x);
    if (!failed && wantNew()) legacy.add(A);
  }
  shadows(A.p);
  scene.add(A.p.root);
  return A;
}
function upgradeAll() {
  const lib = getLib(); if (!lib) return;
  for (const A of legacy) {
    const old = A.p, parent = old.root.parent;
    if (!parent) continue;
    const n = buildNew(lib, A.opts);
    n.p.setRole(old.role);
    n.p.root.position.copy(old.root.position); n.p.root.rotation.copy(old.root.rotation); n.p.root.visible = old.root.visible;
    for (const k of ['capG', 'helmetG', 'maskG', 'glove', 'bat']) n.p[k].visible = old[k].visible;
    for (const ch of [...old.root.children]) if (ch.isSprite) n.p.root.add(ch); // 이름표
    shadows(n.p);
    parent.remove(old.root); parent.add(n.p.root);
    A.p = n.p; A.a = n.a;
  }
  legacy.clear();
}
export const usingNewCharacter = () => !!getLib();
