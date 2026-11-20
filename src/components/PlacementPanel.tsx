import { useState } from 'react';
import { MERIDIANS } from '../data';
import { formatAcupoints, formatLandmarks } from '../placement';
import { SIDES, SIDE_LABEL, landmarkKey, type Acupoint, type Landmark, type PlaceTarget, type PositionStatus } from '../types';

interface Props {
  points: Acupoint[];
  landmarks: Landmark[];
  target: PlaceTarget;
  onTarget: (t: PlaceTarget) => void;
  autoNext: boolean;
  onAutoNext: (v: boolean) => void;
  onClear: () => void;
  onStatus: (s: PositionStatus) => void;
  onResetAll: () => void;
}

export function targetKey(t: PlaceTarget) {
  return t.kind === 'point' ? `point:${t.id}:${t.side}` : `landmark:${t.key}`;
}
function parseKey(k: string): PlaceTarget {
  const [kind, ...rest] = k.split(':');
  if (kind === 'point') return { kind: 'point', id: rest[0], side: rest[1] as 'R' | 'L' };
  return { kind: 'landmark', key: rest.join(':') };
}

/** 置く順番：経絡ごとに、穴の番号順で右→左。そのあと基準点 */
export function allTargets(points: Acupoint[], landmarks: Landmark[]): PlaceTarget[] {
  return [
    ...points.flatMap((p) => SIDES.map((side) => ({ kind: 'point', id: p.id, side }) as const)),
    ...landmarks.map((l) => ({ kind: 'landmark', key: landmarkKey(l) }) as const),
  ];
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const sideName = (s: Landmark['side']) => (s === 'midline' ? '正中' : SIDE_LABEL[s]);

export default function PlacementPanel(props: Props) {
  const { points, landmarks, target, onTarget, autoNext, onAutoNext, onClear, onStatus, onResetAll } = props;
  const [exportOpen, setExportOpen] = useState(false);
  const point = target.kind === 'point' ? points.find((p) => p.id === target.id) : undefined;
  const lm = target.kind === 'landmark' ? landmarks.find((l) => landmarkKey(l) === target.key) : undefined;
  const pos = point && target.kind === 'point' ? point.positions[target.side] : lm?.position;
  const status = (point ?? lm)?.positionStatus ?? 'draft';
  const files: [string, string][] = [
    ...MERIDIANS.map((m) => [m.file, formatAcupoints(points.filter((p) => p.meridian === m.code))] as [string, string]),
    ['landmarks.json', formatLandmarks(landmarks)],
  ];

  return (
    <section className="card placement">
      <header className="card-head">
        <h2>配置モード（開発用）</h2>
      </header>
      <p className="small muted">皮膚をタップすると、選んだ対象の位置が保存されます（骨には置かれません）。</p>
      <label className="field">
        対象
        <select value={targetKey(target)} onChange={(e) => onTarget(parseKey(e.target.value))}>
          {MERIDIANS.map((m) => (
            <optgroup key={m.code} label={m.name}>
              {points
                .filter((p) => p.meridian === m.code)
                .flatMap((p) =>
                  SIDES.map((s) => (
                    <option key={`${p.id}${s}`} value={`point:${p.id}:${s}`}>
                      {p.positions[s] ? '● ' : '○ '}
                      {p.id} {p.name}（{SIDE_LABEL[s]}）
                    </option>
                  )),
                )}
            </optgroup>
          ))}
          <optgroup label="骨度法の基準点">
            {landmarks.map((l) => (
              <option key={landmarkKey(l)} value={`landmark:${landmarkKey(l)}`}>
                {l.position ? '● ' : '○ '}
                {l.name}（{sideName(l.side)}）
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      <p className="small">{point ? point.location : lm?.note}</p>
      <p className="mono small">position: {pos ? `[${pos.join(', ')}]` : 'null'}</p>
      <div className="row">
        <label className="check">
          <input type="checkbox" checked={status === 'checked'} disabled={!pos} onChange={(e) => onStatus(e.target.checked ? 'checked' : 'draft')} />
          教科書で確認済み{point ? '（左右とも）' : ''}
        </label>
        <label className="check">
          <input type="checkbox" checked={autoNext} onChange={(e) => onAutoNext(e.target.checked)} />
          置いたら次へ
        </label>
      </div>
      <div className="row">
        <button onClick={onClear} disabled={!pos}>
          この位置を消す
        </button>
        <button className="primary" onClick={() => setExportOpen(true)}>
          JSONを書き出す
        </button>
      </div>

      {exportOpen && (
        <div className="modal" role="dialog" aria-label="JSON書き出し">
          <div className="modal-body">
            <header className="card-head">
              <h2>JSON書き出し</h2>
              <button className="icon-btn" onClick={() => setExportOpen(false)} aria-label="閉じる">
                ×
              </button>
            </header>
            <p className="small">それぞれ data/ の同名ファイルに上書きして使います。</p>
            {files.map(([name, text]) => (
              <div key={name} className="export">
                <div className="row">
                  <b>data/{name}</b>
                  <button onClick={() => navigator.clipboard?.writeText(text)}>コピー</button>
                  <button onClick={() => download(name, text)}>保存</button>
                </div>
                <textarea readOnly value={text} rows={6} />
              </div>
            ))}
            <button
              className="danger"
              onClick={() => {
                if (confirm('このブラウザに保存している配置をすべて消して、data/ の内容に戻しますか？')) onResetAll();
              }}
            >
              配置をリセット（data/ の内容に戻す）
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
