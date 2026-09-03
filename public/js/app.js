/**
 * 主应用入口 — 初始化所有模块、绑定事件
 */

/* ---------- 全局状态 ---------- */
let sourceLang = 'auto';
let targetLang = 'zh-CN';
let translateTimer = null;
let translationController = null;
let translationRequestId = 0;
let learningController = null;
let lastTranslationSnapshot = null;
const DEBOUNCE_MS = 400;

/* ---------- 初始化 ---------- */
document.addEventListener('DOMContentLoaded', () => {
  /* 加载用户偏好 */
  sourceLang = localStorage.getItem('translate_sl') || 'auto';
  targetLang = localStorage.getItem('translate_tl') || 'zh-CN';

  /* 应用 i18n */
  applyI18n();

  /* 初始化子模块 */
  initTabs();
  initImageUpload();
  initDocumentUpload();
  initCameraTranslation();
  initInterpreterUI();

  /* 绑定核心事件 */
  bindTranslationEvents();
  bindLanguageSelectors();
  bindToolbarActions();
  bindSettingsPanel();
  bindHistoryPanel();
  bindTheme();

  /* 更新语言按钮显示 */
  updateLangButtons();

  /* 注册 PWA Service Worker */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js?v=29', { updateViaCache: 'none' }).catch(() => {});
  }
});

/* ---------- 翻译事件 ---------- */

function bindTranslationEvents() {
  const sourceText = document.getElementById('sourceText');
  const charCount = document.getElementById('charCount');

  if (!sourceText) return;

  sourceText.addEventListener('input', () => {
    const text = sourceText.value;
    translationController?.abort();
    learningController?.abort();
    translationRequestId += 1;
    lastTranslationSnapshot = null;

    /* 字符计数 */
    if (charCount) {
      charCount.textContent = `${text.length}/5000`;
      charCount.classList.toggle('over', text.length > 5000);
    }

    /* 防抖翻译 */
    clearTimeout(translateTimer);
    if (!text.trim()) {
      document.getElementById('targetText').textContent = '';
      document.getElementById('engineBadge').style.display = 'none';
      const learnCard = document.getElementById('learnCard');
      if (learnCard) {
        learnCard.replaceChildren();
        learnCard.style.display = 'none';
      }
      const detectedLabel = document.getElementById('detectedLangLabel');
      if (detectedLabel) detectedLabel.style.display = 'none';
      return;
    }

    translateTimer = setTimeout(() => doTranslate(), DEBOUNCE_MS);
  });

  /* 清空按钮 */
  const clearBtn = document.getElementById('clearSourceBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      sourceText.value = '';
      sourceText.dispatchEvent(new Event('input'));
      sourceText.focus();
    });
  }

  /* 原文对照译文高亮 */
  const updateHighlightFromTextarea = () => {
    const targetText = document.getElementById('targetText');
    if (targetText && targetText.querySelector('.trans-interactive-line')) {
      const currentLine = getTextareaLineNumber(sourceText);
      highlightTargetLine(currentLine);
    }
  };
  sourceText.addEventListener('click', updateHighlightFromTextarea);
  sourceText.addEventListener('keyup', updateHighlightFromTextarea);
  sourceText.addEventListener('focus', updateHighlightFromTextarea);

  const learnToggle = document.getElementById('learnModeToggle');
  if (learnToggle) {
    learnToggle.checked = localStorage.getItem('translate_learn_mode') === 'true';
    learnToggle.addEventListener('change', () => {
      try { localStorage.setItem('translate_learn_mode', String(learnToggle.checked)); } catch {}
      if (!learnToggle.checked) {
        learningController?.abort();
        const learnCard = document.getElementById('learnCard');
        if (learnCard) learnCard.style.display = 'none';
      } else if (lastTranslationSnapshot) {
        void loadLearningCard(lastTranslationSnapshot);
      }
    });
  }
}

// ===== 双向高亮辅助函数 =====
function getTextareaLineNumber(textarea) {
  const text = textarea.value;
  const selStart = textarea.selectionStart;
  return text.substring(0, selStart).split('\n').length - 1;
}

function selectTextareaLine(textarea, lineIndex) {
  const lines = textarea.value.split('\n');
  if (lineIndex < 0 || lineIndex >= lines.length) return;
  
  let start = 0;
  for (let i = 0; i < lineIndex; i++) {
    start += lines[i].length + 1; // +1 是换行符
  }
  const end = start + lines[lineIndex].length;
  
  textarea.focus();
  textarea.setSelectionRange(start, end);
  
  const lineHeight = 24; // 大致行高
  textarea.scrollTop = Math.max(0, (lineIndex - 2) * lineHeight);
}

