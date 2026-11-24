// fx.js — 파티클/연출: 불꽃놀이, 임팩트 플래시, 흙먼지, 공 궤적
import * as THREE from 'three';
import { DUST_PNG, TRAIL_PNG } from './fxtex.js';
import { glowTex } from './stadium.js';

export class FX {
  constructor(scene) {
    this.scene = scene;
    // 공용 파티클 풀 (Points, additive)
    this.N = 6000;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.N * 3);
    this.col = new Float32Array(this.N * 3);
    this.size = new Float32Array(this.N);
    this.vel = new Float32Array(this.N * 3);
    this.life = new Float32Array(this.N);
    this.max = new Float32Array(this.N);
    this.kind = new Uint8Array(this.N); // 0 불꽃(가산) 1 먼지
    this.drag = new Float32Array(this.N);
    this.grav = new Float32Array(this.N);
    this.base = new Float32Array(this.N * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: glowTex() }, scale: { value: 600 } },
      vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC; uniform float scale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC * t.a, t.a); }`,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    // 먼지 (일반 블렌딩)
    const dg = new THREE.BufferGeometry();
    this.DN = 800;
    this.dpos = new Float32Array(this.DN * 3); this.dsize = new Float32Array(this.DN); this.dalpha = new Float32Array(this.DN);
    this.dvel = new Float32Array(this.DN * 3); this.dlife = new Float32Array(this.DN); this.dmax = new Float32Array(this.DN);
    dg.setAttribute('position', new THREE.BufferAttribute(this.dpos, 3));
    dg.setAttribute('size', new THREE.BufferAttribute(this.dsize, 1));
    dg.setAttribute('alpha', new THREE.BufferAttribute(this.dalpha, 1));
    const dmat = new THREE.ShaderMaterial({
      uniforms: { map: { value: imgTex(DUST_PNG) }, scale: { value: 600 }, color: { value: new THREE.Color('#b98a63') } }, // [hud 11-24] 먼지: 실사 흙먼지 텍스처(전엔 둥근 빛 점)
      vertexShader: `attribute float size; attribute float alpha; varying float vA; uniform float scale;
        void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; uniform vec3 color; varying float vA; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(color, t.a * vA * 0.8); }`,
      depthWrite: false, transparent: true,
    });
    this.dust = new THREE.Points(dg, dmat);
    this.dust.frustumCulled = false;
    scene.add(this.dust);
    this.next = 0; this.dnext = 0;
    this.bursts = [];
    // 임팩트 플래시
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#fff6dd', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    this.flash.visible = false; this.flash.renderOrder = 20;
    scene.add(this.flash);
    this.flashT = 0;
    // 충격파 링
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.ring.visible = false; scene.add(this.ring);
    // 공 궤적 리본
    this.TN = 40;
    this.trailPts = [];
    const tg = new THREE.BufferGeometry();
    this.tpos = new Float32Array(this.TN * 2 * 3);
    this.talpha = new Float32Array(this.TN * 2);
    const idx = [];
    for (let i = 0; i < this.TN - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    tg.setIndex(idx);
    tg.setAttribute('position', new THREE.BufferAttribute(this.tpos, 3));
    tg.setAttribute('alpha', new THREE.BufferAttribute(this.talpha, 1));
    { const uv = new Float32Array(this.TN * 2 * 2); for (let i = 0; i < this.TN; i++) { const u = 1 - i / (this.TN - 1); uv.set([u, 0, u, 1], i * 4); } tg.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); } // [hud 11-24] 리본 텍스처 좌표(u=0 공 쪽)
    this.trailColor = new THREE.Color('#ffffff');
    this.trail = new THREE.Mesh(tg, new THREE.ShaderMaterial({
      uniforms: { color: { value: this.trailColor }, map: { value: imgTex(TRAIL_PNG) } },
      vertexShader: 'attribute float alpha; varying float vA; varying vec2 vUv; void main(){ vA = alpha; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 color; uniform sampler2D map; varying float vA; varying vec2 vUv; void main(){ float t = texture2D(map, vec2(vUv.x * 0.6, vUv.y)).r; float a = vA * (0.35 + 0.9 * t); gl_FragColor = vec4(color * a, a); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    this.trail.frustumCulled = false;
    scene.add(this.trail);
    // 배트 스윙 잔상 (손잡이 쪽 ~ 배트 끝 사이 면)
    this.BN = 14;
    this.batPts = [];
    const bg = new THREE.BufferGeometry();
    this.bpos = new Float32Array(this.BN * 2 * 3); this.balpha = new Float32Array(this.BN * 2);
    const bidx = []; for (let i = 0; i < this.BN - 1; i++) { const a = i * 2; bidx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    bg.setIndex(bidx);
    bg.setAttribute('position', new THREE.BufferAttribute(this.bpos, 3));
    bg.setAttribute('alpha', new THREE.BufferAttribute(this.balpha, 1));
    this.batTrail = new THREE.Mesh(bg, new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color('#fff2d6') } },
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 color; varying float vA; void main(){ gl_FragColor = vec4(color * vA, vA); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    this.batTrail.frustumCulled = false; this.batTrail.visible = false;
    scene.add(this.batTrail);
  }
  // 배트 잔상: 매 프레임 손잡이쪽 a, 끝 b 를 넣음 (없으면 서서히 사라짐)
  batPush(a, b) { this.batPts.push([a.clone(), b.clone(), 0]); if (this.batPts.length > this.BN) this.batPts.shift(); }
  // 꽃가루(끝내기·홈런)
  confetti(x, y, z, n = 260) {
    const C = [[1, 0.25, 0.3], [1, 0.85, 0.2], [0.3, 0.7, 1], [0.4, 1, 0.5], [1, 1, 1]];
    for (let k = 0; k < n; k++) {
      const c = C[k % C.length];
      this.spawn(x + (Math.random() - 0.5) * 12, y + Math.random() * 4, z + (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 6, 4 + Math.random() * 7, (Math.random() - 0.5) * 6, 3 + Math.random() * 2, 0.55, c[0] * 0.8, c[1] * 0.8, c[2] * 0.8, 1.4, 2.2);
    }
  }

  spawn(x, y, z, vx, vy, vz, life, size, r, g, b, drag = 1, grav = 9.8) {
    const i = this.next; this.next = (this.next + 1) % this.N;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.max[i] = life; this.size[i] = size;
    this.base[i * 3] = r; this.base[i * 3 + 1] = g; this.base[i * 3 + 2] = b;
    this.drag[i] = drag; this.grav[i] = grav;
  }
  // 불꽃 한 발
  firework(x, y, z, hue) {
    const c = new THREE.Color().setHSL(hue, 0.9, 0.6);
    const n = 160;
    const sp = 22 + Math.random() * 10;
    for (let k = 0; k < n; k++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const v = sp * (0.85 + Math.random() * 0.3);
      this.spawn(x, y, z, Math.cos(th) * s * v, u * v, Math.sin(th) * s * v, 1.8 + Math.random() * 0.8, 3.2, c.r, c.g, c.b, 1.6, 6);
    }
    for (let k = 0; k < 30; k++) this.spawn(x, y, z, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, 0.5, 9, 1, 0.95, 0.8, 3, 0);
  }
  // 불꽃놀이 쇼 (외야 너머)
  show(n = 10, center = [0, 0, 150]) {
    for (let i = 0; i < n; i++) {
      this.bursts.push({ t: i * 0.28 + Math.random() * 0.2, x: center[0] + (Math.random() - 0.5) * 160, y: 70 + Math.random() * 60, z: center[2] + Math.random() * 60, hue: Math.random() });
    }
  }
  impact(pos, strength = 1) {
    // 정타일수록 큰 섬광 + 사방으로 튀는 불꽃 + 나무 부스러기
    if (strength > 1.2) for (let k = 0; k < 24; k++) { const a = Math.random() * Math.PI * 2, v = 3 + Math.random() * 5; this.spawn(pos.x, pos.y, pos.z, Math.cos(a) * v, Math.random() * 4, Math.sin(a) * v + 2, 0.6 + Math.random() * 0.4, 0.5, 0.85, 0.62, 0.38, 2, 9.8); }
    this.flash.position.copy(pos);
    this.flash.visible = true; this.flashT = 0.14; this.flashS = 0.5 + strength * 0.8;
    this.ring.position.copy(pos);
    this.ring.visible = true; this.ringT = 0.3; this.ringS = strength;
    for (let k = 0; k < 30 * strength; k++) {
      const v = 6 + Math.random() * 10 * strength;
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.3) * 1.2;
      this.spawn(pos.x, pos.y, pos.z, Math.cos(a) * v * 0.6, e * v * 0.6, Math.sin(a) * v * 0.6 + 4, 0.25 + Math.random() * 0.2, 0.9, 1, 0.9, 0.6, 4, 2);
    }
  }
  dustPuff(x, z, amount = 1, spread = 1) {
    for (let k = 0; k < 10 * amount; k++) {
      const i = this.dnext; this.dnext = (this.dnext + 1) % this.DN;
      const a = Math.random() * Math.PI * 2, v = (0.6 + Math.random() * 1.4) * spread;
      this.dpos[i * 3] = x + Math.cos(a) * 0.2; this.dpos[i * 3 + 1] = 0.15; this.dpos[i * 3 + 2] = z + Math.sin(a) * 0.2;
      this.dvel[i * 3] = Math.cos(a) * v; this.dvel[i * 3 + 1] = 0.5 + Math.random() * 0.8; this.dvel[i * 3 + 2] = Math.sin(a) * v;
      this.dlife[i] = this.dmax[i] = 0.8 + Math.random() * 0.7;
      this.dsize[i] = 0.75 + Math.random() * 0.7;
    }
  }
  trailPush(p, color) {
    if (color) this.trailColor.set(color);
    this.trailPts.push(p.clone());
    if (this.trailPts.length > this.TN) this.trailPts.shift();
  }
  trailClear() { this.trailPts.length = 0; }

  update(dt, camera) {
    // 불꽃 예약
    for (const b of this.bursts) { b.t -= dt; if (b.t <= 0 && !b.done) { b.done = true; this.firework(b.x, b.y, b.z, b.hue); } }
    this.bursts = this.bursts.filter((b) => !b.done);
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] <= 0) { this.size[i] = 0; continue; }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.max[i]);
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt; this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const tw = 0.75 + 0.25 * Math.sin(this.life[i] * 40 + i);
      this.col[i * 3] = this.base[i * 3] * k * tw; this.col[i * 3 + 1] = this.base[i * 3 + 1] * k * tw; this.col[i * 3 + 2] = this.base[i * 3 + 2] * k * tw;
    }
    const ga = this.points.geometry.attributes;
    ga.position.needsUpdate = ga.color.needsUpdate = ga.size.needsUpdate = true;
    for (let i = 0; i < this.DN; i++) {
      if (this.dlife[i] <= 0) { this.dalpha[i] = 0; continue; }
      this.dlife[i] -= dt;
      const k = this.dlife[i] / this.dmax[i];
      this.dpos[i * 3] += this.dvel[i * 3] * dt; this.dpos[i * 3 + 1] += this.dvel[i * 3 + 1] * dt; this.dpos[i * 3 + 2] += this.dvel[i * 3 + 2] * dt;
      this.dvel[i * 3] *= 0.94; this.dvel[i * 3 + 2] *= 0.94; this.dvel[i * 3 + 1] *= 0.9;
      this.dsize[i] += dt * 1.2;
      this.dalpha[i] = Math.max(0, k);
    }
    const da = this.dust.geometry.attributes;
    da.position.needsUpdate = da.size.needsUpdate = da.alpha.needsUpdate = true;
    // 플래시
    if (this.flash.visible) {
      this.flashT -= dt;
      const k = Math.max(0, this.flashT / 0.16);
      this.flash.scale.setScalar(this.flashS * (1.4 - k * 0.4));
      this.flash.material.opacity = k;
      if (this.flashT <= 0) this.flash.visible = false;
    }
    if (this.ring.visible) {
      this.ringT -= dt;
      const k = Math.max(0, this.ringT / 0.3);
      this.ring.scale.setScalar(0.2 + (1 - k) * (0.6 + this.ringS * 0.9));
      this.ring.material.opacity = k * 0.8;
      if (camera) this.ring.quaternion.copy(camera.quaternion);
      if (this.ringT <= 0) this.ring.visible = false;
    }
    // 배트 잔상
    { for (const q of this.batPts) q[2] += dt;
      while (this.batPts.length && this.batPts[0][2] > 0.12) this.batPts.shift();
      const n = this.batPts.length; // [qa] 전엔 shift 전에 길이를 재서, 스윙 직후 한 프레임이 길면(렉) 점이 다 빠진 빈 배열을 읽어 TypeError → 프레임 루프 사망(화면 고정)
      this.batTrail.visible = n > 1;
      if (n > 1) {
        for (let i = 0; i < this.BN; i++) {
          const idx = Math.min(this.batPts.length - 1, Math.max(0, i - (this.BN - this.batPts.length)));
          const [a, b, age] = this.batPts[idx] || this.batPts[this.batPts.length - 1];
          this.bpos.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
          const al = i < this.BN - this.batPts.length ? 0 : Math.max(0, 1 - age / 0.12) * 0.42;
          this.balpha[i * 2] = al * 0.15; this.balpha[i * 2 + 1] = al;
        }
        this.batTrail.geometry.attributes.position.needsUpdate = true; this.batTrail.geometry.attributes.alpha.needsUpdate = true;
      } }
    // 궤적 리본 (카메라 향해 폭 확장)
    const n = this.trailPts.length;
    this.trail.visible = n > 1;
    if (n > 1 && camera) {
      const cp = camera.position;
      const t = new THREE.Vector3(), side = new THREE.Vector3(), view = new THREE.Vector3();
      for (let i = 0; i < this.TN; i++) {
        const idx = Math.min(n - 1, Math.max(0, i - (this.TN - n)));
        const p = this.trailPts[idx];
        const q = this.trailPts[Math.min(n - 1, idx + 1)], o = this.trailPts[Math.max(0, idx - 1)];
        t.subVectors(q, o); view.subVectors(cp, p);
        side.crossVectors(t, view).normalize();
        const k = i / (this.TN - 1);
        const w = 0.06 * k; // [hud 11-24] 텍스처 가장자리가 부드러워서 폭 0.045→0.06
        this.tpos[i * 6] = p.x + side.x * w; this.tpos[i * 6 + 1] = p.y + side.y * w; this.tpos[i * 6 + 2] = p.z + side.z * w;
        this.tpos[i * 6 + 3] = p.x - side.x * w; this.tpos[i * 6 + 4] = p.y - side.y * w; this.tpos[i * 6 + 5] = p.z - side.z * w;
        const a = i < this.TN - n ? 0 : k * k * 0.85;
        this.talpha[i * 2] = a; this.talpha[i * 2 + 1] = a;
      }
      this.trail.geometry.attributes.position.needsUpdate = true;
      this.trail.geometry.attributes.alpha.needsUpdate = true;
    }
  }
}

// [hud 11-24] data URI 이미지 → 텍스처 (fxtex.js)
function imgTex(url) { const t = new THREE.TextureLoader().load(url); t.colorSpace = THREE.SRGBColorSpace; return t; }
