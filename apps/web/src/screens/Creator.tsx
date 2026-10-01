// Character creator: identity → personality → tastes → appearance (live portrait) → housemates. Keyboard accessible.
import { useMemo, useState } from 'react';
import { compileAppearanceTags, content, DEFAULT_PLAYER, TASTE_AXES, TRAIT_NAMES, type Appearance, type Gender, type PlayerSetup } from '@shared-roof/shared';
import { useGame } from '../store';
import { Btn, Panel } from '../components/ui';
import { PixelImage, ProcPortrait, useImage } from '../components/pixel';
import { api } from '../api';

const OCCUPATIONS = ['graphic designer', 'barista', 'nursing student', 'office worker', 'photographer', 'chef in training', 'sales clerk', 'programmer', 'florist', 'hair stylist', 'yoga instructor', 'musician'];
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

function CreatorPortrait({ id, age, gender, appearance, seed, lowRes }: { id: string; age: number; gender: Gender; appearance: Appearance; seed: number; lowRes?: boolean }) {
  const st = useImage(() => api.portrait({ id, age, gender, appearance, portraitSeed: seed, lowRes }), [id, age, gender, JSON.stringify(appearance), seed, lowRes]);
  const ready = st?.status === 'ready' && st.url && !st.url.endsWith('.svg');
  return (
    <div className="relative" style={{ width: 160, height: 200 }}>
      <div className="absolute inset-0 flex items-end justify-center">
        <ProcPortrait appearance={appearance} gender={gender} seed={seed} size={160} />
      </div>
      {ready && <PixelImage url={st!.url!} factor={lowRes ? 4 : 8} alt="portrait" className="absolute inset-0" style={{ width: 160, height: 200, objectFit: 'cover' }} />}
      {st && st.status !== 'ready' && <span className="caption absolute bottom-1 right-1 bg-paper px-1 text-[0.65rem]">painting<span className="blink">…</span></span>}
    </div>
  );
}

