import {
  $,
  $$,
  api,
  escapeHtml,
  formatLastSync,
  formatRelativeTime,
  safeHttpUrl,
  showToast,
  sortArticles,
  startNatalClock
} from './shared.js?v=20261117b';

const NEWS_STORAGE_KEY = 'escargot_ronda_snapshot_v1';

const SORT_LABELS = {
  recent: 'Mais recentes',
  importance: 'Mais importantes',
  interesting: 'Mais interessantes',
  tvScore: 'Maior potencial TV'
};

const state = {
  activeTab: 'ronda',
  quarantineView: 'prefeitura',
  sortOverride: null,
  historyDay: 'all',
  historyQuery: '',
  historySortBy: 'recent',
  layaPollTimer: null,
  auth: {
    authenticated: false,
    username: null
  },
  news: {
    todayDateKey: '',
    retentionDays: 7,
    pautas: [],
    historyPautas: [],
    historyDates: [],
    quarantine: [],
    filteredGeo: [],
    filteredLowTv: [],
    layaStatus: null,
    displayConfig: {
      searchQuery: '',
      beatFilter: 'all',
      interestFilter: 'all',
      sortBy: 'recent',
      sourceFilter: 'all'
    },
    stats: {}
  },
  bulletinQueue: [],
  sentHistory: []
};

function switchTab(tabName) {
  state.activeTab = tabName;
  $$('.tab-btn[data-tab]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.tab === tabName);
  });
  $$('.tab-panel').forEach((panel) => {
    panel.classList.toggle('is-active', panel.id === `tab-${tabName}`);
  });
}

function updateHeaderStatus() {
  $('#last-sync-label').textContent = state.news.isRefreshing
    ? 'Coletando portais…'
    : formatLastSync(state.news.lastSyncAt);
  const labelEl = $('#config-tab-label');
  if (labelEl) {
    labelEl.textContent = state.auth?.authenticated ? '🔓 Configurações' : '🔒 Configurações';
  }
  scheduleLayaSyncPoll();
}

function scheduleLayaSyncPoll() {
  if (state.layaPollTimer) {
    clearTimeout(state.layaPollTimer);
    state.layaPollTimer = null;
  }
  const ls = state.news.layaStatus;
  const shouldPoll =
    Boolean(state.news.isRefreshing) ||
    (ls?.enabled &&
      (ls.isClassifying || (!ls.online && (ls.totalEligible ?? 0) > 0 && ls.classifiedCount < ls.totalEligible)));

  if (shouldPoll) {
    state.layaPollTimer = setTimeout(async () => {
      try {
        state.news = await api('/api/news?bootstrap=0');
        updateHeaderStatus();
        renderStatsAndBadges();
        renderPautas();
        renderHistory();
        renderQuarantine();
      } catch {
        // ignore transient poll error
      }
    }, state.news.isRefreshing ? 2500 : 3500);
  }
}

function activeSortMode() {
  return state.sortOverride || state.news.displayConfig?.sortBy || 'recent';
}

function filterDisplayItems(baseItems, { queryOverride = null, sortBy = 'recent', skipConfigSearch = false } = {}) {
  let items = [...(baseItems || [])];
  const cfg = state.news.displayConfig || {};
  const q = String(queryOverride !== null ? queryOverride : skipConfigSearch ? '' : cfg.searchQuery || '')
    .trim()
    .toLowerCase();
  const beatFilter = cfg.beatFilter || 'all';
  const interestFilter = cfg.interestFilter || 'all';
  const sourceFilter = cfg.sourceFilter || 'all';

  if (q) {
    items = items.filter((a) => {
      const hay = `${a.title} ${a.summary} ${a.sourceName} ${a.tvCategory} ${(a.geo?.matchedLocations || []).join(' ')}`.toLowerCase();
      return hay.includes(q);
    });
  }

  if (beatFilter !== 'all') {
    items = items.filter((a) => a.tvCategory === beatFilter);
  }

  if (interestFilter === 'interesting') {
    items = items.filter((a) => a.laya?.isInteresting);
  } else if (interestFilter === 'high') {
    items = items.filter((a) => (a.laya?.importanceScore ?? 0) >= 55);
  }

  if (sourceFilter.startsWith('cat:')) {
    const cat = sourceFilter.slice(4);
    items = items.filter((a) => a.sourceCategory === cat);
  } else if (sourceFilter === 'src:tribuna') {
    items = items.filter((a) => a.sourceId.startsWith('tribuna'));
  } else if (sourceFilter.startsWith('src:')) {
    const id = sourceFilter.slice(4);
    items = items.filter((a) => a.sourceId === id);
  }

  return sortArticles(items, sortBy);
}

