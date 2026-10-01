// Adapter interfaces implemented by the server (ollama/mock LLM, comfyui/mock images).

export type LlmKind = 'beats' | 'lines' | 'deltas' | 'commentary' | 'chat' | 'summary' | 'flavor';

export interface LlmRequest {
  kind: LlmKind;
  /** full prompt (persona + rules folded into the first user turn; no system role) */
  prompt: string;
  temperature: number;
  /** JSON schema for structured output (Ollama `format`) */
  schema?: Record<string, unknown>;
  maxTokens?: number;
  /** structured context used by the mock client to produce template output */
  context?: unknown;
  signal?: AbortSignal;
}

export interface LlmClient {
  readonly name: string;
  health(): Promise<boolean>;
  complete(req: LlmRequest): Promise<string>;
  stream(req: LlmRequest): AsyncIterable<string>;
}

export type ImageKind = 'portrait' | 'scene' | 'freeze' | 'avatar' | 'location';

export interface ImageRequest {
  kind: ImageKind;
  prompt: string;
  negative: string;
  seed: number;
  width: number;
  height: number;
  /** stable key for placeholder palettes / prebaked asset lookup, e.g. "portrait:ren:1101" */
  subjectKey: string;
  /** structured hints for procedural placeholders */
  meta?: {
    appearance?: import('./model').Appearance;
    gender?: string;
    timeOfDay?: 'morning' | 'day' | 'evening' | 'night';
    weather?: string;
    people?: { appearance: import('./model').Appearance; gender: string; seed: number }[];
  };
}

export interface ImageResult {
  id: string;
  path: string;
  mime: string;
  placeholder: boolean;
}

export interface ImageBackend {
  readonly name: string;
  health(): Promise<boolean>;
  generate(req: ImageRequest, signal?: AbortSignal): Promise<ImageResult>;
}
