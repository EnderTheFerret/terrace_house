// Messages, shared plans and the house social feed.
import { Tip } from '../components/Tip';
import { PixelImage, useImage } from '../components/pixel';
import { api, type ImageStatus } from '../api';
import { useEffect, useState } from 'react';
import { content, freezePixels, pixelsToSvg, reachability, SLOTS, type PlayerView, type Slot } from '@shared-roof/shared';
import { unreadMessages, useGame } from '../store';
import { TopBar, slotLabel } from '../components/layout';
import { Btn } from '../components/ui';

export function Phone() {
  const { view, act, goBack, busy, setScreen, scenes, live } = useGame();
  const tab = useGame((s) => s.phoneTab);
  const setTab = (phoneTab: string) => useGame.setState({ phoneTab });
  const [draft, setDraft] = useState('');
  const [also, setAlso] = useState<string[]>([]);
  const [postKind, setPostKind] = useState<'photo' | 'story'>('photo');
  const [target, setTarget] = useState('');
  const [node, setNode] = useState('market');
  const [episode, setEpisode] = useState((view?.episode ?? 1) + 1);
  const [slot, setSlot] = useState<Slot>('slot1');
  const [asDate, setAsDate] = useState(false);
  const read = useGame((s) => s.phoneRead);
  const [item, setItem] = useState('');
  const messages = view ? tab === 'group' ? view.groupChat.messages : view.chats.find((t) => t.with === tab)?.messages ?? [] : [];
  const planIds = tab === 'calendar' ? view?.invitations.filter(p => p.to === view.playerId).map(p => p.id).join('|') ?? '' : '';
  useEffect(() => { useGame.setState((s) => ({ phoneRead: { ...s.phoneRead, [tab]: messages.length, ...Object.fromEntries(planIds.split('|').filter(Boolean).map(id => [`plan:${id}`, 1])) } })); }, [tab, messages.length, planIds]);
  if (!view) return null;
  const name = (id: string) => view.characters.find((c) => c.id === id)?.name.split(' ')[0] ?? id;
  const housemates = view.characters.filter((c) => c.status === 'inHouse' && !c.isPlayer);
  const contact = housemates.find((c) => c.id === tab);
  const pending = scenes.find(s => s.rendered && s.phase !== 'done');
  const blocked = busy || !!pending;
  const destinations = reachability('house', view.slot as Slot, view.budget.level, view.carFree, 180 - view.minutesLeft, view.weekday);
  const submit = (action: Parameters<typeof act>[0]) => void act(action).then(() => {
    if (action.type === 'text' && !useGame.getState().error) { setDraft(''); setAlso([]); }
    if (['plan', 'respondPlan', 'post', 'like'].includes(action.type) && useGame.getState().screen === 'house') setScreen('phone');
  });
  const retry = async () => {
    if (busy) return;
    useGame.setState({ busy: true, error: null });
    try { useGame.setState(await api.retryText(tab)); }
    catch (e) { useGame.setState({ error: (e as Error).message }); }
    finally { useGame.setState({ busy: false }); }
  };
  const chat = tab === 'group' || !!contact;
  return (
    <div className="flex h-full flex-col">
      <TopBar /><Tip id="phone" />
      <main className="flex min-h-0 flex-1 justify-center p-4">
        <div className="flex w-full max-w-2xl flex-col rounded-[22px] bg-[#2b2b33] p-3 shadow-xl">
          <div className="mb-2 flex justify-between px-2 text-xs text-paper"><span>{view.dateLabel} · {view.clock}</span><button className="underline" onClick={goBack}>close</button></div>
          <div className="flex gap-1 overflow-x-auto pb-2 scroll-thin" role="tablist" aria-label="phone">
            {[['group', `house (${view.groupChat.members.length})`], ['calendar', 'plans'], ['feed', 'feed'], ...housemates.map((c) => [c.id, name(c.id)])].map(([id, label]) => {
              const thread = id === 'group' ? view.groupChat.messages : view.chats.find((t) => t.with === id)?.messages ?? [];
              const unread = id === 'calendar' ? view.invitations.filter(p => p.to === view.playerId && p.status === 'pending' && !read[`plan:${p.id}`]).length : unreadMessages(thread, view.playerId, read[id]);
              return <button key={id} role="tab" aria-selected={tab === id} className={`shrink-0 rounded px-2 py-1 text-xs ${tab === id ? 'bg-[#9fe0b0]' : 'bg-white/80'}`} onClick={() => { setTab(id); setDraft(''); setAlso([]); }}>{label}{unread > 0 && ` (${unread})`}</button>;
            })}
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-[12px] bg-[#f4f6f8] p-3 scroll-thin" role="tabpanel" aria-live="polite">
            {chat && <>
              {tab === 'group' && !view.groupChat.member && <p className="caption text-xs">you are no longer in this group chat.</p>}
              {messages.length === 0 && <p className="caption text-xs">no messages yet.</p>}
              {messages.map((m, i) => <div key={i} className={`reply-text max-w-[85%] ${m.from === view.playerId ? 'self-end' : 'self-start'}`}>
                {m.from !== view.playerId && <div className="caption text-[0.65rem]">{name(m.from)}</div>}
                {'photo' in m && !!m.photo && <PhonePhoto request={() => api.selfie(m.from, m.tick)} deps={[m.from, m.tick]} alt={`photo from ${name(m.from)}`} />}
                <div className={`rounded-[10px] px-2 py-1 ${m.from === view.playerId ? 'bg-[#9fe0b0]' : 'bg-white'}`}>{m.text}</div>
                {m.from === view.playerId && <div className="caption text-right text-[0.6rem]">{'read' in m && !m.read ? 'delivered' : 'read'}</div>}
              </div>)}
            </>}
            {tab === 'calendar' && <>
              <h2 className="text-sm">shared plans</h2>
              {view.invitations.length === 0 && <p className="caption text-xs">Make a plan. Save a little time for someone.</p>}
              {view.invitations.map((p) => <div key={p.id} className="rounded bg-white p-2 text-sm">
                {p.performance && <p className="font-semibold">{p.performance.title} · {p.performance.audience === 'house' ? 'house invitation' : 'personal invitation'}</p>}
                <p>{name(p.from)} → {name(p.to)} · {content().city.nodes.find((n) => n.id === p.node)?.name ?? p.node}{p.date && ' · date (private)'}</p>
                <p className="caption text-xs">episode {p.episode}, {slotLabel(p.slot)} · {p.status}</p>
                {p.to === view.playerId && p.status === 'pending' && <div className="mt-1 flex gap-2"><Btn disabled={busy} onClick={() => submit({ type: 'respondPlan', id: p.id, accept: true })}>accept plan</Btn><Btn disabled={busy} onClick={() => submit({ type: 'respondPlan', id: p.id, accept: false })}>decline plan</Btn></div>}
                {p.performance && p.to === view.playerId && p.status === 'accepted' && <p className="caption mt-1 text-xs">{p.episode === view.episode && p.slot === view.slot ? 'The show is tonight. Head to the venue to keep your promise.' : 'Go to the venue during the scheduled evening to attend.'}</p>}
                {p.performance && p.to === view.playerId && p.status === 'accepted' && p.episode === view.episode && p.slot === view.slot && <Btn className="mt-1" disabled={blocked || !destinations.some(r => r.node === p.node && r.reachable && r.afford !== 'out')} onClick={() => submit({ type: 'goOut', node: p.node, activity: 'invite' })}>attend {p.performance.kind === 'dj' ? 'DJ set' : p.performance.kind === 'play' ? 'play' : 'show'}</Btn>}
              </div>)}
              <form className="mt-2 grid grid-cols-2 gap-2 text-sm" onSubmit={(e) => { e.preventDefault(); submit({ type: 'plan', target, node, episode, slot, ...(asDate ? { date: true } : {}) }); }}>
                <label>with<select aria-label="plan with" className="px-panel-soft block w-full" value={target} onChange={(e) => setTarget(e.target.value)}><option value="">choose</option>{housemates.map((c) => <option key={c.id} value={c.id}>{name(c.id)}</option>)}</select></label>
                <label>where<select aria-label="plan destination" className="px-panel-soft block w-full" value={node} onChange={(e) => setNode(e.target.value)}>{content().city.nodes.filter((n) => n.activities.includes('date') || n.activities.includes('invite')).map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}{content().house.rooms.filter((r) => !['bathroom', 'smallBathroom', 'stairs', 'stairsUp'].includes(r.id)).map((r) => <option key={r.id} value={r.id}>{r.name} (at home)</option>)}</select></label>
                <label>episode<input aria-label="plan episode" type="number" min={view.episode} max={view.episode + 7} className="px-panel-soft block w-full" value={episode} onChange={(e) => setEpisode(Number(e.target.value))} /></label>
                <label>time<select aria-label="plan time" className="px-panel-soft block w-full" value={slot} onChange={(e) => setSlot(e.target.value as Slot)}>{SLOTS.map((s) => <option key={s} value={s}>{slotLabel(s)}</option>)}</select></label>
                <label className="col-span-2 flex items-center gap-1 text-xs"><input type="checkbox" checked={asDate} onChange={(e) => setAsDate(e.target.checked)} />as a date (private: only the two of you know, unless someone tells)</label>
                <Btn disabled={busy || !target || episode < view.episode} primary>make plan</Btn>
              </form>
              <h2 className="mt-3 text-sm">your day</h2>
              {view.timeline.filter((t) => t.episode === view.episode).map((t, i) => <p key={i} className="text-xs"><span className="caption">{t.clock} · {slotLabel(t.slot)}</span> {t.text}</p>)}
            </>}
            {tab === 'feed' && <>
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); submit({ type: 'post', text: draft.trim(), kind: postKind }); setDraft(''); }}><select aria-label="post format" value={postKind} onChange={(e) => setPostKind(e.target.value as 'photo' | 'story')}><option value="photo">photo</option><option value="story">story</option></select><input aria-label="new social post" maxLength={200} className="px-panel-soft min-w-0 flex-1 px-2 text-sm" placeholder="share a moment…" value={draft} onChange={(e) => setDraft(e.target.value)} /><Btn disabled={busy || !draft.trim()}>post</Btn></form>
              {[...view.feed].reverse().map((p) => <article key={p.id} className={`rounded bg-white p-2 text-sm ${p.kind === 'story' ? 'border-l-4 border-[#9fe0b0]' : ''}`}><div className="caption text-xs">{name(p.from)}{p.with ? ` with ${name(p.with)}` : ''} · {p.kind} · ep {p.episode}</div>{p.people.length > 0 && <FeedPhoto post={p} mine={[p.from, p.with].includes(view.playerId)} alt={`${p.kind} by ${name(p.from)} at ${content().city.nodes.find((n) => n.id === p.location)?.name ?? p.location}`} />}<p>{p.text}</p><button className="mt-1 text-xs underline" disabled={busy || p.likes.includes(view.playerId)} onClick={() => submit({ type: 'like', id: p.id })}>{p.likes.includes(view.playerId) ? '♥ liked' : '♡ like'} · {p.likes.length}</button>{p.likes.length > 0 && <span className="caption ml-2 text-xs">{p.likes.map(name).join(', ')}</span>}</article>)}
            </>}
          </div>
          {contact && <>
            {messages.at(-1)?.from === tab && messages.at(-2)?.from === view.playerId && <Btn className="mt-2 self-start text-xs" disabled={busy} onClick={() => void retry()}>retry reply</Btn>}
            <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-paper" role="group" aria-label="also send to">
              <span>also send to:</span>
              {housemates.filter((c) => c.id !== tab).map((c) => <button type="button" key={c.id} aria-pressed={also.includes(c.id)} className={`rounded px-2 py-0.5 ${also.includes(c.id) ? 'bg-[#9fe0b0] text-black' : 'bg-white/80 text-black'}`} onClick={() => setAlso(also.includes(c.id) ? also.filter((x) => x !== c.id) : [...also, c.id].slice(0, 4))}>{name(c.id)}</button>)}
            </div>
            <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!busy && draft.trim()) submit({ type: 'text', target: tab, ...(also.length ? { guests: also.filter((id) => id !== tab) } : {}), text: draft.trim() }); }}><input aria-label={`message to ${name(tab)}`} placeholder="type a message…" className="min-w-0 flex-1 rounded bg-white px-2 py-1 text-sm" value={draft} onChange={(e) => setDraft(e.target.value)} /><Btn disabled={busy || !draft.trim()}>send</Btn></form>
            {pending && <Btn className="mt-2 text-xs" onClick={() => { if (live && !live.done) setScreen('scene'); else void useGame.getState().nextScene(); }}>return to conversation</Btn>}
            <p className="mt-1 text-xs text-paper">Quick messages and hangout requests don’t advance time. Some housemates put their phone away for Shabbat.</p>
            <div className="mt-2 flex flex-wrap gap-2"><Btn disabled={blocked} onClick={() => submit({ type: 'favor', target: tab, kind: 'coffee' })}>make coffee</Btn><Btn disabled={blocked} onClick={() => submit({ type: 'favor', target: tab, kind: 'note' })}>leave a note</Btn>
              <select aria-label="gift from your bag" className="rounded px-1 text-xs" value={item} onChange={(e) => setItem(e.target.value)}><option value="">your gifts</option>{[...new Set(view.inventory)].map((g) => <option key={g}>{g}</option>)}</select><Btn disabled={blocked || !item || !view.inventory.includes(item)} onClick={() => { submit({ type: 'gift', target: tab, item }); setItem(''); }}>give gift</Btn>
            </div>
          </>}
        </div>
      </main>
    </div>
  );
}

