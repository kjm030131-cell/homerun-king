# 홈런왕 재개발 (rebuild) — 작업자 공통 기준

> 2026-11-18 시작. 기존 v20 기틀(멀티·CI·물리·테스트)은 살리고 UI·게임플레이·모델/애니메이션·사운드를 전부 새로 만든다.
> 작업자(파트별 세션)는 반드시 이 문서와 `HANDOFF.md` 0절(규칙·사용자 취향)을 먼저 읽는다.

## 1. 목표
- 모드 두 개: **리얼 모드**(지금처럼 실제 야구에 가까움) + **캐주얼 모드**(짧은 판, 쉬운 조작, 친구끼리 바로 재밌는 순간이 많이 나오게).
- 모델: 사용자가 GPT 이미지 → Tripo로 제작 중. 받을 것: 선수 몸(T포즈, 흰 유니폼·로고 없음, **모자 없음**), 모자, 타격 헬멧, 배트, 글러브. FBX.
- 애니메이션: **Mixamo** 클립을 사용자가 받아 온다(뼈 이름 `mixamorig:*`).
- 사운드: 전면 교체.
- 경기장: 현재 잠실 구장 모델이 별로라는 사용자 피드백 → 전면 새로 (stadium 파트).
- HANDOFF.md 0-3의 금지 사항(공 위치 미리보기 금지, 카메라 휙휙 금지, 팝업 최소 표시 시간, 투수는 마운드 근처만, 렉 민감)은 두 모드 모두 그대로 지킨다.

## 2. 브랜치
- `rebuild` = 통합 브랜치 (총괄 세션만 merge). `main`은 완성 전까지 건드리지 않는다 → 라이브 사이트는 v20 유지.
- 파트별 브랜치: `rebuild/ui`, `rebuild/gameplay`, `rebuild/anim`, `rebuild/audio`, `rebuild/stadium`. 각 작업자는 **자기 브랜치에만 push**. `main`·`rebuild`에 직접 push 금지, force push 금지.
- push 하면 `qa.yml`(빌드+문법+테스트)이 돈다. `gh run watch`로 통과 확인 후 보고.
- 이 클라우드 환경은 npm 설치가 막혀 있다(esbuild·three·playwright 없음). `node --test tests/*.test.mjs`는 로컬에서 되고, 빌드 검증은 CI(qa)로 한다.

## 3. 파일 소유권 (충돌 방지)
| 파트 | 주인인 파일 |
|---|---|
| ui | `public/index.html`, `client/ui/**`(새로), `main.js` 안의 메뉴·로비·대기실·HUD 코드(→ `client/ui/`로 옮김) |
| gameplay | `shared/**`, `src/index.js`, `tests/**`, `client/game/**`(새로: 입력·카메라·타격/투구 클라 처리) |
| anim | `client/player.js`, `skinned.js`, `rig.js`, `anim.js`, `replay.js`, `client/anim/**`(새로), `public/assets/models/**`, `assets-src/models/**`, `assets-src/mixamo/**`, 모델 파이프라인 `tools/` 스크립트 |
| audio | `client/audio.js`, `client/audio/**`(새로), `public/assets/sfx/**` |
| stadium | `client/stadium.js`, `client/stadium/**`(새로), `client/fx.js`, `public/assets/tex/**`, `public/assets/ads/**`, `assets-src/`의 구장 이미지, 조명·하늘·후처리 설정 |
| 공용 | `client/core/bus.js`(바꾸려면 보고서에 제안만), `client/main.js`(아래 규칙) |

- `client/main.js`는 모두가 만지는 곳이라 **연결 지점만 최소로** 고친다. 바꾼 줄 근처에 `// [ui]`, `// [gameplay]` 같은 태그를 단다. 큰 덩어리를 옮기는 건 ui(화면)·gameplay(입력·카메라)만.
- 남의 파일이 꼭 바뀌어야 하면 직접 고치지 말고 보고서에 "요청"으로 적는다.

## 4. 공통 인터페이스
### 4-1. 게임 이벤트 (gameplay가 만들고 모두가 쓴다)
- `shared/sim.js`의 `Game`이 `this.events.push({ e, ...데이터 })`로 쌓고, 스냅샷에 `ev` 배열로 실어 보낸 뒤 비운다. 혼자하기도 같은 배열을 읽는다.
- 클라는 받은 이벤트를 `bus.emit(e, data)`로 뿌린다(`client/core/bus.js`).
- 최소 이벤트 목록(이름 고정, 데이터 필드는 gameplay가 `docs/rebuild/events.md`에 확정):
  `windup` `release` `swing` `contact` `foul` `miss` `ballCall` `strikeCall` `catch` `throw` `tag` `out` `safe` `hr` `score` `steal` `slide` `dive` `inningEnd` `gameEnd` `modeChange`
- UI·애니메이션·사운드는 이벤트를 **구독만** 하고 게임 상태를 바꾸지 않는다.

### 4-2. 모드
- `Game` 설정에 `rules: 'real' | 'casual'`. 규칙 수치는 `shared/rules.js`의 `RULES.real`, `RULES.casual` 객체로 모은다(gameplay).

### 4-3. 캐릭터 애니메이션 API (anim이 만든다)
- `client/anim/character.js`의 `Character`: `play(clip, { fade, speed, loop })`, `setUniform(colors)`, `attach(slot, mesh)`(slot: `head`=모자/헬멧, `handR`=배트·공, `handL`=글러브), `update(dt)`.
- 클립 이름(고정): `idle` `ready` `run` `sprint` `batStance` `swing` `powerSwing` `buntStance` `pitch` `throw` `catchHigh` `catchLow` `dive` `slide` `catcherSquat` `celebrate` `disappointed` `umpireCall`
- 게임 코드는 Mixamo 파일 이름을 모른다. 클립 이름 ↔ 파일 매핑은 anim이 관리.
- 투구 모션 시간표는 sim의 `WINDUP`과 맞아야 한다(gameplay와 anim이 `docs/rebuild/events.md`에서 합의).

### 4-4. 사운드
- `client/audio/`의 사운드 매니저가 bus 이벤트에 반응. 다른 파트는 `sfx()`를 직접 부르지 않는다.

## 5. 보고 형식 (작업자 → 총괄)
각 작업 묶음이 끝나면 `docs/rebuild/<파트>.md`를 갱신하고 아래를 보고:
1. 바꾼 점(숫자 근거 있으면 같이)  2. 브랜치·커밋·qa 결과  3. 사용자 확인이 필요한 것(맥에서 해볼 것, 결정할 것)  4. 다른 파트에 요청할 것
