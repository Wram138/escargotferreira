import {
  $,
  api,
  escapeHtml,
  formatLastSync,
  showInlineAlert,
  showToast,
  startNatalClock
} from './shared.js?v=20261116';

const state = {
  auth: {
    authenticated: false,
    username: null
  },
  news: {
    pautas: [],
    layaStatus: null,
    stats: {},
    telegramConfigured: false
  },
  settings: null,
  sources: [],
  sentHistory: [],
  displayDraft: {
    searchQuery: '',
    beatFilter: 'all',
    interestFilter: 'all',
    sortBy: 'recent',
    sourceFilter: 'all'
  },
  layaPollTimer: null
};

function onAuthRequired() {
  state.auth = { authenticated: false, username: null };
  state.settings = null;
  state.sources = [];
  renderAuthGate();
}

async function req(path, options = {}) {
  return api(path, options, onAuthRequired);
}

function renderAuthGate() {
  const isAuthed = Boolean(state.auth?.authenticated);
  $('#config-login-card').classList.toggle('hidden', isAuthed);
  $('#config-protected-content').classList.toggle('hidden', !isAuthed);
  $('#config-tab-label').textContent = isAuthed ? '🔓 Configurações' : '🔒 Configurações';
  if (isAuthed && state.auth.username) {
    $('#auth-session-user').textContent = state.auth.username;
  }
}

function updateStatusIndicators() {
  $('#last-sync-label').textContent = formatLastSync(state.news.lastSyncAt);

  const tgPill = $('#tg-status-pill');
  const tgText = $('#tg-status-text');
  const hasTg = Boolean(
    state.news?.telegramConfigured ||
    (state.settings?.meta?.hasBotToken && state.settings?.meta?.hasChatId)
  );
  tgPill.classList.toggle('tg-pill--ok', hasTg);
  tgPill.classList.toggle('tg-pill--warn', !hasTg);
  tgText.textContent = hasTg ? 'Telegram Conectado' : 'Telegram: configurar token e grupo';

  const layaPill = $('#laya-status-pill');
  const layaText = $('#laya-status-text');
  const layaCfgBadge = $('#laya-config-badge');
  const ls = state.news.layaStatus;
  let layaLabel = 'Laya: verificando…';
  let layaOk = false;

  if (!ls || !ls.enabled) {
    layaLabel = 'Laya: desativado';
  } else if (ls.isClassifying) {
    layaLabel = `Laya analisando (${ls.classifiedCount}/${ls.totalEligible})…`;
    layaOk = true;
  } else if (ls.online) {
    layaLabel = `Laya Ativo (${ls.classifiedCount}/${ls.totalEligible})`;
    layaOk = true;
  } else {
    layaLabel = 'Laya: carregando modelo…';
  }

  layaPill.classList.toggle('laya-pill--ok', layaOk);
  layaPill.classList.toggle('laya-pill--warn', !layaOk);
  layaText.textContent = layaLabel;
  if (layaCfgBadge) layaCfgBadge.textContent = layaLabel;

  if (state.layaPollTimer) {
    clearTimeout(state.layaPollTimer);
    state.layaPollTimer = null;
  }
  const shouldPoll =
    state.auth.authenticated &&
    ls?.enabled &&
    (ls.isClassifying || (!ls.online && (ls.totalEligible ?? 0) > 0 && ls.classifiedCount < ls.totalEligible));
  if (shouldPoll) {
    state.layaPollTimer = setTimeout(async () => {
      try {
        state.news = await req('/api/news?bootstrap=0');
        updateStatusIndicators();
        renderKpis();
      } catch {
        // ignore transient poll
      }
    }, 3500);
  }
}

function renderKpis() {
  const stats = state.news.stats || {};
  const ls = state.news.layaStatus || {};
  const interestingCount =
    stats.layaInterestingCount ?? (state.news.pautas || []).filter((p) => p.laya?.isInteresting).length;
  const blockedTotal = (stats.blockedPrefeitura || 0) + (stats.blockedCrime || 0) + (stats.blockedManual || 0);

  $('#kpi-pautas').textContent = stats.totalPautas ?? 0;
  $('#kpi-sources-hint').textContent = `${stats.sourcesOk ?? 0} fontes OK${
    stats.sourcesError ? ` • ${stats.sourcesError} erro(s)` : ''
  }`;
  $('#kpi-strong').textContent = interestingCount;
  $('#kpi-laya-hint').textContent = ls.enabled
    ? `${ls.classifiedCount ?? 0} de ${ls.totalEligible ?? 0} avaliadas pelo Laya`
    : 'Laya desativado (heurística local)';
  $('#kpi-blocked').textContent = blockedTotal;
  $('#kpi-offtopic-hint').textContent = `${(stats.filteredGeo || 0) + (stats.filteredLowTv || 0)} fora de Natal / baixo apelo`;
  $('#kpi-sent').textContent = state.sentHistory.length;
}

