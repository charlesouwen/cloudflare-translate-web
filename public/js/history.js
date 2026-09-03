/**
 * 翻译历史管理模块
 * 基于 localStorage 存储，最多 500 条
 */

const HISTORY_KEY = 'translate_history';
const FAVORITES_KEY = 'translate_favorites';
const MAX_HISTORY = 500;

/* ---------- 历史记录 CRUD ---------- */

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch { return []; }
}

function writeStoredList(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn(`[history] unable to persist ${key}:`, error);
    return false;
  }
}

function addHistory(item) {
  /* item = { id, text, translatedText, sl, tl, engine, timestamp } */
  const history = getHistory();
  item.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  item.timestamp = Date.now();
  const duplicateIndex = history.findIndex((entry) =>
    entry.text === item.text && entry.sl === item.sl && entry.tl === item.tl);
  if (duplicateIndex >= 0) history.splice(duplicateIndex, 1);
  history.unshift(item);
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  writeStoredList(HISTORY_KEY, history);
  return item;
}

function deleteHistory(id) {
  const history = getHistory().filter(h => h.id !== id);
  writeStoredList(HISTORY_KEY, history);
  writeStoredList(FAVORITES_KEY, getFavorites().filter((favoriteId) => favoriteId !== id));
}

function clearHistory() {
  writeStoredList(HISTORY_KEY, []);
  writeStoredList(FAVORITES_KEY, []);
}

function searchHistory(query) {
  const q = query.toLowerCase();
  return getHistory().filter(h =>
    h.text.toLowerCase().includes(q) ||
    h.translatedText.toLowerCase().includes(q)
  );
}

/* ---------- 收藏 ---------- */

function getFavorites() {
  try {
    return JSON.parse(localStorage.getItem(FAVORITES_KEY)) || [];
  } catch { return []; }
}

function toggleFavorite(id) {
  const favorites = getFavorites();
  const idx = favorites.indexOf(id);
  if (idx >= 0) {
    favorites.splice(idx, 1);
  } else {
    favorites.push(id);
  }
  writeStoredList(FAVORITES_KEY, favorites);
  return idx < 0; /* true = 已收藏 */
}

function isFavorite(id) {
  return getFavorites().includes(id);
}

function getFavoriteItems() {
  const favIds = getFavorites();
  return getHistory().filter(h => favIds.includes(h.id));
}

/* ---------- UI 渲染 ---------- */

function renderHistoryPanel() {
  const panel = document.getElementById('historyPanel');
  if (!panel) return;

  const showFavorites = panel.dataset.showFavorites === 'true';
  const items = showFavorites ? getFavoriteItems() : getHistory();
  const searchQuery = document.getElementById('historySearch')?.value || '';
  const normalizedQuery = searchQuery.toLowerCase();
  const filteredItems = normalizedQuery
    ? items.filter((item) => item.text.toLowerCase().includes(normalizedQuery) ||
      item.translatedText.toLowerCase().includes(normalizedQuery))
    : items;

  const listEl = panel.querySelector('.history-list');
  if (!listEl) return;

  if (filteredItems.length === 0) {
    listEl.innerHTML = `<div class="history-empty">${__t('noHistory')}</div>`;
    return;
  }

  listEl.innerHTML = filteredItems.map(item => {
    const fav = isFavorite(item.id);
    const date = new Date(item.timestamp);
    const timeStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    const slName = getLanguageName(item.sl);
    const tlName = getLanguageName(item.tl);

    return `
      <div class="history-item" data-id="${item.id}">
        <div class="history-item-header">
          <span class="history-langs">${slName} → ${tlName}</span>
          <span class="history-time">${timeStr}</span>
        </div>
        <div class="history-item-text">${escapeHtml(item.text.substring(0, 100))}${item.text.length > 100 ? '...' : ''}</div>
        <div class="history-item-translation">${escapeHtml(item.translatedText.substring(0, 100))}${item.translatedText.length > 100 ? '...' : ''}</div>
        <div class="history-item-actions">
          <button class="history-btn history-use" title="使用">↗</button>
          <button class="history-btn history-fav ${fav ? 'active' : ''}" title="${fav ? __t('unfavorite') : __t('favorite')}">
            ${fav ? '★' : '☆'}
          </button>
          <button class="history-btn history-del" title="${__t('delete')}">✕</button>
        </div>
      </div>
    `;
  }).join('');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
