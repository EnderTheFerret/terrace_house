// Scene: dialogue with streamed lines, captions, player intents, eavesdrop prompt, freeze-frame and studio panel.
import { Tip } from '../components/Tip';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGame, findInvite, type LiveLine } from '../store';
import { StudioStrip, TopBar } from '../components/layout';
import { Btn, INTENT_LABEL } from '../components/ui';
import { content, EMOTIONS, isOutdoors, type Emotion, type Occasion } from '@shared-roof/shared';
import { SceneArtwork } from '../components/SceneArtwork';
import { PixelImage, Portrait, Stand, useImage } from '../components/pixel';
import { api, waitImage, type ImageStatus } from '../api';
import { chime } from '../audio';

const CPS = 45;

/** Reveal lines one after another at a typewriter pace (instant if disabled / reduced motion). */
function useReveal(lines: LiveLine[], enabled: boolean) {
  const [pos, setPos] = useState({ idx: 0, chars: 0 });
  const total = lines.length;
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => {
      setPos((p) => {
        const cur = lines[p.idx];
        if (!cur) return p;
        if (p.chars < cur.text.length) return { idx: p.idx, chars: p.chars + 2 };
        if (cur.done && p.idx < total - 1) return { idx: p.idx + 1, chars: 0 };
        return p;
      });
    }, 1000 / CPS);
    return () => clearInterval(t);
  }, [lines, total, enabled]);
  const idx = Math.min(pos.idx, Math.max(0, total - 1));
  const chars = pos.idx > idx ? Infinity : pos.chars;
  const skip = () => {
    if (!lines.length) return;
    setPos({ idx: lines.length - 1, chars: lines[lines.length - 1]?.text.length ?? 0 });
  };
  const complete = !enabled || (idx >= total - 1 && chars >= (lines[total - 1]?.text.length ?? 0) && (lines[total - 1]?.done ?? true));
  const reset = useCallback((idx = 0) => setPos({ idx, chars: 0 }), []);
  return { idx: enabled ? idx : total - 1, chars: enabled ? chars : Infinity, skip, complete, reset };
}

