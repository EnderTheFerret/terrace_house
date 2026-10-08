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
import { ChatLog } from './screens/ChatLog';
import { Bible, Fridge, Saves, Settings, Summary } from './screens/Info';
import { Debug } from './screens/Debug';
import { CityMap } from './screens/CityMap';
import { Cooking } from './screens/Cooking';
import { Gallery } from './screens/Gallery';
import { SpriteLibrary } from './screens/SpriteLibrary';
import { EditCharacter } from './screens/EditCharacter';
import { Guide } from './screens/Guide';
import { ErrorToast } from './components/ui';
import { ActivityStatus } from './components/Activity';
import { useCharacterSprites } from './pixel/sprites';

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
  chatlog: ChatLog,
  bible: Bible,
  fridge: Fridge,
  debug: Debug,
  summary: Summary,
  settings: Settings,
  saves: Saves,
  episode: EpisodeCard,
  studio: Studio,
  gallery: Gallery,
  sprites: SpriteLibrary,
  editme: EditCharacter,
  guide: Guide,
};

const NEEDS_GAME: Screen[] = ['house', 'map', 'scene', 'cooking', 'phone', 'board', 'chatlog', 'bible', 'fridge', 'debug', 'summary', 'episode', 'studio', 'editme'];

export function App() {
  const { screen, guideBack, settings, boot, view, live } = useGame();
  const guideOpen = screen === 'guide';
  const activeScreen = guideOpen ? guideBack : screen;
  const spritePending = useCharacterSprites(NEEDS_GAME.includes(activeScreen) ? view?.characters.filter(c => c.status === 'inHouse' && (c.isPlayer || c.location === view.playerLocation || activeScreen === 'map' && c.cityLocation || live?.header?.participants.some(p => p.id === c.id))).sort((a, b) => Number(b.isPlayer) - Number(a.isPlayer)) ?? [] : []);
  useEffect(() => {
    void boot();
    const t = setInterval(() => void useGame.getState().refreshHealth(), 30000);
    return () => clearInterval(t);
  }, [boot]);
  useEffect(() => {
    document.documentElement.style.setProperty('--text-scale', String(settings.textScale));
  }, [settings.textScale]);
  const Comp = !view && NEEDS_GAME.includes(activeScreen) ? Title : screens[activeScreen];
  return (
    <div className={`h-full ${settings.reducedMotion ? 'reduced-motion' : ''}`}>
      <div className={guideOpen ? 'hidden' : 'h-full'} inert={guideOpen}>
        {Comp === EpisodeCard ? <EpisodeCard pending={spritePending} /> : <Comp />}
      </div>
      {guideOpen && <div role="dialog" aria-modal="true" aria-label="activity guide" className="fixed inset-0 z-50 bg-cream"><Guide /></div>}
      <ActivityStatus spritePending={spritePending} />
      <ErrorToast />
    </div>
  );
}
