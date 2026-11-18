// audio/index.js — 사운드 매니저. bus 이벤트(REBUILD.md 4-1)를 듣고 소리를 낸다. 게임 상태는 절대 바꾸지 않는다.
// main.js 에서 initAudio() 한 번만 부르면 끝. 다른 파트는 sfx 를 직접 부르지 말고 bus.emit 만 한다.
//
// 기준은 서버 이벤트(sim → 스냅샷 ev → bus, 필드는 docs/rebuild/events.md).
// 화면 시각에 맞춰야 하는 소리만 클라 신호(cue:*)·localSwing 으로 내고, 같은 순간의 서버 이벤트는 걸러서 한 번만 낸다.
//   localSwing{pid,mode,contact,q}  내 스윙 즉시 타격음/헛스윙 → 같은 pid 의 서버 contact 는 관중 반응만
//   cue:mitt{pid,kmh}               화면에서 공이 미트에 닿는 순간 → 1.5초 안 서버 catch{pitch:1} 무시
//   cue:swing{pid,power}            화면 스윙 순간 바람소리 (서버 swing/miss 는 소리 안 냄)
//   cue:release{pid}                타자용 '온다' 신호음 (서버 release 는 소리 안 냄)
//   cue:slide{rid,x,z}              화면 슬라이딩 시작 (서버 slide 는 위치가 없어 소리 안 냄)
//   cue:bounce{x,z,impact,surf}     클라 공 물리의 바운드 (서버엔 없음)
// UI 보조: ui:click  ui:perfect  ui:tick{p}  ui:walkup{me}  ui:screen{screen}  ui:msg{text,s}(배너 → 캐스터)
// 내보내는 이벤트: caster:line{text,pri}  (자막은 UI 가 그린다)
import { bus } from '../core/bus.js';
import { ctx, installUnlock, whenReady, setVol, getVol, VOL_KEYS, E, stats } from './engine.js';
import { loadSamples, sampleInfo, SLOTS } from './samples.js';
import * as S from './synth.js';
import { Crowd } from './crowd.js';
import { Caster, situation } from './caster.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const now = () => performance.now() / 1000;

export const crowd = new Crowd();
let caster = null, rules = 'real', inited = false;
const seenContact = new Map(); // pid → 처리 시각 (내 스윙 즉시 소리 + 나중에 서버 정보 도착해도 두 번 안 냄)
const game = { inn: 1, innings: 9, mode: 'game' }; // windup 에 없는 상황(이닝·모드)은 다른 이벤트에서 모아 둠
let lastMitt = -9, lastGameEnd = 0, lastHr = 0, lastSitu = null;
const UMP_OUT = new Set(['force', 'tag', 'pick', 'cs']); // 누심이 소리 내 외치는 아웃 (뜬공·삼진은 제외)

// 타구 기대치(0~1): 관중이 얼마나 들썩일지. 타구 속도·발사각이 있으면 그걸로, 없으면 q 로
export function expectOf(d) {
  if (d.bunt || d.mode === 'bunt' || d.grade === 'bunt') return 0.05;
  const q = clamp(d.q ?? 0.5, 0, 1);
  // 서버 타구 속도가 아직 없으면 보수적으로(q 로만) — 실제 값이 오면 다시 맞춘다
  let e = d.ev ? clamp((d.ev - 110) / 60, 0, 1) * 0.7 + q * 0.3 : clamp((q - 0.3) / 0.6, 0, 1) ** 1.3 * (d.mode === 'power' ? 1.1 : 0.95);
  if (d.la != null) { if (d.la < 8) e *= 0.45; else if (d.la > 50) e *= 0.35; else if (d.la >= 20 && d.la <= 35) e = Math.min(1, e * 1.2); }
  if (d.foul) e *= 0.5;
  return clamp(e, 0, 1);
}

function on(type, fn) { bus.on(type, (d) => { if (!E.ctx || E.ctx.state !== 'running') return; fn(d || {}); }); }

