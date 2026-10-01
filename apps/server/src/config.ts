// Configuration from .env (Node's built-in loader; no dotenv dependency).
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '../../..');

const envFile = resolve(ROOT, '.env');
if (existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    /* malformed .env: fall back to defaults */
  }
}

const env = (k: string, d: string) => {
  const v = process.env[k];
  return v === undefined || v.trim() === '' ? d : v.replace(/\s+#.*$/, '').trim();
};
const num = (k: string, d: number) => {
  const n = Number(env(k, String(d)));
  return Number.isFinite(n) ? n : d;
};

export const config = {
  mode: (env('MODE', 'real') === 'mock' ? 'mock' : 'real') as 'mock' | 'real',
  ollamaUrl: env('OLLAMA_URL', 'http://127.0.0.1:11434'),
  ollamaModel: env('OLLAMA_MODEL', 'gemma3:12b'),
  comfyUrl: env('COMFY_URL', 'http://127.0.0.1:8188'),
  comfyWorkflow: resolve(ROOT, env('COMFY_WORKFLOW', './workflows/txt2img.api.json')),
  comfyMapping: resolve(ROOT, env('COMFY_MAPPING', './workflows/mapping.json')),
  stylePrefix: env('IMAGE_STYLE_PREFIX', 'pixel art, 16-bit retro game art, clean pixel clusters, limited pastel palette, soft lighting, reality show still'),
  seasonLength: num('SEASON_LENGTH', 24),
  llmCallsPerSlot: num('LLM_CALLS_PER_SLOT', 6),
  seed: env('SEED', ''),
  language: env('LANGUAGE', 'en'),
  port: num('PORT', 8787),
  llmTimeoutMs: num('LLM_TIMEOUT_MS', 45000),
  imageTimeoutMs: num('IMAGE_TIMEOUT_MS', 180000),
  temps: {
    lines: num('TEMP_DIALOGUE', 0.9),
    beats: num('TEMP_BEATS', 0.7),
    deltas: num('TEMP_DELTAS', 0.2),
    commentary: num('TEMP_COMMENTARY', 0.9),
    chat: num('TEMP_DIALOGUE', 0.9),
    summary: 0.5,
    flavor: 0.8,
  },
  dataDir: resolve(ROOT, 'data'),
  cacheDir: resolve(ROOT, 'cache', 'images'),
  logsDir: resolve(ROOT, 'logs'),
  assetsDir: resolve(ROOT, 'apps', 'web', 'public', 'assets'),
  webDist: resolve(ROOT, 'apps', 'web', 'dist'),
  sizes: {
    portrait: [832, 1216],
    scene: [1216, 832],
    freeze: [1216, 832],
    avatar: [512, 512],
    location: [1216, 832],
  } as Record<string, [number, number]>,
};

export type Config = typeof config;
