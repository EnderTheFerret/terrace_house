// Relationship board: directed graph of what the player knows (affinity / romance / trust), asymmetry highlighted,
// reliability shown by line style AND text (never colour alone). Table view for screen readers.
import { Tip } from '../components/Tip';
import { useState } from 'react';
import { useGame } from '../store';
import { TopBar } from '../components/layout';
import { Btn, Panel, Tag } from '../components/ui';

type Metric = 'affinity' | 'romance' | 'trust';
const likeWord = (a: number) => a <= -30 ? 'dislikes' : a <= -8 ? 'cool toward' : a < 8 ? 'neutral' : a < 25 ? 'friendly' : a < 50 ? 'likes' : 'close to';
const romanceWord = (r: number) => r < 15 ? 'a spark' : r < 35 ? 'interested' : 'smitten';
const DASH: Record<string, string | undefined> = { self: undefined, witnessed: undefined, told: '6 3', rumor: '2 4', unknown: '1 6' };

export function Board() {
  const { view, goBack } = useGame();
  const [metric, setMetric] = useState<Metric>('affinity');
  const [table, setTable] = useState(false);
  if (!view) return null;
  const people = view.characters.filter((c) => c.status === 'inHouse');
  const n = people.length;
  const R = 200;
  const pos = Object.fromEntries(people.map((c, i) => [c.id, { x: 300 + R * Math.cos((2 * Math.PI * i) / n - Math.PI / 2), y: 260 + R * Math.sin((2 * Math.PI * i) / n - Math.PI / 2) }]));
  const edges = view.board.filter((e) => e.reliability !== 'unknown' && (metric !== 'trust' || e.reliability === 'self'));
  const val = (e: (typeof edges)[number]) => e[metric];
  const find = (a: string, b: string) => view.board.find((e) => e.from === a && e.to === b);
  const name = (id: string) => (id === view.playerId ? 'you' : (people.find((c) => c.id === id)?.name.split(' ')[0] ?? id));
  return (
    <div className="flex h-full flex-col">
      <TopBar /><Tip id="board" />
      <main className="flex min-h-0 flex-1 gap-4 overflow-auto p-4 scroll-thin max-md:flex-col max-md:p-2">
        <Panel title="relationship board · only what you know" className="flex-1 max-md:flex-none max-md:overflow-x-auto">
          <div className="mb-3 flex flex-wrap gap-2" role="radiogroup" aria-label="metric">
            {(['affinity', 'romance', 'trust'] as Metric[]).map((m) => (
              <button key={m} role="radio" aria-checked={metric === m} className={`px-btn text-xs ${metric === m ? 'px-btn-primary' : ''}`} onClick={() => setMetric(m)}>
                {m}
              </button>
            ))}
            <Btn className="ml-auto text-xs" onClick={() => setTable((t) => !t)}>{table ? 'graph view' : 'table view'}</Btn>
            <Btn className="text-xs" onClick={goBack}>back</Btn>
          </div>
          {!table ? (
            <svg viewBox="0 0 600 520" className="w-full max-w-3xl" role="img" aria-label={`directed ${metric} graph`}>
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill="#3a2e3f" />
                </marker>
              </defs>
              {edges.map((e) => {
                const a = pos[e.from];
                const b = pos[e.to];
                if (!a || !b) return null;
                const v = val(e);
                if (Math.abs(v) < 2) return null;
                const back = find(e.to, e.from);
                const asym = back && back.reliability !== 'unknown' ? Math.abs(e.affinity - back.affinity) : 0;
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const len = Math.hypot(dx, dy);
                const nx = -dy / len;
                const ny = dx / len;
                const off = 10;
                const sx = a.x + (dx / len) * 34 + nx * off;
                const sy = a.y + (dy / len) * 34 + ny * off;
                const ex = b.x - (dx / len) * 38 + nx * off;
                const ey = b.y - (dy / len) * 38 + ny * off;
                const color = metric === 'romance' ? '#e07a6a' : v < 0 ? '#6f86a8' : metric === 'trust' ? '#5fa86b' : '#c49568';
                return (
                  <g key={`${e.from}>${e.to}`}>
                    <line x1={sx} y1={sy} x2={ex} y2={ey} stroke={color} strokeWidth={1 + Math.abs(v) / 18} strokeDasharray={DASH[e.reliability]} markerEnd="url(#arrow)" opacity={0.85}>
                      <title>{`${name(e.from)} → ${name(e.to)}: ${metric} ${v} (${e.reliability})`}</title>
                    </line>
                    {metric === 'affinity' && asym >= 30 && (
                      <text x={(sx + ex) / 2} y={(sy + ey) / 2 - 4} fontSize="14" fill="#e07a6a" textAnchor="middle">
                        !
                      </text>
                    )}
                  </g>
                );
              })}
              {people.map((c) => (
                <g key={c.id} transform={`translate(${pos[c.id].x},${pos[c.id].y})`}>
                  <rect x={-34} y={-18} width={68} height={36} fill={c.isPlayer ? '#f6d48f' : '#fffaf3'} stroke="#3a2e3f" strokeWidth={3} />
                  <text textAnchor="middle" y={5} fontSize="14" fontFamily="DotGothic16">
                    {name(c.id)}
                  </text>
                </g>
              ))}
            </svg>
          ) : (
            <table className="text-sm">
              <caption className="caption mb-2 text-left text-xs">read across: how the row person feels about the column person · {metric}. your row is your own feelings; the other rows are only your estimate of them, so a compliment shows up in their row, under “you”.</caption>
              <thead>
                <tr>
                  <th />
                  {people.map((c) => (
                    <th key={c.id} className="px-2 text-left font-normal">{name(c.id)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {people.map((a) => (
                  <tr key={a.id}>
                    <th className="pr-2 text-left font-normal">{name(a.id)}</th>
                    {people.map((b) => {
                      const e = a.id === b.id ? null : find(a.id, b.id);
                      return (
                        <td key={b.id} className="px-2">
                          {!e || e.reliability === 'unknown' || (metric === 'trust' && e.reliability !== 'self') ? '—' : <>{e[metric]}<Tag kind={e.reliability} /></>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="caption mt-3 text-xs">each arrow points from the person who feels it to the person they feel it about; thicker = stronger, blue = negative. line style = how you know: solid witnessed/your own feelings · dashed told · dotted rumor. “!” marks a lopsided relationship. hover an arrow for its number, or use table view.</p>
        </Panel>
        <div className="flex w-72 flex-col gap-4 self-start max-md:w-full">
        <Panel title="how they feel about you">
          <p className="caption mb-2 text-xs">your best guess from what you've seen and heard. liking runs −100 to 100, romance 0 to 100; one good talk moves it a few points.</p>
          <ul className="text-sm">
            {people.filter((c) => !c.isPlayer).map((c) => {
              const e = find(c.id, view.playerId);
              const mine = find(view.playerId, c.id);
              const known = e && e.reliability !== 'unknown';
              return (
                <li key={c.id} className="mb-2">
                  <strong>{name(c.id)}</strong>{' '}
                  {known ? <>{likeWord(e.affinity)} <span className="caption text-xs">({e.affinity})</span>{e.romance >= 5 && <> · {romanceWord(e.romance)} <span className="caption text-xs">(♥ {e.romance})</span></>}<Tag kind={e.reliability} /></> : <span className="caption text-xs">no read on them yet</span>}
                  {mine && <div className="caption text-xs">you: {likeWord(mine.affinity)} ({mine.affinity}){mine.romance >= 5 ? ` · ♥ ${mine.romance}` : ''} · trust {mine.trust}</div>}
                </li>
              );
            })}
          </ul>
        </Panel>
        <Panel title="couples you know of">
          {view.couples.length ? (
            <ul className="text-sm">
              {view.couples.map((c, i) => (
                <li key={i}>
                  {name(c.a)} & {name(c.b)} <span className="caption text-xs">({c.status})</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="caption text-xs">none yet.</p>
          )}
        </Panel>
        </div>
      </main>
    </div>
  );
}
