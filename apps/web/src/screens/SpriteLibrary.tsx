import { useEffect, useRef, useState } from 'react';
import { OCCASIONS, type Emotion, type Occasion } from '@shared-roof/shared';
import { api, waitArtwork, type SpriteLibraryCharacter } from '../api';
import { SpritePreview } from '../components/pixel';
import { Btn } from '../components/ui';
import { useGame } from '../store';

const label = (emotion: Emotion) => emotion === 'tender' ? 'in love' : emotion;

export function SpriteLibrary() {
  const { view, settings, setView, setScreen, galleryBack, scenes, busy: gameBusy } = useGame();
  const [characters, setCharacters] = useState<SpriteLibraryCharacter[] | null>(null);
  const [id, setId] = useState(view?.playerId ?? '');
  const [occasion, setOccasion] = useState<Occasion>('daily');
  const [customOutfit, setCustomOutfit] = useState('');
  const [day, setDay] = useState(view?.day ?? 0);
  const [target, setTarget] = useState<'walk' | Emotion>('walk');
  const [notes, setNotes] = useState('');
  const [revision, refresh] = useState(0);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const character = view?.characters.find(c => c.id === id);
  const artwork = characters?.find(c => c.id === id);
  const savedNotes = target === 'walk' ? character?.spriteInstructions : character?.expressionEdits?.[target]?.instructions;
  const canEdit = !gameBusy && !scenes.some(s => s.phase !== 'done');
  useEffect(() => { setNotes(savedNotes ?? ''); }, [id, target, savedNotes]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!view) return;
    let active = true;
    setCharacters(null);
    api.spriteLibrary({ occasion, day, outfit: customOutfit.trim() || undefined }).then(r => { if (active) setCharacters(r.characters); }).catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [view?.gameId, occasion, customOutfit, day, revision]); // eslint-disable-line react-hooks/exhaustive-deps

  const generate = async (edit?: 'fix' | 'change') => {
    if (!character || busy) return;
    const ac = new AbortController(); controller.current = ac;
    setBusy(true); setError(''); setMessage(edit ? 'Saving edit and generating…' : 'Generating…');
    try {
      if (edit) {
        const seed = edit === 'change' ? Math.floor(Math.random() * 2 ** 31) : target === 'walk' ? character.spriteSeed ?? character.portraitSeed : character.expressionEdits?.[target]?.seed ?? character.portraitSeed;
        const result = await api.editArtwork(id, { kind: target === 'walk' ? 'walk' : 'expression', emotion: target === 'walk' ? undefined : target, seed, instructions: edit === 'fix' ? notes.trim() : '' });
        if (ac.signal.aborted) return;
        setView(result.view);
      }
      if (await waitArtwork(id, target === 'walk' ? 'walk' : 'expression', target === 'walk' ? 'neutral' : target, { occasion, day, outfit: customOutfit.trim() || undefined }, ac.signal)) setMessage('Ready. This artwork will be used in the game.');
    } catch (e) {
      if (!ac.signal.aborted) { setError((e as Error).message); setMessage(''); }
    } finally {
      if (!ac.signal.aborted) { setBusy(false); refresh(n => n + 1); }
    }
  };

  return <div className="flex h-full flex-col">
    <header className="flex items-center gap-3 border-b-[3px] border-ink bg-paper p-3">
      <h1 className="text-lg">sprite library</h1>
      <Btn className="ml-auto text-xs" disabled={busy} onClick={() => { setError(''); refresh(n => n + 1); }}>refresh</Btn>
      <Btn className="text-xs" onClick={() => setScreen(galleryBack)}>back</Btn>
    </header>
    <main className="flex-1 overflow-y-auto p-4 scroll-thin">
      {!view ? <p>Start or load a season to browse character sprites.</p> : <>
        <p className="caption mb-4 text-sm">Choose a character, then a walking sheet or conversation expression. Describe a fix or request a new variation. Expressions appear when dialogue calls for that emotion; edits apply across outfits.</p>
        <div className="mb-4 flex flex-wrap items-end gap-4">
          <label className="text-sm">character<select className="px-panel-soft block px-2 py-1" value={id} disabled={busy} onChange={e => { setId(e.target.value); setMessage(''); }}>{view.characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="text-sm">outfit<select className="px-panel-soft block px-2 py-1" value={occasion} disabled={busy} onChange={e => { setOccasion(e.target.value as Occasion); setCustomOutfit(''); }}>{OCCASIONS.map(o => <option key={o} value={o}>{o === 'formal' ? 'formal / suit' : o}</option>)}</select></label>
          <label className="text-sm">custom outfit (optional)<input className="px-panel-soft block px-2 py-1" value={customOutfit} maxLength={300} disabled={busy} placeholder="Black tuxedo with a white shirt and bow tie" onChange={e => setCustomOutfit(e.target.value)} /></label>
          <label className="text-sm">day<input className="px-panel-soft block w-24 px-2 py-1" type="number" min={0} max={9999} value={day} disabled={busy} onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 0 && n <= 9999) setDay(n); }} /></label>
        </div>
        {artwork && <p className="caption mb-3 text-xs">{artwork.name} · {artwork.outfit}</p>}
        {characters === null && !error && <p role="status">Loading sprites…</p>}
        {artwork && <div role="group" aria-label={`sprites for ${artwork.name}`} className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {[{ key: 'walk' as const, name: 'walking sheet', image: artwork.walk }, ...artwork.expressions.map(e => ({ key: e.emotion, name: `${label(e.emotion)} expression`, image: e.image }))].map(entry => <button type="button" key={entry.key} disabled={busy} aria-pressed={target === entry.key} className={`px-panel flex flex-col items-center justify-between gap-2 p-3 ${target === entry.key ? 'bg-[#f8ded7]' : 'bg-paper'}`} onClick={() => { setTarget(entry.key); setMessage(''); }}>
            <span className="text-sm">{entry.name}</span>
            {entry.image?.url ? <img src={entry.image.url} alt={`${artwork.name} ${entry.name}`} className={`h-36 w-full object-contain ${entry.key === 'walk' ? 'pixelated' : ''}`} /> : <span aria-hidden className="caption flex h-36 items-center text-3xl">—</span>}
            <span className="caption text-xs">{entry.image?.placeholder ? 'temporary preview' : entry.image?.status ?? 'not generated'}</span>
          </button>)}
        </div>}
        {character && <section className="px-panel mt-4 max-w-3xl p-4" aria-label="edit selected sprite">
          <h2 className="mb-2">{character.name} · {target === 'walk' ? 'walking sheet' : `${label(target)} expression`}</h2>
          {target === 'walk' && <SpritePreview url={artwork?.walk?.url} appearance={{ ...character.appearance, outfit: artwork?.outfit ?? character.appearance.outfit }} />}
          <label htmlFor="sprite-edit" className="mt-3 block text-sm">describe a sprite edit</label>
          <textarea id="sprite-edit" className="px-panel-soft mt-1 block w-full px-2 py-1" maxLength={500} rows={3} disabled={busy || target === 'neutral' || !canEdit} value={notes} placeholder={target === 'walk' ? 'Keep the glasses visible and fix the feet in every frame' : 'Make the smile softer while keeping the same face'} onChange={e => setNotes(e.target.value)} />
          <div className="mt-3 flex flex-wrap gap-3">
            <Btn primary disabled={busy || !settings.images} onClick={() => void generate()}>generate / retry</Btn>
            <Btn disabled={busy || !settings.images || !canEdit || target === 'neutral' || !notes.trim()} onClick={() => void generate('fix')}>apply edit</Btn>
            <Btn disabled={busy || !settings.images || !canEdit || target === 'neutral'} onClick={() => void generate('change')}>new variation</Btn>
            {(() => { const image = target === 'walk' ? artwork?.walk : artwork?.expressions.find(e => e.emotion === target)?.image; return image?.url && <a className="self-center text-sm underline" href={image.url} target="_blank" rel="noreferrer">open original</a>; })()}
          </div>
          {!canEdit && <p className="caption mt-2 text-xs">Finish the current conversation before saving sprite edits.</p>}
          {target === 'neutral' && <p className="caption mt-2 text-xs">Neutral uses the original portrait. Select another expression to edit its face.</p>}
          {!settings.images && <p className="caption mt-2 text-xs">Enable images in settings to generate or edit sprites.</p>}
        </section>}
      </>}
      {message && <p className="mt-3 text-sm" role="status">{message}</p>}
      {error && <p className="mt-3 text-sm" role="alert">{error}</p>}
      {error && <p className="caption mt-1 text-xs">Saved edits will be used when you retry. Temporary previews appear in the library while images are offline.</p>}
    </main>
  </div>;
}
