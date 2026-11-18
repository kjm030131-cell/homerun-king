// [ui] 대기실: 두 팀 명단(중계 '선발 라인업' 판), 경기 설정, 준비/시작
import { $, esc, show, setSeg } from './dom.js';
import { CLUBS, clubOf, emblemURL } from '../emblem.js';
import { teamColor } from './results.js';
import { POS_KO } from '../../shared/sim.js';

export const RULES_KO = { real: '리얼', casual: '캐주얼' };
export const rulesOf = (set) => (set && set.rules === 'casual' ? 'casual' : 'real');

// c: { lobby, myId, send(m), isLocal }
export function bindRoom(c) {
  const sendSet = (o) => { const L = c.lobby(); if (L && L.host === c.myId()) c.send({ t: 'set', ...o }); };
  const seg = (id, k, f = (v) => v) => $(id).addEventListener('change', (e) => sendSet({ [k]: f(e.detail) }));
  seg('sRules', 'rules');
  seg('sMode', 'mode'); seg('sInn', 'innings', Number); seg('sOuts', 'derbyOuts', Number); seg('sDiff', 'diff', Number);
  seg('sPub', 'pub', (v) => v === '1'); seg('sSize', 'size', Number); seg('sPit', 'pitRot'); seg('sLine', 'lineup');
  seg('sFld', 'fieldCtl'); seg('sTod', 'tod'); seg('sHit', 'hitEase', Number); seg('sTime', 'timeLim', Number);
  $('sMax').onchange = () => sendSet({ max: +$('sMax').value });
  $('sName').onchange = () => sendSet({ name: $('sName').value });
  $('sTA').onchange = $('sTH').onchange = () => sendSet({ teams: [$('sTA').value, $('sTH').value] });
  $('sPw').onchange = () => sendSet({ pw: $('sPw').value });
  document.querySelectorAll('#room [data-team]').forEach((b) => (b.onclick = () => c.send({ t: 'team', team: b.dataset.team })));
  $('myPos').onchange = () => c.send({ t: 'pos', pos: $('myPos').value });
  $('myBo').onchange = () => c.send({ t: 'bo', bo: +$('myBo').value });
  $('bReady').onclick = () => { const L = c.lobby(), me = L && L.players.find((p) => p.id === c.myId()); c.send({ t: 'ready', on: !(me && me.ready) }); };
  $('bStart').onclick = () => c.send({ t: 'start' });
}

