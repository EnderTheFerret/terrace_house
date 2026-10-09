// Edit your own housemate mid-season: job, background and looks. Personality stays; new portraits draw on demand.
import { useState } from 'react';
import { content, type Appearance, type Gender } from '@shared-roof/shared';
import { api } from '../api';
import { useGame } from '../store';
import { TopBar } from '../components/layout';
import { Btn, Panel } from '../components/ui';

const OCCUPATIONS = [...new Set(content().jobs.map((j) => j.title))].sort();
const LOOKS = ['hairStyle', 'hairColor', 'eyeColor', 'build', 'outfit', 'accessory', 'skinTone'] as const;

export function EditCharacter() {
  const { view, goBack } = useGame();
  const me = view?.characters.find((c) => c.id === view.playerId);
  const [name, setName] = useState(me?.name ?? '');
  const [age, setAge] = useState(me?.age ?? 24);
  const [hometown, setHometown] = useState(me?.hometown ?? '');
  const [occupation, setOccupation] = useState(me?.occupation ?? '');
  const [interestedIn, setInterestedIn] = useState<Gender[]>(me?.interestedIn ?? []);
  const [appearance, setAppearance] = useState<Appearance | undefined>(me?.appearance);
  const [appearanceText, setAppearanceText] = useState(me?.appearanceText ?? '');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  if (!view || !me || !appearance) return null;
  const opts = content().appearanceOptions;
  const valid = name.trim().length > 0 && age >= 20 && age <= 35 && occupation.trim().length > 0 && interestedIn.length > 0;
  const run = async (fn: () => Promise<void>) => { setBusy(true); setMsg(''); try { await fn(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); } };
  const save = () => run(async () => {
    const r = await api.editPlayer({ name, age, hometown, occupation, interestedIn, appearance, appearanceText });
    useGame.setState({ view: r.view });
    goBack();
  });
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="flex flex-1 justify-center overflow-y-auto p-6 scroll-thin">
        <Panel title="edit your character" className="w-full max-w-2xl">
          <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-center gap-3 text-sm max-md:grid-cols-[5.5rem_minmax(0,1fr)] max-md:gap-2">
            <label htmlFor="e-name">name</label>
            <input id="e-name" className="px-panel-soft px-2 py-1" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
            <label htmlFor="e-age">age (20–35)</label>
            <input id="e-age" type="number" min={20} max={35} className="px-panel-soft w-24 px-2 py-1" value={age} onChange={(e) => setAge(Number(e.target.value))} />
            <label htmlFor="e-home">hometown</label>
            <input id="e-home" className="px-panel-soft px-2 py-1" value={hometown} maxLength={40} onChange={(e) => setHometown(e.target.value)} />
            <label htmlFor="e-job">occupation</label>
            <div className="flex gap-2 max-md:flex-col">
              <select id="e-job" className="px-panel-soft min-w-0 px-2 py-1" value={OCCUPATIONS.includes(occupation) ? occupation : ''} onChange={(e) => e.target.value && setOccupation(e.target.value)}>
                <option value="">custom</option>
                {OCCUPATIONS.map((o) => <option key={o}>{o}</option>)}
              </select>
              <input aria-label="custom occupation" className="px-panel-soft flex-1 px-2 py-1" value={occupation} maxLength={60} onChange={(e) => setOccupation(e.target.value)} />
            </div>
            <span>interested in</span>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {(['woman', 'man', 'nonbinary'] as const).map((g) => (
                <label key={g} className="flex items-center gap-1"><input type="checkbox" checked={interestedIn.includes(g)} onChange={(e) => setInterestedIn(e.target.checked ? [...interestedIn, g] : interestedIn.filter((x) => x !== g))} />{g}</label>
              ))}
            </div>
            {LOOKS.map((k) => (
              <label key={k} className="contents">
                <span>{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</span>
                <select className="px-panel-soft px-2 py-1" value={appearance[k]} onChange={(e) => setAppearance({ ...appearance, [k]: e.target.value })}>
                  {[...new Set([appearance[k], ...(opts[k] ?? [])])].map((o) => <option key={o}>{o}</option>)}
                </select>
              </label>
            ))}
            <label htmlFor="e-look">describe how you look</label>
            <textarea id="e-look" className="px-panel-soft px-2 py-1" maxLength={500} value={appearanceText} onChange={(e) => setAppearanceText(e.target.value)} placeholder="Dark curls, olive skin, a linen shirt and a silver necklace…" />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Btn className="text-xs" disabled={busy || !appearanceText.trim()} onClick={() => void run(async () => { const r = await api.mapAppearance(appearanceText.trim(), appearance); setAppearance(r.appearance); setAppearanceText(r.appearanceText); })}>match description</Btn>
          </div>
          <p className="caption mt-3 text-xs">Changing your looks draws a new portrait and walk sprite for you; everyone else keeps theirs. Your personality and history stay as they are.</p>
          {msg && <p role="alert" className="mt-2 text-xs text-rose">{msg}</p>}
          <div className="mt-4 flex gap-2">
            <Btn primary disabled={busy || !valid} onClick={() => void save()}>save changes</Btn>
            <Btn disabled={busy} onClick={goBack}>cancel</Btn>
          </div>
        </Panel>
      </main>
    </div>
  );
}
