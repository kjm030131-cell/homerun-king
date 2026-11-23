// main.js — 홈런왕 클라이언트
import * as THREE from 'three';
import {
  Game, HIT_EASE, pitchPos, integrate, fenceR, BASES, MOUND, ZONE, PITCHES, PITCH_KEYS, POS_KO, HOME_SPOT, FOUL, SPRINT_SPEED, FIELD_SPEED,
  RELEASE, WINDUP, SWING, PCI, BALL_R, runnerXZ, RULES, inZone, // [gameplay] RULES: 모드별 퍼펙트 투구 구간 · PCI 타격 · [pitch] inZone: 지나간 공 볼/스트 색
} from '../shared/sim.js';
import { Player, UNIFORMS, setFaceTextures } from './player.js';
import { loadSkin, attachSkin, syncAllSkins } from './skinned.js';
import { Replay } from './replay.js';
import { makeActor, usingNewCharacter } from './anim/actor.js'; // [anim] ([qa] usingNewCharacter: 팀 캐시 확인용)
import { CLUBS, clubOf, emblemURL, uniformsFor } from './emblem.js';
import { TEX_AVG, FACE_SKINS } from './texinfo.js';
import { Animator, PITCH_DUR, PITCH_RELEASE_K, THROW_DUR, swingTrack, pitchK } from './anim.js';
import { buildStadium, glowTex, createLook } from './stadium.js'; // [stadium] 구장 + 조명·톤매핑·블룸(look)
import { groundY } from './stadium/field.js'; // [model] 마운드 위 선수 발 높이
import { FX } from './fx.js';
import { initAudio, setVolume, unlock as audio } from './audio/index.js'; // [audio] 사운드 매니저 (서버 이벤트 + cue:* 로만 소리)
// [ui] 화면·HUD·설정은 client/ui/ (createUI 하나로 연결)
import { createUI, cfg, store, TOUCH, banner, feedback, toast, castLine, addChat, sysChat, myDuty, paintClubs, swingReport, saveLocalCareer } from './ui/index.js';
import { bus } from './core/bus.js'; // [gameplay] 게임 이벤트 → bus
import { createPCI, judgeSwing } from './game/batting.js'; // [gameplay] PCI 타격
import { createBallLook } from './game/ball.js'; // [pitch] 실밥·구종별 회전축
import { createNetInterp, mergeBall, stepBall, rkey } from './net/interp.js'; // [net] 서버 시계·보간 버퍼·외삽·공 합류 (tools/qa/netbench.mjs 로 측정)
import { createSnapMerger } from './net/snap.js'; // [net] 서버가 바뀐 키만 보냄 → 합치기

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const nowP = () => performance.now() / 1000;
// [ui] 설정·localStorage·TOUCH 는 client/ui/settings.js 로 옮김 (cfg/store 는 위 import)
const fcam = { yawOff: 0, pitchOff: 0, dragT: 0, yaw: null };
setVolume(cfg.vol / 100);
initAudio(); // [audio]

// ═════════════ 렌더러 ═════════════
const canvas = $('c');
const glOK = (() => { try { const t = document.createElement('canvas'); return !!(t.getContext('webgl2') || t.getContext('webgl')); } catch { return false; } })();
if (!glOK) {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(5,9,20,.88);padding:16px;font-family:inherit';
  d.innerHTML = `<div style="max-width:440px;background:#0e1422;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:24px 22px;color:#e8ecf4;line-height:1.6">
    <div style="font-size:20px;font-weight:800;margin-bottom:8px">3D 그래픽을 켤 수 없어요</div>
    <div style="font-size:14px;color:#aab3c5">이 브라우저에서 WebGL(그래픽 가속)이 꺼져 있어서 경기장을 그릴 수 없어요.<br><br>
    <b style="color:#fff">크롬</b>: 설정 → 시스템 → <b style="color:#ffd23a">"가능한 경우 그래픽 가속 사용"</b> 켜기 → 크롬 다시 시작<br>
    그래도 안 되면 주소창에 <code style="color:#ffd23a">chrome://gpu</code> 에서 WebGL 상태를 확인하거나 사파리/다른 브라우저로 열어봐.</div>
    <button onclick="location.reload()" style="margin-top:18px;width:100%;padding:12px;border:0;border-radius:10px;background:#ff6a2b;color:#111;font-weight:800;font-size:15px;cursor:pointer">다시 시도</button></div>`;
  document.body.appendChild(d);
  throw new Error('WebGL unavailable');
}
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.15, 7500);
window.__camera = camera;
camera.position.set(0, 60, -100);
// [stadium] 톤매핑·조명(해/조명탑)·그림자·안개·블룸·환경광·낮밤은 client/stadium/look.js
const look = createLook(renderer, scene, camera);
function applyTimeOfDay(mode) { look.setTimeOfDay(mode, stadium); } // [stadium]
function applyQuality() { // [stadium]
  look.setQuality(cfg.gq); stadium.setQuality(cfg.gq);
  scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  resize();
}
function resize() {
  const w = innerWidth, h = innerHeight;
  look.resize(w, h); // [stadium]
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

const AD_N = 22;
const adURLs = (window.HR_ASSETS && window.HR_ASSETS.ads) || Array.from({ length: AD_N }, (_, i) => `./assets/ads/ad${String(i + 1).padStart(2, '0')}.jpg`);
const TEX = (window.HR_ASSETS && window.HR_ASSETS.tex) || {
  dirt: { url: './assets/tex/dirt.jpg', avg: TEX_AVG.dirt },
  grass: { url: './assets/tex/grass.jpg', avg: TEX_AVG.grass },
  crowd: { url: './assets/tex/crowd.jpg' },
  skyDay: { url: './assets/tex/sky_day.jpg' },
  skyNight: { url: './assets/tex/sky_night.jpg' },
};
const stadium = buildStadium(scene, { quality: cfg.gq, ads: adURLs, tex: TEX });
setFaceTextures((window.HR_ASSETS && window.HR_ASSETS.faces) || FACE_SKINS.map((skin, i) => ({ url: `./assets/tex/face${i}.jpg`, skin })));
applyTimeOfDay(store.get('tod', 'night'));
const fx = new FX(scene);
applyQuality();

// ═════════════ 공 / 마커 ═════════════
const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * 1.6, 16, 12), new THREE.MeshStandardMaterial({ color: '#fbfaf5', roughness: 0.45, emissive: '#3a3a36' }));
ballMesh.castShadow = true; scene.add(ballMesh);
const ballLook = createBallLook(ballMesh); // [pitch] 실밥 텍스처 + 구종별 회전(슬라이더 빨간 점 등) — 위치 정보 없음
const ballGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#ffffff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.35 }));
ballGlow.scale.set(0.6, 0.6, 1); ballMesh.add(ballGlow);
const blob = new THREE.Mesh(new THREE.CircleGeometry(0.22, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.45, depthWrite: false }));
scene.add(blob);
const landRing = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.3, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ff8a3d', transparent: true, opacity: 0.85, depthWrite: false }));
landRing.position.y = 0.08; scene.add(landRing);
// 낙구 지점: 빛 기둥 + 남은 시간만큼 줄어드는 원 (내 수비수가 원 안이면 초록)
const landBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.55, 16, 20, 1, true), new THREE.MeshBasicMaterial({ color: '#ff8a3d', transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
landBeam.position.y = 8; landRing.add(landBeam);
const landFill = new THREE.Mesh(new THREE.CircleGeometry(1.0, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ff8a3d', transparent: true, opacity: 0.28, depthWrite: false }));
landFill.position.y = 0.01; landRing.add(landFill);
let landTotal = 1, landLeft = 0;
// 수비 가이드: 내 선수 → 잡을 지점까지 띠 (초록 = 뛰면 됨 / 노랑 = 다이빙 필요 / 빨강 = 어려움) + 땅볼 차단 지점 링
const guide = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5), new THREE.MeshBasicMaterial({ color: '#4fd18b', transparent: true, opacity: 0.55, depthWrite: false }));
guide.position.y = 0.06; guide.visible = false; scene.add(guide);
const relayRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.25, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#5bd0ff', transparent: true, opacity: 0.9, depthWrite: false }));
relayRing.position.y = 0.08; relayRing.visible = false; scene.add(relayRing);
const cutRing = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#5bd0ff', transparent: true, opacity: 0.85, depthWrite: false }));
cutRing.position.y = 0.07; cutRing.visible = false; scene.add(cutRing);
let cut = null, cutT = 0, divePromptT = 0;
const droppedBat = new THREE.Group(); scene.add(droppedBat); droppedBat.visible = false;
{
  const prof = [[0, 0], [0.024, 0], [0.015, 0.03], [0.0125, 0.1], [0.013, 0.3], [0.024, 0.52], [0.032, 0.68], [0.033, 0.82], [0, 0.86]].map(([r, y]) => new THREE.Vector2(r, y));
  const m = new THREE.Mesh(new THREE.LatheGeometry(prof, 12), new THREE.MeshStandardMaterial({ color: '#caa06a', roughness: 0.45 }));
  m.rotation.z = Math.PI / 2; m.position.y = 0.035; m.castShadow = true; droppedBat.add(m);
}
// 스트라이크존 / 커서 / 조준점
const zoneGroup = new THREE.Group();
let zoneMesh = null;
{
  const pts = [[ZONE.x0, ZONE.y0], [ZONE.x1, ZONE.y0], [ZONE.x1, ZONE.y1], [ZONE.x0, ZONE.y1]];
  const seg = []; for (let i = 0; i < 4; i++) { const a = pts[i], b = pts[(i + 1) % 4]; seg.push(new THREE.Vector3(a[0], a[1], 0), new THREE.Vector3(b[0], b[1], 0)); }
  for (let i = 1; i < 3; i++) { const x = ZONE.x0 + (ZONE.x1 - ZONE.x0) * i / 3, y = ZONE.y0 + (ZONE.y1 - ZONE.y0) * i / 3; seg.push(new THREE.Vector3(x, ZONE.y0, 0), new THREE.Vector3(x, ZONE.y1, 0), new THREE.Vector3(ZONE.x0, y, 0), new THREE.Vector3(ZONE.x1, y, 0)); }
  // 선 대신 캔버스 텍스처 판 한 장 → 안티앨리어싱 돼서 깨지거나 깜빡이지 않음
  const W = ZONE.x1 - ZONE.x0, H = ZONE.y1 - ZONE.y0, pad = 0.03;
  const c = document.createElement('canvas'); c.width = 512; c.height = Math.round(512 * (H + pad * 2) / (W + pad * 2));
  const g = c.getContext('2d'), sx = c.width / (W + pad * 2), px = pad * sx;
  const w = c.width - px * 2, h = c.height - px * 2;
  // 존 안쪽은 아주 옅게 채워서 배경(관중석·잔디)과 구분되게
  g.fillStyle = 'rgba(255,255,255,.075)'; g.fillRect(px, px, w, h);
  g.strokeStyle = 'rgba(255,255,255,.34)'; g.lineWidth = 2.5; g.setLineDash([10, 8]);
  for (let i = 1; i < 3; i++) { g.beginPath(); g.moveTo(px + w * i / 3, px + 6); g.lineTo(px + w * i / 3, px + h - 6); g.stroke(); g.beginPath(); g.moveTo(px + 6, px + h * i / 3); g.lineTo(px + w - 6, px + h * i / 3); g.stroke(); }
  g.setLineDash([]);
  g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 13; g.strokeRect(px, px, w, h);
  g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 6; g.strokeRect(px, px, w, h);
  // 모서리 꺾쇠(노란색) — 멀리서도 존 경계가 바로 보이게
  const L = Math.min(w, h) * 0.2; g.strokeStyle = '#ffd34a'; g.lineWidth = 10; g.lineCap = 'round';
  for (const [x, y, dx, dy] of [[px, px, 1, 1], [px + w, px, -1, 1], [px, px + h, 1, -1], [px + w, px + h, -1, -1]]) { g.beginPath(); g.moveTo(x + dx * L, y); g.lineTo(x, y); g.lineTo(x, y + dy * L); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const zp = zoneMesh = new THREE.Mesh(new THREE.PlaneGeometry(W + pad * 2, H + pad * 2), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
  zp.position.set((ZONE.x0 + ZONE.x1) / 2, (ZONE.y0 + ZONE.y1) / 2, 0); zp.rotation.y = Math.PI; zp.renderOrder = 5; zoneGroup.add(zp);
  void seg;
}
scene.add(zoneGroup);
// [gameplay] PCI(MLB 더쇼식 둥근 사각 커서) — client/game/batting.js. 판정 크기 그대로 그림(숨은 판정 없음, 타이밍 맞으면 판정만 조금 넓어짐)
const PCIv = createPCI(scene), pci = PCIv.group;
let pciHot = false;
const hitEase = () => (S && S.hx) || HIT_EASE[(S && S.he) ?? 1] || 1; // [gameplay] hx = 서버가 쓰는 실제 판정 배율(모드·난이도 반영)
const mode2 = () => (buntOn || (S && S.bs) ? 'bunt' : keys.f ? 'power' : 'contact');
// 타격 보조: 공이 들어올 위치 표시 + 줄어드는 타이밍 링
const assistDot = new THREE.Group();
{
  const f = new THREE.Mesh(new THREE.CircleGeometry(0.055, 24), new THREE.MeshBasicMaterial({ color: '#ff7a3d', transparent: true, opacity: 0.5, depthTest: false, side: THREE.DoubleSide }));
  const r = new THREE.Mesh(new THREE.RingGeometry(0.055, 0.075, 28), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide }));
  f.renderOrder = r.renderOrder = 12; assistDot.add(f, r);
}
scene.add(assistDot);
const timeRing = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 56), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthTest: false, side: THREE.DoubleSide }));
timeRing.renderOrder = 12; scene.add(timeRing);
const aimMark = new THREE.Group();
{
  const r = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.075, 28), new THREE.MeshBasicMaterial({ color: '#ff6a2b', depthTest: false, side: THREE.DoubleSide }));
  const c = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.12, 0, 0), new THREE.Vector3(-0.08, 0, 0), new THREE.Vector3(0.08, 0, 0), new THREE.Vector3(0.12, 0, 0), new THREE.Vector3(0, -0.12, 0), new THREE.Vector3(0, -0.08, 0), new THREE.Vector3(0, 0.08, 0), new THREE.Vector3(0, 0.12, 0)]), new THREE.LineBasicMaterial({ color: '#ff6a2b', depthTest: false }));
  r.renderOrder = c.renderOrder = 11; aimMark.add(r, c);
}
scene.add(aimMark);
const crossMark = new THREE.Mesh(new THREE.CircleGeometry(0.04, 16), new THREE.MeshBasicMaterial({ color: '#ff3b3b', transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide }));
crossMark.renderOrder = 11; scene.add(crossMark);

// ═════════════ 상태 ═════════════
let net = null, myId = null, myName = '', roomCode = null, myToken = null;
let lobby = null, S = null, prevS = null;
const NI = createNetInterp(), SM = createSnapMerger(); // [net]
let screen = 'title';
const simNow = () => NI.simNow(nowP()); // [net]

