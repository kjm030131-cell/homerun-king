// genbody.mjs — 야구선수 몸체(매끈한 단일 메시)를 SDF로 조각 → Surface Nets → 스킨 가중치 → 간략화 → public/assets/models/body.bin
// 실행: node tools/genbody.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { MeshoptSimplifier } from 'meshoptimizer';
import { BONES } from '../client/rig.js';

const root = new URL('../', import.meta.url).pathname;
const BI = Object.fromEntries(BONES.map((b, i) => [b[0], i]));

// ── SDF 기본형 ──
const P = []; // {f, bone, k, grp}
const sym = (fn) => { fn(1, 'Left'); fn(-1, 'Right'); };
function E(c, r, bone, k, grp = 0) {
  const [cx, cy, cz] = c, [rx, ry, rz] = r;
  P.push({ bone: BI[bone], k, grp, f: (x, y, z) => {
    const px = (x - cx) / rx, py = (y - cy) / ry, pz = (z - cz) / rz;
    const k0 = Math.sqrt(px * px + py * py + pz * pz);
    const qx = px / rx, qy = py / ry, qz = pz / rz; const k1 = Math.sqrt(qx * qx + qy * qy + qz * qz);
    return k1 < 1e-9 ? -Math.min(rx, ry, rz) : k0 * (k0 - 1) / k1;
  } });
}
function C(a, b, r1, r2, bone, k, grp = 0) { // 둥근 원뿔(테이퍼 캡슐)
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz, rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  P.push({ bone: BI[bone], k, grp, f: (x, y, z) => {
    const pax = x - a[0], pay = y - a[1], paz = z - a[2];
    const yy = pax * bax + pay * bay + paz * baz, zz = yy - l2;
    const vx = pax * l2 - bax * yy, vy = pay * l2 - bay * yy, vz = paz * l2 - baz * yy;
    const x2 = vx * vx + vy * vy + vz * vz, y2 = yy * yy * l2, z2 = zz * zz * l2;
    const kk = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(zz) * a2 * z2 > kk) return Math.sqrt(x2 + z2) * il2 - r2;
    if (Math.sign(yy) * a2 * y2 < kk) return Math.sqrt(x2 + y2) * il2 - r1;
    return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
  } });
}
function B(c, h, r, bone, k, grp = 0) { // 둥근 상자
  P.push({ bone: BI[bone], k, grp, f: (x, y, z) => {
    const qx = Math.abs(x - c[0]) - h[0], qy = Math.abs(y - c[1]) - h[1], qz = Math.abs(z - c[2]) - h[2];
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
    return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - r;
  } });
}
const smin = (a, b, k) => { if (k <= 0) return Math.min(a, b); const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

// ── 몸 설계 (T포즈, 정면 +z, 왼쪽 +x) ──
// 몸통 — 남성 운동선수 체형: 넓은 어깨·두꺼운 가슴판·곧은 허리·좁은 골반
E([0, 1.35, -0.006], [0.17, 0.14, 0.116], 'Spine2', 0);
E([0, 1.392, 0.028], [0.158, 0.085, 0.085], 'Spine2', 0.05); // 평평한 가슴판
E([0, 1.448, -0.03], [0.145, 0.075, 0.09], 'Spine2', 0.05); // 승모
sym((s) => E([s * 0.095, 1.32, -0.03], [0.075, 0.12, 0.08], 'Spine2', 0.05)); // 광배
E([0, 1.235, 0.006], [0.15, 0.12, 0.108], 'Spine1', 0.06);
E([0, 1.12, 0.01], [0.145, 0.095, 0.104], 'Spine', 0.05);
E([0, 1.0, 0.002], [0.148, 0.1, 0.106], 'Hips', 0.05);
sym((s) => E([s * 0.062, 0.955, -0.045], [0.074, 0.085, 0.064], 'Hips', 0.04));
E([0, 1.064, 0.012], [0.14, 0.022, 0.103], 'Spine', 0.008); // 벨트
// 목·머리
C([0, 1.44, -0.026], [0, 1.6, -0.008], 0.07, 0.061, 'Neck', 0.035);
E([0, 1.69, 0.008], [0.088, 0.11, 0.1], 'Head', 0.03);
E([0, 1.628, 0.028], [0.073, 0.054, 0.07], 'Head', 0.05); // 턱
E([0, 1.598, 0.062], [0.034, 0.02, 0.03], 'Head', 0.03); // 턱끝
E([0, 1.718, 0.066], [0.074, 0.022, 0.04], 'Head', 0.03); // 눈썹뼈
C([0, 1.7, 0.096], [0, 1.668, 0.106], 0.008, 0.011, 'Head', 0.01);
sym((s) => E([s * 0.087, 1.675, 0.0], [0.013, 0.03, 0.022], 'Head', 0.01));
// 팔
sym((s, n) => {
  const X = (v) => s * v;
  E([X(0.175), 1.432, -0.048], [0.086, 0.078, 0.078], n + 'Arm', 0.045);
  C([X(0.16), 1.437, -0.05], [X(0.3), 1.437, -0.05], 0.074, 0.067, n + 'Arm', 0.03); // 소매
  C([X(0.15), 1.438, -0.05], [X(0.43), 1.438, -0.05], 0.053, 0.042, n + 'Arm', 0.02);
  E([X(0.335), 1.452, -0.044], [0.07, 0.042, 0.045], n + 'Arm', 0.03);
  C([X(0.43), 1.438, -0.05], [X(0.705), 1.438, -0.05], 0.045, 0.03, n + 'ForeArm', 0.02);
  E([X(0.5), 1.44, -0.048], [0.08, 0.042, 0.045], n + 'ForeArm', 0.03);
  B([X(0.758), 1.434, -0.05], [0.036, 0.008, 0.03], 0.011, n + 'Hand', 0.015);
  B([X(0.823), 1.433, -0.05], [0.022, 0.002, 0.031], 0.009, n + 'HandIndex1', 0.008);
  B([X(0.869), 1.433, -0.05], [0.02, 0.002, 0.029], 0.008, n + 'HandIndex2', 0.006);
  C([X(0.725), 1.425, -0.03], [X(0.765), 1.419, 0.008], 0.015, 0.012, n + 'HandThumb1', 0.01);
  C([X(0.765), 1.419, 0.008], [X(0.79), 1.417, 0.03], 0.012, 0.0095, n + 'HandThumb2', 0.006);
});
// 다리 (그룹 1=왼쪽, 2=오른쪽: 서로 부드럽게 붙지 않게)
sym((s, n) => {
  const g = s > 0 ? 1 : 2, X = (v) => s * v;
  C([X(0.09), 0.95, 0.0], [X(0.088), 0.55, 0.012], 0.086, 0.066, n + 'UpLeg', 0, g);
  E([X(0.092), 0.78, 0.026], [0.072, 0.16, 0.07], n + 'UpLeg', 0.04, g);
  E([X(0.088), 0.53, 0.02], [0.064, 0.068, 0.066], n + 'Leg', 0.03, g);
  C([X(0.088), 0.53, 0.012], [X(0.088), 0.365, 0.0], 0.064, 0.058, n + 'Leg', 0.03, g);
  E([X(0.088), 0.358, -0.006], [0.064, 0.03, 0.066], n + 'Leg', 0.014, g); // 바지 밑단 주름
  C([X(0.088), 0.42, -0.012], [X(0.088), 0.12, -0.022], 0.05, 0.033, n + 'Leg', 0.02, g);
  E([X(0.088), 0.395, -0.034], [0.048, 0.075, 0.05], n + 'Leg', 0.03, g);
  C([X(0.088), 0.145, -0.022], [X(0.088), 0.075, -0.02], 0.035, 0.043, n + 'Foot', 0.02, g);
  C([X(0.088), 0.062, -0.064], [X(0.088), 0.048, 0.1], 0.045, 0.04, n + 'Foot', 0.02, g);
  C([X(0.088), 0.046, 0.1], [X(0.088), 0.038, 0.168], 0.04, 0.032, n + 'ToeBase', 0.02, g);
  B([X(0.088), 0.012, 0.048], [0.04, 0.005, 0.118], 0.007, n + 'Foot', 0.008, g);
});

const GRPS = [P.filter((p) => p.grp === 0), P.filter((p) => p.grp === 1), P.filter((p) => p.grp === 2)];
function grpD(list, x, y, z) { let d = 1e9; for (const p of list) d = smin(d, p.f(x, y, z), p.k); return d; }
function sdf(x, y, z) {
  const b = grpD(GRPS[0], x, y, z);
  const l = x > -0.02 ? smin(b, grpD(GRPS[1], x, y, z), 0.035) : b;
  const r = x < 0.02 ? smin(b, grpD(GRPS[2], x, y, z), 0.035) : b;
  return Math.min(l, r);
}

// ── 격자 (거친 → 세밀) ──
const H = +(process.argv[2] || 0.0045);
const X0 = -0.95, Y0 = -0.012, Z0 = -0.2, X1 = 0.95, Y1 = 1.84, Z1 = 0.22;
const nx = Math.ceil((X1 - X0) / H) + 1, ny = Math.ceil((Y1 - Y0) / H) + 1, nz = Math.ceil((Z1 - Z0) / H) + 1;
console.log('grid', nx, ny, nz, (nx * ny * nz / 1e6).toFixed(1) + 'M');
const HC = 0.018, cx = Math.ceil((X1 - X0) / HC) + 2, cy = Math.ceil((Y1 - Y0) / HC) + 2, cz = Math.ceil((Z1 - Z0) / HC) + 2;
const coarse = new Float32Array(cx * cy * cz);
for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) coarse[i + cx * (j + cy * k)] = sdf(X0 + i * HC, Y0 + j * HC, Z0 + k * HC);
function coarseAt(x, y, z) {
  const fx = (x - X0) / HC, fy = (y - Y0) / HC, fz = (z - Z0) / HC;
  const i = Math.min(cx - 2, Math.floor(fx)), j = Math.min(cy - 2, Math.floor(fy)), k = Math.min(cz - 2, Math.floor(fz));
  const u = fx - i, v = fy - j, w = fz - k, I = (a, b, c) => coarse[a + cx * (b + cy * c)];
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(I(i, j, k), I(i + 1, j, k), u), l(I(i, j + 1, k), I(i + 1, j + 1, k), u), v), l(l(I(i, j, k + 1), I(i + 1, j, k + 1), u), l(I(i, j + 1, k + 1), I(i + 1, j + 1, k + 1), u), v), w);
}
const V = new Float32Array(nx * ny * nz);
let exact = 0;
const t0 = Date.now();
for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
  const x = X0 + i * H, y = Y0 + j * H, z = Z0 + k * H;
  const c = coarseAt(x, y, z);
  V[i + nx * (j + ny * k)] = Math.abs(c) < 0.035 ? (exact++, sdf(x, y, z)) : c;
}
console.log('sdf', exact, 'exact evals', (Date.now() - t0) + 'ms');

