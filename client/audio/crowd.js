// audio/crowd.js — 관중: 계속 깔리는 층(웅성임·함성·탄식·박수) + 상황별 반응.
// 층은 루프로 계속 돌고 음량만 자동화한다(소리마다 새로 만들지 않음 → 가볍다).
// 관중 소리는 전부 '멀리 있는' 소리: 고역을 살짝 깎고 잔향을 많이 섞는다.
import { E, voice, nz, osc, buf } from './engine.js';
import { sample, hasSample, onSample } from './samples.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);

// 리얼: 메이저리그 중계처럼 투구 땐 조용, 큰 순간에 터짐 / 캐주얼: KBO식으로 늘 시끌벅적, 응원 박수·오르간 잦음
export const PROFILES = {
  real: { bed: 0.16, hush: 0.45, react: 1.0, chantP: 0.25, buzz: 0.6, casual: false },
  casual: { bed: 0.22, hush: 0.15, react: 1.3, chantP: 0.7, buzz: 1.0, casual: true },
};

// ── 오프라인 생성 버퍼 ──
// 웅성임: '말하는 사람' 여러 명(공명 필터 + 음절 리듬 엔벨로프)을 섞어서 만든 스테레오 루프
// [net] 첫 소리 켤 때 한 번에 합성하느라 메인 스레드가 멈췄음(이 서버 기준 웅성임 50ms + 박수 85ms, 할당 ~90MB) →
//       샘플마다 Math.random·Math.exp·나머지 연산 대신 미리 만든 백색잡음 표를 순서대로 읽고 감쇠는 곱셈으로: 웅성임 ~30ms, 박수 ~25ms (소리 성격은 같음)
function mkBabble(a, sec = 5, talkers = 8) {
  const sr = a.sampleRate, n = (sr * sec) | 0, b = a.createBuffer(2, n, sr);
  const W = E.noise.getChannelData(0), wn = W.length; // 들뜸 신호는 이미 만든 백색잡음을 재사용(빠름)
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let k = 0; k < talkers; k++) {
      const f = rnd(350, 1300), r = Math.exp(-Math.PI * (f * 0.35) / sr), c = 2 * r * Math.cos(2 * Math.PI * f / sr), r2 = r * r, g0 = 1 - r;
      // 루프 이음매가 안 튀게 음절 리듬은 sec 주기의 정수배로 맞춤
      const syl = Math.round(rnd(3, 6.5) * sec) / sec, phr = Math.max(1, Math.round(rnd(0.15, 0.4) * sec)) / sec;
      const ph = Math.random() * 6.28, php = Math.random() * 6.28, amp = rnd(0.4, 1) * 0.9;
      let p = (Math.random() * wn) | 0, y1 = 0, y2 = 0, e = 0;
      for (let i = 0; i < n; i++) {
        if ((i & 31) === 0) { const t = i / sr, sv = Math.sin(2 * Math.PI * syl * t + ph); e = (sv > 0 ? sv * sv : 0) * (0.5 + 0.5 * Math.sin(2 * Math.PI * phr * t + php)) * amp; }
        const y = W[p] * g0 + c * y1 - r2 * y2; y2 = y1; y1 = y;
        d[i] += y * e; if (++p === wn) p = 0;
      }
    }
    // 바탕 쉬쉬 소리
    let q = (ch * 977) % wn;
    for (let i = 0; i < n; i++) { d[i] = d[i] * 0.5 + W[q] * 0.02; q += 7; if (q >= wn) q -= wn; }
  }
  return b;
}
// 박수: 짧은 손뼉 펄스를 촘촘히
function mkApplause(a, sec = 4, rate = 520) {
  const sr = a.sampleRate, n = (sr * sec) | 0, b = a.createBuffer(2, n, sr);
  const W = E.noise.getChannelData(0), wn = W.length;
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch), m = (rate * sec) | 0;
    let o = (Math.random() * wn) | 0;
    for (let k = 0; k < m; k++) {
      const i0 = (Math.random() * (n - 400)) | 0, len = (rnd(0.002, 0.006) * sr) | 0, L = len * 3, c = rnd(0.3, 0.7), dk = Math.exp(-1 / len);
      let lp = 0, env = rnd(0.15, 1) * 0.5;
      if (o + 2 * L >= wn) o = (Math.random() * (wn - 2 * L - 1)) | 0;
      for (let j = 0; j < L; j++) { lp += (W[o + j] - lp) * c; d[i0 + j] += (lp - W[o + L + j] * 0.2) * env; env *= dk; }
      o += 2 * L;
    }
  }
  return b;
}

