// stadium/env.js — 하늘(그라데이션+해/구름, 밤 별·달·도시 불빛), 원경 파노라마 사진, 주변 도시(잠실 느낌: 한강·롯데타워), 광장·나무
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTex, glowTex, rng } from './util.js';

function windowTex(seed, lit) {
  const t = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#121824'; g.fillRect(0, 0, w, h);
    const R = rng(seed);
    const cw = w / 16, ch = h / 16;
    for (let r = 0; r < 16; r++) {
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, r * ch + ch - 3, w, 3);
      for (let c = 0; c < 16; c += 2) {
        const on = R() < lit, warm = R() < 0.8, a = 0.55 + R() * 0.4;
        g.fillStyle = on ? (warm ? `rgba(255,214,150,${a})` : `rgba(200,225,255,${a})`) : 'rgba(46,58,80,.9)';
        g.fillRect(c * cw + 2, r * ch + 3, cw * 2 - 4, ch - 7);
      }
    }
  }, true);
  return t;
}
let _dayWin = null;
function dayWindowTex() {
  if (_dayWin) return _dayWin;
  _dayWin = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#c3c9d2'; g.fillRect(0, 0, w, h);
    const R = rng(77), cw = w / 16, ch = h / 16;
    for (let r = 0; r < 16; r++) for (let c = 0; c < 16; c += 2) { const v = 80 + R() * 50; g.fillStyle = `rgb(${v * 0.78 | 0},${v * 0.92 | 0},${v * 1.15 | 0})`; g.fillRect(c * cw + 2, r * ch + 3, cw * 2 - 4, ch - 7); }
  }, true);
  return _dayWin;
}

