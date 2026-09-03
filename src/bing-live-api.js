const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type"
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
  + "(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/151.0.0.0";
const BING_HOSTS = ["cn.bing.com", "www.bing.com", "bing.com"];
const CONFIG_CACHE_URL = "https://bing-live-interpreter.internal/bing-config-v2";
const MAX_JSON_BYTES = 64 * 1024;
const MAX_UPSTREAM_BYTES = 2 * 1024 * 1024;
const MAX_TTS_AUDIO_BYTES = 5 * 1024 * 1024;
const EDGE_TTS_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const EDGE_TTS_VERSION = "1-143.0.3650.75";
const EDGE_TTS_BASE = "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";

const SPEECH_LOCALES = {
  ar: "ar-EG", bg: "bg-BG", ca: "ca-ES", da: "da-DK", de: "de-DE",
  el: "el-GR", en: "en-US", es: "es-ES", et: "et-EE", fi: "fi-FI",
  fr: "fr-FR", "fr-CA": "fr-CA", ga: "ga-IE", gu: "gu-IN", hi: "hi-IN",
  hr: "hr-HR", it: "it-IT", ja: "ja-JP", ko: "ko-KR", lt: "lt-LT",
  lv: "lv-LV", mr: "mr-IN", mt: "mt-MT", nb: "nb-NO", nl: "nl-NL",
  pl: "pl-PL", pt: "pt-BR", "pt-PT": "pt-PT", ro: "ro-RO", ru: "ru-RU",
  sk: "sk-SK", sl: "sl-SI", sv: "sv-SE", ta: "ta-IN", te: "te-IN",
  th: "th-TH", tr: "tr-TR", yue: "zh-HK", "zh-Hans": "zh-CN",
  "zh-Hant": "zh-TW"
};

const BING_LANGUAGES = [
  ["auto-detect", "自动检测", "Auto-detect"], ["af", "南非荷兰语", "Afrikaans"],
  ["sq", "阿尔巴尼亚语", "Shqip"], ["am", "阿姆哈拉语", "አማርኛ"],
  ["ar", "阿拉伯语", "العربية"], ["hy", "亚美尼亚语", "Հայերեն"],
  ["as", "阿萨姆语", "অসমীয়া"], ["az", "阿塞拜疆语", "Azərbaycan"],
  ["bn", "孟加拉语", "বাংলা"], ["bs", "波斯尼亚语", "Bosanski"],
  ["bg", "保加利亚语", "Български"], ["ca", "加泰罗尼亚语", "Català"],
  ["zh-Hans", "中文 (简体)", "简体中文"], ["zh-Hant", "中文 (繁体)", "繁體中文"],
  ["hr", "克罗地亚语", "Hrvatski"], ["cs", "捷克语", "Čeština"],
  ["da", "丹麦语", "Dansk"], ["prs", "达里语", "دری"],
  ["nl", "荷兰语", "Nederlands"], ["en", "英语", "English"],
  ["et", "爱沙尼亚语", "Eesti"], ["fil", "菲律宾语", "Filipino"],
  ["fi", "芬兰语", "Suomi"], ["fr", "法语", "Français"],
  ["fr-CA", "法语 (加拿大)", "Français (Canada)"], ["de", "德语", "Deutsch"],
  ["el", "希腊语", "Ελληνικά"], ["gu", "古吉拉特语", "ગુજરાતી"],
  ["ht", "海地克里奥尔语", "Kreyòl Ayisyen"], ["he", "希伯来语", "עברית"],
  ["hi", "印地语", "हिन्दी"], ["hu", "匈牙利语", "Magyar"],
  ["is", "冰岛语", "Íslenska"], ["id", "印度尼西亚语", "Indonesia"],
  ["ga", "爱尔兰语", "Gaeilge"], ["it", "意大利语", "Italiano"],
  ["ja", "日语", "日本語"], ["kn", "卡纳达语", "ಕನ್ನಡ"],
  ["kk", "哈萨克语", "Қазақ"], ["km", "高棉语", "ខ្មែរ"],
  ["ko", "韩语", "한국어"], ["lo", "老挝语", "ລາວ"],
  ["lv", "拉脱维亚语", "Latviešu"], ["lt", "立陶宛语", "Lietuvių"],
  ["mk", "马其顿语", "Македонски"], ["ms", "马来语", "Melayu"],
  ["ml", "马拉雅拉姆语", "മലയാളം"], ["mt", "马耳他语", "Malti"],
  ["mr", "马拉地语", "मराठी"], ["my", "缅甸语", "ဗမာ"],
  ["mi", "毛利语", "Te Reo Māori"], ["ne", "尼泊尔语", "नेपाली"],
  ["nb", "挪威语", "Norsk"], ["fa", "波斯语", "فارسی"],
  ["pl", "波兰语", "Polski"], ["pt", "葡萄牙语 (巴西)", "Português (Brasil)"],
  ["pt-PT", "葡萄牙语 (葡萄牙)", "Português (Portugal)"],
  ["pa", "旁遮普语", "ਪੰਜਾਬੀ"], ["ro", "罗马尼亚语", "Română"],
  ["ru", "俄语", "Русский"], ["sr-Cyrl", "塞尔维亚语 (西里尔)", "Српски"],
  ["sr-Latn", "塞尔维亚语 (拉丁)", "Srpski"], ["sk", "斯洛伐克语", "Slovenčina"],
  ["sl", "斯洛文尼亚语", "Slovenščina"], ["es", "西班牙语", "Español"],
  ["sw", "斯瓦希里语", "Kiswahili"], ["sv", "瑞典语", "Svenska"],
  ["ta", "泰米尔语", "தமிழ்"], ["te", "泰卢固语", "తెలుగు"],
  ["th", "泰语", "ไทย"], ["tr", "土耳其语", "Türkçe"],
  ["uk", "乌克兰语", "Українська"], ["ur", "乌尔都语", "اردو"],
  ["vi", "越南语", "Tiếng Việt"], ["cy", "威尔士语", "Cymraeg"],
  ["yua", "尤卡坦玛雅语", "Màaya T'àan"], ["yue", "粤语", "粵語"]
].map(([code, name, nativeName]) => ({
  code,
  name,
  nativeName,
  speechLocale: SPEECH_LOCALES[code] || ""
}));