// ── Surface Nets ──
const idx = (i, j, k) => i + nx * (j + ny * k);
const cellV = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
const cid = (i, j, k) => i + (nx - 1) * (j + (ny - 1) * k);
const pos = [];
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
const CO = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
const cv = new Float32Array(8);
for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
  let m = 0;
  for (let c = 0; c < 8; c++) { cv[c] = V[idx(i + CO[c][0], j + CO[c][1], k + CO[c][2])]; if (cv[c] < 0) m |= 1 << c; }
  if (m === 0 || m === 255) continue;
  let sx = 0, sy = 0, sz = 0, n = 0;
  for (const [a, b] of EDGES) {
    if ((cv[a] < 0) === (cv[b] < 0)) continue;
    const t = cv[a] / (cv[a] - cv[b]);
    sx += CO[a][0] + (CO[b][0] - CO[a][0]) * t; sy += CO[a][1] + (CO[b][1] - CO[a][1]) * t; sz += CO[a][2] + (CO[b][2] - CO[a][2]) * t; n++;
  }
  cellV[cid(i, j, k)] = pos.length / 3;
  pos.push(X0 + (i + sx / n) * H, Y0 + (j + sy / n) * H, Z0 + (k + sz / n) * H);
}
const tris = [];
const quad = (a, b, c, d, flip) => {
  if (a < 0 || b < 0 || c < 0 || d < 0) return;
  if (flip) [b, d] = [d, b];
  const D = (p, q) => Math.hypot(pos[p * 3] - pos[q * 3], pos[p * 3 + 1] - pos[q * 3 + 1], pos[p * 3 + 2] - pos[q * 3 + 2]);
  if (D(a, c) < D(b, d)) tris.push(a, b, c, a, c, d); else tris.push(a, b, d, b, c, d);
};
for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
  const v0 = V[idx(i, j, k)], in0 = v0 < 0;
  if (in0 !== (V[idx(i + 1, j, k)] < 0)) quad(cellV[cid(i, j - 1, k - 1)], cellV[cid(i, j, k - 1)], cellV[cid(i, j, k)], cellV[cid(i, j - 1, k)], !in0);
  if (in0 !== (V[idx(i, j + 1, k)] < 0)) quad(cellV[cid(i - 1, j, k - 1)], cellV[cid(i - 1, j, k)], cellV[cid(i, j, k)], cellV[cid(i, j, k - 1)], !in0);
  if (in0 !== (V[idx(i, j, k + 1)] < 0)) quad(cellV[cid(i - 1, j - 1, k)], cellV[cid(i, j - 1, k)], cellV[cid(i, j, k)], cellV[cid(i - 1, j, k)], !in0);
}
console.log('raw', pos.length / 3, 'verts', tris.length / 3, 'tris');

