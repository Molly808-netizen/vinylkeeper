// === VinylKeeper — app.js ===

const DISCOGS_BASE = 'https://api.discogs.com';
const USER_AGENT = 'VinylKeeper/0.1';

// State
let currentRelease = null;
let marketStats = null;
let currentMode = 'text';

// === Settings ===
function getSettings() {
  return {
    token: localStorage.getItem('vk_token') || '',
    margin: parseFloat(localStorage.getItem('vk_margin') || '1.5'),
  };
}

function saveSettings() {
  const token = document.getElementById('discogs-token').value.trim();
  const margin = parseFloat(document.getElementById('margin-target').value);
  localStorage.setItem('vk_token', token);
  localStorage.setItem('vk_margin', isNaN(margin) ? '1.5' : margin.toString());
  showConfirm('settings-confirm');
}

function loadSettingsUI() {
  const s = getSettings();
  document.getElementById('discogs-token').value = s.token;
  document.getElementById('margin-target').value = s.margin;
}

// === Tabs ===
function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
  document.querySelectorAll('.tab-content').forEach(s => {
    s.classList.toggle('active', s.id === `tab-${tabName}`);
    s.classList.toggle('hidden', s.id !== `tab-${tabName}`);
  });
}

// === Search modes ===
function switchMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  document.querySelectorAll('.mode-input').forEach(d => d.classList.toggle('hidden', d.id !== `mode-${mode}`));
}

// === Discogs API call ===
async function discogsGet(path) {
  const { token } = getSettings();
  if (!token) throw new Error('Token Discogs manquant — va dans ⚙️ Réglages pour le saisir.');

  const url = `${DISCOGS_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Discogs token=${token}`,
      'User-Agent': USER_AGENT,
    },
  });

  if (res.status === 401) throw new Error('Token Discogs invalide ou expiré.');
  if (res.status === 429) throw new Error('Trop de requêtes — attends quelques secondes.');
  if (!res.ok) throw new Error(`Erreur API Discogs (${res.status})`);

  return res.json();
}

// === Search ===
async function doSearch() {
  const { token } = getSettings();
  if (!token) {
    showError('search-results', 'Token Discogs manquant — va dans ⚙️ Réglages.');
    return;
  }

  let query = '';
  if (currentMode === 'text') query = document.getElementById('search-text').value.trim();
  if (currentMode === 'barcode') query = document.getElementById('search-barcode').value.trim();
  if (currentMode === 'matrix') query = document.getElementById('search-matrix').value.trim();

  if (!query) return;

  const container = document.getElementById('search-results');
  container.classList.remove('hidden');
  container.innerHTML = '<p class="loading">🔍 Recherche en cours…</p>';

  try {
    let endpoint;
    if (currentMode === 'barcode') {
      endpoint = `/database/search?barcode=${encodeURIComponent(query)}&type=release&per_page=10`;
    } else {
      endpoint = `/database/search?q=${encodeURIComponent(query)}&type=release&per_page=10`;
    }

    const data = await discogsGet(endpoint);
    renderResults(container, data.results || []);
  } catch (err) {
    container.innerHTML = `<div class="error-msg">❌ ${err.message}</div>`;
  }
}

function renderResults(container, results) {
  if (!results.length) {
    container.innerHTML = '<p class="no-results">Aucun résultat trouvé.</p>';
    return;
  }

  container.innerHTML = results.map(r => {
    const thumb = r.thumb || r.cover_image || '';
    const imgTag = thumb
      ? `<img src="${thumb}" alt="cover" loading="lazy" onerror="this.style.display='none'">`
      : `<div style="width:56px;height:56px;background:var(--bg3);border-radius:6px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:1.4rem">💿</div>`;

    const label = Array.isArray(r.label) ? r.label[0] : (r.label || '');
    const meta = [r.year, r.country, label].filter(Boolean).join(' · ');

    return `<div class="result-item" data-id="${r.id}">
      ${imgTag}
      <div class="result-info">
        <div class="result-title">${escHtml(r.title || '—')}</div>
        <div class="result-meta">${escHtml(meta)}</div>
      </div>
      <span class="result-arrow">›</span>
    </div>`;
  }).join('');

  // Click handlers
  container.querySelectorAll('.result-item').forEach(el => {
    el.addEventListener('click', () => selectRelease(parseInt(el.dataset.id)));
  });
}

// === Select release ===
async function selectRelease(releaseId) {
  switchTab('result');
  const card = document.getElementById('result-card');
  card.innerHTML = '<p class="loading">📀 Chargement…</p>';
  document.getElementById('pricing-block').classList.add('hidden');

  try {
    const [release, stats] = await Promise.all([
      discogsGet(`/releases/${releaseId}`),
      discogsGet(`/marketplace/stats/${releaseId}`).catch(() => null),
    ]);

    currentRelease = release;
    marketStats = stats;

    renderCard(card, release, stats);
    document.getElementById('pricing-block').classList.remove('hidden');
    updatePriceSummary();
  } catch (err) {
    card.innerHTML = `<div class="error-msg">❌ ${err.message}</div>`;
  }
}

