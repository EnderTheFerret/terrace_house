// Author-only debug view: pairwise voice-distance matrix, LLM budget usage, event log, raw relationships, arcs.
import { useEffect, useState } from 'react';
import { content, DRUNK_LABEL, placeName, voiceDistanceMatrix } from '@shared-roof/shared';
import { useGame } from '../store';
import { TopBar } from '../components/layout';
import { Btn, Panel } from '../components/ui';
import { api } from '../api';

export function Debug() {
  const { goBack } = useGame();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const reload = () => api.debug().then(setD).catch(() => setD(null));
  useEffect(() => { void reload(); }, []);
  const edit = async (e: Parameters<typeof api.debugCharacter>[0]) => {
    setErr('');
    try {
      const r = await api.debugCharacter(e);
      useGame.setState({ view: r.view });
      await reload();
    } catch (x) { setErr((x as Error).message); }
  };
  const places = [
    ...content().house.rooms.map((r) => ({ id: r.id, label: `house · ${placeName(r.id)}` })),
    ...content().city.nodes.filter((n) => n.id !== 'house').map((n) => ({ id: n.id, label: `town · ${n.name}` })),
  ];
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
        <Panel title="characters (move them, set mood and energy)">
          {err && <p role="alert" className="mb-1 text-[#b3412f]">{err}</p>}
          <table>
            <thead><tr><th className="text-left font-normal">who</th><th className="text-left font-normal">where</th><th className="font-normal">mood</th><th className="font-normal">energy</th><th className="font-normal">drink</th><th className="font-normal">hangover</th><th /></tr></thead>
            <tbody>
              {(d.characters ?? []).map((c: any) => (
                <tr key={c.id}>
                  <td className="pr-2 whitespace-nowrap">{c.name.split(' ')[0]}{c.isPlayer ? ' (you)' : ''}<span className="caption block">{c.doing ?? 'idle'}{c.swimming ? ' · swimming' : ''}</span></td>
                  <td className="pr-2">
                    <select aria-label={`${c.name} location`} className="px-panel-soft px-1 py-0.5" value={places.some((p) => p.id === c.location) ? c.location : ''} onChange={(e) => void edit({ id: c.id, location: e.target.value })}>
                      {!places.some((p) => p.id === c.location) && <option value="">{c.location}</option>}
                      {places.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                  </td>
                  <td className="pr-2"><input aria-label={`${c.name} mood`} type="number" step="0.1" min="-1" max="1" className="px-panel-soft w-16 px-1" defaultValue={c.mood.toFixed(2)} key={`m${c.id}${c.mood}`} onBlur={(e) => { if (Number(e.target.value) !== Number(c.mood.toFixed(2))) void edit({ id: c.id, mood: Number(e.target.value) }); }} /></td>
                  <td className="pr-2"><input aria-label={`${c.name} energy`} type="number" step="5" min="0" max="100" className="px-panel-soft w-16 px-1" defaultValue={Math.round(c.energy)} key={`e${c.id}${c.energy}`} onBlur={(e) => { if (Number(e.target.value) !== Math.round(c.energy)) void edit({ id: c.id, energy: Number(e.target.value) }); }} /></td>
                  <td className="pr-2">
                    <select aria-label={`${c.name} drunk`} className="px-panel-soft px-1 py-0.5" value={c.drunk ?? 0} onChange={(e) => void edit({ id: c.id, drunk: Number(e.target.value) })}>
                      {DRUNK_LABEL.map((l, i) => <option key={l} value={i}>{l}</option>)}
                    </select>
                  </td>
                  <td className="pr-2">
                    <select aria-label={`${c.name} hangover`} className="px-panel-soft px-1 py-0.5" value={c.hangover ?? 0} onChange={(e) => void edit({ id: c.id, hangover: Number(e.target.value) })}>
                      {['none', 'hungover', 'badly hungover'].map((l, i) => <option key={l} value={i}>{l}</option>)}
                    </select>
                  </td>
                  <td><Btn className="text-xs" onClick={() => void edit({ id: c.id, idle: true })}>make idle</Btn></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="caption mt-2">a moved character gets an activity that fits the new place, then carries on with their usual schedule. edits are saved and replayed.</p>
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
