// 헤드리스 브라우저 장면 테스트 (가상 시계)
// GPU 없는 클라우드에선 실시간 렌더가 초당 1프레임 수준이라, 게임 시간을 직접 굴리고 원하는 순간에만 한 프레임 그려서 찍는다.
// 사용: node tools/build.mjs && node tools/test/shot.mjs tools/test/steps/smoke.mjs [출력폴더]
//   - dist/solo.html(서버 없는 혼자하기판)을 열어 steps 파일의 단계를 순서대로 실행
//   - 크로미움 경로: 환경변수 CHROME 또는 /opt/pw-browsers/chromium (없으면 playwright 기본값)
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const stepsFile = resolve(process.argv[2] || 'tools/test/steps/smoke.mjs');
const out = resolve(process.argv[3] || 'test-shots'); mkdirSync(out, { recursive: true });
const steps = (await import(pathToFileURL(stepsFile))).default;
const guess = ['/opt/pw-browsers/chromium/chrome-linux64/chrome', ...(() => { try { return readdirSync('/opt/pw-browsers').filter((d) => /^chromium-\d+$/.test(d)).map((d) => `/opt/pw-browsers/${d}/chrome-linux64/chrome`); } catch { return []; } })(),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath: process.env.CHROME || guess, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
// three.js 는 CDN 대신 node_modules 에서 (오프라인에서도 동작), 나머지 외부 요청(폰트 등)은 빈 응답
await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => {
  const m = r.request().url().match(/three@[\d.]+\/(.*)$/);
  if (m && existsSync(resolve('node_modules/three', m[1]))) return r.fulfill({ status: 200, contentType: 'application/javascript', body: readFileSync(resolve('node_modules/three', m[1])) });
  return r.fulfill({ status: 200, body: '' });
});
await page.goto(pathToFileURL(resolve('dist/solo.html')).href);
let fail = 0;
for (const s of steps) {
  if (s.wait) await page.waitForTimeout(s.wait);
  if (s.eval) { try { const v = await page.evaluate(s.eval); console.log('EVAL', typeof v === 'string' ? v : JSON.stringify(v)); if (typeof v === 'string' && /FAIL|timeout/.test(v)) fail++; } catch (e) { console.log('EVALERR', e.message.split('\n')[0]); fail++; } }
  if (s.shot) { await page.screenshot({ path: `${out}/${s.shot}` }); console.log('SHOT', `${out}/${s.shot}`); }
}
await browser.close();
process.exit(fail ? 1 : 0);
