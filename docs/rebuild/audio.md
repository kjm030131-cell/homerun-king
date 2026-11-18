# 사운드 파트 (rb-audio)

> 2026-11-18 · 사운드 전면 교체 1차. 합성음만으로도 전부 동작하고, `public/assets/sfx/`에 파일을 넣으면 그 소리로 바뀐다.

## 1. 구조

```
client/audio/index.js   사운드 매니저 — bus 이벤트 구독, 관중·캐스터 연결, 볼륨 UI   (main.js 는 initAudio() 만 부름)
client/audio/engine.js  AudioContext·첫 클릭 해제·볼륨 그룹(마스터/효과/관중/캐스터)·구장 잔향·동시 발음 제한·거리감
client/audio/synth.js   효과음 레시피(타격·포구·송구·슬라이딩·심판·오르간·불꽃…) — 샘플 있으면 샘플, 없으면 합성
client/audio/crowd.js   관중: 계속 도는 층 4개(웅성임/함성/탄식/박수) + 상황 반응, 리얼/캐주얼 톤
client/audio/caster.js  캐스터 대사 풀(상황 조건 포함) + 브라우저 TTS
client/audio/samples.js 샘플 슬롯 목록·로더 (public/assets/sfx/index.json — 빌드가 만듦)
client/audio.js         호환용 껍데기: 예전 sfx.* 호출 → bus 이벤트. 새 코드에서 쓰지 말 것
```

- 다른 파트는 **`bus.emit(이벤트, 데이터)`만** 한다. `sfx`를 직접 부르지 않는다.
- 사운드는 이벤트를 듣기만 하고 게임 상태를 바꾸지 않는다. 내보내는 건 `caster:line {text, pri}`(자막용) 하나.

## 2. 이벤트 (2026-11-18 통합 후)

**기준은 서버 이벤트**(sim → 스냅샷 `ev` → main.js `case 's'`에서 `bus.emit`, 필드는 `docs/rebuild/events.md`). 화면 시각에 맞춰야 하는 소리만 클라 신호로 내고, 같은 순간의 서버 이벤트는 걸러서 **한 번만** 난다.

### 클라 신호 (화면 타이밍)
| 이벤트 | 누가 | 소리 | 같은 순간 서버 이벤트 처리 |
|---|---|---|---|
| `localSwing {pid,mode,contact,q}` | main.js doSwing (gameplay) | 내 스윙 즉시 타격음 / 헛스윙 공기음 | 같은 `pid`의 서버 `contact`는 타격음 없이 관중 반응만 실제 속도·각도로 보정 |
| `cue:mitt {pid,kmh}` | main.js (공이 화면에서 미트에 닿는 순간) | 포수 미트 '팡' | 1.5초 안의 서버 `catch{pitch:1}` 무시 (서버 catch 에 pid 가 없어 시각으로) |
| `cue:swing {pid?,power,bunt}` | main.js + anim | 배트 바람소리 | 서버 `swing`/`miss`는 소리 안 냄. main·anim 둘 다 와도 같은 소리 0.15초 간격 제한으로 한 번 |
| `cue:release {pid}` | main.js (타자일 때 릴리스 순간) | '온다' 신호음 | 서버 `release`는 소리 안 냄 |
| `cue:slide {rid?,x,z}` | main.js + anim | 흙 슬라이딩 | 서버 `slide`는 위치가 없어 소리 안 냄. 0.3초 간격 제한 |
| `cue:dive {x,z}` | anim | 다이빙 쿵 | 서버 `dive`는 0.25초 기다렸다가 0.6초 안에 cue:dive 가 없었을 때만 |
| `cue:bounce {x,z,impact,surf}` | main.js (클라 공 물리) | 바운드 | 서버엔 없음 |

### 서버 이벤트 → 소리
`windup`(b·s·o·on·sc → 관중 숨죽임, 상황 멘트) · `contact`(grade → 타격음 종류, ev·la → 관중 기대치) · `foul` · `ballCall`(walk 박수, hbp '오~') · `strikeCall`(looking 콜, k 삼진 콜+환호) · `catch`(글러브, robbed/다이빙 뜬공 환호) · `throw`(from 위치 바람소리) · `tag` · `out`(force·tag·pick·cs 만 누심 "아웃!", dp≥2 환호, 큰 뜬공 잡히면 탄식) · `safe`(close·steal·pick 만 "세이프!") · `hit`(루타별 환호) · `error`(탄식) · `hr`(폭발+오르간+불꽃) · `score`(go·tie 크게, walkoff 폭발, 홈런 직후는 생략) · `wall` · `steal` · `wildPitch` · `inningStart`(이닝 기억, 가끔 오르간) · `inningEnd`(박수) · `gameEnd` · `modeChange`(rules 톤, mode·innings 기억) · **`batterUp`(id 가 내 id 면 등장 오르간)**.

