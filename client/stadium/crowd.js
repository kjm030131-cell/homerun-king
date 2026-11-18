// stadium/crowd.js — 관중: 1인 = 카메라를 보는 사각형 2삼각형(빌보드) + 사람 아틀라스(앉음/만세 x 4체형)
// v20의 저폴리 3D 관중(1인 56삼각형, 약 1.5만 명 = 86만 삼각형)을 대체 → 2만 명이어도 4만 삼각형.
// 각도 구역(12개)별로 따로 그려 화면 밖 구역은 통째로 컬링. 품질 단계는 instanceCount 로 밀도만 줄임(재생성 없음).
import * as THREE from 'three';
import { canvasTex, rng } from './util.js';

const FW = 128, FH = 256, COLS = 4, ROWS = 2; // 아틀라스 칸
const QW = 0.64, QH = 1.2; // 사람 판 크기(m): 앉은 상반신 + 만세 팔 여유

// 채널 인코딩: R = 옷(인스턴스 색으로 칠함), G = 피부, B = 머리카락·모자(어두운색), A = 모양
function drawPerson(g, col, up) {
  const x0 = col * FW, y0 = up * FH;
  const S = (v) => `rgb(${v},0,0)`, K = (v) => `rgb(0,${v},0)`, D = (v) => `rgb(0,0,${v})`;
  const cx = x0 + FW / 2;
  const wide = col === 3 ? 1.12 : col === 2 ? 0.94 : 1;
  const headY = y0 + 128, headR = 19;
  // 몸통(사다리꼴) — 아래쪽(앞줄에 가려지는 쪽)까지 꽉
  g.fillStyle = S(235);
  g.beginPath(); g.moveTo(cx - 40 * wide, y0 + 160); g.lineTo(cx + 40 * wide, y0 + 160); g.lineTo(cx + 34 * wide, y0 + FH); g.lineTo(cx - 34 * wide, y0 + FH); g.closePath(); g.fill();
  // 어깨 둥글게
  for (const sx of [-1, 1]) { g.beginPath(); g.arc(cx + sx * 33 * wide, y0 + 168, 11, 0, Math.PI * 2); g.fill(); }
  // 옷 음영(왼쪽 어둡게)
  g.fillStyle = S(170); g.fillRect(cx - 34 * wide, y0 + 172, 12, FH - 172);
  // 팔
  if (!up) {
    g.fillStyle = S(205);
    for (const sx of [-1, 1]) { g.beginPath(); g.moveTo(cx + sx * 36 * wide, y0 + 166); g.lineTo(cx + sx * 44 * wide, y0 + 168); g.lineTo(cx + sx * 34 * wide, y0 + 236); g.lineTo(cx + sx * 24 * wide, y0 + 234); g.closePath(); g.fill(); }
    g.fillStyle = K(225); for (const sx of [-1, 1]) { g.beginPath(); g.arc(cx + sx * 26 * wide, y0 + 236, 7, 0, Math.PI * 2); g.fill(); }
  } else {
    g.fillStyle = S(215); g.lineCap = 'round';
    for (const sx of [-1, 1]) {
      g.strokeStyle = S(215); g.lineWidth = 13; g.beginPath(); g.moveTo(cx + sx * 34 * wide, y0 + 166); g.lineTo(cx + sx * 46, y0 + 112); g.stroke();
      g.strokeStyle = K(225); g.lineWidth = 11; g.beginPath(); g.moveTo(cx + sx * 46, y0 + 112); g.lineTo(cx + sx * 50, y0 + 58); g.stroke();
      g.fillStyle = K(235); g.beginPath(); g.arc(cx + sx * 51, y0 + 50, 8, 0, Math.PI * 2); g.fill();
    }
  }
  // 목 + 머리
  g.fillStyle = K(200); g.fillRect(cx - 8, headY + 12, 16, 22);
  g.fillStyle = K(240); g.beginPath(); g.ellipse(cx, headY, headR * 0.9, headR, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = K(185); g.beginPath(); g.ellipse(cx - 6, headY + 3, 7, 12, 0, 0, Math.PI * 2); g.fill(); // 얼굴 음영
  // 머리카락/모자 변형
  g.fillStyle = D(235);
  if (col === 1) { // 야구모자
    g.beginPath(); g.ellipse(cx, headY - 6, headR * 0.98, headR * 0.72, 0, Math.PI, 0); g.fill();
    g.fillRect(cx - headR, headY - 8, headR * 2.0, 6); g.fillRect(cx - 4, headY - 8, headR + 8, 5);
  } else if (col === 2) { // 긴 머리
    g.beginPath(); g.ellipse(cx, headY - 2, headR * 1.02, headR * 1.05, 0, Math.PI * 0.95, Math.PI * 2.05); g.fill();
    g.fillRect(cx - headR, headY - 2, 8, 34); g.fillRect(cx + headR - 8, headY - 2, 8, 34);
  } else { // 짧은 머리
    g.beginPath(); g.ellipse(cx, headY - 5, headR * 0.95, headR * 0.8, 0, Math.PI, 0); g.fill();
  }
}

export function buildCrowd(world, seats, Q) {
  const atlas = canvasTex(FW * COLS, FH * ROWS, (g) => { for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) drawPerson(g, c, r); });
  atlas.colorSpace = THREE.NoColorSpace; // 채널 = 마스크(색 아님)
  atlas.premultiplyAlpha = true; // 밉맵에서 가장자리 어두워짐 방지 → 셰이더에서 a로 나눔
  const uni = { uTime: { value: 0 }, uExcite: { value: 0 }, uLight: { value: new THREE.Vector3(1, 1, 1) }, uAtlas: { value: atlas } };
  const mat = new THREE.ShaderMaterial({
    uniforms: uni,
    vertexShader: `attribute vec3 aPos; attribute vec3 aCol; attribute vec4 aDat; attribute vec2 aSkin;
      uniform float uTime; uniform float uExcite;
      varying vec2 vUv; varying vec3 vShirt; varying vec3 vSkin; varying float vShade;
      void main(){
        float rnd = aDat.x, cheer = aDat.y;
        float ph = uTime * (5.0 + rnd * 3.0) + rnd * 40.0;
        float act = clamp(cheer * 0.55 + uExcite, 0.0, 1.0) * step(0.3, rnd + uExcite * 0.8 + cheer * 0.4);
        float jump = max(0.0, sin(ph)) * 0.32 * act + sin(uTime * 1.1 + rnd * 20.0) * 0.012;
        float up = step(0.45, act) * step(0.0, sin(ph * 0.5 + rnd * 6.0));
        vec3 toCam = cameraPosition - aPos; toCam.y = 0.0;
        vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(1e-4, 0.0, 0.0));
        vec3 p = aPos + right * (position.x * ${QW.toFixed(2)} * aDat.w) + vec3(0.0, position.y * ${QH.toFixed(2)} * aDat.w + jump, 0.0);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        vUv = vec2((aDat.z + uv.x) / ${COLS.toFixed(1)}, 1.0 - (up + 1.0 - uv.y) / ${ROWS.toFixed(1)});
        vShirt = aCol; vSkin = vec3(aSkin.x, aSkin.x * 0.74, aSkin.x * 0.58); vShade = aSkin.y;
      }`,
    fragmentShader: `uniform sampler2D uAtlas; uniform vec3 uLight;
      varying vec2 vUv; varying vec3 vShirt; varying vec3 vSkin; varying float vShade;
      void main(){
        vec4 t = texture2D(uAtlas, vUv);
        if (t.a < 0.38) discard;
        vec3 w = t.rgb / max(t.a, 1e-3);
        vec3 c = vShirt * w.r + vSkin * w.g + vec3(0.035, 0.03, 0.028) * w.b;
        gl_FragColor = vec4(c * uLight * vShade, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  mat.name = 'crowd';
  // ── 인스턴스 데이터 ──
  const R = rng(77);
  const count = seats.length / 4;
  const SECT = 12, buckets = Array.from({ length: SECT }, () => []);
  for (let i = 0; i < count; i++) {
    const f = seats[i * 4 + 3];
    // 좌석 점유율: 응원석 > 내야 > 3층 > 외야
    const occ = f & 1 ? 0.96 : f & 4 ? 0.7 : f & 2 ? 0.74 : 0.84;
    if (R() > occ) continue;
    const ang = Math.atan2(seats[i * 4], seats[i * 4 + 2]);
    buckets[Math.min(SECT - 1, Math.max(0, Math.floor((ang + Math.PI) / (2 * Math.PI) * SECT)))].push(i);
  }
  const shirts = ['#e8e1d3', '#f4f4f4', '#7c8aa8', '#202330', '#e2486a', '#3a5fa8', '#d6c9a5', '#556b4f', '#ffffff', '#9a2b33'].map((h) => new THREE.Color(h));
  const home = new THREE.Color('#1d2f63'), away = new THREE.Color('#c2323b'), cTmp = new THREE.Color();
  const quad = new THREE.PlaneGeometry(1, 1); quad.translate(0, 0.5, 0);
  const group = new THREE.Group(); group.name = 'crowd';
  const meshes = [];
  let total = 0;
  for (const ids of buckets) {
    if (!ids.length) continue;
    for (let i = ids.length - 1; i > 0; i--) { const j = (R() * (i + 1)) | 0; [ids[i], ids[j]] = [ids[j], ids[i]]; } // 섞기 → 앞에서부터 n명 = 고른 밀도
    const n = ids.length;
    const aPos = new Float32Array(n * 3), aCol = new Float32Array(n * 3), aDat = new Float32Array(n * 4), aSkin = new Float32Array(n * 2);
    const box = new THREE.Box3();
    ids.forEach((i, j) => {
      const x = seats[i * 4], y = seats[i * 4 + 1], z = seats[i * 4 + 2], f = seats[i * 4 + 3];
      aPos.set([x, y + 0.3, z], j * 3);
      box.expandByPoint(new THREE.Vector3(x, y, z));
      let c = shirts[(R() * shirts.length) | 0];
      if (!(f & 6) && R() < (f & 1 ? 0.7 : 0.4)) c = f & 8 ? home : away; // 내야: 3루(+x) 홈팬 남색 / 1루 원정팬 빨강
      cTmp.copy(c).multiplyScalar(0.75 + R() * 0.3);
      aCol.set([cTmp.r, cTmp.g, cTmp.b], j * 3);
      aDat.set([R(), f & 1 ? 1 : 0, (R() * COLS) | 0, 0.9 + R() * 0.18], j * 4);
      aSkin.set([[0.62, 0.5, 0.42, 0.3][(R() * 4) | 0], 0.82 + R() * 0.26], j * 2);
    });
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index; g.setAttribute('position', quad.attributes.position); g.setAttribute('uv', quad.attributes.uv);
    g.setAttribute('aPos', new THREE.InstancedBufferAttribute(aPos, 3));
    g.setAttribute('aCol', new THREE.InstancedBufferAttribute(aCol, 3));
    g.setAttribute('aDat', new THREE.InstancedBufferAttribute(aDat, 4));
    g.setAttribute('aSkin', new THREE.InstancedBufferAttribute(aSkin, 2));
    g.instanceCount = n;
    g.boundingBox = box.clone().expandByScalar(2);
    g.boundingSphere = box.getBoundingSphere(new THREE.Sphere()); g.boundingSphere.radius += 2.5; // 응원 동작 여유
    const m = new THREE.Mesh(g, mat); m.userData.full = n; m.userData.sh = 'none';
    group.add(m); meshes.push(m); total += n;
  }
  world.add(group);
  return {
    group, uni, total,
    setDensity(d) { let shown = 0; for (const m of meshes) { m.geometry.instanceCount = Math.max(1, Math.round(m.userData.full * d)); shown += m.geometry.instanceCount; } return shown; },
    update(t, excite) { uni.uTime.value = t; uni.uExcite.value = excite; },
  };
}
