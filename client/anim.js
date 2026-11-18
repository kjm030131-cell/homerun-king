// anim.js — 선수 모션: 포즈 라이브러리 + 절차적 애니메이션 + IK 타깃
// 규칙(모델은 +z를 바라봄): 다리 x(-)=앞으로, 무릎 x(+)=굽힘, 상체 x(+)=숙임,
// 팔 x(-)=앞으로 들기, 팔꿈치 x(-)=굽힘, y(+)=몸 왼쪽(+x)으로 회전. 왼쪽 = +x.
import * as THREE from 'three';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// 포즈 합성
export function mix(a, b, t) {
  const o = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const x = a[k] || Z3, y = b[k] || Z3;
    o[k] = [lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)];
  }
  return o;
}
const Z3 = [0, 0, 0];
function add(a, b) { const o = { ...a }; for (const k in b) { const x = a[k] || Z3; o[k] = [x[0] + b[k][0], x[1] + b[k][1], x[2] + b[k][2]]; } return o; }
// 키프레임 트랙: [[k, pose], ...]
function track(frames, k) {
  if (k <= frames[0][0]) return frames[0][1];
  for (let i = 0; i < frames.length - 1; i++) {
    const [k0, p0] = frames[i], [k1, p1] = frames[i + 1];
    if (k <= k1) return mix(p0, p1, ease((k - k0) / (k1 - k0)));
  }
  return frames[frames.length - 1][1];
}
// 벡터 키프레임 (Catmull-Rom)
function vtrack(frames, k, out) {
  const n = frames.length;
  if (k <= frames[0][0]) return out.copy(frames[0][1]);
  if (k >= frames[n - 1][0]) return out.copy(frames[n - 1][1]);
  let i = 0; while (i < n - 2 && k > frames[i + 1][0]) i++;
  const t = (k - frames[i][0]) / (frames[i + 1][0] - frames[i][0]);
  const p0 = frames[Math.max(0, i - 1)][1], p1 = frames[i][1], p2 = frames[i + 1][1], p3 = frames[Math.min(n - 1, i + 2)][1];
  const t2 = t * t, t3 = t2 * t;
  for (const c of ['x', 'y', 'z']) {
    out[c] = 0.5 * ((2 * p1[c]) + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3);
  }
  return out;
}

// ───────── 기본 포즈 ─────────
export const POSES = {
  stand: { // 힘 뺀 자연스러운 서기: 무릎 살짝, 팔꿈치 살짝 굽힘, 어깨 내려감
    root: [0, -0.012, 0],
    thL: [-0.06, 0.08, 0.07], thR: [-0.04, -0.1, -0.07], shinL: [0.12, 0, 0], shinR: [0.09, 0, 0], ftL: [-0.06, 0, -0.04], ftR: [-0.05, 0, 0.04],
    spine: [0.03, 0, 0], chest: [-0.02, 0, 0],
    uaL: [0.08, 0.1, 0.16], uaR: [0.06, -0.1, -0.16], faL: [-0.38, 0, 0], faR: [-0.34, 0, 0], neck: [0.02, 0, 0],
  },
  ready: {
    root: [0, -0.1, 0],
    thL: [-0.58, 0.12, 0.2], shinL: [0.98, 0, 0], ftL: [-0.38, 0, -0.05],
    thR: [-0.58, -0.12, -0.2], shinR: [0.98, 0, 0], ftR: [-0.38, 0, 0.05],
    spine: [0.38, 0, 0], chest: [0.18, 0, 0], neck: [-0.3, 0, 0], head: [-0.22, 0, 0],
    uaL: [-0.8, 0, 0.28], faL: [-0.85, 0, 0], uaR: [-0.72, 0, -0.22], faR: [-1.0, 0, 0],
  },
  groundball: {
    root: [0, -0.45, 0.05],
    thL: [-1.25, 0.22, 0.38], shinL: [1.8, 0, 0], ftL: [-0.55, 0, 0],
    thR: [-1.1, -0.22, -0.38], shinR: [1.85, 0, 0], ftR: [-0.75, 0, 0],
    spine: [0.75, 0, 0], chest: [0.35, 0, 0], neck: [-0.55, 0, 0], head: [-0.45, 0, 0],
    uaL: [-1.2, 0, 0.2], faL: [-0.3, 0, 0], uaR: [-1.1, 0, -0.2], faR: [-0.5, 0, 0],
  },
  catcher: {
    root: [0, -0.52, 0],
    thL: [-1.62, 0.28, 0.48], shinL: [2.25, 0, 0], ftL: [-0.62, 0, -0.1],
    thR: [-1.62, -0.28, -0.48], shinR: [2.25, 0, 0], ftR: [-0.62, 0, 0.1],
    spine: [0.28, 0, 0], chest: [0.06, 0, 0], neck: [-0.18, 0, 0],
    uaL: [-0.9, 0, 0.3], faL: [-0.9, 0, 0], uaR: [0.2, 0, -0.35], faR: [-1.6, 0, 0], hL: [0, 1.3, 0],
  },
  ump: {
    root: [0, -0.27, 0],
    thL: [-0.85, 0.1, 0.32], shinL: [1.25, 0, 0], ftL: [-0.4, 0, -0.1],
    thR: [-0.85, -0.1, -0.32], shinR: [1.25, 0, 0], ftR: [-0.4, 0, 0.1],
    spine: [0.55, 0, 0], chest: [0.22, 0, 0], neck: [-0.45, 0, 0], head: [-0.35, 0, 0],
    uaL: [-0.6, 0, 0.35], faL: [-0.4, 0, 0], uaR: [-0.6, 0, -0.35], faR: [-0.4, 0, 0],
  },
  knees: { // 외야수 투구 대기: 양손 무릎 짚고 숙임
    root: [0, -0.12, 0],
    thL: [-0.62, 0.1, 0.2], shinL: [0.95, 0, 0], ftL: [-0.33, 0, -0.06],
    thR: [-0.62, -0.1, -0.2], shinR: [0.95, 0, 0], ftR: [-0.33, 0, 0.06],
    spine: [0.62, 0, 0], chest: [0.2, 0, 0], neck: [-0.55, 0, 0], head: [-0.3, 0, 0],
    uaL: [-0.55, 0, 0.12], faL: [-0.35, 0, 0], uaR: [-0.55, 0, -0.12], faR: [-0.35, 0, 0],
  },
  lead: { // 주자 리드 자세
    root: [0, -0.12, 0],
    thL: [-0.45, 0, 0.32], shinL: [0.8, 0, 0], ftL: [-0.35, 0, 0],
    thR: [-0.45, 0, -0.32], shinR: [0.8, 0, 0], ftR: [-0.35, 0, 0],
    spine: [0.42, 0, 0], chest: [0.1, 0, 0], neck: [-0.35, 0, 0],
    uaL: [-0.35, 0, 0.3], faL: [-0.7, 0, 0], uaR: [-0.35, 0, -0.3], faR: [-0.7, 0, 0],
  },
};

