// SQLite persistence: saves (full GameState + schemaVersion), memories, images index, events_log (replay).
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { GameState, SCHEMA_VERSION } from '@shared-roof/shared';
import { config } from './config';

export type DB = Database.Database;

export function openDb(file = resolve(config.dataDir, 'shared-roof.sqlite')): DB {
  if (file !== ':memory:') mkdirSync(resolve(file, '..'), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS saves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slot INTEGER NOT NULL,           -- 0 = autosave, 1..5 manual
      game_id TEXT NOT NULL,
      name TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      episode INTEGER NOT NULL,
      log_seq INTEGER NOT NULL,
      state_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS saves_slot ON saves(slot);
    CREATE TABLE IF NOT EXISTS memories (
      game_id TEXT NOT NULL, char_id TEXT NOT NULL, episode INTEGER, tick INTEGER, text TEXT, salience REAL
    );
    CREATE TABLE IF NOT EXISTS images (
      key TEXT PRIMARY KEY, path TEXT NOT NULL, kind TEXT, prompt TEXT, seed INTEGER, placeholder INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS events_log (
      game_id TEXT NOT NULL, seq INTEGER NOT NULL, kind TEXT NOT NULL, payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (game_id, seq)
    );
  `);
  db.prepare(`INSERT OR IGNORE INTO meta(key, value) VALUES ('db_version', '1')`).run();
  return db;
}

/** Migration stub: upgrade older saved states to the current schema version. */
export function migrateState(raw: any): GameState {
  let s = raw;
  const v = Number(s?.schemaVersion ?? 0);
  if (v < 1) {
    // v0 → v1: fields introduced in v1 get defaults
    s = { previously: '', pendingArrivals: [], counters: {}, ...s, schemaVersion: 1 };
  }
  if (s.schemaVersion > SCHEMA_VERSION) throw new Error(`save is from a newer version (${s.schemaVersion})`);
  return GameState.parse(s);
}

export interface SaveRow {
  id: number;
  slot: number;
  game_id: string;
  name: string;
  schema_version: number;
  episode: number;
  log_seq: number;
  created_at: string;
}

export class Store {
  constructor(public db: DB) {}

  save(slot: number, state: GameState, name: string, logSeq: number): number {
    if (slot > 0) this.db.prepare('DELETE FROM saves WHERE slot = ?').run(slot);
    else this.db.prepare('DELETE FROM saves WHERE slot = 0 AND id NOT IN (SELECT id FROM saves WHERE slot = 0 ORDER BY id DESC LIMIT 4)').run();
    const r = this.db
      .prepare('INSERT INTO saves(slot, game_id, name, schema_version, episode, log_seq, state_json) VALUES (?,?,?,?,?,?,?)')
      .run(slot, state.gameId, name, state.schemaVersion, state.world.episode, logSeq, JSON.stringify(state));
    // denormalized memory export for querying/debugging
    const del = this.db.prepare('DELETE FROM memories WHERE game_id = ?');
    const ins = this.db.prepare('INSERT INTO memories(game_id, char_id, episode, tick, text, salience) VALUES (?,?,?,?,?,?)');
    this.db.transaction(() => {
      del.run(state.gameId);
      for (const [cid, items] of Object.entries(state.memory)) for (const m of items) ins.run(state.gameId, cid, m.episode, m.tick, m.text, m.salience);
    })();
    return Number(r.lastInsertRowid);
  }

  list(): SaveRow[] {
    return this.db.prepare('SELECT id, slot, game_id, name, schema_version, episode, log_seq, created_at FROM saves ORDER BY slot, id DESC').all() as SaveRow[];
  }

  load(id: number): { row: SaveRow; state: GameState } | null {
    const r = this.db.prepare('SELECT * FROM saves WHERE id = ?').get(id) as (SaveRow & { state_json: string }) | undefined;
    if (!r) return null;
    return { row: r, state: migrateState(JSON.parse(r.state_json)) };
  }

  latestAutosave(): { row: SaveRow; state: GameState } | null {
    const r = this.db.prepare('SELECT id FROM saves WHERE slot = 0 ORDER BY id DESC LIMIT 1').get() as { id: number } | undefined;
    return r ? this.load(r.id) : null;
  }

  appendEvent(gameId: string, kind: string, payload: unknown): number {
    const row = this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM events_log WHERE game_id = ?').get(gameId) as { m: number };
    const seq = row.m + 1;
    this.db.prepare('INSERT INTO events_log(game_id, seq, kind, payload_json) VALUES (?,?,?,?)').run(gameId, seq, kind, JSON.stringify(payload));
    return seq;
  }

  events(gameId: string, upTo = Number.MAX_SAFE_INTEGER): { seq: number; kind: string; payload: any }[] {
    return (this.db.prepare('SELECT seq, kind, payload_json FROM events_log WHERE game_id = ? AND seq <= ? ORDER BY seq').all(gameId, upTo) as { seq: number; kind: string; payload_json: string }[]).map((r) => ({
      seq: r.seq,
      kind: r.kind,
      payload: JSON.parse(r.payload_json),
    }));
  }

  truncateEvents(gameId: string, afterSeq: number) {
    this.db.prepare('DELETE FROM events_log WHERE game_id = ? AND seq > ?').run(gameId, afterSeq);
  }

  imageGet(key: string): { path: string; placeholder: number } | undefined {
    return this.db.prepare('SELECT path, placeholder FROM images WHERE key = ?').get(key) as { path: string; placeholder: number } | undefined;
  }

  imagePut(key: string, path: string, kind: string, prompt: string, seed: number, placeholder: boolean) {
    this.db.prepare('INSERT OR REPLACE INTO images(key, path, kind, prompt, seed, placeholder) VALUES (?,?,?,?,?,?)').run(key, path, kind, prompt, seed, placeholder ? 1 : 0);
  }
}
