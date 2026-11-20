"""皮膚の頂点を「普通の皮膚 / 手掌・足底（赤白肉際の白い側）/ 爪」に分ける。

    python3 scripts/skin_regions.py   # → scripts/skin-regions.txt（頂点ごとに 0/1/2 の1文字）

convert-bp3d.mjs がこれを読んで skin.glb に頂点色（COLOR_0）を付ける。
- 爪：末節骨の上で、皮膚がいちばん薄い側（背側）にある部分
- 手掌・足底：手と足の皮膚のうち、法線が掌側・足底側を向いている部分。境目がおおよその赤白肉際になる
BodyParts3D（CC BY-SA 2.1 JP）の bp3d/ にある OBJ を使う（scripts/download-bp3d.sh。is_a 版の zip も必要）。
"""
import collections, os, sys
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, 'bp3d')
DIRS = [os.path.join(BP, 'partof_BP3D_4.0_obj_99'), os.path.join(BP, 'isa_BP3D_4.0_obj_99')]

names = collections.defaultdict(set)
for f in ['isa_element_parts.txt', 'partof_element_parts.txt']:
    for line in list(open(os.path.join(BP, f), encoding='utf-8'))[1:]:
        c, n, fj = line.rstrip('\n').split('\t')
        names[n].add(fj)


def read_obj(fj):
    for d in DIRS:
        p = os.path.join(d, fj + '.obj')
        if os.path.exists(p):
            V, N, F = [], [], []
            for line in open(p):
                if line.startswith('v '): V.append(list(map(float, line.split()[1:4])))
                elif line.startswith('vn '): N.append(list(map(float, line.split()[1:4])))
                elif line.startswith('f '): F.append([int(t.split('/')[0]) - 1 for t in line.split()[1:4]])
            V = np.array(V); V = np.c_[V[:, 0], V[:, 2], -V[:, 1]] / 1000  # アプリ座標(m, Y-up)
            N = np.array(N) if N else None
            if N is not None: N = np.c_[N[:, 0], N[:, 2], -N[:, 1]]
            return V, N, np.array(F)
    return None


def part(n):
    vs = [read_obj(f) for f in sorted(names.get(n, []))]
    vs = [v[0] for v in vs if v is not None]
    if not vs: raise KeyError(n)
    return np.vstack(vs)


SV, SN, SF = read_obj('FJ2810')  # skin
SN = SN / np.linalg.norm(SN, axis=1, keepdims=True)
cls = np.zeros(len(SV), np.int8)

# 皮膚の OBJ は外側の面と内側の面（約2mm内側）の2枚。判定は外側の面の頂点だけで行う
_parent = np.arange(len(SV))
def _find(x):
    while _parent[x] != x:
        _parent[x] = _parent[_parent[x]]; x = _parent[x]
    return x
for a_, b_, c_ in SF:
    ra = _find(a_); _parent[_find(b_)] = ra; _parent[_find(c_)] = ra
_roots = np.array([_find(i) for i in range(len(SV))])
_best = max(np.unique(_roots), key=lambda r: np.prod(np.ptp(SV[_roots == r], axis=0)) if (_roots == r).sum() > 1000 else 0)
OUTER = _roots == _best


def near(P, cand_idx, chunk=400):
    """cand_idx の皮膚頂点から点群 P までの最短距離"""
    d = np.full(len(cand_idx), 9.0)
    C = SV[cand_idx]
    for i in range(0, len(P), chunk):
        d = np.minimum(d, np.sqrt(((C[:, None, :] - P[None, i:i + chunk, :]) ** 2).sum(2)).min(1))
    return d


def axis(P, toward_far_from):
    c = P.mean(0); a = np.linalg.svd(P - c, full_matrices=False)[2][0]
    t = (P - c) @ a; p0, p1 = c + a * t.min(), c + a * t.max()
    if np.linalg.norm(p0 - toward_far_from) > np.linalg.norm(p1 - toward_far_from): p0, p1 = p1, p0
    return c, p0, p1  # p0=近位, p1=遠位


