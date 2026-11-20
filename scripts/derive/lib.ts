// 仮置きの位置を骨・腱の位置から計算するための道具（README「仮置きの位置の決め方」参照）
// 座標はアプリ座標（m, Y-up, 前=+Z, 体の右=-X）。右側で計算し、左は x を反転して皮膚へ寄せる。
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { SkinSurface } from '../../src/surface.ts';

export type V3 = THREE.Vector3;
export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const BP = path.join(ROOT, 'bp3d');
const OBJ_DIRS = ['partof_BP3D_4.0_obj_99', 'isa_BP3D_4.0_obj_99'].map((d) => path.join(BP, d));

// ---- BodyParts3D の部品
const names = new Map<string, Set<string>>();
for (const f of ['isa_element_parts.txt', 'partof_element_parts.txt']) {
  for (const line of fs.readFileSync(path.join(BP, f), 'utf8').split('\n').slice(1)) {
    const [, n, fj] = line.split('\t');
    if (!n || !fj) continue;
    if (!names.has(n)) names.set(n, new Set());
    names.get(n)!.add(fj.trim());
  }
}
export interface Mesh {
  V: V3[];
  F: [number, number, number][];
}
const objCache = new Map<string, Mesh>();
function readObj(fj: string): Mesh | null {
  if (objCache.has(fj)) return objCache.get(fj)!;
  for (const d of OBJ_DIRS) {
    const p = path.join(d, fj + '.obj');
    if (!fs.existsSync(p)) continue;
    const m: Mesh = { V: [], F: [] };
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      if (line.startsWith('v ')) {
        const [, x, y, z] = line.trim().split(/\s+/).map(Number);
        m.V.push(V(x / 1000, z / 1000, -y / 1000));
      } else if (line.startsWith('f ')) {
        const t = line.trim().split(/\s+/).slice(1, 4).map((s) => parseInt(s, 10) - 1);
        m.F.push([t[0], t[1], t[2]]);
      }
    }
    objCache.set(fj, m);
    return m;
  }
  return null;
}
export function mesh(name: string): Mesh {
  const out: Mesh = { V: [], F: [] };
  for (const fj of [...(names.get(name) ?? [])].sort()) {
    const m = readObj(fj);
    if (!m) continue;
    const o = out.V.length;
    out.V.push(...m.V);
    out.F.push(...m.F.map(([a, b, c]) => [a + o, b + o, c + o] as [number, number, number]));
  }
  if (!out.V.length) throw new Error('part not found: ' + name);
  return out;
}
export const part = (name: string) => mesh(name).V;

/** 平面（axis 成分 = c）と三角形の交点 */
export function slice(m: Mesh, axis: 'x' | 'y' | 'z', c: number): V3[] {
  const out: V3[] = [];
  for (const f of m.F) {
    for (const [i, j] of [[f[0], f[1]], [f[1], f[2]], [f[2], f[0]]]) {
      const p = m.V[i][axis] - c;
      const q = m.V[j][axis] - c;
      if (p * q < 0) out.push(m.V[i].clone().lerp(m.V[j], p / (p - q)));
    }
  }
  return out;
}
export const mean = (P: V3[]) => P.reduce((a, p) => a.add(p), V(0, 0, 0)).divideScalar(P.length);
export const argmax = (P: V3[], f: (p: V3) => number) => P.reduce((b, p) => (f(p) > f(b) ? p : b));
export const argmin = (P: V3[], f: (p: V3) => number) => P.reduce((b, p) => (f(p) < f(b) ? p : b));

