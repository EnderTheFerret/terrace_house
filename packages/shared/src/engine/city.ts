// City graph: shortest paths, opening hours, reachability under time + car constraints, plus price levels (Section 7).
import type { CityNode } from '../contentSchema';
import type { GameState, Slot } from '../model';
import { content } from '../content';
import { SLOT_MINUTES } from './core';
import { afford, nodePrice, type Budget, type Price } from './budget';

export const ACTIVITY_MINUTES = 60;
/** Latest you can walk into a lecture and still count as attending: this much of the block must remain on arrival. */
export const LATE_LECTURE_MINUTES = 30;

/** A player may share the car already booked for their accepted meeting. */
export const carPlanNode = (s: GameState) => s.invitations.find((p) => p.status === 'accepted' && p.episode === s.world.episode && p.slot === s.world.slot && [p.from, p.to].includes(s.playerId) && [p.from, p.to].includes(s.world.carUsedBy ?? ''))?.node ?? null;
export const canUseCar = (s: GameState, destination: string) => s.world.carUsedBy === null || s.world.carUsedBy === s.playerId || carPlanNode(s) === destination;

export function node(id: string): CityNode {
  const n = content().city.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`unknown node ${id}`);
  return n;
}

/** Dijkstra over the undirected weighted graph. Car edges usable only with the car. */
export function shortestTimes(from: string, useCar: boolean): Record<string, number> {
  const { nodes, edges } = content().city;
  const dist: Record<string, number> = Object.fromEntries(nodes.map((n) => [n.id, Infinity]));
  dist[from] = 0;
  const done = new Set<string>();
  while (done.size < nodes.length) {
    let u: string | null = null;
    for (const n of nodes) if (!done.has(n.id) && (u === null || dist[n.id] < dist[u])) u = n.id;
    if (u === null || dist[u] === Infinity) break;
    done.add(u);
    for (const e of edges) {
      if (e.requiresCar && !useCar) continue;
      // driving is faster on any edge when the car is used
      const w = useCar && !e.requiresCar ? Math.ceil(e.minutes * 0.6) : e.minutes;
      const v = e.a === u ? e.b : e.b === u ? e.a : null;
      if (v && dist[u] + w < dist[v]) dist[v] = dist[u] + w;
    }
  }
  return dist;
}

export interface Reach {
  node: string;
  name: string;
  minutes: number;
  /** price level of going there (₪ … ₪₪₪) and whether your budget covers it */
  price: Price;
  afford: 'ok' | 'stretch' | 'out';
  reachable: boolean;
  needsCar: boolean;
  reason?: string;
}

/**
 * Outward journey + activity + return journey must fit the remaining block. Affordability is reported separately
 * (working somewhere never needs the budget for it).
 */
export function reachability(from: string, slot: Slot, budget: Budget, carAvailable: boolean, elapsed = 0, weekday = 3, forceCar = false, lecture = false): Reach[] {
  const walk = shortestTimes(from, false);
  const drive = carAvailable ? shortestTimes(from, true) : null;
  return content()
    .city.nodes.filter((n) => n.id !== from)
    .map((n) => {
      const wm = walk[n.id];
      const dm = drive ? drive[n.id] : Infinity;
      const left = Math.max(0, SLOT_MINUTES - elapsed);
      // a lecture you can still catch the end of: the block closes on you there, so no return leg or full hour is needed
      const need = (m: number) => (lecture ? m + LATE_LECTURE_MINUTES : m * 2 + ACTIVITY_MINUTES);
      const needsCar = forceCar || !Number.isFinite(wm) || need(wm) > left;
      const minutes = needsCar ? dm : wm;
      const price = nodePrice(n);
      let reason: string | undefined;
      if (!Number.isFinite(minutes)) reason = carAvailable ? 'no route' : 'needs the car';
      else if (need(minutes) > left) reason = lecture ? 'too late: the lecture is nearly over' : 'too far for this slot';
      return { node: n.id, name: n.name, minutes, price, afford: afford(budget, price), reachable: !reason, needsCar, reason };
    });
}

export const workNodes = () => content().city.nodes.filter((n) => n.activities.includes('work'));
export const WAGE: Record<string, number> = { konbini: 100, cafe: 110, grill: 130, records: 100, livehouse: 120 };

/** A contract pays more than a drop-in shift; two missed shifts and you're let go. */
export const CONTRACT_BONUS = 1.25;
export const MISSES_BEFORE_FIRED = 2;
export type PlayerJob = { nodeId: string; slot: Slot; weekdays: number[]; wage: number };
/** Three fixed weekdays from the signing day, spread across the week (episodes advance the weekday by one). */
export const contractDays = (weekday: number) => [...new Set([weekday % 5, (weekday + 2) % 5, (weekday + 4) % 5])].sort((a, b) => a - b);
/** Students have lectures on weekday late mornings at the university (instead of shifts). */
export const classToday = (occupation: string, weekday: number, slot: string) => /student/i.test(occupation) && weekday < 5 && slot === 'slot1';
export const shiftToday = (job: PlayerJob | null, weekday: number, slot: string) => !!job && job.slot === slot && job.weekdays.includes(weekday);
