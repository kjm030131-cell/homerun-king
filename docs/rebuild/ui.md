# UI 파트 (rb-ui) — 구조 · 화면 흐름 · 남은 일

2026-11-18. 첫 화면부터 HUD·결과까지 전부 새로 만들고, `client/main.js` 안의 메뉴·로비·대기실·HUD 코드를 `client/ui/`로 옮겼다.

## 1. 디자인 기준
- 스포츠 중계 그래픽. 색 5개: 중계 남색 `--ink #0c1736`, 파울라인 분필 `--chalk #f3f4ee`, 전광판 전구 `--bulb #ffc531`, 공 실밥 `--seam #e5363a`, 잔디 `--turf #2fae6a`.
- 시그니처는 **비스듬한 중계 띠(평행사변형)** 하나. 스코어버그·결과 배너·모드 선택 대각선·주요 버튼·등장 카드에만 쓴다. 나머지 판은 위쪽 색 띠 하나로만 구분(둥근 카드·그림자 남발 X).
- 글꼴: 제목 Black Han Sans, 본문 Noto Sans KR, 숫자 Barlow Condensed(스코어·카운트·핑). Oswald는 3D 캔버스 글자(판정 OUT/SAFE, 베이스 번호, 엠블럼)용으로 계속 로드.
- 리얼 = 분필색, 캐주얼 = 전구색. `body[data-rules]`로 강조색 `--mode`가 바뀐다.
- 이모티콘 없음(캐스터 자막의 마이크 이모티콘도 '중계' 라벨로 바꿈).

## 2. 화면 흐름
```
타이틀(닉네임 + 플레이)
  └ 초대 링크(?room=CODE)로 왔으면 → 바로 그 방
  └ 모드 선택: 리얼 | 캐주얼  (대각선으로 갈린 두 판, 마지막 선택은 localStorage hr_rules)
      └ 로비: 혼자 하기 / 방 만들기 / 코드로 참가 / 열린 방 목록(6초마다 자동 새로고침, 지금 모드 방을 위로)
          ├ 혼자 하기 창(규칙·경기 종류·이닝·구단·팀·포지션·난이도…) → 경기
          └ 대기실: 원정 VS 홈 명단, 경기 설정(규칙·시간제 포함), 채팅, 준비/시작 → 경기
경기 HUD ─ Esc: 일시정지 메뉴(혼자하기는 진짜로 멈춤) ─ 경기 끝: 결과(승리/패배 + FINAL 스코어버그 + MVP·홈런왕 + 라인·기록표)
나가기 → 닉네임이 있으면 로비로(예전엔 타이틀)
```

## 3. 파일 구조 (`client/ui/`)
| 파일 | 내용 |
|---|---|
| `index.js` | `createUI(ctx)` — 화면 전환, 타이틀·모드·로비·혼자하기·방 만들기·코드 참가·비밀번호·구단 고르기·일시정지·키보드(Esc/Enter/Tab/H/T), bus 구독 |
| `hud.js` | `hudFrame()` 매 프레임 HUD, `myDuty()`(카메라 코드도 씀), 스윙 분석, 도움말 카드, 등장 카드·타석 소개, 구종 막대 |
| `room.js` | 대기실 렌더·설정 바인딩, 구단 그리드 |
| `results.js` | 라인스코어·기록표·더비 순위, MVP 계산, 결과 화면, 팀색(어두운 팀색은 보조색으로) |
| `announce.js` | 배너 큐(최소 1.1초), 피드백 문구, 토스트, 캐스터 자막 |
| `chat.js` | 채팅·빠른 채팅 |
| `settings.js` | `store`/`cfg`(localStorage `hr_*` 키 v20과 동일), 설정 창 |
| `career.js` | 통산 기록(서버 `/api/stats` / 혼자는 `hr_career`) |
| `dom.js` | 값이 바뀔 때만 DOM을 건드리는 setter(`setText`, `setHTML`, `cls`, `style`) |

