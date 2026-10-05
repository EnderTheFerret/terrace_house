import { useEffect, useRef, useState } from 'react';
import { api, type GalleryScene } from '../api';
import { Btn } from '../components/ui';
import { useGame } from '../store';

export function Gallery() {
  const galleryBack = useGame((s) => s.galleryBack);
  const setScreen = useGame((s) => s.setScreen);
  const [scenes, setScenes] = useState<GalleryScene[] | null>(null);
  const [error, setError] = useState('');
  const [revision, refresh] = useState(0);
  const [selected, select] = useState<GalleryScene | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let active = true;
    setError('');
    setScenes(null);
    api.gallery().then((r) => { if (active) setScenes(r.scenes); }).catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [revision]);
  useEffect(() => {
    if (selected) dialog.current?.showModal();
    else dialog.current?.close();
  }, [selected]);
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b-[3px] border-ink bg-paper p-3">
        <h1 className="text-lg">scene gallery</h1>
        <Btn className="ml-auto text-xs" onClick={() => refresh((n) => n + 1)}>refresh</Btn>
        <Btn className="text-xs" onClick={() => setScreen(galleryBack)}>back</Btn>
      </header>
      <main className="flex-1 overflow-y-auto p-4 scroll-thin">
        <p className="caption mb-4 text-sm">Generated conversations and freeze frames from all seasons. Select a scene to view it.</p>
        {error ? <p role="alert">Could not load scenes: {error}. Use refresh to try again.</p> : scenes === null ? <p role="status">Loading scenes…</p> : scenes.length === 0 ? <p>No generated scenes yet. Use “generate scene” during a conversation. Finished illustrations appear here automatically; temporary offline previews are not saved in the gallery.</p> : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {scenes.map((scene, i) => (
              <button key={scene.url} className="px-panel overflow-hidden p-2 text-left" onClick={() => select(scene)} aria-label={`view scene ${scenes.length - i}`}>
                <img src={scene.url} alt={`generated scene ${scenes.length - i}`} loading="lazy" className="h-48 w-full object-contain" />
                <span className="caption mt-2 block text-xs">{new Date(scene.createdAt.replace(' ', 'T') + 'Z').toLocaleString()}</span>
              </button>
            ))}
          </div>
        )}
      </main>
      <dialog ref={dialog} aria-label="gallery scene" onClose={() => select(null)} className="px-panel m-auto max-h-[90vh] max-w-[95vw] overflow-auto bg-paper p-3 backdrop:bg-black/70">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2>generated scene</h2>
          {selected && <a href={selected.url} target="_blank" rel="noreferrer" className="underline text-sm">open original</a>}
          <Btn autoFocus onClick={() => select(null)}>close</Btn>
        </div>
        {selected && <img src={selected.url} alt="selected generated scene" className="block max-h-[75vh] max-w-[85vw] object-contain" />}
      </dialog>
    </div>
  );
}
