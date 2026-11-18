// glb-info.mjs — 넣은 GLB 가 제대로인지 바로 확인 (의존성 없음)
//   node tools/glb-info.mjs                       → public/assets/models/ 전체 점검
//   node tools/glb-info.mjs 파일.glb               → 그 파일 하나
// 보는 것: 크기, 메시·삼각형 수, 스킨·뼈(mixamorig 이름인지), 애니메이션 길이, 텍스처 크기, 압축 확장
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { readGlb } from './glb-lod.mjs';
import { CLIPS, CLIP_NAMES, REQUIRED, FILES } from '../client/anim/clips.js';

function info(path) {
  const buf = readFileSync(path), g = readGlb(buf), J = g.json;
  let tris = 0;
  for (const m of J.meshes || []) for (const p of m.primitives) tris += p.indices != null ? J.accessors[p.indices].count / 3 : J.accessors[p.attributes.POSITION].count / 3;
  const joints = (J.skins || []).flatMap((s) => s.joints.map((j) => J.nodes[j].name || ''));
  const anims = (J.animations || []).map((a) => {
    let dur = 0; for (const s of a.samplers) { const t = J.accessors[s.input]; dur = Math.max(dur, (t.max && t.max[0]) || 0); }
    return `${a.name || '?'} ${dur.toFixed(2)}s 채널 ${a.channels.length}`;
  });
  const imgs = (J.images || []).map((im) => { const bv = J.bufferViews[im.bufferView]; return `${im.mimeType || '?'} ${((bv ? bv.byteLength : 0) / 1024).toFixed(0)}KB`; });
  const nodeNames = (J.nodes || []).map((n) => n.name || '');
  return {
    kb: (buf.length / 1024).toFixed(0), tris, meshes: (J.meshes || []).length, skins: (J.skins || []).length, joints: joints.length,
    mixamo: (joints.length ? joints : nodeNames).some((n) => /mixamorig/i.test(n)), hips: nodeNames.find((n) => /Hips$/.test(n)) || null,
    anims, imgs, ext: J.extensionsUsed || [],
  };
}
const show = (p, I) => {
  console.log(`\n${p}  ${I.kb}KB`);
  console.log(`  메시 ${I.meshes}  삼각형 ${I.tris | 0}  스킨 ${I.skins}  뼈 ${I.joints}  Mixamo 이름 ${I.mixamo ? 'O' : 'X'}  Hips ${I.hips || '-'}`);
  if (I.anims.length) console.log('  애니메이션: ' + I.anims.join(' | '));
  if (I.imgs.length) console.log('  텍스처: ' + I.imgs.join(', '));
  if (I.ext.length) console.log('  확장: ' + I.ext.join(', '));
};
const root = new URL('../', import.meta.url).pathname, dir = root + 'public/assets/models/';
if (process.argv[2]) show(process.argv[2], info(process.argv[2]));
else {
  const warn = [];
  const p = dir + FILES.player;
  if (existsSync(p)) { const I = info(p); show(p, I); if (!I.skins) warn.push('player.glb 에 스킨 없음(Mixamo With Skin)'); if (!I.hips) warn.push('player.glb 에 Hips 뼈 없음'); if (I.tris > 60000) warn.push(`player.glb 삼각형 ${I.tris | 0} — 3만 이하 권장(렉)`); if (I.kb > 6000) warn.push('player.glb 6MB 넘음 — 텍스처 1024px 로'); }
  else warn.push('player.glb 없음 → 게임은 옛 몸으로 동작');
  for (const k of ['cap', 'helmet', 'bat', 'glove']) { const f = dir + FILES[k]; if (existsSync(f)) show(f, info(f)); else warn.push(`${FILES[k]} 없음 → 단순 대체 장비`); }
  const ad = dir + 'anim/';
  const have = existsSync(ad) ? readdirSync(ad).filter((f) => f.endsWith('.glb')).map((f) => f.slice(0, -4)) : [];
  let total = 0;
  for (const n of have) { const I = info(ad + n + '.glb'); total += +I.kb; if (!CLIPS[n]) warn.push(`anim/${n}.glb — 모르는 클립 이름(대소문자 확인)`); if (!I.anims.length) warn.push(`anim/${n}.glb 에 애니메이션 없음`); console.log(`  anim/${n}.glb ${I.kb}KB ${I.anims[0] || ''}`); }
  console.log(`\n클립 ${have.length}/${CLIP_NAMES.length}개, 합 ${total}KB`);
  const miss = CLIP_NAMES.filter((n) => !have.includes(n));
  if (miss.length) console.log('없는 클립: ' + miss.join(', '));
  const req = REQUIRED.filter((n) => !have.includes(n));
  if (req.length) warn.push('필수 클립 없음(이게 다 있어야 새 캐릭터로 바뀜): ' + req.join(', '));
  if (existsSync(dir + 'manifest.json')) try { JSON.parse(readFileSync(dir + 'manifest.json', 'utf8')); } catch (e) { warn.push('manifest.json JSON 오류: ' + e.message); }
  console.log(warn.length ? '\n확인할 것:\n - ' + warn.join('\n - ') : '\n문제 없음');
}
