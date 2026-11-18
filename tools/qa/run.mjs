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
  realtime: { rules: 'real', mode: 'practice', realtime: 25, desc: '가상 시계 없이 실제 rAF 루프 + 렌더 (화면 고정 확인)' },
};
if (opt.list) { for (const [k, v] of Object.entries(SCENARIOS)) console.log(k.padEnd(16), v.desc); process.exit(0); }
const pick = names.length ? names : Object.keys(SCENARIOS);

const req = (m) => { for (const b of [root, '/opt/npm-tools']) { try { return createRequire(b + '/')(m); } catch { } } throw new Error(m + ' 없음'); };
const { chromium } = req('playwright-core');
const chrome = [process.env.CHROME, '/usr/bin/google-chrome', '/opt/pw-browsers/chromium/chrome-linux64/chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && existsSync(p));

const b = await bundle();
console.log(`[qa] 번들 ${b.tool} ${b.ms}ms`);
const { srv, port } = await serve();
const browser = await chromium.launch({ executablePath: chrome, headless: !opt.headed, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--autoplay-policy=no-user-gesture-required'] });
const inject = readFileSync(join(root, 'tools/qa/inject.js'), 'utf8') + '\n' + readFileSync(join(root, 'tools/qa/driver.js'), 'utf8');
const report = {};
let bad = 0;

for (const name of pick) {
  const S = SCENARIOS[name]; if (!S) { console.log('없는 시나리오', name); continue; }
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
  await page.waitForFunction(() => document.getElementById('bPlay'), null, { timeout: 30000 });
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
      await page.evaluate(() => window.__qaVclock());
      const chunk = +opt.chunk || 5, total = +opt.sec || S.sec, rn = opt.render === undefined ? 30 : +opt.render;
      let tl = Date.now();
      for (let t = 0; t < total; t += chunk) {
        const ok = await Promise.race([page.evaluate(([c, rn]) => window.__qaStep(c, { render: rn, renderContact: true }), [chunk, rn]), new Promise((res) => setTimeout(() => res('TIMEOUT(무한 루프 의심)'), 120000))]);
        const tc = Date.now();
        samples.push(await page.evaluate(() => window.__qaSample()).catch(() => null));
        if (opt.v) { const z = samples[samples.length - 1]; console.log(`  .. t=${z && z.t} ${z && z.screen}/${z && z.ph}/${z && z.cam} 객체${z && z.objs} 스킨${z && z.skin}/믹사모${z && z.mix} 실시간 ${((tc - tl) / 1000).toFixed(1)}s ${ok}`); } tl = Date.now();
        if (ok !== 'ok') { r.stop = ok; break; }
      }
    }
    const q = await page.evaluate(() => { const Q = window.__qa; const f = Q.fstat; const cw = f.contactWin.slice().sort((a, b) => a - b); return { errors: Q.errors, raf: { n: Q.raf.n, err: Q.raf.err, slow: Q.raf.slow.slice(-10) }, frameErr: Q.frameErr || 0, count: Q.count, evc: Q.evc, f: { n: f.n, avg: +(f.sum / Math.max(1, f.n)).toFixed(2), max: +f.max.toFixed(1), tickMax: +f.tickMax.toFixed(1), renderMax: +f.renderMax.toFixed(0), renderN: f.renderN, hist: f.hist, top: f.top.slice(0, 10), contactP95: cw.length ? +cw[Math.floor(cw.length * 0.95)].toFixed(1) : null, contactMax: cw.length ? +cw[cw.length - 1].toFixed(1) : null } }; });
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
  if (r.raf) console.log(`  rAF ${r.raf.n}회 rAF예외 ${r.raf.err} frame예외 ${r.frameErr}${r.rafStalled ? '  ★ rAF 멈춤(화면 고정)' : ''}`);
  const sm = r.samples; if (sm.length > 2) { const a = sm[1], z = sm[sm.length - 1]; console.log(`  누수 점검 t=${a.t}→${z.t}: 객체 ${a.objs}→${z.objs} 메시 ${a.meshes}→${z.meshes} geo ${a.geo}→${z.geo} tex ${a.tex}→${z.tex} 셰이더 ${a.prog}→${z.prog} 힙 ${a.heapMB}→${z.heapMB}MB 오디오노드 ${a.audio && a.audio.nodes}→${z.audio && z.audio.nodes} | 끝 상태 ${z.screen}/${z.ph} ${z.inn}회${z.half ? '말' : '초'} ${JSON.stringify(z.score)}`); const nan = sm.flatMap((x) => x.nan || []); if (nan.length) console.log('  ✗ NaN 위치:', [...new Set(nan)].slice(0, 8).join(', ')); }
  for (const e of r.errors || []) console.log(`  ✗ [${e.src}] ×${e.n}\n     ${e.msg.replace(/\n/g, '\n     ')}`);
  const cs = r.console.filter((c) => !/\[anim\]/.test(c));
  if (cs.length) console.log('  콘솔:', cs.slice(0, 12).join('\n        '));
}
await browser.close(); srv.close();
if (opt.json) writeFileSync(opt.json, JSON.stringify(report, null, 1));
process.exit(bad ? 1 : 0);
