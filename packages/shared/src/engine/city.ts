// City graph: shortest paths, opening hours, reachability under time + money + car constraints (Section 7).
import type { CityNode } from '../contentSchema';
import type { Slot } from '../model';
import { content } from '../content';
import { SLOT_MINUTES, SLOT_START } from './core';

export const ACTIVITY_MINUTES = 60;
export const TRAIN_FARE = 220;
export const CAR_FUEL = 400;

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
export function isOpen(n: CityNode, slot: Slot): boolean {
  const start = SLOT_START[slot];
  const end = start + SLOT_MINUTES / 60;
  const [o, c] = n.open;
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
 * For each destination: travel time (one way) + activity must fit the slot budget (return trip is the next slot's
 * problem, as in the show's edit); money must cover entry + fare. Car halves walking edges and unlocks car-only edges.
 */
export function reachability(from: string, slot: Slot, money: number, carAvailable: boolean): Reach[] {
  const walk = shortestTimes(from, false);
  const drive = carAvailable ? shortestTimes(from, true) : null;
  return content()
    .city.nodes.filter((n) => n.id !== from)
    .map((n) => {
      const wm = walk[n.id];
      const dm = drive ? drive[n.id] : Infinity;
      const needsCar = !Number.isFinite(wm) || wm + ACTIVITY_MINUTES > SLOT_MINUTES;
      const minutes = needsCar ? dm : wm;
      const fare = needsCar ? CAR_FUEL : minutes > 20 ? TRAIN_FARE : 0;
      const cost = n.cost + fare;
      const open = isOpen(n, slot);
      let reason: string | undefined;
      if (!Number.isFinite(minutes)) reason = carAvailable ? 'no route' : 'needs the car';
      else if (minutes + ACTIVITY_MINUTES > SLOT_MINUTES) reason = 'too far for this slot';
      else if (!open) reason = 'closed now';
      else if (cost > money) reason = 'not enough money';
      return { node: n.id, name: n.name, minutes, cost, open, reachable: !reason, needsCar, reason };
    });
}

export const workNodes = () => content().city.nodes.filter((n) => n.activities.includes('work'));
export const WAGE: Record<string, number> = { konbini: 3000, cafe: 3200, grill: 3800, records: 3000, livehouse: 3500 };
