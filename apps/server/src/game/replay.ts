// Deterministic replay of an events_log: re-applies engine steps in the same order the session used.
import {
  applyReread, autoChoices, createGame, finishSlot, panelPrediction, planSlot, proposeOutcome, recordCommentary, resolveScene, applyCooking,
  applyDrinks, debugEdit, editPlayer, joinNewPlayer, recordChat, recordConversation, recordPlayerWords, passTime, recordDiary, planMoveInArrival, planHouseMeal, queueNpcPlans,
  type EventInstance, type GameState, beginBroadcast, respondToPlan, addTalkPlan, applyPlanRead, askBack,
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
      case 'autonomy':
        queueNpcPlans(s!, p.plans);
        break;
      case 'new':
        s = createGame({ ...p, moveInVersion: p.moveInVersion ?? 1, communalMeals: p.communalMeals ?? false });
        break;
      case 'action': {
        const r = planSlot(s!, p.action, { legacyText: p.action.type === 'text' && !p.textVersion });
        s = r.state;
        plan = new Map(r.plan.scenes.map((sc) => [sc.event.id, sc.event]));
        break;
      }
      case 'broadcast-start':
        beginBroadcast(s!, p.event);
        plan.set(p.event.id, p.event);
        break;
      case 'plan-response':
        s = respondToPlan(s!, p.action);
        break;
      case 'talk-plan':
        s = addTalkPlan(s!, p.from, p.to, p.plan);
        break;
      case 'scene': {
        let ev = (p.event as EventInstance | undefined) ?? plan.get(p.eventId);
        if (!ev) throw new Error(`replay: unknown event ${p.eventId} at seq ${e.seq}`);
        if (p.response === 'join' && !ev.participants.includes(s!.playerId)) ev = { ...ev, participants: [...ev.participants, s!.playerId], isPlayerScene: true };
        // same rng consumption as the live session: choices, engine proposal, then resolution with the logged proposal
        s = autoChoices(s!, ev, p.playerIntent).state;
        s = proposeOutcome(s, ev, p.choices).state;
        s = resolveScene(s, ev, p.proposal, p.choices, p.response).state;
        break;
      }
      case 'reread':
        applyReread(s!, p.id, p.change, p.participants, true, p.boardChange ?? { ...p.change, affinityDeltas: [], romanceDeltas: [] }, p.episode);
        break;
      case 'ask-back':
        s = askBack(s!, p.target);
        break;
      case 'plan-read':
        s = applyPlanRead(s!, p.a, p.b, p.read);
        break;
      case 'reading':
        if (p.change) applyReread(s!, p.id, p.change, p.participants, false, p.boardChange ?? { ...p.change, affinityDeltas: [], romanceDeltas: [] });
        break;
      case 'diary':
        s = recordDiary(s!, p.id, p.episode, p.diary, p.pairs ?? {});
        break;
      case 'intermission':
        if (p.remarks) s = recordCommentary(s!, { calledBack: [], remarks: p.remarks });
        break;
      case 'commentary':
        s = panelPrediction(s!).state;
        s = recordCommentary(s, { prediction: p.prediction, calledBack: p.calledBack ?? [], remarks: p.remarks });
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
      case 'conversation':
        s = recordConversation(s!, p.listeners, p.lines);
        break;
      case 'chat':
        s = recordChat(s!, p.a, p.b, p.lines, p.photoFrom);
        break;
      case 'chat-retry':
        if (s!.chats[p.key]?.[p.index]) s!.chats[p.key][p.index].text = p.text;
        break;
      case 'time':
        s = passTime(s!, p.lines, p.protectedIds ?? [], p.minutesPerLine ?? 3);
        break;
      case 'move-in': {
        const arrival = planMoveInArrival(s!);
        s = arrival.state;
        for (const scene of arrival.plan.scenes) plan.set(scene.event.id, scene.event);
        break;
      }
      case 'move-in-join':
        plan.set(p.event.id, p.event);
        s!.characters[p.newcomer].location = p.event.location;
        break;
      case 'meal': {
        const meal = planHouseMeal(s!);
        s = meal.state;
        for (const scene of meal.plan.scenes) plan.set(scene.event.id, scene.event);
        break;
      }
      case 'meal-routines':
        s!.world.flags.communalMeals = true;
        break;
      case 'new-player':
        s = joinNewPlayer(s!, p.setup);
        break;
      case 'edit-player':
        s = editPlayer(s!, p.edit);
        break;
      case 'drinks':
        s = applyDrinks(s!, p.changes);
        break;
      case 'debug-edit':
        s = debugEdit(s!, p.edit);
        break;
      case 'generated-character':
        applyCharacterSnapshot(s!, p.character);
        break;
      case 'appearance-palette':
        if (s!.characters[p.id]?.portraitSeed === p.portraitSeed) s!.characters[p.id].appearance.palette = p.palette;
        break;
      case 'artwork-edit': {
        const c = s!.characters[p.id];
        if (p.edit.kind === 'walk') {
          c.spriteSeed = p.edit.seed;
          c.spriteInstructions = p.edit.instructions;
        } else c.expressionEdits = { ...c.expressionEdits, [p.edit.emotion]: { seed: p.edit.seed, instructions: p.edit.instructions } };
        break;
      }
    }
  }
  if (!s) throw new Error('replay: log has no "new" event');
  return s;
}
