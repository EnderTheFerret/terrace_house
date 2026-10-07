// Cooking minigame renderer. All rules/scoring live in shared/engine/cooking (pure); this only collects inputs.
import { Tip } from '../components/Tip';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  availableSteps, beginStep, chopBeats, completeStep, content, recipeById, sauteBand, sauteStep, scoreBoil, scoreChop, scorePlate,
  scoreSauteTrace, scoreSeason, startCooking, TASTE_AXES, type CookingState, type Recipe, type RecipeStep, type SauteParams,
} from '@shared-roof/shared';
import { useGame } from '../store';
import { TopBar } from '../components/layout';
import { Btn, Meter } from '../components/ui';
import { CookingAnimation, FoodSprite } from '../components/CookingArt';
import { api } from '../api';
import { chime } from '../audio';

type Done = (score: number) => void;

function useCookingClock() {
  const paused = useGame(s => s.screen === 'guide');
  const clock = useRef({ offset: 0, pausedAt: null as number | null });
  useEffect(() => {
    if (paused) clock.current.pausedAt = performance.now();
    else if (clock.current.pausedAt !== null) {
      clock.current.offset += performance.now() - clock.current.pausedAt;
      clock.current.pausedAt = null;
    }
  }, [paused]);
  return useCallback(() => (clock.current.pausedAt ?? performance.now()) - clock.current.offset, []);
}

function useSpace(onDown: () => void, onUp?: () => void) {
  useEffect(() => {
    const d = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        onDown();
      }
    };
    const u = (e: KeyboardEvent) => {
      if (e.code === 'Space') onUp?.();
    };
    window.addEventListener('keydown', d);
    window.addEventListener('keyup', u);
    return () => {
      window.removeEventListener('keydown', d);
      window.removeEventListener('keyup', u);
    };
  }, [onDown, onUp]);
}

