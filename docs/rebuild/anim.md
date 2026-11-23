# anim 파트 — 모델·애니메이션 (rb-anim)

> 2026-11-18. 새 몸(Tripo → Mixamo)을 쓰는 `Character` + 파일 파이프라인. **새 파일이 들어오기 전까지 게임은 지금 몸(body.bin)으로 그대로 돈다.**

## 0. 현재 상태 (2026-11-18 밤)
- **몸 들어옴**: `assets-src/models/player.glb`(Tripo 리깅, `mixamorig:*` 뼈 53개, 삼각형 1.8만) → `public/assets/models/player.glb`(텍스처 2048/1024 JPEG, 8.9MB → 2.8MB).
- **클립 16개 들어옴** (`public/assets/models/anim/`): idle, ready, run(임시), sprint, throw(임시), batStance, swing, powerSwing, buntStance, pitch, dive, slide, catcherSquat, celebrate, disappointed, umpireCall.
- **필수 5개가 다 있어서 새 캐릭터로 바뀜.** 단 `run` 은 Running 을 받기 전까지 Fast_Run 을 같이 씀(manifest.json 에서 원래 속도 5.66m/s → 느리게 뛰면 재생도 느려짐).
- 없는 것: catchHigh·catchLow(→ ready + 글러브 IK), umpireSafe(→ idle). 필수 클립이 빠져도 `?animlab` 은 열리게 바꿔 둠.
- 장비(모자·헬멧·배트·글러브) GLB 들어옴(11-19) → 아래 "11-19 장비 4개" 참고.

### 새 변환 방식: `tools/mixamo-retarget.py` (Blender 필요 없음, Python + numpy)
- Mixamo FBX(Without/With Skin 둘 다)를 읽어 **우리 몸 뼈에 맞게 월드 회전 리타깃** → `anim/<클립>.glb`.
  Mixamo 기본 캐릭터로 받은 애니메이션도 그대로 써도 됨(뼈 방향·길이 차이 보정, Hips 이동은 엉덩이 높이 비율로 축척).
- 클립 ↔ 원본 파일, 회전(yaw)·자르기(trim)·정지 자세(hold)·반복 구간 자동 선택(loop)은 `assets-src/mixamo/clips.json` 에서 관리.
- 실행: `python3 tools/mixamo-retarget.py` (전부) / `python3 tools/mixamo-retarget.py swing pitch` (일부) / `player` = 몸만.
- 검증: 내보낸 클립을 몸에 입혀(스키닝) 프레임별로 렌더해서 원본 Mixamo 뼈대 동작과 비교함. 방향: 타자 클립은 원본이 홈플레이트를 -x 로 봐서 `yaw 90`(→ +z 홈플레이트, +x 투수), 번트는 투수 정면, 투수(스트라이드 +z)·포수·심판은 0.

| 클립 | 원본 | 처리 |
|---|---|---|
| batStance | Baseball_Idle | yaw 90, 1.5초 반복 |
| swing | Baseball_Hit | yaw 90, 0~1.85초(이후 1루로 뛰는 구간 잘라냄) |
| powerSwing | Baseball_Hit_1 | yaw 90, 0~2.1초 |
| buntStance | Baseball_Bunt | yaw 90, 1.2초 자세로 정지(배트 수평, 투수 정면) |
| pitch | Baseball_Pitching_1 | 0~2.8초(레그킥 높은 쪽). 마커는 로딩 때 자동(릴리스 ≈ 1.6초) |
| catcherSquat | Baseball_Catcher | 앉은 구간 중 처음·끝이 가장 비슷한 7.6~8.8초 반복 |
| umpireCall | Baseball_Umpire | 전체(자세 → 스트라이크 콜 → 자세) |
| idle | Breathing_Idle | 9.9초 반복 |
| ready | Goalkeeper_Idle | 3.3초 반복(무릎 굽힌 준비 자세) |
| run / sprint | Fast_Run | 제자리화는 로더(lockXZ), 원래 속도 5.66m/s(manifest) — run 은 임시 |
| dive | Goalkeeper_Diving_Save | yaw -65(옆 다이빙을 정면 방향으로, 글러브 손이 앞), 0.75~3.4초(도약 → 착지 ≈ 0.6초, 게임 0.55초) |
| slide | Running_Slide | 전체(발부터, 착지 ≈ 0.3초) |
| celebrate | Victory | 8.5초 반복 |
| disappointed | Defeated | 전체 |
| throw | Baseball_Pitching(5.2초 버전) | 1.45~2.75초(스트라이드 → 릴리스 → 팔로스루). 야수 송구 클립 받기 전 임시 |

