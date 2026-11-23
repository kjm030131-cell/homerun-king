// audio/synth.js — 효과음 레시피. 샘플 슬롯에 파일이 있으면 그걸, 없으면 합성음.
// 모든 함수는 (데이터) → 소리. 위치(x,z)를 주면 거리감·좌우가 붙는다.
import { voice, nz, osc, modal, buf, place, duck, E } from './engine.js';
import { sample } from './samples.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);

// 샘플이 있으면 재생하고 true
function trySample(v, name, o) { const b = sample(name); if (!b || !v) return false; buf(v, b, o); return true; }

// ═════════════ 타격음 ═════════════
// 타구 속도(km/h)가 아직 없으면(내 스윙은 서버 응답 전에 소리를 냄) 질 q 로 추정 — sim.js 타구 속도 식과 같은 꼴
export function estEV(q, mode = 'contact', kmh = 145) {
  const pow = mode === 'power' ? 1.08 : 0.98;
  return clamp(((31.5 + 20.2 * q) * pow + 0.1 * (kmh / 3.6 - 35)) * 3.6, 60, 190);
}
// 종류: barrel(홈런성 정타) / solid(정타) / weak(빗맞음) / jam(먹힘) / tip(파울팁) / bunt
const GRADE = { tip: 'tip', bunt: 'bunt', weak: 'jam', ok: 'weak', good: 'solid', perfect: 'barrel' };
export function batKind(q, ev, o = {}) {
  if (o.bunt || o.grade === 'bunt') return 'bunt';
  if (o.grade && GRADE[o.grade]) return o.grade === 'good' && ev >= 168 && q >= 0.65 ? 'barrel' : GRADE[o.grade];
  if (q < 0.12 || (o.foul && q < 0.25)) return 'tip';
  if (q < 0.3) return 'jam';
  if (q < 0.55) return 'weak';
  if (q >= 0.85 || (ev >= 168 && q >= 0.65)) return 'barrel';
  return 'solid';
}
// ── [sound 11-23] 나무 배트 타격음을 파형으로 미리 만들어 둔다 (예전: 사인파 몇 개 → 장난감 같은 '띵') ──
// 실제 나무 배트 '딱': ① 1~2ms 넓은 대역 충격(공-배트 접촉) ② 1.2~5kHz 대역 나무 부분음이 20~60ms 안에 급히 꺼짐
// ③ 공이 찌그러졌다 펴지는 저음 '퍽'(80~140Hz, 30~50ms) ④ 배트 휨 진동(150~200Hz, 정타일수록 짧고 먹히면 길게 '징')
// 마지막에 tanh 로 살짝 포화시켜 귀에 꽂히는 압(타격감)을 만든다. 종류마다 변형 3개를 돌려 써서 매번 똑같지 않게.
const BAT = {
  //        충격 대역(Hz)  충격ms  부분음 [주파수, 감쇠ms, 세기]                                         퍽(Hz,ms,세기)   휨(Hz,ms,세기)   포화
  barrel: { hp: 1400, imp: 1.6, modes: [[2150, 26, 1.0], [3050, 16, 0.7], [1380, 38, 0.75], [4600, 9, 0.45], [820, 55, 0.45], [5900, 6, 0.3]], thump: [105, 42, 0.9], bend: [178, 70, 0.22], drive: 2.6, gain: 1.0 },
  solid: { hp: 1200, imp: 1.4, modes: [[1950, 24, 1.0], [2850, 15, 0.6], [1250, 34, 0.7], [4200, 8, 0.35], [760, 48, 0.4]], thump: [110, 38, 0.75], bend: [172, 80, 0.25], drive: 2.2, gain: 0.85 },
  weak: { hp: 800, imp: 1.2, modes: [[1150, 22, 0.9], [1750, 14, 0.5], [620, 30, 0.6], [2600, 8, 0.25]], thump: [120, 40, 0.8], bend: [160, 110, 0.35], drive: 1.8, gain: 0.7 },
  jam: { hp: 400, imp: 1.0, modes: [[520, 26, 0.8], [880, 16, 0.45], [1350, 9, 0.25]], thump: [95, 55, 1.0], bend: [140, 260, 0.6], drive: 1.6, gain: 0.7 },
  tip: { hp: 2500, imp: 0.7, modes: [[3300, 8, 0.6], [4600, 5, 0.35]], thump: [0, 0, 0], bend: [0, 0, 0], drive: 1.2, gain: 0.45 },
  bunt: { hp: 900, imp: 0.9, modes: [[1050, 14, 0.7], [1700, 9, 0.35]], thump: [140, 30, 0.6], bend: [0, 0, 0], drive: 1.3, gain: 0.5 },
};
const batBank = new Map();
function mkBat(a, k) {
  const P = BAT[k], sr = a.sampleRate, len = (sr * 0.32) | 0, b = a.createBuffer(1, len, sr), d = b.getChannelData(0);
  const W = E.noise.getChannelData(0); let o = (Math.random() * (W.length - len)) | 0;
  // ① 충격: 하이패스한 잡음 펄스 + 단일 샘플 클릭
  const impN = (P.imp / 1000 * sr) | 0, hc = Math.exp(-2 * Math.PI * P.hp / sr); let lp = 0;
  for (let i = 0; i < impN; i++) { const w = W[o + i]; lp = lp * hc + w * (1 - hc); const env = Math.exp(-i / (impN * 0.35)); d[i] += (w - lp) * env * 1.4; }
  d[0] += 0.9; d[1] -= 0.5;
  // ② 나무 부분음: 매번 ±3% 흔들고 위상 무작위
  for (const [f0, ms, g] of P.modes) {
    const f = f0 * (0.97 + Math.random() * 0.06), w = 2 * Math.PI * f / sr, dk = Math.exp(-1 / (ms / 1000 * sr)), ph = Math.random() * 6.28;
    let e = g; for (let i = 0; i < len && e > 1e-4; i++) { d[i] += Math.sin(w * i + ph) * e; e *= dk; }
  }
  // ③ 공 찌그러짐 '퍽' (빠르게 피치가 내려가는 저음)
  if (P.thump[0]) { const [f, ms, g] = P.thump, n = (ms / 1000 * sr * 3) | 0; let ph = 0;
    for (let i = 0; i < n && i < len; i++) { const t = i / sr, ff = f * (1.6 - 0.6 * Math.min(1, t / (ms / 1000))); ph += 2 * Math.PI * ff / sr; d[i] += Math.sin(ph) * g * Math.exp(-t / (ms / 1000)) * Math.min(1, i / (sr * 0.0015)); } }
  // ④ 배트 휨 진동 (먹힌 타구는 길게 '징')
  if (P.bend[0]) { const [f, ms, g] = P.bend, w = 2 * Math.PI * f / sr, dk = Math.exp(-1 / (ms / 1000 * sr)); let e = g;
    for (let i = 0; i < len && e > 1e-4; i++) { d[i] += Math.sin(w * i) * e * Math.min(1, i / (sr * 0.004)); e *= dk; } }
  // 짧은 나무 '사각' 질감(대역 잡음 꼬리)
  let bp1 = 0, bp2 = 0; const fc = P.modes[0][0], r = Math.exp(-Math.PI * fc * 0.6 / sr), c = 2 * r * Math.cos(2 * Math.PI * fc / sr);
  for (let i = 0; i < (sr * 0.05) | 0; i++) { const y = W[o + 4000 + i] * (1 - r) + c * bp1 - r * r * bp2; bp2 = bp1; bp1 = y; d[i] += y * 0.9 * Math.exp(-i / (sr * 0.012)); }
  // 포화 + 정규화
  let pk = 0; for (let i = 0; i < len; i++) { d[i] = Math.tanh(d[i] * P.drive); pk = Math.max(pk, Math.abs(d[i])); }
  const nrm = 0.95 / (pk || 1); for (let i = 0; i < len; i++) d[i] *= nrm;
  return b;
}
function batBuf(a, k) {
  let l = batBank.get(k); if (!l) { l = [0, 1, 2].map(() => mkBat(a, k)); batBank.set(k, l); }
  return l[(Math.random() * l.length) | 0];
}
export function warmBat(a) { if (!E.noise) return; for (const k in BAT) batBuf(a, k); } // 오디오 켤 때 미리 (첫 타격 끊김 방지)

