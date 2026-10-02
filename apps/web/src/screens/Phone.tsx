// Messages, shared plans and the house social feed.
import { useEffect, useState } from 'react';
import { content, freezePixels, pixelsToSvg, SLOTS, type Slot } from '@shared-roof/shared';
import { useGame } from '../store';
import { TopBar, slotLabel } from '../components/layout';
import { Btn } from '../components/ui';

export function Phone() {
  const { view, act, goBack, busy, setScreen } = useGame();
  const tab = useGame((s) => s.phoneTab);
  const setTab = (phoneTab: string) => useGame.setState({ phoneTab });
  const [draft, setDraft] = useState('');
  const [postKind, setPostKind] = useState<'photo' | 'story'>('photo');
  const [target, setTarget] = useState('');
  const [node, setNode] = useState('market');
  const [episode, setEpisode] = useState((view?.episode ?? 1) + 1);
  const [slot, setSlot] = useState<Slot>('slot1');
  const read = useGame((s) => s.phoneRead);
  const [item, setItem] = useState('');
  const messages = view ? tab === 'group' ? view.groupChat.messages : view.chats.find((t) => t.with === tab)?.messages ?? [] : [];
  useEffect(() => { useGame.setState((s) => ({ phoneRead: { ...s.phoneRead, [tab]: messages.length } })); }, [tab, messages.length]);
  if (!view) return null;
  const name = (id: string) => view.characters.find((c) => c.id === id)?.name.split(' ')[0] ?? id;
  const housemates = view.characters.filter((c) => c.status === 'inHouse' && !c.isPlayer);
  const contact = housemates.find((c) => c.id === tab);
  const submit = (action: Parameters<typeof act>[0]) => void act(action).then(() => {
    if (['plan', 'respondPlan', 'post', 'like'].includes(action.type) && useGame.getState().screen === 'house') setScreen('phone');
  });
  const chat = tab === 'group' || !!contact;
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="flex min-h-0 flex-1 justify-center p-4">
        <div className="flex w-full max-w-2xl flex-col rounded-[22px] bg-[#2b2b33] p-3 shadow-xl">
          <div className="mb-2 flex justify-between px-2 text-xs text-paper"><span>{view.dateLabel} · {view.clock}</span><button className="underline" onClick={goBack}>close</button></div>
          <div className="flex gap-1 overflow-x-auto pb-2 scroll-thin" role="tablist" aria-label="phone">
            {[['group', `house (${view.groupChat.members.length})`], ['calendar', 'plans'], ['feed', 'feed'], ...housemates.map((c) => [c.id, name(c.id)])].map(([id, label]) => {
              const total = id === 'group' ? view.groupChat.messages.length : view.chats.find((t) => t.with === id)?.messages.length ?? 0;
              const unread = Math.max(0, total - (read[id] ?? 0));
              return <button key={id} role="tab" aria-selected={tab === id} className={`shrink-0 rounded px-2 py-1 text-xs ${tab === id ? 'bg-[#9fe0b0]' : 'bg-white/80'}`} onClick={() => { setTab(id); setDraft(''); }}>{label}{unread > 0 && ` (${unread})`}</button>;
            })}
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-[12px] bg-[#f4f6f8] p-3 scroll-thin" role="tabpanel" aria-live="polite">
            {chat && <>
              {tab === 'group' && !view.groupChat.member && <p className="caption text-xs">you are no longer in this group chat.</p>}
              {messages.length === 0 && <p className="caption text-xs">no messages yet.</p>}
              {messages.map((m, i) => <div key={i} className={`max-w-[85%] text-sm ${m.from === view.playerId ? 'self-end' : 'self-start'}`}>
                {m.from !== view.playerId && <div className="caption text-[0.65rem]">{name(m.from)}</div>}
                <div className={`rounded-[10px] px-2 py-1 ${m.from === view.playerId ? 'bg-[#9fe0b0]' : 'bg-white'}`}>{m.text}</div>
                {m.from === view.playerId && <div className="caption text-right text-[0.6rem]">{'read' in m && !m.read ? 'delivered' : 'read'}</div>}
              </div>)}
            </>}
            {tab === 'calendar' && <>
              <h2 className="text-sm">shared plans</h2>
              {view.invitations.length === 0 && <p className="caption text-xs">Make a plan. Save a little time for someone.</p>}
              {view.invitations.map((p) => <div key={p.id} className="rounded bg-white p-2 text-sm">
                <p>{name(p.from)} → {name(p.to)} · {content().city.nodes.find((n) => n.id === p.node)?.name ?? p.node}</p>
                <p className="caption text-xs">episode {p.episode}, {slotLabel(p.slot)} · {p.status}</p>
                {p.to === view.playerId && p.status === 'pending' && <div className="mt-1 flex gap-2"><Btn disabled={busy} onClick={() => submit({ type: 'respondPlan', id: p.id, accept: true })}>accept plan</Btn><Btn disabled={busy} onClick={() => submit({ type: 'respondPlan', id: p.id, accept: false })}>decline plan</Btn></div>}
              </div>)}
              <form className="mt-2 grid grid-cols-2 gap-2 text-sm" onSubmit={(e) => { e.preventDefault(); submit({ type: 'plan', target, node, episode, slot }); }}>
                <label>with<select aria-label="plan with" className="px-panel-soft block w-full" value={target} onChange={(e) => setTarget(e.target.value)}><option value="">choose</option>{housemates.map((c) => <option key={c.id} value={c.id}>{name(c.id)}</option>)}</select></label>
                <label>where<select aria-label="plan destination" className="px-panel-soft block w-full" value={node} onChange={(e) => setNode(e.target.value)}>{content().city.nodes.filter((n) => n.activities.includes('date') || n.activities.includes('invite')).map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}{content().house.rooms.filter((r) => !['bathroom', 'smallBathroom', 'stairs', 'stairsUp'].includes(r.id)).map((r) => <option key={r.id} value={r.id}>{r.name} (at home)</option>)}</select></label>
                <label>episode<input aria-label="plan episode" type="number" min={view.episode} max={view.episode + 7} className="px-panel-soft block w-full" value={episode} onChange={(e) => setEpisode(Number(e.target.value))} /></label>
                <label>time<select aria-label="plan time" className="px-panel-soft block w-full" value={slot} onChange={(e) => setSlot(e.target.value as Slot)}>{SLOTS.map((s) => <option key={s} value={s}>{slotLabel(s)}</option>)}</select></label>
                <Btn disabled={busy || !target || episode < view.episode} primary>make plan</Btn>
              </form>
              <h2 className="mt-3 text-sm">your day</h2>
              {view.timeline.filter((t) => t.episode === view.episode).map((t, i) => <p key={i} className="text-xs"><span className="caption">{t.clock} · {slotLabel(t.slot)}</span> {t.text}</p>)}
            </>}
            {tab === 'feed' && <>
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); submit({ type: 'post', text: draft.trim(), kind: postKind }); setDraft(''); }}><select aria-label="post format" value={postKind} onChange={(e) => setPostKind(e.target.value as 'photo' | 'story')}><option value="photo">photo</option><option value="story">story</option></select><input aria-label="new social post" maxLength={200} className="px-panel-soft min-w-0 flex-1 px-2 text-sm" placeholder="share a moment…" value={draft} onChange={(e) => setDraft(e.target.value)} /><Btn disabled={busy || !draft.trim()}>post</Btn></form>
              {[...view.feed].reverse().map((p) => <article key={p.id} className={`rounded bg-white p-2 text-sm ${p.kind === 'story' ? 'border-l-4 border-[#9fe0b0]' : ''}`}><div className="caption text-xs">{name(p.from)}{p.with ? ` with ${name(p.with)}` : ''} · {p.kind} · ep {p.episode}</div>{p.people.length > 0 && <img className="pixelated my-2 w-full rounded" style={{ maxHeight: 220, objectFit: 'contain' }} alt={`${p.kind} by ${name(p.from)} at ${content().city.nodes.find((n) => n.id === p.location)?.name ?? p.location}`} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(pixelsToSvg(freezePixels(p.location, p.slot === 'lateNight' || p.slot === 'evening' ? 'night' : p.slot === 'slot3' ? 'evening' : 'day', p.people), 4))}`} />}<p>{p.text}</p><button className="mt-1 text-xs underline" disabled={busy || p.likes.includes(view.playerId)} onClick={() => submit({ type: 'like', id: p.id })}>{p.likes.includes(view.playerId) ? '♥ liked' : '♡ like'} · {p.likes.length}</button>{p.likes.length > 0 && <span className="caption ml-2 text-xs">{p.likes.map(name).join(', ')}</span>}</article>)}
            </>}
          </div>
          {contact && <>
            <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); submit({ type: 'text', target: tab, text: draft.trim() || undefined }); setDraft(''); }}><input aria-label={`message to ${name(tab)}`} maxLength={200} placeholder="type a message…" className="min-w-0 flex-1 rounded bg-white px-2 py-1 text-sm" value={draft} onChange={(e) => setDraft(e.target.value)} /><Btn disabled={busy}>send</Btn></form>
            <p className="mt-1 text-xs text-paper">Phone conversations take minutes. Some housemates put their phone away for Shabbat.</p>
            <div className="mt-2 flex flex-wrap gap-2"><Btn disabled={busy} onClick={() => submit({ type: 'favor', target: tab, kind: 'coffee' })}>make coffee</Btn><Btn disabled={busy} onClick={() => submit({ type: 'favor', target: tab, kind: 'note' })}>leave a note</Btn>
              <select aria-label="gift from your bag" className="rounded px-1 text-xs" value={item} onChange={(e) => setItem(e.target.value)}><option value="">your gifts</option>{[...new Set(view.inventory)].map((g) => <option key={g}>{g}</option>)}</select><Btn disabled={busy || !item || !view.inventory.includes(item)} onClick={() => { submit({ type: 'gift', target: tab, item }); setItem(''); }}>give gift</Btn>
            </div>
          </>}
        </div>
      </main>
    </div>
  );
}
