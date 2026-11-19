// [pitch] 타자 시점 투구 스크린샷 — 공이 화면에서 보이는지(크기·대비·실밥 회전) 확인용. 진짜 크롬(SwiftShader) + 가상 시계.
//   node tools/qa/pitchview.mjs [--tag=after] [--tod=night|day] [--n=3] [--cam=0|1] [--types=FB,SL,CB]
// 결과: tools/qa/.out/pitch-<tag>-<tod>-<구종>-<n>-<진행률>.png  (+ 공 화면 지름 px 표 출력)
// 혼자하기 '타격 연습'(실전 구종·코스)에서 봇은 스윙하지 않고 공만 봄. 공 위치 미리보기는 없음 — 찍는 건 실제로 날아가는 공뿐.
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { bundle, serve, root, outDir } from './serve.mjs';

const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const tag = opt.tag || 'now', tod = opt.tod || 'night', N = +opt.n || 1, types = (opt.types || 'FB,SL,CB').split(',');
const SV = (opt.sv || '0.08,0.45,0.8,0.97').split(',').map(Number);
const req = (m) => { for (const b of [root, '/opt/npm-tools']) { try { return createRequire(b + '/')(m); } catch { } } throw new Error(m + ' 없음'); };
const { chromium } = req('playwright-core');
const chrome = [process.env.CHROME, '/usr/bin/google-chrome', '/opt/pw-browsers/chromium/chrome-linux64/chrome'].find((p) => p && existsSync(p));
await bundle();
const { srv, port } = await serve({});
const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 800 } }); // 맥북 에어 크롬 창 크기 정도
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.stack || e.message).split('\n').slice(0, 3).join(' | ')));
await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, body: '' }));
const inject = readFileSync(join(root, 'tools/qa/inject.js'), 'utf8') + '\n' + readFileSync(join(root, 'tools/qa/driver.js'), 'utf8');
await page.addInitScript({ content: inject + `;window.__qa.seed(11);try{localStorage.setItem('hr_tod',JSON.stringify('${tod}'))}catch(e){}` });
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction(() => document.getElementById('bPlay'), null, { timeout: 30000, polling: 500 });
await page.waitForTimeout(6000);
await page.evaluate(([tod, cam]) => {
  const $ = (id) => document.getElementById(id); const seg = (id, v) => { const b = document.querySelector(`#${id} [data-v="${v}"]`); if (b) b.click(); };
  window.__fastCam = 1;
  $('nick').value = 'QA봇'; $('bPlay').click();
  document.querySelector('#modes [data-rules="real"]').click(); $('bSolo').click();
  seg('oRules', 'real'); seg('oMode', 'practice'); $('oGo').click();
}, [tod, opt.cam]);
await page.waitForTimeout(1500);
await page.evaluate(([tod, cam]) => { window.__qaVclock(); window.__qaJitter = 0; window.__qa.bot.swingP = 0; const H = window.__hr; if (H && H.ui && H.ui.applyTimeOfDay) H.ui.applyTimeOfDay(tod); }, [tod, opt.cam]);
if (opt.cam != null) await page.evaluate((c) => { if (+c !== +(JSON.parse(localStorage.getItem('hr_batCam') || '0'))) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', bubbles: true })); }, opt.cam);
const rows = [];
for (const type of types) {
  await page.evaluate((t) => { const H = window.__hr; H.net().send({ t: 'ppick', type: t }); }, type);
  for (let k = 0; k < N; k++) {
    // 다음 투구가 날아갈 때까지
    const ok = await page.evaluate(() => { const H = window.__hr; for (let i = 0; i < 60 * 30; i++) { window.__qaStep(1 / 60, { render: 0 }); const s = H.S(); if (s && s.ph === 'pitching' && s.p && H.simNow() < s.p.t0 - 0.2) return true; } return false; });
    if (!ok) break;
    for (const sv of SV) {
      const info = await page.evaluate((sv) => {
        const H = window.__hr, s = H.S(), p = s.p;
        while (H.simNow() < p.t0 + p.T * sv - 1 / 120) window.__qaStep(1 / 60, { render: 0 });
        window.__noRender = 0; window.__frame(window.__V); window.__noRender = 1;
        let ball = null; H.scene.traverse((o) => { if (!ball && o.isMesh && o.geometry && o.geometry.type === 'SphereGeometry' && Math.abs(o.geometry.parameters.radius - 0.037 * 1.6) < 1e-4) ball = o; });
        const cam = H.camera, v = ball.getWorldPosition(ball.position.clone()), d = v.distanceTo(cam.position);
        const r = ball.geometry.parameters.radius * ball.scale.x, px = 2 * r / d * (innerHeight / 2) / Math.tan(cam.fov * Math.PI / 360);
        const sc = v.clone().project(cam);
        return { type: p.type, kmh: p.kmh, sv, vis: ball.visible, px: +px.toFixed(1), dist: +d.toFixed(1), fov: +cam.fov.toFixed(1), cam: H.cam(), sx: Math.round((sc.x + 1) / 2 * innerWidth), sy: Math.round((1 - sc.y) / 2 * innerHeight) };
      }, sv);
      const f = join(outDir, `pitch-${tag}-${tod}-${type}-${k}-${String(Math.round(sv * 100)).padStart(3, '0')}.png`);
      await page.screenshot({ path: f });
      if (sv === SV[0] || opt.crop) { const x = Math.max(0, info.sx - 120), y = Math.max(0, info.sy - 90); await page.screenshot({ path: f.replace('.png', '-crop.png'), clip: { x, y, width: 240, height: 180 } }); }
      rows.push({ ...info, f: f.replace(root + '/', '') });
    }
  }
}
console.log(rows.map((r) => `${r.type} ${r.kmh}km/h 진행 ${r.sv} 보임 ${r.vis} 공 지름 ${r.px}px 거리 ${r.dist}m 화각 ${r.fov} ${r.cam}  ${r.f}`).join('\n'));
console.log('페이지 예외', errs.length, errs.slice(0, 5));
await browser.close(); srv.close();
process.exit(errs.length ? 1 : 0);