function getFilteredPautas() {
  return filterDisplayItems(state.news.pautas || [], { sortBy: activeSortMode() });
}

function renderStatsAndBadges() {
  const stats = state.news.stats || {};
  const blockedTotal = (stats.blockedPrefeitura || 0) + (stats.blockedCrime || 0) + (stats.blockedManual || 0);
  const historyList = state.news.historyPautas || state.news.pautas || [];

  $('#count-ronda').textContent = (state.news.pautas || []).length;
  $('#count-historico').textContent = historyList.length;
  $('#count-boletim').textContent = state.bulletinQueue.length;
  $('#count-filtro').textContent = blockedTotal;
}

function renderStoryCardHtml(art) {
  const url = safeHttpUrl(art.url);
  const imgUrl = art.imageUrl ? safeHttpUrl(art.imageUrl) : null;
  const scoreClass = art.tvScore >= 72 ? 'tv-score--high' : art.tvScore >= 50 ? 'tv-score--mid' : 'tv-score--low';

  const mediaBlock =
    imgUrl && imgUrl !== '#'
      ? `<img class="story-card__thumb" src="${escapeHtml(imgUrl)}" alt="" loading="lazy" onerror="this.style.display='none'" />`
      : `<div class="story-card__monogram" style="background:${escapeHtml(art.badgeColor || '#334155')}">${escapeHtml(
          art.sourceShortName || art.sourceName
        )}</div>`;

  const alsoText =
    Array.isArray(art.alsoReportedBy) && art.alsoReportedBy.length > 0
      ? `<div class="story-card__also">Também em: ${art.alsoReportedBy
          .map(
            (o) =>
              `<a href="${escapeHtml(safeHttpUrl(o.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(
                o.sourceShortName || o.sourceName
              )}</a>`
          )
          .join(' • ')}</div>`
      : '';

  const laya = art.laya || {};
  const intPct = Math.round((laya.interestingProb ?? 0) * 100);
  const impScore = Math.round(laya.importanceScore ?? art.tvScore ?? 0);
  const impLabel = laya.importanceLabel || 'Média';
  const impClass =
    impLabel === 'Urgente'
      ? 'laya-imp--urgente'
      : impLabel === 'Alta'
        ? 'laya-imp--alta'
        : impLabel === 'Média'
          ? 'laya-imp--media'
          : 'laya-imp--baixa';
  const isLayaReal = laya.source === 'laya';
  const prefMatch = art.preferenceMatch || {};
  const prefTag =
    prefMatch.hasMatch && !art.likedByUser
      ? `<span class="laya-tag laya-tag--pref" title="Pontuação reforçada com base nas matérias que você curtiu">✨ Baseado no seu Gostei: ${escapeHtml(
          prefMatch.reason
        )}</span>`
      : '';
  const layaBlock = `
    <div class="story-card__laya">
      <span class="laya-tag ${laya.isInteresting ? 'laya-tag--interesting' : 'laya-tag--low'}">
        ${laya.isInteresting ? `★ Interessante (${intPct}%)` : `○ Baixo interesse (${intPct}%)`}
      </span>
      <span class="laya-tag ${impClass}">
        Importância: ${escapeHtml(impLabel)} (${impScore}/100)
      </span>
      ${prefTag}
      <span class="muted">${isLayaReal ? '🧠 Laya AI' : laya.status === 'pending' ? '⏳ Laya na fila' : 'Heurística'}</span>
    </div>
  `;

  return `
    <article class="story-card" data-url="${escapeHtml(art.canonicalUrl)}">
      <div class="story-card__top">
        ${mediaBlock}
        <div class="story-card__body">
          <div class="story-meta">
            <span class="source-badge" style="background:${escapeHtml(art.badgeColor || '#475569')}">${escapeHtml(
              art.sourceShortName || art.sourceName
            )}</span>
            <span class="beat-badge">${escapeHtml(art.tvCategory || 'Natal/RN')}</span>
            <span class="muted">${escapeHtml(formatRelativeTime(art.publishedAt))}</span>
            <span class="tv-score-badge ${scoreClass}">${art.tvScore} • ${escapeHtml(art.tvLabel)}</span>
          </div>
          <h3 class="story-card__title">
            <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(art.title)}</a>
          </h3>
        </div>
      </div>

      ${art.summary ? `<p class="story-card__summary">${escapeHtml(art.summary)}</p>` : ''}

      ${layaBlock}

      <div class="story-card__tv-box">
        <strong>🎬 Gancho TV:</strong> ${escapeHtml(art.tvSuggestion)}
      </div>

      ${alsoText}

      <div class="story-card__actions">
        <div class="story-card__actions-left">
          <button
            type="button"
            class="btn btn--sm ${art.likedByUser ? 'btn--liked' : 'btn--outline'}"
            data-action="toggle-like"
            aria-pressed="${art.likedByUser ? 'true' : 'false'}"
            title="Marcar gostei ajuda o sistema e o Laya AI a priorizar pautas semelhantes"
          >
            ${art.likedByUser ? '👍 Gostei (Ativo)' : '👍 Gostei'}
          </button>
          <button type="button" class="btn btn--sm ${art.sentToTelegram ? 'btn--sent' : 'btn--telegram'}" data-action="send-tg">
            ${art.sentToTelegram ? '✓ Reenviar Telegram' : '✈ Enviar Telegram'}
          </button>
          <button type="button" class="btn btn--sm ${art.inBulletin ? 'btn--sent' : 'btn--outline'}" data-action="toggle-bulletin">
            ${art.inBulletin ? '✓ No Boletim' : '+ Boletim'}
          </button>
        </div>
        <div class="story-card__actions-right">
          <a class="btn btn--sm btn--ghost" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Ler original ↗</a>
          <button type="button" class="btn btn--sm btn--ghost" data-action="block-manual" title="Ocultar matéria da ronda">Ocultar</button>
        </div>
      </div>
    </article>
  `;
}

