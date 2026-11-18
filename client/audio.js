// audio.js — WebAudio 합성 사운드 (외부 파일 없음)
let ctx = null, master = null, crowdGain = null, crowdSrc = null;
let volume = 0.8;
export function setVolume(v) { volume = v; if (master) master.gain.value = v; }
export function audio() {
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = volume; master.connect(ctx.destination);
    } catch { return null; }
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
function noiseBuf(dur, shape = 3) {
  const a = audio(); const n = Math.max(1, (a.sampleRate * dur) | 0);
  const b = a.createBuffer(1, n, a.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, shape);
  return b;
}
function play(buf, { type = 'bandpass', freq = 1000, q = 1, gain = 1, rate = 1, delay = 0 } = {}) {
  const a = audio(); if (!a) return;
  const s = a.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
  const f = a.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = a.createGain(); g.gain.value = gain;
  s.connect(f).connect(g).connect(master);
  s.start(a.currentTime + delay);
}
function tone(freq, dur, { type = 'sine', gain = 0.3, delay = 0, slide = 0 } = {}) {
  const a = audio(); if (!a) return;
  const o = a.createOscillator(); o.type = type; o.frequency.value = freq;
  const g = a.createGain();
  const t = a.currentTime + delay;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.05);
}
export const sfx = {
  // 타구음: q(0~1) 클수록 날카로운 "딱"
  crack(q = 1) {
    if (!audio()) return;
    const sharp = Math.max(0.15, q);
    // 1) 날카로운 접촉음(클릭) 2) 나무 공명 "따악" 3) 묵직한 몸통음 4) 구장 메아리
    play(noiseBuf(0.012, 2), { type: 'highpass', freq: 2500, gain: 0.9 * sharp });
    play(noiseBuf(0.06 + 0.07 * sharp, 5), { freq: 1100 + 1500 * sharp, q: 4 + 6 * sharp, gain: 1.0 + 1.2 * sharp, type: 'bandpass' });
    tone(620 + 380 * sharp, 0.09 + 0.06 * sharp, { type: 'triangle', gain: 0.22 * sharp, slide: 0.92 });
    if (q > 0.55) tone(95, 0.16, { type: 'sine', gain: 0.5 * q, slide: 0.55 });
    if (q > 0.7) play(noiseBuf(0.25, 3), { freq: 1400, q: 2, gain: 0.25 * q, type: 'bandpass', delay: 0.17 });
    if (q < 0.35) play(noiseBuf(0.12, 3), { freq: 500, q: 0.7, gain: 0.7, type: 'lowpass' });
  },
  swing(power = 1) { play(noiseBuf(0.24, 1.6), { type: 'bandpass', freq: 380 + 220 * power, q: 0.9, gain: 0.18 + 0.12 * power, rate: 0.9 }); },
  bunt() { play(noiseBuf(0.06, 4), { freq: 900, q: 1, gain: 0.7 }); },
  whiff() { play(noiseBuf(0.22, 1.5), { type: 'bandpass', freq: 700, q: 0.5, gain: 0.25 }); },
  mitt(strength = 1) { if (!audio()) return; play(noiseBuf(0.07, 5), { type: 'lowpass', freq: 900, gain: 0.9 * strength }); tone(95, 0.09, { gain: 0.35 * strength, slide: 0.6 }); },
  catch() { play(noiseBuf(0.05, 5), { type: 'lowpass', freq: 1200, gain: 0.45 }); },
  throwWhoosh() { play(noiseBuf(0.18, 2), { type: 'bandpass', freq: 1200, q: 0.6, gain: 0.22 }); },
  bounce(v = 1) { play(noiseBuf(0.04, 6), { type: 'lowpass', freq: 400, gain: Math.min(0.6, 0.12 * v) }); },
  wall() { play(noiseBuf(0.12, 3), { type: 'lowpass', freq: 300, gain: 0.8 }); },
  slide() { play(noiseBuf(0.45, 1.2), { type: 'bandpass', freq: 600, q: 0.4, gain: 0.35 }); },
  cheer(len = 3, gain = 0.4) {
    if (!audio()) return;
    const a = audio(); const n = a.sampleRate * len;
    const b = a.createBuffer(2, n, a.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) { const t = i / n; d[i] = (Math.random() * 2 - 1) * Math.min(1, t * 5) * Math.pow(1 - t, 1.3); } }
    play(b, { freq: 1000, q: 0.5, gain });
    play(b, { freq: 2600, q: 0.8, gain: gain * 0.4, rate: 1.02 });
  },
  groan() { play(noiseBuf(1.2, 1.5), { type: 'lowpass', freq: 380, gain: 0.35 }); },
  firework(delay = 0) { play(noiseBuf(0.5, 2), { type: 'lowpass', freq: 220, gain: 0.8, delay }); play(noiseBuf(0.9, 1.4), { type: 'highpass', freq: 3000, gain: 0.12, delay: delay + 0.05 }); },
  ui() { tone(880, 0.06, { type: 'triangle', gain: 0.12 }); },
  gaugeTick(p) { tone(300 + 500 * p, 0.03, { type: 'square', gain: 0.03 }); },
  perfect() { tone(1046, 0.12, { type: 'triangle', gain: 0.15 }); tone(1568, 0.18, { type: 'triangle', gain: 0.12, delay: 0.06 }); },
  ump(strike) { tone(strike ? 220 : 160, 0.25, { type: 'sawtooth', gain: 0.05, slide: 0.8 }); },
  // 응원 오르간 "빰빰빰빠밤"
  organ() { [523, 587, 659, 784, 659, 784].forEach((f, i) => tone(f, 0.18, { type: 'square', gain: 0.05, delay: i * 0.17 })); },
};
// 관중 환경음 (계속)
export function crowdAmbience(level) {
  if (!ctx) return;
  const a = audio(); if (!a) return;
  if (!crowdSrc) {
    const n = a.sampleRate * 4, b = a.createBuffer(2, n, a.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); let v = 0; for (let i = 0; i < n; i++) { v = v * 0.97 + (Math.random() * 2 - 1) * 0.03; d[i] = v * 6 + (Math.random() * 2 - 1) * 0.15; } }
    crowdSrc = a.createBufferSource(); crowdSrc.buffer = b; crowdSrc.loop = true;
    const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 0.4;
    crowdGain = a.createGain(); crowdGain.gain.value = 0;
    crowdSrc.connect(f).connect(crowdGain).connect(master); crowdSrc.start();
  }
  crowdGain.gain.setTargetAtTime(level, a.currentTime, 0.4);
}
