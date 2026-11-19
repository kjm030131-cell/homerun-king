// [net] 멀티 화면 동기화: 서버 시계 추정 + 다른 선수 보간 버퍼 + 짧은 외삽.
// main.js 와 tools/qa/netbench.mjs(측정 도구)가 같은 코드를 쓴다 — 여기 숫자를 바꾸면 netbench 로 전후 비교할 것.
//
// 전(ad4c38e):
//  - 보간 지연 = 1/30 + 2.2 × (도착 간격 흔들림 EMA), 45~220ms. 흔들림 EMA 는 '간격 차이'라 늦게 온 스냅샷 하나가 앞뒤 두 번 세지고,
//    한두 번 튄 손실(TCP 재전송 100~300ms)에도 지연이 몇 초 동안 크게 늘었다 천천히 줄어듦 → 버퍼링 느낌.
//  - 버퍼가 바닥나면(보간 시각 > 마지막 스냅샷) 마지막 위치에 그대로 멈춤 → 다음 스냅샷이 오면 한꺼번에 이동(끊김).
//    타구 중 앞으로 당기기(최대 1.5m)도 멈춘 동안은 빠져서 1.5m 뒤로 튀었다 다시 앞으로.
// 후:
//  - 스냅샷마다 '늦음' L = (도착 시각 + 시계 차) − 서버 시각 을 재고, 최근 4초 L 의 90% 분위 + 스냅샷 간격 + 8ms 를 지연 목표로
//    (98%면 1% 손실 때 TCP 재전송으로 뒤 스냅샷 9개가 줄줄이 늦는 걸 다 덮으려고 지연이 200ms 넘게 커짐 → 90% + 외삽이 지연·끊김 둘 다 적음, netbench).
//    지연은 재생 속도가 0.8~1.15배 안에서만 바뀌게 천천히 따라감(갑자기 빨라지거나 느려 보이지 않게).
//  - 버퍼가 바닥나면 마지막 구간 속도로 최대 0.18초까지 외삽(그 뒤엔 멈춤). 들어온 스냅샷과 합류는 화면 이동(place)의 부드러움이 맡는다.
//  - 서버 시각이 크게 뒤로 가면(방이 새로 만들어짐) 버퍼를 비움 — 전에는 옛 시각보다 커질 때까지 새 스냅샷을 전부 버려서 선수들이 멈춰 있었음.
export const NET = { MIN: 0.04, MAX: 0.25, Q: 0.9, WIN: 120, MARGIN: 0.008, EXT_MAX: 0.18, PUSH_MAX: 1.5, UP: 0.2, DOWN: 0.15, SLEW: 0.003 };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, u) => a + (b - a) * u;
const lerpAng = (a, b, u) => { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * u; };
export const rkey = (r) => (r[7] ? 'r' + r[7] : r[2] + '|' + (r[4] || ''));

