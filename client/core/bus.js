// 재개발 공용 이벤트 버스. 게임 이벤트(서버 스냅샷 `ev` 또는 혼자하기 Game.events)를
// UI·애니메이션·사운드가 각자 구독한다. 파트끼리 서로 직접 import 하지 말고 이걸로만 소통.
const subs = new Map();
export const bus = {
  on(type, fn) { (subs.get(type) || subs.set(type, new Set()).get(type)).add(fn); return () => subs.get(type)?.delete(fn); },
  emit(type, data) { for (const fn of subs.get(type) || []) try { fn(data); } catch (e) { console.error('[bus]', type, e); } for (const fn of subs.get('*') || []) try { fn(type, data); } catch (e) { console.error('[bus]', e); } },
};
