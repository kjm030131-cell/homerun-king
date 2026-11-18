import { CLUBS } from './clubs.js';
import { RULES, rulesOf } from './rules.js';
export { RULES, rulesOf };
// sim.js — 홈런왕 규칙/물리 엔진 (서버 Durable Object와 브라우저 연습모드 공용)
// 좌표계: 홈플레이트 원점, +z = 중견수 방향, +x = 3루(좌익) 방향, y = 위. 포수 시점에서 1루가 오른쪽.
// 단위: m, 초, rad/s

// ═════════════ 상수 ═════════════
export const G = 9.8;
export const BASE_D = 27.43;
const H = BASE_D / Math.SQRT2;
export const BASES = [[0, 0], [-H, H], [0, 2 * H], [H, H]];
export const MOUND = [0, 18.44];
export const WALL_H = 2.6;
export const RUN_SPEED = 7.2; // 평균 주루 속도(예측·도루용)
export const RUN_TOP = 8.0; // 최고 속도: 정지 상태에서 ~1초 가속 → 타자 1루 도달 ~4.3초 (실제 MLB 평균)
export const TROT_SPEED = 6.5;
export const FIELD_SPEED = 6.7; // CPU 수비수 실효 이동 속도(판단·경로 손실 포함)
export const SPRINT_SPEED = 8.9;
export const THROW_SPEED = 31;
export const DRAG = 0.0062;
export const MAGNUS = 0.00049;
export const BALL_R = 0.037;
export const ZONE = { x0: -0.25, x1: 0.25, y0: 0.48, y1: 1.08 };
export const RELEASE = [0.45, 1.85, 17.0];
export const FOUL = Math.PI / 4;
export const TEMPO = 1.15; // 결과 대기 배율 (팝업 읽을 시간)
export const WINDUP = 1.85; // 세트 → 레그킥(정점에서 잠깐 멈춤) → 스트라이드 → 릴리스 (타자가 타이밍 잡을 수 있게)
export const POLE = [[100 * Math.sin(FOUL), 100 * Math.cos(FOUL)], [-100 * Math.sin(FOUL), 100 * Math.cos(FOUL)]];

// 잠실: 좌우 100m, 좌우중간 약 120m, 중앙 125m
export function fenceR(phi) {
  const a = Math.min(Math.abs(phi), FOUL);
  return 100 + 25 * Math.pow(Math.max(0, Math.cos(2 * a)), 0.8);
}
// 그라운드 바깥 경계(관중석 시작선)
export function standR(phi) {
  const a = Math.abs(phi);
  if (a <= FOUL) return fenceR(phi);
  if (a > 3 * Math.PI / 4) return 18 + 4 * (Math.PI - a) / (Math.PI / 4);
  return Math.max(18, Math.min(100, 22 / Math.sin(a - FOUL)));
}
// 지면 재질: 흙/잔디/워닝트랙
export function surface(x, z) {
  const r = Math.hypot(x, z), phi = Math.atan2(x, z);
  if (Math.abs(phi) <= FOUL && r > fenceR(phi) - 4.5) return 'dirt';
  if (Math.hypot(x - MOUND[0], z - MOUND[1]) < 2.75) return 'dirt';
  if (Math.hypot(x, z) < 4.2) return 'dirt';
  for (let i = 1; i < 4; i++) if (Math.hypot(x - BASES[i][0], z - BASES[i][1]) < 3.2) return 'dirt';
  if (Math.hypot(x - MOUND[0], z - MOUND[1]) < 29) {
    const k = 0.84 * H;
    if (Math.abs(x) / k + Math.abs(z - H) / k <= 1) return 'grass';
    return 'dirt';
  }
  return 'grass';
}

export const POS = ['P', 'C', '1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF'];
export const POS_KO = { P: '투수', C: '포수', '1B': '1루수', '2B': '2루수', SS: '유격수', '3B': '3루수', LF: '좌익수', CF: '중견수', RF: '우익수' };
export const HOME_SPOT = {
  P: [0, 18.44], C: [0, -1.25], '1B': [-20, 25.5], '2B': [-12, 39.5], SS: [11.5, 40],
  '3B': [20, 26], LF: [33, 83], CF: [0, 95], RF: [-33, 83], // 실제 수비 위치 깊이(메이저 평균)
};
const BUNT_SPOT = { '1B': [-14, 13], '3B': [14, 13] };
const HUMAN_ORDER = ['P', 'SS', 'CF', '2B', '3B', '1B', 'LF', 'RF', 'C'];

// 구종: v = km/h, brk = 홈플레이트 도달 시 변화량(m) [x(+3루쪽), y(+위)]
export const PITCHES = {
  // brk: 처음 겨냥한 선에서 홈플레이트까지 휘는 양(m, x+ = 3루 쪽/우타자 몸쪽, y- = 떨어짐)
  // k: 휘는 시점 (2 = 처음부터 둥글게, 클수록 끝에서 꺾임)
  FB: { name: '포심', v: 150, brk: [0.12, 0.22], k: 2.0, col: '#ff5a4f' },
  TS: { name: '투심', v: 145, brk: [0.5, -0.24], k: 2.4, col: '#ff9f43' },
  SL: { name: '슬라이더', v: 134, brk: [-0.8, -0.3], k: 3.0, col: '#4fc3ff' },
  CB: { name: '커브', v: 118, brk: [-0.38, -1.25], k: 2.0, col: '#b18cff' },
  CH: { name: '체인지업', v: 129, brk: [0.38, -0.64], k: 2.6, col: '#5be08f' },
  SP: { name: '스플리터', v: 137, brk: [0.04, -0.95], k: 3.4, col: '#ffd23a' },
  BP: { name: '배팅볼', v: 112, brk: [0, -0.12], k: 2.0, col: '#ffffff' },
};
export const PITCH_KEYS = ['FB', 'TS', 'SL', 'CB', 'CH', 'SP'];
// bat: CPU 타자 실력(낮을수록 잘 침), whiff: CPU 헛스윙 기본확률, pitchT: 투구 체감 속도(1=실제)
export const DIFF = [
  { name: '쉬움', bat: 1.35, whiff: 0.36, eye: 0.6, pitchErr: 0.085, zone: 0.62, react: 0.5, read: 1.0, err: 0.022, speed: 0.92, pitchT: 0.68 },
  { name: '보통', bat: 1.0, whiff: 0.29, eye: 0.8, pitchErr: 0.06, zone: 0.51, react: 0.36, read: 0.8, err: 0.01, speed: 0.97, pitchT: 0.8 },
  { name: '어려움', bat: 0.8, whiff: 0.24, eye: 0.92, pitchErr: 0.04, zone: 0.5, react: 0.26, read: 0.6, err: 0.005, speed: 1.0, pitchT: 0.93 },
];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const r2 = (v) => Math.round(v * 100) / 100;
// 송구 시간: 짧은 송구는 빠르게, 60m 넘는 원거리 송구는 포물선이라 평균 속도가 떨어짐 (중계 플레이가 의미 있게)
const throwT = (d) => d / (THROW_SPEED + Math.min(d, 35) * 0.08 - Math.max(0, d - 45) * 0.06);

// ═════════════ 투구 궤적 ═════════════
// 겉보기 목표(목표-변화량)로 직선 진행하다 s^2로 꺾여 실제 목표에 도달 (늦게 꺾이는 변화구)
export function pitchPos(p, s) {
  const ax = p.tx - p.bx, ay = p.ty - p.by;
  const k = p.k || 2, e = s > 0 ? Math.pow(s, k) : 0;
  // 느린 공은 홈 근처에서 더 감속(체감) — z는 살짝 비선형
  const zs = s + (p.dc || 0) * s * (1 - s);
  return [
    RELEASE[0] + (ax - RELEASE[0]) * s + p.bx * e,
    RELEASE[1] + (ay - RELEASE[1]) * s + p.by * e,
    RELEASE[2] * (1 - zs),
  ];
}
export function inZone(x, y) {
  return x >= ZONE.x0 - BALL_R && x <= ZONE.x1 + BALL_R && y >= ZONE.y0 - BALL_R && y <= ZONE.y1 + BALL_R;
}

// ═════════════ 타격 판정 ═════════════
// dt = 스윙시각-도달시각(초, 음수=빠름), ax/ay = (배트중심-공) 오차(m)
export const SWING = {
  contact: { W: 0.11, R: 0.22, pow: 0.98, lift: 9 },
  power: { W: 0.085, R: 0.17, pow: 1.08, lift: 18 },
  bunt: { W: 0.3, R: 0.32 },
};
// 사람 타자 타격 난이도: 판정 폭 배율 / 공 체감 속도 배율 (0 쉬움, 1 보통, 2 어려움)
export const HIT_EASE = [1.78, 1.55, 1.12]; // 판정 폭(타이밍·배트 원) 배율: 쉬움 / 보통 / 어려움 (재개발: '아직 좀 어렵다' 피드백 → 보통 1.42→1.55)
export const HIT_SLOW = [1.14, 1.06, 1.0];
// human: 사람 타자 보정 켜기, hq/pull: 모드별(RULES) 맞힌 공 질 보정·스윗스팟 모으기
export function evalSwing(mode, dt, ax, ay, pitchV = 40, ease = 1, human = false, hq = 0.85, pull = 0.35) {
  const M0 = SWING[mode] || SWING.contact;
  const M = ease === 1 ? M0 : { ...M0, W: M0.W * ease, R: M0.R * ease };
  const d = Math.hypot(ax, ay);
  if (!isFinite(dt) || Math.abs(dt) > M.W || d > M.R) return null;
  if (mode === 'bunt') {
    const qa = 1 - d / M.R;
    let launch = clamp(-6 - (ay / M.R) * 42 + gauss() * 6, -35, 65);
    const spray = clamp(-(ax / M.R) * 38 + gauss() * 9, -75, 75);
    let v = 5.5 + 5 * (1 - qa) + rand(0, 3);
    if (launch > 35) v = rand(9, 14);
    return { v, launch, spray, q: qa, bunt: true };
  }
  const qt = 1 - Math.abs(dt) / M.W, qa = 1 - d / M.R;
  let q = Math.pow(qt, 0.5) * Math.pow(qa, 0.6);
  if (human) q = 1 - (1 - q) * hq; // 사람 타자: 맞힌 공의 질을 조금 후하게 (같은 실수라도 타구가 덜 죽음)
  if (q < 0.2 || (qt < 0.3 && Math.random() < 0.6)) return { v: rand(14, 24), launch: rand(25, 70), spray: (Math.random() < 0.5 ? -1 : 1) * rand(60, 125), q, foul: true };
  // 배트 끝/손잡이에 맞으면 빗맞은 타구
  if (qa < 0.3 && Math.random() < (human ? 0.55 : 0.7)) return { v: rand(18, 30), launch: ay > 0 ? rand(-20, 5) : human ? rand(18, 55) : rand(45, 75), spray: clamp(-(dt / M.W) * 40 + gauss() * 12, -78, 78), q: q * 0.5 };
  // 타구 속도: 메이저리그 인플레이 타구 분포(중앙값 ~146km/h, 상위10% ~167km/h, 최고 ~190km/h)에 맞춤
  const v = (31.5 + 20.2 * q) * M.pow + 0.1 * (pitchV - 35) + rand(-1.2, 1.2);
  let launch = clamp(M.lift - (ay / M.R) * (human ? 32 : 42) + gauss() * (human ? 5 : 6), -25, 70);
  // 사람 타자: 잘 맞힌 공(q>0.55)은 '스윗스팟(10~25°)' 쪽으로 살짝 모아줌 → 정타가 뜬공 아웃보다 라인드라이브가 되게
  if (human && q > 0.55) launch += (15 - launch) * Math.min(pull, (q - 0.55) * 0.9);
  const spray = clamp(-(dt / M.W) * 52 - (ax / M.R) * 20 + 5 + gauss() * 12, -78, 78); // 우타자: 빠르면 당겨서 좌측(+x)
  return { v, launch, spray, q };
}
// 타구 초기 상태 (속도 + 스핀)
export function battedBall(x, y, res) {
  const L = res.launch * Math.PI / 180, S = res.spray * Math.PI / 180;
  const dx = Math.sin(S), dz = Math.cos(S);
  // 실측(스탯캐스트) 경향: 발사각이 높을수록 백스핀↑ (라인드라이브 ~1500rpm, 플라이 ~2500rpm, 팝업 3500+), 땅볼은 탑스핀
  const la = res.launch;
  let rpm = la < 0 ? -900 + la * 20 : la < 16 ? 200 + la * 28 : Math.min(4200, Math.max(650, SPIN_A + la * SPIN_B));
  rpm *= 0.85 + Math.random() * 0.3;
  if (res.bunt) rpm = -200;
  const back = rpm * Math.PI / 30;
  // 사이드 스핀: 당긴 타구는 파울라인 쪽으로 휘고(훅), 밀어친 타구도 파울라인 쪽으로 휨(슬라이스)
  const side = clamp(res.spray / 40, -1.3, 1.3) * 600 * Math.PI / 30 * (la > 5 ? 1 : 0.3);
  return {
    x, y: Math.max(0.3, y), z: 0.3,
    vx: res.v * Math.cos(L) * dx, vy: res.v * Math.sin(L), vz: res.v * Math.cos(L) * dz,
    sx: back * -dz, sy: side, sz: back * dx,
    state: 'air',
  };
}

// ═════════════ 공 물리 ═════════════
// 실제 공기역학 (야구공 질량 145g, 반지름 3.66cm, 잠실 해수면 공기밀도 1.19)
//  항력 a = -K·Cd·|v|·v,  양력(마그누스) a = K·CL·|v|·(ω̂ × v),  K = ρA/2m
//  CL = 1/(2.32 + 0.4/S), S = rω/v  (Sawicki·Nathan 모델) · 스핀은 비행 중 서서히 감쇠(τ≈30s)
//  스핀 단위: rad/s (2500rpm ≈ 262)
const AIR_K = 0.5 * 1.19 * Math.PI * 0.0366 * 0.0366 / 0.145;
export let AERO_CD = 0.28, AERO_CL = 0.8, AERO_CDV = 0.012; // 스탯캐스트 비거리·체공시간에 맞춘 값
export let SPIN_A = -1100, SPIN_B = 110; // 비거리+체공시간 둘 다 스탯캐스트 평균에 맞춘 값 (직선타 15° 100mph: 92m · 2.8초)
export function setAero(cd, cl, cdv = 0, sa, sb) { AERO_CD = cd; AERO_CL = cl; AERO_CDV = cdv; if (sa != null) { SPIN_A = sa; SPIN_B = sb; } }
function aero(b, dt) {
  const v = Math.hypot(b.vx, b.vy, b.vz);
  if (v < 0.3) return;
  const w = Math.hypot(b.sx || 0, b.sy || 0, b.sz || 0);
  const Sp = w > 0 ? 0.0366 * w / v : 0;
  const cd = Math.max(0.2, AERO_CD - AERO_CDV * (v - 40)) + 0.1 * Math.min(Sp, 0.3); // 빠를수록 항력계수↓(실측), 스핀 많을수록 약간↑
  const kd = AIR_K * cd * v;
  let ax = -kd * b.vx, ay = -kd * b.vy, az = -kd * b.vz;
  if (Sp > 0 && b.state === 'air') {
    const cl = AERO_CL / (2.32 + 0.4 / Sp), kl = AIR_K * cl * v / w;
    ax += kl * (b.sy * b.vz - b.sz * b.vy);
    ay += kl * (b.sz * b.vx - b.sx * b.vz);
    az += kl * (b.sx * b.vy - b.sy * b.vx);
    const sd = Math.exp(-dt / 30); b.sx *= sd; b.sy *= sd; b.sz *= sd;
  }
  b.vx += ax * dt; b.vy += ay * dt; b.vz += az * dt;
}
// 사건 리턴: landed/wall/over/pole. world=false면 순수 비행만(비거리 추정용)
export function integrate(b, dt, world = true) {
  const ev = { landed: false, wall: false, over: false, pole: false, surf: null, impact: 0 };
  b.vy -= G * dt;
  if (b.state === 'thrown') {
    const sp = Math.hypot(b.vx, b.vy, b.vz), k = 1 - DRAG * 0.5 * sp * dt;
    b.vx *= k; b.vy *= k; b.vz *= k;
  } else if (b.state === 'air' || b.y > 0.06) aero(b, dt);
  const r0 = Math.hypot(b.x, b.z);
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  if (!world) return ev;
  const r = Math.hypot(b.x, b.z), phi = Math.atan2(b.x, b.z);
  // 폴대
  for (const p of POLE) if (b.y < 30 && b.y > WALL_H && dist2(b.x, b.z, p[0], p[1]) < 0.4) ev.pole = true;
  // 외야 펜스 (안쪽에서 바깥으로 넘어갈 때만)
  if (Math.abs(phi) <= FOUL + 0.004) {
    const R = fenceR(phi);
    if (r >= R - 0.12 && r0 < R + 0.3) {
      if (b.y > WALL_H) { if (r >= R) ev.over = true; }
      else {
        const nx = b.x / r, nz = b.z / r, vr = b.vx * nx + b.vz * nz;
        if (vr > 0) {
          ev.impact = vr;
          const e = b.y > WALL_H - 0.25 ? 0.25 : 0.42; // 펜스 꼭대기 맞으면 힘 빠짐
          b.vx -= (1 + e) * vr * nx; b.vz -= (1 + e) * vr * nz;
          b.vx *= 0.8; b.vz *= 0.8; b.vy *= 0.75;
          b.sx = b.sy = b.sz = 0;
        }
        b.x = nx * (R - 0.15); b.z = nz * (R - 0.15);
        ev.wall = true;
      }
    }
  }
  // 지면
  if (b.y <= BALL_R) {
    b.y = BALL_R;
    const surf = surface(b.x, b.z);
    ev.surf = surf;
    const vh = Math.hypot(b.vx, b.vz);
    if (b.vy < 0) {
      ev.landed = true;
      const vin = -b.vy;
      ev.impact = vin;
      const e = (surf === 'dirt' ? 0.42 : 0.36) * (vin > 15 ? 0.82 : 1);
      const mu = surf === 'dirt' ? 0.38 : 0.46;
      b.vy = vin * e;
      if (vh > 0) {
        // 마찰 충격량: 가파르게 떨어질수록 수평속도 손실 큼. 스핀이 방향 성분에 영향
        const spinBoost = (b.sx * b.vz - b.sz * b.vx) / (vh || 1) * 0.004; // 탑스핀 → 가속, 백스핀 → 감속
        const dv = Math.min(vh * 0.5, mu * (1 + e) * vin * 0.55) - spinBoost;
        const s = clamp((vh - dv) / vh, 0.35, 1.08);
        b.vx *= s; b.vz *= s;
      }
      b.sx *= 0.4; b.sy *= 0.3; b.sz *= 0.4;
      if (b.vy < 1.3) b.vy = 0; // 잔 바운드는 구르기로 (떨림 방지)
      if (b.state === 'air' || b.state === 'thrown') b.state = 'ground';
    }
    if (b.vy === 0) {
      // 굴러감: 구름저항 + 속도비례 저항
      const dec = (surf === 'dirt' ? 2.6 : 4.6) + (surf === 'dirt' ? 0.06 : 0.12) * vh;
      const ns = Math.max(0, vh - dec * dt);
      if (vh > 0) { b.vx *= ns / vh; b.vz *= ns / vh; }
    }
  }
  return ev;
}
// 펜스 무시 비행 비거리
export function carry(b0) {
  const b = { ...b0, state: 'air' };
  for (let i = 0; i < 1500 && b.y > 0; i++) integrate(b, 1 / 120, false);
  return Math.round(Math.hypot(b.x, b.z));
}

