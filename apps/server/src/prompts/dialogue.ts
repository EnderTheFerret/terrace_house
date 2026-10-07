const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Keep marked actions and third-person scene descriptions out of a character's spoken reply. */
export function splitReply(text: string, names: string[]): { text: string; narration: boolean }[] {
  const out: { text: string; narration: boolean }[] = [];
  const subject = [...names, 'He', 'She', 'They', 'His', 'Her', 'Their'].map(escape).join('|');
  // ponytail: unmarked narration uses sentence subjects; models should use asterisks for ambiguous actions.
  const narrative = new RegExp(`^(?:${subject})(?:['’]s)?\\s+(?:pauses?|sets? down|sits?|stands?|leans?|glances?|shifts?|takes? a sip|tucks?|fidgets?|offers? a|drops? (?:his|her|their)|gives? a|turns?|reaches?|nods?|shakes? (?:his|her|their)|laughs?|smiles?|grins?|pockets?|eyes|voice|expression)\\b|^(?:He|She|They)['’](?:s|re)\\s+(?:still|already)\\b`, 'i');
  const add = (value: string, narration: boolean) => {
    const clean = value.replace(/[*`“”"]/g, '').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    if (out.at(-1)?.narration === narration) out[out.length - 1].text += ` ${clean}`;
    else out.push({ text: clean, narration });
  };
  for (const part of text.split(/(\*[^*]+\*|“[^”]+”|"[^"]+")/g)) {
    if (part.startsWith('*')) add(part, true);
    else if (/^[“"]/.test(part)) add(part, false);
    else for (const sentence of part.match(/[^.!?]+(?:[.!?]+|$)/g) ?? []) add(sentence, narrative.test(sentence.trim()) || !dialogueCheck(sentence, names).ok);
  }
  return out;
}

/** Catch common plain stage directions that remain after roleplay markup is removed. */
export function dialogueCheck(text: string, names: string[] = []): { ok: boolean; reasons: string[] } {
  const subject = [...new Set([...names.filter(Boolean), 'he', 'she', 'they'])].map(escape).join('|');
  const action = '(?:fidgets|shrugs|shrugged|nods|blinks|gestures|leans? back|leaned back|(?:grins|laughs|smiles|pauses)(?=\\s*(?:[.,]|and\\b))|shifts? (?:his|her|their) weight|pulls? out (?:his|her|their) phone|rolls? (?:his|her|their) eyes|tucks? a strand|takes? a sip|waves? dismissively|looks? (?:around|up|down|away)|glances? (?:at|up|around|between)|catches? (?:himself|herself|themselves) staring)';
  const stage = new RegExp(`(?:^|[.!?]\\s+)(?:${subject})\\s+${action}\\b|\\b(?:${subject})(?:['’]s)?\\s+(?:eyes|expression)\\s+(?:widen|narrows?|shifts?)\\b`, 'i');
  const reasons = [];
  if (stage.test(text)) reasons.push('third-person stage direction in spoken dialogue');
  if (/\[(?:laugh(?:ter|s)?|quietly|smiles?|sighs?|shrugs?|pauses?)\]/i.test(text)) reasons.push('bracketed stage direction in spoken dialogue');
  if (/\*[^*]+\*|\b(?:sends? (?:a |the )?(?:text|message)|types? (?:a |the )?(?:text|message))\b/i.test(text)) reasons.push('action instead of a text message');
  return { ok: reasons.length === 0, reasons };
}
