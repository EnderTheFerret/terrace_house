// House: top-down pixel view of the share house. Walk with arrows/WASD, E/Enter to interact.
// A full keyboard-accessible action list mirrors everything the map offers.
import { Tip } from '../components/Tip';
import { useEffect, useMemo, useRef, useState } from 'react';
import { classToday, clockLabel, content, HOUSEHOLD, HOUSEHOLD_ACTIVITIES, priceLabel, ROOMS, SLOTS, placeName, roomName, shiftToday, TRIPS, type HouseholdActivity, type CharView, type PlayerAction, type PlayerView, type Room } from '@shared-roof/shared';
import { useGame } from '../store';
import { TopBar, StudioStrip, DigestModal, slotLabel } from '../components/layout';
import { Btn, Modal, Panel } from '../components/ui';
import { conversationPlaces, facing, drawLighting, drawWater, drawWeather, findPath, hotspots, houseSize, loadHouseAssets, passable, poolPlaces, renderHouse, roomAt, seatFor, solidTiles, spotFor, swimSolids, withinPoolWater, TILE, type Seat } from '../pixel/house';
import { emote, MOOD_ICON, posedSprite, sprite } from '../pixel/sprites';
import { Portrait } from '../components/pixel';
import { api } from '../api';
import { ambience } from '../audio';
import { useWorldClock } from '../useWorldClock';

type Dir = 'down' | 'up' | 'left' | 'right';
const PLAYER_WALK_SPEED = 3.5;
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
  /** furniture pose taken on arrival (sofa, bed, stove, table) */
  seat?: Seat;
  /** remaining tile steps to (tx, ty), and which goal they were planned for */
  path?: [number, number][];
  pathFor?: string;
  departing?: boolean;
  goingPrivate?: boolean;
  talkingTo?: string;
  companion?: string;
  /** when an idle housemate next strolls to another spot in their room (animation clock, ms) */
  idleAt?: number;
}

function takeStairs(a: Actor, nextFloor: number, destination: [number, number]) {
  const exit = hotspots(a.floor).find(h => h.action.startsWith('stairs'))!;
  const entry = hotspots(nextFloor).find(h => h.action.startsWith('stairs'))!;
  a.tx = exit.x;
  a.ty = exit.y;
  a.transfer = { floor: nextFloor, x: entry.x, y: entry.y - 1, tx: destination[0], ty: destination[1] };
}

function drawHouseLife(ctx: CanvasRenderingContext2D, house: PlayerView['house'], floor: number) {
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
}

