import { Suspense, createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, Line, OrbitControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { MERIDIANS, MODEL_URL, kotsudoById } from '../data';
import { SkinSurface } from '../surface';
import { KIND_COLOR, STRUCTURES, structureParts } from '../structures';
import { LAYERS, SIDES, SIDE_LABEL, findLandmark, type Acupoint, type LayerName, type LayerState, type Landmark, type PointRef, type Side, type Vec3 } from '../types';

// 描画順（小さいほど先に描く）
// 骨(不透明) → 皮膚の深度だけ先に描く → 皮膚の色(半透明, depthWrite off)
// → 体の裏側にある線・点を薄く（depthTest off）→ 手前に見えている線・点（depthTest on）
const ORDER = { skinDepth: 1, skinColor: 2, ghost: 9, line: 10, ruler: 11, point: 12 };
const GHOST_OPACITY = 0.28;
/** 体の向こう側の線・点を薄く透かして描くか */
const GhostCtx = createContext(true);
const LIFT = 0.0025; // 線を皮膚から浮かせる量(m)。皮膚に埋もれないように

const SKIN_COLOR = '#e3b99c';
const POINT_COLOR = '#d6336c';
const SELECTED_COLOR = '#ffb000';
const LINE_COLOR = '#c2255c';
const RULER_COLOR = '#1971c2';

// 起動時は全身を正面から
export const INITIAL_CAMERA = { position: [0, 0.8, 3.4] as Vec3, target: [0, 0.8, 0.1] as Vec3 };

const WHOLE_BODY = { position: [0, 0.8, 3.4] as Vec3, target: [0, 0.8, 0.1] as Vec3 };

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

/** 爪（皮膚に重ねる薄い板）と、その周りの少し暗い縁（爪郭）。皮膚と同じ透明度で描く */
function Nails({ opacity }: { opacity: number }) {
  const gltf = useGLTF(MODEL_URL.nails, MODEL_URL.draco);
  const geo = useMemo(() => {
    const get = (n: string) => (gltf.scene.getObjectByName(n) as THREE.Mesh | undefined)?.geometry;
    return { nail: get('nails') ?? firstGeometry(gltf.scene), fold: get('nailFolds') };
  }, [gltf]);
  const opaque = opacity >= 0.999;
  if (opacity <= 0.001) return null;
  const mat = (color: string, offset: number, rough: number, vertexColors = false) => (
    <meshStandardMaterial
      key={opaque ? 'o' : 't'}
      color={color}
      vertexColors={vertexColors}
      roughness={rough}
      transparent={!opaque}
      opacity={opacity}
      depthWrite={opaque}
      polygonOffset
      polygonOffsetFactor={offset}
      polygonOffsetUnits={offset}
      side={THREE.DoubleSide}
    />
  );
  return (
    <group>
      {geo.fold && (
        <mesh geometry={geo.fold} renderOrder={ORDER.skinColor + 0.3} raycast={() => null}>
          {mat('#d3a68f', -1, 0.9)}
        </mesh>
      )}
      <mesh geometry={geo.nail} renderOrder={ORDER.skinColor + 0.5} raycast={() => null}>
        {mat(geo.nail.getAttribute('color') ? '#ffffff' : '#f3d6d0', -4, 0.3, !!geo.nail.getAttribute('color'))}
      </mesh>
    </group>
  );
}

/** 骨・筋・動脈・神経の層。オンにしたときに初めて読み込む（骨は最初から） */
function Layer({ name }: { name: LayerName }) {
  const gltf = useGLTF(MODEL_URL[name], MODEL_URL.draco);
  const geo = useMemo(() => firstGeometry(gltf.scene), [gltf]);
  const def = LAYERS.find((l) => l.name === name)!;
  return (
    <mesh geometry={geo} raycast={() => null}>
      <meshStandardMaterial color={def.color} roughness={name === 'bones' ? 0.75 : 0.55} />
    </mesh>
  );
}

function Body({
  skinGeo,
  layers,
  skinOpacity,
  placing,
  onPlace,
}: {
  skinGeo: THREE.BufferGeometry;
  layers: LayerState;
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
      {LAYERS.filter((l) => layers[l.name]).map((l) => (
        <Suspense key={l.name} fallback={null}>
          <Layer name={l.name} />
        </Suspense>
      ))}
      <Suspense fallback={null}>
        <Nails opacity={skinOpacity} />
      </Suspense>
      {/* 配置モードのタップ判定用。皮膚だけを対象にし、透明度 0% でも当たる（骨には当たらない） */}
      <mesh geometry={skinGeo} visible={false} onClick={placing ? handleClick : undefined} />
      {/* 半透明時：一番手前の皮膚だけを描くため、先に深度だけ書く */}
      <mesh geometry={skinGeo} renderOrder={ORDER.skinDepth} visible={!opaque && !hidden} raycast={() => null}>
        <meshBasicMaterial colorWrite={false} transparent depthWrite />
      </mesh>
      <mesh geometry={skinGeo} renderOrder={ORDER.skinColor} visible={!hidden} raycast={() => null}>
        {/* transparent の切り替えはシェーダの再コンパイルが要るので、key で作り直す */}
        {/* 色は skin.glb の頂点色（皮膚・手掌足底・爪）。頂点色が無いモデルなら SKIN_COLOR */}
        <meshStandardMaterial
          key={opaque ? 'opaque' : 'transparent'}
          color={skinGeo.getAttribute('color') ? '#ffffff' : SKIN_COLOR}
          vertexColors={!!skinGeo.getAttribute('color')}
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
  const ghost = useContext(GhostCtx);
  if (points.length < 2) return null;
  const dash = dashed ? { dashed: true, dashSize: 0.006, gapSize: 0.004 } : {};
  return (
    <>
      {ghost && (
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
      )}
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
  side,
  position,
  surface,
  selected,
  placing,
  onSelect,
}: {
  point: Acupoint;
  side: Side;
  position: Vec3;
  surface: SkinSurface;
  selected: boolean;
  placing: boolean;
  onSelect: (ref: PointRef) => void;
}) {
  const pos = useMemo(() => {
    const p = new THREE.Vector3(...position);
    // 皮膚に半分埋もれないよう、法線方向に少しだけ浮かせる
    return p.addScaledVector(surface.closest(p).normal, 0.0008);
  }, [position, surface]);
  const showGhost = useContext(GhostCtx);
  const solid = useRef<THREE.Mesh>(null);
  const ghost = useRef<THREE.Mesh>(null);
  const hit = useRef<THREE.Mesh>(null);
  useScreenScale(pos, [solid, ghost, hit], selected ? 0.009 : 0.006, 0.0015);
  const color = selected ? SELECTED_COLOR : POINT_COLOR;
  return (
    <group position={pos}>
      {showGhost && (
        <mesh ref={ghost} renderOrder={ORDER.ghost} raycast={() => null}>
          <sphereGeometry args={[1, 16, 12]} />
          <meshBasicMaterial color={color} depthTest={false} depthWrite={false} transparent opacity={GHOST_OPACITY + 0.1} />
        </mesh>
      )}
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
                onSelect({ id: point.id, side });
              }
        }
      >
        <sphereGeometry args={[2.6, 8, 6]} />
      </mesh>
      {selected && (
        <Html center style={{ pointerEvents: 'none' }} zIndexRange={[20, 0]}>
          <div className="point-label">
            {point.name}
            <span>
              {point.id}・{SIDE_LABEL[side]}
            </span>
          </div>
        </Html>
      )}
    </group>
  );
}