// 인물들
let fielders = [], fieldTeamBuilt = null, batter = null, batTeamBuilt = null;
const runners = new Map();
const umps = [];
const coaches = [];
if (!/noskin/.test(location.search)) loadSkin((window.HR_ASSETS && window.HR_ASSETS.model) || './assets/models/body.bin', (window.HR_ASSETS && window.HR_ASSETS.modelLo) || './assets/models/body_lo.bin');
function mkActor(opts) { return makeActor(opts, scene); } // [anim] 새 캐릭터(GLB) 있으면 Character, 없으면 옛 몸 — client/anim/actor.js
// [qa] 공수 교대마다 수비 9명·타자·코치를 새로 만들던 것(유니폼 데칼 캔버스·스켈레톤 복제 → 교대 순간 프레임 40ms+ 멈칫)을 팀별로 보관해 다시 씀
const teamCache = new Map();
const runnerPool = new Map(); // [qa] 주자 재사용 (poolKey → 배우 목록)
function parkRunner(A) { scene.remove(A.p.root); if (A.poolKey) (runnerPool.get(A.poolKey) || runnerPool.set(A.poolKey, []).get(A.poolKey)).push(A); }
function takeRunner(pk) { const l = runnerPool.get(pk); const A = l && l.pop(); if (!A || (usingNewCharacter() && !A.p.char)) return null; A.init = false; A.slideT = 0; A.p.root.visible = true; scene.add(A.p.root); return A; }
const cachedTeam = (k) => { const c = teamCache.get(k); return c && (!usingNewCharacter() || c.every((A) => A.p.char)) ? c : null; }; // 늦게 온 새 몸으로 못 바뀐 옛 몸 캐시는 버림
function clearActors() {
  teamCache.clear(); runnerPool.clear();
  for (const A of fielders) scene.remove(A.p.root);
  fielders = []; fieldTeamBuilt = null;
  if (batter) scene.remove(batter.p.root); batter = null; batTeamBuilt = null;
  for (const A of runners.values()) scene.remove(A.p.root);
  runners.clear();
  for (const A of coaches) scene.remove(A.p.root); coaches.length = 0;
}
// 심판 (홈, 1루, 3루)
for (const [x, z, ry] of [[0, -2.35, 0], [-22.5, 27, Math.PI * 0.75], [22.5, 27, -Math.PI * 0.75]]) {
  const U = mkActor({ team: 'ump', role: 'ump', seed: x + 3 });
  U.p.root.position.set(x, 0, z); U.p.root.rotation.y = ry; U.home = x === 0;
  if (!U.home) { U.p.maskG.visible = false; U.p.capG.visible = true; }
  umps.push(U);
}
function buildTeams(s) {
  const ft = s.half === 0 ? 'home' : 'away', bt = s.half === 0 ? 'away' : 'home';
  const key = ft + s.fl.map((f) => f[0]).join('');
  if (fieldTeamBuilt !== key) {
    for (const A of fielders) scene.remove(A.p.root);
    if (fieldTeamBuilt && fielders.length) teamCache.set('f' + fieldTeamBuilt, fielders); // [qa]
    const nums = { P: 18, C: 22, '1B': 25, '2B': 4, '3B': 13, SS: 6, LF: 7, CF: 8, RF: 9 };
    const c = cachedTeam('f' + key); // [qa]
    if (c) { fielders = c; for (const A of c) { A.init = false; scene.add(A.p.root); } }
    else fielders = s.fl.map((f, i) => { const A = mkActor({ team: ft, num: nums[f[0]], role: f[0] === 'C' ? 'catcher' : 'fielder', seed: i + (ft === 'home' ? 0 : 50) }); A.pos = f[0]; return A; });
    fieldTeamBuilt = key;
  }
  if (batTeamBuilt !== bt) {
    if (batter) scene.remove(batter.p.root);
    for (const A of runners.values()) parkRunner(A); // [qa]
    runners.clear();
    for (const A of coaches) scene.remove(A.p.root);
    if (batTeamBuilt && batter) teamCache.set('b' + batTeamBuilt, [batter, ...coaches]); // [qa]
    coaches.length = 0;
    const c = cachedTeam('b' + bt); // [qa]
    if (c) { batter = c[0]; batter.init = false; coaches.push(...c.slice(1)); for (const A of c) scene.add(A.p.root); }
    else {
      batter = mkActor({ team: bt, num: 24, role: 'batter', seed: 99 });
      for (const [x, z] of [[-24, 21], [24, 21]]) { const C = mkActor({ team: bt, num: 70 + coaches.length, role: 'fielder', seed: x }); C.p.glove.visible = false; C.p.root.position.set(x, 0, z); C.p.root.rotation.y = Math.atan2(-x, -z + 10); coaches.push(C); }
    }
    batTeamBuilt = bt;
  }
}

// ═════════════ 네트워크 ═════════════
function startLocal(name, o) {
  const game = new Game({ emit: (m) => handleMsg(m), sendTo: (id, m) => handleMsg(m), onGameOver: (sum) => saveLocalCareer(sum, name) });
  myId = 'me'; myName = name; bus.emit('ui:me', { id: myId }); // [audio] 내 타석 오르간(batterUp)용
  game.addPlayer('me', name);
  const me = game.players.get('me'); me.team = o.team; me.pos = o.pos;
  game.applySettings({ mode: o.mode, innings: o.inn, derbyOuts: o.mode === 'derby' ? Math.max(5, o.inn * 3) : 10, diff: o.diff, clubs: o.clubs || [0, 1], pitRot: 'fixed', fieldCtl: o.fld || 'auto', tod: o.tod || 'night', hitEase: o.hitEase ?? 1, rules: o.rules }); // [gameplay] rules: 'real' | 'casual' (ui가 메뉴에서 넘겨줄 것)
  applyClubs(game.set.clubs);
  let last = performance.now();
  const tickFn = () => {
    const t = performance.now(); const dt = Math.min(0.1, (t - last) / 1000); last = t;
    if (dt <= 0 || (net && net.paused)) return; // [ui] 혼자하기 일시정지 (Esc 메뉴)
    game.tick(dt);
    handleMsg(game.snapshot(true)); // [gameplay] true: 이벤트(ev)도 같이
  };
  const iv = setInterval(tickFn, 1000 / 60);
  net = { send: (m) => game.handle('me', m), close: () => clearInterval(iv), local: true, game };
  window.__hr = { game, getRole: () => getRole(), cam: () => camMode, S: () => S, net: () => net, rp: replay, lct: () => lastContactT, scene, tick: tickFn, renderer, simNow, camera };
  roomCode = null;
  game.start();
  lobby = game.lobbyState();
}
let wsRetry = 0, pingIv = 0, lastMsgAt = 0;
// 탭 복귀·네트워크 복구 시 바로 재접속
const kickReconnect = () => { if (net && net.ws && net.ws.readyState > 1 && roomCode && myName) { wsRetry = 0; connectWS(roomCode, myName); } };
addEventListener('online', kickReconnect);
document.addEventListener('visibilitychange', () => { if (!document.hidden) kickReconnect(); });
function connectWS(code, name, pw = '') {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const tok = sessionStorage.getItem('hr_tok_' + code) || '';
  const ws = new WebSocket(`${proto}://${location.host}/ws/${code}?name=${encodeURIComponent(name)}&token=${encodeURIComponent(tok)}&pw=${encodeURIComponent(pw)}`);
  let opened = false;
  SM.reset(); // [net] 새 소켓은 통째 스냅샷부터
  ws.onopen = () => { opened = true; wsRetry = 0; $('conn').classList.add('hide'); };
  ws.onmessage = (e) => { if (net && net.ws !== ws) return; /* [net] 재접속 뒤 옛 소켓에 남은 메시지 무시 */ lastMsgAt = performance.now(); try { handleMsg(JSON.parse(e.data)); } catch (err) { console.error(err); } };
  ws.onclose = (e) => {
    if (!net || net.ws !== ws) return;
    if (e.code === 4001) { toTitle(); ui.openPw(code); ui.showErr('비밀번호가 틀렸어'); return; }
    if (e.code === 4002 || e.code === 4003) { toTitle(); ui.showErr(e.reason || '방에 들어갈 수 없어'); return; }
    if (e.code === 4004) { toTitle(); ui.showErr('다른 창에서 접속했어'); return; }
    if (!opened && !myId) { toTitle(); ui.showErr('방에 접속할 수 없어'); return; }
    $('conn').classList.remove('hide');
    // 재접속: 토큰으로 원래 자리로 복귀. 처음엔 빠르게, 점점 간격 늘려 최대 2분 정도 계속 시도
    if (wsRetry < 30) { wsRetry++; setTimeout(() => { if (net && net.ws === ws) connectWS(code, name); }, Math.min(4000, 400 * wsRetry)); }
  };
  net = { ws, send: (m) => ws.readyState === 1 && ws.send(JSON.stringify(m)), close: () => { net = null; ws.close(); } };
  window.__hr = { game: null, getRole: () => getRole(), cam: () => camMode, S: () => S, net: () => net, rp: replay, lct: () => lastContactT, scene, tick: () => { }, renderer, simNow, camera, ni: () => NI }; // [qa] 멀티에서도 테스트 훅 (tools/qa) · [net] ni: 보간 상태
  roomCode = code;
  clearInterval(pingIv);
  lastMsgAt = performance.now();
  let lastIv = performance.now();
  pingIv = setInterval(() => {
    if (!net || net.ws !== ws) return;
    const now = performance.now();
    // 내 탭이 멈췄다 깨어난 경우(백그라운드·버벅임)는 서버 탓이 아님 → 판정 리셋
    if (now - lastIv > 2500 || document.hidden) lastMsgAt = now;
    lastIv = now;
    net.send({ t: 'ping', c: now });
    // 소켓이 '열려있는 척' 죽은 경우(와이파이 전환·절전): 6초 동안 아무것도 안 오면 끊고 다시 붙음
    if (ws.readyState === 1 && now - lastMsgAt > 6000) { try { ws.close(); } catch { } ws.onclose({ code: 1006 }); }
  }, 1000);
}
let rtt = 0, pgList = null, pingDrawT = 0, curFps = 0;
function handleMsg(m) {
  switch (m.t) {
    case 'welcome': myId = m.id; bus.emit('ui:me', { id: myId }); /* [audio] */ myToken = m.token; if (m.code) sessionStorage.setItem('hr_tok_' + m.code, m.token); break;
    case 'pong': rtt = Math.round(performance.now() - m.c); net && net.send({ t: 'rtt', ms: rtt }); break;
    case 'lobby': lobby = m; ui.renderLobby(); break;
    case 'chat': addChat(m.name, m.text, m.team); break;
    case 'kicked': toTitle(); ui.showErr('방장이 내보냈어'); break;
    case 'toast': toast(m.text); break;
    case 's': if (!(m = SM.merge(m))) break; onSnap(m); if (m.ev) for (const x of m.ev) bus.emit(x.e, x); break; // [gameplay] 게임 이벤트 연결 지점 (docs/rebuild/events.md)
  }
}

