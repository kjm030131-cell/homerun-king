// [bugs] 화면 흐름 시나리오 — 진짜 크롬(헤드리스)에서 혼자하기 전체 흐름을 봇으로 돌리며 예외·멈춤·UI 겹침·이벤트/사운드 신호 중복·누락·장비 상태를 검사한다.
//   node tools/qa/flows.mjs                 # 전부
//   node tools/qa/flows.mjs solo-real derby # 골라서   (--list 목록, --shots 스크린샷 저장, --v 진행 표시)
// 흐름: 타이틀 → 모드 → 혼자하기 설정 → 경기(봇) 중간에 Esc 일시정지·설정 변경·채팅·Tab 기록·H 조작법 → 결과 화면 → 한 판 더 → 나가기(로비) → 다른 모드 다시 시작
// 검사:
//  · 예외(rAF/프레임/틱/콘솔), 가상 시계로 진행하는데 게임 시간이 안 흐름(멈춤), 일시정지 중 게임 시간이 흐름
//  · UI 겹침: 화면에 보이는 HUD 요소끼리 사각형이 겹치는지 (겹쳐도 되는 쌍은 제외) + 스크린샷(--shots)
//  · bus 이벤트: 같은 투구(pid)에 windup/release/contact/판정이 두 번 · 같은 이벤트가 같은 시각에 두 번 · 내 스윙 localSwing 중복 · 미트 소리 신호(cue:mitt) 중복
//  · 장비: 타자 헬멧(모자 숨김)·배트, 수비 모자, 포수 마스크, 주자 헬멧 — 공수 교대·리플레이·다시 하기 뒤에도
//  · 투구 공: 실밥 텍스처, 지나간 뒤 통과점 색(존 = 노랑, 볼 = 하늘색)
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { bundle, serve, root, outDir } from './serve.mjs';

const argv = process.argv.slice(2);
const opt = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const names = argv.filter((a) => !a.startsWith('--'));
const FLOWS = {
  'solo-real': { rules: 'real', mode: 'game', inn: '1', pos: 'any', desc: '리얼 1이닝 끝까지 + 일시정지·설정·채팅·Tab·H + 결과·한 판 더·나가기 → 캐주얼 다시 시작' },
  'solo-casual': { rules: 'casual', mode: 'game', inn: '1', pos: 'any', desc: '캐주얼 끝까지 + 한 판 더' },
  pitcher: { rules: 'real', mode: 'game', inn: '1', pos: 'P', team: 'home', desc: '투수(홈) — 투구·견제·수비' },
  fielder: { rules: 'real', mode: 'game', inn: '1', pos: 'CF', team: 'home', fld: 'pos', desc: '중견수 직접 조작' },
  derby: { rules: 'real', mode: 'derby', inn: '1', desc: '홈런 더비 끝까지 + 한 판 더' },
  practice: { rules: 'real', mode: 'practice', desc: '타격 연습: 구종 1~6·0 바꾸며' },
};
if (opt.list) { for (const [k, v] of Object.entries(FLOWS)) console.log(k.padEnd(12), v.desc); process.exit(0); }
const pick = names.length ? names : Object.keys(FLOWS);

