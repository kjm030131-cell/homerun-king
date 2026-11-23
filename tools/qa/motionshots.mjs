// [motion] 상황별 모션 스크린샷 — CPU 경기를 가상 시계로 돌리며 이벤트(타석 입장·스윙·삼진·심판 콜·다이빙·슬라이딩·경기 끝 …)가
//   나올 때마다 그 장면을 근접 카메라로 찍는다 → tools/qa/.out/motion-*.png
//   node tools/qa/motionshots.mjs [--inn=3] [--max=1800(게임초)] [--seed=11] [--only=enter,swing]
// 판정·시뮬은 건드리지 않음(봇 끔, 수비는 자동). 이벤트는 game.ev 를 감싸서 받음.
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { bundle, serve, root, outDir } from './serve.mjs';

const argv = process.argv.slice(2);
const opt = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const req = (m) => { for (const b of [root, '/opt/npm-tools']) { try { return createRequire(b + '/')(m); } catch { } } throw new Error(m + ' 없음'); };
const { chromium } = req('playwright-core');
const chrome = [process.env.CHROME, '/usr/bin/google-chrome', '/opt/pw-browsers/chromium/chrome-linux64/chrome'].find((p) => p && existsSync(p));
mkdirSync(outDir, { recursive: true });

await bundle();
const { srv, port } = await serve({ api: async () => null });
const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const inject = readFileSync(join(root, 'tools/qa/inject.js'), 'utf8') + '\n' + readFileSync(join(root, 'tools/qa/driver.js'), 'utf8');
const errors = [], files = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => errors.push('[pageerror] ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')));
page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !/GL Driver|Failed to load resource/.test(t)) errors.push('[console] ' + t.slice(0, 200)); if (/\[anim\]/.test(t)) console.log('  ', t.slice(0, 160)); });
await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, body: '' }));
await page.addInitScript({ content: inject + `;window.__qa.seed(${+(opt.seed || 11)});` });
let ready = null; const isNew = new Promise((ok) => { ready = ok; });
page.on('console', (m) => { if (/새 캐릭터 사용|옛 몸 유지/.test(m.text())) ready(); });
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction(() => document.getElementById('bPlay'), null, { timeout: 30000, polling: 500 });
await Promise.race([isNew, new Promise((ok) => setTimeout(ok, 90000))]);
await page.waitForTimeout(6000); // 뒤에서 받는 변주 클립(mill·swing2·pitch2 …)까지
await page.evaluate((inn) => {
  const $ = (id) => document.getElementById(id);
  const seg = (id, v) => { const b = document.querySelector(`#${id} [data-v="${v}"]`); if (b) b.click(); };
  $('nick').value = 'QA'; $('bPlay').click();
  document.querySelector('#modes [data-rules="real"]').click();
  $('bSolo').click();
  seg('oRules', 'real'); seg('oMode', 'game'); seg('oInn', inn); seg('oTeam', 'home'); $('oPos').value = 'SS';
  $('oGo').click();
}, String(opt.inn || 3));
await page.waitForTimeout(1200);
await page.evaluate(() => {
  window.__qaVclock(); window.__qaJitter = 0; window.__qa.bot.on = false; window.__fastCam = 1;
  const H = window.__hr, g = H.game, o = g.ev.bind(g);
  window.__mev = [];
  g.ev = (e, d) => { window.__mev.push({ e, d: { ...d }, t: H.simNow() }); return o(e, d); };
});

