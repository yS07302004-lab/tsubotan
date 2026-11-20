#!/usr/bin/env bash
# BodyParts3D (partof, 4.0, 解像度99) を bp3d/ にダウンロードして展開する
# ライセンス: CC BY-SA 2.1 JP  https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html
set -euo pipefail
cd "$(dirname "$0")/.."
B=https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST
mkdir -p bp3d && cd bp3d
for f in partof_parts_list_e.txt partof_element_parts.txt partof_inclusion_relation_list.txt isa_parts_list_e.txt isa_element_parts.txt isa_inclusion_relation_list.txt partof_BP3D_4.0_obj_99.zip isa_BP3D_4.0_obj_99.zip; do
  [ -f "$f" ] || curl -fL -o "$f" "$B/$f"
done
[ -d partof_BP3D_4.0_obj_99 ] || unzip -q partof_BP3D_4.0_obj_99.zip
# is_a 版：筋・腱・血管など（手掌・足底・爪の色分けと、取穴の計算で使う。約480MB）
[ -d isa_BP3D_4.0_obj_99 ] || unzip -q isa_BP3D_4.0_obj_99.zip
echo "done: bp3d/partof_BP3D_4.0_obj_99"
