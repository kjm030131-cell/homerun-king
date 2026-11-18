// 구단 엠블럼(캔버스로 그림) + 유니폼 색
import { CLUBS, clubOf } from '../shared/clubs.js';
export { CLUBS, clubOf };
const cache = new Map();
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const f = (v) => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)));
  return '#' + ((1 << 24) | (f(r) << 16) | (f(g) << 8) | f(b)).toString(16).slice(1);
}
export function emblemCanvas(i, size = 128) {
  const key = i + ':' + size;
  if (cache.has(key)) return cache.get(key);
  const C = clubOf(i), c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), s = size / 128;
  g.scale(s, s);
  // 방패
  const shield = () => { g.beginPath(); g.moveTo(64, 6); g.bezierCurveTo(88, 16, 104, 16, 116, 14); g.lineTo(116, 62); g.bezierCurveTo(116, 94, 92, 112, 64, 124); g.bezierCurveTo(36, 112, 12, 94, 12, 62); g.lineTo(12, 14); g.bezierCurveTo(24, 16, 40, 16, 64, 6); g.closePath(); };
  g.save(); g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 6; g.shadowOffsetY = 2; shield(); g.fillStyle = C.c2; g.fill(); g.restore();
  g.save(); g.translate(64, 66); g.scale(0.88, 0.88); g.translate(-64, -66); shield();
  const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, shade(C.c1, 0.18)); gr.addColorStop(1, shade(C.c1, -0.25));
  g.fillStyle = gr; g.fill(); g.clip();
  // 사선 띠
  g.fillStyle = C.c2; g.globalAlpha = 0.9; g.beginPath(); g.moveTo(0, 88); g.lineTo(128, 52); g.lineTo(128, 62); g.lineTo(0, 98); g.fill(); g.globalAlpha = 1;
  // 야구공 실밥 장식
  g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 2; g.beginPath(); g.arc(64, 64, 46, 0, Math.PI * 2); g.stroke();
  g.restore();
  // 글자
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '700 italic 66px Oswald, "Arial Narrow", Impact, sans-serif';
  g.lineWidth = 7; g.strokeStyle = shade(C.c1, -0.45); g.strokeText(C.k, 64, 62); g.fillText(C.k, 64, 62);
  g.font = '700 13px Oswald, "Arial Narrow", sans-serif'; g.fillStyle = C.c2 === '#1a1a1f' ? '#fff' : C.c2;
  g.fillText(C.en, 64, 104);
  cache.set(key, c);
  return c;
}
export const emblemURL = (i, size = 96) => emblemCanvas(i, size).toDataURL();
export function uniformsFor(i, side) {
  const C = clubOf(i), dark = C.c2 === '#1a1a1f';
  if (side === 'home') return { jersey: '#f4f2ec', pants: '#f4f2ec', accent: C.c1, cap: C.c1, sock: C.c1, num: C.c1, pin: i % 2 ? null : shade(C.c1, 0.72), word: C.en, trim: C.c2, k: C.k, logoFg: '#ffffff', logoSt: C.c2 === '#1a1a1f' ? '#000' : C.c2, under: C.c1, shoeAcc: C.c2 };
  return { jersey: C.c1, pants: '#b4bac8', accent: dark ? '#ffffff' : C.c2, cap: C.c1, sock: dark ? '#e8e8e8' : C.c2, num: '#ffffff', pin: null, word: C.en, trim: C.c2, k: C.k, logoFg: dark ? '#ffffff' : C.c2, logoSt: '#ffffff', under: shade(C.c1, -0.25), shoeAcc: C.c2 };
}
export { shade };
