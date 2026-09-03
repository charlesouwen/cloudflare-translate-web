/**
 * 同声传译 v7
 *
 * MediaRecorder 在音轨就绪后立即采集；Silero VAD 在后台增强句段边界。
 * VAD 或 Web Audio 不可用时分别回退到自适应音量分段和定时分段。
 */

const INTERP_SAMPLE_RATE = 16000;
const INTERP_INTERIM_INTERVAL_MS = 1250;
const INTERP_INTERIM_MIN_SAMPLES = Math.round(INTERP_SAMPLE_RATE * 0.8);
const INTERP_INTERIM_NEW_SAMPLES = Math.round(INTERP_SAMPLE_RATE * 0.55);
const INTERP_MAX_UTTERANCE_SAMPLES = INTERP_SAMPLE_RATE * 12;
const INTERP_STT_TIMEOUT_MS = 22000;
const INTERP_TRANSLATE_TIMEOUT_MS = 14000;
const INTERP_MAX_FINAL_WORKERS = 2;
const INTERP_MAX_FINAL_QUEUE = 8;
const INTERP_MIN_VOICED_MS = 320;
const INTERP_MUSIC_WINDOW_SAMPLES = INTERP_SAMPLE_RATE * 12;
const INTERP_MUSIC_OVERLAP_SAMPLES = Math.round(INTERP_SAMPLE_RATE * 2.5);
const INTERP_MUSIC_INTERIM_MIN_SAMPLES = Math.round(INTERP_SAMPLE_RATE * 1.2);
const INTERP_MUSIC_INTERIM_NEW_SAMPLES = Math.round(INTERP_SAMPLE_RATE * 0.9);
const INTERP_MUSIC_INTERIM_INTERVAL_MS = 1100;
const INTERP_LIVE_STALL_MS = 3000;
const INTERP_LIVE_AUDIO_QUEUE_FRAMES = 12;
const INTERP_LIVE_MAX_BUFFERED_BYTES = 256 * 1024;
const INTERP_TTS_RATE = 0.8;
const INTERP_LOOPBACK_DEVICE_RE = /(?:stereo mix|what u hear|wave out mix|loopback|monitor of|立体声混音|立體聲混音|blackhole|soundflower|cable output|vb-audio|voicemeeter (?:output|aux output))/i;

const INTERP_WHISPER_LANG_MAP = {
  chinese: 'zh', mandarin: 'zh', english: 'en', japanese: 'ja', korean: 'ko',
  french: 'fr', german: 'de', spanish: 'es', russian: 'ru', portuguese: 'pt',
  italian: 'it', arabic: 'ar', hindi: 'hi', thai: 'th', vietnamese: 'vi',
  dutch: 'nl', turkish: 'tr', polish: 'pl',
};
const INTERP_LATIN_LANGUAGES = new Set(['en', 'fr', 'de', 'es', 'pt', 'it', 'nl', 'tr', 'pl']);

let interpreterHistory = [];
let interpreterInitialized = false;

const interpreterState = {
  stream: null,
  displayStream: null,
  audioContext: null,
  meterSource: null,
  analyser: null,
  pcmProcessor: null,
  pcmMuteGain: null,
  liveSocket: null,
  liveSocketReady: false,
  liveSocketFailed: false,
  liveAudioQueue: [],
  liveConnectedAt: 0,
  liveLastTranscriptAt: 0,
  vad: null,
  vadReady: false,
  vadSpeaking: false,
  fallbackRecorder: null,
  fallbackChunks: [],
  fallbackMimeType: '',
  fallbackRecorderStartedAt: 0,
  fallbackPendingUtterance: null,
  fallbackSilenceSince: 0,
  fallbackNoiseFloor: 0.008,
  fallbackCalibrationUntil: 0,
  mode: 'recorder',
  source: 'microphone',
  captureMethod: 'microphone',
  contentMode: 'conversation',
  direction: 'auto',
  correction: false,
  autoplay: true,
  tone: 'Standard',
  voiceName: '',
  voices: [],
  asrEngine: 'fusion',
  bingConfig: null,
  bingGroup: null,
  bingAudioPrebuffer: [],
  bingRestartTimer: null,
  bingPCMProcessor: null,
  bingMuteGain: null,
  bingActive: false,
  listening: false,
  starting: false,
  activeUtterance: null,
  preRollFrames: [],
  speechHadForcedCut: false,
  sequence: 0,
  finalQueue: [],
  finalWorkers: 0,
  activeRequests: 0,
  animationFrameId: null,
  lastLevel: 0,
  streamStartedAt: 0,
  peakLevel: 0,
  inputSilent: false,
  lastSignalAt: 0,
  captureRequestId: 0,
  timedChunkTimer: null,
};

const interpreterPlayback = {
  audio: null,
  player: null,
  primed: false,
  url: '',
  animationFrameId: 0,
  highlight: null,
  runId: 0,
  echoReferences: [],
  activeEchoReference: null,
};

function initInterpreter() {
  if (interpreterInitialized) return;
  interpreterInitialized = true;

  const myLang = document.getElementById('interpMyLang');
  const theirLang = document.getElementById('interpTheirLang');
  const savedMyLang = localStorage.getItem('interp_my_lang');
  const savedTheirLang = localStorage.getItem('interp_their_lang');
  if (savedMyLang && myLang) myLang.value = savedMyLang;
  if (savedTheirLang && theirLang) theirLang.value = savedTheirLang;

  interpreterState.source = localStorage.getItem('interp_audio_source') || migrateLegacySource();
  const savedContentMode = localStorage.getItem('interp_content_mode');
  const contentModeVersion = localStorage.getItem('interp_content_mode_version');
  interpreterState.contentMode = contentModeVersion === '2' && ['conversation', 'music'].includes(savedContentMode)
    ? savedContentMode
    : 'conversation';
  localStorage.setItem('interp_content_mode', interpreterState.contentMode);
  localStorage.setItem('interp_content_mode_version', '2');
  const savedDirection = localStorage.getItem('interp_speaker_direction');
  const directionModeVersion = localStorage.getItem('interp_direction_mode_version');
  interpreterState.direction = directionModeVersion === '2' && ['auto', 'mine', 'theirs'].includes(savedDirection)
    ? savedDirection
    : 'auto';
  localStorage.setItem('interp_speaker_direction', interpreterState.direction);
  localStorage.setItem('interp_direction_mode_version', '2');
  interpreterState.correction = localStorage.getItem('interp_ai_correction') === 'true';
  const savedTone = localStorage.getItem('interp_tone');
  interpreterState.tone = ['Standard', 'Casual', 'Formal'].includes(savedTone) ? savedTone : 'Standard';
  interpreterState.voiceName = localStorage.getItem('interp_voice_name') || '';
  const savedAsr = localStorage.getItem('interp_asr_engine');
  interpreterState.asrEngine = ['fusion', 'whisper', 'bing'].includes(savedAsr) ? savedAsr : 'fusion';
  const savedAutoplay = localStorage.getItem('interp_autoplay_enabled');
  if (savedAutoplay !== null) {
    interpreterState.autoplay = savedAutoplay === 'true';
  } else {
    interpreterState.autoplay = localStorage.getItem('interp_autoplay_my') !== 'false' ||
      localStorage.getItem('interp_autoplay_their') !== 'false';
  }

  myLang?.addEventListener('change', () => {
    saveLanguagePair('mine');
    void loadInterpreterVoices();
  });
  theirLang?.addEventListener('change', () => {
    saveLanguagePair('theirs');
    void loadInterpreterVoices();
  });

  document.getElementById('interpSwapLang')?.addEventListener('click', () => {
    if (!myLang || !theirLang) return;
    const previous = myLang.value;
    myLang.value = theirLang.value;
    theirLang.value = previous;
    persistLanguagePair();
    void loadInterpreterVoices();
  });

  document.querySelectorAll('[data-interp-source]').forEach((button) => {
    button.addEventListener('click', () => {
      if (interpreterState.listening || interpreterState.starting) {
        notifyInterpreter('请先停止实时翻译，再切换音频来源');
        return;
      }
      interpreterState.source = button.dataset.interpSource;
      localStorage.setItem('interp_audio_source', interpreterState.source);
      updateInterpreterControls();
    });
  });

  document.querySelectorAll('[data-interp-content]').forEach((button) => {
    button.addEventListener('click', () => {
      if (interpreterState.listening || interpreterState.starting) {
        notifyInterpreter('请先停止实时翻译，再切换内容模式');
        return;
      }
      interpreterState.contentMode = button.dataset.interpContent;
      localStorage.setItem('interp_content_mode', interpreterState.contentMode);
      updateInterpreterControls();
    });
  });

  document.querySelectorAll('[data-interp-direction]').forEach((button) => {
    button.addEventListener('click', () => {
      interpreterState.direction = button.dataset.interpDirection;
      localStorage.setItem('interp_speaker_direction', interpreterState.direction);
      updateInterpreterControls();
    });
  });
  const correctionToggle = document.getElementById('interpCorrectionToggle');
  if (correctionToggle) {
    correctionToggle.checked = interpreterState.correction;
    correctionToggle.addEventListener('change', () => {
      interpreterState.correction = correctionToggle.checked;
      localStorage.setItem('interp_ai_correction', String(interpreterState.correction));
    });
  }

  const autoplayToggle = document.getElementById('interpAutoplayToggle');
  if (autoplayToggle) {
    autoplayToggle.checked = interpreterState.autoplay;
    autoplayToggle.addEventListener('change', () => {
      interpreterState.autoplay = autoplayToggle.checked;
      localStorage.setItem('interp_autoplay_enabled', String(interpreterState.autoplay));
      if (interpreterState.autoplay) void primeInterpreterPlayback();
      else stopInterpreterTTS();
    });
  }

  document.querySelectorAll('[data-interp-tone]').forEach((button) => {
    button.addEventListener('click', () => {
      interpreterState.tone = button.dataset.interpTone || 'Standard';
      localStorage.setItem('interp_tone', interpreterState.tone);
      updateInterpreterControls();
    });
  });

  document.querySelectorAll('[data-interp-asr]').forEach((button) => {
    button.addEventListener('click', () => {
      if (interpreterState.listening || interpreterState.starting) {
        notifyInterpreter('Stop live interpretation before changing the ASR engine');
        return;
      }
      interpreterState.asrEngine = button.dataset.interpAsr || 'fusion';
      localStorage.setItem('interp_asr_engine', interpreterState.asrEngine);
      updateInterpreterControls();
    });
  });

  const voiceSelect = document.getElementById('interpVoiceSelect');
  voiceSelect?.addEventListener('change', () => {
    interpreterState.voiceName = voiceSelect.value || '';
    localStorage.setItem('interp_voice_name', interpreterState.voiceName);
  });

  document.getElementById('interpMicGlobal')?.addEventListener('click', async () => {
    if (interpreterState.autoplay) void primeInterpreterPlayback();
    if (interpreterState.listening || interpreterState.starting) {
      await window.stopInterpreter();
    } else {
      await startInterpreter();
    }
  });

  document.getElementById('interpMessagesView')?.addEventListener('click', (event) => {
    const playButton = event.target.closest('.interp-play-btn');
    if (!playButton) return;
    const text = playButton.dataset.text;
    const lang = playButton.dataset.lang;
    if (text && lang) {
      void primeInterpreterPlayback();
      void playInterpreterTTS(text, lang, {
        interrupt: true,
        bubble: playButton.closest('.interp-msg-bubble'),
      }).catch(() => notifyInterpreter('Interpreter TTS unavailable'));
    }
  });

  updateInterpreterControls();
  updateInterpreterStatus();
  void loadInterpreterVoices();
}

function migrateLegacySource() {
  return localStorage.getItem('interp_system_audio_my_enabled') === 'true' ||
    localStorage.getItem('interp_system_audio_their_enabled') === 'true'
    ? 'system'
    : 'microphone';
}

function saveLanguagePair(changedSide) {
  const myLang = document.getElementById('interpMyLang');
  const theirLang = document.getElementById('interpTheirLang');
  if (!myLang || !theirLang) return;

  if (myLang.value === theirLang.value) {
    const fallback = Array.from((changedSide === 'mine' ? theirLang : myLang).options)
      .find((option) => option.value !== (changedSide === 'mine' ? myLang.value : theirLang.value));
    if (fallback) {
      if (changedSide === 'mine') theirLang.value = fallback.value;
      else myLang.value = fallback.value;
      notifyInterpreter('两侧语言已自动保持不同');
    }
  }
  persistLanguagePair();
}

function persistLanguagePair() {
  localStorage.setItem('interp_my_lang', getMyLang());
  localStorage.setItem('interp_their_lang', getTheirLang());
}