const BING_VOICES = [
  ["zh-Hans", "zh-CN", "Female", "zh-CN-XiaoxiaoNeural", "晓晓 · 中文女声"],
  ["zh-Hans", "zh-CN", "Male", "zh-CN-YunxiNeural", "云希 · 中文男声"],
  ["zh-Hans", "zh-CN", "Female", "zh-CN-XiaoyiNeural", "晓伊 · 中文女声"],
  ["zh-Hant", "zh-TW", "Female", "zh-TW-HsiaoChenNeural", "曉臻 · 台湾女声"],
  ["yue", "zh-HK", "Female", "zh-HK-HiuGaaiNeural", "曉佳 · 粤语女声"],
  ["en", "en-US", "Female", "en-US-AriaNeural", "Aria · English US Female"],
  ["en", "en-US", "Female", "en-US-JennyNeural", "Jenny · English US Female"],
  ["en", "en-US", "Male", "en-US-GuyNeural", "Guy · English US Male"],
  ["en", "en-GB", "Female", "en-GB-SoniaNeural", "Sonia · English UK Female"],
  ["ja", "ja-JP", "Female", "ja-JP-NanamiNeural", "Nanami · 日本語女声"],
  ["ja", "ja-JP", "Male", "ja-JP-KeitaNeural", "Keita · 日本語男声"],
  ["ko", "ko-KR", "Female", "ko-KR-SunHiNeural", "SunHi · 한국어 여성"],
  ["ko", "ko-KR", "Male", "ko-KR-InJoonNeural", "InJoon · 한국어 남성"],
  ["fr", "fr-FR", "Female", "fr-FR-DeniseNeural", "Denise · Français"],
  ["de", "de-DE", "Female", "de-DE-KatjaNeural", "Katja · Deutsch"],
  ["es", "es-ES", "Female", "es-ES-ElviraNeural", "Elvira · Español"],
  ["ru", "ru-RU", "Female", "ru-RU-DariyaNeural", "Dariya · Русский"],
  ["pt", "pt-BR", "Female", "pt-BR-FranciscaNeural", "Francisca · Português"],
  ["it", "it-IT", "Male", "it-IT-DiegoNeural", "Diego · Italiano"],
  ["ar", "ar-SA", "Male", "ar-SA-HamedNeural", "Hamed · العربية"],
  ["th", "th-TH", "Male", "th-TH-NiwatNeural", "Niwat · ไทย"],
  ["vi", "vi-VN", "Male", "vi-VN-NamMinhNeural", "NamMinh · Tiếng Việt"]
].map(([targetLang, locale, gender, voiceName, label]) => ({
  targetLang, locale, gender, voiceName, label
}));

