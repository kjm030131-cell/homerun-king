#!/usr/bin/env python3
"""Mixamo FBX 애니메이션 → 게임 클립 GLB (Blender 없이, numpy 만 사용).

- 몸(player.glb, Tripo/Mixamo 리그 'mixamorig:*')의 뼈에 맞게 '월드 회전 리타깃'한다.
  애니메이션을 다른 캐릭터(Mixamo 기본 캐릭터 등)로 받았어도 뼈 방향·길이 차이를 보정한다.
- 결과: public/assets/models/anim/<클립>.glb (뼈 노드 + 회전 트랙 + Hips 위치 트랙). loader.js 가 그대로 읽는다.
- 몸 GLB 도 텍스처를 줄여 public/assets/models/player.glb 로 복사한다(--body-out, Pillow 있으면).

사용:
  python3 tools/mixamo-retarget.py            # assets-src/mixamo/clips.json 기준 전부
  python3 tools/mixamo-retarget.py swing pitch   # 일부만

clips.json:
  { "body": "assets-src/models/player.glb",
    "clips": { "swing": { "src": "Baseball_Hit.fbx", "yaw": 90, "trim": [0, 1.85] },
               "buntStance": { "src": "Baseball_Bunt.fbx", "yaw": 90, "hold": 1.2 },
               "catcherSquat": { "src": "Baseball_Catcher.fbx", "loop": [6.9, 9.17, 1.2] } } }
  yaw  : 클립을 수직축으로 돌리는 각(도). 게임 기준은 '캐릭터 +z = 정면'(타자는 +z = 홈플레이트, +x = 투수)
  trim : [시작초, 끝초]
  hold : 이 시각의 자세 하나로 정지 클립(반복용)
  loop : [lo, hi, 최소길이] 구간 안에서 처음·끝 자세가 가장 비슷한 반복 구간을 자동으로 고름
"""
import json, os, struct, sys, zlib, math

import numpy as np

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
TICK = 46186158000
FPS = 30

# ───────────── 회전 유틸 (행렬 기준) ─────────────
def rx(a):
    c, s = math.cos(a), math.sin(a); return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
def ry(a):
    c, s = math.cos(a), math.sin(a); return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
def rz(a):
    c, s = math.cos(a), math.sin(a); return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])

def euler_xyz(deg):
    """FBX eEulerXYZ: R = Rz·Ry·Rx (도). deg: (...,3)"""
    d = np.radians(np.asarray(deg, float)).reshape(-1, 3)
    out = np.empty((len(d), 3, 3))
    for i, (x, y, z) in enumerate(d): out[i] = rz(z) @ ry(y) @ rx(x)
    return out

def quat_to_mat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])

def mat_to_quat(m):
    """(...,3,3) → (...,4) xyzw"""
    m = np.asarray(m).reshape(-1, 3, 3); out = np.empty((len(m), 4))
    for i, M in enumerate(m):
        t = np.trace(M)
        if t > 0:
            s = math.sqrt(t + 1) * 2; w = s / 4; x = (M[2, 1] - M[1, 2]) / s; y = (M[0, 2] - M[2, 0]) / s; z = (M[1, 0] - M[0, 1]) / s
        elif M[0, 0] > M[1, 1] and M[0, 0] > M[2, 2]:
            s = math.sqrt(1 + M[0, 0] - M[1, 1] - M[2, 2]) * 2; w = (M[2, 1] - M[1, 2]) / s; x = s / 4; y = (M[0, 1] + M[1, 0]) / s; z = (M[0, 2] + M[2, 0]) / s
        elif M[1, 1] > M[2, 2]:
            s = math.sqrt(1 + M[1, 1] - M[0, 0] - M[2, 2]) * 2; w = (M[0, 2] - M[2, 0]) / s; x = (M[0, 1] + M[1, 0]) / s; y = s / 4; z = (M[1, 2] + M[2, 1]) / s
        else:
            s = math.sqrt(1 + M[2, 2] - M[0, 0] - M[1, 1]) * 2; w = (M[1, 0] - M[0, 1]) / s; x = (M[0, 2] + M[2, 0]) / s; y = (M[1, 2] + M[2, 1]) / s; z = s / 4
        q = np.array([x, y, z, w]); out[i] = q / np.linalg.norm(q)
    return out