function updateInterpreterControls() {
  document.querySelectorAll('[data-interp-source]').forEach((button) => {
    const active = button.dataset.interpSource === interpreterState.source;
    button.setAttribute('aria-pressed', String(active));
    button.disabled = interpreterState.listening || interpreterState.starting;
  });
  document.querySelectorAll('[data-interp-direction]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.interpDirection === interpreterState.direction));
  });
  document.querySelectorAll('[data-interp-content]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.interpContent === interpreterState.contentMode));
    button.disabled = interpreterState.listening || interpreterState.starting;
  });

  const autoplayToggle = document.getElementById('interpAutoplayToggle');
  if (autoplayToggle) {
    autoplayToggle.checked = interpreterState.autoplay;
    autoplayToggle.disabled = false;
    autoplayToggle.closest('.interp-check-control')?.classList.remove('is-disabled');
  }

  const correctionToggle = document.getElementById('interpCorrectionToggle');
  if (correctionToggle) correctionToggle.checked = interpreterState.correction;

  document.querySelectorAll('[data-interp-tone]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.interpTone === interpreterState.tone));
  });
  document.querySelectorAll('[data-interp-asr]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.interpAsr === interpreterState.asrEngine));
    button.disabled = interpreterState.listening || interpreterState.starting;
  });
  const voiceSelect = document.getElementById('interpVoiceSelect');
  if (voiceSelect && voiceSelect.value !== interpreterState.voiceName &&
      Array.from(voiceSelect.options).some((option) => option.value === interpreterState.voiceName)) {
    voiceSelect.value = interpreterState.voiceName;
  }
}

async function loadInterpreterVoices() {
  const voiceSelect = document.getElementById('interpVoiceSelect');
  if (!voiceSelect) return;
  const targetLang = getTheirLang();
  voiceSelect.disabled = true;
  voiceSelect.replaceChildren(new Option('Bing Neural', ''));
  try {
    const response = await fetch(`/api/voices?lang=${encodeURIComponent(targetLang)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`voice list failed (${response.status})`);
    const data = await response.json();
    interpreterState.voices = Array.isArray(data.voices) ? data.voices : [];
    for (const voice of interpreterState.voices) {
      const option = new Option(voice.label || voice.voiceName, voice.voiceName || '');
      option.dataset.locale = voice.locale || '';
      voiceSelect.add(option);
    }
    if (interpreterState.voiceName && interpreterState.voices.some((voice) => voice.voiceName === interpreterState.voiceName)) {
      voiceSelect.value = interpreterState.voiceName;
    } else {
      interpreterState.voiceName = '';
      localStorage.removeItem('interp_voice_name');
    }
  } catch (error) {
    console.warn('[interpreter] voice list unavailable:', error);
  } finally {
    voiceSelect.disabled = false;
  }
}

async function startInterpreter() {
  if (interpreterState.listening || interpreterState.starting) return;
  if (!navigator.mediaDevices) {
    setInterpreterError('当前浏览器不支持音频采集');
    return;
  }

  const captureRequestId = ++interpreterState.captureRequestId;
  interpreterState.starting = true;
  interpreterState.inputSilent = false;
  interpreterState.peakLevel = 0;
  let startErrorMessage = '';
  updateInterpreterControls();
  updateInterpreterStatus('正在连接音频…');

  try {
    const stream = await captureInterpreterStream(interpreterState.source);
    if (captureRequestId !== interpreterState.captureRequestId || !interpreterState.starting) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    validateAudioStream(stream);
    interpreterState.stream = stream;
    interpreterState.listening = true;
    interpreterState.mode = 'recorder';
    interpreterState.streamStartedAt = performance.now();
    interpreterState.lastSignalAt = interpreterState.streamStartedAt;
    interpreterState.fallbackNoiseFloor = 0.0025;
    interpreterState.fallbackCalibrationUntil = interpreterState.captureMethod !== 'display'
      ? interpreterState.streamStartedAt + 450
      : interpreterState.streamStartedAt;
    startFallbackRecorder();
    document.getElementById('interpHint')?.classList.add('is-hidden');

    try {
      await setupAudioMeter(interpreterState.stream);
      monitorInterpreterLevel();
      if (interpreterState.asrEngine !== 'whisper') {
        try {
          await startBingRecognition();
          if (interpreterState.contentMode !== 'music') startBingPCMProcessor();
        } catch (bingError) {
          interpreterState.bingActive = false;
          if (interpreterState.asrEngine === 'bing') throw bingError;
          console.warn('[interpreter] Bing recognition unavailable; keeping Whisper final recognition:', bingError);
          notifyInterpreter('Bing recognition unavailable; Whisper fallback is active');
        }
      }
      if (interpreterState.contentMode === 'music') {
        startLiveRecognition();
        if (startMusicPCMProcessor()) {
          interpreterState.mode = 'music';
          interpreterState.activeUtterance = createUtterance([], false);
          if (interpreterState.fallbackRecorder?.state === 'recording') {
            interpreterState.fallbackRecorder.stop();
          }
        } else {
          interpreterState.mode = 'timed';
          startTimedRecorderFallback();
        }
        updateInterpreterStatus();
      } else {
        void startSileroVAD().then((ready) => {
          if (!ready || !interpreterState.listening) return;
          interpreterState.vadReady = true;
          interpreterState.mode = 'hybrid';
          updateInterpreterStatus();
        }).catch((vadError) => {
          interpreterState.vadReady = false;
          interpreterState.mode = 'recorder';
          console.warn('[同传] Silero VAD 不可用，继续使用音量分段:', vadError);
          updateInterpreterStatus();
        });
      }
    } catch (meterError) {
      console.warn('[同传] Web Audio 不可用，已停止自动分段以避免静音误识别:', meterError);
      throw new Error('AudioAnalysisUnavailable');
    }
  } catch (error) {
    console.error('[同传] 音频采集失败:', error);
    await cleanupInterpreterCapture();
    interpreterState.listening = false;
    startErrorMessage = describeCaptureError(error);
  } finally {
    interpreterState.starting = false;
    updateInterpreterControls();
    updateInterpreterStatus();
    if (startErrorMessage) setInterpreterError(startErrorMessage);
  }
}

async function captureInterpreterStream(source) {
  if (source === 'system') {
    if (typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
      throw new Error('NoDisplayCapture');
    }
    let displayStream;
    try {
      displayStream = await requestMediaStream(() => navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'browser' },
        audio: { suppressLocalAudioPlayback: false },
        preferCurrentTab: false,
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include',
        systemAudio: 'include',
        windowAudio: 'system',
      }), 60000);
    } catch (error) {
      if (!['TypeError', 'OverconstrainedError'].includes(error.name)) throw error;
      console.warn('[同传] 增强共享参数不受支持，使用标准标签页音频参数重试:', error);
      displayStream = await requestMediaStream(() => navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      }), 60000);
    }
    const audioTrack = displayStream.getAudioTracks()[0];
    if (!audioTrack) {
      const displaySurface = displayStream.getVideoTracks()[0]?.getSettings?.().displaySurface || '';
      displayStream.getTracks().forEach((track) => track.stop());
      updateInterpreterStatus('正在尝试扬声器回采…');
      const loopbackStream = await captureLoopbackStream();
      if (loopbackStream) {
        interpreterState.captureMethod = 'loopback';
        loopbackStream.getAudioTracks()[0]?.addEventListener('ended', () => void window.stopInterpreter(), { once: true });
        return loopbackStream;
      }
      const error = new Error('NoSystemAudio');
      error.displaySurface = displaySurface;
      error.loopbackChecked = true;
      throw error;
    }
    audioTrack.enabled = true;
    try {
    audioTrack.contentHint = interpreterState.contentMode === 'music' ? 'music' : 'speech';
    } catch {}
    interpreterState.captureMethod = 'display';
    interpreterState.displayStream = displayStream;
    displayStream.getTracks().forEach((track) => {
      track.addEventListener('ended', () => void window.stopInterpreter(), { once: true });
    });
    return new MediaStream([audioTrack]);
  }

  let stream;
  const captureMusic = interpreterState.contentMode === 'music';
  try {
    stream = await requestMediaStream(() => navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: { ideal: !captureMusic },
        noiseSuppression: { ideal: !captureMusic },
        autoGainControl: { ideal: !captureMusic },
        channelCount: { ideal: captureMusic ? 2 : 1 },
        sampleRate: { ideal: captureMusic ? 48000 : INTERP_SAMPLE_RATE },
      },
    }), 15000);
  } catch (error) {
    if (!['OverconstrainedError', 'NotReadableError', 'AbortError'].includes(error.name)) throw error;
    console.warn('[同传] 高级麦克风约束失败，使用浏览器默认音频配置重试:', error);
    stream = await requestMediaStream(() => navigator.mediaDevices.getUserMedia({ audio: true }), 15000);
  }
  stream.getAudioTracks()[0]?.addEventListener('ended', () => void window.stopInterpreter(), { once: true });
  interpreterState.captureMethod = 'microphone';
  return stream;
}

async function captureLoopbackStream() {
  if (typeof navigator.mediaDevices.enumerateDevices !== 'function' ||
      typeof navigator.mediaDevices.getUserMedia !== 'function') return null;

  let devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  if (!devices.some((device) => device.kind === 'audioinput' && device.label)) {
    try {
      const permissionStream = await requestMediaStream(
        () => navigator.mediaDevices.getUserMedia({ audio: true }),
        15000,
      );
      permissionStream.getTracks().forEach((track) => track.stop());
      devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    } catch (error) {
      console.warn('[同传] 无法检查扬声器回采设备:', error);
      return null;
    }
  }

  const loopbackDevice = devices.find((device) =>
    device.kind === 'audioinput' && INTERP_LOOPBACK_DEVICE_RE.test(device.label || ''),
  );
  if (!loopbackDevice) return null;

  try {
    const stream = await requestMediaStream(() => navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: loopbackDevice.deviceId },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 2 },
        sampleRate: { ideal: 48000 },
      },
    }), 15000);
    console.info('[同传] 已切换扬声器回采设备:', loopbackDevice.label);
    return stream;
  } catch (error) {
    console.warn('[同传] 扬声器回采设备启动失败:', error);
    return null;
  }
}

function requestMediaStream(factory, timeoutMs) {
  let expired = false;
  let timeoutId;
  const mediaPromise = Promise.resolve().then(factory);
  mediaPromise.then((stream) => {
    if (expired) stream.getTracks().forEach((track) => track.stop());
  }).catch(() => {});

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      expired = true;
      const error = new Error('AudioCaptureTimeout');
      error.name = 'TimeoutError';
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([mediaPromise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

function validateAudioStream(stream) {
  const track = stream?.getAudioTracks?.()[0];
  if (!track) throw new Error('NoAudioTrack');
  if (track.readyState !== 'live') throw new Error('AudioTrackEnded');
  console.info('[同传] 音频轨已连接:', {
    label: track.label || 'default',
    readyState: track.readyState,
    muted: track.muted,
    settings: track.getSettings?.() || {},
  });
}

async function setupAudioMeter(stream) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('NoAudioContext');
  try {
    interpreterState.audioContext = new AudioContextClass({
      sampleRate: INTERP_SAMPLE_RATE,
      latencyHint: 'interactive',
    });
  } catch {
    interpreterState.audioContext = new AudioContextClass();
  }
  interpreterState.analyser = interpreterState.audioContext.createAnalyser();
  interpreterState.analyser.fftSize = 1024;
  interpreterState.analyser.smoothingTimeConstant = 0.15;
  interpreterState.meterSource = interpreterState.audioContext.createMediaStreamSource(stream);
  interpreterState.meterSource.connect(interpreterState.analyser);
  if (interpreterState.audioContext.state === 'suspended') {
    let timeoutId;
    try {
      await Promise.race([
        interpreterState.audioContext.resume(),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('AudioContextTimeout')), 2500);
        }),
      ]);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

function startMusicPCMProcessor() {
  const context = interpreterState.audioContext;
  if (!context || typeof context.createScriptProcessor !== 'function' || !interpreterState.meterSource) return false;

  try {
    const processor = context.createScriptProcessor(2048, 2, 1);
    const muteGain = context.createGain();
    muteGain.gain.value = 0;
    interpreterState.meterSource.connect(processor);
    processor.connect(muteGain);
    muteGain.connect(context.destination);
    processor.onaudioprocess = handleMusicPCMProcess;

    interpreterState.pcmProcessor = processor;
    interpreterState.pcmMuteGain = muteGain;
    return true;
  } catch (error) {
    console.warn('[同传] 音频 PCM 采集初始化失败:', error);
    return false;
  }
}

function handleMusicPCMProcess(event) {
  if (!interpreterState.listening || interpreterState.mode !== 'music') return;
  const frame = downsampleMusicFrame(event.inputBuffer, INTERP_SAMPLE_RATE);
  if (!frame.length) return;
  sendLiveAudioFrame(frame);
  if (interpreterState.bingActive) sendBingAudioFrameToGroup(encodePCM16Frame(frame));

  if (!interpreterState.activeUtterance) {
    interpreterState.activeUtterance = createUtterance([], false);
  }
  const utterance = interpreterState.activeUtterance;
  utterance.frames.push(frame);
  utterance.sampleCount += frame.length;
  const frameLevel = frameRms(frame);
  utterance.peakLevel = Math.max(utterance.peakLevel, frameLevel);
  if (frameLevel >= 0.0035) utterance.voicedMs += frame.length / INTERP_SAMPLE_RATE * 1000;

  const newSamples = utterance.sampleCount - utterance.overlapSamples;
  const now = performance.now();
  const latestLiveActivity = interpreterState.liveLastTranscriptAt || interpreterState.liveConnectedAt;
  const liveResponsive = interpreterState.liveSocketReady && !interpreterState.liveSocketFailed &&
    now - latestLiveActivity < INTERP_LIVE_STALL_MS;
  if (!liveResponsive && newSamples >= INTERP_MUSIC_INTERIM_MIN_SAMPLES &&
      now - utterance.lastInterimAt >= INTERP_MUSIC_INTERIM_INTERVAL_MS) {
    queueInterimRecognition(utterance);
  }

  if (utterance.sampleCount >= INTERP_MUSIC_WINDOW_SAMPLES) {
    const completeAudio = concatAudioFrames(utterance.frames);
    const overlap = completeAudio.slice(-INTERP_MUSIC_OVERLAP_SAMPLES);
    interpreterState.activeUtterance = null;
    if (utterance.voicedMs >= INTERP_MIN_VOICED_MS && utterance.peakLevel >= 0.0035) {
      finalizeUtterance(utterance, completeAudio);
    } else {
      utterance.bubble?.remove();
    }

    const nextUtterance = createUtterance([overlap], false);
    nextUtterance.overlapSamples = overlap.length;
    nextUtterance.previousOriginal = utterance.original;
    nextUtterance.previousTranscriptRef = utterance.transcriptRef;
    interpreterState.activeUtterance = nextUtterance;
  }
}

function frameRms(samples) {
  if (!samples?.length) return 0;
  let energy = 0;
  for (let index = 0; index < samples.length; index += 1) energy += samples[index] * samples[index];
  return Math.sqrt(energy / samples.length);
}

function downsampleMusicFrame(audioBuffer, targetRate) {
  const channelCount = Math.max(1, audioBuffer.numberOfChannels || 1);
  const inputLength = audioBuffer.length;
  const mono = new Float32Array(inputLength);
  for (let channel = 0; channel < channelCount; channel += 1) {
    const samples = audioBuffer.getChannelData(channel);
    for (let index = 0; index < inputLength; index += 1) {
      mono[index] += samples[index] / channelCount;
    }
  }

  const sourceRate = audioBuffer.sampleRate || interpreterState.audioContext?.sampleRate || targetRate;
  if (sourceRate === targetRate) return mono;
  const ratio = sourceRate / targetRate;
  const outputLength = Math.max(1, Math.floor(inputLength / ratio));
  const output = new Float32Array(outputLength);
  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const start = Math.floor(outputIndex * ratio);
    const end = Math.min(inputLength, Math.max(start + 1, Math.floor((outputIndex + 1) * ratio)));
    let sum = 0;
    for (let inputIndex = start; inputIndex < end; inputIndex += 1) sum += mono[inputIndex];
    output[outputIndex] = sum / (end - start);
  }
  return output;
}

const INTERP_BING_SPEECH_LOCALES = {
  'zh-CN': 'zh-CN', 'zh-Hans': 'zh-CN', 'zh-TW': 'zh-TW', 'zh-Hant': 'zh-TW',
  en: 'en-US', ja: 'ja-JP', ko: 'ko-KR', fr: 'fr-FR', de: 'de-DE',
  es: 'es-ES', ru: 'ru-RU', pt: 'pt-BR', it: 'it-IT', ar: 'ar-EG',
  hi: 'hi-IN', th: 'th-TH', vi: 'vi-VN', nl: 'nl-NL', tr: 'tr-TR',
};

function bingSpeechLocale(code) {
  const value = String(code || '').trim();
  return INTERP_BING_SPEECH_LOCALES[value] || INTERP_BING_SPEECH_LOCALES[languageBase(value)] || '';
}

function getBingRecognitionSides() {
  const mine = { speaker: 'mine', code: getMyLang(), locale: bingSpeechLocale(getMyLang()) };
  const theirs = { speaker: 'theirs', code: getTheirLang(), locale: bingSpeechLocale(getTheirLang()) };
  if (interpreterState.contentMode === 'music' || interpreterState.direction === 'theirs') {
    return theirs.locale ? [theirs] : [];
  }
  if (interpreterState.direction === 'mine') return mine.locale ? [mine] : [];
  return [mine, theirs].filter((side) => side.locale);
}

async function startBingRecognition() {
  closeBingRecognition();
  const response = await fetch('/api/speech-config', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Bing speech config failed (${response.status})`);
  const config = await response.json();
  if (!config.available || !config.endpoint) throw new Error('Bing speech recognition is unavailable');
  const sides = getBingRecognitionSides();
  if (!sides.length) throw new Error('No supported Bing speech language for this pair');

  interpreterState.bingConfig = config;
  interpreterState.bingActive = true;
  const group = {
    recognizers: [],
    format: sides.length > 1 ? 'detailed' : (config.protocol?.format || 'simple'),
    opened: false,
    closed: false,
  };
  interpreterState.bingGroup = group;
  sides.forEach((side) => group.recognizers.push(createBingRecognizer(group, side)));
}

function createBingRecognizer(group, side) {
  const requestId = compactInterpreterUuid();
  const connectionId = compactInterpreterUuid();
  const config = interpreterState.bingConfig || {};
  const url = new URL(config.endpoint);
  url.searchParams.set('clientbuild', config.clientBuild || 'TranslateThisDesktop');
  url.searchParams.set('referer', config.referer || 'https://cn.bing.com/translator/');
  url.searchParams.set('form', config.form || 'QBRE');
  url.searchParams.set('uqurequestid', config.uquRequestId || compactInterpreterUuid());
  url.searchParams.set('language', side.locale);
  url.searchParams.set('format', group.format);
  url.searchParams.set(config.authQueryName || 'Ocp-Apim-Subscription-Key', config.subscriptionKey || 'key');
  url.searchParams.set('X-ConnectionId', connectionId);

  const socket = new WebSocket(url.toString());
  socket.binaryType = 'arraybuffer';
  const recognizer = {
    ws: socket,
    group,
    speaker: side.speaker,
    code: side.code,
    locale: side.locale,
    requestId,
    connectionId,
    opened: false,
    finalReceived: false,
    hypothesis: '',
    history: [],
    finalText: '',
  };

  socket.addEventListener('open', () => {
    if (!interpreterState.bingActive || interpreterState.bingGroup !== group) return socket.close();
    recognizer.opened = true;
    sendBingTextFrame(recognizer, 'speech.config', {
      context: {
        system: { name: 'SpeechSDK', version: '1.42.0', build: 'JavaScript', lang: 'JavaScript' },
        os: { platform: navigator.platform || 'Browser', name: navigator.userAgent, version: '' },
        audio: { source: { connectivity: 'Unknown', manufacturer: 'Browser', model: 'Microphone', type: 'Microphones' } },
      }
    });
    sendBingTextFrame(recognizer, 'speech.context', {
      speech: { language: side.locale, format: group.format, recognition: { mode: 'Interactive', profanity: 'Raw' } }
    });
    sendBingAudioFrame(recognizer, makeBingWavHeader(config.protocol?.sampleRate || INTERP_SAMPLE_RATE));
    if (group.recognizers.every((item) => item.opened)) {
      group.opened = true;
      flushBingAudioPrebuffer();
      updateInterpreterStatus('Bing recognition connected');
    }
  });
  socket.addEventListener('message', (event) => handleBingRecognitionMessage(recognizer, event.data));
  socket.addEventListener('error', () => {
    if (interpreterState.bingActive) console.warn('[interpreter] Bing speech socket error');
  });
  socket.addEventListener('close', () => {
    recognizer.finalReceived = true;
    if (!interpreterState.bingActive || interpreterState.bingGroup !== group) return;
    if (group.recognizers.every((item) => item.finalReceived || item.ws.readyState === WebSocket.CLOSED)) {
      group.closed = true;
      clearTimeout(interpreterState.bingRestartTimer);
      interpreterState.bingRestartTimer = setTimeout(() => {
        if (interpreterState.bingActive && interpreterState.listening) void startBingRecognition();
      }, 280);
    }
  });
  return recognizer;
}

function handleBingRecognitionMessage(recognizer, rawMessage) {
  if (!interpreterState.bingActive) return;
  let message;
  try {
    const text = typeof rawMessage === 'string'
      ? rawMessage
      : rawMessage instanceof Blob ? '' : new TextDecoder().decode(rawMessage);
    if (!text) return;
    message = parseBingSpeechMessage(text);
  } catch {
    return;
  }
  if (!message.path) return;
  if (message.path === 'speech.hypothesis') {
    const raw = message.body?.Text || message.body?.DisplayText || '';
    const text = sanitizeTranscript(raw);
    if (!text) return;
    recognizer.hypothesis = mergeBingHypothesis(recognizer.hypothesis, text, recognizer.code);
    recognizer.history.push(text);
    recognizer.history = recognizer.history.slice(-8);
    const utterance = interpreterState.activeUtterance || interpreterState.fallbackPendingUtterance || createUtterance([], true);
    if (!interpreterState.activeUtterance && !interpreterState.fallbackPendingUtterance) interpreterState.activeUtterance = utterance;
    const winner = chooseBingRecognizer();
    const provisional = winner?.hypothesis || recognizer.hypothesis;
    if (provisional && (interpreterState.asrEngine === 'bing' || interpreterState.asrEngine === 'fusion')) {
      void applyTranscriptResult(utterance, {
        text: provisional,
        language: winner?.code || recognizer.code,
        source_language: winner?.code || recognizer.code,
        target_language: oppositeInterpreterLanguage(winner?.speaker || recognizer.speaker),
        speaker_side: winner?.speaker || recognizer.speaker,
        direction_confidence: bingTextConfidence(provisional, winner?.code || recognizer.code),
      }, false);
    }
    return;
  }
  if (message.path === 'speech.phrase') {
    const text = chooseBingPhraseText(message.body, recognizer);
    if (!text) return;
    recognizer.finalText = text;
    const utterance = interpreterState.activeUtterance || interpreterState.fallbackPendingUtterance || createUtterance([], true);
    if (!interpreterState.activeUtterance && !interpreterState.fallbackPendingUtterance) interpreterState.activeUtterance = utterance;
    const winner = chooseBingRecognizer();
    if (!winner?.finalText) return;
    utterance.bingFinalText = winner.finalText;
    utterance.bingLanguage = winner.code;
    utterance.bingSpeaker = winner.speaker;
    if (interpreterState.asrEngine === 'bing' && !utterance.committed) {
      if (interpreterState.fallbackPendingUtterance === utterance) interpreterState.fallbackPendingUtterance = null;
      interpreterState.activeUtterance = null;
      void applyTranscriptResult(utterance, {
        text: winner.finalText,
        language: winner.code,
        source_language: winner.code,
        target_language: oppositeInterpreterLanguage(winner.speaker),
        speaker_side: winner.speaker,
        direction_confidence: bingTextConfidence(winner.finalText, winner.code),
      }, true);
    }
  }
}

function chooseBingRecognizer() {
  const group = interpreterState.bingGroup;
  if (!group) return null;
  return group.recognizers
    .filter((recognizer) => recognizer.hypothesis || recognizer.finalText)
    .sort((left, right) => bingRecognizerScore(right) - bingRecognizerScore(left))[0] || null;
}

function bingRecognizerScore(recognizer) {
  const text = recognizer.finalText || recognizer.hypothesis;
  const stable = recognizer.history.length > 1
    ? textSimilarityForInterpreter(text, recognizer.history.at(-2))
    : 0;
  return bingTextConfidence(text, recognizer.code) * 8 + stable * 2 + Math.min(text.length, 80) / 80;
}

function bingTextConfidence(text, code) {
  const value = String(text || '');
  const base = languageBase(code);
  const cjk = (value.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g) || []).length;
  const latin = (value.match(/[A-Za-z\u00c0-\u024f]/g) || []).length;
  const total = cjk + latin;
  if (!total) return 0.2;
  if (['zh', 'ja', 'ko'].includes(base)) return cjk / total;
  return latin / total;
}