export function runnerXZ(b) {
  const i = Math.floor(b), f = b - i;
  const a = BASES[i % 4], c = BASES[(i + 1) % 4];
  return [a[0] + (c[0] - a[0]) * f, a[1] + (c[1] - a[1]) * f];
}

export const DEFAULT_SETTINGS = {
  name: '', mode: 'game', innings: 3, derbyOuts: 10, diff: 1, max: 12, pub: true, teams: ['서울 나이츠', '부산 하버스'],
  size: 0, // 팀당 인원 제한 (0=자유, 1·2·3 = 1:1·2:2·3:3)
  lineup: 'humans', // humans: 사람만 돌아가며 타격 · nine: 9인 타순(빈 타순은 CPU)
  pitRot: 'inning', // inning: 이닝마다 투수 교대 · batter: 타자마다 교대 · fixed: 고정 · cpu: CPU 투수
  fieldCtl: 'pos', // auto: 공 가까운 수비수로 자동 전환 · pos: 내 포지션만
  clubs: [0, 1],
  tod: 'night', // 경기 시간대: night | day
  hitEase: 1, // 사람 타격 난이도 0 쉬움 1 보통 2 어려움
  rules: 'real', // 'real' 리얼 | 'casual' 캐주얼 (shared/rules.js)
  timeLim: 0, // 시간제(분): 지나면 진행 중 이닝이 마지막 이닝. 0 = 없음
};
export const CLUB_N = CLUBS.length;

// ═════════════ 게임 ═════════════
export class Game {
  constructor(opts = {}) {
    this.emit = opts.emit || (() => {});
    this.sendTo = opts.sendTo || (() => {});
    this.onKick = opts.onKick || (() => {});
    this.onChange = opts.onChange || (() => {});
    this.onGameOver = opts.onGameOver || (() => {});
    this.players = new Map();
    this.joinSeq = 0;
    this.hostId = null;
    this.set = { ...DEFAULT_SETTINGS, teams: [...DEFAULT_SETTINGS.teams], clubs: [...DEFAULT_SETTINGS.clubs] };
    this.password = '';
    this.phase = 'lobby';
    this.now = 0;
    this.seq = 0;
    this.msg = ''; this.msgId = 0; this.msgBig = false;
    this.fielders = [];
    this.runners = [];
    this.ball = null;
    this.pitch = null;
    this.play = null;
    this.stats = new Map(); this.pstats = new Map(); this.pa0 = null;
    this.stam = new Map();
    this.events = []; // 게임 이벤트 (docs/rebuild/events.md) — snapshot(true)가 ev 로 실어 보내고 비움
    if (opts.rules && RULES[opts.rules]) { this.set.rules = opts.rules; this.set.innings = RULES[opts.rules].innings; }
  }
  get mode() { return this.set.mode; }
  get innings() { return this.innLim || this.set.innings; }
  get R() { return rulesOf(this.set.rules); }
  // 이벤트 발생: UI·애니메이션·사운드는 구독만 한다. 아무도 안 가져가면(테스트·AI 경기) 오래된 것부터 버림
  ev(e, d) { const o = { e, at: r2(this.now), ...d }; this.events.push(o); if (this.events.length > 400) this.events.splice(0, this.events.length - 300); return o; }
  takeEvents() { const a = this.events; this.events = []; return a; }
  get D() { return DIFF[this.set.diff] || DIFF[1]; }

  // ───────── 플레이어 ─────────
  addPlayer(id, name) {
    const cnt = { away: 0, home: 0 };
    for (const p of this.players.values()) if (cnt[p.team] !== undefined) cnt[p.team]++;
    const cap = this.teamCap();
    let team = this.phase !== 'lobby' ? 'spec' : cnt.away <= cnt.home ? 'away' : 'home';
    if (team !== 'spec' && cnt[team] >= cap) team = cnt.away < cap ? 'away' : cnt.home < cap ? 'home' : 'spec';
    this.players.set(id, { id, name: String(name || '선수').slice(0, 12), team, order: this.joinSeq++, ready: false, pos: 'any', bo: 0, ping: 0, conn: true, dcAt: 0 });
    if (!this.hostId) this.hostId = id;
    this.emitLobby();
    if (this.phase !== 'lobby') this.say(`${this.players.get(id).name} 관전 입장`, false);
  }
  disconnect(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (this.phase === 'lobby' || this.phase === 'over' || p.team === 'spec') return this.removePlayer(id);
    p.conn = false; p.dcAt = this.now;
    this.say(`${p.name} 연결 끊김 · CPU가 대신함`, false);
    if (this.hostId === id) this.pickHost();
    this.emitLobby();
  }
  reconnect(id) {
    const p = this.players.get(id);
    if (!p) return false;
    p.conn = true;
    this.say(`${p.name} 재접속`, false);
    if (!this.players.get(this.hostId)?.conn) this.hostId = id;
    this.emitLobby();
    return true;
  }
  removePlayer(id) {
    const p = this.players.get(id);
    this.players.delete(id);
    if (this.hostId === id) this.pickHost();
    for (const f of this.fielders) if (f.ctrl === id) f.ctrl = null;
    if (p && this.phase !== 'lobby') this.say(`${p.name} 퇴장`, false);
    this.emitLobby();
  }
  pickHost() {
    const next = [...this.players.values()].filter((p) => p.conn).sort((a, b) => a.order - b.order)[0];
    this.hostId = next ? next.id : null;
  }
  teamCap() { return this.set.size ? this.set.size : Math.max(1, Math.ceil(this.set.max / 2)); }
  teamCount(team, except) { let n = 0; for (const p of this.players.values()) if (p.team === team && p.id !== except) n++; return n; }
  isLive(id) { const p = id && this.players.get(id); return !!(p && p.conn); }
  lobbyState() {
    return {
      t: 'lobby', host: this.hostId, phase: this.phase, set: this.set, locked: !!this.password,
      players: [...this.players.values()].sort((a, b) => a.order - b.order)
        .map((p) => ({ id: p.id, name: p.name, team: p.team, ready: p.ready, pos: p.pos, bo: p.bo, ping: p.ping, conn: p.conn })),
    };
  }
  emitLobby() { this.emit(this.lobbyState()); this.onChange(); }
  humans(team) { return [...this.players.values()].filter((p) => p.team === team).sort((a, b) => a.order - b.order); }
  activeCount() { return [...this.players.values()].filter((p) => p.team !== 'spec').length; }

  handle(id, m) {
    if (!m || typeof m !== 'object') return;
    const p = this.players.get(id);
    if (!p) return;
    const host = id === this.hostId;
    const inLobby = this.phase === 'lobby';
    switch (m.t) {
      case 'ping': this.sendTo(id, { t: 'pong', c: m.c }); break;
      case 'rtt': p.ping = clamp(m.ms | 0, 0, 9999); break;
      case 'team':
        if (inLobby && ['away', 'home', 'spec'].includes(m.team) && m.team !== p.team) {
          if (m.team !== 'spec' && this.teamCount(m.team, id) >= this.teamCap()) { this.sendTo(id, { t: 'toast', text: '그 팀은 자리가 꽉 찼어' }); break; }
          p.team = m.team; p.ready = false; p.bo = 0; this.emitLobby();
        }
        break;
      case 'bo': // 타순 선택 (0 = 자동)
        if (inLobby) {
          const v = clamp(m.bo | 0, 0, 9);
          if (v) for (const q of this.players.values()) if (q !== p && q.team === p.team && q.bo === v) q.bo = p.bo; // 겹치면 자리 바꿈
          p.bo = v; this.emitLobby();
        }
        break;
      case 'club': // 우리 팀 구단 고르기 (팀원 누구나, 방장은 양쪽)
        if (inLobby) {
          const ti = m.side === 'home' ? 1 : m.side === 'away' ? 0 : -1, c = m.club | 0;
          if (ti >= 0 && c >= 0 && c < CLUB_N && (host || p.team === (ti ? 'home' : 'away')) && this.set.clubs[1 - ti] !== c) { this.set.clubs[ti] = c; this.set.teams[ti] = CLUBS[c].name; this.emitLobby(); }
        }
        break;
      case 'sw': this.onSwitch(id); break;
      case 'ppick': if (this.dy && this.dy.pr && (m.type === 'MIX' || PITCH_KEYS.includes(m.type))) { this.ppick = m.type; this.say(m.type === 'MIX' ? '연습 구종: 섞어서' : `연습 구종: ${PITCHES[m.type].name || m.type}`, false); } break;
      case 'ready': if (inLobby) { p.ready = !!m.on; this.emitLobby(); } break;
      case 'pos': if (inLobby && (m.pos === 'any' || POS.includes(m.pos))) { p.pos = m.pos; this.emitLobby(); } break;
      case 'name': {
        const n = String(m.name || '').trim().slice(0, 12);
        if (n && inLobby) { p.name = n; this.emitLobby(); }
        break;
      }
      case 'set':
        if (host && inLobby) { this.applySettings(m); this.emitLobby(); }
        break;
      case 'kick':
        if (host && m.id !== id && this.players.has(m.id)) {
          const k = this.players.get(m.id);
          this.sendTo(m.id, { t: 'kicked' });
          this.removePlayer(m.id);
          this.onKick(m.id);
          this.say(`${k.name} 강퇴`, false);
        }
        break;
      case 'host': if (host && this.players.has(m.id)) { this.hostId = m.id; this.emitLobby(); } break;
      case 'start':
        if (host && (inLobby || this.phase === 'over')) this.start();
        break;
      case 'lobby':
        if (host && this.phase !== 'lobby') this.toLobby();
        break;
      case 'pitch': this.onPitch(id, m); break;
      case 'swing': this.onSwing(id, m); break;
      case 'bunt': if (this.batter && this.batter.id === id && (this.phase === 'pitch' || (this.phase === 'pitching' && this.now < this.pitch.t0))) this.buntStance = !!m.on; break;
      case 'steal': this.onSteal(id); break;
      case 'pick': this.onPick(id, m); break;
      case 'mv': this.onMove(id, m); break;
      case 'jump': this.onJump(id); break;
      case 'dive': this.onDive(id, m); break;
      case 'throw': this.onThrow(id, m); break;
      case 'run': this.onRunCmd(id, m); break;
      case 'slide': this.onSlideCmd(id); break;
      case 'chat': {
        const text = String(m.text || '').slice(0, 80).trim();
        if (text) this.emit({ t: 'chat', id, name: p.name, text, team: p.team });
        break;
      }
    }
  }
  applySettings(m) {
    const s = this.set;
    if (typeof m.name === 'string') s.name = m.name.trim().slice(0, 24);
    if (m.mode === 'game' || m.mode === 'derby') { s.mode = m.mode; s.practice = false; }
    if (m.mode === 'practice') { s.mode = 'derby'; s.practice = true; } // 타격 연습 = 끝없는 더비 + 실전 구종
    if (m.innings != null) s.innings = clamp(m.innings | 0, 1, 9);
    if (m.derbyOuts != null) s.derbyOuts = clamp(m.derbyOuts | 0, 3, 20);
    if (m.diff != null) s.diff = clamp(m.diff | 0, 0, 2);
    if (m.max != null) s.max = clamp(m.max | 0, 2, 18);
    if (m.size != null) { s.size = clamp(m.size | 0, 0, 3); if (s.size) s.max = s.size * 2; this.rebalance(); }
    if (m.lineup === 'humans' || m.lineup === 'nine') s.lineup = m.lineup;
    if (['inning', 'batter', 'fixed', 'cpu'].includes(m.pitRot)) s.pitRot = m.pitRot;
    if (m.fieldCtl === 'auto' || m.fieldCtl === 'pos') s.fieldCtl = m.fieldCtl;
    if (m.tod === 'day' || m.tod === 'night') s.tod = m.tod;
    if (m.hitEase != null) s.hitEase = clamp(m.hitEase | 0, 0, 2);
    if (Array.isArray(m.clubs)) { const a = clamp(m.clubs[0] | 0, 0, CLUB_N - 1), b = clamp(m.clubs[1] | 0, 0, CLUB_N - 1); if (a !== b) { s.clubs = [a, b]; if (!Array.isArray(m.teams)) s.teams = [CLUBS[a].name, CLUBS[b].name]; } }
    if (m.pub != null) s.pub = !!m.pub;
    if (Array.isArray(m.teams)) s.teams = [0, 1].map((i) => String(m.teams[i] || DEFAULT_SETTINGS.teams[i]).trim().slice(0, 8) || DEFAULT_SETTINGS.teams[i]);
    if (typeof m.pw === 'string') this.password = m.pw.slice(0, 20);
    if (RULES[m.rules] && m.rules !== s.rules) {
      s.rules = m.rules;
      if (m.innings == null) s.innings = RULES[m.rules].innings;
      this.ev('modeChange', { rules: s.rules, innings: s.innings });
    }
    if (m.timeLim != null) s.timeLim = clamp(m.timeLim | 0, 0, 60);
    if (this.R.forceAutoField) s.fieldCtl = 'auto';
  }
  // 인원 제한이 줄면 넘치는 사람은 반대팀/관전으로
  rebalance() {
    const cap = this.teamCap();
    for (const t of ['away', 'home']) {
      const hs = this.humans(t);
      for (const h of hs.slice(cap)) { const o = t === 'away' ? 'home' : 'away'; h.team = this.teamCount(o) < cap ? o : 'spec'; h.ready = false; h.bo = 0; }
    }
  }
  toLobby() {
    this.phase = 'lobby';
    this.ball = null; this.pitch = null; this.play = null; this.fielders = []; this.runners = [];
    for (const [id, p] of [...this.players]) { p.ready = false; if (!p.conn) this.players.delete(id); }
    this.emitLobby();
  }

  say(text, big = true) { this.msg = text; this.msgBig = big; this.msgId++; }

  // ───────── 경기 흐름 ─────────
  start() {
    this.phase = 'starting';
    this.score = [0, 0];
    this.inning = 1; this.half = 0;
    this.lineIdx = { away: 0, home: 0 };
    this.halfCount = { away: 0, home: 0 };
    this.lineup = { away: [], home: [] };
    this.line = [[], []];
    this.hits = [0, 0];
    this.errs = [0, 0];
    this.stats = new Map(); this.pstats = new Map(); this.pa0 = null;
    this.stam = new Map();
    this.ball = null; this.pitch = null; this.play = null; this.walkoff = false;
    this.lastPitch = null; this.lastHit = null; this.hrEv = null;
    this.innLim = 0; this.startT = this.now; this.mercy = false;
    if (this.R.forceAutoField) this.set.fieldCtl = 'auto';
    for (const p of this.players.values()) p.ready = false;
    this.ev('modeChange', { rules: this.set.rules, mode: this.mode, innings: this.set.innings, start: 1 });
    this.emitLobby();
    if (this.mode === 'derby') return this.startDerby();
    this.startHalf();
  }
  get batTeam() { return this.half === 0 ? 'away' : 'home'; }
  get fieldTeam() { return this.half === 0 ? 'home' : 'away'; }

  startHalf() {
    this.outs = 0;
    this.runners = [];
    this.halfRuns = 0;
    this.walkoff = false;
    // 포지션 배정: 선호 포지션 우선, 나머지는 이닝마다 투수가 돌아가게
    const humans = this.humans(this.fieldTeam);
    const rotMode = this.set.pitRot;
    const order = rotMode === 'cpu' ? HUMAN_ORDER.filter((q) => q !== 'P') : HUMAN_ORDER;
    const taken = new Map();
    // 이닝/타자 교대 모드면 투수는 사람끼리 돌아가며 (선호 포지션보다 우선)
    const pc = humans.filter((h) => h.pos === 'any' || h.pos === 'P'); // 다른 포지션 고른 사람은 투수 순번에서 빠짐
    if ((rotMode === 'inning' || rotMode === 'batter') && pc.length) {
      const k = this.halfCount[this.fieldTeam]++ % pc.length;
      taken.set('P', pc[k].id);
    }
    for (const h of humans) if (h.pos !== 'any' && !taken.has(h.pos) && ![...taken.values()].includes(h.id) && !(rotMode === 'cpu' && h.pos === 'P')) taken.set(h.pos, h.id);
    let rest = humans.filter((h) => ![...taken.values()].includes(h.id)).map((h) => h.id);
    for (const pos of order) if (!taken.has(pos) && rest.length) taken.set(pos, rest.shift());
    this.fielders = POS.map((pos) => { const f = this.mkFielder(pos, taken.get(pos) || null); f.home = f.ctrl; return f; });
    this.buildLineup(this.batTeam);
    for (const st of this.stam.values()) st.sta = Math.min(100, st.sta + 12);
    // 시간제: 제한 시간이 지난 뒤 시작하는 이닝이 마지막 이닝
    const lim = (this.set.timeLim || this.R.timeLim) * 60;
    let lastNote = '';
    if (lim && this.half === 0 && !this.innLim && this.inning > 1 && this.inning < this.set.innings && this.now - this.startT >= lim) { this.innLim = this.inning; lastNote = ' · 시간 종료, 마지막 이닝!'; }
    this.say(`${this.inning}회${this.half === 0 ? '초' : '말'} · ${this.set.teams[this.half]} 공격${lastNote}`);
    this.ev('inningStart', { inning: this.inning, half: this.half, last: this.inning >= this.innings ? 1 : 0, extra: this.inning > this.innings ? 1 : 0 });
    this.nextBatter();
    // 연장 승부치기: 정해진 루에 주자를 두고 시작
    if (this.mode === 'game' && this.inning > this.innings && this.R.ghost) {
      for (const b of this.R.ghost) this.runners.push({ rid: ++this.seq, pid: null, name: '승부치기 주자', b, target: b, start: b, forced: false, mustReturn: false, out: false, scored: false, manual: 0, batter: false, steal: false, trot: false });
      this.say(`${this.inning}회${this.half === 0 ? '초' : '말'} · 승부치기 (무사 ${this.R.ghost.join('·')}루)`);
    }
    this.pause(2.4, 'pitch');
  }
  mkFielder(pos, ctrl) {
    return { pos, x: HOME_SPOT[pos][0], z: HOME_SPOT[pos][1], ry: pos === 'C' ? 0 : Math.atan2(-HOME_SPOT[pos][0], -HOME_SPOT[pos][1]), ctrl, act: -99, mv: 0, jt: -99, dv: -99, dvx: 0, dvz: 0, fum: -99, lastMvT: 0 };
  }

