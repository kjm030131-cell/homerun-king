// timing.js — 투구(와인드업) 시간표: 게임 시각 ↔ 클립 시각 맞추기
// · 서버 sim 의 WINDUP(1.85s) 안에서 단계별 시각(PITCH_TL)을 클립 안의 같은 이름 마커(markers)에 맞춰 구간마다 속도를 바꿔 재생한다.
//   → 사람 타자가 보는 '다리 들기 → 정점 멈춤 → 스트라이드 → 릴리스'가 sim 이 공을 놓는 순간과 정확히 겹친다.
// · 단계 시각은 gameplay 파트가 docs/rebuild/events.md 에 확정 → 여기 PITCH_TL 을 같이 바꾸거나,
//   'windup' 이벤트 데이터에 phases 를 실어 보내면 자동 반영(setPitchTimeline).
import { bus } from '../core/bus.js';

// 와인드업 시작부터 초. 지금 값 = client/anim.js pitchK() 와 같은 시간표(세트 0.35 → 레그킥 0.9 → 정점 0.2 → 스트라이드 0.4)
export const PITCH_TL = { set: 0, lift: 0.35, peak: 1.25, hold: 1.45, release: 1.85 };
export const PITCH_ORDER = ['set', 'lift', 'peak', 'hold', 'release'];

export function setPitchTimeline(tl) {
  if (!tl) return;
  for (const k of PITCH_ORDER) if (Number.isFinite(tl[k])) PITCH_TL[k] = tl[k];
}

// 구간 선형 보간: xs(증가) → ys. 범위 밖은 끝 기울기 1(자연 속도)로 이어 감
export function piecewise(x, xs, ys) {
  const n = xs.length;
  if (n === 0) return x;
  if (x <= xs[0]) return ys[0] + (x - xs[0]);
  for (let i = 0; i < n - 1; i++) {
    if (x <= xs[i + 1]) { const d = xs[i + 1] - xs[i]; return d > 1e-6 ? ys[i] + (ys[i + 1] - ys[i]) * (x - xs[i]) / d : ys[i + 1]; }
  }
  return ys[n - 1] + (x - xs[n - 1]);
}

// 투구: 와인드업 시작부터 tau 초 → 클립 시각. markers: { set, lift, peak, hold?, release, end }
// hold 마커가 없으면 정점에서 멈춤(peak = hold). 릴리스 뒤로는 자연 속도(팔로스루).
export function pitchClipTime(tau, m, tl = PITCH_TL) {
  const xs = [], ys = [];
  for (const k of PITCH_ORDER) {
    const y = k === 'hold' ? (m.hold ?? m.peak) : m[k];
    if (!Number.isFinite(y) || !Number.isFinite(tl[k])) continue;
    if (xs.length && (tl[k] < xs[xs.length - 1] || y < ys[ys.length - 1])) continue; // 순서 어긋난 마커는 버림
    xs.push(tl[k]); ys.push(y);
  }
  const t = piecewise(Math.max(0, tau), xs, ys);
  return Math.min(Math.max(t, 0), m.end ?? t);
}

// 진행도 k → 클립 시각 (kmap: [[k, 마커이름], ...])
export function kClipTime(k, kmap, m) {
  const xs = [], ys = [];
  for (const [kk, name] of kmap) { const y = m[name]; if (Number.isFinite(y) && (!ys.length || y >= ys[ys.length - 1])) { xs.push(kk); ys.push(y); } }
  if (xs.length < 2) return Math.max(0, k) * (m.end ?? 1);
  // 마지막 마커 뒤는 마지막 구간 속도로 이어 감
  const n = xs.length;
  let t;
  if (k >= xs[n - 1]) { const s = (ys[n - 1] - ys[n - 2]) / Math.max(1e-6, xs[n - 1] - xs[n - 2]); t = ys[n - 1] + (k - xs[n - 1]) * s; }
  else t = piecewise(k, xs, ys);
  return Math.min(Math.max(t, 0), m.end ?? t);
}

// 옛 main.js 는 투구 진행을 pitchK(tau) 로만 준다 → tau 로 되돌림(평평한 구간은 그 구간 시작으로)
// client/anim.js pitchK 와 짝. 그쪽을 바꾸면 여기도 같이.
export function tauFromPitchK(k) {
  if (k < 0) return -1;
  if (k <= 0) return 0.35;
  if (k < 0.36) { const s = k / 0.36; let u = s; for (let i = 0; i < 8; i++) { const f = u * u * (3 - 2 * u) - s, d = 6 * u * (1 - u); if (d < 1e-6) break; u = Math.min(1, Math.max(0, u - f / d)); } return 0.35 + u * 0.9; }
  if (k === 0.36) return 1.25;
  if (k < 0.656) return 1.45 + 0.4 * Math.pow((k - 0.36) / (0.656 - 0.36), 1 / 1.35);
  return 1.85 + (k - 0.656) * 1.6;
}

// 이벤트 구독(docs/rebuild/events.md 확정): windup { at, pid, set:0.35, kick:1.25, peak:1.45, dur:1.85, rel } — at 기준 초
//  events.md 이름 ↔ 여기 이름: set(세트 끝)=lift, kick(레그킥 끝)=peak, peak(정점 멈춤 끝)=hold, dur(릴리스)=release
export const windupClock = { at: -1, pid: null, data: null };
export function onWindup(d) {
  if (!d) return;
  windupClock.at = Number.isFinite(d.at) ? d.at : -1; windupClock.pid = d.pid ?? null; windupClock.data = d;
  setPitchTimeline({ lift: d.set, peak: d.kick, hold: d.peak, release: d.dur });
}
bus.on('windup', onWindup);
