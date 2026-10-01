// Shared chrome: top bar, studio strip, digest modal.
import { useEffect, useState } from 'react';
import { content } from '@shared-roof/shared';
import { useGame } from '../store';
import { api, waitImage, type ImageStatus } from '../api';
import { HealthBadge, Modal, Btn, Tag } from './ui';
import { PixelImage } from './pixel';

const SLOT_LABEL: Record<string, string> = { morning: 'morning', slot1: 'late morning', slot2: 'afternoon', slot3: 'early evening', evening: 'night' };
const WEATHER_ICON: Record<string, string> = { sunny: '☀', cloudy: '☁', rain: '☂', typhoon: '🌀', snow: '❄' };
export const slotLabel = (s: string) => SLOT_LABEL[s] ?? s;

export function TopBar() {
  const { view, setScreen, settings } = useGame();
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      const map: Record<string, Parameters<typeof setScreen>[0]> = { p: 'phone', b: 'board', i: 'bible', f: 'fridge', m: 'map' };
      if (e.key === '`' && settings.author) setScreen('debug');
      const s = map[e.key.toLowerCase()];
      if (s && !e.ctrlKey && !e.metaKey && !e.altKey) setScreen(s);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [setScreen, settings.author]);
  if (!view) return null;
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b-[3px] border-ink bg-paper px-3 py-2 text-sm">
      <span className="text-base">ep {view.episode}<span className="caption">/{view.seasonLength}</span></span>
      <span className="caption">{view.dateLabel}</span>
      <span>{slotLabel(view.slot)}</span>
      <span title={view.weather} aria-label={`weather: ${view.weather}`}>
        {WEATHER_ICON[view.weather] ?? ''} <span className="caption">{view.weather}</span>
      </span>
      {view.cityEvent && <span className="px-1" style={{ background: '#f6d48f', boxShadow: '0 0 0 1px var(--color-ink)' }}>today: {view.cityEvent.name}</span>}
      <span>¥{view.money.toLocaleString()}</span>
      <span className="ml-auto flex flex-wrap items-center gap-2">
        <HealthBadge />
        <button className="px-btn text-xs" onClick={() => setScreen('phone')} title="phone (p)">phone</button>
        <button className="px-btn text-xs" onClick={() => setScreen('board')} title="relationships (b)">board</button>
        <button className="px-btn text-xs" onClick={() => setScreen('bible')} title="housemates (i)">bible</button>
        <button className="px-btn text-xs" onClick={() => setScreen('fridge')} title="fridge & chores (f)">fridge</button>
        <button className="px-btn text-xs" onClick={() => setScreen('saves')}>save</button>
        <button className="px-btn text-xs" onClick={() => setScreen('settings')}>settings</button>
        {settings.author && <button className="px-btn text-xs" onClick={() => setScreen('debug')}>debug</button>}
      </span>
    </header>
  );
}

const avatarCache: Record<string, ImageStatus> = {};
const avatarListeners = new Set<() => void>();
let avatarsRequested = false;
function requestAvatars() {
  if (avatarsRequested) return;
  avatarsRequested = true;
  api.panel()
    .then((r) => {
      for (const [id, st] of Object.entries(r))
        void waitImage(st, (s) => {
          avatarCache[id] = s;
          avatarListeners.forEach((f) => f());
        });
    })
    .catch(() => (avatarsRequested = false));
}
/** Panel avatars, fetched once per page load and shared by every avatar on screen. */
export function usePanelAvatars() {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    avatarListeners.add(f);
    requestAvatars();
    return () => void avatarListeners.delete(f);
  }, []);
  return avatarCache;
}

const REACTION_ICON: Record<string, string> = { laugh: '😂', gasp: '😮', cringe: '😬', aww: '🥹', silence: '…', groan: '😩' };
export const reactionIcon = (r: string) => REACTION_ICON[r] ?? '';

export function PanelAvatar({ id, size = 48, speaking = false }: { id: string; size?: number; speaking?: boolean }) {
  const av = usePanelAvatars();
  const p = content().panel.find((x) => x.id === id)!;
  const st = av[id];
  return (
    <div className={`relative overflow-hidden bg-white ${speaking ? 'bob' : ''}`} style={{ width: size, height: size, boxShadow: `0 0 0 2px ${speaking ? 'var(--color-rose)' : 'var(--color-ink)'}` }} title={`${p.name}, ${p.role}`}>
      {st?.url ? <PixelImage url={st.url} factor={6} alt={p.name} style={{ width: size, height: size }} /> : <div className="flex h-full items-center justify-center text-lg">{p.name[0]}</div>}
    </div>
  );
}

/** Studio strip: collapsed shows the panel watching; expanded shows lines with reactions. */
export function StudioStrip({ lines, prediction, expanded }: { lines?: { speaker: string; text: string; reaction: string }[]; prediction?: { text: string } | null; expanded?: boolean }) {
  const panel = content().panel;
  const [shown, setShown] = useState(0);
  const reduced = useGame((s) => s.settings.reducedMotion);
  useEffect(() => {
    setShown(reduced ? (lines?.length ?? 0) : 0);
    if (!lines?.length || reduced) return;
    const t = setInterval(() => setShown((n) => (n >= lines.length ? n : n + 1)), 1400);
    return () => clearInterval(t);
  }, [lines, reduced]);
  const open = expanded && lines && lines.length > 0;
  return (
    <aside className={`border-t-[3px] border-ink bg-[#f4ecf8] transition-all ${open ? 'py-3' : 'py-1'}`} aria-label="studio panel" aria-live="polite">
      <div className="flex items-start gap-3 px-3">
        <div className="caption pt-1 text-xs">studio</div>
        {!open && (
          <div className="flex items-center gap-2">
            {panel.map((p) => (
              <PanelAvatar key={p.id} id={p.id} size={28} />
            ))}
            <span className="caption ml-2 text-xs">the panel is watching.</span>
          </div>
        )}
        {open && (
          <div className="flex flex-1 flex-col gap-2">
            {lines!.slice(0, Math.max(1, shown)).map((l, i) => {
              const p = panel.find((x) => x.id === l.speaker);
              return (
                <div key={i} className="slide-up flex items-start gap-2">
                  <PanelAvatar id={l.speaker} size={44} speaking={i === shown - 1} />
                  <div>
                    <div className="caption text-xs">
                      {p?.name ?? l.speaker} · <span aria-label={`reaction: ${l.reaction}`}>{reactionIcon(l.reaction)} {l.reaction}</span>
                    </div>
                    <div className="text-sm">{l.text}</div>
                  </div>
                </div>
              );
            })}
            {prediction && shown >= (lines?.length ?? 0) && (
              <div className="slide-up px-panel-soft self-start px-2 py-1 text-xs">
                prediction noted: “{prediction.text}”
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

export function DigestModal() {
  const { showDigest, slotDigest } = useGame();
  if (!showDigest || !slotDigest.length) return null;
  const close = () => useGame.setState({ showDigest: false });
  return (
    <Modal title="while you were out" onClose={close}>
      <ul className="mb-4 flex flex-col gap-2 text-sm">
        {slotDigest.map((d, i) => (
          <li key={i}>
            {d.text}
            <Tag kind={d.reliability} />
            {d.distorted && <span className="caption ml-1 text-xs">(might be exaggerated)</span>}
          </li>
        ))}
      </ul>
      <Btn primary onClick={close} autoFocus>
        ok
      </Btn>
    </Modal>
  );
}
