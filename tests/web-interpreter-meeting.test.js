const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const playbackEcho = require('../public/js/interpreter-echo');
const interpreterSource = fs.readFileSync(
  path.join(__dirname, '../public/js/interpreter.js'),
  'utf8',
);

function createClassList() {
  const values = new Set();
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    contains: (name) => values.has(name),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    toggle: (name, force) => {
      const enabled = force === undefined ? !values.has(name) : Boolean(force);
      if (enabled) values.add(name);
      else values.delete(name);
      return enabled;
    },
  };
}

function createBubble() {
  return {
    classList: createClassList(),
    isConnected: true,
    removed: false,
    querySelector: () => null,
    remove() {
      this.removed = true;
    },
  };
}

function createHarness() {
  let now = 1000;
  const scheduledTimers = [];
  const messagesView = { scrollHeight: 0, scrollTop: 0 };
  const storage = new Map();
  const sandbox = {
    AbortController,
    ArrayBuffer,
    Blob,
    DataView,
    Float32Array,
    Math,
    Number,
    Set,
    TextDecoder,
    Uint8Array,
    URL,
    cancelAnimationFrame: () => {},
    clearInterval: () => {},
    clearTimeout: () => {},
    console,
    document: {
      createDocumentFragment: () => ({ append: () => {} }),
      createElement: () => ({ classList: createClassList(), dataset: {} }),
      createTextNode: (value) => ({ textContent: value }),
      getElementById: (id) => (id === 'interpMessagesView' ? messagesView : null),
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      removeItem: (key) => storage.delete(key),
      setItem: (key, value) => storage.set(key, String(value)),
    },
    navigator: {},
    performance: { now: () => now },
    requestAnimationFrame: () => 1,
    setInterval: () => 1,
    setTimeout: (callback, delay) => {
      scheduledTimers.push({ callback, delay });
      return scheduledTimers.length;
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.InterpreterPlaybackEcho = playbackEcho;

  const exposeTestApi = `
    globalThis.__interpreterTestApi = {
      state: interpreterState,
      meeting: interpreterMeeting,
      playback: interpreterPlayback,
      applyTranscriptResult,
      beginInterpreterCaptureSuppression,
      buildRecognitionHistory,
      commitUtterance,
      captureLoopbackStream,
      createUtterance,
      endInterpreterCaptureSuppression,
      finishFallbackUtterance,
      handleMeetingMicrophoneFrame,
      handleMusicPCMProcess,
      handleVADSpeechStart,
      monitorFallbackSpeech,
      shouldSuppressInterpreterCapture,
      stopInterpreterTTS,
      translateInterpreterText,
      stubDownsample: (stub) => { downsampleMusicFrame = stub; },
      stubFetch: (stub) => { globalThis.fetch = stub; },
      stubFinalize: (stub) => { finalizeUtterance = stub; },
      stubInterimRecognition: (stub) => { queueInterimRecognition = stub; },
      stubMediaDevices: (stub) => { navigator.mediaDevices = stub; },
      stubTTS: (stub) => { playInterpreterTTS = stub; },
      stubTranslate: (stub) => { translateUtterance = stub; },
      setHistory: (items) => { interpreterHistory = items; },
      setTranslationEngine: (engine) => {
        if (engine) localStorage.setItem('translate_engine', engine);
        else localStorage.removeItem('translate_engine');
      },
    };
  `;
  vm.createContext(sandbox);
  vm.runInContext(`${interpreterSource}\n${exposeTestApi}`, sandbox, {
    filename: 'public/js/interpreter.js',
  });
  return {
    api: sandbox.__interpreterTestApi,
    advanceTime: (milliseconds) => { now += milliseconds; },
    scheduledTimers,
  };
}

function translatedUtterance(overrides = {}) {
  return {
    autoplay: true,
    bubble: createBubble(),
    committed: false,
    contentMode: 'conversation',
    isMine: false,
    original: 'Good morning',
    pendingTranslationText: '',
    sessionId: 1,
    sessionSource: 'meeting',
    source: 'system',
    transcriptRef: { text: 'Good morning' },
    translated: '早上好',
    translationTimer: null,
    ...overrides,
  };
}

test('meeting mode speaks only the local microphone lane when autoplay is enabled', () => {
  const { api } = createHarness();
  const spoken = [];
  api.stubTTS((text, language, options) => {
    spoken.push({ text, language, options });
    return Promise.resolve();
  });
  Object.assign(api.state, {
    autoplay: true,
    captureRequestId: 1,
    listening: true,
    source: 'meeting',
  });

  const remote = translatedUtterance();
  api.commitUtterance(remote, 'en', 'zh-CN');
  assert.equal(spoken.length, 0, 'shared remote audio must never loop back through automatic TTS');

  const local = translatedUtterance({
    isMine: true,
    original: '请稍等一下',
    source: 'microphone',
    translated: 'Please wait a moment.',
  });
  api.commitUtterance(local, 'zh-CN', 'en');
  assert.equal(spoken.length, 1, 'the local microphone lane may speak its translation');
  assert.deepEqual(
    { text: spoken[0].text, language: spoken[0].language },
    { text: 'Please wait a moment.', language: 'en' },
  );

  api.state.autoplay = false;
  api.commitUtterance(translatedUtterance({
    isMine: true,
    source: 'microphone',
  }), 'zh-CN', 'en');
  assert.equal(spoken.length, 1, 'the autoplay switch must disable local microphone TTS');
});

test('a rejected or empty final result cannot revive an earlier interim transcript', async () => {
  const { api } = createHarness();
  const translations = [];
  api.stubTranslate(async (_utterance, text, isFinal) => {
    translations.push({ text, isFinal });
  });

  const filtered = translatedUtterance({
    original: 'Thank you for watching.',
    translated: '感谢观看。',
    translationController: { abort: () => {} },
  });
  await api.applyTranscriptResult(filtered, {
    accepted: false,
    text: '',
    whisper_filtered_reason: 'no-audio-signal',
  }, true);
  assert.equal(translations.length, 0);
  assert.equal(filtered.original, '');
  assert.equal(filtered.translated, '');
  assert.equal(filtered.bubble.removed, true);

  const empty = translatedUtterance({ original: 'stale interim', translated: '过期临时译文' });
  await api.applyTranscriptResult(empty, { text: '' }, true);
  assert.equal(translations.length, 0, 'an empty final must supersede, not translate, stale interim text');
  assert.equal(empty.bubble.removed, true);
});

test('live translation makes one worker request for auto and explicit providers', async () => {
  const { api } = createHarness();
  const requests = [];
  api.state.tone = 'Formal';
  api.stubFetch(async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      json: async () => ({ translation: 'translated once' }),
    };
  });

  api.setTranslationEngine('auto');
  const automatic = await api.translateInterpreterText(
    'Good morning', 'en', 'zh-CN', new AbortController().signal,
  );
  assert.equal(automatic.translatedText, 'translated once');
  assert.equal(requests.length, 1, 'auto must delegate provider racing to one worker request');
  assert.equal(requests[0].url, '/api/translate');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    text: 'Good morning',
    sl: 'en',
    tl: 'zh-CN',
    tone: 'Formal',
    isVoice: true,
  });

  api.setTranslationEngine('bing');
  await api.translateInterpreterText(
    '请稍等', 'zh-CN', 'en', new AbortController().signal,
  );
  assert.equal(requests.length, 2, 'an explicit provider must also make exactly one worker request');
  assert.equal(requests[1].url, '/api/translate');
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    text: '请稍等',
    sl: 'zh-CN',
    tl: 'en',
    tone: 'Formal',
    isVoice: true,
    provider: 'bing',
  });
});

