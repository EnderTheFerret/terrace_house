import { useEffect, useRef, useState } from 'react';
import { DEFAULT_PLAYER, hashSeed, type PlayerSetup } from '@shared-roof/shared';
import assets from '../../public/assets/manifest.json';
import { api, waitImage, type ImageStatus } from '../api';
import { useGame } from '../store';
import { Btn } from './ui';
import { ProcPortrait, SpritePreview } from './pixel';

const lookKey = (p: PlayerSetup) => JSON.stringify([p.age, p.gender, p.appearance, p.appearanceText ?? '', p.portraitSeed]);
const baked = (p: PlayerSetup, sprite = false): string | undefined => {
  if (p.age !== DEFAULT_PLAYER.age || p.gender !== DEFAULT_PLAYER.gender) return undefined;
  const { palette: _palette, ...appearance } = p.appearance;
  const portrait = `portrait:player:${p.portraitSeed}:${hashSeed(JSON.stringify([appearance, p.appearanceText ?? ''])) % 100000}:thigh-up-v1`;
  if (sprite && (p.spriteSeed !== undefined || p.spriteInstructions)) return undefined;
  const file = (assets as Record<string, string>)[sprite ? `sprite:klein-4walk-v1:${portrait.replace(':thigh-up-v1', '')}` : portrait];
  return file ? `/assets/${file}` : undefined;
};

export function CreatorArtwork({ player, onChange, onBusy }: { player: PlayerSetup; onChange: (p: Partial<PlayerSetup>) => void; onBusy: (busy: boolean) => void }) {
  const enabled = useGame(s => s.settings.images);
  const [shown, setShown] = useState(player);
  const [portrait, setPortrait] = useState<string | undefined>(() => baked(player));
  const [walk, setWalk] = useState<string | undefined>(() => baked(player, true));
  const [notes, setNotes] = useState(player.spriteInstructions ?? '');
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [temporary, setTemporary] = useState(!baked(player));
  const [spriteTemporary, setSpriteTemporary] = useState(!baked(player, true));
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const changed = lookKey(shown) !== lookKey(player);

  const generate = async (setup: PlayerSetup, portraitToo: boolean) => {
    if (controller.current || !enabled) return;
    const ac = new AbortController();
    controller.current = ac;
    onBusy(true); setError('');
    const body = { ...setup, id: 'player', portraitSeed: setup.portraitSeed! };
    const finishImage = async (st: ImageStatus) => {
      let result = st;
      await waitImage(st, next => { result = next; }, ac.signal);
      if (ac.signal.aborted) throw new Error('cancelled');
      if (result.status !== 'ready' || !result.url) throw new Error('Artwork could not be generated. Please try again.');
      return result;
    };
    try {
      if (portraitToo || !portrait) {
        setStage('Generating portrait…');
        const ready = await finishImage(await api.portrait(body));
        setPortrait(ready.url); setTemporary(!!ready.placeholder); setShown(setup);
      }
      setStage('Generating walking sprite…');
      const ready = await finishImage(await api.draftSprite(body));
      setWalk(ready.url); setSpriteTemporary(!!ready.placeholder); setShown(setup);
      onChange({ spriteSeed: setup.spriteSeed, spriteInstructions: setup.spriteInstructions });
    } catch (e) { if (!ac.signal.aborted) setError((e as Error).message); }
    finally {
      if (!ac.signal.aborted) { setStage(''); onBusy(false); }
      controller.current = null;
    }
  };

  const changeSprite = (fix: boolean) => {
    if (controller.current) return;
    const patch = { spriteSeed: fix ? player.spriteSeed ?? player.portraitSeed! : Math.floor(Math.random() * 2 ** 31), spriteInstructions: fix ? notes.trim() : '' };
    void generate({ ...player, ...patch }, false);
  };

  return <section className="flex max-w-2xl flex-col gap-3" aria-label="portrait and walking sprite">
    <div className="flex flex-wrap items-center justify-center gap-5 px-panel-soft p-3">
      <figure className="flex flex-col items-center gap-1">
        {portrait ? <img src={portrait} alt="Your character portrait" className="pixelated h-[200px] w-[160px] object-contain" /> : <div role="img" aria-label="Temporary appearance preview"><ProcPortrait appearance={shown.appearance} gender={shown.gender} seed={shown.portraitSeed!} size={160} /></div>}
        <figcaption className="caption text-xs">{temporary ? 'Temporary portrait' : 'Portrait'}</figcaption>
      </figure>
      <div className="flex flex-col items-center gap-2">
        <SpritePreview url={walk} appearance={shown.appearance} scale={3} />
        <p className="caption max-w-sm text-center text-xs">{spriteTemporary ? 'Temporary sprite. Finished artwork needs the image service.' : 'This is the walking animation used in the house.'}</p>
      </div>
    </div>
    <div className="flex flex-wrap justify-center gap-2">
      <Btn disabled={!!stage || !enabled} onClick={() => void generate(player, true)}>generate portrait + sprite</Btn>
      <Btn disabled={!!stage || !enabled} onClick={() => { const setup = { ...player, portraitSeed: Math.floor(Math.random() * 99999) }; onChange({ portraitSeed: setup.portraitSeed }); void generate(setup, true); }}>reroll portrait</Btn>
      <Btn disabled={!!stage || !enabled || changed} onClick={() => changeSprite(false)}>change sprite</Btn>
    </div>
    <label className="flex flex-col gap-1 text-sm" htmlFor="sprite-fix">What should be fixed in the sprite?
      <textarea id="sprite-fix" className="px-panel-soft px-2 py-1" rows={2} maxLength={500} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Keep the glasses visible in every frame; fix the feet and walking pose…" />
    </label>
    <Btn className="self-start" disabled={!!stage || !enabled || changed || !notes.trim()} onClick={() => changeSprite(true)}>fix sprite</Btn>
    <p role="status" className="caption text-xs">{stage || (!enabled ? 'Enable images in settings to generate artwork.' : changed ? 'Appearance changed. Generate updated artwork when you are ready.' : 'Change or fix the sprite while keeping your portrait.')}</p>
    {error && <p role="alert" className="text-sm text-rose">{error}</p>}
  </section>;
}
