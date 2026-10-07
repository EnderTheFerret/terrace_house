import { useEffect, useState } from 'react';
import { locationSvg } from '@shared-roof/shared';
import { useGame } from '../store';
import { Btn, HealthBadge } from '../components/ui';
import { unlockAudio } from '../audio';

export function Title() {
  const { view, setScreen, health, resume } = useGame();
  const unfinished = useGame((st) => st.scenes.some((x) => x.rendered && x.phase !== 'done'));
  const [art, setArt] = useState(true);
  useEffect(() => {
    const img = new Image();
    img.onerror = () => setArt(false);
    img.src = '/assets/tel-aviv-title.png';
  }, []);
  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden" onClick={unlockAudio}>
      <img src={art ? '/assets/tel-aviv-title.png' : `data:image/svg+xml,${encodeURIComponent(locationSvg('house', 'evening', 'sunny'))}`} alt="" className="pixelated absolute inset-0 h-full w-full object-cover opacity-90" />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[rgb(253_246_236/0.25)] to-[rgb(253_246_236/0.9)]" />
      <div className="relative z-10 flex flex-col items-center gap-6">
        <div className="px-panel px-8 py-5 text-center">
          <h1 className="text-5xl lowercase tracking-wide">shared roof</h1>
          <p className="caption mt-2 text-sm">six strangers. one house. a panel watching everything.</p>
        </div>
        <nav className="flex flex-col gap-3" aria-label="main menu">
          <Btn primary onClick={() => setScreen('creator')} autoFocus>
            new season
          </Btn>
          <Btn disabled={!view} onClick={() => { if (unfinished && !view?.seasonOver) return void resume(); if (!view?.seasonOver) useGame.setState({ episodeCard: 'start' }); setScreen(view?.seasonOver ? 'summary' : 'episode'); }}>
            continue{view ? ` · episode ${view.episode}` : ''}
          </Btn>
          <Btn onClick={() => setScreen('saves')}>load</Btn>
          <Btn onClick={() => setScreen('gallery')}>scene gallery</Btn>
          <Btn disabled={!view} onClick={() => setScreen('sprites')}>sprite library</Btn>
          <Btn onClick={() => setScreen('practice')}>practice cooking</Btn>
          <Btn onClick={() => setScreen('guide')}>activity guide</Btn>
          <Btn onClick={() => setScreen('settings')}>settings</Btn>
        </nav>
        <HealthBadge />
        {health?.mode === 'mock' && <p className="caption text-xs">mock mode: all text & images are generated locally from templates</p>}
      </div>
      <p className="caption absolute bottom-3 text-[0.7rem]">an original life-sim inspired by slow reality tv · all characters are fictional adults</p>
    </div>
  );
}