test('meeting recognition history stays isolated to the fixed speaker language', () => {
  const { api } = createHarness();
  api.setHistory([
    { contentMode: 'conversation', original: '我方第一句', sl: 'zh-CN' },
    { contentMode: 'conversation', original: 'remote sentence one', sl: 'en' },
    { contentMode: 'conversation', original: '我方第二句', sl: 'zh-Hans' },
    { contentMode: 'music', original: 'unrelated lyric', sl: 'en' },
    { contentMode: 'conversation', original: 'remote sentence two', sl: 'en-US' },
  ]);

  assert.equal(
    api.buildRecognitionHistory('conversation', 'en', 'theirs', 'zh-CN'),
    'remote sentence one remote sentence two',
    'the remote lane must not receive local-language context',
  );
  assert.equal(
    api.buildRecognitionHistory('conversation', 'en', 'mine', 'zh-CN'),
    '我方第一句 我方第二句',
    'the local microphone lane must not receive remote-language context',
  );

  api.state.source = 'meeting';
  const remoteLane = api.createUtterance();
  const localLane = api.createUtterance([], false, {
    direction: 'mine',
    sessionSource: 'meeting',
    source: 'microphone',
  });
  assert.equal(remoteLane.direction, 'theirs');
  assert.equal(remoteLane.historyPrompt, 'remote sentence one remote sentence two');
  assert.equal(localLane.direction, 'mine');
  assert.equal(localLane.historyPrompt, '我方第一句 我方第二句');
});

