// actor.js — main.js 가 쓰는 '배우' 만들기. 새 캐릭터(GLB)가 준비됐으면 Character, 아니면 옛 몸(body.bin + 절차 애니메이션).
// · main.js 는 지금처럼 A.p(root·ball·bat·glove·capG·helmetG·maskG·batPoint)와 A.a.fielder/pitcher/batter/… 만 쓴다.
// · 새 GLB 가 늦게 도착하면, 이미 만든 옛 배우들도 그 자리에서 새 캐릭터로 바꿔 끼운다(upgrade).
// · 동작 시작 이벤트(사운드용, 화면에서 모션이 시작되는 순간): cue:swing {power, bunt} / cue:dive {x,z} / cue:slide {x,z}
//   (서버 판정 이벤트 swing/dive/slide 는 gameplay 가 같은 이름으로 보내므로 겹치지 않게 'cue:' 접두사(총괄 지정))
import * as THREE from 'three';
const _bq = new THREE.Quaternion(), _be = new THREE.Euler(), _bq2 = new THREE.Quaternion(), _bqI = new THREE.Quaternion(); // [motion] 핸드폰 배트 연동
import { Player, UNIFORMS } from '../player.js';
import { attachSkin } from '../skinned.js';
import { Animator } from '../anim.js';
import { bus } from '../core/bus.js';
import { Character, tintedMaterial } from './character.js';
import { loadLib, getLib } from './loader.js';
import { CLIPS, FIT, BODY } from './clips.js';
import { PITCH_TL, tauFromPitchK } from './timing.js';
import { D, now, since, mood, rnd, hash } from './director.js'; // [motion]
import { mirrorName } from './procedural.js'; // [lefty]

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
    this.team = team; this.role = role; this.isChar = true; this.seed = seed; // [motion] seed: 선수별 동작 버릇
    this.scale = 0.96 + rnd(3) * 0.08;
    this.look = { u, num, name };
    this.char = new Character(lib, { colors: u, num: team === 'ump' ? '' : num, name, scale: this.scale, seed });
    this.root = this.char.root; this.body = this.char.body; this.J = {};
    const C = this.char;
    this.capG = C.attach('head', tint(lib.acc.cap.clone(), u.cap, FIT.cap.tint || 'all'));
    this.helmetG = C.attach('head', tint(lib.acc.helmet.clone(), u.cap, FIT.helmet.tint || 'all')); this.helmetG.visible = false;
    // [lefty] 헬멧 거울용: 장비 내용을 캐릭터 공간 원점의 그룹에 넣어 두고 좌타면 x 배율 −1 (귀가리개가 오른쪽 귀로)
    this.helmetFlip = new THREE.Group(); for (const ch of [...this.helmetG.children]) this.helmetFlip.add(ch); this.helmetG.add(this.helmetFlip);
    this.maskG = C.attach('head', maskGroup(lib)); this.maskG.visible = false;
    this.glove = C.attach('handL', (role === 'catcher' ? lib.acc.gloveC : lib.acc.glove).clone());
    const bh = C.attach('handR', lib.acc.bat.clone());
    this.bat = bh.getObjectByName('batFrame') || bh; this.bat.visible = false;
    // [lefty] 좌타 배트: 같은 배트를 캐릭터 공간에서 x 거울(오른손 자리 → 왼손 자리)로 왼손 뼈에. 거울 클립과 함께 쓰면 우타 배트의 정확한 거울
    const bl = lib.acc.bat.clone(), flip = new THREE.Group(); flip.scale.x = -1; for (const ch of [...bl.children]) flip.add(ch); bl.add(flip);
    C.attach('handL', bl); this.batR = this.bat; this.batL = bl.getObjectByName('batFrame') || bl; this.batL.visible = false; this.hand = 1;
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.037, 10, 8), new THREE.MeshStandardMaterial({ color: '#f7f5ef', roughness: 0.5 }));
    this.ball.visible = false;
    const bp = new THREE.Vector3().setFromMatrixPosition(lib.rest.get('RightHand')).add(_v.set(...FIT.ball.pos));
    this.ball.userData.rest = new THREE.Matrix4().makeTranslation(bp.x, bp.y, bp.z).toArray();
    C.attach('handR', this.ball);
    for (const g of [this.capG, this.helmetG, this.maskG, this.glove, this.bat, this.batL, this.ball]) g.userData.acc = true;
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
  // [lefty] 타석 방향: 1 우타 · -1 좌타 → 배트 손·헬멧 귀가리개 거울 (클립 거울은 ClipAnimator._m)
  setHand(h) {
    h = h < 0 ? -1 : 1; if (h === this.hand) return;
    const vis = this.bat.visible; this.bat.visible = false;
    this.hand = h; this.bat = h < 0 ? this.batL : this.batR; this.bat.visible = vis;
    this.helmetFlip.scale.x = h;
  }
  batPoint(t, out) { return this.bat.localToWorld(out.set(0, t, 0)); }
  ik() {} lookAt() {} applyPose() {}
  dispose() { this.char.dispose(); }
}

