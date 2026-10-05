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
  useEffect(() => {
    api.dayLog().then(setLog).catch((e: Error) => setError(e.message));
  }, []);
  const reread = async (id: string) => {
    setWorking(id);
    setError('');
    try {
      const r = await api.reread(id);
      setView(r.view);
      setLog(r.log);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(null);
    }
  };
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="min-h-0 flex-1 overflow-auto p-4 scroll-thin">
        <Panel title={`chat log · episode ${log?.episode ?? ''}`}>
          <div className="mb-3 flex items-center gap-3">
            <Btn className="text-xs" onClick={goBack}>back</Btn>
            <p className="caption text-xs">
              "re-read" asks the model to read the scene again: affinity, romance, trust and tension are corrected to match what was actually said (only the difference is added), and fresh memories are saved. Once per scene.
            </p>
          </div>
          {error && <p role="alert" className="mb-3 text-sm">{error}</p>}
          {log && !log.scenes.length && <p className="caption text-sm">no finished conversations today yet.</p>}
          {log?.scenes.map((sc) => (
            <section key={sc.id} className="mb-5">
              <div className="mb-1 flex flex-wrap items-center gap-3">
                <h3 className="text-sm">{sc.title} <span className="caption text-xs">· {sc.location}</span></h3>
                <Btn className="text-xs" disabled={sc.reread || working !== null} onClick={() => void reread(sc.id)}>
                  {working === sc.id ? 're-reading…' : sc.reread ? 're-read ✓' : 're-read this scene'}
                </Btn>
              </div>
              <ul className="text-sm">
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
