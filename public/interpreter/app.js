import {
  appendSpeechSegment,
  chooseRecognitionCandidate,
  createRecognitionCandidate,
  chooseCrossScriptCandidate,
  estimateSpeechCommitDelay,
  mergeSpeechHypothesis,
  recognitionCandidateScore,
  safeSpeechCorrection,
  speechScriptCompatibility,
  speechSentenceNaturalness,
  speechTextSimilarity,
  speechTranslationQuality
} from "./speech-quality.js?v=16";

const els = Object.fromEntries([
  "ariaLive", "engineState", "sourceLang", "targetLang", "swapLangs", "sourceText",
  "targetText", "charCount", "sourceTransliteration", "targetTransliteration", "clearText",
  "listenButton", "speakSource", "speakTarget", "copyTarget", "voiceSelect", "toneControl",
  "autoSpeak", "translationMeta", "statusBar", "errorBar", "dictionarySection",
  "dictionaryResults", "phraseSection", "phraseTabs", "phraseGrid", "phraseEngine",
  "workMode", "speakerControl", "speakerMode", "sourceLangLabel", "targetLangLabel",
  "sourcePanelLabel", "targetPanelLabel", "conversationSection", "conversationLog",
  "conversationEmpty", "clearConversation", "segmentDelay", "pipelineState", "micState",
  "micMeterFill", "liveSpeakerState", "semanticState", "playbackState",
  "listenButtonText", "conversationCount"
].map((id) => [id, document.getElementById(id)]));

const state = {
  languages: [],
  voices: [],
  tone: "Standard",
  workMode: "two-way",
  speakerMode: "auto",
  detectedLanguage: "",
  translationTimer: 0,
  translationController: null,
  phraseController: null,
  activePhraseCategory: "popular",
  speechConfig: null,
  listening: false,
  finalizingTurn: false,
  turn: null,
  turnSerial: 0,
  restartTimer: 0,
  micStream: null,
  audioContext: null,
  mediaSource: null,
  audioFilter: null,
  audioProcessor: null,
  muteNode: null,
  audioOutputSampleRate: 16000,
  audioPrebuffer: [],
  audioPrebufferBytes: 0,
  vadPreRoll: [],
  committedSource: "",
  committedTarget: "",
  interimSource: "",
  pendingSpeech: null,
  pendingSpeechTimer: 0,
  committingSpeech: false,
  latestSourceLanguage: "zh-Hans",
  latestTargetLanguage: "en",
  conversationEntries: [],
  nextConversationId: 1,
  currentAudio: null,
  currentAudioUrl: "",
  currentAudioFinish: null,
  speaking: false,
  playbackHighlight: null,
  playbackAnimation: 0,
  playbackReference: null,
  noiseFloor: 0.0035,
  voiceActiveFrames: 0,
  voiceSilenceFrames: 0,
  voiceGateOpen: false,
  lastVoiceActivityAt: 0,
  speechStartedAt: 0
};

const AUTO_ARBITRATION_WAIT_MS = 2400;
const AUDIO_PREBUFFER_SECONDS = 2;
const PLAYBACK_RESUME_GUARD_MS = 420;
const MIN_VALID_SPEECH_MS = 320;
const VAD_ONSET_FRAMES = 2;
const VAD_RELEASE_FRAMES = 6;
const VAD_PRE_ROLL_FRAMES = 3;
const PLAYBACK_ECHO_GUARD_MS = 1600;

init().catch((error) => {
  console.error(error);
  showError(error.message || "页面初始化失败");
  setEngineState("初始化失败", "error");
});

async function init() {
  bindEvents();
  updateSpeechAvailability();
  setSessionStage("idle", "等待开始");
  setSemanticState("等待完整语句");
  setMicState("麦克风待命", 0);
  setEngineState("正在连接", "busy");

  const languageData = await fetchJson("/api/languages");
  state.languages = Array.isArray(languageData.languages) ? languageData.languages : [];
  renderLanguageOptions();
  restorePreferences();
  updateModeUi();
  await Promise.all([loadVoices(), loadPhrasebook(), checkHealth()]);
  updateControls();
}

function bindEvents() {
  els.sourceText.addEventListener("input", () => {
    state.committedSource = els.sourceText.value;
    state.interimSource = "";
    updateTextControls();
    scheduleManualTranslation();
  });

  els.sourceLang.addEventListener("change", async () => {
    await stopListening({ keepStatus: true });
    state.detectedLanguage = "";
    savePreferences();
    updateSpeechAvailability();
    updateModeUi();
    scheduleManualTranslation(0);
    await loadPhrasebook();
  });

  els.targetLang.addEventListener("change", async () => {
    await stopListening({ keepStatus: true });
    savePreferences();
    updateModeUi();
    await Promise.all([loadVoices(), loadPhrasebook()]);
    scheduleManualTranslation(0);
  });

  els.swapLangs.addEventListener("click", async () => {
    await stopListening({ keepStatus: true });
    const source = els.sourceLang.value;
    const target = els.targetLang.value;
    const nextSource = source === "auto-detect" ? (state.detectedLanguage || target) : target;
    if ([...els.sourceLang.options].some((option) => option.value === nextSource)) {
      els.sourceLang.value = nextSource;
    }
    if ([...els.targetLang.options].some((option) => option.value === source) && source !== "auto-detect") {
      els.targetLang.value = source;
    } else if (els.targetLang.value === els.sourceLang.value) {
      els.targetLang.value = els.sourceLang.value === "en" ? "zh-Hans" : "en";
    }

    const oldSourceText = els.sourceText.value;
    els.sourceText.value = els.targetText.textContent;
    els.targetText.textContent = oldSourceText;
    state.committedSource = els.sourceText.value;
    state.committedTarget = els.targetText.textContent;
    state.detectedLanguage = "";
    updateTextControls();
    savePreferences();
    updateSpeechAvailability();
    updateModeUi();
    await Promise.all([loadVoices(), loadPhrasebook()]);
    scheduleManualTranslation(0);
  });

  els.clearText.addEventListener("click", async () => {
    await stopListening({ keepStatus: true });
    stopPlayback();
    window.clearTimeout(state.translationTimer);
    state.translationController?.abort();
    state.committedSource = "";
    state.committedTarget = "";
    state.interimSource = "";
    state.detectedLanguage = "";
    els.sourceText.value = "";
    els.targetText.textContent = "";
    els.translationMeta.textContent = "";
    setTransliteration(els.sourceTransliteration, "");
    setTransliteration(els.targetTransliteration, "");
    hideDictionary();
    hideError();
    setStatus("");
    updateTextControls();
  });

  els.listenButton.addEventListener("click", async () => {
    if (state.listening) await stopListening();
    else await startListening();
  });

  els.speakSource.addEventListener("click", () => speakText(els.sourceText.value, state.latestSourceLanguage));
  els.speakTarget.addEventListener("click", () =>
    speakText(
      els.targetText.textContent,
      state.latestTargetLanguage,
      els.voiceSelect.value,
      { highlightCurrent: true }
    ));
  els.copyTarget.addEventListener("click", copyCurrentTranslation);

  els.workMode.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-mode]");
    if (!button || button.dataset.mode === state.workMode) return;
    await stopListening({ keepStatus: true });
    state.workMode = button.dataset.mode;
    state.committedSource = "";
    state.committedTarget = "";
    els.sourceText.value = "";
    els.targetText.textContent = "";
    updateModeUi();
    updateControls();
    savePreferences();
  });

  els.speakerMode.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-speaker]");
    if (!button || button.dataset.speaker === state.speakerMode) return;
    await stopListening({ keepStatus: true });
    state.speakerMode = button.dataset.speaker;
    updateModeUi();
    updateControls();
    savePreferences();
  });

  els.clearConversation.addEventListener("click", clearConversation);

  els.toneControl.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-tone]");
    if (!button) return;
    state.tone = button.dataset.tone;
    for (const toneButton of els.toneControl.querySelectorAll("button")) {
      toneButton.setAttribute("aria-pressed", String(toneButton === button));
    }
    savePreferences();
    if (els.sourceText.value.trim() && !state.listening) scheduleManualTranslation(0);
  });

  els.autoSpeak.addEventListener("change", savePreferences);
  els.voiceSelect.addEventListener("change", savePreferences);
  els.segmentDelay.addEventListener("change", () => {
    savePreferences();
    if (state.pendingSpeech) schedulePendingSpeechCommit();
  });
}

function renderLanguageOptions() {
  els.sourceLang.replaceChildren();
  els.targetLang.replaceChildren();

  for (const language of state.languages) {
    const label = language.nativeName && language.nativeName !== language.name
      ? `${language.name} - ${language.nativeName}`
      : language.name;
    els.sourceLang.add(new Option(label, language.code));
    if (language.code !== "auto-detect") els.targetLang.add(new Option(label, language.code));
  }

  els.sourceLang.value = optionExists(els.sourceLang, "zh-Hans") ? "zh-Hans" : els.sourceLang.options[0]?.value;
  els.targetLang.value = optionExists(els.targetLang, "en") ? "en" : els.targetLang.options[0]?.value;
}

function restorePreferences() {
  try {
    const preferences = JSON.parse(localStorage.getItem("bing-live-interpreter.preferences") || "{}");
    if (optionExists(els.sourceLang, preferences.sourceLang)) els.sourceLang.value = preferences.sourceLang;
    if (optionExists(els.targetLang, preferences.targetLang)) els.targetLang.value = preferences.targetLang;
    if (["Standard", "Casual", "Formal"].includes(preferences.tone)) state.tone = preferences.tone;
    if (typeof preferences.autoSpeak === "boolean") els.autoSpeak.checked = preferences.autoSpeak;
    if (optionExists(els.segmentDelay, String(preferences.segmentDelay || ""))) {
      els.segmentDelay.value = String(preferences.segmentDelay);
    }
    if (["one-way", "two-way"].includes(preferences.workMode)) state.workMode = preferences.workMode;
    if (["auto", "a", "b"].includes(preferences.speakerMode)) state.speakerMode = preferences.speakerMode;
    for (const button of els.toneControl.querySelectorAll("button")) {
      button.setAttribute("aria-pressed", String(button.dataset.tone === state.tone));
    }
  } catch {
    // Ignore inaccessible or malformed local preferences.
  }
}

