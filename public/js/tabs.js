/**
 * 标签页切换模块
 * 管理五种翻译模式：文字 / 图片 / 文档 / 网站 / 同传
 */

const TABS = ['text', 'images', 'documents', 'camera', 'interpreter'];
let currentTab = 'text';
let tabsInitialized = false;

function initTabs() {
  if (tabsInitialized) {
    switchTab(getTabFromLocation(), { syncUrl: false });
    return;
  }
  tabsInitialized = true;

  document.querySelectorAll('.tabs-inner, .bottom-tabs').forEach((tabList) => {
    tabList.setAttribute('role', 'tablist');
    if (!tabList.hasAttribute('aria-label')) {
      tabList.setAttribute('aria-label', tabList.classList.contains('bottom-tabs') ? '移动端翻译模式' : '翻译模式');
    }
  });

  const tabButtons = document.querySelectorAll('.tab-btn, .bottom-tab-btn');
  tabButtons.forEach((btn) => {
    const tab = btn.dataset.tab;
    const surface = btn.classList.contains('bottom-tab-btn') ? 'mobile' : 'desktop';
    if (!btn.id) btn.id = `tab-${surface}-${tab}`;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-controls', `panel-${tab}`);
    btn.addEventListener('click', () => {
      switchTab(tab);
    });
    btn.addEventListener('keydown', handleTabKeydown);
  });

  document.querySelectorAll('.tab-panel').forEach((panel) => {
    const tab = panel.id.replace(/^panel-/, '');
    const labelledBy = document.querySelector(`.tab-btn[data-tab="${tab}"]`) ||
      document.querySelector(`.bottom-tab-btn[data-tab="${tab}"]`);
    panel.setAttribute('role', 'tabpanel');
    if (labelledBy) panel.setAttribute('aria-labelledby', labelledBy.id);
  });

  window.addEventListener('popstate', () => {
    switchTab(getTabFromLocation(), { syncUrl: false });
  });

  switchTab(getTabFromLocation(), { syncUrl: false });
}

function getTabFromLocation() {
  const requestedTab = new URL(window.location.href).searchParams.get('tab');
  return TABS.includes(requestedTab) ? requestedTab : 'text';
}

function syncTabToUrl(tab, replace) {
  const url = new URL(window.location.href);
  if (url.searchParams.get('tab') === tab) return;

  url.searchParams.set('tab', tab);
  const previousState = history.state && typeof history.state === 'object' ? history.state : {};
  const nextState = { ...previousState, tab };
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  history[replace ? 'replaceState' : 'pushState'](nextState, '', nextUrl);
}

function handleTabKeydown(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;

  const tabList = event.currentTarget.closest('.tabs-inner, .bottom-tabs');
  if (!tabList) return;

  const availableButtons = Array.from(tabList.querySelectorAll('[data-tab]'))
    .filter((button) => !button.disabled);
  const visibleButtons = availableButtons.filter((button) => button.getClientRects().length > 0);
  const buttons = visibleButtons.length ? visibleButtons : availableButtons;
  const currentIndex = buttons.indexOf(event.currentTarget);
  if (currentIndex < 0 || buttons.length < 2) return;

  let nextIndex;
  if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = buttons.length - 1;
  else if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % buttons.length;
  else nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;

  event.preventDefault();
  buttons[nextIndex].focus();
  switchTab(buttons[nextIndex].dataset.tab);
}

function switchTab(tab, { syncUrl = true, replace = false } = {}) {
  if (!TABS.includes(tab)) return false;
  const previousTab = currentTab;
  currentTab = tab;

  /* 切换标签页时，100% 强制回收硬件资源，保护用户隐私并节约手机电量 */
  if (tab !== 'camera' && previousTab !== tab) {
    if (typeof stopCamera === 'function') {
      stopCamera();
    }
    if (typeof resetCameraUI === 'function') {
      resetCameraUI();
    }
  }
  if (tab !== 'interpreter' && previousTab === 'interpreter') {
    if (typeof window.stopInterpreter === 'function') {
      window.stopInterpreter();
    }
  }

  /* 更新顶部标签 */
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const isActive = btn.dataset.tab === tab;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
    btn.tabIndex = isActive ? 0 : -1;
  });

  /* 更新底部标签（移动端） */
  document.querySelectorAll('.bottom-tab-btn').forEach(btn => {
    const isActive = btn.dataset.tab === tab;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
    btn.tabIndex = isActive ? 0 : -1;
  });

  /* 切换面板 */
  document.querySelectorAll('.tab-panel').forEach(panel => {
    const isActive = panel.id === `panel-${tab}`;
    panel.classList.toggle('active', isActive);
    panel.hidden = !isActive;
  });

  /* 同传模式特殊处理 */
  const mainLayout = document.querySelector('.translate-main');
  if (mainLayout) {
    mainLayout.classList.toggle('interpreter-mode', tab === 'interpreter');
  }

  /* 同传模式下隐藏文字翻译界面的检测语种标签 */
  const detectedLabel = document.getElementById('detectedLangLabel');
  if (detectedLabel) {
    if (tab === 'interpreter') {
      detectedLabel.style.setProperty('display', 'none', 'important');
    } else {
      const sourceBtn = document.getElementById('sourceLangBtn');
      detectedLabel.style.display = (sourceBtn && sourceBtn.dataset.code === 'auto' && detectedLabel.textContent) ? 'inline' : 'none';
    }
  }

  /* 同传模式下隐藏顶部的全局语言选择栏，因为同传有独立的语种选择器 */
  const langBar = document.querySelector('.lang-bar');
  if (langBar) {
    if (tab === 'interpreter') {
      langBar.style.setProperty('display', 'none', 'important');
    } else {
      langBar.style.removeProperty('display');
    }
  }

  if (syncUrl) syncTabToUrl(tab, replace);
  return true;
}

