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
    const r = H.getRole(), g = H.game, now = g.now;
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
    for (let i = 0; i < n; i++) {
      window.__V += ms;
      const t0 = Q.realNow();
      try { H.tick(); } catch (e) { Q.rec('tick', e); }
      const t1 = Q.realNow();
      countEv(H);
      try { bot(H); } catch (e) { Q.rec('bot', e); }
      const t2 = Q.realNow();
      const doRender = o.render && (fs.n % o.render === 0 || (o.renderContact && window.__V / 1000 - (H.lct() || -9) < 0.6));
      window.__noRender = doRender ? 0 : 1;
      let fe = null;
      try { window.__frame(window.__V); } catch (e) { fe = e; Q.rec('frame', e); Q.frameErr = (Q.frameErr || 0) + 1; }
      const t3 = Q.realNow();
      window.__noRender = 1;
      const tick = t1 - t0, fr = t3 - t2, tot = tick + fr;
      fs.n++; fs.sum += tot; if (tot > fs.max) fs.max = tot; if (tick > fs.tickMax) fs.tickMax = tick;
      if (doRender) { fs.renderN++; if (fr > fs.renderMax) fs.renderMax = fr; }
      fs.hist[tot < 4 ? 0 : tot < 8 ? 1 : tot < 16 ? 2 : tot < 33 ? 3 : tot < 100 ? 4 : 5]++;
      const s = H.S();
      const sinceC = window.__V / 1000 - (H.lct() || -99);
      if (sinceC >= 0 && sinceC < 1.5 && !doRender) fs.contactWin.push(tot);
      if (fs.contactWin.length > 5000) fs.contactWin.splice(0, 2500);
      if (!doRender && tot > 12) { fs.top.push({ ms: +tot.toFixed(1), tick: +tick.toFixed(1), ph: s && s.ph, cam: H.cam(), sinceContact: +sinceC.toFixed(2), err: fe ? String(fe.message).slice(0, 80) : undefined }); fs.top.sort((a, b) => b.ms - a.ms); fs.top.length = Math.min(fs.top.length, 25); }
      if (o.stopOnFrameErr && fe) return 'frameErr';
    }
    return 'ok';
  };
  window.__qaSample = () => {
    const H = window.__hr; if (!H) return null;
    let objs = 0, meshes = 0, skin = 0, mix = 0, nan = [];
    H.scene.traverse((ob) => {
      objs++; if (ob.isSkinnedMesh) { skin++; if (ob.skeleton && ob.skeleton.bones.some((b) => /Hips/.test(b.name))) mix++; }
      if (ob.isMesh || ob.isSkinnedMesh || ob.isPoints || ob.isSprite) meshes++;
      const p = ob.position; if (!(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) && nan.length < 8) nan.push((ob.name || ob.type) + '@' + (ob.parent && (ob.parent.name || ob.parent.type)));
    });
    const s = H.S(); const b = s && s.b;
    if (b && b.slice(0, 6).some((v) => typeof v === 'number' && !Number.isFinite(v))) nan.push('snapshot.b');
    const mi = H.renderer.info.memory;
    return { t: +((window.__V || Q.realNow()) / 1000).toFixed(1), objs, meshes, skin, mix, geo: mi.geometries, tex: mi.textures, prog: (H.renderer.info.programs || []).length, heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null, audio: Q.audioNodes, nan, ph: s && s.ph, inn: s && s.inn, half: s && s.half, mode: s && s.mode, score: s && s.sc, cam: H.cam(), screen: document.body.dataset.screen, ev: H.game.events ? H.game.events.length : 0 };
  };
})();
