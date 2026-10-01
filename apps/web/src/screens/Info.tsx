// Character bible, fridge & chores board, saves, settings, season summary.
import { useEffect, useState } from 'react';
import { content } from '@shared-roof/shared';
import { useGame } from '../store';
import { TopBar } from '../components/layout';
import { Btn, HealthBadge, Meter, Panel, Tag } from '../components/ui';
import { Portrait } from '../components/pixel';
import { api } from '../api';

export function Bible() {
  const { view, goBack } = useGame();
  if (!view) return null;
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 scroll-thin md:grid-cols-2 xl:grid-cols-3">
        <div className="col-span-full flex items-center gap-3">
          <h1 className="text-lg lowercase">housemates, as you know them</h1>
          <Btn className="ml-auto text-xs" onClick={goBack}>back</Btn>
        </div>
        {view.bible.map((b) => {
          const c = view.characters.find((x) => x.id === b.id)!;
          return (
            <Panel key={b.id}>
              <div className="flex gap-3">
                <Portrait charId={c.id} appearance={c.appearance} gender={c.gender} seed={c.portraitSeed} size={88} label={c.name} />
                <div className="text-sm">
                  <div className="text-base">{c.name}</div>
                  <div className="caption text-xs">{c.age} · {c.occupation} · from {c.hometown}</div>
                  {b.traits && <div className="mt-1 text-xs">{b.traits}</div>}
                  {b.values && <div className="caption text-xs">cares about {b.values.join(', ')}</div>}
                </div>
              </div>
              <dl className="mt-2 grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1 text-xs">
                <dt className="caption">hobbies</dt>
                <dd>{b.hobbies?.join(', ') ?? '— spend more time together'}</dd>
                <dt className="caption">work</dt>
                <dd>{b.work ?? '— you only know the job title'}</dd>
                <dt className="caption">wants</dt>
                <dd>{b.goals?.join(' · ') ?? '— they haven’t opened up yet'}</dd>
                <dt className="caption">fears</dt>
                <dd>{b.fears?.join(', ') ?? '—'}</dd>
                <dt className="caption">tells</dt>
                <dd>{b.tells?.join(', ') ?? '—'}</dd>
                <dt className="caption">backstory</dt>
                <dd>{b.backstory ?? '—'}</dd>
                <dt className="caption">secret</dt>
                <dd>{b.secret ? <>{b.secret.text}<Tag kind={b.secret.reliability} /></> : '—'}</dd>
              </dl>
              {b.knownFacts.length > 0 && (
                <ul className="mt-2 text-xs">
                  {b.knownFacts.map((f, i) => (
                    <li key={i}>• {f.text}<Tag kind={f.reliability} /></li>
                  ))}
                </ul>
              )}
            </Panel>
          );
        })}
      </main>
    </div>
  );
}

