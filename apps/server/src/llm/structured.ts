// Structured LLM calls: JSON schema → zod validation → one retry with the error appended → mock fallback.
// Failures go to logs/llm-failures.jsonl; gameplay never blocks.
import { appendFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { LlmClient, LlmRequest } from '@shared-roof/shared';
import { config } from '../config';

export function logFailure(prompt: string, error: string, kind: string) {
  try {
    mkdirSync(config.logsDir, { recursive: true });
    const hash = createHash('sha256').update(prompt).digest('hex').slice(0, 16);
    appendFileSync(resolve(config.logsDir, 'llm-failures.jsonl'), JSON.stringify({ at: new Date().toISOString(), kind, promptHash: hash, error: error.slice(0, 500) }) + '\n');
  } catch {
    /* logging must never break gameplay */
  }
}

/** Pull the first JSON object out of a model response (models sometimes wrap JSON in prose/fences). */
export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(t);
  } catch {
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
    throw new Error('no JSON object in response');
  }
}

export const jsonSchemaOf = (schema: z.ZodType) => z.toJSONSchema(schema, { target: 'draft-7', unrepresentable: 'any' }) as Record<string, unknown>;

/** Per-slot LLM call budget (LLM_CALLS_PER_SLOT). */
export class Budget {
  used = 0;
  log: { kind: string; ok: boolean; source: string }[] = [];
  constructor(public cap: number) {}
  reset() {
    this.used = 0;
    this.log = [];
  }
  /** Reserve n calls; false when the cap would be exceeded (caller falls back to templates). */
  take(n = 1) {
    if (this.used + n > this.cap) return false;
    this.used += n;
    return true;
  }
  get remaining() {
    return Math.max(0, this.cap - this.used);
  }
}

export interface StructuredResult<T> {
  value: T;
  source: 'llm' | 'mock';
  error?: string;
}

export async function structured<T>(
  llm: LlmClient,
  mock: LlmClient,
  req: LlmRequest,
  schema: z.ZodType<T>,
  budget: Budget | null,
): Promise<StructuredResult<T>> {
  const viaMock = async (error?: string): Promise<StructuredResult<T>> => {
    const raw = await mock.complete(req);
    return { value: schema.parse(extractJson(raw)), source: 'mock', error };
  };
  if (llm.name === 'mock' || (budget && !budget.take())) return viaMock();
  const withSchema: LlmRequest = { ...req, schema: req.schema ?? jsonSchemaOf(schema) };
  let lastErr = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const prompt = attempt === 0 ? withSchema.prompt : `${withSchema.prompt}\n\nYour previous answer was invalid: ${lastErr.slice(0, 300)}\nReturn ONLY valid JSON matching the schema.`;
      if (attempt === 1 && budget && !budget.take()) break;
      const text = await llm.complete({ ...withSchema, prompt });
      const parsed = schema.safeParse(extractJson(text));
      if (parsed.success) {
        budget?.log.push({ kind: req.kind, ok: true, source: 'llm' });
        return { value: parsed.data, source: 'llm' };
      }
      lastErr = parsed.error.message;
    } catch (e) {
      lastErr = (e as Error).message;
      if ((e as Error).name === 'TimeoutError' || /fetch failed|ECONNREFUSED/.test(lastErr)) break; // service down: no retry
    }
  }
  logFailure(req.prompt, lastErr, req.kind);
  budget?.log.push({ kind: req.kind, ok: false, source: 'mock' });
  return viaMock(lastErr);
}
