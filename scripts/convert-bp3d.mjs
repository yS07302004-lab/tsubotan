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
const OBJ_DIR_ISA = path.join(BP, 'isa_BP3D_4.0_obj_99'); // 筋・血管・神経などは is_a 版にしか無い
const objPath = (f) => [OBJ_DIR, OBJ_DIR_ISA].map((d) => path.join(d, f + '.obj')).find((p) => fs.existsSync(p));
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
  return [...files].filter((f) => objPath(f)).sort();
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
    const m = readObj(objPath(f));
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
  // m.cls（頂点ごとの領域）があれば一緒に並べ替える
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
  const cls = [];
  for (let v = 0; v < n; v++) {
    if (find(v) !== outer) continue;
    remap[v] = pos.length / 3;
    if (m.cls) cls.push(m.cls[v]);
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
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), idx: new Uint32Array(idx), cls: m.cls ? cls : null };
}

// 皮膚の頂点色：0=皮膚, 1=手掌・足底（赤白肉際の白い側）, 2=爪。scripts/skin_regions.py が作る
const REGION_COLORS = ['#e3b99c', '#f2d3bf', '#fbe4e4'];
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function regionColors(cls) {
  const rgb = REGION_COLORS.map((h) => [1, 3, 5].map((i) => srgbToLinear(parseInt(h.slice(i, i + 2), 16) / 255)));
  const out = new Float32Array(cls.length * 3);
  cls.forEach((c, i) => out.set(rgb[c] ?? rgb[0], i * 3));
  return out;
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

async function writeGlb(name, meshName, files, { outerOnly = false, regions = null } = {}) {
  const raw = merge(files);
  if (regions) {
    if (regions.length !== raw.pos.length / 3) throw new Error(`skin-regions.txt の長さ ${regions.length} が頂点数 ${raw.pos.length / 3} と合わない`);
    raw.cls = regions;
  }
  const m = outerOnly ? keepOuterShell(raw) : raw;
  const doc = new Document();
  doc.getRoot().getAsset().copyright = CREDIT;
  const buf = doc.createBuffer();
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(m.pos).setBuffer(buf))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(m.nor).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(m.idx).setBuffer(buf))
    .setMaterial(doc.createMaterial(meshName));
  if (m.cls) prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(regionColors(m.cls)).setBuffer(buf));
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

// 部品の重心で選ぶ（part_of の木では筋・血管が手足に属していないため）
function centroid(f) {
  const m = readObj(objPath(f));
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < m.pos.length; i += 3) { x += m.pos[i]; y += m.pos[i + 1]; z += m.pos[i + 2]; }
  const n = m.pos.length / 3;
  return [x / n, y / n, z / n];
}
// 上肢：体の中心から外（|x|>0.15m）で肩より下、下肢：殿部より下（y<0.85m）で正中から離れた所（骨盤底の筋を除く）
const inLimbs = ([x, y]) => (Math.abs(x) > 0.15 && y < 1.4) || (y < 0.85 && Math.abs(x) > 0.03);
const limbFiles = (root) => filesUnder('isa', root).filter((f) => inLimbs(centroid(f)));

fs.mkdirSync(OUT, { recursive: true });
const regionsFile = path.join(ROOT, 'scripts', 'skin-regions.txt');
const regions = fs.existsSync(regionsFile) ? [...fs.readFileSync(regionsFile, 'utf8').trim()].map(Number) : null;
if (!regions) console.warn('scripts/skin-regions.txt が無いので、手掌・足底・爪の色は付けない（python3 scripts/skin_regions.py で作る）');
const skin = await writeGlb('skin.glb', 'skin', filesUnder('partof', 'FMA7163'), { outerOnly: true, regions }); // skin（外側の面だけ）
const bones = await writeGlb('bones.glb', 'bones', filesUnder('isa', 'FMA5018', 'FMA7591')); // bone organ + costal cartilage
// ---- 目印の強調表示用：data/structures.json に出てくる部品を、部品ごとの別メッシュ（ノード名＝部品名）で1つの glb に入れる
const partFiles = new Map();
for (const tree of ['isa', 'partof'])
  for (const [, n, f] of readTsv(`${tree}_element_parts.txt`)) {
    if (!partFiles.has(n)) partFiles.set(n, new Set());
    partFiles.get(n).add(f.trim());
  }