/** 長軸（主成分）。p0 = farFrom から遠くない方（近位）、p1 = 遠位 */
export function axis(P: V3[], farFrom?: V3) {
  const c = mean(P);
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of P) {
    const d = [p.x - c.x, p.y - c.y, p.z - c.z];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i * 3 + j] += d[i] * d[j];
  }
  let v = V(0.3, 1, 0.2).normalize();
  for (let k = 0; k < 60; k++) {
    v = V(m[0] * v.x + m[1] * v.y + m[2] * v.z, m[3] * v.x + m[4] * v.y + m[5] * v.z, m[6] * v.x + m[7] * v.y + m[8] * v.z).normalize();
  }
  const ts = P.map((p) => p.clone().sub(c).dot(v));
  let p0 = c.clone().addScaledVector(v, Math.min(...ts));
  let p1 = c.clone().addScaledVector(v, Math.max(...ts));
  if (farFrom && p0.distanceTo(farFrom) > p1.distanceTo(farFrom)) [p0, p1] = [p1, p0];
  return { c, p0, p1, dir: p1.clone().sub(p0).normalize(), len: p0.distanceTo(p1), mid: p0.clone().lerp(p1, 0.5) };
}

// ---- 皮膚
export const SKIN_COLORS = ['#e3b99c', '#f2d3bf', '#fbe4e4']; // convert-bp3d.mjs の REGION_COLORS と同じ順（皮膚・手掌足底・爪）
const io = new NodeIO().registerExtensions([KHRDracoMeshCompression]).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });
const prim = (await io.read(path.join(ROOT, 'public/models/skin.glb'))).getRoot().listMeshes()[0].listPrimitives()[0];
const g = new THREE.BufferGeometry();
g.setAttribute('position', new THREE.BufferAttribute(prim.getAttribute('POSITION')!.getArray()!, 3));
g.setAttribute('normal', new THREE.BufferAttribute(prim.getAttribute('NORMAL')!.getArray()!, 3));
g.setIndex(new THREE.BufferAttribute(prim.getIndices()!.getArray()!, 1));
export const S = new SkinSurface(g);
// 頂点ごとの領域（0=皮膚, 1=手掌・足底, 2=爪）。頂点色から戻す
const colorArr = prim.getAttribute('COLOR_0')?.getArray();
const lin = (h: string) => [1, 3, 5].map((i) => { const c = parseInt(h.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const ref = SKIN_COLORS.map(lin);
const posArr = g.getAttribute('position');
export const region = new Int8Array(posArr.count);
if (colorArr) for (let i = 0; i < posArr.count; i++) {
  let best = 0, bd = 1e9;
  ref.forEach((c, k) => { const d = (colorArr[i * 3] - c[0]) ** 2 + (colorArr[i * 3 + 1] - c[1]) ** 2 + (colorArr[i * 3 + 2] - c[2]) ** 2; if (d < bd) { bd = d; best = k; } });
  region[i] = best;
}
export const skinVertex = (i: number) => V(posArr.getX(i), posArr.getY(i), posArr.getZ(i));
/** p に最も近い皮膚頂点の領域 */
export function regionAt(p: V3): number {
  const hit = S.bvh.closestPointToPoint(p, {} as never) as { faceIndex: number } | null;
  if (!hit) return 0;
  const idx = g.getIndex()!;
  const vs = [0, 1, 2].map((k) => idx.getX(hit.faceIndex * 3 + k));
  const nearest = vs.reduce((b, v) => (skinVertex(v).distanceTo(p) < skinVertex(b).distanceTo(p) ? v : b));
  return region[nearest];
}

/** start から dir の向きに撃って最初に当たる皮膚 */
export function cast(start: V3, dir: V3): V3 {
  const hit = S.bvh.raycastFirst(new THREE.Ray(start.clone(), dir.clone().normalize()), THREE.DoubleSide) as THREE.Intersection | null;
  if (!hit) throw new Error(`no skin hit from ${fmt(start)} toward ${fmt(dir)}`);
  return hit.point.clone();
}
/** anchor の外側（outward 方向に dist）から内向きに撃つ */
export const castIn = (anchor: V3, outward: V3, dist = 0.08) => cast(anchor.clone().addScaledVector(outward.clone().normalize(), dist), outward.clone().negate());
export const fromFront = (x: number, y: number) => cast(V(x, y, 1), V(0, 0, -1));
export const fromBack = (x: number, y: number) => cast(V(x, y, -1), V(0, 0, 1));
export const snap = (p: V3) => S.closest(p).point;

/**
 * 赤白肉際：軸 axisDir のまわりに、dorsalDir（背側）から sideDir の向きへ回しながら皮膚へ撃ち、
 * 初めて手掌・足底の領域に入った所（背側との境目）を返す
 */
export function redWhite(center: V3, axisDir: V3, dorsalDir: V3, sideDir: V3, dist = 0.06): V3 {
  const a = axisDir.clone().normalize();
  const d0 = dorsalDir.clone().addScaledVector(a, -dorsalDir.dot(a)).normalize();
  const s0 = sideDir.clone().addScaledVector(a, -sideDir.dot(a)).addScaledVector(d0, -sideDir.dot(d0)).normalize();
  let prev: V3 | null = null;
  for (let deg = 0; deg <= 180; deg += 3) {
    const t = (deg * Math.PI) / 180;
    const dir = d0.clone().multiplyScalar(Math.cos(t)).addScaledVector(s0, Math.sin(t));
    const p = castIn(center, dir, dist);
    if (regionAt(p) === 1) return prev ? prev.lerp(p, 0.5) : p;
    prev = p;
  }
  throw new Error('red-white border not found near ' + fmt(center));
}

/** 骨度の物差しと同じ計算で、A→B を sun 等分した i/2 寸目の皮膚上の点（アプリの KotsudoRuler と同じ） */
export const rulerMark = (A: V3, B: V3, sun: number, s: number) => {
  const ext = Math.max(0, Math.ceil(s - sun)) * 2;
  return S.ruler(A, B, sun * 2, 0, ext)[Math.round(s * 2)].point;
};

export const mirror = (p: V3) => S.closest(V(-p.x, p.y, p.z)).point;
export const fmt = (p: V3) => `[${[p.x, p.y, p.z].map((x) => x.toFixed(4)).join(', ')}]`;
export const r4 = (p: V3): [number, number, number] => [p.x, p.y, p.z].map((x) => Math.round(x * 10000) / 10000 || 0) as [number, number, number];

const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];
/** 右側 x の位置での第 n 肋間の高さ（第 n 肋骨・肋軟骨の下縁と第 n+1 の上縁の中間。前面の部分で測る） */
export function icsY(n: number, x: number): number {
  const ant = (k: number) => {
    const P = [`right ${ORD[k - 1]} rib`, `right ${ORD[k - 1]} costal cartilage`].flatMap((nm) => { try { return slice(mesh(nm), 'x', x); } catch { return []; } });
    if (!P.length) throw new Error(`rib ${k} not at x=${x}`);
    const zmax = Math.max(...P.map((p) => p.z));
    return P.filter((p) => p.z > zmax - 0.012);
  };
  return (Math.min(...ant(n).map((p) => p.y)) + Math.max(...ant(n + 1).map((p) => p.y))) / 2;
}

// ---- 爪（scripts/nails.py が作る形）。井穴などの「爪甲角の近位外方1分」に使う
const NAILS: { side: 'R' | 'L'; digit: string; cornerLateral: number[]; cornerMedial: number[]; axis: number[]; lateralDir: number[] }[] =
  JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'nails.json'), 'utf8')).nails;
/**
 * 爪甲の根元の角から「近位外方1分」（約1.5mm ずつ近位と外へ）の皮膚上の点。
 * which='lateral' は体の外側（手は橈側＝母指側、足は小指側）、'medial' はその反対
 */
export function nailCornerPoint(digit: string, which: 'lateral' | 'medial', side: 'R' | 'L' = 'R', fen = 0.0015): V3 {
  const n = NAILS.find((x) => x.side === side && x.digit === digit);
  if (!n) throw new Error('nail not found: ' + digit);
  const c = V(...(which === 'lateral' ? n.cornerLateral : n.cornerMedial) as [number, number, number]);
  const lat = V(...(n.lateralDir as [number, number, number])).multiplyScalar(which === 'lateral' ? 1 : -1);
  return snap(c.addScaledVector(V(...(n.axis as [number, number, number])), -fen).addScaledVector(lat, fen));
}