/** @param d {q, ev?, la?, mode?, bunt?, foul?, kmh?} @param prof 리얼/캐주얼 톤 */
export function bat(d, prof = {}) {
  const q = clamp(d.q ?? 0.6, 0, 1), mode = d.mode || 'contact';
  const ev = d.ev || estEV(q, mode, d.kmh);
  const kind = batKind(q, ev, { bunt: d.bunt || mode === 'bunt', foul: d.foul, grade: d.grade });
  const b = clamp((ev - 90) / 90, 0, 1) * 0.6 + q * 0.4; // 밝기·세기
  const pl = place(0, 0.3, 1);
  const big = kind === 'barrel';
  const v = voice({ prio: 9, dur: big ? 1.6 : 0.9, pan: pl.pan * 0.3, dist: pl.dist * 0.25, wet: big ? 0.26 : 0.16, gain: 1 });
  if (!v) return kind;
  if (kind !== 'tip' && kind !== 'bunt') duck('crowd', big ? 0.35 : 0.55, big ? 0.5 : 0.3);
  if (trySample(v, 'bat_' + kind, { rate: 0.97 + Math.random() * 0.06 + (b - 0.5) * 0.06, gain: 0.65 + 0.55 * b })) { echo(kind, b, true); return kind; }
  // 세게 맞을수록 살짝 높고 크게 (rate 0.96~1.06)
  buf(v, batBuf(v.a, kind), { rate: 0.96 + 0.1 * b + (Math.random() - 0.5) * 0.03, gain: BAT[kind].gain * (0.75 + 0.35 * b) });
  if (big) { osc(v, { f: 58, f2: 38, dur: 0.22, gain: 0.35 }); if (prof.casual) osc(v, { type: 'triangle', f: 1320, dur: 0.25, gain: 0.05, t: 0.01 }); } // 홈런성: 가슴 울리는 저음
  echo(kind, b, false, v.a);
  return kind;
}
// 관중석에서 되돌아오는 메아리 (정타일수록 크고 두 번)
function echo(kind, b, smp, a) {
  if (kind !== 'barrel' && kind !== 'solid') return;
  const n = kind === 'barrel' ? 2 : 1;
  for (let i = 0; i < n; i++) {
    // 관중석·외야 담장에서 0.2~0.45초 뒤 돌아오는 '딱' (구장 크기 체감의 핵심)
    const v = voice({ prio: 3, dur: 0.5, dist: 75 + i * 45, wet: 0.6, pan: i ? -0.55 : 0.5, delay: 0.02, gain: (kind === 'barrel' ? 0.42 : 0.24) * (i ? 0.55 : 1) * (0.6 + 0.4 * b) });
    if (!v) return;
    if (smp && trySample(v, 'bat_' + kind, { gain: 0.6, lp: 2500, dur: 0.3 })) continue;
    buf(v, batBuf(v.a, kind), { gain: 0.7, lp: 2600 - i * 600 });
  }
}

