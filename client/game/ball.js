// client/game/ball.js — [pitch] 공 모양: 실밥 텍스처 + 구종별 회전축/회전 (실제 타자가 읽는 단서)
// 11-19 '친구랑 하면 공이 어디로 오는지·볼인지 모르겠다' — 위치 미리보기 없이, 실제 야구처럼 공 자체에서 읽을 거리를 줌.
//  · 포심: 백스핀(실밥 줄이 위로 감겨 올라감) · 투심: 기울어진 백스핀 · 슬라이더: 진행 방향 축(자이로) → 타자 쪽에 '빨간 점'
//  · 커브: 탑스핀(앞으로 굴러 떨어짐) · 체인지업: 많이 기운 백스핀, 느린 회전 · 스플리터: 회전 적음(실밥이 거의 멈춰 보임)
// 회전 속도는 실제 rpm × APPARENT — 실제 속도(초당 35~45바퀴)를 60fps로 그리면 거꾸로 돌거나 멈춰 보이는 착시(스트로브)라
// 회전 '축'(=타자가 읽는 단서)은 그대로 두고 화면에서 읽히는 속도(초당 2~5바퀴)로 줄여서 그림. 위치·궤적 정보는 전혀 없음.
import * as THREE from 'three';

const APPARENT = 0.11;
// 축: 월드 좌표(공은 +z(투수) → 0(홈)으로 날아감). +x 축 회전 = 백스핀(양력 위)
export const SPIN = {
  FB: { rpm: 2300, axis: [1, 0.22, 0], dot: false },
  TS: { rpm: 2150, axis: [1, 0.75, 0], dot: false },
  SL: { rpm: 2450, axis: [0.35, 0.3, -1], dot: true },
  CB: { rpm: 2600, axis: [-1, 0.3, 0], dot: false },
  CH: { rpm: 1750, axis: [1, 0.95, 0], dot: false },
  SP: { rpm: 1300, axis: [1, 0.5, 0.25], dot: false },
  BP: { rpm: 1200, axis: [1, 0, 0], dot: false },
};

// 야구공 실밥 곡선 (단위 구 위): x = a cos t + b cos 3t, y = a sin t − b sin 3t, z = c sin 2t, c = 2√(ab)
const SA = 0.7, SB = 0.3, SC = 2 * Math.sqrt(SA * SB);
function seam(t, out) { out.set(SA * Math.cos(t) + SB * Math.cos(3 * t), SA * Math.sin(t) - SB * Math.sin(3 * t), SC * Math.sin(2 * t)).normalize(); return out; }

// 구 방향 → SphereGeometry UV 캔버스 좌표 (three: x = -cos φ sin θ, y = cos θ, z = sin φ sin θ, u = φ/2π, 캔버스 위 = y+)
function toUV(d, W, H) {
  const th = Math.acos(Math.max(-1, Math.min(1, d.y)));
  let ph = Math.atan2(d.z, -d.x); if (ph < 0) ph += Math.PI * 2;
  return [ph / (Math.PI * 2) * W, th / Math.PI * H, Math.max(0.12, Math.sin(th))];
}
export function seamTexture() {
  const W = 512, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#f6f3ec'; g.fillRect(0, 0, W, H);
  const d = new THREE.Vector3(), d2 = new THREE.Vector3(), tan = new THREE.Vector3(), nrm = new THREE.Vector3(), p = new THREE.Vector3();
  const dot = (x, y, s, w, h, col) => { g.fillStyle = col; for (const ox of [0, -W, W]) g.fillRect(x + ox - (w / s) / 2, y - h / 2, w / s, h); };
  const N = 900;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    seam(t, d); seam(t + 1e-3, d2); tan.subVectors(d2, d).normalize(); nrm.crossVectors(d, tan).normalize();
    // 가운데 솔기(옅은 회색 홈)
    { const [x, y, s] = toUV(d, W, H); dot(x, y, s, 2.2, 2.2, '#c9c2b4'); }
    // 양쪽 빨간 실밥 (V자 바늘땀: 4개마다 하나씩 굵게)
    if (i % 3 === 0) for (const k of [-1, 1]) {
      for (const off of [0.035, 0.06]) { p.copy(d).addScaledVector(nrm, k * off).normalize(); const [x, y, s] = toUV(p, W, H); dot(x, y, s, 3.4, 3.4, '#c4252b'); }
    }
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

// 실밥 위의 점(슬라이더 '빨간 점'이 생기는 자리) / 실밥에서 가장 먼 점(포심처럼 줄이 감겨 보이는 자리)
const SEAM_PT = seam(Math.PI / 4, new THREE.Vector3()).clone();
const LOBE_PT = (() => {
  const v = new THREE.Vector3(), s = new THREE.Vector3(); let best = null, bd = -1;
  for (let i = 0; i < 600; i++) {
    const z = 1 - 2 * (i + 0.5) / 600, r = Math.sqrt(1 - z * z), a = i * 2.39996; v.set(r * Math.cos(a), r * Math.sin(a), z);
    let md = 9; for (let k = 0; k < 120; k++) md = Math.min(md, v.distanceTo(seam(k / 120 * Math.PI * 2, s)));
    if (md > bd) { bd = md; best = v.clone(); }
  }
  return best;
})();

export function createBallLook(mesh) {
  const tex = seamTexture();
  const m = mesh.material; m.map = tex; m.emissiveMap = tex; m.color.set('#ffffff'); m.needsUpdate = true;
  const axis = new THREE.Vector3(1, 0, 0), q = new THREE.Quaternion(), tmp = new THREE.Vector3();
  let w = 0, pid = null;
  return {
    // 새 투구: 구종별 축으로 공 방향을 맞춤 (손에서 놓을 때 잡은 방식 = 실밥 방향)
    pitch(p) {
      if (!p || p.id === pid) return;
      pid = p.id;
      const S = SPIN[p.type] || SPIN.FB;
      axis.fromArray(S.axis).normalize();
      mesh.quaternion.setFromUnitVectors(S.dot ? SEAM_PT : LOBE_PT, axis);
      w = S.rpm / 60 * Math.PI * 2 * APPARENT;
    },
    // 타구·송구: 시뮬 스핀 벡터(rad/s, 월드)를 그대로 축으로
    spinVec(sx, sy, sz) {
      const l = Math.hypot(sx || 0, sy || 0, sz || 0);
      if (l < 1) { w = 0; return; }
      axis.set(sx / l, sy / l, sz / l); w = Math.min(l, 450) * APPARENT; pid = null;
    },
    update(dt) { if (w) { q.setFromAxisAngle(axis, w * Math.min(dt, 0.05)); mesh.quaternion.premultiply(q); } void tmp; },
  };
}
