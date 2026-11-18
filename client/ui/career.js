// [ui] 통산 기록 (멀티: 서버 Lobby DO / 혼자: 이 브라우저 localStorage 'hr_career')
import { store } from './settings.js';

export let career = {};
let careerT = -1e9;
export function saveLocalCareer(sum, me) {
  const v = sum && (sum[me] || Object.values(sum)[0]); if (!v) return;
  const all = store.get('career', {}), cur = all[me] || {};
  for (const k of ['g', 'w', 'pa', 'h', 'hr', 'rbi', 'k', 'bb', 'sb', 'outs', 'r', 'ph', 'pk', 'pbb']) cur[k] = (cur[k] || 0) + (Number(v[k]) || 0);
  cur.max = Math.max(cur.max || 0, Number(v.max) || 0);
  all[me] = cur; store.set('career', all); career[me] = cur;
}
// local: 혼자하기 여부, names: 방 사람 이름 목록
export function refreshCareer(local, names, force) {
  const t = performance.now() / 1000;
  if (!force && t - careerT < 30) return;
  careerT = t;
  if (local) { career = { ...store.get('career', {}) }; return; }
  names = [...new Set(names)].slice(0, 20);
  if (!names.length) return;
  fetch('/api/stats?n=' + encodeURIComponent(names.join(','))).then((r) => r.json()).then((j) => { career = j.stats || {}; }).catch(() => {});
}
export const avgStr = (h, ab) => (ab > 0 ? (h / ab).toFixed(3).replace(/^0/, '') : '-.---');
export const eraStr = (r, outs) => (outs > 0 ? (r * 27 / outs).toFixed(2) : '-.--');
export const ipStr = (outs) => `${Math.floor(outs / 3)}${outs % 3 ? '.' + (outs % 3) : ''}`;
