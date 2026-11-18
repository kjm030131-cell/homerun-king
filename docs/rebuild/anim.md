# anim 파트 — 모델·애니메이션 (rb-anim)

> 2026-11-18. 새 몸(Tripo → Mixamo)을 쓰는 `Character` + 파일 파이프라인. **새 파일이 들어오기 전까지 게임은 지금 몸(body.bin)으로 그대로 돈다.**

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
