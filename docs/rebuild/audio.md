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

## 2. 이벤트 (REBUILD.md 4-1 이름 그대로)

데이터 필드는 gameplay가 `docs/rebuild/events.md`로 확정하기 전이라 **있으면 쓰고 없으면 기본값**. 아래 필드를 넣어 주면 소리가 좋아진다.

| 이벤트 | 사운드가 쓰는 필드 | 소리 |
|---|---|---|
| `windup` | `s`(스냅샷) 또는 `cnt, occ, sc, inn, mode` | 관중 숨죽임(긴장도만큼), 상황 멘트(만루·풀카운트…) |
| `release` | `cue` | 타자용 '온다' 신호음 |
| `swing` | `power`, `bunt` | 배트 바람소리 |
| `miss` | `local` | 내 헛스윙 공기음 |
| `contact` | `pid, q, ev(km/h), la(°), mode, bunt, foul, kmh` | 타격음 6종 + 관중 함성 차오름. 같은 `pid`가 두 번 오면 두 번째는 관중 반응만 보정 |
| `foul` | | 큰 타구였으면 '오~', 아니면 가라앉음 |
| `ballCall` | `walk` | 볼넷이면 박수. 접전이면 응원 박수 시작 |
| `strikeCall` | `k, swinging, looking` | 심판 "스트라이크!"(루킹), 삼진은 큰 콜 + 환호 |
| `catch` | `x, z, pitch, kmh, dive, jump, held` | `pitch`면 포수 미트 '팡'(구속 비례), 아니면 야수 글러브(거리감) |
| `throw` | `x, z, p` | 송구 바람소리 |
| `tag` | `x, z` | 글러브 터치 |
| `out` | `x, z, call, big, robbed, dp, fly` | `call`이면 누심 "아웃!", 큰 타구 잡히면 탄식→박수, 호수비면 환호 |
| `safe` | `x, z, call, hit('1B'/'2B'/'3B'/'bunt'), error` | 누심 "세이프!", 안타 환호(장타일수록 큼), 실책 탄식 |
| `hr` | `dist, n, walkoff` | 관중 폭발 + 오르간 + 불꽃 6발 |
| `score` | `walkoff` | 환호 / 끝내기 폭발 |
| `steal` | `ok` | 웅성 / 환호 |
| `slide`, `dive` | `x, z` | 흙 미끄러짐 / 몸 던지는 쿵 |
| `inningEnd` | `start` | 박수 + 가끔 이닝 오르간 |
| `gameEnd` | `king` | 긴 환호·박수 |
| `modeChange` | `rules: 'real'\|'casual'` | 관중·타격음 톤 바꿈 |

클라 전용 보조 이벤트(sim 이벤트 아님): `ui:click`, `ui:perfect`, `ui:tick{p}`, `ui:walkup{me}`, `ui:screen{screen}`, `ui:msg{text,s}`(배너 문구 → 캐스터), `ball:bounce{x,z,impact,surf}`, `ball:wall{x,z}`.

### main.js 연결 (`// [audio]` 태그)
- 예전 `sfx.*` 호출 자리 전부 → `bus.emit(...)`. `crowdAmbience` 매 프레임 호출 삭제(관중은 이벤트로 움직임).
- 배너 메시지 정규식 → 이벤트 변환 블록(`onSnap` 메시지 부분). **gameplay가 sim에 `ev` 이벤트를 넣으면 이 블록의 emit 줄은 지우면 된다**(배너·excite 부분은 남김).
- `setScreen`에서 `ui:screen`, 투구 시작(`ph`가 `pitching`으로 바뀔 때) `windup`, 서버 `s.lh` 도착 시 `contact`(실제 타구 속도·각도).
- 캐스터 대사 표(CAST)는 `client/audio/caster.js`로 옮김. main 은 `caster:line`을 받아 자막만 그림.
- `tools/build.mjs`에 2줄: `public/assets/sfx/index.json` 생성. `.gitignore`에 그 파일 추가.

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
- 볼륨 4개: 전체(기존 `vol` 키 그대로), 효과음 `volSfx`, 관중 `volCrowd`, 캐스터 `volCast` (localStorage `hr_*`). 설정 창에 슬라이더가 없으면 사운드가 '전체 음량' 아래에 붙인다(`mountVolumeUI`) — ui 파트가 새 설정 화면을 만들면 같은 id 로 두면 됨.
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
- **gameplay**: sim 이벤트에 위 2절 필드를 넣어 주기. 특히 `contact{pid,q,ev,la,mode,foul}`, `catch{pitch,kmh,x,z,dive}`, `out/safe{call,x,z,k}`, `hr{dist,n,walkoff}`, `windup`(카운트·주자·점수). 이벤트가 들어오면 main.js `onSnap`의 `[audio]` 메시지→이벤트 변환 줄은 지우기. `modeChange{rules}`도 경기 시작 때 한 번.
- **ui**: 설정 화면을 새로 만들 때 음량 슬라이더 id `vol`(전체)·`volSfx`·`volCrowd`·`volCast` 유지(없으면 사운드가 자동으로 붙임). 캐스터 자막은 `bus.on('caster:line', {text})`로 그리기. 화면 바뀔 때 `ui:screen{screen}` emit 유지, 버튼 클릭음은 `bus.emit('ui:click')`.
- **anim**: 스윙 모션에서 배트가 빠르게 지나가는 순간 `swing{power}` emit(지금은 main.js 가 swingK 로 냄), 슬라이딩·다이빙 시작 때 `slide/dive{x,z}`.
- **총괄**: `tools/build.mjs`에 2줄(`[audio]`), `.gitignore` 1줄 추가함.
