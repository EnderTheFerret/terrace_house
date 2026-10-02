// House: top-down pixel view of the share house. Walk with arrows/WASD, E/Enter to interact.
// A full keyboard-accessible action list mirrors everything the map offers.
import { useEffect, useMemo, useRef, useState } from 'react';
import { content, ROOMS, placeName, roomName, shiftToday, type CharView, type PlayerAction, type PlayerView } from '@shared-roof/shared';
import { useGame } from '../store';
import { TopBar, StudioStrip, DigestModal, slotLabel } from '../components/layout';
import { Btn, Modal, Panel } from '../components/ui';
import { hotspots, houseSize, passable, renderHouse, roomAt, solidTiles, spotFor, TILE } from '../pixel/house';
import { emote, MOOD_ICON, sprite, useCharacterSprites } from '../pixel/sprites';
import { Portrait } from '../components/pixel';
import { api } from '../api';
import { ambience } from '../audio';

type Dir = 'down' | 'up' | 'left' | 'right';
interface Actor {
  id: string;
  x: number;
  y: number;
  tx: number;
  ty: number;
  dir: Dir;
  moving: number;
  floor: number;
  transfer?: { floor: number; x: number; y: number; tx: number; ty: number };
  finishingStairs?: boolean;
}

function takeStairs(a: Actor, nextFloor: number, destination: [number, number]) {
  const exit = hotspots(a.floor).find(h => h.action.startsWith('stairs'))!;
  const entry = hotspots(nextFloor).find(h => h.action.startsWith('stairs'))!;
  a.tx = exit.x;
  a.ty = exit.y;
  a.transfer = { floor: nextFloor, x: entry.x, y: entry.y - 1, tx: destination[0], ty: destination[1] };
}

const clockTint = (clock: string) => {
  const [h, m] = clock.split(':').map(Number);
  const hour = h + m / 60;
  return hour < 6 || hour >= 20 ? 'rgba(30,30,80,0.35)' : hour >= 16 ? `rgba(255,140,80,${((hour - 16) / 4) * 0.24})` : hour < 10 ? 'rgba(255,214,170,0.10)' : 'rgba(0,0,0,0)';
};

function drawHouseLife(ctx: CanvasRenderingContext2D, house: PlayerView['house'], floor: number, clock: string) {
  const furn = content().house.furniture.filter((f) => f.floor === floor);
  const sink = furn.find((f) => f.type === 'sink');
  if (sink) for (let i = 0; i < Math.ceil(house.dishes / 15); i++) { ctx.fillStyle = i % 2 ? '#f5f0df' : '#9fd3e6'; ctx.fillRect(sink.x * TILE + 3, sink.y * TILE + 13 - i * 2, 10, 2); }
  const room = content().house.rooms.find((r) => r.floor === floor && r.id === (floor ? 'bathroom' : 'living'));
  if (room) for (let i = 0; i < Math.ceil(house.laundry / 20); i++) { ctx.fillStyle = ['#c9b4ef', '#e07a6a', '#9fd3e6'][i % 3]; ctx.fillRect((room.x + 1) * TILE + (i % 3) * 3, (room.y + room.h - 2) * TILE - Math.floor(i / 3) * 3, 6, 4); }
  const fridge = furn.find((f) => f.type === 'fridge');
  if (fridge) {
    ctx.fillStyle = '#f6d48f'; ctx.fillRect(fridge.x * TILE + 3, fridge.y * TILE + 8, 8, 10);
    const stock = Object.values(house.fridge).reduce((sum, n) => sum + n, 0);
    for (let i = 0; i < Math.min(6, stock); i++) { ctx.fillStyle = ['#5fa86b', '#e07a6a', '#fffaf3'][i % 3]; ctx.fillRect(fridge.x * TILE + 4 + (i % 3) * 2, fridge.y * TILE + 10 + Math.floor(i / 3) * 4, 2, 3); }
    for (let i = 0; i < Math.ceil(house.trash / 25); i++) { ctx.fillStyle = '#6a6a76'; ctx.fillRect((fridge.x - 1) * TILE + i * 3, (fridge.y + 2) * TILE, 5, 5); }
  }
  if (Number(clock.split(':')[0]) >= 19 || Number(clock.split(':')[0]) < 6) for (const f of furn.filter((f) => ['sofa', 'diningtable', 'bench'].includes(f.type))) {
    ctx.fillStyle = 'rgba(255,220,130,0.14)'; ctx.fillRect((f.x - 1) * TILE, (f.y - 1) * TILE, (f.w + 2) * TILE, (f.h + 2) * TILE);
  }
}

