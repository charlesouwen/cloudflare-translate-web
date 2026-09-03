/**
 * Speech output shared by the translator and the interpreter.
 *
 * Browser speech is preferred because Edge/Windows can expose Microsoft
 * Natural/Online voices. The Google endpoint remains a compatibility fallback
 * for browsers that do not expose a usable voice or block SpeechSynthesis.
 */

let ttsAudio = null;
let ttsQueue = [];
let ttsPlaying = false;
let ttsRunId = 0;
let ttsCurrentUtterance = null;
let ttsVoicesPromise = null;
let ttsVoicesCache = [];
let ttsVoicesWaited = false;
let ttsVoiceListenerInstalled = false;
let ttsProcessId = 0;

const TTS_MAX_QUEUE = 4;
const TTS_BROWSER_MAX_CHARS = 260;
const TTS_GOOGLE_MAX_CHARS = 180;
const TTS_VOICE_HINTS = [
  'natural', 'online', 'neural', 'enhanced', 'premium', 'wavenet',
  'microsoft', 'google', 'siri', 'eloquence',
];
const TTS_LOW_QUALITY_HINTS = [
  'espeak', 'festival', 'robot', 'synthetic', 'compact',
];

const TTS_LANG_DEFAULTS = {
  zh: 'zh-CN', 'zh-cn': 'zh-CN', 'zh-hans': 'zh-CN',
  'zh-tw': 'zh-TW', 'zh-hant': 'zh-TW',
  en: 'en-US', 'en-us': 'en-US', 'en-gb': 'en-GB',
  ja: 'ja-JP', ko: 'ko-KR', fr: 'fr-FR', de: 'de-DE', nl: 'nl-NL',
  es: 'es-ES', pt: 'pt-BR', 'pt-pt': 'pt-PT', it: 'it-IT', ru: 'ru-RU',
  id: 'id-ID', ms: 'ms-MY', tr: 'tr-TR', pl: 'pl-PL',
  ar: 'ar-SA', hi: 'hi-IN', th: 'th-TH', vi: 'vi-VN',
};

function normalizeTTSLang(lang) {
  const raw = String(lang || 'en').trim().toLowerCase().replace('_', '-');
  /* Keep unknown language codes intact; services commonly accept `fil` but
     reject an invented `fil-FIL` region. */
  return TTS_LANG_DEFAULTS[raw] || raw;
}

function languageBase(lang) {
  return normalizeTTSLang(lang).split('-')[0];
}

function splitSpeechText(text, maxLength) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  if (normalized.length <= maxLength) return [normalized];

  const chunks = [];
  let remaining = normalized;
  while (remaining.length > maxLength) {
    const candidate = remaining.slice(0, maxLength + 1);
    let cut = Math.max(
      candidate.lastIndexOf('。'), candidate.lastIndexOf('！'), candidate.lastIndexOf('？'),
      candidate.lastIndexOf('.'), candidate.lastIndexOf('!'), candidate.lastIndexOf('?'),
      candidate.lastIndexOf('；'), candidate.lastIndexOf(';'), candidate.lastIndexOf(','),
      candidate.lastIndexOf('，'), candidate.lastIndexOf(' '),
    );
    if (cut < Math.floor(maxLength * 0.45)) cut = maxLength;
    else if (cut < candidate.length && /[^\s]/.test(candidate[cut])) cut += 1;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks.filter(Boolean);
}