  nextBatter() {
    this.closePA();
    const team = this.batTeam;
    const hs = this.humans(team).sort((a, b) => (a.bo || 99) - (b.bo || 99) || a.order - b.order);
    const n = this.lineIdx[team] + 1, slot = ((n - 1) % 9) + 1;
    if (this.set.lineup === 'nine' && this.mode === 'game') {
      const id = (this.lineup[team] || [])[slot - 1];
      const h = id && this.players.get(id);
      this.batter = h ? { id: h.id, name: h.name, n, slot } : { id: null, name: `CPU ${slot}번`, n, slot };
    } else if (hs.length) {
      const h = hs[this.lineIdx[team] % hs.length];
      this.batter = { id: h.id, name: h.name, n, slot: (this.lineIdx[team] % hs.length) + 1 };
    } else {
      this.batter = { id: null, name: `CPU ${slot}번`, n, slot };
    }
    this.lineIdx[team]++;
    if (this.set.pitRot === 'batter' && this.mode === 'game' && this.fielders.length && n > 1) this.rotatePitcher();
    [this.balls, this.strikes] = this.mode === 'game' ? this.R.startCount : [0, 0];
    this.pickCount = 0; this.seqHist = [];
    this.buntStance = false;
    this.openPA();
    this.ev('batterUp', { id: this.batter.id, name: this.batter.name, n: this.batter.n, slot: this.batter.slot, team: team, cnt: [this.balls, this.strikes] });
  }
  // 9인 타순: 지정한 타순 우선, 나머지 사람은 빈 타순 앞에서부터
  buildLineup(team) {
    if (!this.lineup) this.lineup = { away: [], home: [] };
    const L = new Array(9).fill(null), hs = this.humans(team);
    for (const h of hs) if (h.bo && !L[h.bo - 1]) L[h.bo - 1] = h.id;
    let k = 0;
    for (const h of hs) if (!L.includes(h.id)) { while (k < 9 && L[k]) k++; if (k < 9) L[k] = h.id; }
    this.lineup[team] = L;
  }
  // 타자마다 투수 교대: 수비팀 사람끼리 투수 자리를 넘김
  rotatePitcher() {
    const hs = this.humans(this.fieldTeam).filter((h) => h.conn && (h.pos === 'any' || h.pos === 'P'));
    if (hs.length < 2) return;
    const P = this.fielders.find((f) => f.pos === 'P');
    if (!hs.some((h) => h.id === P.home)) return;
    const i = hs.findIndex((h) => h.id === P.home);
    const next = hs[(i + 1) % hs.length].id;
    const g = this.fielders.find((f) => f.home === next);
    const cur = P.home;
    P.home = P.ctrl = next;
    if (g) g.home = g.ctrl = cur;
  }
  // 수동 전환: 공(또는 타구 예상 지점)에 가장 가까운, 다른 사람이 안 잡은 수비수로
  onSwitch(id) {
    if (this.phase !== 'live' || !this.ball) return;
    const p = this.players.get(id);
    if (!p || p.team !== this.fieldTeam) return;
    const cur = this.ctrlFielder(id);
    if (cur >= 0 && this.ball.holder === cur) return;
    const b = this.ball, tgt = this.play && this.play.chasePt && b.holder < 0 ? [this.play.chasePt[0], this.play.chasePt[2]] : [b.x, b.z];
    let best = -1, bd = 1e9;
    for (let i = 0; i < this.fielders.length; i++) {
      const f = this.fielders[i];
      if (i === cur || (f.ctrl && f.ctrl !== id && this.isLive(f.ctrl))) continue;
      const d = dist2(f.x, f.z, tgt[0], tgt[1]);
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0) this.giveCtrl(id, best);
  }
  giveCtrl(id, i) {
    const cur = this.ctrlFielder(id);
    if (cur === i) return;
    if (cur >= 0) this.fielders[cur].ctrl = null;
    const f = this.fielders[i];
    f.ctrl = id; f.act = this.now - 2; f.swT = this.now;
    (this.play || {}).sw = this.now;
  }
  // 자동 전환: 쫓아가는 수비수/송구 받는 수비수를 사람에게
  autoSwitch() {
    if (this.set.fieldCtl !== 'auto' || !this.play || !this.ball) return;
    const b = this.ball, P = this.play;
    let target = -1;
    if (b.holder >= 0) target = b.holder;
    else if (b.state === 'thrown') { let bd = 1e9; for (let i = 0; i < this.fielders.length; i++) { if (i === b.thrower) continue; const d = dist2(this.fielders[i].x, this.fielders[i].z, b.tx, b.tz); if (d < bd) { bd = d; target = i; } } }
    else {
      // 타구 쫓기는 플레이당 한 번(타구 직후)만 자동 전환 — 계속 바뀌면 헷갈림
      if (P.autoChaseDone && !(P.chaser >= 0 && this.now - (P.sw || 0) > 2.5 && this.humanIdleAll())) return;
      target = P.chaser;
    }
    if (target < 0) return;
    const tf = this.fielders[target];
    if (tf.ctrl && this.isLive(tf.ctrl)) return;
    // 공을 던진 사람이 받는 사람으로 따라감, 아니면 가장 오래 안 움직인 팀원
    const hs = this.humans(this.fieldTeam).filter((h) => h.conn).map((h) => h.id);
    if (!hs.length) return;
    let pick = null;
    if (b.state === 'thrown' && b.thrower >= 0) { const tc = this.fielders[b.thrower].ctrl; if (tc && hs.includes(tc)) pick = tc; }
    if (!pick) {
      let best = 1e9;
      for (const id of hs) {
        const ci = this.ctrlFielder(id), f = ci >= 0 ? this.fielders[ci] : null;
        if (f && (b.holder === ci || this.now - (f.swT || -9) < 1.5)) continue; // 공 든 사람/방금 바꾼 사람은 그대로
        if (f && this.now - f.act < 0.6 && f.act > (f.swT || -9)) continue; // 직접 움직이는 중이면 안 뺏음
        const d = f ? dist2(f.x, f.z, tf.x, tf.z) : 0;
        if (d < best) { best = d; pick = id; }
      }
    }
    if (pick) { this.giveCtrl(pick, target); if (b.holder < 0 && b.state !== 'thrown') P.autoChaseDone = true; }
  }
  humanIdleAll() { return !this.fielders.some((f) => f.ctrl && this.isLive(f.ctrl) && this.now - f.act < 1.2 && f.act > (f.swT || -9)); }
  restoreCtrl() { for (const f of this.fielders) { f.ctrl = f.home ?? f.ctrl; f.swT = -9; } }
  batterIsCPU() { return !this.batter.id || !this.isLive(this.batter.id); }

  // 상황별 수비 위치: 1루 주자 + 2아웃 전 = 병살 대형(2루수·유격수 2루 쪽으로), 3루 주자 + 2아웃 전 + 접전/후반 = 전진 수비
  spotOf(pos) {
    const hs = HOME_SPOT[pos];
    if (this.mode !== 'game' || this.outs >= 2) return hs;
    const on = (k) => this.runners.some((r) => !r.out && !r.scored && (r.target ?? r.b) === k);
    const close = Math.abs(this.score[0] - this.score[1]) <= 1 && this.inning >= Math.max(2, (this.set.innings || 9) - 2);
    if (on(3) && close) {
      const IN = { '1B': [-17, 22], '3B': [17, 22.5], '2B': [-10, 31.5], SS: [10, 31.5] };
      if (IN[pos]) return IN[pos];
    }
    if (on(1)) { const DP = { '2B': [-9.5, 36.5], SS: [9, 37] }; if (DP[pos]) return DP[pos]; }
    return hs;
  }
  resetFielders() {
    this.restoreCtrl();
    for (const f of this.fielders) {
      const hs = f.shift && f.ctrl && this.isLive(f.ctrl) ? f.shift : this.spotOf(f.pos);
      f.x = hs[0]; f.z = hs[1]; f.mv = 0; f.jt = f.dv = f.fum = -99;
      f.ry = f.pos === 'C' ? 0 : Math.atan2(-hs[0], -hs[1]);
    }
  }

  enterPitch() {
    this.phase = 'pitch';
    this.pitch = null; this.ball = null; this.aiSwing = null; this.play = null;
    this.resetFielders();
    this.runners = this.runners.filter((r) => !r.out && !r.scored && !r.trot).map((r) => ({ ...r, b: r.target, start: r.target, forced: false, mustReturn: false, manual: 0, steal: false, trot: false }));
    const pc = this.pitcherCtrl();
    this.pitchDeadline = this.now + (this.isLive(pc) ? 15 : this.mode === 'derby' ? 1.0 : rand(1.4, 2.3));
    this.pickTried = false;
    if (this.mode === 'game' && this.balls === 0 && this.strikes === 0 && !this.isLive(pc)) this.pitchDeadline += 2.0; // 타자 등장 컷씬 시간
    if (this.mode === 'derby' && !this.isLive(this.batter.id)) { this.dy.order[this.dy.idx].done = true; this.derbyNext(); return; }
    // CPU 번트 판단: 무사 1루, 하위타선
    if (this.mode === 'game' && this.batterIsCPU() && this.outs === 0 && this.runners.some((r) => r.b === 1) && !this.runners.some((r) => r.b === 2) && Math.random() < 0.12) this.buntStance = true;
  }

  pitcherCtrl() { const f = this.fielders.find((x) => x.pos === 'P'); return f ? f.ctrl : null; }
  pitcherKey() { const c = this.pitcherCtrl(); return this.isLive(c) ? c : 'cpu:' + this.fieldTeam; }
  stamina() {
    const k = this.pitcherKey();
    let st = this.stam.get(k);
    if (!st) { st = { sta: 100, pc: 0, k: 0 }; this.stam.set(k, st); }
    return st;
  }

  onPitch(id, m) {
    if (this.phase !== 'pitch' || this.pitcherCtrl() !== id) return;
    const type = PITCH_KEYS.includes(m.type) ? m.type : 'FB';
    this.throwPitch(type, Number(m.tx) || 0, Number(m.ty) || 0.8, clamp(Number(m.power) || 0.8, 0, 1.15), true);
  }

  aiPitch() {
    if (this.mode === 'derby' && this.dy && this.dy.pr) { // 타격 연습: 실전 구종·코스 (70% 스트라이크)
      const keys = ['FB', 'FB', 'FB', 'TS', 'SL', 'CB', 'CH', 'SP'];
      const type = this.ppick && this.ppick !== 'MIX' && PITCHES[this.ppick] ? this.ppick : keys[(Math.random() * keys.length) | 0];
      const inZ = Math.random() < 0.7;
      const tx = inZ ? rand(ZONE.x0 + 0.03, ZONE.x1 - 0.03) : (Math.random() < 0.5 ? -1 : 1) * rand(0.3, 0.4);
      const ty = inZ ? rand(ZONE.y0 + 0.03, ZONE.y1 - 0.03) : rand(0.25, 1.1);
      return this.throwPitch(type, tx, ty, rand(0.8, 0.95), false, 0.03);
    }
    if (this.mode === 'derby') return this.throwPitch('BP', rand(-0.17, 0.17), rand(0.62, 0.98), 0.9, false, 0.02);
    const D = this.D;
    let zoneP = D.zone;
    if (this.balls === 3) zoneP = 0.85;
    else if (this.strikes === 2 && this.balls < 2) zoneP = 0.38;
    let keys = ['FB', 'FB', 'FB', 'TS', 'SL', 'SL', 'CB', 'CH', 'SP'];
    if (this.balls === 3) keys = ['FB', 'FB', 'TS', 'SL'];
    if (this.strikes === 2) keys = ['FB', 'SL', 'SL', 'CB', 'SP', 'SP', 'CH'];
    const type = keys[(Math.random() * keys.length) | 0];
    let tx, ty;
    if (Math.random() < zoneP) { tx = rand(ZONE.x0 + 0.03, ZONE.x1 - 0.03); ty = rand(ZONE.y0 + 0.03, ZONE.y1 - 0.03); }
    else {
      const side = Math.random() < 0.5 ? -1 : 1;
      if (Math.random() < 0.5) { tx = side * rand(0.3, 0.42); ty = rand(0.4, 1.15); } else { tx = rand(-0.25, 0.25); ty = rand(0.18, 0.4); }
    }
    this.throwPitch(type, tx, ty, rand(0.78, 0.96), false);
  }

  throwPitch(type, tx, ty, power, human, errOverride) {
    const P = PITCHES[type];
    const st = this.stamina();
    const tired = clamp((50 - st.sta) / 50, 0, 1);
    const pw = Math.min(1, power), R = this.R;
    const perfect = human && power >= R.perfectPitch[0] && power <= R.perfectPitch[1];
    let err = errOverride ?? (human ? (0.018 + 0.11 * Math.max(0, power - 0.95) + 0.035 * Math.max(0, 0.8 - power)) * R.humanPitchErr * (perfect ? R.perfectBonus.err : 1) : this.D.pitchErr);
    err += tired * 0.05;
    const kmh = P.v * (0.86 + 0.15 * pw) * (1 - tired * 0.06) * (human ? 1 : this.D.speed) + gauss() * 1.2;
    const speed = kmh / 3.6;
    tx = clamp(tx + gauss() * err, -0.95, 0.95);
    ty = clamp(ty + gauss() * err, 0.05, 1.85);
    // 체력 소모
    if (type !== 'BP') { st.sta = Math.max(0, st.sta - (0.9 + 1.1 * pw) * R.staminaMul); st.pc++; }
    const T = RELEASE[2] / speed / (this.mode === 'derby' ? 0.85 : this.D.pitchT) * (this.batterIsCPU() ? 1 : HIT_SLOW[this.set.hitEase] || 1);
    const t0 = this.now + WINDUP;
    const brkScale = (0.85 + 0.15 * pw) * (perfect ? R.perfectBonus.brk : 1);
    this.pitch = {
      id: ++this.seq, type, tx: r2(tx), ty: r2(ty), bx: r2(P.brk[0] * brkScale * (1 + gauss() * 0.08)), by: r2(P.brk[1] * brkScale * (1 + gauss() * 0.08)), k: P.k, dc: P.v < 125 ? 0.12 : P.v < 140 ? 0.06 : 0, t0: r2(t0),
      T: Math.round(T * 1000) / 1000, kmh: Math.round(kmh), swung: false, swingAt: null, res: null, mode: null,
    };
    this.pitch.arrive = this.pitch.t0 + this.pitch.T;
    if (perfect) this.pitch.pf = 1;
    this.phase = 'pitching';
    // 투구 시간표(WINDUP 1.85s): 세트 0~0.35 · 레그킥 0.35~1.25 · 정점 멈춤 1.25~1.45 · 스트라이드 1.45~1.85 · 릴리스 1.85 (docs/rebuild/events.md)
    // 코스(tx,ty)는 이벤트에 넣지 않는다 (공 위치 미리보기 금지)
    this.ev('windup', { pid: this.pitch.id, rel: this.pitch.t0, arr: r2(this.pitch.arrive), human: human ? 1 : 0, set: 0.35, kick: 1.25, peak: 1.45, dur: WINDUP, b: this.balls, s: this.strikes, o: this.outs, on: [1, 2, 3].map((k) => (this.runners.some((r) => !r.out && !r.scored && r.b === k) ? 1 : 0)), sc: [...(this.score || [0, 0])] });
    this.pitchCatch = { pid: this.pitch.id, at: this.pitch.arrive, kmh: this.pitch.kmh };
    this.runnersBefore = this.runners.map((r) => ({ ...r }));
    // CPU 도루
    if (this.mode === 'game' && this.batterIsCPU() && this.humans(this.batTeam).length === 0 && this.outs < 2) {
      const r1 = this.runners.find((r) => r.b === 1 && !this.runners.some((o) => o.b === 2));
      if (r1 && Math.random() < 0.04) { r1.steal = true; this.ev('steal', { rid: r1.rid, from: 1, to: 2, cpu: 1 }); }
    }
    for (const r of this.runners) if (r.steal) { r.target = r.b + 1; r.stealT = t0 - 0.95; }
    // 몸에 맞는 공 (우타자는 +x 쪽에 섬)
    this.pitch.hbp = tx > 0.56 && ty > 0.2 && ty < 1.75;
    // CPU 타자 판단
    this.aiSwing = null;
    if (this.batterIsCPU() && !this.pitch.hbp) {
      const D = this.D;
      const zone = inZone(tx, ty);
      const breaking = !['FB', 'TS', 'BP'].includes(type);
      const edge = Math.max(Math.abs(tx) - 0.25, Math.abs(ty - 0.78) - 0.3, 0); // 존 밖 거리
      let p = zone ? 0.68 : Math.max(0.03, (0.36 + (breaking ? 0.1 : 0)) * (1 - D.eye) * 2 - edge * 2.2);
      if (this.strikes === 2) p += zone ? 0.24 : 0.12;
      if (this.balls === 3 && this.strikes < 2) p = zone ? 0.45 : 0.03;
      if (this.balls >= 2 && this.strikes === 0 && !zone) p *= 0.5;
      if (this.buntStance) p = zone ? 0.92 : 0.25;
      if (Math.random() < p) {
        const mode = this.buntStance ? 'bunt' : this.strikes === 2 ? 'contact' : (Math.random() < R.cpuPower ? 'power' : 'contact');
        const M = SWING[mode];
        let whiff = D.whiff * (breaking ? 1.45 : 1) * (zone ? 1 : 1.9) * (mode === 'power' ? 1.35 : 1) * (pw > 0.97 ? 1.15 : 1) * (perfect ? 1.12 : 1);
        // 볼 배합: 같은 구종을 연달아 던지면 타자가 눈에 익힘(헛스윙↓·정타↑), 완급(속구↔느린 공) 바꾸면 헛스윙↑
        const sq = R.seqEffect ? this.seqFactor(type) : 1;
        whiff *= sq;
        if (mode === 'bunt') whiff = 0.12;
        let dt, ax, ay;
        if (Math.random() < whiff) { // 헛스윙: 타이밍이 크게 어긋남
          dt = (Math.random() < 0.5 ? -1 : 1) * M.W * rand(1.1, 1.6); ax = gauss() * 0.1; ay = gauss() * 0.1;
        } else {
          // CPU 타격 오차는 판정 폭에 비례 (판정 폭을 바꿔도 CPU 실력은 그대로)
          const kw = M.W / 0.15, kr = M.R / 0.34 * 1.22;
          dt = clamp(gauss() * 0.068 * D.bat * kw * (sq < 1 ? 0.88 : 1), -M.W * 0.95, M.W * 0.95);
          ax = gauss() * 0.1 * D.bat * kr;
          ay = clamp((gauss() * 0.15 + (mode === 'power' ? -0.02 : 0.01)) * kr, -M.R * 0.85, M.R * 0.85);
          if (mode === 'bunt') { ax = gauss() * 0.08; ay = 0.02 + gauss() * 0.04; }
        }
        this.aiSwing = { at: this.pitch.arrive + dt, dt, ax, ay, mode };
      }
    }
    if (type !== 'BP') (this.seqHist ||= []).push(type);
  }
  // 직전 투구들과 비교한 볼 배합 효과 (CPU 타자에게만): 1보다 작으면 타자에게 유리
  seqFactor(type) {
    const h = this.seqHist || [], n = h.length;
    if (!n) return 1;
    const v = (k) => PITCHES[k].v, last = h[n - 1];
    if (n >= 2 && h[n - 1] === type && h[n - 2] === type) return 0.72; // 3연속 같은 공
    if (last === type) return 0.88;
    if (Math.abs(v(last) - v(type)) >= 20) return 1.18; // 완급 조절 (예: 포심 → 커브)
    return 1.04;
  }
  // 막판 역전 기회 보정 (캐주얼): 마지막 이닝 이후 지고 있는 팀 타자
  clutchOn() {
    const c = this.R.clutch;
    if (!c || this.mode !== 'game' || this.inning < this.innings) return false;
    const d = this.score[this.half === 0 ? 1 : 0] - this.score[this.half];
    return d >= 1 && d <= c.deficit;
  }
  // 사람 타자 실제 판정 폭 배율 (클라 접촉 미리 계산도 이 값을 씀 → 스냅샷 hx)
  humanEase(mode) {
    if (mode === 'bunt') return 1;
    return (HIT_EASE[this.set.hitEase] || 1) * this.R.hitEase * (this.clutchOn() ? this.R.clutch.ease : 1);
  }