// 달리기 사이클 (φ 위상, a 0~1 강도)
export function runPose(ph, a) {
  const s = Math.sin(ph), c = Math.cos(ph);
  const A = 0.25 + 0.75 * a;
  return {
    root: [0, -0.04 * A + 0.05 * A * Math.abs(Math.sin(ph)), 0],
    hips: [0, -0.16 * s * A, 0],
    spine: [0.12 + 0.22 * a, 0.0, 0], chest: [0.06 * a, 0.24 * s * A, 0], neck: [-0.2 * a, -0.12 * s * A, 0],
    thL: [-0.95 * s * A - 0.1 * a, 0, 0.04], shinL: [0.2 + 1.45 * A * Math.max(0, c) + 0.25 * a, 0, 0], ftL: [0.25 * s * A, 0, 0],
    thR: [0.95 * s * A - 0.1 * a, 0, -0.04], shinR: [0.2 + 1.45 * A * Math.max(0, -c) + 0.25 * a, 0, 0], ftR: [-0.25 * s * A, 0, 0],
    uaL: [0.95 * s * A - 0.1 * a, 0, 0.1], faL: [-1.35 - 0.25 * a + 0.25 * s * A, 0, 0],
    uaR: [-0.95 * s * A - 0.1 * a, 0, -0.1], faR: [-1.35 - 0.25 * a - 0.25 * s * A, 0, 0],
  };
}

// ───────── 투구 (k: 0~1, 0.656에 릴리스) ─────────
export const PITCH_RELEASE_K = 0.656;
export const PITCH_DUR = 1.6;
// 실제 시간(초, 투구 시작부터) → 투구 모션 키 k. 세트 0.35s, 레그킥 0.9s, 정점 멈춤 0.2s, 스트라이드~릴리스 0.4s, 팔로스루
export const PITCH_TOTAL = 2.4;
export function pitchK(tau) {
  if (tau < 0) return -1;
  if (tau < 0.35) return 0;
  if (tau < 1.25) { const u = (tau - 0.35) / 0.9; return 0.36 * (u * u * (3 - 2 * u)); }
  if (tau < 1.45) return 0.36;
  if (tau < 1.85) return 0.36 + (0.656 - 0.36) * Math.pow((tau - 1.45) / 0.4, 1.35);
  return 0.656 + (tau - 1.85) / 1.6;
}
// 세트 포지션: 몸을 옆으로(왼쪽 어깨가 홈), 발은 홈 방향으로 어깨너비, 글러브는 가슴 앞, 고개만 포수 쪽
export const SET_POSE = { root: [0, -0.03, 0], hips: [0, -1.4, 0], spine: [0.1, 0, 0], chest: [0.02, -0.08, 0], neck: [0.05, 0.75, 0], head: [0.08, 0.5, 0],
  thL: [-0.06, 0, 0.11], shinL: [0.14, 0, 0], ftL: [-0.08, 0, -0.11], thR: [-0.08, 0, -0.1], shinR: [0.16, 0, 0], ftR: [-0.08, 0, 0.1] };