const only = opt.only ? String(opt.only).split(',') : null;
const want = (n) => !only || only.some((o) => n.startsWith(o));
// 페이지 안: 가상 시계를 돌리며 트리거 → 찍을 장면(이름·카메라)을 돌려줌
const STEP = String(function step(arg) {
  const { maxT, done } = arg;
  const H = window.__hr, B = [[0, 0], [-19.4, 19.4], [0, 38.8], [19.4, 19.4]];
  const W = (window.__mw = window.__mw || { q: [], seen: {}, swings: {}, n: 0 });
  const has = (n) => done.includes(n) || W.q.some((x) => x.name === n);
  const anims = () => { const out = []; H.scene.traverse((o) => { if (o.name === 'char' && o.userData.anim) { let v = true; for (let p = o; p; p = p.parent) if (!p.visible) v = false; if (v) out.push(o); } }); return out; };
  const cur = (o) => { const C = o.userData.anim.c; const L = C.current(); return L ? L.e.name : ''; };
  const curT = (o) => { const C = o.userData.anim.c; const L = C.current(); return L ? L.e.name + '@' + L.action.time.toFixed(2) : ''; };
  const near = (x, z, d = 1.2) => anims().find((o) => Math.hypot(o.position.x - x, o.position.z - z) < d);
  const sched = (name, at, cam, why) => { if (!has(name)) W.q.push({ name, at, cam, why }); };
  const batCam = { pos: [-1.8, 1.35, 3.6], look: [1.1, 0.95, 0.1], fov: 42 };
  for (let k = 0; k < maxT / 0.05; k++) {
    window.__qaStep(0.05, { render: 0 });
    const t = H.simNow(), s = H.S();
    if (H.cam() === 'intro' && W.seen.introT == null) W.seen.introT = t;
    // 이벤트 → 예약
    while (window.__mev.length) {
      const { e, d } = window.__mev.shift();
      if (e === 'batterUp') { W.bu = t; W.n++; if (W.n >= 2) { sched('motion-enter-a', t + 0.9, { pos: [-1.2, 1.4, 4.2], look: [1.6, 0.9, 0], fov: 42 }, 'Walk_In/Step_In 시작'); sched('motion-enter-b', t + 2.2, { pos: [-1.2, 1.4, 4.2], look: [1.3, 0.9, 0], fov: 42 }, '입장 중간'); } }
      if (e === 'windup' && W.bu && t - W.bu > 3.2 && W.n >= 2) sched('motion-stance', t + 0.05, batCam, '타석 대기');
      if (e === 'windup') { const r = (d.on || []).some((x) => x); sched(r ? 'motion-pitch-stretch-peak' : 'motion-pitch-peak', t + 1.32, { pos: [6.5, 1.1, 18.2], look: [0, 1.1, 18.2], fov: 35 }, '레그킥 정점 멈춤'); sched(r ? 'motion-pitch-stretch-release' : 'motion-pitch-release', t + 1.85, { pos: [6.5, 1.1, 18.0], look: [0, 1.2, 17.6], fov: 35 }, '릴리스 = 와인드업 + 1.85초'); }
      if (e === 'release') sched('motion-catcher', t + d.T - 0.03, { pos: [-2.6, 0.8, -0.9], look: [0, 0.6, -0.8], fov: 40 }, '포수 받기');
      if (e === 'strikeCall') { sched(d.k ? 'motion-ump-k' : 'motion-ump-strike', t + (d.k ? 0.8 : 0.55), { pos: [3.2, 1.3, -3.4], look: [0, 1.0, -1.4], fov: 40 }, d.k ? '삼진 콜' : '스트라이크 콜'); }
      if (e === 'out' && d.kind === 'k') { sched(d.looking ? 'motion-k-looking-react' : 'motion-k-swing-react', t + 0.7, batCam, '삼진 반응'); sched('motion-k-walkout', t + 1.8, { pos: [-1.0, 1.4, 4.6], look: [1.6, 0.9, 0], fov: 42 }, 'Walk_Out'); sched('motion-k-walkout2', t + 2.4, { pos: [-1.0, 1.4, 4.6], look: [1.8, 0.9, 0], fov: 42 }, 'Walk_Out 뒤'); sched('motion-pitcher-pump', t + 1.0, { pos: [-4.5, 1.2, 15.5], look: [0, 1.2, 18.0], fov: 38 }, '삼진 잡은 투수'); }
      if (e === 'dive') { const f = s.fl[d.i]; if (f) sched('motion-dive', t + 0.32, { pos: [f[1] + 3.2, 1.3, f[2] - 3.2], look: [f[1], 0.5, f[2]], fov: 45, follow: d.i }, '다이빙 ' + d.pos); }
      if (e === 'slide') { const b = B[d.base % 4]; sched('motion-slide', t + 0.3, { pos: [b[0] + 3.5, 1.1, b[1] - 3.2], look: [b[0], 0.4, b[1]], fov: 45 }, '슬라이딩 ' + d.base + '루'); }
      // [motion2] 세이프 콜(접전) · 높은 공 · 땅볼 포구 · 이닝 교대 뛰기
      if (e === 'safe' && d.close) { const U = [[0, -2.35], [-22.5, 27], [22.5, 27]].sort((a, c) => Math.hypot(a[0] - d.x, a[1] - d.z) - Math.hypot(c[0] - d.x, c[1] - d.z))[0]; const hx = -U[0], hz = -U[1], hl = Math.hypot(hx, hz) || 1; sched('next-safe-call', t + 0.5, { pos: [U[0] + hx / hl * 4.2, 1.5, U[1] + hz / hl * 4.2 + (U[0] === 0 ? 4 : 0)], look: [U[0], 1.25, U[1]], fov: 45 }, '세이프 콜 ' + d.k + '루'); }
      if (e === 'catch' && !d.pitch && d.fly && d.y > 1.7 && !d.dive && !d.jump) { const f = s.fl[d.i]; if (f) sched('next-catch-high', t + 0.0, { pos: [f[1] - f[1] / Math.hypot(f[1], f[2]) * 4, 1.6, f[2] - f[2] / Math.hypot(f[1], f[2]) * 4], look: [f[1], 1.5, f[2]], fov: 45, follow2: d.i }, '높은 공 포구 ' + d.pos); }
      if (e === 'catch' && !d.pitch && !d.fly && d.y < 0.6 && !d.dive) { const f = s.fl[d.i]; if (f) sched('next-catch-low', t + 0.0, { pos: [f[1] - f[1] / Math.hypot(f[1], f[2]) * 4 + 1.5, 1.2, f[2] - f[2] / Math.hypot(f[1], f[2]) * 4], look: [f[1], 0.6, f[2]], fov: 45 }, '땅볼 포구 ' + d.pos); }
      if (e === 'inningStart' && d.inning >= 1 && (d.inning > 1 || d.half === 1)) { sched('next-inning-swap-a', t + 0.9, { pos: [0, 16, -20], look: [0, 0, 24], fov: 58 }, '이닝 교대: 나가는 수비·들어오는 수비'); sched('next-inning-swap-b', t + 2.4, { pos: [0, 16, -20], look: [0, 0, 24], fov: 58 }, '이닝 교대 1.5초 뒤'); }
      if (e === 'hr' && !d.derby) { sched('next-hr-trot', t + 8.4, { game: 1 }, '[trot] 리플레이 끝/건너뛴 뒤 게임 카메라: 3루→홈 트롯'); sched('next-hr-greet', t + 10.0, { pos: [-1.2, 1.5, 3.4], look: [-3.0, 1.2, -0.5], fov: 42 }, '[trot] 홈 옆 하이파이브'); sched('next-hr-greet2', t + 10.5, { pos: [-1.2, 1.5, 3.4], look: [-3.0, 1.2, -0.5], fov: 42 }, '[trot] 하이파이브 뒤'); }
      if (e === 'hr') sched('motion-hr-pitcher', t + 1.6, { pos: [-4.5, 1.2, 15.5], look: [0, 1.0, 18.2], fov: 38 }, '홈런 맞은 투수');
      if (e === 'catch' && !d.pitch && d.pos === 'C' && d.fly) sched('motion-catcher-pop', t + 0.4, { pos: [-2.6, 1.0, 2.0], look: [d.x, 1.0, d.z], fov: 45 }, '포수 뜬공');
      if (e === 'throw' && d.pos === 'C') sched('motion-catcher-throw', t + (d.pick ? 0.3 : 0.32), { pos: [-3.0, 1.0, 1.5], look: [d.from[0], 0.9, d.from[1]], fov: 40 }, '포수 송구');
      if (e === 'gameEnd') { sched('motion-gameend-wide', t + 2.6, { pos: [0, 7, -12], look: [0, 1, 22], fov: 45 }, '경기 끝: 이긴 팀 Victory · 진 팀 Defeated'); sched('motion-gameend-close', t + 3.4, { pos: [-4.5, 1.5, 14.0], look: [0, 1.0, 18.4], fov: 40 }, '경기 끝 근접(투수)'); sched('motion-gameend-close2', t + 4.0, { pos: [-14, 2.2, 20], look: [-19.4, 1.0, 21], fov: 40 }, '경기 끝 근접(1루)'); }
    }
    // 스윙: 컨택 순간(swingAt) — 클립별로 한 장씩
    if (s.p && s.p.swingAt && t >= s.p.swingAt && t - s.p.swingAt < 0.06 && !W.swings[s.p.id]) {
      W.swings[s.p.id] = 1;
      const b = near(0.95, 0.05); const nm = b ? cur(b) : '?';
      if (s.ph === 'live') sched('motion-swing-follow', t + 0.22, { pos: [0.9, 1.3, 4.6], look: [0.6, 1.0, 0.0], fov: 40 }, '타격 후 팔로스루(주자로 바뀌기 전)');
      if (nm && !has('motion-swing-' + nm)) return { name: 'motion-swing-' + nm, cam: { pos: [0.9, 1.3, 4.6], look: [0.6, 1.0, 0.0], fov: 40 }, why: '스윙 컨택 프레임 = sim 스윙 시각', t, clip: nm };
    }
    // 서성임(mill)
    if (s.ph === 'pitch' && !has('motion-mill')) { const m = anims().find((o) => cur(o) === 'mill' && Math.hypot(o.position.x, o.position.z) > 8); if (m) sched('motion-mill', t + 1.2, { pos: [m.position.x + 3, 1.3, m.position.z - 3.2], look: [m.position.x, 0.9, m.position.z], fov: 40 }, '투구 사이 서성임'); }
    // 예약된 장면
    const i = W.q.findIndex((x) => t >= x.at);
    if (i >= 0) {
      const x = W.q.splice(i, 1)[0];
      if (x.cam.follow != null) { const f = s.fl[x.cam.follow]; if (f) { x.cam.look = [f[1], 0.45, f[2]]; x.cam.pos = [f[1] + 3.2, 1.3, f[2] - 3.2]; } }
      const clips = anims().filter((o) => { const c = x.cam.look || [-1, 0, 0]; return Math.hypot(o.position.x - c[0], o.position.z - c[2]) < 3; }).map((o) => curT(o));
      return { name: x.name, cam: x.cam, why: x.why, t, clip: clips.join(',') };
    }
    if (s.ph === 'over' && !W.q.length) return { end: 1, t };
  }
  return { end: 1, t: H.simNow() };
});
const done = [];
const max = +(opt.max || 1800);
let simT = 0;
while (simT < max) {
  const r = await page.evaluate(([src, a]) => (0, eval)('(' + src + ')')(a), [STEP, { maxT: 120, done }]);
  simT = r.t || simT + 120;
  if (r.end && r.t != null && (await page.evaluate(() => window.__hr.S().ph)) === 'over' && !(await page.evaluate(() => window.__mw.q.length))) { console.log('[motion] 경기 끝', r.t.toFixed(1)); break; }
  if (!r.name) continue;
  done.push(r.name);
  if (!want(r.name)) continue;
  await page.evaluate((cam) => {
    const c = document.getElementById('c'); for (const el of document.body.querySelectorAll('*')) if (el !== c && !el.contains(c) && el.style) el.style.visibility = 'hidden';
    if (c) c.style.visibility = 'visible';
    if (cam.game) { window.__hr.rp.stop(); window.__cam = null; window.__fastCam = 0; for (let i = 0; i < 20; i++) window.__qaStep(1 / 60, { render: 0 }); window.__fastCam = 1; } else window.__cam = cam; // [trot] game: 게임 카메라 그대로(리플레이 건너뛰기)
    window.__qaStep(1 / 60, { render: 0 }); window.__noRender = 0; window.__frame(window.__V); window.__noRender = 1;
  }, r.cam);
  const f = join(outDir, r.name + '.png');
  await page.screenshot({ path: f }); files.push(f);
  await page.evaluate(() => { window.__cam = null; for (const el of document.body.querySelectorAll('*')) if (el.style) el.style.visibility = ''; });
  console.log(`[motion] ${r.name.padEnd(30)} t=${r.t.toFixed(2)} 클립=${r.clip || ''}  (${r.why})`);
}
const qa = await page.evaluate(() => ({ errors: window.__qa.errors.map((e) => e.src + ': ' + e.msg.split('\n')[0]), evc: window.__qa.evc }));
await browser.close(); srv.close();
console.log('[motion] 찍음', files.length, '장');
console.log('[motion] 못 찍은 것:', ['motion-enter-a', 'motion-stance', 'motion-pitch-peak', 'motion-pitch-release', 'motion-pitch-stretch-release', 'motion-catcher', 'motion-ump-strike', 'motion-ump-k', 'motion-k-swing-react', 'motion-k-looking-react', 'motion-k-walkout', 'motion-pitcher-pump', 'motion-dive', 'motion-slide', 'motion-hr-pitcher', 'motion-catcher-throw', 'motion-mill', 'motion-gameend-wide'].filter((n) => !done.includes(n)).join(' '));
console.log('[motion] 예외', errors.length + qa.errors.length, [...errors, ...qa.errors].slice(0, 10).join('\n'));
process.exit(errors.length + qa.errors.length ? 1 : 0);
