import lungJson from '../data/lung.json';
import kidneyJson from '../data/kidney.json';
import pericardiumJson from '../data/pericardium.json';
import bladderJson from '../data/bladder.json';
import kotsudoJson from '../data/kotsudo.json';
import landmarksJson from '../data/landmarks.json';
import type { Acupoint, KotsudoSegment, Landmark } from './types';

export interface Meridian {
  code: string;
  name: string;
  file: string; // 書き出すときのファイル名
  points: Acupoint[];
  /** 走行線のつなぎ方（穴の id の並び）。無ければ番号順に1本でつなぐ */
  lines?: string[][];
}

// 経絡を足すときは data/<名前>.json を作ってここに並べる
function range(code: string, a: number, b: number) {
  return Array.from({ length: b - a + 1 }, (_, i) => `${code}${a + i}`);
}

export const MERIDIANS: Meridian[] = [
  { code: 'LU', name: '手の太陰肺経', file: 'lung.json', points: lungJson as unknown as Acupoint[] },
  { code: 'KI', name: '足の少陰腎経', file: 'kidney.json', points: kidneyJson as unknown as Acupoint[] },
  { code: 'PC', name: '手の厥陰心包経', file: 'pericardium.json', points: pericardiumJson as unknown as Acupoint[] },
  {
    code: 'BL',
    name: '足の太陽膀胱経',
    file: 'bladder.json',
    points: bladderJson as unknown as Acupoint[],
    // 第1行線（BL1〜40）と第2行線（BL41〜54）は委中で合流し、下腿・足（BL55〜67）へ続く
    lines: [range('BL', 1, 40), [...range('BL', 41, 54), 'BL40'], ['BL40', ...range('BL', 55, 67)]],
  },
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
