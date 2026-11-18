// [qa] 하네스용 번들 + 정적 서버
// - client/main.js 를 three 만 외부로 두고 번들 (esbuild → 없으면 bun build)
// - public/ 을 그대로 서빙, index.html 의 import map 을 로컬 three 로 바꿈
// - three 위치: 환경변수 THREE_DIR → node_modules/three → /tmp/three160
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, extname, resolve } from 'node:path';

export const root = resolve(new URL('../../', import.meta.url).pathname);
export const outDir = join(root, 'tools/qa/.out');
// 여러 사본을 순서대로 뒤져 파일별로 찾음 (/tmp/three160 엔 loaders 가 없고 /tmp/anim-three 엔 있음)
export const threeDirs = [process.env.THREE_DIR, join(root, 'node_modules/three'), '/tmp/three160', '/tmp/anim-three'].filter((d) => d && existsSync(join(d, 'build/three.module.js')));
export const threeDir = threeDirs[0];
const reqFrom = (p) => { try { return createRequire(p + '/')('esbuild'); } catch { return null; } };

export async function bundle() {
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, 'app.js');
  const esb = reqFrom(root) || reqFrom('/opt/npm-tools') || reqFrom(join(root, 'node_modules'));
  const t0 = Date.now();
  if (esb) {
    await esb.build({ entryPoints: [join(root, 'client/main.js')], outfile: out, bundle: true, format: 'esm', external: ['three', 'three/addons/*'], target: 'es2020', sourcemap: 'inline', charset: 'utf8', logLevel: 'error' });
  } else {
    const bun = [process.env.BUN, '/root/.bun/bin/bun', 'bun'].find((b) => b && (b === 'bun' || existsSync(b)));
    execFileSync(bun, ['build', join(root, 'client/main.js'), '--outfile', out, '--format', 'esm', '--external', 'three', '--external', 'three/addons/*', '--sourcemap=inline'], { stdio: 'inherit' });
  }
  return { out, ms: Date.now() - t0, tool: esb ? 'esbuild' : 'bun' };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };

export function serve({ port = 0, noGlb = false } = {}) {
  if (!threeDir) throw new Error('three r160 을 못 찾음 (THREE_DIR 지정)');
  const stats = { req: 0, bytes: 0, miss: [] };
  const srv = createServer((q, r) => {
    const u = new URL(q.url, 'http://x');
    let p = decodeURIComponent(u.pathname);
    let file = null, body = null;
    if (p === '/' || p === '/index.html') {
      body = readFileSync(join(root, 'public/index.html'), 'utf8')
        .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/three@[\d.]+\//g, '/three/')
        .replace(/<link[^>]+fonts\.(googleapis|gstatic)[^>]*>/g, '');
      r.writeHead(200, { 'content-type': MIME['.html'] }); r.end(body); stats.req++; return;
    }
    if (p === '/app.js') file = join(outDir, 'app.js');
    else if (p.startsWith('/three/')) file = threeDirs.map((d) => join(d, p.slice(7))).find((f) => existsSync(f)) || join(threeDir, p.slice(7));
    else if (p.startsWith('/api/')) { r.writeHead(200, { 'content-type': 'application/json' }); r.end(p === '/api/rooms' ? '{"rooms":[]}' : '{}'); return; }
    else file = join(root, 'public', p);
    if (noGlb && /player\.glb$/.test(p)) file = null;
    if (!file || !existsSync(file) || statSync(file).isDirectory()) { stats.miss.push(p); r.writeHead(404, { 'content-type': 'text/plain' }); r.end('nf'); return; }
    const b = readFileSync(file); stats.req++; stats.bytes += b.length;
    r.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    r.end(q.method === 'HEAD' ? undefined : b);
  });
  return new Promise((ok) => srv.listen(port, '127.0.0.1', () => ok({ srv, port: srv.address().port, stats })));
}