### UI 이벤트
`ui:screen {name}`(게임 화면이면 관중 켬) · `ui:click` · `ui:perfect` · `ui:volume {master,sfx,crowd,cast}`(0~1) · `ui:me {id}`(main.js 가 내 id 알려 줌 → batterUp 판단) · `ui:msg {text,s}`(배너 문구 → 캐스터). 내보내는 것: `caster:line {text,pri}` → UI 가 자막.

### main.js 연결 (`// [audio]` 태그)
- 지운 것: 서버 이벤트를 흉내 내던 emit 전부(windup, hr, throw, catch, held catch, contact 2곳, out/safe 판정, wall, gameEnd, miss) + 배너 문구 → 이벤트 정규식 변환. 배너 블록엔 화면 연출(excite·축하)만 남김.
- 남긴 것: `cue:swing`, `cue:slide`, `cue:mitt`, `cue:bounce`, `cue:release`, `ui:perfect`, `ui:click`(게이지 시작), `ui:msg`, `ui:me`, `initAudio()`.
- ui ctx 의 `sound()`는 빈 함수(오르간은 사운드가 `batterUp`으로 냄).

## 3. 소리 설계

### 타격음 (제일 중요)
종류는 q(맞은 질)와 타구 속도로 고른다. 내 스윙은 서버 응답을 기다리지 않고 즉시 소리를 내고(q로 속도 추정), 서버 값(`s.lh`)이 오면 관중 반응만 고친다.

| 종류 | 조건 | 느낌 |
|---|---|---|
| `barrel` 홈런성 | q ≥ 0.85, 또는 속도 ≥ 168km/h·q ≥ 0.65 | 날카로운 '딱!' + 저음 쿵 + 맑게 남는 울림 + 관중석 메아리 2번 |
| `solid` 정타 | q 0.55~0.85 | '따악' 나무 공명, 메아리 1번 |
| `weak` 빗맞음 | q 0.3~0.55 | 둔한 '툭' |
| `jam` 먹힘 | q 0.12~0.3 | '퍽' + 손 울리는 '징' |
| `tip` 파울팁 | q < 0.12 | 스치는 '틱' + 뒤로 튀는 바람소리 |
| `bunt` | 번트 | 부드러운 '톡' |

같은 종류 안에서도 속도·q에 따라 밝기·크기·공명 길이가 연속으로 변한다. 캐주얼 모드는 홈런성에 밝은 '잉' 한 겹 추가.

### 관중
- 층 4개가 계속 루프(새 노드를 안 만들어 가벼움): 웅성임(말소리 합성 + 핑크노이즈 좌우), 함성, 탄식/'오~'(모음처럼 필터 이동), 박수.
- 흐름: 투구 전 긴장도만큼 숨죽임 → 타구 순간 기대치만큼 함성이 차오름 → 결과(홈런 폭발 / 잡히면 '아~' 탄식 뒤 박수 / 안타 환호 / 파울 '오~') → 결과가 안 오면 3.5초 뒤 저절로 가라앉음.
- 긴장도: 2스트라이크·3볼·득점권·만루·2아웃 주자·후반 1점차. 0.55 넘으면 투구 사이 "짝짝 짝짝짝" 응원 박수 + 북(다음 투구에서 멈춤).
- 공간감: 관중은 고역을 깎고 잔향을 많이. 구장 잔향 IR(초기 반사 6개 + 2.4초 꼬리). 야수 포구·송구·슬라이딩은 카메라와의 거리로 감쇠·고역 감소·음속 지연(외야 포구가 실제처럼 살짝 늦게)·좌우 패닝.
- 리얼(기본): 투구 때 조용, 큰 순간에 터짐. 캐주얼: 늘 시끌, 반응 1.3배, 응원 박수 자주. `modeChange {rules}`로 전환.

