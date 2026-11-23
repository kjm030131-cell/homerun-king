// [ui] 설정 (localStorage 'hr_*' 키는 v20과 같게 유지 → 기존 사용자 설정 그대로 이어짐)
import { $, setSeg } from './dom.js';
import { bus } from '../core/bus.js';

export const TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
export const store = {
  get(k, d) { try { const v = localStorage.getItem('hr_' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('hr_' + k, JSON.stringify(v)); } catch { } },
};
export const cfg = {
  vol: store.get('vol', 80), gq: store.get('gq', TOUCH ? 'low' : 'mid'), shake: store.get('shake', 1), sens: store.get('sens', 100),
  assist: store.get('assist2', 1), batCam: store.get('batCam2', 0), // [11-23] 0 기본(포수 바로 뒤) · 1 가까이 · 2 중계 망원 — 새 키로 한 번 초기화 replay: store.get('replay', 1), cast: store.get('castV', 2), // [sound] 새 키: 기본 자막+음성 (예전 'cast' 기본은 자막만이라 음성이 안 나왔음)
  fieldCam: store.get('fieldCam2', 'tv'), fps: store.get('fps', 1), // [11-23] 수비 기본 = 중계 시점(화면 방향이 안 바뀜, 더쇼 방식). 예전 'fieldCam'(3인칭 기본) 값은 무시하고 한 번 초기화
  camDist: store.get('camDist', 1), batH: store.get('batH', 1), // [cam] 시점 거리(0 가까이·1 기본·2 멀리, Z 키) · 타자 시점 높이(0 낮게·1 기본·2 높게)
  volSfx: store.get('volSfx', 100), volCrowd: store.get('volCrowd', 100), volCast: store.get('volCast', 100), // [ui] 사운드 파트 요청: 효과음/관중/캐스터 음량 (0~100)
  rules: store.get('rules', 'real') === 'casual' ? 'casual' : 'real', // [ui] 마지막으로 고른 모드
  bats: ['R', 'L', 'S'].includes(store.get('bats', 'R')) ? store.get('bats', 'R') : 'R', // [lefty] 내 타석: 우타·좌타·스위치
};

// 설정 창 연결. hooks: { applyQuality, setVolume, stopReplay, stopSpeech, sound }
export function bindSettings(hooks) {
  // 음량 4개: 전체(vol) · 효과음(volSfx) · 관중(volCrowd) · 캐스터(volCast). 바뀌면 bus 'ui:volume' {master,sfx,crowd,cast} (0~1)
  for (const id of VOLS) $(id).oninput = () => { cfg[id] = +$(id).value; store.set(id, cfg[id]); if (id === 'vol') hooks.setVolume(cfg.vol / 100); paintRange(id); emitVolume(); };
  $('sens').oninput = () => { cfg.sens = +$('sens').value; store.set('sens', cfg.sens); paintRange('sens'); };
  $('gq').addEventListener('change', (e) => { cfg.gq = e.detail; store.set('gq', cfg.gq); hooks.applyQuality(); });
  $('shake').addEventListener('change', (e) => { cfg.shake = +e.detail; store.set('shake', cfg.shake); });
  $('replayS').addEventListener('change', (e) => { cfg.replay = +e.detail; store.set('replay', cfg.replay); if (!cfg.replay) hooks.stopReplay(); });
  $('castS').addEventListener('change', (e) => { cfg.cast = +e.detail; store.set('castV', cfg.cast); if (cfg.cast < 2) hooks.stopSpeech(); });
  $('assist').addEventListener('change', (e) => { cfg.assist = +e.detail; store.set('assist2', cfg.assist); });
  $('fpsS').addEventListener('change', (e) => { cfg.fps = +e.detail; store.set('fps', cfg.fps); });
  $('camDistS').addEventListener('change', (e) => { cfg.camDist = +e.detail; store.set('camDist', cfg.camDist); }); // [cam]
  $('batHS').addEventListener('change', (e) => { cfg.batH = +e.detail; store.set('batH', cfg.batH); }); // [cam]
  $('batsS').addEventListener('change', (e) => { cfg.bats = e.detail; store.set('bats', cfg.bats); bus.emit('ui:bats', cfg.bats); }); // [lefty]
}
const VOLS = ['vol', 'volSfx', 'volCrowd', 'volCast'];
export function emitVolume() { bus.emit('ui:volume', { master: cfg.vol / 100, sfx: cfg.volSfx / 100, crowd: cfg.volCrowd / 100, cast: cfg.volCast / 100 }); }
function paintRange(id) { const e = $(id), o = $(id + 'V'); if (o) o.textContent = id === 'sens' ? (e.value / 100).toFixed(2) + '×' : e.value; }
export function fillSettings() {
  for (const id of [...VOLS, 'sens']) { $(id).value = cfg[id]; paintRange(id); }
  setSeg('gq', cfg.gq); setSeg('shake', cfg.shake); setSeg('replayS', cfg.replay); setSeg('castS', cfg.cast); setSeg('assist', cfg.assist); setSeg('fpsS', cfg.fps); setSeg('camDistS', cfg.camDist); setSeg('batHS', cfg.batH); setSeg('batsS', cfg.bats); // [cam] [lefty]
}
