// audio/caster.js — KBO 중계석: 캐스터(상황 외침) + 해설위원(분석)이 주고받는 멘트. 배너 메시지(+스냅샷 상황)로 대사를 고른다.
// 설정 'castV': 0 끄기 / 1 자막만 / 2 자막+음성(기본). (예전 키 'cast' 는 기본이 자막만이라 음성이 아예 안 나왔음 → 새 키로 기본 음성)
// 음성은 브라우저 TTS. 대사의 '|' 는 끊어 말하기 마디: 큰 장면은 마디마다 빠르고 높아져서 "쳤습니다! 큽니다! 넘어갑니다!" 같은 고조가 난다.
import { readStore, linVol } from './engine.js';

const pick = (a) => a[(Math.random() * a.length) | 0];
const fill = (l, v) => l.replace(/\{(\w+)\}/g, (_, k) => (v[k] ?? ''));

// [정규식, 캐스터 대사들, 확률, 우선순위(0~3: 3 은 하던 말 끊음), 조건(v)=>bool, 해설 태그]
// v: { dist, ev, la, inn, half, team, runs, occ, outs, diff, late, walkoff, flip, loaded }
const POOL = [
  [/끝내기/, ['끝내기!!|경기 끝납니다!|선수들이 그라운드로 쏟아져 나옵니다!', '쳤습니다!|빠집니다!|끝내기!!|오늘의 영웅이 탄생합니다!', '각본 없는 드라마!|끝내기!!|이 팀이 웃습니다!'], 1, 3, null, 'walkoff'],
  [/만루 홈런/, ['쳤습니다!|큽니다!|큽니다!|넘어갑니다!!|그랜드슬램!!', '만루 홈런!!|주자 일소!|구장이 뒤집어집니다!'], 1, 3, null, 'gs'],
  [/홈런 강탈/, ['잡았습니다!!|담장 위에서 걷어냅니다!|홈런을 훔쳐냅니다!', '이걸 잡아요?!|홈런 도둑!'], 1, 3, null, 'rob'],
  [/홈런/, ['쳤습니다!|큽니다!|큽니다!|넘어갑니다!|홈런!!', '맞는 순간!|홈런을 직감합니다!|담장 밖으로!', '높이 떴습니다!|뻗어갑니다!|넘어갔습니다!|홈런!', '받아쳤습니다!|그대로!|넘어갑니다!|홈런!', '비거리 {dist}미터!|대형 홈런!'], 1, 3, null, 'hr'],
  [/삼중살/, ['삼중살!!|트리플 플레이!|한 번에 이닝이 끝납니다!'], 1, 2, null, 'dp'],
  [/병살/, ['병살!|깔끔하게 처리합니다!', '더블 플레이!|한 번에 두 개!', '아, 병살타!|찬스가 무산됩니다.'], 1, 2, null, 'dp'],
  [/3루타/, ['외야 깊숙이!|굴러갑니다!|3루까지!|3루타!', '펜스까지 굴러갑니다!|여유 있게 3루!'], 1, 2, null, 'xbh'],
  [/2루타/, ['외야를 가릅니다!|2루까지!|2루타!', '빠졌습니다!|장타!|2루타!', '라인 타고 굴러갑니다!|2루타!'], 1, 2, null, 'xbh'],
  [/번트 안타/, ['기습 번트!|살았습니다!', '번트 안타!|허를 찌릅니다!'], 1, 1, null, 'hit'],
  [/^안타|안타!/, ['쳤습니다!|빠릅니다!|{ev}킬로미터 총알 타구!', '강한 타구!|수비가 손도 못 댑니다!'], 0.9, 1, (v) => v.ev >= 160, 'hit'],
  [/^안타|안타!/, ['쳤습니다!|안타!', '깨끗한 안타!', '내야를 빠져나갑니다!|안타!', '툭 갖다 댑니다!|안타가 됩니다!', '받아칩니다!|안타!'], 0.85, 1, null, 'hit'],
  [/견제사/, ['견제!|아웃!|잡아냅니다!', '견제사!|리드가 컸어요!'], 1, 2, null, 'cs'],
  [/도루 저지/, ['던졌습니다!|아웃!|도루 저지!', '포수 어깨!|정확합니다!|도루 실패!'], 1, 2, null, 'cs'],
  [/도루 성공/, ['뛰었습니다!|세이프!|도루 성공!', '훔쳤습니다!|도루 성공!'], 1, 1, null, 'steal'],
  [/도루 시도/, ['뛰었습니다!'], 0.6, 1],
  [/파울팁 삼진/, ['파울팁!|삼진!', '스쳤습니다!|파울팁 삼진!'], 1, 1, null, 'k'],
  [/헛스윙 삼진/, ['헛스윙!|삼진!', '방망이 돌았습니다!|삼진!', '결정구!|헛스윙 삼진으로 돌려세웁니다!'], 0.85, 1, null, 'k'],
  [/루킹 삼진/, ['서서 당합니다!|루킹 삼진!', '꼼짝 못합니다!|삼진!', '보더라인에 꽂힙니다!|삼진!'], 0.85, 1, null, 'k'],
  [/삼진/, ['삼진!|돌려세웁니다!'], 0.8, 1, null, 'k'],
  [/볼넷/, ['밀어내기 볼넷!|점수가 들어옵니다!'], 1, 2, (v) => v.loaded, 'walk'],
  [/볼넷/, ['볼넷.|걸어 나갑니다.', '침착하게 골라냅니다.|볼넷.'], 0.7, 0, null, 'walk'],
  [/몸에 맞는 공/, ['아, 맞았습니다!|몸에 맞는 공.'], 0.85, 1, null, 'walk'],
  [/폭투/, ['폭투!|공이 뒤로 빠집니다!|주자 진루!'], 1, 1, null, 'err'],
  [/실책/, ['아!|빠졌습니다!|실책!', '수비가 흔들립니다!|실책!'], 1, 1, null, 'err'],
  [/중계 플레이/, ['중계 플레이!|이어집니다!'], 0.6, 1],
  [/희생번트/, ['희생번트!|작전 성공입니다.'], 0.8, 1],
  [/희생/, ['희생 플라이!|한 점 들어옵니다!'], 1, 1, null, 'score'],
  [/다이빙 캐치/, ['몸을 날립니다!!|잡았습니다!|다이빙 캐치!', '이걸 잡아냅니다!|하이라이트 장면!'], 1, 2, null, 'dive'],
  [/포스아웃|태그아웃/, ['아웃!|한 발 빨랐습니다.'], 0.35, 0],
  [/직선타|플라이 아웃/, ['잡힙니다.', '정면이었습니다,|아웃.', '높이 뜬 공,|잡아냅니다.', '담장 앞에서!|잡힙니다!|아깝습니다!'], 0.4, 0],
  [/득점/, ['동점!!|승부는 원점!'], 1, 2, (v) => v.diff === 0, 'tie'],
  [/득점/, ['역전!!|경기가 뒤집힙니다!'], 1, 2, (v) => v.flip, 'flip'],
  [/득점/, ['홈인!|득점!', '들어옵니다!|점수가 납니다!'], 0.55, 1, null, 'score'],
  [/(\d+)회(초|말) · /, ['{inn}회{half},|{team}의 공격입니다.', '자,|{inn}회{half} 시작합니다.'], 0.4, 0, (v) => v.inn < 7 || !v.close],
  [/(\d+)회(초|말) · /, ['{inn}회{half}!|승부처입니다.', '경기 후반 {inn}회{half},|한 점 싸움입니다.'], 0.85, 0],
  [/경기 종료/, ['경기 종료!|오늘 경기 여기까지입니다.', '마지막 아웃!|경기 끝납니다!'], 1, 2, null, 'end'],
];
// 해설위원 한마디 [확률, 대사들] — 캐스터 외침 뒤에 이어서
const COLOR = {
  walkoff: [0.85, ['오늘의 주인공입니다. 정말 명승부였어요.', '이래서 야구는 끝까지 봐야 합니다.']],
  gs: [0.7, ['한 방에 네 점. 경기 흐름이 완전히 넘어갑니다.', '투수로선 가장 아픈 한 방이죠.']],
  rob: [0.7, ['정말 대단한 수비예요. 점프 타이밍이 완벽했습니다.']],
  hr: [0.6, ['네, 실투였어요. 가운데로 몰린 공을 놓치지 않았습니다.', '타이밍이 완벽했죠. 앞에서 정확하게 걸렸어요.', '노림수가 적중했습니다. 이런 게 해결사죠.', '맞는 순간 소리부터 달랐어요.']],
  dp: [0.4, ['투수 입장에선 최고의 결과죠.', '내야진 호흡이 정말 좋았습니다.']],
  xbh: [0.35, ['코스가 정말 좋았어요. 수비가 잡을 수 없는 곳이었습니다.', '빠른 발이 장타를 만들었어요.']],
  hit: [0.15, ['배트 중심에 잘 맞았어요.', '짧게 끊어 친 게 주효했습니다.', '노리던 공이 들어왔네요.']],
  k: [0.3, ['결정구가 정말 예리했어요.', '볼 배합이 좋았습니다. 바깥쪽으로 보여주다가 승부했죠.', '타자로선 손이 나갈 수밖에 없는 코스였어요.']],
  walk: [0.25, ['투수가 너무 어렵게 갔네요.', '타자가 끝까지 잘 참았습니다.']],
  err: [0.45, ['바운드 계산이 조금 어긋났어요.', '이런 실책 하나가 경기를 바꿀 수 있거든요.']],
  steal: [0.3, ['스타트가 정말 좋았습니다.', '투수 투구 습관을 완벽하게 읽었어요.']],
  cs: [0.4, ['포수 송구가 정말 정확했어요.']],
  dive: [0.5, ['수비 범위가 정말 넓네요. 실점을 막는 수비입니다.']],
  score: [0.3, ['이 한 점이 크죠.', '분위기가 넘어옵니다.']],
  tie: [0.5, ['다시 원점입니다. 이제부터 진짜 승부예요.']],
  flip: [0.6, ['경기가 완전히 뒤집혔습니다. 벤치 분위기도 달라지겠죠.']],
  end: [0.6, ['양 팀 모두 수고 많으셨습니다.', '오늘 경기, 정말 재밌었습니다.']],
};
// 투구 직전 상황 멘트 — 해설위원 목소리 (자주 하면 시끄러우니 25초 쿨다운)
const SITU = [
  [(v) => v.loaded && v.outs === 2, ['2아웃 만루. 여기서 한 방이면 경기가 바뀝니다.', '만루, 투 아웃. 숨 막히는 순간이에요.']],
  [(v) => v.loaded, ['만루 찬스입니다. 최고의 기회죠.', '베이스가 꽉 찼습니다.']],
  [(v) => v.full && v.outs === 2, ['풀카운트, 투 아웃. 다음 공에 모든 게 걸렸습니다.']],
  [(v) => v.full, ['풀카운트. 투수와 타자의 신경전입니다.', '3볼 2스트라이크, 승부구는 뭘까요.']],
  [(v) => v.late && v.close && v.risp, ['후반 득점권 주자. 한 점 싸움입니다.', '여기서 점수가 나면 결정적이죠.']],
  [(v) => v.twoK, ['투 스트라이크, 타자가 몰렸습니다.', '결정구 들어옵니다.'], 0.25],
];

