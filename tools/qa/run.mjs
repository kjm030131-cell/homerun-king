// [qa] 헤드리스 실행 하네스 — 진짜 크롬(헤드리스, SwiftShader WebGL)에서 실제 main.js 루프로 혼자하기를 돌린다.
//
// 사용:
//   node tools/qa/run.mjs                       # 기본 시나리오 전부
//   node tools/qa/run.mjs game-real legacy-game # 이름으로 골라서
//   node tools/qa/run.mjs --list                # 시나리오 목록
//   옵션: --sec=게임초  --render=N(N프레임마다 실제 렌더, 기본 30)  --seed=N  --json=파일  --headed
//
// 필요: three r160 (THREE_DIR 또는 node_modules/three 또는 /tmp/three160), 크롬(CHROME 또는 /usr/bin/google-chrome),
//       playwright-core (node_modules 또는 /opt/npm-tools), esbuild 또는 bun.
// 하는 일: client/main.js 번들 → public/ 서빙(three 는 로컬, 폰트·CDN 차단) → 페이지에 계측(inject.js)·봇(driver.js) 주입
//   → 타이틀 → 모드 선택(리얼/캐주얼) → 혼자하기 설정 → 시작 → 가상 시계로 게임을 굴리며 봇이 키보드·포인터 이벤트로 플레이
//   → 예외(특히 rAF/프레임 안 예외 = 화면 고정), 프레임당 JS 시간, 장면 객체·지오메트리·텍스처·오디오 노드 수, NaN 위치를 기록.
// 끝 코드: 예외가 있으면 1.
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { bundle, serve, root } from './serve.mjs';
import { attachRooms } from './room.mjs';

const argv = process.argv.slice(2);
const opt = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const names = argv.filter((a) => !a.startsWith('--'));

// 시나리오: url 쿼리, 메뉴 선택, 게임 초, 봇 설정
export const SCENARIOS = {
  'game-real': { rules: 'real', mode: 'game', inn: '3', pos: 'any', sec: 900, desc: '리얼 3이닝, 포지션 아무거나 (타격·수비 다)' },
  'game-casual': { rules: 'casual', mode: 'game', inn: '3', pos: 'any', sec: 700, desc: '캐주얼 3이닝' },
  'game-pitcher': { rules: 'real', mode: 'game', inn: '1', pos: 'P', team: 'home', sec: 400, desc: '투수(홈팀) 1이닝 — 투구·수비' },
  'game-cf': { rules: 'real', mode: 'game', inn: '1', pos: 'CF', team: 'home', fld: 'pos', sec: 400, desc: '중견수 직접 조작' },
  derby: { rules: 'real', mode: 'derby', inn: '3', sec: 500, desc: '홈런 더비' },
  practice: { rules: 'real', mode: 'practice', sec: 400, desc: '타격 연습 (수백 번 스윙)' },
  'legacy-game': { q: '?legacy', rules: 'real', mode: 'game', inn: '3', pos: 'any', sec: 600, desc: '옛 몸(?legacy) 리얼' },
  'legacy-practice': { q: '?legacy', rules: 'casual', mode: 'practice', sec: 300, desc: '옛 몸 타격 연습' },
  multi: { multi: 3, sec: 150, rules: 'real', desc: '멀티: 진짜 Room(src/index.js)을 node 에서 + 브라우저 3개 접속 (실시간, 렌더 끔)' },
  'multi-casual': { multi: 2, sec: 120, rules: 'casual', desc: '멀티 캐주얼 2명' },
  realtime: { rules: 'real', mode: 'practice', realtime: 25, desc: '가상 시계 없이 실제 rAF 루프 + 렌더 (화면 고정 확인)' },
};
if (opt.list) { for (const [k, v] of Object.entries(SCENARIOS)) console.log(k.padEnd(16), v.desc); process.exit(0); }
const pick = names.length ? names : Object.keys(SCENARIOS);