function highlightTargetLine(lineIndex) {
  const targetText = document.getElementById('targetText');
  if (!targetText) return;
  
  const lines = targetText.querySelectorAll('.trans-interactive-line');
  if (lines.length === 0) return;
  
  targetText.classList.add('target-has-active');
  lines.forEach(l => {
    const idx = parseInt(l.dataset.line);
    if (idx === lineIndex) {
      l.classList.add('active-line');
    } else {
      l.classList.remove('active-line');
    }
  });
}

async function doTranslate() {
  const sourceText = document.getElementById('sourceText');
  const targetText = document.getElementById('targetText');
  const engineBadge = document.getElementById('engineBadge');
  const text = sourceText?.value?.trim();

  if (!text || !targetText) return;

  const requestId = ++translationRequestId;
  translationController?.abort();
  learningController?.abort();
  const controller = new AbortController();
  translationController = controller;
  const requestSnapshot = { text, sourceLang, targetLang };

  /* 显示加载状态 */
  targetText.classList.add('loading');
  targetText.setAttribute('aria-busy', 'true');

  try {
    const result = await translateText(text, sourceLang, targetLang, { signal: controller.signal });
    if (requestId !== translationRequestId || controller.signal.aborted ||
        sourceText.value.trim() !== requestSnapshot.text || sourceLang !== requestSnapshot.sourceLang ||
        targetLang !== requestSnapshot.targetLang) return;

    // 渲染成交互式多行 DOM
    const lines = result.translatedText.split('\n');
    targetText.innerHTML = lines.map((line, idx) => {
      const escaped = line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return `<div class="trans-interactive-line" data-line="${idx}">${escaped || '&nbsp;'}</div>`;
    }).join('');
    targetText.classList.remove('loading');
    targetText.setAttribute('aria-busy', 'false');

    // 绑定点击事件，实现“点击译文高亮原文”
    targetText.querySelectorAll('.trans-interactive-line').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const lineIdx = parseInt(el.dataset.line);
        highlightTargetLine(lineIdx);
        selectTextareaLine(sourceText, lineIdx);
      });
    });

    /* 显示引擎标识 */
    if (engineBadge) {
      engineBadge.textContent = translationEngineLabel(result);
      engineBadge.className = `engine-badge engine-${result.engine}`;
      engineBadge.style.display = 'inline-block';
    }

    /* 更新检测到的语言 */
    if (sourceLang === 'auto' && result.detectedLanguage) {
      const detectedBtn = document.getElementById('detectedLangLabel');
      if (detectedBtn) {
        const langName = getLanguageName(result.detectedLanguage);
        detectedBtn.textContent = `${__t('detectLanguage')} — ${langName}`;
        detectedBtn.style.display = 'inline';
      }
    }

    /* 添加到历史 */
    try {
      addHistory({
        text: text.substring(0, 200),
        translatedText: result.translatedText.substring(0, 200),
        sl: result.detectedLanguage || sourceLang,
        tl: targetLang,
        engine: result.engine,
      });
    } catch (storageError) {
      console.warn('Translation history could not be saved:', storageError);
    }

    /* ===== 学习模式 ===== */
    lastTranslationSnapshot = { text, result, sourceLang: requestSnapshot.sourceLang, targetLang: requestSnapshot.targetLang, requestId };
    void loadLearningCard(lastTranslationSnapshot);

  } catch (e) {
    if (e.name === 'AbortError' || requestId !== translationRequestId) return;
    targetText.textContent = __t('errorTranslation');
    targetText.classList.remove('loading');
    targetText.setAttribute('aria-busy', 'false');
    targetText.classList.add('error');
    setTimeout(() => targetText.classList.remove('error'), 2000);
    // 学习模式出错时隐藏卡片
    const learnCard = document.getElementById('learnCard');
    if (learnCard) learnCard.style.display = 'none';
  } finally {
    if (translationController === controller) translationController = null;
  }
}

function translationEngineLabel(result) {
  const engine = String(result?.provider || result?.engine || '').toLowerCase();
  if (engine.includes('microsoft')) return 'Microsoft';
  if (engine.includes('google')) return 'Google';
  if (engine.includes('bing')) return 'Bing';
  if (engine.includes('cloudflare') || engine.includes('cf')) return 'Cloudflare AI';
  return 'Auto';
}

