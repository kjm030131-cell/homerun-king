// audio/engine.js — WebAudio 엔진: 컨텍스트·첫 입력 해제·볼륨 그룹·공간감(리버브)·동시 발음 제한·거리/방향
// 다른 파트는 이 파일을 직접 쓰지 않는다. 소리는 bus 이벤트 → audio/index.js 가 낸다.

const store = {
  get(k, d) { try { const v = localStorage.getItem('hr_' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('hr_' + k, JSON.stringify(v)); } catch { } },
};
// 볼륨(0~100). master 는 기존 설정 키 'vol' 을 그대로 쓴다.
export const VOL_KEYS = { master: 'vol', sfx: 'volSfx', crowd: 'volCrowd', cast: 'volCast' };
const VOL_DEF = { master: 80, sfx: 100, crowd: 100, cast: 100 }; // ui/settings.js 기본값과 같게
const vols = {};
for (const k in VOL_KEYS) vols[k] = store.get(VOL_KEYS[k], VOL_DEF[k]);
export const readStore = store.get;

export const MAX_VOICES = 28; // 동시 발음 수 상한 (맥북 에어 기준 여유 있게)

export const E = {
  ctx: null, master: null, limiter: null, groups: {}, verb: null, unlocked: false,
  noise: null, pink: null, brown: null, onReady: [],
};

const cap = (v) => Math.max(0, Math.min(1, v / 100));
// 사람 귀 기준으로 슬라이더가 고르게 느껴지도록 제곱 곡선
const curve = (v) => cap(v) ** 1.6;

export function getVol(k) { return vols[k]; }
export function setVol(k, v, save = true) {
  vols[k] = Math.max(0, Math.min(100, Math.round(v)));
  if (save) store.set(VOL_KEYS[k], vols[k]);
  applyVols();
}
function applyVols() {
  if (!E.ctx) return;
  const t = E.ctx.currentTime;
  E.master.gain.setTargetAtTime(curve(vols.master) * 1.1, t, 0.03);
  for (const g of ['sfx', 'crowd', 'cast']) {
    const G = E.groups[g]; if (!G) continue;
    const k = curve(vols[g] ?? 100) * GROUP_TRIM[g];
    G.dry.gain.setTargetAtTime(k, t, 0.03);
    G.wet.gain.setTargetAtTime(k, t, 0.03);
  }
}
// [sound 11-23] 그룹 기본 비율: 관중이 1.25 로 타격음·심판과 같은 크기라 리미터를 계속 눌러 다른 소리까지 작아졌음(= '소리가 안 나는' 느낌) → 관중은 배경 크기로
const GROUP_TRIM = { sfx: 1.25, crowd: 0.5, cast: 1.1 };
// 큰 효과음(타격·심판 콜) 순간 관중을 잠깐 낮춰 또렷하게 (방송 믹싱의 사이드체인 덕킹)
export function duck(g = 'crowd', amt = 0.5, dur = 0.35) {
  const G = E.ctx && E.groups[g]; if (!G) return;
  const t = E.ctx.currentTime, k = curve(vols[g] ?? 100) * GROUP_TRIM[g];
  for (const n of [G.dry.gain, G.wet.gain]) { n.cancelScheduledValues(t); n.setValueAtTime(n.value, t); n.setTargetAtTime(k * amt, t, 0.012); n.setTargetAtTime(k, t + dur, 0.25); }
}
// TTS 처럼 WebAudio 밖에서 나는 소리용 (0~1)
export function linVol(k) { return cap(vols.master) * cap(vols[k] ?? 100); }

// ── 노이즈 버퍼 (한 번만 만들어 재사용: 예전 코드는 소리마다 새 버퍼를 만들었음) ──
function mkNoise(a, sec, kind) {
  const n = (a.sampleRate * sec) | 0, b = a.createBuffer(1, n, a.sampleRate), d = b.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'pink') { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18; }
    else if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    else d[i] = w;
  }
  return b;
}
// ── 구장 잔향 IR: 짧은 초기 반사(관중석에서 되돌아오는 딱 소리) + 2.4초 꼬리, 고음이 먼저 죽게 ──
function mkIR(a) {
  const sr = a.sampleRate, len = (sr * 2.6) | 0, b = a.createBuffer(2, len, sr);
  const refl = [[0.028, 0.5], [0.061, 0.32], [0.118, 0.38], [0.205, 0.26], [0.33, 0.17], [0.47, 0.09]];
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch); let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const k = 0.18 + 0.78 * Math.min(1, t / 1.6); // 시간이 갈수록 저역통과 강해짐
      lp += ((Math.random() * 2 - 1) - lp) * (1 - k);
      d[i] = lp * Math.exp(-t * 2.6) * (t < 0.02 ? t / 0.02 : 1) * 0.55;
    }
    for (const [t, g] of refl) {
      const i0 = ((t + (ch ? 0.006 : 0)) * sr) | 0;
      for (let j = 0; j < 220 && i0 + j < len; j++) d[i0 + j] += (Math.random() * 2 - 1) * g * Math.exp(-j / 50);
    }
  }
  return b;
}

