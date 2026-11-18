// main.js — 홈런왕 클라이언트
import * as THREE from 'three';
import {
  Game, HIT_EASE, pitchPos, integrate, fenceR, BASES, MOUND, ZONE, PITCHES, PITCH_KEYS, POS_KO, HOME_SPOT, FOUL, SPRINT_SPEED, FIELD_SPEED,
  RELEASE, WINDUP, SWING, BALL_R, runnerXZ, RULES, // [gameplay] RULES: 모드별 퍼펙트 투구 구간
} from '../shared/sim.js';
import { Player, UNIFORMS, setFaceTextures } from './player.js';
import { loadSkin, attachSkin, syncAllSkins } from './skinned.js';
import { Replay } from './replay.js';
import { CLUBS, clubOf, emblemURL, uniformsFor } from './emblem.js';
import { TEX_AVG, FACE_SKINS } from './texinfo.js';
import { Animator, PITCH_DUR, PITCH_RELEASE_K, THROW_DUR, swingTrack, pitchK } from './anim.js';
import { buildStadium, glowTex, createLook } from './stadium.js'; // [stadium] 구장 + 조명·톤매핑·블룸(look)
import { FX } from './fx.js';
import { sfx, audio, setVolume, crowdAmbience } from './audio.js';
import { bus } from './core/bus.js'; // [gameplay] 게임 이벤트 → bus

const OFFLINE = !!window.HR_OFFLINE;
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const nowP = () => performance.now() / 1000;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TOUCH = matchMedia('(pointer: coarse)').matches;

// ═════════════ 설정 ═════════════
const store = {
  get(k, d) { try { const v = localStorage.getItem('hr_' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('hr_' + k, JSON.stringify(v)); } catch { } },
};
const cfg = { vol: store.get('vol', 80), gq: store.get('gq', TOUCH ? 'low' : 'mid'), shake: store.get('shake', 1), sens: store.get('sens', 100), assist: store.get('assist2', 1), batCam: store.get('batCam', 0), replay: store.get('replay', 1), cast: store.get('cast', 1), fieldCam: store.get('fieldCam', 'tps') };
const fcam = { yawOff: 0, pitchOff: 0, dragT: 0, yaw: null };
setVolume(cfg.vol / 100);

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
const pci = new THREE.Group();
let pciHot = false;
const hitEase = () => (S && S.hx) || HIT_EASE[(S && S.he) ?? 0] || 1; // [gameplay] hx = 서버가 쓰는 실제 판정 폭(모드·난이도 반영)
const mode2 = () => (buntOn || (S && S.bs) ? 'bunt' : keys.f ? 'power' : 'contact');
// 배트 중심(PCI): 얇은 타원 테두리 + 아주 옅은 채움 + 가운데 점 하나. 타이밍 맞을 때만 테두리가 초록으로
const pciOuter = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 64), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthTest: false, side: THREE.DoubleSide }));
const pciFill = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.06, depthTest: false, side: THREE.DoubleSide }));
const pciSweet = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.08, 28), new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false, side: THREE.DoubleSide, transparent: true, opacity: 0 }));
const pciDot = new THREE.Mesh(new THREE.CircleGeometry(0.014, 16), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide }));
pci.add(pciFill, pciOuter, pciSweet, pciDot); pci.children.forEach((c) => (c.renderOrder = 11)); scene.add(pci);
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
let lobby = null, S = null, prevS = null, offset = null;
let screen = 'title';
const simNow = () => nowP() + (offset || 0);

// 인물들
let fielders = [], fieldTeamBuilt = null, batter = null, batTeamBuilt = null;
const runners = new Map();
const umps = [];
const coaches = [];
if (!/noskin/.test(location.search)) loadSkin((window.HR_ASSETS && window.HR_ASSETS.model) || './assets/models/body.bin', (window.HR_ASSETS && window.HR_ASSETS.modelLo) || './assets/models/body_lo.bin');
function mkActor(opts) { const p = new Player(opts); p.setRole(opts.role || 'fielder'); attachSkin(p); scene.add(p.root); p.root.traverse((o) => { if (o.isMesh) { const g = o.geometry, n = g ? (g.index ? g.index.count : g.attributes.position.count) / 3 : 0; o.castShadow = o.isSkinnedMesh || n > 400; } }); /* 작은 장식(모자 실밥·밴드 등)은 그림자 생략 → 그림자 패스 드로우콜 절반 */ return { p, a: new Animator(p), init: false, spd: 0, px: 0, pz: 0 }; }
function clearActors() {
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
    const nums = { P: 18, C: 22, '1B': 25, '2B': 4, '3B': 13, SS: 6, LF: 7, CF: 8, RF: 9 };
    fielders = s.fl.map((f, i) => { const A = mkActor({ team: ft, num: nums[f[0]], role: f[0] === 'C' ? 'catcher' : 'fielder', seed: i + (ft === 'home' ? 0 : 50) }); A.pos = f[0]; return A; });
    fieldTeamBuilt = key;
  }
  if (batTeamBuilt !== bt) {
    if (batter) scene.remove(batter.p.root);
    batter = mkActor({ team: bt, num: 24, role: 'batter', seed: 99 });
    for (const A of runners.values()) scene.remove(A.p.root);
    runners.clear();
    for (const A of coaches) scene.remove(A.p.root); coaches.length = 0;
    for (const [x, z] of [[-24, 21], [24, 21]]) { const C = mkActor({ team: bt, num: 70 + coaches.length, role: 'fielder', seed: x }); C.p.glove.visible = false; C.p.root.position.set(x, 0, z); C.p.root.rotation.y = Math.atan2(-x, -z + 10); coaches.push(C); }
    batTeamBuilt = bt;
  }
}

// ═════════════ 네트워크 ═════════════
function startLocal(name, o) {
  const game = new Game({ emit: (m) => handleMsg(m), sendTo: (id, m) => handleMsg(m), onGameOver: (sum) => saveLocalCareer(sum, name) });
  myId = 'me'; myName = name;
  game.addPlayer('me', name);
  const me = game.players.get('me'); me.team = o.team; me.pos = o.pos;
  game.applySettings({ mode: o.mode, innings: o.inn, derbyOuts: o.mode === 'derby' ? Math.max(5, o.inn * 3) : 10, diff: o.diff, clubs: o.clubs || [0, 1], pitRot: 'fixed', fieldCtl: o.fld || 'pos', tod: o.tod || 'night', hitEase: o.hitEase ?? 1, rules: o.rules }); // [gameplay] rules: 'real' | 'casual' (ui가 메뉴에서 넘겨줄 것)
  applyClubs(game.set.clubs);
  let last = performance.now();
  const tickFn = () => {
    const t = performance.now(); const dt = Math.min(0.1, (t - last) / 1000); last = t;
    if (dt <= 0) return;
    game.tick(dt);
    handleMsg(game.snapshot(true)); // [gameplay] true: 이벤트(ev)도 같이
  };
  const iv = setInterval(tickFn, 1000 / 60);
  net = { send: (m) => game.handle('me', m), close: () => clearInterval(iv), local: true, game };
  window.__hr = { game, getRole: () => getRole(), cam: () => camMode, S: () => S, net: () => net, rp: replay, lct: () => lastContactT, scene, tick: tickFn, renderer };
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
  ws.onopen = () => { opened = true; wsRetry = 0; $('conn').classList.add('hide'); };
  ws.onmessage = (e) => { lastMsgAt = performance.now(); try { handleMsg(JSON.parse(e.data)); } catch (err) { console.error(err); } };
  ws.onclose = (e) => {
    if (!net || net.ws !== ws) return;
    if (e.code === 4001) { toTitle(); openPw(code); showErr('비밀번호가 틀렸어'); return; }
    if (e.code === 4002 || e.code === 4003) { toTitle(); showErr(e.reason || '방에 들어갈 수 없어'); return; }
    if (e.code === 4004) { toTitle(); showErr('다른 창에서 접속했어'); return; }
    if (!opened && !myId) { toTitle(); showErr('방에 접속할 수 없어'); return; }
    $('conn').classList.remove('hide');
    // 재접속: 토큰으로 원래 자리로 복귀. 처음엔 빠르게, 점점 간격 늘려 최대 2분 정도 계속 시도
    if (wsRetry < 30) { wsRetry++; setTimeout(() => { if (net && net.ws === ws) connectWS(code, name); }, Math.min(4000, 400 * wsRetry)); }
  };
  net = { ws, send: (m) => ws.readyState === 1 && ws.send(JSON.stringify(m)), close: () => { net = null; ws.close(); } };
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
    case 'welcome': myId = m.id; myToken = m.token; if (m.code) sessionStorage.setItem('hr_tok_' + m.code, m.token); break;
    case 'pong': rtt = Math.round(performance.now() - m.c); net && net.send({ t: 'rtt', ms: rtt }); break;
    case 'lobby': lobby = m; renderLobby(); break;
    case 'chat': addChat(m.name, m.text, m.team); break;
    case 'kicked': toTitle(); showErr('방장이 내보냈어'); break;
    case 'toast': toast(m.text); break;
    case 's': onSnap(m); if (m.ev) for (const x of m.ev) bus.emit(x.e, x); break; // [gameplay] 게임 이벤트 연결 지점 (docs/rebuild/events.md)
  }
}

// ═════════════ 화면 ═════════════
function show(id, on) { $(id).classList.toggle('hide', !on); }
function setScreen(sc) {
  screen = sc;
  show('title', sc === 'title'); show('browser', sc === 'browser'); show('room', sc === 'room');
  show('hud', sc === 'game' || sc === 'over'); show('over', sc === 'over');
  document.querySelector('.credit').classList.toggle('hide', sc !== 'title');
  show('touch', TOUCH && sc === 'game');
}
function toTitle() {
  if (net) { const n = net; net = null; n.close(); }
  clearInterval(pingIv);
  S = null; prevS = null; lobby = null; offset = null; myId = null; snapHist.length = 0; netQ.lastArr = 0;
  setScreen('title');
  history.replaceState(null, '', location.pathname);
  clearActors();
  crowdAmbience(0.05);
}
function showErr(t) { $('err').textContent = t || ''; }
let toastT = 0;
function toast(t) { const e = $('toast'); e.textContent = t; e.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => e.classList.remove('show'), 2800); }
function modal(id, on = true) { show(id, on); if (on) sfx.ui(); }
document.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => b.closest('.modal').classList.add('hide')));
document.querySelectorAll('.seg').forEach((seg) => seg.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || seg.classList.contains('ro')) return;
  seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  seg.dispatchEvent(new CustomEvent('change', { detail: b.dataset.v }));
}));
const segVal = (id) => $(id).querySelector('.on')?.dataset.v;
const setSeg = (id, v) => $(id).querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.v === String(v)));

$('nick').value = store.get('name', '');
function getName() {
  const n = $('nick').value.trim();
  if (!n) { showErr('닉네임 먼저 적어줘'); $('nick').focus(); return null; }
  store.set('name', n); myName = n; return n;
}
if (OFFLINE) document.querySelectorAll('.mp').forEach((e) => e.classList.add('hide'));
const urlRoom = new URLSearchParams(location.search).get('room');
if (urlRoom && !OFFLINE) $('code').value = urlRoom.toUpperCase();