// ═════════════ 화면 (UI 연결) ═════════════ [ui]
function setScreen(sc) { ui.setScreen(sc); }
function toTitle() {
  if (net) { const n = net; net = null; n.close(); }
  clearInterval(pingIv);
  S = null; prevS = null; lobby = null; myId = null; NI.reset(); SM.reset(); // [net]
  setScreen(myName ? 'lobby' : 'title'); // [ui] 나가면 닉네임이 있으면 로비로
  history.replaceState(null, '', location.pathname);
  clearActors();
}
// 구단 → 유니폼 (스코어버그 엠블럼은 ui/hud.js paintClubs)
let clubsKey = '';
function applyClubs(cl) {
  if (!cl) return;
  const k = cl.join(',');
  if (k === clubsKey) return;
  clubsKey = k;
  Object.assign(UNIFORMS.away, uniformsFor(cl[0], 'away'));
  Object.assign(UNIFORMS.home, uniformsFor(cl[1], 'home'));
  if (fieldTeamBuilt || batTeamBuilt) clearActors();
  paintClubs(cl);
}
function setPitchType(k) { pitchType = k; ui.renderPitchBar(k); }
const ui = createUI({
  get S() { return S; }, get lobby() { return lobby; }, get myId() { return myId; }, get myName() { return myName; },
  get net() { return net; }, get roomCode() { return roomCode; }, get local() { return !!net?.local; },
  setMyName: (n) => { myName = n; }, getRole: () => getRole(), myTeam: () => myTeam(), nameOf: (id) => nameOf(id), simNow: () => simNow(),
  startLocal: (name, o) => startLocal(name, o), connect: (code, name, pw) => connectWS(code, name, pw), leave: () => toTitle(),
  applyQuality: () => applyQuality(), applyTimeOfDay: (t) => applyTimeOfDay(t), applyClubs: (cl) => applyClubs(cl),
  setVolume: (v) => setVolume(v), stopReplay: () => replay.stop(), sound: () => { }, /* [audio] 오르간은 사운드가 batterUp 으로 직접 냄 → ui 쪽 호출은 지워도 됨 */ unlockAudio: () => audio(),
  setPitchType: (k) => setPitchType(k),
  setPaused: (on) => { if (net && net.local) { net.paused = on; if (!on) NI.offset = null; } }, // [net]
  onScreen: (sc) => { screen = sc; },
});
$('bReconnect').onclick = () => { if (roomCode) { wsRetry = 0; connectWS(roomCode, myName); } };
// ═════════════ 스냅샷 ═════════════
const seen = { msg: -1, hr: -1, te: -1, ce: -1, we: -1, pitch: -1, lp: -1 };
let ballL = null, lastBallSt = '', hitStopUntil = 0, excite = 0, hrCine = 0, hrCineStart = 0;
let shake = 0, lastHolder = -1, camPunch = 0, lastContactT = 0;
const replay = new Replay();
let rpInfo = null;
function allPlayers() { const a = fielders.map((A) => A.p); if (batter) a.push(batter.p); for (const A of runners.values()) a.push(A.p); for (const U of umps) a.push(U.p); for (const C of coaches) a.push(C.p); return a; }
// ── [net] 보간 버퍼·외삽·서버 시계는 client/net/interp.js (NI) — 지연은 스냅샷 '늦음'의 90% 분위에 맞춰 자동, 바닥나면 최대 0.18초 외삽
const lerpAng = (a, b, u) => { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * u; };
function onSnap(s) {
  const p = nowP();
  NI.clock(s, p); if (!net?.local && s.fl) NI.push(s, p); // [net]
  if (s.pg) pgList = s.pg;
  if (s.ph === 'lobby') { S = s; if ((screen === 'game' || screen === 'over') && !net?.local) setScreen('room'); return; }
  if (screen === 'room' || ((screen === 'title' || screen === 'lobby' || screen === 'modes') && net)) setScreen('game');
  if (s.cl) applyClubs(s.cl); // [ui] HUD 갱신에서 옮겨옴 (값 바뀔 때만 실제 작업)
  if (s.tod) applyTimeOfDay(s.tod);
  if (!s.fl || !s.fl.length) { S = s; return; }
  buildTeams(s);
  if (!S || !S.fl) { seen.ce2 = s.ce2 ? s.ce2.id : -2; seen.hr = s.hr ? s.hr.id : -2; seen.te = s.te ? s.te.id : -2; seen.ce = s.ce ? s.ce.id : -2; seen.we = s.we ? s.we.id : -2; }
  prevS = S; S = s;
  // 메시지
  if (s.msg && s.msg[0] !== seen.msg) {
    seen.msg = s.msg[0];
    const t = s.msg[1];
    banner(t, !!s.msg[2], /홈런!|만루 홈런|점 홈런|홈런왕/.test(t));
    castLine(t, s);
    bus.emit('ui:msg', { text: t, s }); // [audio] 배너 문구 → 캐스터(caster:line 으로 자막)
    // [audio] 소리는 서버 이벤트(ev)로 — 여기선 화면 연출만
    if (/끝내기/.test(t)) { fx.show(18); excite = 1; startCelebration(); }
    else if (/득점/.test(t)) excite = Math.max(excite, 0.6);
    else if (/안타|2루타|3루타|번트 안타/.test(t)) excite = Math.max(excite, 0.45);
    else if (/삼진|스트라이크$/.test(t)) umpCall = nowP();
    else if (/강탈|다이빙 캐치|도루 저지/.test(t)) excite = Math.max(excite, 0.7);
    if (/관전 입장|퇴장|재접속|끊김|강퇴/.test(t)) sysChat(t);
  }
  // 홈런 이벤트
  if (s.hr && s.hr.id !== seen.hr) {
    { hrCine = 1; hrCineStart = nowP(); excite = 1; setTimeout(() => { fx.show(12, [0, 0, 165]); }, 900); /* [audio] 소리는 서버 hr */ bigBoard = { t: nowP(), big: '홈런!', sub: `${s.hr.name} · ${s.hr.dist}m` }; }
    seen.hr = s.hr.id;
    if (cfg.replay && lastContactT && nowP() - lastContactT < 8) replay.schedule(nowP() + 2.6, { tEvent: lastContactT, pre: 0.8, post: 1.6, speed: 0.42, cam: 'hr', scene });
  }
  // 송구/포구/펜스 이벤트
  if (s.te && s.te.id !== seen.te) { if (fielders[s.te.i]) { fielders[s.te.i].throwT = nowP(); } seen.te = s.te.id; }
  if (s.ce && s.ce.id !== seen.ce) { if (fielders[s.ce.i]) { fielders[s.ce.i].catchT = nowP(); if (s.ce.i === getRole().fi && getRole().defense) { feedback(s.ce.dive ? '다이빙 캐치!! 나이스!' : s.ce.jump ? '점프 캐치!! 나이스!' : '나이스 캐치!', '#4fd18b'); if (s.ce.dive || s.ce.jump) bus.emit('ui:perfect'); }
    if ((s.ce.dive || s.ce.jump) && cfg.replay !== 0) replay.schedule(nowP() + 1.0, { tEvent: nowP(), pre: 1.2, post: 0.5, speed: 0.45, cam: 'catch', focus: fielders[s.ce.i].p, scene }); if (s.ce.dive) { fx.dustPuff(fielders[s.ce.i].p.root.position.x, fielders[s.ce.i].p.root.position.z, 2, 2); } } seen.ce = s.ce.id; }
  if (s.ce2 && s.ce2.id !== seen.ce2) {
    if (seen.ce2 !== undefined) showCall(s.ce2);
    seen.ce2 = s.ce2.id;
  }
  if (s.we && s.we.id !== seen.we) { { shake = Math.max(shake, 0.15); } seen.we = s.we.id; }
  // 공
  if (s.b) {
    const h = s.b[6], st = s.b[7];
    // 지연 보정: 서버 상태(s.now 시점)를 화면 공의 시각까지 앞으로 굴린 뒤 합류 — [gameplay] 처음·상태 바뀐 스냅샷도 굴림 / [net] client/net/interp.js mergeBall
    const prevBall = ballL;
    ballL = mergeBall(ballL, s, simNow(), integrate, lastBallSt);
    if (ballL !== prevBall && st === 'thrown' && lastBallSt !== 'thrown') fx.trailClear();
    lastHolder = h; lastBallSt = st;
  } else { ballL = null; lastBallSt = ''; lastHolder = -1; }
  // 새 타구
  if (s.p && s.p.res === 'hit' && prevS && prevS.ph === 'pitching' && s.ph === 'live') {
    const mine = swungLocal[s.p.id];
    if (!mine) onContact(s.p, s.lh ? s.lh.q : 0.6, s.lh && s.lh.mode === 'bunt');
    fx.trailClear();
    droppedBat.visible = true;
    droppedBat.position.set(0.9 + Math.random() * 0.4, 0, 0.6 + Math.random() * 0.6); droppedBat.rotation.y = Math.random() * Math.PI;
  }
  if (s.ph === 'pitch') droppedBat.visible = false;
  if (prevS && prevS.bat && s.bat && (prevS.bat.name !== s.bat.name || prevS.bat.id !== s.bat.id || prevS.bat.n !== s.bat.n)) { buntOn = false; if (s.mode !== 'derby') startIntro(s); }
  if (s.p && s.p.id !== seen.pitch) { seen.pitch = s.p.id; pitchFb = false; fx.trailClear(); tracerId = null; }
  if (s.ph === 'over' && screen !== 'over' && ui.showOver(s)) { fx.show(8, [0, 0, 160]); } // [ui] (환호는 서버 gameEnd)
  if (s.ph !== 'over' && screen === 'over') setScreen('game');
}
let umpCall = 0, bigBoard = null, pitchFb = false;
// ── 판정 팝업 (베이스 위 3D 글자) + 누심 동작 ──
const calls = [];
function callSprite(text, color) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 192;
  const g = c.getContext('2d');
  g.font = '900 128px Oswald, "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const tw = Math.min(500, g.measureText(text).width + 70);
  g.fillStyle = 'rgba(8,12,20,.72)'; g.beginPath(); g.roundRect(256 - tw / 2, 28, tw, 144, 30); g.fill();
  g.fillStyle = color; g.fillRect(256 - tw / 2 + 24, 160, tw - 48, 8);
  g.lineWidth = 16; g.strokeStyle = 'rgba(0,0,0,.75)'; g.strokeText(text, 256, 100);
  g.fillStyle = color; g.fillText(text, 256, 100);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  sp.renderOrder = 30; return sp;
}
function showCall(ev) {
  const sp = callSprite(ev.out ? 'OUT' : 'SAFE', ev.out ? '#ff5050' : '#5be08f');
  sp.position.set(ev.x, 2.6, ev.z); scene.add(sp);
  calls.push({ sp, t0: nowP() });
  // 가장 가까운 심판이 판정 동작
  let best = null, bd = 1e9;
  for (const U of umps) { const d = Math.hypot(U.p.root.position.x - ev.x, U.p.root.position.z - ev.z); if (d < bd) { bd = d; best = U; } }
  if (best && (!best.home || ev.k === 4)) { best.callT = nowP(); best.callKind = ev.out ? 'out' : 'safe'; }
  if (best && !best.home) best.p.root.rotation.y = Math.atan2(ev.x - best.p.root.position.x, ev.z - best.p.root.position.z);
}
window.__showCall = showCall;
function updateCalls() {
  const tp = nowP();
  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i], e = tp - c.t0;
    const pop = e < 0.15 ? 0.6 + e / 0.15 * 0.7 : e < 0.3 ? 1.3 - (e - 0.15) / 0.15 * 0.3 : 1;
    const d = camera.position.distanceTo(c.sp.position);
    const sc = Math.max(2.0, d * 0.095) * pop;
    c.sp.scale.set(sc * 2.67, sc, 1);
    c.sp.position.y = 2.6 + e * 0.4;
    c.sp.material.opacity = e > 1.4 ? Math.max(0, 1 - (e - 1.4) / 0.4) : 1;
    if (e > 1.8) { scene.remove(c.sp); c.sp.material.map.dispose(); c.sp.material.dispose(); calls.splice(i, 1); }
  }
}
function onContact(p, q, bunt) {
  lastContactT = nowP();
  const cp = new THREE.Vector3(p.tx, p.ty, 0);
  fx.impact(cp, bunt ? 0.3 : 0.5 + q * 1.1);
  if (!bunt && q > 0.3) {
    shake = Math.max(shake, 0.06 + q * 0.22);
    hitStopUntil = nowP() + 0.015 + q * 0.035; // 정타일수록 공이 아주 잠깐 멈췄다 튀어나감 (길면 공이 느려 보임)
    camPunch = Math.max(camPunch, q * q * 1.2); // 화각 순간 좁힘(줌 펀치) — [gameplay] 5°→1.2°: 줌이 풀리며 공이 가운데로 빨려 들어가 느려 보이던 것 줄임
  }
  excite = Math.max(excite, 0.25 + q * 0.4);
}

// ── 등장 컷씬: (투수 바뀌면 투수 →) 타자 클로즈업 + 기록 카드(ui) ──
let intro = null, lastPitcherName = '';
function startIntro(s) {
  if (s.mode !== 'game' || replay.active) { ui.walkup(s); return; }
  ui.refreshCareer();
  const seq = [];
  if (s.cp && s.cp[0] !== lastPitcherName) { seq.push('p'); lastPitcherName = s.cp[0]; }
  seq.push('b');
  intro = { t0: nowP(), seq, idx: -1, s };
}
function introStep() {
  if (!intro) return null;
  if (S && S.ph !== 'pitch' && S.ph !== 'pitching' && intro.idx < 0) { intro.t0 = nowP(); if (S.ph === 'over') { endIntro(); } return null; } // 투구 단계가 시작될 때부터
  const e = nowP() - intro.t0, D = { p: 1.9, b: 2.5 };
  let acc = 0, idx = -1;
  for (let i = 0; i < intro.seq.length; i++) { if (e < acc + D[intro.seq[i]]) { idx = i; break; } acc += D[intro.seq[i]]; }
  const windup = S && S.ph === 'pitching' && S.p && simNow() > S.p.t0 - WINDUP;
  if (idx < 0 || windup || !S || S.mode !== 'game' || screen !== 'game' || replay.active) { endIntro(); return null; }
  if (idx !== intro.idx) { intro.idx = idx; ui.introCard(intro.seq[idx], S); }
  return { kind: intro.seq[idx], e: e - acc };
}
function endIntro() { intro = null; ui.introHide(); }
function myTeam() { const p = lobby && lobby.players.find((x) => x.id === myId); return p ? p.team : null; }
function nameOf(id) { if (!id) return null; const p = lobby && lobby.players.find((x) => x.id === id); return p ? p.name : null; }

// ═════════════ 역할 ═════════════
function getRole() {
  const r = { batter: false, pitcher: false, fi: -1, holding: false, offense: false, defense: false, pos: null, spec: false };
  if (!S || !S.fl) return r;
  const t = myTeam();
  r.spec = !t || t === 'spec';
  r.offense = !r.spec && t === S.bt && S.mode !== 'derby';
  r.defense = !r.spec && t !== S.bt;
  r.batter = !!(S.bat && S.bat.id === myId);
  r.fi = S.fl.findIndex((f) => f[4] === myId);
  if (r.fi >= 0) { r.pos = S.fl[r.fi][0]; r.pitcher = r.pos === 'P'; }
  r.holding = r.fi >= 0 && !!S.b && S.b[6] === r.fi;
  return r;
}

// ═════════════ 입력 ═════════════
const keys = {};
const mouse = new THREE.Vector2(0, -0.2);
let mouseRaw = new THREE.Vector2(0, -0.2);
let pitchType = 'FB';
let gauge = null; // {t0, aim:[x,y]}
let buntOn = false;
const swungLocal = {};
// 한글 입력 상태(ㅈㅁㄴㅇ)에서도 WASD 등이 먹도록 물리 키 기준으로
function keyOf(e) {
  const c = e.code || '';
  if (c.startsWith('Key')) return c.slice(3).toLowerCase();
  if (c.startsWith('Digit')) return c.slice(5);
  if (c.startsWith('Numpad') && /\d$/.test(c)) return c.slice(-1);
  if (c === 'ShiftLeft' || c === 'ShiftRight') return 'shift';
  if (c.startsWith('Arrow')) return c.toLowerCase();
  return (e.key || '').toLowerCase();
}
addEventListener('keydown', (e) => {
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'SELECT') return;
  const k = keyOf(e);
  if (replay.active && (k === ' ' || e.key === 'Escape' || e.key === 'Enter')) { replay.stop(); e.preventDefault(); return; }
  if (intro && (e.key === 'Escape' || e.key === 'Enter') && !getRole().pitcher) { endIntro(); e.preventDefault(); return; }
  if (ui.handleKey(e, k)) return; // [ui] Esc 메뉴/창 닫기, Enter 채팅, Tab 기록, H 조작법, T 빠른 채팅
  if (screen !== 'game' && screen !== 'over') return;
  if (ui.modalOpen()) return; // 창이 떠 있으면 경기 입력 막음 (혼자하기 일시정지 중 스윙 방지)
  if (k === 'v' && S && getRole().fi >= 0 && !getRole().pitcher && getRole().pos !== 'C') { cfg.fieldCam = cfg.fieldCam === 'tps' ? 'tv' : 'tps'; store.set('fieldCam', cfg.fieldCam); fcam.yawOff = 0; toast(cfg.fieldCam === 'tps' ? '수비 시점: 내 선수 뒤 (드래그로 회전)' : '수비 시점: 중계 화면'); return; }
  if (k === 'v') { cfg.batCam = cfg.batCam === 1 ? 0 : 1; store.set('batCam', cfg.batCam); toast(cfg.batCam === 1 ? '타격 시점: 타자 어깨 뒤' : '타격 시점: 포수 뒤 (중계)'); return; }
  keys[k] = true;
  if (e.code === 'Space') e.preventDefault();
  if (!S || screen !== 'game' || e.repeat) return;
  const role = getRole();
  // 타자
  if (role.batter) {
    if (k === 'b') toggleBunt();
    if (e.code === 'Space') doSwing('contact');
    if (k === 'f') doSwing('power');
  }
  // 투수
  if (role.pitcher && S.ph === 'pitch' && /^[1-6]$/.test(k)) setPitchType(PITCH_KEYS[+k - 1]);
  if (role.batter && S.dy && S.dy.pr && /^[0-6]$/.test(k)) net.send({ t: 'ppick', type: k === '0' ? 'MIX' : PITCH_KEYS[+k - 1] }); // 타격 연습: 구종 고정
  if (role.pitcher && e.code === 'Space') pitchClick();
  if (role.pitcher && S.ph === 'pitch' && k === 'q') { net.send({ t: 'pick' }); gauge = null; }
  // 수비
  if (S.ph === 'live' && role.fi >= 0) {
    const tmap = { '1': 1, '2': 2, '3': 3, '4': 4, 'f': 0, 'r': 5 };
    if (!role.holding && k in tmap) pendThrow = { base: tmap[k], t: nowP() }; // 잡기 직전에 눌러도 잡자마자 송구
    if (role.holding && e.code === 'Space') { const rb = recBase(); const relay = useRelay(rb, role); net.send({ t: 'throw', base: relay ? 5 : rb, p: 0.55 }); feedback(relay ? `중계 송구 → 커트맨 (${rb === 4 ? '홈' : rb + '루'})` : `추천 송구 → ${rb === 4 ? '홈' : rb + '루'}`, '#ffd23a'); return; }
    if (role.holding) {
      const map = tmap;
      // 꾹 누르면 세게(빠르지만 부정확), 톡 치면 정확하게. 터치는 바로 던짐
      if (k in map) { if (!e.isTrusted) { net.send({ t: 'throw', base: map[k], p: 0.5 }); } else if (!throwCharge) throwCharge = { k, base: map[k], t0: nowP() }; }
    }
    else {
      if (k === 'q') { net.send({ t: 'sw' }); }
      if (e.code === 'Space') { net.send({ t: 'jump' }); ctl.lastIn = nowP(); }
      if (k === 'c') { const d = moveDir(); net.send({ t: 'dive', dx: d[0], dz: d[1] }); }
    }
  }
  // 공격
  if (role.offense) {
    if (S.ph === 'live' && k === 'e') { net.send({ t: 'run', go: 1 }); feedback('전 주자 추가 진루!', '#ffcf3f'); }
    if (S.ph === 'live' && k === 'q') { net.send({ t: 'run', go: 0 }); feedback('귀루!', '#9fd0ff'); }
    if (S.ph === 'live' && e.code === 'Space') net.send({ t: 'slide' });
    if ((S.ph === 'pitch' || S.ph === 'pitching') && k === 'r') { net.send({ t: 'steal' }); }
  }
});
let throwCharge = null, pendThrow = null;
const throwPow = () => (throwCharge ? clamp((nowP() - throwCharge.t0) / 0.7, 0, 1) : 0);
addEventListener('keyup', (e) => { const k = keyOf(e); keys[k] = false; keys[e.key.toLowerCase()] = false;
  if (throwCharge && throwCharge.k === k) { const p = 0.25 + throwPow() * 0.75; if (net && getRole().holding) { net.send({ t: 'throw', base: throwCharge.base, p }); if (p > 0.85) feedback('강송구!', '#ff9f43'); } else pendThrow = { base: throwCharge.base, t: nowP() }; throwCharge = null; } ui.handleKeyUp(e); });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; ui.onBlur(); });
