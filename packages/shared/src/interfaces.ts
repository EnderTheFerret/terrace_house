// Adapter interfaces implemented by the server (ollama/mock LLM, comfyui/mock images).

export type LlmKind = 'beats' | 'lines' | 'deltas' | 'commentary' | 'chat' | 'summary' | 'flavor' | 'actions';

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

/** `cutout` = a finished portrait with its background removed (visual-novel standing figure). */
export type ImageKind = 'portrait' | 'scene' | 'freeze' | 'avatar' | 'location' | 'sprite' | 'cutout';

export interface ImageRequest {
  kind: ImageKind;
  prompt: string;
  negative: string;
  seed: number;
  width: number;
  height: number;
  /** stable key for placeholder palettes / prebaked asset lookup, e.g. "portrait:ren:1101" */
  subjectKey: string;
  /** Local portrait or style reference (used by the reference workflow, if configured). */
  reference?: string;
  /** Restrict a reference edit to the detected face, preserving the approved body pixels. */
  editRegion?: 'face';
  /** Crop an upright full-length source to a knees-up portrait before reference edits. */
  framing?: 'knees';
  /** Optional second reference, e.g. a sprite direction/layout guide. */
  reference2?: string;
  /** Group images: every participant's approved portrait, in the order the prompt names them (image 1, image 2, ...). */
  references?: string[];
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
  /** Hash only the workflow that draws this request, so unrelated art edits keep their cache. */
  workflowHashFor?(req: ImageRequest): string;
  health(): Promise<boolean>;
  generate(req: ImageRequest, signal?: AbortSignal, onProgress?: (p: number) => void): Promise<ImageResult>;
  /** release GPU memory (models stay on disk); called before the LLM needs the card */
  free?(): Promise<void>;
  /** stop the job currently executing (it is requeued by the caller) */
  interrupt?(): Promise<void>;
}