function bindStoryCardActions(grid, items) {
  const byUrl = new Map(items.map((item) => [item.canonicalUrl, item]));
  grid.querySelectorAll('.story-card').forEach((card) => {
    const canonicalUrl = card.dataset.url;
    const article = byUrl.get(canonicalUrl);
    if (!article) return;

    card.querySelector('[data-action="toggle-like"]').addEventListener('click', () => toggleLike(article));
    card.querySelector('[data-action="send-tg"]').addEventListener('click', (e) => sendSingleToTelegram(article, e.currentTarget));
    card.querySelector('[data-action="toggle-bulletin"]').addEventListener('click', () => toggleBulletin(article));
    card.querySelector('[data-action="block-manual"]').addEventListener('click', () => overrideArticle(canonicalUrl, 'block'));
  });
}

function formatDayLabel(dateKey, todayKey) {
  if (!dateKey) return '';
  const [y, m, d] = dateKey.split('-');
  const shortDate = `${d}/${m}`;
  if (todayKey && dateKey === todayKey) return `Hoje (${shortDate})`;
  if (todayKey) {
    const todayDate = new Date(`${todayKey}T12:00:00Z`);
    const targetDate = new Date(`${dateKey}T12:00:00Z`);
    const diffDays = Math.round((todayDate - targetDate) / 86400000);
    if (diffDays === 1) return `Ontem (${shortDate})`;
  }
  return `${shortDate}/${y}`;
}