function chooseBingPhraseText(body, recognizer) {
  const alternatives = Array.isArray(body?.NBest) ? body.NBest : [body || {}];
  return alternatives.map((item) => ({
    text: sanitizeTranscript(item.DisplayText || item.Display || item.Text || item.ITN || ''),
    confidence: Number(item.Confidence ?? item.confidence) || 0,
  })).filter((item) => item.text).sort((left, right) =>
    (right.confidence * 0.7 + bingTextConfidence(right.text, recognizer.code) * 0.3)
    - (left.confidence * 0.7 + bingTextConfidence(left.text, recognizer.code) * 0.3)
  )[0]?.text || sanitizeTranscript(body?.DisplayText || body?.Text || '');
}

function mergeBingHypothesis(previous, current, code) {
  const left = String(previous || '').trim();
  const right = String(current || '').trim();
  if (!left) return right;
  if (!right) return left;
  if (right.startsWith(left) || left.startsWith(right)) return right.length >= left.length ? right : left;
  const compactLeft = left.replace(/\s+/g, '');
  const compactRight = right.replace(/\s+/g, '');
  for (let size = Math.min(24, compactLeft.length, compactRight.length); size >= 3; size -= 1) {
    if (compactLeft.slice(-size) === compactRight.slice(0, size)) return compactLeft + compactRight.slice(size);
  }
  return textSimilarityForInterpreter(left, right) > 0.78 ? right : right;
}

