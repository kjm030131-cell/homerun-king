// rig.js — 스킨 몸체용 뼈대 정의(바인드 = T포즈, 모든 뼈 회전 = 단위). 생성기(tools/genbody.mjs)와 런타임이 공유
// [이름, 부모, 월드 위치(m)]
const L = (n, p, x, y, z) => [[`Left${n}`, p && p.replace('*', 'Left'), x, y, z], [`Right${n}`, p && p.replace('*', 'Right'), -x, y, z]];
export const BONES = [
  ['Hips', null, 0, 1.04, 0.021],
  ['Spine', 'Hips', 0, 1.142, 0.022],
  ['Spine1', 'Spine', 0, 1.243, 0.012],
  ['Spine2', 'Spine1', 0, 1.334, -0.002],
  ['Neck', 'Spine2', 0, 1.5, -0.027],
  ['Head', 'Neck', 0, 1.596, -0.01],
  ...L('Shoulder', 'Spine2', 0.046, 1.443, -0.028),
  ...L('Arm', '*Shoulder', 0.152, 1.438, -0.05),
  ...L('ForeArm', '*Arm', 0.43, 1.438, -0.05),
  ...L('Hand', '*ForeArm', 0.713, 1.438, -0.05),
  ...L('HandIndex1', '*Hand', 0.8, 1.433, -0.05),
  ...L('HandIndex2', '*HandIndex1', 0.85, 1.433, -0.05),
  ...L('HandThumb1', '*Hand', 0.728, 1.422, -0.022),
  ...L('HandThumb2', '*HandThumb1', 0.765, 1.418, 0.008),
  ...L('UpLeg', 'Hips', 0.088, 0.972, 0.005),
  ...L('Leg', '*UpLeg', 0.088, 0.529, 0.008),
  ...L('Foot', '*Leg', 0.088, 0.09, -0.022),
  ...L('ToeBase', '*Foot', 0.088, 0.02, 0.105),
];
export const BIND_POS = Object.fromEntries(BONES.map(([n, , x, y, z]) => [n, [x, y, z]]));
