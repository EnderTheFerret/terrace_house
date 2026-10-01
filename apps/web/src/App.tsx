import { useEffect, type ReactElement } from 'react';
import { useGame, type Screen } from './store';
import { Title } from './screens/Title';
import { ErrorToast } from './components/ui';

const screens: Partial<Record<Screen, () => ReactElement>> = {
  title: Title,
};

export function App() {
  const { screen, settings, boot } = useGame();
  useEffect(() => {
    void boot();
    const t = setInterval(() => void useGame.getState().refreshHealth(), 30000);
    return () => clearInterval(t);
  }, [boot]);
  useEffect(() => {
    document.documentElement.style.setProperty('--text-scale', String(settings.textScale));
  }, [settings.textScale]);
  const Comp = screens[screen] ?? Title;
  return (
    <div className={`h-full ${settings.reducedMotion ? 'reduced-motion' : ''}`}>
      <Comp />
      <ErrorToast />
    </div>
  );
}
