import { MERIDIANS } from '../data';
import type { Acupoint, PointRef } from '../types';

export default function PointList({ points, selected, onPick }: { points: Acupoint[]; selected: PointRef | null; onPick: (ref: PointRef) => void }) {
  return (
    <div className="list">
      <nav className="list-jump">
        {MERIDIANS.map((m) => (
          <a key={m.code} href={`#meridian-${m.code}`}>
            {m.name}
          </a>
        ))}
      </nav>
      {MERIDIANS.map((m) => {
        const ps = points.filter((p) => p.meridian === m.code);
        return (
          <section key={m.code} id={`meridian-${m.code}`}>
            <h2>
              {m.name}（{ps.length}穴）
            </h2>
            <ol>
              {ps.map((p) => (
                <li key={p.id}>
                  <button className={p.id === selected?.id ? 'active' : ''} onClick={() => onPick({ id: p.id, side: selected?.side ?? 'R' })}>
                    <span className="code">{p.id}</span>
                    <span className="name">
                      {p.name}
                      <small>{p.reading}</small>
                    </span>
                    <span className="tags-inline">{p.tags.join('・')}</span>
                    {Object.keys(p.positions).length === 0 && <span className="unplaced">未配置</span>}
                  </button>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