export function initAudio() {
  if (inited) return; inited = true;
  installUnlock();
  loadSamples();
  whenReady(() => setTimeout(() => crowd.start(), 0));
  caster = new Caster((text, pri) => bus.emit('caster:line', { text, pri }), (k) => crowd.setDuck(k));

  // ── 투구 ──
  on('windup', (d) => { d = { ...d, inn: game.inn, innings: game.innings, mode: game.mode }; lastSitu = situation(d); crowd.prePitch(tension(lastSitu)); caster.situ(d); });
  on('cue:release', () => S.ui.cue());
  on('cue:swing', (d) => S.swing(d));
  on('cue:mitt', (d) => { lastMitt = now(); S.mitt(d.kmh || 140); });

  // ── 타격 ──
  // 내 스윙: 서버 응답(핑만큼 늦음) 전에 바로 타격음
  on('localSwing', (d) => {
    if (!d.contact) { S.whiff(); return; }
    if (d.pid != null) seenContact.set(d.pid, now());
    const kind = S.bat(d, { casual: rules === 'casual' });
    if (kind !== 'tip' && kind !== 'bunt') crowd.rise(expectOf(d));
  });
  on('contact', (d) => {
    const t = now();
    for (const [k, at] of seenContact) if (t - at > 10) seenContact.delete(k);
    if (d.pid != null && seenContact.has(d.pid)) { // 이미 소리 냄 → 실제 타구 속도·각도로 관중 반응만 다듬기
      if (!d.foul && d.grade !== 'bunt') { const e = expectOf(d), p = crowd.pending(); if (Math.abs(e - p) > 0.15) crowd.rise(e); }
      return;
    }
    if (d.pid != null) seenContact.set(d.pid, t);
    const kind = S.bat(d, { casual: rules === 'casual' });
    if (kind !== 'tip' && kind !== 'bunt') crowd.rise(expectOf(d));
  });
  on('foul', (d) => { if (d.kind === 'tip') return; const e = crowd.pending(); if (e > 0.4) crowd.ooh(e); else crowd.settle(0.8); });

  // ── 판정 ──
  on('strikeCall', (d) => {
    if (d.k) { S.ump('strike3', { big: true }); crowd.cheer(0.32, 1.6); }
    else if (d.looking) S.ump('strike', {});
    afterPitch(d);
  });
  on('ballCall', (d) => { if (d.hbp) crowd.ooh(0.35); else if (d.walk) crowd.applause(0.3, 1.5); afterPitch(d); });
  on('out', (d) => {
    if (UMP_OUT.has(d.kind)) S.ump('out', d);
    if (d.kind === 'k') return; // 삼진은 strikeCall 에서
    const pend = crowd.pending();
    if ((d.dp || 0) >= 2) crowd.cheer(0.6, 2.6);
    else if (d.kind === 'cs' || d.kind === 'pick') crowd.cheer(0.5, 2);
    else if (pend > 0.45) crowd.groan(pend);
    else if (pend > 0) crowd.settle(1);
  });
  on('safe', (d) => {
    if (d.close || d.steal || d.pick) S.ump('safe', d);
    if (d.steal) crowd.cheer(0.35, 1.4);
  });
  on('hit', (d) => { const a = d.bunt ? 0.4 : ({ 1: 0.42, 2: 0.6, 3: 0.72 }[d.bases]); if (a) crowd.cheer(a, 1.6 + a * 1.6); });
  on('error', () => crowd.groan(0.45));
  on('tag', (d) => S.glove(d));

  // ── 수비 ──
  on('catch', (d) => {
    if (d.pitch) { if (now() - lastMitt > 1.5) S.mitt(d.kmh || 140); return; } // 화면 신호(cue:mitt)가 이미 냈으면 건너뜀
    S.glove(d);
    if (d.robbed) crowd.cheer(1.0, 4);
    else if (d.fly && (d.dive || d.jump)) crowd.cheer(0.75, 2.6);
  });
  on('throw', (d) => S.throwWhoosh({ x: d.from && d.from[0], z: d.from && d.from[1], p: d.pw }));
  on('cue:slide', (d) => S.slide(d));
  on('dive', (d) => S.dive(d));
  on('cue:bounce', (d) => S.bounce(d));
  on('wall', (d) => { S.wall(d); if (crowd.pending() > 0.4) crowd.ooh(0.6); });
  on('steal', () => crowd.rise(0.3));
  on('wildPitch', () => crowd.ooh(0.35));

  // ── 큰 장면 ──
  on('hr', (d) => {
    const t = now(); if (t - lastHr < 3) return; lastHr = t;
    crowd.explode(!!d.walkoff);
    S.music.charge();
    for (let i = 0; i < 6; i++) S.firework(0.9 + i * 0.35);
  });
  on('score', (d) => {
    if (now() - lastHr < 4) return; // 홈런 득점은 이미 터짐
    if (d.walkoff) { crowd.explode(true); S.music.walkup(); return; }
    crowd.cheer(d.go || d.tie ? 0.75 : 0.55, 2.4);
  });
  on('inningEnd', () => crowd.applause(0.35, 2.5));
  bus.on('inningStart', (d) => { if (d && d.inning) game.inn = d.inning; });
  bus.on('modeChange', (d) => { if (d && d.mode) game.mode = d.mode; if (d && d.innings) game.innings = d.innings; });
  on('inningStart', () => { if (Math.random() < (rules === 'casual' ? 0.8 : 0.4)) S.music.inning(); });
  on('gameEnd', () => { const t = now(); if (t - lastGameEnd < 4) return; lastGameEnd = t; crowd.cheer(0.7, 4); crowd.applause(0.8, 5); });
  on('modeChange', (d) => { if (d.rules) { rules = d.rules === 'casual' ? 'casual' : 'real'; crowd.setProfile(rules); } });

  // ── UI ──
  on('ui:click', () => S.ui.click());
  on('ui:perfect', () => S.ui.perfect());
  on('ui:tick', (d) => S.ui.tick(d.p));
  on('ui:walkup', (d) => { if (d.me) S.music.walkup(); });
  bus.on('ui:screen', (d) => { const g = d && (d.screen === 'game' || d.screen === 'over'); crowd.setScene(!!g); if (!g && caster) caster.stop(); });
  bus.on('ui:msg', (d) => { if (caster && d) caster.msg(d.text, d.s); }); // 자막은 소리가 막혀 있어도 나오게
  window.__audio = { E, stats, sampleInfo, crowd, SLOTS, expectOf, rules: () => rules };
}

