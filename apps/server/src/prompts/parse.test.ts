import { expect, it } from 'vitest';
import type { Beat } from '@shared-roof/shared';
import { parseLines } from './scene';

const beat = (speaker: string) => ({ speaker, intent: 'x', emotion: 'neutral', beatType: 'smalltalk', depth: 'smalltalk', topic: 't' }) as Beat;

// raw shapes seen from Rocinante-X in scripts/conversation-probe.ts
it('keeps actions and spoken words from roleplay-style output', () => {
  const b = [beat('kaito')];
  expect(parseLines('kaito: "One sugar\'s good, thanks bro." *puts down phone briefly* "Actually, I\'ll keep it with me."\n\n*cranks the camera angle* "You don\'t mind?"', b)).toEqual(["One sugar's good, thanks bro. puts down phone briefly Actually, I'll keep it with me. cranks the camera angle You don't mind?"]);
  expect(parseLines('ren: "I can at least not set the kitchen on fire."\n\nHe takes a sip, eyes on the sky.\n\n"Least I can do while it\'s raining."', [beat('ren')])).toEqual(["I can at least not set the kitchen on fire. He takes a sip, eyes on the sky. Least I can do while it's raining."]);
});

it('accepts backticked and capitalised ids and keeps pure actions', () => {
  const b = [beat('mio'), beat('sora')];
  expect(parseLines('`mio: Um, I\'ll have some if you\'re making it?`\n\n`Sora: I need three espressos.`', b)).toEqual(["Um, I'll have some if you're making it?", 'I need three espressos.']);
  expect(parseLines('ren: *shrugs*', [beat('ren')])).toEqual(['shrugs']);
});

it('keeps the conclusion after action narration instead of clipping at four sentences', () => {
  const long = 'kaito: One. Two. Three. Four. Five. Six.';
  expect(parseLines(long, [beat('kaito')])).toEqual(['One. Two. Three. Four. Five. Six.']);
});

it('does not attach an extra speaker\'s continuation to the requested reply', () => {
  expect(parseLines('sora: I meant the music.\nplayer: I agree.\nI promise to help.', [beat('sora')])).toEqual(['I meant the music.']);
});