~~쓰지 않고 원본만 둔 것~~ → 11-22 [motion] 에서 23개 전부 씀(아래 절).

### 다음에 받아야 할 Mixamo (아래 3-3 표 이름 그대로, `assets-src/mixamo/` 에 두고 clips.json 에 등록)
- `run`(Running, In Place 체크) — 지금은 Fast_Run 임시
- `throw`(Throw / Goalkeeper Overhand Throw — 지금은 투구 동작 잘라 씀), `catchHigh`(Goalkeeper Catch), `catchLow`(Goalkeeper Scoop), (선택) `umpireSafe`

### 11-19 새벽 수정 (피드백: 화면 멈춤·붕 뜸·배트 이상·혼자 침)
- **타격 후 화면 정지 버그**: `ui.introHide` 가 UI 객체에 빠져 있어 타자 등장 카드가 끝날 때 예외 → 프레임 루프(requestAnimationFrame) 사슬이 끊겨 화면이 영영 멈춤. `client/ui/index.js` 한 줄 추가 + `client/main.js` frame 을 try/catch 로 감싸 오류가 나도 다음 프레임은 항상 예약([fix] 태그).
  화면이 멈춘 동안에도 시뮬(setInterval)은 계속 돌아서 클릭이 스윙으로 들어갔음 → '아무것도 안 눌렀는데 혼자 침' 의 주원인으로 봄. (혼자하기에서 입력 없이 15구 확인: 자동 스윙 없음. 멀티에선 연결이 끊기면 CPU 가 대신 침 — 화면에 '연결 끊김' 문구)
- **스윙 끝 자세**: swing 클립 끝(1.85초)이 '배트 놓고 1루로 뛰기 시작' 자세였음 → 스윙 후 그 자세로 멈춰 팔 벌리고 배트가 위로 솟아 보였음. 팔로스루 끝(1.62 / 강타 1.68초)으로 자름.
- **바닥 보정**: 리타깃 도구가 프레임마다 몸이 땅을 뚫지 않게 Hips 를 올림(내리지는 않음). 다이빙·슬라이딩 최대 19cm, 투구·송구 6~7cm 묻히던 것 해결. 전 클립 발바닥 ±2.4cm.
- **접지 그림자**: 선수마다 발밑 원형 그림자(공용 재질 1개) — 먼 선수 실시간 그림자를 끈 뒤 '붕 뜬' 느낌 보완. main.js 가 타자 메시 transparent 를 끄는 코드가 있어서 그림자 재질은 항상 투명으로 고정.
- 테스트: three r160(GitHub 스파스 클론) + /opt 의 chromium 으로 dist/solo.html 에 새 캐릭터를 주입해 가상 시계로 3타석·스윙 프레임 캡처(스크립트는 리포 밖).

### 11-19 장비 4개 + 선수 뜸 수정 (rb-model)
- **장비 GLB 적용**: 총괄이 줄인 Tripo 장비(`bat` 3천 면, `glove` 1만 면, `helmet` 3천 면, `cap` 3천 면, 텍스처 포함)를 `assets-src/models/` 와 `public/assets/models/` 에 넣음 → 로더가 자동으로 대체 장비 대신 사용(콘솔·animlab '장비 GLB: cap✓ helmet✓ bat✓ glove✓').
  - 모자·헬멧: Tripo 모델은 폭 대비 깊이가 얕아서 폭으로만 키우면 앞머리가 뚫고 나왔음 → `FIT.*.stretch`(축별 배율) 추가. cap `width 1.08, stretch [1,0.93,1.1]`, helmet `width 1.27, stretch [1,0.87,1.13]`. 헬멧 귀가리개는 왼쪽(+x) = 우타자가 투수 쪽 귀 → 그대로 맞음.
  - **모자 밑 머리 누르기**: 몸 셰이더가 눈썹 높이(머리 높이 58%) 위에서 머리 타원체(눈썹 단면 폭·깊이, 정수리) 밖 정점을 타원체 ×0.95 표면으로 눌러 넣음(`BODY.hatBrow/hatSquash`, loader `headE`). 모자·헬멧·포수 마스크 모두 머리카락 안 뚫음. 비용: 정점 셰이더에 분기 1개.
  - 글러브: 모델이 주머니 +y·손가락 -z·웹/엄지 +x(오른손 끼는 배치) → `mirror: true`(x 뒤집기) + `rot [180,-90,0]`, `anchor [-1,1,0]`(손목 끝·손등 면), `pos [-0.035,0.045,0]`, `fit 0.29`. 손이 글러브 안에 들어감, 손등 쪽이 바깥.
  - 배트: 축·손잡이 자동 판정 그대로 맞음(오른손 그립, 손잡이 끝 손 아래).
  - 팀 색: 모자·헬멧은 흰색 모델이라 `tint 'all'` 로 팀 색이 고르게 입혀짐(챙 포함). 글러브는 갈색 그대로, 배트는 나무색.