function renderPautas() {
  const items = getFilteredPautas();
  const sortMode = activeSortMode();
  const sortSelect = $('#ronda-sort-select');
  if (sortSelect) {
    sortSelect.value = SORT_LABELS[sortMode] ? sortMode : 'recent';
  }
  const summaryEl = $('#ronda-results-label');
  if (summaryEl) {
    const label = SORT_LABELS[sortMode] || 'Mais recentes';
    const likesCount = state.news.stats?.likedCount || 0;
    const likesHint = likesCount > 0 ? ` • 👍 ${likesCount} ${likesCount === 1 ? 'curtida' : 'curtidas'} guiando o Laya` : '';
    summaryEl.textContent = `${items.length} ${items.length === 1 ? 'pauta de hoje' : 'pautas de hoje'} • ${label}${likesHint}`;
  }

  const grid = $('#pautas-grid');
  const empty = $('#pautas-empty');

  if (items.length === 0) {
    grid.innerHTML = '';
    const emptyTitle = empty.querySelector('h3');
    const emptyText = empty.querySelector('p');
    const st = state.news.stats || {};
    const histCount = (state.news.historyPautas || []).length;
    if (state.news.isRefreshing) {
      if (emptyTitle) emptyTitle.textContent = 'Coletando notícias dos portais de Natal/RN…';
      if (emptyText) emptyText.innerHTML = 'Aguarde alguns segundos enquanto a ronda atualiza as 15 fontes.';
    } else if ((st.sourcesOk || 0) === 0 && (st.sourcesError || 0) > 0) {
      if (emptyTitle) emptyTitle.textContent = `Falha na coleta das fontes (${st.sourcesError} erro(s))`;
      if (emptyText) {
        emptyText.innerHTML =
          'Verifique os logs ou o status de cada portal em <a href="/configuracoes"><strong>Configurações</strong></a>.';
      }
    } else if (histCount > 0 && (state.news.pautas || []).length === 0) {
      if (emptyTitle) emptyTitle.textContent = 'Nenhuma pauta publicada hoje ainda';
      if (emptyText) {
        emptyText.innerHTML =
          `As matérias dos dias anteriores seguem salvas no histórico de 7 dias.<br><br><button type="button" id="open-history-cta" class="btn btn--outline btn--sm">Ver ${histCount} matérias no Histórico (7 dias)</button>`;
        $('#open-history-cta')?.addEventListener('click', () => switchTab('historico'));
      }
    } else {
      if (emptyTitle) emptyTitle.textContent = 'Nenhuma pauta encontrada para os filtros configurados';
      if (emptyText) {
        emptyText.innerHTML =
          'Ajuste os filtros na página de <a href="/configuracoes"><strong>Configurações</strong></a> ou clique em <strong>Atualizar Ronda</strong>.';
      }
    }
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  grid.innerHTML = items.map(renderStoryCardHtml).join('');
  bindStoryCardActions(grid, items);
}

function renderHistory() {
  const daySelect = $('#history-day-select');
  const sortSelect = $('#history-sort-select');
  const grid = $('#history-grid');
  const empty = $('#history-empty');
  const summaryEl = $('#history-results-label');
  if (!grid || !daySelect) return;

  const historyAll = state.news.historyPautas || state.news.pautas || [];
  const todayKey = state.news.todayDateKey || '';
  const dates = state.news.historyDates?.length
    ? state.news.historyDates
    : [...new Set(historyAll.map((a) => a.natalDate).filter(Boolean))].sort((a, b) => b.localeCompare(a));

  if (state.historyDay !== 'all' && !dates.includes(state.historyDay)) {
    state.historyDay = 'all';
  }

  daySelect.innerHTML = [
    `<option value="all">Todos os últimos ${state.news.retentionDays || 7} dias (${historyAll.length})</option>`,
    ...dates.map((dk) => {
      const count = historyAll.filter((a) => a.natalDate === dk).length;
      return `<option value="${escapeHtml(dk)}">${escapeHtml(formatDayLabel(dk, todayKey))} (${count})</option>`;
    })
  ].join('');
  daySelect.value = state.historyDay;
  if (sortSelect) sortSelect.value = state.historySortBy;

  const dayFiltered =
    state.historyDay === 'all' ? historyAll : historyAll.filter((a) => a.natalDate === state.historyDay);
  const items = filterDisplayItems(dayFiltered, {
    queryOverride: state.historyQuery,
    sortBy: state.historySortBy,
    skipConfigSearch: true
  });

  if (summaryEl) {
    const sortLabel = SORT_LABELS[state.historySortBy] || 'Mais recentes';
    summaryEl.textContent = `${items.length} ${items.length === 1 ? 'matéria' : 'matérias'} no histórico • ${sortLabel}`;
  }

  if (items.length === 0) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  grid.innerHTML = items.map(renderStoryCardHtml).join('');
  bindStoryCardActions(grid, items);
}

async function toggleLike(article) {
  try {
    const res = await api('/api/articles/like', {
      method: 'POST',
      body: JSON.stringify({ canonicalUrl: article.canonicalUrl, article })
    });
    state.news = res;
    renderAll();
    showToast(
      res.liked
        ? 'Gostei registrado! Próximas matérias semelhantes ganharão prioridade no Laya e na Ronda.'
        : 'Gostei removido.',
      res.liked ? 'ok' : 'info'
    );
  } catch (err) {
    showToast(err.message, 'err');
  }
}

async function sendSingleToTelegram(article, btnEl) {
  const prevText = btnEl.textContent;
  btnEl.disabled = true;
  btnEl.textContent = 'Enviando…';
  try {
    const res = await api('/api/telegram/send', {
      method: 'POST',
      body: JSON.stringify({ canonicalUrl: article.canonicalUrl, article })
    });
    state.sentHistory = res.sentHistory || state.sentHistory;
    article.sentToTelegram = true;
    showToast('Pauta enviada para o grupo do Telegram!', 'ok');
    renderStatsAndBadges();
    renderPautas();
    renderHistory();
    renderBulletinAndHistory();
  } catch (err) {
    showToast(err.message, 'err');
    btnEl.disabled = false;
    btnEl.textContent = prevText;
  }
}

async function toggleBulletin(article) {
  try {
    if (article.inBulletin) {
      state.bulletinQueue = await api(`/api/bulletin?url=${encodeURIComponent(article.canonicalUrl)}`, {
        method: 'DELETE'
      });
      article.inBulletin = false;
      showToast('Removida da fila do boletim.');
    } else {
      state.bulletinQueue = await api('/api/bulletin', {
        method: 'POST',
        body: JSON.stringify({ article })
      });
      article.inBulletin = true;
      showToast('Adicionada ao Boletim Telegram!', 'ok');
    }
    renderStatsAndBadges();
    renderPautas();
    renderHistory();
    renderBulletinAndHistory();
  } catch (err) {
    showToast(err.message, 'err');
  }
}

async function overrideArticle(canonicalUrl, action) {
  try {
    state.news = await api('/api/articles/override', {
      method: 'POST',
      body: JSON.stringify({ canonicalUrl, action })
    });
    showToast(action === 'approve' ? 'Matéria liberada para a Ronda!' : 'Matéria movida para bloqueadas.');
    renderAll();
  } catch (err) {
    showToast(err.message, 'err');
  }
}

function renderBulletinAndHistory() {
  const list = $('#bulletin-list');
  if (state.bulletinQueue.length === 0) {
    list.innerHTML = '<div class="empty-state"><p>Nenhuma pauta na fila. Clique em <strong>+ Boletim</strong> nas matérias da Ronda.</p></div>';
  } else {
    list.innerHTML = state.bulletinQueue
      .map(
        (art, idx) => `
        <div class="bulletin-item">
          <div>
            <div class="story-meta">
              <span class="source-badge" style="background:${escapeHtml(art.badgeColor || '#475569')}">${escapeHtml(
                art.sourceShortName || art.sourceName
              )}</span>
              <span class="beat-badge">${escapeHtml(art.tvCategory || 'Natal/RN')}</span>
            </div>
            <strong>${idx + 1}. ${escapeHtml(art.title)}</strong>
          </div>
          <button type="button" class="btn btn--ghost btn--sm" data-remove-url="${escapeHtml(art.canonicalUrl)}">Remover</button>
        </div>
      `
      )
      .join('');

    list.querySelectorAll('[data-remove-url]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        state.bulletinQueue = await api(`/api/bulletin?url=${encodeURIComponent(btn.dataset.removeUrl)}`, {
          method: 'DELETE'
        });
        const match = state.news.pautas.find((p) => p.canonicalUrl === btn.dataset.removeUrl);
        if (match) match.inBulletin = false;
        renderAll();
      });
    });
  }

  const histEl = $('#sent-history-list');
  if (state.sentHistory.length === 0) {
    histEl.innerHTML = '<div class="empty-state"><p>Nenhuma matéria enviada ao Telegram ainda.</p></div>';
  } else {
    histEl.innerHTML = state.sentHistory
      .slice(0, 30)
      .map(
        (h) => `
        <div class="history-item">
          <div>
            <strong>${escapeHtml(h.title)}</strong>
            <div class="muted">${escapeHtml(h.sourceName)} • ${escapeHtml(formatRelativeTime(h.sentAt))} • modo: ${escapeHtml(h.mode)}</div>
          </div>
        </div>
      `
      )
      .join('');
  }
}