test('TTS playback and its cooldown suppress both capture lanes', () => {
  const { api, advanceTime } = createHarness();
  let regularAbortCount = 0;
  let meetingAbortCount = 0;
  const regularBubble = createBubble();
  const meetingBubble = createBubble();
  api.state.activeUtterance = {
    bubble: regularBubble,
    committed: false,
    finalQueued: false,
    sttController: { abort: () => { regularAbortCount += 1; } },
    translationController: { abort: () => { regularAbortCount += 1; } },
  };
  api.meeting.activeUtterance = {
    bubble: meetingBubble,
    peakLevel: 0.02,
    voicedMs: 600,
    sttController: { abort: () => { meetingAbortCount += 1; } },
  };
  api.state.bingGroup = {
    recognizers: [{ finalText: 'stale final', history: ['stale'], hypothesis: 'stale interim' }],
  };
  api.state.bingAudioPrebuffer = [new ArrayBuffer(4)];

  api.beginInterpreterCaptureSuppression();
  assert.equal(api.shouldSuppressInterpreterCapture(), true);
  assert.equal(api.state.activeUtterance, null);
  assert.equal(api.meeting.activeUtterance, null);
  assert.equal(regularAbortCount, 2);
  assert.equal(meetingAbortCount, 1);
  assert.equal(regularBubble.removed, true);
  assert.equal(meetingBubble.removed, true);
  assert.equal(api.state.bingAudioPrebuffer.length, 0);
  assert.equal(api.state.bingGroup.recognizers[0].hypothesis, '');

  Object.assign(api.state, { listening: true, mode: 'music', source: 'meeting' });
  let inputTouched = false;
  const suppressedEvent = {
    get inputBuffer() {
      inputTouched = true;
      throw new Error('suppressed capture must not inspect audio');
    },
  };
  api.handleMusicPCMProcess(suppressedEvent);
  api.handleMeetingMicrophoneFrame(suppressedEvent);
  api.state.mode = 'recorder';
  api.monitorFallbackSpeech(0.2);
  api.handleVADSpeechStart();
  assert.equal(inputTouched, false);
  assert.equal(api.state.activeUtterance, null, 'remote conversation capture must not start during TTS');

  api.endInterpreterCaptureSuppression(false);
  assert.equal(api.state.playbackActive, false);
  assert.equal(api.shouldSuppressInterpreterCapture(), true, 'capture must remain muted during cooldown');
  advanceTime(701);
  assert.equal(api.shouldSuppressInterpreterCapture(), false);
});

test('adjacent or interrupted TTS cannot clear the playback cooldown early', () => {
  const { api, advanceTime } = createHarness();
  Object.assign(api.state, {
    captureMethod: 'microphone',
    playbackActive: true,
    playbackGuardUntil: Number.POSITIVE_INFINITY,
  });
  api.playback.finish = () => api.endInterpreterCaptureSuppression(false);

  api.stopInterpreterTTS({ keepQueue: true, increment: false });
  const guardUntil = api.state.playbackGuardUntil;
  assert.equal(api.state.playbackActive, false);
  assert.equal(guardUntil, 1700, 'interrupted playback must retain the normal echo cooldown');

  advanceTime(100);
  api.stopInterpreterTTS({ keepQueue: true, increment: false });
  assert.equal(
    api.state.playbackGuardUntil,
    guardUntil,
    'initializing the next queued TTS item must not reset the previous cooldown',
  );

  advanceTime(599);
  assert.equal(api.shouldSuppressInterpreterCapture(), true);
  advanceTime(2);
  assert.equal(api.shouldSuppressInterpreterCapture(), false);
});

