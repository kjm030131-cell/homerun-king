// [motion] One-Euro 필터 (Casiez 2012): 가만히 있을 땐 떨림을 강하게 거르고, 빠르게 움직이면 지연 없이 바로 따라감
//  minCut: 정지 상태 차단 주파수(Hz, 낮을수록 부드러움) · beta: 속도에 따라 차단 주파수를 올리는 정도(클수록 빠른 동작에 덜 늦음)
//  dCut: 속도 추정용 차단 주파수. 값과 함께 걸러진 속도(dx, 단위/초)도 줌 → 프레임 사이 예측(외삽)에 씀
const alpha = (cut, dt) => { const r = 2 * Math.PI * cut * dt; return r / (r + 1); };
export class OneEuro {
  constructor(minCut = 1.2, beta = 0.6, dCut = 1.5) { this.minCut = minCut; this.beta = beta; this.dCut = dCut; this.x = null; this.dx = 0; }
  reset() { this.x = null; this.dx = 0; }
  // w: 이번 값의 믿음(0~1, 관절이 안 보이면 낮게 → 덜 따라감)
  filter(v, dt, w = 1) {
    if (this.x === null || !(dt > 0)) { this.x = v; this.dx = 0; return v; }
    const d = (v - this.x) / dt;
    this.dx += (d - this.dx) * alpha(this.dCut, dt);
    const cut = this.minCut + this.beta * Math.abs(this.dx);
    this.x += (v - this.x) * alpha(cut, dt) * w;
    return this.x;
  }
}
// 꼭짓점 시각 보정: 세 표본(t0,v0)(t1,v1)(t2,v2) 중 가운데가 최대일 때 포물선 꼭짓점 시각 — 센서 주기(16~50ms)보다 정확한 '맞는 순간'
export function peakTime(t0, v0, t1, v1, t2, v2) {
  const d0 = t1 - t0, d1 = t2 - t1; if (!(d0 > 0 && d1 > 0)) return t1;
  // 일반 간격 포물선: 세 점을 지나는 2차식의 꼭짓점
  const a = ((v2 - v1) / d1 - (v1 - v0) / d0) / (d0 + d1);
  if (!(a < 0)) return t1;
  const b = (v1 - v0) / d0 - a * (t1 + t0);
  const tp = -b / (2 * a);
  return Math.max(t0 + d0 * 0.5, Math.min(t2 - d1 * 0.5, tp));
}
