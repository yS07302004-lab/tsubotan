/** アプリ座標（m, Y-up, 前方=+Z, 体の右=-X）。README「座標系」参照 */
export type Vec3 = [number, number, number];

/** 体の右・左。正中の穴（任脈・督脈）は将来 'C' を足す */
export type Side = 'R' | 'L';
export const SIDES: Side[] = ['R', 'L'];
export const SIDE_LABEL: Record<Side, string> = { R: '右', L: '左' };

export type PositionStatus = 'draft' | 'checked';

export interface Acupoint {
  id: string; // WHO コード（LU1 など）
  name: string;
  reading: string;
  meridian: string;
  location: string;
  /** 教科書の別説（別の部位の取り方）があれば */
  locationAlt?: string;
  landmarks: string[];
  kotsudo: string | null;
  tags: string[];
  etymology: { text: string; status: 'draft' | 'checked'; sources: string[] };
  /** 左右それぞれの位置（まだ置いていない側は無い） */
  positions: Partial<Record<Side, Vec3>>;
  /** 位置が教科書で確認済みか（無ければ draft 扱い） */
  positionStatus?: PositionStatus;
}

export interface KotsudoSegment {
  id: string;
  from: string;
  to: string;
  sun: number;
  extend?: number;
  note?: string;
  /** 'point_height'：横向きの区間。物差しを選んだ穴の高さへ平行移動して描く */
  align?: 'point_height';
}

export interface Landmark {
  name: string;
  side: Side | 'midline';
  note: string;
  position: Vec3 | null;
  positionStatus?: PositionStatus;
}

/** 選んでいる穴（どちら側か込み） */
export interface PointRef {
  id: string;
  side: Side;
}

/** 配置モードで置く対象（経穴の片側 or 骨度法の基準点） */
export type PlaceTarget = { kind: 'point'; id: string; side: Side } | { kind: 'landmark'; key: string };

export const landmarkKey = (l: Pick<Landmark, 'name' | 'side'>) => `${l.name}|${l.side}`;

/** 名前と側から基準点を探す（その側に無ければ正中のもの） */
export function findLandmark(list: Landmark[], name: string | undefined, side: Side): Landmark | undefined {
  if (!name) return undefined;
  return list.find((l) => l.name === name && l.side === side) ?? list.find((l) => l.name === name && l.side === 'midline');
}

/** 皮膚の下に表示する層（骨・筋・動脈・神経） */
export type LayerName = 'bones' | 'muscles' | 'arteries' | 'nerves';
export const LAYERS: { name: LayerName; label: string; color: string }[] = [
  { name: 'bones', label: '骨', color: '#fbf7ec' },
  { name: 'muscles', label: '筋', color: '#b8504a' },
  { name: 'arteries', label: '動脈', color: '#e8443a' },
  { name: 'nerves', label: '神経', color: '#f2c230' },
];
export type LayerState = Record<LayerName, boolean>;
