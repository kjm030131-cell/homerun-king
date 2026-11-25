// [motion] 웹캠 전신 추적 — 구글 MediaPipe 포즈(관절 33개, 실제 m 단위)를 CDN에서 처음 켤 때 내려받음
//  - 선수 몸이 내 몸을 그대로 따라 함 (character.pose)
//  - 스윙: 두 손목 가운데 속도가 꼭짓점 찍는 순간 = 맞는 순간, 그때 손 높이 = 스윙 높이
const VER = '0.10.14';
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VER}`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
import { OneEuro, peakTime } from './filter.js';
const dynImport = new Function('u', 'return import(u)'); // 빌드 도구가 CDN 주소를 묶으려 하지 않게

export function createPose(video, onSwing) {
  const P = { ready: false, err: '', lm: null, t: 0, speed: 0, loading: false };
  let lander = null, lastTs = -1, prev = null, burst = null, cool = 0, raf = 0, on = false;
  P.load = async () => {
    if (P.ready || P.loading) return P.ready;
    P.loading = true;
    try {
      const vision = await dynImport(`${CDN}/vision_bundle.mjs`);
      const files = await vision.FilesetResolver.forVisionTasks(`${CDN}/wasm`);
      const opts = (delegate) => ({ baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.6 });
      try { lander = await vision.PoseLandmarker.createFromOptions(files, opts('GPU')); } catch { lander = await vision.PoseLandmarker.createFromOptions(files, opts('CPU')); }
      P.ready = true;
    } catch (e) { P.err = '전신 인식 모델을 못 불러왔어 (인터넷 확인) — 움직임 감지로 대신할게'; console.warn('[pose]', e); }
    P.loading = false;
    return P.ready;
  };
  // [motion+] 관절 33개 × xyz One-Euro 필터 (깊이 z 는 노이즈가 커서 더 강하게) + 프레임 사이 예측
  const F = Array.from({ length: 33 }, () => [new OneEuro(1.0, 8), new OneEuro(1.0, 8), new OneEuro(0.6, 4)]);
  const vis = new Float32Array(33), out = Array.from({ length: 33 }, () => [0, 0, 0, 0]);
  let detAvg = 20, gap = 48, hist = []; // 감지 소요(ms) 평균 → 감지 간격을 자동으로(여유 있으면 30fps, 렉이면 15fps)
  function frame() {
    if (!on) return;
    raf = requestAnimationFrame(frame);
    if (!lander || video.readyState < 2) return;
    const ts = performance.now(); if (ts - lastTs < gap) return;
    lastTs = ts;
    let r; const d0 = performance.now(); try { r = lander.detectForVideo(video, ts); } catch { return; }
    detAvg += (performance.now() - d0 - detAvg) * 0.1; gap = Math.max(33, Math.min(66, detAvg * 2.6));
    const w = r && r.worldLandmarks && r.worldLandmarks[0];
    if (!w) { if (ts - P.t > 300) { P.lm = null; for (const f of F) for (const e of f) e.reset(); } return; }
    const dtS = P.t ? Math.min(0.2, (ts - P.t) / 1000) : 0.05;
    for (let i = 0; i < 33; i++) {
      const p = w[i], v = p.visibility ?? 1;
      vis[i] += (v - vis[i]) * (v > vis[i] ? 0.6 : 0.25);
      // 잘 안 보이는 관절(가려짐·화면 밖)은 거의 안 따라감 — 엉뚱한 위치로 튀는 것 방지
      const tw = v < 0.25 ? 0.04 : Math.min(1, 0.25 + v);
      F[i][0].filter(p.x, dtS, tw); F[i][1].filter(p.y, dtS, tw); F[i][2].filter(p.z, dtS, tw);
    }
    P.lm = out; P.t = ts;
    // 스윙 감지: 손목 가운데 속도(m/s) — 두 손목이 보일 때만, 꼭짓점 시각은 포물선으로 보정
    const hx = (w[15].x + w[16].x) / 2, hy = (w[15].y + w[16].y) / 2, hz = (w[15].z + w[16].z) / 2;
    const wv = Math.min(w[15].visibility ?? 1, w[16].visibility ?? 1);
    if (prev && wv > 0.35) {
      const dt = (ts - prev.t) / 1000, sp = dt > 0 ? Math.hypot(hx - prev.x, hy - prev.y, (hz - prev.z) * 0.6) / dt : 0;
      P.speed = sp;
      hist.push([ts, sp]); if (hist.length > 3) hist.shift();
      const sh = (w[11].y + w[12].y) / 2, handUp = sh - hy;
      if (ts >= cool) {
        if (!burst) { if (sp > 2.2) burst = { t0: ts, pk: sp, at: ts, h: handUp, down: 0, i: 0 }; }
        else {
          if (sp > burst.pk) { burst.pk = sp; burst.at = ts; burst.h = handUp; burst.down = 0; burst.pre = hist.length >= 2 ? hist[hist.length - 2] : null; burst.post = null; }
          else { if (!burst.post && burst.at === hist[hist.length - 2]?.[0]) burst.post = [ts, sp]; if (sp < burst.pk * 0.8) burst.down++; }
          if (burst.down >= 2 || ts - burst.t0 > 400) {
            const b = burst; burst = null;
            if (b.pre && b.post) b.at = peakTime(b.pre[0], b.pre[1], b.at, b.pk, b.post[0], b.post[1]);
            if (b.pk > 3.2) { cool = ts + 650; onSwing(b); }
          }
        }
      }
    } else if (wv <= 0.35) hist.length = 0;
    prev = { x: hx, y: hy, z: hz, t: ts };
  }
  // 지금 시각의 자세: 마지막 감지(20~30fps) 뒤 흐른 시간만큼 속도로 앞당김(최대 60ms, 점점 약하게) → 화면(60fps)에서 계단처럼 끊기지 않음
  function sample() {
    const age = Math.min(0.06, Math.max(0, (performance.now() - P.t) / 1000)), k = age * (1 - age / 0.12);
    for (let i = 0; i < 33; i++) { const f = F[i], o = out[i]; o[0] = f[0].x + f[0].dx * k; o[1] = f[1].x + f[1].dx * k; o[2] = f[2].x + f[2].dx * k * 0.5; o[3] = vis[i]; }
    return out;
  }
  P.start = () => { if (on) return; on = true; raf = requestAnimationFrame(frame); };
  P.stop = () => { on = false; cancelAnimationFrame(raf); P.lm = null; };
  // 최근 0.25초 안의 관절만 (끊기면 원래 동작으로)
  P.now = () => (P.lm && performance.now() - P.t < 250 ? sample() : null);
  return P;
}
