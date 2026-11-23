// 홈런왕 — Cloudflare Worker + Durable Objects
//  Room  : 방 하나 = DO 하나. 60Hz 시뮬레이션, 30Hz 스냅샷 브로드캐스트 (변한 키만 — [net] packSnap)
//  Lobby : 공개 방 목록 (싱글톤 DO)
import { Game } from '../shared/sim.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 4 }, () => CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]).join('');
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;
    if (p === '/api/new' && req.method === 'POST') return json({ code: newCode() });
    if (p === '/api/stats') return env.LOBBY.get(env.LOBBY.idFromName('main'), { locationHint: 'apac' }).fetch('https://lobby/stats?n=' + encodeURIComponent(url.searchParams.get('n') || ''));
    if (p === '/api/rooms') return env.LOBBY.get(env.LOBBY.idFromName('main'), { locationHint: 'apac' }).fetch('https://lobby/list');
    let m = p.match(/^\/api\/room\/([A-Za-z0-9]{4})$/);
    if (m) {
      const code = m[1].toUpperCase();
      return env.ROOMS.get(env.ROOMS.idFromName(code), { locationHint: 'apac' }).fetch(new Request('https://room/info', { headers: { 'x-room': code } }));
    }
    // [motion] 핸드폰 컨트롤러 ↔ PC 중계 (방 코드와 따로, 6자리)
    m = p.match(/^\/ws\/pad\/([A-Za-z0-9]{6})$/);
    if (m) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
      return env.PADS.get(env.PADS.idFromName(m[1].toUpperCase()), { locationHint: 'apac' }).fetch(req);
    }
    m = p.match(/^\/ws\/([A-Za-z0-9]{4})$/);
    if (m) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
      const code = m[1].toUpperCase();
      const h = new Headers(req.headers); h.set('x-room', code);
      return env.ROOMS.get(env.ROOMS.idFromName(code), { locationHint: 'apac' }).fetch(new Request(req.url, { headers: h }));
    }
    return env.ASSETS.fetch(req);
  },
};

const TICK = 1000 / 60;
const STEP = 1 / 60, SNAP_DT = 1 / 30; // [net] 시뮬 고정 스텝 · 스냅샷 간격(게임 시각)
// [net] 스냅샷 델타: 매번 통째로(평균 1.5KB, 30Hz × 사람 수) 보내던 것을 '지난 브로드캐스트와 달라진 키'만 보냄.
//  - 키 단위 JSON 문자열 비교 → 같으면 뺌, 없어진 키는 x:[키…]. 받는 쪽(client/net/snap.js mergeSnap)이 지난 스냅샷에 덮어씀.
//  - d:1 = 델타. 3초마다·누가 새로 접속하면 다음 한 번은 통째로(k:1) → 어긋나도 3초 안에 저절로 맞음.
//  - t·now·ph 는 항상, ev(이벤트)·pg(핑 목록)는 있을 때만(합치지 않음).
const SNAP_KEY_EVERY = 90; // 스냅샷 90개(3초)마다 통째로
const PASS = new Set(['t', 'now', 'ph', 'ev', 'pg']);
export function packSnap(st, s) {
  const full = !st.last || ++st.n >= SNAP_KEY_EVERY;
  if (full) { st.last = new Map(); st.n = 0; }
  const parts = [];
  for (const k in s) {
    const v = s[k]; if (v === undefined) continue;
    const js = JSON.stringify(v);
    if (PASS.has(k)) { parts.push(JSON.stringify(k) + ':' + js); continue; }
    if (!full && st.last.get(k) === js) continue;
    st.last.set(k, js); parts.push(JSON.stringify(k) + ':' + js);
  }
  if (full) parts.push('"k":1');
  else {
    parts.push('"d":1');
    let gone = null; for (const k of st.last.keys()) if (!(k in s) || s[k] === undefined) (gone || (gone = [])).push(k);
    if (gone) { for (const k of gone) st.last.delete(k); parts.push('"x":' + JSON.stringify(gone)); }
  }
  return '{' + parts.join(',') + '}';
}

