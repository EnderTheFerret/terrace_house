// Studio intermission: the show cuts away from the house and the panel talks over the footage so far.
import { useEffect, useState } from 'react';
import { content } from '@shared-roof/shared';
import { useGame } from '../store';
import { api } from '../api';
import { Btn } from '../components/ui';
import { PanelAvatar, reactionIcon } from '../components/layout';

type Line = { speaker: string; text: string; reaction: string };

export function Studio() {
  const { studioAfter, settings } = useGame();
  const [data, setData] = useState<{ at: 'mid' | 'end'; lines: Line[] } | null>(null);
  const [shown, setShown] = useState(0);
  const [error, setError] = useState('');
  const leave = () => useGame.setState({ screen: studioAfter });

  useEffect(() => {
    let active = true;
    api.intermission().then(next => { if (active) setData(next); }, (e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!data) return;
    if (settings.reducedMotion) return setShown(data.lines.length);
    const t = setInterval(() => setShown((n) => Math.min(n + 1, data.lines.length)), 1600);
    setShown(1);
    return () => clearInterval(t);
  }, [data, settings.reducedMotion]);

  const panel = content().panel;
  const lines = data?.lines.slice(0, shown) ?? [];
  const speaking = lines[lines.length - 1]?.speaker;
  return (
    <div className="flex h-full flex-col bg-[#f4ecf8]" onClick={() => data && setShown(data.lines.length)}>
      <header className="flex items-center gap-3 border-b-[3px] border-ink bg-paper px-3 py-2 text-sm">
        <span className="rec-dot" aria-hidden /> <span>studio</span>
        <span className="caption">{data?.at === 'end' ? 'after the episode' : 'intermission'}</span>
      </header>
      <main className="flex min-h-0 flex-1 flex-col items-center gap-6 overflow-y-auto p-6">
        {/* the panel on their sofas around the low table */}
        <div className="flex items-end gap-4" aria-label="the panel">
          {panel.map((p) => (
            <div key={p.id} className="flex flex-col items-center gap-1">
              <PanelAvatar id={p.id} size={72} speaking={p.id === speaking} />
              <span className="caption text-xs">{p.name.split(' ')[1]}</span>
            </div>
          ))}
        </div>
        <div className="studio-table" aria-hidden />
        <div className="flex w-full max-w-2xl flex-col gap-3" aria-live="polite">
          {!data && !error && <p className="caption text-center">the panel is settling in<span className="blink">…</span></p>}
          {error && <div role="alert"><p>{error}</p><Btn onClick={() => { setError(''); void api.intermission().then(setData, (e: Error) => setError(e.message)); }}>retry panel</Btn><Btn onClick={leave}>continue</Btn></div>}
          {lines.map((l, i) => {
            const p = panel.find((x) => x.id === l.speaker);
            return (
              <div key={i} className="slide-up px-panel flex items-start gap-3 p-3">
                <PanelAvatar id={l.speaker} size={40} />
                <div>
                  <div className="caption text-xs">
                    {p?.name ?? l.speaker} · <span aria-label={`reaction: ${l.reaction}`}>{reactionIcon(l.reaction)} {l.reaction}</span>
                  </div>
                  <div className="reply-text">{l.text}</div>
                </div>
              </div>
            );
          })}
        </div>
        {data && shown >= data.lines.length && (
          <Btn primary autoFocus onClick={leave}>
            {data.at === 'end' ? 'roll credits' : 'back to the house'}
          </Btn>
        )}
      </main>
    </div>
  );
}
