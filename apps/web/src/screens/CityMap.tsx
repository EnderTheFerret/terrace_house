// City map: pixel-art canvas rendered from content/city.json, reachable nodes highlighted by remaining slot cost.
import { Tip } from '../components/Tip';
import { useEffect, useMemo, useRef, useState } from 'react';
import { afford, content, reachability, servesDrinks, shiftToday, ACTIVITY_MINUTES, GIFT_ITEMS, GIFT_PRICE, priceLabel, type PlayerAction, type CityNode } from '@shared-roof/shared';
import { useGame } from '../store';
import { useWorldClock } from '../useWorldClock';
import { TopBar, StudioStrip, slotLabel } from '../components/layout';
import { Btn, Modal, Panel } from '../components/ui';
import { sprite } from '../pixel/sprites';

const DAY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
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
      const sea = gx < 12;
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

const ACT_LABEL: Record<string, string> = { date: 'go on a date', wander: 'wander around', work: 'work a shift', shop: 'go shopping', karaoke: 'karaoke', eat: 'eat out', invite: 'invite housemates', gift: 'buy a gift' };

export function CityMap() {
  const { view, act, busy, goBack, setScreen } = useGame();
  const ref = useRef<HTMLCanvasElement>(null);
  const [sel, setSel] = useState<CityNode | null>(null);
  const [activity, setActivity] = useState<string>('wander');
  const [invite, setInvite] = useState<string>('');
  const [contract, setContract] = useState(false);
  const [drink, setDrink] = useState(false);
  const [item, setItem] = useState('flowers');
  const [scale, setScale] = useState(3);
  useWorldClock(!!sel);
  const reach = useMemo(() => {
    if (!view) return [];
    const booked = view.carPlanNode ? reachability('house', view.slot as never, view.budget.level, true, 180 - view.minutesLeft, view.weekday).find((r) => r.node === view.carPlanNode) : undefined;
    return reachability('house', view.slot as never, view.budget.level, view.carFree, 180 - view.minutesLeft, view.weekday).map((r) => booked?.node === r.node ? booked : r);
  }, [view]);
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
    ctx.setTransform(2, 0, 0, 2, 0, 0);
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
      ctx.drawImage(sprite(me, 'down', Math.floor(t / 400) % 2 ? 0 : 1), mx(home.x) - 8, my(home.y) - 26, 16, 20);
      for (const node of content().city.nodes) {
        const visitors = view.characters.filter(ch => !ch.isPlayer && ch.cityLocation === node.id);
        visitors.forEach((ch, i) => ctx.drawImage(sprite(ch, ch.companion ? (i % 2 ? 'left' : 'right') : 'down', 1), mx(node.x) - 8 + (i - (visitors.length - 1) / 2) * 14, my(node.y) - 25, 16, 20));
      }
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
    setContract(false);
    setDrink(false);
  };
  const drinks = !!sel && servesDrinks(sel.id);
  const needsInvite = activity === 'date' || activity === 'invite';
  // an accepted plan for this block at the selected place, with the other person already there
  const plans = sel ? view.invitations.filter((p) => p.status === 'accepted' && !p.performance && p.node === sel.id && p.episode === view.episode && p.slot === view.slot && [p.from, p.to].includes(view.playerId)) : [];
  const mates = view.characters.filter((c) => sel && c.cityLocation === sel.id && plans.some((p) => [p.from, p.to].includes(c.id)));
  const joinPlan = () => {
    if (!sel || !mates.length) return;
    const activity = plans.length === 1 && plans[0].date && sel.activities.includes('date') ? 'date' : sel.activities.includes('invite') ? 'invite' : sel.activities.find((a) => !['work', 'class'].includes(a)) ?? 'wander';
    const r = byNode[sel.id];
    setSel(null);
    void act({ type: 'goOut', node: sel.id, activity: activity as never, invite: mates[0].id, guests: mates.length > 1 ? mates.slice(1).map((c) => c.id) : undefined, useCar: r?.needsCar, drink: drinks && drink });
  };
  const go = () => {
    if (!sel) return;
    const r = byNode[sel.id];
    const a: PlayerAction = { type: 'goOut', node: sel.id, activity: activity as never, invite: needsInvite ? invite || undefined : undefined, useCar: r?.needsCar, contract: activity === 'work' && contract, item: activity === 'gift' ? item : undefined, drink: drinks && drink && !['work', 'class'].includes(activity) };
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
      <TopBar /><Tip id="map" />
      <main className="flex min-h-0 flex-1 gap-4 p-3">
        <div className="relative flex flex-1 items-center justify-center overflow-hidden">
          <div className="relative" style={{ width: W * scale, height: H * scale }}>
            <canvas ref={ref} width={W * 2} height={H * 2} className="pixelated px-panel block cursor-pointer" style={{ width: W * scale, height: H * scale }} onClick={onCanvasClick} aria-label="city map of Tel Aviv. use the destination list to choose with the keyboard." />
            {nodes.map((n) => (
              <span key={n.id} className={`pointer-events-none absolute -translate-x-1/2 whitespace-nowrap bg-paper/80 px-1 text-[0.6rem] ${byNode[n.id]?.reachable ? '' : 'opacity-50'}`} style={{ left: mx(n.x) * scale, top: (my(n.y) + 7) * scale }}>
                {n.name}
              </span>
            ))}
          </div>
        </div>
        <Panel title={`${slotLabel(view.slot)} · where to? (${Math.max(0, view.minutesLeft - ACTIVITY_MINUTES)} min for travel there and back)`} className="flex w-96 shrink-0 flex-col overflow-hidden">
          <ul className="flex-1 overflow-y-auto pr-1 text-sm scroll-thin">
            {view.characters.filter(c => !c.isPlayer && c.cityLocation).map(c => <li key={`visitor-${c.id}`} className="mb-2 text-xs">{c.name.split(' ')[0]} · at {content().city.nodes.find(n => n.id === c.cityLocation)?.name}{c.condition ? ` · ${c.condition}` : ''}{c.companion ? ` with ${view.characters.find(p => p.id === c.companion)?.name.split(' ')[0]}` : ''}</li>)}
            {nodes
              .map((n) => ({ n, r: byNode[n.id] }))
              .sort((a, b) => Number(b.r?.reachable) - Number(a.r?.reachable) || (a.r?.minutes ?? 999) - (b.r?.minutes ?? 999))
              .map(({ n, r }) => (
                <li key={n.id}>
                  <button
                    className={`mb-1 flex w-full items-center gap-2 px-2 py-1 text-left ${sel?.id === n.id ? 'bg-[#fde4dc]' : 'hover:bg-[#fff1dd]'} ${r?.reachable ? '' : 'opacity-60'}`}
                    disabled={!r?.reachable}
                    onClick={() => pick(n)}
                    aria-label={`${n.name}, ${Number.isFinite(r?.minutes) ? `${r!.minutes} minutes${r!.needsCar ? ' by car' : ''}` : 'no route'}, ${r?.reason ?? (r ? `${priceLabel(r.price)}${r.afford === 'ok' ? '' : r.afford === 'stretch' ? ', a stretch for your budget' : ', out of your budget'}` : '')}`}
                  >
                    <span className="flex-1">
                      {n.name}
                      <span className="caption block text-xs">{n.type} · {content().city.districts.find((d) => d.id === n.district)?.name}</span>
                    </span>
                    <span className="text-right text-xs">
                      {Number.isFinite(r?.minutes) ? `${r!.minutes} min` : '—'}
                      {r?.needsCar ? ' 🚗' : ''}
                      <span className="caption block">{r?.reason ?? (r ? `${priceLabel(r.price)}${r.afford === 'stretch' ? ' · stretch' : r.afford === 'out' ? ' · out of budget' : ''}` : '')}</span>
                    </span>
                  </button>
                </li>
              ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <Btn onClick={goBack}>back home</Btn>
            <Btn onClick={() => setScreen('phone')}>phone</Btn>
          </div>
          {view.job && (
            <p className={`mt-1 text-xs ${shiftToday(view.job, view.weekday, view.slot) ? '' : 'caption'}`}>
              {shiftToday(view.job, view.weekday, view.slot) ? '⚑ your shift is now: ' : 'job: '}
              {content().city.nodes.find((n) => n.id === view.job!.nodeId)?.name}, {slotLabel(view.job.slot)} {view.job.weekdays.map((d) => DAY[d]).join('/')}
            </p>
          )}
          <p className="caption mt-1 text-xs">shared car: {view.carFree ? 'available' : view.carPlanNode ? 'reserved for your plan' : 'taken'}</p>
        </Panel>
      </main>
      <StudioStrip />
      {sel && (
        <Modal title={sel.name} onClose={() => setSel(null)}>
          <p className="mb-3 text-sm">{sel.description}</p>
          {mates.length > 0 && (
            <div className="mb-3 flex items-center gap-3">
              <Btn primary disabled={busy} onClick={joinPlan}>join {mates.map((c) => c.name.split(' ')[0]).join(' & ')} · {plans.length === 1 && plans[0].date ? 'your date' : 'your plan'}</Btn>
              <span className="caption text-xs">already here</span>
            </div>
          )}
          <fieldset className="mb-3">
            <legend className="caption mb-1 text-xs">what will you do?</legend>
            <div className="flex flex-wrap gap-2">
              {[...sel.activities, ...(sel.activities.includes('shop') && !sel.activities.includes('gift') ? ['gift'] : [])].map((a) => (
                <button key={a} aria-pressed={activity === a} className={`px-btn text-xs ${activity === a ? 'px-btn-primary' : ''}`} onClick={() => setActivity(a)}>
                  {ACT_LABEL[a] ?? a}
                  
                </button>
              ))}
            </div>
          </fieldset>
          {activity === 'work' && (
            <label className="mb-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={contract} disabled={view.job?.nodeId === sel.id} onChange={(e) => setContract(e.target.checked)} />
              {view.job?.nodeId === sel.id
                ? `you work here: ${slotLabel(view.job.slot)}, ${view.job.weekdays.map((d) => DAY[d]).join('/')} (budget +1 level while you keep it)`
                : `sign a contract: this time slot, 3 fixed days a week; a part-time job lifts your budget a level${view.job ? ' (replaces your current job)' : ''}`}
            </label>
          )}
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
          {drinks && !['work', 'class'].includes(activity) && (
            <label className="mb-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={drink} onChange={(e) => setDrink(e.target.checked)} />
              have a few drinks <span className="caption text-xs">(others may join in; tomorrow may hurt)</span>
            </label>
          )}
          {activity === 'gift' && <label className="mb-3 flex items-center gap-2 text-sm">gift
            <select aria-label="buy gift" className="px-panel-soft px-2 py-1" value={item} onChange={(e) => setItem(e.target.value)}>{Object.keys(GIFT_ITEMS).map((id) => <option key={id} value={id} disabled={afford(view.budget.level, GIFT_PRICE[id] ?? 1) === 'out'}>{id} · {priceLabel(GIFT_PRICE[id] ?? 1)}</option>)}</select>
          </label>}
          <p className="caption mb-3 text-xs">
            {byNode[sel.id]?.minutes} min away{byNode[sel.id]?.needsCar ? ' by car' : ''} · {byNode[sel.id] ? priceLabel(byNode[sel.id].price) : ''} (your budget: {view.budget.label})
          </p>
          <div className="flex gap-3">
            <Btn primary disabled={busy || (needsInvite && !invite)} onClick={go} autoFocus>
              {activity === 'gift' ? 'buy and return' : 'go'}
            </Btn>
            <Btn onClick={() => setSel(null)}>cancel</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}
