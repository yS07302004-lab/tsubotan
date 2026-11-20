// 手の厥陰心包経（右側で計算）
import { V, axis, argmax, argmin, castIn, fromFront, icsY, mean, mesh, part, rulerMark, slice, type V3 } from './lib.ts';
import { armLandmarks } from './lung.ts';
import { trunkLandmarks } from './kidney.ts';

export function pericardium(lm: Record<string, V3>) {
  const P: Record<string, V3> = {};
  const L: Record<string, V3> = {};
  const arm = armLandmarks();
  const t = trunkLandmarks();
  // 天池：第4肋間、前正中線の外方5寸（乳頭の外方1寸）
  const x1 = -5 * t.H;
  P.PC1 = fromFront(x1, icsY(4, -4 * t.H)); // 第4肋間の高さ（乳頭線で測る）
  // 曲沢：肘窩横紋上、上腕二頭筋腱の内側
  const tendonMed = Math.max(...arm.tendon.map((p) => p.x));
  P.PC3 = fromFront(tendonMed + 0.006, arm.creaseY);
  L['肘窩横紋（曲沢）'] = P.PC3;
  // 大陵：手関節掌側横紋上、長掌筋腱と橈側手根屈筋腱の間
  const pl = mesh('right palmaris longus');
  const fcr = mesh('right flexor carpi radialis');
  const between = (y: number) => {
    const a = slice(pl, 'y', y), b = slice(fcr, 'y', y);
    if (a.length && b.length) return (mean(a).x + mean(b).x) / 2;
    return b.length ? Math.max(...b.map((p) => p.x)) + 0.003 : mean(a).x; // 長掌筋腱が無い高さは橈側手根屈筋腱の内側
  };
  P.PC7 = fromFront(between(arm.wristY), arm.wristY);
  L['手関節掌側横紋（大陵）'] = P.PC7;
  // 郄門・間使・内関：曲沢〜大陵12寸のうち、手関節掌側横紋の上方5寸・3寸・2寸
  for (const [id, s] of [['PC4', 7], ['PC5', 9], ['PC6', 10]] as const) {
    const y = rulerMark(P.PC3, P.PC7, 12, s).y;
    P[id] = fromFront(between(y), y);
  }
  // 天泉：腋窩横紋前端の下方2寸、上腕二頭筋の長頭と短頭の間
  const y2 = rulerMark(lm['腋窩横紋前端'], P.PC3, 9, 2).y;
  const lh = slice(arm.bicepsLong, 'y', y2), sh = slice(arm.bicepsShort, 'y', y2);
  const groove = V((Math.max(...lh.map((p) => p.x)) + Math.min(...sh.map((p) => p.x))) / 2, y2, 0);
  P.PC2 = fromFront(groove.x, y2);
  // 労宮：手掌、第2・第3中手骨の間、中手指節関節の近位
  const hand = mean(part('right capitate'));
  const m2 = axis(part('right second metacarpal bone'), hand), m3 = axis(part('right third metacarpal bone'), hand);
  const a = m2.p0.clone().lerp(m2.p1, 0.78).lerp(m3.p0.clone().lerp(m3.p1, 0.78), 0.5);
  P.PC8 = castIn(a, V(0, 0, 1), 0.05);
  // 中衝：中指の先端中央
  const dp = axis(part('distal phalanx of right middle finger'), hand);
  P.PC9 = castIn(dp.p1, dp.dir, 0.03);
  void argmax; void argmin;
  return { P, L };
}