/* ---------- 图片上传处理 ---------- */

function initImageUpload() {
  const dropZone = document.getElementById('imageDropZone');
  const fileInput = document.getElementById('imageFileInput');
  if (!dropZone || !fileInput) return;

  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length > 0) handleImageFile(files[0]);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) handleImageFile(fileInput.files[0]);
  });
}

async function handleImageFile(file) {
  if (!file.type.startsWith('image/')) return;

  const dropZone = document.getElementById('imageDropZone');
  const preview = document.getElementById('imagePreview');
  if (dropZone) dropZone.style.display = 'none';
  
  if (preview) {
    preview.innerHTML = '<canvas id="imageResultCanvas" style="max-width:100%;height:auto;display:block;margin:0 auto;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.12);"></canvas><button class="icon-btn" id="imageCloseBtn" style="position:absolute;top:10px;right:10px;background:rgba(255,255,255,0.9);border-radius:50%;border:none;cursor:pointer;padding:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1);">✕</button>';
    preview.style.display = 'block';
    preview.style.position = 'relative';
    document.getElementById('imageCloseBtn').addEventListener('click', () => {
      preview.style.display = 'none';
      if (dropZone) dropZone.style.display = 'flex';
      /* 重新绑定点击由于 dropZone 从 none 恢复，本身已有的事件不受影响 */
      const fileInput = document.getElementById('imageFileInput');
      if (fileInput) fileInput.value = '';
    });
  }

  const canvasEl = document.getElementById('imageResultCanvas');
  const sl = document.getElementById('sourceLangBtn')?.dataset.code || 'auto';
  const tl = document.getElementById('targetLangBtn')?.dataset.code || 'zh-CN';

  try {
    await processImageTranslation(file, sl, tl, canvasEl, (resultLines) => {
      if (!resultLines || resultLines.length === 0) {
        showToast('未能识别到文字');
      }
    });
  } catch (e) {
    console.error('Image translation failed:', e);
    showToast('图片翻译失败');
  }
}

/* ---------- 文档上传处理 ---------- */

function initDocumentUpload() {
  const dropZone = document.getElementById('docDropZone');
  const fileInput = document.getElementById('docFileInput');
  if (!dropZone || !fileInput) return;

  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length > 0) handleDocumentFile(files[0]);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) handleDocumentFile(fileInput.files[0]);
  });
}

async function handleDocumentFile(file) {
  const fileName = file.name.toLowerCase();
  let text = '';

  if (fileName.endsWith('.txt')) {
    text = await file.text();
  } else if (fileName.endsWith('.html') || fileName.endsWith('.htm')) {
    const html = await file.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    text = doc.body.textContent || '';
  } else {
    alert('Unsupported file type. Please use .txt or .html files.');
    return;
  }

  /* 隐藏上传区，显示面板 */
  const dropZone = document.getElementById('docDropZone');
  const docInfoPanel = document.getElementById('docInfoPanel');
  if (dropZone) dropZone.style.display = 'none';
  if (docInfoPanel) docInfoPanel.style.display = 'block';
  
  const docFileName = document.getElementById('docFileName');
  if (docFileName) docFileName.textContent = file.name;
  
  const docCloseBtn = document.getElementById('docCloseBtn');
  if (docCloseBtn) {
    docCloseBtn.onclick = () => {
      if (docInfoPanel) docInfoPanel.style.display = 'none';
      if (dropZone) dropZone.style.display = 'flex';
      document.getElementById('docOriginalView').innerHTML = '';
      document.getElementById('docTranslatedView').innerHTML = '';
      const fileInput = document.getElementById('docFileInput');
      if (fileInput) fileInput.value = '';
    };
  }

  const originalView = document.getElementById('docOriginalView');
  const translatedView = document.getElementById('docTranslatedView');
  
  /* 按段落切割并逐段翻译 */
  const paragraphs = text.split('\n').filter(p => p.trim() !== '');
  originalView.innerHTML = '';
  translatedView.innerHTML = '';
  
  const sl = document.getElementById('sourceLangBtn')?.dataset.code || 'auto';
  const tl = document.getElementById('targetLangBtn')?.dataset.code || 'zh-CN';
  
  for (const p of paragraphs) {
    const origP = document.createElement('p');
    origP.textContent = p;
    originalView.appendChild(origP);
    
    const transP = document.createElement('p');
    transP.className = 'translating';
    transP.textContent = '...';
    translatedView.appendChild(transP);
    
    try {
      const result = await translateText(p, sl, tl);
      transP.textContent = result.translatedText;
      transP.className = '';
    } catch(e) {
      transP.textContent = '翻译失败';
      transP.className = 'error';
    }
  }
}