export function House() {
  const { view, act, busy, setScreen, settings, setView } = useGame();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(2);
  const [prompt, setPrompt] = useState<{ label: string; run: () => void } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; action: PlayerAction } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [, setPlaced] = useState(0);
  const [floor, setFloor] = useState(0);
  const [walking, setWalking] = useState(false);
  const [balcony, setBalcony] = useState('');
  const [invite, setInvite] = useState('');
  const base = useMemo(() => renderHouse(floor), [floor]);
  const solid = useMemo(() => solidTiles(floor), [floor]);
  const actors = useRef<Map<string, Actor>>(new Map());
  const doorAngles = useRef<Map<string, number>>(new Map());
  const keys = useRef<Set<string>>(new Set());
  const daySlot = !!view && view.slot !== 'morning';

  const chars = useMemo(() => (view ? view.characters.filter((c) => c.status === 'inHouse') : []), [view]);
  const byId = useMemo(() => Object.fromEntries(chars.map((c) => [c.id, c])), [chars]);
  useCharacterSprites(chars);
  const currentRoom = view?.playerLocation;
  const weather = view?.weather;
  const music = chars.some((c) => c.location === 'living' && c.activity === 'hobby');
  useEffect(() => {
    if (!currentRoom || !weather || !settings.sound) return;
    return ambience(currentRoom, weather, music);
  }, [currentRoom, weather, settings.sound, music]);

  const visit = async (room: string, destinationFloor = floor, invitation?: string, position?: [number, number]) => {
    if (walking || busy || !view) return;
    setWalking(true);
    keys.current.clear();
    let traversing = false;
    try {
      const r = await api.act({ type: 'visit', room, invite: invitation });
      const a = actors.current.get(view.playerId);
      if (a) {
        const [x, y] = position ?? spotFor(room, 0);
        if (destinationFloor !== a.floor && !settings.reducedMotion) { takeStairs(a, destinationFloor, [x, y]); traversing = true; }
        else Object.assign(a, { x, y, tx: x, ty: y, floor: destinationFloor });
      }
      setView(r.view);
      if (!traversing) setFloor(destinationFloor);
      setBalcony('');
      setPlaced((n) => n + 1);
    } catch (e) { setToast((e as Error).message); }
    finally { if (!traversing) setWalking(false); }
  };
  const stairs = () => {
    const next = floor === 0 ? 1 : 0;
    const h = hotspots(next).find((h) => h.action.startsWith('stairs'));
    if (h) void visit(next === 1 ? 'stairsUp' : 'stairs', next, undefined, [h.x, h.y]);
  };

  // place actors from occupancy
  useEffect(() => {
    if (!view?.occupancy) return;
    const seen = new Set<string>();
    for (const room of ROOMS) {
      (view.occupancy[room] ?? []).forEach((id, i) => {
        seen.add(id);
        const [sx, sy] = spotFor(room, i);
        const a = actors.current.get(id);
        const level = content().house.rooms.find((r) => r.id === room)?.floor ?? 0;
        if (!a) { actors.current.set(id, { id, x: sx, y: sy, tx: sx, ty: sy, dir: 'down', moving: 0, floor: level }); if (id === view.playerId) setFloor(level); }
        else if (id !== view.playerId) {
          if (a.transfer?.floor === level) Object.assign(a.transfer, { tx: sx, ty: sy });
          else if (level !== a.floor && !settings.reducedMotion) takeStairs(a, level, [sx, sy]);
          else { delete a.transfer; Object.assign(a, { tx: sx, ty: sy, floor: level }); }
        }
        else if (room !== roomAt(a.tx, a.ty, a.floor) && !room.startsWith('stairs')) {
          delete a.transfer; delete a.finishingStairs;
          Object.assign(a, { x: sx, y: sy, tx: sx, ty: sy, floor: level }); setFloor(level); setWalking(false);
        }
      });
    }
    for (const id of [...actors.current.keys()]) if (!seen.has(id)) actors.current.delete(id);
    setPlaced((n) => n + 1); // re-render DOM labels
  }, [view, settings.reducedMotion]);

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
      if (a.id === view.playerId || a.floor !== floor) continue;
      const d = Math.abs(Math.round(a.x) - px) + Math.abs(Math.round(a.y) - py);
      if (d <= 1) {
        const c = byId[a.id];
        if (c) return { label: `talk to ${c.name.split(' ')[0]}`, run: () => setConfirm({ title: `talk to ${c.name.split(' ')[0]}?`, action: { type: 'talk', target: c.id } }) };
      }
    }
    const h = hotspots(floor).find((h) => Math.abs(h.x - px) + Math.abs(h.y - py) <= 1);
    if (!h) return null;
    return { label: h.label, run: () => hotspotAction(h.action) };
  };

  const hotspotAction = (action: string) => {
    if (action.startsWith('stairs')) return stairs();
    if (action === 'fridge') return setScreen('fridge');
    if (action === 'cook') return setScreen('cooking');
    if (action === 'map') {
      if (!daySlot) return setToast('it is still early. the city opens later.');
      return setScreen('map');
    }
    const act2: Record<string, PlayerAction> = {
      hangout: { type: 'house', activity: 'hangout' },
      hobby: { type: 'house', activity: 'hobby' },
      tidy: { type: 'house', activity: 'tidy' },
      backyard: { type: 'house', activity: 'backyard' },
      rest: { type: 'house', activity: 'rest' },
    };
    const a = act2[action];
    if (a) setConfirm({ title: `${action === 'rest' ? 'rest for a while' : action === 'tidy' ? 'tidy up' : action === 'backyard' ? 'spend time in the backyard' : action === 'hobby' ? 'spend time on a hobby' : 'hang out in the living room'}?`, action: a });
  };

  // input
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (confirm || balcony || busy || walking || (e.target as HTMLElement)?.closest('input,textarea,select,[role=dialog]')) return;
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
    const blur = () => keys.current.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
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
      ctx.setTransform(2, 0, 0, 2, 0, 0);
      ctx.imageSmoothingEnabled = false;
      // player movement (tile steps)
      const me = actors.current.get(view.playerId);
      stepCd -= dt;
      if (me && !busy && !walking && !confirm && !balcony && stepCd <= 0 && Math.abs(me.x - me.tx) < 0.01 && Math.abs(me.y - me.ty) < 0.01) {
        const k = keys.current;
        let dx = 0;
        let dy = 0;
        if (k.has('arrowup') || k.has('w')) [dy, me.dir] = [-1, 'up'];
        else if (k.has('arrowdown') || k.has('s')) [dy, me.dir] = [1, 'down'];
        else if (k.has('arrowleft') || k.has('a')) [dx, me.dir] = [-1, 'left'];
        else if (k.has('arrowright') || k.has('d')) [dx, me.dir] = [1, 'right'];
        if (dx || dy) {
          const occupied = [...actors.current.values()].some((a) => a.id !== me.id && a.floor === floor && Math.round(a.tx) === me.tx + dx && Math.round(a.ty) === me.ty + dy);
          if (!occupied && passable(me.tx, me.ty, me.tx + dx, me.ty + dy, solid, floor)) {
            const room = roomAt(me.tx + dx, me.ty + dy, floor);
            if (room && room !== roomAt(me.tx, me.ty, floor)) {
              if (room.startsWith('balcony')) { setBalcony(room); keys.current.clear(); }
              else void visit(room, floor, undefined, [me.tx + dx, me.ty + dy]);
            } else { me.tx += dx; me.ty += dy; }
          }
          stepCd = 0.13;
        }
      }
      ctx.drawImage(base, 0, 0);
      drawHouseLife(ctx, view.house, floor, view.clock);
      for (const [x, y, level] of content().house.doors) {
        if (level !== floor) continue;
        const horizontal = roomAt(x, y, floor) !== roomAt(x, y - 1, floor);
        const dx = x + (horizontal ? 0.5 : 0), dy = y + (horizontal ? 0 : 0.5);
        const near = [...actors.current.values()].some(a => a.floor === floor && Math.hypot(a.x + 0.5 - dx, a.y + 0.5 - dy) < 1.3);
        const key = `${floor}:${x},${y}`;
        const before = doorAngles.current.get(key) ?? 0;
        const angle = settings.reducedMotion ? Number(near) : Math.max(0, Math.min(1, before + (near ? 1 : -1) * dt * 6));
        doorAngles.current.set(key, angle);
        const length = Math.round(TILE * (1 - angle));
        ctx.fillStyle = '#8a5c38';
        ctx.fillRect(x * TILE, y * TILE, horizontal ? length : 3, horizontal ? 3 : length);
        ctx.fillRect(x * TILE, y * TILE, horizontal ? 3 : TILE - length, horizontal ? TILE - length : 3);
      }
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
          if (a.transfer) {
            Object.assign(a, a.transfer);
            delete a.transfer;
            if (a.id === view.playerId) { a.finishingStairs = true; setFloor(a.floor); }
            setPlaced(n => n + 1);
          } else if (a.finishingStairs) {
            delete a.finishingStairs;
            setWalking(false);
          }
        }
        if (a.floor !== floor) continue;
        const ch = byId[a.id];
        if (!ch) continue;
        const frame = a.moving > 0 ? (Math.floor(a.moving * 8) % 2 ? 0 : 2) : 1;
        const bob = a.moving === 0 && Math.floor(t / 600 + a.x) % 2 === 0 ? 1 : 0;
        const X = Math.round(a.x * TILE);
        const Y = Math.round(a.y * TILE) - 6 - bob;
        ctx.fillStyle = 'rgba(58,46,63,0.25)';
        ctx.fillRect(X + 3, Math.round(a.y * TILE) + 12, 10, 3);
        ctx.drawImage(sprite(a.id, ch.appearance, a.dir, frame, ch.portraitSeed, ch.appearanceText), X, Y, 16, 20);
        const em = a.moving === 0 ? emote(ch.activity) : null;
        if (em) ctx.drawImage(em, X + 11, Y - 3 - (Math.floor(t / 500) % 2));
        if (a.id === view.playerId) {
          ctx.fillStyle = '#e07a6a';
          ctx.fillRect(X + 7, Y - 4, 2, 2);
        }
      }
      ctx.fillStyle = clockTint(view.clock);
      ctx.fillRect(0, 0, c.width, c.height);
      if (view.weather === 'rain') {
        ctx.fillStyle = 'rgba(200,220,240,0.6)';
        for (let i = 0; i < 40; i++) {
          const rx = (i * 53 + t / 4) % (7 * TILE);
          const ry = (i * 37 + t / 2) % (6 * TILE);
          const outside = content().house.rooms.find((r) => r.floor === floor && (r.id === 'backyard' || r.id.startsWith('balcony')));
          if (outside) ctx.fillRect(outside.x * TILE + rx % (outside.w * TILE), outside.y * TILE + ry % (outside.h * TILE), 1, 3);
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
  }, [view, base, solid, byId, floor, walking, busy, confirm, balcony, settings.reducedMotion]);

  if (!view) return null;
  const [W, H] = houseSize();
  const npcsHere = chars.filter((c) => !c.isPlayer);
  const out = npcsHere.filter((c) => c.location === 'out');
  const doAct = (a: PlayerAction) => {
    if (walking || busy) return;
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
              width={W * 2}
              height={H * 2}
              tabIndex={0}
              aria-label="top-down view of the share house. use arrow keys or WASD to walk, E or Enter to interact."
              className="pixelated px-panel block"
              style={{ width: W * scale, height: H * scale }}
              autoFocus
            />
            {/* name + mood labels as DOM (crisp, readable, not colour-only) */}
            {[...actors.current.values()].map((a) => {
              const c = byId[a.id];
              if (!c || c.isPlayer || a.floor !== floor) return null;
              const m = c.mood ? MOOD_ICON[c.mood] : null;
              return (
                <div key={a.id} className="pointer-events-none absolute -translate-x-1/2 text-center text-[0.65rem] leading-none" style={{ left: (a.tx * TILE + 8) * scale, top: (a.ty * TILE - 16) * scale - 4, transition: 'left 600ms linear, top 600ms linear' }}>
                  <span className="bg-paper/85 px-1" style={{ boxShadow: '0 0 0 1px var(--color-ink)' }}>
                    {m && <span style={{ color: m.color }} aria-hidden>{m.glyph} </span>}
                    {c.name.split(' ')[0]}
                  </span>
                  {c.bark && <span className="mt-1 block max-w-40 bg-paper px-2 py-1 text-xs leading-tight">{c.bark}</span>}
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
          <Panel title="your life in the house"><p className="text-sm">{view.goals.short}</p><p className="caption mt-1 text-xs">long term: {view.goals.long}</p>{view.goals.career && <p className="mt-2 text-xs">work: {view.goals.career.title} · {view.goals.career.completed ? 'resolved' : `chapter ${view.goals.career.act + 1}`}</p>}</Panel>
          <Panel title={floor === 0 ? 'ground floor' : 'upstairs'}>
            <Btn disabled={busy || walking} onClick={stairs}>{floor === 0 ? 'take stairs upstairs' : 'take stairs downstairs'}</Btn>
            <div className="mt-2 flex flex-wrap gap-2">{content().house.rooms.filter((r) => r.id.startsWith('balcony')).map((r) => <Btn key={r.id} disabled={busy || walking} onClick={() => { setBalcony(r.id); setInvite(''); }}>{r.name}</Btn>)}</div>
            <p className="caption mt-2 text-xs">Balconies belong to their bedrooms. Ask a roommate to invite you.</p>
          </Panel>
          {view.approaches.map((a) => <Panel key={a.id} title={byId[a.from]?.name.split(' ')[0] ?? a.from}><p className="mb-2 text-sm">{a.text}</p><div className="flex gap-2"><Btn disabled={busy || walking} onClick={() => doAct({ type: 'approach', id: a.id, accept: true })}>got a minute</Btn><Btn disabled={busy || walking} onClick={() => doAct({ type: 'approach', id: a.id, accept: false })}>not now</Btn></div></Panel>)}
          <Panel title={`${slotLabel(view.slot)} ${view.clock} — what will you do?`}>
            <p className="caption mb-2 text-xs">{view.minutesLeft} min left in this block. talking lasts as long as the conversation; going out, resting or letting time pass ends the block.</p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Btn disabled={busy || walking} onClick={() => doAct({ type: 'house', activity: 'hangout' })}>hang out</Btn>
              <Btn disabled={busy || walking} onClick={() => setScreen('cooking')}>cook</Btn>
              <Btn disabled={busy || walking} onClick={() => doAct({ type: 'house', activity: 'backyard' })}>backyard</Btn>
              <Btn disabled={busy || walking} onClick={() => doAct({ type: 'house', activity: 'tidy' })}>tidy up</Btn>
              <Btn disabled={busy || walking} onClick={() => doAct({ type: 'house', activity: 'hobby' })}>hobby</Btn>
              <Btn disabled={busy || walking} onClick={() => doAct({ type: 'house', activity: 'rest' })}>rest</Btn>
              <Btn disabled={busy || walking || !daySlot} onClick={() => setScreen('map')} title={daySlot ? 'go out into the city' : 'the city opens later'}>
                go out
              </Btn>
              <Btn disabled={busy || walking} onClick={() => doAct({ type: 'idle' })}>let time pass</Btn>
              <Btn disabled={busy || walking} onClick={() => doAct({ type: 'skip' })}>skip to next block</Btn>
              <Btn disabled={busy || walking} onClick={() => setConfirm({ title: 'sleep until morning? (plans and shifts still happen)', action: { type: 'sleep' } })}>sleep until morning</Btn>
            </div>
            {shiftToday(view.job, view.weekday, view.slot) && (
              <p className="mt-3 text-sm" role="status">
                ⚑ you have a shift at {placeName(view.job!.nodeId)} now. skipping it twice gets you let go.
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {view.canGraduate && byId[view.canGraduate] && (
                <Btn primary disabled={busy || walking} onClick={() => setConfirm({ title: `leave the house with ${byId[view.canGraduate!].name.split(' ')[0]}? (you'll create the next housemate who moves in)`, action: { type: 'graduate', with: view.canGraduate! } })}>
                  graduate together
                </Btn>
              )}
              {(() => {
                const partner = chars.find((c) => !c.isPlayer && c.partner === view.playerId);
                return partner && partner.id !== view.canGraduate ? (
                  <Btn disabled={busy || walking} onClick={() => setConfirm({ title: `leave the house with ${partner.name.split(' ')[0]}? (you'll create the next housemate who moves in)`, action: { type: 'graduate', with: partner.id } })}>leave with {partner.name.split(' ')[0]}</Btn>
                ) : null;
              })()}
              <Btn disabled={busy || walking} onClick={() => setConfirm({ title: 'graduate from the house alone? (your farewell happens now; then you create the next housemate who moves in)', action: { type: 'graduate' } })}>leave the house</Btn>
              <Btn disabled={busy || walking || view.episode < 3 || !!view.finaleEpisode} onClick={() => setConfirm({ title: 'announce the final episode? everyone gets one last chance before the season wraps.', action: { type: 'endSeason' } })}>{view.finaleEpisode ? 'finale announced' : 'wrap the season'}</Btn>
            </div>
          </Panel>
          <Panel title="who's where">
            <ul className="flex flex-col gap-2 text-sm">
              {npcsHere.map((c) => (
                <WhoRow key={c.id} c={c} onTalk={() => setConfirm({ title: `talk to ${c.name.split(' ')[0]}?`, action: { type: 'talk', target: c.id } })} disabled={busy || walking || c.location === 'out' || !c.location} />
              ))}
            </ul>
            {out.length > 0 && <p className="caption mt-2 text-xs">{out.length} out of the house right now.</p>}
          </Panel>
          <Panel title="today's timeline"><ol className="flex flex-col gap-1 text-xs">{view.timeline.filter((t) => t.episode === view.episode).map((t, i) => <li key={i}><span className="caption">{t.clock}</span> {t.text}</li>)}</ol><Btn className="mt-2 text-xs" onClick={() => setScreen('phone')}>shared plans & phone</Btn></Panel>
          {view.previously && (
            <Panel soft title="previously">
              <p className="text-xs">{view.previously}</p>
            </Panel>
          )}
        </div>
      </main>
      <StudioStrip />
      <DigestModal />
      {view.awaitingPlayer && (
        <Modal title="you graduated from the house">
          <p className="mb-4 text-sm">the season goes on without you. someone new is about to ring the doorbell — and this time it's you again.</p>
          <Btn primary autoFocus onClick={() => setScreen('creator')}>
            create your next housemate
          </Btn>
        </Modal>
      )}
      {confirm && (
        <Modal title={confirm.title} onClose={() => setConfirm(null)}>
          <p className="caption mb-4 text-sm">{confirm.action.type === 'talk' ? 'this takes as long as you talk.' : confirm.action.type === 'endSeason' ? 'The next episode is the finale. This choice is saved.' : confirm.action.type === 'sleep' ? 'Advance through the night to the next morning.' : `this takes time in the ${slotLabel(view.slot)}.`}</p>
          <div className="flex gap-3">
            <Btn primary autoFocus disabled={busy || walking} onClick={() => doAct(confirm.action)}>
              yes
            </Btn>
            <Btn onClick={() => setConfirm(null)}>not yet</Btn>
          </div>
        </Modal>
      )}
      {balcony && <Modal title={`visit ${roomName(balcony)}?`} onClose={() => setBalcony('')}>
        <label className="mb-3 flex flex-col gap-1 text-sm">invited by
          <select aria-label="balcony invitation" className="px-panel-soft px-2 py-1" value={invite} onChange={(e) => setInvite(e.target.value)}><option value="">on my own</option>{chars.filter((c) => !c.isPlayer && view.invitations.some((p) => p.node === balcony && p.episode === view.episode && p.slot === view.slot && p.status === 'accepted' && [p.from, p.to].includes(c.id) && [p.from, p.to].includes(view.playerId))).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </label>
        <p className="caption mb-3 text-xs">Your own balcony is open to you. For another bedroom's balcony, arrange a shared plan on the phone and come at the agreed time.</p>
        <div className="flex gap-2"><Btn primary disabled={busy || walking} onClick={() => void visit(balcony, 1, invite || undefined)}>visit balcony</Btn><Btn onClick={() => setBalcony('')}>cancel</Btn></div>
      </Modal>}
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
          {c.location === 'out' ? 'out' : c.location ? roomName(c.location) : '?'}{c.floor !== null && c.floor !== undefined ? ` · ${c.floor === 0 ? 'ground floor' : 'upstairs'}` : ''}
          {c.activity ? ` · ${c.activity}` : ''}
          {c.mood && (
            <>
              {' · '}
              <span style={{ color: m?.color }} aria-hidden>{m?.glyph}</span> {c.mood}
            </>
          )}
        </div>
      </div>
      <button className="px-btn text-xs" onClick={onTalk} disabled={disabled} aria-label={`talk to ${c.name.split(' ')[0]}`}>
        talk
      </button>
    </li>
  );
}

export const roomOf = roomAt;
