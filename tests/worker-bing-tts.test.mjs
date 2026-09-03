import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const sourceUrl = new URL('../src/index.js', import.meta.url);
const source = (await fs.readFile(sourceUrl, 'utf8'))
  .replace("import { franc } from 'franc-min';", "const franc = () => 'und';")
  .replace(
    "import bingLiveApi from './bing-live-api.js';",
    "const bingLiveApi = { fetch: async () => new Response('{}', { status: 501 }) };",
  );
const workerUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const worker = (await import(workerUrl)).default;

const originalFetch = globalThis.fetch;
const calls = [];
let edgeAvailable = false;
let edgeSocket = null;
const sessionHtml = `
  <html data-iid="translator.5023">
    <script>
      var page = { IG: "TESTIG123" };
      var params_AbusePreventionHelper = [1786587773356,"test-token",3600000];
    </script>
  </html>`;

class FakeEdgeSocket {
  constructor() {
    this.handlers = new Map();
    this.sent = [];
    this.accepted = false;
  }

  accept() { this.accepted = true; }
  addEventListener(type, handler) { this.handlers.set(type, handler); }
  removeEventListener(type, handler) {
    if (this.handlers.get(type) === handler) this.handlers.delete(type);
  }
  close() {}
  send(message) {
    this.sent.push(message);
    if (!String(message).includes('Path:ssml')) return;
    queueMicrotask(() => {
      const header = new TextEncoder().encode('Content-Type:audio/mpeg\r\nPath:audio\r\n');
      const packet = new Uint8Array(2 + header.byteLength + 4);
      new DataView(packet.buffer).setUint16(0, header.byteLength, false);
      packet.set(header, 2);
      packet.set([0x49, 0x44, 0x33, 0x04], 2 + header.byteLength);
      this.handlers.get('message')?.({ data: packet.buffer });
      this.handlers.get('message')?.({ data: 'X-Timestamp:test\r\nPath:turn.end\r\n\r\n' });
    });
  }
}

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  calls.push({ url, init });
  if (url.includes('/translator')) {
    return new Response(sessionHtml, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'set-cookie': 'MUID=test-cookie; Path=/; Secure; HttpOnly',
      },
    });
  }
  if (url.includes('/tfettts')) {
    const ttsCalls = calls.filter((call) => call.url.includes('/tfettts'));
    if (ttsCalls.length === 1) {
      return new Response('', { status: 401 });
    }
    return new Response(new Uint8Array([0x49, 0x44, 0x33, 0x04]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg' },
    });
  }
  if (url.includes('speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1')) {
    if (!edgeAvailable) {
      return new Response('', { status: 403, headers: { Date: new Date().toUTCString() } });
    }
    edgeSocket = new FakeEdgeSocket();
    return { status: 101, webSocket: edgeSocket };
  }
  throw new Error(`Unexpected upstream request: ${url}`);
};

try {
  const response = await worker.fetch(new Request(
    'https://fanyi.92haohuo.cn/api/tts?q=hello&tl=zh-CN&provider=bing&profile=sweet-female&rate=-20',
  ), { AI: {}, ASSETS: {} });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'audio/mpeg');
  assert.equal(response.headers.get('x-tts-provider'), 'bing');
  assert.equal(response.headers.get('x-tts-upstream'), 'bing-translator');
  assert.equal(response.headers.get('x-tts-profile-applied'), 'true');
  assert.equal(response.headers.get('x-tts-rate-applied'), 'true');
  assert.equal((await response.arrayBuffer()).byteLength, 4);

  const pageCalls = calls.filter((call) => call.url.includes('/translator'));
  const ttsCalls = calls.filter((call) => call.url.includes('/tfettts'));
  assert.equal(pageCalls.length, 1);
  assert.equal(ttsCalls.length, 2);
  assert.match(ttsCalls[0].url, /[?&]isVertical=1(?:&|$)/);
  assert.match(ttsCalls[0].url, /[?&]SFX=1(?:&|$)/);
  assert.match(ttsCalls[1].url, /[?&]SFX=2(?:&|$)/);

  const firstHeaders = new Headers(ttsCalls[0].init.headers);
  const secondHeaders = new Headers(ttsCalls[1].init.headers);
  assert.equal(firstHeaders.has('cookie'), false, 'the first request must not send a cookie');
  assert.match(secondHeaders.get('cookie') || '', /MUID=test-cookie/);

  const body = String(ttsCalls[0].init.body || '');
  const form = new URLSearchParams(body.replace(/^&/, ''));
  const ssml = form.get('ssml') || '';
  assert.deepEqual([...form.keys()].sort(), ['key', 'ssml', 'token']);
  assert.match(ssml, /name='zh-CN-XiaoxiaoNeural'/);
  assert.match(ssml, /<prosody rate='-20\.00%'>hello<\/prosody>/);
  assert.doesNotMatch(body, /(?:^|&)text=/);
  assert.doesNotMatch(body, /(?:^|&)lang=/);

  edgeAvailable = true;
  const edgeResponse = await worker.fetch(new Request(
    'https://fanyi.92haohuo.cn/api/tts?q=hello&tl=en&provider=bing&profile=sweet-female&rate=-10',
  ), { AI: {}, ASSETS: {} });
  assert.equal(edgeResponse.status, 200);
  assert.equal(edgeResponse.headers.get('content-type'), 'audio/mpeg');
  assert.equal(edgeResponse.headers.get('x-tts-provider'), 'bing');
  assert.equal(edgeResponse.headers.get('x-tts-upstream'), 'bing-edge-readaloud');
  assert.equal(edgeResponse.headers.get('x-tts-profile-applied'), 'true');
  assert.equal((await edgeResponse.arrayBuffer()).byteLength, 4);
  assert.equal(edgeSocket.accepted, true);
  assert.equal(edgeSocket.sent.length, 2);
  assert.match(edgeSocket.sent[0], /Path:speech\.config/);
  assert.match(edgeSocket.sent[1], /Path:ssml/);
  assert.match(edgeSocket.sent[1], /name='Microsoft Server Speech Text to Speech Voice \(en-US, AriaNeural\)'/);
  assert.match(edgeSocket.sent[1], /rate='-10%'/);
  assert.match(edgeSocket.sent[1], /X-Timestamp:.+\)Z\r\nPath:ssml/);
  const edgeCalls = calls.filter((call) => call.url.includes('speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1'));
  const successfulEdgeCall = edgeCalls[edgeCalls.length - 1];
  assert.match(successfulEdgeCall.url, /Sec-MS-GEC-Version=1-143\.0\.3650\.75/);
  assert.match(new Headers(successfulEdgeCall.init.headers).get('cookie') || '', /^muid=[A-F0-9]{32};$/);

  process.stdout.write('worker Bing TTS tests passed\n');
} finally {
  globalThis.fetch = originalFetch;
}