const req = (m) => { for (const b of [root, '/opt/npm-tools']) { try { return createRequire(b + '/')(m); } catch { } } throw new Error(m + ' 없음'); };
const { chromium } = req('playwright-core');
const chrome = [process.env.CHROME, '/usr/bin/google-chrome', '/opt/pw-browsers/chromium/chrome-linux64/chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && existsSync(p));

const b = await bundle();
console.log(`[qa] 번들 ${b.tool} ${b.ms}ms`);
let RM = null;
const { srv, port } = await serve({ api: async (p) => {
  if (p === '/api/new') return { code: 'QA' + String.fromCharCode(65 + Object.keys(report).length) + 'M' };
  const m = p.match(/^\/api\/room\/(\w{4})$/); if (m && RM) { const r = await RM.roomOf(m[1].toUpperCase()).fetch(new Request('http://x/info', { headers: { 'x-room': m[1].toUpperCase() } })); return r.json(); }
  return null;
} });
RM = await attachRooms(srv, root);
const browser = await chromium.launch({ executablePath: chrome, headless: !opt.headed, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--autoplay-policy=no-user-gesture-required'] });
const inject = readFileSync(join(root, 'tools/qa/inject.js'), 'utf8') + '\n' + readFileSync(join(root, 'tools/qa/driver.js'), 'utf8');
const report = {};
let bad = 0;

for (const name of pick) {
  const S = SCENARIOS[name]; if (!S) { console.log('없는 시나리오', name); continue; }
  if (S.multi) { const r = await runMulti(name, S); report[name] = r; if (r.bad) bad++; continue; }
  const t0 = Date.now();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const cons = [];
  page.on('console', (m) => { const t = m.type(); if ((t === 'error' || t === 'warning' || /\[anim\]/.test(m.text())) && !/GL Driver Message|Failed to load resource/.test(m.text())) cons.push(`[${t}] ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => cons.push('[pageerror] ' + (e.stack || e.message).split('\n').slice(0, 4).join(' | ')));
  page.on('response', (x) => { if (x.status() >= 400) cons.push(`[404] ${x.url().replace(/^https?:\/\/[^/]+/, '')}`); });
  page.on('crash', () => cons.push('[crash] 페이지 크래시'));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, body: '' }));
  await page.addInitScript({ content: inject + `;window.__qa.seed(${+opt.seed || 7});` });
  await page.goto(`http://127.0.0.1:${port}/${S.q || ''}`);
  await page.waitForFunction(() => document.getElementById('bPlay'), null, { timeout: 30000, polling: 500 });
  // 새 캐릭터 GLB 로딩 기다림 (옛 몸이면 바로)
  if (!S.q) await page.waitForFunction(() => 1, null, { timeout: 1000 }).catch(() => { });
  await page.waitForTimeout(S.q ? 1500 : 6000);
  const r = { name, desc: S.desc };
  const samples = [];
  try {
    await page.evaluate((S) => {
      const $ = (id) => document.getElementById(id);
      const seg = (id, v) => { const b = document.querySelector(`#${id} [data-v="${v}"]`); if (b) b.click(); };
      window.__fastCam = 1;
      $('nick').value = 'QA봇'; $('bPlay').click();
      document.querySelector(`#modes [data-rules="${S.rules}"]`).click();
      $('bSolo').click();
      seg('oRules', S.rules); seg('oMode', S.mode); if (S.inn) seg('oInn', S.inn); if (S.team) seg('oTeam', S.team); if (S.fld) seg('oFld', S.fld);
      if (S.pos) $('oPos').value = S.pos;
      $('oGo').click();
    }, S);
    await page.waitForTimeout(1500);
    r.anim = cons.filter((c) => /\[anim\]/.test(c));
    if (S.realtime) {
      // 실제 시계·실제 rAF·실제 렌더. 봇은 setInterval 로
      await page.evaluate(() => { const Q = window.__qa; Q.bot.on = true; window.__qaBotIv = setInterval(() => { try { window.__qaBotStep && window.__qaBotStep(); } catch (e) { Q.rec('bot', e); } }, 16); });
      const end = Date.now() + S.realtime * 1000;
      let lastN = 0;
      while (Date.now() < end) {
        await page.waitForTimeout(2500);
        const x = await page.evaluate(() => ({ raf: window.__qa.raf.n, last: window.__qa.raf.last, s: window.__qaSample() }));
        samples.push({ ...x.s, rafFrames: x.raf - lastN }); lastN = x.raf;
        if (opt.v) console.log(`  .. rAF ${samples[samples.length - 1].rafFrames} 프레임/2.5s, 마지막 ${x.last.toFixed(0)}ms ${x.s && x.s.ph}/${x.s && x.s.cam} 스킨${x.s && x.s.skin}/믹사모${x.s && x.s.mix}`);
      }
      r.rafStalled = samples.slice(-2).every((x) => x.rafFrames === 0);
    } else {
      await page.evaluate((j) => { window.__qaVclock(); if (j != null) window.__qaJitter = j; }, opt.jitter != null ? +opt.jitter : null);
      let cdp = null;
      if (opt.profile) { cdp = await page.context().newCDPSession(page); await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start'); r._markT = await page.evaluate(() => { const Q = window.__qa; return (function qaMarkFn() { const t = Q.realNow(); while (Q.realNow() - t < 15); return t; })(); }); }
      r._cdp = cdp;
      if (opt.alloc) { r._al = await page.context().newCDPSession(page); await r._al.send('HeapProfiler.enable'); await r._al.send('HeapProfiler.startSampling', { samplingInterval: 16384, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true }); }
      const chunk = +opt.chunk || 5, total = +opt.sec || S.sec, rn = opt.render === undefined ? 30 : +opt.render;
      let tl = Date.now();
      for (let t = 0; t < total; t += chunk) {
        const ok = await Promise.race([page.evaluate(([c, rn]) => window.__qaStep(c, { render: rn, renderContact: true }), [chunk, rn]), new Promise((res) => setTimeout(() => res('TIMEOUT(무한 루프 의심)'), 120000))]);
        const tc = Date.now();
        if (opt.gc && (t / chunk) % 6 === 5) { const c2 = r._gc || (r._gc = await page.context().newCDPSession(page)); await c2.send('HeapProfiler.collectGarbage'); }
        samples.push(await page.evaluate(() => window.__qaSample()).catch(() => null));
        if (opt.v) { const z = samples[samples.length - 1]; console.log(`  .. t=${z && z.t} ${z && z.screen}/${z && z.ph}/${z && z.cam} 객체${z && z.objs} 스킨${z && z.skin}/믹사모${z && z.mix} 실시간 ${((tc - tl) / 1000).toFixed(1)}s ${ok}`); } tl = Date.now();
        if (ok !== 'ok') { r.stop = ok; break; }
      }
    }
    if (r._cdp) {
      const { profile } = await r._cdp.send('Profiler.stop');
      const win = await page.evaluate(() => window.__qa.slowWin || []);
      { let t = profile.startTime; const ts = profile.timeDeltas.map((d) => (t += d)); const idx = profile.samples.findIndex((id) => profile.nodes.find((n) => n.id === id)?.callFrame.functionName === 'qaMarkFn'); profile.__base = idx >= 0 ? ts[idx] / 1000 - r._markT : 0; }
      r.prof = slowProfile(profile, win);
    }
    if (r._al) {
      const { profile } = await r._al.send('HeapProfiler.stopSampling');
      const m = new Map(), m2 = new Map(); let tot = 0;
      const walk = (n, stack) => { const f = n.callFrame, k = `${f.functionName || '(anon)'} ${(f.url || '').replace(/^.*\//, '')}:${f.lineNumber + 1}`; tot += n.selfSize; m.set(k, (m.get(k) || 0) + n.selfSize); const st = [...stack, k]; if (n.selfSize) { const g = st.filter((x) => /app\.js/.test(x)).slice(-2).join(' < '); m2.set(g, (m2.get(g) || 0) + n.selfSize); } for (const c of n.children) walk(c, st); };
      walk(profile.head, []);
      r.alloc = { totMB: +(tot / 1048576).toFixed(1), top: [...m].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, v]) => [k, +(v / 1048576).toFixed(2)]), game: [...m2].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, v]) => [k, +(v / 1048576).toFixed(2)]) };
    }
    delete r._cdp; delete r._gc; delete r._al;
    const q = await page.evaluate(() => { const Q = window.__qa; const f = Q.fstat; const cw = f.contactWin.slice().sort((a, b) => a - b); return { errors: Q.errors, raf: { n: Q.raf.n, err: Q.raf.err, slow: Q.raf.slow.slice(-10) }, frameErr: Q.frameErr || 0, count: Q.count, ball: Q.ballStats && Q.ballStats(), evc: Q.evc, f: { n: f.n, avg: +(f.sum / Math.max(1, f.n)).toFixed(2), max: +f.max.toFixed(1), tickMax: +f.tickMax.toFixed(1), renderMax: +f.renderMax.toFixed(0), renderN: f.renderN, hist: f.hist, top: f.top.slice(0, 10), contactP95: cw.length ? +cw[Math.floor(cw.length * 0.95)].toFixed(1) : null, contactMax: cw.length ? +cw[cw.length - 1].toFixed(1) : null } }; });
    Object.assign(r, q);
  } catch (e) { r.fatal = String(e.message || e).slice(0, 400); }
  r.console = [...new Set(cons)].slice(0, 40);
  r.samples = samples.filter(Boolean);
  r.secs = ((Date.now() - t0) / 1000).toFixed(0);
  report[name] = r;
  await page.close();
  const nerr = (r.errors || []).length + (r.fatal ? 1 : 0);
  if (nerr) bad++;
  console.log(`\n══ ${name} (${r.secs}s) — ${S.desc}`);
  if (r.fatal) console.log('  FATAL', r.fatal);
  if (r.anim) console.log('  anim:', r.anim.join(' / ').slice(0, 200));
  if (r.count) console.log('  봇:', JSON.stringify(r.count));
  if (r.f) console.log(`  프레임 ${r.f.n}개 평균 ${r.f.avg}ms 최대 ${r.f.max}ms (틱 최대 ${r.f.tickMax}) 렌더 ${r.f.renderN}회 최대 ${r.f.renderMax}ms 분포<4/8/16/33/100/+ ${r.f.hist.join('/')} 타격후1.5초 p95 ${r.f.contactP95} 최대 ${r.f.contactMax}`);
  if (r.f && r.f.top.length) console.log('  느린 프레임:', r.f.top.slice(0, 5).map((x) => `${x.ms}ms(${x.ph}/${x.cam}/타격후${x.sinceContact}s)`).join(' '));
  if (r.ball && r.ball.n) console.log(`  공(화면 vs 시뮬, 타구 비행 중 ${r.ball.n}프레임): 위치차 평균 ${r.ball.dAvg}m 최대 ${r.ball.dMax}m · 보이는속도/실제속도 p10 ${r.ball.speedRatio.p10} 중앙 ${r.ball.speedRatio.p50} p90 ${r.ball.speedRatio.p90} · 순간이동 ${r.ball.jumps}회\n     진행방향 뒤처짐: ${r.ball.lag.join(' / ')}`);
  if (r.raf) console.log(`  rAF ${r.raf.n}회 rAF예외 ${r.raf.err} frame예외 ${r.frameErr}${r.rafStalled ? '  ★ rAF 멈춤(화면 고정)' : ''}`);
  const sm = r.samples; if (opt.gc) console.log('  GC 후 힙(30초마다):', sm.filter((x, i) => i % 6 === 5).map((x) => x.heapMB).join(' ')); if (sm.length > 2) { const a = sm[1], z = sm[sm.length - 1]; console.log(`  누수 점검 t=${a.t}→${z.t}: 객체 ${a.objs}→${z.objs} 메시 ${a.meshes}→${z.meshes} geo ${a.geo}→${z.geo} tex ${a.tex}→${z.tex} 셰이더 ${a.prog}→${z.prog} 힙 ${a.heapMB}→${z.heapMB}MB 오디오노드 ${a.audio && a.audio.nodes}→${z.audio && z.audio.nodes} | 끝 상태 ${z.screen}/${z.ph} ${z.inn}회${z.half ? '말' : '초'} ${JSON.stringify(z.score)}`); if (z.texLeak) console.log(`  장면에서 빠졌는데 dispose 안 된 것: 텍스처 ${z.texLeak.n} ${JSON.stringify(z.texLeak.top)} / 지오메트리 ${z.geoLeak.n} ${JSON.stringify(z.geoLeak.top)}`); const nan = sm.flatMap((x) => x.nan || []); if (nan.length) console.log('  ✗ NaN 위치:', [...new Set(nan)].slice(0, 8).join(', ')); }
  if (r.prof) { console.log(`  프로파일: 느린 스텝 ${r.prof.n}개(합 ${r.prof.ms}ms, 샘플로 잡힌 ${r.prof.covered}ms 정렬 ${r.prof.aligned} / 전체 샘플 ${r.prof.samples}개 ${r.prof.durMs}ms) — 자기 시간 상위`); for (const x of r.prof.self) console.log(`     ${x[1].toFixed(0).padStart(6)}ms  ${x[0]}`); console.log('    포함 시간 상위(게임 코드)'); for (const x of r.prof.total) console.log(`     ${x[1].toFixed(0).padStart(6)}ms  ${x[0]}`); }
  if (r.alloc) { console.log(`  할당 샘플(살아있는 것만 아님 — 샘플링 시점에 살아있던 것) 총 ${r.alloc.totMB}MB`); for (const x of r.alloc.top) console.log(`     ${String(x[1]).padStart(7)}MB  ${x[0]}`); console.log('    게임 코드 호출 위치'); for (const x of r.alloc.game) console.log(`     ${String(x[1]).padStart(7)}MB  ${x[0]}`); }
  for (const e of r.errors || []) console.log(`  ✗ [${e.src}] ×${e.n}\n     ${e.msg.replace(/\n/g, '\n     ')}`);
  const cs = r.console.filter((c) => !/\[anim\]/.test(c));
  if (cs.length) console.log('  콘솔:', cs.slice(0, 12).join('\n        '));
}
async function runMulti(name, S) {
  const t0 = Date.now(), r = { name, desc: S.desc, pages: [] }; const e0 = RM.errors.length;
  const pages = [];
  for (let i = 0; i < S.multi; i++) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const cons = []; page.on('pageerror', (e) => cons.push('[pageerror] ' + (e.stack || e.message).split('\n').slice(0, 4).join(' | ')));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) cons.push('[error] ' + m.text().slice(0, 300)); });
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (x) => x.fulfill({ status: 200, body: '' }));
    await page.addInitScript({ content: inject + `;window.__qa.seed(${(+opt.seed || 7) + i});window.__noRender=1;` }); // 멀티는 렌더 끔 (SwiftShader 3개는 너무 느림)
    await page.goto(`http://127.0.0.1:${port}/${S.q || ''}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForFunction(() => document.getElementById('bPlay') && window.__qa, null, { timeout: 90000, polling: 500 }).catch(async (e) => { console.log('로딩 실패', i, cons, await page.evaluate(() => [document.readyState, !!window.__qa, !!document.getElementById('bPlay'), location.href]).catch((x) => x.message)); throw e; });
    pages.push({ page, cons });
  }
  await new Promise((ok) => setTimeout(ok, 5000));
  let code = null;
  for (let i = 0; i < pages.length; i++) {
    const { page } = pages[i];
    code = await page.evaluate(async ([i, S, code]) => {
      const $ = (id) => document.getElementById(id); const W = (ms) => new Promise((ok) => setTimeout(ok, ms));
      window.__noRender = 1; window.__fastCam = 1;
      $('nick').value = 'QA' + i; $('bPlay').click(); await W(200);
      document.querySelector(`#modes [data-rules="${S.rules}"]`).click(); await W(200);
      if (i === 0) { $('bCreate').click(); await W(200); const inn = document.querySelector('#cInn'); if (inn) inn.value = '2'; $('cGo').click(); await W(1500); return (location.search.match(/room=(\w+)/) || [])[1] || document.body.innerText.match(/\bQA[A-Z]M\b/)?.[0] || null; }
      $('code').value = code; $('bJoin').click(); await W(1500); return code;
    }, [i, S, code]);
    if (i === 0) r.code = code;
  }
  await new Promise((ok) => setTimeout(ok, 1500));
  // 두 팀으로 나눔 (홀수 번째는 홈)
  for (let i = 1; i < pages.length; i += 2) await pages[i].page.evaluate(() => window.__hr && window.__hr.net() && window.__hr.net().send({ t: 'team', team: 'home' }));
  await new Promise((ok) => setTimeout(ok, 800));
  await pages[0].page.evaluate(() => { const b = document.getElementById('bStart'); b && b.click(); });
  for (const { page } of pages) await page.evaluate(() => { const Q = window.__qa; window.__qaBotIv = setInterval(() => { try { window.__qaBotStep(); } catch (e) { Q.rec('bot', e); } }, 16); });
  const end = Date.now() + (+opt.sec || S.sec) * 1000;
  const smp = [];
  while (Date.now() < end) { await new Promise((ok) => setTimeout(ok, 5000)); smp.push(await Promise.all(pages.map(({ page }) => page.evaluate(() => ({ s: window.__qaSample(), raf: window.__qa.raf.n, c: window.__qa.count })).catch((e) => ({ err: e.message }))))); if (opt.v) console.log('  ..', smp[smp.length - 1].map((x) => x.s ? `${x.s.screen}/${x.s.ph}/${x.s.cam} ${x.s.inn}회 rAF${x.raf} 스윙${x.c.swings} 투구${x.c.pitches}` : x.err).join(' | ')); }
  for (const { page, cons } of pages) { const q = await page.evaluate(() => ({ errors: window.__qa.errors, raf: window.__qa.raf, count: window.__qa.count })); r.pages.push({ ...q, raf: { n: q.raf.n, err: q.raf.err }, console: [...new Set(cons)].slice(0, 20), last: smp.length ? smp[smp.length - 1][r.pages.length].s : null }); await page.close(); }
  r.serverErrors = RM.errors.slice(e0);
  for (const rm of RM.rooms.values()) { clearInterval(rm.timer); rm.timer = null; }
  r.bad = r.serverErrors.length + r.pages.reduce((a, p) => a + p.errors.length, 0);
  console.log(`\n══ ${name} (${((Date.now() - t0) / 1000).toFixed(0)}s) — ${S.desc}  방 ${r.code}`);
  r.pages.forEach((p, i) => { console.log(`  [${i}] 봇 ${JSON.stringify(p.count)} rAF ${p.raf.n} 끝 ${p.last && `${p.last.screen}/${p.last.ph} ${p.last.inn}회 ${JSON.stringify(p.last.score)}`}`); for (const e of p.errors) console.log(`  ✗ [${i}][${e.src}] ×${e.n}\n     ${e.msg.replace(/\n/g, '\n     ')}`); });
  for (const e of r.serverErrors.slice(0, 10)) console.log('  ✗ [서버]', e);
  return r;
}
await browser.close(); srv.close(); RM && RM.stop();
// CDP CPU 프로파일에서 느린 스텝 구간(진짜 시계, performance.now 기준)만 모아 함수별 시간
function slowProfile(p, win) {
  const byId = new Map(p.nodes.map((n) => [n.id, n])), parent = new Map();
  for (const n of p.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const nm = (n) => { const f = n.callFrame; return `${f.functionName || '(anon)'} ${(f.url || '').replace(/^.*\//, '')}:${f.lineNumber + 1}`; };
  // 프로파일 시각(μs, 단조 시계) ↔ performance.now(ms): 창 끝 기준 맞춤
  const self = new Map(), total = new Map(); let n = 0, ms = 0;
  let t = p.startTime; const ts = p.timeDeltas.map((d) => (t += d));
  const t0 = p.startTime / 1000, off = win.length ? null : 0;
  // performance.now 의 기준점은 timeOrigin → CDP 시각과 다름. 프로파일 시작 이후 첫 창을 기준으로 맞추기 어렵기 때문에 run 은 Q.profT0 을 씀
  const base = p.__base ?? 0;
  for (const w of win) { n++; ms += w[1] - w[0]; }
  // 느린 스텝 직후 qaSlowMark 가 2ms 돈다 → 그 샘플 묶음 시작 시각이 스텝 끝. 창 = [끝 - 스텝 길이, 끝]
  const marks = []; let prevMark = false;
  for (let i = 0; i < p.samples.length; i++) { const isM = byId.get(p.samples[i]).callFrame.functionName === 'qaSlowMark'; if (isM && !prevMark) marks.push(ts[i] / 1000); prevMark = isM; }
  const wins = marks.length === win.length ? marks.map((m, k) => [m - (win[k][1] - win[k][0]) - 1, m]) : null;
  for (let i = 0; i < p.samples.length; i++) {
    const tm = wins ? ts[i] / 1000 : ts[i] / 1000 - base;
    if (!(wins || win).some((w) => tm >= w[0] && tm <= w[1])) continue;
    const dt = (p.timeDeltas[i + 1] || 0) / 1000;
    let node = byId.get(p.samples[i]);
    self.set(nm(node), (self.get(nm(node)) || 0) + dt);
    const seen = new Set();
    for (let id = node.id; id; id = parent.get(id)) { const k = nm(byId.get(id)); if (seen.has(k)) continue; seen.add(k); if (/app\.js|three/.test(k)) total.set(k, (total.get(k) || 0) + dt); }
  }
  void t0; void off;
  const top = (m, k) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k);
  let hit = 0; for (const [, v] of self) hit += v;
  return { n, ms: Math.round(ms), covered: Math.round(hit), aligned: wins ? 'mark' : `base(${marks.length}/${win.length})`, samples: p.samples.length, durMs: Math.round((p.endTime - p.startTime) / 1000), self: top(self, 15), total: top(total, 25) };
}
writeFileSync(opt.json || join(root, 'tools/qa/.out/last.json'), JSON.stringify(report, null, 1)); // 항상 남김 (간헐 오류 추적)
process.exit(bad ? 1 : 0);
