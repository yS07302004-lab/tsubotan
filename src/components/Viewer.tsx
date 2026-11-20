import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, Line, OrbitControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { MODEL_URL, kotsudoById } from '../data';
import { SkinSurface } from '../surface';
import type { Acupoint, Landmark, Vec3 } from '../types';

// 描画順（小さいほど先に描く）
// 骨(不透明) → 皮膚の深度だけ先に描く → 皮膚の色(半透明, depthWrite off)
// → 体の裏側にある線・点を薄く（depthTest off）→ 手前に見えている線・点（depthTest on）
const ORDER = { skinDepth: 1, skinColor: 2, ghost: 9, line: 10, ruler: 11, point: 12 };
const GHOST_OPACITY = 0.28;
const LIFT = 0.0025; // 線を皮膚から浮かせる量(m)。皮膚に埋もれないように

const SKIN_COLOR = '#e3b99c';
const BONE_COLOR = '#fbf7ec';
const POINT_COLOR = '#d6336c';
const SELECTED_COLOR = '#ffb000';
const LINE_COLOR = '#c2255c';
const RULER_COLOR = '#1971c2';

export const INITIAL_CAMERA = { position: [-0.55, 1.3, 1.25] as Vec3, target: [-0.17, 1.1, 0.08] as Vec3 };

export type ViewName = 'front' | 'side' | 'back' | 'reset';
const VIEW_DIR: Record<Exclude<ViewName, 'reset'>, THREE.Vector3> = {
  front: new THREE.Vector3(0, 0, 1),
  side: new THREE.Vector3(-1, 0, 0), // 体の右（肺経のある側）から
  back: new THREE.Vector3(0, 0, -1),
};

function firstGeometry(scene: THREE.Object3D): THREE.BufferGeometry {
  let g: THREE.BufferGeometry | null = null;
  scene.traverse((o) => {
    if (!g && (o as THREE.Mesh).isMesh) g = (o as THREE.Mesh).geometry;
  });
  if (!g) throw new Error('mesh not found');
  return g;
}

function Body({
  skinGeo,
  boneGeo,
  skinOpacity,
  placing,
  onPlace,
}: {
  skinGeo: THREE.BufferGeometry;
  boneGeo: THREE.BufferGeometry;
  skinOpacity: number;
  placing: boolean;
  onPlace: (p: Vec3) => void;
}) {
  const opaque = skinOpacity >= 0.999;
  const hidden = skinOpacity <= 0.001;
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onPlace([e.point.x, e.point.y, e.point.z]);
  };
  return (
    <group>
      <mesh geometry={boneGeo} raycast={() => null}>
        <meshStandardMaterial color={BONE_COLOR} roughness={0.75} />
      </mesh>
      {/* 配置モードのタップ判定用。皮膚だけを対象にし、透明度 0% でも当たる（骨には当たらない） */}
      <mesh geometry={skinGeo} visible={false} onClick={placing ? handleClick : undefined} />
      {/* 半透明時：一番手前の皮膚だけを描くため、先に深度だけ書く */}
      <mesh geometry={skinGeo} renderOrder={ORDER.skinDepth} visible={!opaque && !hidden} raycast={() => null}>
        <meshBasicMaterial colorWrite={false} transparent depthWrite />
      </mesh>
      <mesh geometry={skinGeo} renderOrder={ORDER.skinColor} visible={!hidden} raycast={() => null}>
        {/* transparent の切り替えはシェーダの再コンパイルが要るので、key で作り直す */}
        <meshStandardMaterial
          key={opaque ? 'opaque' : 'transparent'}
          color={SKIN_COLOR}
          roughness={0.85}
          transparent={!opaque}
          opacity={skinOpacity}
          depthWrite={opaque}
          depthFunc={THREE.LessEqualDepth}
        />
      </mesh>
    </group>
  );
}

