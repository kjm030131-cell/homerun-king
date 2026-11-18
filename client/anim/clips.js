// clips.js — 캐릭터 에셋 설정: 파일 경로, 클립 이름 ↔ 파일, 클립별 재생 규칙, 장비(슬롯) 맞춤값.
// 게임 코드는 클립 '이름'만 안다(REBUILD.md 4-3). Mixamo 파일 이름·구간·마커는 여기서만 관리한다.
// 값 조정은 코드 대신 public/assets/models/manifest.json 으로 덮어쓸 수 있다(mergeManifest). ?animlab 에서 맞춘 값을 복사해 넣으면 됨.

export const MODEL_DIR = './assets/models/';

// 몸·장비 파일 (public/assets/models/ 기준). 없으면 그 장비만 옛 절차형 장비로 대신한다.
export const FILES = {
  player: 'player.glb', // Mixamo 자동 리깅된 몸(T포즈, With Skin) → Blender 로 GLB
  playerLod: 'player.lod.bin', // (선택) 저폴리 인덱스 — CI 빌드가 tools/glb-lod.mjs 로 만든다
  cap: 'cap.glb', helmet: 'helmet.glb', bat: 'bat.glb', glove: 'glove.glb',
  mask: null, // (선택) 유니폼 색 마스크 PNG(R=상의 G=바지 B=스타킹). 없으면 흰색 자동 판정
};

// 게임 클립 이름(고정) → 파일/재생 규칙
//  loop    : 반복 여부
//  lockXZ  : 엉덩이(Hips) 수평 이동 제거(제자리) — 게임이 위치를 직접 움직이는 동작은 true
//  speed   : 제자리 이동 클립의 원래 속도(m/s) — 실제 이동 속도에 맞춰 재생 속도를 바꿈(발 미끄러짐 방지)
//  trim    : [시작초, 끝초] 잘라 쓰기 (null = 전체)
//  yaw     : 클립이 바라보는 방향 보정(도). 모든 클립은 '+z(앞)를 본다'로 맞춘다
//  kmap    : 게임 진행도 k(0~1+) → 마커 이름. 이 클립을 시간이 아니라 진행도로 '긁어서(scrub)' 쓴다
//  markers : 클립 안의 시각(초). null 이면 로딩 때 자동 추정(autoMarkers) — 수동 값이 있으면 그걸 씀
//  fallback: 파일이 없을 때 대신 쓸 클립
export const CLIPS = {
  idle: { loop: true, lockXZ: true },
  ready: { loop: true, lockXZ: true, fallback: 'idle' },
  run: { loop: true, lockXZ: true, speed: 3.6, fallback: 'idle' },
  sprint: { loop: true, lockXZ: true, speed: 7.0, fallback: 'run' },
  batStance: { loop: true, lockXZ: true, fallback: 'idle' },
  // swing: k 0~0.25 = 준비(로드, 투구 따라 체중 이동), 0.3 = 출발, 0.5 = 컨택, 1 = 끝(anim.js SWING_CONTACT_K 와 같음)
  swing: { loop: false, lockXZ: false, kmap: [[0, 'start'], [0.25, 'load'], [0.3, 'launch'], [0.5, 'contact'], [1, 'end']], fallback: 'batStance' },
  powerSwing: { loop: false, lockXZ: false, kmap: [[0, 'start'], [0.25, 'load'], [0.3, 'launch'], [0.5, 'contact'], [1, 'end']], fallback: 'swing' },
  buntStance: { loop: true, lockXZ: true, fallback: 'batStance' },
  // pitch 는 kmap 대신 timing.js 의 투구 시간표(와인드업 초) ↔ markers 로 맞춘다
  pitch: { loop: false, lockXZ: false, fallback: 'throw' },
  // throw: anim.js THROW_RELEASE_K(0.55) 에 놓음
  throw: { loop: false, lockXZ: false, kmap: [[0, 'start'], [0.55, 'release'], [1, 'end']], fallback: 'idle' },
  catchHigh: { loop: false, lockXZ: true, kmap: [[0, 'start'], [1, 'end']], fallback: 'ready' },
  catchLow: { loop: false, lockXZ: true, kmap: [[0, 'start'], [0.5, 'catch'], [1, 'end']], hold: true, fallback: 'ready' },
  // dive/slide: k 1 = 0.55s / 0.6s (main.js 진행도 정의) — 그 뒤는 자연 속도로 이어 감
  dive: { loop: false, lockXZ: true, kmap: [[0, 'start'], [1, 'land'], [1.8, 'end']], fallback: 'catchLow' },
  slide: { loop: false, lockXZ: true, kmap: [[0, 'start'], [1, 'land'], [1.6, 'end']], fallback: 'run' },
  catcherSquat: { loop: true, lockXZ: true, fallback: 'ready' },
  celebrate: { loop: true, lockXZ: true, fallback: 'idle' },
  disappointed: { loop: false, lockXZ: true, fallback: 'idle' },
  umpireCall: { loop: false, lockXZ: true, fallback: 'idle' },
  // (선택) 고정 목록 밖 — 있으면 세이프 판정에 씀
  umpireSafe: { loop: false, lockXZ: true, fallback: 'idle', optional: true },
};
export const CLIP_NAMES = Object.keys(CLIPS).filter((k) => !CLIPS[k].optional);
// 이게 다 있어야 새 캐릭터로 바꾼다(없으면 옛 몸 유지 — 반쪽짜리 동작으로 게임이 어색해지는 것 방지)
export const REQUIRED = ['idle', 'run', 'batStance', 'swing', 'pitch'];
// 시작할 때 먼저 받는 클립(나머지는 뒤에서 이어 받음)
export const EARLY = ['idle', 'ready', 'run', 'batStance', 'swing', 'pitch', 'catcherSquat', 'umpireCall'];

