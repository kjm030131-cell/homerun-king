// [cam] 카메라 연출 — 역할별 시점(타자·투수·포수·야수·주자·관전·리플레이·홈런·등장 컷씬·타이틀 궤도)
// main.js 에서 옮김(다른 파트와 충돌 줄이기). main.js 는 createCamRig(camera, ctx) 로 만들고 매 프레임 rig.update() 만 부른다.
//
// 원칙 (HANDOFF 0-3 · docs/rebuild/gameplay.md 5-A · docs/rebuild/camera.md)
// - 할 일 없을 땐 고정 중계 화면. 공 따라 휙휙 X. 전환은 임계감쇠 스프링(smoothDamp).
// - 타구 순간은 '컷' + deadzoneCam(고정 위치·고정 화각, 공이 데드존을 벗어날 때만 고개) → 화면 공 속도 유지. 이 부분 숫자는 건드리지 말 것.
// - 공 위치 미리보기 금지: 카메라가 투구 목표 쪽으로 미리 움직이지 않는다.
import * as THREE from 'three';
import { BASES, MOUND } from '../../shared/sim.js';
import { cfg, store, toast, myDuty } from '../ui/index.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

// Unity SmoothDamp 방식 (임계감쇠 스프링) — 축별로 직접 (배열 할당 없음)
function damp1(cur, target, vel, c, omega, dt, exp) {
  const change = cur[c] - target[c];
  const temp = (vel[c] + omega * change) * dt;
  vel[c] = (vel[c] - omega * temp) * exp;
  cur[c] = target[c] + (change + temp) * exp;
}
export function smoothDamp(cur, target, vel, smoothTime, dt) {
  const omega = 2 / Math.max(1e-4, smoothTime), x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  damp1(cur, target, vel, 'x', omega, dt, exp); damp1(cur, target, vel, 'y', omega, dt, exp); damp1(cur, target, vel, 'z', omega, dt, exp);
}

// 수비 3인칭 드래그 상태 (main.js 포인터 입력이 씀)
export const fcam = { yawOff: 0, pitchOff: 0, dragT: 0, yaw: null, fi: -1, mx: 0, mz: 0 };

// 사용자 시점 프리셋 (설정 창 + Z 키). 0 가까이 · 1 기본 · 2 멀리
const DIST_NAME = ['가까이', '기본', '멀리'];
const DIST_K = [0.78, 1, 1.28]; // 3인칭·주자 카메라 거리 배율
const FOV_K = [0.86, 1, 1.17]; // 망원 시점(타자·투수·중계) 화각 배율 — 가까이 = 존·투수가 크게
const BAT_H = [1.52, 1.72, 2.02]; // 타자 시점 높이 (기본 1.72 = pitch.md 측정 기준)
const distI = () => clamp(cfg.camDist ?? 1, 0, 2) | 0;

