# qa 파트 기록 (rb-qa)

> 헤드리스 실행 하네스 `tools/qa/` 와 거기서 찾은 버그. 다른 파트 파일을 고친 곳은 `// [qa]` 주석.

## 하네스 사용법
```
node tools/qa/run.mjs --list                         # 시나리오 목록
node tools/qa/run.mjs                                # 전부 (약 10분)
node tools/qa/run.mjs game-real practice --render=0  # 골라서, 렌더 끔(빠름)
node --import ./tools/qa/three-hook.mjs --test tests/*.test.mjs   # three 패키지 없는 환경에서 단위 테스트
```
- 진짜 크롬(헤드리스, SwiftShader WebGL) + 가상 시계로 **실제 `client/main.js` 루프**를 돌린다. 봇이 키보드·포인터 이벤트로 타격(맞힘·헛스윙·파울·번트·강타)·투구(구종·게이지)·수비 이동/송구·주루·도루·리플레이 넘기기·다시 하기를 한다.
- 흐름: 번들(esbuild, 없으면 bun) → `public/` 서빙(three 는 로컬 사본, 폰트·CDN 차단) → 계측(`inject.js`)·봇(`driver.js`) 주입 → 타이틀 → 모드(리얼/캐주얼) → 혼자하기 설정 → 시작.
- 멀티(`multi`, `multi-casual`): `src/index.js` 의 **진짜 Room 클래스**를 node 에서 돌리고(`room.mjs`, WebSocket 서버 직접 구현) 브라우저 2~3개가 방 만들기·코드 참가·시작까지 UI로 들어간다. 실시간, 렌더 끔.
- 옵션: `--sec=게임초` `--render=N`(N프레임마다 실제 렌더, 기본 30, 0=끔. SwiftShader 렌더는 한 번에 0.2~0.6초) `--jitter=0.02`(가끔 긴 프레임 흉내, 기본 2%) `--seed=N` `--v`(진행 표시) `--profile`(느린 스텝만 CPU 프로파일 → 함수별 시간) `--alloc`(할당 샘플링) `--gc`(30초마다 강제 GC 후 힙) `--json=파일`(기본 `tools/qa/.out/last.json`).
- 출력: 예외(rAF/프레임/틱/콘솔), 프레임당 JS 시간 분포·최대·타격 후 1.5초 p95, 장면 객체·geometry·texture·셰이더 수, **장면에서 빠졌는데 dispose 안 된 텍스처·지오메트리**, 힙, 오디오 노드 생성 수, NaN 위치, 화면 공 vs 시뮬 공(위치 차·보이는 속도 비율). 예외가 있으면 끝 코드 1.
- 필요: three r160(`THREE_DIR` → `node_modules/three` → `/tmp/three160` → `/tmp/anim-three`, 파일별로 찾음), 크롬(`CHROME` 또는 `/usr/bin/google-chrome`), playwright-core(`node_modules` 또는 `/opt/npm-tools`). CI 에는 크롬이 없어 CI 에선 안 돈다(로컬/클라우드 세션용).
- 한계: 픽셀은 못 본다(SwiftShader). 프레임 시간은 이 서버 CPU 기준이고 다른 작업과 겹치면 튄다 — 비교는 같은 조건에서. 이 서버는 맥보다 대략 2~3배 느리다.

## 찾아서 고친 것
| # | 증상 | 원인 | 수정 (파일) |
|---|---|---|---|
| 1 | 공 치면 화면 고정 | `ui.introHide` 없음 → 등장 컷씬 끝(다음 와인드업) 프레임에서 TypeError → rAF 재예약 못 함 | `client/ui/index.js`, `main.js` frame try/catch (main 704ccc8 과 같은 수정, main 쪽 채택) |
| 2 | 스윙 직후 렉 한 번 → 화면 고정(가능성) | `fx.update` 배트 잔상: 오래된 점을 지우기 **전** 길이를 써서, 한 프레임이 길면 빈 배열을 구조분해 → TypeError (멀티에서 재현) | `client/fx.js` |
| 3 | 프레임 JS 시간 | 새 캐릭터 `_blob()`(발밑 그림자)이 선수마다 매 프레임 `root.updateMatrixWorld(true)` (뼈 53개+장비 전체) | `client/anim/character.js` — 지움(getWorldPosition 이 부모 사슬만 갱신). 리얼 경기 평균 0.9 → 0.45ms/프레임 |
| 4 | 공수 교대 순간 멈칫(40ms+, 옛 몸 110ms) | 교대마다 수비 9명·타자·코치를 새로 생성(데칼 캔버스·스켈레톤 복제) | `client/main.js` buildTeams — 팀별 캐시 재사용 |
| 5 | GPU 메모리 증가 | 주자를 출루마다 새로 만들고 dispose 없이 버림 → 텍스처 89→146, geo 194→218 (430초) | `client/main.js` — 주자 풀(같은 팀·번호·seed 재사용) |
| 6 | GC 멈춤(최대 ~50ms) | 리플레이 링버퍼가 매 프레임 선수 18명 × Float32Array 새로(새 몸은 안 쓰는 관절 칸까지) + 클립 스냅샷 배열 2개 | `client/replay.js`, `client/anim/character.js snapshot(out)` — 밀려난 프레임 배열 재사용 |
| 7 | 오디오 노드 잔류(예방) | 소리가 끝나면 `out` 만 끊고 패너·잔향 게인은 그룹 버스에 연결된 채 남음 | `client/audio/engine.js` voice — 끝나면 체인 전부 disconnect |

