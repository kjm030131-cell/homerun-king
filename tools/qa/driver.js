// [qa] 페이지 안에서 도는 봇 + 가상 시계 스텝퍼. run.mjs 가 addInitScript 로 넣는다.
// window.__qaVclock()     : 가상 시계 켜기 (이후 시간은 __qaStep 으로만 흐름)
// window.__qaStep(sec, o) : sec 초 동안 60Hz 로 [게임 틱 → 봇 입력 → 프레임] 반복. o.render = N 프레임마다 실제 렌더
// window.__qaSample()     : 누수·NaN 점검용 수치
(() => {
  const Q = window.__qa;
  let rng = 12345;
  const rnd = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  Q.seed = (s) => (rng = s | 0 || 1);
  const key = (type, k) => {
    const code = k === ' ' ? 'Space' : /^\d$/.test(k) ? 'Digit' + k : /^[a-z]$/.test(k) ? 'Key' + k.toUpperCase() : k;
    dispatchEvent(new KeyboardEvent(type, { key: k, code, bubbles: true }));
  };
  const tap = (k) => { key('keydown', k); key('keyup', k); };
  const canvas = () => document.getElementById('c');
  const pointer = (type, x, y, button = 0) => canvas().dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button, buttons: type === 'pointerdown' ? 1 : 0, bubbles: true }));
  // 홈플레이트 면(z=0) 위의 점 → 화면 좌표
  const toScreen = (x, y) => {
    const cam = window.__camera; if (!cam) return [innerWidth / 2, innerHeight / 2];
    const v = cam.position.clone(); v.set(x, y, 0).project(cam);
    return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight];
  };
  const C = (Q.count = { swings: 0, contact: 0, pitches: 0, throws: 0, games: 0, over: 0, replaysSkipped: 0, hr: 0, foul: 0, miss: 0, intro: 0, ab: 0 });
  const plan = {};
  let lastPitchClick = 0, moveKeys = [], moveUntil = 0, lastAct = 0;
  Q.bot = { on: true, swingP: 0.85, skipReplay: 0.3 };
  function bot(H) {
    if (!Q.bot.on) return;
    const s = H.S(); if (!s || !s.fl) return;
    const r = H.getRole(), g = H.game, now = g ? g.now : H.simNow();
    const scr = document.body.dataset.screen;
    if (scr === 'over') { C.over++; if (Q.bot.again !== false && rnd() < 0.02) { const b = document.getElementById('bAgain'); b && b.click(); C.games++; } return; }
    if (H.rp && H.rp.active && rnd() < Q.bot.skipReplay / 60) { tap(' '); C.replaysSkipped++; }
    // 타자
    if (r.batter && s.ph === 'pitching' && s.p) {
      const p = s.p;
      let P = plan[p.id];
      if (!P) {
        const z = rnd();
        P = plan[p.id] = {
          swing: rnd() < Q.bot.swingP,
          mode: z < 0.7 ? 'contact' : z < 0.95 ? 'power' : 'bunt',
          dt: (rnd() + rnd() + rnd() - 1.5) * 0.12, // 대략 ±0.18s
          ax: (rnd() - 0.5) * (rnd() < 0.6 ? 0.18 : 0.8), ay: (rnd() - 0.5) * (rnd() < 0.6 ? 0.18 : 0.8), done: false, aimed: false,
        };
        if (P.mode === 'bunt' && !s.bs) tap('b');
        if (P.mode !== 'bunt' && s.bs) tap('b');
        C.ab++;
      }
      if (P.swing && !P.done && now > p.t0) {
        const [x, y] = toScreen(p.tx + P.ax, p.ty + P.ay);
        pointer('pointermove', x, y);
        if (now >= p.arrive + P.dt) { P.done = true; C.swings++; if (P.mode === 'power') tap('f'); else tap(' '); }
      }
    }
    // 투수
    if (r.pitcher && s.ph === 'pitch') {
      if (H.cam() === 'intro' && rnd() < 0.05) { tap('Enter'); C.intro++; }
      if (now - lastPitchClick > 0.6 + rnd() * 0.8) {
        if (!Q._gauge) {
          tap(String(1 + Math.floor(rnd() * 6)));
          const [x, y] = toScreen((rnd() - 0.5) * 0.7, 0.45 + rnd() * 0.65); pointer('pointermove', x, y);
          tap(' '); Q._gauge = now; C.pitches++;
        } else if (now - Q._gauge > 0.3 + rnd() * 0.9) { tap(' '); Q._gauge = 0; }
        lastPitchClick = now;
      }
    } else Q._gauge = 0;
    // 수비·주루
    if (s.ph === 'live') {
      if (r.fi >= 0) {
        if (now > moveUntil) {
          for (const k of moveKeys) key('keyup', k);
          moveKeys = rnd() < 0.7 ? [['w', 'a', 's', 'd'][Math.floor(rnd() * 4)]] : [];
          if (rnd() < 0.3) moveKeys.push('shift');
          for (const k of moveKeys) key('keydown', k);
          moveUntil = now + 0.2 + rnd() * 0.8;
        }
        if (now - lastAct > 0.4 && rnd() < 0.08) {
          lastAct = now;
          const k = r.holding ? [' ', '1', '2', '3', '4', 'r'][Math.floor(rnd() * 6)] : [' ', 'c', 'q', '1', '2'][Math.floor(rnd() * 5)];
          tap(k); if (r.holding) C.throws++;
        }
      }
      if (r.offense && now - lastAct > 0.5 && rnd() < 0.03) { lastAct = now; tap(['e', 'q', ' '][Math.floor(rnd() * 3)]); }
    } else if (moveKeys.length) { for (const k of moveKeys) key('keyup', k); moveKeys = []; }
    if (r.offense && (s.ph === 'pitch') && rnd() < 0.002) tap('r'); // 가끔 도루
  }
  // 이벤트 세기 (bus 는 모듈 안이라 스냅샷 ev 를 game.events 대신 snapshot 훅으로 못 봄 → 게임 이벤트 배열을 엿봄)
  Q.evc = {};
  function countEv(H) {
    const g = H.game; if (!g || g.__qaEv || typeof g.ev !== 'function') return;
    const o = g.ev.bind(g); g.__qaEv = 1;
    g.ev = (e, d) => { Q.evc[e] = (Q.evc[e] || 0) + 1; if (e === 'contact') C.contact++; if (e === 'hr') C.hr++; if (e === 'foul') C.foul++; if (e === 'miss') C.miss++; return o(e, d); };
  }
  window.__qaBotStep = () => { const H = window.__hr; if (H) { countEv(H); bot(H); } };
  window.__qaVclock = () => {
    window.__V = Q.realNow(); performance.now = () => window.__V; window.__vclock = 1; window.__noRender = 1;
    // 혼자하기 setInterval 틱은 진짜 시계로 계속 돌면 안 됨 → 가상 시계라 dt=0 이라 자동으로 쉼(tickFn 의 dt<=0 return)
    return 1;
  };
  const fs = (Q.fstat = { n: 0, max: 0, sum: 0, top: [], hist: [0, 0, 0, 0, 0, 0], tickMax: 0, renderMax: 0, renderN: 0, contactWin: [] });
  window.__qaStep = (sec, o = {}) => {
    const H = window.__hr; if (!H) return 'no __hr';
    const n = Math.round(sec * 60), ms = 1000 / 60;
    const jit = o.jitter ?? (window.__qaJitter ?? 0.02); // 가끔 긴 프레임(렉) 흉내: 실제 맥에서 생기는 dt 튐 경로까지 돌게
    for (let i = 0; i < n; i++) {
      window.__V += rnd() < jit ? 40 + rnd() * 110 : ms;
      const t0 = Q.realNow();
      try { H.tick(); } catch (e) { Q.rec('tick', e); }
      const t1 = Q.realNow();
      countEv(H);
      try { bot(H); } catch (e) { Q.rec('bot', e); }
      const t2 = Q.realNow();
      const doRender = o.render && (fs.n % o.render === 0 || (o.renderContact && fs.n % 6 === 0 && window.__V / 1000 - (H.lct() || -9) < 0.6));
      window.__noRender = doRender ? 0 : 1;
      let fe = null;
      try { window.__frame(window.__V); } catch (e) { fe = e; Q.rec('frame', e); Q.frameErr = (Q.frameErr || 0) + 1; }
      const t3 = Q.realNow();
      window.__noRender = 1;
      try { ballCheck(H); } catch (e) { Q.rec('ballCheck', e); }
      const tick = t1 - t0, fr = t3 - t2, tot = tick + fr;
      fs.n++; fs.sum += tot; if (tot > fs.max) fs.max = tot; if (tick > fs.tickMax) fs.tickMax = tick;
      if (doRender) { fs.renderN++; if (fr > fs.renderMax) fs.renderMax = fr; }
      fs.hist[tot < 4 ? 0 : tot < 8 ? 1 : tot < 16 ? 2 : tot < 33 ? 3 : tot < 100 ? 4 : 5]++;
      const s = H.S();
      const sinceC = window.__V / 1000 - (H.lct() || -99);
      if (sinceC >= 0 && sinceC < 1.5 && !doRender) fs.contactWin.push(tot);
      if (fs.contactWin.length > 5000) fs.contactWin.splice(0, 2500);
      if (!doRender && tot > 40) { (Q.slowWin || (Q.slowWin = [])).push([t0, t3, +tick.toFixed(1), +fr.toFixed(1)]); (function qaSlowMark() { const m = Q.realNow(); while (Q.realNow() - m < 2); })(); } // 프로파일에서 느린 스텝 위치 표시
      if (!doRender && tot > 12) { fs.top.push({ ms: +tot.toFixed(1), tick: +tick.toFixed(1), ph: s && s.ph, cam: H.cam(), sinceContact: +sinceC.toFixed(2), err: fe ? String(fe.message).slice(0, 80) : undefined }); fs.top.sort((a, b) => b.ms - a.ms); fs.top.length = Math.min(fs.top.length, 25); }
      if (o.stopOnFrameErr && fe) return 'frameErr';
    }
    return 'ok';
  };
  // 화면 공 vs 시뮬 공: 위치 차이·보이는 속도/실제 속도 비율 (타구가 날아가는 중일 때만)
  const BC = (Q.ball = { n: 0, dSum: 0, dMax: 0, ratios: [], jumps: 0, lastP: null, lastT: 0 });
  let ballMesh = null;
  function ballCheck(H) {
    if (!ballMesh) H.scene.traverse((o) => { if (!ballMesh && o.isMesh && o.geometry && o.geometry.type === 'SphereGeometry' && Math.abs(o.geometry.parameters.radius - 0.037 * 1.6) < 1e-4) ballMesh = o; });
    const s = H.S(), g = H.game; if (!ballMesh || !s || !s.b || !g) { BC.lastP = null; return; }
    const b = s.b, st = b[7];
    if (!(s.ph === 'live' && b[6] < 0 && (st === 'air' || st === 'ground') && ballMesh.visible) || (H.rp && H.rp.active)) { BC.lastP = null; return; }
    const m = ballMesh.position, d = Math.hypot(m.x - b[0], m.y - b[1], m.z - b[2]);
    BC.n++; BC.dSum += d; if (d > BC.dMax) BC.dMax = d;
    { const sp = Math.hypot(b[3], b[4], b[5]) || 1, lag = ((b[0] - m.x) * b[3] + (b[1] - m.y) * b[4] + (b[2] - m.z) * b[5]) / sp; // + = 화면 공이 시뮬보다 뒤처짐(m)
      const sc = window.__V / 1000 - (H.lct() || -99), k = sc < 0.25 ? 0 : sc < 1 ? 1 : 2; const L = BC.lag || (BC.lag = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]); L[k][0]++; L[k][1] += lag; L[k][2] = Math.max(L[k][2], Math.abs(lag)); }
    const t = window.__V / 1000;
    if (BC.lastP && t - BC.lastT > 0 && t - BC.lastT < 0.03) {
      const vis = Math.hypot(m.x - BC.lastP[0], m.y - BC.lastP[1], m.z - BC.lastP[2]) / (t - BC.lastT), sim = Math.hypot(b[3], b[4], b[5]);
      if (sim > 5) { BC.ratios.push(vis / sim); if (BC.ratios.length > 20000) BC.ratios.splice(0, 10000); }
      if (vis > sim * 3 + 10) BC.jumps++;
    }
    BC.lastP = [m.x, m.y, m.z]; BC.lastT = t;
  }
  Q.ballStats = () => { const r = BC.ratios.slice().sort((a, b) => a - b), q = (k) => (r.length ? +r[Math.floor(r.length * k)].toFixed(2) : null); return { n: BC.n, dAvg: BC.n ? +(BC.dSum / BC.n).toFixed(3) : null, dMax: +BC.dMax.toFixed(2), speedRatio: { p10: q(0.1), p50: q(0.5), p90: q(0.9) }, jumps: BC.jumps, lag: (BC.lag || []).map(([n, sum, mx], i) => `${['타격 0~0.25s', '0.25~1s', '1s+'][i]}: 평균 ${n ? (sum / n).toFixed(2) : '-'}m 최대 ${mx.toFixed(2)}m (${n})`) }; };
  window.__qaSample = () => {
    const H = window.__hr; if (!H) return null;
    let objs = 0, meshes = 0, skin = 0, mix = 0, nan = [];
    H.scene.traverse((ob) => {
      objs++; if (ob.isSkinnedMesh) { skin++; if (ob.skeleton && ob.skeleton.bones.some((b) => /Hips/.test(b.name))) mix++; }
      if (ob.isMesh || ob.isSkinnedMesh || ob.isPoints || ob.isSprite) meshes++;
      const p = ob.position; if (!(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) && nan.length < 8) nan.push((ob.name || ob.type) + '@' + (ob.parent && (ob.parent.name || ob.parent.type)));
    });
    // 텍스처·지오메트리 추적: 장면에서 빠졌는데 dispose 안 된 것 = GPU 누수
    const TS = Q.texSeen || (Q.texSeen = new Map()), GS = Q.geoSeen || (Q.geoSeen = new Map()), now = new Set();
    const desc = (t) => `${t.name || ''}${t.isCanvasTexture ? 'canvas' : t.isDataTexture ? 'data' : 'img'} ${t.image ? (t.image.width + 'x' + t.image.height) : '?'}`;
    H.scene.traverse((ob) => {
      if (ob.geometry) { const g = ob.geometry; now.add(g.uuid); if (!GS.has(g.uuid)) { const e = { d: g.type + ' ' + (ob.name || ob.parent && ob.parent.name || ''), gone: false, disp: false }; GS.set(g.uuid, e); g.addEventListener('dispose', () => (e.disp = true)); } }
      const ms = ob.material ? (Array.isArray(ob.material) ? ob.material : [ob.material]) : [];
      const add = (k, t) => { if (t && t.isTexture) { now.add(t.uuid); if (!TS.has(t.uuid)) { const e = { d: k + ':' + desc(t), disp: false }; TS.set(t.uuid, e); t.addEventListener('dispose', () => (e.disp = true)); } } };
      for (const m of ms) { for (const k in m) add(k, m[k]); if (m.uniforms) for (const k in m.uniforms) add('u.' + k, m.uniforms[k] && m.uniforms[k].value); if (m.userData && m.userData.uni) for (const k in m.userData.uni) add('uni.' + k, m.userData.uni[k] && m.userData.uni[k].value); if (m.userData && m.userData.shader) for (const k in m.userData.shader.uniforms) add('su.' + k, m.userData.shader.uniforms[k].value); }
    });
    const leak = (M) => { const c = {}; let n = 0; for (const [u, e] of M) if (!now.has(u) && !e.disp) { n++; c[e.d] = (c[e.d] || 0) + 1; } return { n, top: Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 6) }; };
    const texLeak = leak(TS), geoLeak = leak(GS);
    const s = H.S(); const b = s && s.b;
    if (b && b.slice(0, 6).some((v) => typeof v === 'number' && !Number.isFinite(v))) nan.push('snapshot.b');
    const mi = H.renderer.info.memory;
    return { t: +((window.__V || Q.realNow()) / 1000).toFixed(1), objs, meshes, skin, mix, geo: mi.geometries, tex: mi.textures, prog: (H.renderer.info.programs || []).length, heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null, audio: Q.audioNodes, nan, ph: s && s.ph, inn: s && s.inn, half: s && s.half, mode: s && s.mode, score: s && s.sc, cam: H.cam(), screen: document.body.dataset.screen, texLeak, geoLeak, ev: H.game && H.game.events ? H.game.events.length : 0, rtt: !H.game && H.net() ? 1 : 0 };
  };
})();