export function createNetInterp() {
  const hist = [];
  const late = new Float64Array(NET.WIN), sorted = new Float64Array(NET.WIN);
  let ln = 0, li = 0;
  const N = { offset: null, delay: 0.07, want: 0.07, gap: 1 / 30, jit: 0, lastNow: null };
  const out = { a: null, b: null, u: 0, ti: 0, under: false, ext: 0, live: false, delay: 0, fl: null, rn: null };
  N.reset = () => { hist.length = 0; ln = li = 0; N.offset = null; N.lastNow = null; N.delay = N.want = 0.07; };
  N.simNow = (p) => p + (N.offset || 0);
  // 서버 시계: 가장 빨리 도착한 쪽(지연 최소)에 맞추고 천천히 내려옴 — 스윙 dt·투구 화면 시각이 이 시계를 씀.
  // [net] 전엔 더 빨리 온 스냅샷 하나에 시계를 바로 앞으로 옮겨서(지터 30ms 면 수~수십 ms) 그 프레임에 공·투구가 그만큼 순간 이동 →
  //       앞으로도 스냅샷당 최대 3ms 씩만(재생 속도 최대 1.1배) 따라감. 처음·2초 넘게 어긋나면 바로 맞춤.
  N.clock = (s, p) => {
    const sample = s.now - p;
    if (N.offset === null || Math.abs(sample - N.offset) > 2) N.offset = sample;
    else if (sample > N.offset) N.offset += Math.min(sample - N.offset, NET.SLEW);
    else N.offset += (sample - N.offset) * 0.02;
  };
  N.push = (s, p) => {
    const n = hist.length;
    if (n && s.now < hist[n - 1].t - 1) { hist.length = 0; ln = li = 0; N.lastNow = null; } // 새 방(서버 시각 0부터) → 옛 버퍼 버림
    else if (n && s.now <= hist[n - 1].t) return;
    const L = Math.max(0, p + N.offset - s.now);
    late[li] = L; li = (li + 1) % NET.WIN; if (ln < NET.WIN) ln++;
    if (N.lastNow != null) { const g = s.now - N.lastNow; if (g > 0 && g < 0.2) N.gap += (g - N.gap) * 0.05; }
    N.lastNow = s.now;
    for (let i = 0; i < ln; i++) sorted[i] = late[i];
    const sv = sorted.subarray(0, ln).sort();
    N.jit = sv[Math.min(ln - 1, Math.floor(ln * NET.Q))];
    N.want = clamp(N.gap + N.jit + NET.MARGIN, NET.MIN, NET.MAX);
    const rn = new Map(); for (const r of s.rn || []) rn.set(rkey(r), r);
    hist.push({ t: s.now, fl: s.fl, rn });
    if (hist.length > 40) hist.shift();
  };
  N.onSnap = (s, p) => { N.clock(s, p); if (s.fl) N.push(s, p); };

  // 보간 값: 한 구간 a→b, u(1 넘으면 외삽). 구간이 너무 길거나 너무 빠르면(교대·순간 이동) 외삽 안 함
  const seg = (fa, fb, ia, ib, u, k) => {
    if (u <= 1) return lerp(fa[ia], fb[ib], u);
    const d = fb[ib] - fa[ia];
    return Math.abs(d) > 1.2 * k ? fb[ib] : fb[ib] + d * (u - 1);
  };
  // 수비수 i: [x, z, ry]. live 면 공(현재 시각으로 외삽)과 같은 시각이 되게 구간 속도 × 지연만큼 앞으로 (최대 1.5m) — [gameplay] 수정 유지
  const flv = [0, 0, 0];
  out.fl = (i, pos) => {
    const A = out.a, B = out.b; const fa = A.fl[i], fb = B.fl[i];
    if (!fa || !fb || fa[0] !== pos || fb[0] !== pos) return null;
    const u = out.u, k = B.t - A.t;
    flv[0] = seg(fa, fb, 1, 1, u, k * 30); flv[1] = seg(fa, fb, 2, 2, u, k * 30); flv[2] = lerpAng(fa[3], fb[3], Math.min(u, 1));
    if (out.live && k > 0) {
      let ex = (fb[1] - fa[1]) / k * out.delay, ez = (fb[2] - fa[2]) / k * out.delay;
      const el = Math.hypot(ex, ez);
      if (el > NET.PUSH_MAX) { ex *= NET.PUSH_MAX / el; ez *= NET.PUSH_MAX / el; }
      if (el < 15) { flv[0] += ex; flv[1] += ez; } // 15m 넘게 튀는 건 교대·리셋
    }
    return flv;
  };
  const rnv = [0, 0];
  out.rn = (key) => {
    const ra = out.a.rn.get(key), rb = out.b.rn.get(key);
    if (!ra || !rb) return null;
    const k = out.b.t - out.a.t;
    rnv[0] = seg(ra, rb, 0, 0, out.u, k * 30); rnv[1] = seg(ra, rb, 1, 1, out.u, k * 30);
    return rnv;
  };
  // 프레임마다: 지연을 목표 쪽으로(재생 속도 0.85~1.2배 안), 보간 시각 ti 의 구간
  N.sample = (t, dt, live) => {
    const d = N.want - N.delay, lim = (d > 0 ? NET.UP : NET.DOWN) * Math.min(dt, 0.05);
    N.delay += clamp(d, -lim, lim);
    const n = hist.length; if (n < 2) return null;
    const ti = t - N.delay, last = hist[n - 1];
    out.ti = ti; out.live = !!live; out.delay = N.delay; out.under = false; out.ext = 0;
    if (ti >= last.t) {
      out.under = true; out.a = hist[n - 2]; out.b = last;
      const k = last.t - out.a.t;
      out.ext = Math.min(ti - last.t, NET.EXT_MAX);
      out.u = k > 0 && k < 0.15 ? 1 + out.ext / k : 1;
      if (out.u === 1) out.ext = 0;
      return out;
    }
    for (let i = n - 2; i >= 0; i--) {
      const a = hist[i], b = hist[i + 1];
      if (ti >= a.t) { out.a = a; out.b = b; out.u = b.t > a.t ? (ti - a.t) / (b.t - a.t) : 0; return out; }
    }
    out.a = out.b = hist[0]; out.u = 0;
    return out;
  };
  return N;
}

