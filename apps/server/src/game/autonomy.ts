import { z } from 'zod';
import {
  autonomyOptions, housemates, npcs, npcPlanBlock, utility, pairSummaryText, clockLabel,
  type GameState, type LlmClient, type NpcAction,
} from '@shared-roof/shared';
import { memoriesBlock } from '../prompts/common';
import { Budget, structured } from '../llm/structured';
import { MockLlm } from '../llm/mock';

export async function decideActivities(llm: LlmClient, s: GameState, through: number, protectedIds: string[] = []) {
  if (llm.name === 'mock') return { plans: {} as Record<string, NpcAction>, source: 'mock' as const };
  const due = npcs(s).filter(c => !protectedIds.includes(c.id) && c.activityUntil <= through &&
    s.npcPlans[c.id]?.block !== npcPlanBlock(s));
  const menus = Object.fromEntries(due.map(c => [c.id, autonomyOptions(s, c)]));
  const catalog: NpcAction[] = [];
  const keys: string[] = [];
  const allowed = Object.fromEntries(due.map(c => [c.id, menus[c.id].map(a => {
    const key = JSON.stringify([a.kind, a.target, a.third, a.node, a.room, a.companion, a.useCar]);
    let index = keys.indexOf(key);
    if (index < 0) { index = catalog.length; keys.push(key); catalog.push(a); }
    return index;
  })]));
  const fallback = Object.fromEntries(due.map(c => [c.id, allowed[c.id][menus[c.id].reduce((best, a, i, arr) => utility(s, c, a) > utility(s, c, arr[best]) ? i : best, 0)]]));
  if (!due.length) return { plans: {} as Record<string, NpcAction>, source: 'mock' as const };
  const schema = z.object({ choices: z.object(Object.fromEntries(due.map(c => [c.id,
    z.number().int().min(0).max(catalog.length - 1).refine(i => allowed[c.id].includes(i), 'choose an allowed option'),
  ]))) });
  const cards = due.map(c => {
    const messages = [...Object.values(s.chats).flat(), ...s.house.groupChat.messages]
      .filter(m => m.from === c.id || m.readBy.includes(c.id)).sort((a, b) => a.tick - b.tick).slice(-4);
    const others = housemates(s).filter(o => o.id !== c.id);
    return [
      `## ${c.name} (id: ${c.id}), ${c.occupation}. Background: ${c.persona.backstory.slice(0, 200)}.`,
      `Personality: traits ${c.persona.traits.join(',')} (openness, conscientiousness, extraversion, agreeableness, neuroticism); ${c.persona.attachment}; ${c.persona.conflictStyle}; values ${c.persona.values.join(', ')}.`,
      `Goals: ${c.persona.goals.long.text.slice(0, 160)} / ${c.persona.goals.short.text.slice(0, 160)}. Mood ${c.mood}. Keeps Shabbat: ${!!c.persona.keepsShabbat}. Diet ${c.persona.diet}.`,
      `Current activity: ${c.lastAction ?? 'settling in'} at ${c.location}; finishes at minute ${c.activityUntil}.`,
      `Hobbies: ${c.persona.routine.hobbies.join(', ')}. Needs (higher = more urgent): ${JSON.stringify(c.needs)}.`,
      memoriesBlock(s, c.id, [], 2).slice(0, 400),
      `Recent conversations: ${(s.memory[c.id] ?? []).slice(-3).map(m => m.text.slice(0, 160)).join(' | ')}`,
      `Diary: ${s.diaries[c.id]?.at(-1)?.text.slice(0, 160) ?? ''}`,
      `Their own message history:\n${messages.map(m => `${s.characters[m.from]?.name ?? m.from}: ${m.text.slice(0, 160)}`).join('\n') || '(none yet)'}`,
      `Their relationships: ${others.map(o => `${o.id}: ${pairSummaryText(s, c.id, o.id).slice(0, 100)}`).join('\n')}`,
      `Allowed option indexes for ${c.id}: ${allowed[c.id].join(',')}`,
    ].join('\n');
  });
  const result = await structured(llm, new MockLlm(), {
    kind: 'actions', temperature: 0.5, maxTokens: 350, signal: AbortSignal.timeout(30000),
    prompt: [
      `Choose the next ordinary activity of each adult housemate in Tel Aviv at ${clockLabel(s.world.slot, s.world.minutes)} (${s.world.weekday}, ${s.world.weather}).`,
      'Use each person\'s personality, needs, hobbies, memories and own messages. Follow up on their plans when possible. They can explore the house, talk, rest or explore the city. Do not make everyone socialize or move continually.',
      'Each card is private to that person: never base their choice on another card\'s private messages or memories. The player is never moved or recruited automatically.',
      'Options are validated by the engine. A companion outing happens together only if BOTH people independently choose matching destination and each other as companion. Otherwise they go alone. Respect personal boundaries.',
      `Shared option catalogue (each person can choose ONLY one of their allowed indexes):\n${catalog.map((a, i) => `${i} ${a.kind}${a.room ? ` in ${a.room}` : ''}${a.node ? ` at ${a.node}` : ''}${a.target ? ` target ${a.target}` : ''}${a.third ? ` listener ${a.third}` : ''}${a.companion ? ` with ${a.companion}` : ''}${a.useCar ? ' by car' : ''}`).join('\n')}`,
      ...cards,
      `Return JSON only: {"choices":${JSON.stringify(Object.fromEntries(due.map(c => [c.id, allowed[c.id][0]])))}}. One allowed option index per named person; no prose.`,
    ].join('\n\n'),
    context: { kind: 'text', text: JSON.stringify({ choices: fallback }) },
  }, schema, new Budget(1));
  return { plans: Object.fromEntries(Object.entries(result.value.choices).map(([id, option]) => [id, menus[id][allowed[id].indexOf(option)]])), source: result.source };
}