`public/index.html`: 모든 화면 마크업 + CSS. 테스트 훅용 id(`#bSolo`, `#oGo`, `#oMode`)는 유지.

### main.js 연결 지점 (`// [ui]` 태그)
- `createUI({...})` 한 번. ui는 `ctx` 게터로 `S`·`lobby`·`myId`·`net`만 읽고, 행동은 `ctx.startLocal / connect / leave / setPaused …`로만 한다.
- `onSnap`: `ui.showOver(s)`, `applyClubs/applyTimeOfDay`(HUD에서 옮김). 등장 컷씬 상태 머신(`startIntro/introStep`)은 카메라 때문에 main에 두고 카드 그리기만 ui.
- `updateHUD()`는 이제 3D(존·배트 원·조준점) + 값 계산만 하고 `ui.frame(role, f)`로 넘긴다. `f` = `{ camMode, gauge:{lv,type,band}, pitchType, bunt, swingMode, aimOn, throwPow, landChase, ballDist, fps, rtt, pgList, jit }`.
- keydown 맨 앞 `ui.handleKey(e, k)`, 창이 떠 있으면 경기 입력 막음(`ui.modalOpen()`).
- 혼자하기 일시정지: `net.paused` → `tickFn`이 멈춤, 풀 때 `offset = null`(시계 재동기화).

## 4. 성능
- v20 `updateHUD`는 매 프레임 `JSON.stringify`(스냅샷 일부 + `s.dy` 객체 통째)로 키를 만들고, 게이지·와인드업 바를 `width/height`로 바꿔 레이아웃을 다시 계산했다.
- 지금: 느린 부분 키는 원시값 문자열 연결, 모든 텍스트/클래스/스타일은 캐시 비교 후에만 씀, 바(와인드업·게이지·체력·송구 세기)는 `transform: scale`만 → 레이아웃·페인트 없이 합성만. 핑/fps는 0.5초마다.
- 맥에서 확인: 크롬 DevTools Performance로 경기 중 몇 초 녹화 → "Recalculate Style/Layout"이 프레임마다 생기지 않으면 OK.

## 5. 이벤트 버스
구독(전부 `client/ui/index.js` 끝):
| 이벤트 | 연출 |
|---|---|
| `ballCall` / `strikeCall` / `out` | 스코어버그·큰 카운트 해당 줄 튕김 |
| `score` (`half`) | 점수 칸 전구색 번쩍 |
| `contact` (`grade`, `pow`) | 피드백 문구 크기·색 (perfect는 전구색) |
| `modeChange` | HUD 다시 그림 |
| `caster:line` (`{text}` 또는 문자열) | 캐스터 자막. **한 번이라도 오면 ui 내장 멘트·브라우저 음성은 꺼짐** |

이벤트가 안 오면(옛 서버) `hud.js`가 스냅샷 카운트·점수 변화를 비교해 같은 연출을 한다(`onBus`로 한쪽만 동작).

ui가 내는 것(전부 `ui:` 접두사, 게임 이벤트 이름은 emit 안 함):
- `ui:screen {name}` — `title | modes | lobby | room | game | over`
- `ui:click {}` — 버튼 클릭(캡처 단계, 모든 button)
- `ui:volume {master, sfx, crowd, cast}` (0~1) — 시작 시 1번 + 슬라이더 바뀔 때. 슬라이더 id `vol`, `volSfx`, `volCrowd`, `volCast`, 저장 키 `hr_vol`, `hr_volSfx`, `hr_volCrowd`, `hr_volCast`. `vol`은 기존처럼 `setVolume()`도 부름.