### 캐스터
- 대사 풀 108줄(이전 40줄, 결과 멘트 97 + 투구 전 상황 멘트 11): 홈런(거리 넣기), 만루·끝내기·강탈·병살·삼중살·장타·빠른 타구 안타(160km/h↑ 속도 넣기)·견제·도루·삼진 종류별·밀어내기·사구·폭투·실책·희생·다이빙·동점/역전·이닝 시작(후반 접전 별도)·경기 종료 + **투구 직전 상황 멘트**(만루, 2아웃 만루, 풀카운트, 후반 득점권, 2스트라이크 — 25초 쿨다운).
- 브라우저 TTS 유지 + 개선: 한국어 목소리 직접 고름(맥 'Yuna' 우선 — 로컬이라 지연 없음), 큰 장면은 하던 말을 끊고 작은 멘트는 말하는 중이면 건너뜀, 큰 장면일수록 빠르고 높게, 말하는 동안 관중 0.6배로 낮춤, 캐스터 음량 따로.
- 판단: TTS는 '기계 목소리' 한계가 있어서 기본값은 지금처럼 자막. 진짜 중계 느낌을 원하면 다음 단계로 ElevenLabs TTS로 대사를 미리 녹음해 샘플로 쓰는 걸 제안(대사 풀이 고정이라 가능).

### 설정·성능
- 볼륨 4개: 전체 `vol`, 효과음 `volSfx`, 관중 `volCrowd`, 캐스터 `volCast` (localStorage `hr_*`). 슬라이더는 ui 파트 설정 화면, 바뀌면 `ui:volume`을 받아 적용.
- 첫 클릭/키 입력에서 AudioContext 해제(크롬·사파리 정책), 탭 복귀 시 재개.
- 동시 발음 28개 상한(넘치면 우선순위 낮고 오래된 소리부터 끊음, 타격음이 최우선). 같은 소리 최소 간격(바운드 50ms, 포구 90ms…).
- 노이즈 버퍼는 시작 때 한 번만 만든다(예전엔 소리마다 새 버퍼). 관중 말소리 버퍼는 첫 클릭 직후 한 번 생성.
- 마스터 리미터로 큰 장면에서 소리 깨짐 방지.
- 디버그: 콘솔 `__audio.stats`(현재/최대 발음 수, 버린 수), `__audio.sampleInfo`(읽은 샘플 수).

## 4. 샘플 파일 (사용자가 만들 것)

**넣는 법**: `public/assets/sfx/이름.mp3`(또는 `.ogg`). 같은 소리 여러 개는 `이름_2.mp3`, `이름_3.mp3` → 랜덤 재생. 없는 이름은 합성음. 루프 표시된 것은 앞뒤가 자연스럽게 이어지게(생성기에 루프 옵션이 있으면 켜기).
**ElevenLabs Sound Effects 팁**: 길이(Duration)를 아래 값으로 직접 지정, Prompt influence 0.6~0.7. 0.5초보다 짧은 건 생성기 최소 길이로 만들고 앞부분만 쓰면 된다(뒤 무음은 그대로 둬도 됨). 앞에 무음이 있으면 잘라서 소리가 바로 시작되게.
**우선순위**: ★ = 먼저 만들면 체감이 가장 큰 것.