export function Scene() {
  const { live, view, choose, say, inviteTo, endTalk, keepListening, respond, nextScene, finishSlot, act, settings, hangOut, hangoutCg, scenes } = useGame();
  const [phaseShown, setPhaseShown] = useState<'dialogue' | 'freeze' | 'panel'>('dialogue');
  const [recipient, setRecipient] = useState('');
  const [meetingRoom, setMeetingRoom] = useState('kitchen');
  const [artwork, setArtwork] = useState<Record<string, { occasion: Occasion; outfit?: string; emotion?: Emotion; customExpression?: string; line: number; version: number }>>({});
  const recipientId = live && live.recipients.length >= 2 && (recipient === 'everyone' || live.recipients.some(p => p.id === recipient)) ? recipient : undefined;
  const logRef = useRef<HTMLDivElement>(null);
  const reveal = useReveal(live?.lines ?? [], settings.typewriter && !settings.reducedMotion);
  const bg = useImage(live?.header ? async () => live.header!.background : null, [live?.header?.background?.key]);
  const [freezeImg, setFreezeImg] = useState<ImageStatus | null>(null);
  const [sceneImg, setSceneImg] = useState<ImageStatus | null>(null);
  const [imageOpen, setImageOpen] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState('');
  const imageAbort = useRef<AbortController | null>(null);
  const imageDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    setSceneImg(null); setImageOpen(false); setImageBusy(false); setImageError('');
    setRecipient('');
    setArtwork({});
    return () => imageAbort.current?.abort();
  }, [live?.id]);
  useEffect(() => {
    if (imageOpen) imageDialog.current?.showModal();
    else imageDialog.current?.close();
  }, [imageOpen]);
  const generateScene = async () => {
    if (!live || imageBusy) return;
    const ac = new AbortController();
    imageAbort.current?.abort(); imageAbort.current = ac;
    setImageBusy(true); setImageOpen(true); setImageError(''); setSceneImg(null);
    try {
      const st = await api.sceneImage(live.id);
      if (ac.signal.aborted) return;
      setSceneImg(st);
      await waitImage(st, (img) => { if (!ac.signal.aborted) setSceneImg(img); }, ac.signal);
    } catch (e) {
      if (!ac.signal.aborted) setImageError((e as Error).message);
    } finally {
      if (!ac.signal.aborted) setImageBusy(false);
    }
  };

  // an accepted hang-out ends with its scene illustrated (unless the studio already froze the moment)
  useEffect(() => {
    if (!live?.done || !hangoutCg) return;
    useGame.setState({ hangoutCg: false });
    if (!live.freeze && settings.images) void generateScene();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once when the hang-out scene finishes
  }, [live?.done, hangoutCg]);

  useEffect(() => setPhaseShown('dialogue'), [live?.id]);
  const resetReveal = reveal.reset;
  useEffect(() => resetReveal(), [live?.id, resetReveal]);
  useEffect(() => {
    if (!live?.freeze) return setFreezeImg(null);
    const ac = new AbortController();
    setFreezeImg(live.freeze.image);
    void waitImage(live.freeze.image, setFreezeImg, ac.signal);
    return () => ac.abort();
  }, [live?.freeze]);
  useEffect(() => {
    if (live?.done && reveal.complete && phaseShown === 'dialogue') {
      if (live.outcome?.confession === 'accepted') chime('ok');
      setPhaseShown(live.freeze ? 'freeze' : 'panel');
    }
  }, [live?.done, reveal.complete, phaseShown, live?.freeze, live?.outcome]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [reveal.idx, reveal.chars, live?.lines.length]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!live || (e.target as HTMLElement)?.closest('input,textarea,select,dialog')) return;
      if (live.choice && reveal.complete && !live.streaming) {
        const n = Number(e.key);
        if (n >= 1 && n <= live.choice.length) void choose(live.choice[n - 1], recipientId, 'key');
      }
      if ((e.key === ' ' || e.key === 'Enter') && !reveal.complete && !(e.target as HTMLElement)?.closest('button')) {
        e.preventDefault();
        reveal.skip();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [live, reveal, choose, recipientId]);

  const people = useMemo(() => (live?.header?.participants ?? []).map((p) => view?.characters.find((c) => c.id === p.id)).filter(Boolean), [live?.header, view]);
  if (!live || !view) return null;
  const h = live.header;
  const chat = h?.chat;
  const visible = live.lines.slice(0, reveal.idx + 1);
  // first person: the player is never on stage; everyone else in the scene is
  const stage = people.filter((c) => c!.id !== view.playerId) as NonNullable<(typeof people)[number]>[];
  const lastSpeaker = visible.findLast(l => l.speaker !== 'narrator')?.speaker;
  const emotionOf = (id: string): Emotion => {
    const preview = artwork[id];
    if (preview?.emotion && preview.line === reveal.idx) return preview.emotion;
    const e = [...visible].reverse().find((l) => l.speaker === id && l.emotion)?.emotion;
    return (EMOTIONS as readonly string[]).includes(e ?? '') ? (e as Emotion) : 'neutral';
  };
  const current = visible[visible.length - 1];
  // an invitation that came up in the talk (a housemate's, or yours once they said yes); phone chats count too.
  // After a player's own ask, the server's yes/no decides; the line-reading guess only fills in when nobody asked.
  const invite = live.choice && reveal.complete && !live.streaming ? live.invite ?? (live.inviteNote ? null : findInvite(live.lines, view)) : null;
  const othersPending = scenes.some(s => s.id !== live.id && s.rendered && s.phase !== 'done');
  const lateInvite = phaseShown === 'panel' && live.done && !live.arrivalPending && !othersPending && !(live.outcome?.leaving?.length) ? live.invite ?? (live.inviteNote ? null : findInvite(live.lines, view)) : null;
  const inviteOptions = [
    ...content().city.nodes.filter(n => n.activities.includes('invite') || n.activities.includes('date')).map(n => ({ id: n.id, name: n.name, date: n.activities.includes('date') })),
    ...(content().house.rooms.some(r => r.id === view.playerLocation) ? content().house.rooms.filter(r => !r.private && !r.id.startsWith('stairs') && r.id !== view.playerLocation).map(r => ({ id: r.id, name: `${r.name} (at home)`, date: false })) : []),
  ];
  const roomCompany = stage.filter(c => c.status === 'inHouse').slice(0, 4);
  const meetingRooms = content().house.rooms.filter(r => !r.private && !r.id.startsWith('stairs') && r.id !== view.playerLocation);
  const occasionOf = (id: string): Occasion => artwork[id]?.occasion ?? h?.participants.find(p => p.id === id)?.occasion ?? (view.characters.find(c => c.id === id)?.swimming && h?.location === 'backyard' ? 'beach' : h?.occasion ?? 'daily');

  if (live.respond) {
    const sc = useGame.getState().scenes.find((s) => s.id === live.id);
    return (
      <div className="flex h-full flex-col">
        <TopBar /><Tip id="talk" />
        <main className="flex flex-1 items-center justify-center p-6">
          <div className="px-panel max-w-lg p-6 text-center">
            <p className="caption mb-2 text-sm">you can hear a conversation nearby</p>
            <p className="mb-5">{sc?.premise}</p>
            <div className="flex justify-center gap-3">
              <Btn primary autoFocus onClick={() => void respond('join')}>join in</Btn>
              <Btn onClick={() => void respond('eavesdrop')}>eavesdrop</Btn>
              <Btn onClick={() => void respond('ignore')}>leave them be</Btn>
            </div>
            <p className="caption mt-3 text-xs">eavesdropping might get you noticed.</p>
          </div>
        </main>
        <StudioStrip />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="relative min-h-0 flex-1 overflow-hidden bg-[#2a2433]" onClick={() => !reveal.complete && reveal.skip()}>
        {/* background */}
        <div className="absolute inset-0">
          {bg?.url ? <PixelImage url={bg.url} factor={6} alt={h?.locationName ?? 'location'} className="h-full w-full" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div className="h-full w-full bg-gradient-to-b from-[#cfe6f7] to-[#f8e1d0]" />}
          {(view.weather === 'rain' || view.weather === 'typhoon') && !chat && h && isOutdoors(h.location) && <div className="rain-overlay absolute inset-0" />}
          {view.slot === 'evening' && <div className="absolute inset-0 bg-[rgb(30_30_80/0.25)]" />}
        </div>
        {/* header */}
        {h && (
          <div className="absolute left-3 top-3 z-10 px-panel max-w-md px-3 py-2">
            <div className="text-sm lowercase">{h.title}</div>
            <div className="caption text-xs">{h.locationName}{h.eavesdrop ? ' · eavesdropping' : ''}</div>
            <p className="mt-1 text-xs">{h.premise}</p>
          </div>
        )}
        {!h && <div className="absolute inset-0 flex items-center justify-center text-paper">setting the scene<span className="blink">…</span></div>}
        {h?.broadcast?.days && <aside className="absolute left-4 top-28 z-20 max-h-[42%] w-80 overflow-y-auto px-panel p-3 scroll-thin" aria-label="episode highlights on TV">
          <h2 className="mb-2 text-sm">episode {h.broadcast.episode} · days {h.broadcast.days.start}–{h.broadcast.days.end}</h2>
          {h.broadcast.highlights.map((moment, i) => <p key={i} className="reply-text mb-3"><span className="caption">day {moment.day}:</span> {moment.text}</p>)}
          {h.broadcast.scenes.map((scene, i) => <details key={i} className="mb-2"><summary className="text-sm">day {scene.day} · {scene.title}</summary>{scene.lines.map((line, j) => <p key={j} className="reply-text"><span className="caption">{line.name}:</span> {line.text}</p>)}</details>)}
          <section aria-label="panel commentary on TV"><h3 className="mb-2 text-sm">the panel, on TV</h3>{h.broadcast.panel.map((line, i) => <p key={i} className="reply-text mb-3"><span className="caption">day {line.day} · {line.name}:</span> {line.text}</p>)}</section>
        </aside>}
        {h && (stage.length > 0 || h.participants.some(p => p.id === view.playerId)) && (
          <div className="absolute right-3 top-3 z-20 flex flex-wrap justify-end gap-2">
    {!chat && stage.length > 0 && <SceneArtwork key={live.id} people={stage.map(c => ({ id: c.id, name: c.name, occasion: occasionOf(c.id), emotion: emotionOf(c.id), outfit: artwork[c.id]?.outfit, customExpression: artwork[c.id]?.line === reveal.idx ? artwork[c.id]?.customExpression : undefined }))} day={view.day} disabled={live.streaming || !settings.images} onReady={(id, occasion, emotion, outfit, customExpression) => setArtwork(prev => ({ ...prev, [id]: { occasion, emotion, outfit, customExpression, line: reveal.idx, version: (prev[id]?.version ?? 0) + 1 } }))} />}
            {h.participants.some(p => p.id === view.playerId) && h.participants.length >= 2 && <Btn disabled={live.streaming || imageBusy || !settings.images} onClick={() => void generateScene()} title={!settings.images ? 'Enable images in settings to generate a scene' : live.streaming ? 'Available when the current dialogue finishes' : 'Illustrate this conversation'}>
              {imageBusy ? 'generating scene…' : 'generate scene'}
            </Btn>}
            {sceneImg?.status === 'ready' && <Btn className="ml-2" onClick={() => setImageOpen(true)}>view scene</Btn>}
          </div>
        )}
        {h?.intro && (
          <div key={h.intro.id} className="intro-card pointer-events-none absolute left-1/2 top-1/2 z-30 flex -translate-x-1/2 -translate-y-1/2 items-center gap-4 px-panel p-4" role="note" aria-label="new housemate">
            {(() => {
              const c = view.characters.find((x) => x.id === h.intro!.id);
              return c ? <Portrait charId={c.id} appearance={c.appearance} gender={c.gender} seed={c.portraitSeed} size={110} label={c.name} /> : null;
            })()}
            <div>
              <div className="caption text-xs">new housemate</div>
              <div className="text-2xl">{h.intro.name}</div>
              <div className="text-sm">{h.intro.age} · {h.intro.occupation}</div>
              <div className="caption text-xs">from {h.intro.hometown}</div>
            </div>
          </div>
        )}
        {/* visual-novel stage: cut-out figures stand on the location; the speaker steps forward, the rest drop back */}
        {!chat && h && (
          <div role="group" aria-label="people in this conversation" className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-center" style={{ top: '6%', right: live.choice && reveal.complete && !live.streaming ? 304 : 0 }}>
            {stage.map((c, i) => {
              const speaking = lastSpeaker === c.id;
              const occasion = occasionOf(c.id);
              return (
                <div key={c.id} className={`flex h-full items-end transition-all duration-300 `} style={{ marginLeft: i ? `-${stage.length > 2 ? 6 : 2}vw` : 0, zIndex: speaking ? 5 : 1, transform: speaking ? 'translateY(-1%) scale(1.02)' : 'none', filter: lastSpeaker && !speaking ? 'brightness(0.68) saturate(0.85)' : 'none' }}>
                  <Stand key={`${view.gameId}:${c.id}`} refresh={`${JSON.stringify(c.expressionEdits)}:${artwork[c.id]?.version}`} char={c} outfit={{ occasion, day: view.day, outfit: artwork[c.id]?.outfit, customExpression: artwork[c.id]?.line === reveal.idx ? artwork[c.id]?.customExpression : undefined }} emotion={emotionOf(c.id)} height={stage.length <= 2 ? '92%' : stage.length <= 3 ? '80%' : '68%'} />
                </div>
              );
            })}
            {h.outsiders.map((o) => (
              <div key={o.id} className="flex h-full items-end" style={{ zIndex: lastSpeaker === o.id ? 5 : 1, filter: lastSpeaker && lastSpeaker !== o.id ? 'brightness(0.68)' : 'none' }}>
                <Stand key={`${view.gameId}:${o.id}`} char={o} outfit={{ occasion: occasionOf(o.id), day: view.day }} emotion={emotionOf(o.id)} height="92%" />
              </div>
            ))}
          </div>
        )}
        {/* dialogue box or phone */}
        {chat ? (
          <div className="absolute left-1/2 top-1/2 z-10 flex h-[70%] w-80 -translate-x-1/2 -translate-y-1/2 flex-col rounded-[18px] bg-[#2b2b33] p-3">
            <div className="caption mb-2 text-center text-xs text-paper">messages</div>
            <div ref={logRef} className="flex flex-1 flex-col gap-2 overflow-y-auto rounded-[10px] bg-[#f4f6f8] p-2 scroll-thin" aria-live="polite">
              {visible.map((l, i) => {
                const mine = l.speaker === view.playerId;
                const text = i === reveal.idx ? l.text.slice(0, reveal.chars) : l.text;
                return (
                  <div key={l.index} className={`reply-text max-w-[80%] px-2 py-1 ${mine ? 'self-end bg-[#9fe0b0]' : 'self-start bg-white'}`} style={{ borderRadius: 10, boxShadow: '0 1px 0 rgba(0,0,0,.15)' }}>
                    {!mine && <div className="caption text-[0.65rem]">{l.name}</div>}
                    {text}
                  </div>
                );
              })}
              {live.streaming && !live.choice && <div className="caption self-start text-xs">typing<span className="blink">…</span></div>}
            </div>
          </div>
        ) : (
          <div className="absolute bottom-3 left-3 right-3 z-10" style={{ right: live.choice && reveal.complete && !live.streaming ? 316 : 12 }}>
            {/* name tag over the box, visual-novel style */}
            {current && (
              <div className="relative z-10 -mb-2 ml-4 inline-block bg-paper px-4 py-1 text-lg lowercase" style={{ boxShadow: '0 0 0 3px var(--color-ink), 4px 4px 0 var(--color-ink)' }}>
                {current.speaker === view.playerId ? 'you' : current.name}
              </div>
            )}
            <div className="px-panel bg-paper/90 p-4 pt-5 backdrop-blur-[2px]">
              <div ref={logRef} className="max-h-[35vh] min-h-28 overflow-y-auto pr-2 scroll-thin" aria-live="polite">
                {visible.map((l, i) => {
                  const text = i === reveal.idx ? l.text.slice(0, reveal.chars) : l.text;
                  return (
                    <p key={l.index} className={`reply-text mt-2 ${l.speaker === 'narrator' ? 'italic text-ink-soft' : ''}`}>
                      <span className="caption mr-2 text-sm">{l.speaker === view.playerId ? 'you' : l.name}:</span>
                      {settings.captions && l.caption && <span className="caption mr-2 text-xs">{l.caption}</span>}
                      <span>{text}</span>
                    </p>
                  );
                })}
                {live.streaming && !live.choice && visible.length === 0 && <p className="caption">…</p>}
                {live.error && <p className="caption text-xs">({live.error}) </p>}
              </div>
              {/* the player answers in their own words right in the box */}
              {live.choice && reveal.complete && !live.streaming && live.canType && <div className="mt-2"><SayBox onSay={(t) => void say(t, recipientId)} autoFocus wide /></div>}
            </div>
          </div>
        )}
        {/* choices */}
        {live.choice && reveal.complete && !live.streaming && (
          <div className="absolute right-4 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-2" role="group" aria-label="how do you respond?">
            <div className="caption bg-paper px-2 text-xs" style={{ boxShadow: '0 0 0 2px var(--color-ink)' }}>
              how do you respond?
            </div>
            {live.recipients.length >= 2 && (
              <label className="px-panel-soft flex flex-col gap-1 bg-paper p-2 text-xs">
                reply to
                <select aria-label="reply to" className="max-w-64 bg-paper p-1 text-sm" value={recipientId ?? ''} onChange={e => setRecipient(e.target.value)}>
                  <option value="">Automatic</option>
                  <option value="everyone">Everyone</option>
                  {live.recipients.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            )}
            {live.choice.map((c, i) => (
              <Btn key={c} onClick={() => void choose(c, recipientId)}>
                {i + 1}. {INTENT_LABEL[c] ?? c}
              </Btn>
            ))}
            {live.canType && chat && <SayBox onSay={(t) => void say(t, recipientId)} autoFocus={live.canEnd} />}
            {live.inviteNote && <div role="status" className="caption bg-paper px-2 text-xs" style={{ boxShadow: '0 0 0 2px var(--color-ink)' }}>{live.inviteNote}</div>}
            {invite && <Btn primary onClick={() => void hangOut(invite)} title={`go to ${invite.placeName} together`}>{invite.activity === 'talk' ? `go to ${invite.placeName} with ${invite.names}` : `${invite.activity === 'date' ? 'go on a date' : 'hang out'} with ${invite.names} · ${invite.placeName}`}</Btn>}
            <InviteBox people={stage.filter(c => c.status === 'inHouse')} options={inviteOptions} onInvite={(node, date, who) => void inviteTo(node, date, who)} />
            {!chat && roomCompany.length > 0 && content().house.rooms.some(r => r.id === view.playerLocation) && (
              <div className="px-panel-soft flex flex-col gap-2 bg-paper p-2">
                <label className="flex flex-col gap-1 text-xs">continue in another room<select aria-label="move conversation to" className="bg-paper p-1 text-sm" value={meetingRooms.some(r => r.id === meetingRoom) ? meetingRoom : meetingRooms[0]?.id ?? ''} onChange={e => setMeetingRoom(e.target.value)}>{meetingRooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
                <Btn onClick={() => { const room = meetingRooms.find(r => r.id === meetingRoom) ?? meetingRooms[0]; if (room) void hangOut({ from: roomCompany[0].id, name: roomCompany[0].name, names: roomCompany.map(c => c.name.split(' ')[0]).join(' and '), guests: roomCompany.slice(1).map(c => c.id), node: room.id, activity: 'talk', placeName: room.name }); }}>go together & talk</Btn>
              </div>
            )}
            {live.canListen && <Btn onClick={() => void keepListening()} title="stay quiet and let them talk among themselves">keep listening…</Btn>}
            {live.canRetry && <Btn onClick={() => { reveal.reset(Math.max(0, live.lines.findLastIndex(l => l.speaker === view.playerId) + 1)); void useGame.getState().submitChoice({ retry: true }); }}>retry reply</Btn>}
            {live.canEnd && (
              <Btn primary onClick={() => void endTalk()}>
                that's all
              </Btn>
            )}
          </div>
        )}
        {live.error && !live.streaming && <div className="absolute right-4 top-20 z-30 px-panel p-3" role="alert"><p>{live.error}</p><Btn onClick={() => void useGame.getState().playLive(live.id)}>retry connection</Btn></div>}
        {/* freeze frame */}
        {phaseShown === 'freeze' && live.freeze && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-[rgb(20_16_28/0.75)]" onClick={() => setPhaseShown('panel')}>
            <div className="relative max-h-[80%] max-w-[80%] overflow-hidden px-panel">
              {freezeImg?.url ? <img src={freezeImg.url} alt={live.freeze.caption} className="freeze-zoom block" style={{ width: 640, maxWidth: '100%' }} /> : <div className="flex h-64 w-[480px] items-center justify-center bg-[#3a2e3f] text-paper">developing<span className="blink">…</span></div>}
              <div className="absolute bottom-3 left-3 bg-paper px-2 text-sm lowercase" style={{ boxShadow: '0 0 0 2px var(--color-ink)' }}>
                {live.freeze.caption}
              </div>
            </div>
            <div className="absolute bottom-6">
              <Btn autoFocus onClick={() => setPhaseShown('panel')}>
                to the studio
              </Btn>
            </div>
          </div>
        )}
        {/* outcome + continue */}
        {phaseShown === 'panel' && (
          <div className="absolute right-4 top-4 z-20 flex max-w-sm flex-col items-end gap-2">
            {live.arrivalPending && <p role="status" className="px-panel p-3">The doorbell rings — {live.arrivalPending} has arrived. Your conversation pauses to welcome them.</p>}
            {live.outcome?.cues.map((c, i) => (
              <div key={i} className="slide-up px-panel px-3 py-1 text-sm">
                {c}
              </div>
            ))}
            {(live.outcome?.leaving?.length ?? 0) > 0 && <div className="luggage text-3xl" aria-hidden>🧳</div>}
            <Btn primary autoFocus onClick={() => void nextScene()}>
              {live.arrivalPending ? `meet ${live.arrivalPending}` : 'continue'}
            </Btn>
            {lateInvite && <Btn onClick={() => void hangOut(lateInvite)} title={`go to ${lateInvite.placeName} together`}>{lateInvite.activity === 'talk' ? `go to ${lateInvite.placeName} with ${lateInvite.names}` : `${lateInvite.activity === 'date' ? 'go on a date' : 'hang out'} with ${lateInvite.names} · ${lateInvite.placeName}`}</Btn>}
            {h?.moveIn && h.intro && !live.arrivalPending && stage.length >= 2 && (
              <div className="px-panel flex flex-col gap-2 p-3" role="group" aria-label="who will you keep talking with?">
                <p className="text-sm">Who will you keep talking with?</p>
                {stage.map(c => <Btn key={c.id} disabled={live.streaming} onClick={() => void (async () => { await finishSlot(); if (!useGame.getState().error) await act({ type: 'talk', target: c.id }); })()}>keep talking with {c.name.split(' ')[0]}</Btn>)}
                <p className="caption text-xs">Choose continue to explore the house instead.</p>
              </div>
            )}
          </div>
        )}
      </main>
      <dialog ref={imageDialog} aria-label="generated scene" onClose={() => setImageOpen(false)} className="px-panel m-auto max-h-[85vh] max-w-[90vw] overflow-y-auto bg-paper p-3 backdrop:bg-black/70">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2>generated scene</h2>
          <Btn autoFocus onClick={() => setImageOpen(false)}>close</Btn>
        </div>
        {sceneImg?.status === 'ready' && sceneImg.url ? <img src={sceneImg.url} alt="illustration of the current conversation" style={{ width: 720, maxWidth: '100%', height: 'auto' }} /> : <div role="status" className="flex h-64 w-[min(720px,75vw)] items-center justify-center text-sm">{imageError || (sceneImg?.status === 'failed' || sceneImg?.status === 'cancelled' ? 'Image unavailable. Close this window and try again.' : sceneImg?.status === 'queued' ? 'Scene queued. You can close this window and keep talking.' : 'Generating scene… You can close this window and keep talking.')}</div>}
        {sceneImg?.status === 'ready' && <p className="caption mt-2 text-xs">{sceneImg.placeholder ? 'Temporary preview: image service unavailable.' : 'AI illustration based on this conversation.'}</p>}
      </dialog>
      <StudioStrip expanded={phaseShown === 'panel'} lines={live.commentary?.lines} prediction={live.commentary?.prediction} />
    </div>
  );
}

/** Type your own words instead of picking a response; the housemate answers what you actually said. */
function SayBox({ onSay, autoFocus, wide }: { onSay: (text: string) => void; autoFocus?: boolean; wide?: boolean }) {
  const [text, setText] = useState('');
  return (
    <form
      className={`flex gap-1 ${wide ? 'w-full' : ''}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onSay(text);
      }}
    >
      <input
        aria-label="say something in your own words"
        placeholder={wide ? 'say something… (address someone by name, or everyone)' : 'or say it yourself…'}
        className={`px-panel-soft bg-paper px-2 py-1 text-sm ${wide ? 'flex-1 text-base' : 'w-56'}`}
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => setText(e.target.value)}
      />
      <button type="submit" className="px-btn text-xs" disabled={!text.trim()}>
        say
      </button>
    </form>
  );
}

/** Ask a housemate to come along: the answer comes from how they feel about you and how the talk has gone. */
function InviteBox({ people, options, onInvite }: { people: { id: string; name: string }[]; options: { id: string; name: string; date: boolean }[]; onInvite: (node: string, date: boolean, who: string) => void }) {
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState('');
  const [node, setNode] = useState('');
  const [date, setDate] = useState(false);
  const target = people.some(p => p.id === who) ? who : people[0]?.id ?? '';
  const place = options.find(o => o.id === node) ?? options[0];
  if (!people.length || !place) return null;
  if (!open) return <Btn onClick={() => setOpen(true)} title="ask a housemate to go somewhere with you">invite someone out…</Btn>;
  return (
    <div className="px-panel-soft flex flex-col gap-2 bg-paper p-2 text-xs" role="group" aria-label="invite someone">
      {people.length > 1 && <label className="flex flex-col gap-1">invite<select aria-label="invite who" className="bg-paper p-1 text-sm" value={target} onChange={e => setWho(e.target.value)}>{people.map(p => <option key={p.id} value={p.id}>{p.name.split(' ')[0]}</option>)}</select></label>}
      <label className="flex flex-col gap-1">to<select aria-label="invite to" className="bg-paper p-1 text-sm" value={place.id} onChange={e => { setNode(e.target.value); setDate(false); }}>{options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
      {place.date && <label className="flex items-center gap-1"><input type="checkbox" checked={date} onChange={e => setDate(e.target.checked)} />as a date</label>}
      <div className="flex gap-2"><Btn primary onClick={() => { onInvite(place.id, date && place.date, target); setOpen(false); }}>ask {people.find(p => p.id === target)?.name.split(' ')[0]}</Btn><Btn onClick={() => setOpen(false)}>never mind</Btn></div>
    </div>
  );
}

export const imageStatus = api.imageStatus;