function savePreferences() {
  try {
    localStorage.setItem("bing-live-interpreter.preferences", JSON.stringify({
      sourceLang: els.sourceLang.value,
      targetLang: els.targetLang.value,
      tone: state.tone,
      workMode: state.workMode,
      speakerMode: state.speakerMode,
      autoSpeak: els.autoSpeak.checked,
      segmentDelay: els.segmentDelay.value,
      voiceName: els.voiceSelect.value
    }));
  } catch {
    // The app remains usable when storage is blocked.
  }
}

function updateModeUi() {
  const isTwoWay = state.workMode === "two-way";
  for (const button of els.workMode.querySelectorAll("button[data-mode]")) {
    button.setAttribute("aria-pressed", String(button.dataset.mode === state.workMode));
  }
  for (const button of els.speakerMode.querySelectorAll("button[data-speaker]")) {
    button.setAttribute("aria-pressed", String(button.dataset.speaker === state.speakerMode));
    if (button.dataset.speaker === "a") button.textContent = `A · ${languageName(els.sourceLang.value)}`;
    if (button.dataset.speaker === "b") button.textContent = `B · ${languageName(els.targetLang.value)}`;
  }

  els.speakerControl.classList.toggle("hidden", !isTwoWay);
  els.conversationSection.classList.toggle("hidden", !isTwoWay);
  els.sourceLangLabel.textContent = isTwoWay ? "用户 A 语言" : "原文语言";
  els.targetLangLabel.textContent = isTwoWay ? "用户 B 语言" : "译文语言";
  els.sourcePanelLabel.textContent = isTwoWay ? "最近原话" : "原文";
  els.targetPanelLabel.textContent = isTwoWay ? "最近译文" : "译文";
  if (!state.listening) {
    state.latestSourceLanguage = els.sourceLang.value;
    state.latestTargetLanguage = els.targetLang.value;
  }
  renderConversation();
}

function clearConversation() {
  state.conversationEntries = [];
  renderConversation();
}

function renderConversation() {
  els.conversationLog.replaceChildren();
  els.conversationEmpty.classList.toggle("hidden", state.conversationEntries.length > 0);
  els.clearConversation.disabled = state.conversationEntries.length === 0;
  if (els.conversationCount) els.conversationCount.textContent = `${state.conversationEntries.length} 条`;

  for (const entry of state.conversationEntries) {
    const article = document.createElement("article");
    article.className = "conversation-entry";
    article.dataset.speaker = entry.speaker;
    article.dataset.entryId = String(entry.id);

    const sourceCopy = document.createElement("div");
    sourceCopy.className = "conversation-copy";
    const sourceCaption = document.createElement("span");
    sourceCaption.className = "conversation-caption";
    sourceCaption.textContent = `用户 ${entry.speaker.toUpperCase()} · ${languageName(entry.from)}`;
    const sourceText = document.createElement("span");
    sourceText.className = "conversation-text";
    sourceText.textContent = entry.text;
    sourceCopy.append(sourceCaption, sourceText);

    const targetCopy = document.createElement("div");
    targetCopy.className = "conversation-copy";
    const targetCaption = document.createElement("span");
    targetCaption.className = "conversation-caption";
    targetCaption.textContent = `${languageName(entry.to)}译文`;
    const targetText = document.createElement("span");
    targetText.className = "conversation-text conversation-translation";
    targetText.textContent = entry.translation;
    targetCopy.append(targetCaption, targetText);

    const actions = document.createElement("div");
    actions.className = "conversation-actions";
    const speak = makeCommandButton("朗读", "朗读这条译文", () =>
      speakText(entry.translation, entry.to, "", { entryId: entry.id, highlightCurrent: false }));
    const copy = makeCommandButton("复制", "复制这条译文", () => copyText(entry.translation, "译文已复制"));
    actions.append(speak, copy);
    article.append(sourceCopy, targetCopy, actions);
    els.conversationLog.append(article);
  }
}

function languageName(code) {
  return state.languages.find((language) => language.code === code)?.name || code || "未知语言";
}

async function checkHealth() {
  try {
    const health = await fetchJson("/api/health");
    setEngineState(health.ok ? "Bing 网页引擎" : "服务异常", health.ok ? "ready" : "error");
  } catch {
    setEngineState("服务不可用", "error");
  }
}

async function loadVoices(lang = state.latestTargetLanguage || els.targetLang.value) {
  const previous = readSavedVoice();
  els.voiceSelect.disabled = true;
  els.voiceSelect.replaceChildren(new Option("自动选择声音", ""));
  try {
    const data = await fetchJson(`/api/voices?lang=${encodeURIComponent(lang)}`);
    state.voices = Array.isArray(data.voices) ? data.voices : [];
    for (const voice of state.voices) {
      els.voiceSelect.add(new Option(voice.label || voice.voiceName, voice.voiceName));
    }
    if (optionExists(els.voiceSelect, previous)) els.voiceSelect.value = previous;
  } catch (error) {
    console.warn("Voice list unavailable:", error);
  } finally {
    els.voiceSelect.disabled = false;
  }
}

function readSavedVoice() {
  try {
    const preferences = JSON.parse(localStorage.getItem("bing-live-interpreter.preferences") || "{}");
    return preferences.voiceName || "";
  } catch {
    return "";
  }
}

function scheduleManualTranslation(delay = 450) {
  window.clearTimeout(state.translationTimer);
  if (!els.sourceText.value.trim()) {
    state.translationController?.abort();
    els.targetText.textContent = "";
    els.translationMeta.textContent = "";
    hideDictionary();
    return;
  }
  if (state.listening) return;
  state.translationTimer = window.setTimeout(() => translateManualText(), delay);
}

async function translateManualText() {
  const text = els.sourceText.value.trim();
  if (!text || state.listening) return;

  state.translationController?.abort();
  const controller = new AbortController();
  state.translationController = controller;
  hideError();
  setStatus("正在翻译…", "busy");
  state.latestSourceLanguage = els.sourceLang.value;
  state.latestTargetLanguage = els.targetLang.value;

  try {
    const result = await postJson("/api/translate", {
      text,
      from: els.sourceLang.value,
      to: els.targetLang.value,
      tone: state.tone,
      isVoice: false
    }, controller.signal);
    if (controller.signal.aborted) return;

    state.committedSource = text;
    state.committedTarget = result.translation || "";
    state.detectedLanguage = result.detectedLanguage || "";
    els.targetText.textContent = state.committedTarget;
    updateTextControls();
    setTransliteration(els.sourceTransliteration, result.inputTransliteration || "");
    setTransliteration(els.targetTransliteration, result.outputTransliteration || "");
    updateTranslationMeta(result);
    setStatus("");
    await loadDictionary(text, result.translation || "", result.detectedLanguage || els.sourceLang.value);
  } catch (error) {
    if (error.name !== "AbortError") {
      showError(`翻译失败：${error.message}`);
      setStatus("");
    }
  } finally {
    if (state.translationController === controller) state.translationController = null;
  }
}

async function translateSpeechSegment(text, serial, from = els.sourceLang.value, to = els.targetLang.value) {
  const result = await postJson("/api/translate", {
    text,
    from,
    to,
    tone: state.tone,
    isVoice: true
  });
  if (!state.listening || serial !== state.turnSerial) return null;

  state.detectedLanguage = result.detectedLanguage || from;
  state.latestSourceLanguage = from;
  state.latestTargetLanguage = to;
  state.committedTarget = state.workMode === "two-way"
    ? (result.translation || "")
    : appendSegment(state.committedTarget, result.translation || "", to);
  els.targetText.textContent = state.committedTarget;
  updateTextControls();
  setTransliteration(els.sourceTransliteration, result.inputTransliteration || "");
  setTransliteration(els.targetTransliteration, result.outputTransliteration || "");
  updateTranslationMeta(result);
  return result;
}

function updateTranslationMeta(result) {
  const engine = String(result.engine || "").startsWith("bing-web") ? "Bing 网页" : "免密钥备用引擎";
  const toneNames = { Standard: "标准", Casual: "非正式", Formal: "正式" };
  const tone = toneNames[result.toneRequested] || toneNames[state.tone];
  const toneNote = result.toneApplied === false && result.toneRequested !== "Standard" ? " · 语气未应用" : "";
  els.translationMeta.textContent = `${engine} · ${tone}${toneNote}`;
}

async function loadDictionary(text, translation, from) {
  hideDictionary();
  if (!text || text.length > 200 || from === "auto-detect" || from === els.targetLang.value) return;
  try {
    const data = await postJson("/api/dictionary", { text, translation, from, to: els.targetLang.value });
    const candidates = normalizeDictionaryCandidates(data.translations);
    if (!candidates.length) return;
    els.dictionaryResults.replaceChildren();
    for (const candidate of candidates.slice(0, 12)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "dictionary-item";
      button.textContent = candidate.text;
      if (candidate.partOfSpeech) button.title = candidate.partOfSpeech;
      button.addEventListener("click", () => {
        els.targetText.textContent = candidate.text;
        state.committedTarget = candidate.text;
      });
      els.dictionaryResults.append(button);
    }
    els.dictionarySection.classList.remove("hidden");
  } catch (error) {
    console.warn("Dictionary unavailable:", error);
  }
}

function normalizeDictionaryCandidates(raw) {
  const roots = Array.isArray(raw) ? raw : [];
  const candidates = [];
  for (const root of roots) {
    const entries = Array.isArray(root?.translations) ? root.translations : (root?.displayTarget ? [root] : []);
    for (const entry of entries) {
      const text = entry.displayTarget || entry.normalizedTarget || entry.translation || entry.text;
      if (text && !candidates.some((item) => item.text === text)) {
        candidates.push({ text, partOfSpeech: entry.posTag || entry.partOfSpeech || "" });
      }
    }
  }
  return candidates;
}

async function loadPhrasebook(category = state.activePhraseCategory) {
  state.phraseController?.abort();
  const controller = new AbortController();
  state.phraseController = controller;
  const from = phrasebookSourceLanguage();
  const to = els.targetLang.value;
  if (!from || from === to) {
    els.phraseSection.classList.add("hidden");
    return;
  }

  els.phraseSection.classList.remove("hidden");
  els.phraseEngine.textContent = "正在载入…";
  try {
    const data = await postJson("/api/phrasebook", { from, to, categoryID: category }, controller.signal);
    if (controller.signal.aborted) return;
    state.activePhraseCategory = data.activeCategory || category;
    renderPhraseTabs(data.categories || []);
    renderPhraseCards(data.phrases || []);
    els.phraseEngine.textContent = data.engine === "edge-noauth-batch" ? "免密钥批量翻译" : data.engine || "";
  } catch (error) {
    if (error.name !== "AbortError") {
      els.phraseEngine.textContent = "暂时不可用";
      els.phraseGrid.replaceChildren();
    }
  } finally {
    if (state.phraseController === controller) state.phraseController = null;
  }
}

