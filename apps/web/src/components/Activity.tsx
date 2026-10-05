import { useEffect, useState } from 'react';
import { api, pendingRequests, type Activity, type ServerActivity } from '../api';
import { useGame } from '../store';

function eta(activity: Activity, now: number, waiting = false) {
  const elapsed = Math.max(0, now - activity.startedAt);
  const remaining = Math.max(0, activity.estimatedMs - (waiting ? 0 : elapsed));
  const seconds = Math.ceil(remaining / 1000);
  const duration = seconds >= 60 ? `${Math.ceil(seconds / 60)} min` : `${seconds}s`;
  return !waiting && remaining <= 0 ? `Taking longer than estimated · ${Math.floor(elapsed / 1000)}s elapsed` :
    `ETA ≈ ${duration}${waiting ? ' once started' : ''} for this step`;
}

export function ActivityStatus({ spritePending = 0 }: { spritePending?: number }) {
  const [server, setServer] = useState<ServerActivity>({ text: [], image: null });
  const [requests, setRequests] = useState<Activity[]>([]);
  const [now, setNow] = useState(Date.now());
  const [offline, setOffline] = useState(false);
  const { view, settings, screen } = useGame();
  useEffect(() => {
    const ac = new AbortController();
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const activity = await api.activity(AbortSignal.any([ac.signal, AbortSignal.timeout(3000)]));
        if (!ac.signal.aborted) { setServer(activity); setOffline(false); }
      } catch {
        if (!ac.signal.aborted) { setServer({ text: [], image: null }); setOffline(true); }
      } finally { polling = false; }
    };
    const changed = () => {
      setRequests([...pendingRequests.values()]);
      setServer(s => ({ ...s, text: [] })); // discard the previous request's stage immediately
      setNow(Date.now());
      void poll();
    };
    window.addEventListener('game-activity', changed);
    changed();
    const timer = setInterval(() => { setNow(Date.now()); void poll(); }, 1000);
    return () => { ac.abort(); clearInterval(timer); window.removeEventListener('game-activity', changed); };
  }, []);
  const text = server.text[0] ?? requests[0];
  const image = settings.images ? server.image : null;
  const preparingSprites = screen === 'episode' && spritePending > 0;
  if (!text && !image && !preparingSprites) return null;
  const name = image?.characterId && view?.characters.find(c => c.id === image.characterId)?.name;
  return (
    <aside aria-label="Game activity" title="Images load in the background; outfit and expression steps may follow." className="pointer-events-none fixed bottom-2 right-2 z-50 max-w-[min(20rem,calc(100vw-1rem))] px-panel bg-paper/90 px-2 py-1 text-[0.7rem] leading-tight shadow-lg">
      {text && <div>
        <p role="status" aria-live="polite">{offline ? 'Cannot reach server · still waiting' : text.label}…</p>
        <p aria-live="off" className="caption">{eta(text, now)}</p>
      </div>}
      {!image && preparingSprites && <div role="status"><p>{offline ? 'Cannot reach server' : 'Loading housemate sprites'}… {spritePending} remaining</p><p className="caption">{offline ? 'ETA unavailable until the server reconnects.' : 'ETA estimating; waiting for image job status.'}</p></div>}
      {image && <div className={text ? 'mt-2 border-t border-ink pt-2' : ''}>
        <p role="status" aria-live="polite">{image.waiting ? `${image.waiting} · ` : ''}{image.label}{name ? ` · ${name}` : ''}…</p>
        <p aria-live="off" className="caption">{eta(image, now, !!image.waiting)}{typeof image.progress === 'number' && image.progress > 0 ? ` · sampling ${Math.round(image.progress * 100)}%` : ''}{image.queued > (image.waiting ? 1 : 0) ? ` · ${image.queued - (image.waiting ? 1 : 0)} more queued` : ''}</p>
        {screen === 'episode' && spritePending > 0 && <p className="caption mt-1">Episode begins when {spritePending} remaining housemate sprites are ready.</p>}
      </div>}
    </aside>
  );
}