const PITCH_BODY = [
  [0.0, SET_POSE],
  [0.16, { ...SET_POSE, root: [0, -0.02, -0.06], thL: [-0.12, 0, 0.08], shinL: [0.3, 0, 0], thR: [-0.04, 0, -0.06], shinR: [0.2, 0, 0] }],
  [0.36, { root: [0, -0.02, -0.05], hips: [0, -1.35, 0], chest: [0, -0.15, 0], spine: [-0.05, 0, 0], thL: [-1.55, 0.1, 0.1], shinL: [1.85, 0, 0], ftL: [0.5, 0, 0], thR: [0.0, 0, -0.04], shinR: [0.28, 0, 0], neck: [0, 1.25, 0], head: [0.05, 0.15, 0] }],
  [0.52, { root: [0, -0.2, 0.45], hips: [0, -1.25, 0], chest: [0, -0.2, 0], spine: [-0.05, 0, 0], thL: [-0.35, 0.1, 0.95], shinL: [0.55, 0, 0], ftL: [0.1, 0, 0], thR: [0.05, 0, -0.35], shinR: [0.6, 0, 0], neck: [0, 1.2, 0] }],
  [0.62, { root: [0, -0.3, 0.75], hips: [0, -0.55, 0], chest: [0, -0.95, 0], spine: [0.05, 0, 0.1], thL: [-0.25, 0.4, 0.75], shinL: [0.45, 0, 0], ftL: [-0.1, 0, 0], thR: [0.35, 0, -0.45], shinR: [0.65, 0, 0], ftR: [0.4, 0, 0], neck: [0, 1.0, 0] }],
  [0.656, { root: [0, -0.3, 0.85], hips: [0, 0.05, 0], chest: [0.3, 0.15, 0], spine: [0.35, 0, 0], thL: [-0.65, 0.2, 0.3], shinL: [0.55, 0, 0], ftL: [-0.15, 0, 0], thR: [0.55, 0, -0.3], shinR: [0.9, 0, 0], ftR: [0.6, 0, 0], neck: [-0.35, -0.35, 0], head: [-0.2, -0.2, 0] }],
  [0.76, { root: [0, -0.36, 0.95], hips: [0, 0.22, 0], chest: [0.55, 0.12, 0], spine: [0.7, 0, 0], thL: [-0.95, 0.2, 0.15], shinL: [0.8, 0, 0], ftL: [-0.15, 0, 0], thR: [0.9, 0, -0.2], shinR: [1.3, 0, 0], ftR: [0.5, 0, 0], neck: [-0.6, -0.3, 0], head: [-0.25, 0, 0] }],
  [1.0, { root: [0, -0.12, 0.95], hips: [0, 0.05, 0], chest: [0.15, 0, 0], spine: [0.32, 0, 0], thL: [-0.55, 0.12, 0.22], shinL: [0.85, 0, 0], ftL: [-0.3, 0, 0], thR: [-0.5, -0.12, -0.22], shinR: [0.85, 0, 0], ftR: [-0.3, 0, 0], neck: [-0.3, 0, 0] }],
];
// 투구 손 경로 (투수 로컬, 홈 방향 +z, 오른손 = -x)
const PITCH_HAND_R = [ // 몸통(body) 기준
  [0.0, V(-0.2, 1.24, 0.03)], [0.16, V(-0.18, 1.3, 0.05)], [0.36, V(-0.06, 1.38, 0.12)],
  [0.52, V(-0.45, 1.2, -0.55)], [0.6, V(-0.6, 1.72, -0.55)], [0.63, V(-0.52, 1.88, -0.1)],
  [0.656, V(-0.33, 1.78, 0.55)], [0.7, V(-0.15, 1.42, 0.75)], [0.78, V(0.28, 1.02, 0.55)], [1.0, V(-0.1, 1.15, 0.45)],
];
const PITCH_HAND_L = [
  [0.0, V(-0.19, 1.27, 0.1)], [0.16, V(-0.17, 1.32, 0.11)], [0.36, V(-0.04, 1.4, 0.17)], [0.52, V(0.3, 1.55, 0.45)],
  [0.62, V(0.35, 1.6, 0.55)], [0.66, V(0.3, 1.3, 0.35)], [0.78, V(0.3, 1.1, 0.4)], [1.0, V(0.18, 1.15, 0.45)],
];