function renderQuarantine() {
  const container = $('#quarantine-list');
  let items = [];
  if (state.quarantineView === 'prefeitura') items = state.news.quarantine || [];
  else if (state.quarantineView === 'geo') items = state.news.filteredGeo || [];
  else items = state.news.filteredLowTv || [];

  if (items.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>Nenhum item nesta categoria no momento.</p></div>';
    return;
  }

  container.innerHTML = items
    .map(
      (art) => `
      <div class="quarantine-item">
        <div>
          <div class="story-meta">
            <span class="source-badge" style="background:${escapeHtml(art.badgeColor || '#475569')}">${escapeHtml(
              art.sourceShortName || art.sourceName
            )}</span>
            <span class="muted">${escapeHtml(formatRelativeTime(art.publishedAt))}</span>
          </div>
          <strong><a href="${escapeHtml(safeHttpUrl(art.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(
            art.title
          )}</a></strong>
          <div><span class="quarantine-reason">${escapeHtml(art.statusReason || 'Filtrada pelo editor')}</span></div>
        </div>
        <button type="button" class="btn btn--outline btn--sm" data-approve-url="${escapeHtml(art.canonicalUrl)}">
          Liberar p/ Ronda
        </button>
      </div>
    `
    )
    .join('');

  container.querySelectorAll('[data-approve-url]').forEach((btn) => {
    btn.addEventListener('click', () => overrideArticle(btn.dataset.approveUrl, 'approve'));
  });
}