addEventListener('contextmenu', (e) => { if (screen === 'game') e.preventDefault(); });
canvas.addEventListener('pointermove', (e) => {
  mouseRaw.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  // 수비 자유시점: 드래그로 카메라 돌리기
  if (e.buttons && S && (camMode === 'field' || camMode === 'fwait') && cfg.fieldCam === 'tps') { fcam.yawOff -= e.movementX * 0.006; fcam.pitchOff = clamp(fcam.pitchOff + e.movementY * 0.004, -0.35, 0.6); fcam.dragT = nowP(); }
});
canvas.addEventListener('pointerdown', (e) => {
  audio();
  mouseRaw.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  if (screen !== 'game' || !S) return;
  if (replay.active) { replay.stop(); return; }
  if (intro && !getRole().pitcher) { endIntro(); return; }
  const role = getRole();
  if (role.batter) doSwing(e.button === 2 ? 'power' : 'contact');
  else if (role.pitcher) pitchClick();
});
const raycaster = new THREE.Raycaster();
const zonePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const tmpV = new THREE.Vector3();
function aimPoint() {
  // 감도: 화면 중앙 기준 확대/축소
  const sens = cfg.sens / 100;
  mouse.set(mouseRaw.x * sens, mouseRaw.y * sens);
  raycaster.setFromCamera(mouse, camera);
  if (!raycaster.ray.intersectPlane(zonePlane, tmpV)) return null;
  return [clamp(tmpV.x, -0.85, 0.85), clamp(tmpV.y, 0.1, 1.75)];
}
function doSwing(mode) {
  if (!S || S.ph !== 'pitching' || !S.p) return;
  const p = S.p, t = simNow();
  if (swungLocal[p.id] || t < p.t0) return;
  if (buntOn || S.bs) mode = 'bunt';
  swungLocal[p.id] = t;
  let a = aimPoint() || [0, 0.8];
  const dt = t - p.arrive;
  if (mode === 'bunt') {
    // 번트: 배트가 공 높이를 자동으로 따라감. 좌우 커서로 방향만 조절
    a = [p.tx + clamp((a[0] - p.tx) * 0.35, -0.14, 0.14), p.ty + 0.02];
  }
  // [gameplay] 자석 보정(공 쪽으로 커서 당기기)은 없앰 → 대신 서버·클라 공통 PCI 판정이 '타이밍이 맞을수록 커서 판정이 넓어짐'
  const ax = a[0] - p.tx, ay = a[1] - p.ty;
  net.send({ t: 'swing', pid: p.id, dt, ax, ay, mode });
  swingInfo[p.id] = { mode, a };
  // 접촉 여부는 결정적이라 바로 판정 → 즉시 타격감 (서버 pciJudge 와 같은 함수)
  if (mode === 'bunt') {
    const M = SWING.bunt, contact = Math.abs(dt) <= M.W && Math.hypot(ax, ay) <= M.R;
    bus.emit('localSwing', { pid: p.id, mode, contact, dt: Math.round(dt * 1000), q: contact ? 0.3 : 0 });
    if (contact) { contactFreeze = { pid: p.id, until: nowP() + 0.35, pos: [p.tx, p.ty] }; onContact(p, 0.3, true); feedback('번트!', '#9fd0ff'); }
    else feedback(Math.abs(dt) > M.W ? (dt < 0 ? '번트 너무 빨라' : '번트 늦었어') : '번트 헛스윙', '#ff8a80');
    return;
  }
  const R = judgeSwing(mode, dt, ax, ay, hitEase());
  swingReport(dt, a, p, R.J, R.J.contact);
  bus.emit('localSwing', { pid: p.id, mode, contact: R.J.contact, dt: Math.round(dt * 1000), q: R.q }); // [gameplay] 내 스윙 즉시 피드백(서버 contact/miss는 핑만큼 늦게 옴)
  if (R.J.contact) {
    contactFreeze = { pid: p.id, until: nowP() + 0.35, pos: [p.tx, p.ty] };
    onContact(p, R.q, false);
    if (R.perfect) { bus.emit('ui:perfect'); perfectHit = nowP(); }
  }
  feedback(R.text, R.col);
}
let contactFreeze = null, perfectHit = 0;
// [ui] 스윙 분석 창은 client/ui/hud.js swingReport
const swingInfo = {};
// 투구 게이지
const GAUGE_UP = 0.85, GAUGE_MAX = 1.15;
const pBand = () => (RULES[S && S.ru] || RULES.real).perfectPitch; // [gameplay]
function gaugeLevel(t) {
  const u = t / GAUGE_UP * GAUGE_MAX;
  if (u <= GAUGE_MAX) return u;
  return Math.max(0, GAUGE_MAX - (u - GAUGE_MAX));
}
function pitchClick() {
  if (!S || S.ph !== 'pitch') return;
  if (intro) endIntro(); // 컷씬 중에도 바로 던질 수 있게
  if (!gauge) {
    const a = (camMode !== 'intro' && aimPoint()) || [0, 0.8];
    gauge = { t0: nowP(), aim: a, type: pitchType };
    bus.emit('ui:click'); // [audio]
  } else {
    const lv = gaugeLevel(nowP() - gauge.t0);
    sendPitch(lv);
  }
}
function sendPitch(lv) {
  net.send({ t: 'pitch', type: gauge.type, tx: gauge.aim[0], ty: gauge.aim[1], power: lv });
  const [pb0, pb1] = pBand(), pf = lv >= pb0 && lv <= pb1; // [gameplay] 모드별 퍼펙트 구간
  const txt = lv > 1.0 ? '과투구! 제구 흔들림' : pf ? '퍼펙트 투구! 공 끝 살아있다' : lv < 0.6 ? '힘 빠진 공' : '좋아';
  feedback(`${txt} (${Math.round(lv * 100)}%)`, pf ? '#4fd18b' : lv > 1 ? '#ff8a80' : '#ffcf3f');
  if (pf) bus.emit('ui:perfect'); // [audio]
  gauge = null;
}
$('buntBtn').onpointerdown = (e) => { e.stopPropagation(); toggleBunt(); };
function toggleBunt() {
  if (!S || S.mode === 'derby' || !getRole().batter) return;
  buntOn = !(buntOn || S.bs); net.send({ t: 'bunt', on: buntOn });
  feedback(buntOn ? '번트 자세 · 공 들어올 때 클릭' : '강공 자세', '#9fd0ff');
}
// ═════════════ 내 수비수 이동 ═════════════
const ctl = { active: false, x: 0, z: 0, ry: 0, lastIn: 0, lastSend: 0, idx: -1, moving: false };
const touchMove = { x: 0, y: 0 };
function moveDir() {
  let fw = (keys.w || keys.arrowup ? 1 : 0) - (keys.s || keys.arrowdown ? 1 : 0) + touchMove.y;
  let rt = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0) + touchMove.x;
  camera.getWorldDirection(tmpV); tmpV.y = 0; tmpV.normalize();
  const fx_ = tmpV.x, fz = tmpV.z, rx = -fz, rz = fx_;
  let mx = fx_ * fw + rx * rt, mz = fz * fw + rz * rt; // D = 화면 오른쪽
  const l = Math.hypot(mx, mz);
  if (l < 0.01) { const f = S && fielders[getRole().fi]; return f ? [Math.sin(f.p.root.rotation.y), Math.cos(f.p.root.rotation.y)] : [0, 1]; }
  return [mx / l, mz / l];
}
function updateControl(dt) {
  const role = getRole();
  const prePitch = S && S.ph === 'pitch' && role.fi >= 0 && role.pos !== 'P' && role.pos !== 'C';
  if (!S || (S.ph !== 'live' && !prePitch) || role.fi < 0 || screen !== 'game') { ctl.active = false; return; }
  const f = S.fl[role.fi];
  if (ctl.idx !== role.fi) {
    if (ctl.idx >= 0 && S.ph === 'live') feedback(`▶ ${POS_KO[role.pos] || ''} 조작`, '#ffd23a');
    // [qa 11-19] 조작 선수가 바뀌면 누르고 있던 방향키는 무시(한 번 떼야 움직임): 송구 후 받는 선수로 넘어갔을 때 W 를 계속 누르고 있어서 베이스에서 벗어나 공을 놓치던 것
    ctl.block = ctl.idx >= 0; ctl.idx = role.fi; ctl.active = false;
  }
  const diveAge = f[7];
  let fw = (keys.w || keys.arrowup ? 1 : 0) - (keys.s || keys.arrowdown ? 1 : 0) + touchMove.y;
  let rt = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0) + touchMove.x;
  if (ctl.block) { if (Math.abs(fw) < 0.1 && Math.abs(rt) < 0.1) ctl.block = false; else { fw = 0; rt = 0; } }
  const t = nowP();
  if ((Math.abs(fw) > 0.1 || Math.abs(rt) > 0.1) && !(diveAge >= 0 && diveAge < 1.2)) {
    if (!ctl.active) { ctl.x = f[1]; ctl.z = f[2]; ctl.active = true; }
    ctl.lastIn = t;
    const [mx, mz] = (() => { const d = moveDir(); return d; })();
    const mag = Math.min(1, Math.hypot(fw, rt));
    const spd = (keys.shift ? SPRINT_SPEED : FIELD_SPEED) * mag;
    ctl.x += mx * spd * dt; ctl.z += mz * spd * dt;
    ctl.ry = Math.atan2(mx, mz);
    ctl.moving = true;
  } else ctl.moving = false;
  if (diveAge >= 0 && diveAge < 1.2) { ctl.x = f[1]; ctl.z = f[2]; }
  if (ctl.active && t - ctl.lastIn > 0.5) ctl.active = false;
  // [net] 20Hz → 30Hz(스냅샷 주기와 같게): 20Hz 면 다른 사람 화면에서 사람 수비수가 스냅샷 3개 중 1개는 제자리 → 계단처럼 끊겨 보였음. 숫자는 cm 까지
  if (ctl.active && t - ctl.lastSend > 0.031) { ctl.lastSend = t; net.send({ t: 'mv', x: Math.round(ctl.x * 100) / 100, z: Math.round(ctl.z * 100) / 100, ry: Math.round(ctl.ry * 100) / 100, a: 1 }); }
}
// 모바일 스틱/버튼
if (TOUCH) {
  const stick = $('stick'), knob = stick.querySelector('i');
  let sid = null;
  stick.addEventListener('pointerdown', (e) => { sid = e.pointerId; stick.setPointerCapture(sid); });
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId !== sid) return;
    const r = stick.getBoundingClientRect();
    let x = (e.clientX - r.left - r.width / 2) / (r.width / 2), y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    touchMove.x = x; touchMove.y = -y;
    knob.style.transform = `translate(${x * 40}px,${y * 40}px)`;
  });
  const end = () => { sid = null; touchMove.x = touchMove.y = 0; knob.style.transform = ''; };
  stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
}
function renderTouchButtons(role) {
  const tb = $('tbtns');
  let html = '';
  if (S.ph === 'live' && role.fi >= 0) {
    html = role.holding ? '<button data-k=" " style="background:rgba(255,210,58,.35)">추천</button>' + [['1', '1루'], ['2', '2루'], ['3', '3루'], ['4', '홈']].map(([k, l]) => `<button data-k="${k}">${l}</button>`).join('')
      : '<button data-k="q">전환</button><button data-k=" ">점프</button><button data-k="c">다이빙</button><button data-k="shift" data-hold="1">질주</button>';
  } else if (role.batter && (S.ph === 'pitch' || S.ph === 'pitching')) html = '<button data-k="f">강타</button><button data-k="b">번트</button>';
  else if (role.offense && S.ph === 'live') html = '<button data-k="e">진루</button><button data-k="q">귀루</button><button data-k=" ">슬라이딩</button>';
  else if (role.pitcher && S.ph === 'pitch' && (S.occ || []).some(Boolean)) html = '<button data-k="q">견제</button>';
  if (tb.dataset.h === html) return;
  tb.dataset.h = html; tb.innerHTML = html;
  tb.querySelectorAll('button').forEach((b) => {
    const k = b.dataset.k;
    b.onpointerdown = (e) => { e.stopPropagation(); if (b.dataset.hold) keys[k] = true; else dispatchEvent(new KeyboardEvent('keydown', { key: k === ' ' ? ' ' : k, code: k === ' ' ? 'Space' : '' })); };
    b.onpointerup = () => { if (b.dataset.hold) keys[k] = false; };
  });
}