export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.socks = new Map(); // playerId -> ws
    this.tokens = new Map(); // token -> playerId
    this.code = null;
    this.timer = null;
    this.n = 0;
    this.idSeq = 0;
    this.lastReport = 0;
    this.dirty = true;
    this.snapSt = { last: null, n: 0 }; // [net] 델타 기준(지난 브로드캐스트)
    this.newGame();
  }
  newGame() {
    this.game = new Game({
      emit: (m) => this.broadcast(m),
      sendTo: (id, m) => { const ws = this.socks.get(id); if (ws) try { ws.send(JSON.stringify(m)); } catch { } },
      onKick: (id) => { const ws = this.socks.get(id); this.socks.delete(id); if (ws) try { ws.close(4003, '강퇴당했어'); } catch { } },
      onChange: () => { this.dirty = true; },
      onGameOver: (sum) => { this.saveCareer(sum); },
    });
  }

  info() {
    const g = this.game, lp = g.lobbyState();
    return {
      code: this.code, name: g.set.name || `${lp.players.find((p) => p.id === g.hostId)?.name || '???'}의 방`,
      mode: g.set.mode, players: lp.players.filter((p) => p.team !== 'spec').length, spec: lp.players.filter((p) => p.team === 'spec').length,
      max: g.set.max, phase: g.phase, locked: !!g.password, pub: g.set.pub, inn: g.inning || 0, rules: g.set.rules || 'real', timeLim: g.set.timeLim || 0,
    };
  }

  // 경기 끝: 사람 선수 기록을 통산 기록 저장소(로비)로
  async saveCareer(sum) {
    if (!sum || !Object.keys(sum).length) return;
    const lobby = this.env.LOBBY.get(this.env.LOBBY.idFromName('main'), { locationHint: 'apac' });
    try { await lobby.fetch('https://lobby/stats', { method: 'POST', body: JSON.stringify(sum) }); } catch (e) { console.error('career', e); }
  }
  async report(force) {
    if (!this.code) return;
    const now = Date.now();
    if (!force && !this.dirty && now - this.lastReport < 30000) return;
    if (!force && now - this.lastReport < 1000) return;
    this.dirty = false; this.lastReport = now;
    const lobby = this.env.LOBBY.get(this.env.LOBBY.idFromName('main'), { locationHint: 'apac' });
    const body = this.socks.size && this.game.set.pub ? { code: this.code, info: this.info() } : { code: this.code, remove: true };
    try { await lobby.fetch('https://lobby/update', { method: 'POST', body: JSON.stringify(body) }); } catch (e) { console.error('report', e); }
  }

  async fetch(req) {
    const url = new URL(req.url);
    this.code = this.code || req.headers.get('x-room');
    // [net] 모두 잠깐 끊겨 90초 보존 중인 방도 '있음' — 전엔 혼자 있던 사람이 새로고침(?room=)하면 '방이 없어'로 막혀 자기 자리에 못 돌아왔음
    if (url.pathname === '/info') return json({ exists: this.socks.size > 0 || (!!this.idleT && this.tokens.size > 0), ...this.info() });

    const name = (url.searchParams.get('name') || '선수').slice(0, 12);
    const token = url.searchParams.get('token') || '';
    const pw = url.searchParams.get('pw') || '';
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    let id = this.tokens.get(token);
    const g = this.game;
    if (id && g.players.has(id)) {
      // 재접속
      const old = this.socks.get(id);
      if (old) try { old.close(4004, '다른 곳에서 접속'); } catch { }
      this.socks.set(id, server);
      g.reconnect(id);
    } else {
      if (g.password && pw !== g.password) { server.close(4001, '비밀번호가 틀렸어'); return new Response(null, { status: 101, webSocket: client }); }
      const active = [...g.players.values()].filter((p) => p.team !== 'spec').length;
      if (g.players.size >= 18) { server.close(4002, '방이 꽉 찼어'); return new Response(null, { status: 101, webSocket: client }); }
      id = 'p' + (++this.idSeq) + Math.random().toString(36).slice(2, 6);
      const tok = crypto.randomUUID();
      this.tokens.set(tok, id);
      this.socks.set(id, server);
      g.addPlayer(id, name);
      server.send(JSON.stringify({ t: 'welcome', id, token: tok, code: this.code }));
    }
    if (this.tokens.get(token) === id) server.send(JSON.stringify({ t: 'welcome', id, token, code: this.code }));
    server.send(JSON.stringify(g.lobbyState()));
    server.send(JSON.stringify(g.snapshot()));
    this.snapSt.last = null; // [net] 새로 들어온 사람: 다음 브로드캐스트는 통째로 (접속 스냅샷과 다음 델타 사이에 값이 바뀌었다 돌아온 키 대비)

    server.addEventListener('message', (e) => {
      if (typeof e.data !== 'string' || e.data.length > 4000) return;
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (this.socks.get(id) !== server) return;
      try { this.game.handle(id, m); } catch (err) { console.error('handle', err); }
    });
    const bye = () => {
      if (this.socks.get(id) !== server) return;
      this.socks.delete(id);
      try { this.game.disconnect(id); } catch (err) { console.error(err); }
      if (this.socks.size === 0) this.idle();
    };
    server.addEventListener('close', bye);
    server.addEventListener('error', bye);
    this.startLoop();
    this.report(true);
    return new Response(null, { status: 101, webSocket: client });
  }

  startLoop() {
    clearTimeout(this.idleT); this.idleT = null;
    if (this.timer) return;
    // [net] 타이머가 늦게·몰려 와도(DO setInterval 은 정확하지 않음) 게임 시간은 벽시계를 따라 1/60초 고정 스텝으로(밀린 만큼 최대 6스텝),
    //       스냅샷은 '호출 2번마다'가 아니라 게임 시각 1/30초마다 — 전엔 타이머가 밀리면 틱 dt 가 커지고 스냅샷도 그만큼 드물어졌음
    //       (netbench --srvjit=8: 28 → 23 스냅샷/초, 보간 지연 +10ms). 고정 스텝 = 테스트·AI 검사와 같은 dt 라 판정도 그대로 재현됨.
    let last = Date.now(), acc = 0;
    this.nextSnap = this.game.now;
    this.timer = setInterval(() => {
      const t = Date.now();
      acc += Math.min(0.1, (t - last) / 1000);
      last = t;
      for (let k = 0; acc > STEP * 0.5 && k < 6; k++) {
        acc -= STEP;
        try { this.game.tick(STEP); } catch (err) { console.error('tick', err); }
      }
      if (acc > STEP * 0.5) acc = 0; // 0.1초 넘게 밀린 건 버림(따라잡느라 몰아서 돌리지 않게)
      if (this.game.now + 1e-6 >= this.nextSnap || this.game.now < this.nextSnap - 1) {
        this.nextSnap = Math.max(this.nextSnap + SNAP_DT, this.game.now - STEP);
        if (this.socks.size) this.broadcastRaw(packSnap(this.snapSt, this.game.snapshot(true))); // true: 게임 이벤트(ev)를 실어 보내고 비움 · [net] 변한 키만
      }
      if (++this.n % 60 === 0) this.report();
    }, TICK);
  }

  // 모두 끊김: 바로 방을 지우지 않고 잠깐 멈춤 → 와이파이 끊김·새로고침 후 다시 들어오면 경기 그대로 이어짐
  idle() {
    clearInterval(this.timer); this.timer = null;
    this.report(true);
    clearTimeout(this.idleT);
    this.idleT = setTimeout(() => { if (this.socks.size === 0) this.stop(); }, 90000);
  }

  stop() {
    clearTimeout(this.idleT); this.idleT = null;
    clearInterval(this.timer);
    this.timer = null;
    this.tokens.clear();
    this.newGame();
    this.report(true);
  }

  broadcast(m) { this.broadcastRaw(JSON.stringify(m)); }
  broadcastRaw(s) {
    for (const [id, ws] of this.socks) {
      try { ws.send(s); } catch { this.socks.delete(id); }
    }
  }
}