// ═════════════ 포구·송구·스윙·주루 ═════════════
export function mitt(kmh = 140) {
  const s = clamp((kmh - 100) / 55, 0, 1), pl = place(0, -0.6, 0.8);
  const v = voice({ prio: 8, dur: 0.5, pan: pl.pan * 0.4, dist: pl.dist * 0.3, wet: 0.24, key: 'mitt', gap: 0.08 });
  if (trySample(v, 'mitt_pop', { rate: 0.94 + 0.1 * s + Math.random() * 0.04, gain: 0.55 + 0.5 * s })) return;
  nz(v, { type: 'highpass', f: 2000, dur: 0.008, gain: 0.3 + 0.5 * s });   // 가죽 스냅
  nz(v, { f: 1300, q: 1.2, dur: 0.035 + 0.015 * s, gain: 1.0 + 0.6 * s }); // '팡'
  osc(v, { f: 160, f2: 70, dur: 0.07, gain: 0.5 + 0.3 * s });              // 몸통 울림
  nz(v, { buf: 'brown', type: 'lowpass', f: 300, dur: 0.08, gain: 0.4 });
}
export function glove(d = {}) {
  const pl = place(d.x, d.z, 1.2);
  const v = voice({ prio: 6, dur: 0.4, pan: pl.pan, dist: pl.dist, wet: 0.2, key: 'glove', gap: 0.09 });
  if (trySample(v, 'glove_catch', { rate: rnd(0.95, 1.05), gain: 0.8 })) return;
  nz(v, { type: 'highpass', f: 2200, dur: 0.006, gain: 0.25 });
  nz(v, { f: 1100, q: 1, dur: 0.03, gain: 0.8 });
  osc(v, { f: 140, f2: 80, dur: 0.05, gain: 0.3 });
}
export function throwWhoosh(d = {}) {
  const p = clamp(d.p ?? 0.7, 0.2, 1), pl = place(d.x, d.z, 1.6);
  const v = voice({ prio: 4, dur: 0.5, pan: pl.pan, dist: pl.dist, wet: 0.15, gain: 0.5 + 0.5 * p });
  if (trySample(v, 'throw_whoosh', { rate: rnd(0.92, 1.08) })) return;
  nz(v, { type: 'highpass', f: 1800, dur: 0.01, gain: 0.12 });
  nz(v, { f: 700, f2: 1800, q: 0.8, att: 0.04, dur: 0.18 + 0.06 * p, gain: 0.32 });
}
export function swing(d = {}) {
  const pw = clamp(d.power ?? 0.8, 0.3, 1.2), pl = place(0, 0.5, 1.2);
  const v = voice({ prio: 6, dur: 0.45, pan: pl.pan * 0.4, dist: pl.dist * 0.3, wet: 0.08, gain: 0.55 + 0.35 * pw, key: 'swing', gap: 0.15 });
  if (trySample(v, 'swing_whoosh', { rate: 0.92 + 0.12 * pw })) return;
  nz(v, { buf: 'pink', f: 260, f2: 900, q: 0.9, att: 0.08, dur: 0.12, gain: 0.55 });
  nz(v, { f: 1200, f2: 500, q: 0.9, dur: 0.1, t: 0.1, gain: 0.2 });
}
export function whiff() {
  const v = voice({ prio: 5, dur: 0.4, wet: 0.08, key: 'whiff', gap: 0.2 });
  nz(v, { f: 900, f2: 380, q: 0.6, att: 0.05, dur: 0.25, gain: 0.22 });
}
export function bounce(d = {}) {
  const imp = clamp(d.impact ?? 3, 0, 12), pl = place(d.x, d.z, 0);
  const v = voice({ prio: 2, dur: 0.3, pan: pl.pan, dist: pl.dist, wet: 0.12, key: 'bounce', gap: 0.05, gain: clamp(0.1 * imp, 0.05, 0.75) });
  const dirt = d.surf === 'dirt';
  if (trySample(v, dirt ? 'ball_bounce_dirt' : 'ball_bounce_grass', { rate: rnd(0.9, 1.1) })) return;
  nz(v, { buf: 'brown', type: 'lowpass', f: dirt ? 450 : 260, dur: 0.06, gain: 1 });
  if (dirt) nz(v, { f: 2500, q: 1, dur: 0.03, gain: 0.25 });
}
export function wall(d = {}) {
  const pl = place(d.x, d.z, 1.5);
  const v = voice({ prio: 6, dur: 0.6, pan: pl.pan, dist: pl.dist * 0.5, wet: 0.3, key: 'wall', gap: 0.2 });
  if (trySample(v, 'wall_hit', {})) return;
  osc(v, { f: 85, f2: 50, dur: 0.18, gain: 0.6 });
  nz(v, { buf: 'brown', type: 'lowpass', f: 400, dur: 0.2, gain: 0.7 });
  for (let i = 0; i < 5; i++) nz(v, { f: 3200 + i * 300, q: 3, dur: 0.03, t: 0.02 + i * 0.04, gain: 0.1 });
}
export function slide(d = {}) {
  const pl = place(d.x, d.z, 0.3);
  const v = voice({ prio: 5, dur: 0.95, pan: pl.pan, dist: pl.dist, wet: 0.14, key: 'slide', gap: 0.3 });
  if (trySample(v, 'slide_dirt', { rate: rnd(0.95, 1.05) })) return;
  osc(v, { f: 90, f2: 55, dur: 0.12, gain: 0.4 });
  for (let i = 0; i < 16; i++) nz(v, { buf: 'brown', f: rnd(350, 900), q: 1.2, dur: 0.05, t: i * 0.034, gain: 0.25 * (1 - i / 16) + 0.08 });
  nz(v, { type: 'highpass', f: 3000, dur: 0.3, t: 0.1, gain: 0.06 });
}
export function dive(d = {}) {
  const pl = place(d.x, d.z, 0.3);
  const v = voice({ prio: 5, dur: 0.6, pan: pl.pan, dist: pl.dist, wet: 0.14, key: 'dive', gap: 0.3 });
  if (trySample(v, 'dive_thud', {})) return;
  osc(v, { f: 70, f2: 45, dur: 0.2, gain: 0.55 });
  nz(v, { buf: 'brown', type: 'lowpass', f: 500, dur: 0.18, gain: 0.6 });
  nz(v, { f: 2000, q: 0.7, dur: 0.25, gain: 0.1 });
}

