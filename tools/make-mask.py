#!/usr/bin/env python3
"""유니폼 색 마스크 만들기 (R=상의 G=바지 B=스타킹) — public/assets/models/player.mask.png

[model 11-23] 팀 색 셰이더가 텍셀마다 '흰색인지'를 따져 칠해서, 원본 텍스처의 주름 그림자(조금 어두운 곳)는 안 칠해지고
남색 위에 흰 얼룩(군복 무늬)이 남았음 → 미리 영역 마스크를 만들어 주름까지 한 덩어리로 칠한다.

  python3 -I tools/make-mask.py [public/assets/models/player.glb]

방법: UV 공간에 삼각형을 그려 텍셀마다 몸 높이(발=0, 머리=1)를 알아내고,
흐린 텍스처에서 '흰 천'(채도 낮고 밝음)을 고른 뒤 닫힘 연산으로 주름을 메움(피부·검은 소매·신발은 제외),
높이로 상의/바지/스타킹을 나눔(client/anim/clips.js BODY.tint 의 neck·belt·sock 비율과 같게).
"""
import io, json, struct, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

SRC = sys.argv[1] if len(sys.argv) > 1 else 'public/assets/models/player.glb'
OUT = 'public/assets/models/player.mask.png'
N = 2048
NECK, BELT, SOCK = 0.865, 0.585, 0.2  # 실제 몸 기준(벨트 위 끝 ≈ 0.585, 어깨 ≈ 0.86) — clips.js BODY.tint 도 같게

d = open(SRC, 'rb').read()
cl = struct.unpack('<I', d[12:16])[0]
j = json.loads(d[20:20 + cl]); o = 20 + cl + 8

def acc(i):
    a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}[a['componentType']]
    x = np.frombuffer(d, dt, a['count'] * n, o + bv.get('byteOffset', 0) + a.get('byteOffset', 0))
    return x.reshape(-1, n) if n > 1 else x

pr = j['meshes'][0]['primitives'][0]
P = acc(pr['attributes']['POSITION']).astype(float)
UV = acc(pr['attributes']['TEXCOORD_0']).astype(float)
I = acc(pr['indices']).astype(int).reshape(-1, 3)
mat = j['materials'][pr.get('material', 0)]
ti = mat['pbrMetallicRoughness']['baseColorTexture']['index']
im = j['images'][j['textures'][ti]['source']]; bv = j['bufferViews'][im['bufferView']]
T = Image.open(io.BytesIO(d[o + bv.get('byteOffset', 0):o + bv.get('byteOffset', 0) + bv['byteLength']])).convert('RGB').resize((N, N), Image.LANCZOS)

# 1) UV 공간 높이 지도 (삼각형 래스터, 무게중심 보간)
y = P[:, 1]; hn = (y - y.min()) / (y.max() - y.min())
H = np.full((N, N), -1.0)
for t in I:
    u = UV[t] * N
    x0, x1 = int(max(0, u[:, 0].min())), int(min(N - 1, u[:, 0].max()) + 1)
    y0, y1 = int(max(0, u[:, 1].min())), int(min(N - 1, u[:, 1].max()) + 1)
    if x1 <= x0 or y1 <= y0: continue
    X, Y = np.meshgrid(np.arange(x0, x1) + 0.5, np.arange(y0, y1) + 0.5)
    (ax, ay), (bx, by), (cx, cy) = u
    den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if abs(den) < 1e-12: continue
    l0 = ((by - cy) * (X - cx) + (cx - bx) * (Y - cy)) / den
    l1 = ((cy - ay) * (X - cx) + (ax - cx) * (Y - cy)) / den
    l2 = 1 - l0 - l1
    m = (l0 >= -0.02) & (l1 >= -0.02) & (l2 >= -0.02)
    if not m.any(): continue
    hv = l0 * hn[t[0]] + l1 * hn[t[1]] + l2 * hn[t[2]]
    sub = H[y0:y1, x0:x1]; sub[m] = hv[m]
cover = H >= 0

# 2) 흰 천 고르기: 흐린 텍스처에서 채도 낮고 밝은 곳 → 닫힘으로 주름 메움 (피부(채도 높음)·검정은 안 메움)
# 조각 사이 빈 틈을 가까운 조각 색으로 먼저 채움 → 조각 경계에서 마스크가 깎여 흰 실선이 남던 것 방지
_, (gy, gx) = ndimage.distance_transform_edt(~ndimage.binary_erosion(cover, iterations=1), return_indices=True)
Tf = Image.fromarray(np.asarray(T)[gy, gx])
Hf = H[gy, gx]
A = np.asarray(Tf).astype(float) / 255
Ab = np.asarray(Tf.filter(ImageFilter.GaussianBlur(2.5))).astype(float) / 255
def sat_lum(X):
    mx, mn = X.max(2), X.min(2)
    return np.where(mx > 1e-3, (mx - mn) / np.maximum(mx, 1e-3), 0), X @ np.array([0.299, 0.587, 0.114])
sb, lb = sat_lum(Ab); s0, l0 = sat_lum(A)
white = (sb < 0.2) & (lb > 0.42)
fillable = (s0 < 0.3) & (l0 > 0.16)                    # 주름 그림자(회색)는 메워도 됨
white = ndimage.binary_closing(white, iterations=3, border_value=1) & fillable
white = ndimage.binary_opening(white, iterations=1, border_value=1)  # 점 같은 잡티 제거
white = ndimage.binary_dilation(white, iterations=2) & fillable | white  # 남은 잔점(경계 1~2px) 메움

# 3) 높이로 영역 나누기
R = white & (Hf >= BELT) & (Hf < NECK)
G = white & (Hf >= SOCK) & (Hf < BELT)
B = white & (Hf >= 0) & (Hf < SOCK)
M = np.stack([R, G, B], -1).astype(np.uint8) * 255
# 경계 1px 부드럽게 + 조각 사이 빈 틈은 가까운 색으로 채움(밉맵에서 0이 번지지 않게)
Mi = Image.fromarray(M).filter(ImageFilter.GaussianBlur(0.7))
M = np.asarray(Mi)
Image.fromarray(M).resize((1024, 1024), Image.LANCZOS).save(OUT, optimize=True)  # 2048 로 판정, 1024 로 저장(용량)
print(OUT, 'jersey', int(R.sum()), 'pants', int(G.sum()), 'sock', int(B.sum()), 'cover', int(cover.sum()))
