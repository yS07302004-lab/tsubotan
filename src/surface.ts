// 皮膚の表面に沿わせるための道具（three-mesh-bvh で最近点・法線を求める）
import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import type { Vec3 } from './types';

THREE.Mesh.prototype.raycast = acceleratedRaycast;

export interface SurfaceHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
}

export class SkinSurface {
  readonly bvh: MeshBVH;
  private pos: THREE.BufferAttribute;
  private index: THREE.BufferAttribute | null;
  private nor: THREE.BufferAttribute | null;
  private tri = new THREE.Triangle();
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  private c = new THREE.Vector3();

  readonly geometry: THREE.BufferGeometry;

  constructor(geometry: THREE.BufferGeometry) {
    this.geometry = geometry;
    // 当たり判定（配置モード）と共用する
    this.bvh = (geometry as THREE.BufferGeometry & { boundsTree?: MeshBVH }).boundsTree ?? new MeshBVH(geometry);
    (geometry as THREE.BufferGeometry & { boundsTree?: MeshBVH }).boundsTree = this.bvh;
    this.pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    this.index = geometry.getIndex();
    this.nor = (geometry.getAttribute('normal') as THREE.BufferAttribute | undefined) ?? null;
  }

  /**
   * 面の外向き法線。三角形の巻き順は面ごとにそろっていないことがあるので、
   * モデルの頂点法線（OBJ の vn）の平均を使う。無ければ巻き順から求める。
   */
  private faceNormal(face: number, out: THREE.Vector3) {
    const i0 = this.index ? this.index.getX(face * 3) : face * 3;
    const i1 = this.index ? this.index.getX(face * 3 + 1) : face * 3 + 1;
    const i2 = this.index ? this.index.getX(face * 3 + 2) : face * 3 + 2;
    if (this.nor) {
      out.fromBufferAttribute(this.nor, i0).add(this.a.fromBufferAttribute(this.nor, i1)).add(this.b.fromBufferAttribute(this.nor, i2));
      if (out.lengthSq() > 1e-12) return out.normalize();
    }
    this.tri.set(this.a.fromBufferAttribute(this.pos, i0), this.b.fromBufferAttribute(this.pos, i1), this.c.fromBufferAttribute(this.pos, i2));
    return this.tri.getNormal(out);
  }

  /** 皮膚上の最も近い点と、その面の外向き法線 */
  closest(p: THREE.Vector3 | Vec3): SurfaceHit {
    const q = Array.isArray(p) ? new THREE.Vector3(...p) : p;
    const hit = this.bvh.closestPointToPoint(q, {} as never) as { point: THREE.Vector3; faceIndex: number } | null;
    if (!hit) return { point: q.clone(), normal: new THREE.Vector3(0, 0, 1) };
    return { point: hit.point.clone(), normal: this.faceNormal(hit.faceIndex, new THREE.Vector3()) };
  }

  /**
   * p を dir の向き（前後両方）に皮膚へ投影する。最近点だと曲面で上下にずれるので、
   * 「その向きから見た位置」を保ったまま皮膚に乗せる。当たらなければ最近点。
   */
  project(p: THREE.Vector3, dir: THREE.Vector3, maxDist = 0.05): SurfaceHit {
    let best: SurfaceHit | null = null;
    let bestD = Infinity;
    for (const sign of [1, -1]) {
      const d = dir.clone().multiplyScalar(sign).normalize();
      const ray = new THREE.Ray(p.clone().addScaledVector(d, -0.0005), d);
      const hit = this.bvh.raycastFirst(ray, THREE.DoubleSide) as THREE.Intersection | null;
      if (hit && hit.distance < bestD && hit.distance < maxDist) {
        bestD = hit.distance;
        best = { point: hit.point.clone(), normal: this.faceNormal(hit.faceIndex ?? 0, new THREE.Vector3()) };
      }
    }
    return best ?? this.closest(p);
  }

  /**
   * a→b の直線を n 等分した各点を、皮膚の上で「ひとつ前の点からの差分」だけ進めて寄せる。
   * 毎回その場の近くで寄せるので、腋窩や肘窩のくぼみでも別の面へ飛ばない。
   * 返す点は法線方向に lift だけ浮かせる。法線は前後の点でならす。
   */
  path(a: THREE.Vector3, b: THREE.Vector3, n: number, lift: number): SurfaceHit[] {
    const out: SurfaceHit[] = [this.closest(a)];
    const step = b.clone().sub(a).divideScalar(n);
    for (let i = 1; i <= n; i++) {
      const prev = out[i - 1];
      // 前の点から直線の進み分だけ動かし、法線方向の成分は捨てて（皮膚に沿って進む）寄せる
      const d = step.clone();
      d.addScaledVector(prev.normal, -d.dot(prev.normal));
      out.push(this.closest(prev.point.clone().add(d)));
    }
    return this.lifted(out, lift);
  }