| 파일 이름 | 길이 | 완성형 프롬프트 |
|---|---|---|
| ★ `bat_barrel` | 1.2초 | Single isolated sound effect, realistic professional baseball stadium recording, no music, no voices, no announcer: a perfectly squared-up wooden maple bat hitting a fastball for a home run, an explosively loud sharp high-pitched CRACK with a solid low thump, short bright ringing tail and a faint echo off the stadium stands, starts instantly with no silence |
| ★ `bat_solid` | 0.8초 | Single isolated sound effect, realistic professional baseball stadium recording, no music, no voices, no announcer: a solid clean line-drive hit with a wooden baseball bat, crisp sharp wooden crack, tight and punchy, short natural outdoor stadium reflection, starts instantly with no silence |
| ★ `bat_weak` | 0.5초 | Single isolated sound effect, realistic professional baseball stadium recording, no music, no voices, no announcer: a weak mis-hit off the end of a wooden baseball bat, dull hollow wooden "tock", soft and muted, little resonance, starts instantly with no silence |
| `bat_jam` | 0.5초 | Single isolated sound effect, realistic professional baseball stadium recording, no music, no voices, no announcer: a baseball jammed in on the handle of a wooden bat, a dead dull thud with a short buzzing vibration of the bat, no crack, starts instantly with no silence |
| `bat_tip` | 0.3초 | Single isolated sound effect, realistic professional baseball stadium recording, no music, no voices, no announcer: a foul tip, a baseball barely grazing a wooden bat, a very short thin high "tick" followed by a quick tiny whoosh, starts instantly with no silence |
| `bat_bunt` | 0.3초 | Single isolated sound effect, realistic professional baseball stadium recording, no music, no voices, no announcer: a soft bunt, a baseball deadened against a wooden bat held still, gentle short wooden "tok", starts instantly with no silence |
| ★ `mitt_pop` | 0.4초 | Single isolated sound effect, realistic professional baseball stadium recording, no music, no voices, no announcer: a 150 km/h fastball smacking into a catcher's leather mitt, a loud deep satisfying leather POP with a snappy attack, short natural stadium reflection, starts instantly with no silence |
| `glove_catch` | 0.3초 | Single isolated sound effect, realistic professional baseball stadium recording, no music, no voices, no announcer: a baseball caught in an infielder's leather glove, a medium soft leather slap, short and clean, starts instantly with no silence |
| `throw_whoosh` | 0.4초 | Single isolated sound effect, realistic professional baseball stadium recording, no music, no voices, no announcer: a hard overhand baseball throw passing by, a quick airy whoosh of the ball through the air, no impact, starts instantly with no silence |
| `swing_whoosh` | 0.4초 | Single isolated sound effect, realistic professional baseball stadium recording, no music, no voices, no announcer: a powerful baseball bat swing cutting through the air and missing, a fast deep "whoosh", no impact, starts instantly with no silence |
| `ball_bounce_dirt` | 0.25초 | Single isolated sound effect, realistic professional baseball stadium recording, no music, no voices, no announcer: a baseball bouncing once on a packed dirt infield, a short dull thud with a tiny gritty scratch, starts instantly with no silence |
| `ball_bounce_grass` | 0.25초 | Single isolated sound effect, realistic professional baseball stadium recording, no music, no voices, no announcer: a baseball bouncing once on short outfield grass, a soft muffled thump, starts instantly with no silence |
| `wall_hit` | 0.6초 | Single isolated sound effect, realistic professional baseball stadium recording, no music, no voices, no announcer: a baseball slamming into a padded outfield wall, a heavy deep padded thud with a slight rattle of the fence behind it, starts instantly with no silence |
| `slide_dirt` | 0.9초 | Single isolated sound effect, realistic professional baseball stadium recording, no music, no voices, no announcer: a baseball player sliding feet-first into a base on dirt, a body thump followed by a rough scraping slide through loose clay dirt, starts instantly with no silence |
| `dive_thud` | 0.5초 | Single isolated sound effect, realistic professional baseball stadium recording, no music, no voices, no announcer: a baseball outfielder diving and landing on grass, a heavy body thud with a short rustle of grass and uniform fabric, starts instantly with no silence |
| ★ `ump_strike` | 0.8초 | Single isolated sound effect, realistic professional baseball stadium recording, no music, no announcer: a home plate umpire forcefully shouting a single "Strike!" in a gruff male voice, short and punchy, slight stadium echo, starts instantly with no silence |
| `ump_strike3` | 1.2초 | Single isolated sound effect, realistic professional baseball stadium recording, no music, no announcer: a home plate umpire emphatically yelling a dramatic drawn-out strikeout call "Steee-rike!" in a loud gruff male voice, slight stadium echo, starts instantly with no silence |
| `ump_out` | 0.8초 | Single isolated sound effect, realistic professional baseball stadium recording, no music, no announcer: a baseball base umpire loudly shouting a single "Out!" in a gruff male voice, short and sharp, slight stadium echo, starts instantly with no silence |
| `ump_safe` | 0.8초 | Single isolated sound effect, realistic professional baseball stadium recording, no music, no announcer: a baseball base umpire loudly shouting a single "Safe!" in a gruff male voice, short and sharp, slight stadium echo, starts instantly with no silence |
| ★ `crowd_bed` (루프) | 12초 | Seamless loop, realistic professional baseball stadium recording, no music, no announcer, no PA system: ambient murmur of a large calm baseball stadium crowd of 20,000 people heard from the field, steady distant chatter, wide stereo, no cheering, no distinct words, constant level |
| `crowd_roar` (루프) | 8초 | Seamless loop, realistic professional baseball stadium recording, no music, no announcer, no PA system: a huge excited baseball stadium crowd roaring continuously at full volume, sustained cheering and yelling, wide stereo, constant level, no distinct words |
| `crowd_applause` (루프) | 8초 | Seamless loop, realistic professional baseball stadium recording, no music, no announcer, no PA system: steady applause and clapping from a large baseball stadium crowd, wide stereo, constant level, no cheering voices |
| ★ `crowd_hr` | 7초 | Single sound effect, realistic professional baseball stadium recording, no music, no announcer, no PA system: a packed baseball stadium crowd erupting the moment a home run clears the fence, a sudden massive roar that peaks fast, whistles and screaming, then slowly settles into applause, wide stereo |
| `crowd_cheer` | 3초 | Single sound effect, realistic professional baseball stadium recording, no music, no announcer, no PA system: a large baseball crowd cheering a base hit, a quick enthusiastic burst of cheers and claps that fades out, wide stereo |
| ★ `crowd_groan` | 2.5초 | Single sound effect, realistic professional baseball stadium recording, no music, no announcer, no PA system: a large baseball stadium crowd groaning in disappointment, a collective falling "awww" sigh after a long fly ball is caught at the wall, wide stereo |
| `crowd_ooh` | 2초 | Single sound effect, realistic professional baseball stadium recording, no music, no announcer, no PA system: a large baseball stadium crowd reacting "ooooh" as a long fly ball just hooks foul, a rising then falling collective gasp, wide stereo |
| `crowd_chant` | 4초 | Single sound effect, realistic Korean KBO baseball stadium recording, no music instruments except drums, no announcer: thousands of fans clapping a rhythmic cheer pattern clap-clap, clap-clap-clap with a big bass drum, repeated three times, energetic, wide stereo |
| `organ_walkup` | 3초 | Single sound effect, classic baseball stadium pipe organ, no crowd, no voices: a short upbeat ascending organ fanfare riff played over a stadium PA with natural big stadium echo |
| `organ_charge` | 3초 | Single sound effect, classic baseball stadium pipe organ, no crowd, no voices: the famous rising "charge!" organ fanfare, bright and loud, played over a stadium PA with natural big stadium echo |
| `organ_inning` | 4초 | Single sound effect, classic baseball stadium pipe organ, no crowd, no voices: a cheerful bouncy between-innings organ jingle, played over a stadium PA with natural big stadium echo |
| `firework` | 2.5초 | Single sound effect, realistic outdoor recording, no music, no crowd: one large firework shell bursting high above a baseball stadium, a deep boom followed by crackling sparkles, heard from a distance with echo |