// ═════════════ 월드 업데이트 ═════════════
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3();
function place(A, x, z, ry, dt, k = 14) {
  const r = A.p.root;
  if (!A.init) { r.position.set(x, groundY(x, z), z); r.rotation.y = ry; A.init = true; A.spd = 0; return 0; }
  const a = 1 - Math.exp(-k * dt);
  const ox = r.position.x, oz = r.position.z;
  let nx = lerp(ox, x, a), nz = lerp(oz, z, a);
  // [qa 11-19] 화면 이동 속도 상한(사람 최고 속도 근처): 서버 위치가 크게 튀어도 미끄러지듯 날아가지 않고 뛰어감. 50m 넘게 튀면(교대·리셋) 바로 옮김
  const jump = Math.hypot(x - ox, z - oz), vmax = 10.5 * dt, mv = Math.hypot(nx - ox, nz - oz);
  if (jump < 50 && mv > vmax) { nx = ox + (nx - ox) * vmax / mv; nz = oz + (nz - oz) * vmax / mv; }
  else if (jump >= 50) { nx = x; nz = z; }
  r.position.x = nx; r.position.z = nz;
  r.position.y = groundY(r.position.x, r.position.z); // [model] 마운드(높이 25.9cm) 위에선 발이 마운드에 닿게
  let d = ry - r.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
  r.rotation.y += d * Math.min(1, dt * 10);
  const sp = Math.hypot(r.position.x - ox, r.position.z - oz) / Math.max(dt, 1e-3);
  A.spd = lerp(A.spd, sp, 0.25);
  return A.spd;
}
const ballPos = new THREE.Vector3();
// 포수 → 투수 공 돌려주기 (연출용 공)
const tossBall = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * 1.4, 12, 10), new THREE.MeshStandardMaterial({ color: '#fbfaf5', roughness: 0.5 }));
tossBall.visible = false; scene.add(tossBall);
let lastPh = '', lastRes = null, tossT = -9, lastInn = '';
const TOSS = { start: 0.35, dur: 0.75 };
function updateWorld(dt) {
  const s = S, t = simNow(), tp = nowP();
  if (s.p) lastRes = s.p.res;
  const innKey = s.inn + ':' + s.half;
  if (s.ph === 'pitch' && lastPh && lastPh !== 'pitch' && lastRes && lastRes !== 'hit' && innKey === lastInn && s.mode !== 'derby') tossT = tp;
  lastPh = s.ph; lastInn = innKey;
  const tk = tp - tossT;
  const tossing = s.ph === 'pitch' && tk < TOSS.start + TOSS.dur + 0.3;
  if (tossing && tk > TOSS.start && tk < TOSS.start + TOSS.dur) {
    const u = (tk - TOSS.start) / TOSS.dur;
    tossBall.visible = true;
    tossBall.position.set(lerp(-0.1, -0.25, u), lerp(1.5, 1.45, u) + Math.sin(Math.PI * u) * 1.6, lerp(-0.4, 18.0, u));
  } else tossBall.visible = false;
  const role = getRole();
  const pitchPhase = s.ph === 'pitch' || s.ph === 'pitching' || (s.ph === 'result' && !s.b && !(s.p && s.p.res === 'hit'));
  const hasBall = (i) => s.b && s.b[6] === i;
  const ballW = ballMesh.visible ? ballPos : null;
  // 수비수
  const IP = !net?.local && window.__noInterp !== 1 ? NI.sample(t, dt, s.ph === 'live') : null; // [net] 보간(바닥나면 짧게 외삽)
  if (IP) { NI.fr = (NI.fr || 0) + 1; if (IP.under) { NI.ur = (NI.ur || 0) + 1; if (!IP.ext) NI.hold = (NI.hold || 0) + 1; } } // [net] QA 집계용(프레임·언더런·멈춤)
  s.fl.forEach((f, i) => {
    const A = fielders[i]; if (!A) return;
    let [pos, x, z, ry, ctrlId, mv, jt, dv] = f;
    // [gameplay] 타구 중엔 공(현재 시각으로 외삽)과 수비수(보간 지연만큼 과거)가 다른 시각이라 공이 수비수 앞 허공에서 잡혔음 → 구간 속도로 지연만큼 앞으로(최대 1.5m) — NI.sample/fl 안에서
    if (IP) { const q = IP.fl(i, pos); if (q) { x = q[0]; z = q[1]; ry = q[2]; } }
    if (i === role.fi && ctl.active) { x = ctl.x; z = ctl.z; ry = ctl.ry; }
    if (pos === 'P' && pitchPhase) ry = Math.PI;
    const sp = place(A, x, z, ry, dt, i === role.fi && ctl.active ? 30 : IP ? 22 : 12);
    const nm = nameOf(ctrlId) || (net?.local && ctrlId === myId ? myName : null);
    setTag(A, nm ? (ctrlId === myId ? `${nm} ★` : nm) : '', ctrlId === myId ? '#ffcf3f' : '#ffffff', ctrlId === myId && (camMode !== 'field' || cfg.fieldCam === 'tps'));
    if (pos === 'P' && (pitchPhase || (s.p && t - s.p.t0 < 1.2 && s.ph !== 'live'))) {
      let k = -1;
      if (s.p && (s.ph === 'pitching' || s.ph === 'result')) k = pitchK(t - (s.p.t0 - WINDUP));
      if (k > 1.15) k = -1;
      if (window.__pk != null) k = window.__pk;
      A.a.pitcher(dt, { k, speed: sp, lookW: tossBall.visible ? tossBall.position : _v.set(0, 1.2, 0), catchW: tossing && tk > TOSS.start + TOSS.dur - 0.35 ? _u.set(-0.25, 1.45, 17.75) : null });
      return;
    }
    if (pos === 'C' && pitchPhase && tossing && tk < TOSS.start + 0.5) {
      const k = clamp((tk - TOSS.start + THROW_DUR * 0.55) / THROW_DUR, 0, 1);
      A.a.fielder(dt, { speed: 0, ready: false, hasBall: tk < TOSS.start, throwK: tk < TOSS.start - 0.25 ? -1 : k, diveK: -1, jumpK: -1, ballW: null, reachW: null, ground: false });
      return;
    }
    if (pos === 'C' && pitchPhase) {
      let gloveW = null;
      if (s.p && s.ph !== 'pitch') {
        const sv = (t - s.p.t0) / s.p.T;
        if (sv > 0.55 && sv < 1.6) { const q = pitchPos(s.p, Math.min(sv, 1.04)); gloveW = _w.set(q[0], q[1], Math.max(q[2], -0.55)); }
        else if (sv >= 1.6) gloveW = _w.set(s.p.tx, s.p.ty, -0.55);
      }
      A.a.catcher(dt, { speed: 0, gloveW, hasBall: s.p && s.ph === 'result' && (t - s.p.arrive) > 0.05, lookW: ballW || _v.set(0, 1.5, 18) });
      return;
    }
    const ready = s.ph === 'pitching' && s.p && t > s.p.t0 - 0.25 && pos !== 'P';
    const splitK = s.ph === 'pitching' && s.p ? (t - s.p.t0) / 0.35 : -1;
    let throwK = -1;
    if (A.throwT && tp - A.throwT < THROW_DUR) throwK = (tp - A.throwT) / THROW_DUR;
    const diveK = dv >= 0 ? dv / 0.55 : -1, jumpK = jt >= 0 && jt < 0.6 ? jt / 0.6 : -1;
    let reachW = null, ground = false;
    if (ballL && ballL.h < 0 && s.ph === 'live') {
      const d = Math.hypot(ballPos.x - A.p.root.position.x, ballPos.z - A.p.root.position.z);
      const incoming = (ballL.vx * (A.p.root.position.x - ballPos.x) + ballL.vz * (A.p.root.position.z - ballPos.z)) > 0;
      if (d < 4.5 && (incoming || d < 1.5)) {
        if (ballPos.y < 0.6 && ballL.state === 'ground') ground = true;
        else reachW = ballPos;
      }
    }
    if (A.catchT && tp - A.catchT < 0.25 && !reachW) reachW = _u.copy(A.p.root.position).add(_w.set(Math.sin(A.p.root.rotation.y) * 0.5, 1.2, Math.cos(A.p.root.rotation.y) * 0.5));
    const knees = (pos === 'LF' || pos === 'CF' || pos === 'RF') && (s.ph === 'pitch' || (s.ph === 'pitching' && s.p && t < s.p.t0 - 0.9));
    A.a.fielder(dt, { speed: sp, ready, knees, splitK, hasBall: hasBall(i), throwK, diveK, jumpK, ballW, reachW, ground, reachWeight: 1 });
  });
  // 타자
  // [motion] 맞힌 순간(phase → live) 타자가 바로 주자로 바뀌어 스윙이 컨택 프레임에서 끊기던 것 → 팔로스루(0.34초)까지 타자를 보여 주고 홈의 주자는 그동안 숨김
  const swingHold = !pitchPhase && s.ph === 'live' && s.p && s.p.res === 'hit' && s.p.swingAt != null && t - s.p.swingAt < 0.34 && !replay.active;
  const showBatter = pitchPhase || swingHold || (s.ph === 'result' && s.p && s.p.res !== 'hit' && !s.b);
  if (swingHold) { if (droppedBat.visible) { droppedBat.visible = false; droppedBat.userData.pend = 1; } } else if (droppedBat.userData.pend) { droppedBat.userData.pend = 0; droppedBat.visible = s.ph !== 'pitch'; } // [motion] 배트는 팔로스루 끝나고 땅에
  if (batter) {
    batter.p.root.visible = showBatter && !(camMode === 'bat' && false);
    if (showBatter) {
      place(batter, 0.95, 0.05, -Math.PI / 2, dt, 100);
      const nm = nameOf(s.bat && s.bat.id);
      setTag(batter, nm && s.bat.id !== myId ? nm : '', '#ffffff');
      let swingAt = null, contactL = null, loadK = 0;
      if (s.p && s.ph !== 'pitch') {
        loadK = clamp((t - (s.p.t0 - 0.45)) / 0.4, 0, 1);
        if (t > s.p.arrive + 0.3 && !s.p.swingAt && !swungLocal[s.p.id]) loadK = clamp(1 - (t - s.p.arrive - 0.3) / 0.4, 0, 1);
        swingAt = role.batter && swungLocal[s.p.id] ? swungLocal[s.p.id] : s.p.swingAt;
        const info = swingInfo[s.p.id];
        const tgt = info ? info.a : [s.p.tx, s.p.ty];
        contactL = batter.p.root.worldToLocal(_v.set(tgt[0], tgt[1], 0)).clone();
      }
      let swingK = -1;
      if (swingAt != null) {
        if (t >= swingAt - 0.13) swingK = t < swingAt ? 0.3 + 0.2 * (t - (swingAt - 0.13)) / 0.13 : Math.min(1, 0.5 + (t - swingAt) / 0.32 * 0.5);
      }
      if (!batter.trK || batter.trPid !== (s.p && s.p.id)) { batter.trPid = s.p && s.p.id; batter.tr = contactL ? swingTrack(contactL) : null; }
      if (contactL && batter.tr && swingInfo[s.p.id]) batter.tr = swingTrack(contactL);
      const bunt = !!s.bs || (role.batter && buntOn);
      const aimY = s.p && s.ph === 'pitching' && t > s.p.t0 ? s.p.ty - 0.8 : role.batter ? (aimPoint() || [0, 0.8])[1] - 0.8 : 0;
      batter.a.batter(dt, { swingK, loadK, bunt, track: batter.tr, aimY, lookW: _v.set(0, 1.6, 18), intro: !!(intro && camMode === 'intro'), who: s.bat && (s.bat.id || s.bat.name) });
      batter.p.bat.visible = true;
      // 스윙 잔상 + 바람 가르는 소리
      if (!bunt && swingK >= 0.3 && swingK <= 0.78) {
        batter.p.root.updateMatrixWorld(true);
        fx.batPush(batter.p.batPoint(0.42, _w), batter.p.batPoint(0.86, _u));
        if (!batter.swSfx) { batter.swSfx = true; bus.emit('cue:swing', { pid: s.p && s.p.id, power: s.p && s.p.mode === 'power' ? 1 : 0.8 }); } // [audio] 화면 스윙 순간
      }
      if (swingK < 0) batter.swSfx = false;
    }
  }
  // 주자
  const live = new Set();
  for (const r of s.rn || []) {
    const [x0, z0, name, b, pid, flags, target, rid] = r;
    const key = rkey(r);
    live.add(key);
    let A = runners.get(key);
    if (!A) {
      // [qa] 주자는 출루마다 새로 만들고 버리기만 해서(dispose 없음) 경기 내내 지오메트리·텍스처·스켈레톤이 쌓였음 → 같은 모습(팀·번호·seed)끼리 재사용
      const o = { team: batTeamBuilt || 'away', num: (name.charCodeAt(name.length - 1) % 60) + 1, role: 'runner', seed: name.length * 7 + (pid ? pid.length : 0) }, pk = `${o.team}|${o.num}|${o.seed}`;
      A = takeRunner(pk) || mkActor(o); A.poolKey = pk; runners.set(key, A);
    }
    let x = x0, z = z0;
    if (IP) { const q = IP.rn(key); if (q) { x = q[0]; z = q[1]; } } // [net]
    // 리드 (투구 전 베이스에서 살짝 떨어짐)
    const onBase = Math.abs(b - Math.round(b)) < 0.01 && b >= 1 && b <= 3;
    if (onBase && (s.ph === 'pitch' || s.ph === 'pitching') && !(flags & 1)) {
      const [nx, nz] = runnerXZ(b + 0.09); x = nx; z = nz;
    }
    const ox = A.p.root.position.x, oz = A.p.root.position.z;
    const moving = A.init && Math.hypot(x - ox, z - oz) > 0.02;
    let ry = moving ? Math.atan2(x - ox, z - oz) : A.p.root.rotation.y;
    if (!moving && onBase) { const [nx, nz] = runnerXZ(Math.round(b) + 0.5); ry = Math.atan2(-x * 0.2 + (nx - x) * 0.8, -z * 0.2 + (nz - z) * 0.8); }
    const sp = place(A, x, z, ry, dt, 16);
    // 슬라이딩: 목표 베이스 근처, 수비가 공 가지고 근처에 있으면
    const tb = BASES[(target || Math.ceil(b)) % 4];
    const dBase = Math.hypot(tb[0] - x, tb[1] - z);
    let slideK = -1;
    // 슬라이딩은 서버 판정과 같게 (flags 4)
    if ((flags & 4) && s.ph === 'live') { if (!A.slideT) { A.slideT = tp; bus.emit('cue:slide', { rid, x, z }); /* [audio] */ fx.dustPuff(x, z, 2, 1.5); } }
    if (A.slideT) { slideK = (tp - A.slideT) / 0.6; if (slideK > 1.6 || (sp < 0.3 && slideK > 1)) { A.slideT = 0; slideK = -1; } }
    const nm = nameOf(pid);
    setTag(A, nm || '', pid === myId ? '#ffcf3f' : '#fff');
    A.a.runner(dt, { speed: sp, slideK, lead: onBase && (s.ph === 'pitch' || s.ph === 'pitching'), cheer: !!(flags & 2), lookW: onBase ? _v.set(0, 1.2, 15) : null });
    A.p.root.visible = !(showBatter && (b === 0 || (swingHold && b < 0.3))); // [motion] swingHold
  }
  for (const [k, A] of runners) if (!live.has(k)) { parkRunner(A); runners.delete(k); }
  // 심판/코치
  for (const U of umps) {
    let call = null;
    if (U.home && tp - umpCall < 0.9) call = 'strike';
    if (U.callT && tp - U.callT < 1.3) call = U.callKind;
    U.a.ump(dt, { call, stand: !U.home, lookW: ballW || _v.set(0, 1.2, 10) });
  }
  for (const C of coaches) C.a.idle(dt);
  updateCelebration(dt);
  updateBall(dt, t, role, pitchPhase);
}
// ── 끝내기 세리머니: 덕아웃에서 동료들이 뛰어나와 홈 근처에서 방방 뛰고 꽃가루 ──
let celeb = null;
function startCelebration() {
  if (celeb) for (const A of celeb.actors) scene.remove(A.p.root);
  const team = batTeamBuilt || 'home', side = team === 'home' ? 1 : -1;
  const actors = [];
  for (let i = 0; i < 9; i++) {
    const A = mkActor({ team, num: [1, 3, 5, 10, 11, 17, 27, 33, 51][i], role: 'runner', seed: 300 + i });
    A.p.helmetG.visible = false; A.p.capG.visible = true;
    const sx = side * (22 + Math.random() * 6), sz = 14 + Math.random() * 8;
    A.p.root.position.set(sx, 0, sz); A.init = true;
    const a = (i / 9) * Math.PI * 2;
    A.goal = [Math.cos(a) * (1.4 + Math.random() * 1.2), 3.2 + Math.sin(a) * (1.4 + Math.random() * 1.2)];
    A.delay = Math.random() * 0.6; A.jph = Math.random();
    actors.push(A);
  }
  celeb = { t0: nowP(), actors };
  setTimeout(() => fx.confetti(0, 3, 3, 420), 1400);
  setTimeout(() => fx.confetti(0, 3, 3, 300), 3000);
}
function updateCelebration(dt) {
  if (!celeb) return;
  const e = nowP() - celeb.t0;
  if (e > 14 || (screen !== 'game' && screen !== 'over')) { for (const A of celeb.actors) scene.remove(A.p.root); celeb = null; return; }
  for (const A of celeb.actors) {
    const r = A.p.root, [gx, gz] = A.goal;
    const dx = gx - r.position.x, dz = gz - r.position.z, d = Math.hypot(dx, dz);
    if (e < A.delay) { A.a.idle(dt); continue; }
    if (d > 0.4) {
      const v = Math.min(8.2, d * 3);
      r.position.x += dx / d * v * dt; r.position.z += dz / d * v * dt; r.rotation.y = Math.atan2(dx, dz);
      A.a.runner(dt, { speed: v, cheer: true });
    } else {
      // 모여서 점프 + 하이파이브
      r.rotation.y += (Math.atan2(-r.position.x, 3.2 - r.position.z) - r.rotation.y) * Math.min(1, dt * 4);
      const jk = ((e * 1.7 + A.jph) % 1);
      A.a.fielder(dt, { speed: 0, jumpK: jk, throwK: -1, diveK: -1, hasBall: false, ballW: null, reachW: null });
    }
  }
}
function setTag(A, text, color, hide) {
  const tt = hide ? '' : text;
  if (A.tagText === tt) return;
  if (A.tag) { A.p.root.remove(A.tag); A.tag.material.map.dispose(); A.tag.material.dispose(); A.tag = null; }
  A.tagText = tt;
  if (!tt) return;
  const meas = document.createElement('canvas').getContext('2d');
  meas.font = '900 30px "Noto Sans KR", sans-serif';
  const tw = Math.ceil(meas.measureText(tt).width + 28);
  const c = document.createElement('canvas'); c.width = tw + 8; c.height = 64;
  const g = c.getContext('2d');
  g.font = '900 30px "Noto Sans KR", sans-serif';
  g.fillStyle = 'rgba(8,14,30,.8)'; g.beginPath(); g.roundRect(4, 10, tw, 44, 14); g.fill();
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(tt, c.width / 2, 33);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  A.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  A.tag.scale.set(0.6 * c.width / 64, 0.6, 1); A.tag.position.y = 2.45; A.tag.renderOrder = 15;
  A.p.root.add(A.tag);
}
let landPt = null, landT = 0, lastBounceY = 0;
// 공 들고 있을 때: 베이스 위 번호(누를 키) + 주자가 가는 베이스는 금색으로
const baseTags = [1, 2, 3, 4].map((n) => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  sp.renderOrder = 20; sp.visible = false; sp.userData = { c, n, hot: null }; scene.add(sp);
  const B = BASES[n % 4]; sp.position.set(B[0], 2.4, B[1]);
  return sp;
});
function drawBaseTag(sp, hot) {
  if (sp.userData.hot === hot) return; sp.userData.hot = hot;
  const g = sp.userData.c.getContext('2d'); g.clearRect(0, 0, 128, 128);
  g.beginPath(); g.arc(64, 64, 52, 0, 7); g.fillStyle = hot ? 'rgba(255,210,58,.95)' : 'rgba(10,14,24,.78)'; g.fill();
  g.lineWidth = 6; g.strokeStyle = hot ? '#fff' : 'rgba(255,255,255,.7)'; g.stroke();
  g.fillStyle = hot ? '#111' : '#fff'; g.font = '700 64px Oswald, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(sp.userData.n), 64, 68);
  sp.material.map.needsUpdate = true;
}
// 추천 송구 베이스: 가장 앞선 주자가 향하는 베이스(포스/태그 가능), 없으면 1루
// 외야 깊은 곳에서 베이스까지 58m 넘으면 커트맨 경유가 기본
function useRelay(rb, role) {
  if (!S || !S.rl || !['LF', 'CF', 'RF'].includes(role.pos) || !fielders[role.fi]) return false;
  const P = fielders[role.fi].p.root.position, B = BASES[rb % 4];
  return Math.hypot(P.x - B[0], P.z - B[1]) > 58;
}
function recBase() {
  let best = 0;
  for (const r of (S && S.rn) || []) if (r[3] < r[6] && r[6] >= 1 && r[6] > best) best = r[6];
  if (!best) best = 1;
  return Math.min(4, best);
}
function updateBaseTags(role) {
  // 중계 위치 표시: 커트맨(나) 또는 공 든 외야수(나)에게
  const rl = S && S.ph === 'live' && S.rl;
  relayRing.visible = !!(rl && (rl[0] === role.fi || (role.holding && ['LF', 'CF', 'RF'].includes(role.pos))));
  if (relayRing.visible) { relayRing.position.set(rl[1], 0.08, rl[2]); relayRing.scale.setScalar(1 + 0.12 * Math.sin(nowP() * 8)); }
  const on = role.holding && S && S.ph === 'live';
  if (on && pendThrow && nowP() - pendThrow.t < 0.7 && !throwCharge) { net && net.send({ t: 'throw', base: pendThrow.base, p: 0.5 }); pendThrow = null; }
  if (pendThrow && nowP() - pendThrow.t >= 0.7) pendThrow = null;
  const targets = new Set();
  if (on) targets.add(recBase());
  for (const sp of baseTags) {
    sp.visible = on;
    if (!on) continue;
    drawBaseTag(sp, targets.has(sp.userData.n));
    const d = camera.position.distanceTo(sp.position); const sc = clamp(d * 0.045, 1.1, 6); sp.scale.set(sc, sc, 1);
  }
  tbarPow = throwCharge && on ? 0.25 + throwPow() * 0.75 : null; // [ui] 송구 세기 바는 ui/hud.js가 그림
}
let tbarPow = null;
// 내가 조작 중인 수비수 표시 (발밑 링 + 방향 화살표)
const myRing = new THREE.Group();
{
  const ringM = new THREE.MeshBasicMaterial({ color: '#ffd23a', transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.78, 40).rotateX(-Math.PI / 2), ringM); myRing.add(ring);
  const arrow = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.22, 0), new THREE.Vector2(0.22, 0), new THREE.Vector2(0, 0.42)])).rotateX(-Math.PI / 2), ringM);
  arrow.position.z = 0.82; arrow.rotation.y = Math.PI; myRing.add(arrow);
  myRing.position.y = 0.03; myRing.renderOrder = 6; myRing.visible = false; scene.add(myRing);
}
let ringFlash = 0, ringIdx = -1;
function updateMyRing(role) {
  const A = role.fi >= 0 && fielders[role.fi];
  if (!A || screen !== 'game' || camMode === 'pitch' || camMode === 'bat') { myRing.visible = false; ringIdx = role.fi; return; }
  if (role.fi !== ringIdx) { ringIdx = role.fi; ringFlash = nowP(); }
  const e = nowP() - ringFlash;
  myRing.visible = true;
  myRing.position.x = A.p.root.position.x; myRing.position.z = A.p.root.position.z;
  myRing.rotation.y = A.p.root.rotation.y;
  const dcam = camera.position.distanceTo(A.p.root.position);
  const sc = (1 + (e < 0.6 ? (0.6 - e) * 2.2 : 0) + Math.sin(nowP() * 5) * 0.04) * Math.max(1, dcam / 22);
  myRing.scale.set(sc, 1, sc);
}
// 투구 궤적 트레이서 (공이 지나간 뒤 구종 색으로 남김)
const TRN = 48;
const tracerGeo = new THREE.BufferGeometry();
tracerGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(TRN * 3), 3));
const tracerMat = new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, depthWrite: false, depthTest: false, toneMapped: false });
const tracer = new THREE.Mesh(new THREE.BufferGeometry(), tracerMat); tracer.renderOrder = 12; tracer.frustumCulled = false; scene.add(tracer);
let tracerId = null, tracerT = 0;
window.__tr = tracerMat; window.__trl = tracer;
function showTracer(p) {
  const a = tracerGeo.attributes.position.array;
  for (let i = 0; i < TRN; i++) { const q = pitchPos(p, i / (TRN - 1)); a[i * 3] = q[0]; a[i * 3 + 1] = q[1]; a[i * 3 + 2] = Math.max(q[2], -0.3); }
  const pts = []; for (let i = 0; i < TRN; i++) pts.push(new THREE.Vector3(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]));
  tracer.geometry.dispose();
  tracer.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, 0.03, 6, false);
  tracerMat.color.set((PITCHES[p.type] && PITCHES[p.type].col) || '#ffffff');
  tracerId = p.id; tracerT = nowP();
}
function updateTracer() {
  const e = nowP() - tracerT;
  tracerMat.opacity = tracerId == null ? 0 : e < 2.2 ? 0.85 : Math.max(0, 0.85 - (e - 2.2) * 1.5);
  tracer.visible = tracerMat.opacity > 0.01 && (camMode === 'bat' || camMode === 'catch' || camMode === 'tv') && !(S && S.ph === 'pitch');
}
const _predB = {}, _predEv = {}; // [net]
function updateBall(dt, t, role, pitchPhase) {
  const s = S;
  let vis = false;
  blob.visible = false; landRing.visible = false; crossMark.visible = false; guide.visible = false; cutRing.visible = false;
  const tp = nowP();
  if (s.p && (s.ph === 'pitching' || (s.ph === 'result' && !s.b && s.p.res !== 'hit') || (contactFreeze && contactFreeze.pid === s.p.id && s.ph === 'pitching'))) {
    const p = s.p;
    if (t >= p.t0) {
      const sv = (t - p.t0) / p.T;
      ballLook.pitch(p); // [pitch]
      let q = pitchPos(p, Math.min(sv, 1.05));
      if (contactFreeze && contactFreeze.pid === p.id && tp < contactFreeze.until && sv >= 0.95) q = [p.tx, p.ty, 0];
      ballPos.set(q[0], q[1], Math.max(q[2], -0.62));
      // 릴리스 직후: 손에서 나오는 것처럼 보정
      const P = fielders[0];
      if (sv < 0.18 && P) { P.p.ball.getWorldPosition(_v); ballPos.lerp(_v, 1 - sv / 0.18); }
      vis = sv < 1.08 || s.ph === 'pitching';
      if (sv > 1.04) vis = false;
      if (sv < 1.0) fx.trailPush(ballPos, sv < 0.5 ? '#ffffff' : ((PITCHES[p.type] && PITCHES[p.type].col) || '#ffffff'));
      if (sv >= 1.0 && tracerId !== p.id && p.res !== 'hit') showTracer(p);
      if (sv >= 1 && !pitchFb && p.res !== 'hit') {
        pitchFb = true;
        if (!(contactFreeze && contactFreeze.pid === p.id)) bus.emit('cue:mitt', { pid: p.id, kmh: p.kmh }); // [audio] 화면에서 공이 미트에 닿는 순간
      }
      if (sv > 1.0 && (role.batter || role.pitcher || camMode === 'tv')) { crossMark.visible = true; crossMark.position.set(p.tx, p.ty, 0.02); crossMark.material.color.set(inZone(p.tx, p.ty) ? '#ffd23a' : '#5bc8ff'); } // [pitch] 지나간 '뒤'에만: 노랑 = 존 통과(스트라이크), 하늘색 = 볼 — 존 감 익히기용 사후 피드백
    }
  } else if (ballL && (s.ph === 'live' || s.ph === 'result')) {
    if (ballL.h >= 0) {
      vis = false; // 수비수 손 안의 공(모델)이 보임
      const A = fielders[ballL.h]; if (A) A.p.ball.getWorldPosition(ballPos);
    } else if (tp < hitStopUntil) { ballL.tb = t; vis = true; } // 히트스톱: 공 잠깐 멈춤(시각도 같이 멈춤 → 끝나고 따라잡지 않음) [net]
    else {
      // [net] 화면 공 시각(tb) → 지금(t)까지 적분 (프레임 dt 대신: 스냅샷 합류와 같은 시계라 앞서 갔다 끌려오기 없음)
      stepBall(ballL, t, integrate, (ev) => { if (ev.landed && ev.impact > 2.5) { bus.emit('cue:bounce', { impact: ev.impact, surf: ev.surf, x: ballL.x, z: ballL.z }); /* [audio] */ if (ev.surf === 'dirt' && ev.impact > 3) fx.dustPuff(ballL.x, ballL.z, 0.8, 0.8); } });
      ballPos.set(ballL.x, ballL.y, ballL.z);
      ballLook.spinVec(ballL.sx, ballL.sy, ballL.sz); // [pitch]
      fx.trailPush(ballPos, ballL.state === 'thrown' ? '#9fd0ff' : '#ffe6b0');
      vis = true;
      // 낙구 지점
      if (ballL.state === 'air' && ballL.y > 1.2 && ballL.vy > -40) {
        if (tp - landT > 0.08) {
          landT = tp;
          const b = Object.assign(_predB, ballL); // [net] 예측용 공·결과 객체 재사용
          let i = 0; for (; i < 360; i++) { const ev = integrate(b, 1 / 60, true, _predEv); if (ev.landed || ev.wall || ev.over) break; }
          if (!landPt || Math.hypot(landPt[0] - b.x, landPt[1] - b.z) > 3) landTotal = Math.max(0.3, i / 60);
          landLeft = i / 60;
          landPt = [b.x, b.z];
        }
        if (landPt) {
          landRing.visible = true; landRing.position.set(landPt[0], 0.08, landPt[1]); landRing.scale.setScalar(1.3 + 0.1 * Math.sin(tp * 8));
          landLeft = Math.max(0, landLeft - dt);
          landFill.scale.setScalar(Math.max(0.05, landLeft / landTotal));
          const mf = role.fi >= 0 && fielders[role.fi] ? fielders[role.fi].p.root.position : null;
          const inRange = mf && Math.hypot(mf.x - landPt[0], mf.z - landPt[1]) < 1.7;
          const col = inRange ? '#4fd18b' : '#ff8a3d';
          landRing.material.color.set(col); landBeam.material.color.set(col); landFill.material.color.set(col);
          landBeam.visible = role.defense;
        }
      }
      // 수비 가이드
      if (role.defense && role.fi >= 0 && fielders[role.fi] && s.ph === 'live' && (ballL.state === 'air' || ballL.state === 'ground') && ballL.h < 0) {
        const me = fielders[role.fi].p.root.position;
        let tx = null, tz = null, tLeft = 0;
        if (ballL.state === 'air' && landPt && ballL.y > 1.2) { tx = landPt[0]; tz = landPt[1]; tLeft = landLeft; }
        else {
          if (tp - cutT > 0.1) {
            cutT = tp; cut = null;
            const b = Object.assign(_predB, ballL); // [net]
            for (let i = 1; i <= 240; i++) { integrate(b, 1 / 60, true, _predEv); const tt = i / 60; if (b.y < 1.3 && Math.hypot(b.x - me.x, b.z - me.z) / SPRINT_SPEED + 0.12 <= tt) { cut = [b.x, b.z, tp + tt]; break; } }
          }
          if (cut) { tx = cut[0]; tz = cut[1]; tLeft = cut[2] - tp; cutRing.visible = true; cutRing.position.set(tx, 0.07, tz); cutRing.scale.setScalar(1 + 0.1 * Math.sin(tp * 10)); }
        }
        if (tx != null) {
          const dx = tx - me.x, dz = tz - me.z, dd = Math.hypot(dx, dz), need = dd / SPRINT_SPEED;
          const col = dd < 1.6 || need <= tLeft ? '#4fd18b' : need <= tLeft + 0.45 ? '#ffd23a' : '#ff6b5a';
          if (dd > 1.2) { guide.visible = true; guide.position.set(me.x, 0.06, me.z); guide.rotation.y = Math.atan2(dx, dz); guide.scale.set(0.22, 1, dd); guide.material.color.set(col); }
          if (col === '#ffd23a' && dd < 5 && tp - divePromptT > 1.5) { divePromptT = tp; feedback('지금! C 다이빙 / Space 점프', '#ffd23a'); }
        }
      }
    }
  } else if (s.ph === 'pitch' || !s.p) vis = false;
  ballMesh.visible = vis;
  if (vis) {
    ballMesh.position.copy(ballPos);
    // 멀리 날아간 공은 화면에서 점처럼 사라지지 않게 살짝 키워서 그림 (투구 중엔 실제 크기)
    // 날아가는 공은 거리 따라 살짝 키우고, 투구 중인 공은 1.5배로 그려서 '실제 공'을 끝까지 눈으로 따라갈 수 있게 (위치 예측 표시는 없음)
    let bsc = ballL && (s.ph === 'live' || s.ph === 'result') ? clamp(camera.position.distanceTo(ballPos) / 22, 1, 3) * (camera.fov / 52) ** 0.5 : s.ph === 'pitching' && (role.batter || role.pitcher) ? 1.5 : 1;
    // [pitch] 투구 중엔 화면 지름 최소 보장(창이 작거나 어깨 시점이라도 릴리스 직후 점처럼 안 사라지게): 창 높이의 1.2% (800px → 9.6px, 8~14px)
    if (s.ph === 'pitching' && (role.batter || role.pitcher)) { const d = Math.max(0.5, camera.position.distanceTo(ballPos)), px1 = 2 * BALL_R * 1.6 / d * (innerHeight / 2) / Math.tan(camera.fov * Math.PI / 360), want = clamp(innerHeight * 0.012, 8, 14); if (px1 * bsc < want) bsc = want / px1; }
    ballLook.update(dt); // [pitch] 실밥 회전
    ballMesh.scale.setScalar(bsc);
    // [gameplay] 키워 그린 공이 땅에 반쯤 묻혀 '바닥 아래에서 튀는' 것처럼 보이던 것: 그린 반지름만큼 띄움 (물리 위치는 그대로)
    if (ballL && (s.ph === 'live' || s.ph === 'result')) ballMesh.position.y = Math.max(ballPos.y, BALL_R * 1.6 * bsc);
    blob.visible = ballPos.y > 0.12;
    blob.position.set(ballPos.x, 0.06, ballPos.z);
    blob.scale.setScalar(clamp(1 - ballPos.y / 40, 0.35, 1));
  }
  if (!vis) fx.trailClear();
}

