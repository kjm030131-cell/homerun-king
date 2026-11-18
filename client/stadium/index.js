// stadium/index.js — 홈런왕 볼파크 (오리지널 고급 구장 + 잠실 느낌) 조립
// 모듈: layout(규격) · field(그라운드) · fence(펜스·벽·그물·폴) · stands(관중석 볼·지붕·외벽) · crowd(빌보드 관중)
//       structures(덕아웃·불펜·조명탑·깃발) · scoreboard(전광판) · env(하늘·원경) · ads(광고) · merge(정적 병합·그림자 태그)
// 렌더러 톤매핑·조명·안개·블룸·낮/밤은 look.js (main.js 가 createLook 으로 연결)
import { SB } from './layout.js';
import { textTexes, redraw } from './util.js';
import { createMaterials } from './materials.js';
import { createAds } from './ads.js';
import { buildField } from './field.js';
import { buildFence } from './fence.js';
import { buildStands } from './stands.js';
import { buildCrowd } from './crowd.js';
import { buildDugouts, buildBullpens, buildLights, buildFlags } from './structures.js';
import { buildScoreboard } from './scoreboard.js';
import { buildEnv } from './env.js';
import { mergeStatic, applyShadowTags } from './merge.js';
import * as THREE from 'three';

export { canvasTex, textMesh, glowTex } from './util.js';
export { SEAT_ZONES } from './stands.js';
export { createLook } from './look.js';

// 그래픽 단계별 디테일. build* = 처음 만들 때만(새로고침 필요), 나머지는 setQuality 로 즉시 바뀜
export const STADIUM_Q = {
  low: { fieldRes: 2048, standSeg: 140, roofRibs: 10, cityBoxes: 50, crowd: 0.5, trees: false, glows: true },
  mid: { fieldRes: 2048, standSeg: 200, roofRibs: 14, cityBoxes: 80, crowd: 0.85, trees: true, glows: true },
  high: { fieldRes: 4096, standSeg: 240, roofRibs: 18, cityBoxes: 110, crowd: 1, trees: true, glows: true },
};

export function buildStadium(scene, opt = {}) {
  const q0 = STADIUM_Q[opt.quality] ? opt.quality : 'mid';
  const Q = STADIUM_Q[q0];
  const world = new THREE.Group(); world.name = 'stadium';
  scene.add(world);
  const M = createMaterials(opt);
  const ads = createAds(opt.ads || []);
  const field = buildField(world, opt, Q);
  buildFence(world, M, ads);
  const { seats } = buildStands(world, M, ads, Q);
  buildDugouts(world, M);
  buildBullpens(world, M, field.dirtMat);
  const lights = buildLights(world, M, Q);
  const flags = buildFlags(world, M);
  const sb = buildScoreboard(world, M, ads);
  const env = buildEnv(world, opt, Q, M);
  const crowd = buildCrowd(world, seats, Q);
  const mergeInfo = mergeStatic(world, [crowd.group, env.pano, env.skyMesh, env.trees]);
  sb.drawScoreboard(null);

  const state = { q: q0, day: false };
  function setQuality(q) {
    if (!STADIUM_Q[q]) return;
    state.q = q;
    const P = STADIUM_Q[q];
    crowd.setDensity(P.crowd);
    if (env.trees) env.trees.visible = P.trees;
    applyShadowTags(world, { q, day: state.day });
  }
  function setTimeOfDay(mode) {
    const day = mode === 'day';
    state.day = day;
    M.setNight(!day);
    env.setNight(!day);
    for (const g of lights.glows) g.visible = !day;
    crowd.uni.uLight.value.set(...(day ? [1.0, 0.98, 0.95] : [0.66, 0.64, 0.62]));
    ads.U.uB.value = day ? 1.0 : 1.25;
    applyShadowTags(world, { q: state.q, day });
  }
  env.onPano = () => setTimeOfDay(state.day ? 'day' : 'night');
  setQuality(q0);
  setTimeOfDay('night');
  return {
    world, crowd: crowd.group, SB, setTimeOfDay, setQuality,
    sky: env.sky, info: { seats: seats.length / 4, crowd: crowd.total, merged: mergeInfo },
    drawScoreboard: sb.drawScoreboard,
    refreshText() { for (const t of textTexes) redraw(t); sb.resetKey(); },
    update(t, excite) {
      crowd.update(t, excite);
      ads.update(t);
      flags.uni.uTime.value = t;
      env.sky.uTime.value = t;
    },
  };
}
