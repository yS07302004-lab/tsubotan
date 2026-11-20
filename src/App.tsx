import { useMemo, useState } from 'react';
import Viewer, { type ViewName } from './components/Viewer';
import PointCard from './components/PointCard';
import PointList from './components/PointList';
import PlacementPanel, { allTargets, targetKey } from './components/PlacementPanel';
import { CREDIT, meridianOf } from './data';
import { roundVec, usePlacement } from './placement';
import type { PlaceTarget, PointRef, Vec3 } from './types';

// 配置モードは開発用：開発サーバー、または URL に ?dev を付けたときだけ出す
const DEV = import.meta.env.DEV || new URLSearchParams(location.search).has('dev');

export default function App() {
  const { points, landmarks, setPoint, setPointStatus, setLandmark, reset } = usePlacement();
  const [tab, setTab] = useState<'3d' | 'list'>('3d');
  const [selected, setSelected] = useState<PointRef | null>(null);
  const [skinOpacity, setSkinOpacity] = useState(1);
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

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          ツボ単<small>{selPoint ? meridianOf(selPoint.meridian)?.name : '肺経・腎経'}</small>
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
        {tab === 'list' && <PointList points={points} selected={selected} onPick={pick} />}
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
    </div>
  );
}