def ortho(A):
    """스케일 제거한 회전부"""
    A = np.asarray(A, float)
    return A / np.linalg.norm(A, axis=-2, keepdims=True)

# ───────────── FBX (binary) ─────────────
class Node:
    __slots__ = ('name', 'props', 'children')
    def __init__(s, n, p, c): s.name, s.props, s.children = n, p, c
    def find(s, n): return [c for c in s.children if c.name == n]
    def first(s, n):
        r = s.find(n); return r[0] if r else None

def parse_fbx(path):
    d = open(path, 'rb').read()
    if d[:20] != b'Kaydara FBX Binary  ': raise ValueError(path + ': 바이너리 FBX 가 아님(Mixamo 에서 FBX Binary 로 받기)')
    ver = struct.unpack('<I', d[23:27])[0]
    hdr, hs = ('<QQQ', 24) if ver >= 7500 else ('<III', 12)
    sc = {'Y': ('<h', 2), 'C': ('<?', 1), 'I': ('<i', 4), 'F': ('<f', 4), 'D': ('<d', 8), 'L': ('<q', 8)}
    arr = {'f': np.float32, 'd': np.float64, 'l': np.int64, 'i': np.int32, 'b': np.bool_}
    def prop(o):
        t = chr(d[o]); o += 1
        if t in sc:
            f, n = sc[t]; return struct.unpack(f, d[o:o + n])[0], o + n
        if t in arr:
            ln, enc, cl = struct.unpack('<III', d[o:o + 12]); o += 12
            raw = d[o:o + cl]; o += cl
            if enc == 1: raw = zlib.decompress(raw)
            return np.frombuffer(raw, arr[t], ln), o
        if t in 'SR':
            ln = struct.unpack('<I', d[o:o + 4])[0]; o += 4
            v = d[o:o + ln]; return (v.decode('utf8', 'replace') if t == 'S' else v), o + ln
        raise ValueError('FBX prop ' + t)
    def node(o):
        end, n_p, _ = struct.unpack(hdr, d[o:o + hs]); o += hs
        nl = d[o]; o += 1
        if end == 0: return None, o + nl
        name = d[o:o + nl].decode(); o += nl
        props = []
        for _ in range(n_p):
            v, o = prop(o); props.append(v)
        ch = []
        while o < end:
            c, o2 = node(o)
            if c is None: o = o2; break
            ch.append(c); o = o2
        return Node(name, props, ch), end
    o, top = 27, []
    while o < len(d):
        n, o = node(o)
        if n is None: break
        top.append(n)
    return Node('root', [], top)

def p70(n):
    r = {}
    p = n.first('Properties70') if n else None
    if p:
        for P in p.find('P'): r[P.props[0]] = P.props[4:]
    return r