function textSimilarityForInterpreter(left, right) {
  const a = String(left || '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  const b = String(right || '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  return 0;
}

function oppositeInterpreterLanguage(speaker) {
  return speaker === 'mine' ? getTheirLang() : getMyLang();
}

function sendBingTextFrame(turn, path, body) {
  if (turn.ws.readyState !== WebSocket.OPEN) return;
  turn.ws.send(`${bingProtocolHeaders(turn, path, 'application/json; charset=utf-8')}\r\n${JSON.stringify(body)}`);
}

function sendBingAudioFrame(turn, payload) {
  if (turn.ws.readyState !== WebSocket.OPEN || turn.ws.bufferedAmount > INTERP_LIVE_MAX_BUFFERED_BYTES) return;
  const headers = new TextEncoder().encode(bingProtocolHeaders(turn, 'audio', 'audio/x-wav'));
  const audio = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  const frame = new Uint8Array(2 + headers.length + audio.length);
  new DataView(frame.buffer).setUint16(0, headers.length, false);
  frame.set(headers, 2);
  frame.set(audio, 2 + headers.length);
  turn.ws.send(frame.buffer);
}

function bingProtocolHeaders(turn, path, contentType) {
  return [`Path: ${path}`, `X-RequestId: ${turn.requestId}`, `X-Timestamp: ${new Date().toISOString()}`, `X-ConnectionId: ${turn.connectionId}`, `Content-Type: ${contentType}`, ''].join('\r\n');
}

function parseBingSpeechMessage(message) {
  const separator = message.indexOf('\r\n\r\n');
  const headerText = separator >= 0 ? message.slice(0, separator) : message;
  const bodyText = separator >= 0 ? message.slice(separator + 4).trim() : '';
  const headers = {};
  headerText.split('\r\n').forEach((line) => {
    const colon = line.indexOf(':');
    if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  });
  let body = {};
  if (bodyText) {
    try { body = JSON.parse(bodyText); } catch {}
  }
  return { path: headers.path || '', body };
}

function makeBingWavHeader(sampleRate) {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  const write = (offset, value) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, 0, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, 0, true);
  return new Uint8Array(buffer);
}

function compactInterpreterUuid() {
  if (crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '').toUpperCase();
  return [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function startBingPCMProcessor() {
  const context = interpreterState.audioContext;
  if (!context || !interpreterState.meterSource || interpreterState.bingPCMProcessor) return false;
  try {
    const processor = context.createScriptProcessor(2048, 1, 1);
    const muteGain = context.createGain();
    muteGain.gain.value = 0;
    interpreterState.meterSource.connect(processor);
    processor.connect(muteGain);
    muteGain.connect(context.destination);
    processor.onaudioprocess = (event) => {
      if (!interpreterState.listening || !interpreterState.bingActive) return;
      const frame = downsampleMusicFrame(event.inputBuffer, INTERP_SAMPLE_RATE);
      if (frame.length) sendBingAudioFrameToGroup(encodePCM16Frame(frame));
    };
    interpreterState.bingPCMProcessor = processor;
    interpreterState.bingMuteGain = muteGain;
    return true;
  } catch (error) {
    console.warn('[interpreter] Bing PCM processor unavailable:', error);
    return false;
  }
}

function sendBingAudioFrameToGroup(pcm) {
  const group = interpreterState.bingGroup;
  if (!group?.opened) {
    interpreterState.bingAudioPrebuffer.push(pcm.slice ? pcm.slice() : pcm);
    if (interpreterState.bingAudioPrebuffer.length > 120) interpreterState.bingAudioPrebuffer.shift();
    return;
  }
  group.recognizers.forEach((recognizer) => sendBingAudioFrame(recognizer, pcm));
}

function flushBingAudioPrebuffer() {
  const frames = interpreterState.bingAudioPrebuffer.splice(0);
  frames.forEach((frame) => sendBingAudioFrameToGroup(frame));
}

function closeBingRecognition() {
  clearTimeout(interpreterState.bingRestartTimer);
  interpreterState.bingRestartTimer = null;
  const group = interpreterState.bingGroup;
  group?.recognizers?.forEach((recognizer) => {
    try { if (recognizer.ws.readyState < WebSocket.CLOSING) recognizer.ws.close(1000, 'capture stopped'); } catch {}
  });
  interpreterState.bingGroup = null;
  interpreterState.bingAudioPrebuffer = [];
}

function startLiveRecognition() {
  closeLiveRecognition();
  interpreterState.liveSocketFailed = false;
  interpreterState.liveAudioQueue = [];
  interpreterState.liveConnectedAt = 0;
  interpreterState.liveLastTranscriptAt = 0;

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const language = getForcedLanguage({
    direction: interpreterState.direction,
    contentMode: interpreterState.contentMode,
    myLang: getMyLang(),
    theirLang: getTheirLang(),
  }) || 'multi';
  const url = `${protocol}//${location.host}/api/stt/live?language=${encodeURIComponent(language)}`;

  try {
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    interpreterState.liveSocket = socket;

    socket.addEventListener('open', () => {
      if (!interpreterState.listening || interpreterState.liveSocket !== socket) {
        socket.close(1000, 'capture stopped');
        return;
      }
      interpreterState.liveSocketReady = true;
      interpreterState.liveConnectedAt = performance.now();
      const queued = interpreterState.liveAudioQueue.splice(0);
      queued.forEach((frame) => socket.send(frame));
    });
    socket.addEventListener('message', (event) => handleLiveRecognitionMessage(event.data));
    socket.addEventListener('error', () => {
      interpreterState.liveSocketFailed = true;
    });
    socket.addEventListener('close', () => {
      if (interpreterState.liveSocket === socket) {
        interpreterState.liveSocket = null;
        interpreterState.liveSocketReady = false;
        interpreterState.liveSocketFailed = interpreterState.listening;
      }
    });
  } catch (error) {
    interpreterState.liveSocketFailed = true;
    console.warn('[同传] 实时识别连接失败，使用 Whisper 滚动识别:', error);
  }
}

function sendLiveAudioFrame(samples) {
  const socket = interpreterState.liveSocket;
  if (!socket || interpreterState.liveSocketFailed) return;
  const pcm = encodePCM16Frame(samples);
  if (socket.readyState === WebSocket.OPEN) {
    if (socket.bufferedAmount <= INTERP_LIVE_MAX_BUFFERED_BYTES) socket.send(pcm);
    return;
  }
  if (socket.readyState === WebSocket.CONNECTING) {
    interpreterState.liveAudioQueue.push(pcm);
    if (interpreterState.liveAudioQueue.length > INTERP_LIVE_AUDIO_QUEUE_FRAMES) {
      interpreterState.liveAudioQueue.shift();
    }
  }
}

function encodePCM16Frame(samples) {
  const pcm = new ArrayBuffer(samples.length * 2);
  const view = new DataView(pcm);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return pcm;
}

function handleLiveRecognitionMessage(rawMessage) {
  if (!interpreterState.listening || interpreterState.contentMode !== 'music') return;
  let message;
  try {
    message = JSON.parse(typeof rawMessage === 'string' ? rawMessage : new TextDecoder().decode(rawMessage));
  } catch {
    return;
  }
  if (message.type !== 'Results') return;

  const text = sanitizeTranscript(message.channel?.alternatives?.[0]?.transcript || '');
  if (!text) return;
  interpreterState.liveLastTranscriptAt = performance.now();
  const utterance = interpreterState.activeUtterance;
  if (!utterance || utterance.finalQueued || utterance.committed) return;

  if (message.is_final) {
    const addition = trimTranscriptOverlap(utterance.liveFinalText, text);
    utterance.liveFinalText = [utterance.liveFinalText, addition].filter(Boolean).join(' ').trim();
    utterance.livePartialText = '';
  } else {
    utterance.livePartialText = text;
  }

  const combined = [utterance.liveFinalText, utterance.livePartialText].filter(Boolean).join(' ').trim();
  if (!combined) return;
  void applyTranscriptResult(utterance, {
    text: combined,
    language: getForcedLanguage(utterance),
  }, false);
}

function closeLiveRecognition() {
  const socket = interpreterState.liveSocket;
  interpreterState.liveSocket = null;
  interpreterState.liveSocketReady = false;
  interpreterState.liveAudioQueue = [];
  interpreterState.liveConnectedAt = 0;
  interpreterState.liveLastTranscriptAt = 0;
  if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'capture stopped');
}

async function startSileroVAD() {
  if (!window.vad?.MicVAD) throw new Error('VADAssetsUnavailable');
  const streamAtStart = interpreterState.stream;
  if (!streamAtStart) return false;

  const instance = await window.vad.MicVAD.new({
    model: 'v5',
    startOnLoad: false,
    processorType: 'auto',
    baseAssetPath: '/vendor/vad/',
    onnxWASMBasePath: '/vendor/onnx/',
    audioContext: interpreterState.audioContext,
    getStream: async () => streamAtStart,
    pauseStream: async () => {},
    resumeStream: async () => streamAtStart,
    positiveSpeechThreshold: 0.48,
    negativeSpeechThreshold: 0.32,
    redemptionMs: 700,
    preSpeechPadMs: 320,
    minSpeechMs: 256,
    onSpeechStart: handleVADSpeechStart,
    onSpeechRealStart: handleVADSpeechRealStart,
    onSpeechEnd: handleVADSpeechEnd,
    onVADMisfire: handleVADMisfire,
    onFrameProcessed: handleVADFrame,
  });

  try {
    await instance.start();
    if (!interpreterState.listening || interpreterState.stream !== streamAtStart) {
      await instance.destroy().catch(() => {});
      return false;
    }
    interpreterState.vad = instance;
    return true;
  } catch (error) {
    await instance.destroy().catch(() => {});
    throw error;
  }
}

function handleVADSpeechStart() {
  if (!interpreterState.listening) return;
  interpreterState.vadSpeaking = true;
  interpreterState.fallbackSilenceSince = 0;
  if (!interpreterState.activeUtterance) {
    interpreterState.activeUtterance = createUtterance([], true);
  }
  updateInterpreterStatus();
}

function handleVADSpeechRealStart() {
  if (!interpreterState.activeUtterance) handleVADSpeechStart();
  if (interpreterState.activeUtterance) interpreterState.activeUtterance.speechConfirmed = true;
  ensureUtteranceBubble(interpreterState.activeUtterance);
}

function handleVADFrame(probabilities) {
  if (interpreterState.listening && probabilities?.isSpeech > 0.7) {
    interpreterState.vadSpeaking = true;
  }
}

function handleVADSpeechEnd() {
  interpreterState.vadSpeaking = false;
  if (interpreterState.activeUtterance) finishFallbackUtterance();
}

function handleVADMisfire() {
  interpreterState.vadSpeaking = false;
  const utterance = interpreterState.activeUtterance;
  if (utterance && !utterance.speechConfirmed && utterance.voicedMs < INTERP_MIN_VOICED_MS) {
    discardFallbackUtterance();
  }
}

function forceSplitUtterance() {
  finishFallbackUtterance();
}

function createUtterance(prefillFrames = [], fallback = false) {
  const frames = prefillFrames.map((frame) => frame.slice());
  const contentMode = interpreterState.contentMode;
  const theirLang = getTheirLang();
  return {
    id: ++interpreterState.sequence,
    source: interpreterState.source,
    contentMode,
    direction: interpreterState.direction,
    myLang: getMyLang(),
    theirLang,
    correction: interpreterState.correction,
    autoplay: interpreterState.autoplay,
    createdAt: Date.now(),
    historyPrompt: buildRecognitionHistory(contentMode, theirLang),
    startedAt: performance.now(),
    frames,
    sampleCount: frames.reduce((total, frame) => total + frame.length, 0),
    fallback,
    bubble: null,
    original: '',
    translated: '',
    isMine: null,
    lastKnownIsMine: null,
    speakerSide: null,
    speakerConfidence: 0,
    speakerMethod: 'unknown',
    sourceLanguage: '',
    targetLanguage: '',
    sttVersion: 0,
    translationVersion: 0,
    sttController: null,
    translationController: null,
    interimRunning: false,
    interimQueued: false,
    lastInterimAt: 0,
    lastInterimSampleCount: 0,
    finalQueued: false,
    committed: false,
    speechConfirmed: false,
    voicedMs: 0,
    peakLevel: 0,
    lastMeterAt: performance.now(),
    overlapSamples: 0,
    previousOriginal: '',
    previousTranscriptRef: null,
    transcriptRef: { text: '' },
    liveFinalText: '',
    livePartialText: '',
    bingFinalText: '',
    bingLanguage: '',
    bingSpeaker: '',
    translationTimer: null,
    pendingTranslationText: '',
    lastTranslationAt: 0,
  };
}

function buildRecognitionHistory(contentMode, theirLang) {
  let items = interpreterHistory;
  if (contentMode === 'music') {
    const language = languageBase(theirLang);
    items = items.filter((item) =>
      item.contentMode === 'music' && languageBase(item.sl) === language,
    );
  }
  return items
    .filter((item) => !isCaptionArtifact(item.original).isArtifact)
    .slice(-2)
    .map((item) => item.original)
    .join(' ')
    .replace(/\s+/g, ' ')
    .slice(-320);
}

function startFallbackRecorder() {
  if (!interpreterState.listening || !interpreterState.stream || typeof MediaRecorder === 'undefined') {
    throw new Error('NoSupportedRecorder');
  }
  const mimeType = pickInterpreterMimeType();
  const options = mimeType ? { mimeType, audioBitsPerSecond: 48000 } : { audioBitsPerSecond: 48000 };
  const recorder = new MediaRecorder(interpreterState.stream, options);
  const recorderRequestId = interpreterState.captureRequestId;
  const chunks = [];
  const recorderMimeType = recorder.mimeType || mimeType || 'audio/webm';
  interpreterState.fallbackRecorder = recorder;
  interpreterState.fallbackChunks = chunks;
  interpreterState.fallbackMimeType = recorderMimeType;
  interpreterState.fallbackRecorderStartedAt = performance.now();
  interpreterState.fallbackSilenceSince = 0;

  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size) chunks.push(event.data);
  });
  recorder.addEventListener('error', (event) => {
    console.error('[同传] MediaRecorder 错误:', event.error || event);
    setInterpreterError('录音器异常，请重新开始');
    void window.stopInterpreter();
  });
  recorder.addEventListener('stop', () => {
    const pending = interpreterState.fallbackPendingUtterance;
    interpreterState.fallbackPendingUtterance = null;
    if (pending && chunks.length) finalizeUtterance(pending, new Blob(chunks, { type: recorderMimeType }));
    if (interpreterState.fallbackRecorder === recorder) interpreterState.fallbackRecorder = null;
    if (interpreterState.listening && interpreterState.mode !== 'music' &&
        recorderRequestId === interpreterState.captureRequestId) {
      try {
        startFallbackRecorder();
      } catch (error) {
        setInterpreterError('兼容录音模式启动失败');
        void window.stopInterpreter();
      }
    }
  });
  recorder.start(200);
  if (interpreterState.mode === 'timed' && !interpreterState.activeUtterance) {
    interpreterState.activeUtterance = createUtterance([], true);
  }
}

