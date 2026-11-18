# 경기장·렌더 파트 (rb-stadium)

## 1. 바꾼 점
잠실 구장(`client/stadium.js` 약 1000줄 한 파일)을 지우고 **"홈런왕 볼파크"**(오리지널 고급 구장 + 잠실 느낌)로 새로 만들었다.
`client/stadium.js`는 호환용 입구(`export * from './stadium/index.js'`)만 남았다.

| 모듈 (`client/stadium/`) | 내용 |
|---|---|
| `layout.js` | 단면 규격 한 곳: 1층·스위트·3층(오버행)·지붕·외야석·외벽·덕아웃 구간·전광판 `SB`. 펜스/경계는 `shared/sim.js`의 `fenceR`·`standR`·`WALL_H` 그대로 (좌우 100m, 중앙 125m, 높이 2.6m) |
| `field.js` | 그라운드 한 장 굽기(내야 흙 원호 + 파울라인 1.8m 넘치는 흙, 잔디 립, 젖은 흙 테두리, 타석 밟힌 자국, 라인·배터박스·포수석·코치박스·대기타석). **예초 무늬는 셰이더**에서 월드 좌표로 계산(파울라인 평행 두 방향 = 다이아몬드 체크, 내야는 더 잘게) → 해상도 무관하게 선명, 보는 방향에 따라 줄 밝기가 바뀜, 멀면 자동으로 흐려져 모아레 없음. 사진 잔디/흙(`grass.jpg`/`dirt.jpg`) 디테일 유지 |
| `fence.js` | 외야 패딩 + 노란 홈런 라인 + 고정 광고(ad01~11, 백스크린 ±10° 앞은 비움) + 거리 숫자, 파울 벽 1.25m + LED 회전 광고(ad12~22), 덕아웃 앞 개구부, 백네트(홈 뒤 8.5m → 덕아웃 끝 3.6m), 폴대 26m |
| `stands.js` | 1층 24줄(통로·출입구는 셰이더로, 덕아웃 뒤는 줄을 물림) → 콘코스 바닥 → 스위트 유리 띠(밤에 불빛) → 3층 21줄(1층 위로 4.5m 오버행, 밑면 다운라이트, 앞 난간 LED 리본) → 홈 뒤 캔틸레버 지붕(리브·기둥·앞단 조명 띠), 외야석 18줄 + 백스크린, 외벽 파사드(밤에 층 띠 불빛), 끝 마개 벽 |
| `crowd.js` | **빌보드 관중**: 1인 = 카메라를 보는 사각형 2삼각형 + 절차적 사람 아틀라스(4체형 x 앉음/만세, 옷 색은 인스턴스별). 1만 5천~2만 명이 3만 삼각형. 12개 각도 구역별로 따로 그려 화면 밖 컬링. 3루 쪽 홈팬 남색 / 1루 원정팬 빨강, 응원석은 더 많이 들썩 |
| `structures.js` | 덕아웃(0.85m 낮은 바닥, 벤치·헬멧 선반·난간, HOME/VISITOR), 불펜(파울 지역 라인 따라 2레인, 투수판→홈 방향 = 라인 평행), 조명탑 4개(외야 ±27°, 1·3루 뒤 ±63°) + 지붕 앞단 램프 뱅크 4개, 10개 구단 깃발(셰이더로 펄럭) |
| `scoreboard.js` | 중앙 전광판 62x19.4m(기존 그리기 로직 그대로, 헤더 HOMERUN KING) + 크라운 간판 + 좌우 보조 화면(LED 광고 회전) |
| `env.js` | 하늘 돔(낮: 그라데이션+해 번짐+fbm 구름 / 밤: 지평선 도시 불빛), 별·달, 원경 파노라마 사진(`sky_day/night.jpg`), 아파트·강 건너 스카이라인, 롯데월드타워, 한강·다리·불빛, 광장, 나무 180그루(인스턴싱 1콜) |
| `ads.js` | 광고 아틀라스 + 회전 LED 셰이더. **슬롯 고정: ad01~11 외야 고정, ad12~22 LED 회전** (8초마다 한 칸, 바뀔 때 번쩍) |
| `materials.js` | 공용 재질(병합 위해 공유). 밤엔 관중석·구조물 색을 0.55~0.85배 → 조명 받은 그라운드가 돋보이는 야구장 밤 느낌 |
| `merge.js` | 정적 병합(재질+속성 구성+그림자 태그 기준, 속성 유지) + 그림자 태그(`ground/struct/stand/big/none`) → 품질·낮밤에 따라 cast/receive 런타임 전환 |
| `look.js` | 톤매핑(ACES, 낮 0.82 / 밤 1.0), 해(3루 쪽 고도 38°, 오후 그림자) / 밤 키라이트(거의 머리 위 = 짧은 그림자) + 좌우 조명탑 보조광, PMREM 환경광(낮 하늘+해 / 밤 조명탑 램프 8개), 안개, 블룸(밤 램프 HDR 7배 → 빛남), 그래픽 단계 |