def fbx_motion(path, want):
    """→ (times, {bone: (F,4,4) 월드}, {bone: 4x4 바인드 월드}). bone 이름은 'mixamorig:' 포함 원래 이름"""
    root = parse_fbx(path)
    objs = {c.props[0]: c for c in root.first('Objects').children}
    oo, op = {}, []
    for C in root.first('Connections').find('C'):
        if C.props[0] == 'OO': oo.setdefault(C.props[2], []).append(C.props[1])
        else: op.append((C.props[1], C.props[2], C.props[3]))
    models = {i: {'name': o.props[1].split('\x00')[0], 'p': p70(o)} for i, o in objs.items() if o.name == 'Model' and o.props[2] == 'LimbNode'}
    parent = {}
    for p, chs in oo.items():
        if p != 0 and (p not in objs or objs[p].name != 'Model'): continue  # 디포머 연결 무시
        for c in chs: parent[c] = p
    stack = None
    for i, o in objs.items():
        if o.name != 'AnimationStack': continue
        cns = set()
        for l in oo.get(i, []):
            if l in objs and objs[l].name == 'AnimationLayer':
                cns |= {c for c in oo.get(l, []) if c in objs and objs[c].name == 'AnimationCurveNode'}
        if cns: stack = (p70(o), cns); break
    if not stack: raise ValueError(path + ': 애니메이션이 없음')
    sp, cns = stack
    dur = sp['LocalStop'][0] / TICK
    nf = int(round(dur * FPS)) + 1; ts = np.arange(nf) / FPS
    cn2m, cur2cn = {}, {}
    for c, p, prop in op:
        if c in objs and objs[c].name == 'AnimationCurveNode' and p in models: cn2m[c] = (p, prop)
        if c in objs and objs[c].name == 'AnimationCurve': cur2cn.setdefault(p, {})[prop] = c
    loc = {}
    for i, m in models.items():
        p = m['p']
        loc[i] = {'T': np.tile(p.get('Lcl Translation', [0, 0, 0]), (nf, 1)).astype(float),
                  'R': np.tile(p.get('Lcl Rotation', [0, 0, 0]), (nf, 1)).astype(float),
                  'pre': euler_xyz(p.get('PreRotation', [0, 0, 0]))[0],
                  'post': euler_xyz(p.get('PostRotation', [0, 0, 0]))[0]}
    for c in cns:
        if c not in cn2m: continue
        mid, prop = cn2m[c]; key = {'Lcl Translation': 'T', 'Lcl Rotation': 'R'}.get(prop)
        if not key: continue
        for ax, cv in cur2cn.get(c, {}).items():
            k = 'XYZ'.index(ax[-1]); co = objs[cv]
            kt = co.first('KeyTime').props[0] / TICK; kv = co.first('KeyValueFloat').props[0].astype(float)
            loc[mid][key][:, k] = np.interp(ts, kt, kv)
    world = {}
    def W(i):
        if i in world: return world[i]
        L = loc[i]
        M = np.tile(np.eye(4), (nf, 1, 1))
        M[:, :3, :3] = L['pre'] @ euler_xyz(L['R']) @ L['post'].T
        M[:, :3, 3] = L['T']
        if parent.get(i) in models: M = W(parent[i]) @ M
        world[i] = M; return M
    byname = {m['name']: i for i, m in models.items()}
    bind = {}
    for o in objs.values():
        if o.name == 'Pose':
            for pn in o.find('PoseNode'):
                nid = pn.first('Node').props[0]
                if nid in models: bind[models[nid]['name']] = np.array(pn.first('Matrix').props[0]).reshape(4, 4).T
    out = {}
    for n in want:
        if n in byname:
            out[n] = W(byname[n])
            if n not in bind: bind[n] = out[n][0]  # 바인드 포즈 없으면(Without Skin) 첫 프레임 — T포즈가 아니면 어긋날 수 있음
    return ts, out, bind

# ───────────── GLB ─────────────
def read_glb(p):
    d = open(p, 'rb').read()
    cl = struct.unpack('<I', d[12:16])[0]
    j = json.loads(d[20:20 + cl]); o = 20 + cl
    bl = struct.unpack('<I', d[o:o + 4])[0]
    return j, bytearray(d[o + 8:o + 8 + bl])

def write_glb(path, j, b):
    while len(b) % 4: b.append(0)
    j['buffers'] = [{'byteLength': len(b)}]
    js = json.dumps(j, separators=(',', ':'), ensure_ascii=False).encode()
    while len(js) % 4: js += b' '
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 28 + len(js) + len(b)))
        f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(b), 0x004E4942)); f.write(bytes(b))

def node_local(n):
    if 'matrix' in n: return np.array(n['matrix'], float).reshape(4, 4).T
    M = np.eye(4)
    M[:3, :3] = quat_to_mat(n.get('rotation', [0, 0, 0, 1])) * np.array(n.get('scale', [1, 1, 1]))
    M[:3, 3] = n.get('translation', [0, 0, 0]); return M

