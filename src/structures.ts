// 目印（骨・筋・腱・動脈・神経）と BodyParts3D の部品の対応（data/structures.json）
import structuresJson from '../data/structures.json';
import type { Side } from './types';

export type StructureKind = 'bone' | 'muscle' | 'artery' | 'nerve';
export const STRUCTURES = structuresJson as Record<string, { kind: StructureKind; parts: string[] }>;
export const KIND_COLOR: Record<StructureKind, string> = { bone: '#3b8ee8', muscle: '#f08c00', artery: '#e03131', nerve: '#e6b800' };
export const KIND_LABEL: Record<StructureKind, string> = { bone: '骨', muscle: '筋・腱', artery: '動脈', nerve: '神経' };

/** 目印の名前と側から、強調する部品名（右/左を入れたもの）を返す */
export function structureParts(landmark: string, side: Side): string[] {
  const s = STRUCTURES[landmark];
  if (!s) return [];
  return s.parts.map((p) => p.split('{side}').join(side === 'R' ? 'right' : 'left'));
}
