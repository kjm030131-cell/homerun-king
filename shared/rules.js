// rules.js — 모드별 규칙 수치 (리얼 / 캐주얼). Game 이 this.R 로 읽는다. 서버 Room DO 와 혼자하기가 같은 값을 씀.
// 숫자를 바꾸면 tests/ 범위도 같이 확인할 것. 근거·설계는 docs/rebuild/gameplay.md
//
// 공통 원칙(두 모드 모두): 공이 올 위치 미리보기 없음 · 투수는 마운드 근처만 수비 · 결과 대기 TEMPO 1.15 유지

export const RULES = {
  real: {
    id: 'real', name: '리얼',
    innings: 9, // 방 만들 때 기본 이닝(방장이 1~9로 바꿀 수 있음)
    maxExtra: 3, // 연장 최대 이닝 (넘으면 무승부)
    ghost: null, // 연장 승부치기 주자 (null = 없음)
    startCount: [0, 0], // 타석 시작 볼카운트 [볼, 스트라이크]
    // ── 타격 (사람 타자) ──
    hitEase: 1.0, // HIT_EASE(난이도별) 위에 곱하는 PCI 크기·타이밍 창 배율 (sim.js PCI)
    humanQ: 1.0, // 맞힌 공 질 보정: q = 1-(1-q)·humanQ (작을수록 후함, 1 = 보정 없음)
    sweetPull: 0.25, // 잘 맞힌 공 발사각을 10~25° 쪽으로 모으는 최대 비율
    evMul: 1.0, // 타구 속도 배율 (모든 타자)
    foulTipK: 0.22, // 2스트라이크 파울 → 파울팁 삼진 확률
    cpuPower: 0.2, // CPU 타자 강공(파워 스윙) 비율 (2스트라이크 전)
    clutch: null, // 막판 역전 기회 보정 (캐주얼 전용)
    // ── 투구 ──
    humanPitchErr: 1.0, // 사람 투수 제구 오차 배율
    perfectPitch: [0.84, 0.97], // 게이지 퍼펙트 구간 (클라 표시와 같게)
    perfectBonus: { err: 0.7, brk: 1.08 }, // 퍼펙트 투구: 오차 ×0.7, 변화량 ×1.08
    staminaMul: 1.0,
    seqEffect: true, // 같은 구종 연속 → CPU 타자가 익숙해짐 / 완급 조절 → 헛스윙↑ (구종 선택에 의미)
    // ── 수비·주루 ──
    cpuReach: 1.0, // CPU 수비수 포구 범위 배율 (작을수록 안타↑)
    autoThrowWait: 1.6, // 사람이 공 잡고 가만있으면 CPU가 대신 송구하기까지(초)
    autoThrowWaitSwitched: 0.9, // 자동 전환으로 받은 공
    forceAutoField: false, // true = fieldCtl 을 'auto' 로 고정
    sendHome: -0.05, // 3루 코치 공격성(2아웃 전, 음수일수록 과감) / 2아웃은 -0.3
    mercy: 0, // 콜드게임 점수 차 (0 = 없음)
    timeLim: 0, // 시간제(분). 0 = 없음
  },
  casual: {
    id: 'casual', name: '캐주얼',
    innings: 3,
    maxExtra: 1, // 연장 1회까지(승부치기), 그래도 같으면 무승부
    ghost: [1, 2], // 연장 무사 1·2루에서 시작 (WBC·KBO 승부치기 방식)
    startCount: [0, 0], // 1-1 시작은 AI 경기에서 삼진만 늘어 기각(docs 참고). 1-0 시작은 사용자 결정 사항
    hitEase: 1.06, // PCI 크기·타이밍 창 ×1.06 (보통 사람 흉내 타율 리얼 .28 → 캐주얼 .35, docs 4절)
    humanQ: 1.0,
    sweetPull: 0.35,
    evMul: 1.06, // 장타↑ (펜스는 그대로 — 물리 모델은 공통)
    foulTipK: 0.12,
    cpuPower: 0.4,
    clutch: { deficit: 3, ease: 1.12, ev: 1.03 }, // 마지막 이닝 이후, 지고 있는 팀(1~3점 차) 타자 판정 폭 ×1.12, 타구 속도 ×1.03
    humanPitchErr: 0.8,
    perfectPitch: [0.8, 0.98],
    perfectBonus: { err: 0.6, brk: 1.1 },
    staminaMul: 0.5,
    seqEffect: true,
    cpuReach: 0.9,
    autoThrowWait: 0.9,
    autoThrowWaitSwitched: 0.6,
    forceAutoField: true,
    sendHome: -0.25,
    mercy: 10,
    timeLim: 0,
  },
};
export const RULE_IDS = Object.keys(RULES);
export const rulesOf = (id) => RULES[id] || RULES.real;