// 공 합류: 서버 공(s.now 시점)을 화면 공의 시각까지 앞으로 굴린 뒤 부드럽게 합류 (main.js onSnap 에서 옮김 — [gameplay] 수정 포함)
// [net] 화면 공은 자기 시각 tb 를 갖는다(프레임마다 tb → simNow 만큼 적분). 전에는 스냅샷이 프레임 사이에 오면 서버 공을 '지금'까지 굴려
//       '지난 프레임 위치'에 합류시켜서, 다음 프레임에 또 dt 만큼 적분 → 공이 앞서 갔다 끌려오기를 반복(30fps 에서 0.3m+ 튐 5회/분, 오차 p99 2.2m).
export function mergeBall(ballL, s, simT, integrate, lastBallSt) {
  const [x, y, z, vx, vy, vz, h, st, sx, sy, sz] = s.b;
  const sb = { x, y, z, vx, vy, vz, sx, sy, sz, state: st, h, tb: simT };
  const T = ballL && ballL.h < 0 && h < 0 && ballL.tb != null && ballL.tb <= simT ? ballL.tb : simT;
  if (h < 0) {
    const age = clamp(T - s.now, -0.1, 0.25);
    if (age >= 0) for (let i = 0, n = Math.ceil(age * 120); i < n; i++) integrate(sb, age / n);
    else { // 스냅샷이 화면 공보다 '미래'(시계가 천천히 따라가는 중) → 그 시각으로 짧게 되돌림(직선 + 중력, 0.1초 이내라 오차 수 mm)
      sb.x += sb.vx * age; sb.z += sb.vz * age;
      if (st !== 'ground') { sb.y = Math.max(0, sb.y + sb.vy * age + 4.9 * age * age); sb.vy -= 9.8 * age; } // age < 0: 그때 위쪽 속도가 더 컸음
    }
    sb.tb = T;
  }
  if (!ballL || h >= 0 || ballL.h >= 0 || (st === 'thrown' && lastBallSt !== 'thrown') || Math.hypot(ballL.x - sb.x, ballL.y - sb.y, ballL.z - sb.z) > 2.5) return sb;
  const k = 0.35;
  ballL.x = lerp(ballL.x, sb.x, k); ballL.z = lerp(ballL.z, sb.z, k);
  const sameSide = (ballL.vy > 0.5) === (sb.vy > 0.5) || (ballL.y > 0.8 && sb.y > 0.8);
  if (sameSide) { ballL.y = lerp(ballL.y, sb.y, k); ballL.vy = sb.vy; ballL.state = sb.state; }
  ballL.vx = sb.vx; ballL.vz = sb.vz; ballL.sx = sb.sx; ballL.sy = sb.sy; ballL.sz = sb.sz; ballL.h = h;
  if (sb.state === 'thrown' || sb.state === 'dead') ballL.state = sb.state;
  return ballL;
}
// 프레임: 화면 공을 tb → t 까지 적분 (최대 0.1초). 반환: integrate 이벤트 목록 콜백용으로 각 스텝 결과를 fn 에 넘김
export function stepBall(ballL, t, integrate, fn) {
  const span = clamp(t - (ballL.tb ?? t), 0, 0.1);
  ballL.tb = t;
  if (!span) return;
  const steps = Math.ceil(span / (1 / 120));
  for (let i = 0; i < steps; i++) { const ev = integrate(ballL, span / steps); if (fn) fn(ev); }
}
