// 빌드: client/main.js → public/app.js, 혼자 연습판 dist/solo.html
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { TEX_AVG, FACE_SKINS } from '../client/texinfo.js';
const root = new URL('../', import.meta.url).pathname;
const dev = process.argv.includes('--dev');
const entries = process.argv.filter((a) => a.startsWith('--entry=')).map((a) => a.slice(8));
const common = { bundle: true, format: 'esm', external: ['three', 'three/addons/*'], target: 'es2020', minify: !dev, legalComments: 'none', charset: 'utf8' };
if (entries.length) {
  for (const e of entries) { const [src, out] = e.split(':'); await build({ ...common, entryPoints: [root + src], outfile: out }); }
} else {
  await build({ ...common, entryPoints: [root + 'client/main.js'], outfile: root + 'public/app.js' });
  // 혼자 연습판 (서버 없이 단일 HTML)
  const js = readFileSync(root + 'public/app.js', 'utf8');
  let html = readFileSync(root + 'public/index.html', 'utf8');
  const adDir = root + 'public/assets/ads/';
  html = html.replace('./assets/ui/keyart.jpg', 'data:image/jpeg;base64,' + readFileSync(root + 'public/assets/ui/keyart.jpg').toString('base64'));
  const tex = {};
  for (const k of ['dirt', 'grass', 'crowd', 'sky_day', 'sky_night']) { const f = root + `public/assets/tex/${k}.jpg`; if (existsSync(f)) tex[k.replace('_d', 'D').replace('_n', 'N')] = { url: 'data:image/jpeg;base64,' + readFileSync(f).toString('base64'), avg: TEX_AVG[k] }; }
  const faces = FACE_SKINS.map((skin, i) => ({ url: 'data:image/jpeg;base64,' + readFileSync(root + `public/assets/tex/face${i}.jpg`).toString('base64'), skin }));
  const mf = root + 'public/assets/models/body.bin';
  const model = existsSync(mf) ? 'data:application/octet-stream;base64,' + readFileSync(mf).toString('base64') : null;
  const mfl = root + 'public/assets/models/body_lo.bin';
  const modelLo = existsSync(mfl) ? 'data:application/octet-stream;base64,' + readFileSync(mfl).toString('base64') : null;
  const assets = { tex, faces, model, modelLo, ads: readdirSync(adDir).filter((f) => /^ad\d+\.jpg$/.test(f)).sort().map((f) => 'data:image/jpeg;base64,' + readFileSync(adDir + f).toString('base64')) };
  html = html.replace('<script type="module" src="./app.js"></script>', () => `<script>window.HR_OFFLINE=true;window.HR_ASSETS=${JSON.stringify(assets)}</script>\n<script type="module">\n${js}\n</script>`);
  mkdirSync(root + 'dist', { recursive: true });
  writeFileSync(root + 'dist/solo.html', html);
  const frag = html.replace(/<!doctype html>\s*/i, '').replace(/<\/?html[^>]*>\s*/gi, '').replace(/<\/?head>\s*/gi, '').replace(/<\/?body>\s*/gi, '');
  writeFileSync(root + 'dist/solo-artifact.html', frag);
  console.log('built public/app.js', (js.length / 1024).toFixed(0) + 'KB');
}