class Body:
    def __init__(self, path):
        self.j, self.b = read_glb(path)
        J = self.j; nodes = J['nodes']
        self.par = {c: i for i, n in enumerate(nodes) for c in n.get('children', [])}
        sk = J['skins'][0]; self.joints = sk['joints']
        self.names = [nodes[i]['name'] for i in self.joints]
        self.idx = dict(zip(self.names, self.joints))
        self.jset = set(self.joints)
        self.W0 = {nodes[i]['name']: self.gw(i) for i in self.joints}
        self.hips = self.idx.get('mixamorig:Hips')
        if self.hips is None: raise ValueError('몸 GLB 에 mixamorig:Hips 뼈가 없음')
        self.armW = self.gw(self.par[self.hips]) if self.hips in self.par else np.eye(4)
    def gw(self, i):
        M = node_local(self.j['nodes'][i])
        while i in self.par: i = self.par[i]; M = node_local(self.j['nodes'][i]) @ M
        return M

def retarget(body, fbx, cfg):
    ts, Wa, bind = fbx_motion(fbx, body.names)
    if 'mixamorig:Hips' not in Wa: raise ValueError(fbx + ': mixamorig:Hips 가 없음')
    Y = ry(math.radians(cfg.get('yaw', 0)))
    nodes = body.j['nodes']
    # 각 뼈의 목표 월드 회전 = yaw · 애니(월드) · 애니바인드⁻¹ · 몸바인드  (yaw 는 동작 전체를 수직축으로 돌림)
    Wr = {}
    for i in body.joints:
        n = nodes[i]['name']
        if n in Wa and n in bind:
            ra = Y @ ortho(Wa[n][:, :3, :3]); ra0 = ortho(bind[n][:3, :3])
            Wr[i] = ra @ ra0.T @ ortho(body.W0[n][:3, :3])
    restRot = {i: ortho(node_local(nodes[i])[:3, :3]) for i in body.joints}
    nf = len(ts)
    cache = {}
    def wr(i):
        if i in cache: return cache[i]
        if i in Wr: r = Wr[i]
        elif i in body.jset: r = wr(body.par[i]) @ restRot[i]
        else: r = np.tile(ortho(body.gw(i)[:3, :3]), (nf, 1, 1))
        cache[i] = r; return r
    rot = {}
    for i in body.joints:
        if i not in Wr: continue
        p = body.par[i]
        pw = wr(p) if p in body.jset else np.tile(ortho(body.gw(p)[:3, :3]), (nf, 1, 1))
        rot[i] = np.transpose(pw, (0, 2, 1)) @ Wr[i]
    # Hips 위치: 엉덩이 높이 비율로 축척, 부모(Armature) 공간으로
    n = 'mixamorig:Hips'
    pa = Wa[n][:, :3, 3]; pa0 = bind[n][:3, 3]
    t0 = body.W0[n][:3, 3]
    s = t0[1] / pa0[1]
    pw = t0 + s * ((pa - pa0) @ Y.T)
    inv = np.linalg.inv(body.armW)
    hips_local = (inv @ np.c_[pw, np.ones(nf)].T).T[:, :3]
    return ts, rot, hips_local

