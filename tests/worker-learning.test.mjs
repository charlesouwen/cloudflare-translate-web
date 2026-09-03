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
const env = {
  ASSETS: {},
  AI: { run: async () => ({ response: `\`\`\`json\n${aiResponse}\n\`\`\`` }) },
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

const fallbackResponse = await worker.fetch(request({
  text: 'goodbye',
  from: 'en',
  to: 'zh-CN',
  translation: '再见',
}), { ASSETS: {} });
assert.equal(fallbackResponse.status, 200);
const fallback = await fallbackResponse.json();
assert.equal(fallback.dict[0].terms[0], '再见');

process.stdout.write('worker learning tests passed\n');