// ═════════════ 카메라 연출 ═════════════
const camPos = new THREE.Vector3(0, 60, -100), camLook = new THREE.Vector3(0, 0, 60);
const tPos = new THREE.Vector3(), tLook = new THREE.Vector3();
let camYaw = null, camMode = '', camFov = 55;
let lastCamMode = '', camBlendT = 0;
const camVel = new THREE.Vector3(), lookVel = new THREE.Vector3();
// Unity SmoothDamp 방식 (임계감쇠 스프링)
function smoothDamp(cur, target, vel, smoothTime, dt) {
  const omega = 2 / Math.max(1e-4, smoothTime), x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  for (const c of ['x', 'y', 'z']) {
    const change = cur[c] - target[c];
    const temp = (vel[c] + omega * change) * dt;
    vel[c] = (vel[c] - omega * temp) * exp;
    cur[c] = target[c] + (change + temp) * exp;
  }
}
// 3인칭 수비 카메라: 선수 → 목표 방향을 기본으로, 드래그 회전(잠시 뒤 서서히 복귀)
function tpsCam(me, tx, ty, tz, dt) {
  let yaw = Math.atan2(tx - me.x, tz - me.z);
  const dd = Math.hypot(tx - me.x, tz - me.z);
  // [gameplay 11-19] 목표가 가까우면(뜬공이 내 머리 위 등) 홈→나 방향으로 고정: 화면 위쪽 = 외야로 항상 같고 빙글빙글 안 돎
  if (dd < 4) yaw = Math.hypot(me.x, me.z) > 3 ? Math.atan2(me.x, me.z) : (fcam.yaw ?? yaw);
  if (fcam.yaw == null) fcam.yaw = yaw;
  let d = yaw - fcam.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
  fcam.yaw += d * Math.min(1, dt * 2.2);
  if (nowP() - fcam.dragT > 2.5) { fcam.yawOff *= Math.exp(-dt * 1.2); fcam.pitchOff *= Math.exp(-dt * 1.2); }
  const Y = fcam.yaw + fcam.yawOff;
  // 공이 높이 뜰수록 뒤로·위로 빠져서 '내 선수 + 공'이 같이 보이게 (전엔 고개만 들어서 선수가 화면 밖으로 사라지고 관중석만 보였음)
  const hb = clamp(ty, 0, 14);
  const back = 6.2 + hb * 0.35, up = 2.6 + hb * 0.28 + fcam.pitchOff * 5;
  tPos.set(me.x - Math.sin(Y) * back, up, me.z - Math.cos(Y) * back);
  const lookD = clamp(dd, 5, 30);
  tLook.set(me.x + Math.sin(Y) * lookD, 0.9 + hb * 0.32, me.z + Math.cos(Y) * lookD);
}
// [gameplay] 타구 직후 중계 카메라: 홈 뒤 높은 곳에 고정, 시선은 공이 화면 데드존(가로 ±50%, 위·아래 60%)을 벗어날 때만 따라감.
// 데드존 안에선 배경이 멈춰 있어 공이 실제 속도로 보인다. 화각 고정 54°(줌으로 공 움직임이 상쇄되지 않게)
const DZ = { id: -1, yaw: 0, pitch: 0, pos: new THREE.Vector3(0, 8.5, -15), fov: 54 };
function deadzoneCam(dt) {
  const P = DZ.pos;
  if (DZ.id !== lastContactT) { DZ.id = lastContactT; DZ.yaw = 0; DZ.pitch = Math.atan2(1.5 - P.y, 24 - P.z); }
  const dx = ballPos.x - P.x, dy = ballPos.y - P.y, dz = ballPos.z - P.z;
  const by = Math.atan2(dx, dz), bp = Math.atan2(dy, Math.hypot(dx, dz));
  const th = Math.tan(DZ.fov * Math.PI / 360), ax = Math.atan(0.5 * th * camera.aspect), au = Math.atan(0.62 * th), ad = Math.atan(0.6 * th);
  let ty = DZ.yaw, tq = DZ.pitch;
  if (by - DZ.yaw > ax) ty = by - ax; else if (DZ.yaw - by > ax) ty = by + ax;
  if (bp - DZ.pitch > au) tq = bp - au; else if (DZ.pitch - bp > ad) tq = bp + ad;
  const kk = 1 - Math.exp(-9 * dt);
  DZ.yaw += (ty - DZ.yaw) * kk; DZ.pitch += (clamp(tq, -0.6, 1.0) - DZ.pitch) * kk;
  tPos.copy(P);
  tLook.set(P.x + Math.sin(DZ.yaw) * Math.cos(DZ.pitch) * 30, P.y + Math.sin(DZ.pitch) * 30, P.z + Math.cos(DZ.yaw) * Math.cos(DZ.pitch) * 30);
  return DZ.fov;
}
let camDirect = false;
function updateCamera(dt, time) {
  let k = 4, fov = 55;
  camDirect = false;
  const tp = nowP();
  if (screen === 'title' || screen === 'room' || screen === 'browser' || !S || !S.fl) {
    const a = time * 0.05;
    tPos.set(Math.sin(a) * 175, 46 + Math.sin(time * 0.13) * 8, Math.cos(a) * 165 + 50);
    tLook.set(0, 4, 52); k = 1.5; camMode = 'title';
  } else {
    const role = getRole();
    const ph = S.ph;
    const pitchPhase = ph === 'pitch' || ph === 'pitching' || (ph === 'result' && !S.b && !(S.p && S.p.res === 'hit'));
    const hr = hrCine && tp - hrCineStart < 5.5;
    const IN = rpInfo ? null : introStep();
    if (IN) {
      // ── 등장 컷씬 카메라 ──
      if (IN.kind === 'b') { const B = batter ? batter.p.root.position : _v.set(0.95, 0, 0.05); tPos.set(B.x - 2.5 + IN.e * 0.12, 1.5, B.z + 1.7 - IN.e * 0.1); tLook.set(B.x, 1.38, B.z); fov = 30; }
      else { tPos.set(0.9 - IN.e * 0.1, 1.75, 14.4 + IN.e * 0.15); tLook.set(0, 1.5, 18.44); fov = 28; }
      k = 30; camMode = 'intro';
    } else if (rpInfo) {
      // ── 리플레이 카메라 ──
      const I = rpInfo; fov = 42; k = 7;
      if (I.cam === 'hr' && I.rel < 0.32) {
        // 타자 정면 비스듬히: 스윙과 임팩트
        const a = I.rel * 0.25;
        tPos.set(-2.4 + a, 1.15, 2.7 - a); tLook.set(0.75, 1.05, 0.15); fov = 36; k = 9;
      } else if (I.cam === 'hr') {
        // 공 뒤를 쫓는 추적 카메라
        const b = ballMesh.position, d = Math.hypot(b.x, b.z) || 1, ux = b.x / d, uz = b.z / d;
        tPos.set(b.x - ux * 11 - uz * 3, Math.max(2.5, b.y * 0.7 + 3), b.z - uz * 11 + ux * 3); tLook.copy(b); fov = 48; k = 5;
      } else {
        // 호수비: 야수 옆 낮은 시점, 천천히 회전
        const F = I.focus ? I.focus.root.position : ballMesh.position;
        const base = Math.atan2(-F.x, -F.z) + 0.9 + I.rel * 0.35;
        tPos.set(F.x + Math.sin(base) * 5.2, 1.25, F.z + Math.cos(base) * 5.2); tLook.set(F.x, 0.8, F.z); fov = 44; k = 6;
      }
      camMode = 'replay';
    } else if (hr) {
      const e = tp - hrCineStart;
      if (e < 2.4 && ballMesh.visible) {
        // 공 따라가기
        tPos.set(ballPos.x * 0.35, 6 + ballPos.y * 0.55, ballPos.z * 0.5 - 12);
        tLook.copy(ballPos); k = 4; fov = 50;
      } else {
        // 외야 관중석 + 불꽃 와이드
        const a = (e - 2.4) * 0.08;
        tPos.set(Math.sin(a) * 30, 9, -18 + e * 2);
        tLook.set(0, 40, 140); k = 1.6; fov = 58;
      }
      camMode = 'hr';
    } else if (pitchPhase && role.batter) {
      // 기본: 포수 뒤 중계 시점(투수 폼·스트라이크존이 한눈에). V로 타자 어깨 시점 전환
      // 기본: 포수 뒤 망원(투수가 크게, 존은 화면 아래 중앙, 타자는 왼쪽 가장자리)
      if (cfg.batCam === 1) { tPos.set(-0.55, 1.66, -3.6); tLook.set(-0.05, 1.0, 14); fov = 38; }
      else { tPos.set(-0.32, 1.72, -6.6); tLook.set(-0.08, 0.42, 12); fov = 25; }
      k = 8; camMode = 'bat';
    }
    else if (pitchPhase && role.pitcher) {
      // 투수 어깨 너머(3루 쪽 뒤): 와인드업·팔 스윙이 보이고 포수 미트까지 보이게
      // 조준할 땐 존이 크게 보이게, 던지는 순간부터는 뒤로 빠져서 투구 폼 + 공 궤적이 보이게
      // 투수 뒤 높은 곳: 투수 전신이 화면 아래, 홈플레이트·타자가 화면 가운데 (조준 ↔ 투구 동안 시점 고정)
      // [gameplay 11-19] 조준 중: 존이 화면 높이의 ~15%(전엔 ~5%)로 보이게 투수 머리 위로 가깝게 + 망원. 시선은 투수 머리 위로 지나가서 존을 안 가림
      if (ph === 'pitch') { tPos.set(0.5, 3.2, 24.6); tLook.set(0.02, 0.8, 0); fov = 9.5; k = 6; }
      else { tPos.set(0.95, 4.4, 30.8); tLook.set(0.1, 0.58, 6); fov = 25; k = 4; }
      camMode = 'pitch';
    }
    else if (pitchPhase && role.pos === 'C') { tPos.set(0.25, 1.85, -4.6); tLook.set(0, 1.1, 18); k = 6; camMode = 'catch'; fov = 50; }
    else if (pitchPhase && role.fi >= 0 && fielders[role.fi] && cfg.fieldCam === 'tps') {
      // 내 포지션 뒤에서 홈플레이트 쪽을 봄 (드래그로 회전)
      tpsCam(fielders[role.fi].p.root.position, 0, 1.0, 0, dt); k = 5; camMode = 'fwait'; fov = 50;
    }
    else if (pitchPhase && role.fi >= 0 && fielders[role.fi]) {
      // 투구 대기: 수비 중 카메라와 같은 방향(홈 뒤 높은 곳) → 타구 나와도 시점이 뒤집히지 않음
      const P = fielders[role.fi].p.root.position;
      const cz = (P.z + 18) / 2, cx = P.x / 2;
      tPos.set(cx * 0.3, 8 + Math.max(P.z, 10) * 0.12, -14 + cz * 0.2);
      tLook.set(cx, 0.8, cz); k = 4; camMode = 'fwait'; fov = 50;
    } else if (pitchPhase) {
      // 중계 카메라: 중견수 뒤 망원
      tPos.set(3.2, 7.6, 118); tLook.set(0.0, 1.05, 0); k = 6; camMode = 'tv'; fov = 4.4;
    } else if (role.pos === 'P' && (ph === 'live' || (ph === 'result' && S.b)) && !role.holding && !['chase', 'cover', 'hold', 'relay'].includes(myDuty(S, role)?.k)) {
      // 투수가 할 일이 없을 땐 내 선수 따라 흔들리지 않게 '중계 카메라'로 고정 → 어지럽지 않음
      const bz = ballPos.z, bx = ballPos.x;
      if (!ballMesh.visible) { tPos.set(0, 9, -15); tLook.set(0, 1, 20); }
      else if (tp - lastContactT < 2.4) { fov = deadzoneCam(dt); camDirect = true; } // [gameplay] 고정 중계 + 데드존 (공이 화면 가운데 영역을 실제 속도로 지나감)
      else { const far = clamp(bz, 0, 120); tPos.set(bx * 0.2, 8 + far * 0.08, -15 + far * 0.18); tLook.set(bx * 0.8, Math.max(0.6, Math.min(ballPos.y, 20) * 0.5), Math.max(8, bz * 0.85)); fov = 52; }
      k = tp - lastContactT < 2.4 ? 6 : 2.2; camMode = 'pwatch';
    } else if (role.fi >= 0 && fielders[role.fi] && (ph === 'live' || (ph === 'result' && S.b)) && cfg.fieldCam === 'tps') {
      // 3인칭: 내 선수 뒤에서 공(또는 낙구 지점) 쪽을 봄
      const me = fielders[role.fi].p.root.position;
      const tgt = landRing.visible ? landRing.position : ballMesh.visible ? ballPos : null;
      if (tgt) tpsCam(me, tgt.x, ballMesh.visible ? ballPos.y : 1, tgt.z, dt);
      else tpsCam(me, 0, 1, 0, dt);
      k = 4.5; camMode = 'field'; fov = 56;
    } else if (role.fi >= 0 && fielders[role.fi] && (ph === 'live' || (ph === 'result' && S.b))) {
      // 수비 카메라: 홈 뒤 높은 곳에서 '공 + 내 수비수'를 같이 잡는 중계 시점.
      // 조작 선수가 바뀌어도 카메라가 휙 돌지 않고, W = 외야 쪽 / S = 홈 쪽 / A·D = 화면 좌우로 항상 같음
      const me = fielders[role.fi].p.root.position;
      const bx = ballMesh.visible || role.holding ? ballPos.x : me.x, bz = ballMesh.visible || role.holding ? ballPos.z : me.z;
      const cx = (me.x + bx) / 2, cz = (me.z + bz) / 2;
      const spread = Math.hypot(me.x - bx, me.z - bz);
      const far = Math.max(cz, 10);
      tPos.set(cx * 0.3, 7 + far * 0.13 + spread * 0.12 + clamp(ballPos.y * 0.15, 0, 6), -14 + cz * 0.3 - spread * 0.15);
      tLook.set(cx, Math.max(0.5, ballMesh.visible ? Math.min(ballPos.y, 14) * 0.45 : 0.8), cz);
      k = 3.2; camMode = 'field'; fov = clamp(46 + spread * 0.25, 46, 62);
    } else {
      // 타구 중계: 홈 뒤에서 공 추적, 멀리 가면 높이
      // 중계 카메라: 맞은 직후엔 홈 뒤에 '고정'하고 고개만 돌려 공을 따라감 → 공이 실제 속도로 쭉 뻗어나가 보임
      // (카메라가 공이랑 같이 날아가면 화면상 공이 느려 보임). 공이 멀리 가거나 떨어진 뒤에만 천천히 따라감
      const bz = ballPos.z, bx = ballPos.x, tc = tp - lastContactT, fly = ballL && ballL.state === 'air';
      if (!ballMesh.visible && !(S.b && S.b[6] >= 0)) { tPos.set(0, 30, -30); tLook.set(0, 0, 30); k = 3; fov = 52; }
      else if (tc < 2.4 && (fly || bz < 40)) {
        // [gameplay] 맞는 순간 중계 위치로 '컷'(쓸어가는 블렌드·줌아웃 없음) → 카메라 고정, 공이 화면 가운데 데드존을 벗어날 때만 고개를 돌림.
        // 예전(고개가 공을 계속 따라가고 줌이 25°→54°로 풀림)은 화면상 공 속도가 고정 카메라의 51~68%였음 (docs/rebuild/gameplay.md)
        fov = deadzoneCam(dt); camDirect = true; k = 6;
      } else { tPos.set(bx * 0.35, 14 + bz * 0.1 + ballPos.y * 0.15, bz * 0.3 - 16); tLook.copy(ballPos).setY(Math.max(0.5, ballPos.y * 0.7)); k = 2; fov = 52; }
      camMode = 'follow';
    }
  }
  if (window.__cam) { const c = window.__cam; tPos.set(...c.pos); tLook.set(...c.look); fov = c.fov || 50; k = 1000; }
  const a = 1 - Math.exp(-k * dt);
  // 스프링(임계감쇠)으로 따라감: 시작·끝이 부드럽고 튀지 않음. 시점이 바뀐 직후엔 잠깐 더 천천히 블렌드
  if (camMode !== lastCamMode) { camBlendT = nowP(); lastCamMode = camMode; }
  const blend = clamp((nowP() - camBlendT) / 0.7, 0, 1);
  const smooth = (window.__cam || window.__fastCam ? 0.0001 : (1 / Math.max(0.5, k)) * (1.6 - 0.6 * blend));
  if (camDirect) { camPos.copy(tPos); camLook.copy(tLook); camVel.set(0, 0, 0); lookVel.set(0, 0, 0); camFov = fov; } // [gameplay] 데드존 카메라는 직접 (스프링 지연 없음)
  else { smoothDamp(camPos, tPos, camVel, smooth, dt); smoothDamp(camLook, tLook, lookVel, smooth * 0.85, dt); }
  void a;
  camera.position.copy(camPos);
  if (shake > 0 && cfg.shake) {
    camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake;
    shake = Math.max(0, shake - dt * 0.9);
  } else shake = 0;
  camera.lookAt(camLook);
  if (!camDirect) camFov = window.__cam || window.__fastCam ? fov : lerp(camFov, fov, camMode === 'tv' || fov < 30 ? Math.min(1, a * 1.5) : a);
  camPunch = Math.max(0, camPunch - dt * 18);
  const fovNow = camFov - camPunch;
  if (Math.abs(camera.fov - fovNow) > 0.01) { camera.fov = fovNow; camera.updateProjectionMatrix(); }
  // 타자 시점에선 포수·주심 숨김
  const hideC = camMode === 'bat';
  umps[0].p.root.visible = !hideC;
  const ci = S && S.fl ? S.fl.findIndex((f) => f[0] === 'C') : -1;
  if (ci >= 0 && fielders[ci]) fielders[ci].p.root.visible = !hideC;
  if (batter) batter.p.root.traverse((o) => { if (o.isMesh) o.material.transparent = false; });
}