function renderPhraseTabs(categories) {
  els.phraseTabs.replaceChildren();
  for (const category of categories) {
    const button = document.createElement("button");
    button.type = "button";
    button.role = "tab";
    button.textContent = category.name;
    button.dataset.category = category.id;
    button.setAttribute("aria-selected", String(category.id === state.activePhraseCategory));
    button.addEventListener("click", () => loadPhrasebook(category.id));
    els.phraseTabs.append(button);
  }
}

function renderPhraseCards(phrases) {
  els.phraseGrid.replaceChildren();
  for (const phrase of phrases) {
    const card = document.createElement("article");
    card.className = "phrase-card";

    const useButton = document.createElement("button");
    useButton.type = "button";
    useButton.className = "phrase-use";
    useButton.title = "使用该短语";
    const source = document.createElement("strong");
    source.textContent = phrase.source;
    const target = document.createElement("span");
    target.textContent = phrase.target;
    useButton.append(source, target);
    useButton.addEventListener("click", () => usePhrase(phrase));

    const actions = document.createElement("div");
    actions.className = "phrase-actions";
    const copy = makeCommandButton("复制", "复制译文", () => copyText(phrase.target, "译文已复制"));
    const speak = makeCommandButton("朗读", "朗读译文", () => speakText(phrase.target, els.targetLang.value, els.voiceSelect.value));
    actions.append(copy, speak);
    card.append(useButton, actions);
    els.phraseGrid.append(card);
  }
}

function makeCommandButton(label, title, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "phrase-action";
  button.textContent = label;
  button.title = title;
  button.addEventListener("click", handler);
  return button;
}

function usePhrase(phrase) {
  if (state.listening) return;
  els.sourceText.value = phrase.source;
  els.targetText.textContent = phrase.target;
  state.committedSource = phrase.source;
  state.committedTarget = phrase.target;
  updateTextControls();
  scheduleManualTranslation(0);
  els.sourceText.focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function microphoneConstraints() {
  const supported = navigator.mediaDevices.getSupportedConstraints?.() || {};
  const audio = {
    channelCount: { ideal: 1 },
    echoCancellation: { ideal: true },
    noiseSuppression: { ideal: true },
    autoGainControl: { ideal: true }
  };
  if (supported.sampleRate) audio.sampleRate = { ideal: 16000 };
  if (supported.sampleSize) audio.sampleSize = { ideal: 16 };
  if (supported.latency) audio.latency = { ideal: 0.02 };
  if (supported.voiceIsolation) audio.voiceIsolation = { ideal: true };
  return { audio };
}

async function startListening() {
  hideError();
  const sides = recognitionSides();
  if (!sides.length) {
    showError(state.workMode === "two-way"
      ? "用户 A 和用户 B 都必须选择不同且支持语音识别的语言。"
      : "Bing 网页语音识别需要明确且支持语音输入的原文语言。");
    return;
  }
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    showError("麦克风需要 HTTPS，并且浏览器必须支持 getUserMedia。请使用最新版 Chrome 或 Edge。");
    return;
  }

  stopPlayback();
  state.translationController?.abort();
  window.clearTimeout(state.translationTimer);
  setStatus("正在请求麦克风权限…", "busy");
  setSessionStage("listen", "请求麦克风权限");
  setSemanticState("准备实时识别");
  setMicState("等待授权", 0);

  try {
    state.micStream = await navigator.mediaDevices.getUserMedia(microphoneConstraints());
    setMicState("麦克风已连接", 0);
    state.speechConfig = await fetchJson("/api/speech-config");
    state.listening = true;
    state.finalizingTurn = false;
    state.pendingSpeech = null;
    state.speechStartedAt = 0;
    state.lastVoiceActivityAt = 0;
    state.voiceActiveFrames = 0;
    state.voiceSilenceFrames = 0;
    state.voiceGateOpen = false;
    state.noiseFloor = 0.0035;
    window.clearTimeout(state.pendingSpeechTimer);
    state.pendingSpeechTimer = 0;
    if (state.workMode === "two-way") {
      state.committedSource = "";
      state.committedTarget = "";
      els.sourceText.value = "";
      els.targetText.textContent = "";
    } else {
      state.committedSource = els.sourceText.value.trim();
      state.committedTarget = els.targetText.textContent.trim();
    }
    state.interimSource = "";
    els.sourceText.readOnly = true;
    updateControls();
    await startSpeechTurn();
  } catch (error) {
    await stopListening({ keepStatus: true });
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      showError("麦克风权限被拒绝。请在浏览器地址栏的网站权限中允许麦克风，然后再次点击。");
    } else if (error.name === "NotFoundError") {
      showError("没有找到可用的麦克风设备。");
    } else {
      showError(`无法开始语音识别：${error.message}`);
    }
  }
}

function recognitionSides() {
  const source = state.languages.find((language) => language.code === els.sourceLang.value);
  const target = state.languages.find((language) => language.code === els.targetLang.value);
  if (state.workMode === "one-way") {
    return source?.speechLocale ? [{ speaker: "a", language: source }] : [];
  }
  if (!source || !target || source.code === target.code) return [];
  if (state.speakerMode === "a") return source.speechLocale ? [{ speaker: "a", language: source }] : [];
  if (state.speakerMode === "b") return target.speechLocale ? [{ speaker: "b", language: target }] : [];
  if (!source.speechLocale || !target.speechLocale) return [];
  return [
    { speaker: "a", language: source },
    { speaker: "b", language: target }
  ];
}

async function startSpeechTurn() {
  if (!state.listening || state.turn || state.finalizingTurn) return;
  const config = state.speechConfig;
  if (!config?.available || !config.endpoint) throw new Error("Bing 语音配置不可用");
  const sides = recognitionSides();
  if (!sides.length) throw new Error("没有可用的语音识别语言");
  state.speechStartedAt = 0;
  state.lastVoiceActivityAt = 0;

  const group = {
    serial: ++state.turnSerial,
    recognizers: [],
    candidates: [],
    format: sides.length > 1 ? "detailed" : (config.protocol?.format || "simple"),
    audioStarted: false,
    voiceActiveMs: 0,
    voiceActiveFrames: 0,
    finalizing: false,
    ambiguous: false,
    unreliable: false,
    semanticRejected: false,
    arbitrating: false,
    languageReviewed: false,
    openTimer: 0,
    arbitrationTimer: 0
  };
  state.turn = group;
  setStatus(sides.length > 1 ? "正在连接双语识别…" : "正在连接 Bing 语音识别…", "busy");
  setSessionStage("listen", sides.length > 1 ? "连接双路识别" : "连接语音识别");

  for (const side of sides) group.recognizers.push(createSpeechRecognizer(group, side, config));
  group.openTimer = window.setTimeout(() => {
    if (state.turn === group && !group.audioStarted) {
      showError("Bing 语音识别连接超时，正在重试。");
      disposeTurn(group);
      scheduleNextTurn(1200);
    }
  }, 12000);
}

function createSpeechRecognizer(group, side, config) {
  const requestId = compactUuid();
  const connectionId = compactUuid();
  const url = new URL(config.endpoint);
  url.searchParams.set("clientbuild", config.clientBuild || "TranslateThisDesktop");
  url.searchParams.set("referer", config.referer || "https://cn.bing.com/translator/");
  url.searchParams.set("form", config.form || "QBRE");
  url.searchParams.set("uqurequestid", config.uquRequestId || compactUuid());
  url.searchParams.set("language", side.language.speechLocale);
  url.searchParams.set("format", group.format);
  url.searchParams.set(config.authQueryName || "Ocp-Apim-Subscription-Key", config.subscriptionKey || "key");
  url.searchParams.set("X-ConnectionId", connectionId);

  const ws = new WebSocket(url.toString());
  ws.binaryType = "arraybuffer";
  const recognizer = {
    ws,
    group,
    speaker: side.speaker,
    language: side.language,
    requestId,
    connectionId,
    opened: false,
    closed: false,
    finalReceived: false,
    hypothesis: "",
    rawHypothesis: "",
    hypothesisCount: 0,
    hypothesisHistory: []
  };

  ws.onopen = async () => {
    if (!state.listening || state.turn !== group) return;
    recognizer.opened = true;
    sendSpeechPreamble(recognizer, side.language.speechLocale, group.format);
    sendAudioFrame(recognizer, makeWavHeader(config.protocol?.sampleRate || 16000));
    try {
      await startAudioCapture(config.protocol?.sampleRate || 16000);
    } catch (error) {
      showError(`音频采集失败：${error.message}`);
      await stopListening({ keepStatus: true });
      return;
    }
    if (!state.listening || state.turn !== group) return;
    if (!group.recognizers.every((item) => item.opened) || group.audioStarted) return;
    group.audioStarted = true;
    window.clearTimeout(group.openTimer);
    flushAudioPrebuffer(group);
    setStatus(group.recognizers.length > 1 ? "正在自动判断用户 A / B…" : `正在聆听用户 ${side.speaker.toUpperCase()}…`, "live");
    setSessionStage("listen", "正在实时聆听");
    setSemanticState("讲话时实时显示，结束后自动确认");
    setMicState("正在监听", 0);
    setEngineState(group.recognizers.length > 1 ? "双向识别中" : "实时识别中", "live");
  };

  ws.onmessage = (event) => handleSpeechMessage(recognizer, event.data);
  ws.onerror = () => {
    if (state.listening && state.turn === group) setStatus("语音连接异常，准备重试…", "busy");
  };
  ws.onclose = () => {
    recognizer.closed = true;
    if (state.turn !== group || group.finalizing) return;
    if (group.recognizers.every((item) => item.closed)) {
      disposeTurn(group);
      if (state.listening && !state.finalizingTurn) scheduleNextTurn(700);
    }
  };
  return recognizer;
}

