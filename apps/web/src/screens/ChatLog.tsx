// Today's conversations as written, with a button to have the dialogue model read a scene again and correct what it changed.
import { useEffect, useState } from 'react';
import { api, type DayLog } from '../api';
import { useGame } from '../store';
import { TopBar } from '../components/layout';
import { Btn, Panel } from '../components/ui';

export function ChatLog() {
  const { goBack, setView } = useGame();
  const [log, setLog] = useState<DayLog | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    api.dayLog().then(setLog).catch((e: Error) => setError(e.message));
  }, []);
  const readingPending = log?.scenes.some((sc) => sc.reading === 'pending');
  useEffect(() => {
    if (!readingPending) return;
    let active = true;
    const timer = setInterval(() => {
      api.dayLog().then(async (next) => {
        if (!active) return;
        if (!next.scenes.some((sc) => sc.reading === 'pending')) {
          const r = await api.game();
          if (active) setView(r.view);
        }
        if (active) setLog(next);
      }).catch((e: Error) => { if (active) setError(e.message); });
    }, 1500);
    return () => { active = false; clearInterval(timer); };
  }, [readingPending, setView]);
  const reread = async (ids: string[]) => {
    const failures: string[] = [];
    let completed = 0;
    setNotice('');
    setError('');
    for (const id of ids) {
      setWorking(id);
      try {
        const r = await api.reread(id);
        setView(r.view);
        setLog(r.log);
        completed++;
      } catch (e) {
        failures.push(`${log?.scenes.find(sc => sc.id === id)?.title ?? id}: ${(e as Error).message}`);
      }
    }
    setWorking(null);
    setError(failures.join(' · '));
    setNotice(`${completed} of ${ids.length} conversations re-read.${completed ? ' The board reflects the completed readings.' : ''}${failures.length ? ' Failed readings can be retried.' : ''}`);
  };
  const eligible = log?.scenes.filter(sc => !sc.overheard && sc.reading !== 'pending') ?? [];
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="min-h-0 flex-1 overflow-auto p-4 scroll-thin">
        <Panel title={`chat log · episode ${log?.episode ?? ''}`}>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <Btn className="text-xs" onClick={goBack}>back</Btn>
            <Btn className="text-xs" disabled={working !== null || !eligible.length} onClick={() => void reread(eligible.map(sc => sc.id))}>re-read all</Btn>
            <p className="caption text-xs">
              "re-read" asks the dialogue model to read the scene again: affinity, romance, trust and tension are corrected to match what was actually said, and fresh memories are saved. Re-reading replaces the previous reading; it does not add the same effect twice. Re-read all covers today's finished scenes; pending readings and overheard chats are skipped.
            </p>
          </div>
          {error && <p role="alert" className="mb-3 text-sm">{error}</p>}
          {notice && <p role="status" className="mb-3 text-sm">{notice}</p>}
          {log && !log.scenes.length && <p className="caption text-sm">no finished conversations today yet.</p>}
          {log?.scenes.map((sc) => (
            <section key={sc.id} className="mb-5">
              <div className="mb-1 flex flex-wrap items-center gap-3">
                <h3 className="text-sm">{sc.title} <span className="caption text-xs">· {sc.location}</span></h3>
                {sc.overheard ? <span className="caption text-xs">overheard</span> : (
                  <Btn className="text-xs" disabled={sc.reading === 'pending' || working !== null} onClick={() => void reread([sc.id])}>
                    {working === sc.id ? 're-reading…' : sc.reread ? 're-read again' : 're-read this scene'}
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