// 장비 슬롯 → 뼈 (Mixamo 이름에서 'mixamorig:' 뗀 이름)
export const SLOT_BONE = { head: 'Head', handR: 'RightHand', handL: 'LeftHand', chest: 'Spine2', legL: 'LeftLeg', legR: 'RightLeg' };

// 장비 맞춤. 좌표는 'T포즈로 +z 를 보고 선 캐릭터' 기준 미터.
//  rot   : 원본 모델을 그 자세로 돌리는 오일러(도, XYZ). Tripo 가 내보낸 방향에 따라 다름 → ?animlab 에서 맞춤
//  fit   : 'head' = 머리(머리 뼈에 붙은 정점 범위)에 자동으로 맞춤 / 숫자 = 가장 긴 변 길이(m)
//  width : head 맞춤일 때 머리 폭 대비 배율, top: 정수리 위 여유(m), back: 뒤통수 기준 앞으로 밀기(m)
//  anchor: 장비 경계상자의 기준점(-1~1, 각 축) → 뼈 위치 + pos 에 둔다
export const FIT = {
  cap: { rot: [0, 0, 0], fit: 'head', width: 1.1, top: 0.012, back: -0.008, pos: [0, 0, 0], scale: 1 },
  helmet: { rot: [0, 0, 0], fit: 'head', width: 1.18, top: 0.022, back: -0.016, pos: [0, 0, 0], scale: 1 },
  // 배트는 축·손잡이 끝을 자동으로 찾는다(가장 긴 축, 가는 쪽 = 손잡이). knob = 오른손 뼈 기준 손잡이 끝 위치, dir = 배트 방향
  bat: { fit: 0.86, knob: [-0.085, -0.03, -0.13], dir: [0, 0.15, 1] },
  // 글러브: 손가락이 +y, 주머니가 +z 로 서 있는 모델이라고 가정 → 왼손 T포즈(손가락 +x, 손바닥 -y)로 돌림
  glove: { rot: [90, 0, -90], fit: 0.3, anchor: [-1, 0, 0], pos: [0.03, -0.01, 0], scale: 1, catcher: 1.18 },
  ball: { pos: [-0.09, -0.035, 0.025] },
};

// 몸 설정
export const BODY = {
  height: 1.85, // 맞출 키(m) — 옛 몸과 같은 크기
  lodDist: 26, // 이 거리(m)보다 멀면 저폴리(+ 애니메이션 갱신 절반)
  farUpdate: 2, // 먼 선수는 N 프레임마다 한 번 애니메이션 갱신
  hiddenUpdate: 6, // 화면 밖 선수는 N 프레임마다 한 번
  // 유니폼 색 자동 판정(마스크 PNG 없을 때): 흰/옅은 회색 텍셀만 팀 색으로. 높이는 발(0)~정수리(1)
  tint: { satMax: 0.16, lumMin: 0.5, neck: 0.83, belt: 0.535, sock: 0.2 },
  // 등번호·가슴 글씨 투영 영역(키 대비)
  decal: { y0: 0.6, y1: 0.79, halfW: 0.12 },
};

// manifest.json 덮어쓰기: { files, clips: { swing: { trim, markers, yaw } }, fit: { cap: {...} }, body: {...} }
export function mergeManifest(m) {
  if (!m || typeof m !== 'object') return;
  const deep = (dst, src) => { for (const k in src) { const v = src[k]; if (v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object' && !Array.isArray(dst[k])) deep(dst[k], v); else dst[k] = v; } };
  if (m.files) deep(FILES, m.files);
  if (m.clips) for (const k in m.clips) { if (!CLIPS[k]) CLIPS[k] = { loop: false, optional: true }; deep(CLIPS[k], m.clips[k]); }
  if (m.fit) deep(FIT, m.fit);
  if (m.body) deep(BODY, m.body);
}
