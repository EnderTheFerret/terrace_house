// Track actual model calls, including retries, without changing generation or fallback behavior.
import type { LlmClient, LlmRequest } from '@shared-roof/shared';

export interface Activity {
  label: string;
  startedAt: number;
  estimatedMs: number;
}
const stages = {
  actions: ['Housemates are deciding what to do', 10000],
  beats: ['Planning the conversation', 15000],
  lines: ['Generating response', 8000],
  deltas: ['Updating relationships', 15000],
  commentary: ['Generating panel commentary', 15000],
  chat: ['Generating message', 5000],
  summary: ['Generating character details', 45000],
  flavor: ['Preparing scene introduction', 8000],
} as const;

export class TextActivity {
  private active = new Map<symbol, Activity>();
  private durations = new Map<string, number>();
  current() { return [...this.active.values()]; }

  /** `gpu`: claim the shared GPU for the call (the image queue waits, ComfyUI unloads); resolves to its release. */
  wrap(client: LlmClient, gpu?: () => Promise<() => void>): LlmClient {
    const start = (req: LlmRequest) => {
      const key = Symbol();
      const kind = req.kind === 'summary' && (req.maxTokens ?? 0) < 1000 ? 'appearance' : req.kind;
      const [label, initial] = kind === 'appearance' ? ['Interpreting appearance', 10000] : stages[req.kind];
      const activity = { label, startedAt: Date.now(), estimatedMs: this.durations.get(kind) ?? initial };
      this.active.set(key, activity);
      return (success: boolean) => {
        this.active.delete(key);
        // ponytail: estimates learn per stage during this server run; persist timings if restarts matter.
        if (success && client.name !== 'mock') this.durations.set(kind, Math.max(1000, (this.durations.get(kind) ?? Date.now() - activity.startedAt) * 0.7 + (Date.now() - activity.startedAt) * 0.3));
      };
    };
    return {
      name: client.name,
      health: () => client.health(),
      complete: async req => {
        const finish = start(req);
        const release = gpu ? await gpu() : undefined;
        let success = false;
        try { const result = await client.complete(req); success = true; return result; }
        finally { release?.(); finish(success); }
      },
      stream: async function* (req) {
        const finish = start(req);
        const release = gpu ? await gpu() : undefined;
        let success = false;
        try { yield* client.stream(req); success = true; }
        finally { release?.(); finish(success); }
      },
    };
  }
}
