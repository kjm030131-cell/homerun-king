// [ui] 채팅 (대기실 + 경기 중) · 빠른 채팅(T, 1~8)
import { $, esc, show } from './dom.js';

export const QUICK = ['나이스!', '가자!!', 'ㅋㅋㅋㅋ', '아 ㅠㅠ', '홈런 각', '수비 나이스', 'GG', '한 판 더?'];
const TEAM_COL = { away: 'var(--away-t)', home: 'var(--home-t)' };
let send = () => {};
export let quickOpen = false;

export function initChat(sendChat) {
  send = sendChat;
  const bind = (id, after) => ($(id).onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { const t = $(id).value.trim(); if (t) send(t); $(id).value = ''; after && after(); }
    else if (e.key === 'Escape') after && after();
  });
  bind('rchatin');
  bind('chatin', closeChat);
  $('quick').innerHTML = QUICK.map((q, i) => `<button data-q="${i}"><span class="kbd">${i + 1}</span>${esc(q)}</button>`).join('');
  $('quick').querySelectorAll('button').forEach((b) => (b.onpointerdown = (e) => { e.stopPropagation(); sendQuick(+b.dataset.q); }));
}
export function addChat(name, text, team) {
  const color = TEAM_COL[team] || 'var(--bulb)';
  for (const box of ['chatlog', 'rchat']) {
    const d = document.createElement('div');
    d.innerHTML = `<b style="color:${color}">${esc(name)}</b>${esc(text)}`;
    $(box).appendChild(d);
    while ($(box).children.length > 40) $(box).firstChild.remove();
    $(box).scrollTop = 1e9;
  }
}
export function sysChat(text) {
  for (const box of ['chatlog', 'rchat']) { const d = document.createElement('div'); d.className = 'sys'; d.textContent = text; $(box).appendChild(d); while ($(box).children.length > 40) $(box).firstChild.remove(); }
}
export function openChat() { const i = $('chatin'); i.classList.remove('hide'); i.focus(); }
export function closeChat() { const i = $('chatin'); i.classList.add('hide'); i.blur(); }
export function toggleQuick() { quickOpen = !quickOpen; show('quick', quickOpen); }
export function sendQuick(i) { if (QUICK[i]) send(QUICK[i]); quickOpen = false; show('quick', false); }
