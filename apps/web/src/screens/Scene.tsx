// Scene: dialogue with streamed lines, captions, player intents, eavesdrop prompt, freeze-frame and studio panel.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGame, type LiveLine } from '../store';
import { StudioStrip, TopBar } from '../components/layout';
import { Btn, INTENT_LABEL } from '../components/ui';
import { PixelImage, Portrait, useImage } from '../components/pixel';
import { api, waitImage, type ImageStatus } from '../api';
import { chime } from '../audio';

const CPS = 45;

/** Reveal lines one after another at a typewriter pace (instant if disabled / reduced motion). */
function useReveal(lines: LiveLine[], enabled: boolean) {
  const [pos, setPos] = useState({ idx: 0, chars: 0 });
  const total = lines.length;
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => {
      setPos((p) => {
        const cur = lines[p.idx];
        if (!cur) return p;
        if (p.chars < cur.text.length) return { idx: p.idx, chars: p.chars + 2 };
        if (cur.done && p.idx < total - 1) return { idx: p.idx + 1, chars: 0 };
        return p;
      });
    }, 1000 / CPS);
    return () => clearInterval(t);
  }, [lines, total, enabled]);
  const idx = Math.min(pos.idx, Math.max(0, total - 1));
  const chars = pos.idx > idx ? Infinity : pos.chars;
  const skip = () => {
    if (!lines.length) return;
    setPos({ idx: lines.length - 1, chars: lines[lines.length - 1]?.text.length ?? 0 });
  };
  const complete = !enabled || (idx >= total - 1 && chars >= (lines[total - 1]?.text.length ?? 0) && (lines[total - 1]?.done ?? true));
  const reset = useCallback(() => setPos({ idx: 0, chars: 0 }), []);
  return { idx: enabled ? idx : total - 1, chars: enabled ? chars : Infinity, skip, complete, reset };
}