export function ctx() {
  if (E.ctx) return E.ctx;
  let a;
  try { a = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }); } catch { return null; }
  E.ctx = a;
  E.limiter = a.createDynamicsCompressor();
  E.limiter.threshold.value = -4; E.limiter.knee.value = 8; E.limiter.ratio.value = 6; E.limiter.attack.value = 0.001; E.limiter.release.value = 0.15; // [sound] 늘 눌리던 리미터를 큰 순간만 잡게
  E.master = a.createGain();
  E.master.connect(E.limiter).connect(a.destination);
  E.verb = a.createConvolver(); E.verb.buffer = mkIR(a);
  const verbOut = a.createGain(); verbOut.gain.value = 0.9;
  E.verb.connect(verbOut).connect(E.master);
  for (const g of ['sfx', 'crowd', 'cast']) {
    const dry = a.createGain(), wet = a.createGain();
    dry.connect(E.master); wet.connect(E.verb);
    E.groups[g] = { dry, wet };
  }
  E.noise = mkNoise(a, 2.5, 'white'); E.pink = mkNoise(a, 3, 'pink'); E.brown = mkNoise(a, 3, 'brown');
  applyVols();
  return a;
}

// 크롬·사파리: 사용자 입력(클릭/키) 전에는 소리가 막혀 있다 → 첫 입력에서 resume + 무음 1샘플 재생
let unlockInstalled = false;
export function installUnlock() {
  if (unlockInstalled || typeof window === 'undefined') return;
  unlockInstalled = true;
  const evs = ['pointerdown', 'keydown', 'touchend', 'mousedown'];
  const go = () => {
    const a = ctx(); if (!a) return;
    if (a.state === 'suspended') a.resume().catch(() => { });
    try { const s = a.createBufferSource(); s.buffer = a.createBuffer(1, 1, a.sampleRate); s.connect(a.destination); s.start(); } catch { }
    if (a.state === 'running' || a.state === 'suspended') {
      if (!E.unlocked) { E.unlocked = true; for (const f of E.onReady.splice(0)) try { f(a); } catch (e) { console.error('[audio]', e); } }
    }
    if (a.state === 'running') for (const e of evs) removeEventListener(e, go, true);
  };
  for (const e of evs) addEventListener(e, go, true);
  // 탭을 다시 열면 맥 크롬이 컨텍스트를 멈춰 둘 때가 있음
  document.addEventListener('visibilitychange', () => { if (!document.hidden && E.ctx && E.ctx.state === 'suspended') E.ctx.resume().catch(() => { }); });
}
export function whenReady(fn) { if (E.unlocked && E.ctx) fn(E.ctx); else E.onReady.push(fn); }
export const ready = () => !!(E.ctx && E.unlocked && E.ctx.state === 'running');

