// Server entry: picks adapters from MODE, probes services, serves the API (and the built web app in production).
import { resolve } from 'node:path';
import { config, ROOT } from './config';
import { openDb, Store } from './db';
import { buildApp } from './app';
import { MockLlm } from './llm/mock';
import { OllamaClient } from './llm/ollama';
import { MockImageBackend } from './image/mock';
import { ComfyBackend } from './image/comfy';
import type { ImageBackend, LlmClient } from '@shared-roof/shared';

const store = new Store(openDb());
let llm: LlmClient;
let linesLlm: LlmClient;
let image: ImageBackend;
let workflowHash = 'mock';
if (config.mode === 'mock') {
  llm = new MockLlm();
  linesLlm = llm;
  image = new MockImageBackend(config.cacheDir);
} else {
  llm = new OllamaClient(config.ollamaUrl, config.ollamaModel, config.llmTimeoutMs, fetch, config.ollamaKeepAlive);
  linesLlm = config.ollamaModelLines === config.ollamaModel ? llm : new OllamaClient(config.ollamaUrl, config.ollamaModelLines, config.llmTimeoutMs, fetch, config.ollamaKeepAlive);
  try {
    const ref = config.comfyRefWorkflow === 'off' ? undefined : { workflowPath: resolve(ROOT, config.comfyRefWorkflow), mappingPath: config.comfyRefMapping };
    const comfy = new ComfyBackend(config.comfyUrl, config.comfyWorkflow, config.comfyMapping, config.cacheDir, config.imageTimeoutMs, fetch, ref, { workflowPath: resolve(ROOT, 'workflows/sprite_edit.api.json'), mappingPath: resolve(ROOT, 'workflows/sprite_mapping.json') });
    image = comfy;
    workflowHash = comfy.workflowHash;
  } catch (e) {
    console.warn(`[images] could not load ComfyUI workflow (${(e as Error).message}); using placeholders`);
    image = new MockImageBackend(config.cacheDir);
  }
}

const { app, health } = await buildApp({ llm, linesLlm, image, store, workflowHash, serveWeb: true });
const h = await health();
console.log(`[shared roof] mode=${config.mode} llm=${h.llm} (${h.model}) image=${h.image} (${h.imageBackend})`);
if (config.mode === 'real' && h.llm === 'ok') {
  // warm the model so the first scene doesn't pay the load time
  void llm.complete({ kind: 'summary', prompt: 'Reply with: ok', temperature: 0, maxTokens: 2 }).catch(() => {});
}
if (config.mode === 'real' && h.llm === 'down') console.log(`[shared roof] Ollama not reachable at ${config.ollamaUrl} or model ${config.ollamaModel} missing — falling back to templates per call.`);
if (config.mode === 'real' && h.image === 'down') console.log(`[shared roof] ComfyUI not reachable at ${config.comfyUrl} — images use placeholders ("images offline").`);
await app.listen({ port: config.port, host: '127.0.0.1' });
console.log(`[shared roof] api on http://127.0.0.1:${config.port}`);
