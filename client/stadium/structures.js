// stadium/structures.js — 덕아웃, 불펜, 조명탑(마스트+지붕 위 램프 뱅크), 구단 깃발
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CLUBS } from '../../shared/clubs.js';
import { DUGOUT, WALL_FOUL, upperAt, roofAt, outfieldAt, lowerAt } from './layout.js';
import { DEG, textMesh, glowTex, boxAt } from './util.js';

const toMesh = (geos, mat, sh = 'none') => { const m = new THREE.Mesh(mergeGeometries(geos), mat); m.userData.sh = sh; return m; };
// 인덱스 형식 맞추기(병합은 전부 indexed 여야 함)
const idx = (g) => { if (!g.index) { const n = g.attributes.position.count; g.setIndex(Array.from({ length: n }, (_, i) => i)); } return g; };

export function buildDugouts(world, M) {
  for (const s of [-1, 1]) {
    const t = (DUGOUT.t0 + DUGOUT.t1) / 2, len = DUGOUT.t1 - DUGOUT.t0 - 0.6;
    const ux = s * Math.SQRT1_2, uz = Math.SQRT1_2, ox = s * Math.SQRT1_2, oz = -Math.SQRT1_2;
    const cx = ux * t + ox * DUGOUT.wall, cz = uz * t + oz * DUGOUT.wall;
    const g = new THREE.Group(); g.position.set(cx, 0, cz);
    g.rotation.y = Math.atan2(-ox, -oz); // 로컬 +z = 그라운드 쪽
    const inner = new THREE.MeshStandardMaterial({ color: '#141a26', roughness: 0.9, name: 'dugoutIn' });
    const club = new THREE.MeshStandardMaterial({ color: s > 0 ? '#16244a' : '#5a1820', roughness: 0.6, name: 'dugoutClub' });
    const D = DUGOUT.depth;
    const parts = [
      [boxAt(len, 2.4, 0.3, 0, 0.35, -D - 0.25), inner], // 뒷벽
      [boxAt(len, 0.12, D + 0.6, 0, -0.85, -D / 2), M.concrete], // 바닥(그라운드보다 0.85m 낮음)
      [boxAt(len - 1.5, 0.12, 0.55, 0, -0.42, -D + 0.45), club], // 벤치 좌판
      [boxAt(len - 1.5, 0.45, 0.1, 0, -0.62, -D + 0.2), inner],
      [boxAt(0.3, 2.4, D + 0.6, -len / 2, 0.35, -D / 2), inner], [boxAt(0.3, 2.4, D + 0.6, len / 2, 0.35, -D / 2), inner],
      [boxAt(len, 0.08, 0.08, 0, 0.98, 0.42), M.rail], // 앞 난간
      [boxAt(len, 0.25, 0.35, 0, -0.05, 0.15), club], // 앞 턱(계단 첫단)
      [boxAt(len, 0.12, D, 0, 1.38, -D / 2 + 0.2), club], // 천장
    ];
    for (let i = -6; i <= 6; i++) parts.push([boxAt(0.06, 1.0, 0.06, i * (len / 13), 0.5, 0.42), M.rail]);
    const helmet = new THREE.MeshStandardMaterial({ color: s > 0 ? '#1c2f66' : '#a12a33', roughness: 0.4, name: 'helmet' + s });
    for (let i = 0; i < 9; i++) parts.push([boxAt(0.25, 0.32, 0.25, -len / 2 + 2 + i * 1.9, 1.0, -D - 0.02), helmet]); // 헬멧 선반
    for (const [geo, mat] of parts) { const m = new THREE.Mesh(geo, mat); m.userData.sh = 'struct'; g.add(m); }
    const sign = textMesh(s > 0 ? 'HOME' : 'VISITOR', 0.42, { color: '#ffd23a', bg: '#0b0f18', px: 72 });
    const L = lowerAt(Math.atan2(cx, cz));
    sign.position.set(0, (WALL_FOUL + L.y0) / 2 + 0.05, 0.04); g.add(sign);
    world.add(g);
  }
}

