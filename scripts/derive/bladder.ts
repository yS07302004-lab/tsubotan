// 足の太陽膀胱経（右側で計算）
// 頭：眉間〜大椎を1尺8寸として前髪際（眉間の上3寸）・後髪際（大椎の上3寸）を決め、前髪際〜後髪際1尺2寸。横は両乳様突起間9寸
// 背：各棘突起下縁の高さ、後正中線の外方1寸5分・3寸（肩甲棘内端縁間6寸）。仙骨：後仙骨孔（上後腸骨棘の高さから）
// 下肢：殿溝〜膝窩1尺4寸、膝窩〜外果尖1尺6寸
import { V, argmax, argmin, axis, cast, castIn, fromBack, fromFront, mean, mesh, nailCornerPoint, part, redWhite, rulerMark, slice, S, type V3 } from './lib.ts';

const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
const LATERAL = V(-1, 0, 0); // 右の外側

/** 棘突起の先端（いちばん後ろ）の下縁の高さ */
function spinousLow(name: string) {
  const P = part(name);
  const zmin = Math.min(...P.map((p) => p.z));
  return Math.min(...P.filter((p) => p.z < zmin + 0.008).map((p) => p.y));
}
function spinousHigh(name: string) {
  const P = part(name);
  const zmin = Math.min(...P.map((p) => p.z));
  return Math.max(...P.filter((p) => p.z < zmin + 0.008).map((p) => p.y));
}

export function headLandmarks() {
  // 眉間：顔の正中の輪郭で、鼻根のくぼみのすぐ上の出っ張り
  const prof: V3[] = [];
  for (let y = 1.45; y <= 1.62; y += 0.002) prof.push(fromFront(0, y));
  const nasion = argmin(prof.filter((p) => p.y > 1.48 && p.y < 1.56), (p) => p.z);
  const glabella = argmax(prof.filter((p) => p.y > nasion.y && p.y < nasion.y + 0.04), (p) => p.z);
  const daitsui = fromBack(0, spinousLow('seventh cervical vertebra') - 0.003); // 大椎：第7頸椎棘突起の下
  // 正中矢状面の頭の輪郭：頭の中心から外へ向けた線を回しながら皮膚に当てる（眉間→頭頂→後頸部）
  const c = V(0, 1.5, 0.07);
  const sag: V3[] = [];
  const a0 = Math.atan2(glabella.y - c.y, glabella.z - c.z);
  for (let a = a0; a < Math.PI * 1.5; a += 0.01) {
    const d = V(0, Math.sin(a), Math.cos(a));
    const p = cast(c.clone().addScaledVector(d, 0.3), d.clone().negate());
    if (sag.length && p.y < daitsui.y) break;
    sag.push(p);
  }
  sag.push(daitsui);
  const cum = [0];
  for (let i = 1; i < sag.length; i++) cum.push(cum[i - 1] + sag[i].distanceTo(sag[i - 1]));
  const sun = cum[cum.length - 1] / 18;
  const atLen = (d: number) => { let i = 1; while (i < cum.length - 1 && cum[i] < d) i++; return sag[i - 1].clone().lerp(sag[i], (d - cum[i - 1]) / (cum[i] - cum[i - 1])); };
  const front = atLen(3 * sun), back = atLen(15 * sun);
  // 乳様突起：側頭骨の外側で最も低い所
  const tR = part('right temporal bone').filter((p) => p.x < -0.05), tL = part('left temporal bone').filter((p) => p.x > 0.05);
  const mR = argmin(tR, (p) => p.y), mL = argmin(tL, (p) => p.y);
  const headSun = mR.distanceTo(mL) / 9;
  return { glabella, daitsui, front, back, sun, headSun };
}