const PHRASE_CATEGORIES = [
  {
    id: "popular", name: "热门", phrases: [
      "Hello", "Thank you", "Good morning", "How are you?",
      "Nice to meet you", "You're welcome", "Goodbye", "Good night"
    ]
  },
  {
    id: "basics", name: "基础", phrases: [
      "Yes", "No", "Please", "Excuse me", "I don't understand",
      "Could you repeat that?", "Please speak more slowly", "What does this mean?"
    ]
  },
  {
    id: "social", name: "社交", phrases: [
      "What is your name?", "My name is...", "Where are you from?", "I'm from...",
      "How have you been?", "See you later", "Have a nice day", "Congratulations!"
    ]
  },
  {
    id: "travel", name: "旅行", phrases: [
      "Where is the station?", "How much is the ticket?", "I need a taxi",
      "Please take me to this address", "What time does it leave?", "Where is my hotel?",
      "Is this seat available?", "I am lost"
    ]
  },
  {
    id: "dining", name: "餐饮", phrases: [
      "A table for two, please", "May I see the menu?", "What do you recommend?",
      "I am vegetarian", "No spicy food, please", "Could I have some water?",
      "The bill, please", "This is delicious"
    ]
  },
  {
    id: "emergency", name: "紧急", phrases: [
      "Help!", "Call the police", "I need a doctor", "Where is the hospital?",
      "I lost my passport", "There has been an accident", "I am allergic to...",
      "Please call an ambulance"
    ]
  },
  {
    id: "numbers", name: "日期与数字", phrases: [
      "What time is it?", "What is today's date?", "How much does this cost?",
      "One more, please", "Yesterday", "Tomorrow", "Next week", "At three o'clock"
    ]
  },
  {
    id: "technology", name: "科技", phrases: [
      "What is the Wi-Fi password?", "Is there free Wi-Fi?", "My phone is not working",
      "I need a charger", "Can you send me the link?", "Please scan this QR code",
      "The connection is slow", "Could you email it to me?"
    ]
  }
];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/health" && request.method === "GET") {
        return json({
          ok: true,
          service: "bing-live-interpreter",
          authMode: "bing-web-no-paid-key",
          features: ["translate", "tone", "speech", "tts", "voices", "dictionary", "phrasebook"]
        });
      }

      if (url.pathname === "/api/languages" && request.method === "GET") {
        return json({ languages: BING_LANGUAGES });
      }

      if (url.pathname === "/api/voices" && request.method === "GET") {
        const lang = normalizeLang(url.searchParams.get("lang") || "");
        const voices = lang ? BING_VOICES.filter((voice) => voice.targetLang === lang) : BING_VOICES;
        return json({ voices });
      }

      if (url.pathname === "/api/speech-config" && request.method === "GET") {
        return await handleSpeechConfig(request);
      }

      if (url.pathname === "/api/translate" && request.method === "POST") {
        return await handleTranslate(request);
      }

      if (url.pathname === "/api/tts" && request.method === "POST") {
        return await handleTts(request);
      }

      if (url.pathname === "/api/dictionary" && request.method === "POST") {
        return await handleDictionary(request);
      }

      if (url.pathname === "/api/examples" && request.method === "POST") {
        return await handleExamples(request);
      }

      if (url.pathname === "/api/correct" && request.method === "POST") {
        return await handleCorrect(request);
      }

      if (url.pathname === "/api/phrasebook" && request.method === "POST") {
        return await handlePhrasebook(request);
      }

      if (url.pathname.startsWith("/api/")) {
        return json({ error: "API endpoint not found" }, 404);
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status >= 500) {
        console.error(JSON.stringify({ event: "request_error", path: url.pathname, message: error.message }));
      }
      return json({ error: error.message || "Internal Server Error" }, status);
    }
  }
};

