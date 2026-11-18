# fbx2glb.py — Mixamo/Tripo FBX → 웹용 GLB (Blender 3.6 / 4.x 백그라운드 실행)
#
#   맥:  BL=/Applications/Blender.app/Contents/MacOS/Blender
#        $BL -b -P tools/fbx2glb.py -- all                 # 아래 규칙으로 전부 변환(바뀐 것만)
#        $BL -b -P tools/fbx2glb.py -- in.fbx out.glb      # 파일 하나(몸·장비)
#        $BL -b -P tools/fbx2glb.py -- in.fbx out.glb --anim   # 애니메이션만(메시 버림)
#
#   all 규칙 (저장소 루트에서 실행):
#     assets-src/models/*.fbx|.glb|.obj  →  public/assets/models/<이름>.glb   (메시+텍스처, 텍스처 최대 1024px)
#     assets-src/mixamo/*.fbx            →  public/assets/models/anim/<이름>.glb (애니메이션만)
#
# 설정 근거: Mixamo 뼈 축 그대로(Automatic Bone Orientation 끔), 끝 뼈 버림(Ignore Leaf Bones),
#           +Y 위, 스킨 O, 모프 X, Draco X(웹에서 디코더 필요), 애니메이션 매 프레임 샘플 + 같은 키 제거.
import bpy, sys, os, glob

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
TEX = 1024
for i, a in enumerate(argv):
    if a == '--tex' and i + 1 < len(argv): TEX = int(argv[i + 1])


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_any(src):
    ext = os.path.splitext(src)[1].lower()
    if ext == '.fbx':
        bpy.ops.import_scene.fbx(filepath=src, automatic_bone_orientation=False, ignore_leaf_bones=True, use_anim=True)
    elif ext in ('.glb', '.gltf'):
        bpy.ops.import_scene.gltf(filepath=src)
    elif ext == '.obj':
        if hasattr(bpy.ops.wm, 'obj_import'): bpy.ops.wm.obj_import(filepath=src)
        else: bpy.ops.import_scene.obj(filepath=src)
    else:
        raise RuntimeError('모르는 형식: ' + src)


def shrink_textures():
    for img in bpy.data.images:
        try:
            w, h = img.size
            if max(w, h) > TEX:
                k = TEX / max(w, h)
                img.scale(max(1, int(w * k)), max(1, int(h * k)))
                if img.packed_file is not None: img.pack()
        except Exception as e:
            print('  텍스처 줄이기 실패', img.name, e)


def export(dst, anim_only):
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    want = dict(
        filepath=dst, export_format='GLB', export_yup=True, export_apply=False,
        export_texcoords=True, export_normals=True, export_tangents=False, export_materials='EXPORT' if not anim_only else 'NONE',
        export_skins=True, export_morph=False, export_def_bones=False,
        export_animations=anim_only, export_force_sampling=True, export_frame_step=1,
        export_optimize_animation_size=True, export_anim_single_armature=True, export_nla_strips=False,
        export_draco_mesh_compression_enable=False, export_image_format='JPEG', export_jpeg_quality=85,
        export_cameras=False, export_lights=False, export_extras=False,
    )
    # 몸 파일에 딸려 온 T포즈 애니메이션은 안 넣음
    kw = {k: v for k, v in want.items() if k in props}
    if 'export_image_format' in kw and 'JPEG' not in [i.identifier for i in bpy.ops.export_scene.gltf.get_rna_type().properties['export_image_format'].enum_items]:
        kw['export_image_format'] = 'AUTO'
    os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
    bpy.ops.export_scene.gltf(**kw)


def convert(src, dst, anim_only):
    print(('[anim] ' if anim_only else '[model] ') + src + ' -> ' + dst)
    reset()
    import_any(src)
    arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
    if anim_only:
        for o in list(bpy.data.objects):
            if o.type != 'ARMATURE': bpy.data.objects.remove(o, do_unlink=True)
        acts = list(bpy.data.actions)
        if not acts: print('  !! 애니메이션 없음'); return
        act = max(acts, key=lambda a: a.frame_range[1] - a.frame_range[0])
        for a in acts:
            if a is not act: bpy.data.actions.remove(a)
        act.name = os.path.splitext(os.path.basename(dst))[0]
        for o in arms:
            o.animation_data_create(); o.animation_data.action = act
        sc = bpy.context.scene
        sc.frame_start, sc.frame_end = int(act.frame_range[0]), int(act.frame_range[1])
    else:
        for o in arms:
            if o.animation_data: o.animation_data.action = None
        for a in list(bpy.data.actions): bpy.data.actions.remove(a)
        shrink_textures()
    export(dst, anim_only)


def newer(src, dst):
    return not os.path.exists(dst) or os.path.getmtime(src) > os.path.getmtime(dst)


if not argv:
    print(__doc__ if '__doc__' in dir() else '사용법은 파일 맨 위 주석'); sys.exit(1)
if argv[0] == 'all':
    root = os.getcwd()
    jobs = []
    for f in sorted(glob.glob(os.path.join(root, 'assets-src/models/*'))):
        if os.path.splitext(f)[1].lower() in ('.fbx', '.glb', '.gltf', '.obj'):
            jobs.append((f, os.path.join(root, 'public/assets/models', os.path.splitext(os.path.basename(f))[0] + '.glb'), False))
    for f in sorted(glob.glob(os.path.join(root, 'assets-src/mixamo/*.fbx'))):
        jobs.append((f, os.path.join(root, 'public/assets/models/anim', os.path.splitext(os.path.basename(f))[0] + '.glb'), True))
    if not jobs: print('assets-src/models, assets-src/mixamo 에 파일이 없음 (저장소 루트에서 실행했는지 확인)')
    n = 0
    for s, d, a in jobs:
        if '--force' in argv or newer(s, d):
            try: convert(s, d, a); n += 1
            except Exception as e: print('  !! 실패', s, e)
    print('변환 %d개 (건너뜀 %d개)' % (n, len(jobs) - n))
else:
    convert(argv[0], argv[1], '--anim' in argv)
