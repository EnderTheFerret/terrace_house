// Deterministic replay of an events_log: re-applies engine steps in the same order the session used.
import {
  autoChoices, createGame, finishSlot, panelPrediction, planSlot, proposeOutcome, recordCommentary, resolveScene, applyCooking,
  joinNewPlayer, recordChat, recordPlayerWords, passTime,
  type EventInstance, type GameState,
} from '@shared-roof/shared';
import { applyCharacterSnapshot } from './personas';

export interface LoggedEvent {
  seq: number;
  kind: string;
  payload: any;
}

export function replayEvents(events: LoggedEvent[]): GameState {
  let s: GameState | null = null;
  let plan = new Map<string, EventInstance>();
  for (const e of events) {
    const p = e.payload;
    switch (e.kind) {
      case 'new':
        s = createGame(p);
        break;
      case 'action': {
        const r = planSlot(s!, p.action);
        s = r.state;
        plan = new Map(r.plan.scenes.map((sc) => [sc.event.id, sc.event]));
        break;
      }
      case 'scene': {
        let ev = plan.get(p.eventId);
        if (!ev) throw new Error(`replay: unknown event ${p.eventId} at seq ${e.seq}`);
        if (p.response === 'join' && !ev.participants.includes(s!.playerId)) ev = { ...ev, participants: [...ev.participants, s!.playerId], isPlayerScene: true };
        // same rng consumption as the live session: choices, engine proposal, then resolution with the logged proposal
        s = autoChoices(s!, ev, p.playerIntent).state;
        s = proposeOutcome(s, ev, p.choices).state;
        s = resolveScene(s, ev, p.proposal, p.choices, p.response).state;
        break;
      }
      case 'commentary':
        s = panelPrediction(s!).state;
        s = recordCommentary(s, { prediction: p.prediction, calledBack: p.calledBack ?? [] });
        break;
      case 'cooking':
        s = applyCooking(s!, p).state;
        break;
      case 'end-slot':
        s = finishSlot(s!);
        break;
      case 'words':
        s = recordPlayerWords(s!, p.listeners, p.words);
        break;
      case 'chat':
        s = recordChat(s!, p.a, p.b, p.lines);
        break;
      case 'time':
        s = passTime(s!, p.lines);
        break;
      case 'new-player':
        s = joinNewPlayer(s!, p.setup);
        break;
      case 'generated-character':
        applyCharacterSnapshot(s!, p.character);
        break;
      case 'appearance-palette':
        if (s!.characters[p.id]?.portraitSeed === p.portraitSeed) s!.characters[p.id].appearance.palette = p.palette;
        break;
    }
  }
  if (!s) throw new Error('replay: log has no "new" event');
  return s;
}
