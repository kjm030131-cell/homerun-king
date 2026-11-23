// [cam] 역할별 '기본 카메라' 스크린샷 + 타구 화면 공 속도 측정
//   node tools/qa/camshots.mjs --tag=before        → tools/qa/.out/cam-before-*.png
//   node tools/qa/camshots.mjs --tag=after --only=bat,pitch,field,run,speed
// shots.mjs 와 같은 번들·서버·계측. 차이: window.__cam 을 쓰지 않고 게임이 고른 카메라 그대로 찍는다(봇이 경기를 굴려 상황을 만듦).
// 주자·관전 시점은 혼자하기에선 안 나오므로 window.__camRole 로 역할만 바꿔서 찍는다(카메라 코드만 영향).
// 공 속도: 맞은 뒤 0~0.3 / 0.3~0.8 / 0.8~2.4초 동안 '실제 카메라 화면에서 공이 움직인 픽셀' ÷ '맞는 순간 카메라를 그대로 얼렸을 때 픽셀'
//   (docs/rebuild/gameplay.md 5-A 의 측정과 같은 정의: 고정 카메라 대비 화면상 공 속도. 1.0 = 카메라가 공 움직임을 하나도 안 깎음)
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { bundle, serve, root, outDir } from './serve.mjs';

const argv = process.argv.slice(2);
const opt = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const only = opt.only ? String(opt.only).split(',') : null;
const want = (k) => !only || only.includes(k);
const req = (m) => { for (const b of [root, '/opt/npm-tools']) { try { return createRequire(b + '/')(m); } catch { } } throw new Error(m + ' 없음'); };
const { chromium } = req('playwright-core');
const chrome = [process.env.CHROME, '/usr/bin/google-chrome', '/opt/pw-browsers/chromium/chrome-linux64/chrome'].find((p) => p && existsSync(p));
mkdirSync(outDir, { recursive: true });
const tag = opt.tag || 'x';
const W = +(opt.w || 1280), Hh = +(opt.h || 800); // 맥북 에어 크롬 창 비율 근처

await bundle();
const { srv, port } = await serve({ api: async () => null });
const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const inject = readFileSync(join(root, 'tools/qa/inject.js'), 'utf8') + '\n' + readFileSync(join(root, 'tools/qa/driver.js'), 'utf8');
const errors = [], files = [], report = {};