function startTimedRecorderFallback() {
  clearInterval(interpreterState.timedChunkTimer);
  if (!interpreterState.activeUtterance) {
    interpreterState.activeUtterance = createUtterance([], true);
  }
  interpreterState.timedChunkTimer = setInterval(() => {
    if (!interpreterState.listening || interpreterState.mode !== 'timed') return;
    finishFallbackUtterance();
  }, 4000);
}

function pickInterpreterMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return candidates.find((type) => MediaRecorder.isTypeSupported?.(type)) || '';
}

function monitorFallbackSpeech(level) {
  if (!['recorder', 'hybrid'].includes(interpreterState.mode)) return;
  const now = performance.now();
  const active = interpreterState.activeUtterance;

  if (!active && now < interpreterState.fallbackCalibrationUntil) {
    interpreterState.fallbackNoiseFloor = interpreterState.fallbackNoiseFloor * 0.82 + level * 0.18;
    return;
  }

  const threshold = Math.max(0.0035, interpreterState.fallbackNoiseFloor * 2.2 + 0.001);
  if (!active && level < threshold) {
    interpreterState.fallbackNoiseFloor = interpreterState.fallbackNoiseFloor * 0.96 + level * 0.04;
  }

  if (level > threshold && now - interpreterState.streamStartedAt > 300) {
    if (!interpreterState.activeUtterance) {
      interpreterState.activeUtterance = createUtterance([], true);
      ensureUtteranceBubble(interpreterState.activeUtterance);
    }
    interpreterState.fallbackSilenceSince = 0;
  } else if (interpreterState.activeUtterance) {
    if (!interpreterState.fallbackSilenceSince) interpreterState.fallbackSilenceSince = now;
    const silenceLimit = interpreterState.vadReady && interpreterState.vadSpeaking ? 1400 : 850;
    if (now - interpreterState.fallbackSilenceSince >= silenceLimit) finishFallbackUtterance();
  }

  const current = interpreterState.activeUtterance;
  if (current) {
    const frameMs = Math.min(50, Math.max(0, now - current.lastMeterAt));
    current.lastMeterAt = now;
    current.peakLevel = Math.max(current.peakLevel, level);
    if (level > threshold) current.voicedMs += frameMs;
  }
  if (current && now - current.startedAt >= INTERP_MAX_UTTERANCE_SAMPLES / INTERP_SAMPLE_RATE * 1000) {
    forceSplitUtterance();
    return;
  }
  if (current && (current.speechConfirmed || current.voicedMs >= INTERP_MIN_VOICED_MS) &&
      now - current.startedAt >= 800 && now - current.lastInterimAt >= INTERP_INTERIM_INTERVAL_MS) {
    queueInterimRecognition(current, currentFallbackBlob());
  }

  if (!current && now - interpreterState.fallbackRecorderStartedAt > 1800) {
    rotateFallbackRecorder();
  }
}

function finishFallbackUtterance() {
  const recorder = interpreterState.fallbackRecorder;
  const utterance = interpreterState.activeUtterance;
  if (!utterance || !recorder || recorder.state !== 'recording') return;
  if (interpreterState.mode !== 'timed' && !utterance.speechConfirmed &&
      utterance.voicedMs < INTERP_MIN_VOICED_MS) {
    discardFallbackUtterance();
    return;
  }
  interpreterState.activeUtterance = null;
  interpreterState.fallbackPendingUtterance = utterance;
  utterance.sttController?.abort();
  recorder.stop();
  updateInterpreterStatus();
}

function discardFallbackUtterance() {
  const recorder = interpreterState.fallbackRecorder;
  const utterance = interpreterState.activeUtterance;
  interpreterState.activeUtterance = null;
  interpreterState.fallbackPendingUtterance = null;
  utterance?.sttController?.abort();
  utterance?.bubble?.remove();
  if (recorder?.state === 'recording') recorder.stop();
  updateInterpreterStatus();
}

function rotateFallbackRecorder() {
  const recorder = interpreterState.fallbackRecorder;
  if (!recorder || recorder.state !== 'recording' || interpreterState.fallbackPendingUtterance) return;
  recorder.stop();
}

function currentFallbackBlob() {
  return new Blob(interpreterState.fallbackChunks.slice(), { type: interpreterState.fallbackMimeType });
}

function monitorInterpreterLevel() {
  if (!interpreterState.listening || !interpreterState.analyser) {
    updateLevelMeter(0);
    return;
  }

  const useFloatSamples = typeof interpreterState.analyser.getFloatTimeDomainData === 'function';
  const samples = useFloatSamples
    ? new Float32Array(interpreterState.analyser.fftSize)
    : new Uint8Array(interpreterState.analyser.fftSize);
  if (useFloatSamples) interpreterState.analyser.getFloatTimeDomainData(samples);
  else interpreterState.analyser.getByteTimeDomainData(samples);
  let energy = 0;
  for (const sample of samples) {
    const centered = useFloatSamples ? sample : (sample - 128) / 128;
    energy += centered * centered;
  }
  const rms = Math.sqrt(energy / samples.length);
  const now = performance.now();
  const wasInputSilent = interpreterState.inputSilent;
  interpreterState.peakLevel = Math.max(interpreterState.peakLevel, rms);
  if (rms > 0.002) {
    interpreterState.inputSilent = false;
    interpreterState.lastSignalAt = now;
  } else if (now - interpreterState.streamStartedAt > 5000 && now - interpreterState.lastSignalAt > 5000) {
    interpreterState.inputSilent = true;
  }
  interpreterState.lastLevel += (rms - interpreterState.lastLevel) * 0.3;
  updateLevelMeter(Math.min(1, interpreterState.lastLevel * 8));
  monitorFallbackSpeech(rms);
  if (wasInputSilent !== interpreterState.inputSilent) updateInterpreterStatus();
  interpreterState.animationFrameId = requestAnimationFrame(monitorInterpreterLevel);
}

function updateLevelMeter(level) {
  const bars = document.querySelectorAll('.interp-level-meter span');
  const factors = [0.55, 0.82, 1, 0.76, 0.48];
  bars.forEach((bar, index) => {
    const scale = 0.18 + level * factors[index];
    bar.style.transform = `scaleY(${scale.toFixed(2)})`;
  });
}

function queueInterimRecognition(utterance, payload = null) {
  if (!utterance || utterance.finalQueued || utterance.committed) return;
  const currentSamples = utterance.fallback
    ? Math.round((performance.now() - utterance.startedAt) * INTERP_SAMPLE_RATE / 1000)
    : utterance.sampleCount;
  const requiredNewSamples = utterance.contentMode === 'music'
    ? INTERP_MUSIC_INTERIM_NEW_SAMPLES
    : INTERP_INTERIM_NEW_SAMPLES;
  if (currentSamples - utterance.lastInterimSampleCount < requiredNewSamples) return;

  if (utterance.interimRunning) {
    utterance.interimQueued = true;
    return;
  }

  const audioPayload = payload || concatAudioFrames(utterance.frames);
  utterance.interimRunning = true;
  utterance.lastInterimAt = performance.now();
  utterance.lastInterimSampleCount = currentSamples;
  void recognizeUtterance(utterance, audioPayload, false).finally(() => {
    utterance.interimRunning = false;
    if (utterance.interimQueued && !utterance.finalQueued) {
      utterance.interimQueued = false;
      queueInterimRecognition(utterance, utterance.fallback ? currentFallbackBlob() : null);
    }
  });
}

function finalizeUtterance(utterance, payload) {
  if (!utterance || utterance.finalQueued || utterance.committed) return;
  if (payload instanceof Float32Array && payload.length < INTERP_SAMPLE_RATE * 0.22) {
    utterance.bubble?.remove();
    return;
  }
  if (payload instanceof Blob && payload.size < 500) {
    utterance.bubble?.remove();
    return;
  }

  utterance.finalQueued = true;
  utterance.interimQueued = false;
  utterance.sttVersion += 1;
  utterance.sttController?.abort();
  ensureUtteranceBubble(utterance);
  setBubbleStage(utterance, '正在校正', true);

  if (interpreterState.finalQueue.length >= INTERP_MAX_FINAL_QUEUE) {
    const dropped = interpreterState.finalQueue.shift();
    markRecognitionError(dropped.utterance, '等待过久，保留临时结果');
  }
  interpreterState.finalQueue.push({ utterance, payload });
  pumpFinalQueue();
  updateInterpreterStatus();
}

function pumpFinalQueue() {
  while (interpreterState.finalWorkers < INTERP_MAX_FINAL_WORKERS && interpreterState.finalQueue.length) {
    const job = interpreterState.finalQueue.shift();
    interpreterState.finalWorkers += 1;
    void recognizeUtterance(job.utterance, job.payload, true)
      .finally(() => {
        interpreterState.finalWorkers -= 1;
        pumpFinalQueue();
        updateInterpreterStatus();
      });
  }
}

async function recognizeUtterance(utterance, payload, isFinal) {
  const requestVersion = ++utterance.sttVersion;
  const controller = new AbortController();
  utterance.sttController?.abort();
  utterance.sttController = controller;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, INTERP_STT_TIMEOUT_MS);

  interpreterState.activeRequests += 1;
  updateInterpreterStatus();

  try {
    if (isFinal && interpreterState.asrEngine === 'bing' && utterance.bingFinalText) {
      await applyTranscriptResult(utterance, {
        text: utterance.bingFinalText,
        language: utterance.bingLanguage || getForcedLanguage(utterance),
        source_language: utterance.bingLanguage || getForcedLanguage(utterance),
        target_language: oppositeInterpreterLanguage(utterance.bingSpeaker),
        speaker_side: utterance.bingSpeaker,
        direction_confidence: bingTextConfidence(utterance.bingFinalText, utterance.bingLanguage),
      }, true);
      return;
    }
    const blob = makeInterpreterAudioBlob(payload);
    const headers = {
      'Content-Type': blob.type || 'audio/wav',
      'X-My-Lang': utterance.myLang,
      'X-Their-Lang': utterance.theirLang,
      'X-History-Prompt': encodeURIComponent(getRecognitionContext(utterance)),
      'X-Transcript-Mode': isFinal ? 'final' : 'interim',
      'X-ASR-Correction': isFinal && utterance.correction ? '1' : '0',
      'X-Audio-Mode': utterance.source,
      'X-Content-Mode': utterance.contentMode,
      'X-Chunk-Id': String(utterance.id),
      'X-Audio-Voiced-Ms': String(Math.max(0, Math.round(utterance.voicedMs || 0))),
      'X-Audio-Peak': String(Math.max(0, Number(utterance.peakLevel || 0)).toFixed(5)),
    };
    if (isFinal && interpreterState.asrEngine === 'fusion') {
      const alternate = [
        utterance.bingFinalText,
        utterance.liveFinalText,
        utterance.livePartialText,
      ].filter(Boolean).join(' ').trim();
      if (alternate) {
        headers['X-Alternate-Transcript'] = encodeURIComponent(alternate.slice(-1200));
        headers['X-Alternate-Language'] = utterance.bingLanguage || getForcedLanguage(utterance) || '';
      }
    }
    const forcedLanguage = getForcedLanguage(utterance);
    if (forcedLanguage) headers['X-Forced-Lang'] = forcedLanguage;

    const response = await fetch('/api/stt', {
      method: 'POST',
      headers,
      body: blob,
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `语音识别失败 (${response.status})`);
    }

    const result = await response.json();
    if (requestVersion !== utterance.sttVersion || utterance.committed && !isFinal) return;
    await applyTranscriptResult(utterance, result, isFinal);
  } catch (error) {
    if (error.name === 'AbortError' && !timedOut) return;
    console.warn(`[同传] ${isFinal ? '最终' : '临时'}识别失败:`, error);
    if (isFinal) markRecognitionError(utterance, timedOut ? '识别超时，已保留临时结果' : '识别暂时不可用');
  } finally {
    clearTimeout(timeout);
    interpreterState.activeRequests = Math.max(0, interpreterState.activeRequests - 1);
    if (utterance.sttController === controller) utterance.sttController = null;
    updateInterpreterStatus();
  }
}

function getRecognitionContext(utterance) {
  const previous = utterance.previousTranscriptRef?.text || utterance.previousOriginal || '';
  return [utterance.historyPrompt, previous]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(-500);
}

