// [ui] 기록표(Tab), 경기 결과 · MVP · 홈런왕 화면
import { $, esc, show, KING_SVG } from './dom.js';
import { career, avgStr, eraStr, ipStr } from './career.js';
import { clubOf, emblemURL } from '../emblem.js';

export function statTable(st, ps, myId) {
  let h = '<thead><tr><th>타자</th><th>타석</th><th>안타</th><th class="r">홈런</th><th>타점</th><th>최장</th><th>삼진</th><th>볼넷</th><th>도루</th><th>통산 타율</th></tr></thead><tbody>';
  h += st.filter((r) => r[3] > 0 || r[0]).map((r) => { const c = r[0] && career[r[1]]; return `<tr class="${r[0] && r[0] === myId ? 'me' : ''}"><td>${esc(r[1])}</td><td>${r[3]}</td><td>${r[4]}</td><td class="r">${r[5]}</td><td>${r[6]}</td><td>${r[7] ? r[7] + 'm' : '-'}</td><td>${r[8]}</td><td>${r[9]}</td><td>${r[10]}</td><td>${c && c.pa ? avgStr(c.h || 0, c.pa - (c.bb || 0)) : '-'}</td></tr>`; }).join('');
  if (ps && ps.length) {
    h += '<tr class="sep"><th>투수</th><th>이닝</th><th>피안타</th><th class="r">실점</th><th>탈삼진</th><th>볼넷</th><th>피홈런</th><th>상대</th><th>ERA</th><th>통산 ERA</th></tr>';
    h += ps.map((p) => { const c = p[0] && career[p[1]]; return `<tr class="${p[0] && p[0] === myId ? 'me' : ''}"><td>${esc(p[1])}</td><td>${ipStr(p[3])}</td><td>${p[5]}</td><td class="r">${p[4]}</td><td>${p[6]}</td><td>${p[7]}</td><td>${p[8]}</td><td>${p[9]}</td><td>${eraStr(p[4], p[3])}</td><td>${c && c.outs ? eraStr(c.r || 0, c.outs) : '-'}</td></tr>`; }).join('');
  }
  return h + '</tbody>';
}
export function lineTable(s) {
  const inns = Math.max(s.ls[0].length, s.ls[1].length, s.inn || 1);
  let h = '<thead><tr><th></th>' + Array.from({ length: inns }, (_, i) => `<th>${i + 1}</th>`).join('') + '<th class="r">R</th><th>H</th><th>E</th></tr></thead><tbody>';
  (s.tn || ['원정', '홈']).forEach((nm, r) => { h += `<tr><td>${esc(nm)}</td>` + Array.from({ length: inns }, (_, i) => `<td>${s.ls[r][i] ?? '-'}</td>`).join('') + `<td class="r">${s.sc[r]}</td><td>${s.hits[r]}</td><td>${s.errs ? s.errs[r] : 0}</td></tr>`; });
  return h + '</tbody>';
}
function derbyTable(dy, myId, live) {
  const list = live ? dy.list : [...dy.list].sort((a, b) => b[2] - a[2] || b[3] - a[3]);
  return (live ? '<thead><tr><th>선수</th><th class="r">홈런</th><th>최장</th><th>상태</th></tr></thead>' : '<thead><tr><th>순위</th><th>선수</th><th class="r">홈런</th><th>최장 비거리</th></tr></thead>') + '<tbody>' +
    list.map((r, i) => live
      ? `<tr class="${r[0] === myId ? 'me' : ''}"><td>${esc(r[1])}</td><td class="r">${r[2]}</td><td>${r[3] ? r[3] + 'm' : '-'}</td><td>${r[4] ? '완료' : i === dy.idx ? '타석' : '대기'}</td></tr>`
      : `<tr class="${r[0] === myId ? 'me' : ''}"><td>${i + 1}위</td><td>${esc(r[1])}</td><td class="r">${r[2]}</td><td>${r[3] ? r[3] + 'm' : '-'}</td></tr>`).join('') + '</tbody>';
}

export function renderTab(S, myId) {
  if (!S || !S.ls) return;
  if (S.mode === 'derby' && S.dy) { $('tabLine').innerHTML = derbyTable(S.dy, myId, true); $('tabStats').innerHTML = ''; }
  else { $('tabLine').innerHTML = lineTable(S); $('tabStats').innerHTML = statTable(S.st || [], S.ps, myId); }
}