- **'투수가 공중에 떠 있다'**: 경기장 마운드 지오메트리(LatheGeometry)의 단면 점 순서가 가운데→바깥이라 면·노멀이 아래를 향함 → 위에서 보면 뒷면이라 잘려 **마운드 윗면이 안 그려졌음**(평평한 흙 그림 + 먼 쪽 안쪽 경사만 검은 띠). 타자 시점에선 투수 발 뒤로 검은 언덕선이 보여 떠 보임. `client/stadium/field.js` 단면 순서를 뒤집어 고침(stadium 파일, `[model]` 태그).
  - 마운드가 실제로 보이게 되자 투수(y=0)가 25.9cm 파묻힘 → `groundY(x,z)`(field.js, 같은 단면 `MOUND_PROFILE`)로 `main.js place()` 가 선수 루트 높이를 땅 높이에 맞춤. 투수 발바닥 = 마운드 +0.7~2.9cm.
  - 투수판 위치: pitch 클립 세트 자세의 축발 끝이 엉덩이 0.36m 뒤라 투수판 뒤에 서 있었음 → 투구 자세에서 몸을 앞으로 `BODY.pitchFwd 0.5m`(ClipAnimator, 수비하러 뛰면 0). 덤으로 릴리스 순간 오른손이 (0.26, 1.86, 17.27) → sim `RELEASE (0.45, 1.85, 17.0)` 와 0.3m 이내(전엔 높이 0.26m 낮고 0.5m 뒤).
- **'타자가 떠 보인다'**: 발바닥 높이는 정상(전 선수 −0.6~+1.1cm, 포수 앉은 자세 −0.4cm)이었고, 원인은 접지 그림자. 엉덩이 밑 지름 0.95m 원에 가운데 농도 34%라 신발 밑이 비어 보였음 → **두 발을 덮는 타원**(발 사이 가운데, 발→발 방향 길이 = 발 간격+0.5m, 폭 0.5m, 가운데 56%)으로. 점프하면 작아지고, 다이빙·슬라이딩은 몸통 밑 큰 타원.
- 확인: `node tools/qa/shots.mjs [--lab] [--tag=이름]` — 진짜 크롬(SwiftShader)으로 타자 시점·중계·옆·마운드·포수 근접·animlab 장비 확대를 렌더해 `tools/qa/.out/shot-*.png` 로 저장 + 선수별 발바닥(스킨 정점 최저점) − 땅 높이, 릴리스 순간 투수 손 위치 출력.
- 남은 것: `batStance`(Baseball_Idle)가 배트를 아래로 든 대기 자세라 투구 전엔 타격 자세가 아님(로드 시작부터 자세 잡음) — 원하면 다른 클립.

### 렉 줄이기 (11-18 배포 후 '렉 심함' 피드백)
- 선수 재질 단면(FrontSide): Tripo 원본이 양면이라 뒷면까지 그리던 것 제거.
- 먼 선수(26m+, 저폴리): 노멀·거칠기 맵 없는 가벼운 재질 + 그림자 안 그림. 유니폼 색 uniform 은 공유(데칼 텍스처도 선수당 1장으로).
- 블룸 후처리는 그래픽 '높음'에서만(`client/stadium/look.js`, [perf] 태그). '중간'(기본)은 4x MSAA HalfFloat 후처리 버퍼 + 블룸 5단계를 건너뛰고 바로 그림 → 밤 경기 조명 번짐이 약해짐. 원하면 설정에서 '높음'.
- 실측은 맥에서: 오른쪽 위 fps (전/후 비교). 그래도 낮으면 다음 후보 = 리플레이 매 프레임 기록 할당, 선수 그림자 전부 끄기, 몸 삼각형 더 줄이기.

