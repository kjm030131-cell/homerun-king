// audio.js — (호환용) 예전 sfx.* 호출을 bus 이벤트로 바꿔 주는 얇은 껍데기.
// 새 코드는 이걸 쓰지 말 것: 게임 소리는 서버 이벤트로 자동, 화면 타이밍 소리는 cue:* (client/audio/index.js 머리말).
import { bus } from './core/bus.js';
import { setVolume as _setVolume, unlock } from './audio/index.js';

export { initAudio } from './audio/index.js';
export function setVolume(v) { _setVolume(v); }
export function audio() { return unlock(); }
export function crowdAmbience() { } // 관중은 이벤트로 알아서 움직임
const noop = () => { };
export const sfx = {
  crack: (q = 1) => bus.emit('localSwing', { contact: true, q }),
  swing: (power = 1) => bus.emit('cue:swing', { power }),
  bunt: () => bus.emit('localSwing', { contact: true, q: 0.3, mode: 'bunt' }),
  whiff: () => bus.emit('localSwing', { contact: false }),
  mitt: (s = 1) => bus.emit('cue:mitt', { kmh: s >= 1 ? 148 : 128 }),
  bounce: (v = 1) => bus.emit('cue:bounce', { impact: v }),
  slide: () => bus.emit('cue:slide', {}),
  ui: () => bus.emit('ui:click'),
  gaugeTick: (p) => bus.emit('ui:tick', { p }),
  perfect: () => bus.emit('ui:perfect'),
  organ: () => bus.emit('ui:walkup', { me: true }),
  // 아래는 이제 서버 이벤트가 소리를 냄 → 아무것도 안 함
  catch: noop, throwWhoosh: noop, wall: noop, cheer: noop, groan: noop, firework: noop, ump: noop,
};
