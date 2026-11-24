// [motion] 모션 모드 — 핸드폰(자이로)·웹캠으로 진짜 휘두르고 던지기. 수비·송구는 CPU가 자동
//  타격: 휘두른 순간(각속도 꼭짓점) = 맞는 순간. 시계 차이·지연은 빼고 그 시각으로 스윙을 보냄(서버는 지연 0.65초까지 받아줌)
//        세게 휘두르면 강타, 보통이면 정타. 높낮이·좌우는 공을 따라가고 약간의 흔들림만
//  투구: 핸드폰 화면을 누르고 있는 동안 기울여서 조준(PC 화면 커서가 따라감) → 팔을 휘두르면 그 순간 릴리스, 휘두른 세기 = 게이지
//        웹캠은 마우스로 조준해 두고 던지는 동작으로 릴리스
import { $, show, setText, setHTML, cls, style } from '../ui/dom.js';
import { drawQR } from './qr.js';
import { createPadLink, newPadCode } from './link.js';
import { createWebcam } from './webcam.js';
import { createPose } from './pose.js';
import { bus } from '../core/bus.js';

const TYPES_KO = { FB: '포심', TS: '투심', SL: '슬라이더', CB: '커브', CH: '체인지업', SP: '스플리터', BP: '빈볼' };
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 핸드폰 휘두른 세기(°/s 꼭짓점) → 투구 게이지. 1000~1700 이 퍼펙트 구간(0.84~0.97), 센서 한계(≈1950)를 찍으면 과투구
export function padPower(pk) {
  if (pk >= 1950) return 1.03;
  if (pk <= 300) return 0.42;
  if (pk <= 1000) return 0.42 + (pk - 300) / 700 * 0.46;
  return Math.min(0.95, 0.88 + (pk - 1000) / 700 * 0.07);
}
// 웹캠 동작 세기(평소 대비 배수) → 게이지
export const camPower = (rel) => clamp(0.55 + (rel - 0.6) * 0.45, 0.5, 0.96);