### 11-22 [motion] 받은 Mixamo 23개 전부 상황별로 (rb-motion)
변환은 그대로 `python3 tools/mixamo-retarget.py <클립>` (Blender 필요 없음). 새 클립 8개 + buntStance 재변환, 모두 늦게 받음(EARLY 아님, +0.9MB).

| FBX | 전 | 후 (클립 · 쓰는 곳) |
|---|---|---|
| Baseball_Idle / Idle_1 / Idle_2 | batStance/2/3 (타자 해시) | 같음 + 타자별 템포 0.85~1.15 (Idle_1·Idle_2 는 원본 동작이 같음) |
| Baseball_Step_In | batStepIn — 인트로 컷씬 때만, 제자리 | 타자 바뀔 때 45%, 루트 이동 살림(anchor:end → 끝 자세 = 타석) |
| Baseball_Walk_In | 없음 | batWalkIn: 타자 바뀔 때 55%(1.3배속, 3.7초) |
| Baseball_Hit | swing (모든 스윙) | 정타(good·perfect)·이른 타이밍 |
| Baseball_Hit_1 | powerSwing — **재생 안 됐음**(main.js 가 power 를 안 넘김) | 강타 모드(director 가 swing/localSwing 의 mode 로) |
| Baseball_Hit_2 | 없음 | swing2(0~1.36): 늦은 타이밍·빗맞음(ok·weak·tip), 나머지는 타자 버릇 |
| Baseball_Bunt | buntStance (1.2초 정지) | 0.3~1.22 돌아서기 후 마지막 자세 유지 |
| Baseball_Strike | 없음 | batStrike(1.75~): 헛스윙 삼진 반응(60%) / 헛스윙 40% |
| Baseball_Walk_Out | 없음 | batWalkOut: 삼진 뒤(anchor:start) — 다음 타자 Walk_In 과 이어짐 |
| Defeated | disappointed — **재생 안 됐음** | 삼진(루킹 50%·헛스윙 40%), 홈런 맞은 투수, 경기 끝·끝내기 진 팀 |
| Victory | celebrate (주자 cheer·끝내기) | + 삼진 잡은 투수 주먹(이닝 끝 삼진 항상, 그 외 45%), 경기 끝 이긴 팀(동작 구간 0.9초~부터) |
| Baseball_Pitching_1 | pitch | 주자 없을 때 기본(투수 70%) |
| Baseball_Pitching | throw(일부) | + pitch2(0~3.4): 주자 있으면 세트 포지션, 투수 버릇 30%. hold 마커 1.12 수동 |
| Baseball_Catcher | catcherSquat | + catcherThrow(4.3~6.6, 포수 송구·공 돌려주기), catcherPop(2.4~4.5, 뜬공 잡은 뒤) |
| Baseball_Umpire | umpireCall — 0.9초에 끊겨 콜 앞부분만 | 콜 0.45초~ 끝까지, 삼진 콜 0.85배속, 투구 중 무릎 짚은 자세(같은 클립 0.22초 정지 = 추가 메모리 0), 루심 아웃 콜 |
| Baseball_Milling_Idle | 없음 | mill(2.27~7.07): 야수·코치 서 있을 때 가끔 한 번(선수마다 빈도·시작 다름). 주자는 안 함 |
| Breathing_Idle·Goalkeeper_Idle·Fast_Run·Diving_Save·Running_Slide | idle·ready·run/sprint·dive·slide | 같음. 반복 클립은 시작 위치를 선수마다 무작위(18명 같은 박자 숨쉬기 방지) |

