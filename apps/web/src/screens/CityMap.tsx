// City map: pixel-art canvas rendered from content/city.json, reachable nodes highlighted by remaining slot cost.
import { useEffect, useMemo, useRef, useState } from 'react';
import { content, reachability, WAGE, ACTIVITY_MINUTES, type PlayerAction, type CityNode } from '@shared-roof/shared';
import { useGame } from '../store';
import { TopBar, StudioStrip, slotLabel } from '../components/layout';
import { Btn, Modal, Panel } from '../components/ui';
import { sprite } from '../pixel/sprites';

const W = 320;
const H = 224;
const mx = (x: number) => Math.round(12 + x * 2.96);
const my = (y: number) => Math.round(10 + y * 2.02);

const TYPE_COLOR: Record<string, string> = {
  home: '#fffaf3', 'convenience-store': '#8fd3b8', station: '#c8ccd6', cafe: '#f7b98a', workplace: '#c49568', market: '#9fd3e6', riverside: '#7fb36a',
  shop: '#f2b5c8', karaoke: '#c9b4ef', venue: '#3a3a44', 'rooftop-bar': '#e07a6a', park: '#6fae6b', shrine: '#d0574e', onsen: '#f6d48f', 'scenic-spot': '#ffffff', beach: '#f6e7a6',
};

function drawMap(ctx: CanvasRenderingContext2D, slot: string) {
  const city = content().city;
  const dcol = Object.fromEntries(city.districts.map((d) => [d.id, d.color]));
  // ground: nearest-node district colour on a 4px grid, sea in the south-east
  for (let y = 0; y < H; y += 4)
    for (let x = 0; x < W; x += 4) {
      const gx = (x - 12) / 2.96;
      const gy = (y - 10) / 2.02;
      const sea = gx + gy * 0.9 > 150 || (gy > 92 && gx > 40);
      if (sea) {
        ctx.fillStyle = (x + y) % 24 === 0 ? '#b6dcef' : '#8fc6e0';
      } else {
        let best = city.nodes[0];
        let bd = Infinity;
        for (const n of city.nodes) {
          const d = (n.x - gx) ** 2 + (n.y - gy) ** 2;
          if (d < bd) {
            bd = d;
            best = n;
          }
        }
        ctx.fillStyle = dcol[best.district] ?? '#dde8c8';
      }
      ctx.fillRect(x, y, 4, 4);
    }
  // texture
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  for (let i = 0; i < 400; i++) ctx.fillRect((i * 73) % W, (i * 151) % H, 1, 1);
  // roads
  for (const e of city.edges) {
    const a = city.nodes.find((n) => n.id === e.a)!;
    const b = city.nodes.find((n) => n.id === e.b)!;
    const steps = Math.max(Math.abs(mx(a.x) - mx(b.x)), Math.abs(my(a.y) - my(b.y)));
    for (let i = 0; i <= steps; i++) {
      if (e.requiresCar && i % 4 > 1) continue;
      const x = Math.round(mx(a.x) + ((mx(b.x) - mx(a.x)) * i) / steps);
      const y = Math.round(my(a.y) + ((my(b.y) - my(a.y)) * i) / steps);
      ctx.fillStyle = e.requiresCar ? '#7a6a5a' : '#efe6d2';
      ctx.fillRect(x - 1, y - 1, 2, 2);
    }
  }
  // buildings
  for (const n of city.nodes) {
    const x = mx(n.x) - 5;
    const y = my(n.y) - 6;
    ctx.fillStyle = '#4a3c50';
    ctx.fillRect(x - 1, y - 1, 12, 12);
    ctx.fillStyle = TYPE_COLOR[n.type] ?? '#ddd';
    ctx.fillRect(x, y, 10, 10);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(x, y, 10, 2);
    if (['park', 'riverside', 'shrine', 'onsen'].includes(n.type)) {
      ctx.fillStyle = '#4f8e4c';
      ctx.fillRect(x + 2, y + 4, 3, 3);
      ctx.fillRect(x + 6, y + 5, 2, 2);
    } else if (n.type === 'scenic-spot' || n.type === 'beach') {
      ctx.fillStyle = '#e07a6a';
      ctx.fillRect(x + 4, y + 2, 2, 6);
    } else {
      ctx.fillStyle = '#6f86a8';
      ctx.fillRect(x + 2, y + 4, 2, 2);
      ctx.fillRect(x + 6, y + 4, 2, 2);
    }
  }
  const tint: Record<string, string> = { slot1: 'rgba(0,0,0,0)', slot2: 'rgba(255,240,200,0.08)', slot3: 'rgba(255,150,100,0.18)', evening: 'rgba(30,30,90,0.35)', morning: 'rgba(255,210,170,0.12)' };
  ctx.fillStyle = tint[slot] ?? 'transparent';
  ctx.fillRect(0, 0, W, H);
}

