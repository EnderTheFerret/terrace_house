import { useEffect, type ReactNode } from 'react';
import { HOUSEHOLD, HOUSEHOLD_ACTIVITIES } from '@shared-roof/shared';
import { useGame } from '../store';
import { Btn } from '../components/ui';

function Shot({ id, caption }: { id: string; caption: string }) {
  return <figure className="my-3">
    <a href={`/assets/guide/${id}.png`} target="_blank" rel="noreferrer" aria-label={`Enlarge screenshot: ${caption}`}>
      <img src={`/assets/guide/${id}.png`} alt={caption} loading="lazy" className="w-full border-2 border-ink" />
    </a>
    <figcaption className="caption mt-1 text-xs">{caption} · select image to enlarge</figcaption>
  </figure>;
}

function Section({ title, children, open = false }: { title: string; children: ReactNode; open?: boolean }) {
  return <details open={open} className="px-panel p-4">
    <summary className="cursor-pointer text-lg">{title}</summary>
    <div className="mt-3 space-y-3 text-sm leading-relaxed">{children}</div>
  </details>;
}

// Controls checked against features.md, session_handoof.md and the activity screens.
export function Guide() {
  const { setScreen, guideBack } = useGame();
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      e.stopImmediatePropagation();
      if (e.key === 'Escape') setScreen(guideBack);
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [setScreen, guideBack]);
  return <div className="flex h-full flex-col">
    <header className="flex items-center justify-between gap-4 border-b-[3px] border-ink bg-paper p-3">
      <h1 className="text-xl">activity guide</h1>
      <Btn autoFocus onClick={() => setScreen(guideBack)}>back to game / menu</Btn>
    </header>
    <main aria-label="activity guide" className="flex-1 overflow-y-auto p-4 scroll-thin">
      <div className="mx-auto flex max-w-4xl flex-col gap-5 pb-8">
        <p className="text-sm">Pick a section. Reading this guide pauses the world clock and cooking timers; Escape returns you to where you were. Screenshots show a separate example season, so names and availability may differ.</p>
        <Section title="Start here: explore & spend time" open>
          <p><strong>New season → five creator steps → move in.</strong> Talk through the introductions; more housemates arrive during day one. There is no required romance or winning route.</p>
          <p><strong>WASD / arrows</strong> walk; <strong>E</strong> interacts with nearby people or hotspots. Use the house sidebar for the same actions. Stairs change floors; walk into the other bedroom to knock and wait for permission.</p>
          <Shot id="house" caption="House: walking view, room buttons and activity sidebar" />
          <p><strong>Hang out</strong> starts a living-room scene; <strong>backyard</strong> spends time on the pool deck; <strong>hobby</strong> starts a leisure scene; <strong>tidy up</strong> does housework; <strong>rest</strong> takes a break. Stove → cook; fridge → chores; sofa → hang out; TV → hobby; sink → tidy; bed → rest; front door → city.</p>
          <Shot id="house-actions" caption="House actions, work or class reminders, and season choices" />
          <p>Watch the clock: six blocks run from morning to late night. Talking costs six game minutes per spoken line. Watching the house or city adds five minutes every 20 seconds. <strong>Let time pass</strong> uses the block; <strong>skip to next block</strong> advances it; <strong>sleep until morning</strong> needs confirmation. With an accepted plan ahead, <strong>spend time until</strong> lets you pass the time (or do your hobby, or rest) until that plan's block starts (it stops early if a scene or a new episode comes up). Plans and shifts still happen.</p>
        </Section>
        <Section title="Everyday life: all 15 quick activities">
          <p>House → <strong>everyday life</strong> (scroll the sidebar) → choose <strong>activity</strong> and <strong>company</strong> → <strong>start activity</strong> alone or <strong>invite & start together</strong>. No minigame is required. Select an activity below to see its actual controls.</p>
          <div className="grid items-start gap-3 sm:grid-cols-2">
            {HOUSEHOLD_ACTIVITIES.map(id => <details key={id} className="px-panel-soft p-2">
              <summary className="cursor-pointer">{HOUSEHOLD[id].label} · {HOUSEHOLD[id].minutes} min</summary>
              <p className="mt-2 text-xs">{HOUSEHOLD[id].detail}</p>
              <Shot id={`everyday-${id}`} caption={`${HOUSEHOLD[id].label}: activity and company selectors, start button`} />
            </details>)}
          </div>
          <p>If someone is already doing a task alone, use <strong>join [name] & talk</strong>. Type while you work. Ending the talk finishes the remaining task time; you can keep talking after the task finishes.</p>
          <p>Leave enough block time. Busy housemates or someone wanting space may refuse. Plants wait for dry weather; drinks and meals respect Shabbat. A meal needs suitable ingredients and clean cookware; join an existing cook if a meal is already underway.</p>
        </Section>
        <Section title="Talk, listen, invite & build relationships">
          <p>Walk up and press <strong>E</strong>, or use <strong>who’s where → talk to [name] → yes</strong>. To choose the room: <strong>invite a housemate → room → housemate → go together & talk</strong>.</p>
          <Shot id="invite-room" caption="Meet at home: choose room, housemate and go together & talk" />
          <Shot id="talk" caption="Conversation: response choices, your own words and ending the talk" />
          <p>Close to a housemate? Press <strong>matchmaker / snoop…</strong> to ask them to play matchmaker (you and someone, or two housemates) or to snoop around (does someone like you, do two housemates have a thing). Shy or private housemates say no, and a helper with feelings of their own may refuse, stall or downplay what they find. It takes until the next block and happens off screen: the helper, sometimes with a friend, comes to find you with the news, or texts you if you are out.</p>
          <p>Type up to 200 characters and press <strong>say</strong>. <strong>Retry reply</strong> redoes their answer; <strong>edit reply</strong> lets you reword what you just said (not offered once it set up a plan, favor, invitation or drink). Pick who you address when offered. Space / Enter reveals text faster. <strong>Keep listening…</strong> lets others continue; <strong>that's all</strong> ends your talk.</p>
          <p>When you encounter others talking, choose <strong>join</strong>, <strong>eavesdrop</strong> or <strong>leave them be</strong>. Listening secretly can cost trust. During your talk, use the invitation controls to suggest a place or date; use <strong>continue in another room → go together & talk</strong> to move together.</p>
          <p>Flirt, support, joke, apologize, confront or confess through choices or your own words. Friendship, romance and trust grow over days; an invitation or confession can be declined. Dates can lead to hand-holding and a first kiss when both people are ready.</p>
        </Section>
        <Section title="Swim & visit a private balcony">
          <p>House → <strong>pool → swim & invite housemates</strong> → optionally select guests → <strong>enter pool</strong>. Swimwear changes automatically. Use <strong>invite more swimmers</strong> to add people, or <strong>everyone out of the pool</strong> to finish. The pool closes during storms.</p>
          <Shot id="pool" caption="Swimming: guest checkboxes and enter pool" />
          <p>House → a <strong>balcony</strong> button → <strong>visit balcony</strong>. Your own is open to you. For the other bedroom, first arrange an accepted phone plan for that balcony; visit at the agreed block and select the person who invited you.</p>
          <Shot id="balcony" caption="Private balcony: invitation selector and visit button" />
        </Section>
        <Section title="City: dates, wandering, food, shopping & karaoke">
          <p>House → <strong>go out</strong>, front door + E, or <strong>M</strong> → choose an enabled destination → choose an activity → <strong>go</strong>. Each place offers its own activities; a dim destination explains why it is unavailable.</p>
          <Shot id="city" caption="City: destination list, travel time, budget and shared car" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div><p><strong>Go on a date / invite housemates:</strong> choose someone in the <strong>with</strong> selector. <strong>Wander around / eat out:</strong> choose the activity and go.</p><Shot id="city-social" caption="Café: date, wander, eat out and invite controls" /></div>
            <div><p><strong>Go shopping:</strong> choose a shop and go. <strong>Buy a gift:</strong> choose the gift, then <strong>buy and return</strong>. Give it later from the phone contact.</p><Shot id="city-gift" caption="Shopping: gift choice, price and buy and return" /></div>
            <div><p><strong>Karaoke:</strong> choose the karaoke venue, select <strong>karaoke</strong>, choose company and go.</p><Shot id="city-karaoke" caption="Karaoke: activity choice and invitation" /></div>
          </div>
          <p>Travel, activity and the return trip must fit. Weather, Shabbat and the shared car matter. Your job sets your budget; ₪ / ₪₪ / ₪₪₪ are price levels. Stretching above your budget can strain you; a guest may need you to treat them.</p>
        </Section>
        <Section title="Work, class & weekend trips">
          <p><strong>Part-time work:</strong> city → a workplace → <strong>work a shift</strong>. Tick <strong>sign a contract</strong> before going to commit to three fixed weekdays in that block and raise your budget one level. House → <strong>go to work (back after the shift)</strong> appears when your contract shift is due. Two missed shifts can cost the job.</p>
          <Shot id="city-work" caption="Workplace: work a shift and optional part-time contract" />
          <p><strong>Class:</strong> choose a student occupation in the creator or <strong>edit character</strong>. When lectures are due, use <strong>go to class (back after lectures)</strong> in the house. Join before the lecture is nearly over. Exams occur every sixth episode; missing one costs more than a class.</p>
          <Shot id="class" caption="Student's house sidebar: go to class reminder" />
          <p><strong>Weekend trip:</strong> Friday morning through afternoon → house sidebar → <strong>weekend trip</strong> → Galilee, Dead Sea or Eilat → select up to three guests and optionally a roommate → <strong>leave in the shared car → yes</strong>. You return Saturday morning after the drive and late-night scenes. Budget, car availability and Shabbat apply; a Thursday text may prefill the invitation.</p>
          <Shot id="trip" caption="Friday trip: destination, guests, roommate and departure" />
        </Section>
        <Section title="Shared breakfasts, dinners & the first night">
          <p><strong>First day:</strong> after the last housemate arrives and introductions finish, all six residents sit down for a mandatory welcome dinner. Sleeping or skipping cannot bypass it.</p>
          <Shot id="meal-welcome" caption="Welcome dinner: the whole house and group conversation controls" />
          <p><strong>From day two:</strong> breakfast gathers one or two free housemates; evening dinner gathers everyone available. Work shifts, lectures, accepted plans, outings, sleep and private routines determine who can join. Students can have breakfast before late-morning class.</p>
          <Shot id="meal-breakfast" caption="Breakfast: a small group before work or class" />
          <Shot id="meal-dinner" caption="Evening dinner: available residents gather in the kitchen" />
          <p>Meals start automatically while you are free at home in the first hour of the morning or evening. Choose <strong>hang out</strong> to join immediately when a meal is due. Ordinary meals leave your explicit conversations and outings alone. Use response choices, type to a person or <strong>everyone</strong>, or <strong>keep listening…</strong>. Breakfast takes at least 20 game minutes and dinner 40; longer talks use more time.</p>
          <p>The house shares a ready-to-eat vegan, kosher hummus and pita spread. Each diner is fed, groceries come from the fridge and shared budget, dishes accumulate and everyone remembers the meal. These daily gatherings are separate from cooking your own recipe.</p>
        </Section>
        <Section title="Cook a meal: quick option or minigames">
          <p>For a quick meal, use <strong>everyday life → cook for the house</strong>. For hands-on cooking: house → <strong>cook</strong> or stove + E → select cookware, a helper and who to serve → select a recipe → select an available step.</p>
          <Shot id="cooking" caption="Cooking: recipes, cookware, helper and people to serve" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div><p><strong>Chop:</strong> Space / start begins; hit Space / chop as blocks cross the line.</p><Shot id="cook-chop" caption="Chopping rhythm controls" /></div>
            <div><p><strong>Boil:</strong> Space / light the stove begins; Space / take it off the heat stops when the simmer is ready.</p><Shot id="cook-boil" caption="Boiling timer controls" /></div>
            <div><p><strong>Sauté:</strong> hold Space or the heat button; release to cool. Keep the marker inside the band.</p><Shot id="cook-saute" caption="Sauté temperature band" /></div>
            <div><p><strong>Season:</strong> adjust the dial, use <strong>taste once</strong> for a hint, then <strong>done</strong>.</p><Shot id="cook-season" caption="Seasoning dial and taste hint" /></div>
            <div><p><strong>Plate:</strong> drag food toward the reference arrangement, or Tab to select and arrows to move. Press <strong>serve</strong>.</p><Shot id="cook-plate" caption="Plating reference and movable food" /></div>
          </div>
          <p>Complete every step within the recipe time budget. Ingredients, taste, diet and kosher cookware affect reception. After the score, <strong>sit down to eat (60 minutes)</strong> starts dinner. Title menu → <strong>practice cooking</strong> lets you learn without using season ingredients or time.</p>
        </Section>
        <Section title="Phone: messages, gifts, plans & social posts">
          <p>Press <strong>P</strong> or select <strong>phone</strong>. Open a person’s tab → type → <strong>send</strong> to start a chat scene. Ask for a “pic” to request a selfie. Phone chats take game time.</p>
          <Shot id="phone" caption="Contact: message, coffee, note and gift controls" />
          <p><strong>Make coffee / leave a note:</strong> use the contact buttons. <strong>Give gift:</strong> buy one in the city first, choose it from <strong>your gifts</strong>, then <strong>give gift</strong>. Tastes matter.</p>
          <p><strong>Plans tab:</strong> choose person, destination (including rooms and balconies), episode and time → <strong>make plan</strong>. Use <strong>accept plan / decline plan</strong> on incoming invitations; keep enough time at the agreed block.</p>
          <Shot id="plans" caption="Phone plans: person, place, episode, time and make plan" />
          <p><strong>Feed tab:</strong> choose photo or story, add words → <strong>post</strong>; use <strong>like</strong> on a post. Sharing a photo makes the moment public; it does not establish a romance. The house tab displays the group chat.</p>
          <Shot id="feed" caption="Social feed: photo or story, post and like" />
        </Section>
        <Section title="Know the house: fridge, feelings & conversation history">
          <p><strong>F / fridge:</strong> check ingredients, cookware, labeled food and your chore rota. Use everyday activities or <strong>tidy up</strong> for chores; shop in the city to replenish groceries. Respect labels and food preferences.</p>
          <Shot id="fridge" caption="Fridge, chore rota and household condition" />
          <p><strong>B / board:</strong> switch graph/table and affinity/romance/trust. Rows feel about columns. Your row is your own feelings; other rows are your estimate. Witnessed, told and rumor sources differ.</p>
          <Shot id="board" caption="Relationship board: display modes and known feelings" />
          <p><strong>I / bible:</strong> read known hobbies, routines, diet and shared history. More becomes known through time and trust; private facts stay hidden.</p>
          <Shot id="bible" caption="Character bible and shared-history controls" />
          <p><strong>Chat log:</strong> read completed conversations and witnessed overheard lines (including last night). <strong>Re-read this scene</strong> asks the dialogue model to reassess a written scene once; it may correct relationships. Without usable model output, the usual outcome stays.</p>
          <Shot id="chatlog" caption="Chat log: transcripts and scene reading status" />
        </Section>
        <Section title="Artwork, episode replay & season endings">
          <p>During a conversation → <strong>generate scene</strong> for a picture, or <strong>character artwork</strong> to select a person and generate an expression, clothing or both. Presets include formal wear; custom descriptions let you specify the look.</p>
          <Shot id="artwork" caption="Scene character artwork: person, expression and outfit controls" />
          <p><strong>Sprite library:</strong> choose a character and artwork, describe a correction → <strong>apply edit</strong>, or choose <strong>new variation</strong>. Finish active talks before saving edits. <strong>Scene gallery</strong> browses saved pictures. Artwork changes do not change feelings or advance time; generation needs the image service.</p>
          <Shot id="sprites" caption="Sprite library: character, artwork filters and editing controls" />
          <Shot id="gallery" caption="Scene gallery: saved artwork and browsing controls" />
          <p>After an episode airs (two episodes later), the house sidebar offers <strong>watch the episode</strong> to replay its written scenes. The studio reacts automatically; <strong>continue</strong> moves on.</p>
          <Shot id="broadcast" caption="Watch the episode: scenes as aired, with your moments marked" />
          <p><strong>Leave the house → yes</strong> starts your farewell, then lets you create the next resident. A partner can decline to leave with you. <strong>Wrap the season</strong> unlocks from episode 3 and announces the next full episode as the finale; fixed-length seasons finish automatically.</p>
          <Shot id="trip-season" caption="Later-season house controls: departure and finale" />
        </Section>
        <Section title="Save, settings & when an action is unavailable">
          <p><strong>Save</strong> opens five manual slots; choose a slot’s <strong>save</strong> or <strong>load</strong>. The title menu also offers <strong>load</strong>. The game autosaves progress, but manual slots let you keep a moment.</p>
          <Shot id="saves" caption="Save and load slots" />
          <p><strong>Settings:</strong> change text size, captions, sound, typewriter, reduced motion and image generation. <strong>How to play: replay the tips</strong> restores tutorial prompts.</p>
          <Shot id="settings" caption="Settings and tutorial replay" />
          <p>If an action is dim or refused, read its reason: finish a scene or movement, choose an available person, wait for the next block, check ingredients, budget and car, or respect privacy and Shabbat. Automatic arrivals, visitors, career events, arguments and reunions happen as the season advances; they have no summon button.</p>
        </Section>
      </div>
    </main>
  </div>;
}
