# ツボ単（肺経デモ）

経穴を「見て覚える」ための3D図鑑アプリ。まず手の太陰肺経11穴だけのデモ。仕様は [CLAUDE.md](./CLAUDE.md)。

## 使い方

公開版：https://ys07302004-lab.github.io/tsubotan/ （main に push すると GitHub Actions で自動公開。配置モードは末尾に `?dev`）

```bash
npm install
npm run dev        # http://localhost:5173 （スマホで見るときは同じLANから表示されたNetworkのURL）
npm run build      # dist/ に出力（PWA）
npm run preview    # ビルド結果の確認
```

- **3D**：1本指ドラッグで回転、ピンチで拡大、2本指ドラッグで移動。点をタップすると詳細カード
- **一覧**：タップするとその穴へカメラが寄る
- **皮膚スライダー**：0〜100%。下げると骨が透ける
- **配置**（開発用）：開発サーバー、または URL に `?dev` を付けたときだけ出る（下記）

## 3Dモデル

[BodyParts3D](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/) 4.0（part_of 版、解像度 99）から作成。

| ファイル | 中身 | 元データ | 頂点 / 三角形 | サイズ |
|---|---|---|---|---|
| `public/models/skin.glb` | 皮膚 | FMA7163 skin（FJ2810） | 102,467 / 203,382 | 0.48 MB |
| `public/models/bones.glb` | 全身の骨＋肋軟骨（1メッシュに結合） | is_a ツリーの FMA5018 bone organ と FMA7591 costal cartilage の下にある 213 パーツ | 287,126 / 520,284 | 1.27 MB |

- Draco 圧縮済み（位置 14bit 量子化：全身でおよそ 0.1mm 単位なので取穴の精度には影響しない）。ポリゴン削減はしていない
- part_of ツリーの「skeleton」には上肢・下肢の骨が入っていないため、骨は is_a ツリーから集めている
- デコーダは `public/draco/` に同梱（オフラインでも動くように CDN を使わない）

### 作り直す手順

```bash
npm run model:download   # bp3d/ に OBJ と部品リストを取得（約65MB、git には入れない）
npm run model:convert    # public/models/*.glb を生成（--no-draco で非圧縮）
```

### 座標系（実測で確認）

| | 単位 | 上方向 | 体の前 | 体の右 |
|---|---|---|---|---|
| BodyParts3D の OBJ | **mm**（OBJ ヘッダの `Bounds(mm)` と、皮膚の高さ 1719.5mm で確認） | **+Z** | **-Y**（鎖骨・足先が -Y 側） | **-X**（肝臓・右鎖骨が -X 側） |
| アプリ（three.js） | **m** | **+Y** | **+Z** | **-X** |

変換は `(x, y, z)_mm → (x, z, -y) × 0.001`（X軸まわりに -90° 回転してから mm→m）。原点は BodyParts3D のまま動かしていない（足底がおよそ y = -0.078 m、頭頂が y = 1.641 m）。
正面のカメラ（+Z 側）から見ると、体の右は画面の左に来る。
後でクイズ側と合体するときは、この表をクイズ側と突き合わせ、ずれがあれば `scripts/convert-bp3d.mjs` の変換1か所で合わせる。

モデルの姿勢は解剖学的正位（手掌が前を向き、母指が外側）。

## データ

| ファイル | 中身 |
|---|---|
| `data/lung.json` | 肺経11穴。形式は CLAUDE.md の通り。追加で `positionStatus`（`draft` / `checked`）を持つ |
| `data/kotsudo.json` | 骨度法の区間 |
| `data/landmarks.json` | 骨度法の物差しの端になる基準点（`kotsudo.json` の `from` / `to` と同じ名前）の3D座標 |

- `position` はアプリ座標（m）。`positionStatus` が `checked` でない穴は、カードに「3D上の位置は仮置きです」と出る
- 骨度法の物差しは `from` の点から `to` の点までの直線を `sun` 等分し、`extend` があれば同じ目盛りで `to` の先へ延長（点線）する

### 配置モード（開発用）

1. 右上の「配置」を押す（本番ビルドでは URL に `?dev` を付ける）
2. 対象（経穴または基準点）を選び、皮膚をタップする。当たり判定は皮膚だけで、透明度0%でも骨の上には置かれない
3. 位置は 0.1mm 単位に丸めてブラウザに一時保存される。「置いたら次へ」をオンにすると次の対象へ進む
4. 教科書で確認できたら「教科書で確認済み」にチェックを入れる
5. 「JSONを書き出す」で `lung.json` と `landmarks.json` をコピーまたは保存し、`data/` に上書きする

## ライセンス

- 3Dモデル（`public/models/`）は BodyParts3D から切り出し・変換したもので、元データと同じ **CC BY-SA 2.1 JP** で公開する（継承）。
  BodyParts3D, Copyright© The Database Center for Life Science licensed by CC Attribution-Share Alike 2.1 Japan
  https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html
- アプリ内の画面下にも同じクレジットを表示している
- ソースコードのライセンスは未定