async function loadLearningCard(snapshot) {
  const learnCard = document.getElementById('learnCard');
  const enabled = document.getElementById('learnModeToggle')?.checked;
  if (!learnCard || !enabled || !snapshot || snapshot.text.length > 80) {
    if (learnCard) learnCard.style.display = 'none';
    return;
  }

  learningController?.abort();
  const controller = new AbortController();
  learningController = controller;
  learnCard.className = 'learn-card is-loading';
  learnCard.textContent = '正在整理学习内容…';
  learnCard.style.display = 'block';
  try {
    const details = await fetchLearningDetails(
      snapshot.text,
      snapshot.result.detectedLanguage || snapshot.sourceLang,
      snapshot.targetLang,
      snapshot.result.translatedText,
      { signal: controller.signal },
    );
    if (controller.signal.aborted || snapshot.requestId !== translationRequestId ||
        lastTranslationSnapshot !== snapshot) return;
    renderLearnCard(snapshot.text, { ...snapshot.result, ...details });
  } catch (error) {
    if (error.name === 'AbortError') return;
    console.warn('Learning details unavailable:', error);
    learnCard.className = 'learn-card is-empty';
    learnCard.textContent = '学习内容暂时不可用，基础翻译不受影响。';
    learnCard.style.display = 'block';
  } finally {
    if (learningController === controller) learningController = null;
  }
}

/**
 * 渲染学习卡片
 */
function renderLearnCard(text, result) {
  const learnCard = document.getElementById('learnCard');
  if (!learnCard) return;

  const isLearnMode = document.getElementById('learnModeToggle')?.checked;
  const isShortText = text.trim().length <= 80;

  // 非学习模式 或 文本过长 或 无词典数据 → 隐藏卡片
  if (!isLearnMode || !isShortText || (!result.dict?.length && !result.definitions?.length &&
      !result.examples?.length && !result.synonyms?.length)) {
    learnCard.style.display = 'none';
    return;
  }

  const inputWord = text.trim();
  const sl = result.detectedLanguage || sourceLang;

  let html = '';

  /* 1. 发音 + 单词展示行 */
  html += `<div class="learn-phonetic">
    <button class="learn-speak-btn" id="learnSpeakBtn" title="朗读发音">🔊</button>
    <span class="learn-word">${esc(inputWord)}</span>
    ${result.phonetic ? `<span class="learn-ipa">${esc(result.phonetic)}</span>` : ''}
  </div>`;

  /* 2. 词性 + 释义段 */
  if (result.dict && result.dict.length > 0) {
    result.dict.forEach(entry => {
      html += `<div class="learn-pos-section">`;
      if (entry.pos) {
        html += `<span class="learn-pos-tag">${esc(entry.pos)}</span>`;
      }
      if (entry.terms && entry.terms.length > 0) {
        html += `<div class="learn-terms">${entry.terms.map(t => esc(t)).join('、')}</div>`;
      }
      html += `</div>`;
    });
  }

  /* 3. 详细定义 */
  if (result.definitions && result.definitions.length > 0) {
    result.definitions.forEach(def => {
      html += `<div class="learn-pos-section">`;
      if (def.pos) {
        html += `<span class="learn-pos-tag">${esc(def.pos)} 定义</span>`;
      }
      (Array.isArray(def.meanings) ? def.meanings : []).forEach(m => {
        if (m.gloss) html += `<div class="learn-terms">📖 ${esc(m.gloss)}</div>`;
        if (m.example) html += `<div class="learn-example-item">💬 "${esc(m.example)}"</div>`;
      });
      html += `</div>`;
    });
  }

  /* 4. 例句 */
  if (result.examples && result.examples.length > 0) {
    html += `<div class="learn-examples-title">📝 例句</div>`;
    result.examples.forEach(ex => {
      html += `<div class="learn-example-item">${esc(ex)}</div>`;
    });
  }

  /* 5. 同义词 */
  if (result.synonyms && result.synonyms.length > 0) {
    html += `<div class="learn-examples-title">🔗 同义词</div>`;
    html += `<div class="learn-synonyms">`;
    result.synonyms.forEach(s => {
      html += `<span class="learn-synonym-tag">${esc(s)}</span>`;
    });
    html += `</div>`;
  }

  learnCard.className = 'learn-card';
  learnCard.innerHTML = html;
  learnCard.style.display = 'block';

  /* 绑定发音按钮 */
  const speakBtn = document.getElementById('learnSpeakBtn');
  if (speakBtn) {
    speakBtn.addEventListener('click', () => {
      speakBtn.style.transform = 'scale(0.9)';
      setTimeout(() => { speakBtn.style.transform = 'scale(1)'; }, 150);
      if (window.speakText) window.speakText(inputWord, sl === 'auto' ? 'en' : sl);
    });
  }
}

