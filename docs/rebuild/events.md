# 게임 이벤트 명세 (gameplay 확정, 2026-11-18)

UI·애니메이션·사운드는 이 이벤트를 **구독만** 한다(`bus.on(이름, fn)`). 게임 상태는 바꾸지 않는다.

## 흐름
- `shared/sim.js`의 `Game.ev(e, data)`가 `this.events`에 `{ e, at, ...data }`를 쌓는다.
- 서버(Room DO): 2틱마다 `game.snapshot(true)` → 스냅샷의 `ev` 배열로 실어 보내고 비운다(30Hz). 접속 직후 1회 보내는 스냅샷은 `snapshot()`(이벤트 안 비움).
- 혼자하기: 매 틱 `game.snapshot(true)`를 `handleMsg`로 넘김 → 같은 경로.
- 클라: `client/main.js` `handleMsg` 의 `case 's'`에서 `onSnap(m)` 다음 `for (x of m.ev) bus.emit(x.e, x)` (`// [gameplay]` 태그). 그래서 구독 함수가 불릴 때 main.js 의 `S`는 이미 그 스냅샷으로 갱신돼 있다.
- 아무도 안 꺼내면(테스트·AI 경기) 400개 넘을 때 오래된 것부터 버린다.

## 공통 필드
| 필드 | 뜻 |
|---|---|
| `e` | 이벤트 이름 |
| `at` | 발생 시각(게임 시계 초, `s.now`와 같은 시계). 클라 `simNow()`와 비교하면 지연 보정 가능: `late = simNow() - at` |
| `pid` | 투구 id = 스냅샷 `s.p.id` |
| `i` | 수비수 인덱스 = 스냅샷 `s.fl[i]` (0 P, 1 C, 2 1B, 3 2B, 4 SS, 5 3B, 6 LF, 7 CF, 8 RF) |
| `pos` | 수비 포지션 문자열(`'SS'` 등) |
| `rid` | 주자 id = 스냅샷 `s.rn[k][7]` |
| `base` | 1·2·3루, 4 = 홈 |
| `human` | 1 = 사람이 한 동작, 0 = CPU |

네트워크: 이벤트는 스냅샷에 실려 오므로 **핑/2 + 최대 33ms 늦게** 도착한다. 정확한 시각이 필요한 연출(투구 모션)은 `at` 기준으로 맞춘다.

## 투구 시간표 (WINDUP = 1.85s) — anim 파트 합의용
`windup` 이벤트 시각 `at` = 투구 시작. 단계별 시각(`at` 기준 초):

| 구간 | 시작 | 끝 | 내용 | 이벤트 필드 |
|---|---|---|---|---|
| 세트 | 0.00 | 0.35 | 세트 포지션 정지(글러브 가슴 앞) | `set: 0.35` |
| 레그킥 | 0.35 | 1.25 | 앞다리 들어 올림 | `kick: 1.25` |
| 정점 멈춤 | 1.25 | 1.45 | 다리 정점에서 잠깐 멈춤 (타자 타이밍 신호) | `peak: 1.45` |
| 스트라이드 | 1.45 | 1.85 | 앞으로 내딛으며 팔 스윙 | `dur: 1.85` |
| **릴리스** | **1.85** | | 공이 손을 떠남 → `release` 이벤트, `rel`(절대 시각) | `rel` |
| 팔로스루 | 1.85 | 약 2.40 | 마무리 | |

- 현재 `client/anim.js pitchK()`가 이 표와 같다. Mixamo 투구 클립은 **릴리스 프레임이 클립 시작 후 1.85초**가 되도록 속도/구간을 맞추고, 정점 멈춤(1.25~1.45)은 그 구간 프레임을 붙잡아 표현하면 된다.
- 숫자를 바꾸려면 `shared/sim.js WINDUP` + 이 문서 + anim 매핑을 같이 바꾼다(테스트 `events.test.mjs`가 `rel - at = dur` 확인).
- 공이 포수에 닿는 시각 = `arr`(절대). 비행 시간 `T = arr - rel`.

