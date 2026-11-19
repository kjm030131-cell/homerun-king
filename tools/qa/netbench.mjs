// [net] 멀티 네트워크 벤치 — 진짜 Room(src/index.js) + Game(shared/sim.js)을 가상 시계로 돌리고, 가짜 WebSocket 에 지연·지터·손실을 넣어
// 봇 클라이언트 N명이 실제로 경기한다(투구·스윙). 클라는 main.js 의 보간·외삽·화면 이동 로직을 그대로 흉내 낸 모델로 프레임(60fps)마다 화면 위치를 계산해
// 서버 '진짜' 위치와 비교한다. 브라우저 없이 수십 초 만에 돈다.
//
//   node tools/qa/netbench.mjs [--root=/tmp/v20] [--client=v20|cur|new] [--players=4] [--sec=240] [--ping=120] [--jit=30] [--loss=0.01] [--seed=1] [--rules=real] [--json]
//   --root   : src/index.js·shared/sim.js 를 불러올 저장소 루트(옛 버전 비교: git archive 1a666bc src shared | tar -x -C /tmp/v20)
//   --client : 클라 모델. v20 = 1a666bc main.js, cur = ad4c38e main.js, new = client/net/interp.js(지금 코드)
//   --ping   : 왕복 ms (한쪽 = ping/2), --jit: 한쪽 지터 σ ms(반정규), --loss: 패킷 손실 확률(TCP라 재전송 지연 + 순서 대기로 나타남)
//   --srvjit : 서버 타이머 흔들림 σ ms (DO setInterval 은 정확하지 않음, 기본 2)
// 측정: 내려받기 바이트/초·메시지/초(클라당), 서버 틱·스냅샷·직렬화 CPU, 클라 파싱·처리 시간, 보간 언더런(보간 시각이 마지막 스냅샷보다 뒤 = 멈추거나 외삽),
//       화면 위치 오차·튐(선수·주자·공), 끊김(움직이는 선수가 화면에서 멈춘 프레임).
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';

