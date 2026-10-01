import { useEffect, type ReactElement } from 'react';
import { useGame, type Screen } from './store';
import { Title } from './screens/Title';
import { Creator } from './screens/Creator';
import { House } from './screens/House';
import { Scene } from './screens/Scene';
import { EpisodeCard } from './screens/Episode';
import { Studio } from './screens/Studio';
import { Phone } from './screens/Phone';
import { Board } from './screens/Board';
import { Bible, Fridge, Saves, Settings, Summary } from './screens/Info';
import { Debug } from './screens/Debug';
import { CityMap } from './screens/CityMap';
import { Cooking } from './screens/Cooking';
import { ErrorToast } from './components/ui';

const screens: Record<Screen, () => ReactElement | null> = {
  title: Title,
  creator: Creator,
  house: House,
  map: CityMap,
  scene: Scene,
  cooking: () => <Cooking />,
  practice: () => <Cooking practice />,
  phone: Phone,
  board: Board,
  bible: Bible,
  fridge: Fridge,
  debug: Debug,
  summary: Summary,
  settings: Settings,
  saves: Saves,
  episode: EpisodeCard,
  studio: Studio,
};

const NEEDS_GAME: Screen[] = ['house', 'map', 'scene', 'cooking', 'phone', 'board', 'bible', 'fridge', 'debug', 'summary', 'episode', 'studio'];

export function App() {
  const { screen, settings, boot, view } = useGame();
  useEffect(() => {
    void boot();
    const t = setInterval(() => void useGame.getState().refreshHealth(), 30000);
    return () => clearInterval(t);
  }, [boot]);
  useEffect(() => {
    document.documentElement.style.setProperty('--text-scale', String(settings.textScale));
  }, [settings.textScale]);
  const Comp = !view && NEEDS_GAME.includes(screen) ? Title : screens[screen];
  return (
    <div className={`h-full ${settings.reducedMotion ? 'reduced-motion' : ''}`}>
      <Comp />
      <ErrorToast />
    </div>
  );
}