- 볼륨은 게임이 맞추니 파일은 적당히 크게(클리핑 없이) 만들면 된다. 너무 크거나 작으면 알려 주면 슬롯별 배율을 조정.
- 넣은 뒤 확인: 크롬 콘솔에 `__audio.sampleInfo` → `loaded` 숫자가 넣은 파일 수와 같으면 OK.
- 혼자 연습판(`dist/solo.html`, 단일 파일)은 샘플을 안 싣고 합성음만 쓴다.

## 5. 맥에서 들어볼 것
1. 타격 연습 모드에서 타이밍을 일부러 바꿔 치기: 퍼펙트(홈런성) / 정타 / 빗맞음 / 먹힘 / 파울팁 소리가 확실히 구분되는지. 강타(파워) 스윙이 더 묵직한지.
2. 큰 뜬공: 맞는 순간 함성이 차오르다가 → 넘어가면 폭발, 잡히면 '아~' 탄식 후 박수가 나오는지.
3. 강속구 포수 미트 '팡'이 체인지업보다 큰지. 외야 포구 소리가 멀리서 살짝 늦게 들리는지.
4. 만루·풀카운트에서 투구 전 관중이 조용해지고, 투구 사이 응원 박수가 나오는지.
5. 설정: 전체/효과음/관중/캐스터 음량 슬라이더가 각각 먹는지. 캐스터 '자막+음성'에서 목소리(맥은 Yuna)·말 끊김.
6. 렉: 홈런 장면에서 fps 가 예전과 같은지(콘솔 `__audio.stats.peak` 28 이하).

## 6. 다른 파트에 요청
- **ui**: `client/ui/hud.js`의 `c.sound('organ')` 두 곳 지워도 됨(사운드가 `batterUp`으로 냄, ctx.sound 는 이미 빈 함수). `client/ui/announce.js` 내장 멘트·음성은 `caster:line`이 오면 꺼지니 그대로 둬도 되고, 나중에 지워도 됨.
- **gameplay**: `catch{pitch:1}`에 `pid` 넣어 주면 미트 소리 중복을 시각 대신 pid 로 거를 수 있음. `slide`에 `x,z`(베이스 위치)도 있으면 좋음.
- **anim**: `cue:swing/slide/dive`가 들어오면 main.js 의 `cue:swing`·`cue:slide` 줄은 지워도 됨(지금은 둘 다 와도 한 번만 남).
