// Pixel rendering primitives: procedural pixels → canvas, generated images → pixelated canvas, portraits with crossfade.
import { useEffect, useRef, useState } from 'react';
import { EMOTIONS, portraitPixels, spritePixels, spriteSheetPixels, SPRITE_DIRECTIONS, type Appearance, type Emotion, type Pixels } from '@shared-roof/shared';
import { api, waitImage, type ImageStatus, type OutfitRef } from '../api';
import { useGame } from '../store';

const canvasCache = new Map<string, HTMLCanvasElement>();
const portraitPalettes = new Map<string, NonNullable<Appearance['palette']>>();
export const portraitPalette = (id: string, seed: number) => portraitPalettes.get(`${id}:${seed}`);

/** ponytail: sample central portrait regions; use segmented sprite sheets when portraits vary too much. */
export function samplePortraitPalette(url: string): Promise<NonNullable<Appearance['palette']>> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = 32; c.height = 40;
        const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0, 32, 40);
        const color = (x: number, y: number, w: number, h: number) => {
          const d = ctx.getImageData(x, y, w, h).data;
          const colors = new Map<string, number>();
          for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] < 128) continue;
            const rgb = [d[i], d[i + 1], d[i + 2]].map((v) => Math.round(v / 16) * 16).map((v) => Math.min(255, v).toString(16).padStart(2, '0')).join('');
            colors.set(rgb, (colors.get(rgb) ?? 0) + 1);
          }
          return '#' + ([...colors].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '888888');
        };
        resolve({ hair: color(12, 5, 8, 4), skin: color(13, 12, 6, 6), outfit: color(11, 27, 10, 7) });
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error('portrait unavailable'));
    img.src = url;
  });
}

/** Render a Pixels grid into an offscreen canvas (1 px per cell), cached by key. */
export function pixelsCanvas(key: string, p: Pixels): HTMLCanvasElement {
  const hit = canvasCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = p[0].length;
  c.height = p.length;
  const ctx = c.getContext('2d')!;
  for (let y = 0; y < p.length; y++)
    for (let x = 0; x < p[0].length; x++) {
      const col = p[y][x];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  canvasCache.set(key, c);
  return c;
}

/** Preview the game's four directions and walk cycle without requesting generation. */
export function SpritePreview({ url, appearance, scale = 2 }: { url?: string; appearance?: Appearance; scale?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reducedMotion = useGame(s => s.settings.reducedMotion);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let sheet = appearance ? SPRITE_DIRECTIONS.map(dir => [0, 1, 2].map(f => spritePixels(appearance, dir, f))) : null;
    let sourceKey = `procedural:${JSON.stringify(appearance)}`;
    let phase = 0;
    setError('');
    const draw = () => {
      const canvas = ref.current;
      const ctx = active && canvas?.getContext('2d');
      if (!ctx || !sheet) return;
      const frame = reducedMotion ? 1 : [0, 1, 2, 1][phase++ % 4];
      canvas!.dataset.frame = String(frame);
      ctx.clearRect(0, 0, 128, 40);
      ctx.imageSmoothingEnabled = false;
      SPRITE_DIRECTIONS.forEach((dir, i) => ctx.drawImage(pixelsCanvas(`preview-sheet:${sourceKey}:${dir}:${frame}`, sheet![i][frame]), i * 32, 0));
    };
    draw();
    const image = url ? new Image() : null;
    if (image) image.onload = () => {
      if (!active) return;
      try {
        const source = document.createElement('canvas');
        source.width = image.width; source.height = image.height;
        const sourceCtx = source.getContext('2d')!;
        sourceCtx.drawImage(image, 0, 0);
        sheet = spriteSheetPixels(sourceCtx.getImageData(0, 0, image.width, image.height).data, image.width, image.height);
        sourceKey = `generated:${url}`;
        draw();
      } catch { setError('Sprite could not be displayed. Change it or describe a fix.'); }
    };
    if (image) { image.onerror = () => { if (active) setError('Sprite could not be loaded. Try again.'); }; image.src = url!; }
    const timer = reducedMotion ? null : window.setInterval(draw, 160);
    return () => { active = false; if (timer !== null) clearInterval(timer); };
  }, [url, appearance, reducedMotion]);
  return <figure className="max-w-full"><canvas ref={ref} width={128} height={40} className="pixelated block max-w-full" style={{ width: 128 * scale, height: 40 * scale }} role="img" aria-label={`${url ? 'Finished' : 'Temporary'} walk sprite preview: front, back, left and right`} /><figcaption className="caption text-center text-xs">{url ? 'Walk sprite' : 'Temporary walk sprite'} · front / back / left / right{reducedMotion ? ' · animation paused' : ''}</figcaption>{error && <p role="alert" className="text-xs text-rose">{error}</p>}</figure>;
}

