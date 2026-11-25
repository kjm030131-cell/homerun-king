// stadium/scoreboard.js — 중앙 대형 전광판(라인스코어·타자·카운트·구속, 큰 글자 연출) + 크라운 간판 + 좌우 LED 보조 화면
// drawScoreboard(S, extra) 는 main.js 가 매 프레임 부름 — 내용이 같으면 다시 그리지 않음(키 비교)
import * as THREE from 'three';
import { SB } from './layout.js';
import { textMesh, boxAt } from './util.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function buildScoreboard(world, M, ads) {
  const sbCanvas = document.createElement('canvas'); sbCanvas.width = 1920; sbCanvas.height = 600;
  const sbTex = new THREE.CanvasTexture(sbCanvas); sbTex.colorSpace = THREE.SRGBColorSpace; sbTex.anisotropy = 8;
  {
    const frame = [];
    frame.push(boxAt(SB.w + 3.2, SB.h + 3.2, 2.6, 0, SB.y, SB.z + 1.4)); // 본체
    frame.push(boxAt(SB.w + 4.4, 0.6, 3.2, 0, SB.y + SB.h / 2 + 1.9, SB.z + 1.4)); // 윗 처마
    frame.push(boxAt(SB.w + 4.4, 0.6, 3.2, 0, SB.y - SB.h / 2 - 1.9, SB.z + 1.4)); // 아랫 처마
    for (const sx of [-1, 1]) frame.push(boxAt(2.4, SB.y - SB.h / 2, 2.4, sx * SB.w * 0.34, (SB.y - SB.h / 2) / 2, SB.z + 1.6)); // 다리
    // 크라운 간판 받침
    frame.push(boxAt(46, 4.4, 1.2, 0, SB.y + SB.h / 2 + 4.6, SB.z + 0.8));
    // 좌우 보조 화면 틀
    for (const sx of [-1, 1]) frame.push(boxAt(15.2, 9.2, 1.4, sx * (SB.w / 2 + 10.5), SB.y - 2.5, SB.z + 1.2));
    const fm = new THREE.Mesh(mergeGeometries(frame), M.steelDark); fm.userData.sh = 'big'; world.add(fm);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(SB.w, SB.h), new THREE.MeshBasicMaterial({ map: sbTex, toneMapped: false, name: 'scoreboard' }));
    scr.position.set(0, SB.y, SB.z); scr.rotation.y = Math.PI; scr.userData.keep = true; world.add(scr);
    const top = textMesh('JAMSIL BASEBALL STADIUM', 3.0, { color: '#ffd23a', bg: '#0b0f18', px: 96 });
    top.position.set(0, SB.y + SB.h / 2 + 4.6, SB.z + 0.15); top.rotation.y = Math.PI; world.add(top);
    // 보조 화면 = 회전 LED 광고 (ad12~22)
    for (const sx of [-1, 1]) {
      const p = ads.ledPlane(14, 8, sx > 0 ? 3 : 8);
      p.position.set(sx * (SB.w / 2 + 10.5), SB.y - 2.5, SB.z + 0.45); p.rotation.y = Math.PI; p.userData.sh = 'none'; world.add(p);
    }
  }
  let sbKey = '';
  function drawScoreboard(s, extra = {}) {
    const key = JSON.stringify([s && s.ls, s && s.sc, s && s.cnt, s && s.bat && s.bat.name, s && s.hits, s && s.errs, s && s.inn, s && s.half, s && s.tn, extra.big, extra.sub, extra.lp && extra.lp.id, extra.force]);
    if (key === sbKey) return; sbKey = key;
    // [perf] 1920×600 캔버스 다시 그리기 + 텍스처 올리기(수십 ms)를 프레임 안에서 하지 않고 쉬는 시간에 (최신 값 하나만)
    pend = [s, extra];
    if (!pendT) { const ric = typeof requestIdleCallback === 'function' ? requestIdleCallback : (f) => setTimeout(f, 60); pendT = ric(() => { pendT = 0; const [a, b] = pend; pend = null; if (a !== undefined) paint(a, b); }, { timeout: 400 }); }
  }
  let pend = null, pendT = 0;
  function paint(s, extra = {}) {
    const g = sbCanvas.getContext('2d'), W = sbCanvas.width, H = sbCanvas.height;
    g.fillStyle = '#04060a'; g.fillRect(0, 0, W, H);
    g.textBaseline = 'middle';
    // LED 도트 느낌
    if (extra.big) {
      const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#2a0b02'); gr.addColorStop(0.5, '#ff6a2b'); gr.addColorStop(1, '#2a0b02');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff'; g.textAlign = 'center';
      let size = 260; g.font = `${size}px "Black Han Sans", "Noto Sans KR", sans-serif`;
      while (g.measureText(extra.big).width > W * 0.9 && size > 80) { size -= 10; g.font = `${size}px "Black Han Sans", "Noto Sans KR", sans-serif`; }
      g.fillText(extra.big, W / 2, H * 0.42);
      if (extra.sub) { g.font = '700 84px Oswald, "Noto Sans KR", sans-serif'; g.fillStyle = '#ffe9a8'; g.fillText(extra.sub, W / 2, H * 0.82); }
    } else {
      // 라인스코어
      g.fillStyle = '#0d2a1a'; g.fillRect(0, 0, W, 70);
      g.fillStyle = '#ffd23a'; g.font = '700 44px Oswald, sans-serif'; g.textAlign = 'left'; g.fillText('WALK-OFF', 30, 37);
      const inns = Math.max(9, s && s.ls ? Math.max(s.ls[0].length, s.ls[1].length) : 9);
      const x0 = 300, cw = Math.min(78, (W * 0.62 - x0) / inns);
      g.font = '700 38px Oswald, sans-serif'; g.fillStyle = '#8fa1c4'; g.textAlign = 'center';
      for (let i = 0; i < inns; i++) g.fillText(String(i + 1), x0 + i * cw + cw / 2, 112);
      const rx = x0 + inns * cw + 40;
      g.fillText('R', rx, 112); g.fillText('H', rx + 80, 112); g.fillText('E', rx + 160, 112);
      const tn = (s && s.tn) || ['원정', '홈'];
      for (const r of [0, 1]) {
        const y = 185 + r * 82;
        g.textAlign = 'left'; g.fillStyle = r ? '#7aa6ff' : '#ff7b7b';
        let size = 54; g.font = `900 ${size}px "Noto Sans KR", sans-serif`;
        while (g.measureText(tn[r]).width > x0 - 70 && size > 26) { size -= 2; g.font = `900 ${size}px "Noto Sans KR", sans-serif`; }
        g.fillText(tn[r], 50, y);
        if (s && s.half === r && s.ph !== 'over') { g.fillStyle = '#ffd23a'; g.beginPath(); g.arc(26, y, 9, 0, 7); g.fill(); }
        g.textAlign = 'center'; g.font = '700 50px Oswald, sans-serif'; g.fillStyle = '#fff';
        for (let i = 0; i < inns; i++) { const v = s && s.ls && s.ls[r][i]; if (v !== undefined && v !== null) g.fillText(String(v), x0 + i * cw + cw / 2, y); }
        g.fillStyle = '#ffd23a'; g.fillText(String(s && s.sc ? s.sc[r] : 0), rx, y);
        g.fillStyle = '#fff'; g.fillText(String(s && s.hits ? s.hits[r] : 0), rx + 80, y); g.fillText(String(s && s.errs ? s.errs[r] : 0), rx + 160, y);
      }
      // 오른쪽: 타자 · 카운트 · 구속
      const px = W * 0.66;
      g.fillStyle = '#16203a'; g.fillRect(px - 20, 80, 3, H - 100);
      g.textAlign = 'left';
      if (s && s.bat) {
        g.fillStyle = '#8fa1c4'; g.font = '700 38px "Noto Sans KR", sans-serif'; g.fillText('타자', px + 10, 125);
        g.fillStyle = '#fff'; let size = 70; g.font = `900 ${size}px "Noto Sans KR", sans-serif`;
        while (g.measureText(s.bat.name).width > W - px - 140 && size > 30) { size -= 3; g.font = `900 ${size}px "Noto Sans KR", sans-serif`; }
        g.fillText(s.bat.name, px + 110, 125);
        const [b, st, o] = s.cnt || [0, 0, 0];
        const dot = (x, y, n, max, c) => { for (let i = 0; i < max; i++) { g.fillStyle = i < n ? c : '#1a2130'; g.beginPath(); g.arc(x + i * 52, y, 19, 0, 7); g.fill(); } };
        g.font = '700 44px Oswald'; g.fillStyle = '#8fa1c4';
        g.fillText('B', px + 10, 215); dot(px + 80, 215, b, 3, '#4fd18b');
        g.fillText('S', px + 10, 285); dot(px + 80, 285, st, 2, '#ffcf3f');
        g.fillText('O', px + 10, 355); dot(px + 80, 355, o, 2, '#ff4d4d');
      }
      if (extra.lp) {
        g.textAlign = 'right'; g.fillStyle = '#ffd23a'; g.font = '700 150px Oswald, sans-serif'; g.fillText(String(extra.lp.kmh), W - 170, 300);
        g.font = '700 46px Oswald'; g.fillStyle = '#8fa1c4'; g.fillText('km/h', W - 40, 330);
        g.fillStyle = '#fff'; g.font = '900 50px "Noto Sans KR", sans-serif'; g.fillText(extra.lp.name || '', W - 40, 420);
      }
      // 하단 띠
      g.fillStyle = '#0b1120'; g.fillRect(0, H - 70, W, 70);
      g.fillStyle = '#9fb0d0'; g.font = '700 34px "Noto Sans KR", sans-serif'; g.textAlign = 'left';
      g.fillText(extra.ticker || '잠실 야구장 · WALK-OFF 리그', 30, H - 35);
    }
    // LED 격자
    g.fillStyle = 'rgba(0,0,0,.18)'; for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1); for (let x = 0; x < W; x += 4) g.fillRect(x, 0, 1, H);
    sbTex.needsUpdate = true;
  }
  return { drawScoreboard, sbTex, resetKey: () => { sbKey = ''; } };
}