export function bladder(lm: Record<string, V3>) {
  const P: Record<string, V3> = {};
  const L: Record<string, V3> = {};
  const M: Record<string, V3> = {};
  const h = headLandmarks();
  M['眉間'] = h.glabella;
  M['前髪際中点'] = h.front;
  M['後髪際中点'] = h.back;
  // 睛明・攅竹
  const eye = part('right eyeball').filter((p) => p.x < -0.005);
  const ec = mean(eye);
  const inner = Math.max(...eye.map((p) => p.x));
  P.BL1 = fromFront(inner + 0.004, ec.y + 0.003);
  const fr = mesh('frontal bone');
  // 眼窩上縁：眼球の中心より少し内側の縦断面で、眼球より上・前にある前頭骨の最も低い所
  const rim = slice(fr, 'x', ec.x + 0.008).filter((p) => p.z > ec.z - 0.005 && p.y > ec.y + 0.008);
  const rimY = rim.length ? Math.min(...rim.map((p) => p.y)) : ec.y + 0.018;
  P.BL2 = fromFront(P.BL1.x, rimY + 0.003);
  // 頭部の第1行線（前正中線の外方1寸5分）：前髪際の後方 s 寸
  const sag = S.ruler(h.front, h.back, 24, 0); // 前髪際〜後髪際 1尺2寸（アプリの物差しと同じ計算）
  const onHead = (s: number, lat: number) => {
    const m = sag[Math.round(s * 2)];
    return castIn(m.point.clone().addScaledVector(LATERAL, lat * h.headSun), m.normal, 0.06);
  };
  P.BL3 = onHead(0.5, 0.75); // 神庭と曲差の中点
  P.BL4 = onHead(0.5, 1.5);
  P.BL5 = onHead(1, 1.5);
  P.BL6 = onHead(2.5, 1.5);
  P.BL7 = onHead(4, 1.5);
  P.BL8 = onHead(5.5, 1.5);
  // 玉枕：外後頭隆起上縁の高さ、外方1寸3分。天柱：第2頸椎棘突起上縁の高さ、外方1寸3分
  const occ = part('occipital bone').filter((p) => Math.abs(p.x) < 0.006);
  const eop = argmin(occ, (p) => p.z);
  P.BL9 = fromBack(-1.3 * h.headSun, eop.y + 0.004);
  P.BL10 = fromBack(-1.3 * h.headSun, spinousHigh('axis'));
  // 背部：肩甲棘内端縁間6寸 → 後正中線〜肩甲棘内端＝3寸
  const sc = part('right scapula');
  const zmin = Math.min(...sc.map((p) => p.z));
  const spineEnd = argmax(sc.filter((p) => p.z < zmin + 0.015), (p) => p.x);
  const bs = Math.abs(spineEnd.x) / 3; // 背部の横の1寸
  L['肩甲棘内端'] = fromBack(spineEnd.x, spineEnd.y);
  M['後正中線'] = fromBack(0, spineEnd.y);
  const T = (n: number) => spinousLow(`${ORD[n - 1]} thoracic vertebra`);
  const Lu = (n: number) => spinousLow(`${ORD[n - 1]} lumbar vertebra`);
  const inner15 = (y: number) => fromBack(-1.5 * bs, y);
  const outer3 = (y: number) => fromBack(-3 * bs, y);
  const levels: [string, number][] = [
    ['BL11', T(1)], ['BL12', T(2)], ['BL13', T(3)], ['BL14', T(4)], ['BL15', T(5)], ['BL16', T(6)], ['BL17', T(7)], ['BL18', T(9)],
    ['BL19', T(10)], ['BL20', T(11)], ['BL21', T(12)], ['BL22', Lu(1)], ['BL23', Lu(2)], ['BL24', Lu(3)], ['BL25', Lu(4)], ['BL26', Lu(5)],
  ];
  for (const [id, y] of levels) P[id] = inner15(y);
  const outerLv: [string, number][] = [
    ['BL41', T(2)], ['BL42', T(3)], ['BL43', T(4)], ['BL44', T(5)], ['BL45', T(6)], ['BL46', T(7)], ['BL47', T(9)], ['BL48', T(10)],
    ['BL49', T(11)], ['BL50', T(12)], ['BL51', Lu(1)], ['BL52', Lu(2)],
  ];
  for (const [id, y] of outerLv) P[id] = outer3(y);
  // 仙骨：上髎は上後腸骨棘の頂点の高さ、次髎は上後腸骨棘の下縁の高さで上後腸骨棘と正中仙骨稜のほぼ中央。中髎・下髎はその下のくぼみ
  const hip = part('right hip bone').filter((p) => p.x > -0.07 && p.y > 0.85);
  const hz = Math.min(...hip.map((p) => p.z));
  const psis = hip.filter((p) => p.z < hz + 0.006);
  const psisX = mean(psis).x;
  const s1 = Math.max(...psis.map((p) => p.y)), s2 = Math.min(...psis.map((p) => p.y)), gap = s1 - s2;
  const sy = [s1, s2, s2 - gap, s2 - 2 * gap];
  const sx = [0.58, 0.5, 0.43, 0.37].map((k) => psisX * k); // 下へ行くほど正中に近づく
  ['BL31', 'BL32', 'BL33', 'BL34'].forEach((id, i) => (P[id] = fromBack(sx[i], sy[i])));
  ['BL27', 'BL28', 'BL29', 'BL30'].forEach((id, i) => (P[id] = inner15(sy[i])));
  P.BL53 = outer3(sy[1]);
  P.BL54 = outer3(sy[3]);
  // 会陽：尾骨下端の外方5分（尾骨はモデルに無いので仙骨の下端から2.5cm下と見積もる）
  const sacLow = Math.min(...part('sacrum').map((p) => p.y));
  P.BL35 = fromBack(-0.5 * bs, sacLow - 0.025);
  // 大腿後面：承扶＝殿溝の中点、委中＝膝窩横紋の中点
  const fe = mesh('right femur');
  const cond = slice(fe, 'y', 0.385);
  const kneeX = (Math.min(...cond.map((p) => p.x)) + Math.max(...cond.map((p) => p.x))) / 2;
  P.BL40 = fromBack(kneeX, 0.372);
  // 殿溝：大腿後面の中線（大腿二頭筋と半腱様筋の間）で、坐骨結節の下にある後ろからのへこみ
  const bfm = mesh('long head of right biceps femoris'), stm = mesh('right semitendinosus');
  const isch = argmin(part('right hip bone').filter((p) => p.y < 0.85), (p) => p.y);
  const yMid = isch.y - 0.06;
  const thighX = (mean(slice(bfm, 'y', yMid)).x + mean(slice(stm, 'y', yMid)).x) / 2;
  const prof: V3[] = [];
  for (let y = isch.y - 0.11; y <= isch.y + 0.01; y += 0.002) prof.push(fromBack(thighX, y));
  let fold = prof[0], best = -1;
  for (let i = 4; i < prof.length - 4; i++) {
    const conc = prof[i].z - (prof[i - 4].z + prof[i + 4].z) / 2; // 後ろから見たへこみ（z が前へ入る）
    if (conc > best) { best = conc; fold = prof[i]; }
  }
  P.BL36 = fold;
  L['殿溝（承扶）'] = P.BL36;
  L['膝窩横紋（委中）'] = P.BL40;
  const bf = bfm, st = stm;
  const y37 = rulerMark(P.BL36, P.BL40, 14, 6).y;
  const between = (mean(slice(bf, 'y', y37)).x + mean(slice(st, 'y', y37)).x) / 2;
  P.BL37 = fromBack(between, y37);
  const bfMed = (y: number) => Math.max(...slice(bf, 'y', y).map((p) => p.x)); // 大腿二頭筋腱の内側縁
  const y38 = rulerMark(P.BL36, P.BL40, 14, 13).y;
  P.BL38 = fromBack(bfMed(y38) + 0.004, y38);
  P.BL39 = fromBack(bfMed(0.378) + 0.004, 0.372);
  // 下腿後面：膝窩〜外果尖1尺6寸
  const fib = part('right fibula');
  const lmTip = argmin(fib, (p) => p.y); // 外果尖
  L['外果尖'] = castIn(lmTip, LATERAL, 0.06);
  const leg = (s: number) => rulerMark(P.BL40, L['外果尖'], 16, s);
  const gm = mesh('medial head of right gastrocnemius'), gl = mesh('lateral head of right gastrocnemius');
  const calfMid = (y: number) => {
    const a = slice(gm, 'y', y), b = slice(gl, 'y', y);
    return a.length && b.length ? (Math.min(...a.map((p) => p.x)) + Math.max(...b.map((p) => p.x))) / 2 : kneeX;
  };
  for (const [id, s] of [['BL55', 2], ['BL56', 5]] as const) { const y = leg(s).y; P[id] = fromBack(calfMid(y), y); }
  const ach = mesh('right calcaneal tendon');
  const y57 = leg(8).y;
  const a57 = slice(ach, 'y', y57);
  P.BL57 = fromBack(a57.length ? mean(a57).x : calfMid(y57), y57);
  const achAt = (y: number) => { const s = slice(ach, 'y', y); return s.length ? s : slice(ach, 'y', y + 0.01); };
  // 飛揚：崑崙の上方7寸（委中から9寸）、腓腹筋外側頭下縁とアキレス腱の間。跗陽：崑崙の上方3寸、腓骨とアキレス腱の間
  for (const [id, s] of [['BL58', 9], ['BL59', 13]] as const) {
    const y = leg(s).y;
    const a = achAt(y);
    const lat = argmin(a, (p) => p.x);
    const fz = mean(slice(mesh('right fibula'), 'y', y)).z;
    P[id] = castIn(V(lat.x - 0.006, y, (lat.z + fz) / 2), V(-1, 0, -0.3), 0.07);
  }
  // 崑崙：外果尖とアキレス腱の間
  const aT = achAt(lmTip.y);
  const achLat = argmin(aT, (p) => p.x);
  P.BL60 = castIn(V((lmTip.x + achLat.x) / 2, lmTip.y, (lmTip.z + achLat.z) / 2), LATERAL, 0.06);
  // 申脈：外果尖の直下のくぼみ
  P.BL62 = castIn(V(lmTip.x, lmTip.y - 0.012, lmTip.z), LATERAL, 0.06);
  // 僕参：崑崙の下方、踵骨外側の赤白肉際
  const calc = part('right calcaneus');
  const cAt = mean(calc.filter((p) => Math.abs(p.z - P.BL60.z) < 0.01));
  const DOWN = V(0, -1, 0);
  P.BL61 = redWhite(V(cAt.x, cAt.y, P.BL60.z), V(0, 0, 1), LATERAL, DOWN); // 外側から足底へ回して境目を探す
  // 足の外側：第5中足骨
  const foot = mean(part('right talus'));
  const m5 = axis(part('right fifth metatarsal bone'), foot);
  const along = (t: number) => m5.p0.clone().lerp(m5.p1, t);
  const tub = argmin(part('right fifth metatarsal bone').filter((p) => p.distanceTo(m5.p0) < 0.015), (p) => p.x); // 第5中足骨粗面（底の外側の出っ張り）
  P.BL63 = castIn(tub.clone().addScaledVector(m5.dir, -0.012).add(V(0, -0.004, 0)), LATERAL, 0.06); // 粗面の後方、立方骨の下
  P.BL64 = redWhite(tub.clone().addScaledVector(m5.dir, 0.008), m5.dir, LATERAL, DOWN); // 粗面の遠位
  P.BL65 = redWhite(along(0.86), m5.dir, LATERAL, DOWN);
  const pp5 = axis(part('proximal phalanx of right little toe'), foot);
  P.BL66 = redWhite(pp5.p0.clone().lerp(pp5.p1, 0.25), pp5.dir, LATERAL, DOWN);
  // 至陰：足の第5指、爪甲の外側・近位の角から近位外方1分
  P.BL67 = nailCornerPoint('little toe', 'lateral');
  return { P, L, mid: M };
}