function Chop({ step, done }: { step: RecipeStep; done: Done }) {
  const cookingNow = useCookingClock();
  const p = step.params as { beats: number; bpm: number; window: number };
  const beats = useMemo(() => chopBeats(p), [p]);
  const [t0, setT0] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [cuts, setCuts] = useState(0);
  const hits = useRef<number[]>([]);
  const end = beats[beats.length - 1] + 700;
  useEffect(() => {
    if (t0 === null) return;
    let raf = 0;
    const loop = () => {
      const t = cookingNow() - t0;
      setNow(t);
      if (t > end) done(scoreChop(beats, hits.current, p.window));
      else raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [t0, beats, end, done, p.window, cookingNow]);
  const hit = () => {
    if (t0 === null) return setT0(cookingNow());
    hits.current.push(cookingNow() - t0);
    setCuts(hits.current.length);
  };
  useSpace(hit);
  const span = 1600;
  return (
    <div className="flex flex-col items-center gap-3">
      <CookingAnimation type="chop" pulse={cuts} />
      <div className="relative h-16 w-full max-w-[480px] overflow-hidden bg-white" style={{ boxShadow: '0 0 0 2px var(--color-ink)' }} aria-hidden>
        <div className="absolute left-[12.5%] top-0 h-full w-[3px] bg-rose" />
        {t0 !== null &&
          beats.map((b, i) => {
            const x = 60 + ((b - now) / span) * 420;
            if (x < -20 || x > 500) return null;
            return <div key={i} className="absolute top-4 h-8 w-4 bg-[#8fd3b8]" style={{ left: `${(x - 8) / 480 * 100}%`, boxShadow: '0 0 0 2px var(--color-ink)' }} />;
          })}
        {hits.current.slice(-6).map((h, i) => {
          const x = 60 + ((h - now) / span) * 420;
          return x > -10 ? <div key={i} className="absolute top-1 h-2 w-2 bg-ink" style={{ left: `${(x - 1) / 480 * 100}%` }} /> : null;
        })}
      </div>
      <p className="caption text-xs">{t0 === null ? 'press space (or the button) to start — then chop as each block hits the line' : `chop! ${hits.current.length} cuts`}</p>
      <Btn primary onClick={hit}>{t0 === null ? 'start' : 'chop'}</Btn>
    </div>
  );
}

function Boil({ step, done }: { step: RecipeStep; done: Done }) {
  const cookingNow = useCookingClock();
  const p = step.params as { target: [number, number]; max: number };
  const [t0, setT0] = useState<number | null>(null);
  const [t, setT] = useState(0);
  useEffect(() => {
    if (t0 === null) return;
    let raf = 0;
    const loop = () => {
      const s = (cookingNow() - t0) / 1000;
      setT(s);
      if (s >= p.max) done(scoreBoil(s, p.target));
      else raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [t0, p, done, cookingNow]);
  const press = () => (t0 === null ? setT0(cookingNow()) : done(scoreBoil(t, p.target)));
  useSpace(press);
  const heat = Math.min(1, t / p.target[1]);
  const words = heat < 0.4 ? 'still' : heat < 0.75 ? 'tiny bubbles' : heat < 0.98 ? 'a gentle simmer' : t > p.target[1] ? 'boiling over!' : 'right about now…';
  return (
    <div className="flex flex-col items-center gap-3">
      <CookingAnimation type="boil" playing={t0 !== null} speed={1.4 - heat * 0.8} />
      <p className="text-sm" aria-live="polite">{t0 === null ? 'press space to light the stove' : words}</p>
      <p className="caption text-xs">{t0 === null ? '' : `${t.toFixed(1)}s`}</p>
      <Btn primary onClick={press}>{t0 === null ? 'light the stove' : 'take it off the heat'}</Btn>
    </div>
  );
}

function Saute({ step, done }: { step: RecipeStep; done: Done }) {
  const p = step.params as unknown as SauteParams;
  const [running, setRunning] = useState(false);
  const holding = useRef(false);
  const [view, setView] = useState({ t: 0, temp: 0.2 });
  const progress = useRef({ t: 0, temp: 0.2 });
  const trace = useRef<{ t: number; temp: number }[]>([]);
  useEffect(() => {
    if (!running) return;
    let temp = progress.current.temp;
    let t = progress.current.t;
    const iv = setInterval(() => {
      if (useGame.getState().screen === 'guide') return;
      t += 0.05;
      temp = sauteStep(temp, holding.current, p, 0.05);
      trace.current.push({ t, temp });
      progress.current = { t, temp };
      setView({ t, temp });
      if (t >= p.duration) {
        clearInterval(iv);
        done(scoreSauteTrace(trace.current, p));
      }
    }, 50);
    return () => clearInterval(iv);
  }, [running, p, done]);
  useSpace(
    () => {
      if (!running) setRunning(true);
      holding.current = true;
    },
    () => (holding.current = false),
  );
  const band = sauteBand(p, view.t);
  const inBand = Math.abs(view.temp - band) <= p.bandWidth / 2;
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex w-full items-center justify-center gap-6">
      <CookingAnimation type="saute" playing={running} speed={1.2 - view.temp * 0.7} />
      <div className="relative h-44 w-8 shrink-0 bg-white" style={{ boxShadow: '0 0 0 3px var(--color-ink)' }} aria-hidden>
        <div className="absolute inset-x-0 bg-[#8fd3b8]/70" style={{ bottom: `${(band - p.bandWidth / 2) * 100}%`, height: `${p.bandWidth * 100}%` }} />
        <div className="absolute inset-x-0 h-1 bg-rose" style={{ bottom: `${view.temp * 100}%` }} />
      </div>
      </div>
      <p className="text-sm" aria-live="polite">{!running ? 'hold space (or the button) to heat the pan' : inBand ? 'sizzling nicely' : view.temp > band ? 'too hot!' : 'not hot enough'}</p>
      <Meter label="time" value={view.t} max={p.duration} />
      <button
        className="px-btn px-btn-primary select-none"
        onPointerDown={() => {
          if (!running) setRunning(true);
          holding.current = true;
        }}
        onPointerCancel={() => (holding.current = false)}
        onPointerUp={() => (holding.current = false)}
        onPointerLeave={() => (holding.current = false)}
      >
        hold to heat
      </button>
    </div>
  );
}

function Season({ step, done }: { step: RecipeStep; done: Done }) {
  const p = step.params as { optimum: number; tolerance: number; label: string };
  const [v, setV] = useState(0.3);
  const [hint, setHint] = useState<string | null>(null);
  const taste = () => {
    const d = v - p.optimum;
    setHint(Math.abs(d) < p.tolerance * 0.25 ? 'tastes just right' : d < 0 ? 'needs more' : 'a bit much');
  };
  return (
    <div className="flex flex-col items-center gap-3">
      <CookingAnimation type="season" playing={v > 0} speed={1.4 - v * 0.7} />
      <label className="flex flex-col items-center gap-2 text-sm">
        how much {p.label}?
        <input type="range" min={0} max={1} step={0.01} value={v} onChange={(e) => setV(Number(e.target.value))} className="w-full max-w-72" aria-valuetext={`${Math.round(v * 100)} percent`} />
      </label>
      <div className="flex gap-2">
        <Btn onClick={taste} disabled={hint !== null}>taste once</Btn>
        <Btn primary onClick={() => done(scoreSeason(v, p.optimum, p.tolerance))}>done</Btn>
      </div>
      {hint && <p className="text-sm" aria-live="polite">{hint}</p>}
    </div>
  );
}

function Plate({ step, done }: { step: RecipeStep; done: Done }) {
  const p = step.params as { items: { id: string; label: string }[]; layout: { id: string; x: number; y: number }[] };
  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>(() => Object.fromEntries(p.items.map((it, i) => [it.id, { x: 0.08 + (i * 0.84) / Math.max(1, p.items.length - 1), y: 0.92 }])));
  const [selected, setSelected] = useState(p.items[0]?.id);
  const drag = useRef<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const move = (id: string, x: number, y: number) => setPos((q) => ({ ...q, [id]: { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) } }));
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return;
      if (!box.current?.contains(e.target as Node)) return;
      if (!selected) return;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) e.preventDefault();
      const d = 0.03;
      const c = pos[selected];
      if (e.key === 'ArrowLeft') move(selected, c.x - d, c.y);
      if (e.key === 'ArrowRight') move(selected, c.x + d, c.y);
      if (e.key === 'ArrowUp') move(selected, c.x, c.y - d);
      if (e.key === 'ArrowDown') move(selected, c.x, c.y + d);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  return (
    <div className="flex w-full flex-wrap items-start justify-center gap-4">
      <div
        ref={box}
        className="relative aspect-square w-full max-w-[300px] bg-[#daf0ec]"
        style={{ boxShadow: '0 0 0 3px var(--color-ink)' }}
        onPointerMove={(e) => {
          if (!drag.current || !box.current) return;
          const r = box.current.getBoundingClientRect();
          move(drag.current, ((e.clientX - r.left) / r.width - 0.08) / 0.84, ((e.clientY - r.top) / r.height - 0.08) / 0.84);
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <div className="absolute inset-[12%] rounded-full bg-white" style={{ boxShadow: '0 0 0 3px #c8ccd6' }} />
        {p.items.map((it) => (
          <button
            key={it.id}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded cursor-grab"
            style={{ left: `${pos[it.id].x * 84 + 8}%`, top: `${pos[it.id].y * 84 + 8}%`, boxShadow: `0 0 0 2px ${selected === it.id ? 'var(--color-rose)' : 'transparent'}`, touchAction: 'none' }}
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
              drag.current = it.id;
              setSelected(it.id);
            }}
            onFocus={() => setSelected(it.id)}
            aria-label={`${it.label}, use arrow keys to move`}
            title={it.label}
          >
            <FoodSprite id={it.label} ingredient size={44} />
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <div className="caption text-xs">the chef’s photo</div>
        <div className="relative bg-[#f4efe6]" style={{ width: 110, height: 110, boxShadow: '0 0 0 2px var(--color-ink)' }} aria-label="reference layout">
          <div className="absolute rounded-full bg-white" style={{ left: 13, top: 13, width: 84, height: 84 }} />
          {p.layout.map((l) => (
            <span key={l.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: (l.x * 84 + 8) / 100 * 110, top: (l.y * 84 + 8) / 100 * 110 }}>
              <FoodSprite id={p.items.find((i) => i.id === l.id)?.label ?? ''} ingredient size={18} />
            </span>
          ))}
        </div>
        <p className="caption max-w-[10rem] text-xs">drag, or tab + arrow keys</p>
        <Btn primary onClick={() => done(scorePlate(Object.entries(pos).map(([id, v]) => ({ id, ...v })), p.layout))}>serve</Btn>
      </div>
    </div>
  );
}

const MECH: Record<RecipeStep['type'], (p: { step: RecipeStep; done: Done }) => React.ReactElement> = { chop: Chop, boil: Boil, saute: Saute, season: Season, plate: Plate };

export function Cooking({ practice = false }: { practice?: boolean }) {
  const cookingNow = useCookingClock();
  const { view, goBack, setView, act, setScreen } = useGame();
  const recipes = content().recipes;
  const [search, setSearch] = useState('');
  const [diet, setDiet] = useState('all');
  const [onlyReady, setOnlyReady] = useState(false);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [partner, setPartner] = useState('');
  const [utensil, setUtensil] = useState<'meat' | 'dairy' | 'parve'>('parve');
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const housemates = view?.characters.filter((c) => c.status === 'inHouse' && !c.isPlayer) ?? [];
  const [serve, setServe] = useState<string[]>(housemates.map((c) => c.id));
  const [cs, setCs] = useState<CookingState | null>(null);
  const [stepStart, setStepStart] = useState(0);
  const [result, setResult] = useState<{ receptions: { charId: string; verdict: string }[]; improvised: boolean } | null>(null);

  const have = (r: Recipe) => practice || !view || Object.entries(r.ingredients).every(([k, n]) => (view.house.fridge[k] ?? 0) >= n);
  const filtered = recipes.filter(r => `${r.name} ${r.description} ${Object.keys(r.ingredients).join(' ')}`.toLowerCase().includes(search.toLowerCase()) && (diet === 'all' || r.diet === diet || (diet === 'vegetarian' && r.diet === 'vegan')) && (!onlyReady || have(r)));
  const start = (r: Recipe) => {
    setRecipe(r);
    submitting.current = false;
    setError('');
    const pc = view?.characters.find((c) => c.id === partner);
    // co-op skill is computed server-side canonically; for the minigame preview we use a neutral 0.65
    setCs(startCooking(r, pc ? { id: pc.id, skill: 0.65 } : undefined));
    setResult(null);
  };
  const active = cs && recipe && cs.active ? recipe.steps.find((s) => s.id === cs.active)! : null;
  const finishStep = (score: number) => {
    if (!cs || !recipe || !cs.active) return;
    const secs = (cookingNow() - stepStart) / 1000;
    setCs(completeStep(cs, recipe, cs.active, score, secs));
    chime(score > 0.7 ? 'ok' : score > 0.4 ? 'soft' : 'bad');
  };
  useEffect(() => {
    if (!cs?.done || !recipe || practice || result || !view || submitting.current) return;
    submitting.current = true;
    void api.cooking({ recipeId: recipe.id, quality: cs.quality ?? 0, partner: partner || undefined, servedTo: serve, utensil }).then((r) => {
      setView(r.view);
      setResult({ receptions: r.receptions, improvised: r.improvised });
    }).catch((e) => setError((e as Error).message));
  }, [cs?.done, recipe, practice, result, view, partner, serve, cs?.quality, setView, utensil]);

  if (!recipe || !cs) {
    return (
      <div className="flex h-full flex-col">
        {view && !practice ? <TopBar /> : null}<Tip id="cooking" />
        <main className="flex min-h-0 flex-1 justify-center overflow-y-auto p-4 scroll-thin cooking-kitchen">
          <section aria-label={practice ? 'practice kitchen' : 'cook something'} className="w-full max-w-5xl">
            <header className="mb-4 flex items-center justify-between gap-3"><h1 className="text-xl">{practice ? 'practice kitchen' : 'cook something'}</h1><Btn className="text-xs" onClick={() => (practice ? setScreen('title') : goBack())}>back</Btn></header>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <input type="search" aria-label="search recipes" placeholder="find a dish or ingredient" className="px-panel-soft min-w-0 flex-1 px-3 py-2 text-sm" value={search} onChange={e => setSearch(e.target.value)} />
              <select aria-label="recipe diet" className="px-panel-soft px-2 py-2 text-sm" value={diet} onChange={e => setDiet(e.target.value)}><option value="all">all diets</option><option value="vegan">vegan</option><option value="vegetarian">vegetarian</option><option value="omnivore">with meat</option></select>
              {!practice && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={onlyReady} onChange={e => setOnlyReady(e.target.checked)} />in the fridge</label>}
              <span className="caption text-xs">{filtered.length} dishes</span>
            </div>
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((r) => (
                <li key={r.id}>
                  <button className="recipe-tile w-full text-left disabled:opacity-60" disabled={!have(r)} onClick={() => start(r)}>
                    <div className="flex items-center gap-3">
                      <FoodSprite id={r.id} size={80} />
                      <div className="min-w-0"><span className="text-sm">{r.name}</span><div className="caption mt-1 text-[0.65rem]">{'★'.repeat(r.difficulty)} · serves {r.serves}</div><div className="caption text-[0.65rem]">{r.diet} · {r.category}</div></div>
                    </div>
                    <div className="caption mt-2 text-xs">{r.description}</div>
                    <div className="mt-2 text-[0.65rem]">{Object.entries(r.ingredients).map(([id, n]) => `${n} ${id}`).join(' · ')}</div>
                    <div className="caption mt-1 text-[0.65rem]">{r.steps.length} steps · {TASTE_AXES.filter((_, i) => r.taste[i] > 0.6).join(', ')}</div>
                    {!have(r) && <div className="mt-1 text-[0.65rem] text-rose">need {Object.entries(r.ingredients).filter(([id, n]) => (view?.house.fridge[id] ?? 0) < n).map(([id, n]) => `${n - (view?.house.fridge[id] ?? 0)} ${id}`).join(', ')}</div>}
                  </button>
                </li>
              ))}
            </ul>
            {!filtered.length && <p className="py-8 text-sm" role="status">no dishes match</p>}
            {!practice && view && (
              <div className="mt-4 flex flex-wrap gap-6 text-sm">
                <label className="flex items-center gap-2">cookware<select aria-label="cookware" className="px-panel-soft px-2 py-1" value={utensil} onChange={(e) => setUtensil(e.target.value as typeof utensil)}><option value="parve">parve pan</option><option value="meat">meat pan {view.house.kitchen.meatPanClean ? '(clean)' : '(needs cleaning)'}</option><option value="dairy">dairy pan {view.house.kitchen.dairyPanClean ? '(clean)' : '(needs cleaning)'}</option></select></label>
                <label className="flex items-center gap-2">
                  cook with
                  <select className="px-panel-soft px-2 py-1" value={partner} onChange={(e) => setPartner(e.target.value)}>
                    <option value="">(alone)</option>
                    {housemates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
                <fieldset className="flex flex-wrap items-center gap-2">
                  <legend className="caption text-xs">serve to</legend>
                  {housemates.map((c) => (
                    <label key={c.id} className="flex items-center gap-1">
                      <input type="checkbox" checked={serve.includes(c.id)} onChange={(e) => setServe(e.target.checked ? [...serve, c.id] : serve.filter((x) => x !== c.id))} />
                      {c.name.split(' ')[0]} <span className="caption text-xs">{view.bible.find((b) => b.id === c.id)?.diet ?? 'ask about diet'}</span>
                    </label>
                  ))}
                </fieldset>
              </div>
            )}
          </section>
        </main>
      </div>
    );
  }

  const avail = availableSteps(cs, recipe);
  return (
    <div className="flex h-full flex-col">
      {view && !practice ? <TopBar /> : null}
      <main className="cooking-kitchen grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-y-auto p-4 scroll-thin md:grid-cols-[260px_minmax(0,1fr)]">
        <aside aria-label={recipe.name} className="min-w-0 self-start">
          <div className="mb-3 flex items-center gap-3"><FoodSprite id={recipe.id} size={80} /><h1 className="text-lg">{recipe.name}</h1></div>
          <ol className="flex flex-col gap-1 text-sm">
            {recipe.steps.map((s) => {
              const st = cs.steps[s.id];
              return (
                <li key={s.id} className={st.status === 'locked' ? 'caption' : ''}>
                  {st.status === 'done' ? '✓' : st.status === 'active' ? '▶' : st.status === 'ready' ? '○' : '·'} {s.label}
                  <span className="caption ml-1 text-xs">{s.type}{st.by === 'partner' ? ' · partner' : ''}{st.score !== null && st.status === 'done' ? ` · ${Math.round(st.score * 100)}` : ''}</span>
                </li>
              );
            })}
          </ol>
          <div className="mt-3">
            <Meter label={`time ${Math.round(cs.elapsed)}s / ${recipe.timeBudget}s`} value={cs.elapsed} max={recipe.timeBudget} color={cs.elapsed > recipe.timeBudget ? '#e07a6a' : '#8fd3b8'} />
          </div>
        </aside>
        <section className="cooking-worktop flex min-w-0 flex-col items-center justify-center gap-4 px-4 py-6" aria-label={active ? active.label : cs.done ? 'done!' : 'next step'}>
          <h2 className="text-base text-center">{active ? active.label : cs.done ? 'ready to serve' : 'next step'}</h2>
          {active && (() => {
            const M = MECH[active.type];
            return <M key={active.id} step={active} done={finishStep} />;
          })()}
          {!active && !cs.done && (
            <div className="flex w-full flex-col items-center gap-3">
              <FoodSprite id={recipe.id} size={160} />
              <p className="caption text-sm">steps without dependencies can be done in any order.</p>
              {avail.map((s) => (
                <Btn key={s.id} onClick={() => { setCs(beginStep(cs, recipe, s.id)); setStepStart(cookingNow()); }}>
                  {s.label} ({s.type})
                </Btn>
              ))}
              {avail.length === 0 && <p className="caption text-sm">waiting on your partner…</p>}
            </div>
          )}
          {cs.done && (
            <div className="flex flex-col items-center gap-3 text-center">
              <FoodSprite id={recipe.id} size={160} />
              <div className="text-4xl">{Math.round((cs.quality ?? 0) * 100)}<span className="caption text-base">/100</span></div>
              {error && <p role="alert" className="text-sm text-rose">{error}</p>}
              <p className="text-sm">{(cs.quality ?? 0) > 0.8 ? 'restaurant quality.' : (cs.quality ?? 0) > 0.55 ? 'solid home cooking.' : (cs.quality ?? 0) > 0.3 ? 'edible. mostly.' : 'a learning experience.'}</p>
              {result && (
                <ul className="text-sm">
                  {result.improvised && <li className="caption">(improvised — not enough ingredients)</li>}
                  {result.receptions.map((r) => (
                    <li key={r.charId}>{view?.characters.find((c) => c.id === r.charId)?.name.split(' ')[0]}: {r.verdict}</li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap justify-center gap-3">
                <Btn onClick={() => { setRecipe(null); setCs(null); }}>cook again</Btn>
                {!practice && view && (
                  <Btn primary disabled={!result} onClick={() => void act({ type: 'house', activity: 'cook', target: partner || undefined })}>
                    sit down to eat (60 minutes)
                  </Btn>
                )}
                {practice && <Btn onClick={() => setScreen('title')}>title</Btn>}
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export const recipeInfo = recipeById;
