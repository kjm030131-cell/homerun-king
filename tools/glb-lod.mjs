// glb-lod.mjs — player.glb 의 몸 메시로 저폴리 인덱스(player.lod.bin)를 만든다. 정점은 그대로 공유, 삼각형만 줄임(meshoptimizer).
//   node tools/glb-lod.mjs [player.glb] [비율=0.3]
// tools/build.mjs 가 빌드 때 자동으로 부른다(파일이 없거나 GLB 보다 오래됐을 때만). 형식: 'HRL1' u32 개수, u32 인덱스[]
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';

export function readGlb(buf) {
  const u32 = new Uint32Array(buf.buffer, buf.byteOffset, 3);
  if (u32[0] !== 0x46546c67) throw new Error('GLB 아님');
  let o = 12, json = null, bin = null;
  while (o < buf.length) {
    const len = buf.readUInt32LE(o), type = buf.readUInt32LE(o + 4);
    const chunk = buf.subarray(o + 8, o + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8')); else if (type === 0x004e4942) bin = chunk;
    o += 8 + len;
  }
  return { json, bin };
}
const COMP = { 5121: [Uint8Array, 1], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
export function accessor(g, i) {
  const a = g.json.accessors[i], bv = g.json.bufferViews[a.bufferView];
  const [T, sz] = COMP[a.componentType], nc = NC[a.type], stride = bv.byteStride || sz * nc;
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0), out = new T(a.count * nc);
  const dv = new DataView(g.bin.buffer, g.bin.byteOffset, g.bin.byteLength);
  const rd = { 5121: (p) => dv.getUint8(p), 5123: (p) => dv.getUint16(p, true), 5125: (p) => dv.getUint32(p, true), 5126: (p) => dv.getFloat32(p, true) }[a.componentType];
  for (let k = 0; k < a.count; k++) for (let c = 0; c < nc; c++) out[k * nc + c] = rd(base + k * stride + c * sz);
  return out;
}
// 런타임(three 로더)과 같은 순서: 장면 노드 깊이 우선 → 스킨 붙은 첫 메시의 첫 primitive
export function firstSkinPrim(json) {
  const sc = json.scenes[json.scene || 0];
  const walk = (ni) => { const n = json.nodes[ni]; if (n.mesh != null && n.skin != null) return json.meshes[n.mesh].primitives[0]; for (const c of n.children || []) { const r = walk(c); if (r) return r; } return null; };
  for (const ni of sc.nodes) { const r = walk(ni); if (r) return r; }
  return null;
}

export async function makeLod(glbPath, outPath, ratio = 0.3, force = false) {
  if (!existsSync(glbPath)) return null;
  if (!force && existsSync(outPath) && statSync(outPath).mtimeMs >= statSync(glbPath).mtimeMs) return null;
  const g = readGlb(readFileSync(glbPath));
  if ((g.json.extensionsUsed || []).some((e) => /meshopt|draco/i.test(e))) { console.warn('[lod] 압축된 GLB 는 건너뜀(압축 전에 LOD 를 만들 것)'); return null; }
  const prim = firstSkinPrim(g.json);
  if (!prim || prim.indices == null) { console.warn('[lod] 스킨 메시/인덱스 없음'); return null; }
  const idx = Uint32Array.from(accessor(g, prim.indices)), pos = accessor(g, prim.attributes.POSITION);
  const { MeshoptSimplifier } = await import('meshoptimizer');
  await MeshoptSimplifier.ready;
  const target = Math.floor(idx.length * ratio / 3) * 3;
  const [lo, err] = MeshoptSimplifier.simplify(idx, pos, 3, target, 0.02, []);
  const out = Buffer.alloc(8 + lo.length * 4);
  out.writeUInt32LE(0x314c5248, 0); out.writeUInt32LE(lo.length, 4);
  Buffer.from(lo.buffer, lo.byteOffset, lo.byteLength).copy(out, 8);
  writeFileSync(outPath, out);
  console.log(`[lod] ${outPath}: 삼각형 ${idx.length / 3} → ${lo.length / 3} (오차 ${err.toFixed(4)})`);
  return { tri: idx.length / 3, lo: lo.length / 3 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = new URL('../', import.meta.url).pathname;
  const src = process.argv[2] || root + 'public/assets/models/player.glb';
  await makeLod(src, src.replace(/\.glb$/, '.lod.bin'), +(process.argv[3] || 0.3), true);
}