/* HTML转义辅助 */
function esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ---------- 语言选择器 ---------- */

function bindLanguageSelectors() {
  const sourceBtn = document.getElementById('sourceLangBtn');
  const targetBtn = document.getElementById('targetLangBtn');
  const swapBtn = document.getElementById('swapLangBtn');

  if (sourceBtn) {
    sourceBtn.addEventListener('click', () => {
      openLanguageSelector('source', sourceLang, (code) => {
        sourceLang = code;
        localStorage.setItem('translate_sl', code);
        updateLangButtons();
        if (typeof updateInterpreterLabels === 'function') updateInterpreterLabels();
        /* 重新翻译 */
        const text = document.getElementById('sourceText')?.value;
        if (text?.trim()) doTranslate();
      });
    });
  }

  if (targetBtn) {
    targetBtn.addEventListener('click', () => {
      openLanguageSelector('target', targetLang, (code) => {
        targetLang = code;
        localStorage.setItem('translate_tl', code);
        updateLangButtons();
        if (typeof updateInterpreterLabels === 'function') updateInterpreterLabels();
        const text = document.getElementById('sourceText')?.value;
        if (text?.trim()) doTranslate();
      });
    });
  }

  if (swapBtn) {
    swapBtn.addEventListener('click', () => {
      if (sourceLang === 'auto') return;
      const tmp = sourceLang;
      sourceLang = targetLang;
      targetLang = tmp;
      localStorage.setItem('translate_sl', sourceLang);
      localStorage.setItem('translate_tl', targetLang);
      updateLangButtons();
      if (typeof updateInterpreterLabels === 'function') updateInterpreterLabels();

      /* 交换文本 */
      const srcEl = document.getElementById('sourceText');
      const tgtEl = document.getElementById('targetText');
      if (srcEl && tgtEl) {
        srcEl.value = tgtEl.textContent;
        srcEl.dispatchEvent(new Event('input'));
      }
    });
  }
}

function updateLangButtons() {
  const sourceBtn = document.getElementById('sourceLangBtn');
  const targetBtn = document.getElementById('targetLangBtn');
  if (sourceBtn) {
    sourceBtn.textContent = getLanguageName(sourceLang);
    sourceBtn.dataset.code = sourceLang;
  }
  if (targetBtn) {
    targetBtn.textContent = getLanguageName(targetLang);
    targetBtn.dataset.code = targetLang;
  }

  /* 隐藏检测标签 */
  const detectedLabel = document.getElementById('detectedLangLabel');
  if (detectedLabel) {
    detectedLabel.style.display = sourceLang === 'auto' ? 'inline' : 'none';
    if (sourceLang === 'auto') detectedLabel.textContent = __t('detectLanguage');
  }
}

/* ---------- 工具栏操作 ---------- */

function bindToolbarActions() {
  /* 复制译文 */
  const copyBtn = document.getElementById('copyTargetBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const text = document.getElementById('targetText')?.textContent;
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        showToast(__t('copied'));
      } catch { /* fallback */ }
    });
  }

  /* 朗读源文 */
  const listenSourceBtn = document.getElementById('listenSourceBtn');
  if (listenSourceBtn) {
    listenSourceBtn.addEventListener('click', () => {
      const text = document.getElementById('sourceText')?.value;
      const lang = sourceLang === 'auto' ? 'en' : sourceLang;
      if (text) speakText(text, lang);
    });
  }

  /* 朗读译文 */
  const listenTargetBtn = document.getElementById('listenTargetBtn');
  if (listenTargetBtn) {
    listenTargetBtn.addEventListener('click', () => {
      const text = document.getElementById('targetText')?.textContent;
      if (text) speakText(text, targetLang);
    });
  }
}

/* ---------- 设置面板 ---------- */