export function buildBullpens(world, M, dirtMat) {
  // 파울 지역, 라인 따라 홈에서 52~72m, 라인에서 9·13m 바깥 (두 레인). 투수판 → 홈 방향 = 라인과 평행
  const geos = [], fence = [];
  for (const s of [-1, 1]) {
    const ux = s * Math.SQRT1_2, uz = Math.SQRT1_2, nx = s * Math.SQRT1_2, nz = -Math.SQRT1_2;
    for (const d of [9.5, 13]) {
      const at = (t) => [ux * t + nx * d, uz * t + nz * d];
      const [mx, mz] = at(72);
      const prof = [[0, 0.22], [0.6, 0.22], [1.5, 0.06], [1.9, 0]].map(([r, y]) => new THREE.Vector2(r, y));
      const mm = new THREE.Mesh(new THREE.LatheGeometry(prof, 20), dirtMat); mm.position.set(mx, 0.01, mz); mm.userData.sh = 'ground'; world.add(mm);
      const [px, pz] = at(72 - 18.44);
      const plate = new THREE.Mesh(new THREE.CircleGeometry(1.4, 20).rotateX(-Math.PI / 2), dirtMat); plate.position.set(px, 0.012, pz); plate.userData.sh = 'ground'; world.add(plate);
      geos.push(boxAt(0.6, 0.04, 0.15, mx, 0.24, mz, Math.atan2(ux, uz)));
      geos.push(boxAt(0.43, 0.03, 0.43, px, 0.03, pz, Math.atan2(ux, uz) + Math.PI / 4));
    }
    // 불펜 벤치 + 지붕 (벽 쪽)
    const [bx, bz] = [ux * 62 + nx * 20.6, uz * 62 + nz * 20.6], ry = Math.atan2(ux, uz) + Math.PI / 2;
    fence.push(boxAt(12, 0.45, 0.5, bx, 0.22, bz, ry), boxAt(12.4, 0.1, 1.6, bx + nx * -0.3, 2.2, bz + nz * -0.3, ry));
    for (const k of [-6, 6]) fence.push(boxAt(0.1, 2.2, 0.1, bx + ux * k, 1.1, bz + uz * k, 0));
  }
  world.add(toMesh(geos.map(idx), new THREE.MeshStandardMaterial({ color: '#f7f7f2', roughness: 0.8, name: 'bpChalk' }), 'ground'));
  world.add(toMesh(fence.map(idx), M.steelDark, 'struct'));
}