// ───────── 송구 (야수) ─────────
export const THROW_DUR = 0.6;
const THROW_BODY = [
  [0, { root: [0, -0.06, 0], hips: [0, -0.9, 0], chest: [0, -0.3, 0], thL: [-0.2, 0, 0.4], shinL: [0.4, 0, 0], thR: [0.1, 0, -0.3], shinR: [0.5, 0, 0], neck: [0, 1.1, 0] }],
  [0.4, { root: [0, -0.12, 0.25], hips: [0, -0.8, 0], chest: [0, -0.5, 0], thL: [-0.35, 0, 0.5], shinL: [0.45, 0, 0], thR: [0.2, 0, -0.35], shinR: [0.55, 0, 0], neck: [0, 1.2, 0] }],
  [0.55, { root: [0, -0.15, 0.45], hips: [0, 0.2, 0], chest: [0.35, 0.5, 0], spine: [0.3, 0, 0], thL: [-0.6, 0, 0.3], shinL: [0.6, 0, 0], thR: [0.5, 0, -0.2], shinR: [0.9, 0, 0], neck: [-0.3, -0.4, 0] }],
  [1, { root: [0, -0.1, 0.55], chest: [0.3, 0.2, 0], spine: [0.35, 0, 0], thL: [-0.5, 0, 0.2], shinL: [0.7, 0, 0], thR: [0.2, 0, -0.1], shinR: [0.7, 0, 0], neck: [-0.3, 0, 0] }],
];
const THROW_HAND = [[0, V(-0.05, 1.36, 0.25)], [0.4, V(-0.6, 1.75, -0.45)], [0.55, V(-0.33, 1.82, 0.4)], [0.75, V(0.1, 1.2, 0.45)], [1, V(0.05, 1.1, 0.1)]];
export const THROW_RELEASE_K = 0.55;

