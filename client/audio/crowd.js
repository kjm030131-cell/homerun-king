// audio/crowd.js — 관중: 계속 깔리는 층(웅성임·함성·탄식·박수) + 상황별 반응.
// 층은 루프로 계속 돌고 음량만 자동화한다(소리마다 새로 만들지 않음 → 가볍다).
// 관중 소리는 전부 '멀리 있는' 소리: 고역을 살짝 깎고 잔향을 많이 섞는다.
import { E, voice, nz, osc, buf } from './engine.js';
import { sample, hasSample, onSample } from './samples.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);

// 리얼: 메이저리그 중계처럼 투구 땐 조용, 큰 순간에 터짐 / 캐주얼: KBO식으로 늘 시끌벅적, 응원 박수·오르간 잦음
// [sound 11-23] 전체적으로 낮춤(시끄럽다는 피드백): 바탕 웅성임은 '들리는 듯 마는 듯', 반응만 또렷하게
export const PROFILES = {
  real: { bed: 0.22, hush: 0.45, react: 0.8, chantP: 0.25, buzz: 0.5, casual: false },
  casual: { bed: 0.3, hush: 0.15, react: 0.95, chantP: 0.6, buzz: 0.8, casual: true },
};

// ── [sound 11-23] 사람 목소리로 만든 관중 ──
// 예전: 잡음(쉬익)에 필터만 건 '바람 소리' → 관중 같지 않았음. 이제 성대 펄스(실제 목소리의 '음높이')를 포먼트(모음)로 걸러
// 여러 사람이 동시에 말하거나(웅성임) 소리 지르는(함성 '와아') 버퍼를 만든다. 남녀 음높이 섞음, 사람마다 떨림·모음이 다름.
const VOWELS = [[730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010], [570, 840, 2410], [300, 870, 2240], [660, 1720, 2410]]; // 아 에 이 오 우 애
async function mkVoices(a, { sec = 5, talkers = 16, f0lo = 100, f0hi = 240, sustain = false, syl = [3, 6], bright = 1 } = {}) {
  const sr = a.sampleRate, n = (sr * sec) | 0, b = a.createBuffer(2, n, sr);
  const W = E.noise.getChannelData(0), wn = W.length;
  const C1 = new Float64Array(3), C2 = new Float64Array(3), G = new Float64Array(3), Y1 = new Float64Array(3), Y2 = new Float64Array(3);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let k = 0; k < talkers / 2; k++) {
      const female = Math.random() < 0.4, base = female ? rnd(Math.max(f0lo, 170), f0hi) : rnd(f0lo, Math.min(f0hi, 165));
      const sylHz = Math.round(rnd(syl[0], syl[1]) * sec) / sec, phr = Math.max(1, Math.round(rnd(0.2, 0.5) * sec)) / sec; // 루프 이음매 맞춤
      const amp = rnd(0.35, 1), ph0 = Math.random();
      let gph = Math.random(), gPrev = 0, p = (Math.random() * wn) | 0, v0 = (Math.random() * 6) | 0, v1 = (Math.random() * 6) | 0, lastSyl = -1;
      let env = 0, f0 = base, jit = 0;
      Y1.fill(0); Y2.fill(0);
      for (let i = 0; i < n; i++) {
        if ((i & 63) === 0) { // 64샘플마다 모음·음높이·세기 갱신
          const t = i / sr, sp = sylHz * t + ph0, si = Math.floor(sp), frac = sp - si;
          if (si !== lastSyl) { lastSyl = si; v0 = v1; v1 = (Math.random() * 6) | 0; }
          const m = sustain ? 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, frac * 2.5)) : Math.min(1, frac * 3);
          for (let j = 0; j < 3; j++) {
            const F = VOWELS[v0][j] + (VOWELS[v1][j] - VOWELS[v0][j]) * m, r = Math.exp(-Math.PI * (60 + F * 0.08) / sr);
            C1[j] = 2 * r * Math.cos(2 * Math.PI * F / sr); C2[j] = r * r; G[j] = (1 - r) * (j === 0 ? 1.2 : j === 1 ? 0.8 : 0.4);
          }
          const sv = Math.sin(2 * Math.PI * (sylHz * t + ph0)), sw = 0.55 + 0.45 * Math.sin(2 * Math.PI * (phr * t + ph0));
          env = sustain ? amp * (0.65 + 0.35 * sw) : (sv > 0 ? sv : 0) * sw * amp;
          jit = jit * 0.9 + (Math.random() - 0.5) * 0.02;
          f0 = base * (1 + (sustain ? 0.05 : 0.12) * Math.sin(2 * Math.PI * (0.7 * t + ph0)) + jit); // 억양
        }
        gph += f0 / sr; if (gph >= 1) gph -= 1;
        const g = gph < 0.6 ? Math.sin(Math.PI * gph / 0.6) : 0; // 성대 펄스
        const src = (g - gPrev) * 6 + W[p] * 0.06 * bright; gPrev = g; if (++p === wn) p = 0; // 미분(입술 방사) + 숨소리
        let y = 0;
        for (let j = 0; j < 3; j++) { const o = src * G[j] + C1[j] * Y1[j] - C2[j] * Y2[j]; Y2[j] = Y1[j]; Y1[j] = o; y += o; }
        d[i] += y * env;
      }
      await new Promise((r) => setTimeout(r, 0)); // 한 사람 만들 때마다 양보 → 메인 스레드가 한 번에 오래 안 멈춤(사람당 수 ms)
    }
    // 멀리서 들리게: 저역통과 + 정규화
    let lp = 0, pk = 0; const kc = Math.exp(-2 * Math.PI * 3800 / sr);
    for (let i = 0; i < n; i++) { lp = lp * kc + d[i] * (1 - kc); d[i] = lp; if (Math.abs(lp) > pk) pk = Math.abs(lp); }
    const nm = 0.6 / (pk || 1); for (let i = 0; i < n; i++) d[i] *= nm;
  }
  return b;
}

