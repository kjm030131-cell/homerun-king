// audio.js — (호환용) 예전 sfx.* 호출을 bus 이벤트로 바꿔 주는 얇은 껍데기.
// 새 코드는 이걸 쓰지 말고 bus.emit(이벤트) 만 할 것. 실제 소리는 client/audio/ (사운드 매니저).
import { bus } from './core/bus.js';
import { setVolume as _setVolume, unlock } from './audio/index.js';

export { initAudio } from './audio/index.js';
export function setVolume(v) { _setVolume(v); }
export function audio() { return unlock(); }
export function crowdAmbience() { } // 관중은 이제 이벤트로 알아서 움직임
export const sfx = {
  crack: (q = 1) => bus.emit('contact', { q }),
  swing: (power = 1) => bus.emit('swing', { power }),
  bunt: () => bus.emit('contact', { q: 0.3, bunt: true }),
  whiff: () => bus.emit('miss', { local: true }),
  mitt: (s = 1) => bus.emit('catch', { pitch: true, kmh: s >= 1 ? 148 : 128 }),
  catch: () => bus.emit('catch', {}),
  throwWhoosh: () => bus.emit('throw', {}),
  bounce: (v = 1) => bus.emit('ball:bounce', { impact: v }),
  wall: () => bus.emit('ball:wall', {}),
  slide: () => bus.emit('slide', {}),
  cheer: (len = 3, gain = 0.4) => bus.emit('safe', { hit: gain > 0.5 ? '3B' : '1B' }),
  groan: () => bus.emit('safe', { error: true }),
  firework: () => { },
  ui: () => bus.emit('ui:click'),
  gaugeTick: (p) => bus.emit('ui:tick', { p }),
  perfect: () => bus.emit('ui:perfect'),
  ump: (strike) => bus.emit('strikeCall', { looking: !!strike }),
  organ: () => bus.emit('ui:walkup', { me: true }),
};