main.js 변경(`// [stadium]` 태그): 후처리 import 4줄 삭제, 렌더러 아래 조명·블룸·낮밤·품질·리사이즈 블록(약 60줄)을 `createLook()` 호출 12줄로 교체, 렌더 줄 `look.render()`. `applyTimeOfDay`·`applyQuality`·`resize` 이름은 그대로라 다른 코드 영향 없음.

## 2. 성능 (코드로 센 추정치 — 구장만, 선수·UI 제외)
three r160을 Node에서 돌려(DOM 스텁) 장면을 만들고, 보이는 메시 수(=드로우콜)·삼각형을 카메라별 절두체로 셌다. 같은 스크립트로 v20 구장도 측정해 비교.

| | v20 구장 (중간) | 새 구장 낮음 | 새 구장 중간 | 새 구장 높음 |
|---|---|---|---|---|
| 전체 드로우콜 (밤) | 113 | 85 | 86 | 86 |
| 전체 삼각형 | 963k | 86k | 129k | 151k |
| 타석 카메라 calls / tris | 51 / 422k | 49 / 71k | 50 / 105k | 50 / 123k |
| 투수 카메라 | 46 / 621k | 49 / 77k | 50 / 114k | 50 / 133k |
| 타구 추적 카메라 | 69 / 778k | 67 / 81k | 68 / 122k | 68 / 142k |
| 그림자 패스 추가(낮) | 25 / 3k | 0 | 12 / 3k | 24 / 101k |

- 낮에는 조명탑 번짐 스프라이트·야경 점이 꺼져 12콜 더 적음.
- 삼각형이 크게 준 이유: 관중 1인 56 → 2삼각형(빌보드). 관중 수 v20 약 1.5만 → 새 구장 좌석 19,948석 중 15,600명(중간 85%, 낮음 50%, 높음 100%).
- 프레임 예산(삼각형 70만, 드로우콜 300)은 선수 포함해도 여유. 단 빌보드는 알파 테스트라 픽셀 비용이 조금 있음 → 맥에서 fps 확인 필요.
- 그래픽 단계: `STADIUM_Q`(index.js). 낮음 = 그림자·블룸·환경광 끔, 관중 50%, 나무 숨김. 높음 = 그림자 4096 PCFSoft, 낮 경기에서 3층·지붕·관중석이 그림자를 드리움. 단계를 바꾸면 관중 밀도·그림자·나무는 즉시, 그라운드 해상도(높음 4096)·리본 분할 수는 새로고침 때 반영.
- 측정 방법: three r160 소스를 받아 `node --import <DOM 스텁+three 경로 훅> count.mjs client/stadium.js` (스크립트는 저장소 밖 /tmp). 실제 GPU 수치는 맥에서 `tools/test`의 `renderInfo`로 다시 확인.

## 3. 다른 파트 참고
- `buildStadium()` 반환: `world, crowd(Group), SB, setTimeOfDay, setQuality, drawScoreboard, refreshText, update(t, excite), sky, info`. `stadium.js`의 `glowTex`·`canvasTex`·`textMesh`·`SEAT_ZONES`·`createLook` export 유지(fx.js가 glowTex 사용).
- 내야 흙 원호는 그림에선 파울라인 바깥 1.8m까지만 칠함. sim의 지면 판정(마운드 29m 원 = 흙)은 파울 지역 일부까지 흙으로 봄 → 바운드 마찰만 아주 조금 다름(물리 수치는 안 건드림).
- 덕아웃 위치: 라인 따라 17~37m, 라인에서 22.2m(`layout.js DUGOUT`). 벤치 선수 배치하려면 이 값 사용.

## 4. 맥에서 확인할 것
1. 낮/밤 각각 타석·투수·중계 화면에서 fps(오른쪽 위) — v20보다 떨어지면 알려주기.
2. 밤: 조명탑·지붕 램프가 번지는지(블룸), 관중석이 너무 어둡진 않은지.
3. 낮: 3루 쪽 관중석 그림자(높음에서), 하늘 구름, 너무 밝거나 뿌옇지 않은지.
4. 잔디 무늬가 걸을 때 반짝이거나 깨지지 않는지, 관중이 멀리서 사라지거나 깜빡이지 않는지.
5. 광고: 외야 펜스(ad01~11 고정), 파울 벽·3층 리본·전광판 옆(ad12~22 회전).

## 5. 텍스처 (선택 — 없으면 절차적 생성으로 폴백)
파일을 `public/assets/tex/`에 넣고 `client/stadium/index.js`의 `OPTIONAL_TEX`에서 해당 항목 `on: true`로 바꾸면 적용. (기존 grass/dirt/sky_day/sky_night/ads는 그대로 사용 중 — 교체하고 싶을 때만 아래 프롬프트.)
GPT 이미지 생성 후 지정 해상도로 줄여서(jpg 품질 85) 넣는다. 각 프롬프트는 그대로 복사해서 쓰면 된다.

