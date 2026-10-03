// Fastify app: REST + SSE. Built by main.ts; also used by tests with stub adapters.
import { Recall } from './llm/recall';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync, mkdirSync } from 'node:fs';
import { z } from 'zod';
import { Appearance, Emotion, Gender, outfitFor, Slot, type Character, type ImageBackend, type ImageRequest, type LlmClient, type Occasion as OccasionName } from '@shared-roof/shared';

const Occasion = z.enum(['daily', 'date', 'outdoor', 'beach', 'sleep'] satisfies [OccasionName, ...OccasionName[]]);
import { config } from './config';
import { TextActivity } from './activity';
import { Store } from './db';
import { Generator } from './game/generate';
import { GameSession } from './game/session';
import { AssetLibrary, ImageQueue, PRIORITY } from './image/queue';
import { MockImageBackend } from './image/mock';
import { avatarRequest, cutoutRequest, expressionRequest, locationRequest, outfitPortraitRequest, photoRequest, portraitRequest, spriteRequest } from './image/requests';
import { applyCookingResult } from './game/cooking';
import { content } from '@shared-roof/shared';
import { describeAppearance } from './game/personas';

export interface AppDeps {
  llm: LlmClient;
  linesLlm?: LlmClient;
  image: ImageBackend;
  store: Store;
  workflowHash: string;
  cacheDir?: string;
  assetsDir?: string | null;
  serveWeb?: boolean;
  /** recall by meaning (embeddings); null = keyword recall only */
  recall?: Recall | null;
}

export interface Health {
  llm: 'ok' | 'down';
  image: 'ok' | 'down';
  mode: 'mock' | 'real';
  model: string;
  imageBackend: string;
  imagesOffline: boolean;
  linesModel: string;
  linesLlm: 'ok' | 'down';
}