// ── 표면으로 투영 + 법선 ──
const nv = pos.length / 3, nrm = new Float32Array(nv * 3), e = 0.0004;
for (let v = 0; v < nv; v++) {
  let x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2], gx = 0, gy = 0, gz = 0;
  for (let it = 0; it < 3; it++) {
    const d = sdf(x, y, z);
    gx = (sdf(x + e, y, z) - sdf(x - e, y, z)) / (2 * e); gy = (sdf(x, y + e, z) - sdf(x, y - e, z)) / (2 * e); gz = (sdf(x, y, z + e) - sdf(x, y, z - e)) / (2 * e);
    const g2 = gx * gx + gy * gy + gz * gz || 1;
    const st = Math.max(-H, Math.min(H, d)) / g2;
    x -= st * gx; y -= st * gy; z -= st * gz;
  }
  { const E2 = 0.0028; gx = (sdf(x + E2, y, z) - sdf(x - E2, y, z)); gy = (sdf(x, y + E2, z) - sdf(x, y - E2, z)); gz = (sdf(x, y, z + E2) - sdf(x, y, z - E2)); } // 법선은 넓게 샘플 → 매끈
  const gl = Math.hypot(gx, gy, gz) || 1;
  pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
  nrm[v * 3] = gx / gl; nrm[v * 3 + 1] = gy / gl; nrm[v * 3 + 2] = gz / gl;
}

