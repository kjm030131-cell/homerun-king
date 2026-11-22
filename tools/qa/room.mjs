// [qa] wrangler 없이 멀티 확인: src/index.js 의 진짜 Room 클래스를 node 에서 돌리고, 브라우저 WebSocket 을 직접 붙인다.
// - 최소 WebSocket 서버(RFC 6455 텍스트 프레임·close·ping) 직접 구현 (npm 설치 불가 환경)
// - Cloudflare 전용 전역(WebSocketPair, 101 Response)과 env.LOBBY 는 가짜로
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// [net] net = { ping(왕복 ms), jit(한쪽 지터 σ ms, 반정규), loss(손실 확률 → TCP 재전송: ping+100ms 지연, 뒤 메시지도 순서대로 기다림) } — 양쪽 방향 모두
export async function attachRooms(srv, root, net = {}) {
  const errors = [];
  const PING = +net.ping || 0, JIT = +net.jit || 0, LOSS = +net.loss || 0;
  const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const link = () => { let last = 0; return (fn) => { if (!PING && !JIT && !LOSS) return fn(); let t = Date.now() + PING / 2 + (JIT ? Math.abs(gauss()) * JIT : 0); if (LOSS && Math.random() < LOSS) t += PING + 100; t = Math.max(t, last); last = t; setTimeout(fn, t - Date.now()); }; };
  // Room 이 쓰는 전역 흉내
  const RealResponse = globalThis.Response;
  globalThis.Response = class extends RealResponse { constructor(b, o = {}) { const st = o.status; super(b, st === 101 ? { ...o, status: 200 } : o); if (st === 101) Object.defineProperty(this, 'webSocket', { value: o.webSocket }); } };
  let pending = null;
  globalThis.WebSocketPair = function () { const s = pending; pending = null; return { 0: { client: true }, 1: s }; };
  const origErr = console.error;
  console.error = (...a) => { errors.push(a.map((x) => (x && x.stack) || String(x)).join(' ').slice(0, 600)); origErr('[room]', ...a); };
  const { Room } = await import(pathToFileURL(join(root, 'src/index.js')).href);
  const lobbyStub = { idFromName: () => 'x', get: () => ({ fetch: async () => new RealResponse('{}') }) };
  const rooms = new Map();
  const roomOf = (code) => rooms.get(code) || rooms.set(code, new Room({ storage: { get: async () => null, put: async () => { } } }, { LOBBY: lobbyStub })).get(code);

  srv.on('upgrade', async (req, sock) => {
    const u = new URL(req.url, 'http://x');
    const m = u.pathname.match(/^\/ws\/([A-Za-z0-9]{4})$/);
    if (!m) return sock.destroy();
    const key = req.headers['sec-websocket-key'];
    const acc = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acc}\r\n\r\n`);
    sock.setNoDelay(true);
    const ls = { message: [], close: [], error: [] };
    const down = link(), up = link();
    let closed = false, buf = Buffer.alloc(0);
    const frame = (op, payload) => {
      const n = payload.length; let h;
      if (n < 126) { h = Buffer.from([0x80 | op, n]); }
      else if (n < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(n, 2); }
      else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); }
      sock.write(Buffer.concat([h, payload]));
    };
    const fire = (t, e) => { for (const f of ls[t]) try { f(e); } catch (err) { errors.push(String(err.stack || err)); } };
    const server = {
      accept() { },
      send(s) { if (closed) throw new Error('closed'); const p = Buffer.from(String(s)); down(() => { if (!sock.destroyed) frame(1, p); }); },
      close(code = 1000, reason = '') { if (closed) return; const p = Buffer.alloc(2 + Buffer.byteLength(reason)); p.writeUInt16BE(code, 0); p.write(reason, 2); try { frame(8, p); } catch { } closed = true; sock.end(); fire('close', { code, reason }); },
      addEventListener(t, f) { (ls[t] || (ls[t] = [])).push(f); },
    };
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 2) {
        const op = buf[0] & 15, masked = buf[1] & 0x80; let n = buf[1] & 127, o = 2;
        if (n === 126) { if (buf.length < 4) return; n = buf.readUInt16BE(2); o = 4; } else if (n === 127) { if (buf.length < 10) return; n = Number(buf.readBigUInt64BE(2)); o = 10; }
        const mk = masked ? buf.subarray(o, o + 4) : null; if (masked) o += 4;
        if (buf.length < o + n) return;
        const pl = Buffer.from(buf.subarray(o, o + n)); buf = buf.subarray(o + n);
        if (mk) for (let i = 0; i < pl.length; i++) pl[i] ^= mk[i & 3];
        if (op === 1) { const d = pl.toString('utf8'); up(() => fire('message', { data: d })); }
        else if (op === 8) { if (!closed) { closed = true; try { frame(8, pl.subarray(0, 2)); } catch { } sock.end(); fire('close', { code: pl.length >= 2 ? pl.readUInt16BE(0) : 1005 }); } }
        else if (op === 9) frame(10, pl);
      }
    });
    sock.on('close', () => { if (!closed) { closed = true; fire('close', { code: 1006 }); } });
    sock.on('error', () => { });
    pending = server;
    const code = m[1].toUpperCase();
    try { await roomOf(code).fetch(new Request('http://x' + req.url, { headers: { 'x-room': code } })); } catch (e) { errors.push('room.fetch ' + (e.stack || e)); }
  });
  return { rooms, errors, roomOf, stop() { for (const r of rooms.values()) { clearInterval(r.timer); clearTimeout(r.idleT); } } };
}
