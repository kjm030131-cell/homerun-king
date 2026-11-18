// 홈런왕 — Cloudflare Worker + Durable Objects
//  Room  : 방 하나 = DO 하나. 60Hz 시뮬레이션, 20Hz 스냅샷 브로드캐스트
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
const SNAP_EVERY = 2;

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
    if (url.pathname === '/info') return json({ exists: this.socks.size > 0, ...this.info() });

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
    clearTimeout(this.idleT);
    if (this.timer) return;
    let last = Date.now();
    this.timer = setInterval(() => {
      const t = Date.now();
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      try { this.game.tick(dt); } catch (err) { console.error('tick', err); }
      if (++this.n % SNAP_EVERY === 0) this.broadcast(this.game.snapshot(true)); // true: 게임 이벤트(ev)를 실어 보내고 비움
      if (this.n % 60 === 0) this.report();
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
    clearTimeout(this.idleT);
    clearInterval(this.timer);
    this.timer = null;
    this.tokens.clear();
    this.newGame();
    this.report(true);
  }

  broadcast(m) {
    const s = JSON.stringify(m);
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
