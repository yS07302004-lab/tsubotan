import { useMemo, useState } from 'react';
import Viewer, { type ViewName } from './components/Viewer';
import PointCard from './components/PointCard';
import PointList from './components/PointList';
import PlacementPanel, { allTargets, targetKey } from './components/PlacementPanel';
import { CREDIT, MERIDIAN_NAMES } from './data';
import { roundVec, usePlacement } from './placement';
import type { PlaceTarget, Vec3 } from './types';

// 配置モードは開発用：開発サーバー、または URL に ?dev を付けたときだけ出す
const DEV = import.meta.env.DEV || new URLSearchParams(location.search).has('dev');

export default function App() {
  const { points, landmarks, set, reset } = usePlacement();
  const [tab, setTab] = useState<'3d' | 'list'>('3d');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [skinOpacity, setSkinOpacity] = useState(1);
  const [placing, setPlacing] = useState(false);
  const [target, setTarget] = useState<PlaceTarget>({ kind: 'point', id: points[0].id });
  const [autoNext, setAutoNext] = useState(true);
  const [focus, setFocus] = useState<{ pos: Vec3 | null; key: number }>({ pos: null, key: 0 });
  const [view, setView] = useState<{ name: ViewName | null; key: number }>({ name: null, key: 0 });

  const selected = points.find((p) => p.id === selectedId);
  const targets = useMemo(() => allTargets(points, landmarks), [points, landmarks]);

  const pick = (id: string) => {
    setSelectedId(id);
    setTab('3d');
    const p = points.find((x) => x.id === id);
    if (p?.position) setFocus((f) => ({ pos: p.position, key: f.key + 1 }));
  };

  // カードの ‹ › と横スワイプで、前後の穴へ移る
  const step = (d: 1 | -1) => {
    const i = points.findIndex((p) => p.id === selectedId);
    const next = points[i + d];
    if (next) pick(next.id);
  };
  const selIndex = points.findIndex((p) => p.id === selectedId);

  const onPlace = (p: Vec3) => {
    const kind = target.kind === 'point' ? 'points' : 'landmarks';
    set(kind, target.id, { position: roundVec(p), positionStatus: 'draft' });
    if (target.kind === 'point') setSelectedId(target.id);
    if (autoNext) {
      const i = targets.findIndex((t) => targetKey(t) === targetKey(target));
      if (i >= 0 && i + 1 < targets.length) setTarget(targets[i + 1]);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          ツボ単<small>{MERIDIAN_NAMES.LU}</small>
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
        <Viewer
          points={points}
          landmarks={landmarks}
          selectedId={selectedId}
          onSelect={pick}
          skinOpacity={skinOpacity}
          placing={placing}
          onPlace={onPlace}
          focus={focus.pos}
          focusKey={focus.key}
          view={view.name}
          viewKey={view.key}
          showLandmarks={placing}
        />
        <div className="view-buttons" role="group" aria-label="視点">
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
        <p className="credit">{CREDIT}</p>
        {tab === 'list' && <PointList points={points} selectedId={selectedId} onPick={pick} />}
      </main>

      <footer className="bottom">
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
        {placing ? (
          <PlacementPanel
            points={points}
            landmarks={landmarks}
            target={target}
            onTarget={setTarget}
            autoNext={autoNext}
            onAutoNext={setAutoNext}
            onClear={() => set(target.kind === 'point' ? 'points' : 'landmarks', target.id, { position: null, positionStatus: 'draft' })}
            onStatus={(s) => set(target.kind === 'point' ? 'points' : 'landmarks', target.id, { positionStatus: s })}
            onResetAll={reset}
          />
        ) : (
          selected && (
            <PointCard
              point={selected}
              landmarks={landmarks}
              onClose={() => setSelectedId(null)}
              onPrev={selIndex > 0 ? () => step(-1) : undefined}
              onNext={selIndex < points.length - 1 ? () => step(1) : undefined}
            />
          )
        )}
      </footer>
    </div>
  );
}