// ───────── 타격 ─────────
// 타자 로컬: +z = 홈플레이트 쪽, +x = 투수 쪽, 오른손(뒷손) = -x
export const SWING_CONTACT_K = 0.5;
export function swingTrack(contactLocal) {
  // 컨택 지점(배트 스윗스팟)에 맞춰 컨택 프레임 계산
  const P = contactLocal || V(0.05, 0.85, 0.95);
  const dirC = V(0.12, (P.y - 1.0) * 0.55 - 0.05, 1).normalize();
  const knobC = P.clone().addScaledVector(dirC, -0.7);
  return {
    knob: [
      [0, V(-0.2, 1.3, 0.1)], [0.25, V(-0.28, 1.32, 0.04)], [0.4, V(-0.14, 1.16, 0.26)],
      [0.5, knobC], [0.62, V(0.32, 1.05, 0.22)], [0.78, V(0.24, 1.32, -0.08)], [1, V(0.02, 1.42, -0.12)],
    ],
    dir: [
      [0, V(-0.3, 0.88, -0.36)], [0.25, V(-0.45, 0.82, -0.36)], [0.4, V(-0.85, 0.3, 0.45)],
      [0.5, dirC], [0.62, V(0.92, 0.12, 0.35)], [0.78, V(0.3, 0.5, -0.82)], [1, V(-0.55, 0.45, -0.7)],
    ],
  };
}
// 무릎 굽힌 오픈 스탠스. 다리 z(벌림)는 발목 z로 상쇄해 발바닥이 지면과 평행
// 엉덩이가 투수 쪽(+y)으로 돌 때 앞다리(L)는 y를 거꾸로 돌려 앞발을 고정, 뒷발(R)은 뒤꿈치 들며 피벗
const SWING_BODY = [
  // 스탠스: 어깨보다 넓게(약 75cm), 무릎 굽히고 체중 약간 뒤, 발끝은 홈플레이트 쪽
  [0, { root: [-0.02, -0.17, 0], hips: [0, 0.05, 0], spine: [0.32, 0, 0], chest: [0.04, -0.26, 0], neck: [-0.2, 0, 0],
    thL: [-0.44, 0.1, 0.43], shinL: [0.8, 0, 0], ftL: [-0.3, -0.18, -0.43], thR: [-0.5, -0.12, -0.42], shinR: [0.86, 0, 0], ftR: [-0.32, 0.18, 0.42] }],
  // 로드: 앞발 살짝 들고 체중 뒤로
  [0.25, { root: [-0.07, -0.15, 0], hips: [0, -0.22, 0], spine: [0.3, 0, 0], chest: [0.04, -0.38, 0], neck: [-0.2, 0, 0],
    thL: [-0.78, 0.3, 0.3], shinL: [1.1, 0, 0], ftL: [0.05, -0.16, -0.3], thR: [-0.56, 0.04, -0.44], shinR: [0.9, 0, 0], ftR: [-0.32, 0.18, 0.44] }],
  [0.4, { root: [0.1, -0.14, 0], hips: [0, 0.4, 0], spine: [0.3, 0, 0.04], chest: [0.05, -0.2, 0], neck: [-0.2, 0, 0],
    thL: [-0.4, -0.3, 0.42], shinL: [0.42, 0, 0], ftL: [-0.02, -0.1, -0.42], thR: [-0.42, -0.5, -0.34], shinR: [0.85, 0, 0], ftR: [-0.15, 0.4, 0.34] }],
  [0.5, { root: [0.15, -0.13, 0], hips: [0, 1.0, 0], spine: [0.26, 0, 0.14], chest: [0.06, 0.12, 0], neck: [-0.15, 0, 0],
    thL: [-0.3, -0.9, 0.42], shinL: [0.2, 0, 0], ftL: [0.05, -0.05, -0.42], thR: [-0.2, -0.95, -0.28], shinR: [0.95, 0, 0], ftR: [0.55, 0.5, 0.2] }],
  [0.65, { root: [0.17, -0.1, 0], hips: [0, 1.3, 0], spine: [0.15, 0, 0.1], chest: [0.0, 0.4, 0], neck: [-0.05, 0, 0],
    thL: [-0.22, -1.15, 0.36], shinL: [0.12, 0, 0], ftL: [0.1, 0, -0.36], thR: [-0.12, -1.2, -0.2], shinR: [0.95, 0, 0], ftR: [0.85, 0.55, 0.1] }],
  [1, { root: [0.16, -0.06, 0], hips: [0, 1.38, 0], spine: [0.05, 0, 0], chest: [-0.05, 0.45, 0], neck: [0, 0, 0],
    thL: [-0.15, -1.25, 0.3], shinL: [0.1, 0, 0], ftL: [0.05, 0, -0.3], thR: [-0.05, -1.28, -0.12], shinR: [0.95, 0, 0], ftR: [0.95, 0.5, 0.05] }],
];
// 번트: 투수 정면으로 몸을 돌리고 무릎을 깊게
const BUNT_BODY = { root: [0.1, -0.22, 0], hips: [0, 1.2, 0], spine: [0.38, 0, 0], chest: [0.08, 0.1, 0], neck: [-0.35, 0, 0],
  thL: [-0.7, -0.85, 0.28], shinL: [1.0, 0, 0], ftL: [-0.3, -0.1, -0.28], thR: [-0.75, -1.0, -0.28], shinR: [1.05, 0, 0], ftR: [-0.3, 0.2, 0.28] };

// ───────── 컨트롤러 ─────────
const _a = V(), _b = V(), _c = V(), _d = V(), _w = V(), _p = V();
export class Animator {
  constructor(player) {
    this.p = player;
    this.ph = Math.random() * 6;
    this.t = Math.random() * 10;
    this.speed = 0;
  }
  // 로컬 → 월드
  w(v, out = _w) { return this.p.body.localToWorld(out.copy(v)); }
  rate(dt, r) { return 1 - Math.exp(-r * dt); }

  // 공통: 달리기/서기/준비 자세를 속도에 따라 섞음
  locomotion(speed, idlePose) {
    const a = clamp(speed / 8.5, 0, 1);
    if (speed < 0.4) return idlePose;
    const run = runPose(this.ph, a);
    return speed < 1.6 ? mix(idlePose, run, (speed - 0.4) / 1.2) : run;
  }
  tick(dt, speed) {
    this.t += dt;
    this.speed += (speed - this.speed) * this.rate(dt, 8);
    // 보폭: 전력질주 약 3.6m/사이클
    this.ph += dt * (this.speed < 0.3 ? 0 : (this.speed / 3.4) * Math.PI * 2 + 1.5);
  }
  breathe(pose) {
    // 숨쉬기 + 느린 체중 이동(좌우) + 고개 조금씩 — 가만히 서 있어도 살아 있는 느낌
    const b = Math.sin(this.t * 1.6) * 0.02;
    const w = Math.sin(this.t * 0.45 + this.ph) * 0.035, h = Math.sin(this.t * 0.31 + this.ph * 2) * 0.08;
    return add(pose, { root: [w * 0.4, 0, 0], hips: [0, 0, w * 0.5], spine: [0, 0, -w * 0.6], chest: [-b, 0, 0], neck: [0, h, 0],
      thL: [0, 0, -w * 0.5], thR: [0, 0, -w * 0.5], uaL: [0, 0, b * 0.5], uaR: [0, 0, -b * 0.5] });
  }