function renderSourceFilterChips() {
  const container = $('#source-chips');
  const active = state.displayDraft.sourceFilter || 'all';

  const chips = [
    { id: 'all', label: 'Todas as fontes' },
    { id: 'cat:portal', label: 'Portais' },
    { id: 'cat:blog', label: 'Blogs & Rádios Locais' },
    { id: 'cat:agencia', label: 'Agência Brasil' },
    { id: 'src:tribuna', label: 'Tribuna' },
    { id: 'src:g1-rn', label: 'G1 RN' },
    { id: 'src:novo-noticias', label: 'NOVO' },
    { id: 'src:ponta-negra-news', label: 'Ponta Negra' },
    { id: 'src:blog-do-bg', label: 'Blog do BG' }
  ];

  container.innerHTML = chips
    .map(
      (c) =>
        `<button type="button" class="chip ${active === c.id ? 'is-active' : ''}" data-source-filter="${escapeHtml(
          c.id
        )}">${escapeHtml(c.label)}</button>`
    )
    .join('');

  container.querySelectorAll('.chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.displayDraft.sourceFilter = btn.dataset.sourceFilter;
      renderSourceFilterChips();
    });
  });
}

function renderSettingsAndSources() {
  if (state.settings) {
    const { telegram, editorial, laya, display } = state.settings;
    $('#tg-token-input').value = telegram.botToken || '';
    $('#tg-chat-input').value = telegram.chatId || '';
    $('#tg-inc-summary').checked = Boolean(telegram.includeSummary);
    $('#tg-inc-suggestion').checked = Boolean(telegram.includeTvSuggestion);
    $('#tg-inc-score').checked = Boolean(telegram.includeScore);
    $('#tg-inc-laya').checked = telegram.includeLayaImportance !== false;
    $('#tg-inc-link').checked = Boolean(telegram.includeLink);
    $('#tg-auto-send').checked = Boolean(telegram.autoSendEnabled);
    $('#tg-auto-score').value = telegram.autoSendMinScore ?? 72;

    $('#ed-block-crime').checked = editorial.blockCrimeViolence !== false;
    $('#ed-pref-level').value = editorial.prefeituraFilterLevel || 'strict';
    $('#ed-city-mode').value = editorial.cityFilterMode || 'natal_strict';
    $('#ed-min-tv').value = editorial.minTvScore ?? 30;
    $('#ed-min-tv-val').textContent = editorial.minTvScore ?? 30;
    $('#ed-blocked-terms').value = (editorial.customBlockedTerms || []).join(', ');
    $('#ed-refresh-mins').value = editorial.refreshIntervalMinutes ?? 15;

    if (laya) {
      $('#laya-enabled-chk').checked = Boolean(laya.enabled);
      $('#laya-filter-low-chk').checked = Boolean(laya.filterLowInterest);
      $('#laya-url-input').value = laya.endpointUrl || 'http://127.0.0.1:8001';
      const probPct = Math.round((laya.minInterestProb ?? 0.45) * 100);
      $('#laya-min-prob').value = probPct;
      $('#laya-min-prob-val').textContent = `${probPct}%`;
    }

    const prefsBox = $('#laya-prefs-box');
    const prof = state.news?.preferenceProfile;
    if (prefsBox) {
      if (prof && prof.totalLikes > 0) {
        const kws = (prof.topKeywords || []).slice(0, 8).join(', ') || 'nenhuma ainda';
        const beats = (prof.topCategories || []).join(', ') || 'diversas';
        prefsBox.innerHTML = `<strong>👍 Aprendizado ativo (${prof.totalLikes} ${
          prof.totalLikes === 1 ? 'matéria curtida' : 'matérias curtidas'
        }):</strong> Editorias preferidas: <span>${escapeHtml(beats)}</span> • Temas frequentes: <code>${escapeHtml(
          kws
        )}</code>`;
        prefsBox.classList.remove('hidden');
      } else {
        prefsBox.classList.add('hidden');
      }
    }

    if (display) {
      state.displayDraft = { ...state.displayDraft, ...display };
      $('#search-input').value = state.displayDraft.searchQuery || '';
      $('#beat-filter').value = state.displayDraft.beatFilter || 'all';
      $('#interest-filter').value = state.displayDraft.interestFilter || 'all';
      $('#sort-select').value = state.displayDraft.sortBy || 'recent';
    }
  }

  renderSourceFilterChips();

  const list = $('#sources-list');
  list.innerHTML = state.sources
    .map((src) => {
      const st = src.lastStatus;
      const statusText = !src.enabled
        ? 'Desativada'
        : !st
          ? 'Aguardando coleta'
          : st.ok
            ? `✓ ${st.itemCount} itens (${st.durationMs}ms)`
            : `⚠ Erro: ${st.error}`;

      return `
        <div class="source-item">
          <div>
            <div class="source-item__name">${escapeHtml(src.name)}</div>
            <div class="source-item__meta">${escapeHtml(src.category.toUpperCase())} • ${escapeHtml(statusText)}</div>
          </div>
          <div class="source-item__controls">
            <label class="check-item" title="Ativar/Desativar fonte">
              <input type="checkbox" data-toggle-src="${escapeHtml(src.id)}" ${src.enabled ? 'checked' : ''} />
            </label>
            ${
              !src.builtin
                ? `<button type="button" class="btn btn--ghost btn--sm" data-del-src="${escapeHtml(src.id)}">✕</button>`
                : ''
            }
          </div>
        </div>
      `;
    })
    .join('');

  list.querySelectorAll('[data-toggle-src]').forEach((chk) => {
    chk.addEventListener('change', async () => {
      try {
        await req(`/api/sources/${encodeURIComponent(chk.dataset.toggleSrc)}`, {
          method: 'PATCH',
          body: JSON.stringify({ enabled: chk.checked })
        });
        await loadSources();
        showToast('Fonte atualizada! Clique em Atualizar Ronda para aplicar na coleta.', 'ok');
      } catch (err) {
        showToast(err.message, 'err');
      }
    });
  });

  list.querySelectorAll('[data-del-src]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await req(`/api/sources/${encodeURIComponent(btn.dataset.delSrc)}`, { method: 'DELETE' });
        await loadSources();
        showToast('Fonte removida.', 'ok');
      } catch (err) {
        showToast(err.message, 'err');
      }
    });
  });
}