  onSwing(id, m) {
    if (this.phase !== 'pitching' || !this.pitch || this.pitch.swung || this.batter.id !== id || m.pid !== this.pitch.id) return;
    const mode = this.mode === 'game' && (this.buntStance || m.mode === 'bunt') ? 'bunt' : (m.mode === 'power' ? 'power' : 'contact');
    this.resolveSwing(Number(m.dt), Number(m.ax), Number(m.ay), mode, this.humanEase(mode), true);
  }

  resolveSwing(dt, ax, ay, mode = 'contact', ease = 1, human = false) {
    const p = this.pitch;
    p.swung = true;
    p.mode = mode;
    p.swingAt = r2(p.arrive + (isFinite(dt) ? clamp(dt, -0.5, 0.5) : 0));
    const R = this.R;
    const res = evalSwing(mode, dt, ax, ay, p.kmh / 3.6, ease, human, R.humanQ, R.sweetPull);
    this.lastPitch = { type: p.type, kmh: p.kmh, id: p.id };
    const dms = isFinite(dt) ? Math.round(clamp(dt, -0.5, 0.5) * 1000) : 0;
    this.ev('swing', { pid: p.id, mode, human: human ? 1 : 0, dt: dms, bid: this.batter.id || null });
    if (!res) {
      p.res = 'miss';
      { const M = SWING[mode] || SWING.contact, W = M.W * ease; this.ev('miss', { pid: p.id, mode, dt: dms, why: Math.abs(dt) > W ? (dt < 0 ? 'early' : 'late') : 'off', human: human ? 1 : 0 }); }
      if (this.mode === 'derby') return this.derbyOut('헛스윙');
      if (mode === 'bunt') { this.say(this.strikes >= 2 ? '번트 실패 · 삼진' : '번트 헛스윙', this.strikes >= 2); }
      return this.countStrike(true, true);
    }
    if (!res.bunt && !res.foul) res.v *= R.evMul * (this.clutchOn() ? R.clutch.ev : 1);
    this.ev('contact', this.contactInfo(p, res, mode, dms, ax, ay, human));
    if (res.foul && this.strikes === 2 && this.mode === 'game' && Math.random() < R.foulTipK) {
      p.res = 'miss';
      this.ev('foul', { pid: p.id, kind: 'tip', k: 1 });
      this.say('파울팁 삼진!');
      return this.countStrike(true, true, true);
    }
    p.res = 'hit';
    this.ball = Object.assign(battedBall(p.tx, p.ty, res), {
      batted: true, bounced: false, touched: false, fair: null, holder: -1, thrower: -1, throwAt: 0, ev: Math.round(res.v * 3.6), bunt: !!res.bunt,
    });
    this.lastHit = { id: p.id, ev: this.ball.ev, la: Math.round(res.launch), q: r2(res.q), mode };
    this.startPlay();
  }
  // 맞는 순간 피드백 데이터: 등급(grade) · 세기(pow 0~1, 히트스톱·흔들림·소리 세기용) · 타구 종류(kind)
  contactInfo(p, res, mode, dms, ax, ay, human) {
    const q = res.q, la = res.launch, kmh = Math.round(res.v * 3.6);
    const grade = res.foul ? 'tip' : res.bunt ? 'bunt' : q > 0.82 ? 'perfect' : q > 0.55 ? 'good' : q > 0.3 ? 'ok' : 'weak';
    const kind = res.foul ? 'foul' : res.bunt ? 'bunt' : la < 10 ? 'grounder' : la < 25 ? 'liner' : la < 50 ? 'fly' : 'popup';
    let xd = 0;
    if (!res.foul && !res.bunt && la > 8) { const b = battedBall(0, 0.9, { ...res, spray: 0 }); xd = carry(b); }
    const pow = clamp((kmh - 90) / 90, 0, 1) * (grade === 'perfect' ? 1 : grade === 'good' ? 0.85 : 0.6);
    return { pid: p.id, mode, foul: res.foul ? 1 : 0, grade, kind, q: r2(q), ev: kmh, la: Math.round(la), spray: Math.round(res.spray), xd, pow: r2(pow), dt: dms, off: [Math.round((ax || 0) * 100), Math.round((ay || 0) * 100)], human: human ? 1 : 0, x: p.tx, y: p.ty };
  }

  countStrike(swinging, afterSwing, keepMsg) {
    this.strikes++;
    const st = this.stamina();
    const pid = this.pitch ? this.pitch.id : 0;
    this.ev('strikeCall', { pid, swinging: swinging ? 1 : 0, looking: swinging ? 0 : 1, b: this.balls, s: Math.min(3, this.strikes), k: this.strikes >= 3 ? 1 : 0 });
    if (this.strikes >= 3) {
      this.outs++;
      this.ev('out', { kind: 'k', call: 'out', k: 0, x: 0, z: 0, looking: swinging ? 0 : 1, outs: this.outs, bid: this.batter.id || null, name: this.batter.name });
      st.k++;
      const bs = this.stat(); bs.pa++; bs.k++;
      if (!keepMsg && (!/번트/.test(this.msg) || !afterSwing)) this.say(swinging ? '헛스윙 삼진!' : '루킹 삼진!');
      return this.afterPitchCount(this.outs >= 3 ? 'half' : 'next', 1.9);
    }
    if (!afterSwing || !/번트/.test(this.msg)) this.say(swinging ? '헛스윙' : '스트라이크', false);
    this.afterPitchCount('pitch', 1.1);
  }
  countBall() {
    this.balls++;
    this.ev('ballCall', { pid: this.pitch ? this.pitch.id : 0, b: Math.min(4, this.balls), s: this.strikes, walk: this.balls >= 4 ? 1 : 0 });
    if (this.balls >= 4) {
      this.say('볼넷');
      const bs = this.stat(); bs.pa++; bs.bb++;
      for (const r of this.runners) if (r.steal) { r.b = r.target; r.steal = false; }
      const before = this.play; this.play = { runs: 0 };
      this.forceAdvance();
      bs.rbi += this.play.runs; this.play = before;
      return this.pause(1.7, 'next');
    }
    this.say('볼', false);
    this.afterPitchCount('pitch', 1.1);
  }
  // 볼카운트 처리 후: 도루 주자가 있으면 포수 송구 플레이로
  afterPitchCount(after, dur) {
    const stealers = this.runners.filter((r) => r.steal && !r.out);
    if (stealers.length && after !== 'half') return this.startStealPlay(after);
    for (const r of this.runners) if (r.steal) { r.b = r.start ?? Math.floor(r.b); r.target = r.b; r.steal = false; }
    this.pause(dur, after);
  }
  hitByPitch() {
    this.ev('ballCall', { pid: this.pitch ? this.pitch.id : 0, b: this.balls, s: this.strikes, walk: 1, hbp: 1 });
    this.say('몸에 맞는 공');
    const bs = this.stat(); bs.pa++; bs.bb++;
    for (const r of this.runners) if (r.steal) { r.b = r.target; r.steal = false; }
    const before = this.play; this.play = { runs: 0 };
    this.forceAdvance();
    bs.rbi += this.play.runs; this.play = before;
    this.pause(1.8, 'next');
  }
  wildPitch() {
    let n = 0;
    for (const r of [...this.runners].filter((x) => !x.out && !x.scored).sort((a, b) => b.b - a.b)) {
      r.target = Math.min(4, Math.round(r.b) + 1); r.b = r.target; r.steal = false; n++;
      if (r.target >= 4) { r.scored = true; this.addRun(r); }
    }
    if (n) { this.ev('wildPitch', { n }); this.say('폭투! 주자 진루'); this.pause(1.8, 'pitch'); }
  }
  forceAdvance() {
    const occ = (k) => this.runners.find((r) => r.target === k && !r.out && !r.scored);
    let k = 1; const chain = [];
    while (occ(k)) { chain.push(occ(k)); k++; }
    for (const r of chain.reverse()) { r.target++; r.b = r.target; if (r.target >= 4) { r.scored = true; this.addRun(r); } }
    this.runners.push(this.mkRunner(1, false));
  }
  mkRunner(b, batter) {
    return { rid: ++this.seq, pid: this.batter.id, name: this.batter.name, b, target: b === 0 ? 1 : b, start: b, forced: batter, mustReturn: false, out: false, scored: false, manual: 0, batter, steal: false, trot: false };
  }

  pause(dur, after) { if (this.mode !== 'derby' && dur < 4) dur *= TEMPO; this.phase = 'result'; this.phaseUntil = this.now + dur; this.after = after; }
  endPA(dur) { this.pause(dur, this.outs >= 3 ? 'half' : 'next'); }

  addRun(r) {
    this.score[this.half]++;
    this.halfRuns++;
    if (this.play) this.play.runs++;
    const lead = this.score[this.half] - this.score[1 - this.half];
    if (this.half === 1 && this.inning >= this.innings && this.score[1] > this.score[0]) this.walkoff = true;
    // lead: 득점 후 점수 차(공격팀 기준) — 1이면 역전/앞서는 점수, 0이면 동점
    this.ev('score', { half: this.half, sc: [...this.score], rid: r ? r.rid : 0, name: r ? r.name : '', lead, go: lead === 1 ? 1 : 0, tie: lead === 0 ? 1 : 0, walkoff: this.walkoff ? 1 : 0 });
  }

  // ───────── 기록 ─────────
  stat(bat = this.batter) {
    const key = bat.id || 'cpu:' + this.batTeam + bat.name;
    let st = this.stats.get(key);
    if (!st) {
      const p = bat.id && this.players.get(bat.id);
      st = { id: bat.id, name: bat.name, team: p ? p.team : this.batTeam, pa: 0, h: 0, hr: 0, rbi: 0, max: 0, k: 0, bb: 0, sb: 0 };
      this.stats.set(key, st);
    }
    return st;
  }
  // ── 투수 기록: 타석 단위로 아웃·실점·피안타·탈삼진·볼넷을 그 타석의 투수에게 붙임 ──
  pitcherName() { const pc = this.pitcherCtrl(); return this.isLive(pc) ? this.players.get(pc).name : `${this.set.teams[this.half === 0 ? 1 : 0]} 투수`; }
  pstat(key, name, team) {
    let p = this.pstats.get(key);
    if (!p) { p = { id: key.startsWith('cpu') ? null : key, name, team, outs: 0, r: 0, h: 0, k: 0, bb: 0, hr: 0, bf: 0 }; this.pstats.set(key, p); }
    return p;
  }
  sumStats() { let k = 0, bb = 0, hr = 0; for (const t of this.stats.values()) { k += t.k; bb += t.bb; hr += t.hr; } return { k, bb, hr }; }
  openPA() {
    if (this.mode !== 'game' || !this.fielders.length) { this.pa0 = null; return; }
    const t = this.sumStats();
    this.pa0 = { key: this.pitcherKey(), name: this.pitcherName(), team: this.fieldTeam, half: this.half, inn: this.inning, outs: this.outs, runs: this.score[this.half], hits: this.hits[this.half], ...t };
  }
  closePA() {
    const a = this.pa0; if (!a) return; this.pa0 = null;
    if (a.half !== this.half || a.inn !== this.inning) return;
    const p = this.pstat(a.key, a.name, a.team), t = this.sumStats();
    p.outs += Math.max(0, this.outs - a.outs); p.r += Math.max(0, this.score[this.half] - a.runs); p.h += Math.max(0, this.hits[this.half] - a.hits);
    p.k += Math.max(0, t.k - a.k); p.bb += Math.max(0, t.bb - a.bb); p.hr += Math.max(0, t.hr - a.hr); p.bf++;
  }
  // 현재 투수 오늘 기록 (진행 중 타석 제외)
  curPitcher() {
    const key = this.pitcherKey(), p = this.pstats.get(key), st = this.stam.get(key);
    return [this.pitcherName(), p ? p.outs : 0, p ? p.r : 0, p ? p.h : 0, p ? p.k : 0, p ? p.bb : 0, st ? st.pc : 0, this.isLive(this.pitcherCtrl()) ? this.pitcherCtrl() : null];
  }
  // 통산 기록 저장용 요약 (사람만, 이름 기준)
  careerSummary() {
    const out = {};
    for (const t of this.stats.values()) if (t.id) { const o = out[t.name] ||= { g: 1 }; Object.assign(o, { pa: t.pa, h: t.h, hr: t.hr, rbi: t.rbi, k: t.k, bb: t.bb, sb: t.sb, max: t.max }); }
    for (const p of this.pstats.values()) if (p.id) { const o = out[p.name] ||= { g: 1 }; Object.assign(o, { outs: p.outs, r: p.r, ph: p.h, pk: p.k, pbb: p.bb }); }
    if (this.winner) for (const pl of this.players.values()) if (pl.team === this.winner && out[pl.name]) out[pl.name].w = 1;
    return out;
  }
  statList() {
    return [...this.stats.values()].sort((a, b) => b.hr - a.hr || b.max - a.max || b.h - a.h || b.rbi - a.rbi)
      .map((t) => [t.id, t.name, t.team, t.pa, t.h, t.hr, t.rbi, t.max, t.k, t.bb, t.sb]);
  }

