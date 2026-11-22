// [net] netbench.mjs 의 클라 모델 — main.js 의 스냅샷 수신(onSnap)·보간 버퍼(netBuf/interpAt)·공 외삽·화면 이동(place)을 그대로 흉내 낸다.
//  kind = 'v20' (1a666bc main.js), 'cur' (ad4c38e main.js), 'new' (client/net/interp.js — main.js 가 실제로 쓰는 모듈)
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const HERE = new URL('../../', import.meta.url).pathname;
const SNAP = await import(pathToFileURL(join(HERE, 'client/net/snap.js')).href).catch(() => null);
const NI = await import(pathToFileURL(join(HERE, 'client/net/interp.js')).href).catch(() => null);
if (NI && process.env.NETCFG) Object.assign(NI.NET, JSON.parse(process.env.NETCFG)); // 튜닝용: NETCFG='{"Q":0.9}'

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, u) => a + (b - a) * u;
const lerpAng = (a, b, u) => { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * u; };
const hr = () => Number(process.hrtime.bigint()) / 1e6;
const rkey = (r) => (r[7] ? 'r' + r[7] : r[2] + '|' + (r[4] || ''));

export function makeClient({ kind, sim, i, now, send, truthAt, rnd, gauss, srvNow }) {
  const { integrate, inZone, ZONE, runnerXZ } = sim;
  const C = { i, kind, id: null, errors: [] };
  const stat = C.stat = { down: 0, msgs: 0, perSec: new Map(), parse: [], proc: [], frameMs: [], snapB: 0, snapN: 0, snapMaxB: 0, frames: 0, diag: {}, catchup: 0, lagSum: 0, ballLagSum: 0, under: 0, hold: 0, extrap: 0, delaySum: 0,
    plN: 0, plE2: 0, plErrs: [], stall: 0, lurch: 0, moving: 0, plJump: 0, bN: 0, bE2: 0, bErrs: [], bJump: 0, ev: {} };
  let offset = null, S = null, prevS = null, ballL = null, lastBallSt = '', lastFrame = null;
  const snapHist = [];
  const netQ = { jit: 0.01, lastArr: 0, lastNow: 0, delay: 0.06 };
  const NB = kind === 'new' && NI ? NI.createNetInterp() : null;
  const simNow = () => (NB ? NB.simNow(now()) : now() + (offset || 0));
  const A = []; const runners = new Map();
  const merger = SNAP ? SNAP.createSnapMerger() : null;
  C.send = (m) => send(m);
  C.reset = () => { stat.down = 0; stat.msgs = 0; stat.perSec.clear(); for (const k of ['parse', 'proc', 'frameMs', 'plErrs', 'bErrs']) stat[k].length = 0; for (const k of ['snapB', 'snapN', 'snapMaxB', 'frames', 'under', 'hold', 'extrap', 'delaySum', 'plN', 'plE2', 'stall', 'lurch', 'moving', 'plJump', 'bN', 'bE2', 'bJump', 'catchup', 'lagSum', 'ballLagSum']) stat[k] = 0; stat.ev = {}; };

  // ── 수신 ──
  C.recv = (raw) => {
    const a = hr(); let m; try { m = JSON.parse(raw); } catch (e) { C.errors.push('parse ' + e.message); return; }
    const b = hr(); stat.parse.push(b - a);
    try {
      switch (m.t) {
        case 'welcome': C.id = m.id; break;
        case 'pong': { const rtt = Math.round((now() - m.c) * 1000); send({ t: 'rtt', ms: rtt }); break; }
        case 's': {
          if (SNAP) { m = merger.merge(m); if (!m) { C.errors.push('델타인데 기준 없음'); break; } }
          const B = Buffer.byteLength(raw); stat.snapB += B; stat.snapN++; stat.snapMaxB = Math.max(stat.snapMaxB, B);
          onSnap(m);
          if (m.ev) for (const x of m.ev) stat.ev[x.e] = (stat.ev[x.e] || 0) + 1;
          break;
        }
      }
    } catch (e) { C.errors.push(String(e.stack || e).slice(0, 300)); }
    stat.proc.push(hr() - b);
  };
  let pingAt = 0;

  function netBuf(s, p) { // cur / v20 공통 (main.js 그대로)
    if (netQ.lastArr) {
      const d = (p - netQ.lastArr) - (s.now - netQ.lastNow);
      netQ.jit += (Math.abs(d) - netQ.jit) * (Math.abs(d) > netQ.jit ? 0.2 : 0.03);
    }
    netQ.lastArr = p; netQ.lastNow = s.now;
    const want = clamp(1 / 30 + netQ.jit * 2.2, 0.045, 0.22);
    netQ.delay += (want - netQ.delay) * 0.08;
    const rn = new Map(); for (const r of s.rn || []) rn.set(rkey(r), r);
    if (snapHist.length && s.now <= snapHist[snapHist.length - 1].t) return;
    snapHist.push({ t: s.now, fl: s.fl, rn });
    while (snapHist.length > 24) snapHist.shift();
  }
  function interpAt(t) {
    const n = snapHist.length; if (n < 2) return null;
    if (t >= snapHist[n - 1].t) return [snapHist[n - 1], snapHist[n - 1], 0];
    for (let i = n - 2; i >= 0; i--) { const a = snapHist[i], b = snapHist[i + 1]; if (t >= a.t) return [a, b, b.t > a.t ? (t - a.t) / (b.t - a.t) : 0]; }
    return [snapHist[0], snapHist[0], 0];
  }
  function onSnap(s) {
    const p = now();
    if (NB) NB.onSnap(s, p);
    else {
      const sample = s.now - p;
      if (offset === null || sample > offset || Math.abs(sample - offset) > 2) offset = sample; else offset += (sample - offset) * 0.02;
      if (s.fl) netBuf(s, p);
    }
    if (s.ph === 'lobby') { S = s; return; }
    if (!s.fl || !s.fl.length) { S = s; return; }
    prevS = S; S = s;
    if (s.b) {
      const [x, y, z, vx, vy, vz, h, st, sx, sy, sz] = s.b;
      if (kind === 'v20') {
        if (!ballL || h >= 0 || st !== lastBallSt || Math.hypot(ballL.x - x, ballL.y - y, ballL.z - z) > 2.5) ballL = { x, y, z, vx, vy, vz, sx, sy, sz, state: st, h };
        else {
          const sb = { x, y, z, vx, vy, vz, sx, sy, sz, state: st, h };
          const age = clamp(simNow() - s.now, 0, 0.25);
          for (let i = 0, n = Math.ceil(age * 120); i < n; i++) integrate(sb, age / n);
          const k = 0.35;
          ballL.x = lerp(ballL.x, sb.x, k); ballL.y = lerp(ballL.y, sb.y, k); ballL.z = lerp(ballL.z, sb.z, k);
          ballL.vx = sb.vx; ballL.vy = sb.vy; ballL.vz = sb.vz; ballL.sx = sb.sx; ballL.sy = sb.sy; ballL.sz = sb.sz; ballL.h = h; ballL.state = sb.state;
        }
      } else if (NB) {
        const pre = ballL ? { x: ballL.x, y: ballL.y, z: ballL.z, o: ballL } : null;
        ballL = NI.mergeBall(ballL, s, simNow(), integrate, lastBallSt);
        if (process.env.NBDIAG && pre && pre.o === ballL) { const d = Math.hypot(ballL.x - pre.x, ballL.y - pre.y, ballL.z - pre.z) / 0.35; const k = 'merge:' + ballL.state + ':' + (d < 0.05 ? '<5cm' : d < 0.3 ? '<30cm' : d < 1 ? '<1m' : '>1m'); stat.diag[k] = (stat.diag[k] || 0) + 1; }
      } else {
        const sb = { x, y, z, vx, vy, vz, sx, sy, sz, state: st, h };
        if (h < 0) { const age = clamp(simNow() - s.now, 0, 0.25); for (let i = 0, n = Math.ceil(age * 120); i < n; i++) integrate(sb, age / n); }
        if (!ballL || h >= 0 || ballL.h >= 0 || (st === 'thrown' && lastBallSt !== 'thrown') || Math.hypot(ballL.x - sb.x, ballL.y - sb.y, ballL.z - sb.z) > 2.5) ballL = sb;
        else {
          const k = 0.35;
          ballL.x = lerp(ballL.x, sb.x, k); ballL.z = lerp(ballL.z, sb.z, k);
          const sameSide = (ballL.vy > 0.5) === (sb.vy > 0.5) || (ballL.y > 0.8 && sb.y > 0.8);
          if (sameSide) { ballL.y = lerp(ballL.y, sb.y, k); ballL.vy = sb.vy; ballL.state = sb.state; }
          ballL.vx = sb.vx; ballL.vz = sb.vz; ballL.sx = sb.sx; ballL.sy = sb.sy; ballL.sz = sb.sz; ballL.h = h;
          if (sb.state === 'thrown' || sb.state === 'dead') ballL.state = sb.state;
        }
      }
      lastBallSt = st;
    } else { ballL = null; lastBallSt = ''; }
  }

  // main.js place() (v20: 속도 상한 없음)
  function place(o, x, z, dt, k) {
    if (!o.init) { o.x = x; o.z = z; o.init = true; return; }
    const a = 1 - Math.exp(-k * dt);
    const ox = o.x, oz = o.z;
    let nx = lerp(ox, x, a), nz = lerp(oz, z, a);
    if (kind !== 'v20' && !process.env.NOCAP) {
      const jump = Math.hypot(x - ox, z - oz), vmax = 10.5 * dt, mv = Math.hypot(nx - ox, nz - oz);
      if (jump < 50 && mv > vmax) { nx = ox + (nx - ox) * vmax / mv; nz = oz + (nz - oz) * vmax / mv; }
      else if (jump >= 50) { nx = x; nz = z; }
    }
    o.x = nx; o.z = nz;
  }

  // ── 프레임 (60fps) ──
  const bot = { pAt: -1, sw: null, dec: -1 };
  C.frame = () => {
    const tn = now();
    const dt = lastFrame == null ? 1 / 60 : Math.min(0.1, tn - lastFrame); lastFrame = tn;
    if (tn - pingAt >= 1) { pingAt = tn; send({ t: 'ping', c: tn }); }
    if (!S || !S.fl || !S.fl.length || S.ph === 'lobby') return;
    const f0 = hr();
    const t = simNow();
    runBot(t);
    // 수비수·주자 화면 위치
    let IP = null, ti = t, under = false, ext = 0;
    if (NB) { const r = NB.sample(t, dt, S.ph === 'live'); IP = r; ti = r ? r.ti : t; under = !!(r && r.under); ext = r ? r.ext : 0; stat.delaySum += NB.delay; }
    else {
      ti = t - netQ.delay; IP = interpAt(ti); stat.delaySum += netQ.delay;
      if (snapHist.length && ti > snapHist[snapHist.length - 1].t) { under = true; ext = 0; }
    }
    stat.lagSum += srvNow() - ti; stat.ballLagSum += srvNow() - t;
    stat.frames++; if (under) { stat.under++; if (!ext) stat.hold++; else stat.extrap += ext; }
    const live = S.ph === 'live';
    const tr = truthAt(ti), trP = truthAt(ti - dt);
    S.fl.forEach((f, i) => {
      let [pos, x, z] = f;
      let tIntent = ti;
      if (NB) { const q = IP && IP.fl(i, pos); if (q) { x = q[0]; z = q[1]; if (live) tIntent = t; } }
      else if (IP) {
        const fa = IP[0].fl[i], fb = IP[1].fl[i];
        if (fa && fb && fa[0] === pos && fb[0] === pos) {
          x = lerp(fa[1], fb[1], IP[2]); z = lerp(fa[2], fb[2], IP[2]);
          if (kind === 'cur' && live && IP[1].t > IP[0].t) { const dtS = IP[1].t - IP[0].t, ah = netQ.delay; let ex = (fb[1] - fa[1]) / dtS * ah, ez = (fb[2] - fa[2]) / dtS * ah; const el = Math.hypot(ex, ez); if (el > 1.5) { ex *= 1.5 / el; ez *= 1.5 / el; } x += ex; z += ez; tIntent = t; }
        }
      }
      const o = A[i] || (A[i] = { init: false });
      const ox = o.x, oz = o.z, had = o.init && o.pos === pos;
      place(o, x, z, dt, IP ? 22 : 12); o.pos = pos;
      C.diagTag = 'F' + pos; if (had) measure(o.x - ox, o.z - oz, o.x, o.z, dt, tIntent, (T) => T.fl[i], (T) => T.pos === S.fl.map((q) => q[0]).join(), tr, trP);
    });
    const seen = new Set();
    for (const r of S.rn || []) {
      const key = rkey(r); seen.add(key);
      let x = r[0], z = r[1];
      if (NB) { const q = IP && IP.rn(key); if (q) { x = q[0]; z = q[1]; } }
      else if (IP) { const ra = IP[0].rn.get(key), rb = IP[1].rn.get(key); if (ra && rb) { x = lerp(ra[0], rb[0], IP[2]); z = lerp(ra[1], rb[1], IP[2]); } }
      // 리드(투구 전): main.js 처럼 베이스에서 떨어진 자리 — 측정에서 뺌
      const b = r[3], onBase = Math.abs(b - Math.round(b)) < 0.01 && b >= 1 && b <= 3;
      if (onBase && (S.ph === 'pitch' || S.ph === 'pitching') && !(r[5] & 1)) { const [nx, nz] = runnerXZ(b + 0.09); x = nx; z = nz; }
      let o = runners.get(key); if (!o) runners.set(key, (o = { init: false }));
      const ox = o.x, oz = o.z, had = o.init;
      place(o, x, z, dt, 16);
      C.diagTag = 'R'; if (had && !onBase) measure(o.x - ox, o.z - oz, o.x, o.z, dt, ti, (T) => T.rn.get(key), () => true, tr, trP);
    }
    for (const k of runners.keys()) if (!seen.has(k)) runners.delete(k);
    // 공 (타구·송구, 수비수 손 밖)
    if (ballL && (S.ph === 'live' || S.ph === 'result') && ballL.h < 0) {
      const LD = C.lastDraw; const fresh = !LD || LD.o !== ballL || LD.f !== stat.frames - 1; const px = fresh ? ballL.x : LD.x, py = fresh ? ballL.y : LD.y, pz = fresh ? ballL.z : LD.z; // 지난 프레임에 그린 자리 기준
      if (NB) NI.stepBall(ballL, t, integrate);
      else { const steps = Math.ceil(dt / (1 / 120)); for (let k = 0; k < steps; k++) integrate(ballL, dt / steps); }
      const T = truthAt(t), Tp = truthAt(t - dt);
      const bt = T && T[0].b && T[1].b && T[0].b[3] < 0 && T[1].b[3] < 0 ? [lerp(T[0].b[0], T[1].b[0], T[2]), lerp(T[0].b[1], T[1].b[1], T[2]), lerp(T[0].b[2], T[1].b[2], T[2])] : null;
      const bp = Tp && Tp[0].b && Tp[1].b && Tp[0].b[3] < 0 && Tp[1].b[3] < 0 ? [lerp(Tp[0].b[0], Tp[1].b[0], Tp[2]), lerp(Tp[0].b[1], Tp[1].b[1], Tp[2]), lerp(Tp[0].b[2], Tp[1].b[2], Tp[2])] : null;
      C.lastDraw = { o: ballL, f: stat.frames, x: ballL.x, y: ballL.y, z: ballL.z };
      if (bt && bp && !fresh) {
        const e = Math.hypot(ballL.x - bt[0], ballL.y - bt[1], ballL.z - bt[2]);
        stat.bN++; stat.bE2 += e * e; stat.bErrs.push(e);
        const jd = Math.hypot((ballL.x - px) - (bt[0] - bp[0]), (ballL.y - py) - (bt[1] - bp[1]), (ballL.z - pz) - (bt[2] - bp[2]));
        if (jd > 0.3) { stat.bJump++; if (process.env.NBDIAG) { const k = 'ball:' + ballL.state + ':' + (jd > 1 ? '>1' : '<1') + ':v' + Math.round(Math.hypot(ballL.vx, ballL.vy, ballL.vz) / 10) * 10; stat.diag[k] = (stat.diag[k] || 0) + 1; } }
      }
    }
    stat.frameMs.push(hr() - f0);
  };
  function measure(dx, dz, x, z, dt, tI, get, ok, tr0, trP0) {
    const tr = truthAt(tI), trP = truthAt(tI - dt); void tr0; void trP0;
    if (!tr || !trP || !ok(tr[0]) || !ok(tr[1])) return;
    const a = get(tr[0]), b = get(tr[1]), pa = get(trP[0]), pb = get(trP[1]);
    if (!a || !b || !pa || !pb) return;
    const tx = lerp(a[0], b[0], tr[2]), tz = lerp(a[1], b[1], tr[2]), px = lerp(pa[0], pb[0], trP[2]), pz = lerp(pa[1], pb[1], trP[2]);
    const e = Math.hypot(x - tx, z - tz); if (e > 30) return; // 교대·리셋
    stat.plN++; stat.plE2 += e * e; if (stat.plErrs.length < 400000) stat.plErrs.push(e);
    const tv = Math.hypot(tx - px, tz - pz) / dt, dv = Math.hypot(dx, dz) / dt;
    if (e > 3 || tv > 15) { stat.catchup++; return; } // 서버가 순간 이동시킨 뒤 화면에서 뛰어서 따라가는 중(속도 상한 10.5m/s, [qa 11-19]) — 네트워크 끊김과 따로 셈
    const tag = (w) => { if (!process.env.NBDIAG) return; const k = w + ':' + (C.diagTag || '?') + ':' + S.ph + ':' + (tv > 12 ? 'tv>12' : tv > 6 ? 'tv6-12' : 'tv<6'); stat.diag[k] = (stat.diag[k] || 0) + 1; };
    if (tv > 2) { stat.moving++; if (dv < 0.3 * tv) { stat.stall++; tag('stall'); } }
    if (dv > tv * 1.6 + 1.5) { stat.lurch++; tag('lurch'); }
    if (Math.hypot(dx - (tx - px), dz - (tz - pz)) > 0.3) { stat.plJump++; tag('jump'); }
  }
  // ── 봇: 투수면 1.5~3.5초 뒤 투구, 타자면 공을 '보고'(σ 7cm) 존 안이면 스윙(타이밍 σ 100ms) ──
  function runBot(t) {
    const s = S; if (!C.id) return;
    const P = s.fl[0];
    if (s.ph === 'pitch' && P && P[4] === C.id) {
      if (bot.pAt < 0) bot.pAt = t + 1.5 + rnd() * 2;
      if (t >= bot.pAt) { bot.pAt = -1; const ty = ['FB', 'TS', 'SL', 'CB', 'CH', 'SP'][(rnd() * 6) | 0]; send({ t: 'pitch', type: ty, tx: (rnd() - 0.5) * 0.62, ty: 0.42 + rnd() * 0.72, power: 0.84 + rnd() * 0.13 }); }
    } else bot.pAt = -1;
    const p = s.p;
    if (s.ph === 'pitching' && p && s.bat && s.bat.id === C.id) {
      if (bot.dec !== p.id && t >= p.arrive - 0.3) {
        bot.dec = p.id; bot.sw = null;
        const px = p.tx + gauss() * 0.056, py = p.ty + gauss() * 0.07;
        const z = px >= ZONE.x0 && px <= ZONE.x1 && py >= ZONE.y0 && py <= ZONE.y1;
        if (rnd() < (z ? 0.8 : 0.15)) bot.sw = { pid: p.id, at: p.arrive + gauss() * 0.1, ax: px - p.tx + gauss() * 0.08, ay: py - p.ty + gauss() * 0.08, mode: rnd() < 0.25 ? 'power' : 'contact' };
      }
      if (bot.sw && bot.sw.pid === p.id && t >= bot.sw.at) { const w = bot.sw; bot.sw = null; send({ t: 'swing', pid: w.pid, dt: t - p.arrive, ax: w.ax, ay: w.ay, mode: w.mode }); }
    }
    void inZone;
  }
  C.gameStat = () => ({ inn: S && S.inn, sc: S && S.sc, hits: S && S.hits, ev: stat.ev });
  C.report = (sec) => {
    const q = (a, p) => { if (!a.length) return 0; const s = Float64Array.from(a).sort(); return s[Math.floor(s.length * p)]; };
    const secs = [...stat.perSec.values()];
    return {
      kbps: stat.down / 1024 / sec, kbpsMax: +(Math.max(0, ...secs) / 1024).toFixed(2), mps: stat.msgs / sec, snapB: stat.snapB / Math.max(1, stat.snapN), snapMaxB: stat.snapMaxB,
      parse: stat.parse, proc: stat.proc, frameMs: stat.frameMs,
      underrun: stat.under / Math.max(1, stat.frames), hold: stat.hold / Math.max(1, stat.frames), extrapMs: 1000 * stat.extrap / Math.max(1, stat.under - stat.hold), delayMs: 1000 * stat.delaySum / Math.max(1, stat.frames), lagMs: 1000 * stat.lagSum / Math.max(1, stat.frames), ballLagMs: 1000 * stat.ballLagSum / Math.max(1, stat.frames),
      plErr: Math.sqrt(stat.plE2 / Math.max(1, stat.plN)), plErr99: q(stat.plErrs, 0.99), stall: stat.stall / Math.max(1, stat.moving), lurch: stat.lurch / Math.max(1, stat.plN), plJump: stat.plJump / (sec / 60) / 1, catchup: stat.catchup / Math.max(1, stat.plN + stat.catchup),
      bErr: Math.sqrt(stat.bE2 / Math.max(1, stat.bN)), bErr99: q(stat.bErrs, 0.99), bJump: stat.bJump / Math.max(1e-9, stat.bN / 3600), bN: stat.bN,
    };
  };
  return C;
}
