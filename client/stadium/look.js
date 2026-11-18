// stadium/look.js — 화면 분위기: 톤매핑·노출, 조명(해/조명탑), 그림자, 안개, 블룸, 환경광(PMREM), 그래픽 단계
// main.js 는 createLook(renderer, scene, camera) 한 번 부르고 setTimeOfDay / setQuality / resize / render 만 씀
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const TARGET = new THREE.Vector3(0, 0, 45); // 그림자 중심(내야~외야 중간)
// 낮: 3루 쪽 위 오후 해(고도 약 38°) → 3루 관중석 그림자가 파울 지역으로 / 밤: 홈 뒤 지붕 조명 쪽 거의 머리 위(짧은 그림자)
const SUN_DIR = new THREE.Vector3(0.7, 0.62, -0.35).normalize();
const NIGHT_DIR = new THREE.Vector3(-0.15, 0.95, -0.28).normalize();

// 환경광 장면: 하늘 그라데이션 + (밤) 조명탑 램프 / (낮) 해 → PMREM 으로 흐린 반사·주변광
function envScene(day) {
  const s = new THREE.Scene();
  const top = new THREE.Color(day ? '#4f86d0' : '#070b18'), hor = new THREE.Color(day ? '#c9d8e6' : '#1c2238'), gnd = new THREE.Color(day ? '#4d5a3c' : '#16301c');
  const k = day ? 0.95 : 1;
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: top.multiplyScalar(k) }, hor: { value: hor.multiplyScalar(k) }, gnd: { value: gnd.multiplyScalar(day ? 0.8 : 1.6) } },
    vertexShader: 'varying vec3 vp; void main(){ vp = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 hor; uniform vec3 gnd; varying vec3 vp; void main(){ float h = normalize(vp).y; vec3 c = h > 0.0 ? mix(hor, top, smoothstep(0.0, 0.6, h)) : mix(hor, gnd, smoothstep(0.0, 0.12, -h)); gl_FragColor = vec4(c, 1.0); }',
  });
  s.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), mat));
  const bright = new THREE.MeshBasicMaterial({ color: day ? new THREE.Color(30, 28, 24) : new THREE.Color(9, 8.6, 7.8), side: THREE.DoubleSide });
  if (day) { const sun = new THREE.Mesh(new THREE.SphereGeometry(3, 12, 8), bright); sun.position.copy(SUN_DIR).multiplyScalar(80); s.add(sun); }
  else {
    // 조명탑 위치(대략): 외야 좌우, 1·3루 뒤, 홈 뒤 지붕
    for (const [a, el] of [[27, 22], [-27, 22], [63, 28], [-63, 28], [140, 34], [-140, 34], [160, 34], [-160, 34]]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(9, 4), bright);
      const ar = a * Math.PI / 180, er = el * Math.PI / 180;
      p.position.set(Math.sin(ar) * Math.cos(er) * 80, Math.sin(er) * 80, Math.cos(ar) * Math.cos(er) * 80);
      p.lookAt(0, 0, 0); s.add(p);
    }
  }
  return s;
}

export function createLook(renderer, scene, camera) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  scene.fog = new THREE.Fog('#151c35', 450, 3000);
  // 후처리 렌더타깃에 MSAA(4x) — 없으면 블룸 켰을 때 선·가장자리가 계단처럼 깨짐
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { samples: 4, type: THREE.HalfFloatType }));
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.55, 0.86);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const hemi = new THREE.HemisphereLight('#bcd0ff', '#2e4a2a', 0.5);
  const key = new THREE.DirectionalLight('#fff3df', 2.2);
  key.target.position.copy(TARGET);
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -100, right: 100, top: 100, bottom: -100, near: 20, far: 420 });
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.025;
  const fillL = new THREE.DirectionalLight('#dfe6ff', 0.5); fillL.position.set(110, 90, 170);
  const fillR = new THREE.DirectionalLight('#dfe6ff', 0.5); fillR.position.set(-110, 90, 170);
  scene.add(hemi, key, key.target, fillL, fillR);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envCache = {};
  const envFor = (mode) => {
    if (!envCache[mode]) { try { envCache[mode] = pmrem.fromScene(envScene(mode === 'day'), 0.04).texture; } catch (e) { envCache[mode] = null; } }
    return envCache[mode];
  };
  let tod = 'night', q = 'mid', useEnv = true, stadiumRef = null;
  function applyEnv() {
    scene.environment = useEnv ? envFor(tod) : null;
    const day = tod === 'day';
    // 환경광이 주변광 역할을 하므로 반구광은 그만큼 줄임 (낮음 단계 = 환경광 끔 → 반구광으로 대신)
    hemi.intensity = useEnv ? (day ? 0.35 : 0.22) : (day ? 1.15 : 0.6);
  }
  function setTimeOfDay(mode, stadium) {
    mode = mode === 'day' ? 'day' : 'night';
    if (stadium) stadiumRef = stadium;
    if (mode === tod && setTimeOfDay.done) return; setTimeOfDay.done = true;
    tod = mode;
    const day = mode === 'day';
    hemi.color.set(day ? '#d6e6ff' : '#b8c8ff'); hemi.groundColor.set(day ? '#6b7350' : '#2a4428');
    key.color.set(day ? '#fff1dc' : '#f2f5ff'); key.intensity = day ? 3.1 : 2.3;
    key.position.copy(TARGET).addScaledVector(day ? SUN_DIR : NIGHT_DIR, 220);
    fillL.intensity = day ? 0.18 : 0.55; fillR.intensity = day ? 0.3 : 0.55;
    fillL.color.set(day ? '#bcd2ff' : '#e6ebff'); fillR.color.set(day ? '#bcd2ff' : '#e6ebff');
    scene.fog.color.set(day ? '#c4d4e4' : '#151c35'); scene.fog.near = day ? 600 : 450; scene.fog.far = day ? 4200 : 3000;
    renderer.toneMappingExposure = day ? 0.82 : 1.0;
    bloom.strength = day ? 0.15 : 0.6; bloom.radius = day ? 0.4 : 0.55; bloom.threshold = day ? 0.97 : 0.86;
    applyEnv();
    if (stadiumRef) { stadiumRef.setTimeOfDay(mode); if (stadiumRef.sky) stadiumRef.sky.sunDir.value.copy(SUN_DIR); }
  }
  function setQuality(qq) {
    q = qq;
    renderer.setPixelRatio(q === 'low' ? 1 : q === 'mid' ? Math.min(devicePixelRatio, 1.25) : Math.min(devicePixelRatio, 2));
    renderer.shadowMap.type = q === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap; // 부드러운 그림자는 '높음'에서만
    renderer.shadowMap.enabled = q !== 'low';
    key.castShadow = q !== 'low';
    const ms = q === 'high' ? 4096 : 2048;
    key.shadow.mapSize.set(ms, ms);
    if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
    bloom.enabled = q !== 'low';
    useEnv = q !== 'low';
    applyEnv();
  }
  function resize(w, h) {
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.resolution.set(w / 2, h / 2);
  }
  function render() { if (bloom.enabled) composer.render(); else renderer.render(scene, camera); }
  return { composer, bloom, key, hemi, fillL, fillR, setTimeOfDay, setQuality, resize, render, get tod() { return tod; }, get quality() { return q; } };
}
