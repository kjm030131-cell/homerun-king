// [qa] 페이지에 먼저 주입되는 계측 코드 (playwright addInitScript)
// - 모든 예외 기록: rAF 콜백 / setInterval·setTimeout 콜백 / window error / unhandledrejection
// - rAF 콜백 안 예외 = 렌더 루프가 다음 프레임을 예약 못 하고 멈춤 → 화면 고정. 따로 표시
// - 프레임당 JS 시간(실시간, 진짜 시계) 기록
(() => {
  const realNow = performance.now.bind(performance);
  const Q = (window.__qa = { errors: [], raf: { n: 0, err: 0, slow: [], last: 0, alive: 0 }, ticks: { n: 0, err: 0 }, realNow, frameMs: [], mark: '' });
  const rec = (src, e) => {
    const msg = (e && (e.stack || e.message)) || String(e);
    const key = src + '|' + String(msg).split('\n').slice(0, 3).join('|');
    const x = Q.errors.find((y) => y.key === key);
    if (x) { x.n++; return; }
    Q.errors.push({ key, src, msg: String(msg).split('\n').slice(0, 8).join('\n'), n: 1, mark: Q.mark, at: realNow() });
  };
  Q.rec = rec;
  const rAF = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => rAF((t) => {
    const t0 = realNow();
    Q.raf.n++; Q.raf.alive = t0;
    try { cb(t); } catch (e) { Q.raf.err++; rec('raf', e); throw e; } finally {
      const d = realNow() - t0; Q.raf.last = d;
      if (d > 50) { Q.raf.slow.push({ ms: Math.round(d), mark: Q.mark }); if (Q.raf.slow.length > 200) Q.raf.slow.shift(); }
    }
  });
  const wrapT = (orig, src) => (fn, ms, ...a) => orig(typeof fn === 'function' ? (...b) => { try { return fn(...b); } catch (e) { rec(src, e); if (src === 'interval') Q.ticks.err++; throw e; } } : fn, ms, ...a);
  window.setInterval = wrapT(window.setInterval.bind(window), 'interval');
  window.setTimeout = wrapT(window.setTimeout.bind(window), 'timeout');
  addEventListener('error', (e) => rec('window', e.error || e.message));
  addEventListener('unhandledrejection', (e) => rec('promise', e.reason));
  // 오디오 노드 생성 수 (매 타격마다 노드가 쌓이는지)
  Q.audioNodes = { ctx: 0, nodes: 0, buffers: 0, by: {} };
  if (window.BaseAudioContext) for (const m of Object.getOwnPropertyNames(BaseAudioContext.prototype)) if (/^create/.test(m)) {
    const o = BaseAudioContext.prototype[m];
    BaseAudioContext.prototype[m] = function (...a) { Q.audioNodes[m === 'createBuffer' ? 'buffers' : 'nodes']++; Q.audioNodes.by[m] = (Q.audioNodes.by[m] || 0) + 1; return o.apply(this, a); };
  }
  if (window.AudioContext) { const A = window.AudioContext; window.AudioContext = function (...a) { Q.audioNodes.ctx++; return new A(...a); }; window.AudioContext.prototype = A.prototype; }
  const ce = console.error.bind(console);
  console.error = (...a) => { rec('console.error', a.map((x) => (x && x.stack) || (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ')); ce(...a); };
})();