export class Crowd {
  constructor() { this.on = false; this.prof = PROFILES.real; this.L = null; this.inGame = false; this.riseT = 0; this.chantT = 0; this.expect = 0; this.riseAt = 0; this.duck = 1; }
  setProfile(k) { this.prof = PROFILES[k] || PROFILES.real; this.base(0.8); }
  // 첫 입력(오디오 해제) 뒤 한 번 만든다
  start() {
    const a = E.ctx; if (!a || this.L) return;
    const out = a.createGain(); out.gain.value = 1;
    const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000; lp.Q.value = 0.4;
    const wet = a.createGain(); wet.gain.value = 0.45;
    out.connect(lp).connect(E.groups.crowd.dry); out.connect(wet).connect(E.groups.crowd.wet);
    this.out = out;
    const babble = mkBabble(a), appl = mkApplause(a);
    const layer = (srcBuf, rate, filt, pan = 0) => {
      const g = a.createGain(); g.gain.value = 0;
      const s = a.createBufferSource(); s.buffer = srcBuf; s.loop = true; s.playbackRate.value = rate;
      let n = s;
      for (const [type, f, q] of filt) { const bq = a.createBiquadFilter(); bq.type = type; bq.frequency.value = f; bq.Q.value = q; n.connect(bq); n = bq; }
      if (pan && a.createStereoPanner) { const p = a.createStereoPanner(); p.pan.value = pan; n.connect(p); n = p; }
      n.connect(g).connect(out);
      s.start(a.currentTime + 0.02, Math.random() * srcBuf.duration);
      return { g, s, f: n };
    };
    // 바탕 웅성임 = 핑크노이즈(좌·우 따로) + 말소리
    const bedN1 = layer(E.pink, 1, [['bandpass', 900, 0.5]], -0.7), bedN2 = layer(E.pink, 0.97, [['bandpass', 1000, 0.5]], 0.7);
    const bedB = layer(babble, 1, [['highpass', 180, 0.7]]);
    // 함성 = 밝은 노이즈 + 빠르게 돌린 말소리(높은 '우와')
    const roarN = layer(E.noise, 1, [['bandpass', 1700, 0.7], ['lowpass', 5000, 0.5]]), roarB = layer(babble, 1.3, [['bandpass', 1500, 0.6]]);
    // 탄식·'오~' = 좁은 대역 핑크노이즈 2개 (주파수를 움직여 모음처럼)
    const gr1 = layer(E.pink, 1, [['bandpass', 600, 3]]), gr2 = layer(babble, 0.75, [['bandpass', 450, 1.5]]);
    const ap = layer(appl, 1, [['highpass', 700, 0.5]]);
    this.L = {
      bed: { parts: [[bedN1, 0.5], [bedN2, 0.5], [bedB, 1]], v: 0 },
      roar: { parts: [[roarN, 0.55], [roarB, 1]], v: 0 },
      groan: { parts: [[gr1, 0.9], [gr2, 1]], v: 0, flt: [gr1.f, gr2.f] },
      appl: { parts: [[ap, 1]], v: 0 },
    };
    // 루프 샘플이 들어오면 합성 층을 그걸로 교체
    const swap = (name, key) => {
      const b = sample(name); if (!b || !this.L) return;
      const Lr = this.L[key]; for (const [p] of Lr.parts) try { p.s.stop(); } catch { }
      const sp = layer(b, 1, [['highpass', 60, 0.5]]); Lr.parts = [[sp, 1]]; this.set(key, Lr.v, 0.3);
    };
    const map = { crowd_bed: 'bed', crowd_roar: 'roar', crowd_applause: 'appl' };
    for (const k in map) if (hasSample(k)) swap(k, map[k]);
    onSample((name) => { if (map[name]) swap(name, map[name]); });
    this.on = true;
    this.base(1.5);
  }
  // 층 음량 목표치 (tc: 시간상수 초)
  set(key, val, tc = 0.3, at = 0) {
    const Lr = this.L && this.L[key]; if (!Lr) return;
    const a = E.ctx, t = a.currentTime + at;
    Lr.v = val;
    for (const [p, w] of Lr.parts) { const g = p.g.gain; if (!at) { g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); } g.setTargetAtTime(val * w * this.duck, t, tc); }
  }
  // 부풀었다 가라앉기
  env(key, peak, att, hold, rel, after = null) {
    if (!this.L) return;
    this.set(key, peak, att / 3);
    this.set(key, after ?? this.rest(key), rel / 3, att + hold);
  }
  rest(key) {
    if (!this.inGame) return key === 'bed' ? 0.05 : 0;
    return key === 'bed' ? this.prof.bed : key === 'roar' ? this.prof.bed * 0.15 * this.prof.buzz : 0;
  }
  base(tc = 0.8) { if (!this.L) return; for (const k of ['bed', 'roar', 'groan', 'appl']) this.set(k, this.rest(k), tc); }
  setScene(inGame) { if (this.inGame === inGame) return; this.inGame = inGame; this.stopChant(); this.base(1.2); }
  // 캐스터 말할 때 살짝 줄이기
  setDuck(k) { this.duck = k; if (this.L) for (const key in this.L) this.set(key, this.L[key].v, 0.25); }
  // 한 번 재생(원샷 샘플). 없으면 false
  shot(name, gain = 1) {
    if (!hasSample(name)) return false;
    const v = voice({ group: 'crowd', prio: 6, dur: 8, wet: 0.45, gain });
    buf(v, sample(name), { rate: rnd(0.97, 1.03) }); return !!v;
  }

  // ═════ 상황별 반응 ═════
  // 투구 직전: t(긴장 0~1) 만큼 숨죽이기 + 기대감 웅성
  prePitch(t) {
    if (!this.on || !this.inGame) return;
    this.stopChant();
    const P = this.prof;
    this.set('bed', P.bed * (1 - P.hush * (0.5 + 0.5 * t)), 0.5);
    this.set('roar', P.bed * (0.1 + 0.35 * t) * P.buzz, 0.7);
    this.set('appl', t > 0.55 ? 0.05 * t : 0, 0.5);
  }
  // 타구 순간: expect(0~1 큰 타구일수록) 만큼 함성이 차오름. 결과가 안 오면 3.5초 뒤 저절로 가라앉음
  rise(expect) {
    if (!this.on) return;
    const R = this.prof.react;
    this.expect = expect; this.riseAt = E.ctx.currentTime;
    this.set('bed', this.prof.bed * (1 + expect * 0.8), 0.25);
    this.set('roar', clamp((0.12 + 0.7 * expect * expect) * R, 0, 1), 0.25 + 0.45 * expect);
    clearTimeout(this.riseT);
    this.riseT = setTimeout(() => this.settle(1.2), 3500 + expect * 1500);
  }
  settle(tc = 1) { clearTimeout(this.riseT); this.expect = 0; this.base(tc); }
  pending() { return this.expect > 0 && E.ctx && E.ctx.currentTime - this.riseAt < 8 ? this.expect : 0; }
  // 홈런: 폭발
  explode(walkoff = false) {
    if (!this.on) return;
    clearTimeout(this.riseT); this.expect = 0;
    const R = this.prof.react;
    this.shot('crowd_hr', 1);
    this.env('roar', clamp(1.0 * R, 0, 1.2), 0.15, walkoff ? 6 : 3.5, 4);
    this.env('bed', this.prof.bed * 2.2, 0.2, walkoff ? 6 : 3.5, 3);
    this.env('appl', 0.8 * R, 0.6, walkoff ? 6 : 4, 3);
    this.whistles(walkoff ? 8 : 5);
  }
  // 안타·득점·호수비: 환호 (a 세기, dur 길이)
  cheer(a = 0.5, dur = 2) {
    if (!this.on) return;
    clearTimeout(this.riseT); this.expect = 0;
    const R = this.prof.react;
    if (a > 0.45) this.shot('crowd_cheer', a);
    this.env('roar', clamp(a * 0.9 * R, 0, 1.1), 0.12, dur * 0.35, dur * 0.65);
    this.env('appl', a * 0.6 * R, 0.3, dur * 0.5, dur);
    this.env('bed', this.prof.bed * (1 + a), 0.2, dur * 0.4, dur);
    if (a > 0.6) this.whistles(2);
  }
  // 아쉬운 아웃·실책: '아~' 탄식 (함성이 확 꺼지고 낮은 모음이 내려감)
  groan(a = 0.5) {
    if (!this.on) return;
    clearTimeout(this.riseT); this.expect = 0;
    this.set('roar', this.rest('roar'), 0.12);
    if (!this.shot('crowd_groan', a)) {
      const t = E.ctx.currentTime;
      for (const f of this.L.groan.flt) { f.frequency.cancelScheduledValues(t); f.frequency.setValueAtTime(850, t); f.frequency.exponentialRampToValueAtTime(380, t + 1.4); }
      this.env('groan', a * 0.9 * this.prof.react, 0.12, 0.5, 1.2);
    }
    this.env('appl', a * 0.25, 1.0, 0.8, 1.2); // 탄식 뒤 박수 조금 (잘 잡았다)
    this.set('bed', this.rest('bed'), 0.6);
  }
  // 아깝게 빗나간 큰 파울: '오~'
  ooh(a = 0.5) {
    if (!this.on) return;
    clearTimeout(this.riseT); this.expect = 0;
    this.set('roar', this.rest('roar'), 0.3);
    if (!this.shot('crowd_ooh', a)) {
      const t = E.ctx.currentTime;
      for (const f of this.L.groan.flt) { f.frequency.cancelScheduledValues(t); f.frequency.setValueAtTime(420, t); f.frequency.linearRampToValueAtTime(820, t + 0.45); f.frequency.exponentialRampToValueAtTime(480, t + 1.3); }
      this.env('groan', a * 0.8 * this.prof.react, 0.2, 0.4, 0.9);
    }
    this.set('bed', this.rest('bed'), 0.5);
  }
  applause(a = 0.4, dur = 3) { if (this.on) this.env('appl', a * this.prof.react, 0.4, dur, 2); }
  whistles(n = 3) {
    for (let i = 0; i < n; i++) {
      const v = voice({ group: 'crowd', prio: 2, dur: 1, wet: 0.5, dist: rnd(40, 90), pan: rnd(-0.8, 0.8), delay: rnd(0.1, 2.2), gain: 0.5 });
      const f = rnd(1900, 2900);
      osc(v, { f, f2: f * rnd(1.05, 1.25), dur: rnd(0.25, 0.5), hold: 0.15, gain: 0.05, att: 0.04 });
    }
  }
  // 접전 응원: "짝짝 짝짝짝" 박수 + 북 — 다음 투구(windup) 때 멈춤
  chant(force = false) {
    if (!this.on || !this.inGame || (!force && Math.random() > this.prof.chantP)) return;
    this.stopChant();
    if (this.shot('crowd_chant', 0.9)) return;
    const pat = [0, 0.5, 1.25, 1.5, 1.75]; // 짝 짝 / 짝짝짝
    let bar = 0;
    const one = () => {
      if (!this.inGame || bar++ >= 3) return;
      const v = voice({ group: 'crowd', prio: 3, dur: 2.4, wet: 0.5, dist: 60, gain: 0.9 });
      if (v) for (const t of pat) {
        for (let k = 0; k < 6; k++) nz(v, { type: 'bandpass', f: rnd(1100, 2200), q: 0.8, dur: 0.03, t: t + rnd(0, 0.03), gain: 0.22 });
        osc(v, { f: 95, f2: 55, dur: 0.18, gain: 0.35, t });
      }
      this.chantT = setTimeout(one, 2100);
    };
    this.chantT = setTimeout(one, 600);
  }
  stopChant() { clearTimeout(this.chantT); this.chantT = 0; }
}
