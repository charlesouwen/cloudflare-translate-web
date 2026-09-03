import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const sourceUrl = new URL('../src/index.js', import.meta.url);
const source = (await fs.readFile(sourceUrl, 'utf8'))
  .replace("import { franc } from 'franc-min';", "const franc = () => 'und';")
  .replace(
    "import bingLiveApi from './bing-live-api.js';",
    'const bingLiveApi = { fetch: (...args) => globalThis.__testBingLiveFetch(...args) };',
  );
const workerUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const worker = (await import(workerUrl)).default;

const originalFetch = globalThis.fetch;
const wait = (milliseconds, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, milliseconds);
  const abort = () => {
    clearTimeout(timer);
    reject(new Error('aborted'));
  };
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
});

function request(text, overrides = {}) {
  return new Request('https://fanyi.92haohuo.cn/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, sl: 'en', tl: 'zh-CN', provider: 'auto', ...overrides }),
  });
}

function edgeResponse(translatedText) {
  return new Response(JSON.stringify([{
    detectedLanguage: { language: 'en' },
    translations: [{ text: translatedText, to: 'zh-Hans' }],
  }]), { status: 200 });
}

function microsoftResponse(translatedText) {
  return new Response(JSON.stringify([{
    detectedLanguage: { language: 'en' },
    translations: [{ text: translatedText, to: 'zh-Hans' }],
  }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function googleCloudResponse(translatedText) {
  return new Response(JSON.stringify({
    data: { translations: [{ translatedText, detectedSourceLanguage: 'en' }] },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function googleWebRpcResponse(translatedText, detectedLanguage = 'en', sourceText = 'source text') {
  const rpcPayload = [
    [null, null, detectedLanguage, [], null, null, [sourceText, 'auto', 'zh-CN', true]],
    [[[
      null, null, null, null, null,
      [[translatedText, null, null, null, null, null, sourceText, 1]],
      null, null, null, [],
    ]], 'zh-CN', 1, detectedLanguage, [sourceText, 'auto', 'zh-CN', true]],
    detectedLanguage,
  ];
  const envelope = [[
    'wrb.fr', 'MkEWBc', JSON.stringify(rpcPayload), null, null, null, 'generic',
  ]];
  return new Response(`)]}'\n\n${JSON.stringify(envelope)}\n`, {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function responsePayload(response) {
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

globalThis.__testBingLiveFetch = async () => new Response(JSON.stringify({
  translation: 'Tone result',
  toneApplied: true,
  engine: 'bing-tone',
}), { status: 200, headers: { 'Content-Type': 'application/json' } });

try {
  {
    const calls = [];
    let cloudflareCalls = 0;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push(url);
      assert(url.includes('edge.microsoft.com/translate/translatetext'));
      await wait(15, init?.signal);
      return edgeResponse('Fast Bing result');
    };
    const env = { AI: { async run() { cloudflareCalls += 1; return { translated_text: 'Unexpected CF' }; } } };
    const payload = await responsePayload(await worker.fetch(request('Fast primary sentence'), env, {}));
    assert.equal(payload.provider, 'bing');
    assert.equal(payload.translatedText, 'Fast Bing result');
    await wait(340);
    assert.equal(calls.length, 1, 'a fast primary must make exactly one upstream HTTP request');
    assert.equal(cloudflareCalls, 0, 'a fast primary must cancel the Cloudflare hedge timer');
    assert(!calls.some((url) => url.includes('translate.google')),
      'a fast primary must finish before the Google Web hedge starts');
  }

  {
    let edgeCalls = 0;
    let googleCalls = 0;
    let cloudflareCalls = 0;
    let googleStartedAt = 0;
    const startedAt = Date.now();
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('edge.microsoft.com/translate/translatetext')) {
        edgeCalls += 1;
        await wait(900, init?.signal);
        return edgeResponse('Late Bing result');
      }
      assert(url.includes('/_/TranslateWebserverUi/data/batchexecute'));
      assert.equal(init?.method, 'POST');
      assert(new URLSearchParams(init?.body).get('f.req')?.includes('MkEWBc'));
      googleCalls += 1;
      googleStartedAt = Date.now();
      await wait(8, init?.signal);
      return googleWebRpcResponse('Google Web hedge result');
    };
    const env = { AI: { async run() {
      cloudflareCalls += 1;
      return { translated_text: 'Unexpected Cloudflare result' };
    } } };
    const payload = await responsePayload(await worker.fetch(request('Delayed primary sentence'), env, {}));
    assert.equal(payload.provider, 'google');
    assert.equal(payload.engine, 'google-web-rpc');
    assert.equal(edgeCalls, 1);
    assert.equal(googleCalls, 1);
    assert.equal(cloudflareCalls, 0);
    const hedgeDelay = googleStartedAt - startedAt;
    assert(hedgeDelay >= 250 && hedgeDelay < 600,
      `Google Web RPC should start near the 300 ms hedge threshold, got ${hedgeDelay} ms`);
  }

  {
    let googleCalls = 0;
    let cloudflareCalls = 0;
    let cloudflareStartedAt = 0;
    const startedAt = Date.now();
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes('edge.microsoft.com/translate/translatetext')) {
        return new Response('unavailable', { status: 503 });
      }
      assert(url.includes('/_/TranslateWebserverUi/data/batchexecute'));
      googleCalls += 1;
      return new Response('rate limited', { status: 429 });
    };
    const env = { AI: { async run() {
      cloudflareCalls += 1;
      cloudflareStartedAt = Date.now();
      return { translated_text: 'Immediate Cloudflare fallback' };
    } } };
    const payload = await responsePayload(await worker.fetch(request('Primary failure sentence'), env, {}));
    assert.equal(payload.provider, 'cloudflare');
    assert.equal(googleCalls, 1);
    assert.equal(cloudflareCalls, 1);
    assert(cloudflareStartedAt - startedAt < 200,
      'primary and Google failure must start Cloudflare immediately instead of waiting for timers');
  }

  {
    let edgeCalls = 0;
    globalThis.fetch = async (input, init) => {
      edgeCalls += 1;
      assert(String(input).includes('edge.microsoft.com/translate/translatetext'));
      await wait(40, init?.signal);
      return edgeResponse('Coalesced Bing result');
    };
    const env = {};
    const [first, second] = await Promise.all([
      worker.fetch(request('Concurrent identical sentence'), env, {}),
      worker.fetch(request('Concurrent identical sentence'), env, {}),
    ]);
    const [firstPayload, secondPayload] = await Promise.all([responsePayload(first), responsePayload(second)]);
    assert.equal(firstPayload.translatedText, 'Coalesced Bing result');
    assert.equal(secondPayload.translatedText, 'Coalesced Bing result');
    assert.equal(edgeCalls, 1, 'same-key concurrent requests must share one in-flight translation');
    const cachedPayload = await responsePayload(await worker.fetch(
      request('Concurrent identical sentence'), env, {},
    ));
    assert.equal(cachedPayload.cacheHit, true);
    assert.equal(edgeCalls, 1, 'a completed same-key translation must be served from the Worker cache');
  }

  {
    globalThis.fetch = async (input) => {
      assert(String(input).includes('/_/TranslateWebserverUi/data/batchexecute'));
      return new Response(`)]}'\n\n[["wrb.fr","MkEWBc",null]]\n`, { status: 200 });
    };
    const response = await worker.fetch(request('Malformed Google RPC payload', {
      provider: 'google',
    }), {}, {});
    assert.equal(response.status, 502);
    const payload = await response.json();
    assert.equal(payload.error, 'google translation failed');
    assert.match(payload.details, /translation payload/);
  }

  {
    const calls = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push(url);
      assert(url.startsWith('https://api.cognitive.microsofttranslator.com/translate?'));
      await wait(10, init?.signal);
      return microsoftResponse('Official Microsoft result');
    };
    const env = { MICROSOFT_TRANSLATOR_KEY: 'microsoft-secret' };
    const payload = await responsePayload(await worker.fetch(request('Official Microsoft primary'), env, {}));
    assert.equal(payload.provider, 'microsoft');
    assert.equal(payload.translatedText, 'Official Microsoft result');
    assert.equal(calls.length, 1);
    assert(!calls.some((url) => url.includes('edge.microsoft.com')),
      'official Microsoft must replace Bing Edge as Auto primary when configured');
  }

  {
    const calls = [];
    let cloudflareCalls = 0;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('edge.microsoft.com/translate/translatetext')) {
        await wait(700, init?.signal);
        return edgeResponse('Late Bing result');
      }
      if (url.startsWith('https://translation.googleapis.com/language/translate/v2?key=')) {
        await wait(8, init?.signal);
        return googleCloudResponse('Official Google &amp; hedge result');
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };
    const env = {
      GOOGLE_TRANSLATE_API_KEY: 'google-secret',
      AI: { async run() { cloudflareCalls += 1; return { translated_text: 'Unexpected CF' }; } },
    };
    const payload = await responsePayload(await worker.fetch(request('Official Google hedge'), env, {}));
    assert.equal(payload.provider, 'google');
    assert.equal(payload.engine, 'google-cloud');
    assert.equal(payload.translatedText, 'Official Google & hedge result',
      'Google Cloud HTML entities must be decoded before reaching the conversation');
    assert(calls.some((url) => url.startsWith('https://translation.googleapis.com/language/translate/v2?key=')));
    assert(!calls.some((url) => url.includes('/translate_a/single')),
      'Auto must never fall back to anonymous Google');
    assert.equal(cloudflareCalls, 0, 'a successful official Google hedge must cancel the tertiary timer');
  }

  {
    const calls = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push(url);
      assert(url.includes('/_/TranslateWebserverUi/data/batchexecute'));
      assert.equal(init?.method, 'POST');
      return googleWebRpcResponse('Explicit Google Web RPC result');
    };
    const payload = await responsePayload(await worker.fetch(request('Explicit Google Web request', {
      provider: 'google',
    }), {}, {}));
    assert.equal(payload.provider, 'google');
    assert.equal(payload.engine, 'google-web-rpc');
    assert.equal(payload.translatedText, 'Explicit Google Web RPC result');
    assert.equal(calls.length, 1, 'explicit Google must use one modern Web RPC request');
  }

  {
    let bingToneCalls = 0;
    const calls = [];
    globalThis.__testBingLiveFetch = async () => {
      bingToneCalls += 1;
      throw new Error('Bing tone should not run');
    };
    globalThis.fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      assert(url.includes('/_/TranslateWebserverUi/data/batchexecute'));
      return googleWebRpcResponse('Explicit Google formal fallback');
    };
    const payload = await responsePayload(await worker.fetch(request('Explicit styled Google', {
      provider: 'google',
      tone: 'Formal',
      from: 'en',
      to: 'zh-CN',
      isVoice: true,
    }), {}, {}));
    assert.equal(payload.provider, 'google');
    assert.equal(payload.toneApplied, false);
    assert.equal(payload.toneFallback, true);
    assert.equal(bingToneCalls, 0, 'an explicit non-Bing provider must not silently invoke Bing tone');
    assert.equal(calls.length, 1);
  }

  {
    globalThis.fetch = async (input) => {
      assert(String(input).includes('/_/TranslateWebserverUi/data/batchexecute'));
      return googleWebRpcResponse('Hello', 'zh-CN', '你好');
    };
    const response = await worker.fetch(new Request('https://fanyi.92haohuo.cn/api/detect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '你好' }),
    }), {}, {});
    const payload = await responsePayload(response);
    assert.equal(payload.language, 'zh-CN');
    assert.equal(payload.fallback, undefined);
  }

  {
    let bingToneCalls = 0;
    globalThis.__testBingLiveFetch = async () => {
      bingToneCalls += 1;
      throw new Error('Standard tone must not use the legacy delegate');
    };
    globalThis.fetch = async (input) => {
      assert(String(input).includes('edge.microsoft.com/translate/translatetext'));
      return edgeResponse('Standard fields result');
    };
    const payload = await responsePayload(await worker.fetch(request('Standard fields request', {
      tone: 'Standard',
      from: 'en',
      to: 'zh-CN',
      isVoice: true,
    }), {}, {}));
    assert.equal(payload.provider, 'bing');
    assert.equal(bingToneCalls, 0,
      'Standard requests carrying legacy fields must use v28 scheduling');
  }

  {
    let cloudflareCalls = 0;
    globalThis.fetch = async (input) => {
      assert(String(input).includes('edge.microsoft.com/translate/translatetext'));
      return edgeResponse('Obvious source echo');
    };
    const env = { AI: { async run() {
      cloudflareCalls += 1;
      return { translated_text: 'Validated fallback result' };
    } } };
    const payload = await responsePayload(await worker.fetch(request('Obvious source echo'), env, {}));
    assert.equal(payload.provider, 'cloudflare');
    assert.equal(cloudflareCalls, 1, 'an obvious source echo must be rejected and fall back');
  }

  {
    globalThis.fetch = async (input) => {
      assert(String(input).includes('/_/TranslateWebserverUi/data/batchexecute'));
      return googleWebRpcResponse('Google recovered result');
    };
    const payload = await responsePayload(await worker.fetch(request('Google recovery observation', {
      provider: 'google',
    }), {}, {}));
    assert.equal(payload.provider, 'google');
    assert.equal(payload.translatedText, 'Google recovered result');
  }

  {
    let fetchCalls = 0;
    let aiCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error('status must not fetch upstream');
    };
    const env = { AI: { async run() { aiCalls += 1; throw new Error('status must not run AI'); } } };
    const statusResponse = await worker.fetch(
      new Request('https://fanyi.92haohuo.cn/status?format=json'), env, {},
    );
    const payload = await responsePayload(statusResponse);
    assert.equal(payload.version, 'translate-v28');
    assert.equal(payload.checks.translation.google_public_auto, true);
    assert.equal(payload.providers.google.status, 'ok');
    assert.equal(payload.providers.google.healthy, true);
    assert.equal(payload.providers.google.configured, false);
    assert.equal(payload.providers.google.auto_eligible, true);
    assert.equal(payload.providers.google.mode, 'google-web-rpc-best-effort');
    assert.equal(fetchCalls, 0, 'status must be passive and perform no provider fetches');
    assert.equal(aiCalls, 0, 'status must not consume Workers AI quota');
    assert.notEqual(payload.status, 'down',
      'an unverified Google Web RPC hedge must not make Auto unhealthy');
  }
} finally {
  globalThis.fetch = originalFetch;
  delete globalThis.__testBingLiveFetch;
}

process.stdout.write('worker translation race tests passed\n');