/**
 * 選んだ穴の目印（骨・筋・腱・動脈）を色分けして強調する。皮膚の上からでも見えるよう、
 * 実体（皮膚の下）に加えて、半透明の重ね描きもする
 */
function StructureHighlight({ point, side }: { point: Acupoint; side: Side }) {
  const gltf = useGLTF(MODEL_URL.structures, MODEL_URL.draco);
  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: { geo: THREE.BufferGeometry; color: string }[] = [];
    for (const lm of point.landmarks) {
      const kind = STRUCTURES[lm]?.kind;
      if (!kind) continue;
      for (const name of structureParts(lm, side)) {
        if (seen.has(name)) continue;
        seen.add(name);
        const obj = gltf.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name)) as THREE.Mesh | undefined;
        const mesh = obj && ((obj as THREE.Mesh).isMesh ? obj : (obj.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh | undefined));
        if (mesh) out.push({ geo: (mesh as THREE.Mesh).geometry, color: KIND_COLOR[kind] });
      }
    }
    return out;
  }, [gltf, point, side]);
  return (
    <group>
      {items.map((it, i) => (
        <group key={i}>
          <mesh geometry={it.geo} raycast={() => null}>
            <meshStandardMaterial color={it.color} emissive={it.color} emissiveIntensity={0.25} roughness={0.5} />
          </mesh>
          <mesh geometry={it.geo} renderOrder={ORDER.ghost - 1} raycast={() => null}>
            <meshBasicMaterial color={it.color} transparent opacity={0.35} depthTest={false} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

interface MarkerItem {
  point: Acupoint;
  side: Side;
  position: Vec3;
}

/**
 * 選んでいない経穴をまとめて描く（InstancedMesh で描画の回数を減らし、起動・切り替えを軽くする）。
 * 手前は濃く、体の向こう側は薄く。当たり判定は見た目より大きい球
 */
function PointMarkers({
  items,
  surface,
  placing,
  onSelect,
}: {
  items: MarkerItem[];
  surface: SkinSurface;
  placing: boolean;
  onSelect: (ref: PointRef) => void;
}) {
  const showGhost = useContext(GhostCtx);
  const pos = useMemo(
    () =>
      items.map((it) => {
        const p = new THREE.Vector3(...it.position);
        return p.addScaledVector(surface.closest(p).normal, 0.0008); // 皮膚に半分埋もれないよう少し浮かせる
      }),
    [items, surface],
  );
  const geo = useMemo(() => new THREE.SphereGeometry(1, 12, 8), []);
  const hitGeo = useMemo(() => new THREE.SphereGeometry(2.6, 6, 4), []);
  const solid = useRef<THREE.InstancedMesh>(null);
  const ghost = useRef<THREE.InstancedMesh>(null);
  const hit = useRef<THREE.InstancedMesh>(null);
  const m = useMemo(() => new THREE.Matrix4(), []);
  useFrame(({ camera }) => {
    for (let i = 0; i < pos.length; i++) {
      const sc = Math.max(0.0015, camera.position.distanceTo(pos[i]) * 0.006);
      m.makeScale(sc, sc, sc).setPosition(pos[i]);
      solid.current?.setMatrixAt(i, m);
      ghost.current?.setMatrixAt(i, m);
      hit.current?.setMatrixAt(i, m);
    }
    for (const r of [solid, ghost, hit]) if (r.current) r.current.instanceMatrix.needsUpdate = true;
    if (hit.current) hit.current.boundingSphere = null; // 大きさが変わるので当たり判定の範囲を作り直す
  });
  if (!items.length) return null;
  return (
    <group>
      {showGhost && (
        <instancedMesh ref={ghost} args={[geo, undefined, items.length]} renderOrder={ORDER.ghost} frustumCulled={false} raycast={() => null}>
          <meshBasicMaterial color={POINT_COLOR} depthTest={false} depthWrite={false} transparent opacity={GHOST_OPACITY + 0.1} />
        </instancedMesh>
      )}
      <instancedMesh ref={solid} args={[geo, undefined, items.length]} renderOrder={ORDER.point} frustumCulled={false} raycast={() => null}>
        <meshBasicMaterial color={POINT_COLOR} depthWrite={false} transparent />
      </instancedMesh>
      <instancedMesh
        ref={hit}
        args={[hitGeo, undefined, items.length]}
        visible={false}
        onClick={
          placing
            ? undefined
            : (e) => {
                e.stopPropagation();
                const it = e.instanceId !== undefined ? items[e.instanceId] : undefined;
                if (it) onSelect({ id: it.point.id, side: it.side });
              }
        }
      />
    </group>
  );
}

/** 経穴を順に結ぶ線を、皮膚の表面に沿わせて描く */
function MeridianLine({ points, side, surface }: { points: Acupoint[]; side: Side; surface: SkinSurface }) {
  const path = useMemo(() => {
    const ps = points.filter((p) => p.positions[side]).map((p) => new THREE.Vector3(...(p.positions[side] as Vec3)));
    if (ps.length < 2) return [];
    const out: THREE.Vector3[] = [];
    for (let i = 0; i + 1 < ps.length; i++) {
      const seg = surface.walk(ps[i], ps[i + 1], 0.004, LIFT).map((h) => h.point); // 皮膚の上を4mmずつ
      out.push(...(i === 0 ? seg : seg.slice(1)));
    }
    return out;
  }, [points, side, surface]);
  return <SurfaceLine points={path} color={LINE_COLOR} width={2.5} order={ORDER.line} />;
}

/** 骨度法の物差し：from〜to を sun 等分し、extend 寸だけ to の先へ延長する。皮膚に沿わせて描く */
function KotsudoRuler({
  point,
  side,
  landmarks,
  surface,
}: {
  point: Acupoint | undefined;
  side: Side;
  landmarks: Landmark[];
  surface: SkinSurface;
}) {
  const seg = kotsudoById(point?.kotsudo ?? null);
  const a = findLandmark(landmarks, seg?.from, side)?.position;
  const b = findLandmark(landmarks, seg?.to, side)?.position;
  const at = point?.positions[side];
  const geo = useMemo(() => {
    if (!seg || !a || !b) return null;
    let A = new THREE.Vector3(...a);
    let B = new THREE.Vector3(...b);
    if (seg.align === 'point_height' && at) {
      // 横向きの区間は、選んだ穴の高さへ平行移動し、元の向き（皮膚の法線）から皮膚へ乗せ直す
      const dy = at[1] - (A.y + B.y) / 2;
      const nA = surface.closest(A).normal;
      const nB = surface.closest(B).normal;
      A = surface.project(A.setY(A.y + dy), nA, 0.2).point;
      B = surface.project(B.setY(B.y + dy), nB, 0.2).point;
    }
    const total = seg.sun + (seg.extend ?? 0);
    // 皮膚の上の道のりで 0.5寸 ごとに目盛りを取る（extend は同じ間隔で先へ延ばす）
    const path = surface.ruler(A, B, seg.sun * 2, LIFT, (seg.extend ?? 0) * 2);
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
  }, [seg, a, b, at, surface]);
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
  side,
}: {
  surface: SkinSurface;
  focus: Vec3 | null;
  focusKey: number;
  view: ViewName | null;
  viewKey: number;
  side: Side;
}) {
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const camera = useThree((s) => s.camera);
  const anim = useRef<Anim | null>(null);

  // 開発時の確認用（スクリーンショットの自動撮影でカメラを動かす）
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__view = { controls, camera };
  }, [controls, camera]);

  // 指で動かし始めたら、自動のカメラ移動はやめる（ピンチ中に引き戻されないように）
  useEffect(() => {
    if (!controls) return;
    const stop = () => (anim.current = null);
    controls.addEventListener('start', stop);
    return () => controls.removeEventListener('start', stop);
  }, [controls]);

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
      // 全身を正面から
      animate(new THREE.Vector3(...WHOLE_BODY.target), new THREE.Vector3(...WHOLE_BODY.position));
      return;
    }
    const dist = camera.position.distanceTo(controls.target);
    const toT = controls.target.clone();
    // 「横」は選んでいる側から見る（左なら +X 側）
    const dir = view === 'side' && side === 'L' ? new THREE.Vector3(1, 0, 0) : VIEW_DIR[view];
    animate(toT, toT.clone().addScaledVector(dir, dist));
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
  selected: PointRef | null;
  onSelect: (ref: PointRef) => void;
  skinOpacity: number;
  placing: boolean;
  onPlace: (p: Vec3) => void;
  focus: Vec3 | null;
  focusKey: number;
  view: ViewName | null;
  viewKey: number;
  showLandmarks: boolean;
  layers: LayerState;
  /** 表示する経絡（コード）。選んでいる穴の経絡はいつも表示する */
  visibleMeridians: string[];
  showGhost: boolean;
  /** 3D を指で動かし始めたとき（スイッチ類をしまうのに使う） */
  onInteract?: () => void;
}