async function handleSpeechMessage(recognizer, data) {
  const group = recognizer.group;
  if (!state.listening || state.turn !== group) return;
  let message;
  try {
    if (typeof data === "string") message = data;
    else if (data instanceof Blob) message = await data.text();
    else message = new TextDecoder().decode(data);
  } catch {
    return;
  }

  const parsed = parseSpeechProtocolMessage(message);
  if (!parsed.path) return;

  if (parsed.path === "speech.startDetected") {
    holdPendingSpeechCommit();
    state.speechStartedAt = performance.now();
    setStatus(group.recognizers.length > 1
      ? `检测到语音，正在判断用户 A / B…`
      : `检测到用户 ${recognizer.speaker.toUpperCase()} 语音，正在识别…`, "live");
    setSessionStage("listen", "检测到讲话");
    if (els.liveSpeakerState) els.liveSpeakerState.textContent = "语音输入中，实时修订文字";
    return;
  }

  if (parsed.path === "speech.hypothesis") {
    const text = parsed.body?.Text || parsed.body?.DisplayText || "";
    if (text) {
      recognizer.rawHypothesis = text;
      recognizer.hypothesis = mergeSpeechHypothesis(
        recognizer.hypothesis,
        text,
        recognizer.language.code
      );
      if (recognizer.hypothesisHistory.at(-1) !== text) {
        recognizer.hypothesisCount += 1;
        recognizer.hypothesisHistory.push(text);
      recognizer.hypothesisHistory = recognizer.hypothesisHistory.slice(-8);
      }
      holdPendingSpeechCommit();
      if (isPlaybackEcho(recognizer.hypothesis, recognizer.language.code)) {
        setMicState("已过滤播放器回声", 0);
        return;
      }
      const provisional = chooseProvisionalRecognizer(group);
      state.interimSource = provisional.hypothesis;
      state.latestSourceLanguage = provisional.language.code;
      const pendingPrefix = state.pendingSpeech?.speaker === provisional.speaker
        ? state.pendingSpeech.text
        : "";
      const oneWayPrefix = state.pendingSpeech
        ? appendSegment(state.committedSource, state.pendingSpeech.text, provisional.language.code)
        : state.committedSource;
      els.sourceText.value = state.workMode === "two-way"
        ? appendSegment(pendingPrefix, provisional.hypothesis, provisional.language.code)
        : appendSegment(oneWayPrefix, provisional.hypothesis, provisional.language.code);
      updateLatestPanelLabels(provisional.speaker, provisional.language.code, oppositeLanguage(provisional.speaker));
      setSessionStage("listen", `正在识别用户 ${provisional.speaker.toUpperCase()}`);
      setSemanticState("实时草稿，尚未进入翻译");
      if (els.liveSpeakerState) {
        els.liveSpeakerState.textContent = `用户 ${provisional.speaker.toUpperCase()} 正在讲话`;
      }
      updateTextControls();
    }
    return;
  }

  if (parsed.path === "speech.endDetected") {
    setSessionStage("confirm", "检测句末停顿");
    setSemanticState("正在等待可能的续句");
    return;
  }

  if (parsed.path === "speech.phrase") {
    registerRecognitionCandidate(recognizer, parsed.body);
    return;
  }

  if (parsed.path === "turn.end" && !recognizer.finalReceived) {
    registerRecognitionCandidate(recognizer, { RecognitionStatus: "NoMatch" });
  }
}

function chooseProvisionalRecognizer(group) {
  return group.recognizers
    .filter((recognizer) => recognizer.hypothesis)
    .sort((left, right) => provisionalScore(right) - provisionalScore(left))[0];
}

function provisionalScore(recognizer) {
  const previous = recognizer.hypothesisHistory.at(-2) || "";
  const stability = previous ? speechTextSimilarity(recognizer.rawHypothesis, previous) : 0;
  const cjkUnits = (recognizer.hypothesis.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const wordUnits = (recognizer.hypothesis.match(/[A-Za-z\u00c0-\u024f]+/g) || []).length;
  const units = Math.max(1, cjkUnits, wordUnits);
  const revisionDensity = Math.max(0, recognizer.hypothesisCount - units * 1.3) / units;
  return speechScriptCompatibility(recognizer.hypothesis, recognizer.language.code) * 10
    + speechSentenceNaturalness(recognizer.hypothesis, recognizer.language.code) * 3
    + stability * 1.5
    + Math.min(recognizer.hypothesis.length, 40) / 40
    - Math.min(2.5, revisionDensity * 1.8)
    + (state.pendingSpeech?.speaker === recognizer.speaker ? 2.5 : 0);
}

function registerRecognitionCandidate(recognizer, body) {
  const group = recognizer.group;
  if (state.turn !== group || group.finalizing || recognizer.finalReceived) return;
  recognizer.finalReceived = true;
  const quality = createRecognitionCandidate(body, {
    languageCode: recognizer.language.code,
    hypothesisCount: recognizer.hypothesisCount,
    hypothesisHistory: recognizer.hypothesisHistory
  });
  if (quality.text && recognizer.hypothesis) {
    quality.text = mergeSpeechHypothesis(
      recognizer.hypothesis,
      quality.text,
      recognizer.language.code
    );
    quality.scriptScore = speechScriptCompatibility(quality.text, recognizer.language.code);
    quality.naturalness = speechSentenceNaturalness(quality.text, recognizer.language.code);
  }
  const validSpeech = (group.voiceActiveMs || 0) >= MIN_VALID_SPEECH_MS;
  const playbackEcho = isPlaybackEcho(quality.text, recognizer.language.code);
  group.candidates.push({
    speaker: recognizer.speaker,
    language: recognizer.language,
    ...quality,
    success: quality.success && validSpeech && !playbackEcho,
    noiseRejected: quality.success && !validSpeech,
    playbackEchoRejected: quality.success && playbackEcho,
    completedAt: performance.now()
  });

  const allFinished = group.recognizers.every((item) => item.finalReceived);
  if (allFinished || group.recognizers.length === 1) {
    finalizeRecognitionGroup(group);
    return;
  }
  if (quality.text && !group.arbitrationTimer) {
    group.arbitrationTimer = window.setTimeout(() => finalizeRecognitionGroup(group), AUTO_ARBITRATION_WAIT_MS);
  }
}

async function finalizeRecognitionGroup(group) {
  if (state.turn !== group || group.finalizing || group.arbitrating) return;
  group.arbitrating = true;
  window.clearTimeout(group.arbitrationTimer);
  const successes = group.candidates.filter((candidate) => candidate.success);
  let candidate = chooseRecognitionCandidate(successes, {
    strict: group.recognizers.length > 1,
    pendingSpeaker: state.pendingSpeech?.speaker || ""
  });

  const needsSemanticReview = group.recognizers.length > 1
    && successes.length > 0;
  if (needsSemanticReview) {
    setStatus("正在对比识别原句与译文语义…", "busy");
    setSessionStage("confirm", "复核语言方向");
    setSemanticState("检查句子完整性、译文结构和语言方向");
    candidate = await resolveLanguageConflict(group, successes, candidate);
    group.languageReviewed = true;
  }

  if (state.turn !== group || group.finalizing) return;
  group.arbitrating = false;
  group.ambiguous = successes.length > 1 && !candidate;
  group.semanticRejected = Boolean(group.languageReviewed && successes.length > 0 && !candidate);
  group.unreliable = successes.length === 1 && !candidate && !group.semanticRejected;
  void finalizeSpeechTurn(group, candidate);
}

async function resolveLanguageConflict(group, candidates, preferredCandidate = null) {
  const reviews = await Promise.all(candidates.map(async (candidate) => {
    const review = await reviewCandidateMeaning(candidate);
    return {
      candidate,
      detectedLanguage: review.detectedLanguage,
      translation: review.translation,
      exactMatch: languageMatches(review.detectedLanguage, candidate.language.code),
      scriptStrength: candidateTextScriptStrength(candidate.text, candidate.language.code),
      sourceNaturalness: speechSentenceNaturalness(candidate.text, candidate.language.code),
      semanticScore: speechTranslationQuality(
        candidate.text,
        review.translation,
        candidate.language.code,
        oppositeLanguage(candidate.speaker)
      )
    };
  }));

  const semanticWinner = chooseSemanticWinner(reviews, preferredCandidate);
  const crossScriptWinner = chooseCrossScriptCandidate(candidates);
  if (crossScriptWinner) {
    const crossReview = reviews.find((review) => review.candidate === crossScriptWinner);
    const semanticReview = reviews.find((review) => review.candidate === semanticWinner);
    if (!semanticReview
        || !crossReview
        || semanticReview.semanticScore - crossReview.semanticScore < 0.2) {
      setStatus(`根据双路文字体系和语义确认用户 ${crossScriptWinner.speaker.toUpperCase()}…`, "live");
      return crossScriptWinner;
    }
  }
  if (semanticWinner) {
    setStatus(`根据原句和译文语义确认用户 ${semanticWinner.speaker.toUpperCase()}…`, "live");
    return semanticWinner;
  }

  if (reviews.length === 1) return reviews[0].sourceNaturalness >= 0.56
    ? reviews[0].candidate
    : null;

  const exactMatches = reviews.filter((review) => review.exactMatch);
  if (exactMatches.length === 1) {
    setStatus(`语言复核确认用户 ${exactMatches[0].candidate.speaker.toUpperCase()}…`, "live");
    return exactMatches[0].candidate;
  }

  const scriptWinner = chooseScriptWinner(reviews);
  if (scriptWinner) {
    setStatus(`根据文字体系确认用户 ${scriptWinner.speaker.toUpperCase()}…`, "live");
    return scriptWinner;
  }

  if (state.pendingSpeech?.speaker) {
    const continuation = candidates.find((candidate) =>
      candidate.speaker === state.pendingSpeech.speaker
    );
    if (continuation) return continuation;
  }

  return chooseRecognitionCandidate(candidates, {
    strict: false,
    pendingSpeaker: state.pendingSpeech?.speaker || ""
  }) || [...candidates].sort((left, right) =>
    recognitionCandidateScore(right, state.pendingSpeech?.speaker || "")
    - recognitionCandidateScore(left, state.pendingSpeech?.speaker || "")
  )[0] || null;
}

function chooseSemanticWinner(reviews, preferredCandidate) {
  const ranked = reviews
    .filter((review) => Number.isFinite(review.semanticScore))
    .sort((left, right) => right.semanticScore - left.semanticScore);
  if (!ranked.length) return null;
  const best = ranked[0];
  const second = ranked[1];
  const preferred = reviews.find((review) => review.candidate === preferredCandidate);
  if (second && best.semanticScore >= 0.58 && best.semanticScore - second.semanticScore >= 0.14) {
    return best.candidate;
  }
  if (!second && best.semanticScore >= 0.62 && best.sourceNaturalness >= 0.56) {
    return best.candidate;
  }
  if (preferred && preferred.sourceNaturalness >= 0.72) return preferred.candidate;
  return null;
}

async function reviewCandidateMeaning(candidate) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 2200);
  try {
    const target = candidate.language.code === els.sourceLang.value
      ? els.targetLang.value
      : els.sourceLang.value;
    const result = await postJson("/api/translate", {
      text: candidate.text,
      from: "auto-detect",
      to: target === "auto-detect" ? "en" : target,
      tone: "Standard",
      isVoice: true
    }, controller.signal);
    return {
      detectedLanguage: result.detectedLanguage || "",
      translation: result.translation || ""
    };
  } catch {
    return { detectedLanguage: "", translation: "" };
  } finally {
    window.clearTimeout(timeout);
  }
}

