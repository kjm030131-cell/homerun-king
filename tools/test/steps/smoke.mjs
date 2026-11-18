// 기본 확인: 타석 → 투구 → 스윙 → 타구, 수비(투수) 시점, 렌더 통계
import { start, vclock, stepUntil, step, vshot, renderInfo } from './common.mjs';
export default [
  ...start, vclock,
  stepUntil("s.ph==='pitching' && r.batter && s.p && g.now > s.p.t0-0.3", 40), ...vshot('01_bat_windup.png'), renderInfo,
  stepUntil("s.ph==='pitching' && s.p && g.now>=s.p.arrive-0.004", 10),
  { eval: 'const p=window.__hr.S().p; window.__hr.net().send({t:"swing",pid:p.id,dt:0,ax:0,ay:0.02,mode:"contact"}); 1' },
  step(0.6), ...vshot('02_after_swing.png'),
  { eval: 'const g=window.__hr.game; g.half=1; g.startHalf(); 1' },
  stepUntil("s.ph==='pitch' && r.pitcher", 30), step(0.5), ...vshot('03_pitcher.png'), renderInfo,
];
