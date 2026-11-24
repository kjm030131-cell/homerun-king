// stadium/ads.js — 광고 아틀라스 + 회전 LED 셰이더 + 곡선 따라 광고판 나열
// 슬롯 규칙(고정): ad01~ad11 = 외야 펜스 고정 광고, ad12~ad22 = LED 회전 광고(파울 벽·3층 리본·전광판 옆)
import * as THREE from 'three';

export const AD_FIXED = [0, 11]; // [시작, 개수] → ad01..ad11
export const AD_LED = [11, 11]; //  ad12..ad22
const COLS = 4, CW = 512, CH = 102;

export function createAds(urls) {
  const N = Math.max(4, urls.length || 0);
  const ROWS = Math.ceil(Math.max(N, 22) / COLS);
  const canvas = document.createElement('canvas'); canvas.width = CW * COLS; canvas.height = CH * ROWS;
  const g = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const fallback = [['#0b1b33', '#c9a227', 'WALK-OFF'], ['#1e4f8c', '#ffffff', 'PLAY BALL'], ['#b52a2f', '#ffffff', 'BALLPARK'], ['#202835', '#ff9b3d', 'SEOUL NIGHT']];
  const drawFallback = (i) => {
    const [bg, fg, t] = fallback[i % fallback.length], x = (i % COLS) * CW, y = Math.floor(i / COLS) * CH;
    g.fillStyle = bg; g.fillRect(x, y, CW, CH); g.fillStyle = fg; g.font = '900 46px Oswald, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, x + CW / 2, y + CH / 2 + 2);
  };
  for (let i = 0; i < ROWS * COLS; i++) drawFallback(i);
  (urls || []).forEach((u, i) => { const img = new Image(); img.onload = () => { g.drawImage(img, (i % COLS) * CW, Math.floor(i / COLS) * CH, CW, CH); tex.needsUpdate = true; }; img.src = u; });
  // 실제 있는 광고 수에 맞춰 슬롯 범위 보정 (광고가 22개보다 적어도 깨지지 않게)
  const fixed = N >= 22 ? AD_FIXED : [0, Math.max(1, Math.ceil(N / 2))];
  const led = N >= 22 ? AD_LED : [fixed[1] % N, Math.max(1, N - fixed[1])];
  const cellUV = (k) => { const c = k % COLS, r = Math.floor(k / COLS); return [c / COLS, 1 - (r + 1) / ROWS, (c + 1) / COLS, 1 - r / ROWS]; };
  const U = { uStep: { value: 0 }, uFlash: { value: 0 }, uB: { value: 1.15 } };
  let ledMat = null;
  function ledMaterial() {
    if (ledMat) return ledMat;
    ledMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, uStep: U.uStep, uFlash: U.uFlash, uB: U.uB },
      vertexShader: `attribute float aSlot; attribute vec2 aLuv; varying vec2 vL; varying float vS;
        void main(){ vL = aLuv; vS = aSlot; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D map; uniform float uStep; uniform float uFlash; uniform float uB; varying vec2 vL; varying float vS;
        void main(){
          float k = ${led[0].toFixed(1)} + mod(floor(vS + uStep + 0.5), ${led[1].toFixed(1)});
          float c = mod(k, ${COLS.toFixed(1)}); float r = floor(k / ${COLS.toFixed(1)});
          vec2 uv = vec2((c + clamp(vL.x, 0.002, 0.998)) / ${COLS.toFixed(1)}, 1.0 - (r + 1.0 - clamp(vL.y, 0.01, 0.99)) / ${ROWS.toFixed(1)});
          vec3 col = texture2D(map, uv).rgb;
          float dots = 0.8 + 0.2 * step(0.35, fract(vL.y * 34.0)) * step(0.3, fract(vL.x * 170.0));
          col = col * dots * uB + vec3(uFlash * 0.5);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.DoubleSide,
    });
    ledMat.name = 'led';
    return ledMat;
  }
  let fixedMat = null;
  const fixedMaterial = () => fixedMat || (fixedMat = Object.assign(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, side: THREE.DoubleSide }), { name: 'adsFixed' }));
  // 곡선(rFn)을 따라 광고판(직사각형) 나열. 필드 쪽에서 보면 글자가 바로 읽히도록 UV 배치
  // led=true면 aSlot(0,1,2…)으로 회전 셰이더가 칸을 고름, 아니면 고정 슬롯 순환
  function panels(parent, { from, to, rFn, y0, h, panelW, slot0 = 0, gap = 0.04, led = false }) {
    const pos = [], uv = [], slots = [], luv = [], idx = [];
    const dir = Math.sign(to - from);
    let phi = from, k = slot0, n = 0;
    while (dir > 0 ? phi < to : phi > to) {
      const r = rFn(phi);
      const p2 = phi + dir * panelW / r;
      if (dir > 0 ? p2 > to + 1e-6 : p2 < to - 1e-6) break;
      const pe = p2 - dir * gap / r;
      const ra = rFn(phi), rb = rFn(pe);
      const ax = Math.sin(phi) * ra, az = Math.cos(phi) * ra, bx = Math.sin(pe) * rb, bz = Math.cos(pe) * rb;
      const [L, Rr] = dir > 0 ? [[bx, bz], [ax, az]] : [[ax, az], [bx, bz]]; // 필드에서 볼 때 phi 큰 쪽이 왼쪽
      const ya = typeof y0 === 'function' ? y0(phi) : y0, yb = typeof y0 === 'function' ? y0(pe) : y0;
      const [yL, yR] = dir > 0 ? [yb, ya] : [ya, yb];
      const base = n * 4;
      pos.push(L[0], yL, L[1], Rr[0], yR, Rr[1], Rr[0], yR + h, Rr[1], L[0], yL + h, L[1]);
      const cell = fixed[0] + (((k % fixed[1]) + fixed[1]) % fixed[1]);
      const [u0, v0, u1, v1] = cellUV(cell);
      uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
      luv.push(0, 0, 1, 0, 1, 1, 0, 1);
      slots.push(k, k, k, k);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      phi = p2; k++; n++;
    }
    if (!n) return { mesh: null, count: 0 };
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('aLuv', new THREE.Float32BufferAttribute(luv, 2));
    geo.setAttribute('aSlot', new THREE.Float32BufferAttribute(slots, 1));
    geo.setIndex(idx); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, led ? ledMaterial() : fixedMaterial());
    m.userData.sh = 'none';
    parent.add(m);
    return { mesh: m, count: n };
  }
  // 평면 LED 판 하나 (전광판 옆 보조 화면 등): w×h, slot 번호
  function ledPlane(w, h, slot) {
    const geo = new THREE.PlaneGeometry(w, h);
    const n = geo.attributes.position.count;
    geo.setAttribute('aLuv', new THREE.Float32BufferAttribute(geo.attributes.uv.array.slice(), 2));
    geo.setAttribute('aSlot', new THREE.Float32BufferAttribute(new Array(n).fill(slot), 1));
    return new THREE.Mesh(geo, ledMaterial());
  }
  return {
    tex, U, panels, ledPlane, ledMaterial,
    update(t) { const step = Math.floor(t / 8), ph = t / 8 - step; U.uStep.value = step; U.uFlash.value = ph < 0.04 ? 1 - ph / 0.04 : 0; },
  };
}