// ── 청취자 위치: main.js 가 window.__camera 를 노출하므로 그걸 읽는다(없으면 홈 플레이트 뒤) ──
export function listener() {
  const c = typeof window !== 'undefined' && window.__camera;
  if (c && c.position && c.matrixWorld) {
    const m = c.matrixWorld.elements;
    return { x: c.position.x, y: c.position.y, z: c.position.z, rx: m[0], rz: m[2] };
  }
  return { x: 0, y: 2, z: -6, rx: -1, rz: 0 };
}
// 월드 좌표 → 거리(m)·좌우(-1~1)
export function place(x, z, y = 1) {
  if (x == null || z == null) return { dist: 0, pan: 0 };
  const L = listener();
  const dx = x - L.x, dy = y - L.y, dz = z - L.z, d = Math.hypot(dx, dy, dz) || 1;
  const rl = Math.hypot(L.rx, L.rz) || 1;
  const pan = Math.max(-1, Math.min(1, ((dx * L.rx + dz * L.rz) / rl) / Math.max(d, 4)));
  return { dist: d, pan: pan * 0.85 };
}

// ── 발음(voice): 소리 하나 = 입력 노드 하나. 거리감(감쇠·고역 감소·음속 지연·잔향 비율)과 패닝을 붙여 준다 ──
const active = [];
const lastAt = new Map();
export const stats = { voices: 0, dropped: 0, peak: 0 };
/**
 * @param {object} o group('sfx'|'crowd'|'cast'), prio(0~9 높을수록 중요), dur(초), gain, pan(-1~1), dist(m),
 *                   wet(잔향 기본 비율), key+gap(같은 소리 최소 간격), delay(초)
 * @returns {{in: AudioNode, t: number, a: AudioContext} | null}
 */
export function voice(o = {}) {
  const a = E.ctx; if (!a || a.state !== 'running') return null;
  const now = a.currentTime;
  if (o.key && o.gap) { const l = lastAt.get(o.key); if (l != null && now - l < o.gap) return null; lastAt.set(o.key, now); }
  for (let i = active.length - 1; i >= 0; i--) if (active[i].end < now) active.splice(i, 1);
  const prio = o.prio ?? 5;
  if (active.length >= MAX_VOICES) {
    let w = -1;
    for (let i = 0; i < active.length; i++) if (active[i].prio <= prio && (w < 0 || active[i].prio < active[w].prio || (active[i].prio === active[w].prio && active[i].t0 < active[w].t0))) w = i;
    if (w < 0) { stats.dropped++; return null; }
    const v = active[w]; active.splice(w, 1);
    try { v.out.gain.setTargetAtTime(0, now, 0.015); setTimeout(() => v.free(), 120); } catch { }
  }
  const G = E.groups[o.group || 'sfx'];
  const dist = Math.max(0, o.dist || 0);
  const delay = Math.min(0.45, dist / 343) + (o.delay || 0); // 외야 포구 소리는 실제처럼 늦게 들림
  const t = now + delay + 0.004;
  const att = 1 / (1 + Math.max(0, dist - 6) / 22);
  const inp = a.createGain(); inp.gain.value = (o.gain ?? 1);
  const out = a.createGain(); out.gain.value = att;
  let node = inp;
  const nodes = [inp, out]; // [qa] 끝나면 전부 끊음 — 전엔 out 만 끊어서 패너·잔향 게인이 그룹 버스에 계속 연결된 채 남았음(Chrome 은 출력 연결이 있는 노드를 안 치움 → 소리마다 노드 누적)
  if (dist > 18) { const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.max(1400, 16000 / (1 + (dist - 18) / 22)); lp.Q.value = 0.5; node.connect(lp); node = lp; nodes.push(lp); }
  node.connect(out);
  let fin = out;
  if (o.pan && a.createStereoPanner) { const p = a.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, o.pan)); out.connect(p); fin = p; nodes.push(p); }
  const wetAmt = Math.min(0.95, (o.wet ?? 0.18) + dist / 220);
  fin.connect(G.dry);
  if (wetAmt > 0.01) { const w = a.createGain(); w.gain.value = wetAmt; fin.connect(w).connect(G.wet); nodes.push(w); }
  const dur = o.dur ?? 1;
  let freed = false;
  const free = () => { if (freed) return; freed = true; for (const n of nodes) try { n.disconnect(); } catch { } };
  const rec = { t0: now, end: t + dur, prio, out, free };
  active.push(rec);
  stats.voices = active.length; stats.peak = Math.max(stats.peak, active.length);
  setTimeout(free, (delay + dur + 1.5) * 1000);
  return { in: inp, t, a };
}