  // 야수
  fielder(dt, c) {
    // c: speed, ready, hasBall, throwK, diveK, jumpK, ballW(월드 V3), reach(bool), ground(bool)
    const P = this.p;
    this.tick(dt, c.speed);
    let pose, r = 12;
    if (c.diveK >= 0) {
      const k = c.diveK;
      const fly = clamp(k / 0.18, 0, 1), down = clamp((k - 0.5) / 0.5, 0, 1);
      pose = {
        rootR: [lerp(0.3, 1.38, ease(fly)), 0, 0], root: [0, lerp(0.15, -0.05, ease(clamp(k / 0.45, 0, 1))) + Math.sin(Math.PI * clamp(k / 0.45, 0, 1)) * 0.25, 0],
        spine: [-0.1, 0, 0], chest: [-0.1, 0, 0], neck: [-0.9, 0, 0], head: [-0.5, 0, 0],
        thL: [0.15, 0, 0.12], shinL: [0.4 + down * 0.6, 0, 0], ftL: [0.5, 0, 0], thR: [0.3, 0, -0.12], shinR: [0.2 + down * 0.5, 0, 0], ftR: [0.5, 0, 0],
        uaL: [-2.95, 0, 0.12], faL: [-0.1, 0, 0], uaR: [-2.7, 0, -0.25], faR: [-0.3, 0, 0],
      };
      if (k > 1) pose = mix(pose, POSES.ready, clamp((k - 1) / 0.6, 0, 1));
      r = 18;
    } else if (c.throwK >= 0) {
      pose = track(THROW_BODY, c.throwK);
      r = 25;
    } else if (c.jumpK >= 0) {
      const h = Math.sin(Math.PI * clamp(c.jumpK, 0, 1));
      pose = { root: [0, h * 0.55, 0], thL: [-0.7 * h, 0, 0.1], shinL: [1.3 * h, 0, 0], thR: [-0.25 * h, 0, -0.1], shinR: [0.7 * h, 0, 0], ftL: [0.5, 0, 0], ftR: [0.5, 0, 0], uaL: [-2.9, 0, 0.25], faL: [-0.2, 0, 0], uaR: [-0.5, 0, -0.5], faR: [-0.8, 0, 0], neck: [-0.4, 0, 0] };
      r = 22;
    } else if (c.ground && c.speed < 3) {
      pose = POSES.groundball; r = 10;
    } else {
      pose = this.locomotion(c.speed, c.ready ? POSES.ready : c.knees ? this.breathe(POSES.knees) : this.breathe(POSES.stand));
      // 스플릿 스텝: 투구 순간 살짝 뛰었다 착지
      if (c.splitK >= 0 && c.splitK < 1 && c.speed < 1) { const h = Math.sin(Math.PI * c.splitK); pose = add(pose, { root: [0, h * 0.07, 0], thL: [-0.15 * h, 0, 0.05 * h], thR: [-0.15 * h, 0, -0.05 * h], shinL: [0.3 * h, 0, 0], shinR: [0.3 * h, 0, 0] }); r = 20; }
    }
    P.applyPose(pose, this.rate(dt, r));
    // 팔 IK
    P.root.updateMatrixWorld(true);
    if (c.throwK >= 0) {
      vtrack(THROW_HAND, c.throwK, _a);
      P.ik('R', this.w(_a, _b), this.w(_c.set(-0.6, 1.2, -0.6), _d));
      P.ball.visible = c.throwK < THROW_RELEASE_K;
    } else {
      P.ball.visible = !!c.hasBall;
      if (c.hasBall && c.speed < 2) {
        P.ik('R', this.w(_a.set(-0.05, 1.22, 0.3), _b), this.w(_c.set(-0.5, 0.8, -0.2), _d), 0.8);
        P.ik('L', this.w(_a.set(0.05, 1.2, 0.32), _b), this.w(_c.set(0.5, 0.8, -0.2), _d), 0.8);
      }
    }
    // 글러브 뻗기
    if (c.reachW && c.throwK < 0) {
      P.ik('L', c.reachW, this.w(_c.set(0.7, 0.6, -0.3), _d), c.reachWeight ?? 1);
    } else if (c.ground && c.speed < 3 && c.throwK < 0 && c.diveK < 0) {
      P.ik('L', this.w(_a.set(0.12, 0.12, 0.62), _b), this.w(_c.set(0.6, 0.6, 0.2), _d));
      if (!c.hasBall) P.ik('R', this.w(_a.set(-0.02, 0.2, 0.62), _b), this.w(_c.set(-0.6, 0.6, 0.2), _d));
    }
    if (c.ballW && c.diveK < 0 && c.throwK < 0) P.lookAt(c.ballW, this.rate(dt, 10));
  }