// ═════════════ HUD: 3D 조준 표시 + ui 연결 ═════════════
// [ui] DOM HUD(스코어버그·볼카운트·안내·게이지·핑 등)는 client/ui/hud.js. 여기는 장면 안의 존·배트 원·조준점만 + ui.frame 호출
function updateHUD() {
  if (!S || !S.fl || (screen !== 'game' && screen !== 'over')) return;
  const role = getRole();
  const s = S;
  const pitchPhase = s.ph === 'pitch' || s.ph === 'pitching';
  // 릴리스 순간 손끝 반짝 + 소리 (타자 와인드업 신호 '온다!'와 같은 순간)
  if (role.batter && s.ph === 'pitching' && s.p && s.mode !== 'derby' && simNow() >= s.p.t0 && seen.rel !== s.p.id) { seen.rel = s.p.id; bus.emit('cue:release', { pid: s.p.id, kmh: s.p.kmh }); /* [audio] */ fx.impact(new THREE.Vector3(RELEASE[0] - 0.15, RELEASE[1], RELEASE[2]), 0.22); }
  // 존/커서
  zoneGroup.visible = pitchPhase && camMode !== 'intro' && (role.batter || role.pitcher || camMode === 'tv' || camMode === 'catch');
  if (zoneGroup.visible && zoneMesh) { // 타석일 땐 진하게, 와인드업~투구 중엔 살짝 더 밝게
    const live = s.ph === 'pitching';
    zoneMesh.material.opacity = role.batter ? (live ? 1 : 0.9) : role.pitcher ? 0.85 : 0.6;
  }
  pci.visible = false; aimMark.visible = false; assistDot.visible = false; timeRing.visible = false; pciHot = false;
  if (role.batter && s.ph === 'pitching' && s.p && !swungLocal[s.p.id]) {
    const p = s.p, sv = (simNow() - p.t0) / p.T;
    const bunt = buntOn || s.bs;
    // [gameplay] 공이 들어올 자리 표시(assistDot)는 '공 위치 미리보기 금지' 규칙 위반이라 끔 — 쉬움은 판정 폭·자석 보정으로
    const showLoc = false;
    if (showLoc && sv < 1.1) {
      assistDot.visible = true; assistDot.position.set(p.tx, p.ty, -0.01); assistDot.lookAt(camera.position);
      const op = clamp((sv - (cfg.assist === 2 ? 0.3 : 0.6)) / 0.15, 0, 1);
      assistDot.children[0].material.opacity = 0.5 * (bunt ? 1 : op); assistDot.children[1].material.opacity = 0.9 * (bunt ? 1 : op);
    }
    // 타이밍 보조(기본): 줄어드는 링 대신 배트 원 테두리가 '지금!' 구간에서만 초록으로
    pciHot = cfg.assist > 0 && Math.abs(sv - 1) * p.T < (bunt ? SWING.bunt.W : PCI.contact.W * hitEase()) * 0.55; // [gameplay] 타이밍 창 안쪽 55% = 초록 (시간만, 위치는 안 알려줌)
    if (cfg.assist === 2 && sv > 0 && sv < 1.15) {
      const R = bunt ? SWING.bunt.R * 0.6 : PCI.contact.RX * hitEase();
      const rr = R + Math.max(0, 1 - sv) * 0.5;
      const ap = aimPoint() || [0, 0.8]; // [gameplay] 타이밍 링은 공 자리 대신 내 배트 원 위에 (위치 미리보기 금지)
      timeRing.visible = true; timeRing.position.set(ap[0], ap[1], -0.015); timeRing.scale.setScalar(rr); timeRing.lookAt(camera.position);
      timeRing.material.color.set(pciHot ? '#4fd18b' : '#ffffff'); timeRing.material.opacity = clamp(sv * 1.5, 0, 0.6);
    }
  }
  const a = (role.batter || role.pitcher) && pitchPhase ? aimPoint() : null;
  const mode = mode2();
  if (a && role.batter && camMode !== 'intro') PCIv.update(a, mode, hitEase(), pciHot, camera, SWING.bunt.R); // [gameplay] 정타/강타 크기 다름, 그려진 크기 = 판정 크기
  if (camMode === 'intro') { pci.visible = false; aimMark.visible = false; }
  if (role.pitcher && s.ph === 'pitch' && camMode !== 'intro') {
    const aim = gauge ? gauge.aim : a;
    if (aim) { aimMark.visible = true; aimMark.position.set(aim[0], aim[1], 0.01); aimMark.lookAt(camera.position); }
  }
  // 투구 게이지 (값 계산·자동 투구는 여기, 그림은 ui)
  let g = null;
  if (gauge && role.pitcher) {
    const el = nowP() - gauge.t0, lv = gaugeLevel(el);
    g = { lv, type: gauge.type, band: pBand() }; // [gameplay] 모드별 퍼펙트 구간 → ui 게이지
    if (el > GAUGE_UP * 2) sendPitch(0.35);
  }
  if (s.ph !== 'pitch' && gauge) gauge = null;
  if (TOUCH) renderTouchButtons(role);
  ui.frame(role, {
    camMode, gauge: g, pitchType, bunt: !!(buntOn || s.bs), swingMode: mode, aimOn: !!(a && role.batter && camMode !== 'intro'),
    throwPow: tbarPow, landChase: landRing.visible && s.ch === role.fi,
    ballDist: ballL && ballL.h < 0 ? Math.hypot(ballPos.x, ballPos.z) : null,
    fps: curFps, rtt, pgList, jit: NI.jit,
  });
}
// 미니맵
const mm = $('minimap').getContext('2d');
// [net] 경기장 바탕(펜스·내야·베이스)은 안 바뀌니 한 번만 그려 두고 복사 — 전엔 2프레임마다 다시 그리며 점마다 배열을 새로 만들어 GC 압력(2분에 ~30MB)
let mmBg = null;
const MMW = 300, MMS = MMW / 270, MMX = MMW / 2, MMY = MMW - 22;
const mmx = (x) => MMX - x * MMS, mmy = (z) => MMY - z * MMS;
function mmDot(x, z, r, col, stroke) { mm.fillStyle = col; mm.beginPath(); mm.arc(mmx(x), mmy(z), r, 0, 7); mm.fill(); if (stroke) { mm.strokeStyle = '#fff'; mm.lineWidth = 1.5; mm.stroke(); } }
function drawMinimap() {
  if (!S || !S.fl || screen !== 'game') return;
  if (!mmBg) {
    mmBg = document.createElement('canvas'); mmBg.width = mm.canvas.width; mmBg.height = mm.canvas.height;
    const g = mmBg.getContext('2d');
    g.fillStyle = 'rgba(47,125,54,.55)'; g.beginPath(); g.moveTo(mmx(0), mmy(-3));
    for (let i = 0; i <= 40; i++) { const phi = -FOUL + i / 40 * FOUL * 2; const r = fenceR(phi); g.lineTo(mmx(Math.sin(phi) * r), mmy(Math.cos(phi) * r)); }
    g.closePath(); g.fill();
    g.fillStyle = 'rgba(181,119,74,.7)'; g.beginPath(); BASES.forEach(([x, z], i) => { const a = mmx(x * 1.15), b = mmy(z * 1.08 - 1); i ? g.lineTo(a, b) : g.moveTo(a, b); }); g.closePath(); g.fill();
    g.fillStyle = '#fff'; for (const [x, z] of BASES) g.fillRect(mmx(x) - 3, mmy(z) - 3, 6, 6);
  }
  mm.clearRect(0, 0, MMW, MMW);
  mm.drawImage(mmBg, 0, 0);
  const role = getRole();
  const ft = S.half === 0 ? '#3a6ee0' : '#d13a43', bt = S.half === 0 ? '#d13a43' : '#3a6ee0';
  for (let i = 0; i < S.fl.length; i++) { const f = S.fl[i], me = i === role.fi; if (me && ctl.active) mmDot(ctl.x, ctl.z, 7, '#ffcf3f'); else mmDot(f[1], f[2], me ? 7 : 5, me ? '#ffcf3f' : ft); }
  for (const r of S.rn || []) mmDot(r[0], r[1], 5, r[4] === myId ? '#ffcf3f' : bt, true);
  if (ballMesh.visible) mmDot(ballPos.x, ballPos.z, 4, '#fff');
  if (landRing.visible) { mm.strokeStyle = '#ff8a3d'; mm.lineWidth = 2; mm.beginPath(); mm.arc(mmx(landRing.position.x), mmy(landRing.position.z), 7, 0, 7); mm.stroke(); }
}