const soloClub = { me: +(store.get('club', 0)) || 0, op: 1 };
if (soloClub.op === soloClub.me) soloClub.op = (soloClub.me + 1) % CLUBS.length;
function paintSoloClubs() {
  for (const [k, id] of [['me', 'oClubMe'], ['op', 'oClubOp']]) { const b = $(id); b.querySelector('img').src = emblemURL(soloClub[k], 72); b.querySelector('span').textContent = clubOf(soloClub[k]).name; }
}
document.querySelectorAll('[data-solo]').forEach((b) => (b.onclick = () => openClubPicker({ solo: b.dataset.solo })));
$('bSolo').onclick = () => { if (getName()) { audio(); paintSoloClubs(); modal('soloM'); } };
$('oMode').addEventListener('change', (e) => { $('oInnLbl').textContent = e.detail === 'derby' ? '아웃 수 (×3)' : '이닝'; });
$('oGo').onclick = () => {
  show('soloM', false); audio(); showErr('');
  store.set('tod', segVal('oTod'));
  store.set('hitEase', segVal('oHit'));
  startLocal(myName, { fld: segVal('oFld'), hitEase: +segVal('oHit'), tod: segVal('oTod'), mode: segVal('oMode'), inn: +segVal('oInn'), diff: +segVal('oDiff'), team: segVal('oTeam'), pos: $('oPos').value, clubs: segVal('oTeam') === 'away' ? [soloClub.me, soloClub.op] : [soloClub.op, soloClub.me] });
  setScreen('game');
};
$('bCreate').onclick = () => { if (getName()) { audio(); modal('createM'); $('cName').value = `${myName}의 방`; } };
$('cMode').addEventListener('change', (e) => { $('cInn').value = e.detail === 'derby' ? '10' : '3'; });
$('cSize').addEventListener('change', (e) => show('cMaxWrap', e.detail === '0'));
$('cGo').onclick = async () => {
  show('createM', false);
  try {
    const r = await fetch('/api/new', { method: 'POST' }); const j = await r.json();
    const mode = segVal('cMode'), n = +$('cInn').value;
    pendingSettings = { name: $('cName').value.trim(), mode, innings: mode === 'game' ? Math.min(9, n) : 3, derbyOuts: mode === 'derby' ? n : 10, max: +$('cMax').value, size: +segVal('cSize'), tod: segVal('cTod'), hitEase: +segVal('cHit'), pw: $('cPw').value, pub: segVal('cPub') === '1' };
    enterRoom(j.code);
  } catch { showErr('서버에 연결할 수 없어'); }
};
let pendingSettings = null;
$('bJoin').onclick = () => {
  if (!getName()) return;
  const c = $('code').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(c)) return showErr('방 코드는 4자리야');
  tryJoin(c);
};
$('code').onkeydown = (e) => { if (e.key === 'Enter') $('bJoin').click(); };
async function tryJoin(code) {
  try {
    const r = await fetch('/api/room/' + code); const j = await r.json();
    if (!j.exists) return showErr('그 코드의 방이 없어');
    if (j.locked) return openPw(code);
    enterRoom(code);
  } catch { showErr('서버에 연결할 수 없어'); }
}
let pwCode = null;
function openPw(code) { pwCode = code; $('pwIn').value = ''; modal('pwM'); setTimeout(() => $('pwIn').focus(), 50); }
$('pwGo').onclick = () => { show('pwM', false); enterRoom(pwCode, $('pwIn').value); };
$('pwIn').onkeydown = (e) => { if (e.key === 'Enter') $('pwGo').click(); };
function enterRoom(code, pw = '') {
  audio(); showErr('');
  connectWS(code, myName, pw);
  history.replaceState(null, '', `?room=${code}`);
  $('rCode').textContent = code;
  setScreen('room');
}
$('bBrowse').onclick = () => { if (getName()) { setScreen('browser'); loadRooms(); } };
$('bBrowseBack').onclick = () => setScreen('title');
$('bRefresh').onclick = loadRooms;
async function loadRooms() {
  $('rlist').innerHTML = '<div class="empty">불러오는 중…</div>';
  try {
    const r = await fetch('/api/rooms'); const j = await r.json();
    if (!j.rooms.length) { $('rlist').innerHTML = '<div class="empty">열린 방이 없어. 직접 만들어봐!</div>'; return; }
    $('rlist').innerHTML = j.rooms.map((x) => `<button class="ritem" data-code="${esc(x.code)}" data-locked="${x.locked ? 1 : 0}"><b>${x.locked ? '🔒 ' : ''}${esc(x.name)}</b><span class="tag">${x.mode === 'derby' ? '홈런 더비' : '정규 경기'}</span><span class="tag ${x.phase === 'lobby' ? '' : 'live'}">${x.phase === 'lobby' ? '대기 중' : x.mode === 'game' ? `${x.inn}회 진행 중` : '진행 중'}</span><span class="cnt">${x.players}/${x.max}</span></button>`).join('');
    $('rlist').querySelectorAll('.ritem').forEach((b) => (b.onclick = () => (b.dataset.locked === '1' ? openPw(b.dataset.code) : enterRoom(b.dataset.code))));
  } catch { $('rlist').innerHTML = '<div class="empty">목록을 불러오지 못했어</div>'; }
}
$('bCopy').onclick = () => {
  const url = `${location.origin}${location.pathname}?room=${roomCode}`;
  const done = () => { $('bCopy').textContent = '복사됨!'; setTimeout(() => ($('bCopy').textContent = '초대 링크 복사'), 1500); };
  navigator.clipboard?.writeText(url).then(done, () => toast(url));
};
$('bLeave').onclick = toTitle;
$('bQuit').onclick = toTitle;
$('mQuit').onclick = () => { show('menuM', false); toTitle(); };
$('mLobby').onclick = () => { show('menuM', false); net && net.send({ t: 'lobby' }); };
$('mSettings').onclick = () => { show('menuM', false); openSettings(); };
$('mHelp').onclick = () => { show('menuM', false); modal('helpM'); };
$('bHelp').onclick = () => modal('helpM');
$('bSettings').onclick = openSettings;
function openSettings() {
  $('vol').value = cfg.vol; setSeg('gq', cfg.gq); setSeg('shake', cfg.shake); setSeg('replayS', cfg.replay); setSeg('castS', cfg.cast); setSeg('assist', cfg.assist); $('sens').value = cfg.sens; modal('setM');
}
$('vol').oninput = () => { cfg.vol = +$('vol').value; store.set('vol', cfg.vol); setVolume(cfg.vol / 100); };
$('gq').addEventListener('change', (e) => { cfg.gq = e.detail; store.set('gq', cfg.gq); applyQuality(); });
$('shake').addEventListener('change', (e) => { cfg.shake = +e.detail; store.set('shake', cfg.shake); });
$('replayS').addEventListener('change', (e) => { cfg.replay = +e.detail; store.set('replay', cfg.replay); if (!cfg.replay) replay.stop(); });
$('castS').addEventListener('change', (e) => { cfg.cast = +e.detail; store.set('cast', cfg.cast); if (cfg.cast < 2) try { speechSynthesis.cancel(); } catch { } });
$('assist').addEventListener('change', (e) => { cfg.assist = +e.detail; store.set('assist2', cfg.assist); });
$('sens').oninput = () => { cfg.sens = +$('sens').value; store.set('sens', cfg.sens); };
document.querySelectorAll('[data-team]').forEach((b) => (b.onclick = () => net && net.send({ t: 'team', team: b.dataset.team })));
$('myPos').onchange = () => net && net.send({ t: 'pos', pos: $('myPos').value });
$('bReady').onclick = () => { const me = lobby && lobby.players.find((p) => p.id === myId); net && net.send({ t: 'ready', on: !(me && me.ready) }); };
$('bStart').onclick = () => net && net.send({ t: 'start' });
$('bAgain').onclick = () => net && net.send({ t: 'start' });
$('bToLobby').onclick = () => net && net.send({ t: 'lobby' });
$('bReconnect').onclick = () => { if (roomCode) { wsRetry = 0; connectWS(roomCode, myName); } };
// 설정 변경 (방장)
const sendSet = (o) => net && lobby && lobby.host === myId && net.send({ t: 'set', ...o });
$('sMode').addEventListener('change', (e) => sendSet({ mode: e.detail }));
$('sInn').addEventListener('change', (e) => sendSet({ innings: +e.detail }));
$('sOuts').addEventListener('change', (e) => sendSet({ derbyOuts: +e.detail }));
$('sDiff').addEventListener('change', (e) => sendSet({ diff: +e.detail }));
$('sPub').addEventListener('change', (e) => sendSet({ pub: e.detail === '1' }));
$('sMax').onchange = () => sendSet({ max: +$('sMax').value });
$('sSize').addEventListener('change', (e) => sendSet({ size: +e.detail }));
$('sPit').addEventListener('change', (e) => sendSet({ pitRot: e.detail }));
$('sLine').addEventListener('change', (e) => sendSet({ lineup: e.detail }));
$('sFld').addEventListener('change', (e) => sendSet({ fieldCtl: e.detail }));
$('sTod').addEventListener('change', (e) => sendSet({ tod: e.detail }));
$('sHit').addEventListener('change', (e) => sendSet({ hitEase: +e.detail }));
$('myBo').onchange = () => net && net.send({ t: 'bo', bo: +$('myBo').value });
document.querySelectorAll('[data-club]').forEach((b) => (b.onclick = () => openClubPicker({ side: b.dataset.club })));
let clubPick = null;
function openClubPicker(o) {
  clubPick = o;
  let cur, other, can = true;
  if (o.solo) { cur = soloClub[o.solo]; other = soloClub[o.solo === 'me' ? 'op' : 'me']; $('clubT').textContent = o.solo === 'me' ? '내 구단 고르기' : '상대 구단 고르기'; }
  else {
    const ti = o.side === 'home' ? 1 : 0; cur = lobby.set.clubs[ti]; other = lobby.set.clubs[1 - ti];
    can = lobby.host === myId || myTeam() === o.side;
    $('clubT').textContent = `${o.side === 'home' ? '홈' : '원정'}팀 구단 ${can ? '고르기' : '(그 팀 선수나 방장만 바꿀 수 있어)'}`;
  }
  $('clubGrid').innerHTML = CLUBS.map((c, i) => `<button data-i="${i}" class="${i === cur ? 'on' : ''}" ${i === other || !can ? 'disabled' : ''}><img src="${emblemURL(i, 96)}" alt=""><span>${esc(c.name)}</span></button>`).join('');
  $('clubGrid').querySelectorAll('button').forEach((b) => (b.onclick = () => {
    const i = +b.dataset.i;
    if (clubPick.solo) { soloClub[clubPick.solo] = i; if (clubPick.solo === 'me') store.set('club', i); paintSoloClubs(); }
    else net && net.send({ t: 'club', side: clubPick.side, club: i });
    show('clubM', false); sfx.ui();
  }));
  modal('clubM');
}
// 구단 → 유니폼/스코어버그
let clubsKey = '';
function applyClubs(cl) {
  if (!cl) return;
  const k = cl.join(',');
  if (k === clubsKey) return;
  clubsKey = k;
  Object.assign(UNIFORMS.away, uniformsFor(cl[0], 'away'));
  Object.assign(UNIFORMS.home, uniformsFor(cl[1], 'home'));
  if (fieldTeamBuilt || batTeamBuilt) clearActors();
  $('bEmA').src = emblemURL(cl[0], 48); $('bEmH').src = emblemURL(cl[1], 48);
  $('trA').querySelector('i').style.background = clubOf(cl[0]).c1 === '#1c1c22' ? clubOf(cl[0]).c2 : clubOf(cl[0]).c1;
  $('trH').querySelector('i').style.background = clubOf(cl[1]).c2 === '#1a1a1f' ? clubOf(cl[1]).c1 : clubOf(cl[1]).c2;
}
$('sName').onchange = () => sendSet({ name: $('sName').value });
$('sTA').onchange = $('sTH').onchange = () => sendSet({ teams: [$('sTA').value, $('sTH').value] });
$('sPw').onchange = () => sendSet({ pw: $('sPw').value });
$('rchatin').onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') { const t = $('rchatin').value.trim(); if (t && net) net.send({ t: 'chat', text: t }); $('rchatin').value = ''; } };

function renderLobby() {
  if (!lobby) return;
  if (pendingSettings && lobby.host === myId) { net.send({ t: 'set', ...pendingSettings }); pendingSettings = null; }
  const isHost = lobby.host === myId;
  const st = lobby.set;
  const me = lobby.players.find((p) => p.id === myId);
  const li = (p) => `<li class="pl ${p.id === myId ? 'me' : ''}"><span class="rd ${p.ready ? 'on' : ''}" title="${p.ready ? '준비 완료' : '대기'}"></span><span class="bo" title="타순">${p.bo ? p.bo + '번' : '자동'}</span><span class="nm">${esc(p.name)}${p.conn ? '' : ' (끊김)'}</span>${p.pos !== 'any' ? `<span class="pos">${POS_KO[p.pos] || ''}</span>` : ''}${p.id === lobby.host ? '<span class="host">방장</span>' : ''}<span class="ping">${p.ping ? p.ping + 'ms' : ''}</span>${isHost && p.id !== myId ? `<button class="x" data-kick="${p.id}" title="내보내기">강퇴</button>` : ''}</li>`;
  const a = lobby.players.filter((p) => p.team === 'away'), h = lobby.players.filter((p) => p.team === 'home'), sp = lobby.players.filter((p) => p.team === 'spec');
  const bySlot = (x, y) => (x.bo || 99) - (y.bo || 99);
  const cap = st.size || Math.ceil(st.max / 2);
  const empty = (n) => Array.from({ length: Math.max(0, Math.min(3, cap) - n) }, () => '<li class="pl slot"><span class="nm" style="color:var(--dim)">빈 자리 · CPU</span></li>').join('');
  $('tAway').innerHTML = a.sort(bySlot).map(li).join('') + (st.size ? empty(a.length) : a.length ? '' : '<div class="cpu">CPU 팀</div>');
  $('tHome').innerHTML = h.sort(bySlot).map(li).join('') + (st.size ? empty(h.length) : h.length ? '' : '<div class="cpu">CPU 팀</div>');
  $('cntA').textContent = `${a.length}/${cap}`; $('cntH').textContent = `${h.length}/${cap}`;
  const cl = st.clubs || [0, 1];
  $('emA').src = emblemURL(cl[0], 96); $('emH').src = emblemURL(cl[1], 96);
  applyClubs(cl);
  setSeg('sSize', st.size || 0); setSeg('sPit', st.pitRot || 'inning'); setSeg('sLine', st.lineup || 'humans'); setSeg('sFld', st.fieldCtl || 'pos'); setSeg('sTod', st.tod || 'night'); setSeg('sHit', st.hitEase ?? 1); applyTimeOfDay(st.tod || 'night');
  show('sMaxWrap', !st.size);
  document.querySelectorAll('.team [data-team]').forEach((b) => { const t = b.dataset.team, n = t === 'away' ? a.length : h.length; b.disabled = me && me.team === t || n >= cap; b.textContent = me && me.team === t ? '내 팀' : n >= cap ? '꽉 참' : '이 팀으로'; });
  $('specbar').innerHTML = sp.length ? '관전 ' + sp.map((p) => `<span>${esc(p.name)}</span>`).join('') : '';
  document.querySelectorAll('[data-kick]').forEach((b) => (b.onclick = () => net.send({ t: 'kick', id: b.dataset.kick })));
  $('rName').textContent = st.name || '방';
  $('tnA').textContent = st.teams[0]; $('tnH').textContent = st.teams[1];
  if (document.activeElement !== $('sName')) $('sName').value = st.name;
  if (document.activeElement !== $('sTA')) $('sTA').value = st.teams[0];
  if (document.activeElement !== $('sTH')) $('sTH').value = st.teams[1];
  setSeg('sMode', st.mode); setSeg('sInn', st.innings); setSeg('sOuts', st.derbyOuts); setSeg('sDiff', st.diff); setSeg('sPub', st.pub ? 1 : 0);
  $('sMax').value = String(st.max);
  show('sInnWrap', st.mode === 'game'); show('sOutWrap', st.mode === 'derby');
  document.querySelectorAll('#sets .seg').forEach((s) => s.classList.toggle('ro', !isHost));
  for (const id of ['sName', 'sTA', 'sTH', 'sMax', 'sPw']) $(id).disabled = !isHost;
  show('hostOnly', !isHost);
  if (me) { $('myBo').value = String(me.bo || 0); $('myPos').value = me.pos; $('bReady').textContent = me.ready ? '준비 취소' : '준비'; $('bReady').classList.toggle('gold', me.ready); }
  show('bStart', isHost);
  const nonReady = lobby.players.filter((p) => p.team !== 'spec' && !p.ready && p.id !== lobby.host).length;
  $('rnote').textContent = isHost ? (nonReady ? `${nonReady}명 준비 안 됨` : '모두 준비됨') : '방장이 시작하길 기다리는 중…';
  show('mLobby', isHost && !net?.local);
  if (lobby.phase === 'lobby' && screen !== 'title' && screen !== 'browser' && !net?.local) setScreen('room');
  if (lobby.phase !== 'lobby' && screen === 'room') setScreen('game');
}

