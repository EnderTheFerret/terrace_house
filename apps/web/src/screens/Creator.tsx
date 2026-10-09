// Character creator: identity → personality → tastes → appearance → housemates.
import { useMemo, useState } from 'react';
import { compileAppearanceTags, content, defaultCast, DEFAULT_PLAYER, hashSeed, TASTE_AXES, TRAIT_NAMES, type Appearance, type Gender, type PlayerSetup } from '@shared-roof/shared';
import { useGame } from '../store';
import { Btn, Panel } from '../components/ui';
import { SpritePreview } from '../components/pixel';
import { CreatorArtwork } from '../components/CreatorArtwork';
import assets from '../../public/assets/manifest.json';
import { api } from '../api';

const OCCUPATIONS = [...new Set(content().jobs.map((j) => j.title))].sort();

/** Closest archetype to a trait vector: "your type". */
const dist = (a: number[], b: number[]) => a.reduce((d, t, i) => d + (t - b[i]) ** 2, 0);
const nearestType = (traits: number[]) => [...content().archetypes].sort((x, y) => dist(x.traits, traits) - dist(y.traits, traits))[0];
const HOBBIES = ['sketching', 'karaoke', 'baking', 'running', 'reading', 'gaming', 'surfing', 'photography', 'film', 'gardening', 'hiking', 'guitar'];
const EXTRA_OPTS: Record<string, string[]> = { hairStyle: ['shoulder-length bob', 'short messy', 'long with soft bangs'], outfit: ['oversized cardigan and jeans', 'white cook t-shirt and canvas apron', 'vintage band tee and denim jacket'] };

function summary(traits: number[], quirks: string[]) {
  const [O, C, E, A, N] = traits;
  const parts = [
    E > 0.65 ? 'outgoing' : E < 0.35 ? 'reserved' : 'easygoing',
    A > 0.65 ? 'warm' : A < 0.35 ? 'blunt' : 'fair-minded',
    O > 0.65 ? 'curious' : O < 0.35 ? 'practical' : 'open to things',
  ];
  const tail = [C > 0.65 ? 'keeps the kitchen spotless' : C < 0.35 ? 'loses keys weekly' : null, N > 0.65 ? 'overthinks texts' : N < 0.35 ? 'rarely rattled' : null].filter(Boolean);
  const q = quirks.map((id) => content().quirks.find((x) => x.id === id)?.label).filter(Boolean);
  return `A ${parts.join(', ')} type${tail.length ? ` who ${tail.join(' and ')}` : ''}${q.length ? ` — ${q.join(', ')}` : ''}.`;
}