export function buildEnv(world, opt, Q, M) {
  const refs = { winMats: [], nightOnly: [] };
  const R = rng(5);
  // ── 바깥 바닥(광장) ──
  const plazaTex = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#8a8f99'; g.fillRect(0, 0, w, h); for (let i = 0; i < 3000; i++) { g.fillStyle = R() < 0.5 ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.05)'; g.fillRect(R() * w, R() * h, 2, 2); } g.strokeStyle = 'rgba(0,0,0,.12)'; for (let i = 0; i < w; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); } }, true);
  plazaTex.repeat.set(150, 150);
  const plazaMat = new THREE.MeshStandardMaterial({ map: plazaTex, roughness: 1, color: '#9aa0aa', name: 'plaza' });
  const outer = new THREE.Mesh(new THREE.CircleGeometry(3200, 48).rotateX(-Math.PI / 2), plazaMat);
  outer.position.y = -0.35; outer.userData.sh = 'none'; world.add(outer);
  refs.plaza = { m: plazaMat, day: new THREE.Color('#9aa0aa'), night: new THREE.Color('#2a2f3a') };
  // ── 나무 (경기장 둘레) — 인스턴싱 1드로우콜 ──
  {
    const cone = new THREE.ConeGeometry(3.2, 9, 7); cone.translate(0, 8, 0);
    const trunk = new THREE.CylinderGeometry(0.35, 0.45, 4, 5); trunk.translate(0, 2, 0);
    const col = (g, c) => { const n = g.attributes.position.count, a = []; const cc = new THREE.Color(c); for (let i = 0; i < n; i++) a.push(cc.r, cc.g, cc.b); g.setAttribute('color', new THREE.Float32BufferAttribute(a, 3)); return g; };
    const tg = mergeGeometries([col(cone, '#2f5a30'), col(trunk, '#4a3626')]);
    const N = 180, im = new THREE.InstancedMesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, name: 'trees' }), N);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const a = i / N * Math.PI * 2 + R() * 0.02, r = 190 + R() * 60;
      const s = 0.8 + R() * 0.6;
      m4.compose(v.set(Math.sin(a) * r, -0.3, Math.cos(a) * r + 30), q.setFromAxisAngle(sc.set(0, 1, 0), R() * 6), sc.set(s, s * (0.9 + R() * 0.3), s));
      im.setMatrixAt(i, m4);
    }
    im.computeBoundingSphere(); im.userData.sh = 'none'; world.add(im);
    refs.trees = im;
  }
  // ── 주변 아파트·빌딩 (남·서쪽) ──
  {
    const winTexs = [windowTex(3, 0.42), windowTex(11, 0.55), windowTex(23, 0.3)];
    const groups = winTexs.map(() => []);
    const placeBox = (x, z, w, h, d, ry, gi) => {
      const b = new THREE.BoxGeometry(w, h, d);
      const uv = b.attributes.uv, nrm = b.attributes.normal;
      for (let k = 0; k < uv.count; k++) { const side = Math.abs(nrm.getX(k)) > 0.5 ? d : w; uv.setXY(k, uv.getX(k) * side / 40, Math.abs(nrm.getY(k)) > 0.5 ? 0.01 : uv.getY(k) * h / 46); }
      b.rotateY(ry); b.translate(x, h / 2 - 0.4, z);
      groups[gi].push(b);
    };
    const complexes = [[420, -300, 0.3], [700, -120, -0.2], [180, -620, 0.1], [-260, -700, 0.2], [-700, -420, -0.4], [650, 380, 0.5], [950, -600, 0.15], [-1100, -900, 0.3], [300, -1100, 0]];
    for (const [cx, cz, rot] of complexes) {
      for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) {
        const lx = (i - 2) * 70, lz = (j - 1) * 80;
        const x = cx + lx * Math.cos(rot) - lz * Math.sin(rot), z = cz + lx * Math.sin(rot) + lz * Math.cos(rot);
        if (Math.hypot(x, z - 40) < 330) continue;
        placeBox(x, z, 48 + R() * 18, 70 + R() * 40, 15, rot, (i + j) % 3);
      }
    }
    for (let i = 0; i < Q.cityBoxes; i++) { const a = R() * Math.PI * 2, r = 900 + R() * 900; placeBox(Math.cos(a) * r, Math.sin(a) * r + 40, 30 + R() * 40, 30 + Math.pow(R(), 2) * 120, 25 + R() * 20, R() * 3, i % 3); }
    // 강 건너 스카이라인
    for (let i = 0; i < Q.cityBoxes; i++) { const x = -2600 + R() * 5200, z = 1560 + R() * 600, w = 30 + R() * 50, h = 30 + Math.pow(R(), 2) * 140; placeBox(x, z, w, h, 30, 0, i % 3); }
    groups.forEach((gs, i) => { if (!gs.length) return; const mat = new THREE.MeshBasicMaterial({ map: winTexs[i], color: '#c0c6d4', name: 'city' + i }); const m = new THREE.Mesh(mergeGeometries(gs), mat); m.userData.sh = 'none'; m.userData.keep = true; world.add(m); refs.winMats.push(mat); (refs.city ||= []).push(m); }); // keep: 스카이라인 사진이 뜨면 숨김(병합 제외)
  }
  // ── 롯데월드타워 (남동쪽 약 2.3km, 555m) — 잠실 랜드마크 ──
  {
    const prof = [[48, 0], [46, 60], [43, 160], [38, 260], [31, 360], [21, 450], [11, 520], [3, 552], [0.6, 556]].map(([r, y]) => new THREE.Vector2(r, y));
    const body = new THREE.LatheGeometry(prof, 4); body.rotateY(Math.PI / 4);
    const strips = canvasTex(64, 512, (g, w, h) => { g.fillStyle = '#0a0e17'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 5) { g.fillStyle = `rgba(255,225,170,${0.3 + R() * 0.5})`; g.fillRect(2, y, w - 4, 2); } g.fillStyle = 'rgba(160,210,255,.85)'; g.fillRect(0, 0, 3, h); g.fillRect(w - 3, 0, 3, h); });
    const twm = new THREE.MeshBasicMaterial({ map: strips, fog: false, color: '#c9d3e6', name: 'tower' });
    const tw = new THREE.Mesh(body, twm); tw.position.set(-1620, -2, -1640); tw.userData.keep = true; world.add(tw);
    refs.tower = { mesh: tw, m: twm, night: strips, day: canvasTex(64, 512, (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#8fa3bb'); gr.addColorStop(0.5, '#d6e0ea'); gr.addColorStop(1, '#7d90a8'); g.fillStyle = gr; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 6) { g.fillStyle = 'rgba(40,60,90,.18)'; g.fillRect(0, y, w, 1); } }) };
    const beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#ff5a4a', transparent: true, blending: THREE.AdditiveBlending, fog: false, depthWrite: false }));
    beacon.scale.set(40, 40, 1); beacon.position.set(-1620, 558, -1640); world.add(beacon); refs.nightOnly.push(beacon); refs.tower.beacon = beacon;
  }
  // ── 한강 (북쪽 +z) + 다리 + 강변 불빛 ──
  {
    const riverTex = canvasTex(512, 512, (g, w, h) => { g.fillStyle = '#060b16'; g.fillRect(0, 0, w, h); for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${R() < 0.7 ? '255,210,150' : '170,200,255'},${0.08 + R() * 0.25})`; g.fillRect(R() * w, R() * h, 1 + R() * 3, 14 + R() * 40); } }, true);
    riverTex.repeat.set(6, 1);
    const rm = new THREE.MeshBasicMaterial({ map: riverTex, color: '#8fa0c0', name: 'river' });
    const river = new THREE.Mesh(new THREE.PlaneGeometry(6000, 900).rotateX(-Math.PI / 2), rm); river.position.set(0, -0.3, 1050); world.add(river);
    refs.river = { m: rm, nightMap: riverTex };
    const bridge = [];
    for (const bx of [520, -1350]) { bridge.push(new THREE.BoxGeometry(26, 2, 920).translate(bx, 10, 1050)); for (let z = 640; z <= 1460; z += 70) bridge.push(new THREE.BoxGeometry(14, 10, 6).translate(bx, 4.5, z)); }
    const bm = new THREE.Mesh(mergeGeometries(bridge), M.steelDark); bm.userData.sh = 'none'; world.add(bm);
    const pts = []; for (const bx of [520, -1350]) for (let z = 600; z <= 1500; z += 18) pts.push(bx - 12, 11.5, z, bx + 12, 11.5, z);
    for (let x = -3000; x <= 3000; x += 14) pts.push(x, 2, 590, x, 2, 1515);
    for (let i = 0; i < 70; i++) { const a = i / 70 * Math.PI * 2, r = 210 + (i % 2) * 18; pts.push(Math.cos(a) * r, 7, Math.sin(a) * r + 40); } // 광장 가로등
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const lp = new THREE.Points(lg, new THREE.PointsMaterial({ color: '#ffd59a', size: 3, sizeAttenuation: false, name: 'cityLights' })); world.add(lp); refs.nightOnly.push(lp);
  }
  // ── 원경 파노라마 사진 (서울 스카이라인, 낮/밤) — 위쪽은 하늘과 섞이게 알파 ──
  {
    // [stadium 11-24] 새 스카이라인(롯데타워)이 위쪽까지 보이게 알파 구간을 올림(전 0.42→0.62, 지금 0.05→0.16)
    const am = canvasTex(4, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#000'); gr.addColorStop(0.05, '#000'); gr.addColorStop(0.16, '#fff'); gr.addColorStop(1, '#fff'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
    const pano = new THREE.Mesh(new THREE.CylinderGeometry(3000, 3000, 1400, 96, 1, true), new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.BackSide, fog: false, transparent: true, opacity: 0, depthWrite: false, alphaMap: am, name: 'pano' }));
    pano.position.y = 610; pano.renderOrder = -1; world.add(pano); // [stadium 11-24] 1400m 높이: 사진 지평선 ≈ 고각 4°(외야석 위로 아파트), 타워 끝 ≈ 20° (전 640m·y250 은 관중석에 다 가려졌음)
    refs.pano = pano;
    const L = new THREE.TextureLoader();
    for (const k of ['skyDay', 'skyNight']) {
      const info = opt.tex && opt.tex[k]; if (!info || !info.url) continue;
      // [stadium 11-24] 잠실 스카이라인: 파일 = [원본(롯데타워) | 타워 지운 거울본] 이어 붙인 띠(이음매 없음, 타워 1개). 한 바퀴에 2번 → 타워는 180° 떨어져 한 화면엔 1개.
      //  실린더 u=0 이 중견수 방향(+z), u 는 3루 쪽(+x)으로 증가. 타워가 좌중간 뒤(u≈0.056)에 오게: off = 띠 속 타워 x - 0.111 (낮 0.355, 밤 0.331)
      L.load(info.url, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.repeat.set(2, 1); t.offset.x = (k === 'skyNight' ? 0.331 : 0.355) - 0.111; t.anisotropy = 8; refs[k] = t; if (refs.onPano) refs.onPano(); }, undefined, () => {});
    }
  }
  // ── 하늘 돔: 그라데이션 + 해 번짐 + 구름(낮) / 지평선 도시 불빛(밤) ──
  {
    const U = {
      top: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, hor: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3(0.6, 0.55, -0.3).normalize() }, sunCol: { value: new THREE.Color('#fff2d0') }, uDay: { value: 0 }, uTime: { value: 0 },
    };
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: U,
      vertexShader: 'varying vec3 vp; void main(){ vp = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 hor; uniform vec3 sunDir; uniform vec3 sunCol; uniform float uDay; uniform float uTime; varying vec3 vp;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
        float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
        void main(){
          vec3 d = normalize(vp); float h = d.y;
          vec3 c = mix(hor, mid, smoothstep(-0.02, 0.18, h)); c = mix(c, top, smoothstep(0.18, 0.75, h));
          float sd = max(dot(d, sunDir), 0.0);
          c += sunCol * (pow(sd, 6.0) * 0.25 + pow(sd, 64.0) * 0.6 + smoothstep(0.9993, 0.9997, sd) * 4.0) * uDay;
          // 구름: 하늘 평면에 투영한 fbm (낮만)
          if (uDay > 0.0 && h > 0.01) {
            vec2 cp = d.xz / (h + 0.12) * 1.6 + vec2(uTime * 0.004, 0.0);
            float cl = smoothstep(0.52, 0.78, fbm(cp)) * smoothstep(0.01, 0.12, h);
            vec3 ccol = mix(vec3(0.82, 0.86, 0.92), vec3(1.0), pow(sd, 3.0));
            c = mix(c, ccol, cl * 0.85 * uDay);
          }
          // 밤: 지평선 도시 불빛 번짐(주황)
          c += vec3(0.16, 0.08, 0.03) * (1.0 - uDay) * exp(-max(h, 0.0) * 14.0);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    skyMat.name = 'sky';
    const sky = new THREE.Mesh(new THREE.SphereGeometry(3600, 32, 16), skyMat); sky.renderOrder = -2; sky.frustumCulled = false; world.add(sky);
    refs.sky = U; refs.skyMesh = sky;
    const n = 600, p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const th = R() * Math.PI * 2, ph = R() * 1.15; p[i * 3] = Math.cos(th) * Math.sin(ph) * 3300; p[i * 3 + 1] = Math.cos(ph) * 3300 * 0.7 + 380; p[i * 3 + 2] = Math.sin(th) * Math.sin(ph) * 3300; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: '#c8d4ff', size: 1.3, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.65, name: 'stars' }));
    world.add(stars); refs.stars = stars;
    const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#fff7e0', fog: false, transparent: true, depthWrite: false }));
    moon.scale.set(150, 150, 1); moon.position.set(1400, 1300, 2200); world.add(moon); refs.moon = moon;
  }
  refs.setNight = (night) => {
    for (const o of refs.nightOnly) o.visible = night;
    refs.stars.visible = night; refs.moon.visible = night;
    const U = refs.sky;
    U.uDay.value = night ? 0 : 1;
    if (night) { U.top.value.set('#040817'); U.mid.value.set('#0d1a3c'); U.hor.value.set('#2e3354'); }
    else { U.top.value.set('#2a66c8'); U.mid.value.set('#79aee6'); U.hor.value.set('#d9e6f0'); }
    const pt = refs[night ? 'skyNight' : 'skyDay'];
    if (pt) { refs.pano.material.map = pt; refs.pano.material.opacity = 1; refs.pano.material.needsUpdate = true; }
    if (pt && refs.tower.mesh.visible) { // 사진(스카이라인·롯데타워)이 있으니 상자 빌딩·3D 타워는 숨김 — 사진 앞에 회색 상자가 겹쳐 보였음
      refs.tower.mesh.visible = false; refs.tower.beacon.visible = false; refs.nightOnly.splice(refs.nightOnly.indexOf(refs.tower.beacon), 1);
      for (const m of refs.city || []) m.visible = false;
    }
    refs.river.m.map = night ? refs.river.nightMap : null; refs.river.m.color.set(night ? '#8fa0c0' : '#5d7f9e'); refs.river.m.needsUpdate = true;
    for (const m of refs.winMats) { if (!m.userData.nightMap) m.userData.nightMap = m.map; const dt = dayWindowTex(); dt.repeat.copy(m.userData.nightMap.repeat); m.map = night ? m.userData.nightMap : dt; m.needsUpdate = true; }
    refs.tower.m.map = night ? refs.tower.night : refs.tower.day; refs.tower.m.needsUpdate = true;
    refs.plaza.m.color.copy(night ? refs.plaza.night : refs.plaza.day);
  };
  return refs;
}
