// Author-only debug view: pairwise voice-distance matrix, LLM budget usage, event log, raw relationships, arcs.
import { useEffect, useState } from 'react';
import { voiceDistanceMatrix } from '@shared-roof/shared';
import { useGame } from '../store';
import { TopBar } from '../components/layout';
import { Btn, Panel } from '../components/ui';
import { api } from '../api';

export function Debug() {
  const { goBack } = useGame();
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    api.debug().then(setD).catch(() => setD(null));
  }, []);
  if (!d) return <div className="p-6">loading debug…</div>;
  const samples: Record<string, string[]> = d.voice?.samples ?? {};
  const vm = voiceDistanceMatrix(Object.fromEntries(Object.entries(samples).filter(([, l]) => l.length >= 3).map(([id, lines]) => [id, { lines, fillers: [] }])));
  const relIds = Object.keys(d.relationships ?? {}).sort();
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 text-xs scroll-thin xl:grid-cols-2">
        <Panel title={`llm budget: ${d.budget.used}/${d.budget.cap} calls this slot`}>
          <ul>
            {d.budget.log.map((l: any, i: number) => (
              <li key={i}>{l.kind} · {l.source} · {l.ok ? 'ok' : 'fallback'}</li>
            ))}
          </ul>
          <p className="caption mt-2">image queue: {d.images.queued} queued, running {d.images.running ?? 'none'}</p>
          <Btn className="mt-2" onClick={goBack}>back</Btn>
        </Panel>
        <Panel title="voice distance (lines realized this session; higher = more distinct)">
          {vm.ids.length < 2 ? (
            <p className="caption">play a few scenes to collect voice samples.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th />
                  {vm.ids.map((id) => <th key={id} className="px-1 font-normal">{id}</th>)}
                </tr>
              </thead>
              <tbody>
                {vm.ids.map((a, i) => (
                  <tr key={a}>
                    <th className="pr-1 text-left font-normal">{a}</th>
                    {vm.ids.map((b, j) => {
                      const v = vm.matrix[i][j];
                      return <td key={b} className="px-1" style={{ background: i === j ? '#eee' : `rgba(224,122,106,${Math.min(1, v)})` }}>{v.toFixed(2)}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="caption mt-2">voice-check failures: {JSON.stringify(d.voice?.fails ?? {})}</p>
        </Panel>
        <Panel title="relationships (ground truth) aff/rom/ten/trust">
          <table>
            <thead>
              <tr>
                <th />
                {relIds.map((id) => <th key={id} className="px-1 font-normal">{id.slice(0, 6)}</th>)}
              </tr>
            </thead>
            <tbody>
              {relIds.map((a) => (
                <tr key={a}>
                  <th className="pr-1 text-left font-normal">{a.slice(0, 8)}</th>
                  {relIds.map((b) => {
                    const r = d.relationships[a]?.[b];
                    return <td key={b} className="px-1 whitespace-nowrap">{r ? `${Math.round(r.affinity)}/${Math.round(r.romance)}/${Math.round(r.tension)}/${Math.round(r.trust)}` : '—'}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="caption mt-2">arcs: {Object.entries(d.arcs).map(([k, v]: [string, any]) => `${k} ${v.done.length}/3`).join(' · ')}</div>
        </Panel>
        <Panel title="event log (ground truth)">
          <ol className="max-h-96 overflow-y-auto scroll-thin">
            {[...d.log].reverse().map((l: any, i: number) => (
              <li key={i}>ep{l.episode} {l.slot} [{l.kind}] {l.text}</li>
            ))}
          </ol>
        </Panel>
      </main>
    </div>
  );
}