function Scene(props: ViewerProps) {
  const { points, landmarks, selected, onSelect, skinOpacity, placing, onPlace, focus, focusKey, view, viewKey, showLandmarks } = props;
  const skin = useGLTF(MODEL_URL.skin, MODEL_URL.draco);
  const skinGeo = useMemo(() => firstGeometry(skin.scene), [skin]);

  const surface = useMemo(() => new SkinSurface(skinGeo), [skinGeo]);
  const selPoint = selected ? points.find((p) => p.id === selected.id) : undefined;
  const shown = new Set(props.visibleMeridians);
  if (selPoint) shown.add(selPoint.meridian);
  const visiblePoints = points.filter((p) => shown.has(p.meridian));
  const markerItems = useMemo(
    () =>
      visiblePoints.flatMap((p) =>
        SIDES.filter((side) => p.positions[side] && !(selected?.id === p.id && selected.side === side)).map((side) => ({
          point: p,
          side,
          position: p.positions[side] as Vec3,
        })),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, props.visibleMeridians.join(','), selPoint?.meridian, selected?.id, selected?.side],
  );
  return (
    <>
      <Body skinGeo={skinGeo} layers={props.layers} skinOpacity={skinOpacity} placing={placing} onPlace={onPlace} />
      {MERIDIANS.filter((m) => shown.has(m.code)).flatMap((m) => {
        const mine = points.filter((p) => p.meridian === m.code);
        const lines = m.lines ?? [mine.map((p) => p.id)];
        return lines.flatMap((ids, li) =>
          SIDES.map((side) => (
            <MeridianLine
              key={`${m.code}-${li}-${side}`}
              points={ids.map((id) => mine.find((p) => p.id === id)).filter((p): p is Acupoint => !!p)}
              side={side}
              surface={surface}
            />
          )),
        );
      })}
      {!placing && selPoint && selected && (
        <Suspense fallback={null}>
          <StructureHighlight point={selPoint} side={selected.side} />
        </Suspense>
      )}
      {!placing && selected && <KotsudoRuler point={selPoint} side={selected.side} landmarks={landmarks} surface={surface} />}
      <PointMarkers key={markerItems.length} items={markerItems} surface={surface} placing={placing} onSelect={onSelect} />
      {selPoint && selected && selPoint.positions[selected.side] && (
        <PointMarker
          point={selPoint}
          side={selected.side}
          position={selPoint.positions[selected.side] as Vec3}
          surface={surface}
          selected
          placing={placing}
          onSelect={onSelect}
        />
      )}
      {showLandmarks &&
        landmarks
          .filter((l) => l.position)
          .map((l) => (
            <mesh key={`${l.name}|${l.side}`} position={l.position as Vec3} renderOrder={ORDER.point} raycast={() => null}>
              <sphereGeometry args={[0.003, 12, 8]} />
              <meshBasicMaterial color={RULER_COLOR} depthTest={false} transparent />
            </mesh>
          ))}
      <CameraRig surface={surface} focus={focus} focusKey={focusKey} view={view} viewKey={viewKey} side={selected?.side ?? 'R'} />
    </>
  );
}