FINGERS = ['thumb', 'index finger', 'middle finger', 'ring finger', 'little finger']
TOES = ['big toe', 'second toe', 'third toe', 'fourth toe', 'little toe']
summary = []
for side in ['right', 'left']:
    hand_c = np.vstack([part(f'{side} {o} metacarpal bone') for o in ['first', 'second', 'third', 'fourth', 'fifth']]).mean(0)
    foot_c = part(f'{side} talus').mean(0)
    dorsals = {}
    for digit, center in [(d, hand_c) for d in FINGERS] + [(d, foot_c) for d in TOES]:
        B = part(f'distal phalanx of {side} {digit}')
        c, p0, p1 = axis(B, center)
        L = np.linalg.norm(p1 - p0); a = (p1 - p0) / L
        idx = np.where(OUTER & (np.linalg.norm(SV - c, axis=1) < 0.03))[0]
        rel = SV[idx] - p0; t = rel @ a / L
        r = rel - np.outer(rel @ a, a); rn = r / np.maximum(np.linalg.norm(r, axis=1, keepdims=True), 1e-9)
        # 爪の向き（背側）：皮膚の厚さでは足指の腹（床に押されて薄い）を拾ってしまうので、解剖学的正位の向きから決める
        #   手指=手背（-Z）、母指=外側（体の外）とやや後ろ、足指=上（+Y）。それぞれ骨の長軸に直交する成分を使う
        lateral = -1.0 if side == 'right' else 1.0
        hint = np.array([0.0, 1.0, 0.0]) if digit in TOES else np.array([lateral, 0.0, -0.3]) if digit == 'thumb' else np.array([0.0, 0.0, -1.0])
        dorsal = hint - a * (hint @ a); dorsal /= np.linalg.norm(dorsal)
        dorsals[digit] = (dorsal, idx)
        nail = (t > 0.3) & (t < 0.97) & (rn @ dorsal > np.cos(np.radians(60))) & (SN[idx] @ dorsal > 0.2)
        # 爪は scripts/nails.py で別の形として作るので、ここでは塗らない
        summary.append((side, digit, int(nail.sum())))
    # 手掌：手の骨の近くの皮膚で、法線が掌側を向く所
    palm_dir = -np.mean([dorsals[d][0] for d in FINGERS[1:]], axis=0); palm_dir /= np.linalg.norm(palm_dir)
    thumb_bones = [f'{side} first metacarpal bone', f'proximal phalanx of {side} thumb', f'distal phalanx of {side} thumb']
    other = [f'{side} {o} metacarpal bone' for o in ['second', 'third', 'fourth', 'fifth']]
    for dgt in FINGERS[1:]:
        for seg_name in ['proximal', 'middle', 'distal']:
            other.append(f'{seg_name} phalanx of {side} {dgt}')
    hand_idx = np.where(OUTER & (np.linalg.norm(SV - hand_c, axis=1) < 0.13))[0]
    dt = near(np.vstack([part(n) for n in thumb_bones]), hand_idx)
    do = near(np.vstack([part(n) for n in other]), hand_idx)
    in_hand = np.minimum(dt, do) < 0.022
    wrist_y = part(f'{side} radius')[:, 1].min()
    in_hand &= SV[hand_idx, 1] < wrist_y - 0.005
    pal = np.where((dt < do)[:, None], -dorsals['thumb'][0], palm_dir)
    is_palm = in_hand & ((SN[hand_idx] * pal).sum(1) > 0.25) & (cls[hand_idx] != 2)
    cls[hand_idx[is_palm]] = 1
    # 足底：足の骨の近くで、法線が下（足指は足底側）を向く所
    foot_bones = [f'{side} calcaneus', f'{side} talus', f'navicular bone of {side} foot', f'{side} cuboid bone'] + \
        [f'{side} {o} metatarsal bone' for o in ['first', 'second', 'third', 'fourth', 'fifth']]
    foot_idx = np.where(OUTER & (np.linalg.norm(SV - foot_c, axis=1) < 0.2))[0]
    foot_idx = foot_idx[SV[foot_idx, 1] < foot_c[1]]
    dfoot = near(np.vstack([part(n) for n in foot_bones if n in names]), foot_idx)
    toe_dirs = np.array([-dorsals[t][0] for t in TOES]).mean(0); toe_dirs /= np.linalg.norm(toe_dirs)
    plantar = np.tile([0, -1, 0], (len(foot_idx), 1)).astype(float)
    is_sole = (dfoot < 0.03) & ((SN[foot_idx] * plantar).sum(1) > 0.35) & (cls[foot_idx] != 2)
    cls[foot_idx[is_sole]] = 1

# 境目のギザギザ・まだらを減らす：手掌・足底かどうかを、隣の頂点との多数決で数回ならす（爪はそのまま）
nbr = [[] for _ in range(len(SV))]
for a_, b_, c_ in SF:
    nbr[a_] += [b_, c_]; nbr[b_] += [a_, c_]; nbr[c_] += [a_, b_]
region = np.where((SV[:, 1] < 0.95) & ((np.abs(SV[:, 0]) > 0.2) | (SV[:, 1] < 0.02)))[0]  # 手と足のあたりだけ
for _ in range(4):
    new = cls.copy()
    for v in region:
        if cls[v] == 2 or not nbr[v]: continue
        ns = cls[nbr[v]]
        ns = ns[ns != 2]
        if len(ns) == 0: continue
        new[v] = 1 if (ns == 1).mean() + (0.5 if cls[v] == 1 else 0) / len(ns) > 0.5 else 0
    cls = new

if __name__ == '__main__':
    out = os.path.join(ROOT, 'scripts', 'skin-regions.txt')
    open(out, 'w').write(''.join(map(str, cls.tolist())))
    print('nails:', summary)
    print('counts', np.bincount(cls), '->', out)