async function writeStructures() {
  const S = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'structures.json'), 'utf8'));
  const partNames = new Set();
  for (const { parts } of Object.values(S))
    for (const p of parts) for (const side of ['right', 'left']) partNames.add(p.replaceAll('{side}', side));
  const doc = new Document();
  doc.getRoot().getAsset().copyright = CREDIT;
  const buf = doc.createBuffer();
  const scene = doc.createScene();
  let total = 0;
  for (const name of [...partNames].sort()) {
    const files = [...(partFiles.get(name) ?? [])].filter((f) => objPath(f)).sort();
    if (!files.length) throw new Error('part not found: ' + name);
    const m = merge(files);
    total += m.pos.length / 3;
    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(m.pos).setBuffer(buf))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(m.nor).setBuffer(buf))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(m.idx).setBuffer(buf));
    scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
  }
  const io = new NodeIO().registerExtensions([KHRDracoMeshCompression]).registerDependencies({
    'draco3d.encoder': await draco3d.createEncoderModule(),
    'draco3d.decoder': await draco3d.createDecoderModule(),
  });
  if (USE_DRACO) await doc.transform(draco({ quantizePosition: 14, quantizeNormal: 10 }));
  const out = path.join(OUT, 'structures.glb');
  await io.write(out, doc);
  const info = { file: 'structures.glb', parts: partNames.size, vertices: total, bytes: fs.statSync(out).size };
  console.log(info);
  return info;
}

// ---- 爪：scripts/nails.py が作った形（皮膚の上に重ねる薄い板）を1つのメッシュにする
async function writeNails() {
  const file = path.join(ROOT, 'scripts', 'nails.json');
  if (!fs.existsSync(file)) {
    console.warn('scripts/nails.json が無いので爪は作らない（python3 scripts/nails.py で作る）');
    return null;
  }
  const { nails } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pos = [];
  const idx = [];
  for (const n of nails) {
    const base = pos.length / 3;
    for (const p of n.positions) pos.push(...p);
    for (const i of n.indices) idx.push(i + base);
  }
  // 法線：面の法線を頂点に足し合わせる
  const nor = new Float32Array(pos.length);
  for (let k = 0; k < idx.length; k += 3) {
    const [a, b, c] = [idx[k], idx[k + 1], idx[k + 2]].map((i) => pos.slice(i * 3, i * 3 + 3));
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    for (const i of [idx[k], idx[k + 1], idx[k + 2]]) for (let j = 0; j < 3; j++) nor[i * 3 + j] += n[j];
  }
  for (let i = 0; i < nor.length; i += 3) {
    const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]) || 1;
    nor[i] /= l; nor[i + 1] /= l; nor[i + 2] /= l;
  }
  const doc = new Document();
  doc.getRoot().getAsset().copyright = CREDIT;
  const buf = doc.createBuffer();
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buf))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nor).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(idx)).setBuffer(buf));
  doc.createScene().addChild(doc.createNode('nails').setMesh(doc.createMesh('nails').addPrimitive(prim)));
  const out = path.join(OUT, 'nails.glb');
  await new NodeIO().write(out, doc);
  const info = { file: 'nails.glb', nails: nails.length, bytes: fs.statSync(out).size };
  console.log(info);
  return info;
}

// 表示を切り替えるレイヤー（アプリで必要になったときだけ読み込む）
const muscles = await writeGlb('muscles.glb', 'muscles', limbFiles('FMA5022')); // muscle organ（上肢・下肢）
const arteries = await writeGlb('arteries.glb', 'arteries', limbFiles('FMA50720')); // artery（上肢・下肢）
const nerves = await writeGlb('nerves.glb', 'nerves', filesUnder('isa', 'FMA65132')); // nerve（全部。BodyParts3D には主な神経だけ）
const structures = await writeStructures();
const nailsInfo = await writeNails();
fs.writeFileSync(
  path.join(OUT, 'manifest.json'),
  JSON.stringify(
    {
      credit: CREDIT,
      license: 'CC BY-SA 2.1 JP',
      coordinate: 'meters, Y-up, anterior=+Z, body right=-X; from BodyParts3D (mm, Z-up, anterior=-Y) via (x,y,z)->(x,z,-y)*0.001',
      draco: USE_DRACO,
      models: [skin, bones, muscles, arteries, nerves, structures, nailsInfo].filter(Boolean),
    },
    null,
    2,
  ),
);