  // ───────── 홈런 더비 ─────────
  startDerby() {
    const order = [...this.players.values()].filter((p) => p.team !== 'spec').sort((a, b) => a.order - b.order);
    this.dy = { order: order.map((p) => ({ id: p.id, name: p.name, hr: 0, max: 0, done: false })), idx: 0, outs: 0, n: this.set.practice ? 9999 : this.set.derbyOuts, pr: !!this.set.practice, sw: 0, xh: 0 };
    this.ppick = 'MIX';
    this.inning = 1; this.half = 0; this.outs = 0; this.runners = [];
    this.fielders = ['P', 'C'].map((pos) => this.mkFielder(pos, null));
    if (!this.dy.order.length) return this.gameOver();
    this.derbyBatter();
    this.say(this.set.practice ? '타격 연습 · 1~6 구종 선택, 0 = 섞어서' : `홈런 더비 · ${this.batter.name} 타석`);
    this.pause(2.4, 'pitch');
  }
  derbyBatter() {
    const d = this.dy, cur = d.order[d.idx];
    this.batter = { id: cur.id, name: cur.name };
    this.balls = 0; this.strikes = 0; d.outs = 0; this.buntStance = false;
  }
  // 타구 질 → 예상 타율 (스탯캐스트 xBA 경향을 단순화)
  xba(ev, la) {
    const e = ev < 120 ? 0 : ev < 140 ? 1 : ev < 155 ? 2 : 3;
    const T = la < 10 ? [0.12, 0.22, 0.38, 0.55] : la < 25 ? [0.42, 0.6, 0.72, 0.82] : la < 35 ? [0.08, 0.15, 0.4, 0.78] : la < 50 ? [0.02, 0.05, 0.12, 0.35] : [0.01, 0.01, 0.02, 0.03];
    return T[e];
  }
  derbyOut(reason) {
    const d = this.dy, cur = d.order[d.idx];
    if (d.pr) { // 연습: 아웃 없음. 타구마다 비거리·예상 타율 표시
      if (this.ball) this.ball.ghost = true;
      this.play = null;
      const lh = this.lastHit;
      if (lh && lh.id === this.pitch?.id && !/헛스윙|파울/.test(reason)) { const x = this.xba(lh.ev, lh.la); d.sw++; d.xh += x; const kind = lh.la < 10 ? '땅볼' : lh.la < 25 ? '라인드라이브' : lh.la < 50 ? '플라이' : '팝업'; reason = /^\d+m$/.test(reason) ? (lh.la < 10 ? `${kind} ${lh.ev}km/h` : `${kind} ${reason}`) : reason; this.say(`${reason} · 예상 타율 ${x.toFixed(3).slice(1)} ${x >= 0.6 ? '안타성!' : x >= 0.35 ? '반반' : '아웃성'}`, false); }
      else this.say(reason, false);
      return this.pause(1.4, 'pitch');
    }
    d.outs++;
    if (this.ball) this.ball.ghost = true;
    this.play = null;
    if (d.outs >= d.n) {
      cur.done = true;
      this.say(`${reason} · ${cur.name} 종료 (홈런 ${cur.hr}개)`);
      this.pause(2.4, 'derbyNext');
    } else {
      this.say(`${reason} · 아웃 ${d.outs}/${d.n}`, false);
      this.pause(1.6, 'pitch');
    }
  }
  derbyHR(dist) {
    const cur = this.dy.order[this.dy.idx];
    cur.hr++; cur.max = Math.max(cur.max, dist);
    const st = this.stat(); st.hr++; st.h++; st.max = Math.max(st.max, dist);
    this.ball.ghost = true;
    this.play = null;
    if (this.dy.pr) { this.dy.sw++; this.dy.xh += 1; }
    this.say(`홈런! ${dist}m`);
    this.hrEv = { id: ++this.seq, dist, name: this.batter.name };
    this.ev('hr', { dist, n: 1, walkoff: 0, name: this.batter.name, bid: this.batter.id || null, derby: 1, ev: this.ball.ev });
    this.pause(3.2, 'pitch');
  }
  derbyNext() {
    const d = this.dy;
    d.idx++;
    while (d.idx < d.order.length && !this.isLive(d.order[d.idx].id)) { d.order[d.idx].done = true; d.idx++; }
    if (d.idx >= d.order.length) return this.gameOver();
    this.derbyBatter();
    this.say(`${this.batter.name} 타석`);
    this.pause(2.2, 'pitch');
  }
  derbyLive(dt) {
    const b = this.ball;
    const ev = integrate(b, dt);
    const r = Math.hypot(b.x, b.z), phi = Math.atan2(b.x, b.z);
    if ((ev.over || ev.pole) && !b.bounced) return this.derbyHR(carry(b));
    if (ev.wall) return this.derbyOut(`펜스 직격 ${Math.round(r)}m`);
    if (ev.landed && !b.bounced) {
      b.bounced = true;
      if (Math.abs(phi) > FOUL) return this.derbyOut('파울');
      return this.derbyOut(`${Math.round(r)}m`);
    }
    if (this.now - this.play.t0 > 10) return this.derbyOut('아웃');
  }

  // ───────── 인플레이 ─────────
  startPlay() {
    this.phase = 'live';
    this.play = { t0: this.now, runs: 0, settleSince: -1, holderSince: 0, nextAI: 0, nextRole: 0, traj: null, chaser: -1, result: null, kind: 'bip', outs: 0 };
    if (this.mode === 'derby') { this.say(`타구 속도 ${this.ball.ev}km/h`, false); return; }
    this.stat().pa++;
    const on = [false, false, false, false];
    for (const r of this.runners) if (!r.out && !r.scored) on[r.start ?? r.target] = true;
    for (const r of this.runners) {
      const base = r.steal ? r.start : r.target;
      r.start = base; r.mustReturn = false; r.manual = 0;
      r.forced = base === 1 || (base === 2 && on[1]) || (base === 3 && on[1] && on[2]);
      if (r.forced || r.steal) r.target = Math.max(r.target, base + 1);
      if (this.ball.bunt && !r.steal) r.b = Math.min(r.target, r.b + 0.1); // 번트 때 리드
      else if (!r.steal && r.b === base && base < 4) { // 2차 리드: 투구 때 몇 걸음 나가 있던 상태에서 출발 (2루 주자 ~3.8m)
        r.b = base + (base === 2 ? 0.14 : base === 1 ? 0.09 : 0.05);
        r.v = RUN_TOP / BASE_D * (r.forced ? 0.45 : 0.25); r.rdir = 1;
      }
      r.steal = false;
    }
    this.runners.push(this.mkRunner(0, true));
    this.say(this.ball.bunt ? '번트!' : `타구 속도 ${this.ball.ev}km/h`, false);
  }
  // 도루: 포수가 공을 잡은 상태로 라이브 플레이 시작
  startStealPlay(after) {
    const c = this.fielders.findIndex((f) => f.pos === 'C');
    const cf = this.fielders[c];
    this.ball = { x: cf.x, y: 1.2, z: cf.z, vx: 0, vy: 0, vz: 0, sx: 0, sy: 0, sz: 0, state: 'held', batted: false, bounced: true, touched: true, fair: true, holder: c, thrower: -1, throwAt: 0 };
    this.phase = 'live';
    this.play = { t0: this.now, runs: 0, settleSince: -1, holderSince: this.now, nextAI: Math.max(this.now + 0.05, (this.pitch ? this.pitch.arrive : this.now) + rand(0.62, 1.0)), nextRole: 0, traj: null, chaser: -1, result: null, kind: 'steal', after, outs: 0 };
    for (const r of this.runners) { r.mustReturn = false; r.forced = false; r.manual = this.now + 99; r.sbTry = r.steal; }
  }

  alive() { return this.runners.filter((r) => !r.out && !r.scored); }

  onSteal(id) {
    const p = this.players.get(id);
    if (!p || p.team !== this.batTeam || this.mode !== 'game') return;
    if (!(this.phase === 'pitch' || (this.phase === 'pitching' && this.now < this.pitch.t0 - 0.2))) return;
    const occ = new Set(this.runners.map((r) => r.b));
    let any = false;
    for (const r of [...this.runners].sort((a, b) => b.b - a.b)) {
      if (r.b >= 3 || occ.has(r.b + 1) && !this.runners.find((o) => o.b === r.b + 1)?.steal) continue;
      r.steal = true; any = true;
      this.ev('steal', { rid: r.rid, from: r.b, to: r.b + 1 });
      if (this.phase === 'pitching') { r.target = r.b + 1; r.stealT = this.pitch.t0 - 0.95; }
    }
    if (any) this.say('도루 시도!', false);
  }

  ctrlFielder(id) { return this.fielders.findIndex((x) => x.ctrl === id); }
  onMove(id, m) {
    const i = this.ctrlFielder(id), f = this.fielders[i];
    if (!f || !m.a) return;
    const pre = this.phase === 'pitch' || (this.phase === 'pitching' && this.now < this.pitch.t0);
    if (this.phase !== 'live' && !(pre && f.pos !== 'P' && f.pos !== 'C')) return;
    if (this.now - f.dv < 1.2) return;
    const x = Number(m.x), z = Number(m.z);
    if (!isFinite(x) || !isFinite(z)) return;
    const el = Math.max(0.05, this.now - (f.lastMvT || this.now - 0.1));
    const d = dist2(f.x, f.z, x, z), maxd = SPRINT_SPEED * el * 1.6 + 0.6;
    const k = d > maxd ? maxd / d : 1;
    f.mv = d / el > 0.5 ? (d / el > FIELD_SPEED + 0.5 ? 2 : 1) : 0;
    f.x = clamp(f.x + (x - f.x) * k, -135, 135); f.z = clamp(f.z + (z - f.z) * k, -20, 135);
    f.ry = Number(m.ry) || 0;
    f.act = this.now; f.lastMvT = this.now;
    if (pre) { f.x = clamp(f.x, -60, 60); f.z = clamp(f.z, 8, 110); f.shift = [f.x, f.z]; }
  }
  onJump(id) {
    const f = this.fielders[this.ctrlFielder(id)];
    if (f && this.phase === 'live' && this.now - f.jt > 0.9 && this.now - f.dv > 1.2) { f.jt = this.now; f.act = this.now; }
  }
  onDive(id, m) {
    const f = this.fielders[this.ctrlFielder(id)];
    if (!f || this.phase !== 'live' || this.now - f.dv < 1.4 || (this.ball && this.ball.holder >= 0 && this.fielders[this.ball.holder] === f)) return;
    const l = Math.hypot(m.dx, m.dz) || 1;
    this.startDive(f, m.dx / l, m.dz / l);
    f.act = this.now;
  }
  startDive(f, dx, dz) { f.dv = this.now; f.dvx = dx; f.dvz = dz; f.ry = Math.atan2(dx, dz); const l = Math.hypot(dx, dz) || 1; this.ev('dive', { i: this.fielders.indexOf(f), pos: f.pos, dx: r2(dx / l), dz: r2(dz / l), human: f.ctrl && this.isLive(f.ctrl) ? 1 : 0 }); }
  slide(r, base) { r.slide = this.now; this.ev('slide', { rid: r.rid, base, back: base <= r.b ? 1 : 0 }); }

  // 커트맨이 자리 잡았으면 커트맨에게, 아니면 false (직접 송구)
  throwRelay(i, k, pw = 0.5) {
    const f = this.fielders[i];
    if (i < 6 || k < 2) return false; // 1루 송구는 중계 안 함
    const rp = this.relayPlan(f.x, f.z, k);
    if (!rp || rp.ci === i) return false;
    const c = this.fielders[rp.ci];
    if (dist2(c.x, c.z, rp.x, rp.z) > 7) return false;
    this.play.relay = { ci: rp.ci, k, at: this.now };
    this.throwTo(i, c.x, c.z, pw);
    if (this.alive().some((r) => r.target === k && r.b < k && !r.trot)) this.say('중계 플레이!', false);
    return true;
  }
  onThrow(id, m) {
    if (this.phase !== 'live' || !this.ball || this.ball.holder < 0) return;
    const i = this.ball.holder, f = this.fielders[i];
    if (f.ctrl !== id) return;
    const k = clamp(m.base | 0, 0, 5);
    // 잡자마자(0.2초 안) 누른 송구는 버리지 말고 예약 → 키가 씹히지 않게
    if (this.now - this.play.holderSince < 0.2) { this.play.queuedThrow = { i, k, p: clamp(Number(m.p) || 0.4, 0, 1), at: this.play.holderSince + 0.2 }; f.act = this.now; return; }
    f.act = this.now;
    if (k === 5) { // R = 커트맨에게 (커트맨 없으면 가장 앞선 주자 베이스로 직접)
      const tk = this.relayTarget();
      if (this.throwRelay(i, tk, clamp(Number(m.p) || 0.5, 0, 1))) return;
      const bp = BASES[tk % 4]; this.throwTo(i, bp[0], bp[1], clamp(Number(m.p) || 0.5, 0, 1)); return;
    }
    const pt = k === 0 ? MOUND : BASES[k % 4];
    this.throwTo(i, pt[0], pt[1], clamp(Number(m.p) || 0.4, 0, 1));
  }

  onRunCmd(id, m) {
    const p = this.players.get(id);
    if (this.phase !== 'live' || !p || p.team !== this.batTeam) return;
    for (const r of this.alive()) {
      if (m.go) {
        if (r.mustReturn || r.target >= 4) continue;
        if (r.b === r.target) { r.target++; r.manual = this.now + 1.5; }
        else if (r.target < r.b) { r.target = Math.ceil(r.b); r.manual = this.now + 1.5; } // 귀루 중이어도 다시 앞으로
      } else if (!r.forced && r.b < r.target && r.b > Math.floor(r.b)) {
        r.target = Math.floor(r.b); r.manual = this.now + 1.5;
      }
    }
  }

  // 공격 측 수동 슬라이딩: 다음 베이스 4.5m 안쪽에서 달리는 주자 전원
  onSlideCmd(id) {
    const p = this.players.get(id);
    if (this.phase !== 'live' || !p || p.team !== this.batTeam) return;
    let any = false;
    for (const r of this.alive()) {
      if (r.b === r.target || r.slide) continue;
      const dir = r.target > r.b ? 1 : -1, nb = dir > 0 ? Math.ceil(r.b) : Math.floor(r.b);
      if (nb >= 1 && Math.abs(nb - r.b) * BASE_D < 4.5) { this.slide(r, nb); any = true; }
    }
    if (any) this.sendTo(id, { t: 'toast', text: '슬라이딩!' });
  }
  throwTo(i, x, z, pw = 0.4) {
    const b = this.ball, f = this.fielders[i];
    const d0 = Math.max(1, dist2(f.x, f.z, x, z));
    // 송구 오차 (먼 거리일수록, 세게 던질수록 커짐, 가끔 악송구)
    const ek = 0.75 + 1.4 * pw * pw;
    const eD = 0.25 + d0 * 0.006 + Math.max(0, d0 - 50) * 0.025; // 50m 넘는 원거리 송구는 크게 빗나감
    let ox = gauss() * eD * ek, oz = gauss() * eD * ek;
    if (Math.random() < this.D.err * 0.6) { const a = Math.random() * Math.PI * 2, m = rand(3, 6); ox = Math.cos(a) * m; oz = Math.sin(a) * m; }
    x += ox; z += oz;
    const d = Math.max(1, dist2(f.x, f.z, x, z));
    const T = throwT(d) / (f.pos === 'C' ? 1.25 : 1) / (0.9 + 0.32 * pw); // 세게 = 빠름
    b.x = f.x; b.z = f.z; b.y = 1.8;
    b.vx = (x - f.x) / T; b.vz = (z - f.z) / T;
    b.vy = (1.3 - 1.8 + 0.5 * G * T * T) / T;
    b.sx = b.sy = b.sz = 0;
    b.state = 'thrown'; b.batted = false; b.holder = -1; b.thrower = i; b.throwAt = this.now; b.tx = x; b.tz = z;
    this.play.traj = null; this.play.nextRole = 0;
    this.throwEv = { id: ++this.seq, i };
    let base = -1; for (let k = 0; k < 4; k++) if (dist2(x, z, BASES[k][0], BASES[k][1]) < 6) base = k === 0 ? 4 : k;
    this.ev('throw', { i, pos: f.pos, from: [r2(f.x), r2(f.z)], to: [r2(x), r2(z)], base, T: r2(T), pw: r2(pw), relay: this.play.relay && this.play.relay.at === this.now ? 1 : 0, pick: this.play.kind === 'pick' ? 1 : 0 });
  }

  // 포구 가능 여부
  reach(f, b) {
    const t = this.now;
    let h = 1.25, maxY = 2.45;
    const ja = t - f.jt;
    if (ja > 0.06 && ja < 0.6) maxY = 2.45 + 1.0 * Math.sin(Math.PI * clamp((ja - 0.06) / 0.54, 0, 1));
    const da = t - f.dv;
    if (da > 0.05 && da < 0.55) { h = 1.85; maxY = 1.3; }
    else if (da >= 0.55 && da < 1.2) return false;
    if (t - f.fum < 0.5) return false;
    if (b.batted && this.play && !(f.ctrl && this.isLive(f.ctrl)) && !(da > 0.05 && da < 0.55)) {
      // CPU 수비: 손 닿는 범위를 조금 줄이고, 빠른 타구일수록 더 줄임(160km/h 직선타는 거의 정면만) — 사람 조작 수비는 그대로
      const sp = Math.hypot(b.vx, b.vz);
      h = (!b.bounced ? 1.12 * clamp(1.2 - (sp - 15) / 22, 0.5, 1) : 1.42) * this.R.cpuReach; // 뜬 공(직선타)만 줄임, 땅볼은 거의 그대로
    }
    if (b.batted && this.play) { // 반응 시간: 강한 타구는 몸 가까이만 잡힘
      const el = t - this.play.t0;
      if (el < 0.22) h = Math.min(h, 0.45);
      else if (el < 0.5) h = Math.min(h, f.pos === 'P' ? 0.5 : 0.85);
    }
    if (b.state === 'thrown') { h = Math.max(h, 1.4); maxY = Math.max(maxY, 2.7); }
    return b.y < maxY && dist2(f.x, f.z, b.x, b.z) < h;
  }

  catchBall(i) {
    const b = this.ball, f = this.fielders[i];
    const wasFly = b.batted && !b.bounced && !b.touched && b.state === 'air';
    // 실책 판정
    const sp = Math.hypot(b.vx, b.vy, b.vz);
    const diving = this.now - f.dv < 0.6;
    let pErr = this.D.err * (b.state === 'thrown' ? 0.5 : sp > 28 ? 1.6 : 0.6);
    if (diving) pErr = 0.08;
    if (b.state !== 'thrown' && Math.random() < pErr) {
      f.fum = this.now;
      b.vx = -b.vx * rand(0.1, 0.3) + gauss() * 2; b.vz = -b.vz * rand(0.1, 0.3) + gauss() * 2; b.vy = Math.abs(b.vy) * 0.2 + 1;
      b.sx = b.sy = b.sz = 0;
      b.touched = true; b.state = 'ground'; b.bounced = true;
      if (b.batted && b.fair === null) { const phi = Math.atan2(b.x, b.z); if (Math.abs(phi) <= FOUL) b.fair = true; }
      this.play.err = true;
      this.errs[this.half === 0 ? 1 : 0]++;
      this.ev('error', { i, pos: f.pos, kind: 'field', dive: diving ? 1 : 0 });
      this.say(diving ? '다이빙! 공이 빠졌다' : `${POS_KO[f.pos]} 실책!`, !diving);
      this.play.traj = null;
      return;
    }
    if (b.state === 'thrown' && Math.random() < this.D.err * 0.4) {
      f.fum = this.now;
      b.vx *= -0.15; b.vz *= -0.15; b.vy = 1.5; b.state = 'ground';
      this.errs[this.half === 0 ? 1 : 0]++; this.play.err = true;
      this.ev('error', { i, pos: f.pos, kind: 'catch' });
      this.say('포구 실책!', false);
      return;
    }
    const fromThrow = b.state === 'thrown';
    b.holder = i; b.state = 'held'; b.vx = b.vy = b.vz = 0; b.sx = b.sy = b.sz = 0;
    this.play.holderSince = this.now;
    this.play.holderGoal = null;
    // 포구→송구 전환 시간: 땅볼 포구는 자세 잡는 시간, 송구 받은 피벗은 조금 짧게
    this.play.nextAI = this.now + (fromThrow ? rand(0.4, 0.66) : this.D.react * 0.6 + rand(0.35, 0.6));
    f.v = 0;
    this.catchEv = { id: ++this.seq, i, dive: diving, jump: this.now - f.jt < 0.7 };
    { const fr = Math.hypot(b.x, b.z), fp = Math.atan2(b.x, b.z);
      this.ev('catch', { pitch: 0, kmh: b.ev || 0, i, pos: f.pos, fly: wasFly ? 1 : 0, dive: diving ? 1 : 0, jump: this.catchEv.jump ? 1 : 0, thrown: fromThrow ? 1 : 0, robbed: wasFly && Math.abs(fp) <= FOUL && fr > fenceR(fp) - 1.5 && b.y > WALL_H - 0.3 ? 1 : 0, x: r2(b.x), y: r2(b.y), z: r2(b.z), human: f.ctrl && this.isLive(f.ctrl) ? 1 : 0 }); }
    if (wasFly && (diving || this.catchEv.jump)) this.play.highlight = true;
    if (b.batted && b.fair === null && !wasFly) {
      const phi = Math.atan2(b.x, b.z);
      if (Math.abs(phi) > FOUL) { b.touched = true; return this.foulBall(); }
      b.fair = true;
    }
    b.touched = true;
    if (wasFly) {
      const br = this.runners.find((r) => r.batter && !r.out);
      if (br) { br.out = true; this.outs++; this.ev('out', { kind: 'fly', call: 'out', k: 0, x: r2(b.x), z: r2(b.z), rid: br.rid, i, pos: f.pos, outs: this.outs, name: br.name }); }
      const r = Math.hypot(b.x, b.z), phi = Math.atan2(b.x, b.z);
      const robbed = Math.abs(phi) <= FOUL && r > fenceR(phi) - 1.5 && b.y > WALL_H - 0.3;
      this.say(robbed ? '홈런 강탈!!' : diving ? '다이빙 캐치!' : `${POS_KO[f.pos]} ${b.vy > -8 && Math.hypot(b.x, b.z) < 40 && b.ev > 120 ? '직선타' : '플라이'} 아웃`);
      this.play.result = 'fly';
      b.fair = true;
      for (const rr of this.alive()) {
        if (rr.b !== rr.start || rr.target !== rr.start) { rr.target = rr.start; rr.mustReturn = rr.b !== rr.start; rr.forced = false; }
      }
      if (this.outs >= 3) this.endPlay();
    }
  }