export class Lobby {
  constructor(state) {
    this.state = state;
    this.rooms = new Map();
  }
  async fetch(req) {
    const url = new URL(req.url);
    const now = Date.now();
    if (url.pathname === '/stats') {
      const KEYS = ['g', 'w', 'pa', 'h', 'hr', 'rbi', 'k', 'bb', 'sb', 'outs', 'r', 'ph', 'pk', 'pbb'];
      if (req.method === 'POST') {
        const b = await req.json();
        for (const [name, v] of Object.entries(b).slice(0, 20)) {
          const key = 'c:' + String(name).slice(0, 12);
          const cur = (await this.state.storage.get(key)) || {};
          for (const k of KEYS) cur[k] = (cur[k] || 0) + (Number(v[k]) || 0);
          cur.max = Math.max(cur.max || 0, Number(v.max) || 0);
          await this.state.storage.put(key, cur);
        }
        return json({ ok: true });
      }
      const names = (url.searchParams.get('n') || '').split(',').map((x) => x.trim().slice(0, 12)).filter(Boolean).slice(0, 20);
      const out = {};
      if (names.length) { const m = await this.state.storage.get(names.map((n) => 'c:' + n)); for (const n of names) { const v = m.get('c:' + n); if (v) out[n] = v; } }
      return json({ stats: out });
    }
    if (url.pathname === '/update') {
      const b = await req.json();
      if (b.remove) this.rooms.delete(b.code);
      else this.rooms.set(b.code, { ...b.info, t: now });
      return json({ ok: true });
    }
    for (const [k, v] of this.rooms) if (now - v.t > 120000) this.rooms.delete(k);
    const list = [...this.rooms.values()].sort((a, b) => (a.phase === 'lobby' ? 0 : 1) - (b.phase === 'lobby' ? 0 : 1) || b.players - a.players).slice(0, 50);
    return json({ rooms: list });
  }
}

