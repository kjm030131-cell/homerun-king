// lab.js — 캐릭터 맞춤 화면 (?animlab 로 열기). 게임과 따로 그리는 작은 3D 창.
// 모자·헬멧·글러브·배트 자리, 클립 방향(yaw)·구간(trim)·마커를 눈으로 보며 고치고 → [JSON 복사] → public/assets/models/manifest.json 에 붙여 넣기.
import * as THREE from 'three';
import { loadLib } from './loader.js';
import { prepHeadItem, prepGlove, prepBat, prepClip } from './loader.js';
import { FIT, CLIPS, BODY } from './clips.js';
import { PITCH_TL } from './timing.js';
import { UNIFORMS } from '../player.js';

const css = `#animlab{position:fixed;inset:0;z-index:9999;background:#1b2230;display:flex;font:13px/1.4 system-ui,sans-serif;color:#e8ecf3}
#animlab canvas{flex:1;min-width:0}#animlab .pn{width:330px;overflow:auto;padding:10px;background:#111722;border-left:1px solid #2c3546}
#animlab h3{margin:12px 0 4px;font-size:13px;color:#ffcf3f}#animlab label{display:flex;gap:6px;align-items:center;margin:2px 0}
#animlab input[type=number]{width:62px;background:#0b0f17;color:#fff;border:1px solid #334;padding:2px}#animlab select,#animlab button{background:#26324a;color:#fff;border:1px solid #3a4a66;padding:3px 8px;border-radius:4px}
#animlab .row{display:flex;gap:4px;flex-wrap:wrap}#animlab .msg{color:#9fb0c8;white-space:pre-wrap}#animlab textarea{width:100%;height:120px;background:#0b0f17;color:#cfe;font:11px monospace}`;