const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const ROOT = resolve(opt.root || new URL('../../', import.meta.url).pathname);
const HERE = resolve(new URL('../../', import.meta.url).pathname);
const NP = +(opt.players || 4), SEC = +(opt.sec || 240), PING = +(opt.ping ?? 60), JIT = +(opt.jit ?? 0), LOSS = +(opt.loss ?? 0), SRVJIT = +(opt.srvjit ?? 2);
const CLIENT = opt.client || 'new';
let seed = +(opt.seed || 1);
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
// 네트워크·봇용 난수는 게임 난수와 분리 (게임 결과가 네트워크 조건에 덜 휘둘리게)
let nseed = (+(opt.seed || 1) * 7919) >>> 0;
const nrnd = () => { nseed = (nseed * 1664525 + 1013904223) >>> 0; return nseed / 4294967296; };
const gauss = () => { let u = 0, v = 0; while (!u) u = nrnd(); while (!v) v = nrnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
Math.random = rnd;

// ── 가상 시계 ──
let VT = 0; // ms
const heap = []; let seq = 0;
const push = (t, fn) => { heap.push({ t, s: seq++, fn }); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (cmp(heap[p], heap[i]) <= 0) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
const cmp = (a, b) => a.t - b.t || a.s - b.s;
const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && cmp(heap[l], heap[m]) < 0) m = l; if (r < heap.length && cmp(heap[r], heap[m]) < 0) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
const T0 = 1.7e12;
const timers = new Map(); let tid = 1;
Date.now = () => T0 + Math.floor(VT);
globalThis.setInterval = (fn, ms) => { const id = tid++; timers.set(id, true); const run = (at) => push(at, () => { if (!timers.get(id)) return; fn(); run(at + ms + (SRVJIT ? Math.abs(gauss()) * SRVJIT : 0)); }); run(VT + ms); return id; };
globalThis.setTimeout = (fn, ms = 0) => { const id = tid++; timers.set(id, true); push(VT + ms, () => { if (timers.get(id)) { timers.delete(id); fn(); } }); return id; };
globalThis.clearInterval = globalThis.clearTimeout = (id) => { timers.delete(id); };

// Cloudflare 전역 흉내
const RealResponse = globalThis.Response;
globalThis.Response = class extends RealResponse { constructor(b, o = {}) { const st = o.status; super(b, st === 101 ? { ...o, status: 200 } : o); if (st === 101) Object.defineProperty(this, 'webSocket', { value: o.webSocket }); } };
let pending = null;
globalThis.WebSocketPair = function () { const s = pending; pending = null; return { 0: { client: true }, 1: s }; };
const errors = [];
console.error = (...a) => errors.push(a.map((x) => (x && x.stack) || String(x)).join(' ').slice(0, 400));

// 서버 CPU 계측: Game.prototype.tick / snapshot, JSON.stringify(브로드캐스트)
const { Game } = await import(pathToFileURL(join(ROOT, 'shared/sim.js')).href);
const SIM = await import(pathToFileURL(join(HERE, 'shared/sim.js')).href); // 클라 모델은 항상 지금 sim 의 integrate (클라 번들과 같게) — v20 클라 모델은 v20 sim
const CSIM = CLIENT === 'v20' ? await import(pathToFileURL(join(ROOT, 'shared/sim.js')).href) : SIM;
const hr = () => Number(process.hrtime.bigint()) / 1e6;
const cpu = { tick: [], snap: [], json: [], perSec: new Map() };
const addSec = (ms) => { const k = Math.floor(VT / 1000); cpu.perSec.set(k, (cpu.perSec.get(k) || 0) + ms); };
{
  const ot = Game.prototype.tick, os = Game.prototype.snapshot;
  Game.prototype.tick = function (dt) { const a = hr(); const r = ot.call(this, dt); const d = hr() - a; cpu.tick.push(d); addSec(d); recordTruth(this); return r; };
  Game.prototype.snapshot = function (...x) { const a = hr(); const r = os.apply(this, x); const d = hr() - a; cpu.snap.push(d); addSec(d); return r; };
}
const { Room } = await import(pathToFileURL(join(ROOT, 'src/index.js')).href);
const lobbyStub = { idFromName: () => 'x', get: () => ({ fetch: async () => new RealResponse('{}') }) };
const room = new Room({ storage: { get: async () => null, put: async () => { } } }, { LOBBY: lobbyStub });
{ // 브로드캐스트 직렬화 시간
  const ob = room.broadcast.bind(room);
  room.broadcast = (m) => { const a = hr(); const s = JSON.stringify(m); const d = hr() - a; if (m.t === 's') { cpu.json.push(d); addSec(d); } for (const [id, ws] of room.socks) { try { ws.sendRaw(s); } catch { room.socks.delete(id); } } void ob; };
}

// ── 진짜 위치 기록 (서버 매 틱) ──
const truth = []; // { t, fl:[[x,z]], rn: Map(key→[x,z]), b:[x,y,z,h] | null, ph }
function recordTruth(g) {
  if (g.phase === 'lobby' || !g.fielders.length) return;
  const rn = new Map();
  for (const r of g.alive()) { const [x, z] = SIM.runnerXZ(r.b); rn.set(r.rid ? 'r' + r.rid : r.name + '|' + (r.pid || ''), [x, z]); }
  const b = g.ball && g.ball.state !== 'dead' ? [g.ball.x, g.ball.y, g.ball.z, g.ball.holder] : null;
  truth.push({ t: g.now, fl: g.fielders.map((f) => [f.x, f.z]), rn, b, ph: g.phase, pos: g.fielders.map((f) => f.pos).join() });
  if (truth.length > 6000) truth.splice(0, 3000);
}
function truthAt(t) { // 이분 탐색 + 선형 보간
  let lo = 0, hi = truth.length - 1; if (hi < 1 || t < truth[0].t || t > truth[hi].t) return null;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (truth[m].t <= t) lo = m; else hi = m; }
  return [truth[lo], truth[hi], truth[hi].t > truth[lo].t ? (t - truth[lo].t) / (truth[hi].t - truth[lo].t) : 0];
}

// ── 링크 모델: 한쪽 지연 = ping/2 + |N|·jit, 손실이면 재전송(ping + 100ms) 지연, TCP 라 순서 보장(뒤 메시지도 기다림) ──
function link() {
  let last = 0;
  return (fn) => {
    let t = VT + PING / 2 + (JIT ? Math.abs(gauss()) * JIT : 0);
    if (LOSS && nrnd() < LOSS) t += PING + 100;
    t = Math.max(t, last); last = t;
    push(t, fn);
  };
}