// ═════════════ 채팅 ═════════════
function addChat(name, text, team) {
  const color = team === 'away' ? '#ff8a8f' : team === 'home' ? '#8fb2ff' : '#ffcf3f';
  for (const box of ['chatlog', 'rchat']) {
    const d = document.createElement('div');
    d.innerHTML = `<b style="color:${color}">${esc(name)}</b>${esc(text)}`;
    $(box).appendChild(d);
    while ($(box).children.length > 40) $(box).firstChild.remove();
    $(box).scrollTop = 1e9;
  }
}
function sysChat(text) { const d = document.createElement('div'); d.className = 'sys'; d.textContent = text; $('chatlog').appendChild(d); }
$('chatin').onkeydown = (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') { const t = $('chatin').value.trim(); if (t && net) net.send({ t: 'chat', text: t }); $('chatin').value = ''; $('chatin').classList.add('hide'); $('chatin').blur(); }
  else if (e.key === 'Escape') { $('chatin').classList.add('hide'); $('chatin').blur(); }
};
const QUICK = ['나이스!', '가자!!', 'ㅋㅋㅋㅋ', '아 ㅠㅠ', '홈런 각', '수비 나이스', 'GG', '한 판 더?'];
$('quick').innerHTML = QUICK.map((q, i) => `<button data-q="${i}"><span class="kbd">${i + 1}</span>${q}</button>`).join('');
$('quick').querySelectorAll('button').forEach((b) => (b.onclick = () => sendQuick(+b.dataset.q)));
let quickOpen = false;
function sendQuick(i) { if (net) net.send({ t: 'chat', text: QUICK[i] }); quickOpen = false; show('quick', false); }

// ═════════════ 스냅샷 ═════════════
const seen = { msg: -1, hr: -1, te: -1, ce: -1, we: -1, pitch: -1, lp: -1 };
let ballL = null, lastBallSt = '', hitStopUntil = 0, excite = 0, hrCine = 0, hrCineStart = 0;
let shake = 0, lastHolder = -1, camPunch = 0, lastContactT = 0;
const replay = new Replay();
let rpInfo = null;
function allPlayers() { const a = fielders.map((A) => A.p); if (batter) a.push(batter.p); for (const A of runners.values()) a.push(A.p); for (const U of umps) a.push(U.p); for (const C of coaches) a.push(C.p); return a; }
// ── 보간 버퍼: 다른 선수 위치를 '조금 과거'의 두 스냅샷 사이로 보간 → 핑이 튀어도 순간이동·덜덜거림 없음.
// 지연량은 도착 간격의 흔들림(지터)에 맞춰 자동 조절 (안정적인 와이파이면 ~45ms, 흔들리면 최대 220ms)
const snapHist = [];
const netQ = { jit: 0.01, lastArr: 0, lastNow: 0, delay: 0.06, loss: 0 };
function netBuf(s, p) {
  if (netQ.lastArr) {
    const d = (p - netQ.lastArr) - (s.now - netQ.lastNow);
    netQ.jit += (Math.abs(d) - netQ.jit) * (Math.abs(d) > netQ.jit ? 0.2 : 0.03); // 튀면 빨리 늘리고 천천히 줄임
  }
  netQ.lastArr = p; netQ.lastNow = s.now;
  const want = clamp(1 / 30 + netQ.jit * 2.2, 0.045, 0.22);
  netQ.delay += (want - netQ.delay) * 0.08;
  const rn = new Map(); for (const r of s.rn || []) rn.set(r[7] ? 'r' + r[7] : r[2] + '|' + (r[4] || ''), r);
  if (snapHist.length && s.now <= snapHist[snapHist.length - 1].t) return;
  snapHist.push({ t: s.now, fl: s.fl, rn });
  while (snapHist.length > 24) snapHist.shift();
}
// t 시점의 보간 상태: [a, b, u] (a/b 스냅샷, u 0..1). 버퍼가 비면 null
function interpAt(t) {
  const n = snapHist.length; if (n < 2) return null;
  if (t >= snapHist[n - 1].t) return [snapHist[n - 1], snapHist[n - 1], 0];
  for (let i = n - 2; i >= 0; i--) { const a = snapHist[i], b = snapHist[i + 1]; if (t >= a.t) return [a, b, b.t > a.t ? (t - a.t) / (b.t - a.t) : 0]; }
  return [snapHist[0], snapHist[0], 0];
}
const lerpAng = (a, b, u) => { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * u; };
function onSnap(s) {
  const p = nowP(), sample = s.now - p;
  if (offset === null || sample > offset || Math.abs(sample - offset) > 2) offset = sample; else offset += (sample - offset) * 0.02;
  if (!net?.local && s.fl) netBuf(s, p);
  if (s.pg) pgList = s.pg;
  if (s.ph === 'lobby') { S = s; if ((screen === 'game' || screen === 'over') && !net?.local) setScreen('room'); return; }
  if (screen === 'room' || (screen === 'title' && net)) setScreen('game');
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
    if (/끝내기/.test(t)) { sfx.cheer(6, 0.65); sfx.organ(); fx.show(18); excite = 1; startCelebration(); }
    else if (/득점/.test(t)) { sfx.cheer(1.8, 0.35); excite = Math.max(excite, 0.6); }
    else if (/안타|2루타|3루타|번트 안타/.test(t)) { sfx.cheer(1.6, 0.28); excite = Math.max(excite, 0.45); }
    else if (/삼진/.test(t)) { sfx.ump(true); umpCall = nowP(); }
    else if (/스트라이크$/.test(t)) { sfx.ump(true); umpCall = nowP(); }
    else if (/강탈|다이빙 캐치|도루 저지/.test(t)) { sfx.cheer(2.2, 0.4); excite = Math.max(excite, 0.7); }
    else if (/실책/.test(t)) sfx.groan();
    if (/관전 입장|퇴장|재접속|끊김|강퇴/.test(t)) sysChat(t);
  }
  // 홈런 이벤트
  if (s.hr && s.hr.id !== seen.hr) {
    { hrCine = 1; hrCineStart = nowP(); sfx.cheer(5, 0.6); sfx.organ(); excite = 1; setTimeout(() => { fx.show(12, [0, 0, 165]); for (let i = 0; i < 6; i++) sfx.firework(0.3 + i * 0.35); }, 900); bigBoard = { t: nowP(), big: '홈런!', sub: `${s.hr.name} · ${s.hr.dist}m` }; }
    seen.hr = s.hr.id;
    if (cfg.replay && lastContactT && nowP() - lastContactT < 8) replay.schedule(nowP() + 2.6, { tEvent: lastContactT, pre: 0.8, post: 1.6, speed: 0.42, cam: 'hr', scene });
  }
  // 송구/포구/펜스 이벤트
  if (s.te && s.te.id !== seen.te) { if (fielders[s.te.i]) { fielders[s.te.i].throwT = nowP(); sfx.throwWhoosh(); } seen.te = s.te.id; }
  if (s.ce && s.ce.id !== seen.ce) { if (fielders[s.ce.i]) { fielders[s.ce.i].catchT = nowP(); sfx.catch(); if (s.ce.i === getRole().fi && getRole().defense) { feedback(s.ce.dive ? '다이빙 캐치!! 나이스!' : s.ce.jump ? '점프 캐치!! 나이스!' : '나이스 캐치!', '#4fd18b'); if (s.ce.dive || s.ce.jump) sfx.perfect(); }
    if ((s.ce.dive || s.ce.jump) && cfg.replay !== 0) replay.schedule(nowP() + 1.0, { tEvent: nowP(), pre: 1.2, post: 0.5, speed: 0.45, cam: 'catch', focus: fielders[s.ce.i].p, scene }); if (s.ce.dive) { fx.dustPuff(fielders[s.ce.i].p.root.position.x, fielders[s.ce.i].p.root.position.z, 2, 2); } } seen.ce = s.ce.id; }
  if (s.ce2 && s.ce2.id !== seen.ce2) {
    if (seen.ce2 !== undefined) showCall(s.ce2);
    seen.ce2 = s.ce2.id;
  }
  if (s.we && s.we.id !== seen.we) { { sfx.wall(); shake = Math.max(shake, 0.15); } seen.we = s.we.id; }
  // 공
  if (s.b) {
    const [x, y, z, vx, vy, vz, h, st, sx, sy, sz] = s.b;
    if (!ballL || h >= 0 || st !== lastBallSt || Math.hypot(ballL.x - x, ballL.y - y, ballL.z - z) > 2.5) {
      if (st === 'thrown' && lastBallSt !== 'thrown') fx.trailClear();
      ballL = { x, y, z, vx, vy, vz, sx, sy, sz, state: st, h };
    } else {
      // 지연 보정: 서버 상태(s.now 시점)를 지금 화면 시각까지 앞으로 굴린 뒤 부드럽게 합류
      // (과거 위치로 당기면 공이 뒤로 끌려가서 느려 보임)
      const sb = { x, y, z, vx, vy, vz, sx, sy, sz, state: st, h };
      const age = clamp(simNow() - s.now, 0, 0.25);
      for (let i = 0, n = Math.ceil(age * 120); i < n; i++) integrate(sb, age / n);
      const k = 0.35;
      ballL.x = lerp(ballL.x, sb.x, k); ballL.y = lerp(ballL.y, sb.y, k); ballL.z = lerp(ballL.z, sb.z, k);
      ballL.vx = sb.vx; ballL.vy = sb.vy; ballL.vz = sb.vz; ballL.sx = sb.sx; ballL.sy = sb.sy; ballL.sz = sb.sz; ballL.h = h; ballL.state = sb.state;
    }
    if (st === 'held' && h !== lastHolder) sfx.catch();
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
  if (s.ph === 'over' && screen !== 'over') showOver(s);
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
  if (ev.out) sfx.ump(true);
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
  if (bunt) sfx.bunt(); else sfx.crack(q);
  fx.impact(cp, bunt ? 0.3 : 0.5 + q * 1.1);
  if (!bunt && q > 0.3) {
    shake = Math.max(shake, 0.06 + q * 0.22);
    hitStopUntil = nowP() + 0.015 + q * 0.035; // 정타일수록 공이 아주 잠깐 멈췄다 튀어나감 (길면 공이 느려 보임)
    camPunch = Math.max(camPunch, q * q * 5); // 화각 순간 좁힘(줌 펀치)
  }
  excite = Math.max(excite, 0.25 + q * 0.4);
}

