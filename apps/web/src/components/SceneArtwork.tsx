import { useEffect, useRef, useState } from 'react';
import { EMOTIONS, OCCASIONS, type Emotion, type Occasion } from '@shared-roof/shared';
import { waitArtwork } from '../api';
import { Btn } from './ui';

export interface SceneArtworkPerson { id: string; name: string; occasion: Occasion; emotion: Emotion; outfit?: string; customExpression?: string }

export function SceneArtwork({ people, day, disabled, onReady }: { people: SceneArtworkPerson[]; day: number; disabled: boolean; onReady: (id: string, occasion: Occasion, emotion?: Emotion, outfit?: string, customExpression?: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [id, setId] = useState(people[0]?.id ?? '');
  const person = people.find(p => p.id === id) ?? people[0];
  const [emotion, setEmotion] = useState<Emotion>(person?.emotion ?? 'neutral');
  const [occasion, setOccasion] = useState<Occasion>(person?.occasion ?? 'daily');
  const [customOutfit, setCustomOutfit] = useState(person?.outfit ?? '');
  const [customExpression, setCustomExpression] = useState(person?.customExpression ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => () => controller.current?.abort(), []);
  const select = (id: string) => {
    const p = people.find(p => p.id === id)!;
    setId(id); setEmotion(p.emotion); setOccasion(p.occasion); setCustomOutfit(p.outfit ?? ''); setCustomExpression(p.customExpression ?? ''); setMessage(''); setError('');
  };
  const generate = async (kind: 'expression' | 'outfit' | 'both') => {
    if (!person || busy || disabled) return;
    const ac = new AbortController(); controller.current = ac;
    const label = kind === 'both' ? 'clothing and expression' : kind === 'outfit' ? 'outfit' : 'expression';
    setBusy(true); setError(''); setMessage(`Generating ${label} for ${person.name}…`);
    try {
      const outfit = kind === 'expression' ? person.outfit : customOutfit.trim() || undefined;
      const selectedOccasion = kind === 'expression' ? person.occasion : occasion;
      const description = kind === 'outfit' ? undefined : customExpression.trim() || undefined;
      const selectedEmotion = kind === 'outfit' ? 'neutral' : emotion;
      const image = await waitArtwork(person.id, 'expression', selectedEmotion, { occasion: selectedOccasion, day, outfit, customExpression: description }, ac.signal);
      if (!image || ac.signal.aborted) return;
      onReady(person.id, selectedOccasion, selectedEmotion, outfit, description);
      setMessage(`${person.name}'s ${label} ${kind === 'both' ? 'are' : 'is'} ready and shown in the scene.`);
    } catch (e) {
      if (!ac.signal.aborted) { setError((e as Error).message); setMessage(''); }
    } finally { if (!ac.signal.aborted) setBusy(false); }
  };
  const close = () => { controller.current?.abort(); setBusy(false); dialog.current?.close(); };
  return <>
    <Btn disabled={!people.length} onClick={() => { if (person) select(person.id); dialog.current?.showModal(); }}>character artwork</Btn>
    <dialog ref={dialog} aria-label="generate character artwork" onClick={e => e.stopPropagation()} onClose={close} className="px-panel m-auto max-h-[90vh] w-[min(28rem,95vw)] overflow-auto bg-paper p-4 backdrop:bg-black/70">
      <div className="mb-4 flex items-center justify-between gap-3"><h2>character artwork</h2><Btn onClick={close}>close</Btn></div>
      <label className="mb-3 block text-sm">character<select className="px-panel-soft block w-full px-2 py-1" value={person?.id ?? ''} disabled={busy} onChange={e => select(e.target.value)}>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="mb-3 block text-sm">expression<select className="px-panel-soft block w-full px-2 py-1" value={emotion} disabled={busy} onChange={e => setEmotion(e.target.value as Emotion)}>{EMOTIONS.map(e => <option key={e} value={e}>{e === 'tender' ? 'in love' : e}</option>)}</select></label>
      <label className="mb-3 block text-sm">custom expression (optional)<textarea className="px-panel-soft block w-full px-2 py-1" value={customExpression} maxLength={500} rows={2} disabled={busy} placeholder="A restrained smile, one eyebrow raised, eyes looking to the left" onChange={e => setCustomExpression(e.target.value)} /></label>
      <label className="mb-3 block text-sm">outfit<select className="px-panel-soft block w-full px-2 py-1" value={occasion} disabled={busy} onChange={e => { setOccasion(e.target.value as Occasion); setCustomOutfit(''); }}>{OCCASIONS.map(o => <option key={o} value={o}>{o === 'formal' ? 'formal / suit' : o}</option>)}</select></label>
      <label className="mb-3 block text-sm">custom outfit (optional)<input className="px-panel-soft block w-full px-2 py-1" value={customOutfit} maxLength={300} disabled={busy} placeholder="Black tuxedo with a white shirt and bow tie" onChange={e => setCustomOutfit(e.target.value)} /></label>
      <div className="flex flex-wrap gap-3"><Btn primary disabled={busy || disabled} onClick={() => void generate('expression')}>generate expression</Btn><Btn disabled={busy || disabled} onClick={() => void generate('outfit')}>generate clothing</Btn><Btn disabled={busy || disabled} onClick={() => void generate('both')}>generate both</Btn></div>
      <p className="caption mt-3 text-xs">Your expression description overrides the preset. Expression-only keeps the clothes currently shown. Clothing-only uses the neutral face; both applies your clothing and expression together. Expression previews last until the next dialogue line; clothing stays for this scene.</p>
      {disabled && <p className="caption mt-2 text-xs">Generation is available when images are enabled and the current reply finishes.</p>}
      {message && <p role="status" className="mt-3 text-sm">{message}</p>}
      {error && <p role="alert" className="mt-3 text-sm">{error}</p>}
    </dialog>
  </>;
}
