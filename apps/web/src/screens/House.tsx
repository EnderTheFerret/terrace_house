// House: top-down pixel view of the share house. Walk with arrows/WASD, E/Enter to interact.
// A full keyboard-accessible action list mirrors everything the map offers.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ROOMS, roomName, type CharView, type PlayerAction } from '@shared-roof/shared';
import { useGame } from '../store';
import { TopBar, StudioStrip, DigestModal, slotLabel } from '../components/layout';
import { Btn, Modal, Panel } from '../components/ui';
import { hotspots, houseSize, passable, renderHouse, roomAt, solidTiles, spotFor, TILE } from '../pixel/house';
import { MOOD_ICON, sprite } from '../pixel/sprites';
import { Portrait } from '../components/pixel';

type Dir = 'down' | 'up' | 'left' | 'right';
interface Actor {
  id: string;
  x: number;
  y: number;
  tx: number;
  ty: number;
  dir: Dir;
  moving: number;
}

const TINT: Record<string, string> = { morning: 'rgba(255,214,170,0.10)', slot1: 'rgba(0,0,0,0)', slot2: 'rgba(255,240,200,0.06)', slot3: 'rgba(255,160,110,0.14)', evening: 'rgba(40,40,110,0.28)' };

export function House() {
  const { view, act, busy, setScreen } = useGame();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(2);
  const [prompt, setPrompt] = useState<{ label: string; run: () => void } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; action: PlayerAction } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [, setPlaced] = useState(0);
  const base = useMemo(() => renderHouse(), []);
  const solid = useMemo(() => solidTiles(), []);
  const actors = useRef<Map<string, Actor>>(new Map());
  const keys = useRef<Set<string>>(new Set());
  const daySlot = !!view && ['slot1', 'slot2', 'slot3'].includes(view.slot);

  const chars = useMemo(() => (view ? view.characters.filter((c) => c.status === 'inHouse') : []), [view]);
  const byId = useMemo(() => Object.fromEntries(chars.map((c) => [c.id, c])), [chars]);

  // place actors from occupancy
  useEffect(() => {
    if (!view?.occupancy) return;
    const seen = new Set<string>();
    for (const room of ROOMS) {
      (view.occupancy[room] ?? []).forEach((id, i) => {
        seen.add(id);
        const [sx, sy] = spotFor(room, i);
        const a = actors.current.get(id);
        if (!a) actors.current.set(id, { id, x: sx, y: sy, tx: sx, ty: sy, dir: 'down', moving: 0 });
        else if (id !== view.playerId) Object.assign(a, { tx: sx, ty: sy });
      });
    }
    for (const id of [...actors.current.keys()]) if (!seen.has(id)) actors.current.delete(id);
    setPlaced((n) => n + 1); // re-render DOM labels
  }, [view]);

  // fit canvas
  useEffect(() => {
    const fit = () => {
      const el = wrapRef.current;
      if (!el) return;
      const [w, h] = houseSize();
      setScale(Math.max(1, Math.floor(Math.min(el.clientWidth / w, el.clientHeight / h) * 2) / 2));
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const nearestInteraction = () => {
    const me = view && actors.current.get(view.playerId);
    if (!me || !view) return null;
    const px = Math.round(me.x);
    const py = Math.round(me.y);
    for (const a of actors.current.values()) {
      if (a.id === view.playerId) continue;
      const d = Math.abs(Math.round(a.x) - px) + Math.abs(Math.round(a.y) - py);
      if (d <= 1) {
        const c = byId[a.id];
        if (c) return { label: `talk to ${c.name.split(' ')[0]}`, run: () => setConfirm({ title: `talk to ${c.name.split(' ')[0]}?`, action: { type: 'talk', target: c.id } }) };
      }
    }
    const h = hotspots().find((h) => Math.abs(h.x - px) + Math.abs(h.y - py) <= 1);
    if (!h) return null;
    return { label: h.label, run: () => hotspotAction(h.action) };
  };

  const hotspotAction = (action: string) => {
    if (action === 'fridge') return setScreen('fridge');
    if (action === 'cook') return setScreen('cooking');
    if (action === 'map') {
      if (!daySlot) return setToast(view?.slot === 'evening' ? 'it is late. everyone is home for the night.' : 'it is still early. the city opens later.');
      if (view?.cityEvent?.id === 'typhoon') return setToast('the typhoon has shut everything down.');
      return setScreen('map');
    }
    const act2: Record<string, PlayerAction> = {
      hangout: { type: 'house', activity: 'hangout' },
      hobby: { type: 'house', activity: 'hobby' },
      tidy: { type: 'house', activity: 'tidy' },
      rooftop: { type: 'house', activity: 'rooftop' },
      rest: { type: 'house', activity: 'rest' },
    };
    const a = act2[action];
    if (a) setConfirm({ title: `${action === 'rest' ? 'rest for a while' : action === 'tidy' ? 'tidy up' : action === 'rooftop' ? 'go up to the rooftop' : action === 'hobby' ? 'spend time on a hobby' : 'hang out in the living room'}?`, action: a });
  };

  // input
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (confirm || (e.target as HTMLElement)?.closest('input,textarea,select,[role=dialog]')) return;
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) {
        keys.current.add(k);
        if (document.activeElement === canvasRef.current) e.preventDefault();
      }
      if ((k === 'e' || k === 'enter') && document.activeElement === canvasRef.current) {
        const p = nearestInteraction();
        if (p) p.run();
      }
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  });

  // render loop
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let stepCd = 0;
    let lastPrompt = '';
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const c = canvasRef.current;
      if (!c || !view) {
        raf = requestAnimationFrame(loop);
        return;
      }
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      // player movement (tile steps)
      const me = actors.current.get(view.playerId);
      stepCd -= dt;
      if (me && stepCd <= 0 && Math.abs(me.x - me.tx) < 0.01 && Math.abs(me.y - me.ty) < 0.01) {
        const k = keys.current;
        let dx = 0;
        let dy = 0;
        if (k.has('arrowup') || k.has('w')) [dy, me.dir] = [-1, 'up'];
        else if (k.has('arrowdown') || k.has('s')) [dy, me.dir] = [1, 'down'];
        else if (k.has('arrowleft') || k.has('a')) [dx, me.dir] = [-1, 'left'];
        else if (k.has('arrowright') || k.has('d')) [dx, me.dir] = [1, 'right'];
        if (dx || dy) {
          const occupied = [...actors.current.values()].some((a) => a.id !== me.id && Math.round(a.tx) === me.tx + dx && Math.round(a.ty) === me.ty + dy);
          if (!occupied && passable(me.tx, me.ty, me.tx + dx, me.ty + dy, solid)) {
            me.tx += dx;
            me.ty += dy;
          }
          stepCd = 0.13;
        }
      }
      ctx.drawImage(base, 0, 0);
      const list = [...actors.current.values()].sort((a, b) => a.y - b.y);
      for (const a of list) {
        const speed = a.id === view.playerId ? 7.5 : 3;
        const ddx = a.tx - a.x;
        const ddy = a.ty - a.y;
        const dist = Math.hypot(ddx, ddy);
        if (dist > 0.01) {
          const st = Math.min(dist, speed * dt);
          a.x += (ddx / dist) * st;
          a.y += (ddy / dist) * st;
          if (a.id !== view.playerId) a.dir = Math.abs(ddx) > Math.abs(ddy) ? (ddx > 0 ? 'right' : 'left') : ddy > 0 ? 'down' : 'up';
          a.moving += dt;
        } else {
          a.x = a.tx;
          a.y = a.ty;
          a.moving = 0;
        }
        const ch = byId[a.id];
        if (!ch) continue;
        const frame = a.moving > 0 ? (Math.floor(a.moving * 8) % 2 ? 0 : 2) : 1;
        const bob = a.moving === 0 && Math.floor(t / 600 + a.x) % 2 === 0 ? 1 : 0;
        const X = Math.round(a.x * TILE);
        const Y = Math.round(a.y * TILE) - 6 - bob;
        ctx.fillStyle = 'rgba(58,46,63,0.25)';
        ctx.fillRect(X + 3, Math.round(a.y * TILE) + 12, 10, 3);
        ctx.drawImage(sprite(a.id, ch.appearance, a.dir, frame), X, Y);
        if (a.id === view.playerId) {
          ctx.fillStyle = '#e07a6a';
          ctx.fillRect(X + 7, Y - 4, 2, 2);
        }
      }
      ctx.fillStyle = TINT[view.slot] ?? 'transparent';
      ctx.fillRect(0, 0, c.width, c.height);
      if (view.weather === 'rain' || view.weather === 'typhoon') {
        ctx.fillStyle = 'rgba(200,220,240,0.6)';
        for (let i = 0; i < 40; i++) {
          const rx = (i * 53 + t / 4) % (7 * TILE);
          const ry = (i * 37 + t / 2) % (6 * TILE);
          ctx.fillRect(21 * TILE + rx, ry, 1, 3);
        }
      }
      const p = nearestInteraction();
      const label = p?.label ?? '';
      if (label !== lastPrompt) {
        lastPrompt = label;
        setPrompt(p);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, base, solid, byId]);

  if (!view) return null;
  const [W, H] = houseSize();
  const npcsHere = chars.filter((c) => !c.isPlayer);
  const out = npcsHere.filter((c) => c.location === 'out');
  const doAct = (a: PlayerAction) => {
    setConfirm(null);
    void act(a);
  };

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="flex min-h-0 flex-1 gap-3 p-3">
        <div ref={wrapRef} className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden">
          <div className="relative" style={{ width: W * scale, height: H * scale }}>
            <canvas
              ref={canvasRef}
              width={W}
              height={H}
              tabIndex={0}
              aria-label="top-down view of the share house. use arrow keys or WASD to walk, E or Enter to interact."
              className="pixelated px-panel block"
              style={{ width: W * scale, height: H * scale }}
              autoFocus
            />
            {/* name + mood labels as DOM (crisp, readable, not colour-only) */}
            {[...actors.current.values()].map((a) => {
              const c = byId[a.id];
              if (!c || c.isPlayer) return null;
              const m = c.mood ? MOOD_ICON[c.mood] : null;
              return (
                <div key={a.id} className="pointer-events-none absolute -translate-x-1/2 text-center text-[0.65rem] leading-none" style={{ left: (a.tx * TILE + 8) * scale, top: (a.ty * TILE - 16) * scale - 4, transition: 'left 600ms linear, top 600ms linear' }}>
                  <span className="bg-paper/85 px-1" style={{ boxShadow: '0 0 0 1px var(--color-ink)' }}>
                    {m && <span style={{ color: m.color }} aria-hidden>{m.glyph} </span>}
                    {c.name.split(' ')[0]}
                  </span>
                </div>
              );
            })}
            {prompt && (
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 px-panel px-3 py-1 text-sm" aria-live="polite">
                <kbd>E</kbd> {prompt.label}
              </div>
            )}
            {toast && (
              <div className="absolute left-1/2 top-2 -translate-x-1/2 px-panel px-3 py-1 text-sm" role="status" onAnimationEnd={() => setToast(null)}>
                {toast}{' '}
                <button className="underline" onClick={() => setToast(null)}>
                  ok
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto scroll-thin pr-1">
          <Panel title={`${slotLabel(view.slot)} — what will you do?`}>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Btn disabled={busy} onClick={() => doAct({ type: 'house', activity: 'hangout' })}>hang out</Btn>
              <Btn disabled={busy} onClick={() => setScreen('cooking')}>cook</Btn>
              <Btn disabled={busy} onClick={() => doAct({ type: 'house', activity: 'rooftop' })}>rooftop</Btn>
              <Btn disabled={busy} onClick={() => doAct({ type: 'house', activity: 'tidy' })}>tidy up</Btn>
              <Btn disabled={busy} onClick={() => doAct({ type: 'house', activity: 'hobby' })}>hobby</Btn>
              <Btn disabled={busy} onClick={() => doAct({ type: 'house', activity: 'rest' })}>rest</Btn>
              <Btn disabled={busy || !daySlot || view.cityEvent?.id === 'typhoon'} onClick={() => setScreen('map')} title={daySlot ? 'go out into the city' : 'only during the day'}>
                go out
              </Btn>
              <Btn disabled={busy} onClick={() => doAct({ type: 'idle' })}>let time pass</Btn>
            </div>
            {view.canGraduate && (
              <div className="mt-3">
                <Btn primary onClick={() => setConfirm({ title: `leave the house with ${byId[view.canGraduate!]?.name.split(' ')[0]}? (ends your season)`, action: { type: 'graduate', with: view.canGraduate! } })}>
                  graduate together
                </Btn>
              </div>
            )}
          </Panel>
          <Panel title="who's where">
            <ul className="flex flex-col gap-2 text-sm">
              {npcsHere.map((c) => (
                <WhoRow key={c.id} c={c} onTalk={() => setConfirm({ title: `talk to ${c.name.split(' ')[0]}?`, action: { type: 'talk', target: c.id } })} disabled={busy || c.location === 'out' || !c.location} />
              ))}
            </ul>
            {out.length > 0 && <p className="caption mt-2 text-xs">{out.length} out of the house right now.</p>}
          </Panel>
          {view.previously && (
            <Panel soft title="previously">
              <p className="text-xs">{view.previously}</p>
            </Panel>
          )}
        </div>
      </main>
      <StudioStrip />
      <DigestModal />
      {confirm && (
        <Modal title={confirm.title} onClose={() => setConfirm(null)}>
          <p className="caption mb-4 text-sm">this uses the {slotLabel(view.slot)} slot.</p>
          <div className="flex gap-3">
            <Btn primary autoFocus onClick={() => doAct(confirm.action)}>
              yes
            </Btn>
            <Btn onClick={() => setConfirm(null)}>not yet</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

function WhoRow({ c, onTalk, disabled }: { c: CharView; onTalk: () => void; disabled: boolean }) {
  const m = c.mood ? MOOD_ICON[c.mood] : null;
  return (
    <li className="flex items-center gap-2">
      <div className="shrink-0" style={{ width: 36 }}>
        <Portrait charId={c.id} appearance={c.appearance} gender={c.gender} seed={c.portraitSeed} size={36} label={c.name} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate">
          {c.name.split(' ')[0]}
          {c.isNew && <span className="caption ml-1 text-xs">new</span>}
          {c.leaving && <span className="caption ml-1 text-xs">leaving</span>}
        </div>
        <div className="caption text-xs">
          {c.location === 'out' ? 'out' : c.location ? roomName(c.location) : '?'}
          {c.mood && (
            <>
              {' · '}
              <span style={{ color: m?.color }} aria-hidden>{m?.glyph}</span> {c.mood}
            </>
          )}
        </div>
      </div>
      <button className="px-btn text-xs" onClick={onTalk} disabled={disabled}>
        talk
      </button>
    </li>
  );
}

export const roomOf = roomAt;
