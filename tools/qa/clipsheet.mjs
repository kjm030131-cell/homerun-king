// [motion] 클립 한 장 보기(contact sheet) — 클립을 실제 선수 몸(로더·Character 그대로)에 입혀 여러 시각을 한 PNG 에 타일로 렌더
//   node tools/qa/clipsheet.mjs swing2 batStrike           # 클립마다 tools/qa/.out/clip-<이름>.png (기본 12칸, 옆에서)
//   node tools/qa/clipsheet.mjs swing2 --n=16 --view=front --t0=0.5 --t1=1.6 --role=batter
//   --marks: 칸 = 클립 마커(컨택·릴리스·착지 …) 시각
//   view: side(+x 에서) | front(+z 에서) | back | top · role: batter(배트·헬멧) | fielder | catcher | ump
// 칸마다 클립 시각(초)과 오른손 속도(m/s), 엉덩이 높이·수평 이동(m)을 적어서 컨택·릴리스·착지 프레임을 고르는 데 쓴다.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { serve, root, outDir } from './serve.mjs';

const argv = process.argv.slice(2);
const opt = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const names = argv.filter((a) => !a.startsWith('--'));
const req = (m) => { for (const b of [root, '/opt/npm-tools']) { try { return createRequire(b + '/')(m); } catch { } } throw new Error(m + ' 없음'); };
const { chromium } = req('playwright-core');
const esb = req('esbuild');
const chrome = [process.env.CHROME, '/usr/bin/google-chrome', '/opt/pw-browsers/chromium/chrome-linux64/chrome'].find((p) => p && existsSync(p));
mkdirSync(outDir, { recursive: true });