const ACT_LABEL: Record<string, string> = { date: 'go on a date', wander: 'wander around', work: 'work a shift', shop: 'go shopping', karaoke: 'karaoke', eat: 'eat out', invite: 'invite housemates' };

export function CityMap() {
  const { view, act, busy, goBack, setScreen } = useGame();
  const ref = useRef<HTMLCanvasElement>(null);
  const [sel, setSel] = useState<CityNode | null>(null);
  const [activity, setActivity] = useState<string>('wander');
  const [invite, setInvite] = useState<string>('');
  const [scale, setScale] = useState(3);
  const reach = useMemo(() => (view ? reachability('house', view.slot as never, view.money, view.carFree) : []), [view]);
  const byNode = Object.fromEntries(reach.map((r) => [r.node, r]));

  useEffect(() => {
    const fit = () => setScale(Math.max(2, Math.min(4, Math.floor(Math.min((window.innerWidth - 420) / W, (window.innerHeight - 200) / H)))));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  useEffect(() => {
    const c = ref.current;
    if (!c || !view) return;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    let raf = 0;
    const base = document.createElement('canvas');
    base.width = W;
    base.height = H;
    drawMap(base.getContext('2d')!, view.slot);
    const me = view.characters.find((x) => x.isPlayer)!;
    const loop = (t: number) => {
      ctx.drawImage(base, 0, 0);
      const blinkOn = Math.floor(t / 450) % 2 === 0;
      for (const n of content().city.nodes) {
        const r = byNode[n.id];
        if (!r) continue;
        const x = mx(n.x);
        const y = my(n.y) - 1;
        if (r.reachable) {
          ctx.strokeStyle = sel?.id === n.id ? '#e07a6a' : blinkOn ? '#ffffff' : '#f6d48f';
          ctx.lineWidth = 1;
          ctx.strokeRect(x - 7.5, y - 7.5, 15, 15);
        } else {
          ctx.fillStyle = 'rgba(58,46,63,0.45)';
          ctx.fillRect(x - 6, y - 6, 12, 12);
        }
      }
      const home = content().city.nodes.find((n) => n.id === 'house')!;
      ctx.drawImage(sprite(me.id, me.appearance, 'down', Math.floor(t / 400) % 2 ? 0 : 1), mx(home.x) - 8, my(home.y) - 26);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [view, byNode, sel]);

  if (!view) return null;
  const nodes = content().city.nodes.filter((n) => n.id !== 'house');
  const available = view.characters.filter((c) => c.status === 'inHouse' && !c.isPlayer && !c.leaving);
  const pick = (n: CityNode) => {
    setSel(n);
    setActivity(n.activities.includes('date') ? 'date' : n.activities[0] ?? 'wander');
    setInvite('');
  };
  const needsInvite = activity === 'date' || activity === 'invite';
  const go = () => {
    if (!sel) return;
    const r = byNode[sel.id];
    const a: PlayerAction = { type: 'goOut', node: sel.id, activity: activity as never, invite: needsInvite ? invite || undefined : undefined, useCar: r?.needsCar };
    setSel(null);
    void act(a);
  };
  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    const hit = nodes.find((n) => Math.abs(mx(n.x) - x) < 8 && Math.abs(my(n.y) - y) < 8);
    if (hit && byNode[hit.id]?.reachable) pick(hit);
  };

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="flex min-h-0 flex-1 gap-4 p-3">
        <div className="relative flex flex-1 items-center justify-center overflow-hidden">
          <div className="relative" style={{ width: W * scale, height: H * scale }}>
            <canvas ref={ref} width={W} height={H} className="pixelated px-panel block cursor-pointer" style={{ width: W * scale, height: H * scale }} onClick={onCanvasClick} aria-label="city map of Minatohama. use the destination list to choose with the keyboard." />
            {nodes.map((n) => (
              <span key={n.id} className={`pointer-events-none absolute -translate-x-1/2 whitespace-nowrap bg-paper/80 px-1 text-[0.6rem] ${byNode[n.id]?.reachable ? '' : 'opacity-50'}`} style={{ left: mx(n.x) * scale, top: (my(n.y) + 7) * scale }}>
                {n.name}
              </span>
            ))}
          </div>
        </div>
        <Panel title={`${slotLabel(view.slot)} · where to? (${180 - ACTIVITY_MINUTES} min travel max)`} className="flex w-96 shrink-0 flex-col overflow-hidden">
          <ul className="flex-1 overflow-y-auto pr-1 text-sm scroll-thin">
            {nodes
              .map((n) => ({ n, r: byNode[n.id] }))
              .sort((a, b) => Number(b.r?.reachable) - Number(a.r?.reachable) || (a.r?.minutes ?? 999) - (b.r?.minutes ?? 999))
              .map(({ n, r }) => (
                <li key={n.id}>
                  <button
                    className={`mb-1 flex w-full items-center gap-2 px-2 py-1 text-left ${sel?.id === n.id ? 'bg-[#fde4dc]' : 'hover:bg-[#fff1dd]'} ${r?.reachable ? '' : 'opacity-60'}`}
                    disabled={!r?.reachable}
                    onClick={() => pick(n)}
                    aria-label={`${n.name}, ${Number.isFinite(r?.minutes) ? `${r!.minutes} minutes${r!.needsCar ? ' by car' : ''}` : 'no route'}, ${r?.reason ?? (r && r.cost ? `${r.cost} yen` : 'free')}`}
                  >
                    <span className="flex-1">
                      {n.name}
                      <span className="caption block text-xs">{n.type} · {content().city.districts.find((d) => d.id === n.district)?.name}</span>
                    </span>
                    <span className="text-right text-xs">
                      {Number.isFinite(r?.minutes) ? `${r!.minutes} min` : '—'}
                      {r?.needsCar ? ' 🚗' : ''}
                      <span className="caption block">{r?.reason ?? (r && r.cost ? `¥${r.cost}` : 'free')}</span>
                    </span>
                  </button>
                </li>
              ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <Btn onClick={goBack}>back home</Btn>
            <Btn onClick={() => setScreen('phone')}>phone</Btn>
          </div>
          <p className="caption mt-1 text-xs">shared car: {view.carFree ? 'available' : 'taken'}</p>
        </Panel>
      </main>
      <StudioStrip />
      {sel && (
        <Modal title={sel.name} onClose={() => setSel(null)}>
          <p className="mb-3 text-sm">{sel.description}</p>
          <fieldset className="mb-3">
            <legend className="caption mb-1 text-xs">what will you do?</legend>
            <div className="flex flex-wrap gap-2">
              {sel.activities.map((a) => (
                <button key={a} aria-pressed={activity === a} className={`px-btn text-xs ${activity === a ? 'px-btn-primary' : ''}`} onClick={() => setActivity(a)}>
                  {ACT_LABEL[a] ?? a}
                  {a === 'work' ? ` (+¥${WAGE[sel.id] ?? 2500})` : ''}
                </button>
              ))}
            </div>
          </fieldset>
          {needsInvite && (
            <label className="mb-3 flex items-center gap-2 text-sm">
              with
              <select className="px-panel-soft px-2 py-1" value={invite} onChange={(e) => setInvite(e.target.value)}>
                <option value="">(choose)</option>
                {available.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
          )}
          <p className="caption mb-3 text-xs">
            {byNode[sel.id]?.minutes} min away{byNode[sel.id]?.needsCar ? ' by car' : ''} · costs ¥{byNode[sel.id]?.cost ?? 0}
          </p>
          <div className="flex gap-3">
            <Btn primary disabled={busy || (needsInvite && !invite)} onClick={go} autoFocus>
              go
            </Btn>
            <Btn onClick={() => setSel(null)}>cancel</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}
