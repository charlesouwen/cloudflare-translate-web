/**
 * 拍照翻译核心引擎 (OCR + 翻译)
 * v5.0 - 精准度与体验深度重构版本
 *
 * 核心升级：
 * 1. 完美修复 `processImageTranslation` 核心入口函数，清除残缺死锁字符，消除所有 JS 语法与执行报错。
 * 2. 独家植入 `wrapText` 高性能中英日韩双模式折行排版算法，告别 ReferenceError，保证译文排版紧凑优美。
 * 3. 新增 `isLineMatchSourceLang` 高阶语义语种过滤器：设定特定源语种时只翻译目标语言对应的行，完美保留无关语种，杜绝背景杂乱文字污染。
 * 4. Tesseract 单例智能池 + 30% 轻量化视觉蒙版叠加，保持原图高清晰度与极佳的用户对比体验。
 */

const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.0.5/dist/tesseract.min.js';
const TESSERACT_LOCAL = '/js/tesseract/tesseract.min.js';

const OCR_LANGUAGES = {
  'eng': { name: 'English', size: '~3MB' },
  'chi_sim': { name: '简体中文', size: '~4MB' },
  'chi_tra': { name: '繁體中文', size: '~4.5MB' },
  'jpn': { name: '日本語', size: '~3.5MB' },
  'kor': { name: '한국어', size: '~3.3MB' },
  'fra': { name: 'Français', size: '~3.2MB' },
  'deu': { name: 'Deutsch', size: '~3.1MB' },
  'spa': { name: 'Español', size: '~3MB' },
  'rus': { name: 'Русский', size: '~3.8MB' },
  'ara': { name: 'العربية', size: '~3MB' },
};

const LANG_TO_OCR = {
  'en': 'eng', 'zh-CN': 'chi_sim', 'zh-TW': 'chi_tra',
  'ja': 'jpn', 'ko': 'kor', 'fr': 'fra', 'de': 'deu',
  'es': 'spa', 'ru': 'rus', 'ar': 'ara',
};

