// Phone: LINE-style private chats and the house group chat. Sending a message uses the time slot.
import { useState } from 'react';
import { useGame } from '../store';
import { TopBar } from '../components/layout';
import { Btn } from '../components/ui';

export function Phone() {
  const { view, act, goBack, busy } = useGame();
  const [tab, setTab] = useState<string>('group');
  if (!view) return null;
  const name = (id: string) => view.characters.find((c) => c.id === id)?.name.split(' ')[0] ?? id;
  const housemates = view.characters.filter((c) => c.status === 'inHouse' && !c.isPlayer);
  const thread = view.chats.find((t) => t.with === tab);
  const messages = tab === 'group' ? view.groupChat.messages : (thread?.messages ?? []);
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="flex min-h-0 flex-1 justify-center gap-4 p-4">
        <div className="flex w-[380px] flex-col rounded-[22px] bg-[#2b2b33] p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between px-2 text-xs text-paper">
            <span>{view.dateLabel}</span>
            <button className="underline" onClick={goBack}>close</button>
          </div>
          <div className="flex gap-1 overflow-x-auto pb-2 scroll-thin" role="tablist">
            <button role="tab" aria-selected={tab === 'group'} className={`shrink-0 rounded px-2 py-1 text-xs ${tab === 'group' ? 'bg-[#9fe0b0]' : 'bg-white/80'}`} onClick={() => setTab('group')}>
              house ({view.groupChat.members.length})
            </button>
            {housemates.map((c) => {
              const t = view.chats.find((x) => x.with === c.id);
              const unread = t?.messages.filter((m) => m.from !== view.playerId).length ?? 0;
              return (
                <button key={c.id} role="tab" aria-selected={tab === c.id} className={`shrink-0 rounded px-2 py-1 text-xs ${tab === c.id ? 'bg-[#9fe0b0]' : 'bg-white/80'}`} onClick={() => setTab(c.id)}>
                  {name(c.id)}
                  {unread > 0 && <span className="ml-1">({unread})</span>}
                </button>
              );
            })}
          </div>
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto rounded-[12px] bg-[#f4f6f8] p-3 scroll-thin" role="tabpanel" aria-live="polite">
            {tab === 'group' && !view.groupChat.member && <p className="caption text-center text-xs">you are not in this group chat anymore.</p>}
            {messages.length === 0 && <p className="caption text-center text-xs">no messages yet.</p>}
            {messages.map((m, i) => {
              const mine = m.from === view.playerId;
              const read = 'read' in m ? (m as { read: boolean }).read : true;
              return (
                <div key={i} className={`max-w-[80%] text-sm ${mine ? 'self-end' : 'self-start'}`}>
                  {!mine && <div className="caption text-[0.65rem]">{name(m.from)}</div>}
                  <div className={`px-2 py-1 ${mine ? 'bg-[#9fe0b0]' : 'bg-white'}`} style={{ borderRadius: 10, boxShadow: '0 1px 0 rgba(0,0,0,.15)' }}>
                    {m.text}
                  </div>
                  {mine && <div className="caption text-right text-[0.6rem]">{read ? 'read' : 'delivered'}</div>}
                </div>
              );
            })}
          </div>
          {tab !== 'group' && (
            <div className="mt-2 flex items-center gap-2">
              <Btn disabled={busy} className="flex-1 text-xs" onClick={() => void act({ type: 'text', target: tab })}>
                message {name(tab)} (uses this slot)
              </Btn>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
