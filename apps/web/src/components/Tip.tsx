// Move-in day tutorial: one tip at the moment a system first matters. Skippable; Settings → "how to play" replays them.
import { useGame } from '../store';

export const TIPS = {
  walk: 'Walk with the arrow keys or WASD (on a phone, the arrow pad). Stand next to someone or something and press E (or tap the prompt) to interact.',
  blocks: 'The day runs in blocks (morning, late morning, afternoon…). Talking takes as long as the conversation; going out, resting or letting time pass ends the block.',
  talk: 'Pick an intent, or type your own words: name someone to talk to them, say "guys" to talk to everyone.',
  phone: 'Your phone holds messages, the house group chat and shared plans. Invite people to meet at a set time.',
  board: 'The board and bible show what you know about everyone: only what you have seen, heard or been told.',
  map: 'The city map: places, travel time and what each costs. Work and dates happen out here.',
  cooking: 'Cook from the fridge. Watch the house rules: labeled food, kosher shelf, separate meat and dairy pans.',
} as const;

export function Tip({ id }: { id: keyof typeof TIPS }) {
  const { settings, setSettings } = useGame();
  if (!settings.tutorial || settings.tipsSeen.includes(id)) return null;
  return (
    <div role="note" aria-label="tip" className="px-panel fixed bottom-20 left-4 z-40 max-w-sm bg-paper p-3 text-sm">
      <p><span className="caption">tip · </span>{TIPS[id]}</p>
      <div className="mt-2 flex gap-3 text-xs">
        <button className="underline" onClick={() => setSettings({ tipsSeen: [...settings.tipsSeen, id] })}>got it</button>
        <button className="underline" onClick={() => setSettings({ tutorial: false })}>skip tutorial</button>
      </div>
    </div>
  );
}
