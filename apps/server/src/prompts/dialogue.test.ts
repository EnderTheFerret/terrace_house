import { expect, it } from 'vitest';
import { dialogueCheck, splitReply } from './dialogue';

it('rejects the screenshot narration and other observed plain stage directions', () => {
  expect(dialogueCheck("Oh... Dana? Like from Beersheba? Maya's eyes widen slightly, then she catches herself staring.", ['Maya']).ok).toBe(false);
  expect(dialogueCheck('You\'re hilarious. She rolls her eyes but grins.').ok).toBe(false);
  expect(dialogueCheck('Coffee? Kai leans back in his chair.', ['Kai']).ok).toBe(false);
  expect(dialogueCheck('[laughter] One sugar, please.').ok).toBe(false);
  expect(dialogueCheck('Sure. He grins and leans back in his chair.').ok).toBe(false);
  expect(dialogueCheck('No problem. Maya shifts her weight.', ['Maya']).ok).toBe(false);
});

it('separates multi-character actions from speech without losing the end of the reply', () => {
  expect(splitReply('Ron glances up from the floor. *Kai sets down his mug.* "Yeah, seems that way. Hope so too."', ['Ron', 'Kai'])).toEqual([
    { narration: true, text: 'Ron glances up from the floor. Kai sets down his mug.' },
    { narration: false, text: 'Yeah, seems that way. Hope so too.' },
  ]);
  expect(splitReply('Maya pauses mid-chew. Um... well, I mean... we broke up but he messages me at night. Her voice drops to a whisper. Is that stupid?', ['Maya'])).toEqual([
    { narration: true, text: 'Maya pauses mid-chew.' },
    { narration: false, text: 'Um... well, I mean... we broke up but he messages me at night.' },
    { narration: true, text: 'Her voice drops to a whisper.' },
    { narration: false, text: 'Is that stupid?' },
  ]);
  expect(splitReply('She works at the hospital. Maya, do you want coffee?', ['Maya'])).toEqual([{ narration: false, text: 'She works at the hospital. Maya, do you want coffee?' }]);
  expect(dialogueCheck('*sends a text*').ok).toBe(false);
});

it('allows spoken questions, names and ordinary references to other people', () => {
  for (const text of ['Maya, do you want coffee?', "Maya's sister lives in Beersheba.", 'She works at the hospital.', 'They look after my sister.', 'He said he would take a sip.', 'Put the camera down. Coffee first.', 'I could sleep on the couch.']) {
    expect(dialogueCheck(text, ['Maya']).ok, text).toBe(true);
  }
});
