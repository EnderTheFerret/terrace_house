// Server entry: picks adapters from MODE, probes services, serves the API (and the built web app in production).
import { config } from './config';
import { openDb, Store } from './db';
import { buildApp } from './app';
import { MockLlm } from './llm/mock';
import { OllamaClient } from './llm/ollama';
import { MockImageBackend } from './image/mock';
import { ComfyBackend } from './image/comfy';
import type { ImageBackend, LlmClient } from '@shared-roof/shared';

const store = new Store(openDb());
let llm: LlmClient;
let image: ImageBackend;
let workflowHash = 'mock';
if (config.mode === 'mock') {
  llm = new MockLlm();
  image = new MockImageBackend(config.cacheDir);
} else {
  llm = new OllamaClient(config.ollamaUrl, config.ollamaModel, config.llmTimeoutMs);
  try {
    const comfy = new ComfyBackend(config.comfyUrl, config.comfyWorkflow, config.comfyMapping, config.cacheDir, config.imageTimeoutMs);
    image = comfy;
    workflowHash = comfy.workflowHash;
  } catch (e) {
    console.warn(`[images] could not load ComfyUI workflow (${(e as Error).message}); using placeholders`);
    image = new MockImageBackend(config.cacheDir);
  }
}

const { app, health } = await buildApp({ llm, image, store, workflowHash, serveWeb: process.env.NODE_ENV === 'production' });
const h = await health();
console.log(`[shared roof] mode=${config.mode} llm=${h.llm} (${h.model}) image=${h.image} (${h.imageBackend})`);
if (config.mode === 'real' && h.llm === 'down') console.log(`[shared roof] Ollama not reachable at ${config.ollamaUrl} or model ${config.ollamaModel} missing — falling back to templates per call.`);
if (config.mode === 'real' && h.image === 'down') console.log(`[shared roof] ComfyUI not reachable at ${config.comfyUrl} — images use placeholders ("images offline").`);
await app.listen({ port: config.port, host: '127.0.0.1' });
console.log(`[shared roof] api on http://127.0.0.1:${config.port}`);
