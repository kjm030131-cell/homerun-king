// client/game/batting.js — [gameplay] 사람 타자 PCI(MLB 더쇼식 커서) 그리기 + 스윙 판정 문구
// 판정 자체는 shared/sim.js pciJudge (서버와 같은 함수 → 클라 즉시 판정 = 서버 판정)
// 금지: 공이 올 위치 미리보기 (HANDOFF 0-3). 여기 그리는 건 '내 커서'와 '타이밍' 뿐.
import * as THREE from 'three';
import { PCI, pciJudge, pciQ } from '../../shared/sim.js';

// 둥근 사각(슈퍼타원) 윤곽 점: |x/rx|^p + |y/ry|^p = 1
export function pciOutline(rx, ry, n = 64, p = PCI.P) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    pts.push([rx * Math.sign(c) * Math.pow(Math.abs(c), 2 / p), ry * Math.sign(s) * Math.pow(Math.abs(s), 2 / p)]);
  }
  return pts;
}
// 2D 캔버스 경로 (스윙 분석 창)
export function pciPath(g, cx, cy, rx, ry) {
  const pts = pciOutline(rx, ry, 48);
  g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(cx + x, cy - y) : g.moveTo(cx + x, cy - y))); g.closePath();
}
function ringGeo(rx, ry, w) {
  const o = pciOutline(rx, ry), i = pciOutline(Math.max(0.001, rx - w), Math.max(0.001, ry - w));
  const sh = new THREE.Shape(o.map(([x, y]) => new THREE.Vector2(x, y)));
  sh.holes.push(new THREE.Path(i.map(([x, y]) => new THREE.Vector2(x, y)).reverse()));
  return new THREE.ShapeGeometry(sh);
}
function fillGeo(rx, ry) { return new THREE.ShapeGeometry(new THREE.Shape(pciOutline(rx, ry).map(([x, y]) => new THREE.Vector2(x, y)))); }

// 3D PCI: 바깥 테두리(실제 판정 크기) + 옅은 채움 + 위/아래 1/3 구분선(땅볼·라인드라이브·뜬공 구역) + 가운데 점
export function createPCI(scene) {
  const mat = (o) => new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: o, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const group = new THREE.Group();
  const outer = new THREE.Mesh(new THREE.BufferGeometry(), mat(0.6));
  const fill = new THREE.Mesh(new THREE.BufferGeometry(), mat(0.07));
  const lines = new THREE.Mesh(new THREE.BufferGeometry(), mat(0.28));
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.012, 16), mat(0.9));
  group.add(fill, lines, outer, dot);
  group.children.forEach((c) => (c.renderOrder = 11));
  group.visible = false; scene.add(group);
  let key = '';
  function build(rx, ry) {
    const k = rx.toFixed(3) + ',' + ry.toFixed(3);
    if (k === key) return; key = k;
    for (const m of [outer, fill, lines]) m.geometry.dispose();
    outer.geometry = ringGeo(rx, ry, 0.011);
    fill.geometry = fillGeo(rx, ry);
    // 위·아래 1/3 지점 가로 눈금(테두리 안쪽 짧은 선)
    const w = rx * 0.55, h = 0.005, y = ry / 3;
    const g = new THREE.BufferGeometry();
    const q = (cx, cy) => [cx - w, cy - h, 0, cx + w, cy - h, 0, cx + w, cy + h, 0, cx - w, cy - h, 0, cx + w, cy + h, 0, cx - w, cy + h, 0];
    g.setAttribute('position', new THREE.Float32BufferAttribute([...q(0, y), ...q(0, -y)], 3));
    lines.geometry = g;
  }
  return {
    group,
    // mode: contact|power|bunt, ease: 판정 배율(S.hx), hot: 타이밍 창 안(초록), col: 기본 색
    update(aim, mode, ease, hot, camera, buntR) {
      if (!aim) { group.visible = false; return; }
      group.visible = true;
      if (mode === 'bunt') build(buntR * 0.6, buntR * 0.6);
      else { const P = PCI[mode] || PCI.contact; build(P.RX * ease, P.RY * ease); }
      group.position.set(aim[0], aim[1], -0.02);
      const col = hot ? '#4fd18b' : mode === 'bunt' ? '#9fd0ff' : mode === 'power' ? '#ff9f43' : '#ffffff';
      outer.material.color.set(col); outer.material.opacity = hot ? 0.95 : 0.6;
      lines.visible = mode !== 'bunt';
      group.lookAt(camera.position);
    },
    hide() { group.visible = false; },
  };
}

// 스윙 직후 판정(결정적) + 문구. 서버 contact/miss 이벤트보다 핑만큼 먼저 화면에 뜬다
export function judgeSwing(mode, dt, ax, ay, ease) {
  const J = pciJudge(mode, dt, ax, ay, ease);
  const q = J.contact ? pciQ(mode, dt, J, ease) : 0;
  const ms = Math.round(dt * 1000);
  const tm = Math.abs(dt) < 0.02 ? '완벽한 타이밍' : dt < 0 ? `${-ms}ms 빠름 → 당겨침` : `${ms}ms 늦음 → 밀어침`;
  let text, col;
  if (!J.contact) {
    text = J.why === 'early' ? `너무 빨라 (${-ms}ms)` : J.why === 'late' ? `늦었어 (${ms}ms)` : '커서가 공에서 벗어났어';
    col = '#ff8a80';
  } else {
    const part = J.ny > 0.33 ? '커서 아래쪽 → 땅볼' : J.ny < -0.33 ? '커서 위쪽 → 뜬공' : '커서 가운데 → 라인드라이브';
    text = q > 0.82 ? `퍼펙트! · ${tm}` : `${tm} · ${J.n > 0.88 ? '커서 끝 → 빗맞음' : part}`;
    col = q > 0.82 ? '#4fd18b' : q > 0.5 ? '#4fd18b' : '#ffcf3f';
  }
  return { J, q, text, col, perfect: J.contact && q > 0.82 };
}