export async function openLab() {
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const box = document.createElement('div'); box.id = 'animlab';
  box.innerHTML = '<canvas></canvas><div class="pn"><b>캐릭터 맞춤 (animlab)</b> <button id="alX">닫기</button><div class="msg" id="alM">불러오는 중…</div><div id="alP"></div></div>';
  document.body.appendChild(box);
  box.querySelector('#alX').onclick = () => { box.remove(); running = false; };
  const msg = (t) => { box.querySelector('#alM').textContent = t; };
  let lib;
  try { lib = await loadLib(); } catch (e) { msg(e.message === 'no-model' ? 'public/assets/models/player.glb 가 아직 없음 → 게임은 옛 몸으로 동작 중.\n(docs/rebuild/anim.md 순서대로 파일을 넣으면 여기서 바로 보임)' : '새 캐릭터를 못 읽음: ' + e.message); return; }
  const { CharPlayer } = await import('./actor.js');
  const cv = box.querySelector('canvas');
  const R = new THREE.WebGLRenderer({ canvas: cv, antialias: true }); R.setPixelRatio(Math.min(2, devicePixelRatio)); R.outputColorSpace = THREE.SRGBColorSpace; R.shadowMap.enabled = true;
  const sc = new THREE.Scene(); sc.background = new THREE.Color('#2a3446');
  sc.add(new THREE.HemisphereLight('#dfe8ff', '#3a3328', 1.4));
  const sun = new THREE.DirectionalLight('#fff', 2.2); sun.position.set(3, 6, 4); sun.castShadow = true; sc.add(sun);
  const gr = new THREE.Mesh(new THREE.CircleGeometry(4, 48), new THREE.MeshStandardMaterial({ color: '#7a6247', roughness: 1 })); gr.rotation.x = -Math.PI / 2; gr.receiveShadow = true; sc.add(gr);
  sc.add(new THREE.GridHelper(4, 8, '#556', '#445'));
  const cam = new THREE.PerspectiveCamera(35, 1, 0.05, 50);
  let yaw = 0.6, pitch = 0.15, dist = 3.2, focusY = 1.0, drag = null;
  cv.onpointerdown = (e) => { drag = [e.clientX, e.clientY]; cv.setPointerCapture(e.pointerId); };
  cv.onpointermove = (e) => { if (!drag) return; yaw -= (e.clientX - drag[0]) * 0.01; pitch = Math.max(-0.5, Math.min(1.3, pitch + (e.clientY - drag[1]) * 0.01)); drag = [e.clientX, e.clientY]; };
  cv.onpointerup = () => { drag = null; };
  cv.onwheel = (e) => { dist = Math.max(0.5, Math.min(10, dist * (1 + e.deltaY * 0.001))); e.preventDefault(); };

  const S = { team: 'home', role: 'fielder', clip: lib.clips.has('idle') ? 'idle' : [...lib.clips.keys()][0], t: 0, play: true, speed: 1, pitchLoop: false, tau: 0, focus: 'body' };
  let P = null;
  const rebuild = () => {
    if (P) { sc.remove(P.root); P.dispose(); }
    P = new CharPlayer(lib, { team: S.team, num: 27, name: 'LAB', role: S.role, seed: 1 });
    P.setRole(S.role); if (S.role === 'pitcher') P.glove.visible = true;
    P.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    sc.add(P.root);
  };
  const reprep = (k) => {
    const raw = lib.raw[k]; if (!raw) return;
    if (k === 'cap' || k === 'helmet') lib.acc[k] = prepHeadItem(k, raw, lib);
    else if (k === 'bat') lib.acc.bat = prepBat(raw, lib);
    else if (k === 'glove') { lib.acc.glove = prepGlove(raw, lib); }
    rebuild();
  };
  const reclip = (name) => { const e = lib.clips.get(name); if (!e || !e.src) return; const n = prepClip(name, e.src, lib); Object.assign(e, { clip: n.clip, markers: n.markers }); rebuild(); };
  rebuild();
  msg(`${lib.incomplete && lib.incomplete.length ? '※ 필수 클립 없음(' + lib.incomplete.join(', ') + ') → 게임은 아직 옛 몸. 여기서는 있는 클립만 볼 수 있음\n' : ''}클립 ${lib.clips.size}개: ${[...lib.clips.keys()].join(', ')}\n없음: ${Object.keys(CLIPS).filter((k) => !lib.clips.has(k)).join(', ') || '-'}\n장비 GLB: ${['cap', 'helmet', 'bat', 'glove'].map((k) => k + (lib.raw[k] ? '✓' : '(대체)')).join(' ')}`);

  // ── 패널 ──
  const pn = box.querySelector('#alP');
  const h = (t) => { const e = document.createElement('h3'); e.textContent = t; pn.appendChild(e); };
  const sel = (label, opts, val, on) => { const l = document.createElement('label'); l.textContent = label; const s = document.createElement('select'); for (const o of opts) s.add(new Option(o, o)); s.value = val; s.onchange = () => on(s.value); l.appendChild(s); pn.appendChild(l); return s; };
  const nums = (label, arr, step, on) => { const l = document.createElement('label'); l.textContent = label; arr.forEach((v, i) => { const n = document.createElement('input'); n.type = 'number'; n.step = step; n.value = v; n.onchange = () => { arr[i] = +n.value; on(); }; l.appendChild(n); }); pn.appendChild(l); };
  const num = (label, obj, key, step, on) => { const a = [obj[key] ?? 0]; nums(label, a, step, () => { obj[key] = a[0]; on(); }); };
  const btn = (t, on) => { const b = document.createElement('button'); b.textContent = t; b.onclick = on; pn.appendChild(b); return b; };

  h('보기');
  sel('팀', ['home', 'away', 'ump'], S.team, (v) => { S.team = v; rebuild(); });
  sel('역할', ['fielder', 'batter', 'runner', 'catcher', 'pitcher', 'ump'], S.role, (v) => { S.role = v; rebuild(); });
  sel('확대', ['body', 'head', 'handL', 'handR'], 'body', (v) => { S.focus = v; dist = v === 'body' ? 3.2 : 0.9; });
  h('클립');
  const clipSel = sel('클립', [...lib.clips.keys()], S.clip, (v) => { S.clip = v; S.t = 0; S.pitchLoop = false; showClip(); });
  const tl = document.createElement('input'); tl.type = 'range'; tl.min = 0; tl.max = 1000; tl.style.width = '100%'; tl.oninput = () => { S.play = false; S.pitchLoop = false; const e = lib.clips.get(S.clip); S.t = (+tl.value / 1000) * e.clip.duration; }; pn.appendChild(tl);
  const tinfo = document.createElement('div'); tinfo.className = 'msg'; pn.appendChild(tinfo);
  const row = document.createElement('div'); row.className = 'row'; pn.appendChild(row);
  const rb = (t, on) => { const b = document.createElement('button'); b.textContent = t; b.onclick = on; row.appendChild(b); };
  rb('▶/❚❚', () => { S.play = !S.play; S.pitchLoop = false; });
  rb('×0.25', () => { S.speed = 0.25; }); rb('×1', () => { S.speed = 1; });
  rb('투구 시간표 재생', () => { S.pitchLoop = true; S.tau = 0; clipSel.value = 'pitch'; S.clip = 'pitch'; showClip(); });
  const clipBox = document.createElement('div'); pn.appendChild(clipBox);
  function showClip() {
    clipBox.innerHTML = '';
    const e = lib.clips.get(S.clip); if (!e) return;
    const c = CLIPS[S.clip];
    const save = pn; // nums()/num() 는 pn 에 붙임 → 잠깐 clipBox 로
    const add = (fn) => { const before = pn.lastChild; fn(); const el = pn.lastChild; if (el !== before) clipBox.appendChild(el); };
    add(() => num('방향 yaw(도)', c, 'yaw', 5, () => {}));
    c.trim = c.trim || [0, e.src ? Math.max(...e.src.map((a) => a.duration)) : e.clip.duration];
    add(() => nums('구간 trim(초)', c.trim, 0.05, () => reclip(S.clip)));
    c.markers = c.markers || {};
    for (const k of Object.keys(e.markers)) { const o = { v: e.markers[k] }; add(() => num('마커 ' + k, o, 'v', 0.01, () => { c.markers[k] = o.v; e.markers[k] = o.v; })); }
    void save;
  }
  showClip();
  for (const k of ['cap', 'helmet', 'glove', 'bat']) {
    h(k + (lib.raw[k] ? '' : ' (GLB 없음 — 대체 장비)'));
    const F = FIT[k];
    if (F.rot) nums('회전(도)', F.rot, 5, () => reprep(k));
    if (F.pos) nums('위치(m)', F.pos, 0.005, () => reprep(k));
    if (F.knob) nums('손잡이(m)', F.knob, 0.005, () => reprep(k));
    if (F.dir) nums('방향', F.dir, 0.05, () => reprep(k));
    if (F.width) num('머리폭 배율', F, 'width', 0.01, () => reprep(k));
    if (F.top != null) num('정수리 여유(m)', F, 'top', 0.002, () => reprep(k));
    if (F.back != null) num('뒤통수 기준(m)', F, 'back', 0.002, () => reprep(k));
    if (F.scale != null) num('크기 배율', F, 'scale', 0.02, () => reprep(k));
  }
  h('유니폼 색 판정');
  num('채도 한계', BODY.tint, 'satMax', 0.01, rebuild); num('밝기 하한', BODY.tint, 'lumMin', 0.02, rebuild);
  num('벨트 높이(키 대비)', BODY.tint, 'belt', 0.005, rebuild); num('스타킹 높이', BODY.tint, 'sock', 0.01, rebuild); num('목 높이', BODY.tint, 'neck', 0.005, rebuild);
  h('저장');
  const ta = document.createElement('textarea');
  btn('JSON 만들기/복사', () => {
    const clips = {}; for (const k in CLIPS) { const c = CLIPS[k]; const o = {}; if (c.yaw) o.yaw = c.yaw; if (c.trim) o.trim = c.trim; if (c.markers && Object.keys(c.markers).length) o.markers = c.markers; if (Object.keys(o).length) clips[k] = o; }
    const j = JSON.stringify({ fit: FIT, clips, body: { tint: BODY.tint, decal: BODY.decal } }, null, 1);
    ta.value = j; navigator.clipboard?.writeText(j).catch(() => {});
  });
  pn.appendChild(ta);
  const m2 = document.createElement('div'); m2.className = 'msg'; m2.textContent = '→ public/assets/models/manifest.json 으로 저장해서 push'; pn.appendChild(m2);

  // ── 루프 ──
  let running = true, last = performance.now();
  const v = new THREE.Vector3();
  const loop = (now) => {
    if (!running) { R.dispose(); return; }
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const w = cv.clientWidth, hh = cv.clientHeight; if (cv.width !== (w * R.getPixelRatio()) | 0) { R.setSize(w, hh, false); cam.aspect = w / hh; cam.updateProjectionMatrix(); }
    const C = P.char, e = lib.clips.get(S.clip);
    if (S.pitchLoop) {
      S.tau += dt * S.speed; if (S.tau > PITCH_TL.release + 0.8) S.tau = 0;
      C.scrubPitch(S.tau, { fade: 0 });
      const ph = S.tau < PITCH_TL.lift ? '세트' : S.tau < PITCH_TL.peak ? '레그킥' : S.tau < PITCH_TL.hold ? '정점 멈춤' : S.tau < PITCH_TL.release ? '스트라이드' : '팔로스루';
      tinfo.textContent = `와인드업 ${S.tau.toFixed(2)}s — ${ph} (릴리스 ${PITCH_TL.release}s)`;
      P.ball.visible = S.tau < PITCH_TL.release;
    } else if (e) {
      if (S.play) S.t = (S.t + dt * S.speed) % e.clip.duration;
      C.scrub(S.clip, S.t, { fade: 0 });
      tl.value = (S.t / e.clip.duration) * 1000;
      tinfo.textContent = `${S.t.toFixed(2)} / ${e.clip.duration.toFixed(2)}s  마커 ${JSON.stringify(e.markers)}`;
    }
    C.update(dt);
    const fb = S.focus === 'body' ? null : C.bones[{ head: 'Head', handL: 'LeftHand', handR: 'RightHand' }[S.focus]];
    if (fb) { fb.getWorldPosition(v); } else v.set(0, focusY, 0);
    cam.position.set(v.x + Math.sin(yaw) * Math.cos(pitch) * dist, v.y + Math.sin(pitch) * dist, v.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    cam.lookAt(v);
    R.render(sc, cam);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
