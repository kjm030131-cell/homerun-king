// [ui] 화면 가운데 배너(최소 표시 시간 보장 큐), 짧은 피드백 문구, 캐스터 자막/음성, 토스트
import { $, replay } from './dom.js';
import { cfg } from './settings.js';
import { bus } from '../core/bus.js';

// ── 배너 큐 ──
// 메시지가 연달아 오면 앞 메시지를 최소 MIN_MS는 보여주고 다음 걸 띄움 (큰 메시지는 작은 메시지를 바로 덮음, 홈런은 항상 바로)
const MIN_MS = 1100;
let bannerT = 0, bannerAt = 0, bannerBig = false, flushT = 0;
const bannerQ = [];
export function banner(text, big, hr) {
  const now = performance.now();
  if (!hr && !(big && !bannerBig) && now - bannerAt < MIN_MS && $('banner').classList.contains('show')) {
    if (bannerQ.length > 2) bannerQ.shift();
    bannerQ.push([text, big, hr]);
    if (bannerQ.length === 1) { clearTimeout(flushT); flushT = setTimeout(flushBanner, MIN_MS - (now - bannerAt)); }
    return;
  }
  bannerQ.length = 0; clearTimeout(flushT); showBanner(text, big, hr);
}
function flushBanner() { const n = bannerQ.shift(); if (!n) return; showBanner(...n); if (bannerQ.length) flushT = setTimeout(flushBanner, MIN_MS); }
function showBanner(text, big, hr) {
  const b = $('banner');
  bannerAt = performance.now(); bannerBig = !!big;
  // 결과 종류에 따라 띠 색 (중계 그래픽처럼 한눈에)
  const kind = hr ? 'hr' : /아웃|삼진|병살|견제사|도루 저지|실책/.test(text) ? 'out' : /안타|루타|득점|볼넷|사구|도루 성공|세이프/.test(text) ? 'good' : '';
  b.querySelector('span').textContent = text;
  b.className = (big ? 'big ' : 'small ') + kind;
  replay(b, 'show');
  clearTimeout(bannerT); bannerT = setTimeout(() => b.classList.remove('show'), hr ? 3400 : big ? 2600 : 1900);
}
export function clearBanner() { bannerQ.length = 0; clearTimeout(flushT); clearTimeout(bannerT); $('banner').classList.remove('show'); }

// ── 피드백 (스윙·투구·수비 결과 한 줄) ──
let fbT = 0;
export function feedback(text, color = '#fff') {
  const f = $('fb'); f.textContent = text; f.style.color = color;
  replay(f, 'show'); clearTimeout(fbT); fbT = setTimeout(() => f.classList.remove('show'), 2600);
}

// ── 토스트 ──
let toastT = 0;
export function toast(t) { const e = $('toast'); e.textContent = t; e.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => e.classList.remove('show'), 2800); }

// ── 캐스터 멘트: 주요 장면마다 중계 한마디 (설정: 끄기 / 자막 / 자막+음성) ──
const CAST = [
  [/끝내기/, ['끝냈습니다!! 끝내기!! 선수들이 그라운드로 쏟아져 나옵니다!', '경기 끝! 이 한 방으로 승부가 갈립니다!']],
  [/만루 홈런/, ['만루 홈런!!! 구장이 뒤집어집니다!', '그랜드 슬램! 주자 싹쓸이!']],
  [/홈런/, ['크게 뻗습니다… 담장, 넘어갑니다! 홈런!', '맞는 순간 직감했어요! 이건 넘어갔습니다!', '밤하늘을 가르는 타구! 홈런입니다!', '쭉쭉 뻗어갑니다… 관중석에 꽂힙니다!']],
  [/병살/, ['병살! 한 번에 아웃 두 개를 잡아냅니다!', '6-4-3 깔끔한 병살 플레이!']],
  [/3루타/, ['외야 깊숙이 굴러갑니다! 3루까지 갑니다!', '펜스 앞까지! 여유 있게 3루타!']],
  [/2루타/, ['외야를 가릅니다! 2루까지!', '빠졌습니다! 장타, 2루타!', '라인 따라 굴러가는 2루타!']],
  [/번트 안타/, ['허를 찌르는 번트! 살았습니다!']],
  [/^안타|안타!/, ['깨끗한 안타!', '내야를 빠져나가는 안타!', '잘 받아쳤습니다, 안타!', '정확하게 맞혔어요!'], 0.85],
  [/견제사/, ['견제사! 리드가 너무 컸어요!', '빈틈을 놓치지 않는 견제!']],
  [/도루 저지/, ['도루 저지! 포수 어깨가 대단합니다!', '송구 정확! 잡아냅니다!']],
  [/도루 성공/, ['훔쳤습니다! 도루 성공!', '빠른 발! 여유 있게 세이프!']],
  [/삼진/, ['삼진! 투수가 이겼습니다.', '헛스윙 삼진! 완벽하게 속였어요.', '꼼짝 못하고 삼진!'], 0.75],
  [/볼넷/, ['볼넷, 걸어 나갑니다.', '침착하게 골라냈습니다, 볼넷.'], 0.6],
  [/실책/, ['아, 실책! 공이 빠졌습니다!', '수비가 흔들립니다, 실책!']],
  [/중계 플레이/, ['중계 플레이! 커트맨에게 이어집니다!'], 0.7],
  [/희생/, ['희생 플라이! 한 점 추가합니다.', '제 몫을 해냅니다, 희생타!']],
  [/직선타|플라이 아웃/, ['잘 맞았지만 정면이었습니다.', '수비 위치가 좋았어요, 아웃.', '높이 뜬 공, 잡아냅니다.'], 0.35],
  [/득점/, ['홈인! 점수가 납니다!'], 0.5],
];
let castT = 0, castLast = '', castBus = false;
function showCast(l) {
  const e = $('cast'); e.querySelector('span').textContent = l;
  replay(e, 'show');
  clearTimeout(castT); castT = setTimeout(() => e.classList.remove('show'), 3800);
}
// 사운드 파트의 캐스터가 bus 'caster:line' ({text} 또는 문자열)을 보내면 그 자막을 그림. 한 번이라도 오면 아래 내장 멘트(+브라우저 음성)는 끔
bus.on('caster:line', (d) => { castBus = true; const t = typeof d === 'string' ? d : d && (d.text || d.line); if (t && cfg.cast) showCast(String(t)); });
// 내장 멘트 (사운드 파트 캐스터가 생기기 전 대체용)
export function castLine(t, s) {
  if (castBus || !cfg.cast || (s && s.mode === 'derby' && !/홈런/.test(t))) return;
  for (const [re, lines, p = 1] of CAST) {
    if (!re.test(t)) continue;
    if (Math.random() > p) return;
    let l = lines[Math.floor(Math.random() * lines.length)];
    if (l === castLast && lines.length > 1) l = lines[(lines.indexOf(l) + 1) % lines.length];
    castLast = l;
    showCast(l);
    if (cfg.cast === 2 && window.speechSynthesis) {
      try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(l); u.lang = 'ko-KR'; u.rate = 1.12; u.pitch = 1.05; u.volume = Math.min(1, cfg.vol / 100 * cfg.volCast / 100); speechSynthesis.speak(u); } catch { }
    }
    return;
  }
}
export function stopSpeech() { try { speechSynthesis.cancel(); } catch { } }