/** 体の手前では濃く、裏側（皮膚や骨の向こう）では薄く描く線 */
function SurfaceLine({
  points,
  color,
  width,
  order,
  dashed,
  segments,
}: {
  points: THREE.Vector3[];
  color: string;
  width: number;
  order: number;
  dashed?: boolean;
  segments?: boolean;
}) {
  if (points.length < 2) return null;
  const dash = dashed ? { dashed: true, dashSize: 0.006, gapSize: 0.004 } : {};
  return (
    <>
      <Line
        points={points}
        segments={segments}
        color={color}
        lineWidth={width}
        renderOrder={ORDER.ghost}
        depthTest={false}
        depthWrite={false}
        transparent
        opacity={GHOST_OPACITY}
        {...dash}
      />
      {/* polygonOffset で手前へ少しずらし、太い線が皮膚に食い込んで途切れるのを防ぐ */}
      <Line
        points={points}
        segments={segments}
        color={color}
        lineWidth={width}
        renderOrder={order}
        depthWrite={false}
        transparent
        polygonOffset
        polygonOffsetFactor={-4}
        polygonOffsetUnits={-4}
        {...dash}
      />
    </>
  );
}

/** カメラからの距離に応じて大きさを変え、どの倍率でも同じくらいの大きさに見せる */
function useScreenScale(pos: THREE.Vector3, refs: React.RefObject<THREE.Object3D>[], factor: number, min: number) {
  useFrame(({ camera }) => {
    const s = Math.max(min, camera.position.distanceTo(pos) * factor);
    for (const r of refs) r.current?.scale.setScalar(s);
  });
}

function PointMarker({
  point,
  surface,
  selected,
  placing,
  onSelect,
}: {
  point: Acupoint & { position: Vec3 };
  surface: SkinSurface;
  selected: boolean;
  placing: boolean;
  onSelect: (id: string) => void;
}) {
  const pos = useMemo(() => {
    const p = new THREE.Vector3(...point.position);
    // 皮膚に半分埋もれないよう、法線方向に少しだけ浮かせる
    return p.addScaledVector(surface.closest(p).normal, 0.0008);
  }, [point.position, surface]);
  const solid = useRef<THREE.Mesh>(null);
  const ghost = useRef<THREE.Mesh>(null);
  const hit = useRef<THREE.Mesh>(null);
  useScreenScale(pos, [solid, ghost, hit], selected ? 0.009 : 0.006, 0.0015);
  const color = selected ? SELECTED_COLOR : POINT_COLOR;
  return (
    <group position={pos}>
      <mesh ref={ghost} renderOrder={ORDER.ghost} raycast={() => null}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshBasicMaterial color={color} depthTest={false} depthWrite={false} transparent opacity={GHOST_OPACITY + 0.1} />
      </mesh>
      <mesh ref={solid} renderOrder={ORDER.point} raycast={() => null}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshBasicMaterial color={color} depthWrite={false} transparent />
      </mesh>
      {/* 指でタップしやすいように、見た目より大きい当たり判定 */}
      <mesh
        ref={hit}
        visible={false}
        onClick={
          placing
            ? undefined
            : (e) => {
                e.stopPropagation();
                onSelect(point.id);
              }
        }
      >
        <sphereGeometry args={[2.6, 8, 6]} />
      </mesh>
      {selected && (
        <Html center style={{ pointerEvents: 'none' }} zIndexRange={[20, 0]}>
          <div className="point-label">
            {point.name}
            <span>{point.id}</span>
          </div>
        </Html>
      )}
    </group>
  );
}

/** 経穴を順に結ぶ線を、皮膚の表面に沿わせて描く */
function MeridianLine({ points, surface }: { points: Acupoint[]; surface: SkinSurface }) {
  const path = useMemo(() => {
    const ps = points.filter((p) => p.position).map((p) => new THREE.Vector3(...(p.position as Vec3)));
    const out: THREE.Vector3[] = [];
    for (let i = 0; i + 1 < ps.length; i++) {
      const seg = surface.walk(ps[i], ps[i + 1], 0.004, LIFT).map((h) => h.point); // 皮膚の上を4mmずつ
      out.push(...(i === 0 ? seg : seg.slice(1)));
    }
    return out;
  }, [points, surface]);
  return <SurfaceLine points={path} color={LINE_COLOR} width={2.5} order={ORDER.line} />;
}