function isPlaybackEcho(text, languageCode) {
  const reference = state.playbackReference;
  if (!reference?.text || !text) return false;
  if (!reference.active && performance.now() > reference.expiresAt) return false;
  if (!languageMatches(languageCode, reference.language)) return false;
  return speechTextSimilarity(text, reference.text) >= 0.52;
}

function languageMatches(detected, expected) {
  const actual = normalizeDetectedLanguage(detected);
  const wanted = normalizeDetectedLanguage(expected);
  if (!actual || !wanted) return false;
  if (actual === wanted) return true;
  if (actual === "zh-Hans" && wanted === "zh-Hant") return false;
  if (actual === "zh-Hant" && wanted === "zh-Hans") return false;
  return actual.split("-")[0] === wanted.split("-")[0];
}

function normalizeDetectedLanguage(language) {
  const value = String(language || "").trim();
  const aliases = {
    zh: "zh-Hans",
    "zh-CN": "zh-Hans",
    "zh-SG": "zh-Hans",
    "zh-TW": "zh-Hant",
    "zh-HK": "zh-Hant",
    "en-US": "en",
    "en-GB": "en",
    "ja-JP": "ja",
    "ko-KR": "ko"
  };
  return aliases[value] || value;
}

function candidateTextScriptStrength(text, languageCode) {
  const value = String(text || "");
  const language = normalizeDetectedLanguage(languageCode);
  const cjk = (value.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const latin = (value.match(/[A-Za-z\u00c0-\u024f]/g) || []).length;
  const hangul = (value.match(/[\uac00-\ud7af]/g) || []).length;
  const total = cjk + latin + hangul;
  if (!total) return 0;
  if (language === "zh-Hans" || language === "zh-Hant" || language === "yue") {
    return cjk / total;
  }
  if (language === "ko") return hangul / total;
  if (language === "en") return latin / total;
  return speechScriptCompatibility(value, languageCode);
}

function chooseScriptWinner(reviews) {
  if (reviews.length < 2) return null;
  const crossScriptCandidate = chooseCrossScriptCandidate(
    reviews.map((review) => review.candidate)
  );
  if (crossScriptCandidate) return crossScriptCandidate;

  const cjk = reviews.find((review) => isCjkLanguage(review.candidate.language.code));
  const nonCjk = reviews.find((review) => !isCjkLanguage(review.candidate.language.code));
  if (!cjk || !nonCjk) {
    const [first, second] = [...reviews].sort((left, right) =>
      right.scriptStrength - left.scriptStrength
    );
    if (first.scriptStrength < 0.55) return null;
    if (first.scriptStrength - second.scriptStrength < 0.2) return null;
    return first.candidate;
  }

  const cjkRatio = scriptRatio(cjk.candidate.text, "cjk");
  const latinRatio = scriptRatio(nonCjk.candidate.text, "latin");
  const cjkConfidence = comparableCandidateConfidence(cjk.candidate);
  const latinConfidence = comparableCandidateConfidence(nonCjk.candidate);
  const cjkHasText = cjkRatio >= 0.35;
  const latinHasText = latinRatio >= 0.35;

  if (cjkHasText && scriptRatio(nonCjk.candidate.text, "cjk") <= 0.15) {
    if (cjkConfidence + 0.05 >= latinConfidence
        || (cjk.candidate.revisionPenalty || 0) <= (nonCjk.candidate.revisionPenalty || 0) + 0.25) {
      return cjk.candidate;
    }
    return nonCjk.candidate;
  }
  if (latinHasText && scriptRatio(cjk.candidate.text, "latin") <= 0.15) {
    if (latinConfidence + 0.05 >= cjkConfidence
        || (nonCjk.candidate.revisionPenalty || 0) <= (cjk.candidate.revisionPenalty || 0) + 0.25) {
      return nonCjk.candidate;
    }
    return cjk.candidate;
  }
  return null;
}

function isCjkLanguage(languageCode) {
  return ["zh-Hans", "zh-Hant", "yue", "ja", "ko"].includes(languageCode);
}

function scriptRatio(text, type) {
  const value = String(text || "");
  const counts = {
    cjk: (value.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/g) || []).length,
    latin: (value.match(/[A-Za-z\u00c0-\u024f]/g) || []).length
  };
  const total = counts.cjk + counts.latin;
  return total ? (counts[type] || 0) / total : 0;
}

function comparableCandidateConfidence(candidate) {
  const confidence = Number(candidate?.confidence);
  return Number.isFinite(confidence) ? confidence : 0.45;
}

async function finalizeSpeechTurn(group, candidate) {
  if (!state.listening || state.turn !== group || state.finalizingTurn) return;
  group.finalizing = true;
  state.finalizingTurn = true;
  state.interimSource = "";
  disposeTurn(group, true);

  if (!candidate?.text) {
    state.finalizingTurn = false;
    if (group.ambiguous) {
      showError("两路语言候选仍无法确认方向，已保留监听。可以继续讲话，或临时锁定用户 A / B。");
    } else if (group.semanticRejected) {
      showError("识别文字或译文语义不完整，已过滤本段并继续监听。请清晰说完整句子。");
    } else if (group.unreliable) {
      showError("本段语音置信度过低，已放弃不可靠文字并继续聆听。");
    }
    if (state.pendingSpeech) {
      setStatus("续句没有形成可靠结果，继续等待完整发言…", "live");
      schedulePendingSpeechCommit();
      scheduleNextTurn(80);
    } else {
      const uncertain = group.ambiguous || group.unreliable;
      setStatus(group.ambiguous
        ? "无法可靠判断说话方，继续聆听…"
        : group.unreliable
          ? "识别可信度不足，继续聆听…"
          : "没有识别到语音，继续聆听…", "live");
      scheduleNextTurn(uncertain ? 600 : 350);
    }
    return;
  }

  const from = candidate.language.code;
  const to = state.workMode === "two-way" ? oppositeLanguage(candidate.speaker) : els.targetLang.value;
  const canContinue = state.pendingSpeech
    && state.pendingSpeech.speaker === candidate.speaker
    && state.pendingSpeech.from === from
    && state.pendingSpeech.to === to;

  if (state.pendingSpeech && !canContinue) {
    await commitPendingSpeech({ resume: false });
    if (!state.listening) return;
    state.finalizingTurn = true;
  }

  const previousPending = canContinue ? state.pendingSpeech : null;
  const text = canContinue
    ? appendSegment(previousPending.text, candidate.text, from)
    : candidate.text;
  state.pendingSpeech = {
    speaker: candidate.speaker,
    from,
    to,
    text,
    lastActivityAt: performance.now(),
    startedAt: previousPending?.startedAt || state.speechStartedAt || performance.now(),
    continuationCount: (previousPending?.continuationCount || 0) + (canContinue ? 1 : 0)
  };
  state.latestSourceLanguage = from;
  state.latestTargetLanguage = to;
  els.sourceText.value = state.workMode === "two-way"
    ? text
    : appendSegment(state.committedSource, text, from);
  updateLatestPanelLabels(candidate.speaker, from, to);
  updateTextControls();
  state.finalizingTurn = false;
  const waitSeconds = (segmentDelayMs(state.pendingSpeech) / 1000).toFixed(1);
  setStatus(`已识别用户 ${candidate.speaker.toUpperCase()}，智能等待续句约 ${waitSeconds} 秒…`, "live");
  setSessionStage("confirm", "判断是否说完");
  setSemanticState(`句末确认中 · 最多等待 ${waitSeconds} 秒`);
  if (els.liveSpeakerState) els.liveSpeakerState.textContent = "等待续句，不会立即翻译";
  schedulePendingSpeechCommit();
  scheduleNextTurn(80);
}

function segmentDelayMs(pending = state.pendingSpeech) {
  return estimateSpeechCommitDelay(
    pending?.text || "",
    pending?.from || effectiveSourceLanguage(),
    els.segmentDelay.value,
    pending?.continuationCount || 0
  );
}

function holdPendingSpeechCommit() {
  if (!state.pendingSpeech) return;
  state.pendingSpeech.lastActivityAt = performance.now();
  schedulePendingSpeechCommit();
  setStatus("检测到续句，继续识别完整内容…", "live");
  setSessionStage("listen", "续句输入中");
  setSemanticState("检测到继续讲话，取消本次句末提交");
}

function schedulePendingSpeechCommit() {
  window.clearTimeout(state.pendingSpeechTimer);
  state.pendingSpeechTimer = 0;
  if (!state.listening || !state.pendingSpeech) return;
  const idleMs = performance.now() - (state.pendingSpeech.lastActivityAt || 0);
  const delay = Math.max(0, segmentDelayMs(state.pendingSpeech) - idleMs);
  state.pendingSpeechTimer = window.setTimeout(() => {
    state.pendingSpeechTimer = 0;
    if (!state.listening || !state.pendingSpeech) return;
    const currentIdleMs = performance.now() - (state.pendingSpeech.lastActivityAt || 0);
    if (currentIdleMs < segmentDelayMs(state.pendingSpeech)) {
      schedulePendingSpeechCommit();
      return;
    }
    void commitPendingSpeech();
  }, delay);
}

