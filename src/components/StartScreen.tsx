import { useState } from 'react';
import { CREDIT, MERIDIANS } from '../data';
import { LAYERS, type LayerState } from '../types';

export interface StartChoice {
  meridians: string[];
  layers: LayerState;
  ghost: boolean;
}

const KEY = 'tsubotan.start.v1';
const DEFAULT: StartChoice = { meridians: ['LU'], layers: { bones: false, arteries: false }, ghost: true };

export function loadStartChoice(): StartChoice {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw);
      // 以前の版で保存した筋・神経の選択は捨てる
      return { ...DEFAULT, ...v, layers: { bones: !!v.layers?.bones, arteries: !!v.layers?.arteries } };
    }
  } catch {
    /* 保存できない環境では既定値 */
  }
  return DEFAULT;
}
export function saveStartChoice(c: StartChoice) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

/** スタート画面：何を表示するか選んでから 3D を立ち上げる（3D の読み込みはここで選んでから） */
export default function StartScreen({ initial, onStart }: { initial: StartChoice; onStart: (c: StartChoice, toList?: boolean) => void }) {
  const [c, setC] = useState<StartChoice>(initial);
  const toggleM = (code: string) => setC((v) => ({ ...v, meridians: v.meridians.includes(code) ? v.meridians.filter((x) => x !== code) : [...v.meridians, code] }));
  return (
    <div className="start">
      <header>
        <h1>ツボ単</h1>
        <p>経穴を3Dで見て覚える</p>
      </header>
      <section>
        <h2>表示する経絡</h2>
        <div className="start-grid">
          {MERIDIANS.map((m) => (
            <button key={m.code} className={c.meridians.includes(m.code) ? 'on' : ''} onClick={() => toggleM(m.code)} aria-pressed={c.meridians.includes(m.code)}>
              {m.name}
              <small>{m.points.length}穴</small>
            </button>
          ))}
        </div>
        <div className="start-row">
          <button onClick={() => setC((v) => ({ ...v, meridians: MERIDIANS.map((m) => m.code) }))}>すべて</button>
          <button onClick={() => setC((v) => ({ ...v, meridians: [] }))}>なし（皮膚だけ）</button>
        </div>
      </section>
      <section>
        <h2>皮膚の下に表示するもの</h2>
        <div className="start-grid two">
          {LAYERS.map((l) => (
            <button key={l.name} className={c.layers[l.name] ? 'on' : ''} onClick={() => setC((v) => ({ ...v, layers: { ...v.layers, [l.name]: !v.layers[l.name] } }))} aria-pressed={c.layers[l.name]}>
              <i style={{ background: l.color }} />
              {l.label}
            </button>
          ))}
        </div>
        <label className="start-check">
          <input type="checkbox" checked={c.ghost} onChange={(e) => setC((v) => ({ ...v, ghost: e.target.checked }))} />
          体の向こう側の経穴・経絡も薄く表示する（透視）
        </label>
        <p className="muted small">あとから3D画面の「表示」ボタンでいつでも変えられます。多く選ぶほど立ち上がりに時間がかかります。</p>
      </section>
      <div className="start-actions">
        <button className="primary big" onClick={() => onStart(c)}>
          3Dで表示する
        </button>
        <button onClick={() => onStart(c, true)}>経穴の一覧から選ぶ</button>
      </div>
      <p className="credit-start">{CREDIT}</p>
    </div>
  );
}