// ── 캐스터 멘트: 주요 장면마다 중계 한마디 (설정: 끄기 / 자막 / 자막+음성) ──
const CAST = [
  [/끝내기/, ['끝냈습니다!! 끝내기!! 선수들이 그라운드로 쏟아져 나옵니다!', '경기 끝! 이 한 방으로 승부가 갈립니다!']],
  [/만루 홈런/, ['만루 홈런!!! 잠실이 뒤집어집니다!', '그랜드 슬램! 주자 싹쓸이!']],
  [/홈런/, ['크게 뻗습니다… 담장, 넘어갑니다! 홈런!', '맞는 순간 직감했어요! 이건 넘어갔습니다!', '잠실 밤하늘을 가르는 타구! 홈런입니다!', '쭉쭉 뻗어갑니다… 관중석에 꽂힙니다!']],
  [/병살/, ['병살! 한 번에 아웃 두 개를 잡아냅니다!', '6-4-3 깔끔한 병살 플레이!']],
  [/3루타/, ['외야 깊숙이 굴러갑니다! 3루까지 갑니다!', '펜스 앞까지! 여유 있게 3루타!']],
  [/2루타/, ['외야를 가릅니다! 2루까지!', '빠졌습니다! 장타, 2루타!', '라인 따라 굴러가는 2루타!']],
  [/번트 안타/, ['허를 찌르는 번트! 살았습니다!']],
  [/^안타|안타!/, ['깨끗한 안타!', '내야를 빠져나가는 안타!', '잘 받아쳤습니다, 안타!', '정확하게 맞혔어요!'], 0.85],
  [/견제사/, ['견제사! 리드가 너무 컸어요!', '빈틈을 놓치지 않는 견제!']],
  [/도루 저지/, ['도루 저지! 포수 어깨가 대단합니다!', '송구 정확! 잡아냅니다!']],
  [/도루 성공/, ['훔쳤습니다! 도루 성공!', '빠른 발! 여유 있게 세이프!']],
  [/삼진/, ['삼진! 투수가 이겼습니다.', '헛스윙 삼진! 완벽하게 속였어요.', '꼼짝 못하고 삼진!'], 0.75],
  [/볼넷/, ['볼넷, 걸어 나갑니다.', '침착하게 골라냈습니다, 볼넷.'], 0.6],
  [/실책/, ['아, 실책! 공이 빠졌습니다!', '수비가 흔들립니다, 실책!']],
  [/중계 플레이/, ['중계 플레이! 커트맨에게 이어집니다!'], 0.7],
  [/희생/, ['희생 플라이! 한 점 추가합니다.', '제 몫을 해냅니다, 희생타!']],
  [/직선타|플라이 아웃/, ['잘 맞았지만 정면이었습니다.', '수비 위치가 좋았어요, 아웃.', '높이 뜬 공, 잡아냅니다.'], 0.35],
  [/득점/, ['홈인! 점수가 납니다!'], 0.5],
];
let castT = 0, castLast = '';
function castLine(t, s) {
  if (!cfg.cast || (s && s.mode === 'derby' && !/홈런/.test(t))) return;
  for (const [re, lines, p = 1] of CAST) {
    if (!re.test(t)) continue;
    if (Math.random() > p) return;
    let l = lines[Math.floor(Math.random() * lines.length)];
    if (l === castLast && lines.length > 1) l = lines[(lines.indexOf(l) + 1) % lines.length];
    castLast = l;
    const e = $('cast'); e.textContent = '🎙 ' + l; e.classList.remove('show'); void e.offsetWidth; e.classList.add('show');
    clearTimeout(castT); castT = setTimeout(() => e.classList.remove('show'), 3800);
    if (cfg.cast === 2 && window.speechSynthesis) {
      try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(l); u.lang = 'ko-KR'; u.rate = 1.12; u.pitch = 1.05; u.volume = Math.min(1, cfg.vol / 100); speechSynthesis.speak(u); } catch { }
    }
    return;
  }
}
let bannerT = 0, bannerAt = 0, bannerBig = false;
const bannerQ = [];
// 메시지가 연달아 오면 앞 메시지를 최소 1.1초는 보여주고 다음 걸 띄움 (큰 메시지는 작은 메시지를 바로 덮음)
function banner(text, big, hr) {
  const now = performance.now();
  if (!hr && !(big && !bannerBig) && now - bannerAt < 1100 && $('banner').classList.contains('show')) {
    if (bannerQ.length > 2) bannerQ.shift();
    bannerQ.push([text, big, hr]);
    if (bannerQ.length === 1) setTimeout(flushBanner, 1100 - (now - bannerAt));
    return;
  }
  bannerQ.length = 0; showBanner(text, big, hr);
}
function flushBanner() { const n = bannerQ.shift(); if (!n) return; showBanner(...n); if (bannerQ.length) setTimeout(flushBanner, 1100); }
function showBanner(text, big, hr) {
  const b = $('banner');
  bannerAt = performance.now(); bannerBig = !!big;
  b.textContent = text;
  b.classList.toggle('small', !big); b.classList.toggle('hr', !!hr);
  b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  clearTimeout(bannerT); bannerT = setTimeout(() => b.classList.remove('show'), hr ? 3400 : big ? 2600 : 1900);
}
let wuT = 0;
// ── 통산 기록 (멀티: 서버 저장 / 혼자: 이 브라우저) ──
let career = {}, careerT = 0;
function saveLocalCareer(sum, me) {
  const v = sum && (sum[me] || Object.values(sum)[0]); if (!v) return;
  const all = store.get('career', {}), cur = all[me] || {};
  for (const k of ['g', 'w', 'pa', 'h', 'hr', 'rbi', 'k', 'bb', 'sb', 'outs', 'r', 'ph', 'pk', 'pbb']) cur[k] = (cur[k] || 0) + (Number(v[k]) || 0);
  cur.max = Math.max(cur.max || 0, Number(v.max) || 0);
  all[me] = cur; store.set('career', all); career[me] = cur;
}
function refreshCareer(force) {
  if (!S || (!force && nowP() - careerT < 30)) return;
  careerT = nowP();
  if (net?.local) { career = { ...store.get('career', {}) }; return; }
  const names = [...new Set((lobby?.players || []).map((p) => p.name))].slice(0, 20);
  if (!names.length) return;
  fetch('/api/stats?n=' + encodeURIComponent(names.join(','))).then((r) => r.json()).then((j) => { career = j.stats || {}; }).catch(() => {});
}
const avgStr = (h, ab) => (ab > 0 ? (h / ab).toFixed(3).replace(/^0/, '') : '-.---');
const eraStr = (r, outs) => (outs > 0 ? (r * 27 / outs).toFixed(2) : '-.--');
const ipStr = (outs) => `${Math.floor(outs / 3)}${outs % 3 ? '.' + (outs % 3) : ''}`;
// ── 등장 컷씬: (투수 바뀌면 투수 →) 타자 클로즈업 + 기록 카드 ──
let intro = null, lastPitcherName = '';
function startIntro(s) {
  if (s.mode !== 'game' || replay.active) { walkup(s); return; }
  refreshCareer();
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
  if (idx !== intro.idx) { intro.idx = idx; showIntroCard(intro.seq[idx], S); }
  return { kind: intro.seq[idx], e: e - acc };
}
function endIntro() { intro = null; $('intro').classList.remove('show'); }
function showIntroCard(kind, s) {
  const el = $('intro');
  const club = clubOf((s.cl || [0, 1])[kind === 'b' ? (s.half === 0 ? 0 : 1) : (s.half === 0 ? 1 : 0)]) || {};
  const lum = (hex) => { const c = new THREE.Color(hex || '#000'); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; };
  const cc = lum(club.c1) > 0.12 ? club.c1 : lum(club.c2) > 0.12 ? club.c2 : '#ffd23a'; // 어두운 팀색은 밝은 보조색으로
  el.style.setProperty('--cc', cc || '#ff6a2b');
  if (kind === 'b') {
    const st = (s.st || []).find((r) => (r[0] && r[0] === s.bat.id) || (!r[0] && r[1] === s.bat.name));
    const nm = s.bat.id ? (nameOf(s.bat.id) || s.bat.name) : s.bat.name;
    const slot = s.bat.slot || ((s.bat.n - 1) % 9) + 1;
    const c = career[nm];
    el.querySelector('.in-tag').textContent = `${slot}번 타자 · ${club.name || ''}`;
    el.querySelector('.in-nm').textContent = nm;
    let today = '오늘 첫 타석';
    if (st && st[3]) { const ab = st[3] - st[9]; today = `오늘 ${ab}타수 ${st[4]}안타` + (st[5] ? ` ${st[5]}홈런` : '') + (st[6] ? ` ${st[6]}타점` : '') + (st[9] ? ` ${st[9]}볼넷` : '') + (st[8] ? ` ${st[8]}삼진` : ''); }
    el.querySelector('.in-today').textContent = today;
    if (c && c.pa) { const ab = c.pa - (c.bb || 0); el.querySelector('.in-big').textContent = avgStr(c.h || 0, ab); el.querySelector('.in-bigl').textContent = '통산 타율'; el.querySelector('.in-car').textContent = `${c.g || 0}경기 · ${c.h || 0}안타 · ${c.hr || 0}홈런 · ${c.rbi || 0}타점 · 최장 ${c.max || 0}m`; }
    else if (st && st[3]) { const ab = st[3] - st[9]; el.querySelector('.in-big').textContent = avgStr(st[4], ab); el.querySelector('.in-bigl').textContent = '오늘 타율'; el.querySelector('.in-car').textContent = s.bat.id ? '통산 기록은 경기가 끝나면 쌓여요' : 'CPU 타자'; }
    else { el.querySelector('.in-big').textContent = s.bat.id ? '-.---' : 'CPU'; el.querySelector('.in-bigl').textContent = s.bat.id ? '타율' : ''; el.querySelector('.in-car').textContent = s.bat.id ? '첫 기록 도전!' : ''; }
    const runners = (s.occ || []).filter(Boolean).length;
    el.querySelector('.in-sit').textContent = runners === 3 ? '만루 찬스!' : (s.occ && (s.occ[1] || s.occ[2])) ? '득점권 찬스' : (s.cnt ? `${s.cnt[2]}아웃` : '');
    if (s.bat.id === myId) sfx.organ();
  } else {
    const cp = s.cp || ['', 0, 0, 0, 0, 0, 0, null];
    const c = career[cp[0]];
    el.querySelector('.in-tag').textContent = `투수 · ${club.name || ''}`;
    el.querySelector('.in-nm').textContent = cp[0];
    el.querySelector('.in-today').textContent = cp[1] || cp[6] ? `오늘 ${ipStr(cp[1])}이닝 · ${cp[4]}탈삼진 · ${cp[2]}실점 · ${cp[6]}구` : '오늘 첫 등판';
    if (c && c.outs) { el.querySelector('.in-big').textContent = eraStr(c.r || 0, c.outs); el.querySelector('.in-bigl').textContent = '통산 평균자책'; el.querySelector('.in-car').textContent = `${ipStr(c.outs)}이닝 · ${c.pk || 0}탈삼진 · 볼넷 ${c.pbb || 0}`; }
    else { el.querySelector('.in-big').textContent = cp[1] ? eraStr(cp[2], cp[1]) : '-.--'; el.querySelector('.in-bigl').textContent = cp[1] ? '오늘 평균자책' : '평균자책'; el.querySelector('.in-car').textContent = cp[7] ? '' : 'CPU 투수'; }
    el.querySelector('.in-sit').textContent = '';
  }
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}
function walkup(s) {
  const st = (s.st || []).find((r) => (r[0] && r[0] === s.bat.id) || (!r[0] && r[1] === s.bat.name));
  const me = s.bat.id && s.bat.id === myId;
  const slot = s.bat.slot || ((s.bat.n - 1) % 9) + 1;
  const e = $('walkup');
  e.querySelector('.wu-no').textContent = slot;
  e.querySelector('.wu-nm').textContent = (me ? '타석: ' : '') + (s.bat.id ? (nameOf(s.bat.id) || s.bat.name) : s.bat.name);
  let line = '오늘 첫 타석';
  if (st && st[3]) { const ab = st[3] - st[9]; line = `오늘 ${ab}타수 ${st[4]}안타` + (st[5] ? ` · ${st[5]}홈런` : '') + (st[6] ? ` · ${st[6]}타점` : '') + (st[9] ? ` · ${st[9]}볼넷` : ''); }
  const runners = (s.occ || []).filter(Boolean).length;
  if (runners && s.inn >= 1) line += runners === 3 ? ' · 만루 찬스' : (s.occ[1] || s.occ[2]) ? ' · 득점권' : '';
  e.querySelector('.wu-st').textContent = line;
  e.classList.toggle('me', !!me);
  e.classList.remove('show'); void e.offsetWidth; e.classList.add('show');
  if (me) sfx.organ();
  clearTimeout(wuT); wuT = setTimeout(() => e.classList.remove('show'), 4000);
}
let fbT = 0;
function feedback(text, color = '#fff') { const f = $('fb'); f.textContent = text; f.style.color = color; f.classList.add('show'); clearTimeout(fbT); fbT = setTimeout(() => f.classList.remove('show'), 2600); }

