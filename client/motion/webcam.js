// [motion] 웹캠 동작 감지 — 외부 라이브러리 없이 프레임 차이로 '휘두르는 순간'을 찾음
//  - 80×60 흑백으로 줄여 이전 프레임과 비교 → 바뀐 픽셀 비율(에너지) + 바뀐 곳의 무게중심
//  - 평소 흔들림(바닥값)의 몇 배가 넘으면 동작 시작, 꼭짓점이 지나 반으로 떨어지면 끝 → 꼭짓점 시각을 '맞는 순간'으로 보냄
const W = 80, H = 60;

export function createWebcam(onBurst, onFrame) {
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d', { willReadFrequently: true });
  let stream = null, prev = null, running = false, raf = 0;
  const C = { floor: 0.01, e: 0, burst: null, cool: 0, avgPeak: 0.12, diff: new Uint8Array(W * H), err: '' };

  function frame(tMs) {
    if (!running) return;
    if (video.readyState >= 2 && !C.paused) { // [perf] 전신 인식 중엔 프레임 차이(픽셀 읽기) 안 함
      g.save(); g.scale(-1, 1); g.drawImage(video, -W, 0, W, H); g.restore(); // 거울처럼
      const d = g.getImageData(0, 0, W, H).data, cur = new Uint8Array(W * H);
      for (let i = 0, j = 0; i < cur.length; i++, j += 4) cur[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
      if (prev) {
        let n = 0, sx = 0, sy = 0;
        for (let i = 0; i < cur.length; i++) { const ch = Math.abs(cur[i] - prev[i]) > 26; C.diff[i] = ch ? 255 : 0; if (ch) { n++; sx += i % W; sy += (i / W) | 0; } }
        const e = n / cur.length; C.e = e;
        const cx = n ? sx / n / W : 0.5, cy = n ? sy / n / H : 0.5;
        if (!C.burst) C.floor += (e - C.floor) * (e < C.floor ? 0.2 : 0.02); // 바닥값: 내려갈 땐 빨리, 올라갈 땐 천천히
        const th = Math.max(0.035, C.floor * 4 + 0.015);
        if (!C.burst && e > th && tMs > C.cool) C.burst = { t0: tMs, peak: e, at: tMs, cx, cy };
        else if (C.burst) {
          const B = C.burst;
          if (e > B.peak) { B.peak = e; B.at = tMs; B.cx = cx; B.cy = cy; }
          if (e < B.peak * 0.7 || tMs - B.t0 > 450) { // [11-23] 정점 지나면 바로 (예전 45%까지 기다려 늦었음)
            C.burst = null; C.cool = tMs + 550;
            if (B.peak > th * 1.4) { C.avgPeak += (B.peak - C.avgPeak) * 0.25; onBurst({ at: B.at, peak: B.peak, rel: B.peak / Math.max(0.05, C.avgPeak), cx: B.cx, cy: B.cy }); }
          }
        }
      }
      prev = cur;
      onFrame && onFrame(C);
    }
    raf = video.requestVideoFrameCallback ? video.requestVideoFrameCallback((now) => frame(now)) : requestAnimationFrame(frame);
  }
  C.video = video;
  C.start = async () => {
    if (running) return true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60 } }, audio: false });
    } catch (e) { C.err = e && e.name === 'NotAllowedError' ? '카메라 권한이 막혀 있어' : '웹캠을 못 찾았어'; return false; }
    video.srcObject = stream; await video.play().catch(() => { });
    running = true; prev = null; C.err = '';
    raf = video.requestVideoFrameCallback ? video.requestVideoFrameCallback((now) => frame(now)) : requestAnimationFrame(frame);
    return true;
  };
  C.stop = () => { running = false; if (stream) for (const t of stream.getTracks()) t.stop(); stream = null; video.srcObject = null; C.burst = null; };
  Object.defineProperty(C, 'on', { get: () => running });
  // 미리보기: 카메라 화면 위에 움직인 곳을 금색으로
  const img = new ImageData(W, H);
  C.paint = (canvas) => {
    const x = canvas.getContext('2d');
    if (video.readyState >= 2) { x.save(); x.scale(-1, 1); x.drawImage(video, -canvas.width, 0, canvas.width, canvas.height); x.restore(); }
    for (let i = 0; i < W * H; i++) { const a = C.diff[i]; img.data[i * 4] = 255; img.data[i * 4 + 1] = 200; img.data[i * 4 + 2] = 60; img.data[i * 4 + 3] = a ? 170 : 0; }
    g.putImageData(img, 0, 0); x.imageSmoothingEnabled = false; x.drawImage(cv, 0, 0, canvas.width, canvas.height);
  };
  return C;
}
