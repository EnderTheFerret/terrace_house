// Episode title card (with "previously") and end card (with teaser).
import { useGame } from '../store';
import { Btn } from '../components/ui';

export function EpisodeCard() {
  const { view, episodeCard, setScreen } = useGame();
  if (!view) return null;
  if (episodeCard === 'end') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 bg-[#2a2433] text-paper">
        <div className="caption text-sm text-[#c9b4ef]">end of episode {view.episode - 1}</div>
        <p className="max-w-xl px-6 text-center text-xl">{view.teaser}</p>
        <Btn primary autoFocus onClick={() => useGame.setState({ episodeCard: 'start' })}>
          next episode
        </Btn>
      </div>
    );
  }
  return (
    <div className="fade-in flex h-full flex-col items-center justify-center gap-5">
      <div className="caption text-sm">{view.dateLabel} · {view.season}</div>
      <h1 className="text-6xl tracking-[0.2em]">EPISODE {view.episode}</h1>
      {view.cityEvent && <div className="px-panel px-3 py-1 text-sm">today: {view.cityEvent.name}</div>}
      {view.previously && (
        <div className="px-panel max-w-xl p-4 text-sm">
          <div className="caption mb-1 text-xs">previously</div>
          {view.previously}
        </div>
      )}
      <Btn
        primary
        autoFocus
        onClick={() => {
          useGame.setState({ episodeCard: null, showDigest: false });
          setScreen('house');
        }}
      >
        begin
      </Btn>
    </div>
  );
}