// [motion] 핸드폰 컨트롤러 중계: 코드 하나 = DO 하나. host(PC) 1명 ↔ pad(핸드폰) 여럿, 받은 문자열을 반대쪽에 그대로 넘김 (저장 없음)
export class Pad {
  constructor(state) { this.state = state; this.host = null; this.pads = new Set(); }
  peers() { const n = JSON.stringify({ t: 'peer', host: this.host ? 1 : 0, pads: this.pads.size }); for (const w of [this.host, ...this.pads]) if (w) try { w.send(n); } catch { } }
  async fetch(req) {
    const role = new URL(req.url).searchParams.get('r') === 'h' ? 'h' : 'p';
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    if (role === 'h') { if (this.host) try { this.host.close(4004, '다른 곳에서 연결'); } catch { } this.host = server; }
    else { if (this.pads.size >= 4) { server.close(4002, '컨트롤러가 너무 많아'); return new Response(null, { status: 101, webSocket: client }); } this.pads.add(server); }
    server.addEventListener('message', (e) => {
      const d = typeof e.data === 'string' ? e.data : ''; if (!d || d.length > 2048) return;
      if (role === 'h') { for (const w of this.pads) try { w.send(d); } catch { } }
      else if (this.host) try { this.host.send(d); } catch { }
    });
    const bye = () => { if (role === 'h') { if (this.host === server) this.host = null; } else this.pads.delete(server); this.peers(); };
    server.addEventListener('close', bye); server.addEventListener('error', bye);
    this.peers();
    return new Response(null, { status: 101, webSocket: client });
  }
}
