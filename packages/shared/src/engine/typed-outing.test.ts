import { describe, expect, it } from 'vitest';
import { createGame } from './loop';
import { proposedOuting, proposedPlan } from './living';

describe('an invitation typed in the player\'s own words', () => {
  const s = createGame({ seed: 7, moveInDay: false });
  const ids = ['ren'];

  it('is read as going there now, the way the invite button asks', () => {
    expect(proposedOuting(s, "Maybe head to Carmel market? I'm free right now if you want to do some shopping", ids)).toEqual({ node: 'market', date: false });
    expect(proposedOuting(s, 'Want to go to Carmel Market with me?', ids)).toEqual({ node: 'market', date: false });
    expect(proposedOuting(s, "Let's go on a date at Rothschild Coffee", ids)).toMatchObject({ date: true });
  });

  it('ignores questions and statements that only mention a place', () => {
    expect(proposedOuting(s, 'Do you know a good butcher at Carmel Market?', ids)).toBeNull();
    expect(proposedOuting(s, 'How was the beach yesterday?', ids)).toBeNull();
    expect(proposedOuting(s, "I'm heading to Carmel Market with the others later.", ids)).toBeNull();
    expect(proposedOuting(s, 'Want some coffee?', ids)).toBeNull();
  });

  it('leaves plans for later to the calendar parser, and never turns one into an outing right now', () => {
    const later = 'Want to go to Carmel Market tomorrow morning?';
    expect(proposedPlan(s, later, ids)).toMatchObject({ node: 'market' }); // booked for tomorrow by the other path
  });
});