// ═════════════ 메인 루프 ═════════════
let lastT = performance.now(), frameN = 0;
const perfAcc = { t: 0, n: 0, skip: 2 };
// [fix] 프레임 안에서 예외가 하나라도 나면 requestAnimationFrame 이 다시 안 불려 화면이 영영 멈췄음 → 다음 프레임은 항상 예약하고 오류는 콘솔에만
let frameErrs = 0;
function frame(now, manual) {
  if (!manual) requestAnimationFrame(frame);
  try { frameBody(now, manual); } catch (e) { if (frameErrs++ < 20) console.error('[frame]', e); if (manual) throw e; }
}
function frameBody(now, manual) {
  if (window.__vclock) now = performance.now(); // 테스트용 가상 시계
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  const time = now / 1000;
  frameN++;
  // 자동 그래픽 조정: 게임 중 4초 평균이 38fps 밑이면 한 단계 낮춤
  if (screen === 'game' && !window.__vclock) {
    perfAcc.t += dt; perfAcc.n++;
    if (perfAcc.t > 4) {
      const fps = perfAcc.n / perfAcc.t; perfAcc.t = 0; perfAcc.n = 0; curFps = Math.round(fps);
      if (perfAcc.skip > 0) perfAcc.skip--;
      else if (fps < 38 && cfg.gq !== 'low' && !document.hidden) { cfg.gq = cfg.gq === 'high' ? 'mid' : 'low'; store.set('gq', cfg.gq); applyQuality(); toast(`화면이 버벅여서 그래픽을 '${cfg.gq === 'mid' ? '중간' : '낮음'}'으로 낮췄어 (설정에서 변경)`); }
    }
  }
  const inGame = S && S.fl && S.fl.length && (screen === 'game' || screen === 'over');
  if (inGame) {
    updateControl(dt);
    replay.tick(nowP());
    // 다음 투구가 시작되면(와인드업) 리플레이는 바로 끝냄 → 타자가 공을 놓치지 않게
    if ((replay.active || replay.pending) && S.ph === 'pitching' && S.p && simNow() > S.p.t0 - WINDUP + 0.05) { replay.stop(); replay.pending = null; }
    rpInfo = replay.active ? replay.update(dt, ballMesh, allPlayers()) : null;
    $('replay').classList.toggle('on', !!rpInfo);
    if (rpInfo) {
      blob.visible = landRing.visible = guide.visible = cutRing.visible = relayRing.visible = pci.visible = zoneGroup.visible = aimMark.visible = crossMark.visible = false;
      blob.visible = ballMesh.visible; blob.position.set(ballMesh.position.x, 0.06, ballMesh.position.z);
    } else {
      updateWorld(dt);
      replay.record(nowP(), allPlayers(), ballMesh);
    }
  } else {
    ballMesh.visible = blob.visible = landRing.visible = guide.visible = cutRing.visible = relayRing.visible = pci.visible = zoneGroup.visible = aimMark.visible = crossMark.visible = false;
    for (const U of umps) U.a.ump(dt, {});
  }
  if (contactFreeze && nowP() > contactFreeze.until) contactFreeze = null;
  updateCalls();
  updateTracer();
  if (S && S.fl) { const rr = getRole(); updateMyRing(rr); updateBaseTags(rr); }
  updateCamera(dt, time);
  updateHUD();
  if (frameN % 2 === 0) drawMinimap();
  excite = Math.max(0, excite - dt * 0.18);
  stadium.update(time, inGame ? excite : 0.15);
  // 전광판
  if (inGame) {
    const lp = S.lp ? { id: S.lp.id, kmh: S.lp.kmh, name: PITCHES[S.lp.type]?.name } : null;
    const big = bigBoard && nowP() - bigBoard.t < 6 ? bigBoard : null;
    stadium.drawScoreboard(S, big ? { big: big.big, sub: big.sub } : { lp });
  }
  fx.update(dt, camera);
  if (window.__noRender) return; // 테스트용
  syncAllSkins(camera);
  look.render(); // [stadium]
}
window.__frame = (t) => frame(t, true);
requestAnimationFrame(frame);
document.fonts && document.fonts.ready.then(() => { stadium.refreshText(); stadium.drawScoreboard(S); });
for (const f of ['900 40px "Noto Sans KR"', '700 40px Oswald', '40px "Black Han Sans"']) document.fonts?.load(f).then(() => stadium.refreshText()).catch(() => {});