## 확인했지만 문제 아닌 것
- JS 힙 증가(900초 57→123MB): 강제 GC 후엔 44~46MB로 평평 → 누수 아님(V8 이 GC를 늦게 함). 할당량(GC 압력)은 6번으로 약 10% 감소.
- 화면 공 속도: 타구 비행 중 화면에 보이는 속도/시뮬 속도 중앙값 0.98 (p10 0.9, p90 1.09). 위치 차는 평균 0.6m(한 프레임 앞서 그리는 순서 차이). → "공이 느려 보인다"는 클라 표시 문제가 아니라 시뮬 물리·카메라 쪽(gameplay 담당).
- 오디오: 게임 1초당 노드 약 11개 생성(일회용 합성음). 7번 수정 후 끝난 노드는 전부 끊김.
- 시나리오 11개(리얼·캐주얼·투수·중견수·더비·연습·옛 몸 경기/연습·멀티 3인·멀티 캐주얼, 다른 seed 2회 포함) 예외 0.

## 수비 검사기 `tools/qa/fielding.mjs` (11-19, anim 세션)
엔진만 node 에서 돌리며 매 틱 수비 불변식 확인: `node tools/qa/fielding.mjs 20 [--rules=casual] [--human=idle] [--seed=N]`
(공 방치·플레이 25초+·수비수 펜스 밖/NaN·공 들고 멍·송구 목표에 사람 없음·받을 사람 앞에서 빠짐·뜬공 근처 구경·3명 몰림·주자 겹침·먼 거리 포구)

| 찾은 것 | 원인 | 수정 |
|---|---|---|
| 송구가 받는 사람 발 앞에서 바운드(플레이의 **16%**, 외야→1루 등 긴 송구) | `throwTo` 가 공기저항 없이 속도 계산 → 실제 비행(항력 있음)에서 5~6m 짧게 떨어짐 | `aimThrow`: 항력 넣은 궤적을 3번까지 시뮬해 시간 T 에 (목표, 1.3m) 로 오게 속도 보정 |
| 홈런 타구 쫓던 외야수가 펜스 2~3m 밖까지 달려 나감(플레이 ~7%) | 이동 코드 여러 곳에 경기장 경계가 없음 | `keepInPark()`: 라이브 틱 끝에 펜스/관중석 경계 0.6m 안으로 |
| 혼자하기 수비 때 투수만 조작 | 기본 `fieldCtl: 'pos'` | 기본 'auto' |
| 뜬공 때 수비 3인칭 카메라가 관중석만 비춤 | 고개만 들어 선수가 화면 밖 | 공 높이만큼 뒤·위로 빠짐 |

남은 것(드묾): 1루수 땅볼 처리 후 1루 커버 투수가 늦을 때 빈 베이스로 송구(0.2%).

## 남은 것 / 다른 파트에 요청
- anim: 새 캐릭터 `_post()` 도 IK·고개 돌리기 중엔 `root.updateMatrixWorld(true)` 를 매 프레임(심판 `look` 이 상시) — 필요한 뼈 사슬만 갱신하면 더 줄어듦.
- anim/audio: `mkApplause`/`mkBabble` 가 첫 경기 시작 때 큰 버퍼를 JS 루프로 합성(할당 ~80MB, 수백 ms) — 로딩 화면이나 idle 때 미리.
- `AnimationMixer._update` 할당이 큼(three 내부, 2분에 ~90MB 샘플) — 화면 밖 선수 갱신 간격을 더 늘리는 쪽이 효과 있을 것.
- 옛 몸(?legacy) 은 프레임 평균이 새 몸의 3배(1.35ms) — 새 몸이 기본이라 손대지 않음.