async function open(seed = 11) {
  const page = await browser.newPage({ viewport: { width: W, height: Hh } });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')));
  page.on('console', (m) => { if (m.type() === 'error' && !/GL Driver|Failed to load resource/.test(m.text())) errors.push('[console] ' + m.text().slice(0, 200)); });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, body: '' }));
  await page.addInitScript({ content: inject + `;window.__qa.seed(${seed});` });
  let ready = null; const isNew = new Promise((ok) => { ready = ok; });
  page.on('console', (m) => { if (/새 캐릭터 사용|옛 몸 유지/.test(m.text())) ready(); });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => document.getElementById('bPlay'), null, { timeout: 30000, polling: 500 });
  await Promise.race([isNew, new Promise((ok) => setTimeout(ok, 90000))]);
  await page.waitForTimeout(1500);
  return page;
}
async function start(page, S) {
  await page.evaluate((S) => {
    const $ = (id) => document.getElementById(id);
    const seg = (id, v) => { const b = document.querySelector(`#${id} [data-v="${v}"]`); if (b) b.click(); };
    try { localStorage.removeItem('hr_batCam'); localStorage.removeItem('hr_fieldCam'); } catch { }
    $('nick').value = 'QA'; $('bPlay').click();
    document.querySelector(`#modes [data-rules="${S.rules}"]`).click();
    $('bSolo').click();
    seg('oRules', S.rules); seg('oMode', S.mode); if (S.inn) seg('oInn', S.inn); if (S.team) seg('oTeam', S.team);
    if (S.pos) $('oPos').value = S.pos;
    $('oGo').click();
  }, S);
  await page.waitForTimeout(1200);
  // fastCam 은 끔: 실제 감쇠(블렌드) 그대로 찍는다
  await page.evaluate(() => { window.__qaVclock(); window.__qaJitter = 0; window.__qa.bot.on = false; });
}
// 조건까지 진행. bot=true 면 봇이 투구·타격·수비를 함
async function until(page, src, maxSec = 60, bot = false, step = 1 / 30) {
  return page.evaluate(([src, maxSec, bot, step]) => {
    const f = new Function('H', 's', 'return (' + src + ')');
    const H = window.__hr; window.__qa.bot.on = bot;
    let t = 0;
    for (; t < maxSec; t += step) {
      const s = H.S();
      if (s && f(H, s)) break;
      if (H.cam() === 'intro') dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      if (H.rp && H.rp.active) dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      window.__qaStep(step, { render: 0 });
    }
    window.__qa.bot.on = false;
    return t >= maxSec ? -1 : +t.toFixed(2);
  }, [src, maxSec, bot, step]);
}
const stepS = (page, sec) => page.evaluate((sec) => window.__qaStep(sec, { render: 0 }), sec);
async function shot(page, name, hud = false) {
  const info = await page.evaluate((hud) => {
    const c = document.getElementById('c');
    if (!hud) { for (const el of document.body.querySelectorAll('*')) if (el !== c && !el.contains(c) && el.style) el.style.visibility = 'hidden'; if (c) c.style.visibility = 'visible'; }
    window.__noRender = 0; window.__frame(window.__V); window.__noRender = 1;
    const H = window.__hr, C = H.camera;
    return { cam: H.cam(), pos: C.position.toArray().map((x) => +x.toFixed(2)), fov: +C.fov.toFixed(1) };
  }, hud);
  const f = join(outDir, `cam-${tag}-${name}.png`);
  await page.screenshot({ path: f });
  files.push(f); report[name] = info;
  console.log(`[cam] ${name}: ${info.cam} pos=${info.pos} fov=${info.fov}`);
  await page.evaluate(() => { for (const el of document.body.querySelectorAll('*')) if (el.style) el.style.visibility = ''; });
}
const key = (page, k) => page.evaluate((k) => { dispatchEvent(new KeyboardEvent('keydown', { key: k, code: /^[a-z]$/.test(k) ? 'Key' + k.toUpperCase() : '', bubbles: true })); dispatchEvent(new KeyboardEvent('keyup', { key: k, code: /^[a-z]$/.test(k) ? 'Key' + k.toUpperCase() : '', bubbles: true })); }, k);
const role = (page, src) => page.evaluate((src) => { window.__camRole = src ? new Function('r', src) : null; }, src);