async function commitPendingSpeech({ resume = true } = {}) {
  if (!state.listening || !state.pendingSpeech || state.committingSpeech) return;
  const pending = state.pendingSpeech;
  const validationSerial = state.turnSerial;
  state.pendingSpeech = null;
  window.clearTimeout(state.pendingSpeechTimer);
  state.pendingSpeechTimer = 0;
  state.committingSpeech = true;
  state.finalizingTurn = true;
  if (state.turn) disposeTurn(state.turn, true);

  state.latestSourceLanguage = pending.from;
  state.latestTargetLanguage = pending.to;
  state.committedSource = state.workMode === "two-way"
    ? pending.text
    : appendSegment(state.committedSource, pending.text, pending.from);
  els.sourceText.value = state.committedSource;
  updateLatestPanelLabels(pending.speaker, pending.from, pending.to);
  updateTextControls();
  setStatus(state.workMode === "two-way"
    ? `已确认用户 ${pending.speaker.toUpperCase()} 完成发言，正在校准语句…`
    : "已确认完整语句，正在校准语句…", "busy");
  setSessionStage("confirm", "语义与文字校准");
  setSemanticState("结合整句做保守修正");
  if (els.liveSpeakerState) els.liveSpeakerState.textContent = "发言已结束";

  try {
    const rawText = pending.text;
    const refined = await refineSpeechText(rawText, pending.from);
    pending.text = refined.text;
    state.committedSource = state.workMode === "two-way"
      ? pending.text
      : replaceTrailingSegment(state.committedSource, rawText, pending.text);
    els.sourceText.value = state.committedSource;
    updateTextControls();

    setStatus(refined.changed ? "语句已校准，正在翻译…" : "完整语句已确认，正在翻译…", "busy");
    setSessionStage("translate", "正在翻译");
    setSemanticState(refined.changed ? "已采用 Bing 保守校正" : "识别内容保持原样");
    const result = await translateSpeechSegment(pending.text, validationSerial, pending.from, pending.to);
    if (!result) return;
    await loadVoices(pending.to);
    let conversationEntry = null;
    if (state.workMode === "two-way") {
      conversationEntry = {
        id: state.nextConversationId++,
        speaker: pending.speaker,
        from: pending.from,
        to: pending.to,
        text: pending.text,
        rawText,
        corrected: refined.changed,
        translation: result.translation || ""
      };
      state.conversationEntries.push(conversationEntry);
      state.conversationEntries = state.conversationEntries.slice(-100);
      renderConversation();
    }
    if (els.autoSpeak.checked && result.translation) {
      await ensureRecognitionDuringPlayback();
      setStatus("正在播报译文，同时继续识别用户语音…", "busy");
      setSessionStage("speak", "播报译文");
      setSemanticState("全双工监听 · 自动过滤播放器回声");
      await playSpeech(
        result.translation,
        pending.to,
        els.voiceSelect.value,
        { entryId: conversationEntry?.id, highlightCurrent: true }
      );
      await wait(PLAYBACK_RESUME_GUARD_MS);
    } else if (els.playbackState) {
      els.playbackState.textContent = "译文已生成 · 自动播报关闭";
    }
    hideError();
  } catch (error) {
    if (state.listening) showError(`语音翻译失败：${error.message}`);
  } finally {
    state.committingSpeech = false;
    state.finalizingTurn = false;
    if (state.pendingSpeech) schedulePendingSpeechCommit();
    if (resume && state.listening) {
      if (!state.turn) {
        setStatus("准备下一段语音…", "busy");
        setSessionStage("listen", "恢复实时聆听");
        setSemanticState("等待下一位用户讲话");
        scheduleNextTurn(PLAYBACK_RESUME_GUARD_MS);
      }
    }
  }
}

async function ensureRecognitionDuringPlayback() {
  if (!state.listening || state.turn) return;
  state.finalizingTurn = false;
  try {
    await startSpeechTurn();
  } catch (error) {
    console.warn("Unable to keep recognition active during playback:", error);
  }
}

async function refineSpeechText(text, languageCode) {
  const normalized = normalizeRecognizedText(text, languageCode);
  if (!normalized || normalized.length > 80) {
    return { text: normalized || text, changed: normalized !== text };
  }
  try {
    const result = await postJson("/api/correct", { text: normalized, lang: languageCode });
    const corrected = safeSpeechCorrection(normalized, result.correctedText, languageCode);
    return { text: corrected, changed: corrected !== text };
  } catch {
    return { text: normalized, changed: normalized !== text };
  }
}

function normalizeRecognizedText(text, languageCode) {
  let value = String(text || "").trim().replace(/\s+/g, " ");
  if (["zh-Hans", "zh-Hant", "yue", "ja"].includes(languageCode)) {
    value = value
      .replace(/\s*([，。！？、；：])\s*/g, "$1")
      .replace(/([，。！？、；：])\1{1,}/g, "$1");
  } else {
    value = value
      .replace(/\s+([,.!?;:])/g, "$1")
      .replace(/([,.!?;:])\1{2,}/g, "$1");
  }
  return value;
}

function replaceTrailingSegment(existing, rawText, refinedText) {
  const value = String(existing || "");
  if (rawText && value.endsWith(rawText)) {
    return `${value.slice(0, -rawText.length)}${refinedText}`;
  }
  return refinedText;
}

function oppositeLanguage(speaker) {
  return speaker === "a" ? els.targetLang.value : els.sourceLang.value;
}

function updateLatestPanelLabels(speaker, from, to) {
  if (state.workMode !== "two-way") {
    els.sourcePanelLabel.textContent = "原文";
    els.targetPanelLabel.textContent = "译文";
    return;
  }
  els.sourcePanelLabel.textContent = `用户 ${speaker.toUpperCase()} · ${languageName(from)}原话`;
  els.targetPanelLabel.textContent = `${languageName(to)}译文`;
}

function sendSpeechPreamble(turn, locale, format = "simple") {
  sendTextFrame(turn, "speech.config", {
    context: {
      system: { name: "SpeechSDK", version: "1.42.0", build: "JavaScript", lang: "JavaScript" },
      os: { platform: navigator.platform || "Browser", name: navigator.userAgent, version: "" },
      audio: { source: { connectivity: "Unknown", manufacturer: "Browser", model: "Microphone", type: "Microphones" } }
    }
  });
  sendTextFrame(turn, "speech.context", {
    speech: {
      language: locale,
      format,
      recognition: { mode: "Interactive", profanity: "Raw" }
    }
  });
}

function sendTextFrame(turn, path, body) {
  if (turn.ws.readyState !== WebSocket.OPEN) return;
  const headers = protocolHeaders(turn, path, "application/json; charset=utf-8");
  turn.ws.send(`${headers}\r\n${JSON.stringify(body)}`);
}

function sendAudioFrame(turn, payload) {
  if (turn.ws.readyState !== WebSocket.OPEN || turn.ws.bufferedAmount > 1024 * 1024) return;
  const headerBytes = new TextEncoder().encode(protocolHeaders(turn, "audio", "audio/x-wav"));
  const audioBytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  const frame = new Uint8Array(2 + headerBytes.length + audioBytes.length);
  new DataView(frame.buffer).setUint16(0, headerBytes.length, false);
  frame.set(headerBytes, 2);
  frame.set(audioBytes, 2 + headerBytes.length);
  turn.ws.send(frame.buffer);
}

function protocolHeaders(turn, path, contentType) {
  return [
    `Path: ${path}`,
    `X-RequestId: ${turn.requestId}`,
    `X-Timestamp: ${new Date().toISOString()}`,
    `X-ConnectionId: ${turn.connectionId}`,
    `Content-Type: ${contentType}`,
    ""
  ].join("\r\n");
}

function parseSpeechProtocolMessage(message) {
  const separator = message.indexOf("\r\n\r\n");
  const headerText = separator >= 0 ? message.slice(0, separator) : message;
  const bodyText = separator >= 0 ? message.slice(separator + 4).trim() : "";
  const headers = {};
  for (const line of headerText.split("\r\n")) {
    const colon = line.indexOf(":");
    if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  let body = {};
  if (bodyText) {
    try { body = JSON.parse(bodyText); } catch { body = {}; }
  }
  return { path: headers.path || "", headers, body };
}

async function startAudioCapture(outputSampleRate) {
  if (state.audioContext) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error("浏览器不支持 AudioContext");
  if (!state.micStream?.active) throw new Error("麦克风流已停止");

  try {
    state.audioContext = new AudioContextClass({
      sampleRate: outputSampleRate,
      latencyHint: "interactive"
    });
  } catch {
    state.audioContext = new AudioContextClass({ latencyHint: "interactive" });
  }
  state.audioOutputSampleRate = outputSampleRate;
  if (state.audioContext.state === "suspended") await state.audioContext.resume();
  state.mediaSource = state.audioContext.createMediaStreamSource(state.micStream);
  state.audioFilter = state.audioContext.createBiquadFilter();
  state.audioFilter.type = "highpass";
  state.audioFilter.frequency.value = 80;
  state.audioFilter.Q.value = 0.7;
  state.audioProcessor = state.audioContext.createScriptProcessor(2048, 1, 1);
  state.muteNode = state.audioContext.createGain();
  state.muteNode.gain.value = 0;

  state.audioProcessor.onaudioprocess = (event) => {
    if (!state.listening || !state.audioContext) return;
    const samples = event.inputBuffer.getChannelData(0);
    const voiceState = recordLocalSpeechActivity(samples);
    const pcm = downsampleToPcm16(samples, state.audioContext.sampleRate, state.audioOutputSampleRate);
    if (!pcm.byteLength) return;
    const group = state.turn;
    if (voiceState.active && group) {
      group.voiceActiveFrames = (group.voiceActiveFrames || 0) + 1;
      group.voiceActiveMs = (group.voiceActiveMs || 0)
        + samples.length / state.audioContext.sampleRate * 1000;
    }
    const frames = gateAudioFrames(pcm, voiceState);
    if (group?.audioStarted) {
      for (const frame of frames) {
        for (const recognizer of group.recognizers) {
          if (recognizer.ws.readyState === WebSocket.OPEN) {
            sendAudioFrame(recognizer, frame);
          }
        }
      }
      return;
    }
    for (const frame of frames) bufferAudioFrame(frame);
  };

  state.mediaSource.connect(state.audioFilter);
  state.audioFilter.connect(state.audioProcessor);
  state.audioProcessor.connect(state.muteNode);
  state.muteNode.connect(state.audioContext.destination);
}

function recordLocalSpeechActivity(samples) {
  if (!samples.length) return { active: false, forward: false };
  let sumSquares = 0;
  let peak = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const amplitude = Math.abs(samples[index]);
    sumSquares += amplitude * amplitude;
    if (amplitude > peak) peak = amplitude;
  }
  const rms = Math.sqrt(sumSquares / samples.length);
  const playbackRmsBoost = state.speaking ? 1.35 : 1;
  const playbackPeakBoost = state.speaking ? 1.25 : 1;
  const rmsThreshold = Math.max(0.0085, Math.min(0.03, state.noiseFloor * 3.2)) * playbackRmsBoost;
  const peakThreshold = Math.max(0.03, Math.min(0.1, state.noiseFloor * 8)) * playbackPeakBoost;
  const voiceActive = rms >= rmsThreshold && peak >= peakThreshold;
  const level = Math.min(1, rms / Math.max(0.025, rmsThreshold * 3.2));
  const wasGateOpen = state.voiceGateOpen;

  if (voiceActive) {
    state.voiceActiveFrames += 1;
    state.voiceSilenceFrames = 0;
    if (state.voiceActiveFrames >= VAD_ONSET_FRAMES) state.voiceGateOpen = true;
    const now = performance.now();
    state.lastVoiceActivityAt = now;
    if (!state.speechStartedAt) state.speechStartedAt = now;
    if (state.pendingSpeech) state.pendingSpeech.lastActivityAt = now;
    setMicState(state.speaking ? "播报中检测到用户讲话" : "检测到讲话", level);
  } else {
    state.voiceActiveFrames = 0;
    if (state.voiceGateOpen) {
      state.voiceSilenceFrames += 1;
      if (state.voiceSilenceFrames >= VAD_RELEASE_FRAMES) state.voiceGateOpen = false;
    }
    if (!state.speaking) {
      state.noiseFloor = Math.max(0.0015, Math.min(0.018, state.noiseFloor * 0.965 + rms * 0.035));
    }
    setMicState(state.speaking ? "播报回声抑制中" : state.listening ? "正在监听" : "麦克风待命", level);
  }
  return {
    active: voiceActive,
    forward: state.voiceGateOpen && voiceActive,
    openedNow: !wasGateOpen && state.voiceGateOpen
  };
}