export default function Viewer(props: ViewerProps) {
  // 2本指の操作（ピンチなど）の最中・直後は、指を離したときの「タップ」で穴が選ばれないようにする
  const touches = useRef(new Set<number>());
  const multiAt = useRef(0);
  const onSelect = (ref: PointRef) => {
    if (touches.current.size > 0 || performance.now() - multiAt.current < 600) return;
    props.onSelect(ref);
  };
  return (
    <Canvas
      onPointerDown={(e) => {
        touches.current.add(e.pointerId);
        if (touches.current.size >= 2) multiAt.current = performance.now();
      }}
      onPointerUp={(e) => {
        if (touches.current.size >= 2) multiAt.current = performance.now();
        touches.current.delete(e.pointerId);
      }}
      onPointerCancel={(e) => touches.current.delete(e.pointerId)}
      className="viewer" camera={{ position: INITIAL_CAMERA.position, fov: 35, near: 0.01, far: 20 }} dpr={[1, 2]} gl={{ antialias: true }}>
      <color attach="background" args={['#f6f3ee']} />
      <Lights />
      <Suspense fallback={<Html center>読み込み中…</Html>}>
        <GhostCtx.Provider value={props.showGhost}>
          <Scene {...props} onSelect={onSelect} />
        </GhostCtx.Provider>
      </Suspense>
      <OrbitControls makeDefault target={INITIAL_CAMERA.target} enableDamping minDistance={0.08} maxDistance={4} onStart={props.onInteract} />
    </Canvas>
  );
}

useGLTF.preload(MODEL_URL.skin, MODEL_URL.draco);
useGLTF.preload(MODEL_URL.nails, MODEL_URL.draco);