- **director.js**: bus 이벤트(windup·swing·localSwing·contact·miss·strikeCall·out·hr·score·catch·gameEnd·modeChange)를 고정 객체에 기록 → ClipAnimator 가 읽음. 구독만, 판정 안 건드림, 매 프레임 할당 없음.
- **한 번 재생(shot)·차례(seq)**: 입장·삼진 반응→Walk_Out·주먹·고개 숙임. 새 windup 이 오면 즉시 끊고 대기 자세로 크로스페이드(0.35s).
- **타이밍**: 스윙 컨택 마커를 '오른손 속도 최대'(배트가 아직 포수 쪽으로 누운 순간) → '배트 수평 방향이 투구 선에 수직이 되는 순간'으로(loader autoMarkers, swing 1.333→1.396, powerSwing 1.45→1.413, swing2 1.085). main.js 가 swingK 0.5 = sim 스윙 시각으로 주므로 화면 배트가 공 위치를 지나는 프레임 = 타격 순간. 투구 변주는 timing.js 시간표 그대로(릴리스 = windup.at+1.85s, 스크린샷: pitch@1.63·pitch2@2.11 = 각 release 마커). 포수 송구 release 0.867 = throwK 0.55.
- **구종으로 투구 동작을 고르지 않음**(와인드업 모양으로 구종이 보이면 미리보기와 같음).
- **net 예측(client/net/predict.js)**: 내 투구는 누른 순간 시작 → 서버 windup(주자 정보)이 세트 자세(0.35s) 안에 오면 변주를 다시 고름. 송구·점프·다이빙 예측은 같은 throwK·jumpK·diveK 경로라 그대로.
- main.js [motion]: 맞힌 순간 타자가 주자로 바뀌어 스윙이 컨택 프레임에서 끊기던 것 → 0.34초 팔로스루까지 타자 표시, 그동안 홈의 주자·떨어진 배트 숨김.
- 메모리: 원본 애니메이션(e.src)은 `?animlab` 에서만 보관 → 게임 클립 메모리 약 절반. 프레임 비용 같음(game-real 90초 seed 5: 렌더 끔 0.78→0.71ms, 렌더 1.24→1.18ms/프레임, main 대비).
- 확인 도구: `node tools/qa/clipsheet.mjs <클립> [--marks] [--view=top|front|side|back]` (클립 한 장 보기, 축 표시) · `node tools/qa/motionshots.mjs` (CPU 경기 돌리며 상황별 장면 → `tools/qa/.out/motion-*.png`).
- 남은 것: 세이프 콜 클립 없음(umpireSafe → 대기), catchHigh/catchLow 없음(IK), 이닝 교대 때 수비 팀이 뛰어 들어가는 동작 없음.

## 1. 구조

| 파일 | 하는 일 |
|---|---|
| `client/anim/character.js` | `Character` (REBUILD 4-3): `play(clip,{fade,speed,loop})` `scrub(clip,t)` `scrubK(clip,k)` `scrubPitch(tau)` `setUniform(colors)` `attach(slot,mesh)` `reach(side,pos)` `look(pos)` `update(dt)` `snapshot()/restore()` |
| `client/anim/loader.js` | GLB 읽기 → 모든 선수가 공유하는 라이브러리(템플릿·클립·장비) |
| `client/anim/clips.js` | 파일 이름, 클립 ↔ 파일, 클립 규칙(loop·제자리·trim·yaw·마커), 장비 맞춤값. `manifest.json`으로 덮어쓰기 가능 |
| `client/anim/timing.js` | 투구 시간표(events.md) ↔ 클립 마커 |
| `client/anim/actor.js` | main.js `mkActor` 대신 쓰는 것. GLB가 있으면 새 캐릭터, 없으면 옛 몸. 옛 `Animator` 호출(fielder/pitcher/batter/…)을 클립으로 바꿔 줌 |
| `client/anim/lab.js` | `?animlab` 맞춤 화면 |
| `tools/fbx2glb.py` | Blender로 FBX → GLB 일괄 변환 |
| `tools/glb-info.mjs` | 넣은 파일 점검(`node tools/glb-info.mjs`) |
| `tools/glb-lod.mjs` | 저폴리 인덱스 생성(빌드 때 자동) |