/** Procedural pixel portrait drawn on a canvas, scaled crisp. Always available instantly. */
export function ProcPortrait({ appearance, gender, seed, size = 128, bg }: { appearance: Appearance; gender: string; seed: number; size?: number; bg?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, 32, 32);
    if (bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, 32, 32);
    }
    ctx.drawImage(pixelsCanvas(`portrait:${seed}:${JSON.stringify(appearance)}`, portraitPixels(appearance, gender, seed)), 0, 0);
  }, [appearance, gender, seed, bg]);
  return <canvas ref={ref} width={32} height={32} className="pixelated" style={{ width: size, height: size }} aria-hidden />;
}

/**
 * Show a generated image pixelated: drawn into a small canvas (width/factor) and scaled with nearest-neighbour.
 * Prebaked assets are already pixel art (factor 1).
 */
export function PixelImage({ url, factor = 8, className, style, alt }: { url: string; factor?: number; className?: string; style?: React.CSSProperties; alt: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ok, setOk] = useState(false);
  useEffect(() => {
    setOk(false);
    const img = new Image();
    img.onload = () => {
      const c = ref.current;
      if (!c) return;
      const svg = url.endsWith('.svg');
      const f = url.includes('/assets/') || svg ? 1 : factor;
      const w = Math.max(1, Math.round((svg ? img.width / 12 : img.width) / f));
      const h = Math.max(1, Math.round((svg ? img.height / 12 : img.height) / f));
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingEnabled = !svg && f > 1;
      ctx.drawImage(img, 0, 0, w, h);
      setOk(true);
    };
    img.src = url;
  }, [url, factor]);
  return <canvas ref={ref} role="img" aria-label={alt} className={`pixelated crossfade-img ${className ?? ''}`} style={{ ...style, opacity: ok ? 1 : 0 }} />;
}