async function handleSpeechConfig(request) {
  const config = await getBingConfig();
  return json({
    available: true,
    endpoint: "wss://sr.bing.com/opaluqu/speech/recognition/interactive/cognitiveservices/v1",
    clientBuild: "TranslateThisDesktop",
    form: "QBRE",
    uquRequestId: config.IG,
    subscriptionKey: "key",
    authQueryName: "Ocp-Apim-Subscription-Key",
    referer: `https://${config.host}/translator/`,
    protocol: {
      sampleRate: 16000,
      bitsPerSample: 16,
      channels: 1,
      format: "simple"
    }
  });
}

async function handleTranslate(request) {
  const body = await readJson(request);
  const text = cleanText(body.text);
  const from = normalizeLang(body.from || "auto-detect");
  const to = normalizeLang(body.to || "en");
  const tone = normalizeTone(body.tone);
  const isVoice = Boolean(body.isVoice);

  if (!text) throw new HttpError(400, "text is required");
  if (text.length > 5000) throw new HttpError(413, "text is too long; max 5000 characters");
  if (to === "auto-detect") throw new HttpError(400, "target language cannot be auto-detect");

  let config = await getBingConfig();
  let upstream = await requestBingTranslation(config, { text, from, to, tone, isVoice });

  if (upstream.response.status === 401 || upstream.response.status === 429) {
    config = await getBingConfig(true);
    upstream = await requestBingTranslation(config, { text, from, to, tone, isVoice });
  }

  if ((upstream.response.status === 401 || upstream.response.status === 429) && text.length <= 3000) {
    upstream = await requestBingTranslation(config, { text, from, to, tone, isVoice }, true);
  }

  let invalidBingResponse = false;
  if (upstream.response.ok) {
    let raw;
    try {
      raw = JSON.parse(upstream.text);
    } catch {
      invalidBingResponse = true;
    }

    if (raw) {
      const first = raw[0] || {};
      const translation = first.translations?.[0] || {};
      return json({
        engine: upstream.engine,
        text,
        translation: translation.text || "",
        detectedLanguage: first.detectedLanguage?.language || from,
        to: translation.to || to,
        usedLLM: Boolean(first.usedLLM),
        toneRequested: tone || "Standard",
        toneApplied: Boolean(tone),
        inputTransliteration: raw[1]?.inputTransliteration || "",
        outputTransliteration: raw[1]?.translations?.[0]?.text || ""
      });
    }
  }

  const fallback = await edgeTranslateBatch([text], from, to);
  return json({
    engine: "edge-noauth",
    text,
    translation: fallback.translations[0] || "",
    detectedLanguage: fallback.detectedLanguages[0] || from,
    to,
    usedLLM: false,
    toneRequested: tone || "Standard",
    toneApplied: false,
    inputTransliteration: "",
    outputTransliteration: "",
    bingFallbackReason: invalidBingResponse
      ? "bing-web-non-json"
      : `bing-web-http-${upstream.response.status}`
  });
}

async function requestBingTranslation(config, payload, useEpt = false, host = config.host) {
  const params = new URLSearchParams({
    isVertical: "1",
    IG: config.IG,
    IID: config.IID,
    SFX: String(randomInt(1, 9999))
  });
  if (useEpt) {
    params.set("ref", "TThis");
    params.set("edgepdftranslator", "1");
  }
  const form = new URLSearchParams({
    fromLang: payload.from,
    to: payload.to,
    text: payload.text,
    token: config.token,
    key: String(config.key),
    tryFetchingGenderDebiasedTranslations: "true"
  });
  if (payload.tone) form.set("tone", payload.tone);
  if (payload.isVoice) form.set("isVoice", "1");

  const response = await fetch(`https://${host}/ttranslatev3?${params}`, {
    method: "POST",
    headers: bingHeaders(host),
    body: form
  });
  const text = await readResponseText(response, MAX_UPSTREAM_BYTES);
  return { response, text, engine: useEpt ? "bing-web-ept" : "bing-web" };
}

