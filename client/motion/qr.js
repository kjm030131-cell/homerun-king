// [motion] 작은 QR 인코더 — 바이트 모드 · 오류정정 L · 버전 1~6 (URL 최대 134바이트). 외부 라이브러리 없이 핸드폰 연결 주소용
const DATA = [0, 19, 34, 55, 80, 108, 136]; // 버전별 데이터 코드워드 (L)
const ECC = [0, 7, 10, 15, 20, 26, 18]; // 블록당 오류정정 코드워드
const BLOCKS = [0, 1, 1, 1, 1, 1, 2];
const ALIGN = [0, 0, 18, 22, 26, 30, 34];

function gmul(x, y) { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z & 0xff; }
function rsDivisor(deg) {
  const r = new Array(deg).fill(0); r[deg - 1] = 1; let root = 1;
  for (let i = 0; i < deg; i++) { for (let j = 0; j < deg; j++) { r[j] = gmul(r[j], root); if (j + 1 < deg) r[j] ^= r[j + 1]; } root = gmul(root, 2); }
  return r;
}
function rsRem(data, div) {
  const r = div.map(() => 0);
  for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= gmul(c, f); }); }
  return r;
}

// 문자열 → 모듈 2차원 배열 (true = 검정)
export function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(text)];
  let ver = 1; while (ver <= 6 && bytes.length + 2 > DATA[ver]) ver++;
  if (ver > 6) throw new Error('QR: 너무 긴 주소');
  const cap = DATA[ver];
  // 비트열: 모드(0100) + 길이(8) + 데이터 + 종료 + 패딩
  const bits = [];
  const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(4, 4); put(bytes.length, 8); for (const b of bytes) put(b, 8);
  put(0, Math.min(4, cap * 8 - bits.length)); while (bits.length % 8) bits.push(0);
  const cw = []; for (let i = 0; i < bits.length; i += 8) cw.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let p = 0; cw.length < cap; p ^= 1) cw.push(p ? 0x11 : 0xec);
  // 블록 나눠 오류정정 붙이고 끼워 넣기
  const nb = BLOCKS[ver], bl = cap / nb, div = rsDivisor(ECC[ver]);
  const blocks = [], eccs = [];
  for (let i = 0; i < nb; i++) { const d = cw.slice(i * bl, (i + 1) * bl); blocks.push(d); eccs.push(rsRem(d, div)); }
  const all = [];
  for (let i = 0; i < bl; i++) for (const b of blocks) all.push(b[i]);
  for (let i = 0; i < ECC[ver]; i++) for (const e of eccs) all.push(e[i]);

  const N = 17 + ver * 4;
  const M = Array.from({ length: N }, () => new Array(N).fill(false));
  const F = Array.from({ length: N }, () => new Array(N).fill(false)); // 기능 모듈(데이터 못 씀)
  const set = (x, y, v) => { M[y][x] = v; F[y][x] = true; };
  for (let i = 0; i < N; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= N || y >= N) continue; const d = Math.max(Math.abs(dx), Math.abs(dy)); set(x, y, d !== 2 && d !== 4); } };
  finder(3, 3); finder(N - 4, 3); finder(3, N - 4);
  if (ver >= 2) { const a = ALIGN[ver]; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(a + dx, a + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }
  const format = (mask) => {
    const data = (1 << 3) | mask; // L = 01
    let rem = data; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const b = ((data << 10) | rem) ^ 0x5412, bit = (i) => ((b >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(N - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, N - 15 + i, bit(i));
    set(8, N - 8, true);
  };
  format(0);
  // 데이터 배치 (오른쪽 아래부터 두 줄씩 지그재그)
  let k = 0;
  for (let right = N - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < N; v++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? N - 1 - v : v;
      if (!F[y][x] && k < all.length * 8) { M[y][x] = ((all[k >>> 3] >>> (7 - (k & 7))) & 1) === 1; k++; }
    }
  }
  const MASKS = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const apply = (m) => { for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!F[y][x] && MASKS[m](x, y)) M[y][x] = !M[y][x]; };
  // 벌점이 가장 낮은 마스크 (같은 색 연속·2×2 덩어리·흑백 비율)
  const penalty = () => {
    let p = 0, dark = 0;
    for (let y = 0; y < N; y++) for (let r = 0; r < 2; r++) {
      let run = 1;
      for (let i = 1; i < N; i++) { const a = r ? M[i][y] : M[y][i], b = r ? M[i - 1][y] : M[y][i - 1]; if (a === b) run++; else { if (run >= 5) p += run - 2; run = 1; } }
      if (run >= 5) p += run - 2;
    }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { if (M[y][x]) dark++; if (x < N - 1 && y < N - 1) { const c = M[y][x]; if (c === M[y][x + 1] && c === M[y + 1][x] && c === M[y + 1][x + 1]) p += 3; } }
    return p + Math.floor(Math.abs(dark * 20 - N * N * 10) / (N * N)) * 10;
  };
  let best = 0, bestP = 1e9;
  for (let m = 0; m < 8; m++) { apply(m); format(m); const pp = penalty(); if (pp < bestP) { bestP = pp; best = m; } apply(m); }
  apply(best); format(best);
  return M;
}

// 캔버스에 그리기 (흰 여백 4칸)
export function drawQR(canvas, text, px = 6) {
  const M = qrMatrix(text), N = M.length, S = (N + 8) * px;
  canvas.width = canvas.height = S;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, S, S); g.fillStyle = '#0b1220';
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (M[y][x]) g.fillRect((x + 4) * px, (y + 4) * px, px, px);
  return canvas;
}
