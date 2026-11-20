"""爪の形（皮膚の上に重ねる薄い板）を作る。

    python3 scripts/nails.py   # → scripts/nails.json（convert-bp3d.mjs が public/models/nails.glb にする）

爪の位置（解剖の一般的な所見による）：
- 末節骨の背側。見えている爪は後爪郭（爪の根元）から指先まで。後爪郭は DIP 関節と指先の間で、
  爪母はそこから DIP 関節側へ半分ほど入り込んでいる → 末節骨の長さの約4割の所から先を爪とする
- 幅は指の背側のほぼいっぱい（横から見て±55°ほど）。根元は丸く、先端（遊離縁）も丸い
背側の向き：手指＝中手骨の並ぶ面の手背側、母指＝指腹（いちばん厚い側）の反対、足指＝上
"""
import json, os
import numpy as np
from skin_regions import OUTER, SF, SV, part  # 皮膚（外側の面）と部品の読み込みを共用

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
F = SF[OUTER[SF[:, 0]]]
T0, T1, T2 = SV[F[:, 0]], SV[F[:, 1]], SV[F[:, 2]]
E1, E2 = T1 - T0, T2 - T0


def ray(o, d):
    d = d / np.linalg.norm(d)
    p = np.cross(d, E2); det = (E1 * p).sum(1)
    ok = np.abs(det) > 1e-14; inv = np.zeros_like(det); inv[ok] = 1 / det[ok]
    s = o - T0; u = (s * p).sum(1) * inv; q = np.cross(s, E1); v = (q * d).sum(1) * inv; t = (E2 * q).sum(1) * inv
    m = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 1e-6)
    if not m.any(): return None
    return o + d * t[m].min()


def axis(P, far_from):
    c = P.mean(0); a = np.linalg.svd(P - c, full_matrices=False)[2][0]
    t = (P - c) @ a; p0, p1 = c + a * t.min(), c + a * t.max()
    if np.linalg.norm(p0 - far_from) > np.linalg.norm(p1 - far_from): p0, p1 = p1, p0
    return p0, p1


def perp(v, a):
    v = v - a * (v @ a); return v / np.linalg.norm(v)