// ── 새 몸 애니메이터: 옛 Animator 와 같은 호출 → 클립 재생 ──
// [motion] 상황별 모션: director.js 가 기록한 이벤트(스윙·삼진·홈런·경기 끝 …)를 읽어 같은 호출 안에서 클립을 고른다.
//  · 판정·시간표는 그대로: 스윙 컨택 = swingK 0.5(main.js 가 sim 스윙 시각으로 줌), 투구 릴리스 = 와인드업 + 1.85초(timing.js), 송구 릴리스 = throwK 0.55
//  · 변주는 선수·타자별 시드(같은 선수는 같은 버릇, 멀티에서 화면마다 같게). 매 프레임 할당 없음
//  · 한 번 재생 동작(shot): 입장·삼진 반응·주먹 불끈 등. 새 투구(windup)가 오면 바로 끊고 기본 자세로 크로스페이드
export class ClipAnimator {
  constructor(p) {
    this.p = p; this.c = p.char; this.ev = {}; this.loco = 'idle'; this.gk = 0; this.pk0 = -1; this.call = null; this.t = 0;
    this.seed = Number.isFinite(p.seed) ? p.seed : Math.random() * 1e4;
    p.root.userData.anim = this; // [qa] 하네스·스크린샷이 지금 클립을 읽음(tools/qa/motionshots.mjs)
    this.shot = null; this.queue = null; this.wSeen = D.windup.at;
    // 투구 사이 버릇(mill — Baseball_Milling_Idle): 선수마다 빈도 다르게, 처음엔 흩어서
    this.fidRate = 0.4 + rnd(this.seed, 11) * 0.6; this.fidOn = false; this.fidEnd = 0;
    this.fidNext = now() + 3 + rnd(this.seed, 12) * 9;
  }
  // 한 번 재생: from(클립 초)부터 speed 배속으로 dur 초 동안(기본 = 끝까지). 클립이 없으면 fallback 사슬
  _shot(name, { from = 0, speed = 1, dur = null, fade = 0.25, kind = '' } = {}) {
    const C = this.c;
    C.play(name, { fade, restart: true, from, speed });
    this.shot = { name, speed, kind, until: now() + (dur ?? Math.max(0.2, (C.duration(name) - from) / speed - fade)) };
  }
  // 차례로: [[이름, from, speed, dur], ...]
  _seq(list, kind) { this.queue = list.slice(1); const [n, f, s, d] = list[0]; this._shot(n, { from: f, speed: s, dur: d, kind, fade: 0.3 }); }
  _shotOn() {
    const s = this.shot; if (!s) return false;
    if (now() < s.until) { this.c.play(s.name, { speed: s.speed }); return true; }
    if (this.queue && this.queue.length) { const [n, f, sp, d] = this.queue.shift(); this._shot(n, { from: f, speed: sp, dur: d, kind: s.kind, fade: 0.35 }); return true; }
    this.shot = null; this.queue = null; return false;
  }
  _cut() { this.shot = null; this.queue = null; }
  // [lefty] 좌타자면 타자 클립을 거울 클립(<이름>_L, 처음 쓸 때 만듦)으로
  _m(n) { return this.p.hand < 0 ? mirrorName(this.c.lib, CLIPS, n) : n; }
  // 새 투구 시작 → 하던 한 번 재생 동작을 끊음(타자는 대기 자세, 심판은 자세)
  _newPitch() { if (D.windup.at !== this.wSeen) { this.wSeen = D.windup.at; this._cut(); return true; } return false; }
  // 서 있는 대기: 가끔 서성임(mill) 한 번 → 다시 대기
  _idle(base) {
    if (base !== 'idle' || this.noFid || !this.c.has('mill')) { this.fidOn = false; return base; }
    const t = now();
    if (this.fidOn) { if (t < this.fidEnd) return 'mill'; this.fidOn = false; this.fidNext = t + (5 + rnd(this.seed, t | 0) * 10) / this.fidRate; return 'idle'; }
    if (t >= this.fidNext) { this.fidOn = true; this.fidEnd = t + this.c.duration('mill') - 0.5; this.c.play('mill', { fade: 0.5, restart: true }); return 'mill'; }
    return 'idle';
  }
  // 경기 끝·끝내기: 이긴 팀 Victory, 진 팀 Defeated (서 있을 때만)
  _mood(speed) {
    if (speed > 0.5) return false;
    const m = mood(this.p.team); if (!m) return false;
    this.c.play(m === 'win' ? 'celebrate' : 'disappointed', { fade: 0.45, from: m === 'win' ? 0.9 + rnd(this.seed, 41) * 0.8 : rnd(this.seed, 42) * 0.4 }); // 세리머니는 동작 있는 구간부터(선수마다 조금씩 어긋나게)
    return true;
  }
  _loco(speed, base) {
    const C = this.c; let st = this.loco;
    if (st === 'sprint') { if (speed < 5.4) st = speed > 0.35 ? 'run' : base; }
    else if (st === 'run') { if (speed > 6.2 && C.has('sprint')) st = 'sprint'; else if (speed < 0.35) st = base; }
    else st = speed > 0.6 ? 'run' : base;
    // 재생 속도 = 실제 속도/클립 원래 속도. 너무 느리게 돌리면 슬로모션처럼 보여서(조깅도 발 구르는 템포는 빠름) 최소 0.8
    if (st === 'run' || st === 'sprint') { this.fidOn = false; C.play(st, { fade: 0.22, speed: clamp(speed / (CLIPS[st].speed || 4), 0.8, 1.7), sync: true }); }
    else { const b = this._idle(st); C.play(b, { fade: b === 'mill' ? 0.5 : 0.35 }); }
    this.loco = st;
  }
  // [model] 투수판 맞춤: 루트(sim 투수 위치 = 투수판 가운데)에서 몸을 앞(+z 로컬)으로 BODY.pitchFwd 만큼 — 클립의 축발이 투수판 앞 모서리에 붙게
  _fwd(on, dt) { const b = this.c.body.position, t = on ? BODY.pitchFwd : 0; if (b.z !== t) b.z = Math.abs(t - b.z) < 1e-3 ? t : b.z + (t - b.z) * Math.min(1, dt * 8); }
  fielder(dt, c) {
    motionEvents(this.ev, this.p, 'fielder', c);
    const C = this.c, P = this.p, sp = c.speed || 0;
    this._fwd(false, dt);
    const busy = c.diveK >= 0 || c.throwK >= 0 || c.jumpK >= 0 || (c.ground && sp < 3) || c.highK >= 0;
    const isC = P.role === 'catcher';
    if (busy || sp > 0.8) this._cut();
    else {
      // 투수: 홈런 맞으면 고개 숙임(Defeated) / 포수: 뜬공 잡은 뒤 머리 위 글러브를 내림(Catcher 클립 2.95초~)
      if (this.isP && since(D.hr) < 3 && this.hrSeen !== D.hr.at) { this.hrSeen = D.hr.at; this._shot('disappointed', { from: 0.6, dur: 3.4, fade: 0.45 }); }
      if (isC && D.catchC.fly && since(D.catchC) < 0.6 && this.popSeen !== D.catchC.at) { this.popSeen = D.catchC.at; this._shot('catcherPop', { from: 0.55, fade: 0.15 }); }
    }
    if (c.clip) C.play(c.clip);
    else if (c.celebrate || (c.ground === undefined && c.jumpK >= 0 && !c.ballW && !c.reachW)) C.play('celebrate', { fade: 0.3, from: 0.9 + rnd(this.seed, 43) * 0.8 }); // [motion] Victory 앞 1초는 가만히 서 있는 구간
    else if (c.diveK >= 0) C.scrubK('dive', c.diveK);
    // 포수 송구는 Baseball_Catcher 의 짧은 팔 송구(일어서며), 야수는 투구 동작 송구
    else if (c.throwK >= 0) C.scrubK(isC && C.has('catcherThrow') ? 'catcherThrow' : 'throw', c.throwK, { fade: isC ? 0.15 : 0.12 });
    else if (c.jumpK >= 0) C.scrubK('catchHigh', c.jumpK);
    else if (c.ground && sp < 3) { this.gk = Math.min(1, this.gk + dt / 0.5); C.scrubK('catchLow', c.groundK >= 0 ? Math.max(c.groundK, Math.min(this.gk, 0.5)) : this.gk, { fade: 0.15 }); } // [motion2] 다가오는 공 거리로 숙임
    else if (c.highK >= 0) C.scrubK('catchHigh', c.highK, { fade: 0.18 }); // [motion2] 높은 공 포구(절차적 catchHigh — FBX 받으면 그걸로)
    else if (this._shotOn()) { /* 한 번 재생 동작 */ }
    else if (!this._mood(sp)) this._loco(sp, c.ready || c.knees ? 'ready' : 'idle');
    if (!(c.ground && sp < 3)) this.gk = 0;
    P.ball.visible = c.throwK >= 0 ? c.throwK < 0.55 : !!c.hasBall;
    if (c.reachW && !(c.throwK >= 0)) C.reach('L', c.reachW, c.reachWeight ?? 1);
    if (c.ballW && !(c.diveK >= 0) && !(c.throwK >= 0)) C.look(c.ballW, 0.8);
    C.update(dt);
  }
  // 투구 변주: 주자 있으면 세트 포지션(Baseball_Pitching — 낮은 레그킥), 없으면 투수 버릇(대부분 하이 레그킥 Pitching_1)
  //  ※ 구종으로는 고르지 않음(와인드업 모양으로 구종이 미리 보이면 안 됨 — 공 위치·구종 미리보기 금지)
  _pitchVariant() {
    if (!this.c.has('pitch2')) return 'pitch';
    if (D.windup.runners > 0 && since(D.windup) < 3) return 'pitch2';
    return rnd(this.seed, 31) < 0.3 ? 'pitch2' : 'pitch';
  }
  // c.k = anim.js pitchK(tau) (옛 호출) 또는 c.tau = 와인드업 시작부터 초(있으면 우선)
  pitcher(dt, c) {
    const C = this.c, P = this.p, sp = c.speed || 0;
    this.isP = true;
    let tau = Number.isFinite(c.tau) && c.tau >= 0 ? c.tau : -1;
    if (tau < 0 && c.k >= 0) {
      if (this.pk0 < 0) this.pk0 = 0;
      if (c.k === 0) { this.pk0 += dt; tau = Math.min(this.pk0, PITCH_TL.lift); } else tau = tauFromPitchK(c.k);
    }
    this._fwd(tau >= 0 || sp <= 0.5, dt);
    if (tau >= 0) {
      if (!this.inPitch) { this.inPitch = true; this.pv = this._pitchVariant(); this.pvAt = D.windup.at; this._cut(); }
      // [net 예측] 내 투구는 누른 순간(서버 windup 이벤트 전) 시작 → 이벤트(주자 정보)가 세트 자세 동안 오면 그때 변주를 다시 고름
      else if (this.pvAt !== D.windup.at && tau < PITCH_TL.lift) { this.pvAt = D.windup.at; this.pv = this._pitchVariant(); }
      C.scrubPitch(tau, undefined, this.pv); P.ball.visible = tau < PITCH_TL.release;
    } else {
      this.inPitch = false; this.pk0 = -1;
      // 삼진 잡으면 주먹 불끈(Victory 1.05초~): 이닝 끝내는 삼진은 항상, 아니면 투수 버릇대로
      if (since(D.kOut) < 2 && this.kSeen !== D.kOut.at) {
        this.kSeen = D.kOut.at;
        if (D.kOut.outs >= 3 || rnd(this.seed, 21 + ((D.kOut.at * 10) | 0)) < 0.45) this._shot('celebrate', { from: 1.05, speed: 1.15, dur: 1.9, fade: 0.3 });
      }
      if (sp > 0.5) { this._cut(); this._loco(sp, 'idle'); }
      else if (this._shotOn()) { /* 세리머니 */ }
      else { C.scrubPitch(0, { fade: 0.3 }, this.pv || 'pitch'); this.loco = 'idle'; }
      P.ball.visible = false;
      if (c.catchW && sp < 0.5 && !this.shot) C.reach('L', c.catchW, 1);
      if (c.lookW && !this.shot) C.look(c.lookW, 0.6);
    }
    C.update(dt);
  }
  // 스윙 고르기(스윙이 시작되는 프레임에 한 번): 강타 = Hit_1, 정타(good·perfect) = Hit(끝까지 크게), 늦거나 빗맞음 = Hit_2(짧게 밀어침)
  //  CPU·상대 타자는 스윙 시각에 판정 이벤트가 같이 오고, 내 스윙은 localSwing(누른 즉시, 맞았는지 포함)이 먼저 와서 첫 프레임에 이미 앎
  _pickSwing(c) {
    const C = this.c, S = D.sw, fresh = since(S) < 1.5;
    if ((c.power || (fresh && S.mode === 'power')) && C.has('powerSwing')) return 'powerSwing';
    if (!C.has('swing2')) return 'swing';
    if (fresh) {
      if (S.grade === 'perfect' || S.grade === 'good') return 'swing';
      if (S.grade === 'weak' || S.grade === 'tip' || S.grade === 'ok' || S.dt > 45 || S.why === 'late') return 'swing2';
      if (S.why === 'early') return 'swing';
    }
    return this.swPref < 0.35 ? 'swing2' : 'swing';
  }
  // 타자 반응: 삼진(헛스윙 → Strike 반응 또는 Defeated / 루킹 → 가끔 Defeated) 뒤 Walk_Out, 헛스윙(삼진 아님)은 가끔 Strike 반응
  _batReact() {
    const C = this.c;
    if (this.shot && this.shot.kind === 'react') return;
    if (since(D.kOut) < 2.5 && this.kSeen !== D.kOut.at) {
      const swung = !D.kOut.looking;
      if (since(D.kOut) < (swung ? 0.42 : 0.3)) return; // 스윙 팔로스루가 끝난 뒤
      this.kSeen = D.kOut.at;
      const L = [];
      if (swung) L.push(this.kStyle < 0.6 && C.has('batStrike') ? [this._m('batStrike'), 0, 1.45, 1.15] : ['disappointed', 0.75, 1.25, 1.25]);
      else if (this.kStyle < 0.5) L.push(['disappointed', 0.75, 1.2, 1.1]);
      L.push([this._m('batWalkOut'), 0, 1, 3.2]);
      this._seq(L, 'react');
    } else if (since(D.strike) < 1.2 && D.strike.swinging && !D.strike.k && this.sSeen !== D.strike.at && since(D.strike) > 0.4) {
      this.sSeen = D.strike.at;
      if (C.has('batStrike') && rnd(this.seedB, (D.strike.at * 10) | 0) < 0.4) this._seq([[this._m('batStrike'), 0, 1.5, 1.6]], 'react');
    }
  }
  batter(dt, c) {
    motionEvents(this.ev, this.p, 'batter', c);
    const C = this.c;
    // 타자가 바뀌면: 대기 자세·템포·스윙 버릇을 타자별로(이름/id 해시) + 타석 입장(Walk_In 또는 Step_In)
    const who = String(c.who ?? this.p.look.num ?? '');
    if (this.who !== who) {
      const first = this.who === undefined;
      this.who = who; const h = hash(who); this.seedB = h;
      const opts = ['batStance', 'batStance2', 'batStance3'].filter((n) => C.has(n));
      this.stance = opts[h % Math.max(1, opts.length)] || 'batStance';
      this.stSpeed = 0.85 + rnd(h, 1) * 0.3; // Idle_1·Idle_2 는 원본 동작이 같아서 템포로도 구분
      this.swPref = rnd(h, 2); this.kStyle = rnd(h, 3);
      this.kSeen = D.kOut.at; this.sSeen = D.strike.at; this.wSeen = D.windup.at; this._cut();
      const ent = rnd(h, 4) < 0.55 && C.has('batWalkIn') ? 'batWalkIn' : C.has('batStepIn') ? 'batStepIn' : null;
      // 입장은 3.6초 안에 끝나게(CPU 투수 첫 공까지 3.4~4.3초 + 와인드업) — 와인드업이 먼저 오면 바로 대기 자세로
      if (ent) { const s = ent === 'batWalkIn' ? 1.3 : 1.05; this._shot(this._m(ent), { speed: s, fade: first ? 0 : 0.3, kind: 'enter' }); }
    }
    this._newPitch();
    const swinging = c.swingK >= 0;
    if (swinging && !this.wasSw) this.swClip = this._m(this._pickSwing(c));
    this.wasSw = swinging;
    if (!swinging || c.swingK >= 1) this._batReact();
    const sw0 = this._m('swing');
    if (c.bunt && !this.shot) C.play(this._m('buntStance'), { fade: 0.25 });
    else if (swinging && (c.swingK < 1 || !this.shot)) { this._cut(); C.scrubK(this.swClip || sw0, c.swingK, { fade: this.swClip && this.swClip !== sw0 ? 0.08 : 0.05 }); }
    else if (this._shotOn()) { /* 입장·반응 */ }
    else if (c.loadK > 0.02) C.scrubK(sw0, 0.25 * clamp(c.loadK, 0, 1.12), { fade: 0.25 }); // [anim] 1.12 = 출발(launch) 직전까지 스트라이드
    else C.play(this._m(this.stance), { fade: 0.35, speed: this.stSpeed });
    if (c.lookW && !(swinging) && !this.shot) C.look(c.lookW, 0.4);
    // [model 11-23] 두 손 그립: 대기·준비·스윙(임팩트까지)은 두 손, 팔로스루 끝에서 한 손 놓음. 입장·반응 동작 중엔 안 함
    { const P = this.p, top = P.hand < 0 ? 'L' : 'R', side = top === 'L' ? 'R' : 'L';
      let w = this._shotOn() && !swinging ? 0 : 1;
      if (swinging) w = c.swingK < 0.6 ? 1 : clamp(1 - (c.swingK - 0.6) / 0.14, 0, 1);
      this.gripW = (this.gripW ?? w) + (w - (this.gripW ?? w)) * Math.min(1, dt * 14);
      // [motion] 핸드폰 기울기 → 배트 각도 (손목 기준으로 배트를 돌리고 다른 손은 그립 IK가 따라감). 스윙 중엔 스윙 면 기울기만 약하게
      if (P.bat) { const b = P.bat; if (!b.userData.q0) b.userData.q0 = b.quaternion.clone();
        const o = c.batOff, k = swinging ? 0.45 : 1, Q = c.batQ;
        if (Q) { _bq2.set(Q[0], Q[1], Q[2], Q[3]); if (k < 1) _bq2.slerp(_bqI, 1 - k); b.quaternion.copy(b.userData.q0).multiply(_bq2); C.motionBody(b, top, k); } // [위 방식] 핸드폰 3D 방향 그대로 + 상체가 따라감
        else if (o) { _be.set(clamp(o[0], -0.95, 0.95) * k, 0, clamp(o[1], -0.8, 0.8) * k); b.quaternion.copy(b.userData.q0).multiply(_bq.setFromEuler(_be)); } else b.quaternion.copy(b.userData.q0); }
      if (c.pose) C.motionPose(c.pose, 1, !!c.poseMir); // [motion] 웹캠 전신: 내 몸 그대로
      if (P.bat && P.bat.visible && this.gripW > 0.01) C.grip(P.bat, side, top, this.gripW); }
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
  // 심판: 주심은 투구 시작 ~ 공 도착까지 무릎 짚은 자세(Umpire 클립 첫 자세), 스트라이크 콜은 Umpire 콜 구간(0.45초~)을 끝까지,
  //  삼진 콜은 조금 느리게(힘 줘서). 루심 아웃 콜도 같은 콜 동작. 세이프는 umpireSafe(FBX 없으면 procedural.js 절차적 클립: 팔 교차 → 양옆).
  ump(dt, c) {
    const C = this.c, t = now(), home = !c.stand;
    const call = c.call || null;
    if (call && call !== this.call) {
      if (call === 'safe' && !C.has('umpireSafe')) this.callUntil = 0;
      else {
        const k = call === 'strike' && since(D.strike) < 1.5 && D.strike.k;
        const s = k ? 0.85 : 1.1, from = call === 'safe' ? 0 : call === 'strike' ? 0.45 : 0.55;
        const nm = call === 'safe' ? 'umpireSafe' : 'umpireCall';
        C.play(nm, { fade: 0.12, restart: true, from, speed: s });
        this.callUntil = t + Math.max(0.6, (C.duration(nm) - (call === 'safe' ? 0.15 : 0.45) - from) / s); // [motion2] 세이프는 팔 내리는 데까지
      }
    }
    this.call = call;
    const calling = t < (this.callUntil || 0);
    if (!calling) {
      if (home && since(D.windup) < 3.4 && C.has('umpireCall')) C.scrub('umpireCall', 0.22, { fade: 0.35 });
      else if (!this._mood(0)) C.play(c.stand ? 'idle' : 'ready', { fade: 0.4 });
    }
    if (c.lookW && !calling) C.look(c.lookW, 0.6);
    C.update(dt);
  }
  runner(dt, c) {
    motionEvents(this.ev, this.p, 'runner', c);
    const C = this.c, sp = c.speed || 0;
    this.noFid = true; // 주자는 서성임 없이(타격 직후 홈에서 서성이면 어색)
    if (c.clip) C.play(c.clip);
    else if (c.slideK >= 0) C.scrubK('slide', c.slideK);
    else if (c.cheer && sp < 0.5) C.play('celebrate', { fade: 0.3, from: 0.9 + rnd(this.seed, 44) * 0.8 });
    else if (this._mood(sp)) { /* 경기 끝 */ }
    else if (sp < 0.4 && c.lead) { C.play('ready', { fade: 0.3 }); this.loco = 'ready'; }
    else this._loco(sp, 'idle');
    if (c.lookW) C.look(c.lookW, 0.5);
    C.update(dt);
  }
  // 코치·덕아웃·세리머니 대기: Breathing_Idle + 가끔 서성임, 경기 끝이면 팀 분위기
  idle(dt, c = {}) {
    if (c.clip) this.c.play(c.clip, { fade: 0.3 });
    else if (!this._mood(0)) { const b = this._idle('idle'); this.c.play(b, { fade: b === 'mill' ? 0.5 : 0.3 }); }
    this.c.update(dt);
  }
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