// ── 간략화 ──
await MeshoptSimplifier.ready;
const P32 = new Float32Array(pos), I32 = new Uint32Array(tris);
const target = Math.min(I32.length, Math.round(+(process.argv[3] || 66000) / 3) * 3);
const [simp, err] = MeshoptSimplifier.simplify(I32, P32, 3, target, 0.0012, []);
console.log('simplified', simp.length / 3, 'tris err', err.toFixed(5));
const remap = new Int32Array(nv).fill(-1); let nn = 0;
for (const i of simp) if (remap[i] < 0) remap[i] = nn++;
const outP = new Float32Array(nn * 3), outN = new Int16Array(nn * 3), outJ = new Uint8Array(nn * 4), outW = new Uint8Array(nn * 4);
const outI = new Uint16Array(simp.length); for (let i = 0; i < simp.length; i++) outI[i] = remap[simp[i]];
if (nn > 65535) throw new Error('too many verts ' + nn);

// ── 스킨 가중치: 각 기본형까지 거리 → 뼈별 지수 가중 ──
const SIG = 0.011;
for (let v = 0; v < nv; v++) {
  const o = remap[v]; if (o < 0) continue;
  const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
  for (let c = 0; c < 3; c++) { outP[o * 3 + c] = pos[v * 3 + c]; outN[o * 3 + c] = Math.round(nrm[v * 3 + c] * 32767); }
  const g = x >= 0 ? 1 : 2; // 다리 쪽 제한
  const ds = P.map((p) => (p.grp === 0 || p.grp === g ? p.f(x, y, z) : 1e9));
  const dmin = Math.min(...ds);
  const wb = new Map();
  ds.forEach((d, pi) => { if (d > dmin + SIG * 5) return; const w = Math.exp(-(d - dmin) / SIG); wb.set(P[pi].bone, (wb.get(P[pi].bone) || 0) + w); });
  const top = [...wb.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const sum = top.reduce((s, t) => s + t[1], 0);
  let acc = 0;
  top.forEach(([b, w], q) => { outJ[o * 4 + q] = b; const iw = q === top.length - 1 ? 255 - acc : Math.round(w / sum * 255); outW[o * 4 + q] = iw; acc += iw; });
}
// ── 저장 ──
const head = new Uint32Array([0x31425248, nn, outI.length]); // 'HRB1'
const parts = [head, outP, outN, outJ, outW, outI];
const total = parts.reduce((s, a) => s + a.byteLength, 0);
const buf = Buffer.alloc(total); let off = 0;
for (const a of parts) { Buffer.from(a.buffer, a.byteOffset, a.byteLength).copy(buf, off); off += a.byteLength; }
mkdirSync(root + 'public/assets/models', { recursive: true });
writeFileSync(root + 'public/assets/models/' + (process.argv[4] || 'body.bin'), buf);
console.log('wrote body.bin', nn, 'verts', outI.length / 3, 'tris', (total / 1024).toFixed(0) + 'KB');
