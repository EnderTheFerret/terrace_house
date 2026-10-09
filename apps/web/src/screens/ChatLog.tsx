// Each day's conversations as written, with a button to have the dialogue model read a scene again and correct what it
// changed. Today's page also lists text threads, which a re-read checks for plans agreed in the messages.
import { useEffect, useState } from 'react';
import { api, type DayLog } from '../api';
import { useGame } from '../store';
import { TopBar } from '../components/layout';
import { Btn, Panel } from '../components/ui';

export function ChatLog() {
  const { goBack, setView } = useGame();
  const [log, setLog] = useState<DayLog | null>(null);
  const [day, setDay] = useState<number | undefined>(undefined);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    api.dayLog(day).then(setLog).catch((e: Error) => setError(e.message));
  }, [day]);
  const readingPending = log?.scenes.some((sc) => sc.reading === 'pending');
  useEffect(() => {
    if (!readingPending) return;
    let active = true;
    const timer = setInterval(() => {
      api.dayLog(day).then(async (next) => {
        if (!active) return;
        if (!next.scenes.some((sc) => sc.reading === 'pending')) {
          const r = await api.game();
          if (active) setView(r.view);
        }
        if (active) setLog(next);
      }).catch((e: Error) => { if (active) setError(e.message); });
    }, 1500);
    return () => { active = false; clearInterval(timer); };
  }, [readingPending, setView, day]);
  const [progress, setProgress] = useState('');
  const reread = async (items: { id: string; title: string }[]) => {
    const failures: string[] = [];
    const notes: string[] = [];
    let completed = 0;
    setNotice('');
    setError('');
    for (const [i, { id, title }] of items.entries()) {
      setWorking(id);
      if (items.length > 1) setProgress(`re-reading ${i + 1} of ${items.length}: ${title}…`);
      try {
        const r = await api.reread(id);
        setView(r.view);
        // the server answers with the day it read; keep showing the day being browsed
        setLog(r.log.episode === (log?.episode ?? r.log.episode) ? r.log : await api.dayLog(day));
        if (r.note) notes.push(`${title}: ${r.note}`);
        completed++;
      } catch (e) {
        failures.push(`${title}: ${(e as Error).message}`);
      }
    }
    setWorking(null);
    setProgress('');
    setError(failures.join(' · '));
    setNotice(`${completed} of ${items.length} conversations re-read.${completed ? ' The board and plans reflect the completed readings.' : ''}${failures.length ? ' Failed readings can be retried.' : ''}${notes.length ? ` ${notes.join(' · ')}` : ''}`);
  };
  const readable = (l: DayLog) => l.scenes.filter(sc => !sc.overheard && sc.reading !== 'pending').map(sc => ({ id: sc.id, title: sc.phone ? sc.title : `day ${l.episode} · ${sc.title}` }));
  const eligible = log ? readable(log).filter(sc => !sc.id.startsWith('phone:')) : [];
  // every day from the first, in order, so each reading sees the memories the earlier ones left; then the text threads
  const rereadEverything = async () => {
    if (!log) return;
    setProgress('collecting conversations from every day…');
    const days = await Promise.all(Array.from({ length: log.today }, (_, i) => api.dayLog(i + 1)));
    const all = days.flatMap(readable);
    await reread([...all.filter(sc => !sc.id.startsWith('phone:')), ...all.filter(sc => sc.id.startsWith('phone:'))]);
  };
  const shown = log?.episode ?? 1;
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="min-h-0 flex-1 overflow-auto p-4 scroll-thin">
        <Panel title={`chat log · day ${log?.episode ?? ''}`}>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <Btn className="text-xs" onClick={goBack}>back</Btn>
            <Btn className="text-xs" disabled={!log || shown <= 1 || working !== null} onClick={() => setDay(shown - 1)}>← earlier day</Btn>
            <Btn className="text-xs" disabled={!log || shown >= log.today || working !== null} onClick={() => setDay(shown + 1)}>later day →</Btn>
            <Btn className="text-xs" disabled={working !== null || !!progress || !log} onClick={() => void rereadEverything()}>re-read all days</Btn>
            <Btn className="text-xs" disabled={working !== null || !!progress || !eligible.length} onClick={() => void reread(eligible)}>re-read this day</Btn>
            <p className="caption text-xs">
              "re-read" asks the dialogue model to read the scene again: affinity, romance, trust and tension are corrected to match what was actually said, and fresh memories are saved (dated to that day). Re-reading replaces the previous reading; it does not add the same effect twice. "Re-read all days" goes through every finished scene from day 1 to today, in order, then checks today's texts for plans (older texts were already read when they were sent); "re-read this day" covers only the day shown. Pending readings and overheard chats are skipped.
            </p>
          </div>
          {progress && <p role="status" className="mb-3 text-sm">{progress}</p>}
          {error && <p role="alert" className="mb-3 text-sm">{error}</p>}
          {notice && <p role="status" className="mb-3 text-sm">{notice}</p>}
          {log && !log.scenes.length && <p className="caption text-sm">no finished conversations on this day.</p>}
          {log?.scenes.map((sc) => (
            <section key={sc.id} className="mb-5">
              <div className="mb-1 flex flex-wrap items-center gap-3">
                <h3 className="text-sm">{sc.title} <span className="caption text-xs">· {sc.location}</span></h3>
                {sc.overheard ? <span className="caption text-xs">overheard</span> : (
                  <Btn className="text-xs" disabled={sc.reading === 'pending' || working !== null || !!progress} onClick={() => void reread([{ id: sc.id, title: sc.title }])}>
                    {working === sc.id ? 're-reading…' : sc.phone ? 'check texts for plans' : sc.reread ? 're-read again' : 're-read this scene'}
                  </Btn>
                )}
                {sc.reading && <span className="caption text-xs" role="status">{sc.reading === 'pending' ? 'reading what you said…' : sc.reading === 'applied' ? 'relationships updated from your words' : 'reading unavailable · usual outcome kept'}</span>}
              </div>
              <ul className="reply-text">
                {sc.lines.map((l, i) => (
                  <li key={i}><span className="caption">{l.name}:</span> {l.text}</li>
                ))}
              </ul>
            </section>
          ))}
        </Panel>
      </main>
    </div>
  );
}
