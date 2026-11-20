// 配置モードで決めた座標を保持する（ブラウザの localStorage に一時保存し、JSON で書き出す）
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ACUPOINTS, LANDMARKS } from './data';
import { landmarkKey, type Acupoint, type Landmark, type PositionStatus, type Side, type Vec3 } from './types';

const KEY = 'tsubotan.placement.v2';

interface PointOv {
  positions?: Partial<Record<Side, Vec3 | null>>; // null はその側を消す
  positionStatus?: PositionStatus;
}
interface LandmarkOv {
  position?: Vec3 | null;
  positionStatus?: PositionStatus;
}
type Overrides = { points: Record<string, PointOv>; landmarks: Record<string, LandmarkOv> };

const EMPTY: Overrides = { points: {}, landmarks: {} };

function load(): Overrides {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* 保存できない環境では無視 */
  }
  return EMPTY;
}

/** 0.1mm に丸める（単位 m） */
export function roundVec(v: Vec3): Vec3 {
  return v.map((x) => Math.round(x * 10000) / 10000) as Vec3;
}

function applyPoint(p: Acupoint, o: PointOv | undefined): Acupoint {
  if (!o) return p;
  const positions = { ...p.positions };
  for (const [s, v] of Object.entries(o.positions ?? {}) as [Side, Vec3 | null][]) {
    if (v) positions[s] = v;
    else delete positions[s];
  }
  return { ...p, positions, positionStatus: o.positionStatus ?? p.positionStatus };
}

export function usePlacement() {
  const [ov, setOv] = useState<Overrides>(load);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(ov));
    } catch {
      /* ignore */
    }
  }, [ov]);

  const points: Acupoint[] = useMemo(() => ACUPOINTS.map((p) => applyPoint(p, ov.points[p.id])), [ov]);
  const landmarks: Landmark[] = useMemo(
    () =>
      LANDMARKS.map((l) => {
        const o = ov.landmarks[landmarkKey(l)];
        return o ? { ...l, ...o, position: o.position === undefined ? l.position : o.position } : l;
      }),
    [ov],
  );

  const setPoint = useCallback((id: string, side: Side, position: Vec3 | null) => {
    setOv((prev) => {
      const cur = prev.points[id] ?? {};
      return { ...prev, points: { ...prev.points, [id]: { ...cur, positions: { ...cur.positions, [side]: position }, positionStatus: 'draft' } } };
    });
  }, []);
  const setPointStatus = useCallback((id: string, positionStatus: PositionStatus) => {
    setOv((prev) => ({ ...prev, points: { ...prev.points, [id]: { ...prev.points[id], positionStatus } } }));
  }, []);
  const setLandmark = useCallback((key: string, o: LandmarkOv) => {
    setOv((prev) => ({ ...prev, landmarks: { ...prev.landmarks, [key]: { ...prev.landmarks[key], ...o } } }));
  }, []);
  const reset = useCallback(() => setOv(EMPTY), []);

  return { points, landmarks, setPoint, setPointStatus, setLandmark, reset };
}

// 1行にまとめた JSON（["a", "b"] / {"k": 1} の形。文字列の中は変えない）
const j = (v: unknown) =>
  JSON.stringify(v, null, 1)
    .replace(/\n\s*/g, ' ')
    .replace(/([[{]) /g, '$1')
    .replace(/ ([\]}])/g, '$1');

/** data/<経絡>.json と同じ書式（1穴を数行にまとめる）で書き出す */
export function formatAcupoints(points: Acupoint[]): string {
  const body = points.map((p) => {
    const { id, name, reading, meridian, location, landmarks, kotsudo, tags, etymology, positions, positionStatus, ...rest } = p;
    const pos = (['R', 'L'] as Side[])
      .filter((s) => positions[s])
      .map((s) => `"${s}": ${j(positions[s])}`)
      .join(', ');
    const lines = [
      `"id": ${j(id)}, "name": ${j(name)}, "reading": ${j(reading)}, "meridian": ${j(meridian)},`,
      `"location": ${j(location)},`,
      `"landmarks": ${j(landmarks)},`,
      `"kotsudo": ${j(kotsudo)},`,
      `"tags": ${j(tags)},`,
      `"etymology": { "text": ${j(etymology.text)}, "status": ${j(etymology.status)}, "sources": ${j(etymology.sources)} },`,
      ...Object.entries(rest).map(([k, v]) => `${j(k)}: ${j(v)},`),
      `"positions": {${pos}}${positionStatus ? `, "positionStatus": ${j(positionStatus)}` : ''}`,
    ];
    return `  {\n${lines.map((l) => '    ' + l).join('\n')}\n  }`;
  });
  return `[\n${body.join(',\n')}\n]\n`;
}

/** data/landmarks.json と同じ書式（1行1件）で書き出す */
export function formatLandmarks(items: Landmark[]): string {
  return `[\n${items.map((l) => '  ' + j(l)).join(',\n')}\n]\n`;
}