const req = (m) => { for (const b of [root, '/opt/npm-tools']) { try { return createRequire(b + '/')(m); } catch { } } throw new Error(m + ' 없음'); };
const { chromium } = req('playwright-core');
const chrome = [process.env.CHROME, '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && existsSync(p));
mkdirSync(outDir, { recursive: true });

const b = await bundle();
console.log(`[flows] 번들 ${b.tool} ${b.ms}ms`);
const { srv, port } = await serve({});
const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const inject = readFileSync(join(root, 'tools/qa/inject.js'), 'utf8') + '\n' + readFileSync(join(root, 'tools/qa/driver.js'), 'utf8') + '\n' + PAGE_HELPERS();
let bad = 0;

for (const name of pick) {
  const F = FLOWS[name]; if (!F) { console.log('없는 흐름', name); continue; }
  const t0 = Date.now();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const cons = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/GL Driver|Failed to load resource/.test(m.text())) cons.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => cons.push('[pageerror] ' + (e.stack || e.message).split('\n').slice(0, 4).join(' | ')));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, body: '' }));
  await page.addInitScript({ content: inject + `;window.__qa.seed(${+opt.seed || 11});` });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => document.getElementById('bPlay') && window.__bus, null, { timeout: 30000, polling: 300 });
  await page.waitForTimeout(6000); // 새 캐릭터 GLB 로딩 (가상 시계 루프 중엔 로딩이 안 끝남)
  const R = { name, issues: [], notes: [] };
  const issue = (k, m = '') => R.issues.push(`${k}${m ? ': ' + m : ''}`);
  const ev = (fn, a) => page.evaluate(fn, a);
  const step = (sec, render = 0) => ev(([s, r]) => window.__qaStep(s, { render: r }), [sec, render]);
  const st = () => ev(() => window.__qf.state());
  const shot = async (tag) => { const o = await ev(() => window.__qf.overlap()); if (o.length) issue('UI 겹침(' + tag + ')', o.join(' · ')); if (opt.shots) { await ev(() => { window.__noRender = 0; window.__frame(window.__V); window.__noRender = 1; }); await page.screenshot({ path: join(outDir, `flow-${name}-${tag}.png`) }); } };
  const key = (k, type = 'tap') => ev(([k, type]) => window.__qf.key(k, type), [k, type]);
  // 실행: 조건이 될 때까지 게임을 굴림 (최대 sec 게임초)
  const runUntil = async (cond, sec, chunk = 5) => { for (let t = 0; t < sec; t += chunk) { await step(chunk); const s = await st(); if (opt.v) console.log(`  .. ${s.screen}/${s.ph} ${s.inn}회${s.half ? '말' : '초'} ${s.sc} t=${s.now}`); if (await ev(cond)) return true; } return false; };
  try {
    await page.waitForFunction(() => { const A = window.__actors && window.__actors(); return A && A.umps[0] && A.umps[0].p.isChar; }, null, { timeout: 40000, polling: 500 }).catch(() => R.notes.push('새 캐릭터 로딩 안 끝남(옛 몸으로 진행)'));
    await ev((F) => window.__qf.startSolo(F), F);
    await page.waitForTimeout(1200);
    await ev(() => { window.__qaVclock(); window.__qf.tap(); window.__qa.bot.again = false; });
    await step(3);
    if (opt.probe) console.log('PROBE', JSON.stringify(await ev(() => { const A = window.__actors(), b = A.batter.p, H = window.__hr; const head = []; b.helmetG.traverse((o) => { if (o.isMesh) { const w = o.getWorldPosition(new o.position.constructor()); head.push([o.name, o.visible, +w.x.toFixed(2), +w.y.toFixed(2), +w.z.toFixed(2), o.material && o.material.opacity, o.material && o.material.visible]); } }); const r = b.root.position; let v = true; for (let o = b.helmetG; o; o = o.parent) v = v && o.visible; return { helmet: b.helmetG.visible, chainVisible: v, cap: b.capG.visible, inScene: !!b.root.parent, root: [r.x, r.y, r.z], parent: b.helmetG.parent && b.helmetG.parent.name, meshes: head.slice(0, 5), cam: H.cam(), lib: !!b.char }; })));
    const s0 = await st(); if (s0.screen !== 'game') issue('경기 화면으로 안 들어감', JSON.stringify(s0));
    await shot('start');
    // ── 경기 중 UI 조작 ──
    if (F.mode === 'game') {
      await runUntil(() => window.__qf.state().ph === 'pitching', 20, 1);
      await shot('pitching');
      // Esc 일시정지: 게임 시간 멈춤
      await key('Escape');
      const a = await st(); await step(2); const b2 = await st();
      if (!a.menu) issue('Esc 메뉴가 안 열림');
      if (b2.now !== a.now) issue('일시정지 중 게임 시간이 흐름', `${a.now} → ${b2.now}`);
      await shot('menu');
      // 설정 열어 바꾸기
      await ev(() => document.getElementById('mSettings').click());
      const sc = await ev(() => window.__qf.changeSettings());
      if (!sc.open) issue('설정 창이 안 열림');
      { const x = await st(); await step(1); const y = await st(); if (y.now !== x.now) issue('일시정지 메뉴에서 연 설정 창이 열린 동안 게임이 흐름', `${x.now} → ${y.now}`); }
      await shot('settings');
      await key('Escape');
      const c = await st(); if (c.menu || c.modal.length) issue('Esc 로 창이 안 닫힘', JSON.stringify(c.modal)); await step(1); const c2 = await st(); if (c2.now === c.now) issue('일시정지 풀린 뒤에도 게임 시간이 안 흐름');
      // 채팅
      await key('Enter'); await ev(() => { const i = document.getElementById('chatin'); i.value = 'QA 채팅 테스트'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
      await step(0.5);
      const ch = await ev(() => document.getElementById('chatlog').textContent);
      if (!/QA 채팅 테스트/.test(ch)) issue('채팅이 기록에 안 뜸');
      await shot('chat');
      // 빠른 채팅 T → 1
      await key('t'); await key('1'); await step(0.3);
      // Tab 기록
      await key('Tab', 'down'); await step(0.2);
      const tb = await ev(() => ({ shown: !document.getElementById('tab').classList.contains('hide'), rows: document.querySelectorAll('#tabStats tr').length, line: document.getElementById('tabLine').textContent.length }));
      if (!tb.shown || !tb.line) issue('Tab 기록이 안 뜸', JSON.stringify(tb));
      await shot('tab');
      await key('Tab', 'up'); await step(0.2);
      if (await ev(() => !document.getElementById('tab').classList.contains('hide'))) issue('Tab 떼도 기록이 안 닫힘');
      // H 조작법
      await key('h'); const hp = await ev(() => !document.getElementById('helpM').classList.contains('hide'));
      if (!hp) issue('H 조작법이 안 열림');
      await shot('help');
      await key('h'); if (await ev(() => !document.getElementById('helpM').classList.contains('hide'))) issue('H 다시 눌러도 조작법이 안 닫힘');
      // 끝까지 (장비·이벤트는 매 스텝 page 안에서 검사)
      const ok = await runUntil(() => document.body.dataset.screen === 'over', 1500, 10);
      if (!ok) issue('경기가 끝까지 안 감(1500초)', JSON.stringify(await st()));
      await step(2.5);
      await shot('over');
      const ov = await ev(() => ({ line: document.getElementById('overLine').textContent, final: document.getElementById('overFinal').textContent, again: !document.getElementById('bAgain').classList.contains('hide'), toLobby: !document.getElementById('bToLobby').classList.contains('hide'), sc: window.__hr.S().sc, ls: window.__hr.S().ls }));
      if (!ov.line || !ov.final) issue('결과 화면 표가 비어 있음');
      if (!ov.again) issue('혼자하기 결과 화면에 한 판 더 버튼 없음');
      if (ov.toLobby) issue('혼자하기 결과 화면에 대기실로 버튼(멀티 전용)이 보임');
      { const sum = (a) => (a || []).reduce((x, v) => x + (typeof v === 'number' ? v : 0), 0); if (sum(ov.ls[0]) !== ov.sc[0] || sum(ov.ls[1]) !== ov.sc[1]) issue('결과 라인스코어 합 ≠ 점수', `${JSON.stringify(ov.ls)} vs ${ov.sc}`); }
      // 한 판 더
      await ev(() => document.getElementById('bAgain').click()); await step(3);
      const ag = await st();
      if (ag.screen !== 'game' || ag.inn !== 1 || ag.sc.join() !== '0,0') issue('한 판 더 → 새 경기로 안 바뀜', JSON.stringify(ag));
      await runUntil(() => window.__qf.state().ph === 'pitching', 30, 1);
      await step(20);
      // 나가기 → 로비 → 다른 규칙으로 다시
      await key('Escape'); await ev(() => document.getElementById('mQuit').click()); await step(1);
      const q = await st(); if (q.screen !== 'lobby' && q.screen !== 'title') issue('나가기 → 로비로 안 감', q.screen);
      if (q.actors) issue('나간 뒤에도 선수들이 장면에 남음', JSON.stringify(q.actors));
      if (name === 'solo-real') {
        await ev(() => window.__qf.startSolo({ rules: 'casual', mode: 'game', inn: '1', pos: 'any', again: 1 })); await step(4);
        const z = await st(); if (z.screen !== 'game' || z.ru !== 'casual') issue('로비 복귀 후 다른 규칙 경기 시작 실패', JSON.stringify(z));
        await runUntil(() => window.__qf.state().ph === 'live', 120, 5); await step(15);
      }
    } else {
      // 더비·연습
      if (F.mode === 'practice') for (const k of ['1', '2', '3', '4', '5', '6', '0']) { await key(k); await step(12); }
      const ok = F.mode === 'derby' ? await runUntil(() => document.body.dataset.screen === 'over', 1200, 10) : (await step(60), true);
      if (!ok) issue('더비가 안 끝남');
      if (F.mode === 'derby') {
        await step(2.5); await shot('over');
        await ev(() => document.getElementById('bAgain').click()); await step(3);
        const ag = await st(); if (ag.screen !== 'game' || ag.mode !== 'derby') issue('더비 한 판 더 실패', JSON.stringify(ag));
        await step(30);
      } else await shot('practice');
    }
    const fin = await ev(() => window.__qf.report());
    for (const x of fin.issues) issue(x[0], x[1]);
    R.notes.push(`이벤트 ${fin.nev}개 · 투구 ${fin.pitches} · 타격 ${fin.contacts} · 내 스윙 판정 비교 ${fin.lsCmp} · 장비 검사 ${fin.equipChecks}회 · 통과점 ${fin.cross} (존 노랑 ${fin.crossY}/볼 하늘 ${fin.crossB}) · 오디오 voices 최대 ${fin.audioPeak} 버림 ${fin.audioDropped}`);
    const q = await ev(() => window.__qa.errors);
    for (const e of q) issue(`예외 [${e.src}] ×${e.n}`, e.msg.split('\n').slice(0, 3).join(' | '));
  } catch (e) { issue('FATAL', String(e.message || e).slice(0, 300)); }
  for (const c of [...new Set(cons)].slice(0, 8)) if (!/\[anim\]|404|sfx\/index/.test(c)) issue('콘솔', c);
  await page.close();
  const uniq = [...new Set(R.issues)];
  if (uniq.length) bad++;
  console.log(`\n══ ${name} (${((Date.now() - t0) / 1000).toFixed(0)}s) — ${F.desc}`);
  for (const n of R.notes) console.log('  ' + n);
  if (!uniq.length) console.log('  문제 없음');
  for (const x of uniq.slice(0, 30)) console.log('  ✗ ' + x);
}
await browser.close(); srv.close();
process.exit(bad ? 1 : 0);

// ── 페이지 안 도우미 (inject 뒤에 붙음) ──
function PAGE_HELPERS() {
  return `(${function () {
    const Q = window.__qa;
    const $ = (id) => document.getElementById(id);
    const vis = (el) => { if (!el) return false; const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return false; const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const F = (window.__qf = { issues: [], nev: 0, pitches: 0, contacts: 0, equipChecks: 0, cross: 0, crossY: 0, crossB: 0 });
    const issue = (k, m) => { if (F.issues.length < 200 && !F.issues.some((x) => x[0] === k)) F.issues.push([k, m]); };
    F.key = (k, type) => {
      const code = k === ' ' ? 'Space' : /^\d$/.test(k) ? 'Digit' + k : /^[a-z]$/.test(k) ? 'Key' + k.toUpperCase() : k;
      const tgt = document.activeElement && document.activeElement !== document.body ? document.activeElement : window;
      if (type !== 'up') tgt.dispatchEvent(new KeyboardEvent('keydown', { key: k, code, bubbles: true, cancelable: true }));
      if (type !== 'down') tgt.dispatchEvent(new KeyboardEvent('keyup', { key: k, code, bubbles: true, cancelable: true }));
    };
    F.tap = () => { const c = $('c'); c && c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); };
    F.startSolo = (S) => {
      const seg = (id, v) => { const b = document.querySelector('#' + id + ' [data-v="' + v + '"]'); if (b) b.click(); };
      window.__fastCam = 1;
      if (!S.again) { $('nick').value = 'QA봇'; $('bPlay').click(); }
      if (document.body.dataset.screen === 'title') $('bPlay').click();
      if (document.body.dataset.screen === 'modes' || !S.again) { const m = document.querySelector('#modes [data-rules="' + S.rules + '"]'); m && m.click(); }
      $('bSolo').click();
      seg('oRules', S.rules); seg('oMode', S.mode); if (S.inn) seg('oInn', S.inn); if (S.team) seg('oTeam', S.team); if (S.fld) seg('oFld', S.fld);
      if (S.pos) $('oPos').value = S.pos;
      $('oGo').click();
    };
    F.changeSettings = () => {
      const open = vis($('setM'));
      for (const id of ['shake', 'replayS', 'fpsS', 'assist']) { const el = $(id); if (el && el.type === 'checkbox') el.click(); else if (el && el.tagName === 'SELECT' && el.options.length > 1) { el.selectedIndex = (el.selectedIndex + 1) % el.options.length; el.dispatchEvent(new Event('change', { bubbles: true })); } }
      const gq = $('gq'); if (gq && gq.tagName === 'SELECT') { gq.selectedIndex = 0; gq.dispatchEvent(new Event('change', { bubbles: true })); }
      for (const id of ['vol', 'sens', 'volSfx']) { const el = $(id); if (el) { el.value = String(Math.round((+el.max || 100) * 0.4)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } }
      return { open };
    };
    F.state = () => {
      const H = window.__hr, S = H && H.S(), g = H && H.game;
      const modal = [...document.querySelectorAll('.modal, [id$="M"]')].filter((m) => m.id && vis(m)).map((m) => m.id);
      const A = window.__actors && window.__actors();
      const inScene = A ? [...A.fielders, A.batter, ...A.runners].filter((a) => a && a.p.root.parent).length : 0;
      return { screen: document.body.dataset.screen, ph: S && S.ph, inn: S && S.inn, half: S && S.half, sc: S && S.sc, ru: S && S.ru, mode: S && S.mode, now: g ? +g.now.toFixed(3) : null, menu: vis($('menuM')), modal, actors: document.body.dataset.screen === 'game' || document.body.dataset.screen === 'over' ? 0 : inScene };
    };
    // 화면에 보이는 HUD 요소끼리 겹침 (겹쳐도 되는 것: 같은 묶음 안, 전체 화면 덮개)
    const HUD = ['bug', 'matchup', 'role', 'ping', 'clock', 'duty', 'pcue', 'ptype', 'bigcount', 'banner', 'coach', 'walkup', 'intro', 'cast', 'swa', 'hitinfo', 'tbar', 'pitchbar', 'gauge', 'modeTag', 'buntBtn', 'keys', 'minimap', 'replay', 'hint', 'chat', 'quick', 'fb'];
    const OK = new Set(['banner|bigcount', 'banner|coach', 'banner|matchup', 'banner|role', 'intro|walkup', 'gauge|pitchbar', 'gauge|ptype', 'pitchbar|ptype', 'pcue|ptype', 'bug|clock', 'ping|clock', 'role|duty', 'banner|cast', 'replay|hint', 'chat|quick', 'hitinfo|swa']);
    F.overlap = () => {
      if (document.body.dataset.screen !== 'game') return [];
      const els = HUD.map((id) => [id, $(id)]).filter(([, el]) => vis(el)).map(([id, el]) => [id, el.getBoundingClientRect()]);
      const out = [];
      for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
        const [a, A] = els[i], [b, B] = els[j];
        const w = Math.min(A.right, B.right) - Math.max(A.left, B.left), h = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
        if (w > 6 && h > 6 && !OK.has([a, b].sort().join('|')) && !$(a).contains($(b)) && !$(b).contains($(a))) out.push(a + '×' + b + ' ' + Math.round(w) + 'x' + Math.round(h) + 'px');
      }
      return out;
    };
    // ── 이벤트 탭: 같은 투구에 중복, 같은 이벤트가 같은 시각 두 번 ──
    const per = new Map(); let lastSig = new Map();
    const PER_PID = ['windup', 'release', 'contact', 'localSwing', 'cue:mitt', 'cue:release', 'strikeCall', 'ballCall', 'miss'];
    const hook = () => {
      if (!window.__bus || F.hooked) return; F.hooked = true;
      window.__bus.on('*', (t, d) => {
        F.nev++;
        if (t === 'release') F.pitches++; if (t === 'contact') F.contacts++;
        if (d && d.at != null && !/^(cue|ui|caster):/.test(t)) { const sig = t + JSON.stringify(d); const k = t + '@' + d.at; if (lastSig.get(k) === sig) issue('같은 이벤트가 같은 시각에 두 번: ' + t, sig.slice(0, 120)); lastSig.set(k, sig); if (lastSig.size > 400) lastSig = new Map([...lastSig].slice(-200)); }
        if (t === 'modeChange' && d && d.start) per.clear(); // 새 경기: pid 다시 1부터
        // 내 스윙 즉시 판정(localSwing.contact) = 서버 판정(contact/miss) 인지 (PCI+타이밍, 클라·서버 같은 함수·같은 hx)
        if (t === 'localSwing' && d) { F.ls = F.ls || new Map(); F.ls.set(d.pid, !!d.contact); F.lsN = (F.lsN || 0) + 1; }
        if ((t === 'contact' || t === 'miss') && d && d.human && F.ls && F.ls.has(d.pid)) { const want = F.ls.get(d.pid); F.ls.delete(d.pid); F.lsCmp = (F.lsCmp || 0) + 1; if (want !== (t === 'contact')) issue('내 화면 즉시 판정 ≠ 서버 판정', 'pid ' + d.pid + ' 화면 ' + (want ? '맞음' : '헛스윙') + ' / 서버 ' + t + (d.why ? '(' + d.why + ')' : '') + ' mode=' + d.mode); }
        if (d && d.pid != null && PER_PID.includes(t)) { const k = t + '#' + d.pid; const n = (per.get(k) || 0) + 1; per.set(k, n); if (n === 2) issue('같은 투구(pid)에 ' + t + ' 두 번', 'pid ' + d.pid); if (per.size > 2000) per.clear(); }
      });
    };
    // ── 매 스텝: 장비·통과점·공 ──
    let lastPid = -1, sawCross = -1;
    F.check = () => {
      hook();
      const H = window.__hr; if (!H) return; const S = H.S(); if (!S || !S.fl || document.body.dataset.screen !== 'game') return;
      const A = window.__actors && window.__actors(); if (!A) return;
      const rp = H.rp && H.rp.active;
      F.equipChecks++;
      const tag = rp ? '(리플레이 중)' : '';
      const C = (a) => a && a.p && a.p.capG; // 새 캐릭터만 (옛 몸은 장비 구조가 다름)
      if (A.batter && C(A.batter) && A.batter.p.root.parent && S.mode === 'game' || (A.batter && C(A.batter) && A.batter.p.root.parent && S.mode === 'derby')) {
        const p = A.batter.p;
        if (!p.helmetG.visible) issue('타자 헬멧 안 씀' + tag, S.inn + '회');
        if (p.capG.visible) issue('타자가 모자+헬멧 둘 다' + tag, S.inn + '회');
      }
      for (const a of A.fielders) {
        if (!C(a) || !a.p.root.parent) continue;
        if (a.pos === 'C') { if (!a.p.maskG.visible) issue('포수 마스크 없음' + tag); continue; }
        if (!a.p.capG.visible) issue('수비수 모자 없음 ' + a.pos + tag, S.inn + '회' + (S.half ? '말' : '초'));
        if (a.p.helmetG.visible) issue('수비수가 헬멧 씀 ' + a.pos + tag, S.inn + '회' + (S.half ? '말' : '초'));
      }
      for (const a of A.runners) { if (!C(a) || !a.p.root.parent || !a.p.root.visible) continue; if (!a.p.helmetG.visible) issue('주자 헬멧 안 씀' + tag); if (a.p.capG.visible) issue('주자 모자+헬멧' + tag); }
      // 통과점: 공이 지나간 뒤 색 (존 = 노랑, 볼 = 하늘색)
      const p = S.p;
      if (p && p.id !== lastPid) { lastPid = p.id; sawCross = -1; }
      H.scene.traverse((o) => {
        if (o.isMesh && o.geometry && o.geometry.type === 'CircleGeometry' && o.visible && o.renderOrder === 11 && p && sawCross !== p.id && Math.abs(o.position.z - 0.02) < 1e-3) {
          sawCross = p.id; F.cross++;
          const hex = '#' + o.material.color.getHexString(), inz = p.tx >= -0.287 && p.tx <= 0.287 && p.ty >= 0.443 && p.ty <= 1.117;
          if (hex === '#ffd23a') F.crossY++; else if (hex === '#5bc8ff') F.crossB++;
          if ((inz && hex !== '#ffd23a') || (!inz && hex !== '#5bc8ff')) issue('통과점 색이 판정과 다름', hex + ' tx=' + p.tx + ' ty=' + p.ty);
        }
      });
      // 투구 중 공: 실밥 텍스처
      if (S.ph === 'pitching' && p && H.game && H.game.now > p.t0 + 0.05 && !F.seamOk) {
        H.scene.traverse((o) => { if (o.isMesh && o.visible && o.geometry && o.geometry.type === 'SphereGeometry' && Math.abs((o.geometry.parameters.radius || 0) - 0.0592) < 0.002) { F.seamOk = 1; if (!o.material.map) issue('투구 공에 실밥 텍스처 없음'); } });
      }
    };
    F.report = () => ({ issues: F.issues, lsCmp: F.lsCmp || 0, nev: F.nev, pitches: F.pitches, contacts: F.contacts, equipChecks: F.equipChecks, cross: F.cross, crossY: F.crossY, crossB: F.crossB, audioPeak: window.__audio ? window.__audio.stats.peak : null, audioDropped: window.__audio ? window.__audio.stats.dropped : null });
    // __qaStep 의 매 프레임 뒤에 검사 끼우기
    const orig = window.__qaStep;
    window.__qaStep = (sec, o = {}) => { let r = 'ok'; const H = window.__hr; if (H && !H.net()) H.tick = () => { }; /* 나간 뒤 옛 혼자하기 틱(실제론 clearInterval 로 멈춤)이 하네스에서 계속 불리지 않게 */ const n = Math.max(1, Math.round(sec * 10)); for (let i = 0; i < n && r === 'ok'; i++) { r = orig(sec / n, o); try { F.check(); } catch (e) { Q.rec('flowcheck', e); } } return r; };
  }})();`;
}
