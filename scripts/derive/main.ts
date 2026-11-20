// 仮置きの位置を計算して data/*.json に書き込む
//   node --experimental-strip-types scripts/derive/main.ts [LU KI PC BL]
// positionStatus が "checked" の穴・基準点は上書きしない（教科書で確かめた位置を守る）
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, V, mirror, r4, type V3 } from './lib.ts';
import { lung } from './lung.ts';
import { kidney } from './kidney.ts';
import { pericardium } from './pericardium.ts';
import { bladder } from './bladder.ts';

type Result = { P: Record<string, V3>; L?: Record<string, V3>; mid?: Record<string, V3>; side?: Record<string, V3> };
const MODULES: Record<string, { file: string; run: (lm: Record<string, V3>) => Result }> = {
  LU: { file: 'lung.json', run: lung },
  KI: { file: 'kidney.json', run: kidney },
  PC: { file: 'pericardium.json', run: pericardium },
  BL: { file: 'bladder.json', run: bladder },
};
const want = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(MODULES);

const dataPath = (f: string) => path.join(ROOT, 'data', f);
const lmFile = dataPath('landmarks.json');
const landmarks: any[] = JSON.parse(fs.readFileSync(lmFile, 'utf8'));
const lmR: Record<string, V3> = {};
for (const l of landmarks) if (l.side !== 'L' && l.position) lmR[l.name] = V(...(l.position as [number, number, number]));

function setLandmark(name: string, side: 'R' | 'L' | 'midline', p: V3, note = '') {
  let l = landmarks.find((x) => x.name === name && x.side === side);
  if (!l) {
    l = { name, side, note, position: null, positionStatus: 'draft' };
    landmarks.push(l);
  }
  if (l.positionStatus === 'checked') return;
  l.position = r4(p);
}

for (const code of want) {
  const m = MODULES[code];
  if (!m) throw new Error('unknown meridian ' + code);
  const res = m.run(lmR);
  const file = dataPath(m.file);
  const pts: any[] = JSON.parse(fs.readFileSync(file, 'utf8'));
  let n = 0;
  for (const p of pts) {
    const v = res.P[p.id];
    if (!v || p.positionStatus === 'checked') continue;
    p.positions = { R: r4(v), L: r4(mirror(v)) };
    p.positionStatus = 'draft';
    n++;
  }
  for (const [name, v] of Object.entries({ ...res.L, ...res.side })) {
    setLandmark(name, 'R', v);
    setLandmark(name, 'L', mirror(v));
  }
  for (const [name, v] of Object.entries(res.mid ?? {})) setLandmark(name, 'midline', v);
  fs.writeFileSync(file, formatPoints(pts));
  console.log(`${code}: ${n} points -> data/${m.file}`);
}
fs.writeFileSync(lmFile, `[\n${landmarks.map((l) => '  ' + j(l)).join(',\n')}\n]\n`);

// ---- src/placement.ts と同じ書式
function j(v: unknown) {
  return JSON.stringify(v, null, 1).replace(/\n\s*/g, ' ').replace(/([[{]) /g, '$1').replace(/ ([\]}])/g, '$1');
}
function formatPoints(points: any[]) {
  const body = points.map((p) => {
    const { id, name, reading, meridian, location, landmarks, kotsudo, tags, etymology, positions, positionStatus, ...rest } = p;
    const pos = ['R', 'L'].filter((s) => positions?.[s]).map((s) => `"${s}": ${j(positions[s])}`).join(', ');
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