export function situation(d = {}) {
  const s = d.s && typeof d.s === 'object' ? d.s : d;
  // 서버 windup 이벤트: b·s·o·on·sc / 스냅샷: cnt·occ·sc
  const cnt = s.cnt || d.cnt || [d.b || 0, d.s || 0, d.o || 0], occ = (s.occ || d.occ || d.on || [0, 0, 0]).map(Boolean), sc = s.sc || d.sc || [0, 0];
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
    this.last = ''; this.lastAt = 0; this.situAt = -99; this.sc = null;
    this.V = { pbp: null, color: null, same: true };
    this.q = []; this.cur = null; this.gen = 0;
    if (typeof speechSynthesis !== 'undefined') {
      const load = () => { this.V = pickVoices(); };
      load(); try { speechSynthesis.addEventListener('voiceschanged', load); } catch { }
    }
  }
  mode() { return +readStore('castV', 2); }
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
    for (const [re, lines, p = 1, pri = 1, cond, tag] of POOL) {
      if (!re.test(text) || (cond && !cond(v))) continue;
      if (Math.random() > p) return;
      const now = performance.now() / 1000;
      if (pri < 2 && now - this.lastAt < 2.2) return; // 작은 멘트가 연달아 쏟아지지 않게
      let line = this.uniq(lines);
      if (!v.dist) line = line.replace(/비거리 \{dist\}미터!\|/, '');
      this.say(fill(line, v), pri, 'pbp');
      const c = tag && COLOR[tag];
      if (c && Math.random() < c[0]) this.say(pick(c[1]), Math.min(pri, 1), 'color', true);
      return;
    }
  }
  // 투구 직전 상황 멘트 (해설위원)
  situ(d) {
    if (!this.mode()) return;
    const now = performance.now() / 1000;
    if (now - this.situAt < 25 || now - this.lastAt < 4 || this.cur) return;
    const v = situation(d);
    if (v.mode === 'derby' || v.mode === 'practice') return;
    for (const [cond, lines, p = 0.5] of SITU) {
      if (!cond(v)) continue;
      if (Math.random() > p) return;
      this.situAt = now; this.say(this.uniq(lines), 0, 'color'); return;
    }
  }
  uniq(lines) { let l = pick(lines); if (l === this.last && lines.length > 1) l = lines[(lines.indexOf(l) + 1) % lines.length]; this.last = l; return l; }
  // who: 'pbp' 캐스터 / 'color' 해설. follow: 앞 멘트가 끝나면 이어서(자막도 그때)
  say(line, pri = 1, who = 'pbp', follow = false) {
    this.lastAt = performance.now() / 1000;
    const text = line.replace(/\|/g, ' ');
    if (this.mode() !== 2 || typeof speechSynthesis === 'undefined') { if (!follow) this.onLine(text, pri, who); return; }
    this.enqueue({ segs: line.split('|').map((x) => x.trim()).filter(Boolean), text, pri, who, follow });
  }
  enqueue(it) {
    if (it.pri >= 3 || (!it.follow && this.cur && it.pri > this.cur.pri)) { this.hush(); } // 큰 장면: 하던 말 끊기
    else if (this.cur && !it.follow && it.pri < 1) return; // 말하는 중 작은 멘트는 건너뜀
    if (!it.follow && this.q.length > 1) this.q = this.q.filter((x) => x.pri >= it.pri).slice(-1); // 밀린 말이 쌓이지 않게
    this.q.push(it);
    if (!this.cur) this.next();
  }
  next() {
    const it = this.q.shift();
    if (!it) { this.cur = null; this.onDuck(1); return; }
    this.cur = it; this.onLine(it.text, it.pri, it.who); this.onDuck(0.55);
    const gen = ++this.gen;
    let i = 0;
    const seg = () => {
      if (gen !== this.gen) return;
      if (this.mode() !== 2) { this.stop(); return; } // 설정에서 음성을 끈 경우
      if (i >= it.segs.length) { clearTimeout(this.endT); this.cur = null; setTimeout(() => { if (gen === this.gen) this.next(); }, it.who === 'pbp' ? 250 : 120); return; }
      const u = new SpeechSynthesisUtterance(it.segs[i].replace(/[!?…~]+/g, (m) => m[0]));
      Object.assign(u, voiceFor(this.V, it, i));
      u.volume = Math.min(1, linVol('cast'));
      i++;
      u.onend = u.onerror = () => { clearTimeout(this.endT); seg(); };
      clearTimeout(this.endT); this.endT = setTimeout(() => { if (gen === this.gen) seg(); }, 6000); // 크롬이 onend 를 빼먹을 때 대비
      try { speechSynthesis.speak(u); } catch { seg(); }
    };
    // 크롬: cancel() 직후 바로 speak 하면 가끔 무시됨 → 아주 잠깐 쉬고 시작
    setTimeout(seg, this._afterCancel ? 70 : 0); this._afterCancel = false;
  }
  hush() { this.gen++; this.q = []; this.cur = null; clearTimeout(this.endT); try { speechSynthesis.cancel(); } catch { } this._afterCancel = true; }
  stop() { this.hush(); this.onDuck(1); }
}

