import { useEffect } from 'react';
import { useGame } from './store';

export function useWorldClock(paused: boolean) {
  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void useGame.getState().worldPulse();
    }, 20000);
    return () => window.clearInterval(timer);
  }, [paused]);
}