export function Creator() {
  const { newGame, joinAsNewPlayer, busy, setScreen, view, settings, setSettings } = useGame();
  // after your character graduates you create the next one; the cast is already there
  const next = !!view?.awaitingPlayer;
  // three men and three women: the next character takes the graduate's place, same gender
  const lockedGender = next ? (view.characters.find((c) => c.id === view.playerId)?.gender as Gender | undefined) : undefined;
  const [step, setStep] = useState(0);
  const [p, setP] = useState<PlayerSetup>({
    ...DEFAULT_PLAYER,
    ...(lockedGender && lockedGender !== DEFAULT_PLAYER.gender ? { gender: lockedGender, interestedIn: [lockedGender === 'man' ? 'woman' : 'man'] } : {}),
    name: next ? '' : DEFAULT_PLAYER.name,
    portraitSeed: next ? Math.floor(Math.random() * 99999) : hashSeed(DEFAULT_PLAYER.name) % 100000,
  });
  const [custom, setCustom] = useState('');
  const [randomCast, setRandomCast] = useState(false);
  const [seed, setSeed] = useState('');
  const [seasonLength, setSeasonLength] = useState(0);
  const [mapping, setMapping] = useState(false);
  const [appearanceError, setAppearanceError] = useState('');
  const [artBusy, setArtBusy] = useState(false);
  const opts = content().appearanceOptions;
  const set = (patch: Partial<PlayerSetup>) => setP((x) => ({ ...x, ...patch }));
  const setApp = (k: keyof Appearance, v: string) => setP((x) => ({ ...x, appearance: { ...x.appearance, [k]: v } }));
  const ageOk = p.age >= 20 && p.age <= 35;
  const nameOk = p.name.trim().length > 0;
  const tags = useMemo(() => compileAppearanceTags({ age: p.age, gender: p.gender, appearance: p.appearance }), [p.age, p.gender, p.appearance]);
  const steps = next ? ['identity', 'personality', 'tastes', 'appearance'] : ['identity', 'personality', 'tastes', 'appearance', 'housemates'];
  const canNext = step === 0 ? ageOk && nameOk && p.interestedIn.length > 0 : true;

  const start = () =>
    next
      ? void joinAsNewPlayer({ ...p, name: p.name.trim(), occupation: custom.trim() || p.occupation })
      : void newGame({ player: { ...p, name: p.name.trim(), occupation: custom.trim() || p.occupation }, randomizeCast: randomCast, seed: seed ? Number(seed) : undefined, seasonLength });

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-4 border-b-[3px] border-ink bg-paper px-4 py-2 max-md:gap-2 max-md:px-2">
        <button className="px-btn text-xs" onClick={() => setScreen('title')}>back</button>
        <h1 className="text-lg lowercase max-md:text-base">{next ? 'your next housemate moves in' : 'new housemate'}</h1>
        <ol className="ml-4 flex flex-wrap gap-2 text-xs max-md:ml-0 max-md:w-full" aria-label="steps">
          {steps.map((s, i) => (
            <li key={s} className={`px-2 ${i === step ? 'bg-rose text-white' : 'caption'}`} aria-current={i === step ? 'step' : undefined}>
              {i + 1}. {s}
            </li>
          ))}
        </ol>
      </header>
      <main className="flex min-h-0 flex-1 gap-4 overflow-y-auto p-4 scroll-thin max-md:p-2">
        <div className="min-w-0 flex-1">
          {step === 0 && (
            <Panel title="who are you?">
              <div className="grid max-w-lg grid-cols-[8rem_minmax(0,1fr)] items-center gap-3 text-sm max-md:grid-cols-[5.5rem_minmax(0,1fr)] max-md:gap-2">
                <label htmlFor="c-name">name</label>
                <input id="c-name" className="px-panel-soft px-2 py-1" value={p.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} />
                <label htmlFor="c-age">age (20–35)</label>
                <div>
                  <input id="c-age" type="number" min={20} max={35} className="px-panel-soft w-24 px-2 py-1" value={p.age} onChange={(e) => set({ age: Number(e.target.value) })} aria-invalid={!ageOk} />
                  {!ageOk && <span className="ml-2 text-xs text-rose">housemates are 20–35</span>}
                </div>
                <label htmlFor="c-gender">gender</label>
                <select id="c-gender" className="px-panel-soft px-2 py-1" value={p.gender} disabled={!!lockedGender} title={lockedGender ? `taking your last character's place: the house stays three men and three women` : undefined} onChange={(e) => set({ gender: e.target.value as Gender })}>
                  <option value="woman">woman</option>
                  <option value="man">man</option>
                  <option value="nonbinary">nonbinary</option>
                </select>
                <span>interested in</span>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {(['woman', 'man', 'nonbinary'] as const).map((g) => (
                    <label key={g} className="flex items-center gap-1">
                      <input type="checkbox" checked={p.interestedIn.includes(g)} onChange={(e) => set({ interestedIn: e.target.checked ? [...p.interestedIn, g] : p.interestedIn.filter((x) => x !== g) })} />
                      {g}
                    </label>
                  ))}
                </div>
                <label htmlFor="c-home">hometown</label>
                <input id="c-home" className="px-panel-soft px-2 py-1" value={p.hometown} maxLength={40} onChange={(e) => set({ hometown: e.target.value })} />
                <label htmlFor="c-job">occupation</label>
                <div className="flex gap-2 max-md:flex-col">
                  <select id="c-job" className="px-panel-soft min-w-0 px-2 py-1" value={p.occupation} onChange={(e) => set({ occupation: e.target.value })}>
                    {OCCUPATIONS.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                  <input aria-label="custom occupation" placeholder="or type your own" className="px-panel-soft flex-1 px-2 py-1" value={custom} maxLength={60} onChange={(e) => setCustom(e.target.value)} />
                </div>
              </div>
            </Panel>
          )}
          {step === 1 && (
            <Panel title="personality">
              <div className="flex max-w-lg flex-col gap-3 text-sm">
                <fieldset>
                  <legend className="caption mb-1 text-xs">start from a type (then fine-tune the sliders)</legend>
                  <div className="flex flex-wrap gap-1">
                    {content().archetypes.map((a) => (
                      <button key={a.id} type="button" className={`px-btn text-xs ${nearestType(p.traits).id === a.id ? 'px-btn-primary' : ''}`} title={a.voiceNotes} onClick={() => set({ traits: [...a.traits], occupation: OCCUPATIONS.includes(a.occupations[0]) ? a.occupations[0] : p.occupation })}>
                        {a.label}
                      </button>
                    ))}
                  </div>
                  <p className="caption mt-1 text-xs">closest type: {nearestType(p.traits).label} — {nearestType(p.traits).voiceNotes}</p>
                </fieldset>
                {TRAIT_NAMES.map((t, i) => (
                  <label key={t} className="grid grid-cols-[10rem_1fr_3rem] items-center gap-2 max-md:grid-cols-[7rem_minmax(0,1fr)_2rem]">
                    {t}
                    <input type="range" min={0} max={1} step={0.05} value={p.traits[i]} onChange={(e) => set({ traits: p.traits.map((v, j) => (j === i ? Number(e.target.value) : v)) })} />
                    <span className="caption">{Math.round(p.traits[i] * 100)}</span>
                  </label>
                ))}
                <fieldset>
                  <legend className="caption mb-1 text-xs">pick 3 quirks ({p.quirks.length}/3)</legend>
                  <div className="flex flex-wrap gap-2">
                    {content().quirks.map((q) => {
                      const on = p.quirks.includes(q.id);
                      return (
                        <button key={q.id} type="button" aria-pressed={on} className={`px-btn text-xs ${on ? 'px-btn-primary' : ''}`} disabled={!on && p.quirks.length >= 3} onClick={() => set({ quirks: on ? p.quirks.filter((x) => x !== q.id) : [...p.quirks, q.id] })}>
                          {q.label}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
                <p className="px-panel-soft p-2">{summary(p.traits, p.quirks)}</p>
              </div>
            </Panel>
          )}
          {step === 2 && (
            <Panel title="tastes & hobbies">
              <div className="flex max-w-lg flex-col gap-3 text-sm">
                <label className="flex items-center gap-2">diet
                  <select aria-label="diet" className="px-panel-soft px-2 py-1" value={p.diet ?? 'omnivore'} onChange={(e) => set({ diet: e.target.value as PlayerSetup['diet'] })}>
                    <option value="omnivore">omnivore</option><option value="vegetarian">vegetarian</option><option value="vegan">vegan</option>
                  </select>
                </label>
                <label className="flex items-center gap-2">kashrut
                  <select aria-label="kashrut" className="px-panel-soft px-2 py-1" value={p.kashrut ?? 'none'} onChange={(e) => set({ kashrut: e.target.value as PlayerSetup['kashrut'] })}>
                    <option value="none">none</option><option value="style">kosher-style</option><option value="strict">strict</option>
                  </select>
                </label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={p.keepsShabbat ?? false} onChange={(e) => set({ keepsShabbat: e.target.checked })} />keep Shabbat</label>
                {TASTE_AXES.map((t, i) => (
                  <label key={t} className="grid grid-cols-[8rem_1fr_5rem] items-center gap-2 max-md:grid-cols-[6rem_minmax(0,1fr)_3.5rem]">
                    {t}
                    <input type="range" min={-1} max={1} step={0.1} value={p.tastes[i]} onChange={(e) => set({ tastes: p.tastes.map((v, j) => (j === i ? Number(e.target.value) : v)) })} />
                    <span className="caption">{p.tastes[i] > 0.3 ? 'love' : p.tastes[i] < -0.3 ? 'dislike' : 'okay'}</span>
                  </label>
                ))}
                <fieldset>
                  <legend className="caption mb-1 text-xs">3 hobbies ({p.hobbies.length}/3)</legend>
                  <div className="flex flex-wrap gap-2">
                    {HOBBIES.map((h) => {
                      const on = p.hobbies.includes(h);
                      return (
                        <button key={h} type="button" aria-pressed={on} className={`px-btn text-xs ${on ? 'px-btn-primary' : ''}`} disabled={!on && p.hobbies.length >= 3} onClick={() => set({ hobbies: on ? p.hobbies.filter((x) => x !== h) : [...p.hobbies, h] })}>
                          {h}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              </div>
            </Panel>
          )}
          <div hidden={step !== 3}>
            <Panel title="appearance">
              <label className="mb-2 flex max-w-xl flex-col gap-1 text-sm">describe how you look
                <textarea className="px-panel-soft px-2 py-1" maxLength={500} value={p.appearanceText ?? ''} onChange={(e) => set({ appearanceText: e.target.value })} placeholder="Dark curls, olive skin, a linen shirt and a silver necklace…" />
              </label>
              <Btn disabled={mapping || !p.appearanceText?.trim()} className="mb-3 text-xs" onClick={async () => {
                setMapping(true); setAppearanceError('');
                try { const r = await api.mapAppearance(p.appearanceText!.trim(), p.appearance); set({ appearance: r.appearance, appearanceText: r.appearanceText }); }
                catch (e) { setAppearanceError((e as Error).message); }
                finally { setMapping(false); }
              }}>{mapping ? 'matching appearance…' : 'match description'}</Btn>
              {appearanceError && <p role="alert" className="mb-2 text-xs text-rose">{appearanceError}</p>}
              <div className="flex flex-wrap gap-6">
                <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-2 text-sm max-md:w-full">
                  {(['hairStyle', 'hairColor', 'eyeColor', 'build', 'outfit', 'accessory', 'skinTone'] as const).map((k) => (
                    <label key={k} className="contents">
                      <span>{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</span>
                      <select className="px-panel-soft px-2 py-1" value={p.appearance[k]} onChange={(e) => setApp(k, e.target.value)}>
                        {[...new Set([p.appearance[k], ...(EXTRA_OPTS[k] ?? []), ...(opts[k] ?? [])])].map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                <CreatorArtwork player={p} onChange={set} onBusy={setArtBusy} />
              </div>
              <p className="caption mt-3 text-xs">tags: {tags.join(', ')}</p>
            </Panel>
          </div>
          {step === 4 && (
            <Panel title="your housemates">
              <fieldset className="mb-4 text-sm">
                <legend className="caption mb-1 text-xs">season length</legend>
                <label className="mr-4"><input type="radio" name="season-mode" checked={seasonLength === 0} onChange={() => setSeasonLength(0)} /> open-ended</label>
                <label><input type="radio" name="season-mode" checked={seasonLength > 0} onChange={() => setSeasonLength(12)} /> fixed length</label>
                {seasonLength > 0 && <label className="ml-3">episodes <input aria-label="season episodes" type="number" min={3} max={365} className="px-panel-soft w-20 px-2 py-1" value={seasonLength} onChange={(e) => setSeasonLength(Math.max(3, Math.min(365, Number(e.target.value) || 3)))} /></label>}
                <p className="caption mt-1 text-xs">After episode 3, you can announce the final episode whenever you are ready.</p>
              </fieldset>
              <label className="mb-3 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!settings.tutorial} onChange={(e) => setSettings({ tutorial: !e.target.checked, tipsSeen: [] })} /> skip tutorial tips (move-in day still happens: everyone arrives one at a time)
              </label>
              <fieldset className="mb-3 flex gap-4 text-sm">
                <legend className="caption mb-1 text-xs">choose your cast</legend>
                <label><input type="radio" name="cast" checked={!randomCast} onChange={() => setRandomCast(false)} /> prebaked cast</label>
                <label><input type="radio" name="cast" checked={randomCast} onChange={() => setRandomCast(true)} /> random cast</label>
              </fieldset>
              {!randomCast ? (
                <div className="grid grid-cols-5 gap-3 max-md:grid-cols-2 max-md:gap-2">
                  {defaultCast(p.gender).map((c) => (
                    <div key={c.id} className="px-panel-soft flex flex-col items-center p-2 text-center text-xs">
                  <img src={`/assets/portraits/finished-${c.id}-thigh-up-v1.png`} alt={c.name} className="pixelated h-[200px] w-[160px] max-w-full object-contain" />
                      {Object.values(assets).includes(`sprites/finished-${c.id}-daily-0.png`) ? <SpritePreview url={`/assets/sprites/finished-${c.id}-daily-0.png`} /> : <p className="caption">Walk sprite will be drawn after move-in.</p>}
                      <div className="mt-1 text-sm">{c.name}</div>
                      <div className="caption">{c.age} · {c.occupation}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm">Five new housemates will be drawn from {content().archetypes.length} archetypes. Their characters, portraits and walk sprites will be generated after you move in.</p>
              )}
              <label className="mt-4 flex items-center gap-2 text-sm">
                seed (optional)
                <input className="px-panel-soft w-32 px-2 py-1" value={seed} inputMode="numeric" onChange={(e) => setSeed(e.target.value.replace(/\D/g, ''))} />
              </label>
            </Panel>
          )}
        </div>
      </main>
      <footer className="flex justify-between border-t-[3px] border-ink bg-paper px-4 py-3">
        <Btn disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
          previous
        </Btn>
        {step < steps.length - 1 ? (
          <Btn primary disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
            next
          </Btn>
        ) : (
          <Btn primary disabled={busy || artBusy || !ageOk || !nameOk} onClick={start}>
            move in
          </Btn>
        )}
      </footer>
    </div>
  );
}