async function handleTts(request) {
  const body = await readJson(request);
  const text = cleanText(body.text);
  const lang = normalizeLang(body.lang || body.to || "en");
  const voice = resolveVoice(lang, body.voiceName);
  const rate = normalizeTtsRate(body.rate);

  if (!text) throw new HttpError(400, "text is required");
  if (text.length > 1500) throw new HttpError(413, "text is too long; max 1500 characters");

  let config = await getBingConfig();
  let response = await requestBingTts(config, { text, voice, rate });
  if (response.status === 401 || response.status === 429) {
    await response.body?.cancel();
    config = await getBingConfig(true);
    response = await requestBingTts(config, { text, voice, rate });
  }

  if (!response.ok) {
    await response.body?.cancel();
    try {
      const audio = await requestEdgeReadAloudTts({ text, voice, rate });
      return new Response(audio, {
        headers: {
          ...CORS_HEADERS,
          "content-type": "audio/mpeg",
          "cache-control": "no-store",
          "x-tts-engine": "edge-readaloud",
          "x-bing-voice": voice.voiceName,
          "x-bing-locale": voice.locale
        }
      });
    } catch (error) {
      console.warn(JSON.stringify({ event: "edge_tts_fallback_error", message: error.message }));
      return json({
        error: "Bing and Edge server-side TTS are unavailable; use browser speech synthesis",
        useBrowserFallback: true,
        status: response.status,
        voiceName: voice.voiceName
      }, 503);
    }
  }

  return new Response(response.body, {
    headers: {
      ...CORS_HEADERS,
      "content-type": response.headers.get("content-type") || "audio/mpeg",
      "cache-control": "no-store",
      "x-tts-engine": "bing-translator",
      "x-bing-voice": voice.voiceName,
      "x-bing-locale": voice.locale
    }
  });
}

function requestBingTts(config, { text, voice, rate }) {
  const params = new URLSearchParams({
    isVertical: "1",
    IG: config.IG,
    IID: config.IID,
    SFX: String(randomInt(1, 9999))
  });
  const ssml = `<speak version='1.0' xml:lang='${voice.locale}'>`
    + `<voice xml:lang='${voice.locale}' xml:gender='${voice.gender}' name='${voice.voiceName}'>`
    + `<prosody rate='${rate}'>${escapeSsml(text)}</prosody></voice></speak>`;
  const form = new URLSearchParams({
    ssml,
    token: config.token,
    key: String(config.key)
  });

  return fetch(`https://${config.host}/tfettts?${params}`, {
    method: "POST",
    headers: bingHeaders(config.host),
    body: form
  });
}

async function requestEdgeReadAloudTts({ text, voice, rate }) {
  const connectionId = compactUuid().toLowerCase();
  const gec = await generateEdgeGec();
  const url = new URL(EDGE_TTS_BASE);
  url.searchParams.set("TrustedClientToken", EDGE_TTS_TOKEN);
  url.searchParams.set("ConnectionId", connectionId);
  url.searchParams.set("Sec-MS-GEC", gec);
  url.searchParams.set("Sec-MS-GEC-Version", EDGE_TTS_VERSION);

  const response = await fetch(url, {
    headers: {
      Upgrade: "websocket",
      "user-agent": USER_AGENT,
      pragma: "no-cache",
      "cache-control": "no-cache",
      origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
      "sec-websocket-version": "13",
      cookie: `muid=${compactUuid()};`
    }
  });
  const socket = response.webSocket;
  if (!socket) {
    await response.body?.cancel();
    throw new Error(`Edge Read Aloud WebSocket upgrade failed with HTTP ${response.status}`);
  }

  socket.binaryType = "arraybuffer";
  socket.accept();
  const timestamp = edgeTimestamp();
  const speechConfig = [
    `X-Timestamp:${timestamp}`,
    "Content-Type:application/json; charset=utf-8",
    "Path:speech.config",
    "",
    JSON.stringify({
      context: {
        synthesis: {
          audio: {
            metadataoptions: { sentenceBoundaryEnabled: "true", wordBoundaryEnabled: "false" },
            outputFormat: "audio-24khz-48kbitrate-mono-mp3"
          }
        }
      }
    }) + "\r\n"
  ].join("\r\n");
  const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${voice.locale}'>`
    + `<voice name='${voice.voiceName}'><prosody pitch='+0Hz' rate='${rate}' volume='+0%'>`
    + `${escapeSsml(text)}</prosody></voice></speak>`;
  const ssmlRequest = [
    `X-RequestId:${compactUuid().toLowerCase()}`,
    "Content-Type:application/ssml+xml",
    `X-Timestamp:${timestamp}Z`,
    "Path:ssml",
    "",
    ssml
  ].join("\r\n");

  return new Promise((resolve, reject) => {
    const chunks = [];
    const diagnostics = [];
    let totalBytes = 0;
    let settled = false;
    const timeout = setTimeout(() => finish(new Error("Edge Read Aloud timed out")), 25000);

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { socket.close(1000, error ? "failed" : "complete"); } catch {}
      if (error) {
        reject(error);
        return;
      }
      if (!totalBytes) {
        reject(new Error(`Edge Read Aloud returned no audio (${diagnostics.join(" | ") || "no messages"})`));
        return;
      }
      const output = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
      }
      resolve(output);
    };

    let messageChain = Promise.resolve();
    socket.addEventListener("message", (event) => {
      messageChain = messageChain.then(async () => {
      if (typeof event.data === "string") {
        const path = event.data.match(/^Path:\s*([^\r\n]+)/im)?.[1] || "text";
        diagnostics.push(path);
        if (path === "turn.end") finish();
        return;
      }

      let bytes;
      if (event.data instanceof ArrayBuffer) {
        bytes = new Uint8Array(event.data);
      } else if (event.data instanceof Blob) {
        bytes = new Uint8Array(await event.data.arrayBuffer());
      } else if (ArrayBuffer.isView(event.data)) {
        bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
      } else {
        diagnostics.push(`unknown-binary-${typeof event.data}`);
        return;
      }
      if (bytes.byteLength < 2) return;
      const headerLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(0, false);
      const payloadOffset = 2 + headerLength;
      if (payloadOffset > bytes.byteLength) return;
      const headerText = new TextDecoder().decode(bytes.subarray(2, payloadOffset));
      diagnostics.push(headerText.match(/^Path:\s*([^\r\n]+)/im)?.[1] || "binary");
      if (!/^Path:\s*audio\s*$/im.test(headerText)) return;
      const payload = bytes.slice(payloadOffset);
      if (!payload.byteLength) return;
      totalBytes += payload.byteLength;
      if (totalBytes > MAX_TTS_AUDIO_BYTES) {
        finish(new Error("Edge Read Aloud audio exceeds the supported size"));
        return;
      }
      chunks.push(payload);
      }).catch((error) => finish(error));
    });
    socket.addEventListener("error", () => finish(new Error("Edge Read Aloud WebSocket error")));
    socket.addEventListener("close", () => {
      if (!settled) finish(totalBytes ? undefined : new Error("Edge Read Aloud closed without audio"));
    });

    socket.send(speechConfig);
    socket.send(ssmlRequest);
  });
}

