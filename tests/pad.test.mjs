// [motion] 핸드폰 컨트롤러 중계(Pad DO): 가짜 웹소켓으로 host↔pad 메시지 전달·인원 알림 확인
import { test } from 'node:test';
import assert from 'node:assert/strict';

class FakeSock {
  constructor() { this.out = []; this.l = {}; this.peer = null; this.closed = false; }
  accept() { }
  addEventListener(k, f) { (this.l[k] ||= []).push(f); }
  send(d) { if (this.closed) throw new Error('closed'); this.peer.out.push(JSON.parse(d)); }
  close() { this.closed = true; for (const f of this.l.close || []) f(); }
  emit(d) { for (const f of this.l.message || []) f({ data: JSON.stringify(d) }); }
}
globalThis.WebSocketPair = class { constructor() { const a = new FakeSock(), b = new FakeSock(); a.peer = b; b.peer = a; return { 0: a, 1: b }; } };
const RealResponse = globalThis.Response;
globalThis.Response = class { constructor(body, init) { this.status = init && init.status; this.webSocket = init && init.webSocket; } };
const { Pad } = await import('../src/index.js');
globalThis.Response = RealResponse;

test('Pad 중계: PC ↔ 핸드폰 메시지 전달 + 연결 인원 알림 + 4대 제한', async () => {
  globalThis.Response = class { constructor(body, init) { this.webSocket = init && init.webSocket; } };
  const pad = new Pad({});
  const host = (await pad.fetch(new Request('https://x/ws/pad/AAAAAA?r=h'))).webSocket; // 클라이언트 쪽 소켓 (서버가 보낸 걸 받음)
  const hostSrv = host.peer;
  const ph = (await pad.fetch(new Request('https://x/ws/pad/AAAAAA?r=p'))).webSocket, phSrv = ph.peer;
  assert.deepEqual(host.out.at(-1), { t: 'peer', host: 1, pads: 1 });
  assert.deepEqual(ph.out.at(-1), { t: 'peer', host: 1, pads: 1 });
  phSrv.emit({ t: 'swing', at: 5, pk: 900 });
  assert.deepEqual(host.out.at(-1), { t: 'swing', at: 5, pk: 900 });
  hostSrv.emit({ t: 'hs', st: 'bat' });
  assert.deepEqual(ph.out.at(-1), { t: 'hs', st: 'bat' });
  for (let i = 0; i < 3; i++) await pad.fetch(new Request('https://x/ws/pad/AAAAAA?r=p'));
  const fifth = (await pad.fetch(new Request('https://x/ws/pad/AAAAAA?r=p'))).webSocket;
  assert.ok(fifth.peer.closed, '5번째 핸드폰은 거절');
  phSrv.close();
  assert.equal(host.out.at(-1).pads, 3);
  hostSrv.close();
  assert.equal(pad.host, null);
  globalThis.Response = RealResponse;
});