export function Creator() {
  const { newGame, busy, setScreen, health } = useGame();
  const [step, setStep] = useState(0);
  const [p, setP] = useState<PlayerSetup>({ ...DEFAULT_PLAYER, portraitSeed: 4242 });
  const [custom, setCustom] = useState('');
  const [randomCast, setRandomCast] = useState(false);
  const [seed, setSeed] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const opts = content().appearanceOptions;
  const set = (patch: Partial<PlayerSetup>) => setP((x) => ({ ...x, ...patch }));
  const setApp = (k: keyof Appearance, v: string) => setP((x) => ({ ...x, appearance: { ...x.appearance, [k]: v } }));
  const ageOk = p.age >= 20 && p.age <= 35;
  const nameOk = p.name.trim().length > 0;
  const tags = useMemo(() => compileAppearanceTags({ age: p.age, gender: p.gender, appearance: p.appearance }), [p.age, p.gender, p.appearance]);
  const steps = ['identity', 'personality', 'tastes', 'appearance', 'housemates'];
  const canNext = step === 0 ? ageOk && nameOk && p.interestedIn.length > 0 : true;

  const start = () => void newGame({ player: { ...p, name: p.name.trim(), occupation: custom.trim() || p.occupation }, randomizeCast: randomCast, seed: seed ? Number(seed) : undefined });

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b-[3px] border-ink bg-paper px-4 py-2">
        <button className="px-btn text-xs" onClick={() => setScreen('title')}>back</button>
        <h1 className="text-lg lowercase">new housemate</h1>
        <ol className="ml-4 flex gap-2 text-xs" aria-label="steps">
          {steps.map((s, i) => (
            <li key={s} className={`px-2 ${i === step ? 'bg-rose text-white' : 'caption'}`} aria-current={i === step ? 'step' : undefined}>
              {i + 1}. {s}
            </li>
          ))}
        </ol>
      </header>
      <main className="flex min-h-0 flex-1 gap-4 overflow-y-auto p-4 scroll-thin">
        <div className="flex-1">
          {step === 0 && (
            <Panel title="who are you?">
              <div className="grid max-w-lg grid-cols-[8rem_1fr] items-center gap-3 text-sm">
                <label htmlFor="c-name">name</label>
                <input id="c-name" className="px-panel-soft px-2 py-1" value={p.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} />
                <label htmlFor="c-age">age (20–35)</label>
                <div>
                  <input id="c-age" type="number" min={20} max={35} className="px-panel-soft w-24 px-2 py-1" value={p.age} onChange={(e) => set({ age: Number(e.target.value) })} aria-invalid={!ageOk} />
                  {!ageOk && <span className="ml-2 text-xs text-rose">housemates are 20–35</span>}
                </div>
                <label htmlFor="c-gender">gender</label>
                <select id="c-gender" className="px-panel-soft px-2 py-1" value={p.gender} onChange={(e) => set({ gender: e.target.value as Gender })}>
                  <option value="woman">woman</option>
                  <option value="man">man</option>
                  <option value="nonbinary">nonbinary</option>
                </select>
                <span>interested in</span>
                <div className="flex gap-3">
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
                <div className="flex gap-2">
                  <select id="c-job" className="px-panel-soft px-2 py-1" value={p.occupation} onChange={(e) => set({ occupation: e.target.value })}>
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
                {TRAIT_NAMES.map((t, i) => (
                  <label key={t} className="grid grid-cols-[10rem_1fr_3rem] items-center gap-2">
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
                {TASTE_AXES.map((t, i) => (
                  <label key={t} className="grid grid-cols-[8rem_1fr_5rem] items-center gap-2">
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
          {step === 3 && (
            <Panel title="appearance">
              <div className="flex flex-wrap gap-6">
                <div className="grid grid-cols-[7rem_1fr] items-center gap-2 text-sm">
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
                <div className="flex flex-col items-center gap-2">
                  <div className="px-panel bg-white p-1">
                    <CreatorPortrait id="player" age={p.age} gender={p.gender} appearance={p.appearance} seed={p.portraitSeed!} lowRes={!confirmed} />
                  </div>
                  <div className="flex gap-2">
                    <Btn onClick={() => set({ portraitSeed: Math.floor(Math.random() * 99999) })}>reroll</Btn>
                    <Btn onClick={() => setConfirmed(true)} disabled={confirmed}>
                      {confirmed ? 'high-res ✓' : 'confirm (high-res)'}
                    </Btn>
                  </div>
                  <span className="caption text-xs">seed {p.portraitSeed}{health?.imagesOffline ? ' · images offline: placeholder' : ''}</span>
                </div>
              </div>
              <p className="caption mt-3 text-xs">tags: {tags.join(', ')}</p>
            </Panel>
          )}
          {step === 4 && (
            <Panel title="your housemates">
              <label className="mb-3 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={randomCast} onChange={(e) => setRandomCast(e.target.checked)} /> randomize cast (generated from archetypes)
              </label>
              {!randomCast ? (
                <div className="grid grid-cols-5 gap-3">
                  {content().cast.map((c) => (
                    <div key={c.id} className="px-panel-soft flex flex-col items-center p-2 text-center text-xs">
                      <CreatorPortrait id={c.id} age={c.age} gender={c.gender} appearance={c.appearance} seed={c.portraitSeed} />
                      <div className="mt-1 text-sm">{c.name}</div>
                      <div className="caption">{c.age} · {c.occupation}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm">five strangers will be drawn from {content().archetypes.length} archetypes, chosen to be as different from each other as possible — with at least one stabilizer, two friction pairs and a love triangle waiting to happen.</p>
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
        {step < 4 ? (
          <Btn primary disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
            next
          </Btn>
        ) : (
          <Btn primary disabled={busy || !ageOk || !nameOk} onClick={start}>
            move in
          </Btn>
        )}
      </footer>
    </div>
  );
}
