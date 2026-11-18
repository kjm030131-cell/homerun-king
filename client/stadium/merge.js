// stadium/merge.js — 정적 메시 병합: 같은 재질·같은 속성 구성·같은 그림자 태그끼리 한 덩어리로 → 드로우콜 수백 개 절약
// 제외: 투명 재질, 인스턴싱, 스프라이트/점, userData.keep, skip 목록(낮/밤에 따로 켜고 끄는 것 = todRefs)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function mergeStatic(world, skipObjs = []) {
  world.updateMatrixWorld(true);
  const skip = new Set();
  for (const o of skipObjs) if (o && o.traverse) o.traverse((c) => skip.add(c));
  const inv = new THREE.Matrix4().copy(world.matrixWorld).invert(), mtx = new THREE.Matrix4();
  const groups = new Map();
  world.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || skip.has(o) || Array.isArray(o.material) || !o.visible || o.userData.keep) return;
    const m = o.material; if (!m || m.transparent || o.geometry.isInstancedBufferGeometry) return;
    let p = o.parent, ok = true; while (p && p !== world) { if (!p.visible || skip.has(p)) { ok = false; break; } p = p.parent; } if (!ok) return;
    const g = o.geometry; if (!g || !g.attributes.position || g.morphAttributes.position) return;
    const sig = Object.keys(g.attributes).sort().map((k) => k + g.attributes[k].itemSize).join(',') + '|' + (g.index ? 1 : 0);
    const key = m.uuid + '|' + sig + '|' + (o.userData.sh || 'none') + '|' + o.renderOrder;
    if (!groups.has(key)) groups.set(key, { mat: m, list: [], sh: o.userData.sh || 'none', ro: o.renderOrder });
    groups.get(key).list.push(o);
  });
  let merged = 0, meshes = 0;
  for (const G of groups.values()) {
    if (G.list.length < 2) continue;
    const geos = G.list.map((o) => { const c = o.geometry.clone(); mtx.multiplyMatrices(inv, o.matrixWorld); c.applyMatrix4(mtx); return c; });
    let mg = null; try { mg = mergeGeometries(geos, false); } catch (e) { mg = null; }
    geos.forEach((c) => c.dispose());
    if (!mg) continue;
    const mesh = new THREE.Mesh(mg, G.mat); mesh.userData.sh = G.sh; mesh.renderOrder = G.ro; mesh.name = 'merged:' + (G.mat.name || '');
    world.add(mesh); meshes++;
    for (const o of G.list) { o.parent && o.parent.remove(o); merged++; }
  }
  // 비어 버린 그룹 정리
  const empty = []; world.traverse((o) => { if (o !== world && o.isGroup && o.children.length === 0) empty.push(o); });
  for (const o of empty) o.parent && o.parent.remove(o);
  return { merged, meshes };
}

// 그림자 태그 → cast/receive (품질·낮밤에 따라 런타임 전환, receiveShadow 는 셰이더 uniform 이라 재컴파일 없음)
// ground: 받기만 / struct: 낮은 벽·덕아웃 / stand: 관중석 / big: 3층·지붕·외벽·마스트 / none
export function applyShadowTags(world, { q, day }) {
  const hi = q === 'high', on = q !== 'low';
  const rules = {
    ground: [false, on],
    struct: [on && day, on],
    stand: [hi && day, hi],
    big: [hi && day, false],
    none: [false, false],
  };
  world.traverse((o) => { if (!o.isMesh) return; const r = rules[o.userData.sh || 'none'] || rules.none; o.castShadow = r[0]; o.receiveShadow = r[1]; });
}
