// [qa] 스크린샷 하네스 — 진짜 크롬(SwiftShader)으로 게임 장면을 렌더해서 PNG 로 저장 (선수 발·장비 위치 눈 확인용)
//   node tools/qa/shots.mjs                 # 기본 묶음 → tools/qa/.out/shot-*.png
//   node tools/qa/shots.mjs --q=?legacy     # 옛 몸으로
//   node tools/qa/shots.mjs --lab           # ?animlab(T포즈 몸 + 장비) 확대 샷도
// 흐름: run.mjs 와 같은 번들·서버·계측 → 혼자하기(타격 연습 / CPU 경기) 시작 → 가상 시계로 투구 대기까지 진행
//   → window.__cam 으로 카메라 고정(타자 시점·중계·옆·마운드 근접·포수 근접 …) → 한 프레임 렌더 → page.screenshot
//   + 숫자 점검: 선수별 발바닥(양발 뼈 최저점) 높이 vs 그 자리 땅 높이(마운드 포함)
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
const tag = opt.tag ? '-' + opt.tag : '';

await bundle();
const { srv, port } = await serve({ api: async () => null });
const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const inject = readFileSync(join(root, 'tools/qa/inject.js'), 'utf8') + '\n' + readFileSync(join(root, 'tools/qa/driver.js'), 'utf8');
const errors = [];
const files = [];

async function open(q = '') {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')));
  page.on('console', (m) => { const t = m.text(); if ((m.type() === 'error' || /\[anim\]/.test(t)) && !/GL Driver|Failed to load resource/.test(t)) (m.type() === 'error' ? errors : []).push(`[${m.type()}] ${t.slice(0, 200)}`); if (/\[anim\]/.test(t)) console.log('  ', t.slice(0, 160)); });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, body: '' }));
  await page.addInitScript({ content: inject + ';window.__qa.seed(11);' + (opt.redblob ? 'window.__redBlob=' + (+opt.redblob || 1) + ';' : '') });
  let ready = null; const isNew = new Promise((ok) => { ready = ok; });
  page.on('console', (m) => { if (/새 캐릭터 사용|옛 몸 유지/.test(m.text())) ready(); });
  await page.goto(`http://127.0.0.1:${port}/${q}`);
  await page.waitForFunction(() => document.getElementById('bPlay'), null, { timeout: 30000, polling: 500 });
  // 새 캐릭터(GLB) 로딩이 끝날 때까지 실시간으로 기다림 — 가상 시계 루프는 이벤트 루프를 막아서 로딩이 안 끝남(전엔 첫 샷들이 옛 몸이었음)
  if (!/legacy|noskin/.test(q)) await Promise.race([isNew, new Promise((ok) => setTimeout(ok, 90000))]);
  await page.waitForTimeout(1500);
  return page;
}
async function start(page, S) {
  await page.evaluate((S) => {
    const $ = (id) => document.getElementById(id);
    const seg = (id, v) => { const b = document.querySelector(`#${id} [data-v="${v}"]`); if (b) b.click(); };
    $('nick').value = 'QA'; $('bPlay').click();
    document.querySelector(`#modes [data-rules="${S.rules}"]`).click();
    $('bSolo').click();
    seg('oRules', S.rules); seg('oMode', S.mode); if (S.inn) seg('oInn', S.inn); if (S.team) seg('oTeam', S.team);
    if (S.pos) $('oPos').value = S.pos;
    $('oGo').click();
  }, S);
  await page.waitForTimeout(1200);
  await page.evaluate(() => { window.__qaVclock(); window.__qaJitter = 0; window.__qa.bot.on = false; window.__fastCam = 1; });
}
// 조건이 될 때까지 가상 시계 진행(봇 끔 — 직접 입력 없음, 인트로는 Enter 로 넘김)
async function until(page, fnSrc, maxSec = 60) {
  return page.evaluate(([src, maxSec]) => {
    const f = new Function('H', 's', 'return (' + src + ')');
    const H = window.__hr;
    for (let t = 0; t < maxSec; t += 0.1) {
      const s = H.S();
      if (s && f(H, s)) return t;
      if (H.cam() === 'intro') dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      window.__qaStep(0.1, { render: 0 });
    }
    return -1;
  }, [fnSrc, maxSec]);
}
// 선수 발 점검: 각 캐릭터의 양발(발끝 포함) 뼈 최저 y vs 땅 높이
async function feet(page) {
  return page.evaluate(() => {
    const H = window.__hr, out = [];
    const moundY = (x, z) => { const r = Math.hypot(x, z - 18.44); const prof = [[0, 0.254], [0.6, 0.254], [1.0, 0.24], [1.6, 0.17], [2.2, 0.07], [2.74, 0.0]]; if (r >= 2.74) return 0; for (let i = 1; i < prof.length; i++) if (r <= prof[i][0]) { const [r0, y0] = prof[i - 1], [r1, y1] = prof[i]; return 0.005 + y0 + (y1 - y0) * (r - r0) / (r1 - r0); } return 0; };
    H.scene.updateMatrixWorld(true);
    H.scene.traverse((o) => {
      if (o.name !== 'char' || !o.visible) return;
      let vis = true; for (let p = o; p; p = p.parent) if (!p.visible) vis = false; if (!vis) return;
      const b = {}; o.traverse((x) => { if (x.isBone) b[x.name] = x; });
      const ys = ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase', 'LeftToe_End', 'RightToe_End'].filter((n) => b[n]).map((n) => b[n].getWorldPosition(new o.position.constructor()).y);
      const g = moundY(o.position.x, o.position.z);
      let sole = 1e9; const V = new o.position.constructor();
      o.traverse((m) => { if (!m.isSkinnedMesh || !m.visible) return; const n = m.geometry.attributes.position.count; for (let i = 0; i < n; i += 7) { m.getVertexPosition(i, V); V.applyMatrix4(m.matrixWorld); if (V.y < sole) sole = V.y; } });
      const blob = o.getObjectByName('blob'); const by = blob ? blob.getWorldPosition(new o.position.constructor()).y : null;
      out.push({ x: +o.position.x.toFixed(2), z: +o.position.z.toFixed(2), rootY: +o.position.y.toFixed(3), ground: +g.toFixed(3), footMin: +Math.min(...ys).toFixed(3), sole: +sole.toFixed(3), soleAboveGround: +(sole - g).toFixed(3), blobY: by == null ? null : +by.toFixed(3), blobVis: blob ? blob.visible : null, blobS: blob ? +blob.scale.x.toFixed(2) : null });
    });
    return out;
  });
}
async function shot(page, name, cam) {
  await page.evaluate((cam) => {
    // HUD 숨김(캔버스만 보이게)
    const c = document.getElementById('c'); for (const el of document.body.querySelectorAll('*')) if (el !== c && !el.contains(c) && el.style) el.style.visibility = 'hidden';
    if (c) c.style.visibility = 'visible';
    window.__cam = cam || null;
    if (window.__redBlob) window.__hr.scene.traverse((o) => { if (o.name === 'blob') { o.material.color.set('#ff0000'); o.material.map = null; o.material.opacity = 1; if (window.__redBlob === 2) o.material.depthTest = false; o.material.needsUpdate = true; } }); window.__qaStep(1 / 60, { render: 0 }); window.__qaStep(1 / 60, { render: 0 }); window.__noRender = 0; window.__frame(window.__V); window.__noRender = 1; }, cam);
  const f = join(outDir, `shot${tag}-${name}.png`);
  await page.screenshot({ path: f });
  files.push(f);
  await page.evaluate(() => { window.__cam = null; for (const el of document.body.querySelectorAll('*')) if (el.style) el.style.visibility = ''; });
}