  /** a から b へ、皮膚の上を step(m) ずつ歩いて結ぶ（経脈の走行線用） */
  walk(a: THREE.Vector3, b: THREE.Vector3, step: number, lift: number): SurfaceHit[] {
    const out: SurfaceHit[] = [this.closest(a)];
    const end = this.closest(b);
    const maxIter = Math.ceil((a.distanceTo(b) / step) * 3) + 10;
    for (let i = 0; i < maxIter; i++) {
      const cur = out[out.length - 1];
      const toEnd = end.point.clone().sub(cur.point);
      if (toEnd.length() <= step * 1.5) break;
      toEnd.addScaledVector(cur.normal, -toEnd.dot(cur.normal));
      if (toEnd.lengthSq() < 1e-12) break;
      out.push(this.closest(cur.point.clone().addScaledVector(toEnd.normalize(), step)));
    }
    out.push(end);
    return this.lifted(out, lift);
  }

  /**
   * 骨度の物差し：a→b を皮膚の上で結び（walk）、その道のりを n 等分した点（n+1 個）を返す。
   * extendSteps があれば、同じ間隔で b の先へ延ばした点も続けて返す。頭のように曲がった所でも寸が道のりで測れる
   */
  /**
   * a と b を通り、両端の法線の平均を含む平面で皮膚を切った線をたどって a→b を結ぶ（皮膚に引いたまっすぐな線）。
   * 平面の上を両方向へ歩き、b に早く着いた方を使う（頭なら顔側ではなく頭頂を越える側）
   */
  planeWalk(a: THREE.Vector3, b: THREE.Vector3, step: number): SurfaceHit[] {
    const A = this.closest(a), B = this.closest(b);
    const chord = B.point.clone().sub(A.point);
    const nAvg = A.normal.clone().add(B.normal);
    if (nAvg.lengthSq() < 1e-6) nAvg.copy(A.normal);
    const pn = new THREE.Vector3().crossVectors(chord, nAvg);
    if (pn.lengthSq() < 1e-10) return this.walk(a, b, step, 0);
    pn.normalize();
    const onPlane = (p: THREE.Vector3) => p.addScaledVector(pn, -p.clone().sub(A.point).dot(pn));
    const maxLen = chord.length() * 3 + 0.3;
    const tryDir = (sign: number) => {
      const out: SurfaceHit[] = [A];
      let len = 0;
      let prev = new THREE.Vector3().crossVectors(pn, A.normal).multiplyScalar(sign).normalize();
      while (len < maxLen) {
        const cur = out[out.length - 1];
        if (cur.point.distanceTo(B.point) <= step * 1.5) {
          out.push(B);
          return { out, len: len + cur.point.distanceTo(B.point) };
        }
        let d = new THREE.Vector3().crossVectors(pn, cur.normal).normalize();
        if (d.dot(prev) < 0) d.negate();
        const nx = this.closest(onPlane(cur.point.clone().addScaledVector(d, step)));
        len += nx.point.distanceTo(cur.point);
        prev = nx.point.clone().sub(cur.point).normalize();
        out.push(nx);
      }
      return null;
    };
    const r1 = tryDir(1), r2 = tryDir(-1);
    const best = r1 && r2 ? (r1.len <= r2.len ? r1 : r2) : r1 ?? r2;
    return best ? best.out : this.walk(a, b, step, 0);
  }

  ruler(a: THREE.Vector3, b: THREE.Vector3, n: number, lift: number, extendSteps = 0): SurfaceHit[] {
    const w = this.planeWalk(a, b, 0.002);
    const pts = w.map((h) => h.point);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const total = cum[cum.length - 1];
    const at = (d: number, list: THREE.Vector3[], c: number[]) => {
      let i = 1;
      while (i < c.length - 1 && c[i] < d) i++;
      const t = c[i] === c[i - 1] ? 0 : (d - c[i - 1]) / (c[i] - c[i - 1]);
      return list[i - 1].clone().lerp(list[i], Math.min(1, Math.max(0, t)));
    };
    const out: THREE.Vector3[] = [];
    for (let k = 0; k <= n; k++) out.push(at((total * k) / n, pts, cum));
    if (extendSteps > 0) {
      const unit = total / n;
      // b の先：a→b の向きにまっすぐ延ばした点へ向かって歩き、同じ間隔で取る
      const far = b.clone().add(b.clone().sub(a).multiplyScalar(((extendSteps + 2) * unit) / Math.max(a.distanceTo(b), 1e-6)));
      const w2 = this.planeWalk(b, far, 0.002).map((h) => h.point);
      const c2 = [0];
      for (let i = 1; i < w2.length; i++) c2.push(c2[i - 1] + w2[i].distanceTo(w2[i - 1]));
      for (let k = 1; k <= extendSteps; k++) out.push(at(unit * k, w2, c2));
    }
    return this.lifted(out.map((p) => this.closest(p)), lift);
  }

  private lifted(out: SurfaceHit[], lift: number): SurfaceHit[] {
    const smoothed = out.map((h, i) => {
      const nn = h.normal.clone();
      if (i > 0) nn.add(out[i - 1].normal);
      if (i < out.length - 1) nn.add(out[i + 1].normal);
      return nn.normalize();
    });
    return out.map((h, i) => ({ point: h.point.clone().addScaledVector(smoothed[i], lift), normal: smoothed[i] }));
  }
}
