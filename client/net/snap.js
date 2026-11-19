// [net] 서버 스냅샷 델타 합치기 (src/index.js packSnap 의 짝).
//  d:1 = 지난 스냅샷에서 바뀐 키만 옴 → 지난 것 위에 덮어쓰고 x:[키…] 는 지움. ev·pg 는 그 메시지에 있을 때만(이어받지 않음).
//  k:1 또는 d 없음 = 통째로.  기준이 없는데 델타가 오면(이론상 없음) null → 다음 통째 스냅샷(최대 3초)까지 버림.
export function createSnapMerger() {
  let base = null;
  return {
    reset() { base = null; },
    merge(m) {
      if (!m.d) { delete m.k; base = m; return m; }
      if (!base) return null;
      const s = {};
      for (const k in base) if (k !== 'ev' && k !== 'pg') s[k] = base[k];
      for (const k in m) if (k !== 'd' && k !== 'x') s[k] = m[k];
      if (m.x) for (const k of m.x) delete s[k];
      base = s;
      return s;
    },
  };
}
