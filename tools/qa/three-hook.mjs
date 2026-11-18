// [qa] node 에서 'three' / 'three/addons/*' 를 로컬 사본으로 잇는 resolve 훅 (npm 설치가 안 되는 환경용)
// 사용: node --import ./tools/qa/three-hook.mjs --test tests/*.test.mjs
import { register } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = new URL('../../', import.meta.url).pathname;
const dirs = [process.env.THREE_DIR, join(root, 'node_modules/three'), '/tmp/three160', '/tmp/anim-three'].filter((d) => d && existsSync(join(d, 'build/three.module.js')));
const code = `const dirs=${JSON.stringify(dirs)};import {existsSync} from 'node:fs';import {pathToFileURL} from 'node:url';
export async function resolve(s,c,n){let rel=null;if(s==='three')rel='build/three.module.js';else if(s.startsWith('three/addons/'))rel='examples/jsm/'+s.slice(13);else if(s.startsWith('three/examples/'))rel=s.slice(6);
if(rel){for(const d of dirs){const f=d+'/'+rel;if(existsSync(f))return{url:pathToFileURL(f).href,shortCircuit:true};}}return n(s,c);}`;
register('data:text/javascript,' + encodeURIComponent(code), pathToFileURL(root));
