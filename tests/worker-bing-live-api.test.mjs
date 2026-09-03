import assert from 'node:assert/strict';

import worker from '../src/index.js';

const env = {
  ASSETS: {
    fetch: () => new Response('asset', { status: 200 }),
  },
};

async function jsonRequest(path, init) {
  const response = await worker.fetch(new Request(`https://fanyi.411081.xyz${path}`, init), env, {});
  return { response, payload: await response.json() };
}

const health = await jsonRequest('/api/health');
assert.equal(health.response.status, 200);
assert.equal(health.payload.ok, true);
assert.equal(health.payload.service, 'bing-live-interpreter');
assert(health.payload.features.includes('speech'));
assert(health.payload.features.includes('tts'));

const languages = await jsonRequest('/api/languages');
assert.equal(languages.response.status, 200);
const simplifiedChinese = languages.payload.languages.find((language) => language.code === 'zh-Hans');
assert.equal(simplifiedChinese.speechLocale, 'zh-CN');
assert(languages.payload.languages.some((language) => language.code === 'en'));

const voices = await jsonRequest('/api/voices?lang=zh-Hans');
assert.equal(voices.response.status, 200);
assert(voices.payload.voices.length >= 2);
assert(voices.payload.voices.every((voice) => voice.targetLang === 'zh-Hans'));
assert(voices.payload.voices.some((voice) => voice.voiceName === 'zh-CN-XiaoxiaoNeural'));

const correction = await jsonRequest('/api/correct', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ text: '', lang: 'zh-Hans' }),
});
assert.equal(correction.response.status, 200);
assert.equal(correction.payload.changed, false);

const emptyTts = await jsonRequest('/api/tts', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ text: '', lang: 'zh-Hans' }),
});
assert.equal(emptyTts.response.status, 400);
assert.match(emptyTts.payload.error, /text is required/i);

process.stdout.write('worker Bing live API compatibility tests passed\n');
