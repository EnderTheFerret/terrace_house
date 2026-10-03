import { describe, it, expect } from 'vitest';
import { createGame } from './loop';
import { content } from '../content';
import { mulberry32 } from '../rng';
import { candidateActions, durationFor, isShabbat, jobSchedule, resolveLocations, type AgentAction } from './agents';
import { applyCooking, canEat, npcRecipe, recipeById } from './cooking';
import { arcCandidates, refreshJobArc } from './arcs';
import { reachability, node, isOpen } from './city';
import { houseTick, workCareerTick } from './house';
import { evalAll } from './conditions';

describe('Tel Aviv house life', () => {
  it('keeps busy workers out of house arc beats and requires an available workplace visitor', () => {
    const s=createGame({seed:2});s.world.episode=3;s.world.slot='slot3';
    s.characters.shun.lastAction='work';s.characters.shun.location='station';
    expect(arcCandidates(s,mulberry32(1),new Set(['shun',s.playerId])).some((a)=>a.charId==='shun')).toBe(false);
    s.world.playerJob={nodeId:'konbini',slot:'slot3',weekdays:[0,2,4],wage:100};
    refreshJobArc(s,s.characters[s.playerId]);
    const arc=content().arcs.find((a)=>a.id===s.arcs[s.playerId].arcId)!;
    s.arcs[s.playerId].done=[arc.beats[0].id];s.world.episode=5;
    s.characters[s.playerId].location='konbini';s.characters.ren.location='konbini';
    expect(arcCandidates(s,mulberry32(1),new Set([s.playerId])).some((a)=>a.charId===s.playerId)).toBe(false);
  });
  it('leaves ongoing workers alone and queues showers while both bathrooms are occupied', () => {
    const s=createGame({seed:2});s.characters.ren.lastAction='work';s.characters.ren.location='station';
    const actions:Record<string,AgentAction>={mio:{kind:'seek',target:'ren'},sora:{kind:'shower'},shun:{kind:'shower'}};
    resolveLocations(s,actions,{ren:'station',[s.playerId]:'bathroom',kaito:'smallBathroom'});
    expect(s.characters.mio.location).toBe('living');
    expect(s.characters.sora.location).toBe('stairsUp');
    expect(s.characters.shun.location).toBe('stairsUp');
    expect(actions.sora.kind).toBe('retreat');
    expect(s.house.bathroomQueue).toContain('sora');
    const next:Record<string,AgentAction>={sora:{kind:'shower'},shun:{kind:'shower'}};
    resolveLocations(s,next,{[s.playerId]:'bathroom'});
    expect(s.characters.shun.location).toBe('smallBathroom');
    expect(s.characters.sora.location).toBe('stairsUp');
  });
  it('starts kitchen conversations only for real pan violations or stocked marked ingredients', () => {
    const s=createGame({seed:2});s.world.slot='slot1';
    const rng=mulberry32(1);rng.chance=()=>true;
    const pan=content().eventById.get('meat-pan-cheese')!,shelf=content().eventById.get('kosher-shelf')!;
    houseTick(s,rng,{});
    const allowed=(pre:typeof pan.pre)=>evalAll(s,pre,{a:'ren',b:s.playerId},rng,Object.keys(s.characters));
    expect(allowed(pan.pre)).toBe(false);
    expect(allowed(shelf.pre)).toBe(true);
    s.house.fridge={};houseTick(s,rng,{});
    expect(s.world.flags.kosherShelfStock).toBe(0);
    expect(allowed(shelf.pre)).toBe(false);
    s.world.flags.kosherPanViolation=true;s.house.kitchen.meatPanClean=false;
    expect(allowed(pan.pre)).toBe(true);
  });
  it('keeps Shabbat without cooking, work, cars or phone, and varies short activity durations', () => {
    const s = createGame({ seed: 3 });
    s.world.weekday = 5; s.world.slot = 'evening';
    const ron = s.characters.ren;
    expect(isShabbat(s,ron)).toBe(true);
    const actions = candidateActions(s,ron);
    expect(actions.some((a) => ['cook','work','text'].includes(a.kind) || a.useCar)).toBe(false);
    expect(durationFor({kind:'shower'})).toBe(40);
    expect(durationFor({kind:'nap'})).toBe(90);
    expect(durationFor({kind:'snack'})).toBe(20);
    s.world.slot='slot1';s.world.weekday=0;
    const schedule = jobSchedule(mulberry32(2),content().jobs.find((j)=>j.days==='weekdays')!);
    expect(schedule.every((j)=>!j.weekdays.includes(6))).toBe(true);
    s.world.weekday = 5; s.world.slot = 'slot3'; s.world.minutes = 50;
    for (const a of candidateActions(s, ron).filter((a) => a.useCar)) {
      expect(isShabbat({ ...s, world: { ...s.world, minutes: s.world.minutes + durationFor(a) } }, ron)).toBe(false);
    }
  });
  it('counts the journey home, remaining time, arrival hours and Saturday closures', () => {
    expect(reachability('house','slot1',3,false,160).every((r)=>!r.reachable)).toBe(true);
    expect(isOpen(node('cafe'),'slot1',0,6)).toBe(false);
    const reaches=reachability('house','slot3',3,true,150);
    expect(reaches.find((r)=>r.node==='lighthouse')!.reachable).toBe(false);
  });
  it('applies each career shift once and never forces the player to leave', () => {
    const s=createGame({seed:3});
    s.world.playerJob={nodeId:'konbini',slot:'slot1',weekdays:[0,2,4],wage:100};
    const rng=mulberry32(2);rng.next=()=>.01;
    workCareerTick(s,rng,s.characters[s.playerId]);
    workCareerTick(s,rng,s.characters[s.playerId]);
    expect(s.world.playerJob.wage).toBe(110);
    s.world.tick++;rng.next=()=>.07;
    workCareerTick(s,rng,s.characters[s.playerId]);
    expect(s.world.flags[`careerOffer_${s.playerId}`]).toBe(1);
    expect(s.world.flags[`leaving_${s.playerId}`]).toBeUndefined();
    s.world.tick++;rng.next=()=>.045;
    workCareerTick(s,rng,s.characters[s.playerId]);
    expect(s.world.playerJob).toBeNull();
  });
  it('declines incompatible food without satisfying hunger and rewards considerate cooking', () => {
    const s=createGame({seed:3});
    const dish=recipeById('curry-rice');
    expect(canEat(s.characters.sora,dish)).toBe(false);
    expect(canEat(s.characters.ren,dish,'dairy')).toBe(false);
    const refused=applyCooking(s,{recipeId:dish.id,quality:1,cook:s.playerId,servedTo:['ren'],utensil:'dairy'});
    expect(refused.receptions[0].verdict).toBe('politely declined');
    expect(refused.state.characters.ren.needs.hunger).toBe(s.characters.ren.needs.hunger);
    expect(refused.state.house.kitchen.dairyPanClean).toBe(false);
    const unmarked=structuredClone(s);unmarked.house.kitchen.kosherShelf=[];
    expect(applyCooking(unmarked,{recipeId:'miso-soup',quality:1,cook:s.playerId,servedTo:['ren']}).receptions[0].verdict).toBe('politely declined');
    expect(npcRecipe(s.characters.sora,s,mulberry32(5))?.diet).toBe('vegan');
    const onlyMeat=structuredClone(s);onlyMeat.house.fridge={chicken:8};
    expect(npcRecipe(s.characters.sora,onlyMeat,mulberry32(5))).toBeUndefined();
    const good=applyCooking(s,{recipeId:'miso-soup',quality:1,cook:s.playerId,servedTo:['sora']});
    expect(good.state.rel.sora[s.playerId].trust).toBeGreaterThan(s.rel.sora[s.playerId].trust);
  });
  it('has multiple arcs per career family and brings a contract arc to the workplace when visited', () => {
    for (const category of ['food','health','creative','trades','office','student','service']) expect(content().arcs.filter((a)=>a.category===category)).toHaveLength(2);
    const s=createGame({seed:2});s.world.episode=5;s.world.slot='slot1';
    s.world.playerJob={nodeId:'konbini',slot:'slot1',weekdays:[0,2,4],wage:125};
    refreshJobArc(s,s.characters[s.playerId]);
    const st=s.arcs[s.playerId];const arc=content().arcs.find((a)=>a.id===st.arcId)!;
    st.done=[arc.beats[0].id];
    s.characters[s.playerId].location='konbini';s.characters.ren.location='konbini';
    const beat=arcCandidates(s,mulberry32(2),new Set([s.playerId,'ren'])).find((a)=>a.charId===s.playerId);
    expect(beat?.location).toBe('konbini');
    s.characters[s.playerId].location='living';
    expect(arcCandidates(s,mulberry32(2),new Set([s.playerId,'ren'])).some((a)=>a.charId===s.playerId)).toBe(false);
  });
});