/** A phone photo: the procedural snapshot at once, the generated picture (everyone's real face) once it is drawn. */
/** Feed posts get drawn artwork only when the player is in the moment; everyone else's posts keep the pixel sketch. */
function FeedPhoto({ post: p, mine, alt }: { post: PlayerView['feed'][number]; mine: boolean; alt: string }) {
  const sketch = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(pixelsToSvg(freezePixels(p.location, p.slot === 'lateNight' || p.slot === 'evening' ? 'night' : p.slot === 'slot3' ? 'evening' : 'day', p.people), 4))}`;
  if (!mine) return <img className="pixelated my-2 w-full rounded" style={{ maxHeight: 220, objectFit: 'contain' }} alt={alt} src={sketch} />;
  return <PhonePhoto request={() => api.feedPhoto(p.id)} deps={[p.id]} alt={alt} placeholder={sketch} />;
}

function PhonePhoto({ request, deps, alt, placeholder }: { request: () => Promise<ImageStatus>; deps: unknown[]; alt: string; placeholder?: string }) {
  const st = useImage(request, deps);
  const real = st?.status === 'ready' && !st.placeholder && st.url ? st.url : null;
  if (real) return <PixelImage url={real} factor={4} alt={alt} className="my-2 block w-full rounded" style={{ maxHeight: 260, objectFit: 'contain' }} />;
  return placeholder ? <img className="pixelated my-2 w-full rounded" style={{ maxHeight: 220, objectFit: 'contain' }} alt={alt} src={placeholder} /> : <div className="caption my-2 text-xs" role="status">📷 photo loading…</div>;
}