### 자동 전환 규칙
- 시작할 때 `public/assets/models/player.glb`가 있는지 HEAD로 확인 → 있고 **필수 클립(idle, run, batStance, swing, pitch)** 이 다 있으면 새 캐릭터. 하나라도 없으면 콘솔 경고 후 옛 몸.
- 새 GLB가 늦게 도착하면 이미 만든 선수(심판 등)도 그 자리에서 새 캐릭터로 교체.
- 강제: `?legacy` 또는 `?noskin` = 옛 몸. 혼자하기 단일 HTML(`dist/solo.html`)은 지금은 옛 몸(나중에 build.mjs에서 GLB 인라인 가능).
- 없는 클립은 대체 사슬로 이어짐(예: `sprint→run`, `catcherSquat→ready→idle`) → 일부만 받아도 게임이 깨지지 않음.
- 없는 장비 GLB는 머리·손 크기에 맞춘 단순 장비로 대신함.

### 성능(18명 동시)
- 지오메트리·텍스처·클립·셰이더 프로그램 공유(`SkeletonUtils.clone`). 선수마다 다른 건 머티리얼 유니폼 값(팀 색·번호)뿐.
- 화면 밖 선수: 6프레임에 한 번, 26m 넘게 먼 선수: 2프레임에 한 번 애니메이션 갱신(시간은 모아서) + 선수마다 갱신 프레임을 흩뜨림.
- 먼 선수는 저폴리 인덱스(같은 정점 버퍼, 삼각형 30%)로 그림 — CI 빌드가 `player.lod.bin` 생성.
- 스킨 메시는 고정 경계구로 일반 절두체 컬링(그림자 패스 포함).
- 클립 트랙 정리: 스케일·Hips 외 위치 트랙 제거, `clip.optimize()`.
- 리플레이: 새 캐릭터는 관절 대신 클립 상태(클립·시각·가중치)+IK 뼈 6개만 기록.
- **실제 fps는 모델이 들어온 뒤 맥에서 측정 필요**(오른쪽 위 fps, 옛 몸과 비교). 몸 삼각형 3만 이하 권장.

## 2. 투구 시간표 (events.md와 합의)
- `windup` 이벤트의 `set/kick/peak/dur`(at 기준 0.35/1.25/1.45/1.85s)을 `timing.js PITCH_TL`에 반영(`lift/peak/hold/release`).
- 투구 클립 마커 `set, lift, peak, release, end`(클립 초)를 구간마다 늘이고 줄여 맞춤: 세트 0~0.35 → 레그킥 → **정점 멈춤 1.25~1.45(정점 프레임 고정)** → 스트라이드 → **릴리스 = windup.at + 1.85s** → 팔로스루는 자연 속도.
- 마커는 로딩 때 자동 추정(오른손 속도 최대 = 릴리스, 왼발 최고점 = 레그킥 정점). 틀리면 `?animlab`에서 고쳐 manifest에.
- 현재 main.js는 `pitchK(tau)`를 넘김 → `tauFromPitchK`로 되돌려 사용(같은 시간표, 테스트로 확인). 나중에 `c.tau`(windup부터 초)를 넘기면 그걸 우선.
- 같은 방식(진행도 k → 마커): swing(0.5 = 컨택), throw(0.55 = 릴리스), dive(1 = 0.55s), slide(1 = 0.6s), catchHigh/catchLow.
- dive·slide·throw·catch 는 main.js가 스냅샷 상태(`dv`, 슬라이드 플래그, throwT)로 이미 진행도를 주므로 그걸로 재생(bus 이벤트로 또 틀면 이중 시작이라 쓰지 않음). 포구는 글러브 IK(`reach`).
- 화면 모션 시작 신호: `cue:swing {power,bunt}`, `cue:dive {x,z}`, `cue:slide {x,z}` (서버 이벤트와 이름 안 겹침). 옛 몸·새 몸 둘 다 보냄.

## 3. 사용자가 할 일

### 3-1. 몸 (Tripo → Mixamo → Blender)
1. Tripo에서 몸을 **FBX**로 받기(T포즈, 텍스처 포함).
2. mixamo.com → Upload Character → 그 FBX → 턱·손목·팔꿈치·무릎·사타구니 점 찍기 → Skeleton LOD는 **Standard Skeleton(65)** → Next.
3. 오른쪽 위 Download: Format **FBX Binary(.fbx)**, Skin **With Skin**, Pose **T-pose** → `assets-src/models/player.fbx` 로 저장.
4. **애니메이션은 반드시 이 캐릭터를 올린 상태에서** 받기(다른 캐릭터로 받으면 뼈 길이가 달라 어긋남).