function renderCard(card, r, stats) {
  const artist = (r.artists || []).map(a => a.name).join(', ') || '—';
  const label = (r.labels || []).map(l => l.name).join(', ') || '—';
  const genres = (r.genres || []).join(', ') || '—';
  const styles = (r.styles || []).join(', ') || '';
  const cover = r.images && r.images[0] ? r.images[0].uri : '';

  const imgTag = cover
    ? `<img class="card-cover" src="${cover}" alt="cover" loading="lazy">`
    : `<div class="card-cover" style="height:120px;display:flex;align-items:center;justify-content:center;font-size:3rem;background:var(--bg3);border-radius:8px">💿</div>`;

  let priceHtml = '';
  if (stats && stats.lowest_price) {
    const median = stats.blocked_from_sale ? '—' : (stats.num_for_sale > 0 ? '—' : '—');
    priceHtml = `
      <div class="price-row"><span class="price-label">Prix le plus bas</span><span class="price-value">${formatPrice(stats.lowest_price)}</span></div>
      ${stats.num_for_sale !== undefined ? `<div class="price-row"><span class="price-label">Annonces actives</span><span class="price-value">${stats.num_for_sale}</span></div>` : ''}
    `;
  } else if (stats === null) {
    priceHtml = '<p style="color:var(--text2);font-size:0.8rem;margin-top:8px">Prix marché non disponible pour ce disque.</p>';
  }

  card.innerHTML = `
    ${imgTag}
    <div class="card-artist">${escHtml(artist)}</div>
    <div class="card-title">${escHtml(r.title || '—')}</div>
    <div class="card-details">
      ${r.year ? `<span class="badge">📅 ${r.year}</span>` : ''}
      ${r.country ? `<span class="badge">🌍 ${r.country}</span>` : ''}
      ${label ? `<span class="badge">🏷️ ${escHtml(label)}</span>` : ''}
      ${genres ? `<span class="badge">🎵 ${escHtml(genres)}</span>` : ''}
    </div>
    ${priceHtml}
  `;
}

// === Pricing ===
function updatePriceSummary() {
  const buyPrice = parseFloat(document.getElementById('buy-price').value) || 0;
  const condCoeff = parseFloat(document.getElementById('condition').value);
  const { margin } = getSettings();

  const summary = document.getElementById('price-summary');

  let marketMedian = 0;
  if (marketStats && marketStats.lowest_price && marketStats.lowest_price.value) {
    marketMedian = marketStats.lowest_price.value;
  }

  const byMargin = buyPrice * margin;
  const byMarket = marketMedian * condCoeff;
  const suggested = Math.max(byMargin, byMarket, 1);

  let html = '';
  if (buyPrice > 0) {
    html += `<p>Par marge (×${margin}) : <strong>${formatPrice({ value: byMargin, currency: 'EUR' })}</strong></p>`;
  }
  if (marketMedian > 0) {
    html += `<p>Par marché × état : <strong>${formatPrice({ value: byMarket, currency: 'EUR' })}</strong></p>`;
  }
  if (buyPrice > 0 || marketMedian > 0) {
    html += `<p>Prix conseillé : <span class="highlight">${formatPrice({ value: suggested, currency: 'EUR' })}</span></p>`;
  } else {
    html += `<p style="color:var(--text2);font-size:0.85rem">Renseigne ton prix d'achat pour voir l'estimation.</p>`;
  }

  summary.innerHTML = html;
  return suggested;
}

// === Generate announce ===
function generateAnnounce() {
  if (!currentRelease) return;

  const r = currentRelease;
  const artist = (r.artists || []).map(a => a.name).join(', ') || '—';
  const label = (r.labels || []).map(l => l.name).join(', ') || '—';
  const genres = (r.genres || []).join(', ') || '';
  const condEl = document.getElementById('condition');
  const condLabel = condEl.options[condEl.selectedIndex].text;
  const suggestedPrice = updatePriceSummary();

  const announce = `📀 ${artist} — ${r.title || ''}${r.year ? ` (${r.year})` : ''}
🏷️ Label : ${label}${r.country ? ` | Pressage : ${r.country}${r.year ? ', ' + r.year : ''}` : ''}
📊 État : ${condLabel}
Etat Pochette : 

🎵 Genre : ${genres || '—'}

Vinyle en état ${condLabel}. ${r.country ? `Pressage ${r.country}.` : ''}

Pour une livraison rapide et soignée evitez Vinted Go

#vinyle #vinyl${artist !== '—' ? ' #' + artist.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '') : ''}${genres ? ' #' + genres.toLowerCase().split(',')[0].trim().replace(/\s+/g, '') : ''} #disque #collection #vinted`;

  document.getElementById('announce-text').value = announce;
  switchTab('announce');
}

// === Copy ===
async function copyAnnounce() {
  const text = document.getElementById('announce-text').value;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showConfirm('copy-confirm');
  } catch {
    // Fallback
    const el = document.getElementById('announce-text');
    el.select();
    document.execCommand('copy');
    showConfirm('copy-confirm');
  }
}

// === Utils ===
function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatPrice(price) {
  if (!price || price.value === undefined) return '—';
  return `${parseFloat(price.value).toFixed(2)} ${price.currency || '€'}`;
}

function showConfirm(id) {
  const el = document.getElementById(id);
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 2500);
}

function showError(containerId, msg) {
  const c = document.getElementById(containerId);
  c.classList.remove('hidden');
  c.innerHTML = `<div class="error-msg">❌ ${msg}</div>`;
}

// === Init ===
function init() {
  // Tabs
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => switchTab(t.dataset.tab));
  });

  // Modes
  document.querySelectorAll('.mode-btn').forEach(b => {
    b.addEventListener('click', () => switchMode(b.dataset.mode));
  });

  // Search on Enter
  ['search-text', 'search-barcode', 'search-matrix'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') doSearch();
    });
  });

  document.getElementById('btn-search').addEventListener('click', doSearch);
  document.getElementById('btn-generate').addEventListener('click', generateAnnounce);
  document.getElementById('btn-copy').addEventListener('click', copyAnnounce);
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);

  // Live price update
  document.getElementById('buy-price').addEventListener('input', updatePriceSummary);
  document.getElementById('condition').addEventListener('change', updatePriceSummary);

  loadSettingsUI();
}

document.addEventListener('DOMContentLoaded', init);

// === Service Worker ===
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