function makeInterpreterAudioBlob(payload) {
  if (payload instanceof Blob) return payload;
  if (!(payload instanceof Float32Array)) throw new Error('InvalidAudioPayload');
  const wav = window.vad?.utils?.encodeWAV
    ? window.vad.utils.encodeWAV(payload, 1, INTERP_SAMPLE_RATE, 1, 16)
    : encodePCM16Wav(payload, INTERP_SAMPLE_RATE);
  return new Blob([wav], { type: 'audio/wav' });
}

function encodePCM16Wav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeText = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
}

async function applyTranscriptResult(utterance, result, isFinal) {
  let text = sanitizeTranscript(result.text || '');
  const artifact = isCaptionArtifact(text);
  if (artifact.strong || (!isFinal && artifact.isArtifact)) text = '';
  const previousText = utterance.previousTranscriptRef?.text || utterance.previousOriginal;
  if (utterance.contentMode === 'music' && utterance.overlapSamples && previousText) {
    text = trimTranscriptOverlap(previousText, text);
  }
  const echoFiltered = filterInterpreterPlaybackEcho(
    text,
    result.language || result.source_language,
    utterance,
    isFinal,
  );
  text = echoFiltered.text;
  if (!text) {
    const explicitlyRejected = window.InterpreterPlaybackEcho?.shouldRejectFinalTranscript
      ? window.InterpreterPlaybackEcho.shouldRejectFinalTranscript(result, artifact)
      : result?.accepted === false || Boolean(result?.whisper_filtered_reason) || artifact.strong;
    if (isFinal && explicitlyRejected) {
      utterance.translationController?.abort();
      utterance.translated = '';
      utterance.original = '';
      utterance.bubble?.remove();
      return;
    }
    if (echoFiltered.echoOnly) {
      if (isFinal) utterance.bubble?.remove();
      return;
    }
    if (isFinal && utterance.original) {
      await translateUtterance(utterance, utterance.original, true);
    } else if (isFinal) {
      utterance.bubble?.remove();
    }
    return;
  }

  const direction = resolveSpeakerDirection(utterance, text, result);
  const isMine = direction.isMine === null || direction.isMine === undefined
    ? utterance.lastKnownIsMine ?? null
    : direction.isMine;
  utterance.isMine = isMine;
  if (isMine !== null) utterance.lastKnownIsMine = isMine;
  if (direction.speakerSide) utterance.speakerSide = direction.speakerSide;
  if (direction.confidence > 0) utterance.speakerConfidence = direction.confidence;
  if (direction.method !== 'unknown') utterance.speakerMethod = direction.method;
  if (direction.sourceLanguage) utterance.sourceLanguage = direction.sourceLanguage;
  if (direction.targetLanguage) utterance.targetLanguage = direction.targetLanguage;
  utterance.original = text;
  utterance.transcriptRef.text = text;
  ensureUtteranceBubble(utterance);
  setBubbleDirection(utterance, isMine);
  utterance.bubble.querySelector('.interp-msg-original').textContent = text;
  if (isMine === null) {
    setBubbleStage(utterance, isFinal ? '方向待确认' : '等待方向', !isFinal);
    const translatedElement = utterance.bubble.querySelector('.interp-msg-translated');
    if (translatedElement) translatedElement.textContent = '暂时无法判断说话方';
    if (isFinal) commitUtterance(utterance, '', '');
    return;
  }
  setBubbleStage(utterance, isFinal ? '正在翻译' : '实时', !isFinal);
  if (isFinal) {
    clearTimeout(utterance.translationTimer);
    utterance.translationTimer = null;
    utterance.pendingTranslationText = '';
    await translateUtterance(utterance, text, true);
  } else {
    scheduleInterimTranslation(utterance, text);
  }
}

function isCaptionArtifact(text) {
  return window.InterpreterPlaybackEcho?.classifyCaptionArtifact?.(text) ||
    { isArtifact: false, strong: false, reason: '' };
}

function filterInterpreterPlaybackEcho(text, language, utterance, isFinal) {
  const value = String(text || '').trim();
  if (!value) return { text: '', echoOnly: false };
  const now = Date.now();
  const utteranceStartedAt = Number(utterance?.createdAt) || now;
  interpreterPlayback.echoReferences = interpreterPlayback.echoReferences.filter((reference) =>
    !reference.endedAt || now <= (Number(reference.expiresAt) || Number(reference.endedAt) + 2200));
  const references = interpreterPlayback.echoReferences;
  if (!references.length) return { text: value, echoOnly: false };
  const tools = window.InterpreterPlaybackEcho;
  if (!tools?.classifyPlaybackEcho) return { text: value, echoOnly: false };
  const classified = tools.classifyPlaybackEcho(
    value,
    language,
    references,
    { startedAt: utteranceStartedAt, endedAt: now },
    now,
  );
  if (!classified.reference) return { text: value, echoOnly: false };
  if (classified.isEcho || (isFinal && classified.probableEcho)) {
    return { text: '', echoOnly: true, reference: classified.reference };
  }
  if (classified.containsReference && tools.removeReferenceSegment) {
    const trimmed = sanitizeTranscript(tools.removeReferenceSegment(value, classified.reference.text));
    if (trimmed && tools.normalizeSpeechText(trimmed) !== tools.normalizeSpeechText(value)) {
      return { text: trimmed, echoOnly: false, reference: classified.reference };
    }
  }
  // Partial or fuzzy matches remain visible to avoid deleting a person's
  // correction, but may not recursively trigger another TTS pass.
  if (classified.contaminated && utterance) utterance.autoplay = false;
  return { text: value, echoOnly: false, reference: classified.reference };
}

function scheduleInterimTranslation(utterance, text) {
  utterance.pendingTranslationText = text;
  if (utterance.translationTimer) return;
  const elapsed = performance.now() - utterance.lastTranslationAt;
  const delay = Math.max(180, 550 - elapsed);
  utterance.translationTimer = setTimeout(() => {
    utterance.translationTimer = null;
    if (utterance.committed || utterance.finalQueued || !utterance.pendingTranslationText) return;
    const pendingText = utterance.pendingTranslationText;
    utterance.pendingTranslationText = '';
    utterance.lastTranslationAt = performance.now();
    void translateUtterance(utterance, pendingText, false);
  }, delay);
}

function trimTranscriptOverlap(previousText, currentText) {
  const previous = String(previousText || '').trim();
  const current = String(currentText || '').trim();
  if (!previous || !current) return current;

  const previousWords = previous.split(/\s+/);
  const currentWords = current.split(/\s+/);
  if (previousWords.length > 1 && currentWords.length > 1) {
    const normalize = (word) => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const maxWords = Math.min(10, previousWords.length, currentWords.length);
    for (let size = maxWords; size >= 2; size -= 1) {
      const suffix = previousWords.slice(-size).map(normalize).join(' ');
      const prefix = currentWords.slice(0, size).map(normalize).join(' ');
      if (suffix && suffix === prefix) return currentWords.slice(size).join(' ').trim();
    }
  }

  const previousCompact = previous.replace(/\s+/g, '');
  const currentCompact = current.replace(/\s+/g, '');
  const maxChars = Math.min(24, previousCompact.length, currentCompact.length);
  for (let size = maxChars; size >= 4; size -= 1) {
    if (previousCompact.slice(-size) === currentCompact.slice(0, size)) {
      return currentCompact.slice(size).trim();
    }
  }
  return current;
}

async function translateUtterance(utterance, text, isFinal) {
  const fallbackSource = utterance.isMine ? utterance.myLang : utterance.theirLang;
  const fallbackTarget = utterance.isMine ? utterance.theirLang : utterance.myLang;
  /* Prefer the source/target pair returned by ASR. This matters when a
     provider normalizes a configured locale (for example zh-Hans) or when
     an audio track's detected language differs from the selected pair. */
  const sl = utterance.sourceLanguage || fallbackSource;
  const tl = utterance.targetLanguage || fallbackTarget;
  const version = ++utterance.translationVersion;
  utterance.translationController?.abort();
  const controller = new AbortController();
  utterance.translationController = controller;
  const timeout = setTimeout(() => controller.abort(), INTERP_TRANSLATE_TIMEOUT_MS);
  const translatedElement = utterance.bubble.querySelector('.interp-msg-translated');
  translatedElement.classList.add('is-updating');
  if (!utterance.translated) translatedElement.textContent = '翻译中…';

  interpreterState.activeRequests += 1;
  updateInterpreterStatus();
  try {
    const result = await translateInterpreterText(text, sl, tl, controller.signal);
    if (version !== utterance.translationVersion) return;
    utterance.translated = (result.translatedText || '').trim();
    translatedElement.textContent = utterance.translated || '暂无译文';
    updatePlayButton(utterance, tl);
    if (isFinal) commitUtterance(utterance, sl, tl);
  } catch (error) {
    if (error.name === 'AbortError' && !isFinal) return;
    console.warn('[同传] 翻译失败:', error);
    if (!utterance.translated) translatedElement.textContent = '翻译暂时不可用';
    if (isFinal) commitUtterance(utterance, sl, tl);
  } finally {
    clearTimeout(timeout);
    interpreterState.activeRequests = Math.max(0, interpreterState.activeRequests - 1);
    if (version === utterance.translationVersion) translatedElement.classList.remove('is-updating');
    if (utterance.translationController === controller) utterance.translationController = null;
    updateInterpreterStatus();
  }
}

async function translateInterpreterText(text, from, to, signal) {
  const selectedEngine = localStorage.getItem('translate_engine') || 'auto';
  const preferBing = selectedEngine === 'bing' || (selectedEngine === 'auto' && interpreterState.tone !== 'Standard');
  const providers = preferBing
    ? ['bing-live', 'google', 'cloudflare']
    : selectedEngine === 'google'
      ? ['google', 'cloudflare']
      : selectedEngine === 'cloudflare'
        ? ['cloudflare', 'google']
        : ['google', 'bing-live', 'cloudflare'];

  let lastError;
  for (const provider of providers) {
    try {
      const result = await requestInterpreterTranslation(provider, text, from, to, signal);
      if (result.translatedText) return result;
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      lastError = error;
    }
  }
  throw lastError || new Error('translation unavailable');
}

async function requestInterpreterTranslation(provider, text, from, to, signal) {
  const payload = provider === 'bing-live'
    ? { text, from, to, tone: interpreterState.tone, isVoice: true }
    : { text, sl: from, tl: to, provider };
  const response = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `translation failed (${response.status})`);
  }
  const result = await response.json();
  return {
    ...result,
    translatedText: result.translation || result.translatedText || '',
  };
}

function commitUtterance(utterance, sl, tl) {
  if (utterance.committed) return;
  utterance.committed = true;
  clearTimeout(utterance.translationTimer);
  utterance.translationTimer = null;
  utterance.pendingTranslationText = '';
  const directionKnown = utterance.isMine === true || utterance.isMine === false;
  setBubbleStage(utterance, directionKnown ? '已校正' : '方向待确认', false);
  utterance.bubble.classList.remove('is-interim');
  interpreterHistory.push({
    ts: new Date().toISOString(),
    who: utterance.isMine === null || utterance.isMine === undefined
      ? '未知方向'
      : utterance.isMine ? '我方' : '对方',
    sl,
    tl,
    original: utterance.original,
    translated: utterance.translated,
    contentMode: utterance.contentMode,
  });

  if (directionKnown && interpreterState.autoplay && utterance.autoplay && utterance.translated) {
    setInterpreterPlaybackState(utterance.bubble, 'queued');
    void playInterpreterTTS(utterance.translated, tl, {
      queue: true,
      dedupe: true,
      utterance,
    }).catch((error) => {
      console.warn('[interpreter] automatic TTS failed:', error);
      setInterpreterPlaybackState(utterance.bubble, 'error');
      notifyInterpreter('译文已生成，但浏览器阻止了自动播报；可点击扬声器重试');
    });
  }
}

function ensureUtteranceBubble(utterance) {
  if (utterance.bubble) return utterance.bubble;
  const messageView = document.getElementById('interpMessagesView');
  if (!messageView) return null;
  document.getElementById('interpHint')?.classList.add('is-hidden');

  const bubble = document.createElement('article');
  bubble.className = 'interp-msg-bubble pending-msg is-interim';
  bubble.innerHTML = `
    <div class="interp-msg-header">
      <span class="interp-msg-who">识别中</span>
      <span class="interp-live-badge">聆听</span>
    </div>
    <div class="interp-msg-original">正在聆听…</div>
    <div class="interp-msg-divider"></div>
    <div class="interp-msg-translation-row">
      <button class="interp-play-btn" type="button" title="朗读译文" aria-label="朗读译文" hidden>🔊</button>
      <div class="interp-msg-translated">等待语音…</div>
    </div>`;
  messageView.appendChild(bubble);
  messageView.scrollTop = messageView.scrollHeight;
  utterance.bubble = bubble;
  return bubble;
}

function setBubbleDirection(utterance, isMine) {
  if (!utterance.bubble) return;
  utterance.bubble.classList.remove('pending-msg', 'my-msg', 'their-msg');
  if (isMine === null || isMine === undefined) {
    utterance.bubble.classList.add('pending-msg');
    utterance.bubble.querySelector('.interp-msg-who').textContent = '方向待确认';
    return;
  }
  utterance.bubble.classList.add(isMine ? 'my-msg' : 'their-msg');
  utterance.bubble.querySelector('.interp-msg-who').textContent = isMine ? '我方' : '对方';
}