function renderAll() {
  renderAuthGate();
  updateStatusIndicators();
  if (state.auth.authenticated) {
    renderKpis();
    renderSettingsAndSources();
  }
}

async function loadSources() {
  if (!state.auth.authenticated) return;
  state.sources = await req('/api/sources');
  renderSettingsAndSources();
}

async function loadProtectedConfig() {
  if (!state.auth.authenticated) return;
  const [settings, sources] = await Promise.all([req('/api/settings'), req('/api/sources')]);
  state.settings = settings;
  state.sources = sources;
}

async function loadInitialData() {
  const [authStatus, news, history] = await Promise.all([
    req('/api/auth/status'),
    req('/api/news'),
    req('/api/sent-history')
  ]);
  state.auth = authStatus;
  state.news = news;
  state.sentHistory = history;
  if (state.auth.authenticated) {
    await loadProtectedConfig();
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
    state.news = await req('/api/refresh', { method: 'POST' });
    if (state.auth.authenticated) {
      state.sources = await req('/api/sources');
    }
    state.sentHistory = await req('/api/sent-history');
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
  $('#refresh-btn').addEventListener('click', refreshRound);

  $('#toggle-auth-pass').addEventListener('click', () => {
    const inp = $('#auth-pass-input');
    const isPass = inp.type === 'password';
    inp.type = isPass ? 'text' : 'password';
    $('#toggle-auth-pass').textContent = isPass ? 'Ocultar' : 'Mostrar';
  });

  $('#auth-login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('#auth-login-error');
    errEl.classList.add('hidden');
    try {
      const res = await req('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          username: $('#auth-user-input').value.trim(),
          password: $('#auth-pass-input').value
        })
      });
      state.auth = { authenticated: true, username: res.username };
      $('#auth-pass-input').value = '';
      await loadProtectedConfig();
      renderAll();
      showToast(`Configurações desbloqueadas (${res.username})`, 'ok');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });

  $('#auth-logout-btn').addEventListener('click', async () => {
    try {
      await req('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    onAuthRequired();
    showToast('Configurações bloqueadas.');
  });

  $('#auth-credentials-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const feedback = $('#cred-feedback');
    try {
      const res = await req('/api/auth/credentials', {
        method: 'PUT',
        body: JSON.stringify({
          currentPassword: $('#cred-current-pass').value,
          newUsername: $('#cred-new-user').value.trim(),
          newPassword: $('#cred-new-pass').value
        })
      });
      state.auth = { authenticated: true, username: res.username };
      $('#cred-current-pass').value = '';
      $('#cred-new-user').value = '';
      $('#cred-new-pass').value = '';
      renderAuthGate();
      showInlineAlert(feedback, res.message, true);
      showToast('Credenciais atualizadas!', 'ok');
    } catch (err) {
      showInlineAlert(feedback, err.message, false);
    }
  });

  // Display filters
  $('#display-filters-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const feedback = $('#display-feedback');
    try {
      state.settings = await req('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          display: {
            searchQuery: $('#search-input').value.trim(),
            beatFilter: $('#beat-filter').value,
            interestFilter: $('#interest-filter').value,
            sortBy: $('#sort-select').value,
            sourceFilter: state.displayDraft.sourceFilter || 'all'
          }
        })
      });
      showInlineAlert(feedback, 'Filtros salvos! A página principal da Ronda já está usando essa seleção.', true);
      showToast('Filtros da Ronda atualizados!', 'ok');
    } catch (err) {
      showInlineAlert(feedback, err.message, false);
    }
  });

  $('#reset-display-filters-btn').addEventListener('click', async () => {
    state.displayDraft = {
      searchQuery: '',
      beatFilter: 'all',
      interestFilter: 'all',
      sortBy: 'recent',
      sourceFilter: 'all'
    };
    state.settings = await req('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ display: state.displayDraft })
    });
    renderSettingsAndSources();
    showInlineAlert($('#display-feedback'), 'Filtros restaurados para exibir todas as pautas.', true);
  });

  // Telegram
  $('#toggle-token-vis').addEventListener('click', () => {
    const inp = $('#tg-token-input');
    const isPass = inp.type === 'password';
    inp.type = isPass ? 'text' : 'password';
    $('#toggle-token-vis').textContent = isPass ? 'Ocultar' : 'Mostrar';
  });

  $('#telegram-settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const feedback = $('#tg-feedback');
    try {
      state.settings = await req('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          telegram: {
            botToken: $('#tg-token-input').value.trim(),
            chatId: $('#tg-chat-input').value.trim(),
            includeSummary: $('#tg-inc-summary').checked,
            includeTvSuggestion: $('#tg-inc-suggestion').checked,
            includeScore: $('#tg-inc-score').checked,
            includeLayaImportance: $('#tg-inc-laya').checked,
            includeLink: $('#tg-inc-link').checked,
            autoSendEnabled: $('#tg-auto-send').checked,
            autoSendMinScore: Number($('#tg-auto-score').value) || 72
          }
        })
      });
      updateStatusIndicators();
      showInlineAlert(feedback, 'Configurações do Telegram salvas!', true);
      showToast('Token e grupo salvos!', 'ok');
    } catch (err) {
      showInlineAlert(feedback, err.message, false);
    }
  });

  $('#detect-chats-btn').addEventListener('click', async () => {
    const box = $('#detected-chats-box');
    const feedback = $('#tg-feedback');
    const botToken = $('#tg-token-input').value.trim();
    try {
      const res = await req('/api/telegram/detect-chats', {
        method: 'POST',
        body: JSON.stringify({ botToken })
      });
      if (!res.chats || res.chats.length === 0) {
        box.classList.add('hidden');
        showInlineAlert(
          feedback,
          'Nenhum grupo recente encontrado. Adicione o bot ao grupo, envie uma mensagem lá e clique novamente.',
          false
        );
        return;
      }
      box.classList.remove('hidden');
      box.innerHTML = res.chats
        .map(
          (c) =>
            `<button type="button" class="chat-pick-btn" data-chat-id="${escapeHtml(c.id)}">${escapeHtml(
              c.title
            )} (${escapeHtml(c.type)}: ${escapeHtml(c.id)})</button>`
        )
        .join('');
      box.querySelectorAll('.chat-pick-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          $('#tg-chat-input').value = btn.dataset.chatId;
          showToast(`Grupo selecionado: ${btn.dataset.chatId}`, 'ok');
        });
      });
      showInlineAlert(feedback, `${res.chats.length} chat(s) detectado(s). Clique para selecionar.`, true);
    } catch (err) {
      showInlineAlert(feedback, err.message, false);
    }
  });

  $('#test-tg-btn').addEventListener('click', async () => {
    const feedback = $('#tg-feedback');
    const botToken = $('#tg-token-input').value.trim();
    const chatId = $('#tg-chat-input').value.trim();
    try {
      const res = await req('/api/telegram/test', {
        method: 'POST',
        body: JSON.stringify({ botToken, chatId })
      });
      showInlineAlert(feedback, res.message || 'Teste concluído!', true);
      showToast(res.message || 'Conexão Telegram OK!', 'ok');
    } catch (err) {
      showInlineAlert(feedback, err.message, false);
    }
  });

  // Editorial rules
  $('#ed-min-tv').addEventListener('input', (e) => {
    $('#ed-min-tv-val').textContent = e.target.value;
  });

  $('#editorial-settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const customBlockedTerms = $('#ed-blocked-terms')
        .value.split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      state.settings = await req('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          editorial: {
            blockCrimeViolence: $('#ed-block-crime').checked,
            prefeituraFilterLevel: $('#ed-pref-level').value,
            cityFilterMode: $('#ed-city-mode').value,
            minTvScore: Number($('#ed-min-tv').value),
            customBlockedTerms,
            refreshIntervalMinutes: Number($('#ed-refresh-mins').value) || 15
          }
        })
      });
      state.news = await req('/api/news?bootstrap=0');
      renderAll();
      showToast('Regras editoriais aplicadas imediatamente!', 'ok');
    } catch (err) {
      showToast(err.message, 'err');
    }
  });

  // Laya AI
  $('#laya-min-prob').addEventListener('input', (e) => {
    $('#laya-min-prob-val').textContent = `${e.target.value}%`;
  });

  $('#laya-settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const feedback = $('#laya-feedback');
    try {
      state.settings = await req('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          laya: {
            enabled: $('#laya-enabled-chk').checked,
            filterLowInterest: $('#laya-filter-low-chk').checked,
            endpointUrl: $('#laya-url-input').value.trim() || 'http://127.0.0.1:8001',
            minInterestProb: Number($('#laya-min-prob').value) / 100
          }
        })
      });
      state.news = await req('/api/news?bootstrap=0');
      renderAll();
      showInlineAlert(feedback, 'Configurações do Laya AI salvas!', true);
      showToast('Regras do Laya atualizadas!', 'ok');
    } catch (err) {
      showInlineAlert(feedback, err.message, false);
    }
  });

  $('#laya-reclassify-btn').addEventListener('click', async () => {
    const feedback = $('#laya-feedback');
    try {
      const res = await req('/api/laya/reclassify', {
        method: 'POST',
        body: JSON.stringify({ forceAll: true })
      });
      state.news = res.view;
      renderAll();
      showInlineAlert(feedback, res.message, true);
      showToast('Reclassificação Laya iniciada!', 'ok');
    } catch (err) {
      showInlineAlert(feedback, err.message, false);
    }
  });

  $('#clear-likes-btn')?.addEventListener('click', async () => {
    const feedback = $('#laya-feedback');
    try {
      state.news = await req('/api/likes', { method: 'DELETE' });
      renderAll();
      showInlineAlert(feedback, 'Histórico de curtidas (Gostei) limpo com sucesso.', true);
      showToast('Aprendizado de curtidas redefinido.', 'ok');
    } catch (err) {
      showInlineAlert(feedback, err.message, false);
    }
  });

  // Sources
  $('#probe-source-btn').addEventListener('click', async () => {
    const url = $('#src-url-input').value.trim();
    const feedback = $('#source-probe-feedback');
    if (!url) return;
    try {
      const res = await req('/api/sources/probe', {
        method: 'POST',
        body: JSON.stringify({ url })
      });
      if (!$('#src-name-input').value.trim() && res.suggestedName) {
        $('#src-name-input').value = res.suggestedName.split(/[|\-–]/)[0].trim();
      }
      showInlineAlert(
        feedback,
        `Detectado ${res.type.toUpperCase()} (${res.previewCount} matérias). Exemplo: "${res.sampleTitle}"`,
        true
      );
    } catch (err) {
      showInlineAlert(feedback, err.message, false);
    }
  });

  $('#add-source-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const feedback = $('#source-probe-feedback');
    try {
      const created = await req('/api/sources', {
        method: 'POST',
        body: JSON.stringify({
          name: $('#src-name-input').value.trim(),
          url: $('#src-url-input').value.trim(),
          category: $('#src-cat-input').value,
          type: 'auto'
        })
      });
      $('#src-name-input').value = '';
      $('#src-url-input').value = '';
      showInlineAlert(feedback, `Fonte "${created.name}" adicionada!`, true);
      await loadSources();
      showToast(`Fonte "${created.name}" adicionada!`, 'ok');
    } catch (err) {
      showInlineAlert(feedback, err.message, false);
    }
  });
}

async function init() {
  startNatalClock();
  bindEvents();
  try {
    await loadInitialData();
  } catch (err) {
    showToast(`Erro ao carregar configurações: ${err.message}`, 'err');
  }
}

init();
