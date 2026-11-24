// 홈런왕 오리지널 구단 (대한민국 도시 연고). 실제 프로구단 이름·로고와는 무관한 자체 디자인.
// c1: 메인(원정 유니폼), c2: 포인트, k: 엠블럼 글자
import { KBO_CLUBS } from './kbo.js';

// true: 실제 KBO 구단·선수(shared/kbo.js) · false: 아래 가상 구단. KBO를 빼려면 false 로 바꾸고 위 import 줄과 kbo.js 를 지우면 끝
export const REAL_LEAGUE = true;

export const FICTION_CLUBS = [
  { city: '서울', name: '서울 나이츠', short: '나이츠', en: 'KNIGHTS', k: 'K', c1: '#14254a', c2: '#d4213d' },
  { city: '부산', name: '부산 하버스', short: '하버스', en: 'HARBORS', k: 'H', c1: '#0d5c63', c2: '#f2b84b' },
  { city: '대구', name: '대구 블레이즈', short: '블레이즈', en: 'BLAZE', k: 'B', c1: '#a8121e', c2: '#1a1a1f' },
  { city: '광주', name: '광주 피닉스', short: '피닉스', en: 'PHOENIX', k: 'P', c1: '#d9481c', c2: '#f7c548' },
  { city: '인천', name: '인천 웨이브스', short: '웨이브스', en: 'WAVES', k: 'W', c1: '#0050a8', c2: '#39cfe0' },
  { city: '대전', name: '대전 스타즈', short: '스타즈', en: 'STARS', k: 'S', c1: '#1c1c22', c2: '#ffc72c' },
  { city: '수원', name: '수원 캐슬즈', short: '캐슬즈', en: 'CASTLES', k: 'C', c1: '#6b1a2c', c2: '#c9ced6' },
  { city: '창원', name: '창원 앵커스', short: '앵커스', en: 'ANCHORS', k: 'A', c1: '#0f2b46', c2: '#d6a937' },
  { city: '서울', name: '서울 메트로스', short: '메트로스', en: 'METROS', k: 'M', c1: '#4a2a86', c2: '#5be3b9' },
  { city: '제주', name: '제주 썬더스', short: '썬더스', en: 'THUNDER', k: 'T', c1: '#1f5fa8', c2: '#ffd93a' },
];
export const CLUBS = REAL_LEAGUE ? KBO_CLUBS : FICTION_CLUBS;
export const clubOf = (i) => CLUBS[((i | 0) % CLUBS.length + CLUBS.length) % CLUBS.length];
// 가상 구단이나 로스터가 없으면 null → 기존 'CPU N번' 이름 사용
export const rosterOf = (i) => (clubOf(i).lineup || null);
export const batterOf = (club, slot) => { const L = rosterOf(club); const b = L && L[((slot | 0) - 1 + 9) % 9]; return b ? { name: b[0], pos: b[1], bats: b[2] || null } : null; };
export const starterOf = (club, k) => { const r = clubOf(club).sp; return r && r.length ? r[((k | 0) % r.length + r.length) % r.length] : null; };