async function generateEdgeGec() {
  const windowsEpochSeconds = 11644473600;
  const seconds = Math.floor((Date.now() / 1000 + windowsEpochSeconds) / 300) * 300;
  const ticks = (seconds * 10000000).toFixed(0);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(ticks + EDGE_TTS_TOKEN)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function edgeTimestamp() {
  const date = new Date();
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[date.getUTCDay()]} ${months[date.getUTCMonth()]} ${String(date.getUTCDate()).padStart(2, "0")} `
    + `${date.getUTCFullYear()} ${String(date.getUTCHours()).padStart(2, "0")}:`
    + `${String(date.getUTCMinutes()).padStart(2, "0")}:${String(date.getUTCSeconds()).padStart(2, "0")} `
    + "GMT+0000 (Coordinated Universal Time)";
}

async function handlePhrasebook(request) {
  const body = await readJson(request);
  const from = normalizeLang(body.from || "en");
  const to = normalizeLang(body.to || "zh-Hans");
  const requestedCategory = String(body.categoryID || "popular");
  const category = PHRASE_CATEGORIES.find((item) => item.id === requestedCategory) || PHRASE_CATEGORIES[0];

  if (from === "auto-detect" || to === "auto-detect") {
    throw new HttpError(400, "phrasebook requires explicit source and target languages");
  }
  if (from === to) throw new HttpError(400, "source and target languages must differ");

  const cacheUrl = new URL("https://bing-live-interpreter.internal/phrasebook-v2");
  cacheUrl.searchParams.set("from", from);
  cacheUrl.searchParams.set("to", to);
  cacheUrl.searchParams.set("category", category.id);
  const cacheKey = new Request(cacheUrl.toString());
  const cached = await caches.default.match(cacheKey);
  if (cached) return withCors(cached);

  const [sourceResult, targetResult] = await Promise.all([
    from === "en" ? Promise.resolve({ translations: category.phrases }) : edgeTranslateBatch(category.phrases, "en", from),
    to === "en" ? Promise.resolve({ translations: category.phrases }) : edgeTranslateBatch(category.phrases, "en", to)
  ]);
  const phrases = category.phrases.map((english, index) => ({
    id: `${category.id}-${index + 1}`,
    english,
    source: sourceResult.translations[index] || english,
    target: targetResult.translations[index] || english
  }));
  const payload = {
    categories: PHRASE_CATEGORIES.map(({ id, name }) => ({ id, name })),
    activeCategory: category.id,
    phrases,
    from,
    to,
    engine: "edge-noauth-batch"
  };
  const response = json(payload, 200, { "cache-control": "public, max-age=86400" });
  await caches.default.put(cacheKey, response.clone());
  return response;
}

async function handleDictionary(request) {
  const body = await readJson(request);
  const text = cleanText(body.text);
  const from = normalizeLang(body.from || "auto-detect");
  const to = normalizeLang(body.to || "en");
  if (!text || text.length > 200 || from === "auto-detect" || from === to) {
    return json({ translations: [] });
  }

  const { response, text: upstreamText } = await requestBingJsonEndpoint("tlookupv3", {
    from, to, text
  });
  if (!response.ok) return json({ translations: [] });
  try {
    const raw = JSON.parse(upstreamText);
    return json({ translations: raw });
  } catch {
    return json({ translations: [] });
  }
}

async function handleExamples(request) {
  const body = await readJson(request);
  const text = cleanText(body.text);
  const translation = cleanText(body.translation);
  const from = normalizeLang(body.from || "auto-detect");
  const to = normalizeLang(body.to || "en");
  if (!text || !translation || from === "auto-detect") return json({ examples: [] });

  const { response, text: upstreamText } = await requestBingJsonEndpoint("texamplev3", {
    from, to, text, translation
  });
  if (!response.ok) return json({ examples: [] });
  try {
    return json({ examples: JSON.parse(upstreamText) });
  } catch {
    return json({ examples: [] });
  }
}

async function handleCorrect(request) {
  const body = await readJson(request);
  const text = cleanText(body.text);
  const fromLang = normalizeLang(body.lang || body.from || "auto-detect");
  if (!text || text.length > 80 || fromLang === "auto-detect") {
    return json({ correctedText: text, changed: false });
  }

  const { response, text: upstreamText } = await requestBingJsonEndpoint("tspellcheckv3", {
    fromLang, text
  });
  if (!response.ok) return json({ correctedText: text, changed: false });
  try {
    const raw = JSON.parse(upstreamText);
    const correctedText = raw?.correctedText || text;
    return json({ correctedText, changed: correctedText !== text });
  } catch {
    return json({ correctedText: text, changed: false });
  }
}

async function requestBingJsonEndpoint(path, formValues) {
  let config = await getBingConfig();
  let result = await performBingJsonRequest(config, path, formValues);
  if (result.response.status === 401 || result.response.status === 429) {
    config = await getBingConfig(true);
    result = await performBingJsonRequest(config, path, formValues);
  }
  return result;
}

async function performBingJsonRequest(config, path, formValues) {
  const params = new URLSearchParams({
    isVertical: "1",
    IG: config.IG,
    IID: config.IID,
    SFX: String(randomInt(1, 9999))
  });
  const form = new URLSearchParams({
    ...Object.fromEntries(Object.entries(formValues).map(([key, value]) => [key, String(value)])),
    token: config.token,
    key: String(config.key)
  });
  const response = await fetch(`https://${config.host}/${path}?${params}`, {
    method: "POST",
    headers: bingHeaders(config.host),
    body: form
  });
  const text = await readResponseText(response, MAX_UPSTREAM_BYTES);
  return { response, text };
}