function loadTTSVoices() {
  if (!window.speechSynthesis) return Promise.resolve([]);
  if (!ttsVoiceListenerInstalled) {
    ttsVoiceListenerInstalled = true;
    window.speechSynthesis.addEventListener('voiceschanged', () => {
      ttsVoicesCache = window.speechSynthesis.getVoices();
    });
  }
  const existing = window.speechSynthesis.getVoices();
  if (existing.length) {
    ttsVoicesCache = existing;
    /* Prefer to wait briefly when Chromium has only exposed fallback voices
       and may still publish its Online/Natural voices asynchronously. */
    const hasOnlineVoice = existing.some((voice) => /natural|online|neural|enhanced/i.test(voice.name || ''));
    if (hasOnlineVoice || ttsVoicesWaited) return Promise.resolve(existing);
  } else if (ttsVoicesCache.length) {
    return Promise.resolve(ttsVoicesCache);
  }
  if (ttsVoicesPromise) return ttsVoicesPromise;

  ttsVoicesPromise = new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      ttsVoicesWaited = true;
      window.speechSynthesis.removeEventListener('voiceschanged', finish);
      ttsVoicesCache = window.speechSynthesis.getVoices();
      resolve(ttsVoicesCache);
    };
    window.speechSynthesis.addEventListener('voiceschanged', finish);
    /* Some Chromium builds never emit voiceschanged until a speech call. */
    setTimeout(finish, 420);
  }).finally(() => {
    ttsVoicesPromise = null;
  });
  return ttsVoicesPromise;
}

function scoreTTSVoice(voice, lang) {
  const wanted = normalizeTTSLang(lang).toLowerCase();
  const wantedBase = wanted.split('-')[0];
  const voiceLang = String(voice.lang || '').toLowerCase().replace(/_/g, '-');
  const voiceBase = voiceLang.split('-')[0];
  if (voiceBase !== wantedBase) return -10000;

  let score = voiceLang === wanted ? 140 : 90;
  const name = String(voice.name || '').toLowerCase();
  TTS_VOICE_HINTS.forEach((hint, index) => {
    if (name.includes(hint)) score += 18 - Math.min(index, 8);
  });
  TTS_LOW_QUALITY_HINTS.forEach((hint) => {
    if (name.includes(hint)) score -= 70;
  });
  if (name.includes('online (natural)')) score += 80;
  if (voice.localService === false) score += 20;
  if (voice.default) score += 2;
  return score;
}

function chooseTTSVoice(voices, lang) {
  return voices
    .map((voice) => ({ voice, score: scoreTTSVoice(voice, lang) }))
    .filter((item) => item.score > -1000)
    .sort((a, b) => b.score - a.score)[0]?.voice || null;
}

function cancelledTTSError() {
  const error = new Error('TTS cancelled');
  error.name = 'AbortError';
  return error;
}