export async function buildApp(deps: AppDeps): Promise<{ app: FastifyInstance; session: GameSession; queue: ImageQueue; health: () => Promise<Health> }> {
  const cacheDir = deps.cacheDir ?? config.cacheDir;
  mkdirSync(cacheDir, { recursive: true });
  const fallback = new MockImageBackend(cacheDir);
  const assets = deps.assetsDir === null ? null : new AssetLibrary(deps.assetsDir ?? config.assetsDir);
  const queue = new ImageQueue(deps.image, fallback, deps.store, deps.workflowHash, cacheDir, assets);
  const textActivity = new TextActivity();
  // one GPU: every model call, not only scene streams, keeps images off the card while it runs
  const gpu = () => queue.holdClear();
  const llm = textActivity.wrap(deps.llm, gpu);
  const linesLlm = textActivity.wrap(deps.linesLlm ?? deps.llm, gpu);
  const gen = new Generator(llm, linesLlm);
  const session = new GameSession(deps.store, gen, queue, deps.recall ?? null);
  session.resumeLatest();

  let cached: { at: number; h: Health } | null = null;
  const health = async (): Promise<Health> => {
    if (cached && Date.now() - cached.at < 10_000) return cached.h;
    const [l, i, lines] = await Promise.all([deps.llm.health(), deps.image.health(), (deps.linesLlm ?? deps.llm).health()]);
    const h: Health = {
      llm: l ? 'ok' : 'down',
      image: i ? 'ok' : 'down',
      mode: deps.llm.name === 'mock' ? 'mock' : 'real',
      model: deps.llm.name === 'mock' ? 'mock (templates)' : config.ollamaModel,
      imageBackend: deps.image.name,
      imagesOffline: !i || deps.image.name === 'mock' || queue.offline,
      linesModel: (deps.linesLlm ?? deps.llm).name === 'mock' ? 'mock (templates)' : config.ollamaModelLines,
      linesLlm: lines ? 'ok' : 'down',
    };
    // automatic per-call fallback: if the LLM is down, generation uses templates
    gen.llm = l ? llm : gen.mock;
    gen.linesLlm = lines ? linesLlm : gen.mock;
    cached = { at: Date.now(), h };
    return h;
  };

  const app = Fastify({ logger: false });
  app.setErrorHandler((err: unknown, _req, reply) => {
    const zod = err instanceof z.ZodError;
    const e = err as { statusCode?: number; message?: string };
    reply.status(zod ? 400 : (e.statusCode ?? 400)).send({ error: zod ? 'invalid request' : (e.message ?? 'error'), details: zod ? (err as z.ZodError).issues.slice(0, 5) : undefined });
  });

  await app.register(fastifyStatic, { root: cacheDir, prefix: '/images/', decorateReply: false });
  if (deps.serveWeb && existsSync(config.webDist)) await app.register(fastifyStatic, { root: config.webDist, prefix: '/', decorateReply: false });

  app.get('/api/health', async () => health());
  app.get('/api/activity', async () => ({ text: textActivity.current(), image: queue.activity() }));

  const PlayerSetupSchema = z.object({
    name: z.string().trim().min(1).max(40),
    age: z.number().int().min(20).max(35),
    gender: Gender,
    interestedIn: z.array(Gender).min(1),
    hometown: z.string().max(40),
    occupation: z.string().max(60),
    traits: z.array(z.number().min(0).max(1)).length(5),
    quirks: z.array(z.string()).max(3),
    tastes: z.array(z.number().min(-1).max(1)).length(6),
    hobbies: z.array(z.string().max(30)).max(3),
    appearance: Appearance,
    portraitSeed: z.number().int().optional(),
    appearanceText: z.string().max(500).optional(),
    kashrut: z.enum(['strict', 'style', 'none']).optional(),
    diet: z.enum(['omnivore', 'vegetarian', 'vegan']).optional(),
    keepsShabbat: z.boolean().optional(),
  });

  app.post('/api/game/new', async (req) => {
    const b = z.object({ seed: z.number().int().optional(), player: PlayerSetupSchema.optional(), randomizeCast: z.boolean().optional(), seasonLength: z.number().int().min(0).max(9999).optional(), moveInDay: z.boolean().optional() }).parse(req.body ?? {});
    return { view: await session.newGame(b), scenes: [] };
  });
  app.post('/api/game/new-player', async (req) => {
    const b = z.object({ player: PlayerSetupSchema }).parse(req.body ?? {});
    return { view: session.newPlayer(b.player), scenes: [] };
  });
  app.get('/api/game', async (_req, reply) => {
    if (!session.state) return reply.status(404).send({ error: 'no game' });
    return { view: session.view(), scenes: session.summaries() };
  });
  app.post('/api/game/action', async (req) => session.act((req.body as { action?: unknown })?.action));
  app.post('/api/game/end-slot', async () => session.endSlot());
  app.post('/api/studio/intermission', async () => session.intermission());
  app.post('/api/scene/:id/respond', async (req) => ({ scene: session.respond((req.params as { id: string }).id, (req.body as { response?: unknown })?.response) }));
  app.post('/api/scene/:id/choose', async (req) => {
    session.choose((req.params as { id: string }).id, req.body ?? {}); // { intent } | { text } | { done }
    return { ok: true };
  });
  app.post('/api/scene/:id/image', async (req) => session.sceneImage((req.params as { id: string }).id));
  app.get('/api/scene/:id/stream', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    const emit = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      await session.stream(id, emit);
    } catch (e) {
      emit('error', { message: (e as Error).message });
    }
    emit('end', {});
    res.end();
  });

  app.post('/api/game/cooking', async (req) => {
    const b = z.object({ recipeId: z.string(), quality: z.number().min(0).max(1), partner: z.string().optional(), servedTo: z.array(z.string()).max(6), utensil: z.enum(['meat', 'dairy', 'parve']).optional() }).parse(req.body);
    return applyCookingResult(session, b);
  });

  app.get('/api/saves', async () => ({ saves: deps.store.list() }));
  app.post('/api/saves', async (req) => {
    const b = z.object({ slot: z.number().int().min(1).max(5), name: z.string().max(60).optional() }).parse(req.body);
    return { id: session.save(b.slot, b.name) };
  });
  app.post('/api/saves/:id/load', async (req) => ({ view: session.load(Number((req.params as { id: string }).id)), scenes: [] }));

  app.post('/api/image/portrait', async (req) => {
    const b = z.object({ id: z.string().max(40).default('player'), age: z.number().int().min(20).max(80), gender: Gender, appearance: Appearance, appearanceText: z.string().max(500).optional(), portraitSeed: z.number().int(), lowRes: z.boolean().optional() }).parse(req.body);
    return queue.request(portraitRequest(b, b.lowRes), PRIORITY.playerPortrait);
  });
  app.post('/api/appearance/describe', async (req) => {
    const b = z.object({ text: z.string().trim().min(1).max(500), appearance: Appearance }).parse(req.body);
    return { appearance: await describeAppearance(gen.llm, b.text, b.appearance), appearanceText: b.text };
  });
  app.post('/api/game/appearance-palette', async (req) => {
    const b = z.object({ id: z.string().max(80), portraitSeed: z.number().int(), palette: z.object({ hair: z.string().regex(/^#[0-9a-f]{6}$/i), skin: z.string().regex(/^#[0-9a-f]{6}$/i), outfit: z.string().regex(/^#[0-9a-f]{6}$/i) }) }).parse(req.body);
    return { updated: session.setAppearancePalette(b) };
  });
  app.post('/api/image/location', async (req) => {
    const b = z.object({ location: z.string(), slot: Slot, weather: z.string() }).parse(req.body);
    return queue.request(locationRequest(b.location, b.slot, b.weather), PRIORITY.location);
  });
  app.get('/api/image/character/:id', async (req, reply) => {
    const s = session.state;
    const c = s?.characters[(req.params as { id: string }).id];
    if (!c) return reply.status(404).send({ error: 'unknown character' });
    return queue.request(portraitRequest(c), c.isPlayer ? PRIORITY.playerPortrait : PRIORITY.portrait);
  });
  app.get('/api/image/character/:id/sprite', async (req, reply) => {
    const c = session.state?.characters[(req.params as { id: string }).id];
    if (!c) return reply.status(404).send({ error: 'unknown character' });
    // today's sheet gates the episode card, so it outranks scenery; other days are background prefetch
    const day = z.coerce.number().int().min(0).default(session.state!.world.day).parse((req.query as { day?: string }).day);
    const occasion = Occasion.default('daily').parse((req.query as { occasion?: string }).occasion);
    const priority = day === session.state!.world.day && occasion === 'daily' ? PRIORITY.portrait : PRIORITY.prefetch;
    const outfit = outfitFor(c, occasion, day);
    // chain: approved portrait -> same person in today's outfit -> walk sheet; placeholders (offline/mock) skip it
    const portrait = queue.localFile(portraitRequest(c));
    const dressed = portrait ? queue.localFile(outfitPortraitRequest(c, outfit, portrait)) : null;
    if (!dressed && !queue.offline) {
      queue.request(portrait ? outfitPortraitRequest(c, outfit, portrait) : portraitRequest(c), priority);
      return reply.status(409).send({ error: 'Portrait not ready yet.' });
    }
    return queue.request(spriteRequest(c, dressed ?? undefined, outfit), priority);
  });
  const OutfitQuery = z.object({ occasion: Occasion.default('daily'), day: z.coerce.number().int().min(0).optional() });
  /** Character dressed for an occasion: the outfit portrait's request and its local file once it exists. */
  const dressed = (c: Character, o: z.infer<typeof OutfitQuery>) => {
    const outfit = outfitFor(c, o.occasion, o.day ?? session.state!.world.day);
    const base = queue.localFile(portraitRequest(c));
    const req = base ? outfitPortraitRequest(c, outfit, base) : null;
    return { c: { ...c, appearance: { ...c.appearance, outfit } }, req, file: req ? queue.localFile(req) : null };
  };
  app.get('/api/image/character/:id/outfit', async (req, reply) => {
    const c = session.state?.characters[(req.params as { id: string }).id];
    if (!c) return reply.status(404).send({ error: 'unknown character' });
    const d = dressed(c, OutfitQuery.parse(req.query));
    if (!d.req) return reply.status(409).send({ error: 'Portrait not ready yet.' });
    return queue.request(d.req, PRIORITY.currentScene);
  });
  // visual-novel figure: today's/the occasion's outfit, with the line's expression, background removed
  app.get('/api/image/character/:id/stand', async (req, reply) => {
    const c = session.state?.characters[(req.params as { id: string }).id];
    if (!c) return reply.status(404).send({ error: 'unknown character' });
    const { emotion, ...o } = OutfitQuery.extend({ emotion: Emotion.default('neutral') }).parse(req.query);
    // chain: portrait -> outfit portrait -> expression -> cutout; queue whichever step is missing
    const d = dressed(c, o);
    const source = d.req && d.file && emotion !== 'neutral' ? expressionRequest(d.c, emotion, d.file) : d.req;
    const file = source === d.req ? d.file : source && queue.localFile(source);
    if (queue.offline) {
      // saved figures stay available offline: this exact one, else the neutral one in these clothes, else a placeholder
      const saved = [source && file ? cutoutRequest(file, source) : null, d.req && d.file ? cutoutRequest(d.file, d.req) : null].find((r) => r && queue.localFile(r));
      return queue.request(saved ?? cutoutRequest('', portraitRequest(c)), PRIORITY.currentScene);
    }
    if (!source || !file) {
      queue.request(source ?? portraitRequest(c), PRIORITY.currentScene);
      return reply.status(409).send({ error: 'Portrait not ready yet.' });
    }
    return queue.request(cutoutRequest(file, source), PRIORITY.currentScene);
  });
  app.post('/api/image/character/:id/expression', async (req, reply) => {
    const { emotion, ...o } = OutfitQuery.extend({ emotion: Emotion }).parse(req.body);
    const c = session.state?.characters[(req.params as { id: string }).id];
    if (!c) return reply.status(404).send({ error: 'unknown character' });
    // expressions are drawn from the portrait in the clothes the scene calls for
    const d = dressed(c, o);
    if (emotion !== 'neutral' && !d.file) return reply.status(409).send({ error: 'Wait for the original portrait to finish before generating an expression.' });
    return queue.request(expressionRequest(d.c, emotion, d.file), PRIORITY.portrait);
  });
  // phone photos: house feed posts and selfies in chat threads, drawn on first view with everyone's real face
  const portraitOf = (r: ImageRequest) => queue.localFile(r);
  app.get('/api/image/feed/:id', async (req, reply) => {
    const s = session.state;
    const post = s?.feed.find((p) => p.id === (req.params as { id: string }).id);
    if (!s || !post) return reply.status(404).send({ error: 'unknown post' });
    const people = [post.from, post.with].filter((id): id is string => !!id && !!s.characters[id]).map((id) => s.characters[id]);
    return queue.request(photoRequest(s, people, post.location, post.slot, post.text, `feed:${s.gameId}:${post.id}`, portraitOf), PRIORITY.location);
  });
  app.get('/api/image/selfie/:from/:tick', async (req, reply) => {
    const s = session.state;
    const { from, tick } = req.params as { from: string; tick: string };
    const msg = s && Object.values(s.chats).flat().find((m) => m.photo && m.from === from && m.tick === Number(tick));
    if (!s || !msg || !s.characters[from]) return reply.status(404).send({ error: 'no such photo' });
    return queue.request(photoRequest(s, [s.characters[from]], msg.at ?? s.characters[from].location, s.world.slot, msg.text, `selfie:${s.gameId}:${from}:${tick}`, portraitOf, true), PRIORITY.location);
  });
  app.get('/api/broadcast', async () => session.broadcast());
  app.get('/api/image/panel', async () => Object.fromEntries(content().panel.map((p) => [p.id, queue.request(avatarRequest(p.id), PRIORITY.prefetch)])));
  app.get('/api/image/status/:key', async (req) => queue.status((req.params as { key: string }).key));
  app.post('/api/image/cancel/:key', async (req) => ({ cancelled: queue.cancel((req.params as { key: string }).key) }));

  app.get('/api/debug', async (_req, reply) => (session.state ? session.debug() : reply.status(404).send({ error: 'no game' })));

  return { app, session, queue, health };
}