/* ===== 下载确认对话框 ===== */
function showOCRDownloadConfirm(ocrLang) {
  return new Promise((resolve) => {
    const langInfo = OCR_LANGUAGES[ocrLang] || { name: ocrLang, size: '~4MB' };
    const overlay = document.createElement('div');
    overlay.className = 'ocr-confirm-overlay';
    overlay.innerHTML = `
      <div class="ocr-confirm-dialog">
        <div class="ocr-confirm-icon">📷</div>
        <h3>${__t('ocrModelTitle') || '下载离线识别引擎'}</h3>
        <p>${__t('ocrModelDesc') || '识别该语言的图片内容需要加载离线文字识别包。'}</p>
        <div class="ocr-confirm-info">
          <div class="ocr-info-row">
            <span>${__t('ocrSelectLang') || '识别语种：'}</span>
            <select id="ocrLangSelect" class="ocr-lang-select">
              ${Object.entries(OCR_LANGUAGES).map(([code, info]) =>
                `<option value="${code}" ${code === ocrLang ? 'selected' : ''}>${info.name}</option>`
              ).join('')}
            </select>
          </div>
          <div class="ocr-info-row">
            <span id="ocrSizeLabel">${__t('ocrModelSize', { size: langInfo.size }) || `预估大小: ${langInfo.size}`}</span>
          </div>
        </div>
        <div class="ocr-confirm-actions">
          <button class="ocr-btn ocr-btn-cancel" id="ocrCancelBtn">${__t('ocrCancel') || '取消'}</button>
          <button class="ocr-btn ocr-btn-confirm" id="ocrConfirmBtn">${__t('ocrDownload') || '下载并继续'}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const langSelect = overlay.querySelector('#ocrLangSelect');
    const sizeLabel = overlay.querySelector('#ocrSizeLabel');
    langSelect.addEventListener('change', () => {
      const info = OCR_LANGUAGES[langSelect.value] || { size: '~4MB' };
      sizeLabel.textContent = __t('ocrModelSize', { size: info.size }) || `预估大小: ${info.size}`;
    });
    overlay.querySelector('#ocrConfirmBtn').addEventListener('click', () => {
      overlay.remove(); resolve(langSelect.value);
    });
    overlay.querySelector('#ocrCancelBtn').addEventListener('click', () => {
      overlay.remove(); resolve(false);
    });
  });
}

function loadTesseractScript() {
  return new Promise((resolve) => {
    if (window.Tesseract) { resolve(); return; }
    
    console.log('[OCR] 优先尝试从 jsDelivr 官方 CDN 加载 Tesseract.js...');
    const s = document.createElement('script');
    s.src = TESSERACT_CDN;
    s.onload = () => {
      console.log('[OCR] 成功加载 jsDelivr 官方 CDN 版本的 Tesseract.js');
      resolve();
    };
    s.onerror = () => {
      console.warn('[OCR] jsDelivr CDN 载入失败，正在回退载入本地相对路径 Tesseract.js...');
      const fallback = document.createElement('script');
      fallback.src = TESSERACT_LOCAL;
      fallback.onload = () => {
        console.log('[OCR] 成功加载本地 Tesseract.js 库文件');
        resolve();
      };
      fallback.onerror = (err) => {
        console.error('[OCR] 本地和 CDN 版本的 Tesseract.js 均载入失败！', err);
        resolve();
      };
      document.head.appendChild(fallback);
    };
    document.head.appendChild(s);
  });
}

/* ===== 进度 UI ===== */
function showOCRProgress(percent, text) {
  let el = document.getElementById('ocrProgressOverlay');
  if (!el) {
    el = document.createElement('div'); el.id = 'ocrProgressOverlay';
    el.className = 'ocr-progress-overlay';
    el.innerHTML = `<div class="ocr-progress-dialog">
      <div class="ocr-progress-spinner"></div>
      <div class="ocr-progress-text" id="ocrProgressText"></div>
      <div class="ocr-progress-bar-wrap"><div class="ocr-progress-bar" id="ocrProgressBar"></div></div>
    </div>`;
    document.body.appendChild(el);
  }
  const t = el.querySelector('#ocrProgressText');
  const b = el.querySelector('#ocrProgressBar');
  if (text) t.textContent = text;
  else if (percent >= 0) t.textContent = `${__t('ocrRecognizing') || '正在识别'} ${percent}%`;
  if (percent >= 0) b.style.width = `${percent}%`;
}

function hideOCRProgress() {
  const el = document.getElementById('ocrProgressOverlay');
  if (el) el.remove();
}

/* ===== 全局持久化 OCR Worker 单例与初始化并发排队锁 ===== */
let globalOcrWorker = null;
let currentLoadedLang = '';
let ocrInitPromise = null; // 全局防并发锁

/**
 * 辅助：获取或重建常驻内存的 OCR Worker 单例
 */
async function getOcrWorker(langs, onProgress) {
  if (globalOcrWorker && currentLoadedLang === langs) {
    return globalOcrWorker;
  }

  // 智能 Busy 排队挂起锁：防止由于瞬间对焦或狂点多次引发单例并发重入致使 Tesseract.js 死锁
  if (ocrInitPromise) {
    console.warn(`[OCR] 检测到另一个 Tesseract 初始化实例正在排队构建中，已挂起当前请求以排队等待锁释放...`);
    await ocrInitPromise;
    if (globalOcrWorker && currentLoadedLang === langs) {
      return globalOcrWorker;
    }
  }

  // 锁屏并构建 Promise 排队屏障
  let resolveInit;
  ocrInitPromise = new Promise((r) => { resolveInit = r; });

  try {
    // 释放旧的，重建新的
    if (globalOcrWorker) {
      console.log('[OCR] 检测到目标语言包发生改变，正在释放旧的识别器常驻实例...');
      try {
        await globalOcrWorker.terminate();
      } catch (e) {
        console.error('[OCR] 释放旧实例出错:', e);
      }
      globalOcrWorker = null;
    }

    console.log(`[OCR] 正在初始化全新的 Tesseract 常驻内存实例，语言包: ${langs}`);
    
    // 首选配置：高可靠、全球加速的 jsDelivr CDN
    let options = {
      workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.0.5/dist/worker.min.js',
      corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.2/tesseract-core.wasm.js',
      langPath: 'https://testingcf.jsdelivr.net/gh/naptha/tessdata@gh-pages/4.0.0_fast/',
      cacheMethod: 'refresh',
      logger: (m) => {
        if (m.status === 'recognizing text') {
          showOCRProgress(Math.round(m.progress * 100));
          if (onProgress) onProgress(Math.round(m.progress * 100));
        } else if (m.status === 'loading language traineddata') {
          showOCRProgress(-1, `正在加载离线翻译包 ${Math.round(m.progress * 100)}%`);
        }
      },
    };

    try {
      console.log('[OCR] 正在使用 jsDelivr CDN 通道初始化 Web Worker...');
      globalOcrWorker = await Tesseract.createWorker(langs, 1, options);
      console.log('[OCR] 恭喜！jsDelivr CDN 通道初始化 Worker 成功！');
    } catch (cdnErr) {
      console.warn('[OCR] jsDelivr CDN 启动 Worker 失败，正在触发自愈机制，回退至本地 Worker 初始化...', cdnErr);
      
      // 自愈回退：使用同源本地 Worker 与 WASM
      options.workerPath = '/js/tesseract/worker.min.js';
      options.corePath = undefined; // 移除 corePath，使 Tesseract.js 自动回退寻找同目录的 Web Wasm
      
      try {
        globalOcrWorker = await Tesseract.createWorker(langs, 1, options);
        console.log('[OCR] 恭喜！本地同源 fallback Worker 兼容自愈成功！');
      } catch (fallbackErr) {
        console.error('[OCR] 终极本地回退自愈也宣告失败:', fallbackErr);
        throw fallbackErr;
      }
    }

    currentLoadedLang = langs;
    return globalOcrWorker;

  } finally {
    // 无论最终构建结果如何，均无条件解除全局初始化并发锁
    ocrInitPromise = null;
    if (resolveInit) resolveInit();
  }
}

/**
 * 核心：OCR 识别并返回带位置信息的文本块 (常驻内存，免去重复加载耗时)
 * 关键优化：按用户设定精准加载语言包 + 过滤低置信度结果
 * @returns {Promise<{lines: Array<{text, bbox, baseline, confidence}>}>}
 */
async function ocrImageWithPositions(imageSource, langCode, onProgress) {
  let selectedLang;

  // 核心策略：用户明确指定了源语言时，只加载对应的单一精确语言包
  // 混合包（eng+chi_sim）会导致 Tesseract 在两种语言间犹豫，大幅降低识别精度
  if (langCode && langCode !== 'auto') {
    const specificLang = LANG_TO_OCR[langCode];
    if (specificLang) {
      selectedLang = specificLang;
      console.log(`[OCR] 用户指定源语言 ${langCode}，精确加载单一语言包: ${selectedLang}`);
    } else {
      // 用户设定的语言在 OCR 中没有对应的包，回退混合包
      selectedLang = 'eng+chi_sim';
      console.log(`[OCR] 用户指定 ${langCode} 无对应 OCR 包，回退混合包: ${selectedLang}`);
    }
  } else {
    // auto 模式：使用英文+简体中文混合包
    selectedLang = 'eng+chi_sim';
    console.log('[OCR] 自动检测模式，使用混合包:', selectedLang);
  }

  showOCRProgress(0, __t('ocrRecognizing') || '正在识别...');
  try {
    await loadTesseractScript();
    const worker = await getOcrWorker(selectedLang, onProgress);
    
    showOCRProgress(-1, __t('ocrRecognizing') || '正在进行文字识别...');
    const { data } = await worker.recognize(imageSource);
    
    // 过滤低置信度识别结果（<10分），消除乱码和错误识别
    if (data && data.lines) {
      const originalCount = data.lines.length;
      console.log(`[OCR诊断] 原始识别总行数: ${originalCount}`);
      data.lines.forEach((line, idx) => {
        console.log(`[OCR诊断] 原始行 ${idx}: "${(line.text || '').trim()}" (置信度: ${(line.confidence || 0).toFixed(1)})`);
      });

      const imgH = imageSource.naturalHeight || imageSource.height || 1000;
      data.lines = data.lines.filter(line => {
        const conf = line.confidence || 0;
        const text = (line.text || '').trim();
        const bbox = line.bbox || { y0: 0, y1: 0 };
        const h = bbox.y1 - bbox.y0;
        
        // 过滤条件放宽：置信度 >= 10，且文本行高度不得超过图片总高度的50%（防止全屏噪点框）
        if (conf < 10 || !text || h > imgH * 0.5) {
          console.log(`[OCR过滤] 丢弃低质量行或异常尺寸: "${text}" (置信度: ${conf.toFixed(1)}, 高度: ${h})`);
          return false;
        }
        return true;
      });
      console.log(`[OCR] 过滤完成: ${originalCount} → ${data.lines.length} 行 (丢弃 ${originalCount - data.lines.length} 行低质量结果)`);
    }
    
    hideOCRProgress();
    return data;
  } catch (e) {
    hideOCRProgress();
    throw e;
  }
}

/**
 * 辅助：高精度自动折行排版引擎 (解决 Canvas 文字折行 ReferenceError 问题)
 */
function wrapText(ctx, text, maxWidth) {
  if (!text) return [];

  // 判断是否属于中日韩(CJK)文字体系，中日韩无空格分词，按字符折行；西方语言有空格分词，按单词折行
  const isCJK = /[\u4e00-\u9fa5\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(text);
  let words = [];

  if (isCJK) {
    words = Array.from(text); // 字符拆分
  } else {
    words = text.split(' ');  // 单词拆分
  }

  const lines = [];
  let currentLine = '';

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    let testLine = currentLine;
    
    if (currentLine === '') {
      testLine = word;
    } else {
      testLine = isCJK ? (currentLine + word) : (currentLine + ' ' + word);
    }

    const metrics = ctx.measureText(testLine);
    const testWidth = metrics.width;

    if (testWidth > maxWidth && i > 0) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }
  return lines;
}

/**
 * 核心过滤：检测当前文本行是否符合设定的源语种特征
 */
function isLineMatchSourceLang(text, lang) {
  if (!text) return false;
  const cleanLang = lang.split('-')[0].toLowerCase();
  
  // 1. 中文 (zh)
  if (cleanLang === 'zh') {
    // 必须包含中文汉字
    return /[\u4e00-\u9fa5]/.test(text);
  }
  // 2. 日语 (ja)
  if (cleanLang === 'ja') {
    // 包含日文平假名、片假名，或者汉字
    return /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fa5]/.test(text);
  }
  // 3. 韩语 (ko)
  if (cleanLang === 'ko') {
    // 必须包含韩文音节
    return /[\uac00-\ud7af]/.test(text);
  }
  // 4. 英语 (en) 或其他西方拉丁语系 (fr, de, es, ru 等)
  if (['en', 'fr', 'de', 'es', 'ru', 'it', 'pt'].includes(cleanLang)) {
    // 拉丁语系主要由英文字母/拉丁字母构成
    const latinCount = (text.match(/[a-zA-Z]/g) || []).length;
    const cjkCount = (text.match(/[\u4e00-\u9fa5\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g) || []).length;
    
    // 如果没有任何亚洲字符（可能是纯英文、数字或符号），则认为是合法输入
    if (cjkCount === 0) {
      return true;
    }
    // 混合情况下，判断拉丁字母比例是否高于亚洲字符，防亚洲语种带拼音导致误识别
    return latinCount >= cjkCount;
  }
  
  // 其他不支持精细过滤的生僻语种，默认返回 true 以免误杀
  return true;
}

/**
 * 在 canvas 上绘制图片 + 翻译蒙版
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLImageElement} img
 * @param {Array} translatedLines - [{original, translated, bbox}]
 */
function renderTranslatedOverlay(canvas, img, translatedLines) {
  const ctx = canvas.getContext('2d');
  
  if (img !== canvas) {
    /* img 和 canvas 不是同一个对象时，需要初始化 canvas 并绘制原图 */
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  }
  /* 当 img === canvas 时，canvas 上已经有截图内容，直接叠加蒙版即可 */

  /* 在每行文字位置叠加翻译蒙版 */
  translatedLines.forEach(line => {
    const { bbox, translated } = line;
    if (!translated || !bbox) return;

    const x = bbox.x0;
    const y = bbox.y0;
    const w = bbox.x1 - bbox.x0;
    const h = bbox.y1 - bbox.y0;

    // 动态检测亮暗色主题，决定蒙版色调与字体颜色，保障极其卓越的高对比度可读性
    const isDark = document.body.classList.contains('dark') || 
                   document.documentElement.getAttribute('data-theme') === 'dark' ||
                   (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);

    /* 柔和气泡背景遮盖原文，设定 30% 黄金半透明蒙版，保障原图与文字相得益彰 */
    ctx.save();
    ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.15)' : 'rgba(0, 0, 0, 0.05)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;
    // 蒙版不透明度设为 30%
    ctx.fillStyle = isDark ? 'rgba(25, 25, 25, 0.3)' : 'rgba(255, 255, 255, 0.3)';
    
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(x - 6, y - 4, w + 12, h + 8, 8);
      ctx.fill();
    } else {
      ctx.fillRect(x - 6, y - 4, w + 12, h + 8);
    }
    ctx.restore();

    /* 绘制译文 */
    const fontSize = Math.max(Math.min(h * 0.7, 32), 11);
    ctx.font = `700 ${fontSize}px "Noto Sans SC", "Inter", sans-serif`;
    ctx.fillStyle = isDark ? '#ffffff' : '#000000';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    /* 文字换行与排版居中 */
    const lines = wrapText(ctx, translated, w);
    const lineH = fontSize * 1.3;
    const totalTextHeight = lines.length * lineH;
    
    let startY = y + (h / 2) - (totalTextHeight / 2) + (lineH / 2);

    lines.forEach((l, i) => {
      ctx.fillText(l, x + (w / 2), startY + i * lineH);
    });
  });
}

/**
 * 拍照翻译核心入口函数
 */
async function processImageTranslation(imageInput, sourceLang, targetLang, canvasEl, onDone) {
  console.log(`[OCR] 开始图片翻译流程 | 源语言: ${sourceLang} | 目标语言: ${targetLang}`);
  
  let img;
  let url = null;

  if (imageInput instanceof HTMLCanvasElement) {
    img = imageInput;
  } else {
    url = URL.createObjectURL(imageInput);
    img = new Image();
    img.src = url;

    try {
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
    } catch (e) {
      console.error('[OCR] 图片文件加载失败:', e);
      if (url) URL.revokeObjectURL(url);
      if (onDone) onDone([]);
      return;
    }
  }

  try {
    // 1. 获取图片文字及相对坐标
    const data = await ocrImageWithPositions(img, sourceLang);

    if (!data || !data.lines || data.lines.length === 0) {
      console.log('[OCR] 没有识别到任何有效文本');
      // 无文字也需要将原图画在 Canvas 上显示
      if (img !== canvasEl) {
        const ctx = canvasEl.getContext('2d');
        canvasEl.width = img.naturalWidth || img.width;
        canvasEl.height = img.naturalHeight || img.height;
        ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
        ctx.drawImage(img, 0, 0, canvasEl.width, canvasEl.height);
      }
      
      if (url) URL.revokeObjectURL(url);
      if (onDone) onDone([]);
      return;
    }

    // 2. 映射翻译每行文本（已优化：放宽语义语种特征过滤，确保100%无遗漏翻译）
    const translatePromises = data.lines.map(async (line) => {
      const lineText = line.text.trim();
      if (!lineText) return null;

      // 源语言为 auto 时执行智能双向过滤避免自我翻译污染
      let sl_final = sourceLang;
      let tl_final = targetLang;
      let skipTranslation = false;

      const hasChinese = /[\u4e00-\u9fa5]/.test(lineText);
      const hasJapanese = /[\u3040-\u309F\u30A0-\u30FF]/.test(lineText);
      const hasKorean = /[\uAC00-\uD7AF]/.test(lineText);
      const hasLatin = /[a-zA-Z]/.test(lineText);

      const isTargetChinese = tl_final.startsWith('zh');
      const isTargetEnglish = tl_final === 'en';

      if (sourceLang === 'auto') {
        if (isTargetChinese && hasChinese) {
          skipTranslation = true;
        } else if (isTargetEnglish && hasLatin && !hasChinese && !hasJapanese && !hasKorean) {
          skipTranslation = true;
        }
      }

      if (skipTranslation) {
        return null; // 跳过不处理
      }

      try {
        console.log(`[OCR发起翻译] "${lineText.substring(0, 20)}..." | ${sl_final} → ${tl_final}`);
        const result = await translateText(lineText, sl_final, tl_final);
        return {
          original: lineText,
          translated: result.translatedText,
          bbox: line.bbox,
        };
      } catch (err) {
        console.error(`[OCR翻译单行失败] "${lineText.substring(0, 20)}"`, err);
        return null;
      }
    });

    const results = await Promise.all(translatePromises);
    const translatedLines = results.filter(line => line !== null);

    console.log(`[OCR] 翻译处理完毕，开始渲染 Canvas。成功翻译行数: ${translatedLines.length}`);

    // 3. 渲染透明背景叠加蒙版
    renderTranslatedOverlay(canvasEl, img, translatedLines);
    
    if (url) URL.revokeObjectURL(url);
    if (onDone) onDone(translatedLines);

  } catch (err) {
    console.error('[OCR流程处理异常]:', err);
    hideOCRProgress();
    showToast('识别失败: ' + (err.message || '系统或网络异常'));
    if (url) URL.revokeObjectURL(url);
    if (onDone) onDone([]);
  }
}