const KING_SVG = '<svg viewBox="0 0 60 34" fill="currentColor"><path d="M2 32 L6 6 L18 20 L30 2 L42 20 L54 6 L58 32 Z"/></svg>';
function statTable(st, mine) {
  let h = '<tr><th>타자</th><th>타석</th><th>안타</th><th class="r">홈런</th><th>타점</th><th>최장</th><th>삼진</th><th>볼넷</th><th>도루</th><th>통산 타율</th></tr>';
  h += st.filter((r) => r[3] > 0 || r[0]).map((r) => { const c = r[0] && career[r[1]]; return `<tr class="${r[0] && r[0] === myId ? 'me' : ''}"><td>${esc(r[1])}</td><td>${r[3]}</td><td>${r[4]}</td><td class="r">${r[5]}</td><td>${r[6]}</td><td>${r[7] ? r[7] + 'm' : '-'}</td><td>${r[8]}</td><td>${r[9]}</td><td>${r[10]}</td><td>${c && c.pa ? avgStr(c.h || 0, c.pa - (c.bb || 0)) : '-'}</td></tr>`; }).join('');
  const ps = (S && S.ps) || [];
  if (ps.length) {
    h += '<tr class="sep"><th>투수</th><th>이닝</th><th>피안타</th><th class="r">실점</th><th>탈삼진</th><th>볼넷</th><th>피홈런</th><th>상대</th><th>ERA</th><th>통산 ERA</th></tr>';
    h += ps.map((p) => { const c = p[0] && career[p[1]]; return `<tr class="${p[0] && p[0] === myId ? 'me' : ''}"><td>${esc(p[1])}</td><td>${ipStr(p[3])}</td><td>${p[5]}</td><td class="r">${p[4]}</td><td>${p[6]}</td><td>${p[7]}</td><td>${p[8]}</td><td>${p[9]}</td><td>${eraStr(p[4], p[3])}</td><td>${c && c.outs ? eraStr(c.r || 0, c.outs) : '-'}</td></tr>`; }).join('');
  }
  return h;
}
function lineTable(s) {
  const inns = Math.max(s.ls[0].length, s.ls[1].length, s.inn || 1);
  let h = '<tr><th></th>' + Array.from({ length: inns }, (_, i) => `<th>${i + 1}</th>`).join('') + '<th class="r">R</th><th>H</th><th>E</th></tr>';
  (s.tn || ['원정', '홈']).forEach((nm, r) => { h += `<tr><td>${esc(nm)}</td>` + Array.from({ length: inns }, (_, i) => `<td>${s.ls[r][i] ?? '-'}</td>`).join('') + `<td class="r">${s.sc[r]}</td><td>${s.hits[r]}</td><td>${s.errs ? s.errs[r] : 0}</td></tr>`; });
  return h;
}
function showOver(s) {
  setTimeout(() => refreshCareer(true), 1500);
  setScreen('over');
  const mySide = myTeam();
  let title, king = null;
  if (s.mode === 'derby' && s.dy) {
    const list = [...s.dy.list].sort((a, b) => b[2] - a[2] || b[3] - a[3]);
    title = '홈런 더비 종료';
    if (list[0]) king = { name: list[0][1], line: `홈런 ${list[0][2]}개 · 최장 ${list[0][3] || '-'}m` };
    $('overLine').innerHTML = '<tr><th>순위</th><th>선수</th><th class="r">홈런</th><th>최장 비거리</th></tr>' + list.map((r, i) => `<tr class="${r[0] === myId ? 'me' : ''}"><td>${i + 1}위</td><td>${esc(r[1])}</td><td class="r">${r[2]}</td><td>${r[3] ? r[3] + 'm' : '-'}</td></tr>`).join('');
    $('overStats').innerHTML = '';
  } else {
    title = s.win ? `${s.tn[s.win === 'away' ? 0 : 1]} 승리` : '무승부';
    if (mySide && mySide !== 'spec' && s.win) title = s.win === mySide ? '승리!' : '패배…';
    const st = s.st || [];
    const top = [...st].sort((a, b) => b[5] - a[5] || b[7] - a[7] || b[4] - a[4] || b[6] - a[6])[0];
    if (top && top[5] > 0) king = { name: top[1], line: `홈런 ${top[5]}개 · 최장 ${top[7]}m · ${top[6]}타점` };
    // MVP: 타자(안타·홈런·타점·볼넷·도루)와 투수(아웃·탈삼진·실점) 점수를 같이 비교, 이긴 팀 보너스
    const cands = [];
    for (const r of st) if (r[3] > 0) cands.push({ name: r[1], sc: r[4] * 1.5 + r[5] * 2.5 + r[6] * 1.2 + r[9] * 0.5 + r[10] * 0.6 - r[8] * 0.25 + (r[2] === s.win ? 0.8 : 0), line: `${r[3] - r[9]}타수 ${r[4]}안타` + (r[5] ? ` ${r[5]}홈런` : '') + (r[6] ? ` ${r[6]}타점` : '') });
    for (const p of s.ps || []) if (p[3] > 0) cands.push({ name: p[1], sc: p[3] * 0.4 + p[6] * 0.45 - p[4] * 1.3 - p[7] * 0.3 - p[5] * 0.25 + (p[2] === s.win ? 1 : 0), line: `${ipStr(p[3])}이닝 ${p[6]}탈삼진 ${p[4]}실점` });
    const mvp = cands.sort((a, b) => b.sc - a.sc)[0];
    if (mvp) s._mvp = mvp;
    $('overLine').innerHTML = lineTable(s);
    $('overStats').innerHTML = statTable(st);
  }
  $('overT').textContent = title;
  const card = (k, label) => `<div class="king">${KING_SVG}<div><small>${label}</small><b>${esc(k.name)}</b><em>${esc(k.line)}</em></div></div>`;
  $('kingBox').innerHTML = (s._mvp ? card(s._mvp, '오늘의 MVP') : '') + (king && (!s._mvp || king.name !== s._mvp.name || s.mode === 'derby') ? ' ' + card(king, s.mode === 'derby' ? '홈런왕' : '오늘의 홈런왕') : '');
  if (s._mvp) king = king || s._mvp;
  const isHost = net?.local || (lobby && lobby.host === myId);
  show('bAgain', isHost); show('bToLobby', isHost && !net?.local);
  $('overNote').textContent = isHost ? '' : '방장이 다음 경기를 고르는 중…';
  if (king) { fx.show(8, [0, 0, 160]); sfx.cheer(4, 0.5); }
}
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
  if (e.key === 'Escape') {
    if (!$('helpM').classList.contains('hide')) return show('helpM', false);
    if (!$('setM').classList.contains('hide')) return show('setM', false);
    if (screen === 'game' || screen === 'over') { show('menuM', $('menuM').classList.contains('hide')); return; }
  }
  if (screen !== 'game' && screen !== 'over') return;
  if (e.key === 'Enter') { $('chatin').classList.remove('hide'); $('chatin').focus(); e.preventDefault(); return; }
  if (e.key === 'Tab') { e.preventDefault(); show('tab', true); refreshCareer(); renderTab(); return; }
  if (k === 'h') { modal('helpM', $('helpM').classList.contains('hide')); return; }
  if (k === 'v' && S && getRole().fi >= 0 && !getRole().pitcher && getRole().pos !== 'C') { cfg.fieldCam = cfg.fieldCam === 'tps' ? 'tv' : 'tps'; store.set('fieldCam', cfg.fieldCam); fcam.yawOff = 0; toast(cfg.fieldCam === 'tps' ? '수비 시점: 내 선수 뒤 (드래그로 회전)' : '수비 시점: 중계 화면'); return; }
  if (k === 'v') { cfg.batCam = cfg.batCam === 1 ? 0 : 1; store.set('batCam', cfg.batCam); toast(cfg.batCam === 1 ? '타격 시점: 타자 어깨 뒤' : '타격 시점: 포수 뒤 (중계)'); return; }
  if (quickOpen && /^[1-8]$/.test(k)) { sendQuick(+k - 1); return; }
  if (k === 't') { quickOpen = !quickOpen; show('quick', quickOpen); return; }
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
  if (role.pitcher && S.ph === 'pitch' && /^[1-6]$/.test(k)) { pitchType = PITCH_KEYS[+k - 1]; renderPitchBar(true); }
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
  if (throwCharge && throwCharge.k === k) { const p = 0.25 + throwPow() * 0.75; if (net && getRole().holding) { net.send({ t: 'throw', base: throwCharge.base, p }); if (p > 0.85) feedback('강송구!', '#ff9f43'); } else pendThrow = { base: throwCharge.base, t: nowP() }; throwCharge = null; } if (e.key === 'Tab') show('tab', false); });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; show('tab', false); });
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
  const M0 = SWING[mode];
  if (mode === 'bunt') {
    // 번트: 배트가 공 높이를 자동으로 따라감. 좌우 커서로 방향만 조절
    a = [p.tx + clamp((a[0] - p.tx) * 0.35, -0.14, 0.14), p.ty + 0.02];
  } else if (cfg.assist > 0 && (S.he ?? 1) < 2) {
    // 조준 보정(자석): 배트 원이 공 가까이(판정 반경의 1.5배 안)면 공 쪽으로 살짝 당겨줌. 연습 모드는 더 세게
    const R0 = M0.R * hitEase();
    const dx = p.tx - a[0], dy = p.ty - a[1], dd = Math.hypot(dx, dy);
    const pull = cfg.assist === 2 ? 0.45 : (S.he ?? 1) === 0 ? 0.38 : 0.28;
    if (dd < R0 * 1.5) a = [a[0] + dx * pull, a[1] + dy * pull];
  }
  net.send({ t: 'swing', pid: p.id, dt, ax: a[0] - p.tx, ay: a[1] - p.ty, mode });
  swingInfo[p.id] = { mode, a };
  // 접촉 여부는 결정적이라 바로 판정 → 즉시 타격감
  const he = mode === 'bunt' ? 1 : hitEase(); // 서버와 같은 판정 폭(타격 난이도 반영)
  const M = { ...SWING[mode], W: SWING[mode].W * he, R: SWING[mode].R * he };
  const d = Math.hypot(a[0] - p.tx, a[1] - p.ty);
  const contact = Math.abs(dt) <= M.W && d <= M.R;
  const ms = Math.round(dt * 1000);
  const tm = Math.abs(dt) < 0.025 ? '완벽한 타이밍' : dt < 0 ? `${-ms}ms 빠름` : `${ms}ms 늦음`;
  if (mode !== 'bunt') swingReport(dt, a, p, M, contact);
  bus.emit('localSwing', { pid: p.id, mode, contact, dt: Math.round(dt * 1000), q: contact ? (mode === 'bunt' ? 0.3 : Math.pow(1 - Math.abs(dt) / M.W, 0.5) * Math.pow(1 - d / M.R, 0.6)) : 0 }); // [gameplay] 내 스윙 즉시 피드백(서버 contact/miss는 핑만큼 늦게 옴)
  if (contact) {
    const q = mode === 'bunt' ? 0.3 : Math.pow(1 - Math.abs(dt) / M.W, 0.5) * Math.pow(1 - d / M.R, 0.6);
    contactFreeze = { pid: p.id, until: nowP() + 0.35, pos: [p.tx, p.ty] };
    onContact(p, q, mode === 'bunt');
    if (mode === 'bunt') feedback('번트!', '#9fd0ff');
    else if (q < 0.1) feedback(`${tm} · 빗맞은 파울`, '#ffcf3f');
    else if (q > 0.82) { sfx.perfect(); feedback(`퍼펙트! · ${tm}`, '#4fd18b'); perfectHit = nowP(); }
    else feedback(`${tm} · ${d < 0.08 ? '정타' : a[1] - p.ty > 0.07 ? '공 윗부분 → 땅볼' : a[1] - p.ty < -0.07 ? '공 아랫부분 → 뜬공' : '빗맞음'}`, q > 0.5 ? '#4fd18b' : '#ffcf3f');
  } else {
    sfx.whiff();
    feedback(Math.abs(dt) > M.W ? (dt < 0 ? `너무 빨라 (${-ms}ms)` : `늦었어 (${ms}ms)`) : '공이랑 안 맞았어', '#ff8a80');
  }
}
let contactFreeze = null, perfectHit = 0;
// ── 스윙 분석: 타이밍(빠름/늦음)과 위치(배트 원 vs 공) 중 뭐가 문제였는지 바로 보여줌 + 최근 스윙 경향 코칭 ──
const swHist = [];
let swaT = 0;
function swingReport(dt, a, p, M, contact) {
  const el = $('swa'); if (!el) return;
  const ex = a[0] - p.tx, ey = a[1] - p.ty, d = Math.hypot(ex, ey);
  swHist.push({ dt, ex, ey, d, contact, W: M.W, R: M.R }); if (swHist.length > 12) swHist.shift();
  // 타이밍 바: ±0.2초 범위, 초록 = 맞는 구간
  const span = 0.2, pos = clamp(dt / span, -1, 1);
  el.querySelector('.sw-win').style.cssText = `left:${50 - M.W / span * 50}%;width:${M.W / span * 100}%`;
  el.querySelector('.sw-mk').style.left = `${50 + pos * 50}%`;
  el.querySelector('.sw-mk').style.background = Math.abs(dt) <= M.W ? '#4fd18b' : '#ff6b5a';
  const tOk = Math.abs(dt) <= M.W, lOk = d <= M.R;
  el.querySelector('.sw-tv').textContent = Math.abs(dt) < 0.02 ? '딱 맞음' : `${Math.round(Math.abs(dt) * 1000)}ms ${dt < 0 ? '빠름' : '늦음'}`;
  el.querySelector('.sw-tv').style.color = tOk ? '#4fd18b' : '#ff8a80';
  // 위치 그림: 공(흰 점) 기준으로 배트 원(초록/빨강)이 어디 있었나
  const c = el.querySelector('canvas'), g = c.getContext('2d'), S0 = 60, k = 60 / 0.3;
  g.clearRect(0, 0, 120, 120);
  g.strokeStyle = 'rgba(255,255,255,.15)'; g.strokeRect(10, 10, 100, 100);
  g.beginPath(); g.arc(S0 + ex * k, S0 - ey * k, M.R * k, 0, 7); g.fillStyle = lOk ? 'rgba(79,209,139,.25)' : 'rgba(255,107,90,.22)'; g.fill(); g.strokeStyle = lOk ? '#4fd18b' : '#ff6b5a'; g.lineWidth = 2; g.stroke();
  g.beginPath(); g.arc(S0, S0, 5, 0, 7); g.fillStyle = '#fff'; g.fill();
  const dirTxt = d < 0.03 ? '정확' : `${Math.round(d * 100)}cm ${Math.abs(ey) > Math.abs(ex) ? (ey > 0 ? '위로' : '아래로') : ((ex < 0) ? '왼쪽' : '오른쪽')}`;
  el.querySelector('.sw-lv').textContent = dirTxt; el.querySelector('.sw-lv').style.color = lOk ? '#4fd18b' : '#ff8a80';
  // 경향 코칭 (최근 4번 이상)
  let tip = '';
  const last = swHist.slice(-6);
  if (last.length >= 4) {
    const mT = last.reduce((s, h) => s + h.dt, 0) / last.length;
    const badT = last.filter((h) => Math.abs(h.dt) > h.W).length, badL = last.filter((h) => h.d > h.R).length;
    const mY = last.reduce((s, h) => s + h.ey, 0) / last.length;
    if (badT >= badL && badT >= 2) tip = mT > 0 ? `타이밍이 늦는 편 (평균 ${Math.round(mT * 1000)}ms) → '스트라이드!' 뜰 때 미리 준비` : `타이밍이 빠른 편 (평균 ${Math.round(-mT * 1000)}ms) → 공이 존 앞에 올 때까지 참기`;
    else if (badL >= 2) tip = Math.abs(mY) > 0.06 ? `배트 원이 공보다 ${mY > 0 ? '위' : '아래'}에 있는 편 → ${mY > 0 ? '조금 낮게' : '조금 높게'}` : '위치가 좌우로 흔들림 → 공 따라 원을 끝까지 옮기기';
    else tip = '좋아요! 지금 감각 유지';
  }
  el.querySelector('.sw-tip').textContent = tip;
  el.classList.remove('hide'); clearTimeout(swaT); swaT = setTimeout(() => el.classList.add('hide'), 5200);
}
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
    sfx.ui();
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
  if (pf) sfx.perfect();
  gauge = null;
}
$('buntBtn').onpointerdown = (e) => { e.stopPropagation(); toggleBunt(); };
function toggleBunt() {
  if (!S || S.mode === 'derby' || !getRole().batter) return;
  buntOn = !(buntOn || S.bs); net.send({ t: 'bunt', on: buntOn });
  feedback(buntOn ? '번트 자세 · 공 들어올 때 클릭' : '강공 자세', '#9fd0ff');
}
function renderPitchBar(force) {
  const bar = $('pitchbar');
  if (!force && bar.dataset.k === pitchType) return;
  bar.dataset.k = pitchType;
  bar.innerHTML = PITCH_KEYS.map((k, i) => `<button data-p="${k}" class="${k === pitchType ? 'on' : ''}"><small>${i + 1}</small><i class="pc" style="background:${PITCHES[k].col}"></i>${PITCHES[k].name}<em>~${PITCHES[k].v}km/h</em></button>`).join('');
  bar.querySelectorAll('button').forEach((b) => (b.onpointerdown = (e) => { e.stopPropagation(); pitchType = b.dataset.p; renderPitchBar(true); }));
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
  if (ctl.idx !== role.fi) { if (ctl.idx >= 0 && S.ph === 'live') feedback(`▶ ${POS_KO[role.pos] || ''} 조작`, '#ffd23a'); ctl.idx = role.fi; ctl.active = false; }
  const diveAge = f[7];
  let fw = (keys.w || keys.arrowup ? 1 : 0) - (keys.s || keys.arrowdown ? 1 : 0) + touchMove.y;
  let rt = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0) + touchMove.x;
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
  if (ctl.active && t - ctl.lastSend > 0.05) { ctl.lastSend = t; net.send({ t: 'mv', x: ctl.x, z: ctl.z, ry: ctl.ry, a: 1 }); }
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
  if (!A.init) { r.position.set(x, 0, z); r.rotation.y = ry; A.init = true; A.spd = 0; return 0; }
  const a = 1 - Math.exp(-k * dt);
  const ox = r.position.x, oz = r.position.z;
  r.position.x = lerp(ox, x, a); r.position.z = lerp(oz, z, a);
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
// 수비 중 '지금 내 역할' (서버가 정한 추격자/베이스 커버 기준)
function myDuty(s, role) {
  if (s.ph !== 'live' || role.fi < 0) return null;
  if (role.holding) return { k: 'hold', txt: s.rl && ['LF', 'CF', 'RF'].includes(role.pos) ? '공 잡았다! R = 커트맨에게 중계 (멀면 Space도 자동 중계)' : '공 잡았다! 송구할 베이스 선택', col: '#4fd18b' };
  if (s.ch === role.fi) return { k: 'chase', txt: '▶ 네 타구! 공(주황 원) 쪽으로 가서 잡아', col: '#ffcf3f' };
  if (s.rl && s.rl[0] === role.fi) return { k: 'relay', txt: `▶ 중계! 파란 원으로 가서 외야 송구 받고 ${s.rl[3] === 4 ? '홈' : s.rl[3] + '루'}로`, col: '#5bd0ff' };
  const cv = s.cv || [], bi = cv.indexOf(role.fi);
  if (bi >= 0) return { k: 'cover', base: bi, txt: `▶ ${['1루', '2루', '3루', '홈'][bi]} 커버! 베이스로 가서 송구 받기`, col: '#7cc4ff' };
  return { k: 'idle', txt: role.pos === 'P' ? '투수는 대기 · 다른 야수가 처리 중' : '대기 · 다른 야수가 처리 중', col: '#aab3c5' };
}
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
  const IP = !net?.local && window.__noInterp !== 1 ? interpAt(t - netQ.delay) : null;
  s.fl.forEach((f, i) => {
    const A = fielders[i]; if (!A) return;
    let [pos, x, z, ry, ctrlId, mv, jt, dv] = f;
    if (IP) { const fa = IP[0].fl[i], fb = IP[1].fl[i]; if (fa && fb && fa[0] === pos && fb[0] === pos) { x = lerp(fa[1], fb[1], IP[2]); z = lerp(fa[2], fb[2], IP[2]); ry = lerpAng(fa[3], fb[3], IP[2]); } }
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
  const showBatter = pitchPhase || (s.ph === 'result' && s.p && s.p.res !== 'hit' && !s.b);
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
      batter.a.batter(dt, { swingK, loadK, bunt, track: batter.tr, aimY, lookW: _v.set(0, 1.6, 18) });
      batter.p.bat.visible = true;
      // 스윙 잔상 + 바람 가르는 소리
      if (!bunt && swingK >= 0.3 && swingK <= 0.78) {
        batter.p.root.updateMatrixWorld(true);
        fx.batPush(batter.p.batPoint(0.42, _w), batter.p.batPoint(0.86, _u));
        if (!batter.swSfx) { batter.swSfx = true; sfx.swing(0.8); }
      }
      if (swingK < 0) batter.swSfx = false;
    }
  }
  // 주자
  const live = new Set();
  for (const r of s.rn || []) {
    const [x0, z0, name, b, pid, flags, target, rid] = r;
    const key = rid ? 'r' + rid : name + '|' + (pid || '');
    live.add(key);
    let A = runners.get(key);
    if (!A) { A = mkActor({ team: batTeamBuilt || 'away', num: (name.charCodeAt(name.length - 1) % 60) + 1, role: 'runner', seed: name.length * 7 + (pid ? pid.length : 0) }); runners.set(key, A); }
    let x = x0, z = z0;
    if (IP) { const ra = IP[0].rn.get(key), rb = IP[1].rn.get(key); if (ra && rb) { x = lerp(ra[0], rb[0], IP[2]); z = lerp(ra[1], rb[1], IP[2]); } }
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
    if ((flags & 4) && s.ph === 'live') { if (!A.slideT) { A.slideT = tp; sfx.slide(); fx.dustPuff(x, z, 2, 1.5); } }
    if (A.slideT) { slideK = (tp - A.slideT) / 0.6; if (slideK > 1.6 || (sp < 0.3 && slideK > 1)) { A.slideT = 0; slideK = -1; } }
    const nm = nameOf(pid);
    setTag(A, nm || '', pid === myId ? '#ffcf3f' : '#fff');
    A.a.runner(dt, { speed: sp, slideK, lead: onBase && (s.ph === 'pitch' || s.ph === 'pitching'), cheer: !!(flags & 2), lookW: onBase ? _v.set(0, 1.2, 15) : null });
    A.p.root.visible = !(showBatter && b === 0);
  }
  for (const [k, A] of runners) if (!live.has(k)) { scene.remove(A.p.root); runners.delete(k); }
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
  if (e > 14 || screen === 'room' || screen === 'title') { for (const A of celeb.actors) scene.remove(A.p.root); celeb = null; return; }
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
// 처음 몇 번은 상황별 짧은 도움말 카드 (브라우저마다 종류별 2번까지)
const COACH = {
  bat: ['타격', '투수가 다리를 들었다 <b>멈춘 뒤</b> 내딛을 때 공이 나와. 하얀 원을 공 길목에 두고, 원 테두리가 <b style="color:#4fd18b">초록</b>일 때 클릭!'],
  pitch: ['투구', '<b>1~6</b> 구종 고르고 → 마우스로 코스 → 클릭해서 게이지 시작 → <b style="color:#4fd18b">초록 구간</b>에서 한 번 더 클릭.'],
  field: ['수비', '노란 링이 내 선수. <b>WASD</b>로 공 밑으로 가면 자동 포구. 잡으면 <b>Space</b> = 금색 베이스로 송구.'],
  run: ['주루', '주자 있으면 투구 전 <b>R</b> 도루. 타구 후 <b>E</b> 추가 진루 / <b>Q</b> 귀루. 접전은 자동 슬라이딩.'],
};
let coachT = 0, coachSeen = {};
try { coachSeen = JSON.parse(localStorage.getItem('hr_coach') || '{}'); } catch {}
function coach(kind) {
  if ((coachSeen[kind] || 0) >= 2 || nowP() - coachT < 6) return;
  coachSeen[kind] = (coachSeen[kind] || 0) + 1; try { localStorage.setItem('hr_coach', JSON.stringify(coachSeen)); } catch {}
  const [t, h] = COACH[kind]; const e = $('coach');
  e.querySelector('b').textContent = '도움말 · ' + t; e.querySelector('span').innerHTML = h;
  e.classList.add('show'); coachT = nowP(); setTimeout(() => e.classList.remove('show'), 6500);
}
let coachLast = '';
function updateCoach(role) {
  if (!S || screen !== 'game') return;
  const k = role.batter && S.ph === 'pitch' ? 'bat' : role.pitcher && S.ph === 'pitch' ? 'pitch' : role.fi >= 0 && S.ph === 'live' && !role.pitcher ? 'field' : role.offense && !role.batter && (S.occ || []).some(Boolean) && S.ph === 'pitch' ? 'run' : '';
  if (k && k !== coachLast) coach(k);
  coachLast = k;
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
  const bar = $('tbar');
  if (bar) { const show_ = !!throwCharge && on; bar.classList.toggle('hide', !show_); if (show_) bar.querySelector('i').style.width = `${(0.25 + throwPow() * 0.75) * 100}%`; }
}
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
function updateBall(dt, t, role, pitchPhase) {
  const s = S;
  let vis = false;
  blob.visible = false; landRing.visible = false; crossMark.visible = false; guide.visible = false; cutRing.visible = false;
  const tp = nowP();
  if (s.p && (s.ph === 'pitching' || (s.ph === 'result' && !s.b && s.p.res !== 'hit') || (contactFreeze && contactFreeze.pid === s.p.id && s.ph === 'pitching'))) {
    const p = s.p;
    if (t >= p.t0) {
      const sv = (t - p.t0) / p.T;
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
        if (!(contactFreeze && contactFreeze.pid === p.id)) sfx.mitt(p.kmh > 140 ? 1 : 0.7);
      }
      if (sv > 1.0 && (role.batter || role.pitcher || camMode === 'tv')) { crossMark.visible = true; crossMark.position.set(p.tx, p.ty, 0.02); crossMark.material.color.set(p.res === 'take' || p.res === 'miss' || true ? '#ff3b3b' : '#fff'); }
    }
  } else if (ballL && (s.ph === 'live' || s.ph === 'result')) {
    if (ballL.h >= 0) {
      vis = false; // 수비수 손 안의 공(모델)이 보임
      const A = fielders[ballL.h]; if (A) A.p.ball.getWorldPosition(ballPos);
    } else if (tp >= hitStopUntil) {
      const steps = Math.ceil(dt / (1 / 120));
      const prevY = ballL.y, prevVy = ballL.vy;
      for (let i = 0; i < steps; i++) {
        const ev = integrate(ballL, dt / steps);
        if (ev.landed && ev.impact > 2.5) { sfx.bounce(ev.impact); if (ev.surf === 'dirt' && ev.impact > 3) fx.dustPuff(ballL.x, ballL.z, 0.8, 0.8); }
      }
      ballPos.set(ballL.x, ballL.y, ballL.z);
      fx.trailPush(ballPos, ballL.state === 'thrown' ? '#9fd0ff' : '#ffe6b0');
      vis = true;
      // 낙구 지점
      if (ballL.state === 'air' && ballL.y > 1.2 && ballL.vy > -40) {
        if (tp - landT > 0.08) {
          landT = tp;
          const b = { ...ballL };
          let i = 0; for (; i < 360; i++) { const ev = integrate(b, 1 / 60); if (ev.landed || ev.wall || ev.over) break; }
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
            const b = { ...ballL };
            for (let i = 1; i <= 240; i++) { integrate(b, 1 / 60); const tt = i / 60; if (b.y < 1.3 && Math.hypot(b.x - me.x, b.z - me.z) / SPRINT_SPEED + 0.12 <= tt) { cut = [b.x, b.z, tp + tt]; break; } }
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
    } else vis = true;
  } else if (s.ph === 'pitch' || !s.p) vis = false;
  ballMesh.visible = vis;
  if (vis) {
    ballMesh.position.copy(ballPos);
    // 멀리 날아간 공은 화면에서 점처럼 사라지지 않게 살짝 키워서 그림 (투구 중엔 실제 크기)
    // 날아가는 공은 거리 따라 살짝 키우고, 투구 중인 공은 1.5배로 그려서 '실제 공'을 끝까지 눈으로 따라갈 수 있게 (위치 예측 표시는 없음)
    ballMesh.scale.setScalar(ballL && (s.ph === 'live' || s.ph === 'result') ? clamp(camera.position.distanceTo(ballPos) / 22, 1, 3) * (camera.fov / 52) ** 0.5 : s.ph === 'pitching' && (role.batter || role.pitcher) ? 1.5 : 1);
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
  if (dd < 2.5) yaw = fcam.yaw ?? yaw; // 목표가 바로 옆이면 시점 고정 (빙글빙글 방지)
  if (fcam.yaw == null) fcam.yaw = yaw;
  let d = yaw - fcam.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
  fcam.yaw += d * Math.min(1, dt * 2.2);
  if (nowP() - fcam.dragT > 2.5) { fcam.yawOff *= Math.exp(-dt * 1.2); fcam.pitchOff *= Math.exp(-dt * 1.2); }
  const Y = fcam.yaw + fcam.yawOff;
  const back = 6.2, up = 2.6 + fcam.pitchOff * 5;
  tPos.set(me.x - Math.sin(Y) * back, up, me.z - Math.cos(Y) * back);
  const lookD = Math.min(Math.max(dd, 8), 30);
  tLook.set(me.x + Math.sin(Y) * lookD, Math.max(0.6, ty * 0.5), me.z + Math.cos(Y) * lookD);
}
function updateCamera(dt, time) {
  let k = 4, fov = 55;
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
      if (ph === 'pitch') { tPos.set(0.85, 4.3, 30.2); tLook.set(0.12, 0.62, 6); fov = 23.5; k = 6; }
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
      else if (tp - lastContactT < 2.4) { tPos.set(bx * 0.06, 8.5, -15); tLook.copy(ballPos).setY(Math.max(0.6, ballPos.y * 0.75)); fov = clamp(54 - Math.max(0, Math.hypot(bx, bz) - 35) * 0.16, 38, 54); }
      else { const far = clamp(bz, 0, 120); tPos.set(bx * 0.2, 8 + far * 0.08, -15 + far * 0.18); tLook.set(bx * 0.8, Math.max(0.6, Math.min(ballPos.y, 20) * 0.5), Math.max(8, bz * 0.85)); fov = 52; }
      k = tp - lastContactT < 2.4 ? 6 : 2.2; camMode = 'pwatch';
    } else if (role.fi >= 0 && fielders[role.fi] && (ph === 'live' || (ph === 'result' && S.b)) && cfg.fieldCam === 'tps') {
      // 3인칭: 내 선수 뒤에서 공(또는 낙구 지점) 쪽을 봄
      const me = fielders[role.fi].p.root.position;
      const tgt = landRing.visible ? landRing.position : ballMesh.visible ? ballPos : null;
      if (tgt) tpsCam(me, tgt.x, Math.min(ballMesh.visible ? ballPos.y : 1, 12), tgt.z, dt);
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
        const d = Math.hypot(bx, bz);
        tPos.set(bx * 0.06, 8.5, -15); tLook.copy(ballPos).setY(Math.max(0.5, ballPos.y * 0.75));
        k = 6; fov = clamp(54 - Math.max(0, d - 35) * 0.16, 38, 54);
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
  smoothDamp(camPos, tPos, camVel, smooth, dt);
  smoothDamp(camLook, tLook, lookVel, smooth * 0.85, dt);
  void a;
  camera.position.copy(camPos);
  if (shake > 0 && cfg.shake) {
    camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake;
    shake = Math.max(0, shake - dt * 0.9);
  } else shake = 0;
  camera.lookAt(camLook);
  camFov = window.__cam || window.__fastCam ? fov : lerp(camFov, fov, camMode === 'tv' || fov < 30 ? Math.min(1, a * 1.5) : a);
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

// ═════════════ HUD ═════════════
let hudKey = '';
function updateHUD() {
  if (!S || !S.fl || (screen !== 'game' && screen !== 'over')) return;
  const role = getRole();
  const s = S;
  const pitchPhase = s.ph === 'pitch' || s.ph === 'pitching';
  // 시계
  if (s.ph === 'pitch' && role.pitcher && s.dl != null) { $('clock').classList.remove('hide'); const v = Math.max(0, Math.ceil(s.dl)); $('clock').textContent = v; $('clock').classList.toggle('warn', v <= 5); }
  else $('clock').classList.add('hide');
  // ── 투구 타이밍 신호 (타자): 셋 → 다리 들기 → 정점 → 스트라이드 → 릴리스 ──
  {
    const pc = $('pcue');
    let on = false;
    if (role.batter && s.ph === 'pitching' && s.p && s.mode !== 'derby') {
      const t = simNow(), p = s.p, tau = t - (p.t0 - WINDUP);
      if (tau >= 0 && t < p.t0 + 0.3) {
        on = true;
        const go = t >= p.t0;
        pc.classList.toggle('go', go);
        pc.querySelector('.pc-t').textContent = go ? '온다!' : tau < 0.35 ? '투수 셋 포지션' : tau < 1.25 ? '다리 들기…' : tau < 1.45 ? '정점 — 준비!' : '스트라이드!';
        pc.querySelector('i').style.width = Math.min(100, tau / WINDUP * 100) + '%';
        if (go && seen.rel !== p.id) { seen.rel = p.id; sfx.ui(); fx.impact(new THREE.Vector3(RELEASE[0] - 0.15, RELEASE[1], RELEASE[2]), 0.22); }
      }
    }
    pc.classList.toggle('hide', !on);
  }
  // 큰 볼카운트 (타석/투구 중)
  {
    const bc = $('bigcount'), on = (role.batter || role.pitcher) && pitchPhase && s.cnt && s.mode !== 'derby';
    bc.classList.toggle('hide', !on);
    if (on) { const key = s.cnt.join(); if (bc.dataset.k !== key) { bc.dataset.k = key; const set = (sel, n) => bc.querySelectorAll(sel + ' i').forEach((e, i) => e.classList.toggle('on', i < n)); set('.bc-b', s.cnt[0]); set('.bc-s', s.cnt[1]); set('.bc-o', s.cnt[2]); } }
  }
  // 구종 표시: 쉬움은 던지자마자, 그 외엔 공이 지나간 뒤 (어떤 공이었는지 학습용)
  {
    const pt = $('ptype'); let txt = '';
    if (role.batter && s.p && PITCHES[s.p.type] && s.mode !== 'derby' && (s.ph === 'pitching' || s.ph === 'result')) {
      const t = simNow(), early = (s.he ?? 1) === 0;
      if ((early && t >= s.p.t0 + 0.08) || t >= s.p.arrive + 0.15) txt = `<span style="color:${PITCHES[s.p.type].col}">●</span> ${PITCHES[s.p.type].name} ${s.p.kmh}km/h`;
    }
    pt.classList.toggle('hide', !txt); if (txt && pt.innerHTML !== txt) pt.innerHTML = txt;
  }
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
    pciHot = cfg.assist > 0 && Math.abs(sv - 1) * p.T < SWING.contact.W * hitEase() * 0.55;
    if (cfg.assist === 2 && sv > 0 && sv < 1.15) {
      const R = SWING[bunt ? 'bunt' : 'contact'].R * hitEase();
      const rr = R * 0.6 + Math.max(0, 1 - sv) * 0.5;
      const ap = aimPoint() || [0, 0.8]; // [gameplay] 타이밍 링은 공 자리 대신 내 배트 원 위에 (위치 미리보기 금지)
      timeRing.visible = true; timeRing.position.set(ap[0], ap[1], -0.015); timeRing.scale.setScalar(rr); timeRing.lookAt(camera.position);
      timeRing.material.color.set(pciHot ? '#4fd18b' : '#ffffff'); timeRing.material.opacity = clamp(sv * 1.5, 0, 0.6);
    }
  }
  const a = (role.batter || role.pitcher) && pitchPhase ? aimPoint() : null;
  if (a && role.batter && camMode !== 'intro') {
    const mode = buntOn || s.bs ? 'bunt' : keys.f ? 'power' : 'contact';
    const R = SWING[mode].R * (mode === 'bunt' ? 1 : hitEase());
    pci.visible = true; pci.position.set(a[0], a[1], -0.02);
    pci.scale.setScalar(1); pciOuter.scale.setScalar(R); pciFill.scale.setScalar(R);
    // 표시 크기는 '잘 맞는 구간'(판정 반경의 60%)만 — 화면이 덜 어지럽게
    pciOuter.scale.setScalar(R * 0.6); pciFill.scale.setScalar(R * 0.6);
    pciOuter.material.color.set(pciHot ? '#4fd18b' : mode === 'bunt' ? '#9fd0ff' : mode === 'power' ? '#ff9f43' : '#ffffff');
    pciOuter.material.opacity = pciHot ? 0.95 : 0.5;
    pci.lookAt(camera.position);
    $('modeTag').className = mode; $('modeTag').textContent = mode === 'bunt' ? '번트' : '강타';
  }
  show('modeTag', !!(a && role.batter && (mode2() !== 'contact')));
  const showBunt = role.batter && pitchPhase && s.mode !== 'derby';
  show('buntBtn', showBunt);
  if (showBunt) { const on = buntOn || !!s.bs; const b = $('buntBtn'); b.classList.toggle('on', on); b.innerHTML = on ? '<span class="kbd">B</span>번트 해제' : '<span class="kbd">B</span>번트 자세'; }
  if (camMode === 'intro') { pci.visible = false; aimMark.visible = false; }
  if (role.pitcher && s.ph === 'pitch' && camMode !== 'intro') {
    const aim = gauge ? gauge.aim : a;
    if (aim) { aimMark.visible = true; aimMark.position.set(aim[0], aim[1], 0.01); aimMark.lookAt(camera.position); }
  }
  // 게이지
  show('gauge', !!gauge && role.pitcher); show('gaugeLbl', !!gauge && role.pitcher);
  if (gauge && role.pitcher) {
    const el = nowP() - gauge.t0, lv = gaugeLevel(el);
    const g = $('gauge'), H = g.clientHeight - 8;
    g.querySelector('.fill').style.height = `${clamp(lv / 1.15, 0, 1) * H}px`;
    { const [b0, b1] = pBand(); g.querySelector('.band').style.cssText = `bottom:${b0 / 1.15 * H + 4}px;height:${(b1 - b0) / 1.15 * H}px`; } // [gameplay]
    g.querySelector('.over').style.height = `${(0.15 / 1.15) * H + 4}px`;
    $('gaugeLbl').textContent = `~${Math.round(PITCHES[gauge.type].v * (0.86 + 0.15 * Math.min(1, lv)))}km`;
    if (el > GAUGE_UP * 2) sendPitch(0.35);
  }
  if (s.ph !== 'pitch' && gauge) gauge = null;
  show('pitchbar', role.pitcher && s.ph === 'pitch' && !gauge);
  if (role.pitcher && s.ph === 'pitch') renderPitchBar();
  // 키 버튼
  let keysHtml = '', soft = false;
  if (s.ph === 'live' && role.holding) keysHtml = [['1', '1루'], ['2', '2루'], ['3', '3루'], ['4', '홈'], ['F', '투수']].map(([k, l]) => `<button data-k="${k.toLowerCase()}"><span class="kbd">${k}</span>${l}</button>`).join('');
  else if (role.offense && s.ph === 'live') { keysHtml = '<button data-k="e"><span class="kbd">E</span>추가 진루</button><button data-k="q"><span class="kbd">Q</span>귀루</button>'; soft = true; }
  else if (role.offense && s.ph === 'pitch' && (s.rn || []).length && !role.batter) { keysHtml = '<button data-k="r"><span class="kbd">R</span>도루</button>'; soft = true; }
  const kb = $('keys');
  if (kb.dataset.h !== keysHtml) {
    kb.dataset.h = keysHtml; kb.innerHTML = keysHtml;
    kb.querySelectorAll('button').forEach((b) => (b.onpointerdown = (e) => { e.stopPropagation(); dispatchEvent(new KeyboardEvent('keydown', { key: b.dataset.k })); }));
  }
  kb.classList.toggle('soft', soft);
  show('keys', !!keysHtml && !(role.pitcher && s.ph === 'pitch'));
  if (TOUCH) renderTouchButtons(role);
  // 타구 정보
  const hi = $('hitinfo');
  if (s.lh && (s.ph === 'live' || s.ph === 'result') && s.p && s.lh.id === s.p.id && s.p.res === 'hit') {
    hi.classList.add('show');
    $('hiEv').textContent = `${s.lh.ev}km/h`; $('hiLa').textContent = `${s.lh.la}°`;
    $('hiD').textContent = s.hr && s.hr.id && s.ph === 'result' && /홈런/.test(s.msg[1]) ? `${s.hr.dist}m` : ballL && ballL.h < 0 ? `${Math.round(Math.hypot(ballPos.x, ballPos.z))}m` : '-';
  } else hi.classList.remove('show');
  // 핑
  const fpsTxt = curFps ? `<span style="color:${curFps >= 50 ? '#4fd18b' : curFps >= 35 ? '#ffcf3f' : '#ff6b5a'}">${curFps}fps</span>` : '';
  if (net?.local) { if ($('ping').dataset.h !== fpsTxt) { $('ping').dataset.h = fpsTxt; $('ping').innerHTML = fpsTxt; } }
  else if (nowP() - (pingDrawT || 0) > 0.5) { // 0.5초마다: 내 핑 + 다른 사람 핑 (색: 초록 <80 / 노랑 <160 / 빨강)
    pingDrawT = nowP();
    const col = (ms) => ms < 80 ? '#4fd18b' : ms < 160 ? '#ffcf3f' : '#ff6b5a';
    const others = (pgList || []).filter((x) => x[0] !== myName).map((x) => `<span style="color:${col(x[1])}">${esc(x[0])} ${x[1]}</span>`).join(' · ');
    const unstable = netQ.jit > 0.05 ? ' <b style="color:#ff8a80">연결 불안정</b>' : '';
    $('ping').innerHTML = `${fpsTxt ? fpsTxt + ' · ' : ''}<span style="color:${col(rtt)}">내 핑 ${rtt}ms</span>${unstable}${others ? '<br>' + others : ''}`;
  }
  // 이하 변할 때만
  const keyNow = JSON.stringify([s.sc, s.inn, s.half, s.cnt, s.occ, s.bat, s.bt, role.pos, role.batter, s.ph, role.holding, role.offense, s.tn, s.sta, s.pc, s.dy, lobby && lobby.players.length, s.mode, buntOn, s.bs]);
  if (keyNow === hudKey) return;
  hudKey = keyNow;
  const bugName = (i) => (s.cl && s.tn[i] === clubOf(s.cl[i]).name ? clubOf(s.cl[i]).short : s.tn[i]);
  $('nA').textContent = bugName(0); $('nH').textContent = bugName(1);
  if (s.cl) applyClubs(s.cl);
  if (s.tod) applyTimeOfDay(s.tod);
  $('sA').textContent = s.sc[0]; $('sH').textContent = s.sc[1];
  $('trA').classList.toggle('bat', s.bt === 'away'); $('trH').classList.toggle('bat', s.bt === 'home');
  $('half').textContent = s.half === 0 ? '▲ 초' : '▼ 말';
  $('innN').textContent = s.inn;
  ['d1', 'd2', 'd3'].forEach((id, i) => $(id).setAttribute('fill', s.occ && s.occ[i] ? '#ffcf3f' : 'rgba(255,255,255,.18)'));
  const [b, st, o] = s.cnt;
  document.querySelectorAll('.dots.b i').forEach((d, i) => d.classList.toggle('on', i < b));
  document.querySelectorAll('.dots.s i').forEach((d, i) => d.classList.toggle('on', i < st));
  document.querySelectorAll('.dots.o i').forEach((d, i) => d.classList.toggle('on', i < o));
  // 매치업
  $('muBat').textContent = s.bat ? s.bat.name : '-';
  if (s.mode === 'derby' && s.dy) {
    const cur = s.dy.list[s.dy.idx];
    $('muBatS').textContent = s.dy.pr ? `연습 ${s.dy.sw}타구 · 홈런 ${cur ? cur[2] : 0} · 평균 예상타율 ${s.dy.sw ? (s.dy.xh / s.dy.sw).toFixed(3).slice(1) : '-'}` : cur ? `홈런 ${cur[2]} · 아웃 ${s.dy.outs}/${s.dy.n}` : '';
    $('muP').classList.add('hide');
  } else {
    const myst = (s.st || []).find((r) => s.bat && ((r[0] && r[0] === s.bat.id) || (!r[0] && r[1] === s.bat.name)));
    $('muBatS').textContent = myst ? `${myst[3] - myst[9]}타수 ${myst[4]}안타${myst[5] ? ' ' + myst[5] + '홈런' : ''}` : '첫 타석';
    $('muP').classList.remove('hide');
    const pf = s.fl.find((f) => f[0] === 'P');
    $('muPit').textContent = (pf && nameOf(pf[4])) || (pf && pf[4] === myId ? myName : 'CPU');
    $('staBar').style.width = `${s.sta ?? 100}%`;
    $('muPc').textContent = `${s.pc || 0}구`;
  }
  const team = myTeam();
  let r = '관전 중', sub = '';
  if (team && team !== 'spec') {
    sub = s.mode === 'derby' ? '홈런 더비' : `${s.tn[team === 'away' ? 0 : 1]} · ${role.offense ? '공격' : '수비'}`;
    if (role.batter) r = '타석';
    else if (role.pos) r = POS_KO[role.pos];
    else if (role.offense) r = '공격 대기';
    else r = s.mode === 'derby' ? '대기' : '수비 (CPU 담당)';
  }
  $('role').innerHTML = `${esc(r)}<small>${esc(sub)}</small>`;
  { const du = myDuty(s, role), el = $('duty'); const h = du ? `<span style="color:${du.col}">${esc(du.txt)}</span>` : '';
    if (el.dataset.h !== h) { el.dataset.h = h; el.innerHTML = h; if (du && du.k !== 'idle' && du.k !== el.dataset.k) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); } el.dataset.k = du ? du.k : ''; }
    el.classList.toggle('hide', !du); }
  // 조작 안내: 역할 이름 + 키 칩 + 상황 팁
  let keysL = [], tip = '', title = '';
  const runnersOn = (s.occ || []).some(Boolean);
  if (role.batter && pitchPhase) {
    title = buntOn || s.bs ? '번트' : '타격';
    keysL = buntOn || s.bs ? [['클릭', '번트 대기'], ['마우스 좌우', '방향'], ['B', '강공 전환']]
      : [['마우스', '배트 원 이동'], ['좌클릭', '정타'], ['우클릭 · F', '강타'], ...(s.dy && s.dy.pr ? [['1~6', `구종 고정${s.dy.pp && s.dy.pp !== 'MIX' && PITCHES[s.dy.pp] ? '(' + PITCHES[s.dy.pp].name + ')' : ''}`], ['0', '섞어서']] : [['B', '번트']]), ['V', '시점']];
    tip = buntOn || s.bs ? '' : '위쪽 바가 노랗게 차면 공이 온다 → 원 테두리가 초록일 때 스윙';
  } else if (role.pitcher && s.ph === 'pitch') {
    title = '투구'; keysL = [['1~6', '구종'], ['마우스', '코스'], ['클릭', '게이지 시작'], ['클릭', '초록에서 투구']];
    if (runnersOn) keysL.push(['Q', '견제']);
  } else if (role.pos && s.ph === 'live') {
    title = POS_KO[role.pos] || '수비';
    keysL = role.holding ? [['Space', '추천 베이스(금색) 송구'], ['1 2 3 4', '베이스 지정'], ...(['LF', 'CF', 'RF'].includes(role.pos) ? [['R', '중계(커트맨)']] : []), ['꾹 누르기', '강송구']]
      : [['WASD', '이동'], ['Shift', '질주'], ['Space', '점프'], ['C', '다이빙'], ...(s.fc === 'auto' ? [['Q', '선수 전환']] : []), ['드래그', '시점 회전'], ['V', '시점']];
    tip = role.holding ? '' : landRing.visible && s.ch === role.fi ? '주황 원(낙구 지점)에 들어가면 초록 → 자동으로 잡아요' : '가만히 있으면 CPU가 알아서 이동 · 키 누르면 직접 조작';
  } else if (role.pos && pitchPhase) {
    title = POS_KO[role.pos] || '수비';
    keysL = role.pos === 'C' ? [] : [['WASD', '수비 위치 이동'], ['드래그', '시점 회전'], ['V', '시점']];
    tip = role.pos === 'C' ? '포수 · 투수 공 받는 중' : '';
  } else if (role.offense && s.ph === 'live') { title = '주루'; keysL = [['E', '추가 진루'], ['Q', '귀루'], ['Space', '슬라이딩']]; tip = '베이스 앞 4m 안에서 Space = 슬라이딩'; }
  else if (role.offense) { title = '공격 대기'; keysL = [['R', '도루'], ['T', '빠른 채팅'], ['Tab', '기록']]; tip = runnersOn ? '도루는 투구 직전에! 너무 일찍 누르면 견제당해요' : ''; }
  else { keysL = [['Tab', '기록'], ['T', '빠른 채팅'], ['Esc', '메뉴']]; }
  const hint = (title ? `<b class="ht">${title}</b>` : '') + keysL.map(([k, l]) => `<span class="hk"><span class="kbd">${k}</span>${l}</span>`).join('') + (tip ? `<span class="tip">${tip}</span>` : '');
  if ($('hint').dataset.h !== hint) { $('hint').dataset.h = hint; $('hint').innerHTML = hint; }
}
function renderTab() {
  if (!S || !S.ls) return;
  if (S.mode === 'derby' && S.dy) {
    $('tabLine').innerHTML = '<tr><th>선수</th><th class="r">홈런</th><th>최장</th><th>상태</th></tr>' + S.dy.list.map((r, i) => `<tr class="${r[0] === myId ? 'me' : ''}"><td>${esc(r[1])}</td><td class="r">${r[2]}</td><td>${r[3] ? r[3] + 'm' : '-'}</td><td>${r[4] ? '완료' : i === S.dy.idx ? '타석' : '대기'}</td></tr>`).join('');
    $('tabStats').innerHTML = '';
  } else { $('tabLine').innerHTML = lineTable(S); $('tabStats').innerHTML = statTable(S.st || []); }
}
// 미니맵
const mm = $('minimap').getContext('2d');
function drawMinimap() {
  if (!S || !S.fl || screen !== 'game') return;
  const W = 300, sc = W / 270, ox = W / 2, oy = W - 22;
  const P = (x, z) => [ox - x * sc, oy - z * sc];
  mm.clearRect(0, 0, W, W);
  mm.fillStyle = 'rgba(47,125,54,.55)'; mm.beginPath(); mm.moveTo(...P(0, -3));
  for (let i = 0; i <= 40; i++) { const phi = -FOUL + i / 40 * FOUL * 2; const r = fenceR(phi); mm.lineTo(...P(Math.sin(phi) * r, Math.cos(phi) * r)); }
  mm.closePath(); mm.fill();
  mm.fillStyle = 'rgba(181,119,74,.7)'; mm.beginPath(); BASES.forEach(([x, z], i) => { const [a, b] = P(x * 1.15, z * 1.08 - 1); i ? mm.lineTo(a, b) : mm.moveTo(a, b); }); mm.closePath(); mm.fill();
  mm.fillStyle = '#fff'; for (const [x, z] of BASES) { const [a, b] = P(x, z); mm.fillRect(a - 3, b - 3, 6, 6); }
  const role = getRole();
  const ft = S.half === 0 ? '#3a6ee0' : '#d13a43', bt = S.half === 0 ? '#d13a43' : '#3a6ee0';
  S.fl.forEach((f, i) => { const [a, b] = P(...(i === role.fi && ctl.active ? [ctl.x, ctl.z] : [f[1], f[2]])); mm.fillStyle = i === role.fi ? '#ffcf3f' : ft; mm.beginPath(); mm.arc(a, b, i === role.fi ? 7 : 5, 0, 7); mm.fill(); });
  for (const r of S.rn || []) { const [a, b] = P(r[0], r[1]); mm.fillStyle = r[4] === myId ? '#ffcf3f' : bt; mm.beginPath(); mm.arc(a, b, 5, 0, 7); mm.fill(); mm.strokeStyle = '#fff'; mm.lineWidth = 1.5; mm.stroke(); }
  if (ballMesh.visible) { const [a, b] = P(ballPos.x, ballPos.z); mm.fillStyle = '#fff'; mm.beginPath(); mm.arc(a, b, 4, 0, 7); mm.fill(); }
  if (landRing.visible) { const [a, b] = P(landRing.position.x, landRing.position.z); mm.strokeStyle = '#ff8a3d'; mm.lineWidth = 2; mm.beginPath(); mm.arc(a, b, 7, 0, 7); mm.stroke(); }
}