// 투구 사이: 접전이면 응원 박수
function afterPitch(d) {
  const v = lastSitu ? { ...lastSitu, balls: d.b ?? lastSitu.balls, strikes: d.s ?? lastSitu.strikes } : situation(d);
  v.twoK = v.strikes === 2; v.full = v.balls === 3 && v.strikes === 2;
  const t = tension(v);
  if (t > 0.55) setTimeout(() => crowd.chant(), 900);
}
// 긴장도 0~1
export function tension(v) {
  let t = 0.15;
  if (v.twoK) t += 0.15;
  if (v.balls === 3) t += 0.1;
  if (v.risp) t += 0.2;
  if (v.loaded) t += 0.1;
  if (v.outs === 2 && v.runners) t += 0.15;
  if (v.late && v.close) t += 0.2;
  return clamp(t, 0, 1);
}

// ── 볼륨 (기존 main.js 설정 화면의 'vol' 슬라이더 = 마스터) ──
export { setVol, getVol, VOL_KEYS };
export function setVolume(v01) { setVol('master', v01 * 100); }
export function unlock() { const a = ctx(); if (a && a.state === 'suspended') a.resume().catch(() => { }); return a; }

// 설정 화면에 효과음·관중·캐스터 음량 슬라이더가 없으면 붙인다(ui 파트가 정식으로 만들면 그 id 를 그대로 씀)
export function mountVolumeUI(doc = document) {
  const master = doc.getElementById('vol'); if (!master) return;
  const ids = { sfx: ['volSfx', '효과음'], crowd: ['volCrowd', '관중'], cast: ['volCast', '캐스터 음성'] };
  const lbl = master.parentElement && master.parentElement.querySelector('label');
  if (lbl && lbl.textContent.trim() === '음량') lbl.textContent = '전체 음량';
  let after = master.parentElement;
  for (const k in ids) {
    const [id, name] = ids[k];
    let el = doc.getElementById(id);
    if (!el && after) {
      const wrap = doc.createElement('div');
      wrap.innerHTML = `<label class="lbl" for="${id}">${name}</label><input id="${id}" type="range" min="0" max="100" style="width:100%">`;
      after.after(wrap); after = wrap; el = doc.getElementById(id);
    }
    if (!el) continue;
    el.value = getVol(k);
    el.addEventListener('input', () => setVol(k, +el.value));
  }
  master.addEventListener('focus', () => { master.value = getVol('master'); });
}