export function Fridge() {
  const { view, goBack } = useGame();
  if (!view) return null;
  const h = view.house;
  const name = (id: string) => (id === view.playerId ? 'you' : (view.characters.find((c) => c.id === id)?.name.split(' ')[0] ?? id));
  const ing = content().house.ingredients;
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 scroll-thin lg:grid-cols-3">
        <Panel title="fridge">
          <ul className="grid grid-cols-2 gap-1 text-sm">
            {ing.map((i) => (
              <li key={i.id} className={(h.fridge[i.id] ?? 0) === 0 ? 'caption' : ''}>
                {i.name}: {h.fridge[i.id] ?? 0}
              </li>
            ))}
          </ul>
          <p className="caption mt-2 text-xs">grocery envelope: ¥{h.groceryBudget.toLocaleString()}</p>
          {h.labeledFood.length > 0 && (
            <div className="mt-2 text-xs">
              <div className="caption">labeled</div>
              {h.labeledFood.map((f, i) => (
                <div key={i}>{name(f.owner)}’s {f.item}{f.eaten ? ' — gone!' : ''}</div>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="chore board">
          <table className="w-full text-sm">
            <tbody>
              {Object.entries(h.choreRota).map(([chore, who]) => (
                <tr key={chore}>
                  <td className="caption pr-2">{chore}</td>
                  <td>{name(who)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="caption mb-1 mt-3 text-xs">done / skipped this season</div>
          <table className="w-full text-xs">
            <tbody>
              {Object.entries(h.choreLedger).filter(([id]) => view.characters.find((c) => c.id === id)?.status === 'inHouse').map(([id, l]) => (
                <tr key={id}>
                  <td className="pr-2">{name(id)}</td>
                  <td>{l.done.toFixed(1)} done</td>
                  <td className={l.skipped > l.done ? 'text-rose' : ''}>{l.skipped.toFixed(1)} skipped{l.skipped > l.done ? ' ⚠' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="the house">
          <div className="flex flex-col gap-2">
            <Meter label="dishes in the sink" value={h.dishes} color="#9fd3e6" />
            <Meter label="laundry pile" value={h.laundry} color="#c9b4ef" />
            <Meter label="trash" value={h.trash} color="#c49568" />
            <Meter label="noise" value={h.noise} color="#e07a6a" />
          </div>
          <p className="caption mt-2 text-xs">aircon set to {h.aircon}°C</p>
          <div className="caption mt-3 text-xs">house rules</div>
          <ul className="text-xs">
            {h.rules.map((r, i) => (
              <li key={i}>• {r}</li>
            ))}
          </ul>
          <Btn className="mt-3 text-xs" onClick={goBack}>back</Btn>
        </Panel>
      </main>
    </div>
  );
}

export function Saves() {
  const { view, loadSave, goBack, setScreen } = useGame();
  const [saves, setSaves] = useState<Awaited<ReturnType<typeof api.saves>>['saves']>([]);
  const [msg, setMsg] = useState('');
  const refresh = () => api.saves().then((r) => setSaves(r.saves)).catch(() => {});
  useEffect(() => void refresh(), []);
  return (
    <div className="flex h-full flex-col">
      {view ? <TopBar /> : null}
      <main className="flex flex-1 justify-center overflow-y-auto p-6 scroll-thin">
        <Panel title="save & load" className="w-full max-w-2xl">
          <ul className="flex flex-col gap-2 text-sm">
            {[1, 2, 3, 4, 5].map((slot) => {
              const s = saves.find((x) => x.slot === slot);
              return (
                <li key={slot} className="flex items-center gap-3">
                  <span className="w-14 caption">slot {slot}</span>
                  <span className="flex-1">{s ? `${s.name} · ${s.created_at}` : '— empty —'}</span>
                  <Btn className="text-xs" disabled={!view} onClick={() => api.save(slot).then(() => { setMsg(`saved to slot ${slot}`); void refresh(); }).catch((e) => setMsg(e.message))}>save</Btn>
                  <Btn className="text-xs" disabled={!s} onClick={() => s && void loadSave(s.id)}>load</Btn>
                </li>
              );
            })}
          </ul>
          <div className="caption mb-1 mt-4 text-xs">autosaves</div>
          <ul className="flex flex-col gap-1 text-sm">
            {saves.filter((s) => s.slot === 0).map((s) => (
              <li key={s.id} className="flex items-center gap-3">
                <span className="flex-1">{s.name}</span>
                <Btn className="text-xs" onClick={() => void loadSave(s.id)}>load</Btn>
              </li>
            ))}
          </ul>
          {msg && <p className="caption mt-3 text-xs" role="status">{msg}</p>}
          <Btn className="mt-4 text-xs" onClick={() => (view ? goBack() : setScreen('title'))}>back</Btn>
        </Panel>
      </main>
    </div>
  );
}

export function Settings() {
  const { settings, setSettings, health, view, goBack, setScreen, refreshHealth } = useGame();
  useEffect(() => void refreshHealth(), [refreshHealth]);
  const Toggle = ({ k, label }: { k: 'captions' | 'reducedMotion' | 'images' | 'sound' | 'author' | 'typewriter'; label: string }) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={settings[k]} onChange={(e) => setSettings({ [k]: e.target.checked })} /> {label}
    </label>
  );
  return (
    <div className="flex h-full flex-col">
      {view ? <TopBar /> : null}
      <main className="flex flex-1 justify-center overflow-y-auto p-6 scroll-thin">
        <Panel title="settings" className="w-full max-w-xl">
          <div className="mb-4 flex flex-col gap-1 text-sm">
            <HealthBadge />
            {health && (
              <div className="caption text-xs">
                mode {health.mode} · text model {health.model} ({health.llm}) · images {health.imageBackend} ({health.image})
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Toggle k="captions" label="on-screen captions ([awkward silence] …)" />
            <Toggle k="typewriter" label="typewriter text" />
            <Toggle k="reducedMotion" label="reduced motion" />
            <Toggle k="images" label="image generation (off = procedural placeholders only)" />
            <Toggle k="sound" label="sound (synth blips)" />
            <label className="flex items-center gap-2 text-sm">
              text size
              <select className="px-panel-soft px-2 py-1" value={settings.textScale} onChange={(e) => setSettings({ textScale: Number(e.target.value) })}>
                <option value={0.9}>small</option>
                <option value={1}>medium</option>
                <option value={1.15}>large</option>
                <option value={1.3}>extra large</option>
              </select>
            </label>
            <Toggle k="author" label="author mode (debug view: voice matrix, event log, LLM budget)" />
          </div>
          <Btn className="mt-5 text-xs" onClick={() => (view ? goBack() : setScreen('title'))}>back</Btn>
        </Panel>
      </main>
    </div>
  );
}

export function Summary() {
  const { view, setScreen } = useGame();
  if (!view) return null;
  const name = (id: string) => view.characters.find((c) => c.id === id)?.name ?? id;
  const right = view.predictions.filter((p) => p.resolved === true).length;
  const wrong = view.predictions.filter((p) => p.resolved === false).length;
  return (
    <div className="flex h-full flex-col overflow-y-auto p-6 scroll-thin">
      <h1 className="mb-1 text-center text-4xl lowercase">season finale</h1>
      <p className="caption mb-6 text-center text-sm">{view.episode} episodes · the panel’s predictions: {right} right, {wrong} wrong</p>
      <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-4 md:grid-cols-2">
        {Object.entries(view.epilogues ?? {}).map(([id, text]) => {
          const c = view.characters.find((x) => x.id === id)!;
          return (
            <Panel key={id}>
              <div className="flex gap-3">
                <Portrait charId={c.id} appearance={c.appearance} gender={c.gender} seed={c.portraitSeed} size={72} label={c.name} />
                <div>
                  <div>{name(id)}{c.isPlayer ? ' (you)' : ''}</div>
                  <p className="text-sm">{text}</p>
                </div>
              </div>
            </Panel>
          );
        })}
      </div>
      <div className="mt-6 flex justify-center gap-3">
        <Btn primary onClick={() => setScreen('creator')}>new season</Btn>
        <Btn onClick={() => setScreen('title')}>title</Btn>
      </div>
    </div>
  );
}