  // 투수 (k<0: 세트 대기)
  pitcher(dt, c) {
    const P = this.p;
    this.tick(dt, c.speed || 0);
    let pose, r = 10;
    if (c.k >= 0) { pose = track(PITCH_BODY, c.k); r = 30; }
    else if (c.speed > 0.5) pose = this.locomotion(c.speed, POSES.stand);
    else pose = this.breathe(SET_POSE);
    P.applyPose(pose, this.rate(dt, r));
    P.root.updateMatrixWorld(true);
    if (c.k >= 0) {
      vtrack(PITCH_HAND_R, c.k, _a);
      const elbowUp = c.k > 0.55 && c.k < 0.67;
      P.ik('R', this.w(_a, _b), this.w(elbowUp ? _c.set(-0.9, 1.6, -0.5) : _c.set(-0.7, 0.7, -0.3), _d));
      vtrack(PITCH_HAND_L, c.k, _a);
      P.ik('L', this.w(_a, _b), this.w(_c.set(0.8, 0.9, 0.2), _d));
      P.ball.visible = c.k < PITCH_RELEASE_K;
    } else if (c.catchW && c.speed < 0.5) {
      // 포수가 던져준 공 받기
      P.ik('L', c.catchW, this.w(_c.set(0.7, 1.0, -0.2), _d));
      P.ik('R', this.w(_a.set(-0.18, 0.95, 0.1), _b), this.w(_c.set(-0.5, 1.0, -0.3), _d), 0.7);
      P.ball.visible = false;
    } else if (c.speed < 0.5) {
      // 사인 보는 자세: 공은 글러브 속
      vtrack(PITCH_HAND_R, 0, _a); P.ik('R', this.w(_a, _b), this.w(_c.set(-0.3, 0.9, -0.5), _d));
      vtrack(PITCH_HAND_L, 0, _a); P.ik('L', this.w(_a, _b), this.w(_c.set(-0.1, 0.9, 0.6), _d));
      P.ball.visible = false;
    }
    if (c.lookW && c.k < 0) P.lookAt(c.lookW, this.rate(dt, 6), 1.65, 0.5);
  }

  // 타자: c.swingK(<0 = 스윙 안 함), c.loadK(0~1 투구 따라 체중 이동), c.bunt, c.contactL(로컬 V3)
  batter(dt, c) {
    const P = this.p;
    this.tick(dt, 0);
    let pose, knob = _a, dir = _b;
    if (c.bunt) {
      pose = BUNT_BODY;
      // 배트를 수평으로 들고 공 높이에 맞춤 (몸은 투수 정면)
      knob.set(0.28, 1.08 + clamp(c.aimY || 0, -0.4, 0.4) * 0.5, 0.05);
      dir.set(0.05, 0.08, 1).normalize();
      if (c.swingK >= 0) knob.z += Math.sin(Math.PI * clamp(c.swingK, 0, 1)) * 0.12;
    } else {
      const tr = c.track || (this._tr ||= swingTrack());
      const k = c.swingK >= 0 ? c.swingK : 0.25 * clamp(c.loadK, 0, 1);
      pose = track(SWING_BODY, k);
      if (c.swingK < 0) {
        // 대기 중 배트 까딱
        const wag = Math.sin(this.t * 2.2) * 0.04 * (1 - clamp(c.loadK, 0, 1));
        pose = add(pose, { chest: [0, wag, 0] });
      }
      vtrack(tr.knob, k, knob);
      vtrack(tr.dir, k, dir).normalize();
      if (c.swingK < 0) { const wag = Math.sin(this.t * 2.2) * 0.12 * (1 - clamp(c.loadK, 0, 1)); dir.x += wag * 0.5; dir.normalize(); }
    }
    P.applyPose(pose, this.rate(dt, c.swingK >= 0 ? 45 : 14));
    P.placeBat(knob, dir);
    P.root.updateMatrixWorld(true);
    // 양손을 그립에
    const bk = c.swingK >= 0 ? c.swingK : 0;
    P.batPoint(0.06, _c); P.ik('L', _c, this.w(c.bunt ? _d.set(0.45, 0.7, -0.5) : _d.set(0.25, 0.75, 0.7), _p));
    P.batPoint(0.15, _c); P.ik('R', _c, this.w(bk < 0.42 && !c.bunt ? _d.set(-0.75, 1.25, -0.35) : _d.set(-0.5, 0.45, -0.3), _p));
    if (c.lookW) P.lookAt(c.lookW, this.rate(dt, 12), 1.5, 0.5);
  }