function gateAudioFrames(pcm, voiceState) {
  if (voiceState.openedNow) {
    const frames = [...state.vadPreRoll, pcm];
    state.vadPreRoll = [];
    return frames;
  }
  if (voiceState.forward) {
    state.vadPreRoll = [];
    return [pcm];
  }
  if (voiceState.active) {
    state.vadPreRoll.push(pcm.slice());
    state.vadPreRoll = state.vadPreRoll.slice(-VAD_PRE_ROLL_FRAMES);
    return [];
  }
  state.vadPreRoll = [];
  return [new Uint8Array(pcm.byteLength)];
}

function bufferAudioFrame(pcm) {
  const copy = pcm.slice();
  state.audioPrebuffer.push(copy);
  state.audioPrebufferBytes += copy.byteLength;
  const maxBytes = Math.floor(state.audioOutputSampleRate * 2 * AUDIO_PREBUFFER_SECONDS);
  while (state.audioPrebufferBytes > maxBytes && state.audioPrebuffer.length > 1) {
    state.audioPrebufferBytes -= state.audioPrebuffer.shift().byteLength;
  }
}

function flushAudioPrebuffer(group) {
  const chunks = state.audioPrebuffer;
  clearAudioPrebuffer();
  for (const pcm of chunks) {
    for (const recognizer of group.recognizers) {
      if (recognizer.ws.readyState === WebSocket.OPEN) sendAudioFrame(recognizer, pcm);
    }
  }
}

function clearAudioPrebuffer() {
  state.audioPrebuffer = [];
  state.audioPrebufferBytes = 0;
  state.vadPreRoll = [];
}

function stopAudioCapture() {
  if (state.audioProcessor) {
    state.audioProcessor.onaudioprocess = null;
    try { state.audioProcessor.disconnect(); } catch {}
    state.audioProcessor = null;
  }
  if (state.mediaSource) {
    try { state.mediaSource.disconnect(); } catch {}
    state.mediaSource = null;
  }
  if (state.audioFilter) {
    try { state.audioFilter.disconnect(); } catch {}
    state.audioFilter = null;
  }
  if (state.muteNode) {
    try { state.muteNode.disconnect(); } catch {}
    state.muteNode = null;
  }
  if (state.audioContext) {
    const context = state.audioContext;
    state.audioContext = null;
    context.close().catch(() => {});
  }
  clearAudioPrebuffer();
}

function disposeTurn(group, sendEnd = false) {
  if (!group) return;
  group.finalizing = true;
  window.clearTimeout(group.openTimer);
  window.clearTimeout(group.arbitrationTimer);
  if (state.turn === group) state.turn = null;
  for (const recognizer of group.recognizers || []) {
    try {
      if (recognizer.ws.readyState === WebSocket.OPEN) {
        if (sendEnd) sendAudioFrame(recognizer, new Uint8Array());
        recognizer.ws.close(1000, "turn complete");
      } else if (recognizer.ws.readyState === WebSocket.CONNECTING) {
        recognizer.ws.close();
      }
    } catch {}
  }
}

function scheduleNextTurn(delay) {
  window.clearTimeout(state.restartTimer);
  if (!state.listening) return;
  state.restartTimer = window.setTimeout(() => {
    startSpeechTurn().catch(async (error) => {
      showError(`语音识别重启失败：${error.message}`);
      await stopListening({ keepStatus: true });
    });
  }, delay);
}

async function stopListening({ keepStatus = false } = {}) {
  if (state.pendingSpeech) {
    state.committedSource = state.workMode === "two-way"
      ? state.pendingSpeech.text
      : appendSegment(state.committedSource, state.pendingSpeech.text, state.pendingSpeech.from);
  }
  state.listening = false;
  state.finalizingTurn = false;
  state.speechStartedAt = 0;
  state.lastVoiceActivityAt = 0;
  state.voiceActiveFrames = 0;
  state.voiceSilenceFrames = 0;
  state.voiceGateOpen = false;
  state.turnSerial += 1;
  window.clearTimeout(state.restartTimer);
  window.clearTimeout(state.pendingSpeechTimer);
  state.pendingSpeechTimer = 0;
  state.pendingSpeech = null;
  if (state.turn) disposeTurn(state.turn, true);
  stopAudioCapture();
  if (state.micStream) {
    for (const track of state.micStream.getTracks()) track.stop();
    state.micStream = null;
  }
  state.interimSource = "";
  els.sourceText.value = state.committedSource;
  els.sourceText.readOnly = false;
  updateControls();
  setSessionStage("idle", "等待开始");
  setSemanticState("等待完整语句");
  setMicState("麦克风待命", 0);
  if (els.liveSpeakerState) els.liveSpeakerState.textContent = "尚未检测到语音";
  if (!state.speaking && els.playbackState) els.playbackState.textContent = "等待译文";
  setEngineState("Bing 网页引擎", "ready");
  if (!keepStatus) setStatus("");
}

async function speakText(text, lang, voiceName = "", playbackContext = {}) {
  const cleaned = String(text || "").trim();
  if (!cleaned || state.speaking) return;
  setStatus("正在播报，同时继续识别用户语音…", "busy");
  setSessionStage("speak", "播报译文");
  setSemanticState("全双工监听 · 自动过滤播放器回声");
  try {
    await playSpeech(cleaned, lang, voiceName, playbackContext);
  } catch (error) {
    showError(`播报失败：${error.message}`);
  } finally {
    if (!state.listening) {
      setStatus("");
    }
  }
}

async function playSpeech(text, lang, voiceName = "", playbackContext = {}) {
  stopPlayback();
  const playbackReference = {
    text,
    language: lang,
    active: true,
    expiresAt: Number.POSITIVE_INFINITY
  };
  state.playbackReference = playbackReference;
  state.speaking = true;
  setMicState("播报回声抑制中", 0);
  if (els.playbackState) els.playbackState.textContent = "正在朗读 · 译文同步高亮";
  try {
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, lang, voiceName, rate: 0.8 })
    });
    if (response.ok) {
      const blob = await response.blob();
      await playAudioBlob(blob, text, playbackContext);
      return;
    }
    await browserSpeech(text, lang, playbackContext);
  } catch {
    await browserSpeech(text, lang, playbackContext);
  } finally {
    endPlaybackHighlight();
    clearAudioPrebuffer();
    state.speaking = false;
    setMicState(state.listening ? "正在监听" : "麦克风待命", 0);
    if (els.playbackState) els.playbackState.textContent = "播报完成";
    if (state.playbackReference === playbackReference) {
      playbackReference.active = false;
      playbackReference.expiresAt = performance.now() + PLAYBACK_ECHO_GUARD_MS;
    }
  }
}

function playAudioBlob(blob, text, playbackContext) {
  return new Promise((resolve, reject) => {
    state.currentAudioUrl = URL.createObjectURL(blob);
    const audio = new Audio(state.currentAudioUrl);
    state.currentAudio = audio;
    startPlaybackHighlight(text, playbackContext);
    let settled = false;
    const updateProgress = () => {
      if (settled || state.currentAudio !== audio) return;
      const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
      if (duration) {
        const adjustedDuration = Math.max(0.1, duration - 0.28);
        const progress = Math.max(0, Math.min(1, (audio.currentTime - 0.12) / adjustedDuration));
        updatePlaybackHighlight(Math.floor(text.length * progress));
      }
      state.playbackAnimation = window.requestAnimationFrame(updateProgress);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      window.cancelAnimationFrame(state.playbackAnimation);
      state.playbackAnimation = 0;
      if (!error) updatePlaybackHighlight(text.length);
      if (state.currentAudio === audio) state.currentAudio = null;
      if (state.currentAudioFinish === finish) state.currentAudioFinish = null;
      if (state.currentAudioUrl) {
        URL.revokeObjectURL(state.currentAudioUrl);
        state.currentAudioUrl = "";
      }
      if (error) reject(error); else resolve();
    };
    state.currentAudioFinish = finish;
    audio.onended = () => finish();
    audio.onerror = () => finish(new Error("音频文件无法播放"));
    audio.play().then(updateProgress).catch(finish);
  });
}

