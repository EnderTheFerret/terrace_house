import { describe, expect, it } from 'vitest';
import { findInvite, type LiveLine } from './store';

const view = { playerId: 'me', characters: [{ id: 'kai', name: 'Kai Cohen', isPlayer: false, status: 'inHouse' }, { id: 'ron', name: 'Ron Levi', isPlayer: false, status: 'inHouse' }, { id: 'me', name: 'Me', isPlayer: true, status: 'inHouse' }] } as never;
const line = (speaker: string, text: string): LiveLine => ({ index: 0, speaker, name: speaker, text, caption: null, done: true });

describe('findInvite', () => {
  it('offers a shared room when a housemate suggests moving the conversation there', () => {
    expect(findInvite([line('kai', "Let's head to the kitchen for coffee.")], view)).toMatchObject({ from: 'kai', node: 'kitchen', activity: 'talk' });
    expect(findInvite([line('kai', 'Want to go to the living room?')], view)).toMatchObject({ node: 'living', activity: 'talk' });
    expect(findInvite([line('kai', 'The kitchen was nice yesterday')], view)).toBeNull();
    expect(findInvite([line('kai', "Let's head to the bedroom")], view)).toBeNull();
    expect(findInvite([line('kai', "Let's have coffee in the kitchen.")], { ...view as object, playerLocation: 'kitchen' } as never)).toBeNull();
  });
  it('turns a housemate asking you out into a go-there offer', () => {
    expect(findInvite([line('kai', 'Wanna go for a morning run at the beach?')], view)).toMatchObject({ from: 'kai', name: 'Kai', node: 'beach' });
  });
  it('finds the invite a few lines back, and when you are the one proposing', () => {
    expect(findInvite([line('kai', 'we gotta hit the beach road!'), line('me', 'sure.'), line('kai', 'ha, that is the spirit')], view)).toMatchObject({ from: 'kai', node: 'beach' });
    expect(findInvite([line('kai', 'hey'), line('me', "let's go to the beach")], view)).toMatchObject({ from: 'kai', node: 'beach' });
  });
  it('takes everyone who agreed along, not those who said no', () => {
    const talk = [line('kai', 'we gotta hit the beach road!'), line('me', 'I will bring Ron'), line('ron', 'sure, count me in')];
    expect(findInvite(talk, view)).toMatchObject({ from: 'ron', guests: ['kai'], names: 'Ron and Kai' });
    expect(findInvite([...talk, line('kai', 'nah, I have work')], view)).toMatchObject({ from: 'ron', guests: [] });
  });
  it('offers a date when a housemate asks you out without naming a place, unless you turned them down', () => {
    expect(findInvite([line('kai', 'I was hoping to ask you out sometime.')], view)).toMatchObject({ from: 'kai', activity: 'date', guests: [] });
    expect(findInvite([line('kai', 'Would you go out with me tonight?'), line('me', 'sorry, no, I am busy')], view)).toBeNull();
    expect(findInvite([line('kai', 'Want to go out with me tonight?'), line('me', 'no way, that sounds great, yes')], view)).toMatchObject({ from: 'kai', activity: 'date' });
  });
  it('ignores your own lines, small talk and invitations without a place', () => {
    expect(findInvite([line('me', 'wanna go to the beach?')], view)).toBeNull(); // nobody to go with
    expect(findInvite([line('kai', 'the beach was nice yesterday')], view)).toBeNull();
    expect(findInvite([line('kai', 'wanna hang out sometime?')], view)).toBeNull();
  });
});