/** 骨度法の物差し：from〜to を sun 等分し、extend 寸だけ to の先へ延長する。皮膚に沿わせて描く */
function KotsudoRuler({ point, landmarks, surface }: { point: Acupoint | undefined; landmarks: Landmark[]; surface: SkinSurface }) {
  const seg = kotsudoById(point?.kotsudo ?? null);
  const a = landmarks.find((l) => l.name === seg?.from)?.position;
  const b = landmarks.find((l) => l.name === seg?.to)?.position;
  const geo = useMemo(() => {
    if (!seg || !a || !b) return null;
    const A = new THREE.Vector3(...a);
    const B = new THREE.Vector3(...b);
    const total = seg.sun + (seg.extend ?? 0);
    // 直線上で 0.5寸 ごとに目盛り位置を決め、皮膚へ寄せる
    const end = A.clone().lerp(B, total / seg.sun);
    const path = surface.path(A, end, total * 2, LIFT);
    const main = path.slice(0, seg.sun * 2 + 1).map((h) => h.point);
    const ext = path.slice(seg.sun * 2).map((h) => h.point);
    const ticks: THREE.Vector3[] = [];
    const labels: { pos: Vec3; text: string; ext: boolean }[] = [];
    path.forEach((h, i) => {
      const s = i / 2;
      const prev = path[Math.max(0, i - 1)].point;
      const next = path[Math.min(path.length - 1, i + 1)].point;
      const tangent = next.clone().sub(prev).normalize();
      const across = new THREE.Vector3().crossVectors(tangent, h.normal).normalize();
      const major = Number.isInteger(s);
      const len = (major ? 0.009 : 0.005) * (s === 0 || s === seg.sun ? 1.6 : 1);
      ticks.push(h.point.clone().addScaledVector(across, -len), h.point.clone().addScaledVector(across, len));
      if (major) {
        const lp = h.point.clone().addScaledVector(across, 0.02).addScaledVector(h.normal, 0.002);
        labels.push({ pos: [lp.x, lp.y, lp.z], text: String(s), ext: s > seg.sun });
      }
    });
    return { main, ext, ticks, labels };
  }, [seg, a, b, surface]);
  if (!geo || !seg) return null;
  return (
    <group>
      <SurfaceLine points={geo.main} color={RULER_COLOR} width={3} order={ORDER.ruler} />
      {seg.extend ? <SurfaceLine points={geo.ext} color={RULER_COLOR} width={3} order={ORDER.ruler} dashed /> : null}
      <SurfaceLine points={geo.ticks} segments color={RULER_COLOR} width={2} order={ORDER.ruler} />
      {geo.labels.map((l) => (
        <Html key={l.text} position={l.pos} center style={{ pointerEvents: 'none' }} zIndexRange={[10, 0]}>
          <div className={'ruler-label' + (l.ext ? ' ext' : '')}>{l.text}</div>
        </Html>
      ))}
    </group>
  );
}

function Lights() {
  const light = useRef<THREE.DirectionalLight>(null);
  useFrame(({ camera }) => {
    // カメラの少し上から照らす
    light.current?.position.copy(camera.position).add(new THREE.Vector3(0.3, 0.5, 0));
  });
  return (
    <>
      <hemisphereLight args={['#ffffff', '#8a7f74', 0.9]} />
      <directionalLight ref={light} intensity={1.6} />
    </>
  );
}

type Anim = { t: number; fromT: THREE.Vector3; toT: THREE.Vector3; fromP: THREE.Vector3; toP: THREE.Vector3 };

