// [motion] 웹캠 전신 추적 — 구글 MediaPipe 포즈(관절 33개, 실제 m 단위)를 CDN에서 처음 켤 때 내려받음
//  - 선수 몸이 내 몸을 그대로 따라 함 (character.pose)
//  - 스윙: 두 손목 가운데 속도가 꼭짓점 찍는 순간 = 맞는 순간, 그때 손 높이 = 스윙 높이
const VER = '0.10.14';
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VER}`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
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
      const opts = (delegate) => ({ baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
      try { lander = await vision.PoseLandmarker.createFromOptions(files, opts('GPU')); } catch { lander = await vision.PoseLandmarker.createFromOptions(files, opts('CPU')); }
      P.ready = true;
    } catch (e) { P.err = '전신 인식 모델을 못 불러왔어 (인터넷 확인) — 움직임 감지로 대신할게'; console.warn('[pose]', e); }
    P.loading = false;
    return P.ready;
  };
  function frame() {
    if (!on) return;
    raf = requestAnimationFrame(frame);
    if (!lander || video.readyState < 2) return;
    const ts = performance.now(); if (ts - lastTs < 48) return; // [perf] ~20fps (30fps는 게임 렌더와 GPU를 다퉈 렉)
    lastTs = ts;
    let r; try { r = lander.detectForVideo(video, ts); } catch { return; }
    const w = r && r.worldLandmarks && r.worldLandmarks[0];
    if (!w) { P.lm = null; P.sm = null; return; }
    // [11-24] 떨림 보정: 빠르게 움직이면 바로 따라가고 가만히 있으면 흔들림을 걸러냄(One-Euro 비슷하게), 4번째 값 = 보이는 정도
    const dtS = P.t ? Math.min(0.2, (ts - P.t) / 1000) : 0.05;
    if (!P.sm) P.sm = w.map((p) => [p.x, p.y, p.z, p.visibility ?? 1]);
    else for (let i = 0; i < 33; i++) {
      const a = P.sm[i], p = w[i], sp = Math.hypot(p.x - a[0], p.y - a[1], p.z - a[2]) / Math.max(dtS, 1e-3);
      const k = Math.min(1, 0.25 + sp * 0.18) ; // 0.25(정지) ~ 1(빠름)
      a[0] += (p.x - a[0]) * k; a[1] += (p.y - a[1]) * k; a[2] += (p.z - a[2]) * k * 0.7; a[3] += ((p.visibility ?? 1) - a[3]) * 0.3; // 깊이(z)는 더 흔들려서 덜 따라감
    }
    P.lm = P.sm; P.t = ts;
    // 스윙 감지: 손목 가운데 속도(m/s)
    const hx = (w[15].x + w[16].x) / 2, hy = (w[15].y + w[16].y) / 2, hz = (w[15].z + w[16].z) / 2;
    if (prev) {
      const dt = (ts - prev.t) / 1000, sp = dt > 0 ? Math.hypot(hx - prev.x, hy - prev.y, hz - prev.z) / dt : 0;
      P.speed = sp;
      // 손 높이: 어깨 가운데 기준(m, 위가 +) — MediaPipe y 는 아래가 +
      const sh = (w[11].y + w[12].y) / 2, handUp = sh - hy;
      if (ts >= cool) {
        if (!burst) { if (sp > 2.2) burst = { t0: ts, pk: sp, at: ts, h: handUp, down: 0 }; }
        else {
          if (sp > burst.pk) { burst.pk = sp; burst.at = ts; burst.h = handUp; burst.down = 0; } else if (sp < burst.pk * 0.8) burst.down++;
          if (burst.down >= 2 || ts - burst.t0 > 400) { const b = burst; burst = null; if (b.pk > 3.2) { cool = ts + 650; onSwing(b); } }
        }
      }
    }
    prev = { x: hx, y: hy, z: hz, t: ts };
  }
  P.start = () => { if (on) return; on = true; raf = requestAnimationFrame(frame); };
  P.stop = () => { on = false; cancelAnimationFrame(raf); P.lm = null; };
  // 최근 0.25초 안의 관절만 (끊기면 원래 동작으로)
  P.now = () => (P.lm && performance.now() - P.t < 250 ? P.lm : null);
  return P;
}