// ── 합성 재료 ──
// 노이즈 한 방: 필터 + 엔벨로프(빠른 어택, 지수 감쇠). f2 를 주면 필터가 미끄러짐
export function nz(v, { buf = 'white', t = 0, dur = 0.1, type = 'bandpass', f = 1000, f2 = 0, q = 1, gain = 1, att = 0.002, rate = 1, hold = 0 } = {}) {
  if (!v) return;
  const a = v.a, b = buf === 'pink' ? E.pink : buf === 'brown' ? E.brown : E.noise;
  const s = a.createBufferSource(); s.buffer = b; s.playbackRate.value = rate;
  const fl = a.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
  const g = a.createGain();
  const t0 = v.t + t;
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gain, t0 + att);
  if (hold) g.gain.setValueAtTime(gain, t0 + att + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + att + hold + dur);
  if (f2) fl.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + att + hold + dur);
  s.connect(fl).connect(g).connect(v.in);
  const off = Math.random() * Math.max(0, b.duration - dur - hold - 0.1);
  s.start(t0, off); s.stop(t0 + att + hold + dur + 0.05);
  s.onended = () => { try { s.disconnect(); fl.disconnect(); g.disconnect(); } catch { } }; // [perf] 끝나면 끊음 — 소리마다 노드가 쌓여 오래 하면 렉
}
// 오실레이터 한 방 (sine/triangle/square/sawtooth), f2 로 피치 미끄러짐
export function osc(v, { type = 'sine', f = 440, f2 = 0, t = 0, dur = 0.2, gain = 0.3, att = 0.003, hold = 0, detune = 0 } = {}) {
  if (!v) return;
  const a = v.a, o = a.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = detune;
  const g = a.createGain(), t0 = v.t + t;
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gain, t0 + att);
  if (hold) g.gain.setValueAtTime(gain, t0 + att + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + att + hold + dur);
  if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(10, f2), t0 + att + hold + dur);
  o.connect(g).connect(v.in); o.start(t0); o.stop(t0 + att + hold + dur + 0.05);
  o.onended = () => { try { o.disconnect(); g.disconnect(); } catch { } }; // [perf]
}
// 나무 배트 공명: 감쇠하는 사인 부분음 묶음
export function modal(v, parts, t = 0) { for (const [f, dur, gain] of parts) osc(v, { f, dur, gain, t, att: 0.0008 }); }
// 샘플 재생
export function buf(v, b, { t = 0, rate = 1, gain = 1, dur = 0, lp = 0 } = {}) {
  if (!v || !b) return;
  const a = v.a, s = a.createBufferSource(); s.buffer = b; s.playbackRate.value = rate;
  const g = a.createGain(); g.gain.value = gain;
  let n = s;
  if (lp) { const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; n.connect(f); n = f; }
  n.connect(g).connect(v.in);
  s.start(v.t + t);
  s.onended = () => { try { s.disconnect(); if (n !== s) n.disconnect(); g.disconnect(); } catch { } }; // [perf]
  if (dur) { g.gain.setValueAtTime(gain, v.t + t + Math.max(0, dur - 0.08)); g.gain.linearRampToValueAtTime(0, v.t + t + dur); s.stop(v.t + t + dur + 0.02); }
}
