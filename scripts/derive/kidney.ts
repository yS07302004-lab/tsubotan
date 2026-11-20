// 足の少陰腎経（右側で計算）。教科書：下腿は内果尖〜膝窩横紋1尺5寸、足は内果尖〜足底3寸、
// 腹部は前正中線の外方5分、胸部は前正中線と乳頭線の中間（2寸）。横の寸は両乳頭間8寸
import { V, argmin, cast, fromFront, icsY, mean, mesh, part, redWhite, rulerMark, slice, type V3 } from './lib.ts';

/** 体幹の目印（臍・恥骨結合・胸骨体下端・乳頭・前正中線）。心包経でも使う */
export function trunkLandmarks() {
  // 臍：前正中線上で前からの深さが局所的にいちばん深い所
  const prof: V3[] = [];
  for (let y = 0.85; y <= 1.12; y += 0.002) prof.push(fromFront(0, y));
  let navel = prof[0], best = -1;
  for (let i = 5; i < prof.length - 5; i++) {
    const depth = (prof[i - 5].z + prof[i + 5].z) / 2 - prof[i].z;
    if (depth > best) { best = depth; navel = prof[i]; }
  }
  const hip = mesh('right hip bone');
  const symTop = Math.max(...slice(hip, 'x', -0.004).map((p) => p.y));
  const sym = fromFront(0, symTop);
  const xsY = Math.min(...part('body of sternum').map((p) => p.y));
  const xs = fromFront(0, xsY);
  // 乳頭：右胸で前への出っ張りがいちばん大きい所
  let nip = V(0, 0, 0), bp = -1;
  for (let x = -0.13; x <= -0.09; x += 0.001) for (let y = 1.17; y <= 1.23; y += 0.001) {
    const c = fromFront(x, y).z;
    const ring = [[0.008, 0], [-0.008, 0], [0, 0.008], [0, -0.008]].map(([dx, dy]) => fromFront(x + dx, y + dy).z);
    const p = c - ring.reduce((a, b) => a + b) / 4;
    if (p > bp) { bp = p; nip = fromFront(x, y); }
  }
  const H = Math.abs(nip.x) / 4; // 胸腹部の横の1寸
  return { navel, sym, xs, nip, H, mid: fromFront(0, nip.y) };
}

export function kidney(lm: Record<string, V3>) {
  const P: Record<string, V3> = {};
  const L: Record<string, V3> = {};
  const t = trunkLandmarks();
  const medial = V(1, 0, 0); // 右脚の内側（正中へ向かう向き）
  const med = (y: number, z: number) => cast(V(0, y, z), medial.clone().negate()); // 両脚の間から内側面へ
  // 下腿・足の目印
  const tib = part('right tibia');
  const low = tib.filter((p) => p.y < Math.min(...tib.map((q) => q.y)) + 0.06);
  const mmx = Math.max(...low.map((p) => p.x));
  const mt = argmin(low.filter((p) => p.x > mmx - 0.006), (p) => p.y); // 内果尖
  L['内果尖'] = med(mt.y, mt.z);
  L['膝窩横紋'] = cast(V(-0.036, 0.37, -1), V(0, 0, 1)); // 膝窩横紋の内側寄り、半腱様筋腱の外縁（陰谷）
  const floorY = cast(V(-0.07, -0.5, 0.045), V(0, 1, 0)).y;
  const footU = (L['内果尖'].y - floorY) / 3; // 内果尖〜足底 3寸
  const leg = (s: number) => rulerMark(L['内果尖'], L['膝窩横紋'], 15, s);
  const legU = L['内果尖'].distanceTo(L['膝窩横紋']) / 15;
  const pta = mean(slice(mesh('right posterior tibial artery'), 'y', mt.y)); // 後脛骨動脈
  P.KI1 = (() => {
    const hand = mean(part('right talus'));
    const web = mean([...part('proximal phalanx of right second toe'), ...part('proximal phalanx of right third toe')]);
    const heel = argmin(part('right calcaneus'), (p) => p.z);
    void hand;
    const at = web.clone().lerp(heel, 1 / 3);
    return cast(V(at.x, -0.5, at.z), V(0, 1, 0)); // 第2・第3指間と踵を結ぶ線の前1/3、足底
  })();
  const nt = argmin(part('navicular bone of right foot'), (p) => -p.x); // 舟状骨粗面（最も内側）
  // 然谷：内果の前下方、舟状骨の尖った所の直下で表裏の境目（赤白肉際）
  P.KI2 = redWhite(nt, V(0, 0, 1), medial, V(0, -1, 0));
  P.KI3 = med(mt.y, pta.z);
  P.KI5 = med(mt.y - footU, pta.z - 0.002);
  P.KI4 = med((P.KI3.y + P.KI5.y) / 2, pta.z - 0.015);
  P.KI6 = med(L['内果尖'].y - footU, mt.z);
  P.KI7 = med(leg(2).y, 0.053);
  P.KI8 = med(leg(2).y, 0.053 + legU / 2);
  P.KI9 = med(leg(5).y, 0.062);
  P.KI10 = L['膝窩横紋'].clone();
  // 腹部：臍中央〜恥骨結合上縁5寸、胸骨体下端〜臍中央8寸、前正中線の外方5分
  const ab = (y: number) => fromFront(-t.H / 2, y);
  P.KI11 = ab(t.sym.y);
  for (const [id, s] of [['KI12', 4], ['KI13', 3], ['KI14', 2], ['KI15', 1]] as const) P[id] = ab(rulerMark(t.navel, t.sym, 5, s).y);
  P.KI16 = ab(t.navel.y);
  for (const [id, s] of [['KI17', 2], ['KI18', 3], ['KI19', 4], ['KI20', 5], ['KI21', 6]] as const) P[id] = ab(rulerMark(t.navel, t.xs, 8, s).y);
  // 胸部：前正中線と乳頭線の中間（2寸）、各肋間
  const x2 = -2 * t.H;
  for (const [id, n] of [['KI22', 5], ['KI23', 4], ['KI24', 3], ['KI25', 2], ['KI26', 1]] as const) P[id] = fromFront(x2, icsY(n, x2));
  const clavLow = Math.min(...slice(mesh('right clavicle'), 'x', x2).map((p) => p.y));
  P.KI27 = fromFront(x2, clavLow - 0.004);
  void lm;
  return { P, L, mid: { '臍中央': t.navel, '恥骨結合上縁': t.sym, '胸骨体下端': t.xs, '前正中線': t.mid }, side: { '乳頭線': t.nip } };
}