async function edgeTranslateBatch(texts, from, to) {
  const params = new URLSearchParams({
    from: from && from !== "auto-detect" ? from : "",
    to,
    isEnterpriseClient: "false"
  });
  const response = await fetch(`https://edge.microsoft.com/translate/translatetext?${params}`, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      "user-agent": USER_AGENT
    },
    body: JSON.stringify(texts)
  });
  const rawText = await readResponseText(response, MAX_UPSTREAM_BYTES);
  if (!response.ok) throw new HttpError(502, `No-key translation fallback failed with HTTP ${response.status}`);

  let raw;
  try {
    raw = JSON.parse(rawText);
  } catch {
    throw new HttpError(502, "No-key translation fallback returned non-JSON data");
  }
  return {
    translations: raw.map((item) => item.translations?.[0]?.text || ""),
    detectedLanguages: raw.map((item) => item.detectedLanguage?.language || "")
  };
}

async function getBingConfig(forceRefresh = false) {
  const cacheKey = new Request(CONFIG_CACHE_URL);
  if (forceRefresh) await caches.default.delete(cacheKey);

  if (!forceRefresh) {
    const cached = await caches.default.match(cacheKey);
    if (cached) return cached.json();
  }

  const config = await fetchBingConfig();
  await caches.default.put(cacheKey, new Response(JSON.stringify(config), {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=300" }
  }));
  return config;
}

