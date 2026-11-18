// audio/caster.js — 캐스터 멘트: 배너 메시지(+스냅샷 상황)로 대사를 골라 자막 이벤트와 음성(브라우저 TTS)을 낸다.
// 설정 'cast': 0 끄기 / 1 자막 / 2 자막+음성 (localStorage hr_cast, main.js 설정 화면이 저장)
import { readStore, linVol } from './engine.js';

const pick = (a) => a[(Math.random() * a.length) | 0];
const fill = (l, v) => l.replace(/\{(\w+)\}/g, (_, k) => (v[k] ?? ''));

// [정규식, 대사들, 확률, 우선순위(0~3, 높으면 하던 말 끊고 말함), 조건(v)=>bool]
// v: { dist, ev, la, inn, half, team, runs, occ, outs, diff, late, walkoff }
const POOL = [
  [/끝내기/, ['끝냈습니다!! 끝내기!! 선수들이 그라운드로 쏟아져 나옵니다!', '경기 끝! 이 한 방으로 승부가 갈립니다!', '드라마가 완성됩니다! 끝내기!!', '마지막에 웃는 건 이 팀입니다! 끝내기!'], 1, 3],
  [/만루 홈런/, ['만루 홈런!!! 구장이 뒤집어집니다!', '그랜드 슬램! 주자 싹쓸이!', '네 명이 다 들어옵니다! 만루 홈런!!'], 1, 3],
  [/홈런 강탈/, ['담장 위에서 걷어냅니다!! 홈런을 훔쳤어요!', '이걸 잡아요?! 홈런 강탈!!', '믿을 수 없는 수비! 넘어가던 공을 빼앗습니다!'], 1, 3],
  [/홈런/, ['크게 뻗습니다… 담장, 넘어갑니다! 홈런!', '맞는 순간 직감했어요! 이건 넘어갔습니다!', '밤하늘을 가르는 타구! 홈런입니다!', '쭉쭉 뻗어갑니다… 관중석에 꽂힙니다!', '{dist}미터! 큼지막한 홈런!'], 1, 3],
  [/삼중살/, ['삼중살!! 한 번에 이닝이 끝납니다!', '보기 드문 장면! 트리플 플레이!'], 1, 2],
  [/병살/, ['병살! 한 번에 아웃 두 개를 잡아냅니다!', '깔끔한 병살 플레이!', '내야진 호흡이 척척! 더블 플레이!', '찬스가 병살로 사라집니다.'], 1, 2],
  [/3루타/, ['외야 깊숙이 굴러갑니다! 3루까지 갑니다!', '펜스 앞까지! 여유 있게 3루타!', '발이 빠릅니다! 3루에 슬라이딩, 세이프!'], 1, 2],
  [/2루타/, ['외야를 가릅니다! 2루까지!', '빠졌습니다! 장타, 2루타!', '라인 따라 굴러가는 2루타!', '좌중간을 꿰뚫습니다! 2루타!'], 1, 2],
  [/번트 안타/, ['허를 찌르는 번트! 살았습니다!', '절묘한 번트! 내야가 꼼짝 못 합니다!'], 1, 1],
  [/^안타|안타!/, ['총알 같은 타구! {ev}킬로미터!', '엄청난 타구 속도! 수비가 손도 못 댑니다!'], 0.9, 1, (v) => v.ev >= 160],
  [/^안타|안타!/, ['깨끗한 안타!', '내야를 빠져나가는 안타!', '잘 받아쳤습니다, 안타!', '정확하게 맞혔어요!', '코스가 좋았습니다, 안타!', '툭 갖다 댄 게 안타가 됩니다!'], 0.8, 1],
  [/견제사/, ['견제사! 리드가 너무 컸어요!', '빈틈을 놓치지 않는 견제!', '투수가 주자를 잡아냅니다! 견제사!'], 1, 2],
  [/도루 저지/, ['도루 저지! 포수 어깨가 대단합니다!', '송구 정확! 잡아냅니다!', '레이저 송구! 도루 실패!'], 1, 2],
  [/도루 성공/, ['훔쳤습니다! 도루 성공!', '빠른 발! 여유 있게 세이프!', '포수가 던질 엄두도 못 냅니다!'], 1, 1],
  [/도루 시도/, ['뛰었습니다!', '주자 스타트!'], 0.5, 1],
  [/파울팁 삼진/, ['파울팁! 포수가 놓치지 않습니다, 삼진!', '스치기만 했어요, 파울팁 삼진!'], 1, 1],
  [/헛스윙 삼진/, ['헛스윙 삼진! 완벽하게 속였어요.', '방망이가 허공을 가릅니다, 삼진!', '결정구가 통했습니다! 삼진!'], 0.75, 1],
  [/루킹 삼진/, ['꼼짝 못하고 삼진!', '그대로 서서 당합니다, 루킹 삼진!', '보더라인에 꽂히는 공! 삼진!'], 0.75, 1],
  [/삼진/, ['삼진! 투수가 이겼습니다.', '삼진 아웃!'], 0.75, 1],
  [/볼넷/, ['밀어내기 볼넷! 공짜 점수가 들어옵니다!'], 1, 2, (v) => v.loaded],
  [/볼넷/, ['볼넷, 걸어 나갑니다.', '침착하게 골라냈습니다, 볼넷.', '선구안이 빛납니다, 볼넷.'], 0.6, 0],
  [/몸에 맞는 공/, ['아, 몸에 맞습니다! 1루로 걸어 나갑니다.', '몸에 맞는 공! 괜찮을까요?'], 0.8, 1],
  [/폭투/, ['폭투! 공이 뒤로 빠집니다, 주자 진루!', '포수가 막지 못합니다, 폭투!'], 1, 1],
  [/실책/, ['아, 실책! 공이 빠졌습니다!', '수비가 흔들립니다, 실책!', '잡을 수 있었는데요… 실책입니다.'], 1, 1],
  [/중계 플레이/, ['중계 플레이! 커트맨에게 이어집니다!', '정확한 중계! 송구가 이어집니다!'], 0.7, 1],
  [/희생번트/, ['희생번트 성공! 주자를 한 베이스 보냅니다.', '작전 성공, 희생번트!'], 0.8, 1],
  [/희생/, ['희생 플라이! 한 점 추가합니다.', '제 몫을 해냅니다, 희생타!'], 1, 1],
  [/다이빙 캐치/, ['몸을 날립니다!! 다이빙 캐치!', '이걸 잡아냅니다! 하이라이트 감!', '온몸을 던진 수비!'], 1, 2],
  [/포스아웃|태그아웃/, ['아웃! 한 끗 차이였어요.', '수비가 한발 빨랐습니다.'], 0.3, 0],
  [/직선타|플라이 아웃/, ['잘 맞았지만 정면이었습니다.', '수비 위치가 좋았어요, 아웃.', '높이 뜬 공, 잡아냅니다.', '담장 앞에서 잡힙니다! 아까워요!'], 0.35, 0],
  [/득점/, ['동점! 승부가 원점으로 돌아갑니다!'], 1, 2, (v) => v.diff === 0],
  [/득점/, ['역전!! 경기가 뒤집힙니다!'], 1, 2, (v) => v.flip],
  [/득점/, ['홈인! 점수가 납니다!', '홈으로 들어옵니다, 득점!', '전광판에 점수가 올라갑니다!'], 0.5, 1],
  [/(\d+)회(초|말) · /, ['{inn}회{half}, {team} 공격 시작합니다.', '자, {inn}회{half}입니다.'], 0.35, 0, (v) => v.inn < 7 || !v.close],
  [/(\d+)회(초|말) · /, ['{inn}회{half}, 경기 후반 접전입니다. 한 점이 중요해요!', '승부처 {inn}회{half}! 긴장감이 흐릅니다.'], 0.8, 0],
  [/경기 종료/, ['경기 종료! 오늘 경기 여기까지입니다.', '마지막 아웃! 경기가 끝납니다.', '수고하셨습니다, 경기 종료!'], 1, 2],
];
// 투구 직전 상황 멘트 (자주 하면 시끄러우니 25초 쿨다운)
const SITU = [
  [(v) => v.loaded && v.outs === 2, ['2아웃 만루! 여기서 한 방이면 경기가 바뀝니다!', '만루, 투 아웃. 숨 막히는 순간!']],
  [(v) => v.loaded, ['만루 찬스! 최고의 기회입니다!', '베이스가 꽉 찼습니다!']],
  [(v) => v.full && v.outs === 2, ['풀카운트, 투 아웃! 다음 공에 모든 게 걸렸습니다.']],
  [(v) => v.full, ['풀카운트! 투수와 타자의 신경전.', '3볼 2스트라이크, 승부구는?']],
  [(v) => v.late && v.close && v.risp, ['후반, 득점권 주자! 한 점 싸움입니다.', '여기서 점수가 나면 결정적이죠!']],
  [(v) => v.twoK, ['투 스트라이크, 타자가 몰렸습니다.', '결정구 들어옵니다.'], 0.25],
];

