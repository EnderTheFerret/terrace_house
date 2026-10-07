import { z } from 'zod';
import bookJson from '../../../../content/lorebook.json';

const Entry = z.object({
  uid: z.number().int().nonnegative(), key: z.array(z.string().min(1)),
  comment: z.string(), content: z.string().min(1), constant: z.boolean(),
  disable: z.boolean(), order: z.number(), matchWholeWords: z.boolean(),
});
const book = z.object({ entries: z.record(z.string(), Entry) }).parse(bookJson);
for (const [uid, entry] of Object.entries(book.entries)) {
  if (String(entry.uid) !== uid) throw new Error(`Lorebook entry id mismatch: ${uid}`);
}
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const line = (entry: z.infer<typeof Entry>) => `- ${entry.comment}: ${entry.content}`;
const heading = 'World Info (public context and game direction; not personal memories):\n';

/** A bounded, non-recursive selector for this book's constant and keyword entries. */
export function selectWorldInfo(query: string, maxChars = 2200) {
  const matches = Object.values(book.entries).filter(entry => !entry.disable && (entry.constant || entry.key.some(key => {
    const pattern = escape(key);
    return new RegExp(entry.matchWholeWords ? `(?<![\\p{L}\\p{N}_])${pattern}(?![\\p{L}\\p{N}_])` : pattern, 'iu').test(query);
  }))).sort((a, b) => Number(b.constant) - Number(a.constant) || b.order - a.order || a.uid - b.uid);
  let used = heading.length;
  return matches.filter(entry => {
    const size = line(entry).length + 1;
    if (used + size > maxChars) return false;
    used += size;
    return true;
  });
}

export function worldInfoBlock(query: string, maxChars = 2200): string {
  const entries = selectWorldInfo(query, maxChars);
  return entries.length ? heading + entries.map(line).join('\n') : '';
}
