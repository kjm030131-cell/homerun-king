// [ui] DOM 도우미. HUD는 매 프레임 불리므로 "값이 바뀔 때만 DOM을 건드리는" 캐시 setter를 쓴다.
export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const el = (x) => (typeof x === 'string' ? $(x) : x);

// classList.toggle(force)는 상태가 같으면 DOM을 바꾸지 않으므로 캐시 없이 써도 싸다 (main.js가 직접 토글하는 요소와도 안전)
export function show(id, on) { const e = el(id); if (e) e.classList.toggle('hide', !on); }
export const isShown = (id) => { const e = el(id); return !!e && !e.classList.contains('hide'); };
export function setText(id, t) { const e = el(id); t = String(t); if (e && e._t !== t) { e._t = t; e.textContent = t; } }
export function setHTML(id, h) { const e = el(id); if (e && e._h !== h) { e._h = h; e.innerHTML = h; } }
export function cls(id, c, on) { const e = el(id); on = !!on; const k = '_c_' + c; if (e && e[k] !== on) { e[k] = on; e.classList.toggle(c, on); } }
export function style(id, prop, v) { const e = el(id); const k = '_s_' + prop; if (e && e[k] !== v) { e[k] = v; e.style[prop] = v; } }
// 애니메이션 다시 걸기 (클래스 뗐다 붙이기)
export function replay(id, c) { const e = el(id); if (!e) return; e.classList.remove(c); void e.offsetWidth; e.classList.add(c); }

// 세그먼트 버튼 (.seg > button[data-v])
export const segVal = (id) => $(id).querySelector('.on')?.dataset.v;
export const setSeg = (id, v) => $(id).querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.v === String(v)));
export function bindSegs(root = document) {
  root.querySelectorAll('.seg').forEach((seg) => seg.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || seg.classList.contains('ro') || b.disabled) return;
    seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    seg.dispatchEvent(new CustomEvent('change', { detail: b.dataset.v }));
  }));
}
export const KING_SVG = '<svg viewBox="0 0 60 34" fill="currentColor" aria-hidden="true"><path d="M2 32 L6 6 L18 20 L30 2 L42 20 L54 6 L58 32 Z"/></svg>';