/** Track an image request until ready. */
export function useImage(request: (() => Promise<ImageStatus>) | null, deps: unknown[]): ImageStatus | null {
  // status is tagged with the inputs it answers, so a new request never shows the previous one's image
  const key = JSON.stringify([!!request, ...deps]);
  const [st, setSt] = useState<{ key: string; s: ImageStatus } | null>(null);
  const enabled = useGame((s) => s.settings.images);
  useEffect(() => {
    if (!request || !enabled) {
      setSt(null);
      return;
    }
    const ac = new AbortController();
    setSt(null);
    const update = (s: ImageStatus) => { if (!ac.signal.aborted) setSt({ key, s }); };
    request()
      .then((s) => {
        if (ac.signal.aborted) return;
        update(s);
        return waitImage(s, update, ac.signal);
      })
      .catch(() => update({ key: '', status: 'failed' }));
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);
  return st?.key === key ? st.s : null;
}

/**
 * Visual-novel standing figure: the character cut out of their portrait, dressed for the occasion, showing `emotion`.
 * Uses neutral while the requested expression is drawn; a framed portrait stands in until the first figure.
 */
export function Stand({ char, outfit, emotion, height, refresh = '' }: { char: { id: string; name: string; appearance: Appearance; gender: string; portraitSeed: number }; outfit: OutfitRef; emotion: Emotion; height: string; refresh?: string }) {
  const [tick, setTick] = useState(0);
  const look = JSON.stringify(char.appearance);
  // neutral is the base layer; the line's expression replaces it once drawn
  const base = useImage(() => api.stand(char.id, { ...outfit, customExpression: undefined }, 'neutral'), [char.id, char.portraitSeed, look, outfit.occasion, outfit.day, outfit.outfit, refresh, tick]);
  const face = useImage(emotion !== 'neutral' || outfit.customExpression ? () => api.stand(char.id, outfit, emotion) : null, [char.id, char.portraitSeed, look, outfit.occasion, outfit.day, outfit.outfit, outfit.customExpression, emotion, refresh, tick]);
  const ok = (s: ImageStatus | null) => (s?.status === 'ready' && s.url ? s.url : null);
  const wanted = (emotion !== 'neutral' || outfit.customExpression) && (!face?.emotion || face.emotion === emotion) && !face?.placeholder ? ok(face) : null;
  // useImage drops to null whenever its inputs change: keep the last figure on screen while the next face's status is
  // unknown (usually ready at once), instead of flashing neutral on every line; a face still being drawn shows neutral
  const last = useRef<{ url: string; emotion: Emotion } | null>(null);
  const asking = !wanted && (emotion !== 'neutral' || !!outfit.customExpression) && !face;
  const shown = wanted ? { url: wanted, emotion } : asking && last.current ? last.current : ok(base) ? { url: ok(base)!, emotion: 'neutral' as const } : last.current;
  if (shown) last.current = shown;
  // 409 while the outfit or expression portrait is being drawn: ask again shortly
  const waiting = base?.status === 'failed' || face?.status === 'failed';
  useEffect(() => { if (!waiting) return; const t = setTimeout(() => setTick((n) => n + 1), 1500); return () => clearTimeout(t); }, [waiting, tick]);
  if (!shown) return <div className="px-panel mb-48 bg-paper p-1"><Portrait charId={char.id} appearance={char.appearance} gender={char.gender} seed={char.portraitSeed} size={180} label={char.name} outfit={outfit} /></div>;
  return <img src={shown.url} data-emotion={shown.emotion} alt={`${char.name}${shown.emotion === 'neutral' ? '' : `, ${expressionLabel(shown.emotion)}`}`} className="pointer-events-none block select-none" style={{ height, width: 'auto', imageRendering: 'auto' /* the figure is already pixel art at 832x1216; nearest-neighbour downscaling only adds jaggies */, filter: 'drop-shadow(0 6px 10px rgb(0 0 0 / 0.35))' }} />;
}

/** Character portrait: procedural pixel portrait immediately, crossfades to the generated one when ready. */
const EXPRESSION_ICONS: Record<Emotion, string> = { neutral: '😐', happy: '😊', shy: '😳', awkward: '😅', annoyed: '😒', sad: '😢', excited: '🤩', nervous: '😰', tender: '🥰', angry: '😠' };
const expressionLabel = (emotion: Emotion) => emotion === 'tender' ? 'in love' : emotion;

export function Portrait({ charId, appearance, gender, seed, size = 128, label, expressions = false, outfit }: { charId: string; appearance: Appearance; gender: string; seed: number; size?: number; label: string; expressions?: boolean; outfit?: OutfitRef }) {
  const [emotion, setEmotion] = useState<Emotion>('neutral');
  const [retry, setRetry] = useState(0);
  const enabled = useGame((s) => s.settings.images);
  const base = useImage(() => api.charPortrait(charId), [charId, seed]);
  // the occasion's outfit replaces the base portrait once drawn (it needs the base first, so retry with it)
  const dressed = useImage(outfit && base?.status === 'ready' && !base.placeholder ? () => api.outfitPortrait(charId, outfit) : null, [charId, seed, outfit?.occasion, outfit?.day, outfit?.outfit, base?.status]);
  const variant = useImage(expressions && emotion !== 'neutral' ? () => api.expression(charId, emotion, outfit) : null, [charId, seed, emotion, retry, expressions, outfit?.occasion, outfit?.day, outfit?.outfit]);
  const shown = dressed?.status === 'ready' && !dressed.placeholder ? dressed : base;
  const st = variant?.status === 'ready' && !variant.placeholder ? variant : shown;
  const busy = emotion !== 'neutral' && (!variant || variant.status === 'queued' || variant.status === 'running');
  const ready = st?.status === 'ready' && st.url && !st.url.endsWith('.svg');
  useEffect(() => {
    if (base?.status !== 'ready' || base.placeholder || !base.url || base.url.endsWith('.svg')) return;
    let active = true;
    void samplePortraitPalette(base.url).then((palette) => {
      if (!active) return;
      portraitPalettes.set(`${charId}:${seed}`, palette);
      if (JSON.stringify(appearance.palette) !== JSON.stringify(palette)) void api.savePalette(charId, seed, palette).catch(() => {});
    }).catch(() => {});
    return () => { active = false; };
  }, [base?.status, base?.placeholder, base?.url, charId, seed, appearance.palette]);
  return (
    <div className="shrink-0" style={{ width: expressions ? Math.max(size, 140) : size }}>
    <div className="relative mx-auto overflow-hidden" style={{ width: size, height: size * 1.25 }} aria-label={`${label}${ready && st === variant ? ` · ${expressionLabel(emotion)}` : ''}`} role="img">
      <div className="absolute inset-0 flex items-end justify-center" style={{ opacity: ready ? 0 : 1, transition: 'opacity 600ms' }}>
        <ProcPortrait appearance={appearance} gender={gender} seed={seed} size={size} />
      </div>
      {ready && <PixelImage url={st!.url!} factor={4} alt={label} className="absolute inset-0 h-full w-full object-contain" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
    </div>
    {expressions && <>
      <div className="mt-1 grid grid-cols-5 gap-1" role="group" aria-label={`expressions for ${label}`} onClick={(e) => e.stopPropagation()}>
        {EMOTIONS.map((e) => (
          <button key={e} type="button" className="px-btn text-sm"
            style={{ padding: 0, height: 28, minWidth: 0, fontFamily: 'system-ui', background: emotion === e ? 'var(--color-rose)' : undefined }}
            aria-label={`${e === 'neutral' ? 'Show' : 'Generate'} ${expressionLabel(e)} expression for ${label}`} title={expressionLabel(e)} aria-pressed={emotion === e}
            disabled={e !== 'neutral' && (!enabled || base?.status !== 'ready' || !!base.placeholder || busy)}
            onClick={() => { setEmotion(e); setRetry((n) => n + 1); }}>
            <span aria-hidden>{EXPRESSION_ICONS[e]}</span>
          </button>
        ))}
      </div>
      <p className="caption mt-1 text-xs" role="status">{!enabled ? 'Images disabled' : busy ? `${expressionLabel(emotion)} queued…` : variant?.placeholder || variant?.status === 'failed' || variant?.status === 'cancelled' ? 'Unavailable; click to retry' : base?.placeholder ? 'Images offline' : emotion !== 'neutral' ? expressionLabel(emotion) : 'Choose an expression'}</p>
    </>}
    </div>
  );
}