export function situation(d = {}) {
  const s = d.s || d;
  const cnt = s.cnt || d.cnt || [0, 0, 0], occ = s.occ || d.occ || [false, false, false], sc = s.sc || d.sc || [0, 0];
  const inn = s.inn || d.inn || 1, half = s.half ?? d.half ?? 0;
  const diff = Math.abs((sc[0] || 0) - (sc[1] || 0));
  return {
    balls: cnt[0], strikes: cnt[1], outs: cnt[2], occ, inn, half,
    loaded: !!(occ[0] && occ[1] && occ[2]), risp: !!(occ[1] || occ[2]), runners: occ.filter(Boolean).length,
    full: cnt[0] === 3 && cnt[1] === 2, twoK: cnt[1] === 2, diff, close: diff <= 1, late: inn >= 7 || (d.innings && inn >= d.innings),
    mode: s.mode || d.mode,
  };
}

export class Caster {
  constructor(onLine, onDuck) {
    this.onLine = onLine; this.onDuck = onDuck || (() => { });
    this.last = ''; this.lastAt = 0; this.situAt = -99; this.speaking = 0; this.sc = null; this.voice = null;
    if (typeof speechSynthesis !== 'undefined') {
      const load = () => { this.voice = pickVoice(); };
      load(); try { speechSynthesis.addEventListener('voiceschanged', load); } catch { }
    }
  }
  mode() { return +readStore('cast', 1); }
  // 배너 메시지 → 멘트
  msg(text, s) {
    if (!this.mode() || !text) return;
    if (s && s.mode === 'derby' && !/홈런/.test(text)) return;
    if (s && s.mode === 'practice') return;
    const st = situation({ s: s || {} });
    const prevSc = this.sc; this.sc = s && s.sc ? [...s.sc] : null;
    const v = {
      ...st,
      dist: (/(\d+)m/.exec(text) || [])[1] || '',
      ev: s && s.lh ? s.lh.ev : 0,
      half: (/(\d+)회(초|말)/.exec(text) || [])[2] || (st.half ? '말' : '초'),
      inn: +((/(\d+)회/.exec(text) || [])[1] || st.inn),
      team: (/· (.+) 공격/.exec(text) || [])[1] || '',
      flip: !!(prevSc && this.sc && Math.sign(prevSc[0] - prevSc[1]) !== Math.sign(this.sc[0] - this.sc[1]) && this.sc[0] !== this.sc[1] && prevSc[0] !== prevSc[1]),
    };
    for (const [re, lines, p = 1, pri = 1, cond] of POOL) {
      if (!re.test(text) || (cond && !cond(v))) continue;
      if (Math.random() > p) return;
      const now = performance.now() / 1000;
      if (pri < 2 && now - this.lastAt < 2.2) return; // 작은 멘트가 연달아 쏟아지지 않게
      this.say(fill(this.uniq(lines), v), pri);
      return;
    }
  }
  // 투구 직전 상황 멘트
  situ(d) {
    if (!this.mode()) return;
    const now = performance.now() / 1000;
    if (now - this.situAt < 25 || now - this.lastAt < 4) return;
    const v = situation(d);
    if (v.mode === 'derby' || v.mode === 'practice') return;
    for (const [cond, lines, p = 0.5] of SITU) {
      if (!cond(v)) continue;
      if (Math.random() > p) return;
      this.situAt = now; this.say(this.uniq(lines), 0); return;
    }
  }
  uniq(lines) { let l = pick(lines); if (l === this.last && lines.length > 1) l = lines[(lines.indexOf(l) + 1) % lines.length]; this.last = l; return l; }
  say(line, pri = 1) {
    this.lastAt = performance.now() / 1000;
    this.onLine(line, pri);
    if (this.mode() === 2) this.speak(line, pri);
  }
  // 브라우저 TTS. 큰 장면(우선순위 높음)은 하던 말을 끊고, 작은 멘트는 말하는 중이면 건너뜀
  speak(line, pri = 1) {
    if (typeof speechSynthesis === 'undefined') return;
    try {
      if (speechSynthesis.speaking && pri < this.speaking) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(line.replace(/[!?…~]+/g, (m) => m[0]));
      u.lang = 'ko-KR'; if (this.voice) u.voice = this.voice;
      u.rate = 1.08 + pri * 0.05; u.pitch = 1.0 + pri * 0.05;
      u.volume = Math.min(1, linVol('cast'));
      this.speaking = pri;
      const end = () => { this.speaking = 0; this.onDuck(1); clearTimeout(this.endT); };
      u.onstart = () => this.onDuck(0.6); u.onend = end; u.onerror = end;
      clearTimeout(this.endT); this.endT = setTimeout(end, 9000); // 크롬이 onend 를 빼먹을 때 대비
      speechSynthesis.speak(u);
    } catch { }
  }
  stop() { try { speechSynthesis.cancel(); } catch { } this.speaking = 0; this.onDuck(1); }
}

// 한국어 목소리 고르기: 맥 기본 'Yuna'(로컬, 지연 없음) → 다른 로컬 한국어 → 구글 온라인 한국어
function pickVoice() {
  try {
    const vs = speechSynthesis.getVoices().filter((v) => /^ko/i.test(v.lang));
    if (!vs.length) return null;
    const pref = (re) => vs.find((v) => re.test(v.name));
    return pref(/Yuna|유나/) || vs.find((v) => v.localService) || pref(/Google/) || vs[0];
  } catch { return null; }
}
export const _test = { POOL, SITU };
