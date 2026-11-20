// BodyParts3D の OBJ（臓器ごと）を glTF(.glb) に変換する
//
//   node scripts/convert-bp3d.mjs [--no-draco]
//
// 入力: bp3d/partof_BP3D_4.0_obj_99/*.obj （scripts/download-bp3d.sh で取得）
// 出力: public/models/skin.glb, public/models/bones.glb, public/models/manifest.json
//
// 座標変換（README「座標系」参照）
//   BodyParts3D: 単位 mm / Z-up / 体の前方 = -Y / 体の右 = -X
//   アプリ    : 単位 m  / Y-up / 体の前方 = +Z / 体の右 = -X
//   (x, y, z)_mm -> (x, z, -y) * 0.001   （X軸まわり -90°回転 + mm→m）
//
// ライセンス: 出力モデルも CC BY-SA 2.1 JP（継承）。
import fs from 'node:fs';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { draco } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BP = path.join(ROOT, 'bp3d');
const OBJ_DIR = path.join(BP, 'partof_BP3D_4.0_obj_99');
const OUT = path.join(ROOT, 'public', 'models');
const USE_DRACO = !process.argv.includes('--no-draco');
const SCALE = 0.001;

const CREDIT =
  'BodyParts3D, Copyright© The Database Center for Life Science licensed by CC Attribution-Share Alike 2.1 Japan';

// ---- 部品リストから要素ファイル(FJ****)を集める
// tree = 'partof'（部位の包含関係）または 'isa'（分類）。骨は isa の "bone organ" で集める
// （partof の "skeleton" には上肢・下肢の骨が入っていないため）
function readTsv(file) {
  return fs.readFileSync(path.join(BP, file), 'utf8').split('\n').slice(1).filter(Boolean).map((l) => l.split('\t'));
}
function loadTree(tree) {
  const children = new Map();
  for (const [p, , c] of readTsv(`${tree}_inclusion_relation_list.txt`)) {
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(c);
  }
  const elements = new Map();
  for (const [c, , f] of readTsv(`${tree}_element_parts.txt`)) {
    if (!elements.has(c)) elements.set(c, []);
    elements.get(c).push(f);
  }
  return { children, elements };
}
const TREES = { partof: loadTree('partof'), isa: loadTree('isa') };
function filesUnder(tree, ...rootIds) {
  const { children, elements } = TREES[tree];
  const seen = new Set();
  const files = new Set();
  const stack = [...rootIds];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const f of elements.get(id) ?? []) files.add(f);
    for (const c of children.get(id) ?? []) stack.push(c);
  }
  return [...files].filter((f) => fs.existsSync(path.join(OBJ_DIR, f + '.obj'))).sort();
}

// ---- OBJ 読み込み（v / vn / f のみ。BodyParts3D は三角形・v と vn が同じ番号）
function readObj(file) {
  const pos = [];
  const nor = [];
  const idx = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.startsWith('v ')) {
      const [, x, y, z] = line.trim().split(/\s+/).map(Number);
      pos.push(x * SCALE, z * SCALE, -y * SCALE);
    } else if (line.startsWith('vn ')) {
      const [, x, y, z] = line.trim().split(/\s+/).map(Number);
      nor.push(x, z, -y);
    } else if (line.startsWith('f ')) {
      const vs = line.trim().split(/\s+/).slice(1).map((t) => parseInt(t.split('/')[0], 10) - 1);
      for (let i = 1; i + 1 < vs.length; i++) idx.push(vs[0], vs[i], vs[i + 1]);
    }
  }
  return { pos, nor, idx };
}

function merge(files) {
  const pos = [];
  const nor = [];
  const idx = [];
  for (const f of files) {
    const m = readObj(path.join(OBJ_DIR, f + '.obj'));
    const base = pos.length / 3;
    for (const v of m.pos) pos.push(v);
    for (const v of m.nor) nor.push(v);
    for (const i of m.idx) idx.push(i + base);
  }
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), idx: new Uint32Array(idx) };
}