export function createMotion(api) {
  const { store } = api;
  const M = {
    pad: null, cam: null, code: store.get('padCode', null) || newPadCode(),
    mirror: !!store.get('motionMir', false), // 웹캠 좌우 반전
    calib: store.get('motionCal', 0), // 타이밍 보정(ms, +면 더 늦게 친 걸로)
    auto: store.get('motionAuto', 0), elMean: store.get('motionEl', -12), ori: null, oriT: 0, // [11-23] 자동 보정(ms): 스윙마다 내 평균 타이밍 쪽으로 조금씩
    camLag: 90, // 웹캠 캡처 지연(ms) 기본값
    aim: null, grip: false, lastHS: '', hsT: 0, autoSent: null, log: [],
  };
  store.set('padCode', M.code);
  const padURL = () => `${location.origin}/pad.html#${M.code}`;
  M.connected = () => !!((M.pad && M.pad.pads > 0) || (M.cam && M.cam.on));
  M.active = () => M.connected() && api.mg(); // 모션 플레이 경기에서만 입력을 받음

  // ── 타격 ──
  // 화면 배트 임팩트 시각: 미리 돌기 시작한 배트(sws)의 임팩트, 없으면 지금 바로 휘두름
  const visT = () => { const pre = api.preT(), n = api.simNow(); return Math.max(isFinite(pre) ? pre : n + 0.06, n + 0.02); };
  function swing(atLocalMs, strong, src, el) {
    const S = api.S(), role = api.role();
    if (!S || !S.mo || !role.batter || S.ph !== 'pitching' || !S.p) return S && !S.mo ? 'nomo' : 'skip';
    // 각속도 정점은 '맞혔다고 느끼는 순간'보다 늦음 → 기본 80ms 앞당김 + 자동 보정 + 수동 보정
    const lagMs = performance.now() - atLocalMs - M.calib - M.auto + (src === 'cam' ? M.camLag : 80);
    const t = api.simNow() - lagMs / 1000;
    if (t < S.p.t0 - 0.05) return 'early'; // 공 놓기 전 동작(준비 동작)은 무시
    const p = S.p, sd = src === 'cam' ? 0.07 : 0.055;
    let ay = p.ty + gauss() * sd * 0.8;
    // [11-24] 핸드폰만: 휘두르기 직전(0.15초 전) 커서 위치로 스윙 — 배트 위치를 공 오는 곳에 맞춰 놓고 치기 (공 쪽으로 20%만 도와줌)
    const ca = src === 'pad' ? M.cursorAt(atLocalMs - 150) : null;
    if (ca) {
      const ax = ca[0] + (p.tx - ca[0]) * 0.2 + gauss() * 0.02, ay2 = ca[1] + (p.ty - ca[1]) * 0.2 + gauss() * 0.02;
      api.swing(strong ? 'power' : 'contact', { t, aim: [ax, ay2], vis: visT() });
      M.log.push({ src, lag: Math.round(lagMs), dt: Math.round((t - p.arrive) * 1000), cur: 1 }); if (M.log.length > 20) M.log.shift();
      M.lastLag = Math.round(lagMs);
      const dtMs = (t - p.arrive) * 1000; if (Math.abs(dtMs) < 250) { M.auto = Math.max(-220, Math.min(220, M.auto - dtMs * 0.3)); store.set('motionAuto', Math.round(M.auto)); }
      const off = ca[1] - p.ty; M.lastH = Math.abs(off) < 0.1 ? '높이 딱 맞음' : off > 0 ? '배트가 공보다 위' : '배트가 공보다 아래';
      return 'ok';
    }
    // [motion] 스윙 높이: 정점 때 핸드폰 윗부분(배트 끝) 각도 el(°). 내 평균 각도 = 존 한가운데, 35° 숙이면/들면 존 아래/위 끝 → 공 높이와 어긋난 만큼 빗맞음(65%만 반영해 조금 너그럽게)
    if (isFinite(el)) {
      const zn = S.zn || [-0.236, 0.236, 0.46, 1.06], zc = (zn[2] + zn[3]) / 2, half = (zn[3] - zn[2]) / 2;
      const mk = src === 'cam' ? 'elMeanCam' : 'elMean'; if (M[mk] == null) M[mk] = el;
      const swingY = zc + clamp((el - M[mk]) / 28, -1.6, 1.6) * half; // [11-23] 28°면 존 끝까지 (예전 35°), 85% 반영 (예전 65%라 거의 안 느껴졌음)
      ay = p.ty + (swingY - p.ty) * 0.85 + gauss() * sd * 0.5;
      const hk = swingY > zc + half * 0.35 ? '높게' : swingY < zc - half * 0.35 ? '낮게' : '가운데';
      M.lastH = `스윙 높이 ${hk} (${el > 0 ? '+' : ''}${Math.round(el)}°)`; api.toast(M.lastH);
      M[mk] += (el - M[mk]) * 0.12; if (mk === 'elMean') store.set('motionEl', Math.round(M.elMean * 10) / 10);
      M.lastSwingY = swingY;
    }
    const aim = [p.tx + gauss() * sd, ay];
    api.swing(strong ? 'power' : 'contact', { t, aim, vis: visT() });
    M.log.push({ src, lag: Math.round(lagMs), dt: Math.round((t - p.arrive) * 1000) }); if (M.log.length > 20) M.log.shift();
    M.lastLag = Math.round(lagMs);
    // 자동 보정: 공 근처(±250ms)에서 휘두른 스윙만, 어긋난 만큼의 30%씩 반영 (5~6번이면 내 타이밍에 맞춰짐)
    const dtMs = (t - p.arrive) * 1000;
    if (Math.abs(dtMs) < 250) { M.auto = Math.max(-220, Math.min(220, M.auto - dtMs * 0.3)); store.set('motionAuto', Math.round(M.auto)); }
    return 'ok';
  }
  // ── 투구 ──
  const zoneAim = (x, y) => { const S = api.S(), zn = (S && S.zn) || [-0.236, 0.236, 0.46, 1.06]; const cx = (zn[0] + zn[1]) / 2, cy = (zn[2] + zn[3]) / 2; return [clamp(cx + x * 0.42, -0.8, 0.8), clamp(cy + y * 0.48, 0.15, 1.7)]; };
  function pitch(aim, lv, type) {
    const S = api.S(), role = api.role();
    if (!S || !S.mo || !role.pitcher || S.ph !== 'pitch') return false;
    if (type) api.setType(type);
    api.pitch(aim, lv);
    return true;
  }

  // ── 핸드폰 ──
  function onPad(m) {
    if (m.t === 'ori') { M.ori = [+m.b || 0, +m.g || 0]; if (!(performance.now() < M.curFreeze)) M.curRaw = isFinite(m.cx) ? [m.cx * 22, m.cy * 22] : [M.ori[1], M.ori[0]]; /* 새 핸드폰 페이지는 배트 끝 방향으로 계산한 조준값(cx,cy)을 보냄 */ M.oriQ = Array.isArray(m.q) && m.q.length === 4 ? m.q.map(Number) : null; M.oriT = performance.now(); }
    else if (m.t === 'chk') { const S = api.S(), role = api.role(); if (S && S.mo && role.batter && S.ph === 'pitching' && S.p && api.simNow() > S.p.t0 && api.net()) { api.net().send({ t: 'chk' }); api.toast('체크스윙'); } }
    else if (m.t === 'sws') { // 휘두르기 시작: 정점(=임팩트)은 보통 시작 뒤 ~60ms → 그 시각으로 화면 스윙만 먼저
      const S = api.S(), role = api.role();
      M.curFreeze = performance.now() + 700; // 휘두르는 동안 커서 고정
      if (S && S.mo && role.batter && S.ph === 'pitching' && S.p) { const lag = performance.now() - M.pad.toLocal(m.at) - M.calib - M.auto + 80; const t = api.simNow() - lag / 1000 + 0.06; if (t >= S.p.t0) api.preSwing(t); }
    } else if (m.t === 'swing') { const r = swing(M.pad.toLocal(m.at), m.mode === 'power', 'pad', +m.el); M.pad.send({ t: 'ack', k: 'swing', r, lag: r === 'ok' ? M.lastLag : null, auto: Math.round(M.auto), h: r === 'ok' ? M.lastH : null }); M.lastH = null; }
    else if (m.t === 'grip') { M.grip = !!m.on; if (!m.on) { M.aim = null; api.setAim(null); } }
    else if (m.t === 'aim') { M.aim = [clamp(+m.x || 0, -1.6, 1.6), clamp(+m.y || 0, -1.6, 1.6)]; }
    else if (m.t === 'type') { if (TYPES_KO[m.v]) api.setType(m.v); M.hsT = 0; }
    else if (m.t === 'pitch') {
      const a = zoneAim(clamp(+m.x || 0, -1.6, 1.6), clamp(+m.y || 0, -1.6, 1.6));
      const ok = pitch(a, padPower(+m.pk || 0), TYPES_KO[m.type] ? m.type : null);
      M.grip = false; M.aim = null; api.setAim(null);
      M.pad.send({ t: 'ack', k: 'pitch', r: ok ? 'ok' : 'skip', lv: Math.round(padPower(+m.pk || 0) * 100) });
    } else if (m.t === 'bunt') api.key('b');
    else if (m.t === 'chal') api.key('c');
    else if (m.t === 'guess' && /^[1-3]$/.test(String(m.g))) api.key(String(m.g));
    else if (m.t === 'hello') { M.hsT = 0; paint(); }
  }
  M.connectPad = () => {
    if (api.offline) { setText('mPadSt', '오프라인 판에선 핸드폰 연결이 안 돼 (서버 필요). 웹캠은 돼'); return; }
    if (!M.pad) M.pad = createPadLink(M.code, onPad, () => paint());
    drawQR($('mQR'), padURL(), 5);
    setText('mCode', M.code); setText('mURL', `${location.host}/pad.html`);
    show('mPadBox', true); paint();
  };
  M.newCode = () => { if (M.pad) M.pad.close(); M.pad = null; M.code = newPadCode(); store.set('padCode', M.code); M.connectPad(); };

  // ── 웹캠 ──
  let camCanvas = null;
  M.toggleCam = async () => {
    if (!M.cam) M.cam = createWebcam((b) => {
      const S = api.S(), role = api.role();
      if (role.batter && M.pose && M.pose.ready) return; // 전신 인식 중엔 손목 속도로 스윙 (아래)
      if (role.batter) { const r = swing(b.at, b.rel > 1.25, 'cam'); if (r === 'ok') api.toast(b.rel > 1.25 ? '스윙! (강타)' : '스윙!'); }
      else if (role.pitcher && S && S.ph === 'pitch') { if (pitch(api.aimNow(), camPower(b.rel))) api.toast('투구!'); }
    });
    if (M.cam.on) { M.cam.stop(); if (M.pose) M.pose.stop(); }
    else {
      setText('mCamSt', '카메라 켜는 중…'); const ok = await M.cam.start(); if (!ok) setText('mCamSt', M.cam.err);
      else {
        // 전신 인식(MediaPipe) — 처음 한 번 몇 MB 내려받음. 실패하면 움직임 감지로
        if (!M.pose) M.pose = createPose(M.cam.video, (b) => {
          const S = api.S(), role = api.role();
          // [11-24] 전신 인식 중 투구: 손목이 가장 빠른 순간 = 릴리스, 손목 속도 = 세기 (움직임 감지는 꺼져 있어서 예전엔 투구가 안 됐음)
          if (role.pitcher && S && S.ph === 'pitch') { if (pitch(api.aimNow(), clamp(0.5 + (b.pk - 3) * 0.08, 0.5, 0.97))) api.toast('투구!'); return; }
          if (!role.batter) return;
          const r = swing(b.at, b.pk > 6.5, 'cam', b.h * 62); // 손 높이(어깨 기준 m) → 각도처럼 (0.45m ≈ 28°)
          if (r === 'ok') api.toast(b.pk > 6.5 ? '풀스윙!' : '스윙!');
        });
        setText('mCamSt', '전신 인식 모델 불러오는 중… (처음 한 번)');
        M.pose.load().then((ok) => { if (ok) M.pose.start(); paint(); });
      }
    }
    paint(); syncAuto();
  };

  // 연결 상태를 서버에 알림 → 방 대기실에 '📱 연결됨' 표시 (수비 자동은 모션 플레이 방 설정이 정함)
  function syncAuto() { const on = M.connected(); if (M.autoSent !== on && api.net()) { M.autoSent = on; api.net().send({ t: 'pad', on }); } }
  M.resetNet = () => { M.autoSent = null; };

  function paint() {
    const P = M.pad;
    const padTxt = !P ? '' : !P.open ? '서버에 붙는 중…' : P.pads ? `핸드폰 연결됨${P.direct ? ' ⚡ 직접' : ' · 서버 경유'} · 지연 ${Math.round(P.rtt / 2)}ms` : 'QR을 핸드폰 카메라로 찍어줘';
    setText('mPadSt', padTxt); cls('mPadSt', 'ok', !!(P && P.pads));
    if (M.cam) { setText('mCamSt', M.cam.on ? (M.pose && M.pose.ready ? (M.pose.now() ? '전신 인식 중 · 선수가 내 몸을 따라 해' : '몸이 안 보여 — 카메라에 전신이 나오게 서줘') : M.pose && M.pose.loading ? '전신 인식 모델 불러오는 중…' : M.pose && M.pose.err ? M.pose.err : '웹캠 켜짐 · 옆으로 서서 휘둘러봐') : M.cam.err || '꺼짐'); setText('mCamBtn', M.cam.on ? '웹캠 끄기' : '웹캠 켜기'); cls('mCamSt', 'ok', M.cam.on); }
    show('mCamView', !!(M.cam && M.cam.on));
    setText('mCalV', (M.calib > 0 ? '+' : '') + M.calib + 'ms' + (M.auto ? ` (자동 ${M.auto > 0 ? '+' : ''}${Math.round(M.auto)})` : ''));
    const on = M.connected(); setText('mPlaySt', on ? '준비 끝 · 플레이 볼을 눌러!' : '핸드폰을 연결하거나 웹캠을 켜면 시작할 수 있어'); cls('mPlaySt', 'ok', on);
  }

  // 모달 바인딩
  $('mPadBtn').onclick = () => M.connectPad();
  $('mNewCode').onclick = () => M.newCode();
  $('mCamBtn').onclick = () => M.toggleCam();
  if ($('mMir')) { $('mMir').checked = M.mirror; $('mMir').onchange = (e) => { M.mirror = !!e.target.checked; store.set('motionMir', M.mirror); }; }
  $('mCal').value = M.calib;
  $('mCal').oninput = (e) => { M.calib = +e.target.value | 0; store.set('motionCal', M.calib); paint(); };
  camCanvas = $('mCamView');

  // 매 프레임: 핸드폰에 지금 할 일 알려주기 · 조준 커서 · 웹캠 미리보기 · HUD 배지
  M.update = () => {
    const S = api.S(), role = api.role();
    if (M.pad) {
      M.pad.tick();
      const st = !S || api.screen() !== 'game' ? 'wait' : !S.mo ? 'nomo' : role.batter && (S.ph === 'pitch' || S.ph === 'pitching') ? 'bat' : role.pitcher && S.ph === 'pitch' ? 'pitch' : 'wait';
      const hs = st + '|' + api.type() + '|' + (S && S.bs ? 1 : 0) + '|' + (api.canChal() ? 1 : 0);
      const n = performance.now();
      if (M.pad.pads && (hs !== M.lastHS || n - M.hsT > 1500)) { M.lastHS = hs; M.hsT = n; M.pad.send({ t: 'hs', st, ph: !!(S && api.screen() === 'game'), type: api.type(), types: api.types(), bunt: !!(S && S.bs), chal: !!api.canChal() }); }
      if (st !== 'pitch' && M.grip) { M.grip = false; M.aim = null; api.setAim(null); }
      if (M.grip && M.aim) api.setAim(zoneAim(M.aim[0], M.aim[1]));
    }
    syncAuto();
    const on = M.active();
    show('motionBadge', on && api.screen() === 'game');
    if (on) setText('motionBadgeT', [(M.pad && M.pad.pads) ? '📱 핸드폰' : '', (M.cam && M.cam.on) ? '📷 웹캠' : ''].filter(Boolean).join(' · ') + (S && S.mo === 2 ? ' · 스크린야구' : ' · 수비 자동'));
    const camOn = !!(M.cam && M.cam.on);
    if (M.cam) M.cam.paused = !!(M.pose && M.pose.ready);
    const pn = performance.now(), paintNow = pn - (M.paintT || 0) > 66; if (paintNow) M.paintT = pn; // [perf] 미리보기 15fps
    show('motionCam', camOn && api.screen() === 'game' && api.mg());
    if (camOn) {
      if (paintNow && api.screen() === 'game' && api.mg()) M.cam.paint($('motionCamC'));
      if (paintNow && !$('motionM').classList.contains('hide')) M.cam.paint(camCanvas);
      style('motionCamBar', 'width', Math.min(100, M.cam.e * 400).toFixed(0) + '%');
    }
  };
  // 스윙 결과를 핸드폰에도 (맞으면 진동)
  const S0 = () => api.S();
  bus.on('localSwing', (e) => {
    if (!M.pad || !M.pad.pads) return;
    const late = e.dt > 0, ms = Math.abs(e.dt);
    const txt = e.contact ? (e.q > 0.8 ? '정타! 제대로 맞았다' : '맞혔다!') : ms > 140 ? (late ? `늦었어 (${ms}ms)` : `빨랐어 (${ms}ms)`) : '헛스윙';
    const hi = M.lastSwingY != null && S0() && S0().p ? (M.lastSwingY > S0().p.ty + 0.12 ? ' · 공 위로 지나감' : M.lastSwingY < S0().p.ty - 0.12 ? ' · 공 아래로 지나감' : '') : '';
    // 타격감: 정타 = 길고 묵직하게, 맞힘 = 짧게 두 번, 헛스윙 = 아주 짧게
    M.pad.send({ t: 'fb', k: 'swing', txt: txt + (e.contact ? '' : hi), col: e.contact ? '#4fd18b' : '#ff8a80', vib: e.contact ? (e.q > 0.8 ? [90, 30, 140] : [35, 40, 35]) : 15 });
    M.lastSwingY = null;
  });
  // 실시간 배트: 핸드폰 기울기(타석 자세 기준, °) → 배트 각도(rad). 0.25초 넘게 안 오면 끔
  const bo = [0, 0];
  // [위 방식] 3D 회전이 오면 쿼터니언 그대로 [x,y,z,w] (프레임마다 부드럽게 따라감)
  const bq = [0, 0, 0, 1];
  M.batQ = () => {
    const q = M.oriQ; if (!q || performance.now() - M.oriT > 250) return null;
    let d = bq[0] * q[0] + bq[1] * q[1] + bq[2] * q[2] + bq[3] * q[3]; const sg = d < 0 ? -1 : 1;
    for (let i = 0; i < 4; i++) bq[i] += (q[i] * sg - bq[i]) * 0.55;
    const n = Math.hypot(bq[0], bq[1], bq[2], bq[3]) || 1; for (let i = 0; i < 4; i++) bq[i] /= n;
    return bq;
  };
  // [11-24] 핸드폰 조준 커서: 타석 자세 기준 좌우 기울기 → 좌우, 앞뒤 기울기 → 높낮이 (22°면 존 끝)
  M.cur = null; M.curHist = [];
  M.updateCursor = () => {
    const S = api.S(); if (!M.curRaw || performance.now() - M.oriT > 300 || (M.cam && M.cam.on && M.pose && M.pose.ready)) { M.cur = null; return null; }
    const zn = (S && S.zn) || [-0.236, 0.236, 0.46, 1.06], cx = (zn[0] + zn[1]) / 2, cy = (zn[2] + zn[3]) / 2, hw = (zn[1] - zn[0]) / 2, hh = (zn[3] - zn[2]) / 2;
    const tx = cx + clamp(M.curRaw[0] / 22, -1.7, 1.7) * hw, ty = cy + clamp(M.curRaw[1] / 22, -1.7, 1.7) * hh;
    if (!M.cur) M.cur = [tx, ty]; else { M.cur[0] += (tx - M.cur[0]) * 0.35; M.cur[1] += (ty - M.cur[1]) * 0.35; }
    const n = performance.now(); M.curHist.push([n, M.cur[0], M.cur[1]]); while (M.curHist.length > 90) M.curHist.shift();
    return M.cur;
  };
  M.cursorAt = (tMs) => { if (!M.cur || !M.curHist.length) return null; let r = M.curHist[0]; for (const h of M.curHist) { if (h[0] > tMs) break; r = h; } return [r[1], r[2]]; };
  M.poseNow = () => (M.pose && M.pose.ready && M.cam && M.cam.on ? M.pose.now() : null);
  M.batOff = () => {
    if (!M.ori || performance.now() - M.oriT > 250) return null;
    bo[0] += (M.ori[0] * Math.PI / 180 - bo[0]) * 0.5; // 핸드폰 윗부분 들면 배트도 세워짐(스크린샷으로 방향 확인) bo[1] += (M.ori[1] * Math.PI / 180 - bo[1]) * 0.5;
    return bo;
  };
  M.paint = paint;
  setInterval(paint, 1000);
  return M;
}
