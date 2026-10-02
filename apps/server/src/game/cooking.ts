// Applies a finished cooking minigame to the live game (logged for replay).
import { applyCooking } from '@shared-roof/shared';
import type { GameSession } from './session';

export function applyCookingResult(session: GameSession, b: { recipeId: string; quality: number; partner?: string; servedTo: string[]; utensil?: 'meat' | 'dairy' | 'parve' }) {
  const s = session.state;
  if (!s) throw new Error('no game in progress');
  const r = applyCooking(s, { ...b, cook: s.playerId });
  session.state = r.state;
  session.logSeq = session.store.appendEvent(s.gameId, 'cooking', { ...b, cook: s.playerId });
  return { view: session.view(), receptions: r.receptions, improvised: r.improvised };
}