## 6. 모드·설정 값
- 혼자하기 `startLocal(name, { rules, ... })`, 방 `{ t:'set', rules }`, 방 만들 때 첫 `set`에 `rules`·`timeLim` 포함.
- 규칙을 바꾸면 이닝 기본값을 `RULES[r].innings`(리얼 9, 캐주얼 3), 타격 난이도 기본값을 캐주얼=쉬움 / 리얼=보통으로 맞춤(사용자가 바꿀 수 있음).
- 시간제 `timeLim`: 끔/10/15/20/30분(대기실·방 만들기, 정규 경기만).
- 표시용 모드는 `S.ru` → (혼자) 고른 값 → `lobby.set.rules`.
- 구종 막대: `S.sq`(이번 타석 최근 구종)를 색 점으로 보여주고, 같은 공을 2번 이상 연속이면 그 구종에 "연속 n".
- 게이지 초록 구간은 `RULES[S.ru].perfectPitch`(리얼 0.84~0.97, 캐주얼 0.80~0.98).
- 설정의 "타격 보조"는 문구 수정: 기본(자석 보정 + 초록 테두리) / 연습용(자석 세게 + 배트 원 위 타이밍 링) / 끄기. 공 위치 표시는 없다(조작법 문구도 수정).

## 7. 검증
- `node --test tests/*.test.mjs` 24개 통과.
- 이 환경엔 브라우저가 없어서, 임시 가짜 DOM(index.html 파싱 + 선택자) + three 스텁으로 번들을 실제로 돌려봄(저장소 밖 `/tmp`, 커밋 안 함): 타이틀 → 모드 → 로비(방 목록 2개) → 설정 창 → 방 만들기 창 → 혼자하기(캐주얼, 이닝 3 전달 확인) → HUD(스코어버그·역할·키 안내) → Tab·H·T·Esc 일시정지(게임 시계 멈춤 확인) → 결과 화면 → 로비 → 멀티 대기실(실제 `Game.lobbyState()`로 렌더, 규칙 변경 메시지 전송, 채팅) → 멀티 경기 HUD. 투수로 4구: 게이지·모드별 초록 구간·"연속 3" 표시. 오류 0.
- 눈으로 보는 확인(레이아웃·글꼴·겹침)은 아직 못 했다 → 사용자 맥에서.

## 8. 남은 일 / 요청
- **사용자 확인**: 맥 크롬에서 첫 화면~결과까지 한 바퀴. 특히 모드 선택 대각선 화면, 스코어버그 크기, 오른쪽 큰 볼카운트 위치(화면 높이 36%), 배너 색(안타=초록, 아웃=빨강, 홈런=전구색).
- **사용자 결정**: 규칙 바꿀 때 이닝 기본값(리얼 9이닝은 gameplay 기본값을 따름 — 친구끼리 너무 길면 3/5로), 나가면 로비로 가는 것.
- **gameplay 요청**: `src/index.js` Room `info()`에 `rules`(와 `timeLim`)를 넣어 주면 로비 방 목록에 리얼/캐주얼 태그가 맞게 나온다(지금은 전부 '리얼'로 보임).
- **audio 요청**: 내 타석 등장 때 오르간(`sfx.organ`)은 아직 ui가 `ctx.sound('organ')`로 부른다. `batterUp` 이벤트(`id`가 내 id)로 옮기면 ui 쪽 호출을 지우겠다. 버튼 소리는 `ui:click`만 쓰고 직접 부르지 않는다.
- **도구**: `tools/test/steps/common.mjs`의 `start`는 닉네임 없이 `#bSolo`를 누른다 → 닉네임 입력이 필요해서 헤드리스 장면 테스트가 막힐 수 있다. 장면 테스트 쓰는 파트가 `#nick` 값을 먼저 넣도록(`document.querySelector('#nick').value='테스트'`) 고쳐주면 된다.
- 키아트(`public/assets/ui/keyart.jpg`)는 이제 안 쓴다(타이틀 뒤는 실시간 경기장). 새 구장이 들어오면 타이틀 카메라 궤도(`updateCamera`의 title)도 같이 봐 달라.
- 다음에 할 만한 것: 모바일 터치 화면 다듬기, 처음 접속 튜토리얼, 랭킹 페이지.
