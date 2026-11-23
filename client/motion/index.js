// [motion] 모션 모드 — 핸드폰(자이로)·웹캠으로 진짜 휘두르고 던지기. 수비·송구는 CPU가 자동
//  타격: 휘두른 순간(각속도 꼭짓점) = 맞는 순간. 시계 차이·지연은 빼고 그 시각으로 스윙을 보냄(서버는 지연 0.65초까지 받아줌)
//        세게 휘두르면 강타, 보통이면 정타. 높낮이·좌우는 공을 따라가고 약간의 흔들림만
//  투구: 핸드폰 화면을 누르고 있는 동안 기울여서 조준(PC 화면 커서가 따라감) → 팔을 휘두르면 그 순간 릴리스, 휘두른 세기 = 게이지
//        웹캠은 마우스로 조준해 두고 던지는 동작으로 릴리스
import { $, show, setText, setHTML, cls, style } from '../ui/dom.js';
import { drawQR } from './qr.js';
import { createPadLink, newPadCode } from './link.js';
import { createWebcam } from './webcam.js';
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
    calib: store.get('motionCal', 0), // 타이밍 보정(ms, +면 더 늦게 친 걸로)
    camLag: 90, // 웹캠 캡처 지연(ms) 기본값
    aim: null, grip: false, lastHS: '', hsT: 0, autoSent: null, log: [],
  };
  store.set('padCode', M.code);
  const padURL = () => `${location.origin}/pad.html#${M.code}`;
  M.connected = () => !!((M.pad && M.pad.pads > 0) || (M.cam && M.cam.on));
  M.active = () => M.connected() && api.mg(); // 모션 플레이 경기에서만 입력을 받음

  // ── 타격 ──
  function swing(atLocalMs, strong, src) {
    const S = api.S(), role = api.role();
    if (!S || !S.mo || !role.batter || S.ph !== 'pitching' || !S.p) return S && !S.mo ? 'nomo' : 'skip';
    const lagMs = performance.now() - atLocalMs - M.calib + (src === 'cam' ? M.camLag : 0); // 보정 +면 더 늦게 친 걸로
    const t = api.simNow() - lagMs / 1000;
    if (t < S.p.t0 - 0.05) return 'early'; // 공 놓기 전 동작(준비 동작)은 무시
    const p = S.p, sd = src === 'cam' ? 0.07 : 0.055;
    const aim = [p.tx + gauss() * sd, p.ty + gauss() * sd * 0.8];
    api.swing(strong ? 'power' : 'contact', { t, aim });
    M.log.push({ src, lag: Math.round(lagMs), dt: Math.round((t - p.arrive) * 1000) }); if (M.log.length > 20) M.log.shift();
    M.lastLag = Math.round(lagMs);
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
    if (m.t === 'sws') { // 휘두르기 시작: 정점(=임팩트)은 보통 시작 뒤 ~60ms → 그 시각으로 화면 스윙만 먼저
      const S = api.S(), role = api.role();
      if (S && S.mo && role.batter && S.ph === 'pitching' && S.p) { const lag = performance.now() - M.pad.toLocal(m.at) - M.calib; const t = api.simNow() - lag / 1000 + 0.06; if (t >= S.p.t0) api.preSwing(t); }
    } else if (m.t === 'swing') { const r = swing(M.pad.toLocal(m.at), m.mode === 'power', 'pad'); M.pad.send({ t: 'ack', k: 'swing', r, lag: r === 'ok' ? M.lastLag : null }); }
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
      if (role.batter) { const r = swing(b.at, b.rel > 1.25, 'cam'); if (r === 'ok') api.toast(b.rel > 1.25 ? '스윙! (강타)' : '스윙!'); }
      else if (role.pitcher && S && S.ph === 'pitch') { if (pitch(api.aimNow(), camPower(b.rel))) api.toast('투구!'); }
    });
    if (M.cam.on) M.cam.stop(); else { setText('mCamSt', '카메라 켜는 중…'); const ok = await M.cam.start(); if (!ok) setText('mCamSt', M.cam.err); }
    paint(); syncAuto();
  };

  // 연결 상태를 서버에 알림 → 방 대기실에 '📱 연결됨' 표시 (수비 자동은 모션 플레이 방 설정이 정함)
  function syncAuto() { const on = M.connected(); if (M.autoSent !== on && api.net()) { M.autoSent = on; api.net().send({ t: 'pad', on }); } }
  M.resetNet = () => { M.autoSent = null; };

  function paint() {
    const P = M.pad;
    const padTxt = !P ? '' : !P.open ? '서버에 붙는 중…' : P.pads ? `핸드폰 연결됨 · 지연 ${Math.round(P.rtt / 2)}ms` : 'QR을 핸드폰 카메라로 찍어줘';
    setText('mPadSt', padTxt); cls('mPadSt', 'ok', !!(P && P.pads));
    if (M.cam) { setText('mCamSt', M.cam.on ? '웹캠 켜짐 · 옆으로 서서 휘둘러봐' : M.cam.err || '꺼짐'); setText('mCamBtn', M.cam.on ? '웹캠 끄기' : '웹캠 켜기'); cls('mCamSt', 'ok', M.cam.on); }
    show('mCamView', !!(M.cam && M.cam.on));
    setText('mCalV', (M.calib > 0 ? '+' : '') + M.calib + 'ms');
    const on = M.connected(); setText('mPlaySt', on ? '준비 끝 · 플레이 볼을 눌러!' : '핸드폰을 연결하거나 웹캠을 켜면 시작할 수 있어'); cls('mPlaySt', 'ok', on);
  }

  // 모달 바인딩
  $('mPadBtn').onclick = () => M.connectPad();
  $('mNewCode').onclick = () => M.newCode();
  $('mCamBtn').onclick = () => M.toggleCam();
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
    show('motionCam', camOn && api.screen() === 'game' && api.mg());
    if (camOn) {
      if (api.screen() === 'game') M.cam.paint($('motionCamC'));
      if (!$('motionM').classList.contains('hide')) M.cam.paint(camCanvas);
      style('motionCamBar', 'width', Math.min(100, M.cam.e * 400).toFixed(0) + '%');
    }
  };
  // 스윙 결과를 핸드폰에도 (맞으면 진동)
  bus.on('localSwing', (e) => {
    if (!M.pad || !M.pad.pads) return;
    const late = e.dt > 0, ms = Math.abs(e.dt);
    const txt = e.contact ? (e.q > 0.8 ? '정타! 제대로 맞았다' : '맞혔다!') : ms > 140 ? (late ? `늦었어 (${ms}ms)` : `빨랐어 (${ms}ms)`) : '헛스윙';
    M.pad.send({ t: 'fb', k: 'swing', txt, col: e.contact ? '#4fd18b' : '#ff8a80', vib: e.contact ? [50, 30, 90] : 0 });
  });
  M.paint = paint;
  setInterval(paint, 1000);
  return M;
}