  foulBall() {
    this.ev('foul', { pid: this.pitch ? this.pitch.id : 0, kind: this.ball && this.ball.bunt ? 'bunt' : 'ball', s: Math.min(2, this.strikes + 1), x: this.ball ? r2(this.ball.x) : 0, z: this.ball ? r2(this.ball.z) : 0 });
    this.say(this.ball && this.ball.bunt ? '번트 파울' : '파울', false);
    this.runners = this.runnersBefore.map((r) => ({ ...r, steal: false, b: r.start ?? r.b, target: r.start ?? r.target }));
    if (this.strikes < 2) this.strikes++;
    else if (this.ball && this.ball.bunt) { this.ball.ghost = true; this.play = null; this.strikes = 3; this.outs++; this.ev('out', { kind: 'k', call: 'out', k: 0, x: 0, z: 0, bunt: 1, outs: this.outs, bid: this.batter.id || null, name: this.batter.name }); const bs = this.stat(); bs.k++; this.say('스리번트 파울 · 삼진'); return this.endPA(1.8); }
    this.ball.ghost = true;
    this.play = null;
    this.pause(1.4, 'pitch');
  }

  homeRun() {
    const dist = carry(this.ball);
    this.ball.ghost = true;
    this.hits[this.half]++;
    const st = this.stat(); st.hr++; st.h++; st.max = Math.max(st.max, dist);
    const al = this.alive();
    const n = al.length;
    const sc0 = [...this.score];
    const wo = this.half === 1 && this.inning >= this.innings && this.score[1] + n > this.score[0] ? 1 : 0;
    this.ev('hr', { dist, n, walkoff: wo, name: this.batter.name, bid: this.batter.id || null, ev: this.ball.ev, la: this.lastHit ? this.lastHit.la : 0, x: r2(this.ball.x), z: r2(this.ball.z), before: sc0 });
    for (const r of al) { r.trot = true; r.target = 4; r.manual = 0; this.addRun(r); }
    st.rbi += n;
    this.say(`${n >= 4 ? '만루 홈런!!!' : n > 1 ? `${n}점 홈런!` : '솔로 홈런!'} ${dist}m`);
    this.hrEv = { id: ++this.seq, dist, name: this.batter.name, n };
    for (const r of this.runners) delete r.batter;
    this.play = null;
    this.pause(8.0, this.outs >= 3 ? 'half' : 'next'); // 홈런 리플레이 시간 확보
  }

  call(out, k, x, z) { this.callEv = { id: ++this.seq, out: out ? 1 : 0, k, x: r2(x), z: r2(z) }; }
  outRunner(r, kind) {
    { const [x, z] = kind === 'force' ? BASES[r.target % 4] : runnerXZ(r.b); this.call(true, r.target, x, z); }
    r.out = true;
    this.outs++;
    this.play.outs = (this.play.outs || 0) + 1;
    { const h = this.ball ? this.ball.holder : -1, hf = this.fielders[h], base = kind === 'force' ? r.target : Math.round(r.b);
      const k2 = this.play.kind === 'pick' ? 'pick' : this.play.kind === 'steal' ? 'cs' : kind;
      if (kind === 'tag') this.ev('tag', { i: h, pos: hf ? hf.pos : '', rid: r.rid, base });
      const [cx, cz] = kind === 'force' ? BASES[r.target % 4] : runnerXZ(r.b);
      this.ev('out', { kind: k2, call: 'out', k: r.target, x: r2(cx), z: r2(cz), rid: r.rid, base: r.target, i: h, pos: hf ? hf.pos : '', outs: this.outs, dp: this.play.outs, name: r.name }); }
    const where = r.target >= 4 ? '홈' : `${r.target}루`;
    const steal = this.play.kind === 'steal';
    this.say(this.play.kind === 'pick' ? `견제사! ${r.start ?? r.target}루 주자 아웃` : steal ? `도루 저지! ${where}에서 아웃` : kind === 'force' ? `${where} 포스아웃` : `${where} 태그아웃`, true);
    if (this.play.outs === 2) this.say('병살!');
    if (this.play.outs === 3) this.say('삼중살!!');
    if (this.outs >= 3) {
      if ((kind === 'force' || r.batter) && this.play.runs > 0) {
        this.score[this.half] -= this.play.runs; this.halfRuns -= this.play.runs; this.walkoff = false;
        this.ev('scoreVoid', { half: this.half, runs: this.play.runs, sc: [...this.score] });
        this.say('쓰리아웃 · 득점 무효');
      }
      this.endPlay();
    }
  }

  endPlay() {
    if (!this.play) return;
    const P = this.play;
    if (P.kind === 'pick') {
      for (const r of this.alive()) { r.b = r.start ?? Math.round(r.b); r.target = r.b; r.steal = false; r.mustReturn = false; }
      if (!/견제사/.test(this.msg)) { this.say('세이프! 귀루 성공', false); const b0 = BASES[P.pickBase % 4]; this.ev('safe', { call: 'safe', k: P.pickBase, base: P.pickBase, pick: 1, x: r2(b0[0]), z: r2(b0[1]) }); }
      this.play = null;
      if (this.ball && this.ball.state !== 'held') this.ball.ghost = true;
      return this.pause(1.3, this.outs >= 3 ? 'half' : 'pitch');
    }
    if (P.kind === 'steal') {
      for (const r of this.alive()) { if (r.b !== Math.floor(r.b)) r.target = Math.floor(r.b); r.b = r.target; }
      if (!/저지|아웃/.test(this.msg)) {
        this.say('도루 성공!');
        { const k = Math.max(0, ...this.alive().filter((r) => r.sbTry).map((r) => r.b)), bp = BASES[k % 4]; this.ev('safe', { call: 'safe', steal: 1, base: k, k, x: r2(bp[0]), z: r2(bp[1]) }); }
        for (const r of this.alive()) if (r.sbTry) { const st = this.stat({ id: r.pid, name: r.name }); st.sb++; }
      }
      this.play = null;
      if (this.ball && this.ball.state !== 'held') this.ball.ghost = true;
      return this.pause(1.8, this.outs >= 3 ? 'half' : P.after);
    }
    const br = this.runners.find((r) => r.batter);
    if (br && !br.out) {
      const reached = br.scored ? 4 : br.target;
      if (P.result !== 'fly' && !P.err && P.outs > 0) {
        if (!/아웃|병살|삼중살/.test(this.msg)) this.say('야수 선택');
      } else if (P.result !== 'fly' && !P.err) {
        this.hits[this.half]++;
        this.stat().h++;
        const names = ['', '안타', '2루타', '3루타', '그라운드 홈런!'];
        if (!/아웃|실책/.test(this.msg) || this.outs < 3) this.say(this.ball.bunt && reached === 1 ? '번트 안타!' : names[Math.min(4, reached)] || '안타');
        this.ev('hit', { bases: Math.min(4, reached), bunt: this.ball.bunt ? 1 : 0, rbi: P.runs, name: this.batter.name, bid: this.batter.id || null });
      } else if (P.err && !/아웃/.test(this.msg)) this.say('실책으로 출루');
    } else if (br && br.out && this.ball.bunt && P.runs === 0 && this.alive().some((r) => r.target > r.start)) this.say('희생번트 성공');
    this.stat().rbi += P.err ? 0 : Math.max(0, P.runs);
    for (const r of this.runners) delete r.batter;
    for (const r of this.alive()) { if (r.b !== Math.floor(r.b)) r.target = Math.floor(r.b); r.b = r.target; }
    this.play = null;
    if (this.ball && this.ball.state !== 'held') this.ball.ghost = true;
    this.ev('playEnd', { runs: P.runs, outs: this.outs, hl: P.highlight ? 1 : 0 });
    this.endPA(P.highlight ? 4.6 : 2.0); // 호수비 리플레이 시간 확보
  }

  // ───────── 틱 ─────────
  tick(dt) {
    this.now += dt;
    // 포수 미트에 공 들어감 (안 맞은 투구): 사운드 '팡' · 포수 포구 모션용
    if (this.pitchCatch && this.now >= this.pitchCatch.at) {
      const pc = this.pitchCatch; this.pitchCatch = null;
      const p = this.pitch;
      if (p && p.id === pc.pid && p.res !== 'hit' && !p.hbp) this.ev('catch', { pitch: 1, i: 1, pos: 'C', kmh: pc.kmh, x: p.tx, y: p.ty, z: 0, dive: 0, fly: 0, jump: 0, thrown: 0, robbed: 0, human: 0 });
    }
    // 연결 끊긴 지 2분 지난 플레이어 정리
    if (this.phase !== 'lobby') for (const [id, p] of this.players) if (!p.conn && this.now - p.dcAt > 120) this.removePlayer(id);
    switch (this.phase) {
      case 'pitch':
        this.buntDefense(dt);
        this.holdRunner(dt);
        if (this.now >= this.pitchDeadline - 0.5 && !this.pickTried && this.cpuPickoff()) break;
        if (this.now >= this.pitchDeadline) this.aiPitch();
        break;
      case 'pitching': {
        const p = this.pitch;
        if (!p.rel && this.now >= p.t0) { p.rel = 1; this.ev('release', { pid: p.id, type: p.type, kmh: p.kmh, arr: r2(p.arrive), T: p.T, pf: p.pf || 0 }); }
        this.buntDefense(dt);
        this.stealCover(dt);
        // 도루 주자 출발
        for (const r of this.runners) if (r.steal && this.now >= r.stealT && r.b < r.target) { if (r.b === Math.floor(r.b)) r.b += 0.09; r.b = Math.min(r.target, r.b + RUN_SPEED / BASE_D * dt); }
        if (this.aiSwing && !p.swung && this.now >= this.aiSwing.at) {
          const s = this.aiSwing; this.aiSwing = null;
          this.resolveSwing(s.dt, s.ax, s.ay, s.mode);
        } else if (!p.swung && this.now >= p.arrive + this.swingGrace()) {
          p.swung = true; p.res = 'take';
          this.lastPitch = { type: p.type, kmh: p.kmh, id: p.id };
          if (this.mode === 'derby') { this.say(this.dy && this.dy.pr ? (inZone(p.tx, p.ty) ? '스트라이크 (놓침)' : '볼 · 잘 참았어') : '패스', false); this.pause(this.dy && this.dy.pr ? 1.1 : 0.9, 'pitch'); }
          else if (p.hbp) this.hitByPitch();
          else {
            const wild = (p.ty < 0.22 || Math.abs(p.tx) > 0.62) && this.runners.some((r) => !r.out && !r.scored && !r.steal) && Math.random() < 0.14;
            if (inZone(p.tx, p.ty)) this.countStrike(false); else this.countBall();
            if (wild && this.phase === 'result' && this.after === 'pitch') this.wildPitch();
          }
        }
        break;
      }
      case 'live': {
        const n = Math.max(1, Math.ceil(dt / (1 / 120)));
        for (let i = 0; i < n && this.phase === 'live'; i++) this.liveStep(dt / n);
        break;
      }
      case 'result': {
        const b = this.ball;
        if (b && b.ghost && b.state !== 'dead') {
          integrate(b, dt);
          const r = Math.hypot(b.x, b.z), phi = Math.atan2(b.x, b.z);
          if ((r > fenceR(phi) + 1 && b.y < 7) || (Math.abs(phi) > FOUL && r * Math.sin(Math.abs(phi) - FOUL) > 22 && b.y < 4) || b.z < -18 || (b.vy === 0 && Math.hypot(b.vx, b.vz) < 0.2)) b.state = 'dead';
        }
        // 홈런 트롯
        for (const r of this.runners) if (r.trot && !r.scored) { r.b = Math.min(4, r.b + TROT_SPEED / BASE_D * dt); if (r.b >= 4) r.scored = true; }
        if (this.now >= this.phaseUntil) this.afterResult();
        break;
      }
    }
  }
  // 도루 시작하면 베이스 커버 (2루=유격수, 3루=3루수)
  // ── 견제 ──
  // 1루 주자가 있으면 1루수는 베이스에 붙어서 주자를 묶어둠
  holdRunner(dt) {
    if (this.mode !== 'game' || !this.runners.some((r) => r.b === 1 && !r.out)) return;
    const f = this.fielders.find((x) => x.pos === '1B');
    if (!f || this.isHumanActive(f) || (f.shift && f.ctrl && this.isLive(f.ctrl))) return;
    const gx = -BASES[1][1] + 0.7, gz = BASES[1][1] + 0.6;
    const dx = gx - f.x, dz = gz - f.z, d = Math.hypot(dx, dz);
    if (d > 0.15) { const st = Math.min(d, FIELD_SPEED * 0.8 * dt); f.x += dx / d * st; f.z += dz / d * st; f.mv = d > 0.5 ? 1 : 0; }
    f.ry = Math.atan2(MOUND[0] - f.x, MOUND[1] - f.z);
  }
  // 사람 투수: 'pick' 메시지 / CPU 투수: 도루 기미 있으면 가끔
  onPick(id, m) {
    if (this.mode !== 'game' || this.phase !== 'pitch') return;
    const pi = this.fielders.findIndex((f) => f.pos === 'P');
    if (pi < 0 || (id !== 'cpu' && this.fielders[pi].ctrl !== id)) return;
    let base = m && m.base ? clamp(m.base | 0, 1, 3) : 0;
    const occ = (k) => this.runners.some((r) => !r.out && r.b === k);
    if (!base) base = occ(2) && !occ(3) ? 2 : occ(1) ? 1 : occ(2) ? 2 : occ(3) ? 3 : 0;
    if (!base || !occ(base)) { if (id !== 'cpu') this.sendTo(id, { t: 'toast', text: '견제할 주자가 없어' }); return; }
    if ((this.pickCount || 0) >= 3) { if (id !== 'cpu') this.sendTo(id, { t: 'toast', text: '견제는 타석당 3번까지' }); return; }
    this.pickCount = (this.pickCount || 0) + 1;
    const pf = this.fielders[pi];
    // 주자 리드: 평소 약 2.5m, 도루 스타트 끊은 주자는 4m+
    for (const r of this.runners) {
      if (r.out || r.b >= 4 || r.b !== Math.floor(r.b)) continue;
      r.start = r.b;
      const lead = r.steal ? 0.13 : r.pid ? 0.095 : 0.085;
      r.b = r.b + lead; r.target = r.start; r.mustReturn = true; r.forced = false; r.manual = this.now + 99;
      r.pickWait = this.now + (r.steal ? rand(0.15, 0.4) : r.pid ? rand(0.08, 0.42) : rand(0.08, 0.3)); r.steal = false;
    }
    this.ball = { x: pf.x, y: 1.5, z: pf.z, vx: 0, vy: 0, vz: 0, sx: 0, sy: 0, sz: 0, state: 'held', batted: false, bounced: true, touched: true, fair: true, holder: pi, thrower: -1, throwAt: 0 };
    this.phase = 'live';
    this.play = { t0: this.now, runs: 0, settleSince: -1, holderSince: this.now, nextAI: this.now + 99, nextRole: 0, traj: null, chaser: -1, result: null, kind: 'pick', after: 'pitch', outs: 0, pickAt: this.now + 0.32, pickFrom: pi, pickBase: base };
    this.say(`${base}루 견제!`, false);
    this.ev('pick', { base, cpu: id === 'cpu' ? 1 : 0 });
  }
  cpuPickoff() {
    this.pickTried = true;
    if (this.mode !== 'game' || this.isLive(this.pitcherCtrl())) return false;
    const r = this.runners.find((q) => !q.out && (q.b === 1 || q.b === 2));
    if (!r) return false;
    const p = r.steal ? 0.6 : r.pid ? 0.07 : 0.035;
    if (Math.random() >= p) return false;
    this.onPick('cpu', { base: r.b });
    return true;
  }
  // 사람 타자의 스윙 신호가 핑 때문에 늦게 와도 인정되도록 대기 시간을 핑에 맞춤
  swingGrace() {
    const bp = this.batter && this.batter.id ? (this.players.get(this.batter.id)?.ping || 0) : 0;
    const base = this.runners.some((r) => r.steal) ? 0.22 : 0.65;
    return this.batterIsCPU() ? base : Math.min(1.1, Math.max(base, 0.2 + bp / 1000 * 0.75));
  }
  stealCover(dt) {
    for (const r of this.runners) {
      if (!r.steal || this.now < r.stealT) continue;
      const k = r.target, pos = k === 2 ? 'SS' : k === 3 ? '3B' : null;
      const f = pos && this.fielders.find((x) => x.pos === pos);
      if (!f || this.isHumanActive(f)) continue;
      const base = BASES[k % 4];
      const dx = base[0] - f.x, dz = base[1] + 0.3 - f.z, d = Math.hypot(dx, dz);
      if (d > 0.2) { const st = Math.min(d, FIELD_SPEED * dt); f.x += dx / d * st; f.z += dz / d * st; f.mv = 2; f.ry = Math.atan2(dx, dz); }
    }
  }
  // 번트 자세 보면 1·3루수 전진
  buntDefense(dt) {
    if (this.mode !== 'game' || !this.fielders.length) return;
    for (const pos of ['1B', '3B']) {
      const f = this.fielders.find((x) => x.pos === pos);
      if (!f || this.isHumanActive(f)) continue;
      // 1루 주자 있으면 1루수는 베이스에 붙어 견제 대비 (holdRunner 담당) — 서로 당기던 버그 수정
      if (pos === '1B' && !this.buntStance && this.runners.some((r) => r.b === 1 && !r.out)) continue;
      const g = this.buntStance ? BUNT_SPOT[pos] : this.spotOf(pos);
      const dx = g[0] - f.x, dz = g[1] - f.z, d = Math.hypot(dx, dz);
      if (d > 0.1) { const st = Math.min(d, 5 * dt); f.x += dx / d * st; f.z += dz / d * st; f.mv = 1; } else f.mv = 0;
    }
  }