// 마디별 말투: 캐스터는 빠르고 밝게, 큰 장면(우선순위 2~3)은 마디마다 더 빠르고 높게(고조). 해설은 차분하고 낮게.
function voiceFor(V, it, i) {
  const o = { lang: 'ko-KR' };
  if (it.who === 'color') {
    if (V.color) o.voice = V.color;
    o.rate = 1.02; o.pitch = V.same ? 0.72 : 0.92; // 같은 목소리밖에 없으면 확 낮춰서 다른 사람처럼
  } else {
    if (V.pbp) o.voice = V.pbp;
    const up = it.pri >= 2 ? Math.min(i, 4) : 0;
    o.rate = Math.min(1.45, 1.12 + it.pri * 0.03 + up * 0.06);
    o.pitch = Math.min(1.5, 1.05 + it.pri * 0.04 + up * 0.09);
  }
  return o;
}

// 한국어 목소리 두 개 고르기: 캐스터 = 또렷한 목소리(맥 'Yuna' 로컬, 지연 없음 우선), 해설 = 다른 목소리(가능하면 남성)
// 크롬 맥에는 보통 Yuna(로컬) + Google 한국의(온라인)가 있다. 하나뿐이면 같은 목소리로 음높이만 다르게.
function pickVoices() {
  try {
    const vs = speechSynthesis.getVoices().filter((v) => /^ko/i.test(v.lang));
    if (!vs.length) return { pbp: null, color: null, same: true };
    const find = (re, not) => vs.find((v) => re.test(v.name) && v !== not);
    const male = /Minsu|민수|Jinho|진호|InJoon|Injoon|인준|Hyunsu|현수|Junwoo|준우|Male|남/i;
    const pbp = find(/Yuna|유나/) || vs.find((v) => v.localService) || find(/Google/) || vs[0];
    const color = find(male, pbp) || find(/Google/, pbp) || vs.find((v) => v !== pbp) || pbp;
    return { pbp, color, same: color === pbp };
  } catch { return { pbp: null, color: null, same: true }; }
}
export const _test = { POOL, SITU, COLOR, voiceFor };