async function fetchBingConfig() {
  let lastError;
  for (const host of BING_HOSTS) {
    try {
      const response = await fetch(`https://${host}/translator`, {
        headers: { "user-agent": USER_AGENT },
        redirect: "follow"
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await readResponseText(response, MAX_UPSTREAM_BYTES);
      const parsed = JSON.parse(matchRequired(
        html,
        /params_AbusePreventionHelper\s*=\s*(\[[^\]]+\])/,
        "params_AbusePreventionHelper"
      ));
      if (!Array.isArray(parsed) || parsed.length < 3) throw new Error("unexpected token shape");
      return {
        host: new URL(response.url || `https://${host}/translator`).host,
        IG: matchRequired(html, /IG:"([^"]+)"/, "IG"),
        IID: matchRequired(html, /data-iid="([^"]+)"/, "IID"),
        key: parsed[0],
        token: parsed[1],
        tokenExpiryInterval: Number(parsed[2]) || 600000
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw new HttpError(502, `failed to fetch Bing translator configuration: ${lastError?.message || "unknown error"}`);
}

async function readJson(request) {
  const text = await readStreamText(request.body, MAX_JSON_BYTES);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "request body must be valid JSON");
  }
}

async function readResponseText(response, maxBytes) {
  return readStreamText(response.body, maxBytes);
}

async function readStreamText(stream, maxBytes) {
  if (!stream) return "";
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let output = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new HttpError(413, "payload exceeds the supported size");
      output += decoder.decode(value, { stream: true });
    }
    output += decoder.decode();
    return output;
  } finally {
    reader.releaseLock();
  }
}

function bingHeaders(host) {
  return {
    "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    "user-agent": USER_AGENT,
    "referer": `https://${host}/translator`
  };
}

function matchRequired(text, pattern, name) {
  const match = text.match(pattern);
  if (!match) throw new Error(`missing ${name}`);
  return match[1];
}

function normalizeLang(lang) {
  const value = String(lang || "").trim();
  const aliases = {
    "": "auto-detect", auto: "auto-detect", zh: "zh-Hans", "zh-CN": "zh-Hans",
    "zh-SG": "zh-Hans", "zh-TW": "zh-Hant", "zh-HK": "zh-Hant",
    "en-US": "en", "en-GB": "en", "ja-JP": "ja", "ko-KR": "ko",
    "fr-FR": "fr", "de-DE": "de", "es-ES": "es", "ru-RU": "ru",
    "pt-BR": "pt", "it-IT": "it"
  };
  return aliases[value] || value;
}

function normalizeTone(value) {
  const tone = String(value || "");
  if (!tone || tone === "Standard") return "";
  if (tone === "Casual" || tone === "Formal") return tone;
  throw new HttpError(400, "tone must be Standard, Casual, or Formal");
}

function resolveVoice(lang, requestedVoiceName) {
  const requested = String(requestedVoiceName || "").trim();
  const requestedMatch = BING_VOICES.find((voice) => voice.voiceName === requested && voice.targetLang === lang);
  return requestedMatch
    || BING_VOICES.find((voice) => voice.targetLang === lang)
    || BING_VOICES.find((voice) => voice.targetLang === "en");
}

function normalizeTtsRate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-20%";
  const percent = Math.max(-50, Math.min(80, Math.round((numeric - 1) * 100)));
  return `${percent}%`;
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeSsml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function randomInt(min, max) {
  const data = new Uint32Array(1);
  crypto.getRandomValues(data);
  return min + (data[0] % (max - min + 1));
}

function compactUuid() {
  return crypto.randomUUID().replace(/-/g, "").toUpperCase();
}

function withCors(response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders
    }
  });
}