  catcher(dt, c) {
    const P = this.p;
    this.tick(dt, c.speed || 0);
    const pose = c.speed > 0.5 ? this.locomotion(c.speed, POSES.ready) : POSES.catcher;
    P.applyPose(pose, this.rate(dt, 9));
    P.root.updateMatrixWorld(true);
    if (c.speed <= 0.5) {
      if (c.gloveW) P.ik('L', c.gloveW, this.w(_c.set(0.8, 0.3, -0.2), _d));
      else P.ik('L', this.w(_a.set(0.12, 1.12, 0.48), _b), this.w(_c.set(0.8, 0.6, -0.2), _d));
      P.ik('R', this.w(_a.set(-0.2, 0.9, -0.12), _b), this.w(_c.set(-0.7, 0.9, -0.3), _d), 0.8); // 맨손은 뒤로(파울팁 보호)
    }
    P.ball.visible = !!c.hasBall;
    if (c.lookW) P.lookAt(c.lookW, this.rate(dt, 10));
  }

  // c.call: 'strike' | 'out' | 'safe' | null, c.stand: 누심(서 있는 자세)
  ump(dt, c) {
    const P = this.p;
    this.tick(dt, 0);
    const base = c.stand ? { ...POSES.ready, root: [0, -0.06, 0], spine: [0.25, 0, 0] } : POSES.ump;
    let pose = base;
    if (c.call === 'strike' || c.call === 'out') pose = add(POSES.stand, { spine: [-0.1, 0.3, 0], chest: [0, -0.3, 0], uaR: [-2.6, 0, -0.5], faR: [-1.7, 0, 0], uaL: [0.2, 0, 0.2], neck: [0.1, 0, 0] });
    else if (c.call === 'safe') pose = add(POSES.stand, { root: [0, -0.1, 0], spine: [0.25, 0, 0], thL: [-0.3, 0, 0.25], thR: [-0.3, 0, -0.25], shinL: [0.5, 0, 0], shinR: [0.5, 0, 0], uaL: [-1.45, 0, 1.45], faL: [-0.05, 0, 0], uaR: [-1.45, 0, -1.45], faR: [-0.05, 0, 0] });
    P.applyPose(pose, this.rate(dt, c.call ? 14 : 6));
    P.root.updateMatrixWorld(true);
    if (!c.call && !c.stand) {
      P.ik('L', this.w(_a.set(0.2, 0.62, 0.32), _b), this.w(_c.set(0.6, 0.9, 0.0), _d), 0.9);
      P.ik('R', this.w(_a.set(-0.2, 0.62, 0.32), _b), this.w(_c.set(-0.6, 0.9, 0.0), _d), 0.9);
    }
    if (c.lookW) P.lookAt(c.lookW, this.rate(dt, 8));
  }

  // 주자: c.speed, c.slideK, c.lead, c.trot, c.cheer
  runner(dt, c) {
    const P = this.p;
    this.tick(dt, c.speed);
    let pose, r = 12;
    if (c.slideK >= 0) {
      const k = clamp(c.slideK, 0, 1);
      const s = ease(clamp(k / 0.3, 0, 1));
      // 발부터 들어가는 슬라이딩: 상체를 뒤로 눕히고 앞다리 쭉, 뒷다리는 접어서 밑으로, 양팔은 위로
      pose = {
        rootR: [-1.05 * s, 0, 0], root: [0, -0.36 * s, 0.62 * s],
        thL: [-0.5 * s, 0, 0.05], shinL: [0.06, 0, 0], ftL: [0.35 * s, 0, 0],
        thR: [-0.15 * s, 0, -0.18 * s], shinR: [1.65 * s, 0, 0], ftR: [0.4, 0, 0],
        spine: [0.38 * s, 0, 0], chest: [0.15 * s, 0, 0], neck: [0.45 * s, 0, 0], head: [0.15, 0, 0],
        uaL: [-2.55 * s, 0, 0.35], faL: [-0.4, 0, 0], uaR: [-2.4 * s, 0, -0.35], faR: [-0.5, 0, 0],
      };
      r = 16;
    } else if (c.speed < 0.4 && c.lead) pose = POSES.lead;
    else {
      pose = this.locomotion(c.speed, this.breathe(POSES.stand));
      if (c.cheer && c.speed > 0.5) {
        const pump = Math.max(0, Math.sin(this.t * 3));
        pose = add(pose, { uaR: [-2.4 * pump - 0.5, 0, -0.25], faR: [-1.2 * pump, 0, 0] });
      }
    }
    P.applyPose(pose, this.rate(dt, r));
    if (c.lookW) { P.root.updateMatrixWorld(true); P.lookAt(c.lookW, this.rate(dt, 6)); }
  }

  // 덕아웃/대기 타석
  idle(dt, c = {}) {
    const P = this.p;
    this.tick(dt, 0);
    P.applyPose(this.breathe(c.pose || POSES.stand), this.rate(dt, 6));
  }
}