### 3-2. 장비 (모자·헬멧·배트·글러브)
- Tripo에서 **GLB로 바로** 받아 `assets-src/models/cap.glb`, `helmet.glb`, `bat.glb`, `glove.glb` (FBX면 `.fbx`로 같은 이름). 리깅 필요 없음.
- 방향: 모자·헬멧은 위가 위, 챙이 앞(+z) / 글러브는 손가락이 위, 주머니가 앞이면 기본값 그대로 맞음. 아니면 `?animlab`에서 회전만 고치면 됨.
- 크기는 신경 안 써도 됨(머리 폭·배트 0.86m·글러브 0.3m로 자동).
- 모자·헬멧 색은 팀 색으로 다시 칠함(흰색·회색으로 만들면 제일 깔끔).

### 3-3. Mixamo 애니메이션 목록
공통 설정: **Format FBX Binary · Skin Without Skin · Frames per Second 30 · Keyframe Reduction none**. 'In Place' 체크박스가 보이면 **체크**. 받은 파일을 아래 이름 그대로(대소문자 포함) `assets-src/mixamo/`에.
Mixamo 이름은 검색 후보다 — 미리보기를 보고 가장 자연스러운(남자 선수다운) 것을 고르고, 팔이 몸을 뚫으면 **Character Arm-Space**를 올린다.

| 파일 이름 | 쓰는 곳 | Mixamo 검색 1순위 | 대안 | In Place | Trim·메모 |
|---|---|---|---|---|---|
| `idle.fbx` ★ | 서 있기(야수·코치·주자) | Breathing Idle | Idle, Standing Idle | - | 반복 |
| `ready.fbx` | 수비 준비 자세·주자 리드·주심 | Goalkeeper Idle | Baseball Idle(수비 자세면) | - | 무릎 굽힌 준비 자세, 반복 |
| `run.fbx` ★ | 달리기 | Running | Jog Forward | **체크** | 반복 |
| `sprint.fbx` | 전력질주 | Fast Run | Sprint | **체크** | 반복 |
| `batStance.fbx` ★ | 타석 대기 | Baseball Idle | (없으면 Baseball Hit 를 Trim 0~10%로) | - | 배트 쥔 자세인지 확인 |
| `swing.fbx` ★ | 스윙 | Baseball Hit | - | - | 스탠스→스윙→팔로스루 전체 |
| `powerSwing.fbx` | 강타(선택) | Baseball Hit 다른 변형 | 없으면 생략(swing 사용) | - | |
| `buntStance.fbx` | 번트 | Baseball Bunt | - | - | |
| `pitch.fbx` ★ | 투구 | Baseball Pitching | - | (없음) | 세트→레그킥→릴리스→마무리. 앞쪽 대기 구간이 길면 Trim으로 잘라도 됨 |
| `throw.fbx` | 야수 송구 | Throw | Goalkeeper Overhand Throw, Throwing | - | 오버핸드 |
| `catchHigh.fbx` | 점프·높은 공 포구 | Goalkeeper Catch | Jump Catch | 체크(있으면) | |
| `catchLow.fbx` | 땅볼 처리 | Goalkeeper Scoop | Pick Up | 체크(있으면) | |
| `dive.fbx` | 다이빙 캐치 | Goalkeeper Diving Save | Dive | **체크**(있으면) | 옆으로 몸 날리기 |
| `slide.fbx` | 슬라이딩 | Running Slide | Baseball Slide, Slide | **체크**(있으면) | 발부터 |
| `catcherSquat.fbx` | 포수 앉은 자세 | Baseball Catcher | Squat Idle | - | 반복 |
| `celebrate.fbx` | 끝내기·홈런 세리머니 | Victory | Cheering, Fist Pump | - | |
| `disappointed.fbx` | 패배·삼진 | Defeated | Disappointed, Sad Idle | - | |
| `umpireCall.fbx` | 스트라이크·아웃 콜 | Baseball Umpire | Baseball Strike | - | |
| `umpireSafe.fbx` | 세이프 콜(선택) | Safe | Baseball Umpire 변형 | - | 없으면 생략 |

★ = 필수(이 5개가 있어야 새 캐릭터로 바뀜).