export function House() {
  const { view, act, busy, setScreen, settings, setView, resume, spendUntil } = useGame();
  const unfinished = useGame((st) => st.scenes.some((x) => x.rendered && x.phase !== 'done'));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(3);
  const [zoom, setZoom] = useState(() => (window.innerWidth < 768 ? 0.5 : 1)); // phones start zoomed out
  const [prompt, setPrompt] = useState<{ label: string; run: () => void } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; action: PlayerAction } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [, setPlaced] = useState(0);
  const [floor, setFloor] = useState(0);
  const [walking, setWalking] = useState(false);
  const [balcony, setBalcony] = useState('');
  const [invite, setInvite] = useState('');
  const [meetingRoom, setMeetingRoom] = useState<Room>('kitchen');
  const [meetingGuest, setMeetingGuest] = useState('');
  const [meetingGuests, setMeetingGuests] = useState<string[]>([]);
  const [household, setHousehold] = useState<HouseholdActivity>('meal');
  const [householdGuest, setHouseholdGuest] = useState('');
  const [poolOpen, setPoolOpen] = useState(false);
  const [poolGuests, setPoolGuests] = useState<string[]>([]);
  const [assetsReady, setAssetsReady] = useState(false);
  useWorldClock(walking || !!confirm || !!balcony || poolOpen || unfinished);
  useEffect(() => { void loadHouseAssets().then(() => setAssetsReady(true)); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-render once the baked furniture has loaded
  const base = useMemo(() => renderHouse(floor), [floor, assetsReady]);
  const solid = useMemo(() => solidTiles(floor), [floor]);
  const solids = useMemo(() => [solidTiles(0), solidTiles(1)], []);
  const waterSolid = useMemo(() => swimSolids(0), []);
  const actors = useRef<Map<string, Actor>>(new Map());
  const labels = useRef<Map<string, HTMLDivElement>>(new Map());
  const previousLocations = useRef<Map<string, string | null>>(new Map());
  const previousDoorways = useRef<Map<string, { x: number; y: number; floor: number }>>(new Map());
  const doorAngles = useRef<Map<string, number>>(new Map());
  const keys = useRef<Set<string>>(new Set());

  const chars = useMemo(() => (view ? view.characters.filter((c) => c.status === 'inHouse') : []), [view]);
  const byId = useMemo(() => Object.fromEntries(chars.map((c) => [c.id, c])), [chars]);
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
    useGame.setState({ busy: true });
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
    finally { useGame.setState({ busy: false }); if (!traversing) setWalking(false); }
  };
  /** The other bedroom is closed: knock, and go in only if someone inside answers and lets you in. */
  const knockOn = async (room: string, position: [number, number]) => {
    if (walking || busy || !view) return;
    setWalking(true);
    setToast(`knock knock… (${roomName(room)})`);
    useGame.setState({ busy: true });
    try {
      const r = await api.act({ type: 'visit', room, knock: true });
      const a = actors.current.get(view.playerId);
      if (r.view.playerLocation === room && a) Object.assign(a, { tx: position[0], ty: position[1] });
      setView(r.view);
      setToast(r.view.playerLocation === room ? 'come in.' : (r.view.log.at(-1)?.text ?? 'no answer.'));
    } catch (e) { setToast((e as Error).message); }
    finally { useGame.setState({ busy: false }); setWalking(false); }
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
      const taken = new Set<string>();
      const player = actors.current.get(view.playerId);
      const people = view.characters.filter(c => view.occupancy?.[room]?.includes(c.id));
      const reserved = new Set<string>(player && roomAt(player.tx, player.ty, player.floor) === room ? [`${player.tx},${player.ty}`] : []);
      const conversation = conversationPlaces(room, people, reserved);
      const swimIds = (view.occupancy[room] ?? []).filter(id => view.characters.find(c => c.id === id)?.swimming);
      const swimPlaces = poolPlaces(swimIds, view.playerId, player?.seat?.pose === 'swim' ? [player.tx, player.ty] : undefined);
      (view.occupancy[room] ?? []).forEach((id, i) => {
        seen.add(id);
        const activity = view.characters.find((c) => c.id === id)?.activity ?? null;
        const swimming = view.characters.find(c => c.id === id)?.swimming;
        let n = 0;
        let seat = swimming ? swimPlaces.get(id) : id === view.playerId ? null : seatFor(room, activity, n);
        while (seat && taken.has(`${seat.x},${seat.y}`)) seat = seatFor(room, activity, ++n);
        let [sx, sy] = seat ? [seat.x, seat.y] : spotFor(room, i);
        if (conversation.has(id)) { [sx, sy] = conversation.get(id)!; seat = null; }
        const spots = content().house.rooms.find(r => r.id === room)?.spots ?? [];
        if (!seat && !conversation.has(id) && (taken.has(`${sx},${sy}`) || reserved.has(`${sx},${sy}`))) [sx, sy] = spots.find(([x, y]) => !taken.has(`${x},${y}`) && !reserved.has(`${x},${y}`)) ?? [sx, sy];
        taken.add(`${sx},${sy}`);
        const a = actors.current.get(id);
        const changedSwimming = a && (a.seat?.pose === 'swim') !== !!swimming;
        if (a) { a.seat = seat ?? undefined; a.departing = false; a.goingPrivate = false; }
        const level = content().house.rooms.find((r) => r.id === room)?.floor ?? 0;
        if (!a) { actors.current.set(id, { id, x: sx, y: sy, tx: sx, ty: sy, dir: 'down', moving: 0, floor: level, seat: seat ?? undefined }); if (id === view.playerId) setFloor(level); }
        else if (changedSwimming) { delete a.transfer; delete a.path; delete a.pathFor; Object.assign(a, { x: sx, y: sy, tx: sx, ty: sy, floor: level }); if (id === view.playerId) { setFloor(level); setWalking(false); } }
        else if (id !== view.playerId) {
          if (a.transfer?.floor === level) Object.assign(a.transfer, { tx: sx, ty: sy });
          else if (level !== a.floor && !settings.reducedMotion) takeStairs(a, level, [sx, sy]);
          else { delete a.transfer; Object.assign(a, { tx: sx, ty: sy, floor: level }); }
        }
        else if (room !== roomAt(a.tx, a.ty, a.floor) && !room.startsWith('stairs')) {
          delete a.transfer; delete a.finishingStairs;
          Object.assign(a, { x: sx, y: sy, tx: sx, ty: sy, floor: level }); setFloor(level); setWalking(false);
        }
        const placed = actors.current.get(id)!;
        const ch = view.characters.find(c => c.id === id)!;
        placed.talkingTo = ch.talkingTo ?? people.find(c => c.talkingTo === id)?.id;
        placed.companion = ch.companion;
        if (!a && previousLocations.current.get(id) === 'out' && !settings.reducedMotion) {
          Object.assign(placed, { x: 1, y: 12, floor: 0 });
          if (level !== 0) takeStairs(placed, level, [sx, sy]);
        }
        else if (!a && previousLocations.current.has(id) && previousLocations.current.get(id) === null && !settings.reducedMotion) {
          const entry = previousDoorways.current.get(id);
          if (entry) {
            Object.assign(placed, { x: entry.x, y: entry.y, floor: entry.floor });
            if (level !== entry.floor) takeStairs(placed, level, [sx, sy]);
          }
        }
      });
    }
    for (const id of [...actors.current.keys()]) if (!seen.has(id)) {
      const a = actors.current.get(id)!;
      const c = view.characters.find(c => c.id === id);
      if (c?.location === 'out' && !settings.reducedMotion) {
        const exit: [number, number] = [c.companion && id > c.companion ? 2 : 1, 12];
        a.departing = true; a.seat = undefined; a.talkingTo = undefined; a.companion = c.companion;
        if (a.transfer?.floor === 0) Object.assign(a.transfer, { tx: exit[0], ty: exit[1] });
        else if (a.floor !== 0) takeStairs(a, 0, exit);
        else { delete a.transfer; a.tx = exit[0]; a.ty = exit[1]; }
      } else if (c?.status === 'inHouse' && c.location === null && !settings.reducedMotion) {
        const exit = c.doorway;
        if (!exit) { actors.current.delete(id); continue; }
        a.departing = true; a.goingPrivate = true; a.seat = undefined; a.talkingTo = undefined; a.companion = undefined;
        if (a.transfer?.floor === exit.floor) Object.assign(a.transfer, { tx: exit.x, ty: exit.y });
        else if (a.floor !== exit.floor) takeStairs(a, exit.floor, [exit.x, exit.y]);
        else { delete a.transfer; a.tx = exit.x; a.ty = exit.y; }
      } else actors.current.delete(id);
    }
    previousLocations.current = new Map(view.characters.map(c => [c.id, c.location]));
    previousDoorways.current = new Map(view.characters.filter(c => c.doorway).map(c => [c.id, c.doorway!]));
    setPlaced((n) => n + 1); // re-render DOM labels
  }, [view, settings.reducedMotion]);

  // fit canvas
  useEffect(() => {
    const fit = () => {
      const el = wrapRef.current;
      if (!el) return;
      const [w, h] = houseSize();
      // Native furniture and characters share a 32px scale; the camera follows when the whole floor cannot fit.
      setScale(Math.max(3, Math.ceil(Math.max(el.clientWidth / w, el.clientHeight / h) * 2) / 2) * zoom);
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [zoom]);

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
    if (!h && byId[me.id]?.swimming) return { label: 'get everyone out of the pool', run: () => setConfirm({ title: 'end the swim and change back?', action: { type: 'pool', mode: 'leave' } }) };
    if (!h) return null;
    return { label: h.label, run: () => hotspotAction(h.action) };
  };

  const hotspotAction = (action: string) => {
    if (action === 'pool') { setPoolGuests([]); return setPoolOpen(true); }
    if (action.startsWith('stairs')) return stairs();
    if (action === 'fridge') return setScreen('fridge');
    if (action === 'cook') return setScreen('cooking');
    if (action === 'map') return setScreen('map');
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
      if (confirm || balcony || poolOpen || busy || walking || (e.target as HTMLElement)?.closest('input,textarea,select,[role=dialog]')) return;
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) {
        keys.current.add(k);
        if (document.activeElement === canvasRef.current) e.preventDefault();
      }
      // E works wherever focus is (after clicking a side button too); Enter only on the canvas, where it can't press a button
      if (k === 'e' || (k === 'enter' && document.activeElement === canvasRef.current)) {
        if (e.repeat) return; // holding E must not stack prompts
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
      if (me) { c.dataset.playerX = String(me.x); c.dataset.playerY = String(me.y); }
      stepCd -= dt;
      if (me && !busy && !walking && !confirm && !balcony && !poolOpen && stepCd <= 0 && Math.abs(me.x - me.tx) < 0.01 && Math.abs(me.y - me.ty) < 0.01) {
        const k = keys.current;
        let dx = 0;
        let dy = 0;
        if (k.has('arrowup') || k.has('w')) [dy, me.dir] = [-1, 'up'];
        else if (k.has('arrowdown') || k.has('s')) [dy, me.dir] = [1, 'down'];
        else if (k.has('arrowleft') || k.has('a')) [dx, me.dir] = [-1, 'left'];
        else if (k.has('arrowright') || k.has('d')) [dx, me.dir] = [1, 'right'];
        if (dx || dy) {
          const occupied = [...actors.current.values()].some((a) => a.id !== me.id && a.floor === floor && Math.round(a.tx) === me.tx + dx && Math.round(a.ty) === me.ty + dy);
          const swimming = byId[me.id]?.swimming;
          const withinWater = !swimming || withinPoolWater(me.tx + dx, me.ty + dy);
          if (!occupied && withinWater && passable(me.tx, me.ty, me.tx + dx, me.ty + dy, swimming ? waterSolid : solid, floor)) {
            const room = roomAt(me.tx + dx, me.ty + dy, floor);
            const own = view.characters.find((c) => c.id === view.playerId)?.gender === 'man' ? 'bedroomM' : 'bedroomW';
            if (room && room !== roomAt(me.tx, me.ty, floor)) {
              if (room.startsWith('balcony') && room !== own.replace('bedroom', 'balcony')) { setBalcony(room); keys.current.clear(); }
              else if (room.startsWith('bedroom') && room !== own) { keys.current.clear(); void knockOn(room, [me.tx + dx, me.ty + dy]); }
              else {
                // step through at once; the server catches up in the background (no input lock on every doorway)
                me.tx += dx; me.ty += dy;
                useGame.setState({ busy: true });
                void api.act({ type: 'visit', room }).then((r) => setView(r.view), (e: Error) => setToast(e.message)).finally(() => useGame.setState({ busy: false }));
              }
            } else { me.tx += dx; me.ty += dy; }
          }
          stepCd = 1 / PLAYER_WALK_SPEED;
        }
      }
      ctx.clearRect(0, 0, c.width / 2, c.height / 2);
      ctx.drawImage(base, 0, 0, base.width / 2, base.height / 2);
      drawWater(ctx, floor, settings.reducedMotion ? 0 : t);
      drawHouseLife(ctx, view.house, floor);
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
        const partner = a.companion && actors.current.get(a.companion);
        const ahead = partner && partner.floor === a.floor && Math.hypot(a.x - partner.x, a.y - partner.y) > 2 && Math.hypot(a.tx - a.x, a.ty - a.y) < Math.hypot(partner.tx - partner.x, partner.ty - partner.y);
        const speed = settings.reducedMotion ? 1000 : a.id === view.playerId ? PLAYER_WALK_SPEED : ahead ? 0 : 3;
        // housemates walk a tile path around furniture and through doors (the player steps tile by tile already)
        let [gx, gy] = [a.tx, a.ty];
        let blocked = false;
        if (a.id !== view.playerId) {
          // the server only re-places people when their activity changes; in between, idle ones stroll around their room
          const ch = byId[a.id];
          const still = a.moving === 0 && Math.abs(a.x - a.tx) < 0.01 && Math.abs(a.y - a.ty) < 0.01;
          if (!still || !ch || ch.location === 'out' || ch.swimming || a.seat || a.transfer || a.departing || a.goingPrivate || a.finishingStairs || a.talkingTo || a.companion || settings.reducedMotion) a.idleAt = undefined;
          else if (a.idleAt === undefined) a.idleAt = t + 3000 + Math.random() * 7000;
          else if (t >= a.idleAt) {
            a.idleAt = undefined;
            const spots = (content().house.rooms.find((r) => r.id === roomAt(a.tx, a.ty, a.floor))?.spots ?? []).filter(([x, y]) => !(x === a.tx && y === a.ty) && ![...actors.current.values()].some((o) => o !== a && o.floor === a.floor && Math.round(o.tx) === x && Math.round(o.ty) === y));
            const spot = spots[Math.floor(Math.random() * spots.length)];
            if (spot) [a.tx, a.ty] = spot;
          }
          const goal = `${a.floor}:${a.tx},${a.ty}`;
          if (a.pathFor !== goal) { a.pathFor = goal; a.path = findPath([Math.round(a.x), Math.round(a.y)], [a.tx, a.ty], byId[a.id]?.swimming ? waterSolid : solids[a.floor] ?? solid, a.floor) ?? undefined; }
          while (a.path?.length && Math.hypot(a.path[0][0] - a.x, a.path[0][1] - a.y) < 0.01) a.path.shift();
          if (a.path?.length) [gx, gy] = a.path[0];
          else if (!a.path) { blocked = true; a.moving = 0; }
        }
        const ddx = gx - a.x;
        const ddy = gy - a.y;
        const dist = Math.hypot(ddx, ddy);
        if (dist > 0.01 && !blocked) {
          const st = Math.min(dist, speed * dt);
          a.x += (ddx / dist) * st;
          a.y += (ddy / dist) * st;
          if (a.id !== view.playerId) a.dir = Math.abs(ddx) > Math.abs(ddy) ? (ddx > 0 ? 'right' : 'left') : ddy > 0 ? 'down' : 'up';
          a.moving = st > 0 ? a.moving + dt : 0;
        } else if (!blocked) {
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
          } else if (a.departing) {
            actors.current.delete(a.id); setPlaced(n => n + 1); continue;
          }
        }
        const label = labels.current.get(a.id);
        if (label) {
          label.style.left = `${(a.x * TILE + TILE / 2) * scale}px`;
          label.style.top = `${(a.y * TILE + TILE - 48) * scale - 4}px`;
          label.dataset.moving = String(a.moving > 0);
        }
        if (a.floor !== floor) continue;
        const ch = byId[a.id];
        if (!ch) continue;
        const frame = a.moving > 0 ? [0, 1, 2, 1][Math.floor(a.moving * 8) % 4] : 1;
        const talkingPartner = a.talkingTo && actors.current.get(a.talkingTo);
        const talking = talkingPartner && !a.moving && !talkingPartner.moving && talkingPartner.floor === a.floor && Math.hypot(a.x - talkingPartner.x, a.y - talkingPartner.y) <= 2;
        if (talking) a.dir = facing([a.x, a.y], [talkingPartner.x, talkingPartner.y]);
        if (label) label.dataset.direction = a.dir;
        const talkLabel = label?.querySelector<HTMLElement>('[data-conversation]');
        if (talkLabel) talkLabel.textContent = `${talking ? 'talking with' : 'going to talk with'} ${byId[a.talkingTo!]?.name.split(' ')[0] ?? ''}`;
        const pose = ch.swimming ? { ...a.seat, pose: 'swim' as const, dir: a.dir } : a.moving === 0 && !talking ? a.seat : undefined;
        // idle breathing; the cook stirs faster
        const bob = a.moving === 0 && pose?.pose !== 'sleep' && Math.floor(t / (pose?.pose === 'cook' ? 220 : 600) + a.x) % 2 === 0 ? 1 : 0;
        // 32x40 frames at 1:1 (about 1.5 tiles tall, like a handheld overworld): centred on the tile, feet on its bottom edge
        const tx = Math.round(a.x * TILE), ty = Math.round(a.y * TILE);
        const bed = pose?.pose === 'sleep' ? content().house.furniture.find(f => f.type === 'bed' && f.floor === floor && f.x === a.tx && f.y === a.ty) : undefined;
        const X = tx + TILE / 2 - 16 + (bed ? (bed.w - 1) * TILE / 2 : 0);
        const Y = ty + TILE - 39 - bob + (pose?.pose === 'sleep' ? 18 : pose?.pose === 'swim' ? 16 : 0);
        const head = Y + 12; // top of the hair in a generated frame
        if (pose?.pose !== 'sleep' && pose?.pose !== 'swim') {
          ctx.fillStyle = 'rgba(58,46,63,0.25)';
          ctx.fillRect(tx + TILE / 2 - 7, ty + TILE - 3, 14, 3);
        }
        if (pose) a.dir = pose.dir;
        ctx.drawImage(pose ? posedSprite(ch, pose.pose, pose.dir) : sprite(ch, a.dir, frame), X, Y, 32, 40);
        if (ch.swimming) {
          ctx.fillStyle = 'rgba(106,213,220,0.45)'; ctx.fillRect(X + 4, Y + 27, 24, 5);
          ctx.fillStyle = 'rgba(216,255,247,0.65)'; ctx.fillRect(X, Y + 30, 32, 1); ctx.fillRect(X + 4, Y + 34, 24, 1);
        }
        if (pose?.pose === 'cook') for (let k = 0; k < 2; k++) { // steam off the pan
          const s = (t / 900 + k / 2) % 1;
          ctx.fillStyle = `rgba(255,255,255,${0.6 * (1 - s)})`;
          ctx.fillRect(tx + 4 + k * 6 + Math.round(Math.sin(t / 300 + k) * 1.5), ty - 18 - Math.round(s * 10), 2, 2);
        }
        const em = a.moving === 0 ? emote(ch.activity) : null;
        if (em) ctx.drawImage(em, tx + 13, head - 6 - (Math.floor(t / 500) % 2));
        if (talking && Math.floor(t / 1500) % 2 === (a.id < talkingPartner.id ? 0 : 1)) {
          ctx.fillStyle = '#fffaf3'; ctx.fillRect(tx + 8, head - 9, 15, 7);
          ctx.fillStyle = '#64556c'; for (let i = 0; i < 3; i++) ctx.fillRect(tx + 11 + i * 4, head - 6, 1, 1);
        }
        if (a.id === view.playerId) {
          ctx.fillStyle = '#e07a6a';
          ctx.fillRect(tx + TILE / 2 - 1, head - 5, 2, 2);
        }
      }
      // camera: keep the player centred when the zoomed house is bigger than the window (clamped to the house edges)
      const stage = stageRef.current, wrap = wrapRef.current;
      if (stage && wrap && me) {
        const [hw, hh2] = houseSize();
        const pan = (inner: number, outer: number, at: number) => (inner <= outer ? 0 : Math.max(-(inner - outer) / 2, Math.min((inner - outer) / 2, inner / 2 - at)));
        stage.style.transform = `translate(${pan(hw * scale, wrap.clientWidth, (me.x + 0.5) * TILE * scale)}px, ${pan(hh2 * scale, wrap.clientHeight, (me.y + 0.5) * TILE * scale)}px)`;
      }
      const [hh, mm] = view.clock.split(':').map(Number);
      drawLighting(ctx, floor, hh + mm / 60, view.weather);
      drawWeather(ctx, floor, view.weather, settings.reducedMotion ? 0 : t);
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
  }, [view, base, solid, byId, floor, walking, busy, confirm, balcony, poolOpen, settings.reducedMotion, scale]);

  if (!view) return null;
  const [W, H] = houseSize();
  const npcsHere = chars.filter((c) => !c.isPlayer);
  const me = chars.find((c) => c.isPlayer);
  const playerActor = actors.current.get(view.playerId);
  const speakingActor = playerActor ? [...actors.current.values()].filter(a => a.id !== view.playerId && a.floor === floor && !byId[a.id]?.swimming && Math.hypot(a.tx - playerActor.tx, a.ty - playerActor.ty) <= 2.5).sort((a, b) => Math.hypot(a.tx - playerActor.tx, a.ty - playerActor.ty) - Math.hypot(b.tx - playerActor.tx, b.ty - playerActor.ty))[0]?.id : undefined;
  const out = npcsHere.filter((c) => c.location === 'out');
  const doAct = (a: PlayerAction) => {
    if (walking || busy) return;
    setConfirm(null);
    void act(a);
  };

  return (
    <div className="flex h-full flex-col">
      <TopBar />{settings.tipsSeen.includes('walk') ? <Tip id="blocks" /> : <Tip id="walk" />}
      <main className="flex min-h-0 flex-1 gap-3 p-3 max-md:flex-col max-md:gap-2 max-md:p-2">
        <div ref={wrapRef} className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden max-md:h-[46dvh] max-md:flex-none">
          <div ref={stageRef} className="relative shrink-0" style={{ width: W * scale, height: H * scale }}>
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
                <div key={a.id} ref={el => { if (el) labels.current.set(a.id, el); else labels.current.delete(a.id); }} data-housemate={a.id} className="pointer-events-none absolute -translate-x-1/2 text-center text-[0.65rem] leading-none" style={{ left: (a.x * TILE + TILE / 2) * scale, top: (a.y * TILE + TILE - 48) * scale - 4 }}>
                  <span className="bg-paper/85 px-1" style={{ boxShadow: '0 0 0 1px var(--color-ink)' }}>
                    {m && <span style={{ color: m.color }} aria-hidden>{m.glyph} </span>}
                    {c.name.split(' ')[0]}{c.condition ? (c.condition.includes('hung') ? ' 🤕' : ' 🍺') : ''}
                  </span>
                  {a.talkingTo && <span data-conversation className="mt-1 block bg-paper/85 px-1">going to talk with {byId[a.talkingTo]?.name.split(' ')[0]}</span>}
                  {a.departing && <span className="mt-1 block bg-paper/85 px-1">{a.goingPrivate ? 'taking some private time' : 'heading out'}{a.companion ? ` with ${byId[a.companion]?.name.split(' ')[0]}` : ''}</span>}
                   {c.activityLabel && <span className="mt-1 block bg-paper/85 px-1">{c.activityLabel}{c.companion ? ` with ${byId[c.companion]?.name.split(' ')[0] ?? 'company'}` : ''}</span>}
                   {c.bark && a.id === speakingActor && <span className="mt-1 block max-w-40 bg-paper px-2 py-1 text-xs leading-tight">{c.bark}</span>}
                </div>
              );
            })}
          </div>
          {/* pinned to the viewport, not the zoomed stage, so they stay on screen while the camera pans */}
          <div className="absolute right-3 top-3 z-10 flex items-center gap-2 px-panel p-2 max-md:right-2 max-md:top-2 max-md:gap-1 max-md:p-1" role="group" aria-label="house zoom">
            <button className="px-btn" aria-label="zoom out" disabled={zoom <= 0.25} onClick={() => setZoom(z => Math.max(0.25, z - 0.25))}>−</button>
            <span className="text-xs">{Math.round(zoom * 100)}%</span>
            <button className="px-btn" aria-label="zoom in" disabled={zoom >= 2} onClick={() => setZoom(z => Math.min(2, z + 0.25))}>+</button>
            <Btn className="max-md:hidden" onClick={() => setZoom(1)}>reset view</Btn>
          </div>
          {/* touch d-pad: holds a key in the same set the keyboard fills */}
          <div className="absolute bottom-2 left-2 z-10 grid grid-cols-3 gap-1 md:hidden" role="group" aria-label="walk">
            {([['arrowup', '▲', 'col-start-2'], ['arrowleft', '◀', 'col-start-1 row-start-2'], ['arrowright', '▶', 'col-start-3 row-start-2'], ['arrowdown', '▼', 'col-start-2 row-start-3']] as const).map(([k, glyph, pos]) => (
              <button key={k} aria-label={`walk ${k.slice(5)}`} className={`px-btn h-11 w-11 p-0 text-base opacity-90 ${pos}`} style={{ touchAction: 'none' }}
                onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); keys.current.add(k); }}
                onPointerUp={() => keys.current.delete(k)} onPointerCancel={() => keys.current.delete(k)} onContextMenu={(e) => e.preventDefault()}>{glyph}</button>
            ))}
          </div>
          {prompt && (
            <button type="button" className="absolute bottom-2 left-1/2 z-10 -translate-x-1/2 px-panel px-3 py-1 text-sm max-md:left-auto max-md:right-2 max-md:max-w-[50%] max-md:translate-x-0 max-md:py-3" aria-live="polite" onClick={() => nearestInteraction()?.run()}>
              <kbd className="max-md:hidden">E</kbd> {prompt.label}
            </button>
          )}
          {toast && (
            <div className="absolute left-1/2 top-2 z-10 -translate-x-1/2 px-panel px-3 py-1 text-sm" role="status" onAnimationEnd={() => setToast(null)}>
              {toast}{' '}
              <button className="underline" onClick={() => setToast(null)}>
                ok
              </button>
            </div>
          )}
        </div>
        <div className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto scroll-thin pr-1 max-md:min-h-0 max-md:w-full max-md:flex-1 max-md:shrink max-md:px-1 max-md:pt-1">
          {unfinished && <Panel title="conversation in progress"><p className="caption mb-2 text-xs">You stepped away mid-scene. Finish it before doing anything else.</p><Btn primary disabled={busy} onClick={() => void resume()}>back to the conversation</Btn></Panel>}
          <Panel title="your life in the house"><p className="text-sm">{view.goals.short}</p><p className="caption mt-1 text-xs">long term: {view.goals.long}</p>{view.goals.career && <p className="mt-2 text-xs">work: {view.goals.career.title} · {view.goals.career.completed ? 'resolved' : `chapter ${view.goals.career.act + 1}`}</p>}</Panel>
          <Panel title={floor === 0 ? 'ground floor' : 'upstairs'}>
            <Btn disabled={busy || walking} onClick={stairs}>{floor === 0 ? 'take stairs upstairs' : 'take stairs downstairs'}</Btn>
            <div className="mt-2 flex flex-wrap gap-2">{content().house.rooms.filter(r => r.floor === floor && !r.private && !r.id.startsWith('stairs')).map(r => <Btn key={r.id} disabled={busy || walking || currentRoom === r.id} onClick={() => void visit(r.id, r.floor)}>go to {r.name}</Btn>)}</div>
            <div className="mt-2 flex flex-wrap gap-2">{content().house.rooms.filter((r) => r.id.startsWith('balcony')).map((r) => <Btn key={r.id} disabled={busy || walking} onClick={() => { setBalcony(r.id); setInvite(''); }}>{r.name}</Btn>)}</div>
            <p className="caption mt-2 text-xs">Balconies belong to their bedrooms. Ask a roommate to invite you.</p>
          </Panel>
          <Panel title="pool">
            <p className="caption mb-2 text-xs">{chars.filter(c => c.swimming).length ? `${chars.filter(c => c.swimming).length} in the water · swimwear on` : 'Change into swimwear and take a dip, alone or with housemates.'}</p>
            <Btn disabled={busy || walking || view.weather === 'typhoon'} onClick={() => { setPoolGuests([]); setPoolOpen(true); }}>{me?.swimming ? 'invite more swimmers' : 'swim & invite housemates'}</Btn>
            {chars.some(c => c.swimming) && <Btn className="mt-2" disabled={busy || walking} onClick={() => doAct({ type: 'pool', mode: 'leave' })}>everyone out of the pool</Btn>}
            {view.weather === 'typhoon' && <p className="mt-2 text-xs">The pool is closed during the storm.</p>}
          </Panel>
          {view.approaches.map((a) => <Panel key={a.id} title={byId[a.from]?.name.split(' ')[0] ?? a.from}><p className="mb-2 text-sm">{a.text}</p><div className="flex gap-2"><Btn disabled={busy || walking} onClick={() => doAct({ type: 'approach', id: a.id, accept: true })}>got a minute</Btn><Btn disabled={busy || walking} onClick={() => doAct({ type: 'approach', id: a.id, accept: false })}>not now</Btn></div></Panel>)}
          <Panel title={`${slotLabel(view.slot)} ${view.clock} — what will you do?`}>
            <p className="caption mb-2 text-xs">{view.minutesLeft} min left in this block. Time passes while you watch the house. Housemates finish their activities and choose what to do next.</p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Btn disabled={busy || walking} onClick={() => doAct({ type: 'house', activity: 'hangout' })}>hang out</Btn>
              <Btn disabled={busy || walking} onClick={() => setScreen('cooking')}>cook</Btn>
              <Btn disabled={busy || walking} onClick={() => doAct({ type: 'house', activity: 'backyard' })}>backyard</Btn>
              <Btn disabled={busy || walking} onClick={() => doAct({ type: 'house', activity: 'tidy' })}>tidy up</Btn>
              <Btn disabled={busy || walking} onClick={() => doAct({ type: 'house', activity: 'hobby' })}>hobby</Btn>
              <Btn disabled={busy || walking} onClick={() => doAct({ type: 'house', activity: 'rest' })}>rest</Btn>
              <Btn disabled={busy || walking} onClick={() => setScreen('map')} title="go out into the city">
                go out
              </Btn>
              <Btn disabled={busy || walking} onClick={() => doAct({ type: 'idle' })}>let time pass</Btn>
              <Btn disabled={busy || walking} onClick={() => doAct({ type: 'skip' })}>skip to next block</Btn>
              <Btn disabled={busy || walking} onClick={() => setConfirm({ title: 'sleep until morning? (plans and shifts still happen)', action: { type: 'sleep' } })}>sleep until morning</Btn>
            </div>
            <SpendUntil view={view} disabled={busy || walking || unfinished} onGo={(p, doing) => void spendUntil(p.episode, p.slot, doing)} />
            {shiftToday(view.job, view.weekday, view.slot) && (
              <div className="mt-3 text-sm" role="status">
                <p>⚑ you have a shift at {placeName(view.job!.nodeId)} now. skipping it twice gets you let go.</p>
                <Btn primary className="mt-2" disabled={busy || walking} onClick={() => doAct({ type: 'goOut', node: view.job!.nodeId, activity: 'work' })}>go to work (back after the shift)</Btn>
              </div>
            )}
            {classToday(me?.occupation ?? '', view.weekday, view.slot) && (
              <div className="mt-3 text-sm" role="status">
                <p>⚑ {view.examWeek ? 'exam today' : 'you have lectures'} at {placeName('university')}. {view.examWeek ? 'missing it costs more than a lecture.' : 'skipped classes add up.'}</p>
                <Btn primary className="mt-2" disabled={busy || walking} onClick={() => doAct({ type: 'goOut', node: 'university', activity: 'class' })}>go to class (back after lectures)</Btn>
              </div>
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
                  <Btn disabled={busy || walking} onClick={() => setConfirm({ title: `graduate and ask ${partner.name.split(' ')[0]} to come? They can choose to stay; you'll leave alone if they decline, then create your next housemate.`, action: { type: 'graduate', with: partner.id } })}>ask {partner.name.split(' ')[0]} to leave together</Btn>
                ) : null;
              })()}
              <Btn disabled={busy || walking} onClick={() => setConfirm({ title: 'graduate from the house alone? (your farewell happens now; then you create the next housemate who moves in)', action: { type: 'graduate' } })}>leave the house</Btn>
              <Btn disabled={busy || walking || view.episode < 3 || !!view.finaleEpisode} onClick={() => setConfirm({ title: 'announce the final episode? everyone gets one last chance before the season wraps.', action: { type: 'endSeason' } })}>{view.finaleEpisode ? 'finale announced' : 'wrap the season'}</Btn>
            </div>
          </Panel>
          {view.aired !== null && <BroadcastPanel episode={view.aired} />}
          {view.weekday === 5 && ['morning', 'slot1', 'slot2'].includes(view.slot) && (
            <TripPanel chars={npcsHere.filter((c) => c.location !== 'out')} offer={view.tripOffer} disabled={busy || walking} onGo={(node, withIds, roommate) => setConfirm({ title: `leave for ${TRIPS[node].name} with ${withIds.map((id) => byId[id]?.name.split(' ')[0]).join(', ')}? (back tomorrow morning)`, action: { type: 'trip', node, with: withIds, roommate } })} />
          )}
           <Panel title="everyday life">
             <p className="caption mb-2 text-xs">A little housework or time together. Pick once, then chat while you do it. Housemates also lend a hand on their own.</p>
             <label className="mb-2 flex flex-col gap-1 text-sm">activity<select aria-label="household activity" className="px-panel-soft px-2 py-1" value={household} onChange={e => setHousehold(e.target.value as HouseholdActivity)}>{HOUSEHOLD_ACTIVITIES.map(id => <option key={id} value={id}>{HOUSEHOLD[id].label} · {HOUSEHOLD[id].minutes} min</option>)}</select></label>
             <label className="mb-2 flex flex-col gap-1 text-sm">company<select aria-label="household company" className="px-panel-soft px-2 py-1" value={householdGuest} onChange={e => setHouseholdGuest(e.target.value)}><option value="">on my own</option>{npcsHere.filter(c => c.location && c.location !== 'out' && !c.household && !['work', 'sleep', 'nap', 'shower'].includes(c.activity ?? '')).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
             <p className="caption mb-2 text-xs">{HOUSEHOLD[household].detail}</p>
             <Btn primary disabled={busy || walking || unfinished || !!view.householdOptions?.find(o => o.id === household)?.reason} onClick={() => doAct({ type: 'household', activity: household, target: householdGuest || undefined })}>{householdGuest ? 'invite & start together' : 'start activity'}</Btn>
             {view.householdOptions?.find(o => o.id === household)?.reason && <p className="mt-2 text-xs" role="status">{view.householdOptions.find(o => o.id === household)?.reason}</p>}
             {npcsHere.filter(c => c.household && !c.companion).map(c => <div key={c.id} className="mt-3 text-sm"><p>{c.name.split(' ')[0]}: {c.activityLabel}</p><Btn className="mt-1" disabled={busy || walking || unfinished} onClick={() => doAct({ type: 'household', activity: c.household!, target: c.id, join: true })}>join {c.name.split(' ')[0]} & talk</Btn></div>)}
           </Panel>
           <Panel title="invite housemates">
            <label className="mb-2 flex flex-col gap-1 text-sm">room<select aria-label="meet in room" className="px-panel-soft px-2 py-1" value={meetingRoom} onChange={e => setMeetingRoom(e.target.value as Room)}>{content().house.rooms.filter(r => !r.private && !r.id.startsWith('stairs')).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
            <label className="mb-2 flex flex-col gap-1 text-sm">housemate<select aria-label="invite housemate" className="px-panel-soft px-2 py-1" value={meetingGuest} onChange={e => setMeetingGuest(e.target.value)}><option value="">choose someone</option>{npcsHere.filter(c => c.location !== 'out' && !['work', 'sleep', 'nap', 'shower'].includes(c.activity ?? '')).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
             <fieldset className="mb-3 text-sm"><legend>also invite</legend>{npcsHere.filter(c => c.id !== meetingGuest && c.location && c.location !== 'out' && !['work', 'sleep', 'nap', 'shower'].includes(c.activity ?? '')).map(c => <label key={c.id} className="flex items-center gap-2"><input type="checkbox" checked={meetingGuests.includes(c.id)} disabled={!meetingGuests.includes(c.id) && meetingGuests.length >= 3} onChange={e => setMeetingGuests(prev => e.target.checked ? [...prev, c.id] : prev.filter(id => id !== c.id))} />{c.name.split(' ')[0]}</label>)}</fieldset>
             <Btn primary disabled={busy || walking || unfinished || !meetingGuest} onClick={() => doAct({ type: 'talk', target: meetingGuest, room: meetingRoom, guests: meetingGuests.filter(id => id !== meetingGuest && npcsHere.some(c => c.id === id && c.location && c.location !== 'out' && !['work', 'sleep', 'nap', 'shower'].includes(c.activity ?? ''))) })}>go together & talk</Btn>
            <p className="caption mt-2 text-xs">Meet in this room and continue talking there.</p>
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
      {poolOpen && <Modal title="swim together" onClose={() => setPoolOpen(false)}>
        <p className="mb-3 text-sm">You change into your swimsuit. Invite up to five housemates; everyone changes into their own swimwear. Stay until the block ends, or get out whenever you like.</p>
        <fieldset className="mb-4 flex flex-col gap-2 text-sm"><legend className="caption mb-2">invite housemates</legend>
          {npcsHere.map(c => <label key={c.id} className="flex items-center gap-2"><input type="checkbox" checked={poolGuests.includes(c.id) || !!c.swimming} disabled={busy || !!c.swimming || c.location === 'out'} onChange={() => setPoolGuests(ids => ids.includes(c.id) ? ids.filter(id => id !== c.id) : [...ids, c.id])} />{c.name.split(' ')[0]}{c.swimming ? ' · already swimming' : c.location === 'out' ? ' · away' : ''}</label>)}
        </fieldset>
        <div className="flex gap-3"><Btn primary autoFocus disabled={busy || walking || view.weather === 'typhoon'} onClick={() => { setPoolOpen(false); doAct({ type: 'pool', mode: 'enter', with: poolGuests }); }}>{me?.swimming ? 'invite selected housemates' : 'enter pool'}</Btn><Btn onClick={() => setPoolOpen(false)}>cancel</Btn></div>
      </Modal>}
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

/** The latest aired episode on the living-room TV: every scene as it was broadcast, yours highlighted. */
/** Let time pass until a planned hangout's block begins, so you can pick the plan up right when it starts. */
function SpendUntil({ view, disabled, onGo }: { view: PlayerView; disabled: boolean; onGo: (p: { episode: number; slot: string }, doing: 'skip' | 'hobby' | 'rest') => void }) {
  const at = (p: { episode: number; slot: string }) => p.episode * SLOTS.length + (SLOTS as readonly string[]).indexOf(p.slot);
  const plans = view.invitations.filter(p => p.status === 'accepted' && [p.from, p.to].includes(view.playerId) && at(p) > at(view)).sort((a, b) => at(a) - at(b));
  const [id, setId] = useState('');
  const [doing, setDoing] = useState<'skip' | 'hobby' | 'rest'>('skip');
  const plan = plans.find(p => p.id === id) ?? plans[0];
  if (!plan) return null;
  const when = (p: typeof plan) => `${p.episode === view.episode ? 'today' : p.episode === view.episode + 1 ? 'tomorrow' : `in ${p.episode - view.episode} days`} ${clockLabel(p.slot, 0)}`;
  return (
    <div className="mt-3 flex flex-col gap-2 text-sm">
      <label className="flex flex-col gap-1 text-xs">spend time until<select aria-label="spend time until" className="bg-paper p-1 text-sm" value={plan.id} onChange={e => setId(e.target.value)}>{plans.map(p => <option key={p.id} value={p.id}>{placeName(p.node)} · {when(p)}</option>)}</select></label>
      <label className="flex flex-col gap-1 text-xs">meanwhile<select aria-label="meanwhile" className="bg-paper p-1 text-sm" value={doing} onChange={e => setDoing(e.target.value as typeof doing)}><option value="skip">let time pass</option><option value="hobby">hobby</option><option value="rest">rest</option></select></label>
      <Btn disabled={disabled} onClick={() => onGo(plan, doing)}>{doing === 'skip' ? 'let time pass' : doing} until {when(plan)}</Btn>
    </div>
  );
}

function BroadcastPanel({ episode }: { episode: number }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.broadcast>> | null>(null);
  return (
    <Panel title={`📺 episode ${episode} has aired`}>
      <p className="caption text-xs">Days {(episode - 1) * 3 + 1}–{episode * 3}, aired on day {episode * 3 + 3}. See the important moments the house watched together.</p>
      <Btn className="mt-2 text-xs" onClick={() => void api.broadcast().then(setData)}>watch the episode</Btn>
      {data && (
        <Modal title={`episode ${data.episode ?? episode}, as aired`} onClose={() => setData(null)}>
          <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto scroll-thin text-sm">
            {data.highlights.map((moment, i) => <p key={`highlight:${i}`} className="reply-text"><span className="caption">day {moment.day}:</span> {moment.text}</p>)}
            {data.scenes.length === 0 && data.highlights.length === 0 && data.panel.length === 0 && <p className="caption">a quiet episode: nothing made the cut.</p>}
            {data.scenes.map((sc, i) => (
              <section key={i} className={sc.mine ? 'px-panel-soft p-2' : 'p-2'}>
                <h3 className="text-xs">day {sc.day} · {sc.title} · {sc.location}{sc.mine ? ' · you' : ''}</h3>
                {sc.lines.map((l, j) => <p key={j} className="reply-text"><span className="caption">{l.name}:</span> {l.text}</p>)}
              </section>
            ))}
            <section aria-label="broadcast panel commentary"><h3 className="text-sm">the panel, on TV</h3>{data.panel.map((line, i) => <p key={i} className="reply-text"><span className="caption">day {line.day} · {line.name}:</span> {line.text}</p>)}</section>
          </div>
        </Modal>
      )}
    </Panel>
  );
}

/** Friday: plan an overnight trip in the shared car (Shabbat observers and budgets are checked by the engine). */
function TripPanel({ chars, offer, disabled, onGo }: { chars: CharView[]; offer: PlayerView['tripOffer']; disabled: boolean; onGo: (node: string, withIds: string[], roommate?: string) => void }) {
  const [node, setNode] = useState(offer?.node ?? 'galilee');
  const [picked, setPicked] = useState<string[]>(offer && chars.some((c) => c.id === offer.from) ? [offer.from] : []);
  const host = offer && chars.find((c) => c.id === offer.from);
  const [roommate, setRoommate] = useState('');
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < 3 ? [...p, id] : p));
  return (
    <Panel title="weekend trip">
      {host && <p className="mb-2 text-sm" role="status">✉ {host.name.split(' ')[0]} invited you to {TRIPS[offer!.node].name}.</p>}
      <label className="flex items-center gap-2 text-sm">to
        <select aria-label="trip destination" className="px-panel-soft px-2 py-1" value={node} onChange={(e) => setNode(e.target.value)}>
          {Object.entries(TRIPS).map(([id, t]) => <option key={id} value={id}>{t.name} · {priceLabel(t.price)}</option>)}
        </select>
      </label>
      <fieldset className="mt-2 flex flex-wrap gap-2 text-xs"><legend className="caption">who comes (up to 3)</legend>
        {chars.map((c) => <label key={c.id} className={`flex items-center gap-1 ${c.keepsShabbat ? 'caption' : ''}`} title={c.keepsShabbat ? 'keeps Shabbat: stays home' : undefined}><input type="checkbox" disabled={c.keepsShabbat} checked={picked.includes(c.id)} onChange={() => toggle(c.id)} />{c.name.split(' ')[0]}{c.keepsShabbat ? ' (Shabbat)' : ''}</label>)}
      </fieldset>
      {picked.length > 0 && <label className="mt-2 flex items-center gap-2 text-xs">share a room with
        <select aria-label="trip roommate" className="px-panel-soft px-1 py-0.5" value={roommate} onChange={(e) => setRoommate(e.target.value)}><option value="">decide there</option>{picked.map((id) => <option key={id} value={id}>{chars.find((c) => c.id === id)?.name.split(' ')[0]}</option>)}</select>
      </label>}
      <Btn className="mt-2" disabled={disabled || !picked.length} onClick={() => onGo(node, picked, picked.includes(roommate) ? roommate : undefined)}>leave in the shared car</Btn>
      <p className="caption mt-1 text-xs">Friday to Saturday morning. Anyone who keeps Shabbat stays home.</p>
    </Panel>
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
           {c.activityLabel || c.activity ? ` · ${c.activityLabel ?? c.activity}` : ''}
          {c.mood && (
            <>
              {' · '}
              <span style={{ color: m?.color }} aria-hidden>{m?.glyph}</span> {c.mood}
            </>
          )}
          {c.condition ? ` · ${c.condition}` : ''}
        </div>
      </div>
      <button className="px-btn text-xs" onClick={onTalk} disabled={disabled} aria-label={`talk to ${c.name.split(' ')[0]}`}>
        talk
      </button>
    </li>
  );
}

export const roomOf = roomAt;
