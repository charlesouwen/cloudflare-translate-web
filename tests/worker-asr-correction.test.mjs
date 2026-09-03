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

async function recognize(rawText, correctedText, language, options = {}) {
  const calls = [];
  const env = {
    ASSETS: {},
    AI: {
      run: async (model) => {
        calls.push(model);
        if (model === '@cf/openai/whisper-large-v3-turbo') {
          return { text: rawText, detected_language: language, ...(options.whisper || {}) };
        }
        if (model === '@cf/meta/llama-3-8b-instruct') return { response: correctedText };
        throw new Error(`Unexpected model: ${model}`);
      },
    },
  };
  const headers = {
    'Content-Type': 'audio/wav',
    'X-My-Lang': 'zh-CN',
    'X-Their-Lang': 'en',
    'X-ASR-Correction': '1',
    'X-Transcript-Mode': 'final',
  };
  if (options.alternateTranscript) headers['X-Alternate-Transcript'] = encodeURIComponent(options.alternateTranscript);
  if (options.alternateLanguage) headers['X-Alternate-Language'] = options.alternateLanguage;
  const response = await worker.fetch(new Request('https://fanyi.92haohuo.cn/api/stt', {
    method: 'POST',
    headers,
    body: new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]),
  }), env);
  assert.equal(response.status, 200);
  return { payload: await response.json(), calls };
}

const divergent = await recognize('please deploy the code', '请把代码发布到生产环境', 'en');
assert.equal(divergent.payload.text, 'please deploy the code');
assert.equal(divergent.payload.corrected, false, 'a translated or hallucinated rewrite must be rejected');

const conservative = await recognize('我不属好了', '我部署好了', 'zh');
assert.equal(conservative.payload.text, '我部署好了');
assert.equal(conservative.payload.corrected, true, 'a local homophone correction should be retained');

const fixedCaption = '请不吝点赞、订阅、转发、打赏，支持明镜与点点栏目。';
const filteredCaption = await recognize(fixedCaption, '', 'zh', {
  whisper: {
    transcription_info: { language: 'zh', duration_after_vad: 0.8 },
    segments: [{ no_speech_prob: 0.12, avg_logprob: -0.35, compression_ratio: 1.2 }],
  },
});
assert.equal(filteredCaption.payload.text, '', 'the known fixed caption hallucination must be rejected');
assert.equal(filteredCaption.payload.whisper_filtered_reason, 'fixed-caption-hallucination');
assert(!filteredCaption.calls.includes('@cf/meta/llama-3-8b-instruct'),
  'a deterministic hallucination must not spend another AI inference');

const subtitleVolunteer = await recognize('\u5b57\u5e55\u5fd7\u613f\u8005 \u674e\u5b97\u76db', '', 'zh', {
  whisper: {
    transcription_info: { language: 'zh', duration_after_vad: 0.8 },
    segments: [{ no_speech_prob: 0.12, avg_logprob: -0.35, compression_ratio: 1.2 }],
  },
});
assert.equal(subtitleVolunteer.payload.text, '',
  'the subtitle-volunteer training-corpus hallucination must be rejected');
assert.equal(subtitleVolunteer.payload.whisper_filtered_reason, 'fixed-caption-hallucination');
assert(!subtitleVolunteer.calls.includes('@cf/meta/llama-3-8b-instruct'),
  'the subtitle-volunteer hallucination must not spend correction inference');

const novaRescue = await recognize(fixedCaption, '我正在测试实时翻译', 'zh', {
  alternateTranscript: '我正在测试实时翻译',
  alternateLanguage: 'zh-CN',
  whisper: {
    transcription_info: { language: 'zh', duration_after_vad: 0.1 },
    segments: [{ no_speech_prob: 0.88, avg_logprob: -1.5, compression_ratio: 3.2 }],
  },
});
assert.equal(novaRescue.payload.text, '我正在测试实时翻译',
  'a valid live Nova transcript must survive a hallucinated Whisper final pass');
assert.equal(novaRescue.payload.asr_source, 'nova');
assert.match(novaRescue.payload.language, /^zh(?:-|$)/);

const divergentNovaRescue = await recognize('今天下午可能会有雷阵雨', 'please turn the volume down', '', {
  alternateTranscript: 'please turn the volume down',
  alternateLanguage: 'en',
  whisper: {
    transcription_info: { language: 'zh', language_probability: 0.98, duration_after_vad: 2.4 },
    segments: [{ no_speech_prob: 0.02, avg_logprob: -0.12, compression_ratio: 1.1 }],
  },
});
assert.equal(divergentNovaRescue.payload.text, 'please turn the volume down',
  'a high-confidence but divergent Whisper result must not overwrite the live candidate');
assert.equal(divergentNovaRescue.payload.asr_source, 'nova');
assert.equal(divergentNovaRescue.payload.language, 'en',
  'the selected live candidate language must override the rejected Whisper language');
assert.equal(divergentNovaRescue.payload.whisper_filtered_reason, 'whisper-nova-divergence');

const transcriptionInfoLanguage = await recognize('please close the door', 'please close the door', '', {
  whisper: {
    transcription_info: { language: 'en', language_probability: 0.99, duration_after_vad: 1.8 },
    segments: [{ no_speech_prob: 0.01, avg_logprob: -0.08, compression_ratio: 1.05 }],
  },
});
assert.equal(transcriptionInfoLanguage.payload.language, 'en',
  'Whisper transcription_info.language must drive the direction when legacy fields are absent');

const legitimateCreatorSentence = await recognize('请点赞支持这个栏目，我们稍后继续讨论', '请点赞支持这个栏目，我们稍后继续讨论', 'zh', {
  whisper: {
    transcription_info: { language: 'zh', duration_after_vad: 2.2 },
    segments: [{ no_speech_prob: 0.03, avg_logprob: -0.18, compression_ratio: 1.15 }],
  },
});
assert.equal(legitimateCreatorSentence.payload.text, '请点赞支持这个栏目，我们稍后继续讨论',
  'creator-related words with strong speech evidence must not be treated as a generic hallucination');
assert.equal(legitimateCreatorSentence.payload.whisper_filtered_reason, null);

const noSpeechSentinel = await recognize('呃呃呃呃', '[NO_SPEECH]', 'zh');
assert.equal(noSpeechSentinel.payload.text, '', 'an explicit correction sentinel must suppress acoustic gibberish');
assert.equal(noSpeechSentinel.payload.whisper_filtered_reason, 'post-correction-no-speech');

process.stdout.write('worker ASR correction tests passed\n');