// ── 클라 모델 ──
const { makeClient } = await import(pathToFileURL(join(HERE, 'tools/qa/netclient.mjs')).href);
const clients = [];
async function connect(i) {
  const down = link(), up = link();
  const C = makeClient({ kind: CLIENT, sim: CSIM, i, now: () => VT / 1000, send: (m) => { const s = JSON.stringify(m); up(() => sock.fire('message', { data: s })); }, truthAt, rnd: nrnd, gauss });
  const ls = { message: [], close: [], error: [] };
  const sock = {
    accept() { }, fire(t, e) { for (const f of ls[t]) f(e); },
    send(s) { this.sendRaw(typeof s === 'string' ? s : JSON.stringify(s)); },
    sendRaw(s) { C.stat.down += Buffer.byteLength(s); C.stat.msgs++; const k = Math.floor(VT / 1000); C.stat.perSec.set(k, (C.stat.perSec.get(k) || 0) + Buffer.byteLength(s)); down(() => deliver(C, () => C.recv(s))); },
    close() { }, addEventListener(t, f) { (ls[t] || (ls[t] = [])).push(f); },
  };
  pending = sock;
  await room.fetch(new Request(`http://x/ws/QAAA?name=${encodeURIComponent('봇' + i)}&token=`, { headers: { 'x-room': 'QAAA' } }));
  clients.push(C);
  return C;
}

// 클라 메인 스레드: 프레임이 바쁜 동안 도착한 메시지는 프레임이 끝난 뒤 처리 (브라우저 이벤트 루프)
const FMS = +(opt.fms || 0), FSPIKE = +(opt.fspike || 0);
function deliver(C, fn) { if (VT < (C.busyUntil || 0)) push(C.busyUntil, fn); else fn(); }
// 실행
for (let i = 0; i < NP; i++) await connect(i);
const runUntil = async (ms) => { while (heap.length && heap[0].t <= ms) { const e = pop(); VT = e.t; e.fn(); } VT = ms; await null; };
// 프레임 루프 (클라마다 60fps, 프레임 시각 살짝 흔들림)
for (const C of clients) {
  const fr = (at) => push(at, () => {
    C.frame();
    const busy = FMS ? FMS * (0.7 + 0.6 * nrnd()) + (nrnd() < FSPIKE ? 40 + 40 * nrnd() : 0) : 0;
    C.busyUntil = VT + busy;
    fr(at + Math.max(1, Math.ceil(busy / (1000 / 60))) * (1000 / 60) + (nrnd() - 0.5) * 1);
  });
  fr(5 + C.i);
}
await runUntil(500);
const host = clients[0];
for (const C of clients) C.send({ t: 'team', team: C.i % 2 ? 'home' : 'away' });
await runUntil(1500);
host.send({ t: 'set', innings: +(opt.inn || 3), rules: opt.rules || 'real', diff: 1 });
await runUntil(2000);
host.send({ t: 'start' });
await runUntil(3000);
for (const C of clients) C.reset(); // 로비 메시지는 빼고 경기 중만
const sec0 = Math.floor(VT / 1000);
cpu.tick.length = cpu.snap.length = cpu.json.length = 0;
const wall0 = Date.now ? process.hrtime.bigint() : 0n;
await runUntil(VT + SEC * 1000);
const wallMs = Number(process.hrtime.bigint() - wall0) / 1e6;
for (const t of timers.keys()) timers.delete(t);