test('meeting loopback cannot reuse the selected translated-audio cable', async () => {
  const { api } = createHarness();
  const selectedInputs = [];
  const devices = [
    {
      kind: 'audioinput',
      deviceId: 'tts-return',
      groupId: 'translated-cable',
      label: 'CABLE Output (VB-Audio Virtual Cable)',
    },
    {
      kind: 'audioinput',
      deviceId: 'remote-loopback',
      groupId: 'sound-card',
      label: 'Stereo Mix (Realtek Audio)',
    },
    {
      kind: 'audiooutput',
      deviceId: 'translated-output',
      groupId: 'translated-cable',
      label: 'CABLE Input (VB-Audio Virtual Cable)',
    },
  ];
  api.stubMediaDevices({
    enumerateDevices: async () => devices,
    getUserMedia: async ({ audio }) => {
      selectedInputs.push(audio.deviceId.exact);
      return { getAudioTracks: () => [{}], getTracks: () => [] };
    },
  });
  Object.assign(api.state, {
    outputDeviceId: 'translated-output',
    source: 'meeting',
  });

  const stream = await api.captureLoopbackStream();
  assert.ok(stream);
  assert.deepEqual(selectedInputs, ['remote-loopback']);
  assert.equal(api.state.loopbackConflict, false);

  selectedInputs.length = 0;
  api.stubMediaDevices({
    enumerateDevices: async () => devices.filter((device) => device.deviceId !== 'remote-loopback'),
    getUserMedia: async ({ audio }) => {
      selectedInputs.push(audio.deviceId.exact);
      return { getAudioTracks: () => [{}], getTracks: () => [] };
    },
  });
  const rejected = await api.captureLoopbackStream();
  assert.equal(rejected, null);
  assert.deepEqual(selectedInputs, []);
  assert.equal(api.state.loopbackConflict, true);
});

test('system music PCM silence is discarded instead of finalized for recognition', () => {
  const { api, advanceTime } = createHarness();
  let finalized = 0;
  let interimQueued = 0;
  api.stubDownsample(() => new Float32Array(16000 * 12));
  api.stubFinalize(() => { finalized += 1; });
  api.stubInterimRecognition(() => { interimQueued += 1; });
  Object.assign(api.state, {
    activeUtterance: null,
    bingActive: false,
    contentMode: 'music',
    listening: true,
    liveConnectedAt: 0,
    liveSocketFailed: false,
    liveSocketReady: false,
    mode: 'music',
    playbackActive: false,
    playbackGuardUntil: 0,
    source: 'system',
  });

  advanceTime(200);
  api.handleMusicPCMProcess({ inputBuffer: {} });
  assert.equal(interimQueued, 0, 'silence must not trigger rolling interim STT');
  assert.equal(finalized, 0, 'a full silent rolling window must not reach final STT');
  assert.equal(api.state.activeUtterance.voicedMs, 0);
  assert.equal(api.state.activeUtterance.peakLevel, 0);

  api.state.activeUtterance = null;
  api.stubDownsample(() => new Float32Array(16000 * 12).fill(0.01));
  api.handleMusicPCMProcess({ inputBuffer: {} });
  assert.equal(interimQueued, 1, 'a voiced rolling window must keep interim recognition active');
  assert.equal(finalized, 1, 'a voiced rolling window must still reach final STT');
});

test('timed system-audio fallback does not queue a silent chunk for recognition', () => {
  const { api } = createHarness();
  const bubble = createBubble();
  let stopped = 0;
  Object.assign(api.state, {
    activeUtterance: {
      bubble,
      peakLevel: 0,
      speechConfirmed: false,
      sttController: null,
      voicedMs: 0,
    },
    contentMode: 'music',
    fallbackPendingUtterance: null,
    fallbackRecorder: {
      state: 'recording',
      stop: () => { stopped += 1; },
    },
    inputSilent: true,
    mode: 'timed',
    source: 'system',
  });

  api.finishFallbackUtterance();
  assert.equal(stopped, 1, 'discarding the current MediaRecorder chunk should rotate the recorder once');
  assert.equal(api.state.fallbackPendingUtterance, null, 'silence must not become a pending STT job');
  assert.equal(bubble.removed, true);

  const voicedBubble = createBubble();
  const voicedUtterance = {
    bubble: voicedBubble,
    peakLevel: 0.02,
    speechConfirmed: true,
    sttController: null,
    voicedMs: 500,
  };
  api.state.activeUtterance = voicedUtterance;
  api.finishFallbackUtterance();
  assert.equal(stopped, 2);
  assert.equal(api.state.fallbackPendingUtterance, voicedUtterance,
    'the timed fallback must continue to submit chunks with speech evidence');
  assert.equal(voicedBubble.removed, false);
});