// 皮膚の OBJ は厚みのある殻で、外側の面と内側の面（約2mm内側）の2枚が入っている。
// 内側の面があると、表面へ点を寄せたときに皮膚の下へ入ったり、半透明で2重に見えたりするので、
// つながった部分ごとに分け、外接箱がいちばん大きい部分（＝外側の面）だけを残す。
function keepOuterShell(m) {
  const n = m.pos.length / 3;
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  for (let i = 0; i < m.idx.length; i += 3) {
    const a = find(m.idx[i]);
    parent[find(m.idx[i + 1])] = a;
    parent[find(m.idx[i + 2])] = a;
  }
  const box = new Map();
  for (let v = 0; v < n; v++) {
    const r = find(v);
    const b = box.get(r) ?? { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], count: 0 };
    for (let k = 0; k < 3; k++) {
      b.min[k] = Math.min(b.min[k], m.pos[v * 3 + k]);
      b.max[k] = Math.max(b.max[k], m.pos[v * 3 + k]);
    }
    b.count++;
    box.set(r, b);
  }
  const vol = (b) => (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]);
  const [outer] = [...box.entries()].sort((x, y) => vol(y[1]) - vol(x[1]))[0];
  const remap = new Int32Array(n).fill(-1);
  const pos = [];
  const nor = [];
  for (let v = 0; v < n; v++) {
    if (find(v) !== outer) continue;
    remap[v] = pos.length / 3;
    for (let k = 0; k < 3; k++) {
      pos.push(m.pos[v * 3 + k]);
      nor.push(m.nor[v * 3 + k]);
    }
  }
  const idx = [];
  for (let i = 0; i < m.idx.length; i += 3) {
    if (remap[m.idx[i]] < 0) continue;
    idx.push(remap[m.idx[i]], remap[m.idx[i + 1]], remap[m.idx[i + 2]]);
  }
  console.log(`skin: ${box.size} parts -> kept outer shell (${pos.length / 3} of ${n} vertices)`);
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), idx: new Uint32Array(idx) };
}

function bounds(p) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[i + k]);
      max[k] = Math.max(max[k], p[i + k]);
    }
  return { min, max };
}

async function writeGlb(name, meshName, files, { outerOnly = false } = {}) {
  const m = outerOnly ? keepOuterShell(merge(files)) : merge(files);
  const doc = new Document();
  doc.getRoot().getAsset().copyright = CREDIT;
  const buf = doc.createBuffer();
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(m.pos).setBuffer(buf))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(m.nor).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(m.idx).setBuffer(buf))
    .setMaterial(doc.createMaterial(meshName));
  const mesh = doc.createMesh(meshName).addPrimitive(prim);
  const node = doc.createNode(meshName).setMesh(mesh).setExtras({ source: 'BodyParts3D 4.0 partof', files });
  doc.createScene().addChild(node);

  const io = new NodeIO().registerExtensions([KHRDracoMeshCompression]).registerDependencies({
    'draco3d.encoder': await draco3d.createEncoderModule(),
    'draco3d.decoder': await draco3d.createDecoderModule(),
  });
  // 量子化は位置 14bit（全身 1.7m で約0.1mm）にして、取穴の精度に影響しないようにする
  if (USE_DRACO) await doc.transform(draco({ quantizePosition: 14, quantizeNormal: 10 }));
  const out = path.join(OUT, name);
  await io.write(out, doc);
  const b = bounds(m.pos);
  const info = {
    file: name,
    vertices: m.pos.length / 3,
    triangles: m.idx.length / 3,
    parts: files.length,
    bytes: fs.statSync(out).size,
    bounds_m: b,
  };
  console.log(info);
  return info;
}

fs.mkdirSync(OUT, { recursive: true });
const skin = await writeGlb('skin.glb', 'skin', filesUnder('partof', 'FMA7163'), { outerOnly: true }); // skin（外側の面だけ）
const bones = await writeGlb('bones.glb', 'bones', filesUnder('isa', 'FMA5018', 'FMA7591')); // bone organ + costal cartilage
fs.writeFileSync(
  path.join(OUT, 'manifest.json'),
  JSON.stringify(
    {
      credit: CREDIT,
      license: 'CC BY-SA 2.1 JP',
      coordinate: 'meters, Y-up, anterior=+Z, body right=-X; from BodyParts3D (mm, Z-up, anterior=-Y) via (x,y,z)->(x,z,-y)*0.001',
      draco: USE_DRACO,
      models: [skin, bones],
    },
    null,
    2,
  ),
);
