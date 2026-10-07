import { expect, it } from 'vitest';
import { addMemory, addTalkPlan, createGame, eventTemplate, learn, makeEvent, planFactId, projectForPlayer, type Beat } from '@shared-roof/shared';
import { plansBlock } from '../prompts/common';
import { linesPrompt } from '../prompts/scene';
import { chatPrompt } from '../prompts/studio';

const beat: Beat = { speaker: 'mio', intent: 'answer the player', emotion: 'neutral', beatType: 'smalltalk', subtext: '', depth: 'smalltalk', topic: 'plans' };
const setup = () => {
  const s = createGame({ seed: 20 });
  const ev = makeEvent(s, eventTemplate('backyard-talk'), { a: 'mio', b: s.playerId }, 'backyard');
  return { s, ev, prompt: (st = s) => linesPrompt(st, ev, [beat], [{ speaker: st.playerId, text: 'What are you up to later?' }], [undefined], 'What are you up to later?') };
};

it('grounds dialogue in the real day, dated memories, plans and what happened elsewhere', () => {
  const { s, prompt } = setup();
  const day1 = prompt();
  expect(day1).toContain('day 1 in the house');
  expect(day1).toContain('moved in today: nobody here shares any history');
  expect(day1).toContain('(the player)');
  expect(day1).not.toContain('works as'); // nobody has been introduced to the player yet
  expect(day1).not.toContain('[...]');

  addMemory(s, 'mio', 'Mio and Ren burned the toast together.', ['mio', 'ren'], 0.6);
  s.world.episode = 3; s.world.slot = 'slot2'; s.world.tick += 14;
  addMemory(s, 'mio', 'Ren and I folded laundry and argued about music.', ['mio', 'ren'], 0.5);
  addMemory(s, 'mio', 'Ren told me a secret about his ex.', ['mio', 'ren'], 0.9);
  s.invitations.push({ id: 'plan-x', from: s.playerId, to: 'mio', episode: 3, slot: 'slot3', node: 'cafe', status: 'accepted' });
  const later = prompt();
  expect(later).toContain('lived together for 2 days');
  expect(later).toContain('works as');
  expect(later).toMatch(/today at 16:00 \(agreed\)/);
  expect(later).toContain('Earlier today, away from this conversation: Ren and I folded laundry');
  expect(later).not.toContain('secret about his ex'); // weighty private moments are not offered up
  expect(later).not.toContain('[...]');

  expect(later).toContain(`Ron: ${s.characters.ren.age}, ${s.characters.ren.occupation}`); // public intro, not guessed

  s.world.slot = 'slot3';
  s.house.dishes = 80;
  const now = prompt();
  expect(now).toContain('right now (agreed)');
  expect(now).toContain('dishes are piling up');
});

it('keeps a date private to the pair until someone is told, while friend plans stay on the house calendar', () => {
  const { s } = setup();
  const friends = addTalkPlan(s, 'ren', 'shun', { node: 'market', episode: 2, slot: 'slot2' });
  expect(plansBlock(friends, 'mio')).toContain('Ron and Shai at Carmel Market tomorrow at 13:00 (house calendar)');
  expect(projectForPlayer(friends).invitations).toContainEqual(friends.invitations.at(-1));
  const s1 = addTalkPlan(s, 'mio', 'kaito', { node: 'cafe', episode: 2, slot: 'slot1', date: true });
  const plan = s1.invitations.at(-1)!;
  expect(plansBlock(s1, 'kaito')).toContain('on a private date to Rothschild Coffee tomorrow at 10:00 (agreed)');
  expect(plansBlock(s1, 'ren')).toBe(''); // Ren has no idea
  expect(projectForPlayer(s1).invitations).not.toContainEqual(plan); // nor does the player
  learn(s1, 'ren', planFactId(plan), 'told', 'mio');
  expect(plansBlock(s1, 'ren')).toContain('Maya and Kai at Rothschild Coffee tomorrow at 10:00 (a date; heard from Maya)');
  learn(s1, s1.playerId, planFactId(plan), 'told', 'mio');
  expect(projectForPlayer(s1).invitations).toContainEqual(plan);
});

it('gives phone replies the clock, where the sender is, their plans and dated messages', () => {
  const { s } = setup();
  s.invitations.push({ id: 'plan-y', from: 'mio', to: s.playerId, episode: 2, slot: 'slot1', node: 'market', status: 'pending' });
  const thread = [{ from: s.playerId, text: 'still on for tomorrow?', tick: s.world.tick }];
  const p = chatPrompt(s, 'mio', s.playerId, thread);
  expect(p).toContain('still on for tomorrow?');
  expect(p).toContain('[today]');
  expect(p).toMatch(/tomorrow at 10:00 \(not answered yet\)/);
  expect(p).toContain('they are texting, not in the same room');
  expect(p).not.toContain('[...]');
});