export function createCamRig(camera, ctx) {
  const camPos = new THREE.Vector3(0, 60, -100), camLook = new THREE.Vector3(0, 0, 60);
  const tPos = new THREE.Vector3(), tLook = new THREE.Vector3();
  const camVel = new THREE.Vector3(), lookVel = new THREE.Vector3();
  const _v = new THREE.Vector3();
  let camFov = 55, lastMode = '', blendT = 0, direct = false, snap = false, titleSeen = false;
  let peek = false; // X 누르고 있는 동안: 투수 = 주자 보기
  const rig = { mode: '', peek: false };

  // 좌타 미러: 타자가 1루 쪽(-x)에 서 있으면 -1. (지금 sim 에는 좌타가 없지만 서는 자리만 바뀌면 카메라는 따라감)
  const side = () => { const w = window.__camSide; if (w) return w; const B = ctx.batter; return B && B.p.root.position.x < -0.2 ? -1 : 1; };

  // ── 3인칭 수비 카메라 ──
  // 선수 뒤·약간 오른쪽 어깨 위. 가로는 목표(공·낙구 지점·송구 베이스·홈) 방향, 세로는 '내 발 ~ 목표'가 한 화면에 들어오게 기울기·화각을 계산.
  // (전: 높이 2.6m 에서 수평선을 봐서 화면 절반이 관중석·하늘, 홈·공이 작았음)
  function tpsCam(me, tx, ty, tz, dt, holding) {
    const D = DIST_K[distI()];
    let yaw = Math.atan2(tx - me.x, tz - me.z);
    const dd = Math.hypot(tx - me.x, tz - me.z);
    // [gameplay 11-19] 목표가 가까우면(뜬공이 내 머리 위 등) 홈→나 방향으로 고정: 화면 위쪽 = 외야로 항상 같고 빙글빙글 안 돎
    // 공을 들고 송구 베이스 바로 위에 서 있으면(포스아웃 후 등) 방향을 그대로 둠 — 발밑 목표로 화면이 빙글 도는 것 방지
    if (dd < 4) yaw = holding ? (fcam.yaw ?? yaw) : Math.hypot(me.x, me.z) > 3 ? Math.atan2(me.x, me.z) : (fcam.yaw ?? yaw);
    if (fcam.yaw == null || snap) fcam.yaw = yaw;
    let d = yaw - fcam.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    fcam.yaw += d * Math.min(1, dt * (holding ? 3.2 : 2.2));
    if (ctx.nowP() - fcam.dragT > 2.5) { fcam.yawOff *= Math.exp(-dt * 1.2); fcam.pitchOff *= Math.exp(-dt * 1.2); }
    const Y = fcam.yaw + fcam.yawOff, fx = Math.sin(Y), fz = Math.cos(Y), rx = -fz, rz = fx;
    // 공이 높이 뜰수록 뒤로·위로 빠짐 (gameplay 11-19 — 내 선수 + 공이 같이 보이게)
    const hb = clamp(ty, 0, 14);
    const back = (5.4 + hb * 0.35) * D, up = (3.0 + hb * 0.28) * (0.75 + 0.25 * D) + fcam.pitchOff * 5, sh = 0.75 * D;
    tPos.set(me.x - fx * back + rx * sh, up, me.z - fz * back + rz * sh);
    // 세로 구도: 내려다보는 각(+)으로 발·목표
    const hp = back, aFeet = Math.atan2(up, hp);
    const dt2 = Math.max(1, Math.hypot(tx - tPos.x, tz - tPos.z));
    const aTgt = Math.min(Math.atan2(up - Math.max(ty, 0.6), dt2), Math.atan2(up - 0.3, dt2)); // 공 높이와 그 아래 땅 둘 다
    const HMIN = 0.30, HMAX = 0.55; // 세로 반화각 (rad) = 화각 34°~63°
    let h = clamp((aFeet - aTgt) / 1.42, HMIN, HMAX);
    let c = aFeet - 0.78 * h; // 내 발을 화면 아래 ~89% 에, 목표는 위에서 ~18% 에
    if (aTgt < c - 0.64 * h) c = aTgt + 0.64 * h; // 목표가 위로 벗어나면 목표 우선(발은 조금 잘려도)
    const L = 20;
    tLook.set(tPos.x + fx * Math.cos(c) * L, tPos.y - Math.sin(c) * L, tPos.z + fz * Math.cos(c) * L);
    return (2 * h * 180) / Math.PI;
  }

  // [gameplay] 타구 직후 중계 카메라: 홈 뒤 높은 곳에 고정, 시선은 공이 화면 데드존(가로 ±50%, 위·아래 60%)을 벗어날 때만 따라감.
  // 데드존 안에선 배경이 멈춰 있어 공이 실제 속도로 보인다. 화각 고정 54°(줌으로 공 움직임이 상쇄되지 않게) — 숫자 바꾸지 말 것
  const DZ = { id: -1, yaw: 0, pitch: 0, pos: new THREE.Vector3(0, 8.5, -15), fov: 54 };
  function deadzoneCam(dt) {
    const P = DZ.pos, ballPos = ctx.ballPos, lct = ctx.lastContactT;
    if (DZ.id !== lct) { DZ.id = lct; DZ.yaw = 0; DZ.pitch = Math.atan2(1.5 - P.y, 24 - P.z); }
    const dx = ballPos.x - P.x, dy = ballPos.y - P.y, dz = ballPos.z - P.z;
    const by = Math.atan2(dx, dz), bp = Math.atan2(dy, Math.hypot(dx, dz));
    const th = Math.tan(DZ.fov * Math.PI / 360), ax = Math.atan(0.5 * th * camera.aspect), au = Math.atan(0.62 * th), ad = Math.atan(0.6 * th);
    let ty = DZ.yaw, tq = DZ.pitch;
    if (by - DZ.yaw > ax) ty = by - ax; else if (DZ.yaw - by > ax) ty = by + ax;
    if (bp - DZ.pitch > au) tq = bp - au; else if (DZ.pitch - bp > ad) tq = bp + ad;
    const kk = 1 - Math.exp(-9 * dt);
    DZ.yaw += (ty - DZ.yaw) * kk; DZ.pitch += (clamp(tq, -0.6, 1.0) - DZ.pitch) * kk;
    tPos.copy(P);
    tLook.set(P.x + Math.sin(DZ.yaw) * Math.cos(DZ.pitch) * 30, P.y + Math.sin(DZ.pitch) * 30, P.z + Math.cos(DZ.yaw) * Math.cos(DZ.pitch) * 30);
    return DZ.fov;
  }

  // 내가 주자면 [x, z, base(실수), target]
  function myRunner(S) {
    const id = ctx.myId; if (!id || !S.rn) return null;
    for (const r of S.rn) if (r[4] === id) return r;
    return null;
  }
  // 앞선 주자의 베이스 (투수 '주자 보기')
  function leadBase(S) {
    let best = 0; for (const r of S.rn || []) { const b = Math.round(r[3]); if (b > best && b < 4) best = b; }
    return best;
  }

  // 키: V(시점 전환) · Z(거리 프리셋) · X(누르고 있는 동안 주자 보기). 처리하면 true
  rig.key = (k, role, S) => {
    if (k === 'v' && S && role.fi >= 0 && !role.pitcher && role.pos !== 'C') { cfg.fieldCam = cfg.fieldCam === 'tps' ? 'tv' : 'tps'; store.set('fieldCam', cfg.fieldCam); fcam.yawOff = 0; toast(cfg.fieldCam === 'tps' ? '수비 시점: 내 선수 뒤 (드래그로 회전)' : '수비 시점: 중계 화면'); return true; }
    if (k === 'v') { cfg.batCam = cfg.batCam === 1 ? 0 : 1; store.set('batCam', cfg.batCam); toast(cfg.batCam === 1 ? '타격 시점: 가까이 (존 크게)' : '타격 시점: 포수 뒤 (중계)'); return true; }
    if (k === 'z') { cfg.camDist = (distI() + 1) % 3; store.set('camDist', cfg.camDist); toast(`시점 거리: ${DIST_NAME[cfg.camDist]} (설정에서도 바꿀 수 있어)`); return true; }
    if (k === 'x') { if (!peek && S && role.pitcher && leadBase(S)) { peek = true; } return !!peek; }
    return false;
  };
  rig.keyUp = (k) => { if (k === 'x') peek = false; };
  rig.blur = () => { peek = false; };

  rig.update = (dt, time, shake, punch) => {
    const S = ctx.S, screen = ctx.screen, tp = ctx.nowP(), ballPos = ctx.ballPos, ballMesh = ctx.ballMesh, fielders = ctx.fielders;
    let k = 4, fov = 55, mode = '';
    direct = false;
    if (screen === 'title' || screen === 'room' || screen === 'browser' || !S || !S.fl) {
      // [ui 11-23] 메뉴 배경: 경기장 안쪽을 낮게 도는 드론 컷 (예전 궤도는 관중석 지붕 뒤로 지나가 검은 판이 화면을 덮었음). 첫 화면은 그 자리에서 바로 시작
      const a = time * 0.045 + 0.9;
      tPos.set(Math.sin(a) * 52, 21 + Math.sin(time * 0.11) * 4, 50 - Math.cos(a) * 56);
      tLook.set(Math.sin(a + 1.2) * 8, 3, 50); k = 1.5;
      if (lastMode !== 'title' && !titleSeen) { direct = true; titleSeen = true; }
      mode = 'title';
    } else {
      const role = window.__camRole ? window.__camRole(ctx.getRole()) : ctx.getRole(); // qa: 역할 바꿔 찍기(주자·관전 시점)
      const ph = S.ph, sd = side(), di = distI();
      const pitchPhase = ph === 'pitch' || ph === 'pitching' || (ph === 'result' && !S.b && !(S.p && S.p.res === 'hit'));
      const hr = ctx.hrCine && tp - ctx.hrCineStart < 5.5;
      const rpInfo = ctx.rpInfo;
      const IN = rpInfo ? null : ctx.introStep();
      // 조작 선수가 멀리 바뀌면(자동 전환·송구 받는 선수) 쓸어가지 않고 한 번에 컷
      snap = false;
      if (role.fi >= 0 && fielders[role.fi]) {
        const P = fielders[role.fi].p.root.position;
        if (fcam.fi !== role.fi) { if (fcam.fi >= 0 && Math.hypot(P.x - fcam.mx, P.z - fcam.mz) > 10) snap = true; fcam.fi = role.fi; }
        fcam.mx = P.x; fcam.mz = P.z;
      } else fcam.fi = -1;
      if (IN) {
        // ── 등장 컷씬 카메라 ──
        if (IN.kind === 'b') { const B = ctx.batter ? ctx.batter.p.root.position : _v.set(0.95 * sd, 0, 0.05); tPos.set(B.x - 2.5 * sd + IN.e * 0.12 * sd, 1.5, B.z + 1.7 - IN.e * 0.1); tLook.set(B.x, 1.38, B.z); fov = 30; }
        else { tPos.set(0.9 - IN.e * 0.1, 1.75, 14.4 + IN.e * 0.15); tLook.set(0, 1.5, 18.44); fov = 28; }
        k = 30; mode = 'intro';
      } else if (rpInfo) {
        // ── 리플레이 카메라 ──
        const I = rpInfo; fov = 42; k = 7;
        if (I.cam === 'hr' && I.rel < 0.32) {
          const a = I.rel * 0.25; // 타자 정면 비스듬히: 스윙과 임팩트
          tPos.set((-2.4 + a) * sd, 1.15, 2.7 - a); tLook.set(0.75 * sd, 1.05, 0.15); fov = 36; k = 9;
        } else if (I.cam === 'hr') {
          const b = ballMesh.position, d = Math.hypot(b.x, b.z) || 1, ux = b.x / d, uz = b.z / d; // 공 뒤를 쫓는 추적 카메라
          tPos.set(b.x - ux * 11 - uz * 3, Math.max(2.5, b.y * 0.7 + 3), b.z - uz * 11 + ux * 3); tLook.copy(b); fov = 48; k = 5;
        } else {
          const F = I.focus ? I.focus.root.position : ballMesh.position; // 호수비: 야수 옆 낮은 시점, 천천히 회전
          const base = Math.atan2(-F.x, -F.z) + 0.9 + I.rel * 0.35;
          tPos.set(F.x + Math.sin(base) * 5.2, 1.25, F.z + Math.cos(base) * 5.2); tLook.set(F.x, 0.8, F.z); fov = 44; k = 6;
        }
        mode = 'replay';
      } else if (hr) {
        const e = tp - ctx.hrCineStart;
        if (e < 2.4 && ballMesh.visible) { tPos.set(ballPos.x * 0.35, 6 + ballPos.y * 0.55, ballPos.z * 0.5 - 12); tLook.copy(ballPos); k = 4; fov = 50; }
        else { const a = (e - 2.4) * 0.08; tPos.set(Math.sin(a) * 30, 9, -18 + e * 2); tLook.set(0, 40, 140); k = 1.6; fov = 58; }
        mode = 'hr';
      } else if (pitchPhase && role.batter) {
        // 기본: 포수 뒤 망원(pitch.md — 투수 릴리스·존이 한 화면, 타자는 왼쪽 가장자리). 높이 프리셋을 바꿔도 존이 화면의 같은 자리에 오게 시선 높이를 같이 보정
        // V: 가까이(존 크게) — 전엔 존이 화면 맨 아래 왼쪽에 붙어 있었음 → 존·투수가 가운데 세로줄에
        if (cfg.batCam === 1) { tPos.set(-0.55 * sd, 1.66, -3.6); tLook.set(0.7 * sd, -0.35, 14); fov = 38 * FOV_K[di]; }
        else { const H = BAT_H[clamp(cfg.batH ?? 1, 0, 2) | 0]; tPos.set(-0.32 * sd, H, -6.6); tLook.set(-0.08 * sd, H + (1.26 - H) * (18.6 / 6.6), 12); fov = 25 * FOV_K[di]; }
        k = 8; mode = 'bat';
      } else if (pitchPhase && role.pitcher) {
        const lb = peek && ph === 'pitch' ? leadBase(S) : 0;
        if (lb) {
          // X: 주자 보기 — 마운드 뒤에서 앞선 주자 쪽으로 고개 (견제 대상 확인). 떼면 원래 조준 시점으로
          const B = BASES[lb]; tPos.set(0.4, 2.7, 23.5); tLook.set(B[0], 0.9, B[1]); fov = 46; k = 6;
        } else if (ph === 'pitch') {
          // [gameplay 11-19] 조준 중: 존이 화면 높이의 ~15%로 보이게 투수 머리 위로 가깝게 + 망원. 시선은 투수 머리 위로 지나가서 존을 안 가림
          tPos.set(0.5, 3.2, 24.6); tLook.set(0.02, 0.8, 0); fov = 9.5 * FOV_K[di]; k = 6;
        } else {
          // 투구: 같은 시선 줄 위에서 조금만 뒤로(전: 30.8m·4.4m·25° 로 크게 빠져서 와인드업 시작마다 화면이 확 바뀜) → 투구 폼 + 공 궤적 + 존
          tPos.set(0.8, 3.9, 28.6); tLook.set(0.06, 0.65, 3); fov = 19 * FOV_K[di]; k = 3.2;
        }
        mode = 'pitch';
      } else if (pitchPhase && role.pos === 'C') {
        // 포수: 전엔 눈높이(1.85m)라 주심 등·내 머리가 존을 가렸음 → 더 높이·뒤에서 내려다보고 주심은 숨김(bat 과 같음)
        tPos.set(0.15 * sd, 3.2, -5.6); tLook.set(0, -0.54, 12); k = 6; mode = 'catch'; fov = 44 * FOV_K[di];
      } else if (pitchPhase && role.fi >= 0 && fielders[role.fi] && cfg.fieldCam === 'tps') {
        fov = tpsCam(fielders[role.fi].p.root.position, 0, 1.0, 0, dt, false); k = 5; mode = 'fwait'; // 내 포지션 뒤에서 홈 쪽
      } else if (pitchPhase && role.fi >= 0 && fielders[role.fi]) {
        // 투구 대기: 수비 중 카메라와 같은 방향(홈 뒤 높은 곳) → 타구 나와도 시점이 뒤집히지 않음
        const P = fielders[role.fi].p.root.position;
        const cz = (P.z + 18) / 2, cx = P.x / 2;
        tPos.set(cx * 0.3, 8 + Math.max(P.z, 10) * 0.12, -14 + cz * 0.2);
        tLook.set(cx, 0.8, cz); k = 4; mode = 'fwait'; fov = 50;
      } else if (pitchPhase && role.offense && myRunner(S)) {
        // 내가 주자: 내 베이스 바깥 뒤·위에서 마운드 쪽 → 투수(견제)·내 리드·다음 베이스·내야 수비가 한 화면
        const r = myRunner(S), D = DIST_K[di], mx = MOUND[0], mz = MOUND[1];
        let ux = r[0] - mx, uz = r[1] - mz; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
        tPos.set(r[0] + ux * 7.5 * D, 4.6 * (0.7 + 0.3 * D), r[1] + uz * 7.5 * D);
        tLook.set(lerp(r[0], mx, 0.55), 0.9, lerp(r[1], mz, 0.55)); fov = 58; k = 4; mode = 'run';
      } else if (pitchPhase) {
        // 관전·대기: 중견수 뒤 망원(실제 중계의 기본 화면) — 투수·타자·포수·존
        tPos.set(3.2, 7.6, 118); tLook.set(0.0, 1.05, 0); k = 6; mode = 'tv'; fov = 4.4 * FOV_K[di];
      } else if (role.pos === 'P' && (ph === 'live' || (ph === 'result' && S.b)) && !role.holding && !['chase', 'cover', 'hold', 'relay'].includes(myDuty(S, role)?.k)) {
        // 투수가 할 일이 없을 땐 내 선수 따라 흔들리지 않게 '중계 카메라'로 고정 → 어지럽지 않음
        const bz = ballPos.z, bx = ballPos.x;
        if (!ballMesh.visible) { tPos.set(0, 9, -15); tLook.set(0, 1, 20); }
        else if (tp - ctx.lastContactT < 2.4) { fov = deadzoneCam(dt); direct = true; } // [gameplay] 고정 중계 + 데드존
        else { const far = clamp(bz, 0, 120); tPos.set(bx * 0.2, 8 + far * 0.08, -15 + far * 0.18); tLook.set(bx * 0.8, Math.max(0.6, Math.min(ballPos.y, 20) * 0.5), Math.max(8, bz * 0.85)); fov = 52; }
        k = tp - ctx.lastContactT < 2.4 ? 6 : 2.2; mode = 'pwatch';
      } else if (role.fi >= 0 && fielders[role.fi] && (ph === 'live' || (ph === 'result' && S.b)) && cfg.fieldCam === 'tps') {
        // 3인칭: 내 선수 뒤에서 공(또는 낙구 지점) 쪽. 공을 들면 송구할 베이스 쪽으로 돌아섬(전: 공이 내 손이라 '홈→나' 방향 = 외야를 봤음)
        const me = fielders[role.fi].p.root.position, landRing = ctx.landRing;
        if (role.holding) { const B = BASES[ctx.recBase() % 4]; fov = tpsCam(me, B[0], 1, B[1], dt, true); }
        else {
          const tgt = landRing.visible ? landRing.position : ballMesh.visible ? ballPos : null;
          fov = tgt ? tpsCam(me, tgt.x, ballMesh.visible ? ballPos.y : 1, tgt.z, dt, false) : tpsCam(me, 0, 1, 0, dt, false);
        }
        k = 4.5; mode = 'field';
      } else if (role.fi >= 0 && fielders[role.fi] && (ph === 'live' || (ph === 'result' && S.b))) {
        // 수비 카메라(V 중계): 홈 뒤 높은 곳에서 '공 + 내 수비수'를 같이 잡는 중계 시점. W = 외야 쪽 / S = 홈 쪽 / A·D = 화면 좌우로 항상 같음
        const me = fielders[role.fi].p.root.position;
        const bx = ballMesh.visible || role.holding ? ballPos.x : me.x, bz = ballMesh.visible || role.holding ? ballPos.z : me.z;
        const cx = (me.x + bx) / 2, cz = (me.z + bz) / 2;
        const spread = Math.hypot(me.x - bx, me.z - bz);
        const far = Math.max(cz, 10);
        tPos.set(cx * 0.3, 7 + far * 0.13 + spread * 0.12 + clamp(ballPos.y * 0.15, 0, 6), -14 + cz * 0.3 - spread * 0.15);
        tLook.set(cx, Math.max(0.5, ballMesh.visible ? Math.min(ballPos.y, 14) * 0.45 : 0.8), cz);
        k = 3.2; mode = 'field'; fov = clamp(46 + spread * 0.25, 46, 62);
      } else {
        // 타구 중계: 맞은 직후엔 홈 뒤에 '고정'하고 고개만 돌려 공을 따라감 → 공이 실제 속도로 쭉 뻗어나가 보임
        const bz = ballPos.z, bx = ballPos.x, tc = tp - ctx.lastContactT, ballL = ctx.ballL, fly = ballL && ballL.state === 'air';
        if (!ballMesh.visible && !(S.b && S.b[6] >= 0)) { tPos.set(0, 30, -30); tLook.set(0, 0, 30); k = 3; fov = 52; }
        else if (tc < 2.4 && (fly || bz < 40)) {
          // [gameplay] 맞는 순간 중계 위치로 '컷' → 카메라 고정, 공이 화면 가운데 데드존을 벗어날 때만 고개를 돌림 (docs/rebuild/gameplay.md 5-A)
          fov = deadzoneCam(dt); direct = true; k = 6;
        } else {
          // 그 뒤엔 높은 중계로 천천히. 내가 주자면 '공 + 내 주자'를 같이 잡음(다음 베이스·공 위치 판단)
          const r = role.offense ? myRunner(S) : null;
          let cx = bx, cz = bz, spread = 0;
          if (r) { spread = Math.hypot(r[0] - bx, r[1] - bz); const w = spread < 70 ? 0.45 : 0.25; cx = lerp(bx, r[0], w); cz = lerp(bz, r[1], w); }
          tPos.set(cx * 0.35, 14 + cz * 0.1 + ballPos.y * 0.15 + spread * 0.08, cz * 0.3 - 16 - spread * 0.06);
          tLook.set(cx, Math.max(0.5, Math.min(ballPos.y, 15) * 0.3), cz); k = 2; fov = r ? clamp(52 + spread * 0.1, 52, 60) : 52;
          if (!r) tLook.copy(ballPos).setY(Math.max(0.5, ballPos.y * 0.7));
        }
        mode = 'follow';
      }
    }
    if (window.__cam) { const c = window.__cam; tPos.set(...c.pos); tLook.set(...c.look); fov = c.fov || 50; k = 1000; }
    const a = 1 - Math.exp(-k * dt);
    // 스프링(임계감쇠)으로 따라감: 시작·끝이 부드럽고 튀지 않음. 시점이 바뀐 직후엔 잠깐 더 천천히 블렌드
    if (mode !== lastMode) { blendT = tp; lastMode = mode; }
    const blend = clamp((tp - blendT) / 0.7, 0, 1);
    const smooth = (window.__cam || window.__fastCam ? 0.0001 : (1 / Math.max(0.5, k)) * (1.6 - 0.6 * blend));
    if (direct || snap) { camPos.copy(tPos); camLook.copy(tLook); camVel.set(0, 0, 0); lookVel.set(0, 0, 0); camFov = fov; } // [gameplay] 데드존 카메라는 직접 (스프링 지연 없음) · 조작 선수 먼 전환은 컷
    else { smoothDamp(camPos, tPos, camVel, smooth, dt); smoothDamp(camLook, tLook, lookVel, smooth * 0.85, dt); }
    camera.position.copy(camPos);
    if (shake > 0 && cfg.shake) { camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake; }
    camera.lookAt(camLook);
    if (!direct && !snap) camFov = window.__cam || window.__fastCam ? fov : lerp(camFov, fov, mode === 'tv' || fov < 30 ? Math.min(1, a * 1.5) : a);
    const fovNow = camFov - punch;
    if (Math.abs(camera.fov - fovNow) > 0.01) { camera.fov = fovNow; camera.updateProjectionMatrix(); }
    // 타자 시점에선 포수·주심 숨김, 포수 시점에선 주심만 숨김 (존을 가리지 않게). 바뀔 때만 건드림
    if (S && S.fl) {
      const hideU = mode === 'bat' || mode === 'catch', hideC = mode === 'bat';
      const U = ctx.umps[0]; if (U && U.p.root.visible === hideU) U.p.root.visible = !hideU;
      let ci = -1; for (let i = 0; i < S.fl.length; i++) if (S.fl[i][0] === 'C') { ci = i; break; }
      const C = ci >= 0 && fielders[ci]; if (C && C.p.root.visible === hideC) C.p.root.visible = !hideC;
    }
    rig.mode = mode; rig.peek = peek; rig.direct = direct;
  };
  return rig;
}
