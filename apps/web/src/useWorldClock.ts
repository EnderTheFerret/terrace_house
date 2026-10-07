import { useEffect } from 'react';
import { useGame } from './store';

export function useWorldClock(paused: boolean) {
  const guideOpen = useGame(s => s.screen === 'guide');
  useEffect(() => {
    if (paused || guideOpen) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void useGame.getState().worldPulse();
    }, 20000);
    return () => window.clearInterval(timer);
  }, [paused, guideOpen]);
}
