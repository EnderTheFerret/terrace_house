// Pixel rendering primitives: procedural pixels → canvas, generated images → pixelated canvas, portraits with crossfade.
import { useEffect, useRef, useState } from 'react';
import { portraitPixels, type Appearance, type Pixels } from '@shared-roof/shared';
import { api, waitImage, type ImageStatus } from '../api';
import { useGame } from '../store';

const canvasCache = new Map<string, HTMLCanvasElement>();

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
  const [st, setSt] = useState<ImageStatus | null>(null);
  const enabled = useGame((s) => s.settings.images);
  useEffect(() => {
    if (!request || !enabled) {
      setSt(null);
      return;
    }
    const ac = new AbortController();
    request()
      .then((s) => {
        setSt(s);
        return waitImage(s, setSt, ac.signal);
      })
      .catch(() => setSt(null));
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);
  return st;
}

/** Character portrait: procedural pixel portrait immediately, crossfades to the generated one when ready. */
export function Portrait({ charId, appearance, gender, seed, size = 128, label }: { charId: string; appearance: Appearance; gender: string; seed: number; size?: number; label: string }) {
  const st = useImage(() => api.charPortrait(charId), [charId, seed]);
  const ready = st?.status === 'ready' && st.url && !st.url.endsWith('.svg');
  return (
    <div className="relative overflow-hidden" style={{ width: size, height: size * 1.25 }} aria-label={label} role="img">
      <div className="absolute inset-0 flex items-end justify-center" style={{ opacity: ready ? 0 : 1, transition: 'opacity 600ms' }}>
        <ProcPortrait appearance={appearance} gender={gender} seed={seed} size={size} />
      </div>
      {ready && <PixelImage url={st!.url!} factor={8} alt={label} className="absolute inset-0 h-full w-full object-cover" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
    </div>
  );
}
