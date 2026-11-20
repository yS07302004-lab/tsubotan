import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import type { ViewName } from './components/Viewer';
import StartScreen, { loadStartChoice, saveStartChoice, type StartChoice } from './components/StartScreen';

// 3D（three.js）はスタート画面で選んでから読み込む。スタート画面の表示中に裏で先読みしておく
const loadViewer = () => import('./components/Viewer');
const Viewer = lazy(loadViewer);
import PointCard from './components/PointCard';
import PointList from './components/PointList';
import PlacementPanel, { allTargets, targetKey } from './components/PlacementPanel';
import { CREDIT, MERIDIANS, meridianOf } from './data';
import { roundVec, usePlacement } from './placement';
import { LAYERS, type LayerName, type LayerState, type PlaceTarget, type PointRef, type Vec3 } from './types';

// 配置モードは開発用：開発サーバー、または URL に ?dev を付けたときだけ出す
const DEV = import.meta.env.DEV || new URLSearchParams(location.search).has('dev');

export default function App() {
  const { points, landmarks, setPoint, setPointStatus, setLandmark, reset } = usePlacement();
  const [tab, setTab] = useState<'3d' | 'list'>('3d');
  const [selected, setSelected] = useState<PointRef | null>(null);
  const [skinOpacity, setSkinOpacity] = useState(1);
  // スタート画面で選んだもの（前回の選択を覚えておく）
  const [started, setStarted] = useState(false);
  const initial = useMemo(loadStartChoice, []);
  const [layers, setLayers] = useState<LayerState>(initial.layers);
  const [visibleMeridians, setVisibleMeridians] = useState<string[]>(initial.meridians);
  const [showGhost, setShowGhost] = useState(initial.ghost);
  const [panelOpen, setPanelOpen] = useState(false);
  useEffect(() => {
    // スタート画面を出している間に、3D の部品とモデルを先読みする
    const id = setTimeout(() => void loadViewer(), 300);
    return () => clearTimeout(id);
  }, []);
  const start = (c: StartChoice, toList = false) => {
    saveStartChoice(c);
    setLayers(c.layers);
    setVisibleMeridians(c.meridians);
    setShowGhost(c.ghost);
    if (c.layers.muscles || c.layers.arteries || c.layers.nerves) setSkinOpacity(0.3);
    setTab(toList ? 'list' : '3d');
    setStarted(true);
  };
  const toggleMeridian = (code: string) =>
    setVisibleMeridians((v) => (v.includes(code) ? v.filter((c) => c !== code) : [...v, code]));
  const toggleLayer = (name: LayerName) => {
    const on = !layers[name];
    setLayers((l) => ({ ...l, [name]: on }));
    // 皮膚が濃いままだと中が見えないので、層をオンにしたら皮膚を薄くする
    if (on && skinOpacity > 0.6) setSkinOpacity(0.3);
  };
  const [placing, setPlacing] = useState(false);
  const [target, setTarget] = useState<PlaceTarget>({ kind: 'point', id: points[0].id, side: 'R' });
  const [autoNext, setAutoNext] = useState(true);
  const [focus, setFocus] = useState<{ pos: Vec3 | null; key: number }>({ pos: null, key: 0 });
  const [view, setView] = useState<{ name: ViewName | null; key: number }>({ name: null, key: 0 });

  const selPoint = selected ? points.find((p) => p.id === selected.id) : undefined;
  const targets = useMemo(() => allTargets(points, landmarks), [points, landmarks]);

  const pick = (ref: PointRef) => {
    const p = points.find((x) => x.id === ref.id);
    // 選んだ側にまだ位置が無ければ、ある側を出す
    const side = p?.positions[ref.side] ? ref.side : p?.positions.R ? 'R' : p?.positions.L ? 'L' : ref.side;
    setSelected({ id: ref.id, side });
    setTab('3d');
    if (p && !visibleMeridians.includes(p.meridian)) setVisibleMeridians((v) => [...v, p.meridian]);
    const pos = p?.positions[side];
    if (pos) setFocus((f) => ({ pos, key: f.key + 1 }));
  };

  // カードの ‹ › と横スワイプで、同じ経絡の前後の穴へ移る（側はそのまま）
  const sameMeridian = selPoint ? points.filter((p) => p.meridian === selPoint.meridian) : [];
  const selIndex = sameMeridian.findIndex((p) => p.id === selected?.id);
  const step = (d: 1 | -1) => {
    const next = sameMeridian[selIndex + d];
    if (next && selected) pick({ id: next.id, side: selected.side });
  };

  const onPlace = (p: Vec3) => {
    const pos = roundVec(p);
    if (target.kind === 'point') {
      setPoint(target.id, target.side, pos);
      setSelected({ id: target.id, side: target.side });
    } else {
      setLandmark(target.key, { position: pos, positionStatus: 'draft' });
    }
    if (autoNext) {
      const i = targets.findIndex((t) => targetKey(t) === targetKey(target));
      if (i >= 0 && i + 1 < targets.length) setTarget(targets[i + 1]);
    }
  };

  if (!started) return <StartScreen initial={initial} onStart={start} />;

  const controls = (
    <div className="panel" role="dialog" aria-label="表示の設定">
      <label className="slider">
        <span>皮膚</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(skinOpacity * 100)}
          onChange={(e) => setSkinOpacity(Number(e.target.value) / 100)}
          aria-label="皮膚の透明度"
        />
        <output>{Math.round(skinOpacity * 100)}%</output>
      </label>
      <div className="layers meridians" role="group" aria-label="表示する経絡">
        {MERIDIANS.map((m) => (
          <button key={m.code} className={visibleMeridians.includes(m.code) ? 'on' : ''} onClick={() => toggleMeridian(m.code)} aria-pressed={visibleMeridians.includes(m.code)}>
            {m.short}
          </button>
        ))}
        <button className={showGhost ? 'on' : ''} onClick={() => setShowGhost((v) => !v)} aria-pressed={showGhost} title="体の向こう側の経絡・経穴を薄く表示">
          透視
        </button>
      </div>
      <div className="layers" role="group" aria-label="表示する層">
        {LAYERS.map((l) => (
          <button key={l.name} className={layers[l.name] ? 'on' : ''} onClick={() => toggleLayer(l.name)} aria-pressed={layers[l.name]}>
            <i style={{ background: l.color }} />
            {l.label}
          </button>
        ))}
      </div>
      <div className="layers views" role="group" aria-label="視点">
        {(
          [
            ['front', '前'],
            ['side', '横'],
            ['back', '後'],
            ['reset', '全体'],
          ] as const
        ).map(([name, label]) => (
          <button key={name} onClick={() => setView((v) => ({ name, key: v.key + 1 }))}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          ツボ単<small>{selPoint ? meridianOf(selPoint.meridian)?.name : ''}</small>
        </h1>
        <nav className="tabs">
          <button className={tab === '3d' ? 'active' : ''} onClick={() => setTab('3d')}>
            3D
          </button>
          <button className={tab === 'list' ? 'active' : ''} onClick={() => setTab('list')}>
            一覧
          </button>
          {DEV && (
            <button
              className={placing ? 'active dev' : 'dev'}
              onClick={() => {
                setPlacing((v) => !v);
                setTab('3d');
              }}
              title="配置モード（開発用）"
            >
              配置
            </button>
          )}
        </nav>
      </header>

      <main className="stage">
        <Suspense fallback={<div className="loading">3Dを準備中…</div>}>
          <Viewer
            points={points}
            landmarks={landmarks}
            selected={selected}
            onSelect={pick}
            skinOpacity={skinOpacity}
            placing={placing}
            onPlace={onPlace}
            focus={focus.pos}
            focusKey={focus.key}
            view={view.name}
            viewKey={view.key}
            showLandmarks={placing}
            layers={layers}
            visibleMeridians={visibleMeridians}
            showGhost={showGhost}
            onInteract={() => setPanelOpen(false)}
          />
        </Suspense>
        <p className="credit">{CREDIT}</p>
        {tab === '3d' && (
          <>
            {panelOpen && controls}
            {/* スイッチ類はふだんしまっておき、このボタンで出す（3Dを動かし始めると自動でしまう） */}
            <button className={'panel-toggle' + (panelOpen ? ' on' : '')} onClick={() => setPanelOpen((v) => !v)} aria-expanded={panelOpen}>
              {panelOpen ? '閉じる' : '表示'}
            </button>
          </>
        )}
        {tab === 'list' && <PointList points={points} selected={selected} onPick={pick} />}
      </main>

      {(placing || (selPoint && selected)) && (
        <footer className="bottom">
          {placing ? (
            <PlacementPanel
              points={points}
              landmarks={landmarks}
              target={target}
              onTarget={setTarget}
              autoNext={autoNext}
              onAutoNext={setAutoNext}
              onClear={() => (target.kind === 'point' ? setPoint(target.id, target.side, null) : setLandmark(target.key, { position: null }))}
              onStatus={(s) => (target.kind === 'point' ? setPointStatus(target.id, s) : setLandmark(target.key, { positionStatus: s }))}
              onResetAll={reset}
            />
          ) : (
            selPoint &&
            selected && (
              <PointCard
                point={selPoint}
                side={selected.side}
                onSide={(side) => pick({ id: selPoint.id, side })}
                landmarks={landmarks}
                onClose={() => setSelected(null)}
                onPrev={selIndex > 0 ? () => step(-1) : undefined}
                onNext={selIndex < sameMeridian.length - 1 ? () => step(1) : undefined}
              />
            )
          )}
        </footer>
      )}
    </div>
  );
}