// ═════════════ 심판 콜 (포먼트 합성 목소리 — 샘플 넣으면 그게 훨씬 낫다) ═════════════
const VOW = { a: [800, 1200, 2500], i: [300, 2300, 3000], e: [480, 1900, 2550], u: [330, 800, 2300], o: [500, 860, 2400], eo: [600, 1000, 2500] };
function vox(v, { t = 0, dur = 0.4, f0 = [[0, 180]], vw = [[0, 'a']], gain = 0.5 }) {
  const a = v.a, t0 = v.t + t;
  const src = a.createOscillator(); src.type = 'sawtooth';
  src.frequency.setValueAtTime(f0[0][1], t0);
  for (const [tt, f] of f0.slice(1)) src.frequency.linearRampToValueAtTime(f, t0 + tt);
  const vib = a.createOscillator(), vg = a.createGain(); vib.frequency.value = 6.5; vg.gain.value = 4; vib.connect(vg).connect(src.frequency);
  const env = a.createGain();
  env.gain.setValueAtTime(0, t0); env.gain.linearRampToValueAtTime(gain, t0 + 0.025);
  env.gain.setValueAtTime(gain, t0 + dur * 0.7); env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  [1, 0.55, 0.28].forEach((fg, k) => {
    const bp = a.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.setValueAtTime(VOW[vw[0][1]][k], t0);
    for (const [tt, w] of vw.slice(1)) bp.frequency.linearRampToValueAtTime(VOW[w][k], t0 + tt);
    bp.Q.value = VOW[vw[0][1]][k] / (70 + k * 40);
    const g = a.createGain(); g.gain.value = fg * 2.2;
    src.connect(bp).connect(g).connect(env);
  });
  env.connect(v.in);
  src.start(t0); vib.start(t0); src.stop(t0 + dur + 0.05); vib.stop(t0 + dur + 0.05);
}
// kind: strike / strike3 / out / safe   pos: 판정 위치(누심이면 베이스)
export function ump(kind, d = {}) {
  const pl = place(d.x ?? 0, d.z ?? -1, 1.7);
  const v = voice({ group: 'sfx', prio: 7, dur: 1.3, pan: pl.pan, dist: pl.dist * 0.6, wet: 0.3, key: 'ump', gap: 0.25, gain: d.big ? 1.1 : 0.9 });
  if (!v) return;
  duck('crowd', 0.6, 0.6);
  if (trySample(v, 'ump_' + kind, { rate: rnd(0.97, 1.03) })) return;
  const g = 0.32 * (d.big ? 1.2 : 1);
  if (kind === 'strike' || kind === 'strike3') {
    const L = kind === 'strike3' ? 1.5 : 1;
    nz(v, { type: 'highpass', f: 4500, dur: 0.06, gain: 0.12 });                       // ㅅ
    nz(v, { f: 3000, q: 1, dur: 0.01, t: 0.07, gain: 0.25 });                          // ㅌ
    vox(v, { t: 0.08, dur: 0.38 * L, f0: [[0, 190], [0.14 * L, 235], [0.36 * L, 145]], vw: [[0, 'eo'], [0.05, 'a'], [0.24 * L, 'a'], [0.34 * L, 'i']], gain: g });
    nz(v, { f: 2400, q: 1.2, dur: 0.02, t: 0.08 + 0.4 * L, gain: 0.22 });              // ㅋ
  } else if (kind === 'out') {
    vox(v, { dur: 0.36, f0: [[0, 230], [0.12, 245], [0.34, 160]], vw: [[0, 'a'], [0.18, 'a'], [0.3, 'u']], gain: g });
    nz(v, { f: 3000, q: 1, dur: 0.012, t: 0.37, gain: 0.25 });                          // ㅅ(받침)
  } else if (kind === 'safe') {
    nz(v, { type: 'highpass', f: 4500, dur: 0.07, gain: 0.12 });
    vox(v, { t: 0.07, dur: 0.3, f0: [[0, 205], [0.1, 220], [0.28, 165]], vw: [[0, 'e'], [0.16, 'e'], [0.26, 'i']], gain: g });
    nz(v, { type: 'highpass', f: 1800, dur: 0.12, t: 0.36, gain: 0.08 });               // ㅍ
  }
}