// ═════════════ 메인 루프 ═════════════
let lastT = performance.now(), frameN = 0;
const perfAcc = { t: 0, n: 0, skip: 2 };
function frame(now, manual) {
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
  if (S && S.fl) { const rr = getRole(); updateMyRing(rr); updateBaseTags(rr); updateCoach(rr); }
  updateCamera(dt, time);
  updateHUD();
  if (frameN % 2 === 0) drawMinimap();
  excite = Math.max(0, excite - dt * 0.18);
  stadium.update(time, inGame ? excite : 0.15);
  crowdAmbience(inGame ? 0.06 + excite * 0.25 : 0.03);
  // 전광판
  if (inGame) {
    const lp = S.lp ? { id: S.lp.id, kmh: S.lp.kmh, name: PITCHES[S.lp.type]?.name } : null;
    const big = bigBoard && nowP() - bigBoard.t < 6 ? bigBoard : null;
    stadium.drawScoreboard(S, big ? { big: big.big, sub: big.sub } : { lp });
  }
  fx.update(dt, camera);
  if (window.__noRender) { if (!manual) requestAnimationFrame(frame); return; } // 테스트용
  syncAllSkins(camera);
  look.render(); // [stadium]
  if (!manual) requestAnimationFrame(frame);
}
window.__frame = (t) => frame(t, true);
requestAnimationFrame(frame);
setScreen('title');
document.fonts && document.fonts.ready.then(() => { stadium.refreshText(); stadium.drawScoreboard(S); });
for (const f of ['900 40px "Noto Sans KR"', '700 40px Oswald', '40px "Black Han Sans"']) document.fonts?.load(f).then(() => stadium.refreshText()).catch(() => {});