// ── 오프라인 생성 버퍼 ──
// 웅성임: '말하는 사람' 여러 명(공명 필터 + 음절 리듬 엔벨로프)을 섞어서 만든 스테레오 루프
// [net] 첫 소리 켤 때 한 번에 합성하느라 메인 스레드가 멈췄음(이 서버 기준 웅성임 50ms + 박수 85ms, 할당 ~90MB) →
//       샘플마다 Math.random·Math.exp·나머지 연산 대신 미리 만든 백색잡음 표를 순서대로 읽고 감쇠는 곱셈으로: 웅성임 ~30ms, 박수 ~25ms (소리 성격은 같음)
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
  // 첫 입력(오디오 해제) 뒤 한 번 만든다. 목소리 버퍼는 조금씩 나눠 만들고(비동기) 다 되면 층을 붙인다
  async start() {
    const a = E.ctx; if (!a || this.L || this._building) return;
    this._building = true;
    const babble = await mkVoices(a, { sec: 4, talkers: 16, syl: [3, 6] });
    const roarV = await mkVoices(a, { sec: 3, talkers: 20, f0lo: 150, f0hi: 380, sustain: true, syl: [0.6, 1.5], bright: 1.4 }); // 두 겹을 다른 속도로 돌려 40명처럼
    const appl = mkApplause(a);
    const out = a.createGain(); out.gain.value = 1;
    const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000; lp.Q.value = 0.4;
    const wet = a.createGain(); wet.gain.value = 0.45;
    out.connect(lp).connect(E.groups.crowd.dry); out.connect(wet).connect(E.groups.crowd.wet);
    this.out = out;
    // [sound] 웅성임 = 말하는 목소리 24명 / 함성 = 소리 지르는 목소리 32명(높은 음, 모음 길게) / 박수
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
    // 바탕: 말소리 + 아주 작은 구장 울림(낮은 핑크노이즈) — 쉬익 소리는 없앰
    const bedHum = layer(E.pink, 1, [['lowpass', 500, 0.5]]);
    const bedB = layer(babble, 1, [['highpass', 160, 0.7]]), bedB2 = layer(babble, 0.93, [['highpass', 160, 0.7]], 0.4);
    // 함성: 목소리 함성 두 겹(조금 다른 속도로 돌려 두꺼운 '와아아')
    const roarA = layer(roarV, 1, [['highpass', 200, 0.6], ['lowpass', 4500, 0.5]], -0.3), roarB = layer(roarV, 1.06, [['highpass', 200, 0.6], ['lowpass', 4500, 0.5]], 0.3);
    // 탄식·'오~': 함성 목소리를 느리게(낮은 '아~') — 재생 속도를 내려 음이 떨어지게
    const gr1 = layer(roarV, 0.8, [['lowpass', 1800, 0.6]]), gr2 = layer(babble, 0.8, [['lowpass', 1400, 0.6]]);
    const ap = layer(appl, 1, [['highpass', 450, 0.5], ['lowpass', 7000, 0.5]]);
    this.L = {
      bed: { parts: [[bedHum, 0.25], [bedB, 1], [bedB2, 0.7]], v: 0 },
      roar: { parts: [[roarA, 1], [roarB, 0.8]], v: 0 },
      groan: { parts: [[gr1, 1], [gr2, 0.6]], v: 0, flt: [], src: [gr1.s, gr2.s] },
      appl: { parts: [[ap, 0.75], ], v: 0 },
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
      for (const sr of this.L.groan.src) { const r = sr.playbackRate; r.cancelScheduledValues(t); r.setValueAtTime(0.95, t); r.exponentialRampToValueAtTime(0.7, t + 1.4); } // '아~' 내려가는 탄식
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
      for (const sr of this.L.groan.src) { const r = sr.playbackRate; r.cancelScheduledValues(t); r.setValueAtTime(0.8, t); r.linearRampToValueAtTime(1.0, t + 0.45); r.exponentialRampToValueAtTime(0.78, t + 1.3); } // '오~' 올라갔다 내려감
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