/** 選んだ穴を正面（皮膚の法線の向き）から見る位置へカメラを動かす。視点ボタンもここで処理する */
function CameraRig({
  surface,
  focus,
  focusKey,
  view,
  viewKey,
}: {
  surface: SkinSurface;
  focus: Vec3 | null;
  focusKey: number;
  view: ViewName | null;
  viewKey: number;
}) {
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const camera = useThree((s) => s.camera);
  const anim = useRef<Anim | null>(null);

  // 開発時の確認用（スクリーンショットの自動撮影でカメラを動かす）
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__view = { controls, camera };
  }, [controls, camera]);

  const animate = (toT: THREE.Vector3, toP: THREE.Vector3) => {
    if (!controls) return;
    anim.current = { t: 0, fromT: controls.target.clone(), toT, fromP: camera.position.clone(), toP };
  };

  useEffect(() => {
    if (!controls || !focus || focusKey === 0) return;
    const toT = new THREE.Vector3(...focus);
    const normal = surface.closest(toT).normal;
    const current = camera.position.clone().sub(controls.target).normalize();
    // 皮膚の法線の向きから見る（今の向きも少し残して、急に回りすぎないようにする）
    const dir = normal.multiplyScalar(0.8).add(current.multiplyScalar(0.2)).normalize();
    dir.y = Math.max(-0.3, Math.min(0.5, dir.y));
    dir.normalize();
    animate(toT, toT.clone().addScaledVector(dir, 0.42));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, controls]);

  useEffect(() => {
    if (!controls || !view || viewKey === 0) return;
    if (view === 'reset') {
      animate(new THREE.Vector3(...INITIAL_CAMERA.target), new THREE.Vector3(...INITIAL_CAMERA.position));
      return;
    }
    const dist = camera.position.distanceTo(controls.target);
    const toT = controls.target.clone();
    animate(toT, toT.clone().addScaledVector(VIEW_DIR[view], dist));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey, controls]);

  useFrame((_, dt) => {
    const a = anim.current;
    if (!a || !controls) return;
    a.t = Math.min(1, a.t + dt / 0.6);
    const k = 1 - Math.pow(1 - a.t, 3);
    controls.target.lerpVectors(a.fromT, a.toT, k);
    camera.position.lerpVectors(a.fromP, a.toP, k);
    controls.update();
    if (a.t >= 1) anim.current = null;
  });
  return null;
}

export interface ViewerProps {
  points: Acupoint[];
  landmarks: Landmark[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  skinOpacity: number;
  placing: boolean;
  onPlace: (p: Vec3) => void;
  focus: Vec3 | null;
  focusKey: number;
  view: ViewName | null;
  viewKey: number;
  showLandmarks: boolean;
}

function Scene(props: ViewerProps) {
  const { points, landmarks, selectedId, onSelect, skinOpacity, placing, onPlace, focus, focusKey, view, viewKey, showLandmarks } = props;
  const skin = useGLTF(MODEL_URL.skin, MODEL_URL.draco);
  const bones = useGLTF(MODEL_URL.bones, MODEL_URL.draco);
  const skinGeo = useMemo(() => firstGeometry(skin.scene), [skin]);
  const boneGeo = useMemo(() => firstGeometry(bones.scene), [bones]);
  const surface = useMemo(() => new SkinSurface(skinGeo), [skinGeo]);
  const selected = points.find((p) => p.id === selectedId);
  return (
    <>
      <Body skinGeo={skinGeo} boneGeo={boneGeo} skinOpacity={skinOpacity} placing={placing} onPlace={onPlace} />
      <MeridianLine points={points} surface={surface} />
      {!placing && <KotsudoRuler point={selected} landmarks={landmarks} surface={surface} />}
      {points
        .filter((p): p is Acupoint & { position: Vec3 } => !!p.position)
        .map((p) => (
          <PointMarker key={p.id} point={p} surface={surface} selected={p.id === selectedId} placing={placing} onSelect={onSelect} />
        ))}
      {showLandmarks &&
        landmarks
          .filter((l) => l.position)
          .map((l) => (
            <mesh key={l.name} position={l.position as Vec3} renderOrder={ORDER.point} raycast={() => null}>
              <sphereGeometry args={[0.003, 12, 8]} />
              <meshBasicMaterial color={RULER_COLOR} depthTest={false} transparent />
            </mesh>
          ))}
      <CameraRig surface={surface} focus={focus} focusKey={focusKey} view={view} viewKey={viewKey} />
    </>
  );
}

export default function Viewer(props: ViewerProps) {
  return (
    <Canvas className="viewer" camera={{ position: INITIAL_CAMERA.position, fov: 35, near: 0.01, far: 20 }} dpr={[1, 2]} gl={{ antialias: true }}>
      <color attach="background" args={['#f6f3ee']} />
      <Lights />
      <Suspense fallback={<Html center>読み込み中…</Html>}>
        <Scene {...props} />
      </Suspense>
      <OrbitControls makeDefault target={INITIAL_CAMERA.target} enableDamping minDistance={0.08} maxDistance={4} />
    </Canvas>
  );
}

useGLTF.preload(MODEL_URL.skin, MODEL_URL.draco);
useGLTF.preload(MODEL_URL.bones, MODEL_URL.draco);