export function renderRoom(lobby, myId, send) {
  const isHost = lobby.host === myId;
  const st = lobby.set;
  const me = lobby.players.find((p) => p.id === myId);
  const li = (p) => `<li class="pl ${p.id === myId ? 'me' : ''} ${p.ready ? 'rdy' : ''}"><span class="bo" title="타순">${p.bo ? p.bo : '-'}</span><span class="nm">${esc(p.name)}${p.conn ? '' : ' <em>끊김</em>'}</span>${p.pos !== 'any' ? `<span class="pos">${POS_KO[p.pos] || ''}</span>` : ''}${p.id === lobby.host ? '<span class="host">방장</span>' : ''}<span class="ping">${p.ping ? p.ping + 'ms' : ''}</span><span class="rd" title="${p.ready ? '준비 완료' : '대기'}">${p.ready ? '준비' : ''}</span>${isHost && p.id !== myId ? `<button class="x" data-kick="${p.id}" title="내보내기">강퇴</button>` : ''}</li>`;
  const a = lobby.players.filter((p) => p.team === 'away'), h = lobby.players.filter((p) => p.team === 'home'), sp = lobby.players.filter((p) => p.team === 'spec');
  const bySlot = (x, y) => (x.bo || 99) - (y.bo || 99);
  const cap = st.size || Math.ceil(st.max / 2);
  const empty = (n) => Array.from({ length: Math.max(0, Math.min(3, cap) - n) }, () => '<li class="pl slot"><span class="nm">빈 자리, CPU가 채움</span></li>').join('');
  $('tAway').innerHTML = a.sort(bySlot).map(li).join('') + (st.size ? empty(a.length) : a.length ? '' : '<li class="pl slot"><span class="nm">CPU 팀</span></li>');
  $('tHome').innerHTML = h.sort(bySlot).map(li).join('') + (st.size ? empty(h.length) : h.length ? '' : '<li class="pl slot"><span class="nm">CPU 팀</span></li>');
  $('cntA').textContent = `${a.length}/${cap}`; $('cntH').textContent = `${h.length}/${cap}`;
  const cl = st.clubs || [0, 1];
  $('emA').src = emblemURL(cl[0], 128); $('emH').src = emblemURL(cl[1], 128);
  $('teamA').style.setProperty('--tc', teamColor(cl[0])); $('teamH').style.setProperty('--tc', teamColor(cl[1]));
  $('tnA').textContent = st.teams[0]; $('tnH').textContent = st.teams[1];
  document.querySelectorAll('#room .team [data-team]').forEach((b) => { const t = b.dataset.team, n = t === 'away' ? a.length : h.length; b.disabled = (me && me.team === t) || n >= cap; b.textContent = me && me.team === t ? '내 팀' : n >= cap ? '꽉 참' : '이 팀으로'; });
  $('specbar').innerHTML = sp.length ? '<b>관전</b>' + sp.map((p) => `<span>${esc(p.name)}</span>`).join('') : '';
  document.querySelectorAll('[data-kick]').forEach((b) => (b.onclick = () => send({ t: 'kick', id: b.dataset.kick })));
  $('rName').textContent = st.name || '방';
  const rules = rulesOf(st);
  $('room').dataset.rules = rules;
  $('rRules').textContent = RULES_KO[rules] + ' 모드';
  // 설정 값
  setSeg('sRules', rules);
  setSeg('sSize', st.size || 0); setSeg('sPit', st.pitRot || 'inning'); setSeg('sLine', st.lineup || 'humans'); setSeg('sFld', st.fieldCtl || 'auto');
  setSeg('sTod', st.tod || 'night'); setSeg('sHit', st.hitEase ?? 1); setSeg('sTime', st.timeLim || 0);
  setSeg('sMode', st.practice ? 'derby' : st.mode); setSeg('sInn', st.innings); setSeg('sOuts', st.derbyOuts); setSeg('sDiff', st.diff); setSeg('sPub', st.pub ? 1 : 0);
  show('sMaxWrap', !st.size);
  for (const [id, v] of [['sName', st.name], ['sTA', st.teams[0]], ['sTH', st.teams[1]]]) if (document.activeElement !== $(id)) $(id).value = v;
  $('sMax').value = String(st.max);
  show('sInnWrap', st.mode === 'game'); show('sOutWrap', st.mode === 'derby'); show('sTimeWrap', st.mode === 'game');
  document.querySelectorAll('#sets .seg').forEach((s) => s.classList.toggle('ro', !isHost));
  for (const id of ['sName', 'sTA', 'sTH', 'sMax', 'sPw']) $(id).disabled = !isHost;
  show('hostOnly', !isHost);
  if (me) { $('myBo').value = String(me.bo || 0); $('myPos').value = me.pos; $('bReady').textContent = me.ready ? '준비 취소' : '준비'; $('bReady').classList.toggle('on', !!me.ready); }
  show('bReady', !!me && me.team !== 'spec');
  show('bStart', isHost);
  const nonReady = lobby.players.filter((p) => p.team !== 'spec' && !p.ready && p.id !== lobby.host).length;
  $('rnote').textContent = isHost ? (nonReady ? `${nonReady}명 준비 안 됨` : '모두 준비됨') : '방장이 시작하길 기다리는 중';
  return cl;
}

// 구단 고르기 창. o: { solo:'me'|'op' } 또는 { side:'away'|'home' }
export function clubGrid(cur, other, can, onPick) {
  $('clubGrid').innerHTML = CLUBS.map((c, i) => `<button data-i="${i}" class="${i === cur ? 'on' : ''}" ${i === other || !can ? 'disabled' : ''} style="--tc:${teamColor(i)}"><img src="${emblemURL(i, 96)}" alt=""><span>${esc(c.name)}</span></button>`).join('');
  $('clubGrid').querySelectorAll('button').forEach((b) => (b.onclick = () => onPick(+b.dataset.i)));
}
export { clubOf };