// ═════════════ 음악·연출 ═════════════
function organ(notes, step, gain = 0.05, t0 = 0) {
  const v = voice({ prio: 4, dur: notes.length * step + 0.6, wet: 0.5, dist: 50, gain: 1 });
  if (!v) return;
  notes.forEach((f, i) => {
    if (!f) return;
    const t = t0 + i * step, d = step * 0.92;
    osc(v, { type: 'square', f, dur: d, hold: d * 0.5, gain, t });
    osc(v, { type: 'sine', f: f * 2, dur: d, hold: d * 0.5, gain: gain * 0.9, t, detune: 4 });
    osc(v, { type: 'triangle', f: f / 2, dur: d, hold: d * 0.5, gain: gain * 0.8, t });
  });
}
export function organSample(name, fallback) {
  const v = voice({ prio: 4, dur: 5, wet: 0.45, dist: 50 });
  if (trySample(v, name, {})) return;
  fallback();
}
export const music = {
  walkup: () => organSample('organ_walkup', () => organ([523, 587, 659, 784, 659, 784], 0.17)),                       // 빰빰빰빠밤
  charge: () => organSample('organ_charge', () => organ([392, 523, 659, 784, 0, 659, 784, 784], 0.14, 0.055)),         // 차-지!
  inning: () => organSample('organ_inning', () => organ([523, 659, 784, 1046, 784, 659, 698, 880, 1046, 0, 988, 1046], 0.2, 0.04)),
};
export function firework(delay = 0) {
  const v = voice({ prio: 3, dur: 1.4, dist: 140, wet: 0.55, delay, pan: rnd(-0.5, 0.5) });
  if (!v) return;
  if (trySample(v, 'firework', { rate: rnd(0.9, 1.1) })) return;
  osc(v, { f: 70, f2: 32, dur: 0.7, gain: 0.8 });
  nz(v, { buf: 'brown', type: 'lowpass', f: 260, dur: 0.9, gain: 0.9 });
  for (let i = 0; i < 14; i++) nz(v, { type: 'highpass', f: 4000, dur: 0.015, t: rnd(0.15, 0.9), gain: 0.25 });
}
export const ui = {
  click() { osc(voice({ prio: 3, dur: 0.15, wet: 0, key: 'ui', gap: 0.04 }), { type: 'triangle', f: 880, dur: 0.06, gain: 0.12 }); },
  perfect() { const v = voice({ prio: 4, dur: 0.4, wet: 0.1, key: 'perfect', gap: 0.2 }); osc(v, { type: 'triangle', f: 1046, dur: 0.12, gain: 0.15 }); osc(v, { type: 'triangle', f: 1568, dur: 0.18, gain: 0.12, t: 0.06 }); },
  tick(p = 0.5) { osc(voice({ prio: 1, dur: 0.06, wet: 0, key: 'tick', gap: 0.03 }), { type: 'square', f: 300 + 500 * p, dur: 0.03, gain: 0.03 }); },
  cue() { osc(voice({ prio: 3, dur: 0.1, wet: 0, key: 'cue', gap: 0.3 }), { f: 1400, dur: 0.04, gain: 0.06 }); },
};