function setBubbleStage(utterance, label, interim) {
  if (!utterance.bubble) return;
  const badge = utterance.bubble.querySelector('.interp-live-badge');
  if (badge) badge.textContent = label;
  utterance.bubble.classList.toggle('is-interim', interim);
  document.getElementById('interpMessagesView').scrollTop = document.getElementById('interpMessagesView').scrollHeight;
}

function updatePlayButton(utterance, targetLang) {
  const button = utterance.bubble?.querySelector('.interp-play-btn');
  if (!button || !utterance.translated) return;
  button.hidden = false;
  button.dataset.text = utterance.translated;
  button.dataset.lang = targetLang;
}

function markRecognitionError(utterance, message) {
  ensureUtteranceBubble(utterance);
  if (utterance.original) {
    setBubbleStage(utterance, '临时结果', false);
    const sl = utterance.isMine === true ? utterance.myLang : utterance.isMine === false ? utterance.theirLang : '';
    const tl = utterance.isMine === true ? utterance.theirLang : utterance.isMine === false ? utterance.myLang : '';
    commitUtterance(utterance, sl, tl);
  } else if (utterance.bubble) {
    utterance.bubble.classList.add('has-error');
    utterance.bubble.querySelector('.interp-msg-original').textContent = message;
    utterance.bubble.querySelector('.interp-msg-translated').textContent = '请继续说话，系统会自动恢复';
    setBubbleStage(utterance, '未完成', false);
  }
}

function getForcedLanguage(utterance) {
  if (utterance.direction === 'mine') return utterance.myLang;
  if (utterance.direction === 'theirs') return utterance.theirLang;
  if (utterance.contentMode === 'music') return utterance.theirLang;
  return '';
}

function resolveSpeakerDirection(utterance, text, result = {}) {
  if (utterance.direction === 'mine') {
    return makeClientDirection(true, 'mine', utterance.myLang, utterance.theirLang, 'explicit', 1);
  }
  if (utterance.direction === 'theirs') {
    return makeClientDirection(false, 'theirs', utterance.theirLang, utterance.myLang, 'explicit', 1);
  }

  const explicitSide = normalizeSpeakerSide(result.speaker_side ?? result.speaker ?? result.speakerSide);
  const resultSource = normalizeResultLanguage(result.source_language || result.sourceLanguage);
  const resultTarget = normalizeResultLanguage(result.target_language || result.targetLanguage);
  if (explicitSide === 'mine') {
    return makeClientDirection(true, explicitSide, resultSource || utterance.myLang,
      resultTarget || utterance.theirLang, 'provider-side', Number(result.direction_confidence) || 0.95);
  }
  if (explicitSide === 'theirs') {
    return makeClientDirection(false, explicitSide, resultSource || utterance.theirLang,
      resultTarget || utterance.myLang, 'provider-side', Number(result.direction_confidence) || 0.95);
  }

  /* Some ASR providers omit speaker_side but still return a source language.
     Treat the configured language pair as the authority for that case. */
  const resultSourceBase = normalizeWhisperLanguage(resultSource);
  const resultTargetBase = normalizeWhisperLanguage(resultTarget);
  const myBase = languageBase(utterance.myLang);
  const theirBase = languageBase(utterance.theirLang);
  if (resultSourceBase === myBase && resultSourceBase !== theirBase) {
    return makeClientDirection(true, 'mine', resultSource || utterance.myLang,
      resultTarget || utterance.theirLang, 'provider-source', Number(result.direction_confidence) || 0.95);
  }
  if (resultSourceBase === theirBase && resultSourceBase !== myBase) {
    return makeClientDirection(false, 'theirs', resultSource || utterance.theirLang,
      resultTarget || utterance.myLang, 'provider-source', Number(result.direction_confidence) || 0.95);
  }
  const resultDirection = String(result.direction || '').toLowerCase();
  if (resultDirection === 'mine_to_theirs') {
    return makeClientDirection(true, 'mine', resultSource || utterance.myLang,
      resultTarget || utterance.theirLang, 'provider-direction', Number(result.direction_confidence) || 0.95);
  }
  if (resultDirection === 'theirs_to_mine') {
    return makeClientDirection(false, 'theirs', resultSource || utterance.theirLang,
      resultTarget || utterance.myLang, 'provider-direction', Number(result.direction_confidence) || 0.95);
  }

  const detected = normalizeWhisperLanguage(result.language || result.detected_language || result.detectedLanguage);
  if (detected === myBase && detected !== theirBase) {
    return makeClientDirection(true, 'mine', utterance.myLang, utterance.theirLang, 'language', 0.98);
  }
  if (detected === theirBase && detected !== myBase) {
    return makeClientDirection(false, 'theirs', utterance.theirLang, utterance.myLang, 'language', 0.98);
  }

  const glyphDirection = detectDirectionByScript(text, myBase, theirBase);
  if (glyphDirection !== null) {
    return glyphDirection
      ? makeClientDirection(true, 'mine', utterance.myLang, utterance.theirLang, 'script', 0.82)
      : makeClientDirection(false, 'theirs', utterance.theirLang, utterance.myLang, 'script', 0.82);
  }
  /* An earlier confirmed result is safe to retain for an interim update. It
     is not the same as guessing mine: no prior evidence still yields unknown. */
  if (utterance.isMine !== null && utterance.isMine !== undefined) {
    return makeClientDirection(
      utterance.isMine,
      utterance.speakerSide || (utterance.isMine ? 'mine' : 'theirs'),
      utterance.sourceLanguage || (utterance.isMine ? utterance.myLang : utterance.theirLang),
      utterance.targetLanguage || (utterance.isMine ? utterance.theirLang : utterance.myLang),
      'previous-result',
      utterance.speakerConfidence || 0.6,
    );
  }
  return makeClientDirection(null, null, '', '', 'unknown', 0);
}

function makeClientDirection(isMine, speakerSide, sourceLanguage, targetLanguage, method, confidence) {
  return {
    isMine,
    speakerSide,
    sourceLanguage: sourceLanguage || '',
    targetLanguage: targetLanguage || '',
    method,
    confidence: Number.isFinite(confidence) ? confidence : 0,
  };
}

function normalizeSpeakerSide(raw) {
  if (raw === true || raw === 1) return 'mine';
  if (raw === false || raw === 0) return 'theirs';
  const value = String(raw || '').trim().toLowerCase();
  if (['mine', 'my', 'user', 'self', 'speaker1', '我方', '我'].includes(value)) return 'mine';
  if (['theirs', 'their', 'other', 'speaker2', '对方', '他方'].includes(value)) return 'theirs';
  return '';
}

function normalizeResultLanguage(raw) {
  const value = String(raw || '').trim();
  return value ? value : '';
}

function detectDirectionByScript(text, myBase, theirBase) {
  const script = /[\u3040-\u30ff]/.test(text) ? 'ja'
    : /[\uac00-\ud7af]/.test(text) ? 'ko'
      : /[\u4e00-\u9fff]/.test(text) ? 'zh'
        : /[\u0400-\u04ff]/.test(text) ? 'ru'
          : /[\u0600-\u06ff]/.test(text) ? 'ar'
            : null;
  if (script) {
    if (myBase === script) return true;
    if (theirBase === script) return false;
  }

  const hasLatinText = /[A-Za-zÀ-ɏ]/.test(text);
  const myIsLatin = INTERP_LATIN_LANGUAGES.has(myBase);
  const theirIsLatin = INTERP_LATIN_LANGUAGES.has(theirBase);
  if (hasLatinText && myIsLatin !== theirIsLatin) return myIsLatin;
  return null;
}

function normalizeWhisperLanguage(raw) {
  const normalized = String(raw || '').toLowerCase().trim();
  if (normalized.length <= 3) return normalized;
  return INTERP_WHISPER_LANG_MAP[normalized] || languageBase(normalized);
}

function sanitizeTranscript(text) {
  return String(text)
    .replace(/\[(?:blank_audio|music|silence|noise)\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000);
}

function concatAudioFrames(frames) {
  const total = frames.reduce((sum, frame) => sum + frame.length, 0);
  const audio = new Float32Array(total);
  let offset = 0;
  frames.forEach((frame) => {
    audio.set(frame, offset);
    offset += frame.length;
  });
  return audio;
}

function playInterpreterTTS(text, lang, options = {}) {
  const normalized = String(text || '').trim();
  if (!normalized || typeof window === 'undefined') return Promise.resolve();
  if (options.interrupt) stopInterpreterTTS();
  const task = () => speakInterpreterTTS(normalized, lang, options);
  if (!options.queue) return task();

  interpreterState.ttsQueue ||= [];
  const key = `${lang}\u0000${normalized}`;
  if (options.dedupe !== false && interpreterState.ttsQueue.some((item) => item.key === key)) {
    return Promise.resolve();
  }
  while (interpreterState.ttsQueue.length >= 3) interpreterState.ttsQueue.shift()?.resolve?.();
  return new Promise((resolve, reject) => {
    interpreterState.ttsQueue.push({ key, task, resolve, reject });
    pumpInterpreterTTS();
  });
}

async function pumpInterpreterTTS() {
  if (interpreterState.ttsPlaying) return;
  interpreterState.ttsPlaying = true;
  try {
    while (interpreterState.ttsQueue?.length) {
      const item = interpreterState.ttsQueue.shift();
      try {
        await item.task();
        item.resolve?.();
      } catch (error) {
        item.reject?.(error);
      }
    }
  } finally {
    interpreterState.ttsPlaying = false;
  }
}

async function speakInterpreterTTS(text, lang, options = {}) {
  const runId = ++interpreterPlayback.runId;
  stopInterpreterTTS({ keepQueue: true, increment: false });
  const bubble = options.bubble || options.utterance?.bubble || null;
  const target = bubble?.querySelector('.interp-msg-translated') || null;
  const highlightContext = { target, text, lang, echoReference: null };
  setInterpreterPlaybackState(bubble, 'loading');
  beginInterpreterHighlight(highlightContext);
  try {
    const response = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        lang,
        voiceName: interpreterState.voiceName || '',
        rate: INTERP_TTS_RATE,
      }),
    });
    if (response.ok && /audio\//i.test(response.headers.get('content-type') || '')) {
      const blob = await response.blob();
      await playInterpreterAudio(blob, text, highlightContext, runId);
      return;
    }
    await speakInterpreterBrowser(text, lang, highlightContext, runId);
  } catch (error) {
    if (runId !== interpreterPlayback.runId) return;
    console.warn('[interpreter] Bing TTS unavailable, using browser voice:', error);
    try {
      await speakInterpreterBrowser(text, lang, highlightContext, runId);
    } catch (browserError) {
      const googleResponse = await fetch(`/api/tts?q=${encodeURIComponent(text)}&tl=${encodeURIComponent(lang)}&provider=google`);
      if (!googleResponse.ok || !/audio\//i.test(googleResponse.headers.get('content-type') || '')) {
        throw browserError;
      }
      const blob = await googleResponse.blob();
      beginInterpreterHighlight(highlightContext);
      await playInterpreterAudio(blob, text, highlightContext, runId);
    }
  } finally {
    finishInterpreterEchoReference(highlightContext.echoReference);
    if (runId === interpreterPlayback.runId) {
      endInterpreterHighlight();
      setInterpreterPlaybackState(bubble, 'idle');
    }
  }
}

function getInterpreterAudioPlayer() {
  if (!interpreterPlayback.player) {
    const player = new Audio();
    player.preload = 'auto';
    player.playsInline = true;
    interpreterPlayback.player = player;
  }
  return interpreterPlayback.player;
}

async function primeInterpreterPlayback() {
  if (interpreterPlayback.primed) return true;
  const player = getInterpreterAudioPlayer();
  const previousMuted = player.muted;
  const previousVolume = player.volume;
  try {
    // Reuse the same media element for later translated speech. Mobile Safari
    // and some embedded Chromium builds retain user activation per element.
    player.muted = true;
    player.volume = 0;
    player.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
    await player.play();
    player.pause();
    player.currentTime = 0;
    interpreterPlayback.primed = true;
    return true;
  } catch {
    return false;
  } finally {
    player.muted = previousMuted;
    player.volume = previousVolume;
  }
}

function setInterpreterPlaybackState(bubble, state) {
  if (!bubble?.isConnected) return;
  const button = bubble.querySelector('.interp-play-btn');
  bubble.classList.toggle('is-speaking', state === 'speaking');
  bubble.classList.toggle('is-tts-pending', state === 'queued' || state === 'loading');
  bubble.classList.toggle('has-tts-error', state === 'error');
  if (!button) return;
  button.classList.toggle('is-speaking', state === 'speaking');
  button.disabled = state === 'queued' || state === 'loading' || state === 'speaking';
  button.title = state === 'error' ? '自动播报失败，点击重试' : '朗读译文';
}

