import { expect, it } from 'vitest';
import { selectWorldInfo, worldInfoBlock } from './lorebook';
import { loreBlock } from './common';

it('activates specific places and practices without recursing into entry contents', () => {
  const names = selectWorldInfo('Walk around Jaffa\'s flea market?').map(e => e.comment);
  expect(names).toContain('Jaffa and the port');
  expect(names).toContain('Jaffa flea market');
  expect(names).not.toContain('Florentin');
  expect(names).not.toContain('Terrace House format');
  expect(worldInfoBlock('Friday dinner, kosher and Shabbat')).toContain('Keeping kosher does not imply keeping Shabbat');
});

it('matches whole words, including Hebrew, without triggering on fragments', () => {
  expect(selectWorldInfo('training in a bandana').map(e => e.comment)).not.toContain('Getting around');
  expect(selectWorldInfo('training in a bandana').map(e => e.comment)).not.toContain('Unknown personal connections');
  expect(worldInfoBlock('שבת')).toContain('Shabbat in the city');
  expect(selectWorldInfo('השבתון').map(e => e.comment)).not.toContain('Shabbat in the city');
});

it('keeps the lore budget bounded and separates public lore from personal history', () => {
  const block = worldInfoBlock('Jaffa flea market Florentin Rothschild kosher Shabbat sister Israel bus beach');
  expect(block.length).toBeLessThanOrEqual(2200);
  expect(block).toContain('never a character\'s personal history');
  expect(block).not.toContain('https://');
  expect(worldInfoBlock('Jaffa', 10)).toBe('');
  expect(loreBlock('Rothschild Coffee')).toContain('Game locations and guests (fictional)');
});
