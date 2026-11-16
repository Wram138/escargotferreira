export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => [...document.querySelectorAll(sel)];

export function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function safeHttpUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch {
    // invalid
  }
  return '#';
}

export function showToast(message, type = 'info') {
  const container = $('#toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${type === 'ok' ? 'toast--ok' : type === 'err' ? 'toast--err' : ''}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

export function showInlineAlert(el, msg, isOk) {
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden', 'inline-alert--ok', 'inline-alert--err');
  el.classList.add(isOk ? 'inline-alert--ok' : 'inline-alert--err');
}

export async function api(path, options = {}, onAuthRequired = null) {
  const { timeoutMs = 25000, ...fetchOpts } = options;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer = null;
  if (controller && timeoutMs > 0) {
    timer = setTimeout(() => controller.abort(), timeoutMs);
  }

  let res;
  try {
    res = await fetch(path, {
      headers: { 'Content-Type': 'application/json', ...(fetchOpts.headers || {}) },
      ...(controller ? { signal: controller.signal } : {}),
      ...fetchOpts
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('Tempo limite excedido ao conectar ao servidor.');
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && data.authRequired && typeof onAuthRequired === 'function') {
      onAuthRequired();
    }
    throw new Error(data.error || `Erro HTTP ${res.status}`);
  }
  return data;
}

export function formatRelativeTime(iso) {
  if (!iso) return '';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return '';
  const diffMin = Math.round((Date.now() - ts) / 60000);
  const clock = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Fortaleza',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(ts));

  if (diffMin < 1) return `agora • ${clock}`;
  if (diffMin < 60) return `há ${diffMin} min • ${clock}`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `há ${diffHours}h • ${clock}`;
  const day = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Fortaleza',
    day: '2-digit',
    month: '2-digit'
  }).format(new Date(ts));
  return `${day} • ${clock}`;
}

export function startNatalClock(elSelector = '#natal-clock') {
  const update = () => {
    const el = $(elSelector);
    if (!el) return;
    const now = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Fortaleza',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(new Date());
    el.textContent = `Natal ${now}`;
  };
  update();
  return setInterval(update, 1000);
}

export function formatLastSync(iso) {
  if (!iso) return 'Aguardando ronda';
  const t = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Fortaleza',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(iso));
  return `Atualizado ${t}`;
}

export function sortArticles(items = [], sortBy = 'recent') {
  const copy = [...items];
  const pubTs = (a) => new Date(a?.publishedAt || 0).getTime() || 0;

  if (sortBy === 'importance') {
    return copy.sort(
      (a, b) =>
        (b.laya?.importanceScore ?? 0) - (a.laya?.importanceScore ?? 0) ||
        (b.laya?.interestingProb ?? 0) - (a.laya?.interestingProb ?? 0) ||
        pubTs(b) - pubTs(a)
    );
  }

  if (sortBy === 'interesting') {
    return copy.sort(
      (a, b) =>
        (b.laya?.interestingProb ?? 0) - (a.laya?.interestingProb ?? 0) ||
        (b.laya?.muitoInteressanteProb ?? 0) - (a.laya?.muitoInteressanteProb ?? 0) ||
        (b.laya?.importanceScore ?? 0) - (a.laya?.importanceScore ?? 0) ||
        pubTs(b) - pubTs(a)
    );
  }

  if (sortBy === 'tvScore') {
    return copy.sort((a, b) => (b.tvScore ?? 0) - (a.tvScore ?? 0) || pubTs(b) - pubTs(a));
  }

  return copy.sort((a, b) => pubTs(b) - pubTs(a));
}
