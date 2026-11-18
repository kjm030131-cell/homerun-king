# 홈런왕 (잠실 구장)

친구들이랑 방 코드로 모여서 하는 웹 3D 야구. 정규 경기 · 홈런 더비 · 타격 연습. 빈 자리는 CPU가 채운다.

- 플레이: **https://homerun-king.jaemin-poker.workers.dev** (PC 크롬 권장)
- 기술: three.js 0.160 클라이언트 + Cloudflare Workers / Durable Objects 서버(서버 권위 시뮬레이션)
- **개발을 이어서 하는 사람(다른 Claude 포함)은 [`HANDOFF.md`](HANDOFF.md)부터 읽을 것.** 규칙·구조·수치·다음 할 일이 다 있다.

## 개발 흐름

```bash
npm ci
npm run check        # 빌드 + 문법 검사 + 테스트 (push 전에 항상)
npm run dev          # 로컬 서버 http://localhost:8787 (탭 두 개로 멀티 확인)
git push             # main 에 push 하면 GitHub Actions 가 테스트 후 자동 배포
```

- **배포는 `main` push 하나뿐.** 터미널에서 `wrangler deploy` 직접 하지 않는다.
- 큰 작업은 브랜치에서 → 테스트(qa 워크플로) 통과 후 main 에 merge.
- 혼자하기판(서버 없이 한 파일): `npm run build` 후 `dist/solo.html`.

## 구조 (자세한 건 HANDOFF.md 2절)

```
shared/sim.js     규칙 + 물리 + AI (서버와 혼자하기 공용)
src/index.js      Worker + Room DO(경기) + Lobby DO(방 목록·통산 기록)
client/           렌더링·입력·카메라·HUD·네트워크 (main.js 가 중심)
public/           index.html + 에셋 (app.js 는 빌드 결과물이라 git 에 없음)
assets-src/       원본 이미지
tools/            빌드, 몸 모델 생성기, 장면 테스트
tests/            단위 테스트 (node --test)
```

## 조작

| 상황 | 조작 |
|---|---|
| 타격 | 마우스로 배트 원 이동, 좌클릭/Space 정타, 우클릭/F 강타, B 번트 자세 |
| 투구 | 1~6 구종 → 마우스 코스 → 클릭 게이지 시작 → 초록에서 클릭, Q 견제 |
| 수비 | WASD 이동(투구 전엔 위치 조정), Shift 질주, Space 점프, C 다이빙, Q 선수 전환, 공 잡으면 1·2·3·4 송구 / F 투수 / R 중계 / Space 추천 베이스 (꾹 누르면 강송구) |
| 주루 | R 도루(투구 전), E 추가 진루, Q 귀루, Space 슬라이딩 |
| 타격 연습 | 1~6 구종 고정, 0 섞어서 |
| 기타 | Enter 채팅, T 빠른 채팅, Tab 기록, V 시점, H 조작법, Esc 메뉴 |

## 방 설정 (대기실)

팀 인원(1:1 / 2:2 / 3:3 / 자유), 투수 교대 방식, 타순(사람만 / 9인 타순), 수비 조작(자동 전환 / 내 포지션만), 구단 10개, 이닝·난이도·타격 난이도·낮/밤, 비밀번호·공개 여부.

## 광고판 바꾸기

`public/assets/ads/ad01.jpg` ~ `ad22.jpg` 를 같은 이름, 5:1 비율(권장 640×128)로 덮어쓰고 push. 1~11번 외야 펜스 고정 판넬, 12~22번은 LED 회전.
