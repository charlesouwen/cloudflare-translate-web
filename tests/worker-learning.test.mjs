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
assert.equal((await transientResponse.json()).partial, true);

const recoveredResponse = await worker.fetch(request(recoveryBody), recoveringEnv);
assert.equal(recoveredResponse.status, 200);
const recovered = await recoveredResponse.json();
assert.equal(recovered.engine, 'cloudflare-ai');
assert.equal(recovered.partial, false);
assert.equal(recoveryCalls, 2, 'a transient fallback must not stay cached after Workers AI recovers');

process.stdout.write('worker learning tests passed\n');