function bindSettingsPanel() {
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsPanel = document.getElementById('settingsPanel');
  const settingsClose = document.getElementById('settingsClose');

  if (settingsBtn && settingsPanel) {
    settingsBtn.addEventListener('click', () => {
      settingsPanel.classList.toggle('open');
    });
    if (settingsClose) {
      settingsClose.addEventListener('click', () => {
        settingsPanel.classList.remove('open');
      });
    }
  }

  /* 界面语言选择 */
  const uiLangSelect = document.getElementById('uiLangSelect');
  if (uiLangSelect) {
    uiLangSelect.value = window.__currentLocale;
    uiLangSelect.addEventListener('change', () => {
      setUILanguage(uiLangSelect.value);
      updateLangButtons();
      renderHistoryPanel();
    });
  }

  /* 翻译引擎选择 */
  const engineSelect = document.getElementById('engineSelect');
  if (engineSelect) {
    engineSelect.value = getEngine();
    engineSelect.addEventListener('change', () => {
      setEngine(engineSelect.value);
      /* 清除缓存，重新翻译 */
      TRANSLATE_CACHE.clear();
      const text = document.getElementById('sourceText')?.value;
      if (text?.trim()) doTranslate();
    });
  }
}

/* ---------- 历史面板 ---------- */

function bindHistoryPanel() {
  const historyBtn = document.getElementById('historyBtn');
  const historyPanel = document.getElementById('historyPanel');
  const historyClose = document.getElementById('historyClose');

  if (historyBtn && historyPanel) {
    historyBtn.addEventListener('click', () => {
      historyPanel.classList.toggle('open');
      if (historyPanel.classList.contains('open')) renderHistoryPanel();
    });
    if (historyClose) {
      historyClose.addEventListener('click', () => {
        historyPanel.classList.remove('open');
      });
    }
  }

  /* 历史/收藏切换 */
  const historyTabBtns = document.querySelectorAll('.history-tab-btn');
  historyTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      historyTabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const panel = document.getElementById('historyPanel');
      if (panel) panel.dataset.showFavorites = btn.dataset.type === 'favorites';
      renderHistoryPanel();
    });
  });

  /* 历史搜索 */
  const historySearch = document.getElementById('historySearch');
  if (historySearch) {
    historySearch.addEventListener('input', () => renderHistoryPanel());
  }

  /* 清空历史 */
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', () => {
      if (confirm(__t('clearHistory') + '?')) {
        clearHistory();
        renderHistoryPanel();
      }
    });
  }

  /* 历史列表事件委托 */
  const historyList = document.querySelector('.history-list');
  if (historyList) {
    historyList.addEventListener('click', (e) => {
      const item = e.target.closest('.history-item');
      if (!item) return;
      const id = item.dataset.id;

      if (e.target.closest('.history-use')) {
        /* 使用该翻译 */
        const h = getHistory().find(x => x.id === id);
        if (h) {
          document.getElementById('sourceText').value = h.text;
          sourceLang = h.sl;
          targetLang = h.tl;
          updateLangButtons();
          doTranslate();
          document.getElementById('historyPanel')?.classList.remove('open');
        }
      } else if (e.target.closest('.history-fav')) {
        toggleFavorite(id);
        renderHistoryPanel();
      } else if (e.target.closest('.history-del')) {
        deleteHistory(id);
        renderHistoryPanel();
      }
    });
  }
}

/* ---------- 主题切换 ---------- */

function bindTheme() {
  const saved = localStorage.getItem('translate_theme') || 'system';
  applyTheme(saved);

  const themeBtn = document.getElementById('themeBtn');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const current = localStorage.getItem('translate_theme') || 'system';
      const next = current === 'light' ? 'dark' : current === 'dark' ? 'system' : 'light';
      applyTheme(next);
      localStorage.setItem('translate_theme', next);
    });
  }
}

function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'dark') {
    root.setAttribute('data-theme', 'dark');
  } else if (mode === 'light') {
    root.setAttribute('data-theme', 'light');
  } else {
    root.removeAttribute('data-theme');
  }

  /* 更新主题图标 */
  const themeBtn = document.getElementById('themeBtn');
  if (themeBtn) {
    themeBtn.textContent = mode === 'dark' ? '🌙' : mode === 'light' ? '☀️' : '🌓';
  }
}

/* ---------- 同声传译 UI ---------- */

function initInterpreterUI() {
  /* 启动新的原生交替传译系统事件绑定 */
  if (typeof initInterpreter === 'function') {
    initInterpreter();
  }

  const exportBtn = document.getElementById('interpreterExportBtn');
  /* 导出对话 */
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      if (typeof exportInterpreterMessages === 'function') {
        const text = exportInterpreterMessages();
        if (!text) {
          showToast('暂无对话记录');
          return;
        }
        const blob = new Blob([text], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `interpretation_${new Date().toISOString().slice(0,10)}.txt`;
        a.click();
      }
    });
  }
}

/* ---------- Toast 提示 ---------- */

function showToast(msg, duration = 2000) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}
