// [net] 내 조작 즉시 반응(클라 예측) — 화면 연출만 앞당긴다. 판정·위치·결과는 전부 서버 그대로(서버 권위).
// main.js 와 tools/qa/netclient.mjs(측정 모델)가 같이 쓴다.
//
// 전: 투구 클릭·송구 키·점프·다이빙을 누르면 서버까지 갔다 온 스냅샷(왕복 = 핑 + 스냅샷 대기 ~17ms)이 와야 동작이 시작됨
//     → 핑 120ms 면 누르고 0.14초 동안 투수·수비수가 가만히 있음(송구는 그동안 공이 이미 날아가는 화면도 생김).
// 후: 서버가 받아들일 조건(같은 조건을 클라에서 확인)이면 누른 순간 동작 시작.
//     투구는 서버 투구가 오면 릴리스 전(와인드업 1.2초 지점)까지 서버 시간표로 천천히 합류 → 릴리스·공은 서버 시각 그대로.
//     송구·점프·다이빙은 서버 이벤트가 와도 다시 시작하지 않음(내 화면 시작 시각 유지).
import { WINDUP, BASES, MOUND, COMMAND } from '../../shared/sim.js';

export const PRED = { PITCH_WAIT: 1.0, BLEND: 1.2, OFF_MAX: 0.6, HUMAN_DL: 15 };

// 투구 예측 시작. simT = 화면 서버 시계, rtt = 왕복(초).
// 서버는 투구 단계가 열린 뒤 COMMAND.ready 초 전 투구를 그때까지 미룸(퀵 피치 금지) → 그 시각(왕복만큼 앞당긴)보다 일찍 시작하지 않음.
// s.dl = 투구 제한까지 남은 시간(사람 투수는 단계 시작 + 15초).
export function pitchPred(s, simT, rtt) {
  let ps = simT;
  if (s.dl != null) ps = Math.max(simT, s.now + s.dl - PRED.HUMAN_DL + COMMAND.ready - rtt);
  return { ps, pid0: s.p ? s.p.id : null, off: null, es0: 0 };
}
// 내 화면 와인드업 경과 시간(pitchK 입력). null = 예측 없음(원래대로 서버 시간표), 음수 = 아직 시작 전.
export function windupTau(P, s, simT) {
  if (!P) return null;
  const p = s.p;
  if (p && p.id !== P.pid0 && s.ph !== 'pitch') {
    const es = simT - (p.t0 - WINDUP);
    if (P.off == null) { const o = (simT - P.ps) - es; P.off = o > 0 && o < PRED.OFF_MAX ? o : 0; P.es0 = Math.min(es, PRED.BLEND - 0.3); }
    if (!P.off || es >= PRED.BLEND) return es;
    return es + P.off * Math.max(0, (PRED.BLEND - es) / (PRED.BLEND - P.es0));
  }
  if (s.ph === 'pitch') { const e = simT - P.ps; return e < PRED.PITCH_WAIT ? e : null; }
  return null;
}

// 송구: 서버 onThrow 가 받아들이는지 (라이브, 내 선수가 공을 듦, 서 있는 베이스로 송구가 아님 — 잡자마자 0.2초 안은 서버가 예약했다 던짐)
export function throwOk(s, fi, base) {
  if (!s || s.ph !== 'live' || !s.b || s.b[6] !== fi || fi < 0) return false;
  if (base === 5) return true;
  const f = s.fl[fi], pt = base === 0 ? MOUND : BASES[base % 4];
  return !!f && Math.hypot(f[1] - pt[0], f[2] - pt[1]) >= 2.5;
}
// 점프: 서버 onJump (라이브, 지난 점프 0.9초·다이빙 1.2초 지남). 스냅샷 나이(fl[6]·fl[7], 3초 넘으면 -1)는 서버에 닿을 땐 더 커질 뿐이라 여기서 통과면 서버도 통과
export function jumpOk(s, fi, lastJ, tp) {
  const f = s && s.ph === 'live' && s.fl[fi];
  if (!f) return false;
  return (f[6] < 0 || f[6] > 0.9) && (f[7] < 0 || f[7] > 1.2) && tp - lastJ > 0.9;
}
// 다이빙: 서버 onDive (라이브, 지난 다이빙 1.4초, 공을 들고 있지 않음)
export function diveOk(s, fi, lastD, tp) {
  const f = s && s.ph === 'live' && s.fl[fi];
  if (!f || (s.b && s.b[6] === fi)) return false;
  return (f[7] < 0 || f[7] > 1.4) && tp - lastD > 1.4;
}
// 다이빙 몸 이동: 서버 sim.js 라이브 틱과 같게 (0.05~0.5초 동안 5.5m/s)
export function diveStep(age0, age1, dx, dz) {
  const a = Math.max(0.05, age0), b = Math.min(0.5, age1);
  return b > a ? [dx * 5.5 * (b - a), dz * 5.5 * (b - a)] : null;
}
