import lungJson from '../data/lung.json';
import kidneyJson from '../data/kidney.json';
import kotsudoJson from '../data/kotsudo.json';
import landmarksJson from '../data/landmarks.json';
import type { Acupoint, KotsudoSegment, Landmark } from './types';

export interface Meridian {
  code: string;
  name: string;
  file: string; // 書き出すときのファイル名
  points: Acupoint[];
}

// 経絡を足すときは data/<名前>.json を作ってここに並べる
export const MERIDIANS: Meridian[] = [
  { code: 'LU', name: '手の太陰肺経', file: 'lung.json', points: lungJson as unknown as Acupoint[] },
  { code: 'KI', name: '足の少陰腎経', file: 'kidney.json', points: kidneyJson as unknown as Acupoint[] },
];

export const ACUPOINTS: Acupoint[] = MERIDIANS.flatMap((m) => m.points);
export const KOTSUDO = kotsudoJson as unknown as KotsudoSegment[];
export const LANDMARKS = landmarksJson as unknown as Landmark[];

export const meridianOf = (code: string) => MERIDIANS.find((m) => m.code === code);

export const CREDIT =
  'BodyParts3D, Copyright© The Database Center for Life Science licensed by CC Attribution-Share Alike 2.1 Japan';

export const MODEL_URL = {
  skin: `${import.meta.env.BASE_URL}models/skin.glb`,
  bones: `${import.meta.env.BASE_URL}models/bones.glb`,
  draco: `${import.meta.env.BASE_URL}draco/`,
};

export function kotsudoById(id: string | null): KotsudoSegment | undefined {
  return id ? KOTSUDO.find((k) => k.id === id) : undefined;
}