// ── 1) 타자: 타격 연습 ──
if (want('bat')) {
  const page = await open(11);
  await start(page, { rules: 'real', mode: 'practice' });
  console.log('[cam] 연습 대기', await until(page, "s.ph === 'pitch' && H.cam() !== 'intro'", 40));
  await stepS(page, 1.0);
  await shot(page, 'bat-wait');
  await shot(page, 'bat-wait-hud', true);
  console.log('[cam] 릴리스', await until(page, "s.ph === 'pitching' && s.p && H.simNow() > s.p.t0 + 0.02", 30, false, 1 / 60));
  await shot(page, 'bat-release');
  await until(page, "s.p && H.simNow() > (s.p.t0 + s.p.arrive) / 2", 3, false, 1 / 60);
  await shot(page, 'bat-mid');
  if (opt.side) { // 좌타 미러(카메라만): __camSide = -1
    await until(page, "s.ph === 'pitch'", 20);
    await page.evaluate(() => { window.__camSide = -1; }); await stepS(page, 1.0);
    await shot(page, 'bat-wait-L');
    await page.evaluate(() => { window.__camSide = 0; });
  }
  await until(page, "s.ph === 'pitch'", 20);
  await key(page, 'v'); await stepS(page, 1.2);
  await shot(page, 'bat-shoulder');
  await key(page, 'v'); await stepS(page, 1.2);
  await page.close();
}
// ── 2) 투수 ──
if (want('pitch')) {
  const page = await open(12);
  await start(page, { rules: 'real', mode: 'game', inn: '1', pos: 'P', team: 'home' });
  console.log('[cam] 투수 대기', await until(page, "s.ph === 'pitch' && H.cam() !== 'intro' && H.getRole().pitcher", 60));
  await stepS(page, 1.0);
  await shot(page, 'pitch-aim');
  await shot(page, 'pitch-aim-hud', true);
  console.log('[cam] 투구', await until(page, "s.ph === 'pitching' && s.p && H.simNow() > s.p.t0 - 0.6", 30, true, 1 / 60));
  await shot(page, 'pitch-windup');
  await until(page, "s.ph === 'pitching' && s.p && H.simNow() > s.p.t0 + 0.2", 3, false, 1 / 60);
  await shot(page, 'pitch-flight');
  console.log('[cam] 주자 있음', await until(page, "s.ph === 'pitch' && H.getRole().pitcher && s.rn && s.rn.length > 0 && H.cam() !== 'intro'", 400, true));
  await stepS(page, 1.0);
  await shot(page, 'pitch-aim-runner');
  await page.close();
}
// ── 3) 수비: 유격수·중견수 (3인칭 기본 / V 중계) ──
if (want('field')) {
  for (const pos of ['SS', 'CF']) {
    const page = await open(pos === 'SS' ? 13 : 14);
    await start(page, { rules: 'real', mode: 'game', inn: '1', pos, team: 'home' });
    console.log('[cam]', pos, '대기', await until(page, "s.ph === 'pitch' && H.cam() !== 'intro' && H.getRole().fi >= 0", 60));
    await stepS(page, 1.0);
    await shot(page, `field-${pos}-wait`);
    await key(page, 'v'); await stepS(page, 1.2);
    await shot(page, `field-${pos}-wait-tv`);
    await key(page, 'v'); await stepS(page, 1.2);
    // 인플레이 타구 (페어, 내 쪽이든 아니든)
    const tt = await until(page, "s.ph === 'live' && s.b && H.lct() > 0 && H.simNow() > 0 && performance.now() / 1000 - H.lct() > 0.25 && performance.now() / 1000 - H.lct() < 0.4", 400, true, 1 / 60);
    console.log('[cam]', pos, '타구', tt);
    await shot(page, `field-${pos}-hit0.3`);
    await stepS(page, 0.9); await shot(page, `field-${pos}-hit1.2`);
    await stepS(page, 1.3); await shot(page, `field-${pos}-hit2.5`);
    await stepS(page, 1.5); await shot(page, `field-${pos}-hit4`);
    await page.close();
  }
  // 포수
  const page = await open(15);
  await start(page, { rules: 'real', mode: 'game', inn: '1', pos: 'C', team: 'home' });
  console.log('[cam] 포수 대기', await until(page, "s.ph === 'pitch' && H.cam() !== 'intro' && H.getRole().fi >= 0", 60));
  await stepS(page, 1.0);
  await shot(page, 'field-C-wait');
  await page.close();
}
// ── 4) 주자·관전 (역할만 바꿔서) + 타구 따라가기 ──
if (want('run')) {
  const page = await open(16);
  await start(page, { rules: 'real', mode: 'game', inn: '1', pos: 'SS', team: 'away' });
  console.log('[cam] 공격 타석', await until(page, "s.ph === 'pitch' && H.getRole().batter && H.cam() !== 'intro'", 120, false));
  // 1루에 '나'인 주자를 넣고(동료가 타석인 상황), 타자 역할만 끔
  await page.evaluate(() => { const g = window.__hr.game; const r = g.mkRunner(1, false); r.pid = 'me'; r.target = 1; r.start = 1; r.forced = false; r.batter = false; g.runners.push(r); });
  await role(page, 'r.batter = false; return r;');
  await stepS(page, 1.2);
  await shot(page, 'run-wait');
  await role(page, 'r.batter = false; r.offense = false; r.spec = true; return r;');
  await stepS(page, 1.2);
  await shot(page, 'spec-wait');
  await role(page, 'r.batter = false; return r;');
  const tt = await until(page, "s.ph === 'live' && s.b && performance.now() / 1000 - H.lct() > 0.25 && performance.now() / 1000 - H.lct() < 0.4", 300, true, 1 / 60);
  console.log('[cam] 주자 타구', tt);
  await shot(page, 'run-hit0.3');
  await stepS(page, 0.9); await shot(page, 'run-hit1.2');
  await stepS(page, 1.5); await shot(page, 'run-hit2.7');
  await stepS(page, 1.5); await shot(page, 'run-hit4.2');
  await role(page, null);
  await page.close();
}
// ── 5) 타구 화면 공 속도 (타자 본인, 연습 모드 — 타구 여러 개) ──
if (want('speed')) {
  const page = await open(21);
  await start(page, { rules: 'real', mode: 'practice' });
  await until(page, "s.ph === 'pitch' && H.cam() !== 'intro'", 40);
  const res = await page.evaluate((HITS) => {
    const H = window.__hr, C = H.camera, Q = window.__qa;
    const win = [[0, 0.3], [0.3, 0.8], [0.8, 2.4]];
    const acc = win.map(() => [0, 0]), accD = win.map(() => [0, 0]); // [실제 px, 고정 px] · accD = 데드존 카메라가 켜진 프레임만
    let n = 0, lastL = -1, F = null, prev = null;
    const proj = (cam, p) => { const v = p.clone().project(cam); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight, v.z]; };
    const ballM = () => (H.ball && H.ball.visible ? H.ball : null);
    Q.bot.on = true; Q.bot.swingP = 1;
    for (let i = 0; i < 60 * 1800 && n < HITS; i++) {
      window.__qaStep(1 / 60, { render: 0 });
      if (H.cam() === 'intro') dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      const s = H.S(), L = H.lct(), tc = performance.now() / 1000 - L;
      if (L !== lastL && s.ph === 'live' && s.b && tc < 0.1) {
        lastL = L; n++;
        // 맞은 순간 카메라 얼림(첫 프레임 자세)
        F = C.clone(); F.position.copy(C.position); F.quaternion.copy(C.quaternion); F.fov = C.fov; F.aspect = C.aspect; F.updateProjectionMatrix(); F.updateMatrixWorld(true);
        prev = null;
      }
      if (!F || tc > 2.4 || s.ph !== 'live') { if (tc > 2.4) F = null; continue; }
      const bm = ballM(); if (!bm) continue;
      H.scene.updateMatrixWorld(); C.updateMatrixWorld(true);
      const p = bm.getWorldPosition(bm.position.clone());
      const a = proj(C, p), f = proj(F, p);
      if (prev) {
        const inF = f[2] < 1 && f[0] > 0 && f[0] < innerWidth && f[1] > 0 && f[1] < innerHeight && prev.f[0] > 0 && prev.f[0] < innerWidth && prev.f[1] > 0 && prev.f[1] < innerHeight;
        // 실제: 이번 프레임 카메라에서 본 공 - 지난 프레임 카메라에서 본 지난 공 (카메라 회전이 공 움직임을 상쇄하면 작아짐)
        const da = Math.hypot(a[0] - prev.a[0], a[1] - prev.a[1]), df = Math.hypot(f[0] - prev.f[0], f[1] - prev.f[1]);
        const wi = win.findIndex(([x, y]) => tc >= x && tc < y);
        if (wi >= 0 && inF) { acc[wi][0] += da; acc[wi][1] += df; if (window.__camRig && window.__camRig.direct) { accD[wi][0] += da; accD[wi][1] += df; } }
      }
      prev = { a, f };
    }
    Q.bot.on = false;
    const R = (A) => A.map(([x, y], i) => [win[i].join('~'), y ? +(x / y).toFixed(3) : null, Math.round(y)]);
    return { hits: n, ratio: R(acc), deadzoneOnly: R(accD) };
  }, +(opt.hits || 40));
  console.log('[cam] 공 속도(실제 ÷ 고정 카메라):', JSON.stringify(res));
  report.speed = res;
  await page.close();
}
await browser.close(); srv.close();
const { writeFileSync } = await import('node:fs');
writeFileSync(join(outDir, `cam-${tag}.json`), JSON.stringify({ report, errors }, null, 1));
console.log('[cam] 저장', files.length, '장 →', outDir);
console.log('[cam] 예외', errors.length, errors.slice(0, 10).join('\n'));
process.exit(errors.length ? 1 : 0);
