// [motion] PC ↔ 핸드폰 컨트롤러 연결 (서버 Pad 중계 · /ws/pad/<코드>)
//  - 코드는 6자리, 브라우저에 기억 → 새로고침해도 핸드폰이 저절로 다시 붙음
//  - 1초마다 핑으로 핸드폰 시계와 PC 시계 차이를 잼(왕복이 가장 짧았던 값) → 핸드폰이 보낸 '스윙한 순간'을 PC 시각으로 바꿈
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const newPadCode = () => Array.from({ length: 6 }, () => CHARS[(Math.random() * CHARS.length) | 0]).join('');

export function createPadLink(code, onMsg, onState) {
  let ws = null, closed = false, retry = 0, pingT = 0;
  const L = { code, open: false, pads: 0, rtt: 0, offset: null, samples: [] };
  function connect() {
    if (closed) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    try { ws = new WebSocket(`${proto}://${location.host}/ws/pad/${code}?r=h`); } catch { return later(); }
    ws.onopen = () => { L.open = true; retry = 0; onState(L); };
    ws.onclose = () => { L.open = false; L.pads = 0; onState(L); later(); };
    ws.onerror = () => { };
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'peer') { const was = L.pads; L.pads = m.pads | 0; if (L.pads !== was) { L.samples = []; L.offset = null; } onState(L); return; }
      if (m.t === 'pog') {
        const now = performance.now(), rtt = now - m.h;
        if (rtt < 0 || rtt > 2000) return;
        L.samples.push({ rtt, off: m.p - (m.h + rtt / 2) }); if (L.samples.length > 12) L.samples.shift();
        const best = L.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
        L.offset = best.off; L.rtt = Math.round(L.samples.reduce((a, b) => a + b.rtt, 0) / L.samples.length);
        onState(L); return;
      }
      onMsg(m);
    };
  }
  function later() { if (closed) return; setTimeout(connect, Math.min(8000, 600 * 2 ** retry++)); }
  L.send = (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
  // 핸드폰 시각(ms) → PC performance.now() 기준(ms)
  L.toLocal = (padMs) => (L.offset == null ? performance.now() - L.rtt / 2 : padMs - L.offset);
  L.tick = () => { const n = performance.now(); if (L.pads && n - pingT > (L.samples.length < 5 ? 250 : 1000)) { pingT = n; L.send({ t: 'png', h: n }); } };
  L.close = () => { closed = true; try { ws && ws.close(); } catch { } };
  connect();
  return L;
}
