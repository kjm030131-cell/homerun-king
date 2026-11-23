// director.js — [motion] 게임 이벤트(bus) → '지금 어떤 상황인가' 기록. ClipAnimator 가 매 프레임 읽어 상황별 모션을 고른다.
// · 구독만 한다(REBUILD 4-1). 게임 상태·판정은 건드리지 않음.
// · 시각은 클라 시계(performance.now) — 이벤트가 핑만큼 늦게 와도 '받은 순간부터 몇 초' 로만 쓰므로 문제없음.
//   (투구 모션처럼 정확한 시각이 필요한 것은 기존대로 main.js 가 sim 시각으로 넘겨 주는 tau·swingK 를 쓴다)
// · 매 프레임 할당 없음: 이벤트가 올 때 고정 객체의 값만 바꿈.
import { bus } from '../core/bus.js';

export const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
const NEVER = -1e9;

export const D = {
  windup: { at: NEVER, pid: null, runners: 0 }, // 투구 시작(주자 수: 세트 포지션 투구 고를 때)
  sw: { pid: null, at: NEVER, mode: '', dt: 0, contact: null, grade: '', why: '' }, // 마지막 스윙(로컬 즉시 + 서버)
  strike: { at: NEVER, k: 0, swinging: 0, looking: 0 }, // 스트라이크 판정(심판 콜)
  kOut: { at: NEVER, looking: 0, outs: 0 }, // 삼진 아웃
  out3: { at: NEVER }, // 이닝 끝내는 아웃
  hr: { at: NEVER, walkoff: 0 },
  end: { at: NEVER, win: null, walkoff: 0 }, // 경기 끝
  walkoff: { at: NEVER },
  catchC: { at: NEVER, fly: 0 }, // 포수가 타구(뜬공)를 잡음
  ballCall: { at: NEVER, walk: 0 },
};

function onSwingInfo(d, local) {
  const S = D.sw;
  if (S.pid !== d.pid || (local && S.at < now() - 3)) { S.pid = d.pid; S.at = now(); S.contact = null; S.grade = ''; S.why = ''; S.dt = 0; }
  if (d.mode) S.mode = d.mode;
  if (Number.isFinite(d.dt)) S.dt = d.dt;
  if (local && d.contact != null) { S.contact = !!d.contact; if (d.contact) S.grade = d.q > 0.82 ? 'perfect' : d.q > 0.55 ? 'good' : d.q > 0.3 ? 'ok' : 'weak'; }
}
bus.on('windup', (d) => { D.windup.at = now(); D.windup.pid = d.pid; D.windup.runners = Array.isArray(d.on) ? d.on.reduce((a, b) => a + (b ? 1 : 0), 0) : 0; });
bus.on('localSwing', (d) => onSwingInfo(d, true));
bus.on('swing', (d) => onSwingInfo(d, false));
bus.on('contact', (d) => { onSwingInfo(d, false); D.sw.contact = true; D.sw.grade = d.grade || D.sw.grade; });
bus.on('miss', (d) => { onSwingInfo(d, false); D.sw.contact = false; D.sw.why = d.why || ''; });
bus.on('strikeCall', (d) => { const S = D.strike; S.at = now(); S.k = d.k ? 1 : 0; S.swinging = d.swinging ? 1 : 0; S.looking = d.looking ? 1 : 0; });
bus.on('ballCall', (d) => { D.ballCall.at = now(); D.ballCall.walk = d.walk ? 1 : 0; });
bus.on('out', (d) => {
  if (d.kind === 'k') { D.kOut.at = now(); D.kOut.looking = d.looking ? 1 : 0; D.kOut.outs = d.outs | 0; }
  if ((d.outs | 0) >= 3) D.out3.at = now();
});
bus.on('hr', (d) => { D.hr.at = now(); D.hr.walkoff = d.walkoff ? 1 : 0; if (d.walkoff) D.walkoff.at = now(); });
bus.on('score', (d) => { if (d.walkoff) D.walkoff.at = now(); });
bus.on('catch', (d) => { if (!d.pitch && d.pos === 'C') { D.catchC.at = now(); D.catchC.fly = d.fly ? 1 : 0; } });
bus.on('gameEnd', (d) => { D.end.at = now(); D.end.win = d.win || null; D.end.walkoff = d.walkoff ? 1 : 0; });
bus.on('modeChange', (d) => { if (d.start) reset(); });

export function reset() {
  for (const k in D) { const o = D[k]; if (o && 'at' in o) o.at = NEVER; }
  D.end.win = null; D.sw.pid = null;
}
// 이벤트 뒤 지난 초 (없으면 아주 큼)
export const since = (o) => now() - o.at;

// 팀 분위기: 'win' | 'lose' | null — 경기 끝(60초) · 끝내기(14초)
export function mood(team) {
  if (!team || team === 'ump') return null;
  if (since(D.end) < 60 && D.end.win) return team === D.end.win ? 'win' : 'lose';
  if (since(D.walkoff) < 14) return team === 'home' ? 'win' : 'lose'; // 끝내기는 항상 홈팀(말 공격)
  return null;
}
// 시드 → 0~1 (선수·타석·투구마다 다르지만 같은 입력이면 같은 값 — 멀티에서 화면마다 같은 동작)
export function rnd(seed, k = 0) { const x = Math.sin((seed + 1) * 9301 + k * 49297 + 0.5) * 233280; return x - Math.floor(x); }
export function hash(str) { let h = 7; const s = String(str ?? ''); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
