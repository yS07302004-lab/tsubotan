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