const entry = join(outDir, 'clipsheet.entry.js');
writeFileSync(entry, `
import * as THREE from 'three';
import { loadLib } from '${root}/client/anim/loader.js';
import { CharPlayer } from '${root}/client/anim/actor.js';
import { CLIPS } from '${root}/client/anim/clips.js';
window.__sheet = async (name, o) => {
  const lib = await loadLib();
  // 뒤에서 이어 받는 클립까지 기다림
  for (let i = 0; i < 200 && !lib.clips.has(name); i++) await new Promise((r) => setTimeout(r, 100));
  const e = lib.clips.get(name); if (!e) return { err: name + ' 없음: ' + [...lib.clips.keys()].join(',') };
  const mk = o.marks ? Object.entries(e.markers).sort((a, b) => a[1] - b[1]) : null;
  if (mk) o.n = mk.length;
  const n = o.n, cols = Math.min(n, o.cols || 4), rows = Math.ceil(n / cols), W = o.w || 320, H = o.h || 360;
  const R = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); R.setSize(W * cols, H * rows); R.setPixelRatio(1);
  R.outputColorSpace = THREE.SRGBColorSpace; R.setScissorTest(true); document.body.appendChild(R.domElement);
  const sc = new THREE.Scene(); sc.background = new THREE.Color('#2a3446');
  sc.add(new THREE.HemisphereLight('#dfe8ff', '#3a3328', 1.5)); const sun = new THREE.DirectionalLight('#fff', 2.2); sun.position.set(3, 6, 4); sc.add(sun);
  const gr = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshStandardMaterial({ color: '#7a6247', roughness: 1 })); gr.rotation.x = -Math.PI / 2; sc.add(gr);
  const grid = new THREE.GridHelper(12, 24, '#99a', '#556'); grid.position.y = 0.002; sc.add(grid);
  const ax = new THREE.AxesHelper(1.6); ax.position.y = 0.01; sc.add(ax); // 빨강 +x(타자: 투수 쪽) · 파랑 +z(타자: 홈플레이트 쪽)
  const p = new CharPlayer(lib, { team: o.team || 'home', num: '7', role: o.role || 'batter', seed: 1 }); p.setRole(o.role || 'batter');
  sc.add(p.root);
  const C = p.char, cam = new THREE.PerspectiveCamera(o.fov || 38, W / H, 0.05, 80);
  const t0 = o.t0 ?? 0, t1 = Math.min(o.t1 ?? e.clip.duration, e.clip.duration);
  const info = [], hp = new THREE.Vector3(), rh = new THREE.Vector3(), prh = new THREE.Vector3();
  const B = C.bones;
  const probe = (t) => { C.scrub(name, t, { fade: 0 }); C.update(1 / 60); p.root.updateMatrixWorld(true); return B.RightHand.getWorldPosition(new THREE.Vector3()); };
  const H0 = (C.scrub(name, 0, { fade: 0 }), C.update(0), p.root.updateMatrixWorld(true), B.Hips.getWorldPosition(new THREE.Vector3()));
  for (let i = 0; i < n; i++) {
    const t = mk ? Math.min(mk[i][1], e.clip.duration - 1e-3) : n === 1 ? t0 : t0 + (t1 - t0) * i / (n - 1);
    const a = probe(Math.max(0, t - 1 / 60)), b = probe(t);
    const v = a.distanceTo(b) * 60;
    B.Hips.getWorldPosition(hp);
    const c = i % cols, r = (i / cols) | 0;
    const look = new THREE.Vector3(o.follow ? hp.x : 0, 0.95, o.follow ? hp.z : 0);
    const D = o.dist || 3.6, vw = o.view || 'side';
    const dir = vw === 'front' ? [0, 0.12, 1] : vw === 'back' ? [0, 0.12, -1] : vw === 'top' ? [0, 1, 0.001] : vw === 'iso' ? [0.8, 0.3, 0.8] : vw === 'left' ? [-1, 0.12, 0] : [1, 0.12, 0];
    const dv = new THREE.Vector3(...dir).normalize().multiplyScalar(D);
    cam.position.copy(look).add(dv); cam.lookAt(look); cam.updateMatrixWorld();
    const y = (rows - 1 - r) * H;
    R.setViewport(c * W, y, W, H); R.setScissor(c * W, y, W, H); R.render(sc, cam);
    info.push({ m: mk ? mk[i][0] : '', t: +t.toFixed(3), v: +v.toFixed(1), hy: +hp.y.toFixed(2), dx: +(hp.x - H0.x).toFixed(2), dz: +(hp.z - H0.z).toFixed(2) });
  }
  // 글씨
  const cv = document.createElement('canvas'); cv.width = W * cols; cv.height = H * rows; const g = cv.getContext('2d');
  g.drawImage(R.domElement, 0, 0); g.font = 'bold 15px monospace'; g.fillStyle = '#ffde59';
  info.forEach((q, i) => { const c = i % cols, r = (i / cols) | 0; g.fillText(name + ' ' + q.m + ' t=' + q.t.toFixed(2) + ' v=' + q.v, c * W + 6, r * H + 18); g.fillText('hipY ' + q.hy + ' dx ' + q.dx + ' dz ' + q.dz, c * W + 6, r * H + 36); });
  document.body.innerHTML = ''; document.body.appendChild(cv); cv.id = 'sheet';
  return { dur: e.clip.duration, markers: e.markers, info };
};
`);
const bundleOut = join(outDir, 'clipsheet.js');
await esb.build({ entryPoints: [entry], outfile: bundleOut, bundle: true, format: 'esm', external: ['three', 'three/addons/*'], target: 'es2020', logLevel: 'error', charset: 'utf8' });
const { srv, port } = await serve({});
const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const { readFileSync } = await import('node:fs');
const js = readFileSync(bundleOut, 'utf8');
for (const name of names) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.route(/\/sheet\.html$/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><head><script type="importmap">{ "imports": { "three": "/three/build/three.module.js", "three/addons/": "/three/examples/jsm/" } }</script></head><body style="margin:0;background:#000"><script type="module" src="/sheet.js"></script></body></html>` }));
  await page.route(/\/sheet\.js$/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: js }));
  await page.goto(`http://127.0.0.1:${port}/sheet.html`);
  await page.waitForFunction(() => window.__sheet, null, { timeout: 30000 });
  const o = { n: +(opt.n || 12), cols: +(opt.cols || 4), view: opt.view, role: opt.role, t0: opt.t0 != null ? +opt.t0 : undefined, t1: opt.t1 != null ? +opt.t1 : undefined, dist: opt.dist ? +opt.dist : undefined, follow: !!opt.follow, marks: !!opt.marks, w: opt.w ? +opt.w : undefined, h: opt.h ? +opt.h : undefined };
  const res = await page.evaluate(([n, o]) => window.__sheet(n, o), [name, o]);
  if (res.err) { console.log(name, res.err); await page.close(); continue; }
  const f = join(outDir, `clip-${name}${opt.tag ? '-' + opt.tag : ''}.png`);
  await (await page.$('#sheet')).screenshot({ path: f });
  console.log(name, 'dur', res.dur.toFixed(2), 'markers', JSON.stringify(res.markers));
  if (opt.v) console.log('  ', res.info.map((q) => `${q.t}:${q.v}`).join(' '));
  console.log('  →', f);
  await page.close();
}
await browser.close(); srv.close();