function speakBrowserChunk(text, lang, runId, voice) {
  return new Promise((resolve, reject) => {
    if (runId !== ttsRunId) {
      reject(cancelledTTSError());
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    const base = languageBase(lang);
    utterance.lang = normalizeTTSLang(lang);
    utterance.voice = voice || null;
    /* A slightly slower rate makes online voices sound less clipped in TTS. */
    utterance.rate = base === 'zh' || base === 'ja' || base === 'ko' ? 0.96 : 0.98;
    utterance.pitch = 1;
    utterance.volume = 1;
    ttsCurrentUtterance = utterance;

    let keepAlive = null;
    const cleanup = () => {
      if (keepAlive) clearInterval(keepAlive);
      if (ttsCurrentUtterance === utterance) ttsCurrentUtterance = null;
      utterance.onend = null;
      utterance.onerror = null;
    };
    utterance.onend = () => {
      cleanup();
      resolve();
    };
    utterance.onerror = (event) => {
      cleanup();
      if (runId !== ttsRunId || event?.error === 'canceled' || event?.error === 'interrupted') {
        reject(cancelledTTSError());
      } else {
        reject(new Error(`SpeechSynthesis error: ${event?.error || 'unknown'}`));
      }
    };
    try {
      window.speechSynthesis.speak(utterance);
      /* Chromium can pause long utterances in a background tab. */
      keepAlive = setInterval(() => {
        if (runId === ttsRunId && window.speechSynthesis.paused) window.speechSynthesis.resume();
      }, 10000);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

async function speakWithBrowser(text, lang, runId) {
  const voices = await loadTTSVoices();
  const voice = chooseTTSVoice(voices, lang);
  if (!voice) throw new Error(`No browser voice for ${normalizeTTSLang(lang)}`);
  const chunks = splitSpeechText(text, TTS_BROWSER_MAX_CHARS);
  for (const chunk of chunks) {
    await speakBrowserChunk(chunk, lang, runId, voice);
  }
}

function speakWithGoogleTTS(text, lang, runId) {
  return new Promise((resolve, reject) => {
    const segments = splitSpeechText(text, TTS_GOOGLE_MAX_CHARS);
    let index = 0;
    let firstError = null;

    const playNext = () => {
      if (runId !== ttsRunId) {
        reject(cancelledTTSError());
        return;
      }
      if (index >= segments.length) {
        if (firstError && !segments.length) reject(firstError);
        else resolve();
        return;
      }
      const segment = segments[index++];
      const audio = new Audio(`/api/tts?q=${encodeURIComponent(segment)}&tl=${encodeURIComponent(normalizeTTSLang(lang))}`);
      audio.preload = 'auto';
      ttsAudio = audio;
      const advance = () => {
        if (ttsAudio === audio) ttsAudio = null;
        playNext();
      };
      audio.onended = advance;
      audio.onerror = () => {
        firstError ||= new Error('Google TTS audio failed');
        advance();
      };
      audio.play().catch((error) => {
        firstError ||= error;
        advance();
      });
    };
    playNext();
  });
}

async function speakNow(text, lang, runId, options = {}) {
  const provider = options.provider || localStorage.getItem('translate_tts_provider') || 'browser';
  if (provider !== 'google' && window.speechSynthesis) {
    try {
      await speakWithBrowser(text, lang, runId);
      return;
    } catch (error) {
      if (runId !== ttsRunId) return;
      console.warn('Browser natural voice unavailable; falling back to Google TTS:', error);
    }
  }
  await speakWithGoogleTTS(text, lang, runId);
}

/** Speak immediately, replacing the current utterance. */
async function speakText(text, lang, options = {}) {
  if (!String(text || '').trim()) return;
  stopSpeaking();
  const runId = ttsRunId;
  try {
    await speakNow(String(text).trim(), lang, runId, options);
  } catch (error) {
    if (error?.name !== 'AbortError') throw error;
  }
}

/** Queue interpreter output while bounding stale speech during fast input. */
function queueSpeak(text, lang, options = {}) {
  const normalizedText = String(text || '').trim();
  if (!normalizedText) return Promise.resolve();
  if (options.interrupt) return speakText(normalizedText, lang, options);

  const key = `${normalizeTTSLang(lang)}\u0000${normalizedText}`;
  if (options.dedupe && ttsQueue.some((item) => item.key === key)) return Promise.resolve();
  while (ttsQueue.length >= (options.maxQueue || TTS_MAX_QUEUE)) {
    const dropped = ttsQueue.shift();
    dropped?.resolve?.();
  }
  return new Promise((resolve, reject) => {
    ttsQueue.push({ text: normalizedText, lang, key, resolve, reject });
    if (!ttsPlaying) void processQueue();
  });
}

async function processQueue() {
  if (ttsPlaying) return;
  const processId = ++ttsProcessId;
  ttsPlaying = true;
  const runId = ttsRunId;
  try {
    while (ttsQueue.length && runId === ttsRunId) {
      const item = ttsQueue.shift();
      try {
        await speakNow(item.text, item.lang, runId, {});
        item.resolve?.();
      } catch (error) {
        item.reject?.(error);
      }
    }
  } finally {
    if (processId === ttsProcessId) ttsPlaying = false;
  }
}

function stopSpeaking() {
  ttsRunId += 1;
  ttsProcessId += 1;
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (ttsAudio) {
    ttsAudio.pause();
    ttsAudio.removeAttribute('src');
    ttsAudio = null;
  }
  ttsCurrentUtterance = null;
  ttsQueue.splice(0).forEach((item) => item.resolve?.());
  ttsPlaying = false;
}

function isTTSAvailable() {
  return Boolean(window.speechSynthesis) || true;
}

/* Explicit exports keep this module usable even when scripts are bundled. */
window.speakText = speakText;
window.queueSpeak = queueSpeak;
window.stopSpeaking = stopSpeaking;
window.isTTSAvailable = isTTSAvailable;