function browserSpeech(text, lang, playbackContext = {}) {
  return new Promise((resolve, reject) => {
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
      reject(new Error("Bing TTS 与浏览器播报均不可用"));
      return;
    }
    window.speechSynthesis.cancel();
    startPlaybackHighlight(text, playbackContext);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = languageLocale(lang);
    utterance.rate = 0.9;
    const browserVoice = window.speechSynthesis.getVoices().find((voice) =>
      voice.lang.toLowerCase() === utterance.lang.toLowerCase()
      || voice.lang.toLowerCase().startsWith(utterance.lang.split("-")[0].toLowerCase())
    );
    if (browserVoice) utterance.voice = browserVoice;
    const timeout = window.setTimeout(() => {
      window.speechSynthesis.cancel();
      resolve();
    }, Math.min(120000, Math.max(15000, text.length * 450)));
    utterance.onboundary = (event) => {
      if (Number.isFinite(event.charIndex)) {
        updatePlaybackHighlight(event.charIndex + Math.max(1, event.charLength || 1));
      }
    };
    utterance.onend = () => {
      window.clearTimeout(timeout);
      updatePlaybackHighlight(text.length);
      resolve();
    };
    utterance.onerror = (event) => {
      window.clearTimeout(timeout);
      if (event.error === "canceled" || event.error === "interrupted") resolve();
      else reject(new Error(`浏览器播报错误：${event.error}`));
    };
    window.speechSynthesis.speak(utterance);
  });
}

function startPlaybackHighlight(text, context = {}) {
  endPlaybackHighlight();
  const targets = [];
  if (context.highlightCurrent && els.targetText.textContent.trim() === text.trim()) {
    targets.push(els.targetText);
  }
  if (context.entryId) {
    const entry = els.conversationLog.querySelector(`[data-entry-id="${context.entryId}"]`);
    const translation = entry?.querySelector(".conversation-translation");
    if (translation) targets.push(translation);
    entry?.classList.add("is-playing");
  }
  if (!targets.length) return;

  const renderedTargets = targets.map((target) => renderHighlightTokens(target, text));
  state.playbackHighlight = {
    text,
    entryId: context.entryId || null,
    targets: renderedTargets
  };
  updatePlaybackHighlight(0);
}

function renderHighlightTokens(target, text) {
  const fragment = document.createDocumentFragment();
  const tokens = [];
  const pattern = /\s+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|./gu;
  let match;
  while ((match = pattern.exec(text))) {
    const value = match[0];
    if (/^\s+$/.test(value)) {
      fragment.append(document.createTextNode(value));
      continue;
    }
    const span = document.createElement("span");
    span.className = "speech-word";
    span.textContent = value;
    span.dataset.start = String(match.index);
    span.dataset.end = String(match.index + value.length);
    tokens.push(span);
    fragment.append(span);
  }
  target.replaceChildren(fragment);
  return { target, tokens };
}

function updatePlaybackHighlight(characterIndex) {
  const highlight = state.playbackHighlight;
  if (!highlight) return;
  for (const rendered of highlight.targets) {
    for (const token of rendered.tokens) {
      const start = Number(token.dataset.start);
      const end = Number(token.dataset.end);
      token.classList.toggle("is-spoken", end <= characterIndex);
      token.classList.toggle("is-speaking", start <= characterIndex && characterIndex < end);
    }
  }
}

function endPlaybackHighlight() {
  window.cancelAnimationFrame(state.playbackAnimation);
  state.playbackAnimation = 0;
  const highlight = state.playbackHighlight;
  if (!highlight) return;
  for (const rendered of highlight.targets) {
    if (rendered.target.isConnected) rendered.target.textContent = highlight.text;
  }
  if (highlight.entryId) {
    els.conversationLog
      .querySelector(`[data-entry-id="${highlight.entryId}"]`)
      ?.classList.remove("is-playing");
  }
  state.playbackHighlight = null;
}

function stopPlayback() {
  if (state.currentAudio) {
    state.currentAudio.pause();
    state.currentAudio.removeAttribute("src");
  }
  if (state.currentAudioFinish) {
    state.currentAudioFinish();
  } else if (state.currentAudioUrl) {
    URL.revokeObjectURL(state.currentAudioUrl);
    state.currentAudioUrl = "";
  }
  state.currentAudio = null;
  state.currentAudioFinish = null;
  window.speechSynthesis?.cancel();
  endPlaybackHighlight();
  if (state.playbackReference?.active) {
    state.playbackReference.active = false;
    state.playbackReference.expiresAt = performance.now() + PLAYBACK_ECHO_GUARD_MS;
  }
  state.speaking = false;
}

function copyCurrentTranslation() {
  const text = els.targetText.textContent.trim();
  if (text) copyText(text, "译文已复制");
}

async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    announce(successMessage);
    setStatus(successMessage, "success");
    window.setTimeout(() => {
      if (els.statusBar.textContent === successMessage) setStatus("");
    }, 1400);
  } catch {
    showError("无法写入剪贴板，请检查浏览器权限。");
  }
}

function updateSpeechAvailability() {
  const sides = recognitionSides();
  const expectedSides = state.workMode === "two-way" && state.speakerMode === "auto" ? 2 : 1;
  const supported = Boolean(
    window.isSecureContext
    && navigator.mediaDevices?.getUserMedia
    && sides.length === expectedSides
  );
  els.listenButton.disabled = !supported && !state.listening;
  let title = "";
  if (!window.isSecureContext) {
    title = "麦克风需要 HTTPS";
  } else if (state.workMode === "two-way" && els.sourceLang.value === els.targetLang.value) {
    title = "用户 A 和用户 B 需要选择不同语言";
  } else if (els.sourceLang.value === "auto-detect") {
    title = "语音输入需要明确选择用户 A 的语言";
  } else if (sides.length !== expectedSides) {
    title = state.workMode === "two-way" && state.speakerMode === "auto"
      ? "自动模式要求用户 A 和用户 B 的语言都支持语音识别"
      : "当前识别方的语言不支持语音输入";
  } else if (state.listening) {
    title = "停止实时识别";
  } else if (state.workMode === "two-way") {
    title = state.speakerMode === "auto"
      ? "开始双向自动识别"
      : `开始识别用户 ${state.speakerMode.toUpperCase()}`;
  } else {
    title = "开始实时识别";
  }
  els.listenButton.title = title;
  els.listenButton.setAttribute("aria-label", title);
}

function updateControls() {
  els.listenButton.classList.toggle("recording", state.listening);
  els.listenButton.setAttribute("aria-pressed", String(state.listening));
  if (els.listenButtonText) {
    els.listenButtonText.textContent = state.listening ? "停止同声传译" : "开始同声传译";
  }
  els.listenButton.querySelector(".mic-start")?.classList.toggle("hidden", state.listening);
  els.listenButton.querySelector(".mic-stop")?.classList.toggle("hidden", !state.listening);
  els.sourceLang.disabled = state.listening;
  els.targetLang.disabled = state.listening;
  els.swapLangs.disabled = state.listening;
  for (const button of els.workMode.querySelectorAll("button")) button.disabled = state.listening;
  for (const button of els.speakerMode.querySelectorAll("button")) button.disabled = state.listening;
  updateSpeechAvailability();
  updateTextControls();
}

function updateTextControls() {
  const length = els.sourceText.value.length;
  els.charCount.textContent = `${length} / 5000`;
  els.clearText.classList.toggle("hidden", length === 0 && !els.targetText.textContent);
  els.speakSource.disabled = !els.sourceText.value.trim();
  els.speakTarget.disabled = !els.targetText.textContent.trim();
  els.copyTarget.disabled = !els.targetText.textContent.trim();
}

function effectiveSourceLanguage() {
  return els.sourceLang.value === "auto-detect" ? (state.detectedLanguage || "en") : els.sourceLang.value;
}

function phrasebookSourceLanguage() {
  return els.sourceLang.value === "auto-detect" ? (state.detectedLanguage || "en") : els.sourceLang.value;
}

function languageLocale(code) {
  const language = state.languages.find((item) => item.code === code);
  if (language?.speechLocale) return language.speechLocale;
  const fallbacks = { "zh-Hans": "zh-CN", "zh-Hant": "zh-TW", yue: "zh-HK", en: "en-US" };
  return fallbacks[code] || code || "en-US";
}

function appendSegment(existing, segment, lang) {
  return appendSpeechSegment(existing, segment, lang);
}

function makeWavHeader(sampleRate) {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 0, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, 0, true);
  return new Uint8Array(buffer);
}

function writeAscii(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

function downsampleToPcm16(input, inputRate, outputRate) {
  if (!input.length) return new Uint8Array();
  const ratio = inputRate / outputRate;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const buffer = new ArrayBuffer(outputLength * 2);
  const view = new DataView(buffer);
  for (let index = 0; index < outputLength; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.max(start + 1, Math.min(input.length, Math.floor((index + 1) * ratio)));
    let sum = 0;
    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) sum += input[sampleIndex];
    const sample = Math.max(-1, Math.min(1, sum / (end - start)));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

function compactUuid() {
  if (crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "").toUpperCase();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function setTransliteration(element, text) {
  element.textContent = text;
  element.classList.toggle("hidden", !text);
}

function hideDictionary() {
  els.dictionarySection.classList.add("hidden");
  els.dictionaryResults.replaceChildren();
}

function setSessionStage(stage, message) {
  if (!els.pipelineState) return;
  els.pipelineState.dataset.stage = stage;
  const label = els.pipelineState.querySelector("span:last-child");
  if (label) label.textContent = message;
  const order = ["listen", "confirm", "translate", "speak"];
  const activeIndex = order.indexOf(stage);
  for (const item of document.querySelectorAll("[data-pipeline-step]")) {
    const index = order.indexOf(item.dataset.pipelineStep);
    item.classList.toggle("active", index === activeIndex);
    item.classList.toggle("complete", activeIndex > index && activeIndex >= 0);
  }
}

function setSemanticState(message) {
  if (els.semanticState) els.semanticState.textContent = message;
}

function setMicState(message, level = 0) {
  if (els.micState && els.micState.textContent !== message) els.micState.textContent = message;
  if (els.micMeterFill) {
    els.micMeterFill.style.width = `${Math.round(Math.max(0, Math.min(1, level)) * 100)}%`;
  }
}

function setStatus(message, mode = "") {
  els.statusBar.textContent = message;
  els.statusBar.className = message ? `status-bar ${mode}`.trim() : "status-bar hidden";
  if (message) announce(message);
}

function showError(message) {
  els.errorBar.textContent = message;
  els.errorBar.classList.remove("hidden");
  announce(message);
}

function hideError() {
  els.errorBar.textContent = "";
  els.errorBar.classList.add("hidden");
}

function setEngineState(text, mode) {
  els.engineState.textContent = text;
  els.engineState.dataset.state = mode;
}

function announce(message) {
  els.ariaLive.textContent = "";
  window.setTimeout(() => { els.ariaLive.textContent = message; }, 10);
}

function optionExists(select, value) {
  return Boolean(value && [...select.options].some((option) => option.value === value));
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function postJson(url, body, signal) {
  return fetchJson(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