const Q = opt.q || '';
if (opt.redblob) console.log('[shots] 그림자 빨강');
// 1) 타격 연습: 타자 시점(기본 카메라), 중계·옆·근접
if (!opt.only || opt.only === 'practice') {
  const page = await open(Q);
  await start(page, { rules: 'real', mode: 'practice' });
  const t = await until(page, "s.ph === 'pitch' && H.cam() !== 'intro'", 40);
  console.log('[shots] 연습 투구 대기', t);
  await page.evaluate(() => window.__qaStep(1.0, { render: 0 }));
  await shot(page, 'bat-view', null);
  if (opt.redblob) console.log('[dbg]', JSON.stringify(await page.evaluate(() => { const H = window.__hr, out = []; H.scene.traverse((o) => { if (o.name === 'blob') { let wv = true; for (let p = o; p; p = p.parent) if (!p.visible) wv = false; const w = o.getWorldPosition(o.position.clone()); out.push({ wv, vis: o.visible, w: w.toArray().map((x) => +x.toFixed(2)), mat: [o.material.transparent, o.material.depthTest, o.material.opacity, o.material.visible], cam: H.camera.position.toArray().map((x) => +x.toFixed(2)), layers: o.layers.mask, camLayers: H.camera.layers.mask }); } }); return out; })));
  await shot(page, 'batter-side', { pos: [4.2, 1.0, 0.6], look: [0.6, 0.9, 0.2], fov: 40 });
  await shot(page, 'batter-feet', { pos: [2.6, 0.35, 2.2], look: [0.7, 0.3, 0.1], fov: 40 });
  await shot(page, 'batter-front', { pos: [0.3, 1.3, 4.5], look: [0.7, 0.9, 0], fov: 40 });
  await shot(page, 'mound-side', { pos: [6.5, 1.0, 18.6], look: [0, 0.9, 18.4], fov: 35 });
  await shot(page, 'mound-low', { pos: [3.2, 0.25, 15.5], look: [0, 0.4, 18.4], fov: 40 });
  await shot(page, 'catcher-side', { pos: [3.5, 0.8, -2.0], look: [0, 0.5, -0.9], fov: 40 });
  await shot(page, 'tv', { pos: [0, 6.5, -15], look: [0, 1, 14], fov: 40 });
  // 와인드업 중(레그킥 정점·릴리스)
  const t2 = await until(page, "s.ph === 'pitching' && s.p && H.simNow() > s.p.t0 - 0.5", 30);
  console.log('[shots] 와인드업', t2);
  await shot(page, 'mound-pitching', { pos: [6.5, 1.0, 18.0], look: [0, 1.0, 18.0], fov: 35 });
  await shot(page, 'bat-view-pitching', null);
  console.log('[shots] 발 점검(연습):', JSON.stringify(await feet(page)));
  // 릴리스 순간 투수 오른손 vs sim RELEASE(0.45, 1.85, 17.0)
  console.log('[shots] 릴리스 손:', JSON.stringify(await page.evaluate(() => {
    const H = window.__hr, out = [];
    for (let i = 0; i < 400; i++) {
      const s = H.S(); if (!s.p) { window.__qaStep(1 / 60, { render: 0 }); continue; }
      const d = H.simNow() - s.p.t0;
      if (d > -0.12 && d < 0.08) { let hand = null; H.scene.traverse((o) => { if (o.name === 'char' && Math.abs(o.position.z - 18.44) < 0.3 && o.visible) { const b = o.getObjectByName('RightHand') || null; if (b) { const v = b.getWorldPosition(o.position.clone()); hand = v.toArray().map((x) => +x.toFixed(2)); } } }); out.push([+d.toFixed(3), hand]); }
      if (d > 0.08) break;
      window.__qaStep(1 / 60, { render: d > -0.2 ? 1 : 0 }); // 렌더해야 Character.frame(FR.n) 이 돌아 먼 선수도 애니메이션 갱신
    }
    return out;
  })));
  await page.close();
}
// 2) CPU 경기: 수비(중계) — 야수·포수·주자
if (!opt.only || opt.only === 'game') {
  const page = await open(Q);
  await start(page, { rules: 'real', mode: 'game', inn: '1', pos: 'SS', team: 'home' });
  const t = await until(page, "s.ph === 'pitch' && H.cam() !== 'intro'", 60);
  console.log('[shots] 경기 투구 대기', t);
  await page.evaluate(() => window.__qaStep(0.8, { render: 0 }));
  await shot(page, 'game-view', null);
  await shot(page, 'game-tv', { pos: [0, 9, -22], look: [0, 0, 22], fov: 45 });
  await shot(page, 'game-ss', { pos: [-4, 1.2, 25], look: [-9.5, 0.8, 30.5], fov: 40 });
  await shot(page, 'game-home-low', { pos: [-3.0, 0.5, 3.0], look: [0.3, 0.5, -0.6], fov: 45 });
  await shot(page, 'game-mound', { pos: [-5.0, 0.9, 16], look: [0, 0.9, 18.4], fov: 40 });
  console.log('[shots] 발 점검(경기·대기):', JSON.stringify(await feet(page)));
  const t3 = await until(page, "s.ph === 'pitching' && s.p && H.simNow() > s.p.t0 - 0.3", 30);
  console.log('[shots] 경기 와인드업', t3);
  await shot(page, 'game-catcher-pitching', { pos: [-3.0, 0.6, -0.4], look: [0, 0.5, -1.2], fov: 40 });
  await shot(page, 'game-tv-pitching', { pos: [0, 2.2, -9], look: [0, 1.0, 10], fov: 30 });
  console.log('[shots] 발 점검(경기·투구):', JSON.stringify(await feet(page)));
  await page.close();
}
// 3) animlab: T포즈 몸 + 장비 근접
if (opt.lab || opt.only === 'lab') {
  const page = await open('?animlab' + (Q ? '&' + Q.slice(1) : ''));
  await page.waitForFunction(() => window.__lab, null, { timeout: 30000, polling: 500 }).catch(async () => console.log('[shots] lab 안 열림', await page.evaluate(() => document.getElementById('alM') && document.getElementById('alM').textContent)));
  for (const [nm, role, focus, yaw, pitch, dist] of [['lab-batter', 'batter', 'body', 0.6, 0.15, 3.2], ['lab-head-b', 'batter', 'head', 0.9, 0.1, 0.9], ['lab-head-b2', 'batter', 'head', -0.9, 0.1, 0.9], ['lab-head-f', 'fielder', 'head', 0.7, 0.15, 0.9], ['lab-head-f2', 'fielder', 'head', 2.6, 0.15, 0.9], ['lab-gloveL', 'fielder', 'handL', 1.2, 0.3, 0.9], ['lab-bat', 'batter', 'handR', -0.8, 0.3, 1.6], ['lab-catcher', 'catcher', 'body', 0.7, 0.2, 3.2]]) {
    const ok = await page.evaluate(([role, focus, yaw, pitch, dist]) => { const L = window.__lab; if (!L) return false; L.set({ role, focus, yaw, pitch, dist }); return true; }, [role, focus, yaw, pitch, dist]);
    if (!ok) { console.log('[shots] __lab 없음'); break; }
    await page.waitForTimeout(1200);
    const f = join(outDir, `shot${tag}-${nm}.png`); await page.screenshot({ path: f }); files.push(f);
  }
  await page.close();
}
await browser.close(); srv.close();
console.log('[shots] 저장:\n  ' + files.join('\n  '));
console.log('[shots] 예외', errors.length, errors.slice(0, 10).join('\n'));
process.exit(errors.length ? 1 : 0);