  afterResult() {
    if (this.walkoff) { this.say('끝내기!!'); this.gameOver(); return; }
    const a = this.after;
    if (a === 'pitch') this.enterPitch();
    else if (a === 'next') { this.nextBatter(); this.enterPitch(); }
    else if (a === 'half') this.endHalf();
    else if (a === 'derbyNext') this.derbyNext();
  }

  endHalf() {
    this.closePA();
    this.line[this.half][this.inning - 1] = this.halfRuns;
    const [aw, hm] = this.score;
    this.ev('inningEnd', { inning: this.inning, half: this.half, runs: this.halfRuns, sc: [aw, hm] });
    // 콜드게임 (캐주얼): 2회 이후 점수 차가 mercy 이상이고 뒤진 팀 공격이 끝났으면
    const M = this.R.mercy;
    if (M && this.mode === 'game' && this.inning >= 2 && this.inning < this.innings && Math.abs(aw - hm) >= M && (this.half === 1 || hm > aw)) {
      if (this.half === 0) this.line[1][this.inning - 1] = 'X';
      this.mercy = true; this.say(`${M}점 차 콜드게임`); return this.gameOver();
    }
    if (this.half === 0) {
      if (this.inning >= this.innings && hm > aw) { this.line[1][this.inning - 1] = 'X'; return this.gameOver(); }
      this.half = 1;
    } else {
      if (this.inning >= this.innings && aw !== hm) return this.gameOver();
      if (this.inning >= this.innings + this.R.maxExtra) return this.gameOver();
      this.half = 0; this.inning++;
    }
    this.startHalf();
  }

  gameOver() {
    this.closePA();
    this.phase = 'over';
    this.play = null;
    if (this.mode === 'derby') {
      const best = [...this.dy.order].sort((a, b) => b.hr - a.hr || b.max - a.max)[0];
      this.say(best ? `홈런왕 · ${best.name}` : '더비 종료');
      this.ev('gameEnd', { derby: 1, best: best ? best.name : null, hr: best ? best.hr : 0 });
      this.emitLobby();
      return;
    }
    const [aw, hm] = this.score;
    this.winner = aw > hm ? 'away' : hm > aw ? 'home' : null;
    this.ev('gameEnd', { sc: [aw, hm], win: this.winner, walkoff: this.walkoff ? 1 : 0, mercy: this.mercy ? 1 : 0, inning: this.inning, rules: this.set.rules });
    this.say(this.winner ? `경기 종료 · ${this.set.teams[this.winner === 'away' ? 0 : 1]} 승리` : '경기 종료 · 무승부');
    try { this.onGameOver(this.careerSummary()); } catch (e) { /* 기록 저장 실패해도 경기는 계속 */ }
    this.emitLobby();
  }

  liveStep(dt) {
    const b = this.ball, P = this.play;
    if (!P) return;
    // 예약된 사람 송구 실행
    if (P.queuedThrow && this.now >= P.queuedThrow.at) {
      const q = P.queuedThrow; P.queuedThrow = null;
      if (b.holder === q.i) { const pt = q.k === 0 ? MOUND : BASES[q.k % 4]; this.throwTo(q.i, pt[0], pt[1], q.p); }
    }
    // 견제구: 커버 들어간 야수가 베이스 근처에 오면(또는 시간 다 되면) 투수가 던짐
    if (P.kind === 'pick' && P.pickAt && b.holder === P.pickFrom) {
      const base = BASES[P.pickBase], cv = this.fielders.findIndex((f, i) => i !== P.pickFrom && dist2(f.x, f.z, base[0], base[1]) < 2.2);
      if (this.now >= P.pickAt && (cv >= 0 || this.now >= P.pickAt + 0.6)) { P.pickAt = 0; this.throwTo(P.pickFrom, base[0], base[1] + 0.3, 0.55); P.nextAI = this.now + 0.6; }
    }
    if (P.kind === 'pick' && !P.pickAt && b.holder >= 0 && this.now - P.holderSince > 0.6 && this.alive().every((r) => r.b === r.target)) return this.endPlay();
    if (this.mode === 'derby') return this.derbyLive(dt);
    // 다이빙 중인 수비수 이동
    for (const f of this.fielders) {
      const da = this.now - f.dv;
      if (da > 0.05 && da < 0.5) { f.x += f.dvx * 5.5 * dt; f.z += f.dvz * 5.5 * dt; }
    }
    // 1) 공
    if (b.holder >= 0) {
      const f = this.fielders[b.holder];
      b.x = f.x; b.z = f.z; b.y = 1.2;
    } else {
      const ev = integrate(b, dt);
      if ((ev.over || ev.pole) && b.batted && !b.bounced && !b.touched) {
        // 펜스 앞 점프 캐치 기회
        for (let i = 0; i < this.fielders.length; i++) if (this.reach(this.fielders[i], b)) { this.catchBall(i); if (!this.play || this.play.result) return; }
        if (b.holder < 0) return this.homeRun();
      }
      if (ev.wall) { b.bounced = true; if (b.batted && b.fair === null) b.fair = true; P.traj = null; this.wallEv = { id: ++this.seq }; this.ev('wall', { x: r2(b.x), y: r2(b.y), z: r2(b.z), impact: r2(ev.impact) }); }
      if (ev.landed && b.batted && !b.bounced) {
        b.bounced = true;
        const r = Math.hypot(b.x, b.z), phi = Math.atan2(b.x, b.z);
        if (r >= 28) { if (Math.abs(phi) > FOUL) return this.foulBall(); b.fair = true; }
        P.traj = null;
      } else if (ev.landed) P.traj = null;
      if (b.batted && b.fair === null && b.bounced) {
        const r = Math.hypot(b.x, b.z), phi = Math.atan2(b.x, b.z);
        const sp = Math.hypot(b.vx, b.vz);
        if (r >= 28 || sp < 0.5) { if (Math.abs(phi) > FOUL) return this.foulBall(); b.fair = true; }
        else if (b.z < 0 && Math.abs(phi) > FOUL) return this.foulBall();
      }
      const phi = Math.atan2(b.x, b.z), r = Math.hypot(b.x, b.z);
      if (Math.abs(phi) > FOUL) {
        const perp = r * Math.sin(Math.abs(phi) - FOUL);
        if ((perp > 22 || b.z < -16) && b.fair !== true) return this.foulBall();
        if ((perp > 22 || b.z < -16) && b.fair === true) {
          // 페어 후 파울 관중석 → 인정 2루타 / 송구가 관중석 → 2베이스 안전진루
          return this.groundRule(b.batted ? '인정 2루타' : '악송구 · 안전진루');
        }
      }
      if (r > fenceR(phi) + 6 || r > 140) {
        if (b.fair) return this.groundRule('인정 2루타');
        return this.foulBall();
      }
      // 포구
      for (let i = 0; i < this.fielders.length; i++) {
        if (i === b.thrower && this.now - b.throwAt < 0.45) continue;
        const f = this.fielders[i];
        if (b.state === 'thrown' && dist2(f.x, f.z, b.tx, b.tz) > 4.5) continue; // 송구는 받을 사람만
        if (this.reach(f, b)) { this.catchBall(i); if (!this.play) return; break; }
      }
      // 몸에 맞고 튕김: 못 잡는 상태(다이빙 후 일어나는 중·놓친 직후)의 야수를 공이 통과하지 않게
      if (b.holder < 0 && b.state !== 'thrown' && b.y < 1.5) {
        for (const f of this.fielders) {
          const dx = b.x - f.x, dz = b.z - f.z, d = Math.hypot(dx, dz);
          if (d > 0.34 || d < 1e-3 || this.now - (f.blk || 0) < 0.3) continue;
          const nx = dx / d, nz = dz / d, vr = b.vx * nx + b.vz * nz;
          if (vr >= 0) continue;
          f.blk = this.now;
          b.vx -= 1.35 * vr * nx; b.vz -= 1.35 * vr * nz; b.vx *= 0.6; b.vz *= 0.6; b.vy = Math.abs(b.vy) * 0.3;
          b.sx = b.sy = b.sz = 0; b.touched = true; if (b.state === 'air') b.state = 'ground'; b.bounced = true;
          if (b.batted && b.fair === null) { const ph = Math.atan2(b.x, b.z); if (Math.abs(ph) <= FOUL) b.fair = true; }
          P.traj = null;
        }
      }
    }
    if (!this.play) return;
    this.fieldAI(dt);
    this.runAI(dt);
    if (!this.play) return;
    // 아웃 판정
    if (b.holder >= 0) {
      const f = this.fielders[b.holder];
      for (const r of this.alive()) {
        if (r.trot) continue;
        const k = r.target;
        if ((r.forced || r.mustReturn) && r.b !== k) {
          const base = BASES[k % 4];
          if (dist2(f.x, f.z, base[0], base[1]) < 1.3) { this.outRunner(r, 'force'); if (!this.play) return; continue; }
        }
        // 베이스 위에 있어야 세이프: 서 있는 베이스(정수) 또는 슬라이딩으로 발이 닿은 경우만
        const fr = r.b - Math.floor(r.b);
        const toNext = (1 - fr) * BASE_D, fromPrev = fr * BASE_D;
        const onBase = r.b === Math.floor(r.b) || (r.slide && (r.target > r.b ? toNext < 0.9 : fromPrev < 0.9));
        if (!onBase) {
          const [rx, rz] = runnerXZ(r.b);
          if (dist2(f.x, f.z, rx, rz) < 1.45) { this.outRunner(r, 'tag'); if (!this.play) return; }
        }
      }
    }
    // 종료 판정
    const settled = b.holder >= 0 && this.alive().every((r) => r.b === r.target && !r.mustReturn);
    if (settled) {
      if (P.settleSince < 0) P.settleSince = this.now;
      if (this.now - P.settleSince > 0.7) return this.endPlay();
    } else P.settleSince = -1;
    if (this.now - P.t0 > 45) return this.endPlay();
  }

  groundRule(text) {
    this.say(text);
    for (const r of this.alive()) {
      const t = Math.min(4, (r.batter ? 0 : r.start) + 2);
      r.target = t; r.b = t;
      if (t >= 4) { r.scored = true; this.addRun(r); }
    }
    this.play.result = 'gr';
    if (this.ball.batted) { this.hits[this.half]++; const st = this.stat(); st.h++; st.rbi += this.play.runs; this.ev('hit', { bases: 2, gr: 1, rbi: this.play.runs, name: this.batter.name, bid: this.batter.id || null }); }
    for (const r of this.runners) delete r.batter;
    this.play = null;
    this.ball.ghost = true;
    this.endPA(2.0);
  }

  predict() {
    const b = { ...this.ball };
    const out = [];
    for (let k = 0; k < 120; k++) {
      integrate(b, 0.05);
      out.push([b.x, b.y, b.z]);
      if (b.vy === 0 && Math.hypot(b.vx, b.vz) < 0.05) break;
    }
    return out;
  }

  isHumanActive(f) { return f.ctrl && this.isLive(f.ctrl) && this.now - f.act < 0.6; } // 손 떼면 0.6초 뒤 CPU가 이어서 쫓아감

  coverMap(chaser, extra = -1) {
    const b = this.ball;
    const idx = (p) => POS.indexOf(p);
    const busy = new Set([chaser, b.holder, extra]);
    const pick = (...ps) => { for (const p of ps) { const i = idx(p); if (!busy.has(i)) { busy.add(i); return i; } } return -1; };
    const m = {};
    m[1] = pick('1B', 'P', '2B');
    m[2] = b.x > 0 ? pick('2B', 'SS') : pick('SS', '2B');
    m[3] = pick('3B', 'SS'); // 투수는 3루 커버 안 함 (실제 야구)
    m[4] = pick('C', 'P');
    return m;
  }

  fieldAI(dt) {
    const b = this.ball, P = this.play;
    const N = this.fielders.length;
    if (this.now >= P.nextRole) {
      P.nextRole = this.now + 0.2;
      const goals = new Array(N).fill(null);
      let chaser = -1;
      if (b.holder < 0) {
        if (b.state === 'thrown') {
          let best = 1e9;
          for (let i = 0; i < N; i++) { if (i === b.thrower) continue; const d = dist2(this.fielders[i].x, this.fielders[i].z, b.tx, b.tz); if (d < best) { best = d; chaser = i; } }
          if (chaser >= 0) goals[chaser] = [b.tx, b.tz];
          P.chaseT = null;
        } else {
          if (!P.traj || this.now - P.trajT > 0.25) { P.traj = this.predict(); P.trajT = this.now; }
          let bestT = 1e9, bestPt = null;
          for (let i = 0; i < N; i++) {
            if (i === b.thrower && this.now - b.throwAt < 0.45) continue;
            const f = this.fielders[i];
            const spd = f.ctrl ? SPRINT_SPEED : FIELD_SPEED;
            let ti = 1e9, pt = null;
            // 도달 시간 = 남은 반응시간 + 가속 구간 포함 이동 시간 (실제로 갈 수 있는 지점만 고름)
            const acc = i >= 6 ? 5.5 : 10, v0 = f.v || 0, el = this.now - P.t0;
            const wait = Math.max(0, (i >= 6 ? this.D.react + 0.2 : this.D.react) - el);
            const runT = (d) => { if (d <= 0) return 0; const dA = (spd * spd - v0 * v0) / (2 * acc); if (d <= dA) return (-v0 + Math.sqrt(v0 * v0 + 2 * acc * d)) / acc; return (spd - v0) / acc + (d - dA) / spd; };
            for (let k = 0; k < P.traj.length; k++) {
              const q = P.traj[k], t = (k + 1) * 0.05;
              if (q[1] > 2.4) continue;
              if (wait + runT(dist2(f.x, f.z, q[0], q[2]) - 1.2) <= t) { ti = t; pt = q; break; }
            }
            if (!pt) { const q = P.traj[P.traj.length - 1]; pt = q; ti = 6 + dist2(f.x, f.z, q[0], q[2]) / spd; }
            // 투수는 마운드 근처(약 10m) 타구만 처리 — 그 밖은 내·외야수 몫 (실제 야구처럼 투수가 뛰어다니지 않음)
            if (f.pos === 'P' && b.batted && !this.isHumanActive(f) && dist2(MOUND[0], MOUND[1], pt[0], pt[2]) > 10) continue;
            if (ti < bestT) { bestT = ti; chaser = i; bestPt = pt; }
          }
          if (chaser >= 0) {
            let gx = bestPt[0], gz = bestPt[2];
            // 타구 판단: 처음엔 낙구 지점을 정확히 모름(특히 앞뒤 거리) → 시간이 지나며 보정. 사람이 직접 조작 중이면 적용 안 함
            const cf = this.fielders[chaser];
            if (b.batted && !this.isHumanActive(cf)) {
              P.readE ||= {};
              let e = P.readE[chaser];
              if (!e) {
                const vl = Math.hypot(b.vx, b.vz) || 1, ux = b.vx / vl, uz = b.vz / vl;
                const dist = Math.min(35, dist2(cf.x, cf.z, gx, gz) + 6);
                const air = !b.bounced && b.vy > 2;
                const dep = gauss() * (air ? 0.2 : 0.03) * dist, side = gauss() * (air ? 0.06 : 0.02) * dist;
                e = P.readE[chaser] = [ux * dep - uz * side, uz * dep + ux * side];
              }
              const k = clamp(1 - (this.now - P.t0 - this.D.react) / (this.D.read || 0.8), 0, 1);
              gx += e[0] * k; gz += e[1] * k;
            }
            goals[chaser] = [gx, gz]; P.chaseT = this.now + bestT; P.chasePt = bestPt;
          }
        }
      }
      P.chaser = chaser;
      // 깊은 외야 타구: 커트맨이 중계 위치로
      P.rl = null;
      const src = b.holder >= 0 ? this.fielders[b.holder] : P.chasePt && chaser >= 6 ? { x: P.chasePt[0], z: P.chasePt[2] } : null;
      if (src && (b.holder < 0 || b.holder >= 6) && b.state !== 'thrown' && Math.hypot(src.x, src.z) > 55) {
        const rp = this.relayPlan(src.x, src.z, this.relayTarget());
        if (rp && rp.ci !== chaser && rp.ci !== b.holder) { P.rl = rp; goals[rp.ci] = [rp.x, rp.z]; }
      } else if (b.state === 'thrown' && P.relay && b.thrower >= 6) {
        const c = this.fielders[P.relay.ci]; P.rl = { ci: P.relay.ci, k: P.relay.k, x: c.x, z: c.z };
      }
      const cov = this.coverMap(chaser, P.rl ? P.rl.ci : -1); P.cov = cov;
      for (const k of [1, 2, 3, 4]) if (cov[k] >= 0) { const base = BASES[k % 4]; goals[cov[k]] = k === 4 ? [0, -0.5] : [base[0], base[1] + 0.4]; }
      for (let i = 0; i < N; i++) {
        if (goals[i] || i === b.holder) continue;
        const f = this.fielders[i], hs = HOME_SPOT[f.pos];
        if (['LF', 'CF', 'RF'].includes(f.pos) && b.holder < 0) goals[i] = [hs[0] + (b.x - hs[0]) * 0.4, hs[1] + (b.z - hs[1]) * 0.4];
        else if (f.pos === 'P') goals[i] = [MOUND[0], MOUND[1]];
        else goals[i] = hs;
      }
      P.goals = goals;
      this.autoSwitch();
    }
    // AI 다이빙/점프
    if (b.holder < 0 && b.state !== 'thrown' && b.batted !== false) {
      for (let i = 0; i < N; i++) {
        const f = this.fielders[i];
        if (this.isHumanActive(f) || f.ctrl && this.isLive(f.ctrl) && this.now - f.act < 3) continue;
        if (this.now - f.dv < 2 || P.dived?.[i]) continue;
        const d = dist2(f.x, f.z, b.x, b.z);
        const closing = (b.vx * (f.x - b.x) + b.vz * (f.z - b.z)) > 0;
        if (closing && d > 1.3 && d < 3.2 && b.y < 1.2 && Math.hypot(b.vx, b.vz) > 6) {
          // 공 진행선에 대한 최근접점으로 다이빙
          const vx = b.vx, vz = b.vz, vl = Math.hypot(vx, vz);
          const t = ((f.x - b.x) * vx + (f.z - b.z) * vz) / (vl * vl);
          const px = b.x + vx * t, pz = b.z + vz * t;
          const off = dist2(f.x, f.z, px, pz);
          if (off > 1.1 && off < 2.8 && t < 0.6 && Math.random() < (b.bounced ? 0.6 : 0.3)) { (P.dived ||= {})[i] = true; this.startDive(f, px - f.x, pz - f.z); }
          else if (off <= 1.1) (P.dived ||= {})[i] = true;
        }
        // 머리 위 직선타 점프: 항상 뛰는 게 아니라 반응 성공했을 때만 (실제처럼 넘어가는 타구도 나옴)
        if (d < 1.1 && b.y > 2.4 && b.y < 3.4 && this.now - f.jt > 1 && !P.jumpTried?.[i]) { (P.jumpTried ||= {})[i] = true; if (Math.random() < 0.28) f.jt = this.now; }
      }
    }
    if (b.holder >= 0) {
      const f = this.fielders[b.holder];
      const waitT = f.swT > 0 && f.act <= f.swT ? this.R.autoThrowWaitSwitched : this.R.autoThrowWait; // 사람이 공 들고 가만있으면 CPU가 대신 송구 (조작 부담↓)
      const human = this.isHumanActive(f) || (f.ctrl && this.isLive(f.ctrl) && this.now - P.holderSince < waitT);
      if (!human && this.now >= P.nextAI) { P.nextAI = this.now + 0.25; this.holderAI(b.holder); }
    }
    // 이동
    const react = this.now - P.t0;
    for (let i = 0; i < N; i++) {
      const f = this.fielders[i];
      if (this.isHumanActive(f)) continue;
      if (this.now - f.dv < 1.2) { f.mv = 0; continue; }
      if (P.kind !== 'steal' && P.kind !== 'pick' && react < (i >= 6 ? this.D.react + 0.2 : this.D.react)) continue;
      const g = i === b.holder ? (P.holderGoal || null) : P.goals && P.goals[i];
      if (!g) { f.mv = 0; continue; }
      const dx = g[0] - f.x, dz = g[1] - f.z, d = Math.hypot(dx, dz);
      const top = (i === P.chaser ? FIELD_SPEED : FIELD_SPEED * 0.9) * (d > 8 ? 1.06 : 1);
      f.v = Math.min(top, (f.v || 0) + (i >= 6 ? 5.5 : 10) * dt); // 첫발 가속: 내야수는 빠른 첫발, 외야수는 최고 속도까지 ~1.1초
      const spd = Math.min(f.v, d > 0.12 ? top : 0) || f.v;
      if (d > 0.12) {
        const st = Math.min(d, spd * dt);
        f.x += dx / d * st; f.z += dz / d * st; f.ry = Math.atan2(dx, dz); f.mv = d > 8 ? 2 : 1;
      } else {
        f.mv = 0; f.v = 0;
        f.ry = Math.atan2(b.x - f.x, b.z - f.z);
      }
    }
  }

