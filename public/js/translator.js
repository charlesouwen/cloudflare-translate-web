/**
 * 翻译核心模块 — Google / Bing / Cloudflare AI
 * 自动降级 + 手动选择 + 翻译缓存
 */

const ENGINE_KEY = 'translate_engine';    // auto | google | bing | cloudflare
const TRANSLATE_CACHE = new Map();
const CACHE_MAX = 200;

function getEngine() {
  return localStorage.getItem(ENGINE_KEY) || 'auto';
}
function setEngine(engine) {
  localStorage.setItem(ENGINE_KEY, engine);
}

/**
 * 翻译文本
 * @param {string} text  - 要翻译的文本
 * @param {string} sl    - 源语言
 * @param {string} tl    - 目标语言
 * @param {{signal?: AbortSignal}} [options] - 可选的请求取消信号
 * @returns {Promise<{translatedText, detectedLanguage, alternatives, engine}>}
 */
async function translateText(text, sl, tl, options = {}) {
  if (!text || !text.trim()) return { translatedText: '', detectedLanguage: sl, alternatives: [], engine: '' };

  /* 检查缓存 */
  const cacheKey = `${sl}|${tl}|${text.trim()}`;
  if (TRANSLATE_CACHE.has(cacheKey)) {
    return TRANSLATE_CACHE.get(cacheKey);
  }

  const engine = getEngine();
  let result;

  if (engine === 'cloudflare') {
    result = await callCFAI(text, sl, tl, options.signal);
  } else if (engine === 'bing') {
    result = await callBing(text, sl, tl, options.signal);
  } else if (engine === 'google') {
    result = await callGoogle(text, sl, tl, options.signal);
  } else {
    /* auto: Worker handles Google -> Bing -> Cloudflare fallback. */
    try {
      result = await callDefault(text, sl, tl, options.signal);
    } catch (e) {
      if (options.signal?.aborted) throw e;
      console.warn('Translation API failed:', e);
      throw e;
    }
  }

  /* 写入缓存 */
  if (TRANSLATE_CACHE.size >= CACHE_MAX) {
    const firstKey = TRANSLATE_CACHE.keys().next().value;
    TRANSLATE_CACHE.delete(firstKey);
  }
  TRANSLATE_CACHE.set(cacheKey, result);

  return result;
}

/* Google 翻译 API */
async function callGoogle(text, sl, tl, signal) {
  const resp = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, sl, tl, provider: 'google' }),
    signal,
  });
  if (!resp.ok) throw new Error(`Google API error: ${resp.status}`);
  return await resp.json();
}

async function callBing(text, sl, tl, signal) {
  const resp = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, sl, tl, provider: 'bing' }),
    signal,
  });
  if (!resp.ok) throw new Error(`Bing API error: ${resp.status}`);
  return await resp.json();
}

async function callDefault(text, sl, tl, signal) {
  const resp = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, sl, tl }),
    signal,
  });
  if (!resp.ok) throw new Error(`Translation API error: ${resp.status}`);
  return await resp.json();
}

/* Cloudflare AI 翻译 */
async function callCFAI(text, sl, tl, signal) {
  const resp = await fetch('/api/translate/cf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, sl, tl }),
    signal,
  });
  if (!resp.ok) throw new Error(`CF AI error: ${resp.status}`);
  return await resp.json();
}

/* 语言检测 */
async function detectLanguage(text) {
  try {
    const resp = await fetch('/api/detect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!resp.ok) return 'en';
    const data = await resp.json();
    return data.language || 'en';
  } catch {
    return 'en';
  }
}

async function fetchLearningDetails(text, from, to, translation, options = {}) {
  const response = await fetch('/api/learn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, from, to, translation }),
    signal: options.signal,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Learning API error: ${response.status}`);
  }
  return response.json();
}
