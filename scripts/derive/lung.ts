// 手の太陰肺経（右側で計算）。教科書『新版 経絡経穴概論』の部位・取り方に合わせる
import { V, axis, argmax, argmin, cast, castIn, fromFront, mean, mesh, nailCornerPoint, part, redWhite, rulerMark, slice, type V3 } from './lib.ts';


/** 腕の目印（心包経でも使う） */
export function armLandmarks() {
  const H = part('right humerus');
  const low = H.filter((p) => p.y < Math.min(...H.map((q) => q.y)) + 0.04);
  const epiLat = argmin(low, (p) => p.x);
  const epiMed = argmax(low, (p) => p.x);
  const creaseY = (epiLat.y + epiMed.y) / 2; // 肘窩横紋：上腕骨の内側上顆と外側上顆を結ぶ高さ
  const bm = [mesh('long head of right biceps brachii'), mesh('short head of right biceps brachii')];
  const bicepsAt = (y: number) => bm.flatMap((m) => slice(m, 'y', y));
  const tendon = bicepsAt(creaseY + 0.005);
  const R = mesh('right radius');
  const Rv = R.V;
  const styloid = argmin(Rv.filter((p) => p.y < Math.min(...Rv.map((q) => q.y)) + 0.03), (p) => p.x + p.y * 0.5); // 橈骨茎状突起（外側で低い所）
  const wristY = styloid.y + 0.004; // 手関節掌側横紋の高さ：橈骨茎状突起の先端のすぐ上
  const radialArtery = mesh('right radial artery');
  const arteryAt = (y: number) => mean(slice(radialArtery, 'y', y));
  return { creaseY, tendon, bicepsAt, bicepsLong: bm[0], bicepsShort: bm[1], wristY, styloid, arteryAt, radius: R };
}

export function lung(lm: Record<string, V3>) {
  const P: Record<string, V3> = {};
  const L: Record<string, V3> = {};
  const arm = armLandmarks();
  // 中府・雲門：雲門は鎖骨中央のやや外方の下際（烏口突起の内方）、中府はその下方1寸・第1肋間の高さ
  const clav = mesh('right clavicle');
  const x2 = -0.111;
  const clavLow = Math.min(...slice(clav, 'x', x2).map((p) => p.y));
  P.LU2 = fromFront(x2, clavLow - 0.015);
  // 第1肋骨は外側まで届かないので、第1肋間の高さは胸骨のそば（正中から3cm）で測る
  const xs = -0.03;
  const r1 = [...slice(mesh('right first rib'), 'x', xs), ...slice(mesh('right first costal cartilage'), 'x', xs)];
  const r2 = [...slice(mesh('right second rib'), 'x', xs), ...slice(mesh('right second costal cartilage'), 'x', xs)];
  const front = (P: V3[]) => P.filter((p) => p.z > Math.max(...P.map((q) => q.z)) - 0.012);
  const ics1 = (Math.min(...front(r1).map((p) => p.y)) + Math.max(...front(r2).map((p) => p.y))) / 2;
  P.LU1 = fromFront(x2 - 0.004, ics1);
  // 尺沢：肘窩横紋上、上腕二頭筋腱の外側
  const tendonLat = Math.min(...arm.tendon.map((p) => p.x));
  P.LU5 = fromFront(tendonLat - 0.008, arm.creaseY);
  L['肘窩横紋'] = P.LU5;
  // 太淵：手関節掌側横紋上の橈骨動脈拍動部
  const art = arm.arteryAt(arm.wristY);
  P.LU9 = fromFront(art.x, arm.wristY);
  L['手関節掌側横紋'] = P.LU9;
  // 孔最：尺沢と太淵を結ぶ線上、手関節掌側横紋の上方7寸（尺沢から5寸）
  P.LU6 = rulerMark(P.LU5, P.LU9, 12, 5);
  // 経渠：太淵の上方1寸、橈骨下端の外側の高まりと橈骨動脈の間
  const y8 = rulerMark(P.LU5, P.LU9, 12, 11).y;
  const radLat8 = Math.min(...slice(arm.radius, 'y', y8).map((p) => p.x));
  const a8 = arm.arteryAt(y8);
  P.LU8 = castIn(V((radLat8 + a8.x) / 2, y8, a8.z), V(-0.4, 0, 1));
  // 列缺：太淵の上方1寸5分、長母指外転筋腱と短母指伸筋腱の間（橈側）
  const y7 = rulerMark(P.LU5, P.LU9, 12, 10.5).y;
  const apl = [...slice(mesh('right abductor pollicis longus'), 'y', y7), ...slice(mesh('right extensor pollicis brevis'), 'y', y7)];
  const c7 = apl.length ? mean(apl) : mean(slice(arm.radius, 'y', y7));
  P.LU7 = castIn(c7, V(-1, 0, 0.35));
  // 天府・侠白：腋窩横紋前端の下方3寸・4寸、上腕二頭筋の外側縁
  const fold = lm['腋窩横紋前端'];
  for (const [id, s] of [['LU3', 3], ['LU4', 4]] as const) {
    const y = rulerMark(fold, P.LU5, 9, s).y;
    const sec = arm.bicepsAt(y);
    const edge = argmin(sec, (p) => p.x);
    P[id] = castIn(edge, V(-1, 0, 0.7));
  }
  // 魚際：第1中手骨の中点の橈側、赤白肉際
  const hand = mean(part('right third metacarpal bone'));
  const mc1 = axis(part('right first metacarpal bone'), hand);
  const mc2 = axis(part('right second metacarpal bone'), hand);
  const thumbDorsal = V(-1, 0, -0.3); // 母指の背側（爪の向き）
  const radial = mc1.mid.clone().sub(mc2.mid); // 第2中手骨から離れる向き＝橈側
  P.LU10 = redWhite(mc1.mid, mc1.dir, thumbDorsal, radial);
  // 少商：母指爪甲の橈側・近位の角から近位外方1分
  P.LU11 = nailCornerPoint('thumb', 'lateral');
  void cast;
  return { P, L };
}