## 이벤트 목록

### 투구·타격
| 이벤트 | 언제 | 데이터 |
|---|---|---|
| `windup` | 투수가 투구 시작 | `pid, rel, arr, human, set, kick, peak, dur`, 상황 `b, s, o`(볼·스트라이크·아웃), `on:[1루,2루,3루]`(1 = 주자), `sc:[원정,홈]` — **코스(tx,ty)·구종 없음** (공 위치 미리보기 금지) |
| `release` | `at = rel` 순간 | `pid, type`(FB·TS·SL·CB·CH·SP·BP), `kmh, arr, T, pf`(1 = 퍼펙트 게이지 투구) |
| `swing` | 스윙 판정 순간(서버) | `pid, mode`(contact·power·bunt), `human, dt`(ms, 음수 = 빠름), `bid`(타자 id, CPU면 null) |
| `miss` | 헛스윙 | `pid, mode, dt, why`(early·late·off = 타이밍은 맞았는데 위치 빗나감), `human` |
| `contact` | 배트에 맞음(파울팁 포함) | 아래 표 |
| `foul` | 파울 확정 | `pid, kind`(ball·bunt·tip), `s`(파울 뒤 스트라이크 수), `k`(1 = 파울팁 삼진), `x, z`(공 위치, ball 일 때) |
| `ballCall` | 볼 판정 | `pid, b, s`(판정 뒤 카운트), `walk`(1 = 볼넷/사구), `hbp`(1 = 몸에 맞는 공) |
| `strikeCall` | 스트라이크 판정(헛스윙·루킹·파울팁 삼진) | `pid, swinging, looking, b, s, k`(1 = 삼진) |

`contact` 데이터 (맞는 순간 타격감용):
| 필드 | 뜻 |
|---|---|
| `foul` | 1 = 파울 타구(빗맞은 파울/파울팁 후보) |
| `pid, q, ev, la, mode` | 투구 id · 맞힌 질 · 타구 속도 · 발사각 · 스윙 종류 |
| `grade` | `perfect`(q>0.82) · `good`(>0.55) · `ok`(>0.3) · `weak` · `tip`(파울 타구) · `bunt` |
| `kind` | `grounder`(<10°) · `liner`(10~25°) · `fly`(25~50°) · `popup` · `foul` · `bunt` |
| `pow` | 0~1 연출 세기(타구 속도·등급). 히트스톱 길이·화면 흔들림·타격음 세기·관중 반응에 그대로 쓰면 됨 |
| `q` | 맞힌 질 0~1 |
| `ev, la, spray` | 타구 속도 km/h, 발사각°, 방향°(+ = 3루/좌측) |
| `xd` | 펜스 무시 예상 비거리 m (8° 이하 땅볼·파울·번트는 0). "넘어간다!" 예고 연출에 쓸 수 있음 |
| `dt, off` | 타이밍 오차 ms, 배트 중심-공 오차 [cm 좌우, cm 위아래] |
| `x, y` | 맞은 위치(홈플레이트 면) |