function saveClientCache() {
  try {
    if (!state.news?.lastSyncAt) return;
    const payload = {
      savedAt: Date.now(),
      news: state.news,
      bulletinQueue: state.bulletinQueue,
      sentHistory: state.sentHistory
    };
    localStorage.setItem(NEWS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Fallback smaller snapshot without filteredGeo if localStorage quota is tight
    try {
      localStorage.setItem(
        NEWS_STORAGE_KEY,
        JSON.stringify({
          savedAt: Date.now(),
          news: { ...state.news, filteredGeo: [], filteredLowTv: [] },
          bulletinQueue: state.bulletinQueue,
          sentHistory: state.sentHistory
        })
      );
    } catch {
      // ignore storage errors in private browsing
    }
  }
}

function loadClientCache() {
  try {
    const raw = localStorage.getItem(NEWS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.news && Array.isArray(parsed.news.pautas)) {
      return parsed;
    }
  } catch {
    // ignore corrupt storage
  }
  return null;
}

function hasVisibleArticles() {
  return Boolean((state.news?.pautas && state.news.pautas.length > 0) || state.news?.lastSyncAt);
}

function renderAll() {
  updateHeaderStatus();
  renderStatsAndBadges();
  renderPautas();
  renderHistory();
  renderBulletinAndHistory();
  renderQuarantine();
  saveClientCache();
}

function showLoadingPlaceholder(titleText, bodyHtml) {
  const empty = $('#pautas-empty');
  if (!empty) return;
  const h3 = empty.querySelector('h3');
  const p = empty.querySelector('p');
  if (h3) h3.textContent = titleText;
  if (p) p.innerHTML = bodyHtml;
  empty.classList.remove('hidden');
}

async function fetchNewsWithRetry() {
  try {
    return await api('/api/news', { timeoutMs: 25000 });
  } catch {
    await new Promise((r) => setTimeout(r, 1000));
    return api('/api/news?bootstrap=0', { timeoutMs: 25000 });
  }
}

function hydrateCachedViewBeforeFetch() {
  const serverNews = window.__INITIAL_NEWS__;
  const serverBulletin = window.__INITIAL_BULLETIN__;
  const localCache = loadClientCache();

  const serverReady = Boolean(serverNews?.lastSyncAt && Array.isArray(serverNews.pautas));
  const localReady = Boolean(localCache?.news?.lastSyncAt && Array.isArray(localCache.news.pautas));

  let usedFreshServerSnapshot = false;

  if (serverReady && (!localReady || new Date(serverNews.lastSyncAt) >= new Date(localCache.news.lastSyncAt))) {
    state.news = serverNews;
    if (Array.isArray(serverBulletin)) state.bulletinQueue = serverBulletin;
    if (Array.isArray(localCache?.sentHistory)) state.sentHistory = localCache.sentHistory;
    usedFreshServerSnapshot = true;
  } else if (localReady) {
    state.news = {
      ...localCache.news,
      isRefreshing: Boolean(serverNews?.isRefreshing)
    };
    if (Array.isArray(localCache.bulletinQueue)) state.bulletinQueue = localCache.bulletinQueue;
    if (Array.isArray(localCache.sentHistory)) state.sentHistory = localCache.sentHistory;
  }

  if (hasVisibleArticles()) {
    renderAll();
  }

  return usedFreshServerSnapshot;
}

async function loadInitialData() {
  const usedFreshServerSnapshot = hydrateCachedViewBeforeFetch();

  if (!hasVisibleArticles()) {
    showLoadingPlaceholder(
      'Sincronizando pautas de Natal/RN…',
      'Conectando aos portais e carregando a ronda mais recente.'
    );
  }

  const auxPromises = [
    api('/api/auth/status', { timeoutMs: 12000 }),
    api('/api/bulletin', { timeoutMs: 12000 }),
    api('/api/sent-history', { timeoutMs: 12000 })
  ];

  // If HTML didn't carry a fresh server snapshot (e.g. cold boot before cache finished), fetch /api/news too
  if (!usedFreshServerSnapshot || state.news.isRefreshing) {
    const [news, auxResults] = await Promise.all([fetchNewsWithRetry(), Promise.allSettled(auxPromises)]);
    const [authRes, bulletinRes, historyRes] = auxResults;
    state.auth = authRes.status === 'fulfilled' ? authRes.value : state.auth;
    if (news?.lastSyncAt || !hasVisibleArticles()) {
      state.news = news;
    }
    if (bulletinRes.status === 'fulfilled' && Array.isArray(bulletinRes.value)) {
      state.bulletinQueue = bulletinRes.value;
    }
    if (historyRes.status === 'fulfilled' && Array.isArray(historyRes.value)) {
      state.sentHistory = historyRes.value;
    }
    renderAll();
    return;
  }

  // Fresh SSR news already painted on screen: silently sync auth, bulletin and sent history without re-downloading news
  const [authRes, bulletinRes, historyRes] = await Promise.allSettled(auxPromises);
  state.auth = authRes.status === 'fulfilled' ? authRes.value : state.auth;
  if (bulletinRes.status === 'fulfilled' && Array.isArray(bulletinRes.value)) {
    state.bulletinQueue = bulletinRes.value;
  }
  if (historyRes.status === 'fulfilled' && Array.isArray(historyRes.value)) {
    state.sentHistory = historyRes.value;
  }
  renderAll();
}

async function refreshRound() {
  const btn = $('#refresh-btn');
  const icon = $('#refresh-icon');
  const label = $('#refresh-label');
  btn.disabled = true;
  icon.classList.add('spin');
  label.textContent = 'Coletando portais…';

  try {
    state.news = await api('/api/refresh', { method: 'POST', timeoutMs: 45000 });
    try {
      state.sentHistory = await api('/api/sent-history', { timeoutMs: 12000 });
    } catch {
      // keep existing history if secondary fetch blips
    }
    renderAll();
    showToast(`Ronda atualizada: ${state.news.stats?.totalPautas || 0} pautas aptas para TV!`, 'ok');
  } catch (err) {
    showToast(`Erro ao atualizar ronda: ${err.message}`, 'err');
  } finally {
    btn.disabled = false;
    icon.classList.remove('spin');
    label.textContent = 'Atualizar Ronda';
  }
}

function bindEvents() {
  $$('.tab-btn[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  $('#refresh-btn').addEventListener('click', refreshRound);

  $('#ronda-sort-select')?.addEventListener('change', (e) => {
    state.sortOverride = e.target.value;
    renderPautas();
  });

  $('#history-search-input')?.addEventListener('input', (e) => {
    state.historyQuery = e.target.value;
    renderHistory();
  });

  $('#history-day-select')?.addEventListener('change', (e) => {
    state.historyDay = e.target.value;
    renderHistory();
  });

  $('#history-sort-select')?.addEventListener('change', (e) => {
    state.historySortBy = e.target.value;
    renderHistory();
  });

  $$('#quarantine-view-toggle .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.quarantineView = btn.dataset.qview;
      $$('#quarantine-view-toggle .seg-btn').forEach((b) => b.classList.toggle('is-active', b === btn));
      renderQuarantine();
    });
  });

  $('#clear-bulletin-btn').addEventListener('click', async () => {
    state.bulletinQueue = await api('/api/bulletin', { method: 'DELETE' });
    state.news.pautas.forEach((p) => { p.inBulletin = false; });
    (state.news.historyPautas || []).forEach((p) => { p.inBulletin = false; });
    renderAll();
  });

  const dispatchBulletin = async (mode) => {
    try {
      const headerTitle = $('#bulletin-title-input').value.trim() || 'BOLETIM DA RONDA — NATAL/RN';
      const res = await api('/api/telegram/send-bulletin', {
        method: 'POST',
        body: JSON.stringify({ mode, headerTitle, clearQueue: true })
      });
      state.bulletinQueue = res.bulletinQueue || [];
      state.sentHistory = res.sentHistory || [];
      state.news = await api('/api/news?bootstrap=0');
      renderAll();
      showToast(`Boletim enviado ao Telegram (${res.sentCount} pauta(s))!`, 'ok');
    } catch (err) {
      showToast(err.message, 'err');
    }
  };

  $('#send-bulletin-digest-btn').addEventListener('click', () => dispatchBulletin('digest'));
  $('#send-bulletin-individual-btn').addEventListener('click', () => dispatchBulletin('individual'));
}

async function bootstrapLoad() {
  try {
    await loadInitialData();
  } catch (err) {
    if (hasVisibleArticles()) {
      showToast(`Usando matérias salvas localmente (${err.message}).`, 'err');
      return;
    }
    $('#last-sync-label').textContent = 'Falha ao carregar';
    showLoadingPlaceholder(
      'Não foi possível carregar as pautas agora',
      `Detalhe: <code>${escapeHtml(err.message)}</code><br><br><button type="button" id="retry-load-btn" class="btn btn--primary btn--sm">↻ Tentar novamente</button>`
    );
    $('#retry-load-btn')?.addEventListener('click', () => bootstrapLoad());
    showToast(`Erro ao iniciar painel: ${err.message}`, 'err');
  }
}

async function init() {
  startNatalClock();
  bindEvents();
  await bootstrapLoad();
}

init();