function beginInterpreterEchoReference(context) {
  if (!context?.text) return null;
  finishInterpreterEchoReference(interpreterPlayback.activeEchoReference);
  const reference = {
    id: `web-tts-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    text: context.text,
    lang: context.lang || '',
    startedAt: Date.now(),
    endedAt: 0,
    expiresAt: 0,
  };
  context.echoReference = reference;
  interpreterPlayback.activeEchoReference = reference;
  interpreterPlayback.echoReferences.push(reference);
  interpreterPlayback.echoReferences = interpreterPlayback.echoReferences
    .filter((item) => !item.endedAt || Date.now() - item.endedAt < 12000)
    .slice(-10);
  return reference;
}

function finishInterpreterEchoReference(reference) {
  if (!reference || reference.endedAt) return;
  reference.endedAt = Date.now();
  reference.expiresAt = reference.endedAt + 2200;
  if (interpreterPlayback.activeEchoReference === reference) {
    interpreterPlayback.activeEchoReference = null;
  }
}

function playInterpreterAudio(blob, text, context, runId) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = getInterpreterAudioPlayer();
    audio.src = url;
    interpreterPlayback.audio = audio;
    interpreterPlayback.url = url;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cancelAnimationFrame(interpreterPlayback.animationFrameId);
      interpreterPlayback.animationFrameId = 0;
      if (!error) updateInterpreterHighlight(text.length);
      finishInterpreterEchoReference(context.echoReference);
      if (interpreterPlayback.audio === audio) interpreterPlayback.audio = null;
      if (interpreterPlayback.url === url) interpreterPlayback.url = '';
      try { audio.removeAttribute('src'); } catch {}
      URL.revokeObjectURL(url);
      error ? reject(error) : resolve();
    };
    audio.onplay = () => {
      beginInterpreterEchoReference(context);
      setInterpreterPlaybackState(context.target?.closest('.interp-msg-bubble'), 'speaking');
    };
    audio.onloadedmetadata = () => {
      const tick = () => {
        if (runId !== interpreterPlayback.runId || settled) return finish();
        const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
        const progress = duration ? Math.max(0, Math.min(1, audio.currentTime / duration)) : 0;
        updateInterpreterHighlight(Math.floor(text.length * progress));
        interpreterPlayback.animationFrameId = requestAnimationFrame(tick);
      };
      tick();
    };
    audio.onended = () => finish();
    audio.onerror = () => finish(new Error('audio playback failed'));
    audio.play().catch(finish);
  });
}

function speakInterpreterBrowser(text, lang, context, runId) {
  return new Promise((resolve, reject) => {
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
      reject(new Error('browser speech unavailable'));
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = normalizeInterpreterSpeechLocale(lang);
    utterance.rate = 0.92;
    utterance.onboundary = (event) => {
      if (runId === interpreterPlayback.runId && Number.isFinite(event.charIndex)) {
        updateInterpreterHighlight(event.charIndex + Math.max(1, event.charLength || 1));
      }
    };
    utterance.onend = () => {
      finishInterpreterEchoReference(context.echoReference);
      updateInterpreterHighlight(text.length);
      resolve();
    };
    utterance.onerror = (event) => {
      finishInterpreterEchoReference(context.echoReference);
      if (event.error === 'canceled' || event.error === 'interrupted') resolve();
      else reject(new Error(`browser speech failed: ${event.error || 'unknown'}`));
    };
    setInterpreterPlaybackState(context.target?.closest('.interp-msg-bubble'), 'speaking');
    beginInterpreterEchoReference(context);
    window.speechSynthesis.speak(utterance);
  });
}

function normalizeInterpreterSpeechLocale(lang) {
  const value = String(lang || 'en').replace('_', '-').toLowerCase();
  const aliases = { zh: 'zh-CN', 'zh-cn': 'zh-CN', 'zh-hans': 'zh-CN', en: 'en-US', ja: 'ja-JP', ko: 'ko-KR', fr: 'fr-FR', de: 'de-DE', es: 'es-ES', ru: 'ru-RU' };
  return aliases[value] || (value.includes('-') ? value : `${value}-${value.toUpperCase()}`);
}

function beginInterpreterHighlight(context) {
  endInterpreterHighlight();
  if (!context.target || !context.target.isConnected) return;
  const fragment = document.createDocumentFragment();
  const tokens = [];
  const pattern = /\s+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|./gu;
  let match;
  while ((match = pattern.exec(context.text))) {
    if (/^\s+$/.test(match[0])) {
      fragment.append(document.createTextNode(match[0]));
      continue;
    }
    const token = document.createElement('span');
    token.className = 'interp-speech-word';
    token.textContent = match[0];
    token.dataset.start = String(match.index);
    token.dataset.end = String(match.index + match[0].length);
    tokens.push(token);
    fragment.append(token);
  }
  context.target.replaceChildren(fragment);
  interpreterPlayback.highlight = { text: context.text, target: context.target, tokens };
  updateInterpreterHighlight(0);
}

function updateInterpreterHighlight(characterIndex) {
  const highlight = interpreterPlayback.highlight;
  if (!highlight) return;
  highlight.tokens.forEach((token) => {
    const start = Number(token.dataset.start);
    const end = Number(token.dataset.end);
    token.classList.toggle('is-spoken', end <= characterIndex);
    token.classList.toggle('is-speaking', start <= characterIndex && characterIndex < end);
  });
}

function endInterpreterHighlight() {
  cancelAnimationFrame(interpreterPlayback.animationFrameId);
  interpreterPlayback.animationFrameId = 0;
  const highlight = interpreterPlayback.highlight;
  if (!highlight) return;
  if (highlight.target?.isConnected) highlight.target.textContent = highlight.text;
  interpreterPlayback.highlight = null;
}

function stopInterpreterTTS(options = {}) {
  interpreterPlayback.runId += options.increment === false ? 0 : 1;
  interpreterPlayback.audio?.pause?.();
  interpreterPlayback.audio?.removeAttribute?.('src');
  interpreterPlayback.audio = null;
  if (interpreterPlayback.url) {
    URL.revokeObjectURL(interpreterPlayback.url);
    interpreterPlayback.url = '';
  }
  window.speechSynthesis?.cancel();
  finishInterpreterEchoReference(interpreterPlayback.activeEchoReference);
  endInterpreterHighlight();
  if (!options.keepQueue) {
    interpreterState.ttsQueue?.splice(0).forEach((item) => item.resolve?.());
  }
}

window.stopInterpreter = async function stopInterpreter() {
  const wasActive = interpreterState.listening || interpreterState.starting;
  interpreterState.captureRequestId += 1;
  interpreterState.listening = false;
  interpreterState.starting = false;

  const active = interpreterState.activeUtterance;
  interpreterState.activeUtterance = null;
  if (active && !active.finalQueued) {
    if (active.fallback && interpreterState.fallbackRecorder?.state === 'recording') {
      const discardNoise = interpreterState.mode !== 'timed' && !active.speechConfirmed &&
        active.voicedMs < INTERP_MIN_VOICED_MS;
      interpreterState.fallbackPendingUtterance = discardNoise ? null : active;
      if (discardNoise) active.bubble?.remove();
      else active.sttController?.abort();
      interpreterState.fallbackRecorder.stop();
    } else if (active.sampleCount - active.overlapSamples >= INTERP_SAMPLE_RATE * 0.22) {
      finalizeUtterance(active, concatAudioFrames(active.frames));
    } else {
      active.bubble?.remove();
    }
  }

  await cleanupInterpreterCapture();
  updateInterpreterControls();
  updateInterpreterStatus();
  if (wasActive) updateLevelMeter(0);
};

async function cleanupInterpreterCapture() {
  clearInterval(interpreterState.timedChunkTimer);
  interpreterState.timedChunkTimer = null;
  if (interpreterState.animationFrameId) {
    cancelAnimationFrame(interpreterState.animationFrameId);
    interpreterState.animationFrameId = null;
  }
  if (interpreterState.vad) {
    const instance = interpreterState.vad;
    interpreterState.vad = null;
    await instance.destroy().catch((error) => console.warn('[同传] VAD 释放失败:', error));
  }
  interpreterState.vadReady = false;
  interpreterState.vadSpeaking = false;
  if (interpreterState.fallbackRecorder?.state === 'recording') {
    interpreterState.fallbackRecorder.stop();
  }
  interpreterState.fallbackRecorder = null;
  closeLiveRecognition();
  interpreterState.bingActive = false;
  closeBingRecognition();
  interpreterState.liveSocketFailed = false;
  interpreterState.stream?.getTracks().forEach((track) => track.stop());
  interpreterState.displayStream?.getTracks().forEach((track) => track.stop());
  interpreterState.stream = null;
  interpreterState.displayStream = null;
  if (interpreterState.pcmProcessor) interpreterState.pcmProcessor.onaudioprocess = null;
  interpreterState.pcmProcessor?.disconnect?.();
  interpreterState.pcmMuteGain?.disconnect?.();
  interpreterState.pcmProcessor = null;
  interpreterState.pcmMuteGain = null;
  if (interpreterState.bingPCMProcessor) interpreterState.bingPCMProcessor.onaudioprocess = null;
  interpreterState.bingPCMProcessor?.disconnect?.();
  interpreterState.bingMuteGain?.disconnect?.();
  interpreterState.bingPCMProcessor = null;
  interpreterState.bingMuteGain = null;
  if (interpreterState.audioContext && interpreterState.audioContext.state !== 'closed') {
    await interpreterState.audioContext.close().catch(() => {});
  }
  interpreterState.meterSource?.disconnect?.();
  interpreterState.meterSource = null;
  interpreterState.audioContext = null;
  interpreterState.analyser = null;
  interpreterState.preRollFrames = [];
  interpreterState.inputSilent = false;
  interpreterState.peakLevel = 0;
  interpreterState.lastSignalAt = 0;
  interpreterState.lastLevel = 0;
  interpreterState.fallbackCalibrationUntil = 0;
  interpreterState.captureMethod = 'microphone';
}

function updateInterpreterStatus(override = '') {
  const activity = document.getElementById('interpActivityText');
  const button = document.getElementById('interpMicGlobal');
  const buttonText = document.getElementById('interpGlobalStatus');
  const queue = document.getElementById('interpQueueStatus');
  const container = document.querySelector('.interpreter-container');

  let status = override;
  if (!status) {
    if (interpreterState.starting) status = '正在连接音频';
    else if (interpreterState.activeUtterance) status = '正在聆听';
    else if (interpreterState.finalWorkers || interpreterState.finalQueue.length) status = '正在校正';
    else if (interpreterState.activeRequests) status = '正在翻译';
    else if (interpreterState.listening && interpreterState.inputSilent) status = '未检测到音频输入';
    else if (interpreterState.listening) status = '等待语音';
    else status = '就绪';
  }
  if (activity) activity.textContent = status;

  const pending = interpreterState.finalWorkers + interpreterState.finalQueue.length;
  if (queue) queue.textContent = pending ? `· ${pending} 条处理中` : '';
  if (button) button.classList.toggle('recording', interpreterState.listening || interpreterState.starting);
  if (buttonText) {
    buttonText.textContent = interpreterState.starting
      ? '取消'
      : interpreterState.listening ? '停止实时翻译' : '开始实时翻译';
  }
  if (container) {
    container.dataset.liveState = interpreterState.inputSilent
      ? 'warning'
      : interpreterState.activeUtterance ? 'speech' : interpreterState.listening ? 'listening' : 'idle';
  }
}

function setInterpreterError(message) {
  const activity = document.getElementById('interpActivityText');
  if (activity) activity.textContent = message;
  document.querySelector('.interpreter-container')?.setAttribute('data-live-state', 'error');
  notifyInterpreter(message);
}

function describeCaptureError(error) {
  if (error.message === 'NoSystemAudio') {
    if (error.displaySurface === 'window') return '窗口没有音轨；请改选标签页，或启用系统“立体声混音”';
    if (error.displaySurface === 'monitor') return '整屏未共享系统音频；请开启系统音频或“立体声混音”';
    return '标签页未共享音频；请开启标签页音频或系统“立体声混音”';
  }
  if (error.message === 'NoDisplayCapture') return '当前浏览器不支持标签页音频，请使用最新版 Chrome 或 Edge';
  if (error.message === 'AudioCaptureTimeout') {
    return interpreterState.source === 'system'
      ? '等待共享超时，请重新选择标签页并共享音频'
      : '麦克风权限请求超时，请在地址栏允许麦克风';
  }
  if (error.name === 'NotAllowedError') {
    return interpreterState.source === 'system' ? '已取消标签页音频共享' : '麦克风权限未授权';
  }
  if (error.name === 'NotFoundError') return '未找到可用音频设备';
  if (error.message === 'NoAudioTrack' || error.message === 'AudioTrackEnded') return '浏览器未返回可用音轨';
  if (error.message === 'NoSupportedRecorder') return '当前浏览器不支持实时录音';
  if (error.message === 'NoAudioContext') return '当前浏览器不支持音频处理';
  if (error.message === 'AudioAnalysisUnavailable') return '浏览器无法分析音频，已停止以避免静音误识别；请使用最新版 Chrome 或 Edge';
  return '无法访问音频来源';
}

function notifyInterpreter(message) {
  if (typeof showToast === 'function') showToast(message);
  else console.info('[同传]', message);
}

function getMyLang() {
  return document.getElementById('interpMyLang')?.value || 'zh-CN';
}

function getTheirLang() {
  return document.getElementById('interpTheirLang')?.value || 'en';
}

function languageBase(code) {
  return String(code || '').split('-')[0].toLowerCase();
}

function updateInterpreterLabels() {}

window.exportInterpreterMessages = function exportInterpreterMessages() {
  if (!interpreterHistory.length) return null;
  return interpreterHistory
    .map((item) => `[${new Date(item.ts).toLocaleTimeString()}] ${item.who}\n${item.original}\n→ ${item.translated}\n`)
    .join('\n');
};