| 파일 | 해상도 | 용도 |
|---|---|---|
| `stadium_facade.jpg` | 1024x1024 | 경기장 외벽(밖에서 보이는 둘레) |
| `stadium_concrete.jpg` | 512x512 | 벽·콘코스·3층 밑면 콘크리트 |
| `stadium_roof.jpg` | 1024x1024 | 홈 뒤 지붕 금속 패널 |
| `crowd_atlas.png` | 1024x1024 (투명) | 관중 아틀라스(4열 x 2행) |
| `field_logo.png` | 1024x1024 (투명) | 홈플레이트 뒤 잔디 로고 |
| `grass.jpg` (교체 시) | 1024x1024 | 잔디 디테일 |
| `dirt.jpg` (교체 시) | 1024x1024 | 내야 흙 디테일 |
| `sky_day.jpg` / `sky_night.jpg` (교체 시) | 2048x353 (생성 1536x1024 → 위아래 잘라 늘림) | 원경 파노라마 |

**stadium_facade.jpg**
> Seamless tileable texture, flat orthographic front view of a modern premium baseball stadium exterior facade: light grey precast concrete vertical fins evenly spaced, dark tinted glass between them, one horizontal dark band every third of the height, clean architectural look, neutral overcast daylight, no shadows from the sun, no perspective, no people, no text, no logos, no sky, the pattern must repeat perfectly on all four edges, photorealistic, square image.

**stadium_concrete.jpg**
> Seamless tileable texture, flat top-down orthographic view of smooth architectural cast-in-place concrete with subtle formwork lines, faint stains and fine pores, medium light grey, even diffuse lighting, no shadows, no cracks, no text, no objects, the pattern must repeat perfectly on all four edges, photorealistic, square image.

**stadium_roof.jpg**
> Seamless tileable texture, flat orthographic view of a stadium canopy roof made of light silver standing-seam metal panels running vertically with thin seams every 1/8 of the width, very slight brushed metal variation, even diffuse lighting, no shadows, no perspective, no text, no logos, the pattern must repeat perfectly on all four edges, photorealistic, square image.

**crowd_atlas.png**
> Sprite sheet on a fully transparent background, exactly 4 columns and 2 rows of equal cells, each cell contains one seated baseball fan seen from the front from the waist up, centered, filling the cell height, simple clean silhouette style with flat shading. Color coding is mandatory: clothing painted pure red (#FF0000) with darker red shading, skin painted pure green (#00FF00) with darker green shading, hair and caps painted pure blue (#0000FF), nothing else. Top row: arms resting down (cell 1 short hair, cell 2 baseball cap, cell 3 long hair, cell 4 broad-shouldered man). Bottom row: the same four people in the same order cheering with both arms raised straight up above the head, hands reaching the top of the cell. No background, no seats, no text, no extra colors, square image.

**field_logo.png**
> Flat emblem logo on a fully transparent background, a circular baseball crest for a fictional ballpark named "HOMERUN KING", a stylized crown above a crossed bat and baseball, bold clean vector shapes, colors only white and light grass green with a thin dark green outline so it looks mowed into a lawn, centered, no gradients, no shadows, no other text, square image.

**grass.jpg (교체 시)**
> Seamless tileable texture, straight top-down orthographic photo of a freshly mowed professional baseball outfield grass (Kentucky bluegrass), dense short blades, natural medium green with subtle variation, even overcast lighting, no stripes, no shadows, no lines, no objects, the pattern must repeat perfectly on all four edges, photorealistic, square image.

**dirt.jpg (교체 시)**
> Seamless tileable texture, straight top-down orthographic photo of a professional baseball infield clay dirt, reddish brown, finely raked with very faint drag marks, small pebbles and cleat scuffs, even overcast lighting, no shadows, no lines, no objects, the pattern must repeat perfectly on all four edges, photorealistic, square image.

**sky_day.jpg (교체 시)**
> Ultra wide panoramic photo of the Seoul skyline seen from far away across the Han River on a clear afternoon: distant apartment towers and mountains along the horizon in the lower third, bright blue sky with a few soft white clouds above, the horizon perfectly straight and level across the whole image, no foreground objects, no people, no text, no watermark, photorealistic, landscape image.

**sky_night.jpg (교체 시)**
> Ultra wide panoramic photo of the Seoul skyline at night seen from far away across the Han River: distant lit apartment towers, bridges with warm lights and dark mountains along the horizon in the lower third, deep navy night sky above with a faint orange city glow near the horizon, the horizon perfectly straight and level across the whole image, no foreground objects, no people, no text, no watermark, photorealistic, landscape image.

## 6. 요청 (다른 파트)
- **총괄/빌드**: `tools/build.mjs`의 혼자 연습판 인라인 목록에 위 선택 텍스처(켜진 것만)를 추가해야 solo.html에서도 보임. 그리고 `crowd.jpg`는 이제 안 쓰니 인라인에서 빼면 solo.html 약 236KB 감소.
- **ui**: 그래픽 설정 옆에 "단계에 따라 일부 디테일(그라운드 해상도)은 새로고침 후 적용" 안내 한 줄(선택).
- **anim**: 덕아웃 벤치 선수를 다시 넣고 싶으면 `layout.js DUGOUT` 좌표 사용. 환경광(PMREM)이 켜져서 선수 재질이 조금 밝아질 수 있음 — 확인 부탁.