TOE_HALF_MM = {'big toe': 7.0, 'second toe': 4.5, 'third toe': 4.2, 'fourth toe': 4.0, 'little toe': 3.2}
FINGERS = ['thumb', 'index finger', 'middle finger', 'ring finger', 'little finger']
TOES = ['big toe', 'second toe', 'third toe', 'fourth toe', 'little toe']
HALF_WIDTH = {'thumb': 55, 'little finger': 50, 'big toe': 50, 'second toe': 45, 'third toe': 45, 'fourth toe': 42, 'little toe': 40}
out = []
for side in ['right', 'left']:
    lateral = np.array([-1.0, 0, 0]) if side == 'right' else np.array([1.0, 0, 0])
    mcs = [part(f'{side} {o} metacarpal bone') for o in ['second', 'third', 'fourth', 'fifth']]
    hand_c = np.vstack(mcs).mean(0)
    # 手背の向き：第2〜5中手骨の重心が作る面の法線のうち、後ろ（-Z）寄りの向き
    cs = np.array([m.mean(0) for m in mcs] + [axis(m, hand_c)[1] for m in mcs])
    n = np.linalg.svd(cs - cs.mean(0))[2][2]
    hand_dorsal = n if n[2] < 0 else -n
    foot_c = part(f'{side} talus').mean(0)
    for digit in FINGERS + TOES:
        B = part(f'distal phalanx of {side} {digit}')
        center = foot_c if digit in TOES else hand_c
        p0, p1 = axis(B, center)
        L = np.linalg.norm(p1 - p0); a = (p1 - p0) / L
        if digit in TOES:
            dorsal = perp(np.array([0, 1.0, 0]), a)
        elif digit == 'thumb':
            # 指腹（皮膚がいちばん厚い向き）の反対
            m = p0 + a * L * 0.6
            best = None
            for k in range(36):
                ang = np.radians(k * 10)
                u0 = perp(np.array([0, 0, 1.0]), a); u1 = np.cross(a, u0)
                d = np.cos(ang) * u0 + np.sin(ang) * u1
                h = ray(m + d * 0.04, -d)
                if h is None: continue
                th = np.linalg.norm(h - m)
                if best is None or th > best[0]: best = (th, d)
            dorsal = -best[1]
        else:
            dorsal = perp(hand_dorsal, a)
        s = np.cross(a, dorsal)  # 横方向
        if s @ lateral < 0: s = -s  # s を体の外側（手は橈側、足は小指側）に向ける
        tip = ray(p1 + a * 0.03, -a)
        tip_t = 1.0 + (np.linalg.norm(tip - p1) / L if tip is not None else 0.15)
        w = np.radians(HALF_WIDTH.get(digit, 55))
        t_prox, t_end = 0.52, 1.0 + (tip_t - 1.0) * 0.72   # 根元は末節骨の約半分、先端は指先のすぐ手前

        def make_grid(t_prox, t_end, wscale, lift, nu=18, nv=15):
            grid = np.zeros((nu, nv, 3))
            radius = None
            for i in range(nu):
                for j in range(nv):
                    q = -1 + 2 * j / (nv - 1)
                    th = q * w * wscale
                    t0 = t_prox + 0.10 * q * q          # 根元は丸く（中央がいちばん近位）
                    t1 = t_end - 0.07 * q * q           # 先端も丸く
                    t = t0 + (t1 - t0) * i / (nu - 1)
                    ap = p0 + a * L * t
                    if digit in TOES:
                        # 足指は短くずんぐりしているので、上から真下（背側から）へ投影する。幅は mm で決める
                        off = q * TOE_HALF_MM[digit] * wscale / 1000
                        o = ap + s * off + dorsal * 0.02
                        h = ray(o, -dorsal)
                        if h is None or np.linalg.norm(h - (ap + s * off)) > 0.015:
                            h = ap + s * off + dorsal * (radius or 0.005)
                        else:
                            radius = (h - (ap + s * off)) @ dorsal
                        grid[i, j] = h + dorsal * lift
                        continue
                    d = np.cos(th) * dorsal + np.sin(th) * s
                    # 隣の指に当たらないよう、骨のすぐ外（1.5cm）から撃ち、遠すぎる当たりは捨てる
                    h = ray(ap + d * 0.015, -d)
                    if h is None or np.linalg.norm(h - ap) > 0.013:
                        h = ap + d * (radius if radius else 0.006)
                    else:
                        radius = np.linalg.norm(h - ap)
                    grid[i, j] = h + d * lift
            return grid

        def tris(nu, nv):
            idx = []
            for i in range(nu - 1):
                for j in range(nv - 1):
                    k = i * nv + j
                    idx += [k, k + nv, k + 1, k + 1, k + nv, k + nv + 1]
            return idx

        # 爪甲は皮膚とほぼ同じ高さ（0.3mm）。周りの爪郭は少し大きく、さらに低く（0.15mm）・暗めに描いて、くぼんで見せる
        grid = make_grid(t_prox, t_end, 1.0, 0.0003)
        rim = make_grid(t_prox - 0.07, t_end + 0.02, 1.13, 0.00015)
        nu, nv = grid.shape[0], grid.shape[1]
        pos = grid.reshape(-1, 3)
        idx = tris(nu, nv)
        out.append({
            'side': 'R' if side == 'right' else 'L', 'digit': digit,
            'positions': np.round(pos, 5).tolist(), 'indices': idx,
            'rimPositions': np.round(rim.reshape(-1, 3), 5).tolist(), 'rimIndices': tris(rim.shape[0], rim.shape[1]),
            'cornerLateral': np.round(grid[0, nv - 1], 5).tolist(),   # 爪甲の根元・外側（手は橈側、足は外側）の角
            'cornerMedial': np.round(grid[0, 0], 5).tolist(),
            'axis': np.round(a, 5).tolist(), 'lateralDir': np.round(s, 5).tolist(),
        })
json.dump({'nails': out}, open(os.path.join(ROOT, 'scripts', 'nails.json'), 'w'))
print(len(out), 'nails -> scripts/nails.json')