// 조명탑: 마스트(외야 2 + 1·3루 2) + 지붕 앞단 램프 뱅크(4). 램프는 HDR 흰색(밤) → 블룸으로 빛남
export function buildLights(world, M, Q) {
  const frames = [], lamps = [], masts = [], glows = [];
  const target = new THREE.Vector3(0, -30, 50);
  function bank(x, y, z, w, h, nx, ny) {
    const o = new THREE.Object3D(); o.position.set(x, y, z); o.lookAt(target); o.updateMatrix();
    const mtx = o.matrix;
    const fr = new THREE.BoxGeometry(w + 0.6, h + 0.6, 0.8); fr.translate(0, 0, -0.35); fr.applyMatrix4(mtx); frames.push(fr);
    // lookAt: 로컬 +z 가 target(그라운드) 쪽 → 램프 판(+z 면)이 그라운드를 봄
    const cw = w / nx, ch = h / ny;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const L = new THREE.PlaneGeometry(cw * 0.8, ch * 0.72); L.translate(-w / 2 + (i + 0.5) * cw, -h / 2 + (j + 0.5) * ch, 0.08); L.applyMatrix4(mtx); lamps.push(L);
    }
    const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#fff3c4', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8, fog: false }));
    const at = new THREE.Vector3(x, y, z); gl.position.copy(at).add(target.clone().sub(at).normalize().multiplyScalar(1.5));
    gl.scale.set(w * 2.4, h * 3.2, 1); world.add(gl); glows.push(gl);
  }
  // 독립 마스트
  const mastSpots = [];
  for (const s of [-1, 1]) {
    { const p = s * 27 * DEG, O = outfieldAt(p), r = O.rT + 7; mastSpots.push([Math.sin(p) * r, Math.cos(p) * r, 58]); }
    { const p = s * 63 * DEG, U = upperAt(p), r = U.rT + 6; mastSpots.push([Math.sin(p) * r, Math.cos(p) * r, 62]); }
  }
  for (const [x, z, H] of mastSpots) {
    const c = new THREE.CylinderGeometry(0.7, 1.6, H, 10); c.translate(x, H / 2, z); masts.push(c);
    // 사다리·플랫폼
    const pl = new THREE.CylinderGeometry(2.2, 2.2, 0.3, 10); pl.translate(x, H - 5, z); masts.push(pl);
    bank(x, H, z, 17, 8, 7, 4);
  }
  // 지붕 앞단 램프 (홈 뒤)
  for (const d of [128, 158]) for (const s of [-1, 1]) {
    const p = s * d * DEG, R = roofAt(p), r = R.rFront + 1.2;
    bank(Math.sin(p) * r, R.yFront + 2.2, Math.cos(p) * r, 13, 3.6, 8, 2);
  }
  world.add(toMesh(frames, M.steelDark, 'none'));
  world.add(toMesh(lamps, M.lamp, 'none'));
  world.add(toMesh(masts, M.steel, 'big'));
  return { glows };
}

// 외야 뒷벽 위 구단 깃발 10개 (셰이더로 펄럭임)
export function buildFlags(world, M) {
  const geos = [], poles = [];
  const n = CLUBS.length;
  CLUBS.forEach((c, i) => {
    const side = i < n / 2 ? 1 : -1, k = i % (n / 2);
    const p = side * (14 + k * 7.2) * DEG;
    const O = outfieldAt(p), r = O.rT + 0.6, x = Math.sin(p) * r, z = Math.cos(p) * r, y = O.yT + 3.4;
    const pc = new THREE.CylinderGeometry(0.06, 0.08, 7, 6); pc.translate(x, y + 3.5, z); poles.push(pc);
    const f = new THREE.PlaneGeometry(2.6, 1.6, 6, 1); f.translate(1.3, 0, 0);
    const col = new THREE.Color(c.c1), col2 = new THREE.Color(c.c2);
    const pos = f.attributes.position, cols = [];
    for (let j = 0; j < pos.count; j++) { const cc = pos.getY(j) < -0.35 ? col2 : col; cols.push(cc.r, cc.g, cc.b); }
    f.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const wave = new Float32Array(pos.count); for (let j = 0; j < pos.count; j++) wave[j] = pos.getX(j) / 2.6;
    f.setAttribute('aWave', new THREE.Float32BufferAttribute(wave, 1));
    f.rotateY(p + Math.PI / 2); f.translate(x, y + 6.1, z);
    geos.push(f);
  });
  const uni = { uTime: { value: 0 } };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide, name: 'flags' });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uni.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; attribute float aWave;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += sin(uTime * 3.1 + aWave * 5.0 + position.x * 0.13) * 0.22 * aWave; transformed.x += cos(uTime * 2.3 + aWave * 4.0 + position.z * 0.1) * 0.12 * aWave;');
  };
  mat.customProgramCacheKey = () => 'hr-flag';
  const fm = new THREE.Mesh(mergeGeometries(geos), mat); fm.userData.sh = 'none'; fm.userData.keep = true; fm.frustumCulled = false; world.add(fm);
  world.add(toMesh(poles, M.rail, 'none'));
  return { uni };
}