### 수비·주루
| 이벤트 | 언제 | 데이터 |
|---|---|---|
| `catch` | 포구 성공. **투구가 포수 미트에 들어갈 때도**(`pitch:1`, 안 맞은 공의 도착 시각 `arr`, 사구 제외) | `pitch`(1 = 포수가 투구 받음), `kmh`(투구 구속, 타구면 타구 속도), `i, pos, fly`(1 = 노바운드 타구), `dive, jump, thrown`(1 = 송구 받음), `robbed`(홈런 강탈), `x, y, z, human` |
| `throw` | 송구 | `i, pos, from:[x,z], to:[x,z], base`(-1 = 베이스 아님/커트맨), `T`(예상 비행 시간), `pw`(0~1 세기), `relay`(1 = 커트맨에게), `pick`(1 = 견제구) |
| `tag` | 태그 아웃 | `i, pos, rid, base` (`out`보다 먼저 옴) |
| `out` | 아웃 | `call:'out'`, `k`(베이스 1~4, 삼진·뜬공은 0), `x, z`(판정 위치), `kind`(k·fly·force·tag·pick·cs = 도루 저지), `outs`(아웃 뒤 아웃카운트), `dp`(이 플레이 아웃 수, 2 = 병살), `rid, base, i, pos, name`, 삼진이면 `looking, bunt, bid` |
| `safe` | 세이프 | 공통 `call:'safe', k`(베이스), `x, z` / 접전 도착 `rid, base, x, z, close:1` / 견제 귀루 `pick:1, base` / 도루 성공 `steal:1, base` |
| `steal` | 도루 시작 | `rid, from, to, cpu` |
| `slide` | 슬라이딩 시작 | `rid, base, back`(1 = 귀루 슬라이딩) |
| `dive` | 다이빙 시작 | `i, pos, dx, dz`(방향 단위벡터), `human` |

### 점수·경기
| 이벤트 | 언제 | 데이터 |
|---|---|---|
| `hr` | 홈런 확정(득점 전) | `dist, n`(타점), `walkoff`(1 = 끝내기 홈런), `name, bid, ev, la, x, z, before`(홈런 전 점수) / 더비: `derby:1` |
| `score` | 1점마다 | `half, sc:[원정,홈], rid, name, lead`(득점 뒤 점수 차, 공격팀 기준), `go`(1 = 앞서가는 점수 = 역전/결승점 후보), `tie`(1 = 동점), `walkoff` |
| `inningEnd` | 이닝 초/말 끝 | `inning, half, runs, sc` |
| `gameEnd` | 경기 끝 | `sc, win`(away·home·null), `walkoff, mercy`(콜드), `inning, rules` / 더비: `derby, best, hr` |
| `modeChange` | 경기 시작(`start:1`) · 방 설정에서 규칙 변경 | `rules`(real·casual, 항상 있음), `mode`(game·derby), `innings` |

### 추가 이벤트 (최소 목록 밖, 있으면 편한 것)
| 이벤트 | 데이터 |
|---|---|
| `inningStart` | `inning, half, last`(마지막 이닝), `extra`(연장) |
| `batterUp` | `id, name, n, slot, team, cnt` |
| `hit` | `bases`(1~4), `bunt, gr`(인정 2루타), `rbi, name, bid` |
| `error` | `i, pos, kind`(field·catch), `dive` |
| `wall` | 펜스 맞음 `x, y, z, impact` |
| `pick` | 견제 시작 `base, cpu` |
| `wildPitch` | `n`(진루 주자 수) |
| `scoreVoid` | 쓰리아웃 포스아웃으로 득점 무효 `half, runs, sc` |
| `playEnd` | 인플레이 끝 `runs, outs, hl`(1 = 하이라이트 → 리플레이 시간 있음) |

### 클라 전용 이벤트
| 이벤트 | 언제 | 데이터 |
|---|---|---|
| `localSwing` | **내가** 스윙 버튼 누른 즉시(main.js doSwing) | `pid, mode, contact`(맞았는지 — 서버와 같은 결정적 판정), `dt, q` |

타자 본인 화면에서는 `localSwing`(즉시)이 먼저, 서버 `swing`/`contact`/`miss`가 핑만큼 뒤에 온다. 타격음·히트스톱처럼 **바로 나와야 하는 것은 `localSwing`**, 타구 결과 연출은 `contact`를 쓰고 같은 `pid`로 중복을 거른다.

## 순서 보장
- 같은 틱 안에서는 발생 순서 그대로. 예: `swing → contact → (foul|…)`, `tag → out`, `hr → score×n`, `strikeCall(k) → out(k)`.
- 한 투구: `windup → release → [swing → contact|miss] → ballCall|strikeCall|foul|…`.