// MVP: 타자(안타·홈런·타점·볼넷·도루)와 투수(아웃·탈삼진·실점) 점수를 같이 비교, 이긴 팀 보너스
export function pickMVP(s) {
  const cands = [];
  for (const r of s.st || []) if (r[3] > 0) cands.push({ name: r[1], id: r[0], sc: r[4] * 1.5 + r[5] * 2.5 + r[6] * 1.2 + r[9] * 0.5 + r[10] * 0.6 - r[8] * 0.25 + (r[2] === s.win ? 0.8 : 0), line: `${r[3] - r[9]}타수 ${r[4]}안타` + (r[5] ? ` ${r[5]}홈런` : '') + (r[6] ? ` ${r[6]}타점` : '') });
  for (const p of s.ps || []) if (p[3] > 0) cands.push({ name: p[1], id: p[0], sc: p[3] * 0.4 + p[6] * 0.45 - p[4] * 1.3 - p[7] * 0.3 - p[5] * 0.25 + (p[2] === s.win ? 1 : 0), line: `${ipStr(p[3])}이닝 ${p[6]}탈삼진 ${p[4]}실점` });
  return cands.sort((a, b) => b.sc - a.sc)[0] || null;
}

// 결과 화면 채우기. 반환: 축하 연출을 할 만한지(MVP·홈런왕이 있음)
export function fillOver(s, o) {
  const { myId, mySide, isHost, local } = o;
  let title, sub = '', king = null, mvp = null, tone = 'draw';
  const cl = s.cl || [0, 1];
  if (s.mode === 'derby' && s.dy) {
    const list = [...s.dy.list].sort((a, b) => b[2] - a[2] || b[3] - a[3]);
    title = s.dy.pr ? '타격 연습 끝' : '홈런 더비 종료'; tone = 'derby';
    if (list[0]) king = { name: list[0][1], line: `홈런 ${list[0][2]}개 · 최장 ${list[0][3] || '-'}m` };
    $('overFinal').innerHTML = '';
    $('overLine').innerHTML = derbyTable(s.dy, myId, false);
    $('overStats').innerHTML = '';
  } else {
    title = s.win ? `${s.tn[s.win === 'away' ? 0 : 1]} 승리` : '무승부';
    if (mySide && mySide !== 'spec' && s.win) { title = s.win === mySide ? '승리' : '패배'; tone = s.win === mySide ? 'win' : 'lose'; sub = s.tn[mySide === 'away' ? 0 : 1]; }
    else if (s.win) tone = 'win';
    const st = s.st || [];
    const top = [...st].sort((a, b) => b[5] - a[5] || b[7] - a[7] || b[4] - a[4] || b[6] - a[6])[0];
    if (top && top[5] > 0) king = { name: top[1], line: `홈런 ${top[5]}개 · 최장 ${top[7]}m · ${top[6]}타점` };
    mvp = pickMVP(s);
    // 최종 스코어 (중계 스코어버그를 크게)
    const side = (i) => `<div class="fs ${s.win === (i ? 'home' : 'away') ? 'w' : ''}" style="--tc:${teamColor(cl[i])}"><img src="${emblemURL(cl[i], 96)}" alt=""><span>${esc(s.tn[i])}</span><b>${s.sc[i]}</b></div>`;
    $('overFinal').innerHTML = side(0) + '<i class="fs-x">FINAL</i>' + side(1);
    $('overLine').innerHTML = lineTable(s);
    $('overStats').innerHTML = statTable(st, s.ps, myId);
  }
  $('overT').textContent = title;
  $('overSub').textContent = sub;
  $('over').dataset.tone = tone;
  const card = (k, label, cls) => `<div class="award ${cls}">${KING_SVG}<div><small>${label}</small><b>${esc(k.name)}</b><em>${esc(k.line)}</em></div></div>`;
  $('kingBox').innerHTML = (mvp ? card(mvp, '오늘의 MVP', 'mvp') : '') + (king && (!mvp || king.name !== mvp.name || s.mode === 'derby') ? card(king, s.mode === 'derby' ? '홈런왕' : '오늘의 홈런왕', 'king') : '');
  show('bAgain', isHost); show('bToLobby', isHost && !local);
  $('overNote').textContent = isHost ? '' : '방장이 다음 경기를 고르는 중';
  return !!(king || mvp);
}
const lum = (hex) => { const n = parseInt(String(hex || '#000').slice(1), 16), f = (v) => { v /= 255; return v <= 0.04 ? v / 12.9 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255); };
// 어두운 배경 위에서 보이는 팀색: 메인색이 너무 어두우면 보조색
export function teamColor(i) { const c = clubOf(i); return lum(c.c1) > 0.06 ? c.c1 : lum(c.c2) > 0.06 ? c.c2 : '#c9ced6'; }
