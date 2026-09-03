/**
 * 语言列表和选择器模块
 * 包含 100+ 种语言的完整列表，以及语言选择器 UI 逻辑
 */

/* 完整语言列表：{ code, name(英文), native(本地名) } */
const LANGUAGES = [
  { code: 'auto', name: 'Detect language', native: '检测语言' },
  { code: 'af', name: 'Afrikaans', native: 'Afrikaans' },
  { code: 'sq', name: 'Albanian', native: 'Shqip' },
  { code: 'am', name: 'Amharic', native: 'አማርኛ' },
  { code: 'ar', name: 'Arabic', native: 'العربية' },
  { code: 'hy', name: 'Armenian', native: 'Հայերեն' },
  { code: 'az', name: 'Azerbaijani', native: 'Azərbaycan' },
  { code: 'eu', name: 'Basque', native: 'Euskara' },
  { code: 'be', name: 'Belarusian', native: 'Беларуская' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা' },
  { code: 'bs', name: 'Bosnian', native: 'Bosanski' },
  { code: 'bg', name: 'Bulgarian', native: 'Български' },
  { code: 'ca', name: 'Catalan', native: 'Català' },
  { code: 'ceb', name: 'Cebuano', native: 'Cebuano' },
  { code: 'zh-CN', name: 'Chinese (Simplified)', native: '中文（简体）' },
  { code: 'zh-TW', name: 'Chinese (Traditional)', native: '中文（繁體）' },
  { code: 'co', name: 'Corsican', native: 'Corsu' },
  { code: 'hr', name: 'Croatian', native: 'Hrvatski' },
  { code: 'cs', name: 'Czech', native: 'Čeština' },
  { code: 'da', name: 'Danish', native: 'Dansk' },
  { code: 'nl', name: 'Dutch', native: 'Nederlands' },
  { code: 'en', name: 'English', native: 'English' },
  { code: 'eo', name: 'Esperanto', native: 'Esperanto' },
  { code: 'et', name: 'Estonian', native: 'Eesti' },
  { code: 'fi', name: 'Finnish', native: 'Suomi' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'fy', name: 'Frisian', native: 'Frysk' },
  { code: 'gl', name: 'Galician', native: 'Galego' },
  { code: 'ka', name: 'Georgian', native: 'ქართული' },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'el', name: 'Greek', native: 'Ελληνικά' },
  { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી' },
  { code: 'ht', name: 'Haitian Creole', native: 'Kreyòl Ayisyen' },
  { code: 'ha', name: 'Hausa', native: 'Hausa' },
  { code: 'haw', name: 'Hawaiian', native: 'ʻŌlelo Hawaiʻi' },
  { code: 'he', name: 'Hebrew', native: 'עברית' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'hmn', name: 'Hmong', native: 'Hmong' },
  { code: 'hu', name: 'Hungarian', native: 'Magyar' },
  { code: 'is', name: 'Icelandic', native: 'Íslenska' },
  { code: 'ig', name: 'Igbo', native: 'Igbo' },
  { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia' },
  { code: 'ga', name: 'Irish', native: 'Gaeilge' },
  { code: 'it', name: 'Italian', native: 'Italiano' },
  { code: 'ja', name: 'Japanese', native: '日本語' },
  { code: 'jv', name: 'Javanese', native: 'Basa Jawa' },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'kk', name: 'Kazakh', native: 'Қазақ' },
  { code: 'km', name: 'Khmer', native: 'ភាសាខ្មែរ' },
  { code: 'rw', name: 'Kinyarwanda', native: 'Ikinyarwanda' },
  { code: 'ko', name: 'Korean', native: '한국어' },
  { code: 'ku', name: 'Kurdish', native: 'Kurdî' },
  { code: 'ky', name: 'Kyrgyz', native: 'Кыргызча' },
  { code: 'lo', name: 'Lao', native: 'ລາວ' },
  { code: 'la', name: 'Latin', native: 'Latina' },
  { code: 'lv', name: 'Latvian', native: 'Latviešu' },
  { code: 'lt', name: 'Lithuanian', native: 'Lietuvių' },
  { code: 'lb', name: 'Luxembourgish', native: 'Lëtzebuergesch' },
  { code: 'mk', name: 'Macedonian', native: 'Македонски' },
  { code: 'mg', name: 'Malagasy', native: 'Malagasy' },
  { code: 'ms', name: 'Malay', native: 'Bahasa Melayu' },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം' },
  { code: 'mt', name: 'Maltese', native: 'Malti' },
  { code: 'mi', name: 'Maori', native: 'Te Reo Māori' },
  { code: 'mr', name: 'Marathi', native: 'मराठी' },
  { code: 'mn', name: 'Mongolian', native: 'Монгол' },
  { code: 'my', name: 'Myanmar', native: 'မြန်မာ' },
  { code: 'ne', name: 'Nepali', native: 'नेपाली' },
  { code: 'no', name: 'Norwegian', native: 'Norsk' },
  { code: 'ny', name: 'Nyanja', native: 'Chichewa' },
  { code: 'or', name: 'Odia', native: 'ଓଡ଼ିଆ' },
  { code: 'ps', name: 'Pashto', native: 'پښتو' },
  { code: 'fa', name: 'Persian', native: 'فارسی' },
  { code: 'pl', name: 'Polish', native: 'Polski' },
  { code: 'pt', name: 'Portuguese', native: 'Português' },
  { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
  { code: 'ro', name: 'Romanian', native: 'Română' },
  { code: 'ru', name: 'Russian', native: 'Русский' },
  { code: 'sm', name: 'Samoan', native: 'Gagana Sāmoa' },
  { code: 'gd', name: 'Scots Gaelic', native: 'Gàidhlig' },
  { code: 'sr', name: 'Serbian', native: 'Српски' },
  { code: 'st', name: 'Sesotho', native: 'Sesotho' },
  { code: 'sn', name: 'Shona', native: 'ChiShona' },
  { code: 'sd', name: 'Sindhi', native: 'سنڌي' },
  { code: 'si', name: 'Sinhala', native: 'සිංහල' },
  { code: 'sk', name: 'Slovak', native: 'Slovenčina' },
  { code: 'sl', name: 'Slovenian', native: 'Slovenščina' },
  { code: 'so', name: 'Somali', native: 'Soomaali' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'su', name: 'Sundanese', native: 'Basa Sunda' },
  { code: 'sw', name: 'Swahili', native: 'Kiswahili' },
  { code: 'sv', name: 'Swedish', native: 'Svenska' },
  { code: 'tl', name: 'Tagalog', native: 'Tagalog' },
  { code: 'tg', name: 'Tajik', native: 'Тоҷикӣ' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்' },
  { code: 'tt', name: 'Tatar', native: 'Татарча' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు' },
  { code: 'th', name: 'Thai', native: 'ไทย' },
  { code: 'tr', name: 'Turkish', native: 'Türkçe' },
  { code: 'tk', name: 'Turkmen', native: 'Türkmen' },
  { code: 'uk', name: 'Ukrainian', native: 'Українська' },
  { code: 'ur', name: 'Urdu', native: 'اردو' },
  { code: 'ug', name: 'Uyghur', native: 'ئۇيغۇرچە' },
  { code: 'uz', name: 'Uzbek', native: "O'zbek" },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'cy', name: 'Welsh', native: 'Cymraeg' },
  { code: 'xh', name: 'Xhosa', native: 'IsiXhosa' },
  { code: 'yi', name: 'Yiddish', native: 'ייִדיש' },
  { code: 'yo', name: 'Yoruba', native: 'Yorùbá' },
  { code: 'zu', name: 'Zulu', native: 'IsiZulu' },
];

/* 常用语言（快速选择栏） */
const POPULAR_LANGUAGES = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'fr', 'de', 'es', 'ru', 'pt', 'ar', 'hi', 'th', 'vi', 'id'];

/* 获取语言名称（优先用户界面语言） */
function getLanguageName(code) {
  const lang = LANGUAGES.find(l => l.code === code);
  if (!lang) return code;
  const uiLang = window.__currentLocale || 'zh-CN';
  if (uiLang.startsWith('zh')) return lang.native;
  return lang.name;
}

/* 获取所有语言（排除 auto） */
function getTargetLanguages() {
  return LANGUAGES.filter(l => l.code !== 'auto');
}

/* 获取源语言列表（包含 auto） */
function getSourceLanguages() {
  return LANGUAGES;
}

/* 最近使用语言 */
const RECENT_KEY = 'translate_recent_langs';
function getRecentLanguages() {
  try {
    const saved = JSON.parse(localStorage.getItem(RECENT_KEY));
    if (saved && saved.length > 0) return saved;
    return ['en', 'zh-CN'];
  } catch { return ['en', 'zh-CN']; }
}

function addRecentLanguage(code) {
  if (code === 'auto') return;
  let recent = getRecentLanguages();
  recent = [code, ...recent.filter(c => c !== code)].slice(0, 5);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
}

/* ---------- 语言选择器 Modal ---------- */
function openLanguageSelector(type, currentCode, onSelect) {
  const overlay = document.createElement('div');
  overlay.className = 'lang-modal-overlay';
  overlay.innerHTML = `
    <div class="lang-modal">
      <div class="lang-modal-header">
        <input type="text" class="lang-search" placeholder="${window.__t ? window.__t('searchLanguage') : 'Search languages...'}" id="langSearchInput">
        <button class="lang-modal-close" id="langModalClose">✕</button>
      </div>
      <div class="lang-modal-body">
        <div class="lang-section recent-section" id="langRecentSection"></div>
        <div class="lang-section all-section" id="langAllSection"></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const searchInput = overlay.querySelector('#langSearchInput');
  const recentSection = overlay.querySelector('#langRecentSection');
  const allSection = overlay.querySelector('#langAllSection');
  const closeBtn = overlay.querySelector('#langModalClose');

  const langs = type === 'source' ? getSourceLanguages() : getTargetLanguages();

  function renderList(filter = '') {
    const filterLower = filter.toLowerCase();
    const recent = getRecentLanguages();

    /* 最近使用 */
    if (!filter && recent.length > 0) {
      const recentLangs = recent.map(c => LANGUAGES.find(l => l.code === c)).filter(Boolean);
      recentSection.innerHTML = `
        <div class="lang-section-title">${window.__t ? window.__t('recentLanguages') : 'Recent'}</div>
        <div class="lang-grid">
          ${recentLangs.map(l => `
            <button class="lang-item ${l.code === currentCode ? 'active' : ''}" data-code="${l.code}">
              ${getLanguageName(l.code)}
            </button>
          `).join('')}
        </div>
      `;
    } else {
      recentSection.innerHTML = '';
    }

    /* 全部语言 */
    const filtered = langs.filter(l =>
      !filter || l.name.toLowerCase().includes(filterLower) ||
      l.native.toLowerCase().includes(filterLower) ||
      l.code.toLowerCase().includes(filterLower)
    );

    allSection.innerHTML = `
      <div class="lang-section-title">${window.__t ? window.__t('allLanguages') : 'All languages'}</div>
      <div class="lang-grid">
        ${filtered.map(l => `
          <button class="lang-item ${l.code === currentCode ? 'active' : ''}" data-code="${l.code}">
            ${getLanguageName(l.code)}
          </button>
        `).join('')}
      </div>
    `;
  }

  renderList();

  searchInput.addEventListener('input', () => renderList(searchInput.value));
  searchInput.focus();

  overlay.addEventListener('click', (e) => {
    const item = e.target.closest('.lang-item');
    if (item) {
      const code = item.dataset.code;
      addRecentLanguage(code);
      onSelect(code);
      overlay.remove();
      return;
    }
    if (e.target === overlay || e.target === closeBtn) {
      overlay.remove();
    }
  });
}
