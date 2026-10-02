// City graph: shortest paths, opening hours, reachability under time + money + car constraints (Section 7).
import type { CityNode } from '../contentSchema';
import type { GameState, Slot } from '../model';
import { content } from '../content';
import { SLOT_MINUTES, SLOT_START } from './core';

export const ACTIVITY_MINUTES = 60;
export const TRAIN_FARE = 8;
export const CAR_FUEL = 14;

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

/** Is the node open for any part of the slot window [start, start+3h)? Supports hours past midnight (to > 24). */
export function isOpen(n: CityNode, slot: Slot, minutes = 0, weekday = 3): boolean {
  const start = SLOT_START[slot] + minutes / 60;
  const end = start + SLOT_MINUTES / 60;
  const [o, c] = n.openDays?.[String(weekday)] ?? n.open;
  const overlaps = (a: number, b: number) => start < b && end > a;
  return overlaps(o, c) || overlaps(o - 24, c - 24);
}

export interface Reach {
  node: string;
  name: string;
  minutes: number;
  cost: number;
  open: boolean;
  reachable: boolean;
  needsCar: boolean;
  reason?: string;
}

/**
 * Outward journey + activity + return journey must fit the remaining block. Money covers entry + fare.
 */
export function reachability(from: string, slot: Slot, money: number, carAvailable: boolean, elapsed = 0, weekday = 3, forceCar = false): Reach[] {
  const walk = shortestTimes(from, false);
  const drive = carAvailable ? shortestTimes(from, true) : null;
  return content()
    .city.nodes.filter((n) => n.id !== from)
    .map((n) => {
      const wm = walk[n.id];
      const dm = drive ? drive[n.id] : Infinity;
      const left = Math.max(0, SLOT_MINUTES - elapsed);
      const needsCar = forceCar || !Number.isFinite(wm) || wm * 2 + ACTIVITY_MINUTES > left;
      const minutes = needsCar ? dm : wm;
      const fare = needsCar ? CAR_FUEL : minutes > 20 ? TRAIN_FARE : 0;
      const cost = n.cost + fare;
      const arrival = SLOT_START[slot] + (elapsed + minutes) / 60;
      const [o, c] = n.openDays?.[String(weekday)] ?? n.open;
      const fits = (a: number, b: number) => arrival >= a && arrival + ACTIVITY_MINUTES / 60 <= b;
      const open = fits(o, c) || fits(o - 24, c - 24);
      let reason: string | undefined;
      if (!Number.isFinite(minutes)) reason = carAvailable ? 'no route' : 'needs the car';
      else if (minutes * 2 + ACTIVITY_MINUTES > left) reason = 'too far for this slot';
      else if (!open) reason = 'closed now';
      else if (cost > money) reason = 'not enough money';
      return { node: n.id, name: n.name, minutes, cost, open, reachable: !reason, needsCar, reason };
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
export const shiftToday = (job: PlayerJob | null, weekday: number, slot: string) => !!job && job.slot === slot && job.weekdays.includes(weekday);
