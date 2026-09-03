import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = (await fs.readFile(new URL('../src/index.js', import.meta.url), 'utf8'))
  .replace("import { franc } from 'franc-min';", "const franc = () => 'und';")
  .replace(
    "import bingLiveApi from './bing-live-api.js';",
    "const bingLiveApi = { fetch: async () => new Response('{}', { status: 501 }) };",
  );
const worker = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).default;

const request = (body) => new Request('https://example.com/api/learn', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const aiResponse = JSON.stringify({
  phonetic: '/həˈləʊ/',
  dict: [{ pos: 'interjection', terms: ['你好', '您好'] }],
  definitions: [{
    pos: 'interjection',
    meanings: [{ gloss: '用于问候。', example: 'Hello, how are you?' }],
  }],
  examples: ['Hello, everyone. — 大家好。'],
  synonyms: ['hi'],
});
let requestedModel = '';
let requestedOptions = null;
const env = {
  ASSETS: {},
  AI: { run: async (model, options) => {
    requestedModel = model;
    requestedOptions = options;
    return { response: `\`\`\`json\n${aiResponse}\n\`\`\`` };
  } },
};

const response = await worker.fetch(request({
  text: 'hello',
  from: 'en',
  to: 'zh-CN',
  translation: '你好',
}), env);
assert.equal(response.status, 200);
const result = await response.json();
assert.equal(result.headword, 'hello');
assert.equal(result.phonetic, '/həˈləʊ/');
assert.equal(result.dict[0].terms[0], '你好');
assert.equal(result.definitions[0].meanings[0].gloss, '用于问候。');
assert.equal(result.engine, 'cloudflare-ai');
assert.equal(result.partial, false);
assert.equal(requestedModel, '@cf/zai-org/glm-4.7-flash');
assert.equal(requestedOptions.response_format.type, 'json_schema');
assert.equal(requestedOptions.response_format.json_schema.strict, true);
assert.equal(requestedOptions.response_format.json_schema.schema.properties.dict.maxItems, 1);
assert.deepEqual(requestedOptions.chat_template_kwargs, { enable_thinking: false });
assert.equal(requestedOptions.max_completion_tokens, 420);

const choicesResponse = await worker.fetch(request({
  text: 'world',
  from: 'en',
  to: 'zh-CN',
  translation: '世界',
}), {
  ASSETS: {},
  AI: { run: async () => ({ choices: [{ message: { content: aiResponse } }] }) },
});
assert.equal(choicesResponse.status, 200);
const choicesResult = await choicesResponse.json();
assert.equal(choicesResult.engine, 'cloudflare-ai');
assert.equal(choicesResult.partial, false,
  'OpenAI-compatible Workers AI responses must populate the learning card');

const fallbackResponse = await worker.fetch(request({
  text: 'goodbye',
  from: 'en',
  to: 'zh-CN',
  translation: '再见',
}), { ASSETS: {} });
assert.equal(fallbackResponse.status, 200);
const fallback = await fallbackResponse.json();
assert.equal(fallback.dict[0].terms[0], '再见');

let recoveryCalls = 0;
const recoveringEnv = {
  ASSETS: {},
  AI: {
    run: async () => {
      recoveryCalls += 1;
      if (recoveryCalls === 1) throw new Error('temporary learning failure');
      return { response: aiResponse };
    },
  },
};
const recoveryBody = {
  text: 'recoverable',
  from: 'en',
  to: 'zh-CN',
  translation: '可恢复的',
};
const transientResponse = await worker.fetch(request(recoveryBody), recoveringEnv);
assert.equal(transientResponse.status, 200);
const transient = await transientResponse.json();
assert.equal(transient.partial, true);
assert.equal(transient.degradedReason, 'temporary learning failure');

const recoveredResponse = await worker.fetch(request(recoveryBody), recoveringEnv);
assert.equal(recoveredResponse.status, 200);
const recovered = await recoveredResponse.json();
assert.equal(recovered.engine, 'cloudflare-ai');
assert.equal(recovered.partial, false);
assert.equal(recoveryCalls, 2, 'a transient fallback must not stay cached after Workers AI recovers');

const edgeEntries = new Map();
let cachedMethod = '';
let cachedControl = '';
globalThis.caches = {
  default: {
    match: async (cacheRequest) => edgeEntries.get(cacheRequest.url)?.clone(),
    put: async (cacheRequest, cacheResponse) => {
      cachedMethod = cacheRequest.method;
      cachedControl = cacheResponse.headers.get('cache-control') || '';
      edgeEntries.set(cacheRequest.url, cacheResponse.clone());
    },
  },
};
const pendingCacheWrites = [];
const edgeBody = {
  text: 'durable',
  from: 'en',
  to: 'zh-CN',
  translation: '持久的',
};
const edgeFillResponse = await worker.fetch(request(edgeBody), {
  ASSETS: {},
  AI: { run: async () => ({ choices: [{ message: { content: aiResponse } }] }) },
}, {
  waitUntil: (promise) => pendingCacheWrites.push(promise),
});
assert.equal((await edgeFillResponse.json()).partial, false);
await Promise.all(pendingCacheWrites);
assert.equal(edgeEntries.size, 1);
assert.equal(cachedMethod, 'GET');
assert.equal(cachedControl, 'public, max-age=86400');
assert(![...edgeEntries.keys()][0].includes('durable'), 'the edge cache key must not expose source text');

const isolatedSource = `${source}\n/* fresh learning-cache isolate */`;
const isolatedWorker = (await import(
  `data:text/javascript;base64,${Buffer.from(isolatedSource).toString('base64')}`
)).default;
let isolatedAiCalls = 0;
const edgeHitResponse = await isolatedWorker.fetch(request(edgeBody), {
  ASSETS: {},
  AI: { run: async () => {
    isolatedAiCalls += 1;
    throw new Error('edge cache miss');
  } },
});
const edgeHit = await edgeHitResponse.json();
assert.equal(edgeHit.partial, false);
assert.equal(edgeHit.engine, 'cloudflare-ai');
assert.equal(isolatedAiCalls, 0, 'a fresh isolate must reuse the complete edge-cached learning card');

const entriesBeforeNoAiFallback = edgeEntries.size;
await isolatedWorker.fetch(request({
  text: 'uncached fallback',
  from: 'en',
  to: 'zh-CN',
  translation: '不缓存的降级结果',
}), { ASSETS: {} });
assert.equal(edgeEntries.size, entriesBeforeNoAiFallback,
  'a missing AI binding must not cache a partial learning card');
delete globalThis.caches;

process.stdout.write('worker learning tests passed\n');