// ── 집계 ──
const st = (a) => { if (!a.length) return { avg: 0, p50: 0, p99: 0, max: 0 }; const s = Float64Array.from(a).sort(); const avg = a.reduce((x, y) => x + y, 0) / a.length; return { avg: +avg.toFixed(4), p50: +s[Math.floor(s.length * 0.5)].toFixed(4), p99: +s[Math.floor(s.length * 0.99)].toFixed(4), max: +s[s.length - 1].toFixed(3) }; };
const secs = [...cpu.perSec.entries()].filter(([k]) => k >= sec0).map(([, v]) => v);
const agg = { net: {}, cl: {} };
const per = clients.map((C) => C.report(SEC));
const mean = (k) => per.reduce((a, p) => a + p[k], 0) / per.length;
const R = {
  cfg: { root: ROOT.replace(HERE, '.'), client: CLIENT, players: NP, sec: SEC, ping: PING, jit: JIT, loss: LOSS, seed: +(opt.seed || 1) },
  downKBps: +mean('kbps').toFixed(2), downKBpsMax: Math.max(...per.map((p) => p.kbpsMax)), msgsPerSec: +mean('mps').toFixed(1), snapAvgB: Math.round(mean('snapB')), snapMaxB: Math.max(...per.map((p) => p.snapMaxB)),
  srv: { tickMs: st(cpu.tick), snapMs: st(cpu.snap), jsonMs: st(cpu.json), cpuMsPerSec: st(secs) },
  cl: { parseMs: st(per.flatMap((p) => p.parse)), procMs: st(per.flatMap((p) => p.proc)), frameMs: st(per.flatMap((p) => p.frameMs)) },
  underrun: +mean('underrun').toFixed(4), holdFrames: +mean('hold').toFixed(4), extrapMs: +mean('extrapMs').toFixed(1), delayMs: +mean('delayMs').toFixed(1),
  pl: { errRms: +mean('plErr').toFixed(3), errP99: +mean('plErr99').toFixed(3), stall: +mean('stall').toFixed(4), lurch: +mean('lurch').toFixed(4), jumpPerMin: +mean('plJump').toFixed(2), catchup: +mean('catchup').toFixed(4) },
  ball: { errRms: +mean('bErr').toFixed(3), errP99: +mean('bErr99').toFixed(3), jumpPerMin: +mean('bJump').toFixed(2), frames: Math.round(mean('bN')) },
  game: { ...host.gameStat(), wallMs: Math.round(wallMs) },
  errors: errors.slice(0, 5).concat(...clients.map((C) => C.errors.slice(0, 3))),
};
if (process.env.NBDIAG) { const d = {}; for (const C of clients) for (const [k, v] of Object.entries(C.stat.diag)) d[k] = (d[k] || 0) + v; console.log(Object.entries(d).filter(([k]) => process.env.NBDIAG === '1' || k.startsWith(process.env.NBDIAG)).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => k + '=' + v).join('\n')); }
if (opt.json) console.log(JSON.stringify(R));
else {
  const c = R.cfg;
  console.log(`── ${c.root} 클라=${c.client} ${c.players}명 ${c.sec}초 핑${c.ping} 지터${c.jit} 손실${c.loss * 100}% seed${c.seed}${FMS ? ` 프레임${FMS}ms 스파이크${FSPIKE * 100}%` : ''}`);
  console.log(`  내려받기 ${R.downKBps}KB/s(최대 ${R.downKBpsMax}) ${R.msgsPerSec}msg/s 스냅샷 평균 ${R.snapAvgB}B 최대 ${R.snapMaxB}B`);
  console.log(`  서버 틱 ${R.srv.tickMs.avg}ms(p99 ${R.srv.tickMs.p99} 최대 ${R.srv.tickMs.max}) 스냅샷 ${R.srv.snapMs.avg} 직렬화 ${R.srv.jsonMs.avg} → CPU ${R.srv.cpuMsPerSec.avg}ms/초(최대 ${R.srv.cpuMsPerSec.max})`);
  console.log(`  클라 파싱 ${R.cl.parseMs.avg}ms(최대 ${R.cl.parseMs.max}) 처리 ${R.cl.procMs.avg}ms 프레임 모델 ${R.cl.frameMs.avg}ms`);
  console.log(`  보간 지연 ${R.delayMs}ms · 언더런 ${(R.underrun * 100).toFixed(2)}% 프레임 (멈춤 ${(R.holdFrames * 100).toFixed(2)}%, 외삽 평균 ${R.extrapMs}ms)`);
  console.log(`  선수/주자: 오차 RMS ${R.pl.errRms}m p99 ${R.pl.errP99}m · 끊김(움직이는데 멈춤) ${(R.pl.stall * 100).toFixed(2)}% · 튐(과속) ${(R.pl.lurch * 100).toFixed(2)}% · 0.3m+ 점프 ${R.pl.jumpPerMin}/분 (따라가는 중 ${(R.pl.catchup * 100).toFixed(1)}% 제외)`);
  console.log(`  공(타구·송구 ${R.ball.frames}프레임): 오차 RMS ${R.ball.errRms}m p99 ${R.ball.errP99}m · 0.3m+ 점프 ${R.ball.jumpPerMin}/분`);
  console.log(`  경기: ${JSON.stringify(R.game)}`);
  if (R.errors.length) console.log('  ✗ 오류:', R.errors.join('\n    '));
}
process.exit(0);