export function Scene() {
  const { live, view, choose, respond, nextScene, settings } = useGame();
  const [phaseShown, setPhaseShown] = useState<'dialogue' | 'freeze' | 'panel'>('dialogue');
  const logRef = useRef<HTMLDivElement>(null);
  const reveal = useReveal(live?.lines ?? [], settings.typewriter && !settings.reducedMotion);
  const bg = useImage(live?.header ? async () => live.header!.background : null, [live?.header?.background?.key]);
  const [freezeImg, setFreezeImg] = useState<ImageStatus | null>(null);

  useEffect(() => setPhaseShown('dialogue'), [live?.id]);
  const resetReveal = reveal.reset;
  useEffect(() => resetReveal(), [live?.id, resetReveal]);
  useEffect(() => {
    if (!live?.freeze) return setFreezeImg(null);
    const ac = new AbortController();
    setFreezeImg(live.freeze.image);
    void waitImage(live.freeze.image, setFreezeImg, ac.signal);
    return () => ac.abort();
  }, [live?.freeze]);
  useEffect(() => {
    if (live?.done && reveal.complete && phaseShown === 'dialogue') {
      if (live.outcome?.confession === 'accepted') chime('ok');
      setPhaseShown(live.freeze ? 'freeze' : 'panel');
    }
  }, [live?.done, reveal.complete, phaseShown, live?.freeze, live?.outcome]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [reveal.idx, reveal.chars, live?.lines.length]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!live) return;
      if (live.choice && reveal.complete) {
        const n = Number(e.key);
        if (n >= 1 && n <= live.choice.length) void choose(live.choice[n - 1]);
      }
      if ((e.key === ' ' || e.key === 'Enter') && !reveal.complete && !(e.target as HTMLElement)?.closest('button')) {
        e.preventDefault();
        reveal.skip();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [live, reveal, choose]);

  const people = useMemo(() => (live?.header?.participants ?? []).map((p) => view?.characters.find((c) => c.id === p.id)).filter(Boolean), [live?.header, view]);
  if (!live || !view) return null;
  const h = live.header;
  const chat = h?.chat;
  const visible = live.lines.slice(0, reveal.idx + 1);

  if (live.respond) {
    const sc = useGame.getState().scenes.find((s) => s.id === live.id);
    return (
      <div className="flex h-full flex-col">
        <TopBar />
        <main className="flex flex-1 items-center justify-center p-6">
          <div className="px-panel max-w-lg p-6 text-center">
            <p className="caption mb-2 text-sm">you can hear a conversation nearby</p>
            <p className="mb-5">{sc?.premise}</p>
            <div className="flex justify-center gap-3">
              <Btn primary autoFocus onClick={() => void respond('join')}>join in</Btn>
              <Btn onClick={() => void respond('eavesdrop')}>eavesdrop</Btn>
              <Btn onClick={() => void respond('ignore')}>leave them be</Btn>
            </div>
            <p className="caption mt-3 text-xs">eavesdropping might get you noticed.</p>
          </div>
        </main>
        <StudioStrip />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="relative min-h-0 flex-1 overflow-hidden bg-[#2a2433]" onClick={() => !reveal.complete && reveal.skip()}>
        {/* background */}
        <div className="absolute inset-0">
          {bg?.url ? <PixelImage url={bg.url} factor={6} alt={h?.locationName ?? 'location'} className="h-full w-full" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div className="h-full w-full bg-gradient-to-b from-[#cfe6f7] to-[#f8e1d0]" />}
          {(view.weather === 'rain' || view.weather === 'typhoon') && !chat && <div className="rain-overlay absolute inset-0" />}
          {view.slot === 'evening' && <div className="absolute inset-0 bg-[rgb(30_30_80/0.25)]" />}
        </div>
        {/* header */}
        {h && (
          <div className="absolute left-3 top-3 z-10 px-panel max-w-md px-3 py-2">
            <div className="text-sm lowercase">{h.title}</div>
            <div className="caption text-xs">{h.locationName}{h.eavesdrop ? ' · eavesdropping' : ''}</div>
            <p className="mt-1 text-xs">{h.premise}</p>
          </div>
        )}
        {!h && <div className="absolute inset-0 flex items-center justify-center text-paper">setting the scene<span className="blink">…</span></div>}
        {/* portraits */}
        {!chat && (
          <div className="absolute bottom-40 left-0 right-0 flex items-end justify-around px-8">
            {people.map((c, i) => {
              const speaking = visible[visible.length - 1]?.speaker === c!.id;
              return (
                <div key={c!.id} className={`flex flex-col items-center transition-transform ${speaking ? '-translate-y-2' : 'opacity-90'}`} style={{ order: i }}>
                  <div className="px-panel bg-paper p-1">
                    <Portrait charId={c!.id} appearance={c!.appearance} gender={c!.gender} seed={c!.portraitSeed} size={120} label={c!.name} />
                  </div>
                  <span className="mt-1 bg-paper px-2 text-xs" style={{ boxShadow: '0 0 0 2px var(--color-ink)' }}>
                    {c!.name.split(' ')[0]}
                  </span>
                </div>
              );
            })}
            {h?.outsiders.map((o) => (
              <div key={o.id} className="px-panel bg-paper px-3 py-6 text-center text-sm">
                {o.name}
              </div>
            ))}
          </div>
        )}
        {/* dialogue box or phone */}
        {chat ? (
          <div className="absolute left-1/2 top-1/2 z-10 flex h-[70%] w-80 -translate-x-1/2 -translate-y-1/2 flex-col rounded-[18px] bg-[#2b2b33] p-3">
            <div className="caption mb-2 text-center text-xs text-paper">messages</div>
            <div ref={logRef} className="flex flex-1 flex-col gap-2 overflow-y-auto rounded-[10px] bg-[#f4f6f8] p-2 scroll-thin" aria-live="polite">
              {visible.map((l, i) => {
                const mine = l.speaker === view.playerId;
                const text = i === reveal.idx ? l.text.slice(0, reveal.chars) : l.text;
                return (
                  <div key={l.index} className={`max-w-[80%] px-2 py-1 text-sm ${mine ? 'self-end bg-[#9fe0b0]' : 'self-start bg-white'}`} style={{ borderRadius: 10, boxShadow: '0 1px 0 rgba(0,0,0,.15)' }}>
                    {!mine && <div className="caption text-[0.65rem]">{l.name}</div>}
                    {text}
                  </div>
                );
              })}
              {live.streaming && !live.choice && <div className="caption self-start text-xs">typing<span className="blink">…</span></div>}
            </div>
          </div>
        ) : (
          <div className="absolute bottom-3 left-3 right-3 z-10 px-panel h-36 p-3">
            <div ref={logRef} className="h-full overflow-y-auto pr-2 scroll-thin" aria-live="polite">
              {visible.map((l, i) => {
                const text = i === reveal.idx ? l.text.slice(0, reveal.chars) : l.text;
                return (
                  <p key={l.index} className={`mb-1 ${i < visible.length - 1 ? 'opacity-60' : ''}`}>
                    <span className="caption mr-2">{l.speaker === view.playerId ? 'you' : l.name}</span>
                    {settings.captions && l.caption && <span className="caption mr-2 text-xs">{l.caption}</span>}
                    <span>{text}</span>
                  </p>
                );
              })}
              {live.streaming && !live.choice && visible.length === 0 && <p className="caption">…</p>}
              {live.error && <p className="caption text-xs">({live.error}) </p>}
            </div>
          </div>
        )}
        {/* choices */}
        {live.choice && reveal.complete && (
          <div className="absolute right-4 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-2" role="group" aria-label="how do you respond?">
            <div className="caption bg-paper px-2 text-xs" style={{ boxShadow: '0 0 0 2px var(--color-ink)' }}>
              how do you respond?
            </div>
            {live.choice.map((c, i) => (
              <Btn key={c} onClick={() => void choose(c)} autoFocus={i === 0}>
                {i + 1}. {INTENT_LABEL[c] ?? c}
              </Btn>
            ))}
          </div>
        )}
        {/* freeze frame */}
        {phaseShown === 'freeze' && live.freeze && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-[rgb(20_16_28/0.75)]" onClick={() => setPhaseShown('panel')}>
            <div className="relative max-h-[80%] max-w-[80%] overflow-hidden px-panel">
              {freezeImg?.url ? <PixelImage url={freezeImg.url} factor={6} alt={live.freeze.caption} className="freeze-zoom block" style={{ width: 640, maxWidth: '100%' }} /> : <div className="flex h-64 w-[480px] items-center justify-center bg-[#3a2e3f] text-paper">developing<span className="blink">…</span></div>}
              <div className="absolute bottom-3 left-3 bg-paper px-2 text-sm lowercase" style={{ boxShadow: '0 0 0 2px var(--color-ink)' }}>
                {live.freeze.caption}
              </div>
            </div>
            <div className="absolute bottom-6">
              <Btn autoFocus onClick={() => setPhaseShown('panel')}>
                to the studio
              </Btn>
            </div>
          </div>
        )}
        {/* outcome + continue */}
        {phaseShown === 'panel' && (
          <div className="absolute right-4 top-4 z-20 flex max-w-sm flex-col items-end gap-2">
            {live.outcome?.cues.map((c, i) => (
              <div key={i} className="slide-up px-panel px-3 py-1 text-sm">
                {c}
              </div>
            ))}
            {(live.outcome?.leaving?.length ?? 0) > 0 && <div className="luggage text-3xl" aria-hidden>🧳</div>}
            <Btn primary autoFocus onClick={() => void nextScene()}>
              continue
            </Btn>
          </div>
        )}
      </main>
      <StudioStrip expanded={phaseShown === 'panel'} lines={live.commentary?.lines} prediction={live.commentary?.prediction} />
    </div>
  );
}

export const imageStatus = api.imageStatus;