FOOT = ('LeftFoot', 'LeftToeBase', 'LeftToe_End', 'RightFoot', 'RightToeBase', 'RightToe_End')
def floor_clamp(body, rot, hips, clear_m=0.05):
    """몸이 땅을 뚫지 않게 프레임마다 Hips 를 올림(내리지는 않음). 발 관절은 T포즈 높이, 나머지 관절은 clear_m(살 두께) 이상"""
    nodes = body.j['nodes']; nf = len(hips)
    # 몸 월드 단위 ↔ 미터: 메시 높이 = 1.85m 로 맞춰짐(loader). 근사: 발끝~머리끝 대신 T포즈 Head 높이/0.92
    head_y = body.W0['mixamorig:Head'][1, 3] if 'mixamorig:Head' in body.W0 else 0.9
    unit = (head_y / 0.92) / 1.85
    clear = {}
    for i in body.joints:
        n = nodes[i]['name'].replace('mixamorig:', '')
        clear[i] = body.W0[nodes[i]['name']][1, 3] if n in FOOT else clear_m * unit
    rest = {i: node_local(nodes[i]) for i in body.joints}
    lift = np.zeros(nf)
    for f in range(nf):
        cache = {}
        def W(i):
            if i in cache: return cache[i]
            M = rest[i].copy()
            if i in rot: M[:3, :3] = rot[i][f]
            if i == body.hips: M[:3, 3] = hips[f]
            p = body.par.get(i)
            M = (W(p) if p in body.jset else body.gw(p)) @ M if p is not None else M
            cache[i] = M; return M
        lift[f] = max(0.0, max(clear[i] - W(i)[1, 3] for i in body.joints))
    if lift.max() <= 1e-4: return hips, 0.0
    up = np.linalg.inv(ortho(body.armW[:3, :3])) @ np.array([0, 1.0, 0]) / np.linalg.norm(body.armW[:3, 0])
    return hips + lift[:, None] * up[None, :], float(lift.max() / unit)

def pose_dist(rot, a, b):
    return sum(np.linalg.norm(R[a] - R[b]) for R in rot.values())

def shape(ts, rot, hips, cfg):
    if 'hold' in cfg:
        k = int(round(cfg['hold'] * FPS)); k = max(0, min(k, len(ts) - 1))
        sel = [k, k]; t = np.array([0.0, 1.0])
        return t, {i: R[sel] for i, R in rot.items()}, hips[sel]
    a, b = 0, len(ts) - 1
    if 'loop' in cfg:
        lo, hi, mn = cfg['loop']
        L, H, M = int(lo * FPS), min(int(hi * FPS), len(ts) - 1), int(mn * FPS)
        best = None
        for i in range(L, H - M + 1):
            for k in range(i + M, H + 1):
                d = pose_dist(rot, i, k)
                if best is None or d < best[0] - 1e-9 or (abs(d - best[0]) < 1e-9 and k - i > best[2] - best[1]): best = (d, i, k)
        _, a, b = best
        cfg['_loop'] = [round(a / FPS, 3), round(b / FPS, 3), round(float(best[0]), 3)]
    if 'trim' in cfg:
        a = max(0, int(round(cfg['trim'][0] * FPS))); b = min(len(ts) - 1, int(round(cfg['trim'][1] * FPS)))
    sel = slice(a, b + 1)
    return ts[sel] - ts[a], {i: R[sel] for i, R in rot.items()}, hips[sel]

def export_clip(body, name, ts, rot, hips, path):
    nodes = body.j['nodes']
    order = body.joints
    remap = {i: k for k, i in enumerate(order)}
    out_nodes = []
    for i in order:
        n = nodes[i]
        t, M = node_local(n)[:3, 3], node_local(n)
        q = mat_to_quat(ortho(M[:3, :3]))[0]
        nn = {'name': n['name'], 'translation': [float(x) for x in t], 'rotation': [float(x) for x in q]}
        ch = [remap[c] for c in n.get('children', []) if c in remap]
        if ch: nn['children'] = ch
        out_nodes.append(nn)
    roots = [remap[i] for i in order if body.par.get(i) not in remap]
    j = {'asset': {'version': '2.0', 'generator': 'homerun-king mixamo-retarget'}, 'scene': 0, 'scenes': [{'nodes': roots}],
         'nodes': out_nodes, 'bufferViews': [], 'accessors': [], 'animations': []}
    b = bytearray()
    def add(arr, typ, mm=False):
        while len(b) % 4: b.append(0)
        a = np.ascontiguousarray(arr, dtype=np.float32); off = len(b); b.extend(a.tobytes())
        j['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': a.nbytes})
        acc = {'bufferView': len(j['bufferViews']) - 1, 'componentType': 5126, 'count': len(a), 'type': typ}
        if mm: acc['min'] = [float(a.min())]; acc['max'] = [float(a.max())]
        j['accessors'].append(acc); return len(j['accessors']) - 1
    tin = add(ts.reshape(-1, 1), 'SCALAR', True)
    an = {'name': name, 'samplers': [], 'channels': []}
    def chan(node, path_, out):
        an['samplers'].append({'input': tin, 'output': out, 'interpolation': 'LINEAR'})
        an['channels'].append({'sampler': len(an['samplers']) - 1, 'target': {'node': node, 'path': path_}})
    for i, R in rot.items():
        q = mat_to_quat(R)
        for k in range(1, len(q)):
            if np.dot(q[k], q[k - 1]) < 0: q[k] *= -1
        chan(remap[i], 'rotation', add(q, 'VEC4'))
    chan(remap[body.hips], 'translation', add(hips, 'VEC3'))
    j['animations'].append(an)
    write_glb(path, j, b)