### 3-4. FBX → GLB 변환 (Blender, 한 번 설치)
1. blender.org 에서 Blender(4.x) 설치.
2. 터미널에서 저장소 폴더로 가서:
   ```
   /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/fbx2glb.py -- all
   ```
   → `assets-src/models/*` → `public/assets/models/*.glb`, `assets-src/mixamo/*.fbx` → `public/assets/models/anim/*.glb`. 바뀐 파일만 다시 변환(`-- all --force`면 전부).
3. 점검: `node tools/glb-info.mjs` (빠진 클립·크기·뼈 이름 확인).
4. `npm run check` → commit → push. (`?animlab`을 주소 뒤에 붙이면 맞춤 화면)

Blender를 손으로 할 때 설정(스크립트와 같음): Import FBX — Armature: *Automatic Bone Orientation 끔*, *Ignore Leaf Bones 켬* / Export glTF 2.0 — Format **glTF Binary (.glb)**, +Y Up 켬, Mesh: UV·Normals, Skinning 켬, Shape Keys 끔, **Compression(Draco) 끔**, Images **JPEG**, Animation: 애니메이션 파일만 켬(Always Sample, 1프레임마다, Optimize Animation Size 켬), 몸 파일은 Animation 끔. 텍스처는 1024px로.

### 3-5. 파일 위치 (확정)
```
assets-src/models/player.fbx           ← Mixamo 리깅 몸(원본, 커밋)
assets-src/models/cap|helmet|bat|glove.glb|fbx   ← Tripo 원본
assets-src/mixamo/<클립이름>.fbx       ← Mixamo 애니메이션 원본
public/assets/models/player.glb        ← 변환 결과(게임이 읽음)
public/assets/models/cap|helmet|bat|glove.glb
public/assets/models/anim/<클립이름>.glb
public/assets/models/manifest.json     ← (선택) ?animlab 에서 맞춘 값
public/assets/models/player.lod.bin    ← (자동) 빌드가 만듦
```
원본 FBX가 개당 50MB를 넘으면 커밋하지 말고 맥에만 둬도 됨(게임은 public/ 의 GLB만 씀).

## 4. 메시 압축 검토
- 런타임은 준비됨: GLTFLoader에 `MeshoptDecoder`(three addons, CDN) 연결 → `EXT_meshopt_compression` GLB를 그대로 읽음. Draco는 디코더 wasm이 따로 필요해서 안 씀.
- 압축 도구 `gltfpack`은 devDependencies에 없음 → 쓰려면 `npm i -D gltfpack`(package-lock 갱신, 총괄 결정) 후 `npx gltfpack -i in.glb -o out.glb -cc`(지오메트리·애니메이션만, 텍스처는 JPEG 유지). 예상 효과: 메시·애니메이션 바이트 약 1/3~1/5. **LOD는 압축 전 파일로 만들어야 함**(glb-lod는 압축 파일을 건너뜀) → 순서: 변환 → LOD → 압축.
- 지금은 압축 없이 시작 권장: 클립 18개×(30fps, 65뼈) ≈ 개당 100~300KB, 몸 2~5MB 예상. 실제 크기는 `glb-info`로 확인 후 결정.
- 대안(제안): CI에서 Blender 변환까지 — ubuntu에 `apt-get install blender` 후 `fbx2glb.py all` 실행하면 사용자는 FBX만 push하면 됨(워크플로 파일은 총괄 소유라 제안만).

## 5. 모델 들어온 뒤 확인할 것(사용자 맥)
1. 주소 뒤 `?animlab` → 모자·헬멧이 머리에 딱 맞는지, 글러브·배트 방향, 투구 시간표 재생(정점 멈춤·릴리스 1.85s)
2. 유니폼 색: 원정(팀 색 상의) 선수에서 얼굴·손에 색이 번지지 않는지 → '유니폼 색 판정' 값 조정
3. 경기에서 fps(옛 몸 대비), 18명 모두 보이는 수비 화면
4. 조정값은 [JSON 복사] → `public/assets/models/manifest.json`

## 6. 남은 일 / 한계
- 얼굴·피부색이 모든 선수 같음(같은 모델). 다양화가 필요하면 Tripo로 머리 2~3종 → 추후.
- 타자 높낮이 공 맞춤(스윙 자세를 공 높이로 기울이기)은 아직 없음 — 배트 위치는 클립 그대로.
- 등번호 투영 영역(`BODY.decal`)은 모델 비율 보고 조정 필요.