  // ── 중계 플레이 ──
  // 외야 깊은 곳 공을 베이스로 보낼 때: 커트맨(유격수/2루수/1루수)이 외야수와 베이스 사이 일직선 위로 나가 받아서 다시 던짐
  relayTarget() { // 주자 중 가장 앞서 가는 주자의 목표 베이스 (없으면 2루)
    let k = 0;
    for (const r of this.alive()) if (!r.trot && r.target >= 1 && r.target <= 4 && r.target > k) k = r.target;
    return k || 2;
  }
  relayPlan(fx, fz, k) {
    const base = BASES[k % 4], d = dist2(fx, fz, base[0], base[1]);
    if (d < 58) return null;
    const pos = k === 4 ? (fx >= 0 ? 'SS' : '1B') : k === 3 ? (fx >= -8 ? 'SS' : '2B') : (fx >= 0 ? 'SS' : '2B');
    const ci = POS.indexOf(pos);
    if (ci < 0) return null;
    const s = clamp(d * 0.45, 22, 42), ux = (fx - base[0]) / d, uz = (fz - base[1]) / d;
    return { ci, k, x: base[0] + ux * s, z: base[1] + uz * s };
  }
  holderAI(i) {
    const f = this.fielders[i], P = this.play;
    P.holderGoal = null;
    let best = null;
    const cov = this.coverMap(-1);
    for (const r of this.alive()) {
      if (r.trot || (r.b === r.target && !r.mustReturn)) continue;
      const k = r.target, base = BASES[k % 4];
      const tr = Math.abs(r.target - r.b) * BASE_D / RUN_SPEED;
      const dHold = dist2(f.x, f.z, base[0], base[1]);
      if (dHold < 1.0) { best = { k, mode: 'wait' }; break; }
      const tRun = dHold / FIELD_SPEED;
      const ci = cov[k];
      const tCover = ci >= 0 ? dist2(this.fielders[ci].x, this.fielders[ci].z, base[0], base[1]) / FIELD_SPEED : 9;
      const tThrow = Math.max(throwT(dHold) + 0.15, tCover);
      const mode = tRun <= tThrow ? 'run' : 'throw';
      const margin = tr - Math.min(tRun, tThrow);
      const lead = !best || k > best.k;
      const need = this.ball.bunt && !r.batter ? 0.6 : 0.05;
      if (margin > need && (lead || margin > best.margin + 1)) best = { k, mode, margin, base };
    }
    if (!best) {
      const adv = this.alive().filter((r) => r.b < r.target && !r.trot).sort((a, c) => c.target - a.target)[0];
      if (adv) {
        const base = BASES[adv.target % 4];
        if (dist2(f.x, f.z, base[0], base[1]) > 12) best = { k: adv.target, mode: 'throw', base };
      }
    }
    if (!best || best.mode === 'wait') return;
    if (best.mode === 'run') P.holderGoal = [best.base[0], best.base[1]];
    else if (!this.throwRelay(i, best.k)) this.throwTo(i, best.base[0], best.base[1]);
  }

  runAI(dt) {
    const b = this.ball, P = this.play;
    const spd = RUN_SPEED / BASE_D;
    const flyPending = b.batted && !b.bounced && b.holder < 0 && !b.touched && !(P.chasePt && P.chaseT != null && P.chasePt[1] < 0.6);
    const alive = this.alive().sort((a, c) => c.b - a.b);
    for (const r of alive) {
      if (r.batter && this.now - P.t0 < (this.ball.bunt ? 0.2 : 0.38)) continue; // 스윙 후 출발
      if (P.kind === 'pick') { // 견제: 반응 후 몸 돌려 귀루(약 5.5m/s) + 다이빙
        if (this.now < (r.pickWait || 0) || r.b <= r.target) continue;
        const v = 6.4 / BASE_D * Math.min(1, (this.now - r.pickWait) / 0.3 + 0.4);
        r.b = Math.max(r.target, r.b - v * dt);
        if ((r.b - r.target) * BASE_D < 2.4 && !r.slide) this.slide(r, r.target);
        continue;
      }
      // 잡힐 것 같은 뜬공(2아웃 전): 주자는 하프웨이까지만 / 깊은 뜬공이면 베이스에서 태그업 대기
      let cap = 99;
      if (flyPending && this.outs < 2 && !r.batter && this.now >= r.manual) {
        const land = P.chasePt ? Math.hypot(P.chasePt[0], P.chasePt[2]) : 60;
        const st = r.start ?? Math.floor(r.b);
        cap = st + (land > 68 && st >= 2 ? 0 : land > 45 ? 0.22 : 0.4);
        r.tagUp = land > 68 && st >= 2;
      }
      // 가속 주루: 출발하면 ~1초 동안 최고 속도까지 올라가고, 멈추면 감속. 방향 바꾸면(귀루) 다시 가속
      const top = RUN_TOP / BASE_D, dir = r.b < Math.min(r.target, cap) ? 1 : r.b > r.target ? -1 : 0;
      if (dir && r.rdir && dir !== r.rdir) r.v = top * 0.25;
      r.v = dir ? Math.min(top, (r.v || 0) + top * dt / 0.95) : Math.max(0, (r.v || 0) - top * dt / 0.35);
      if (dir) r.rdir = dir;
      const stp = Math.max(r.v, top * 0.15) * dt;
      if (dir > 0) r.b = Math.min(r.target, cap, r.b + stp);
      else if (dir < 0) r.b = Math.max(r.target, r.b - stp);
      if (r.b === r.target && !r.arrived) {
        r.arrived = r.target;
        const base = BASES[r.target % 4];
        // 접전이면 세이프 판정 표시
        let close = false;
        if (b.holder >= 0) { const f = this.fielders[b.holder]; close = dist2(f.x, f.z, base[0], base[1]) < 7; }
        else if (b.state === 'thrown') close = dist2(b.tx, b.tz, base[0], base[1]) < 4 && dist2(b.x, b.z, base[0], base[1]) < 22;
        if (close && r.target >= 1) { this.call(false, r.target, base[0], base[1]); this.ev('safe', { call: 'safe', k: r.target, rid: r.rid, base: r.target, x: r2(base[0]), z: r2(base[1]), close: 1 }); if (r.target < 4) this.say('세이프!', false); }
      }
      if (r.b !== r.target) r.arrived = 0;
      // 슬라이딩: 다음 베이스 3m 앞인데 공 든 수비수나 송구가 그 베이스 근처면
      if (r.b !== r.target && !r.slide) {
        const dir = r.target > r.b ? 1 : -1, nb = dir > 0 ? Math.ceil(r.b) : Math.floor(r.b);
        const left = Math.abs(nb - r.b) * BASE_D;
        if (left < 3.2 && nb >= 1) {
          const base = BASES[nb % 4];
          const threat = (b.holder >= 0 && dist2(this.fielders[b.holder].x, this.fielders[b.holder].z, base[0], base[1]) < 9) || (b.state === 'thrown' && dist2(b.tx, b.tz, base[0], base[1]) < 5);
          if (threat && !(nb === 1 && dir > 0 && r.batter)) this.slide(r, nb);
        }
      }
      if (r.b === r.target || (r.slide && this.now - r.slide > 1.2)) r.slide = 0;
      if (r.b === r.target) { r.forced = false; r.mustReturn = false; }
      if (r.b >= 4 && !r.scored) { r.scored = true; this.addRun(r); this.say('득점!', false); continue; }
      if (this.now < r.manual) continue;
      let ahead = null, behind = null;
      for (const o of alive) {
        if (o === r || o.scored || o.out) continue;
        if (o.b > r.b && (!ahead || o.b < ahead.b)) ahead = o;
        if (o.b < r.b && (!behind || o.b > behind.b)) behind = o;
      }
      if (r.target >= 4) continue;
      const nk = r.target + 1;
      const blocked = ahead && (ahead.target <= nk || ahead.b < nk - 0.05);
      const approaching = r.b >= r.target - 0.35;
      if (approaching && !blocked && !r.mustReturn && !(flyPending && this.outs < 2)) {
        const tRun = (nk - r.b) * BASE_D / Math.max(RUN_SPEED, (r.v || 0) * BASE_D); // 달리는 중이면 현재 속도 기준
        const tDef = this.defTime(nk);
        if (tDef > tRun + (r.target === 3 ? (this.outs === 2 ? -0.3 : this.R.sendHome) : 0.3)) /* 3루 코치: 홈은 접전이어도 돌림(2아웃이면 더 과감) */ { r.target = nk; r.forced = false; continue; }
      }
      if (r.b < r.target && !r.forced && b.holder >= 0 && r.b > Math.floor(r.b)) {
        const remain = (r.target - r.b) * BASE_D / RUN_SPEED;
        const back = (r.b - Math.floor(r.b)) * BASE_D / RUN_SPEED;
        const tDef = this.defTime(r.target);
        if (tDef < remain - 0.6 && back < remain && !(behind && behind.target >= Math.floor(r.b))) r.target = Math.floor(r.b);
      }
    }
  }

  defTime(k) {
    const b = this.ball, base = BASES[k % 4];
    if (b.holder >= 0) {
      const f = this.fielders[b.holder];
      const d = dist2(f.x, f.z, base[0], base[1]);
      if (d < 2) return 0;
      return Math.min(d / FIELD_SPEED, throwT(d) + (b.holder >= 6 ? 0.65 : 0.45)); // 외야수는 잡고 자세 잡는 시간이 더 걸림
    }
    if (b.state === 'thrown') return Math.max(0, b.throwAt + dist2(b.x, b.z, b.tx, b.tz) / THROW_SPEED - this.now) + (dist2(b.tx, b.tz, base[0], base[1]) > 3 ? 1.5 : 0);
    const P = this.play;
    if (P && P.chaseT != null) return Math.max(0, P.chaseT - this.now) + (P.chaser >= 6 ? 0.65 : 0.45) + throwT(dist2(P.chasePt[0], P.chasePt[2], base[0], base[1]));
    let tf = 1e9;
    for (const f of this.fielders) tf = Math.min(tf, Math.max(0, dist2(f.x, f.z, b.x, b.z) - 1.5) / FIELD_SPEED);
    return tf + 0.45 + throwT(dist2(b.x, b.z, base[0], base[1]));
  }

  // ───────── 스냅샷 ─────────
  // drain=true: 쌓인 게임 이벤트를 ev 로 실어 보내고 비움 (Room 브로드캐스트·혼자하기 틱에서만. 접속 직후 개별 전송은 false)
  snapshot(drain = false) {
    const s = { t: 's', now: r2(this.now), ph: this.phase };
    if (drain && this.events.length) s.ev = this.takeEvents();
    if (this.phase === 'lobby') return s;
    s.ru = this.set.rules; s.hx = r2(this.humanEase('contact'));
    const age = (t) => (this.now - t < 3 ? r2(this.now - t) : -1);
    s.mode = this.mode;
    s.inn = this.inning; s.half = this.half; s.sc = this.score; s.ls = this.line; s.hits = this.hits; s.errs = this.errs;
    s.tn = this.set.teams; s.cl = this.set.clubs; s.tod = this.set.tod; s.he = this.set.hitEase; s.fc = this.set.fieldCtl;
    s.cnt = [this.balls, this.strikes, this.outs];
    if (this.play && this.phase === 'live') { if (this.play.rl) s.rl = [this.play.rl.ci, r2(this.play.rl.x), r2(this.play.rl.z), this.play.rl.k]; s.ch = this.play.chaser ?? -1; const c = this.play.cov; s.cv = c ? [c[1] ?? -1, c[2] ?? -1, c[3] ?? -1, c[4] ?? -1] : null; }
    if (this.now - (this.pgAt || -9) > 2) { this.pgAt = this.now; s.pg = [...this.players.values()].filter((p) => p.conn && p.team !== 'spec').map((p) => [p.name, p.ping | 0]); }
    s.bat = this.batter; s.bt = this.batTeam;
    s.msg = [this.msgId, this.msg, this.msgBig ? 1 : 0];
    s.fl = this.fielders.map((f) => [f.pos, r2(f.x), r2(f.z), r2(f.ry), f.ctrl, f.mv, age(f.jt), age(f.dv), age(f.fum)]);
    s.rn = this.alive().map((r) => { const [x, z] = runnerXZ(r.b); return [r2(x), r2(z), r.name, r2(r.b), r.pid, (r.steal ? 1 : 0) | (r.trot ? 2 : 0) | (r.slide ? 4 : 0), r.target, r.rid || 0]; });
    const occ = [false, false, false];
    for (const r of this.alive()) { const k = r.steal ? r.start : r.target; if ((r.b === r.target || r.steal) && k >= 1 && k <= 3) occ[k - 1] = true; }
    s.occ = occ;
    s.bs = this.buntStance ? 1 : 0;
    if (this.phase === 'pitch') s.dl = r2(this.pitchDeadline - this.now);
    if (this.mode === 'game' && this.seqHist && this.seqHist.length) s.sq = this.seqHist.slice(-4); // 이번 타석 최근 구종(볼 배합 표시용)
    if (this.pitch && this.phase !== 'pitch') s.p = this.pitch;
    if (this.fielders.length) { const st = this.stamina(); s.sta = Math.round(st.sta); s.pc = st.pc; }
    if (this.lastPitch) s.lp = this.lastPitch;
    if (this.lastHit) s.lh = this.lastHit;
    const b = this.ball;
    if (b && b.state !== 'dead') s.b = [r2(b.x), r2(b.y), r2(b.z), r2(b.vx), r2(b.vy), r2(b.vz), b.holder, b.state, r2(b.sx || 0), r2(b.sy || 0), r2(b.sz || 0)];
    if (this.phase === 'over') s.win = this.winner;
    s.st = this.statList();
    if (this.mode === 'game') { s.cp = this.curPitcher(); s.ps = [...this.pstats.values()].map((p) => [p.id, p.name, p.team, p.outs, p.r, p.h, p.k, p.bb, p.hr, p.bf]); }
    if (this.mode === 'derby' && this.dy) s.dy = { pr: this.dy.pr ? 1 : 0, sw: this.dy.sw, xh: r2(this.dy.xh), pp: this.ppick, n: this.dy.n, outs: this.dy.outs, idx: this.dy.idx, list: this.dy.order.map((o) => [o.id, o.name, o.hr, o.max, o.done ? 1 : 0]) };
    if (this.hrEv) s.hr = this.hrEv;
    if (this.throwEv) s.te = this.throwEv;
    if (this.catchEv) s.ce = this.catchEv;
    if (this.wallEv) s.we = this.wallEv;
    if (this.callEv) s.ce2 = this.callEv;
    return s;
  }
}