# ───────────── 몸 복사(텍스처 축소) ─────────────
def export_body(src, dst, tex):
    j, b = read_glb(src)
    try:
        from PIL import Image
    except ImportError:
        print('  (Pillow 없음 → 텍스처 그대로 복사)'); write_glb(dst, j, b); return
    import io
    old = bytes(b); nb = bytearray()
    views = j['bufferViews']; img_views = {im['bufferView']: k for k, im in enumerate(j.get('images', [])) if 'bufferView' in im}
    for vi, bv in enumerate(views):
        s = bv.get('byteOffset', 0); data = old[s:s + bv['byteLength']]
        if vi in img_views:
            im = j['images'][img_views[vi]]
            I = Image.open(io.BytesIO(data)); I.load()
            lim = tex.get('base', 2048) if 'basecolor' in (im.get('name') or '').lower() else tex.get('other', 1024)
            if max(I.size) > lim: I = I.resize((lim, lim) if I.size[0] == I.size[1] else (int(I.size[0] * lim / max(I.size)), int(I.size[1] * lim / max(I.size))), Image.LANCZOS)
            buf = io.BytesIO(); I.convert('RGB').save(buf, 'JPEG', quality=88, optimize=True)
            data = buf.getvalue(); im['mimeType'] = 'image/jpeg'
            if im.get('name'): im['name'] = os.path.splitext(im['name'])[0] + '.jpg'
        while len(nb) % 4: nb.append(0)
        bv['byteOffset'] = len(nb); bv['byteLength'] = len(data); nb.extend(data)
    write_glb(dst, j, nb)

def main(argv):
    cfgp = os.path.join(ROOT, 'assets-src/mixamo/clips.json')
    C = json.load(open(cfgp, encoding='utf8'))
    only = set(a for a in argv if not a.startswith('-'))
    body_src = os.path.join(ROOT, C['body'])
    body = Body(body_src)
    outdir = os.path.join(ROOT, 'public/assets/models/anim'); os.makedirs(outdir, exist_ok=True)
    if not only or 'player' in only:
        dst = os.path.join(ROOT, 'public/assets/models/player.glb')
        export_body(body_src, dst, C.get('tex', {}))
        print('player.glb', round(os.path.getsize(dst) / 1e6, 2), 'MB')
    for name, cfg in C['clips'].items():
        if only and name not in only: continue
        src = os.path.join(ROOT, 'assets-src/mixamo', cfg['src'])
        ts, rot, hips = retarget(body, src, cfg)
        ts, rot, hips = shape(ts, rot, hips, cfg)
        if cfg.get('floor', True): hips, lifted = floor_clamp(body, rot, hips)
        else: lifted = 0.0
        p = os.path.join(outdir, name + '.glb')
        export_clip(body, name, ts, rot, hips, p)
        extra = (' loop=' + str(cfg['_loop'])) if '_loop' in cfg else ''
        if lifted > 0.005: extra += f' 바닥보정 최대 {lifted * 100:.0f}cm'
        print(f'{name:14s} ← {cfg["src"]:28s} {ts[-1]:5.2f}s {os.path.getsize(p) // 1024:5d}KB{extra}')

if __name__ == '__main__':
    main(sys.argv[1:])
