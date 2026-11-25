// audio/samples.js — 샘플 파일 슬롯. public/assets/sfx/<이름>.ogg|mp3 가 있으면 합성음 대신 그걸 쓴다.
// 같은 소리를 여러 개 넣으려면 <이름>_2.ogg, <이름>_3.ogg … (랜덤으로 돌아가며 재생)
// 파일 목록은 빌드(tools/build.mjs)가 public/assets/sfx/index.json 으로 만든다. 없으면 전부 합성음.
// 목록·길이·생성 프롬프트는 docs/rebuild/audio.md 와 같게 유지할 것.
import { whenReady } from './engine.js';

// [이름, 길이(초), 반복 여부]
export const SLOTS = [
  ['bat_barrel', 1.2], ['bat_solid', 0.8], ['bat_weak', 0.5], ['bat_jam', 0.5], ['bat_tip', 0.3], ['bat_bunt', 0.3],
  ['mitt_pop', 0.4], ['glove_catch', 0.3], ['throw_whoosh', 0.4], ['swing_whoosh', 0.4],
  ['ball_bounce_dirt', 0.25], ['ball_bounce_grass', 0.25], ['wall_hit', 0.6], ['slide_dirt', 0.9], ['dive_thud', 0.5],
  ['ump_strike', 0.8], ['ump_strike3', 1.2], ['ump_out', 0.8], ['ump_safe', 0.8],
  ['crowd_bed', 12, true], ['crowd_roar', 8, true], ['crowd_applause', 8, true],
  ['crowd_hr', 7], ['crowd_cheer', 3], ['crowd_groan', 2.5], ['crowd_ooh', 2], ['crowd_chant', 4],
  ['organ_walkup', 3], ['organ_charge', 3], ['organ_inning', 4], ['firework', 2.5],
  // [sound 11-25] UI: 실제 녹음 효과음(Kenney Interface Sounds, CC0 — public/assets/sfx/CREDITS.md). 없으면 합성음
  ['ui_select', 0.2], ['ui_back', 0.12], ['ui_hover', 0.06], ['ui_toggle', 0.25], ['ui_screen', 0.45], ['ui_perfect', 0.35], ['ui_tick', 0.12], ['ui_cue', 0.2],
];
const NAMES = new Set(SLOTS.map((s) => s[0]));
const bank = new Map(); // 이름 → AudioBuffer[]
let rr = 0;
export const sampleInfo = { listed: 0, loaded: 0, failed: 0 };

export function sample(name) {
  const l = bank.get(name); if (!l || !l.length) return null;
  return l.length === 1 ? l[0] : l[(rr++ + ((Math.random() * l.length) | 0)) % l.length];
}
export const hasSample = (name) => !!(bank.get(name) && bank.get(name).length);
const listeners = [];
export function onSample(fn) { listeners.push(fn); }

function canOgg() { try { return !!new Audio().canPlayType('audio/ogg; codecs="vorbis"'); } catch { return false; } }

export function loadSamples(base = './assets/sfx/') {
  if (typeof window === 'undefined' || window.HR_OFFLINE) return; // 혼자 연습판(단일 html)은 합성음만
  whenReady(async (a) => {
    let list;
    try { const r = await fetch(base + 'index.json', { cache: 'no-cache' }); if (!r.ok) return; list = await r.json(); } catch { return; }
    if (!Array.isArray(list)) return;
    // 같은 이름(변형 번호까지)에 ogg·mp3 둘 다 있으면 브라우저에 맞는 걸 하나만
    const ogg = canOgg(), pick = new Map();
    for (const f of list) {
      const m = /^([a-z0-9_]+?)(?:_(\d+))?\.(ogg|mp3|m4a|wav)$/i.exec(f); if (!m || !NAMES.has(m[1])) continue;
      const key = m[1] + '#' + (m[2] || '1'), ext = m[3].toLowerCase();
      const score = ext === 'ogg' ? (ogg ? 3 : -1) : ext === 'mp3' ? 2 : 1;
      if (score < 0) continue;
      if (!pick.has(key) || pick.get(key).score < score) pick.set(key, { f, name: m[1], score });
    }
    sampleInfo.listed = pick.size;
    await Promise.all([...pick.values()].map(async ({ f, name }) => {
      try {
        const ab = await (await fetch(base + f)).arrayBuffer();
        const b = await new Promise((res, rej) => { const p = a.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); });
        if (!bank.has(name)) bank.set(name, []);
        bank.get(name).push(b); sampleInfo.loaded++;
        for (const fn of listeners) try { fn(name, b); } catch { }
      } catch (e) { sampleInfo.failed++; console.warn('[audio] 샘플 읽기 실패', f, e && e.message); }
    }));
  });
}
