import fs from 'node:fs';
import path from 'node:path';
import { fetchSource } from './fetcher.js';
import { classifyArticle, normalizeText } from './classifier.js';
import { formatArticleMessage, sendTelegramMessage } from './telegram.js';
import { sortArticles } from '../../public/shared.js';
import { buildPreferenceProfile } from './preferences.js';
import {
  buildLayaFallback,
  checkLayaHealth,
  classifyBatchWithLaya,
  computeImportanceScore,
  importanceLabelFromScore
} from './laya.js';

const PT_STOPWORDS = new Set([
  'a', 'o', 'as', 'os', 'de', 'da', 'do', 'das', 'dos', 'em', 'na', 'no', 'nas', 'nos',
  'para', 'por', 'com', 'sem', 'e', 'ou', 'que', 'se', 'um', 'uma', 'ao', 'aos',
  'natal', 'rn', 'prefeitura', 'sobre', 'apos', 'entre', 'ate', 'diz', 'veja', 'confira',
  'para', 'quem', 'esta', 'dia', 'nesta', 'neste', 'nesse', 'nessa', 'mais', 'tem'
]);

function titleTokens(title) {
  return new Set(
    normalizeText(title)
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2 && !PT_STOPWORDS.has(t))
      .map((t) => (t.length >= 6 && !/^\d+$/.test(t) ? t.slice(0, 6) : t))
  );
}

function headlineSimilarity(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return { intersection: 0, jaccard: 0, overlap: 0 };
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  const minSize = Math.min(setA.size, setB.size);
  return {
    intersection,
    jaccard: union === 0 ? 0 : intersection / union,
    overlap: minSize === 0 ? 0 : intersection / minSize
  };
}

const RETENTION_DAYS = 7;
const NATAL_TIMEZONE = 'America/Fortaleza';

export function toNatalDateKey(isoOrDate = new Date()) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: NATAL_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
}

function getArticleRetentionTs(item, fallbackMs = Date.now()) {
  const pubTs = item?.publishedAt ? new Date(item.publishedAt).getTime() : NaN;
  if (!Number.isNaN(pubTs)) return pubTs;
  const seenTs = item?.firstSeenAt ? new Date(item.firstSeenAt).getTime() : NaN;
  if (!Number.isNaN(seenTs)) return seenTs;
  return fallbackMs;
}

/**
 * Merges two records of the same canonicalUrl without ever downgrading geoHint,
 * content richness, original same-day publishedAt, or homepage sticky status.
 */
function mergeArticleRecords(prev, fresh, nowIso = new Date().toISOString()) {
  if (!prev) {
    const { alsoReportedBy, ...cleanFresh } = fresh;
    return {
      ...cleanFresh,
      ...(Array.isArray(alsoReportedBy) && alsoReportedBy.length > 0 ? { alsoReportedBy } : {}),
      imageUrl: cleanFresh.imageUrl || null,
      firstSeenAt: cleanFresh.firstSeenAt || cleanFresh.publishedAt || nowIso,
      homepageDateKey: cleanFresh.homepageDateKey || null,
      homepageEditorialSig: cleanFresh.homepageEditorialSig || null
    };
  }

  const { alsoReportedBy: freshAlso, ...cleanFresh } = fresh;
  const { alsoReportedBy: prevAlso, ...cleanPrev } = prev;

  // Never let a generic feed (e.g. tribuna-geral) downgrade a dedicated Natal feed (tribuna-natal)
  const keepPrevSource = cleanPrev.geoHint === 'natal' && cleanFresh.geoHint !== 'natal';
  const geoHint =
    cleanPrev.geoHint === 'natal' || cleanFresh.geoHint === 'natal'
      ? 'natal'
      : cleanFresh.geoHint || cleanPrev.geoHint || 'rn';

  // Preserve the richest text so an RSS fallback never overwrites a full WP-JSON article
  const summary =
    (cleanFresh.summary || '').length >= (cleanPrev.summary || '').length
      ? cleanFresh.summary
      : cleanPrev.summary;
  const content =
    (cleanFresh.content || '').length >= (cleanPrev.content || '').length
      ? cleanFresh.content
      : cleanPrev.content;

  const categories = [
    ...new Set([
      ...(Array.isArray(cleanPrev.categories) ? cleanPrev.categories : []),
      ...(Array.isArray(cleanFresh.categories) ? cleanFresh.categories : [])
    ])
  ];

  const firstSeenAt = cleanPrev.firstSeenAt || cleanFresh.firstSeenAt || cleanPrev.publishedAt || nowIso;
  const homepageDateKey = cleanPrev.homepageDateKey || cleanFresh.homepageDateKey || null;
  const homepageEditorialSig = cleanPrev.homepageEditorialSig || cleanFresh.homepageEditorialSig || null;

  // Keep publishedAt locked to its original day if it already matched homepageDateKey or firstSeenAt
  const prevPubDay = toNatalDateKey(cleanPrev.publishedAt);
  const freshPubDay = toNatalDateKey(cleanFresh.publishedAt);
  const lockedDay = homepageDateKey || toNatalDateKey(firstSeenAt);
  const publishedAt =
    prevPubDay && lockedDay && prevPubDay === lockedDay && freshPubDay !== lockedDay
      ? cleanPrev.publishedAt
      : cleanPrev.publishedAt || cleanFresh.publishedAt || nowIso;

  const mergedAlso = [];
  for (const item of [...(Array.isArray(prevAlso) ? prevAlso : []), ...(Array.isArray(freshAlso) ? freshAlso : [])]) {
    if (item?.sourceId && !mergedAlso.some((o) => o.sourceId === item.sourceId)) {
      mergedAlso.push(item);
    }
  }

  return {
    ...cleanPrev,
    ...cleanFresh,
    sourceId: keepPrevSource ? cleanPrev.sourceId : cleanFresh.sourceId || cleanPrev.sourceId,
    sourceName: keepPrevSource ? cleanPrev.sourceName : cleanFresh.sourceName || cleanPrev.sourceName,
    sourceShortName: keepPrevSource
      ? cleanPrev.sourceShortName
      : cleanFresh.sourceShortName || cleanPrev.sourceShortName,
    sourceCategory: keepPrevSource
      ? cleanPrev.sourceCategory
      : cleanFresh.sourceCategory || cleanPrev.sourceCategory,
    badgeColor: keepPrevSource ? cleanPrev.badgeColor : cleanFresh.badgeColor || cleanPrev.badgeColor,
    geoHint,
    summary,
    content,
    categories,
    publishedAt,
    imageUrl: cleanFresh.imageUrl || cleanPrev.imageUrl || null,
    firstSeenAt,
    homepageDateKey,
    homepageEditorialSig,
    ...(mergedAlso.length > 0 ? { alsoReportedBy: mergedAlso } : {})
  };
}

/**
 * Deduplicates identical URLs and clusters near-duplicate headlines across portals
 * within the same day and classification status, never demoting articles already fixed on the homepage.
 */
export function deduplicateAndCluster(rawItems) {
  const byUrl = new Map();
  for (const item of rawItems) {
    if (!item?.canonicalUrl) continue;
    byUrl.set(item.canonicalUrl, mergeArticleRecords(byUrl.get(item.canonicalUrl), item));
  }

  // Prefer approved items, items already fixed on the homepage today, dedicated Natal feeds, and images
  const uniqueItems = [...byUrl.values()].sort((a, b) => {
    const aApproved = a.status ? (a.status === 'approved' ? 1 : 0) : 1;
    const bApproved = b.status ? (b.status === 'approved' ? 1 : 0) : 1;
    if (bApproved !== aApproved) return bApproved - aApproved;

    const aPinned = a.homepageDateKey ? 1 : 0;
    const bPinned = b.homepageDateKey ? 1 : 0;
    if (bPinned !== aPinned) return bPinned - aPinned;

    if (aPinned && bPinned && a.firstSeenAt && b.firstSeenAt) {
      const aSeen = new Date(a.firstSeenAt).getTime();
      const bSeen = new Date(b.firstSeenAt).getTime();
      if (!Number.isNaN(aSeen) && !Number.isNaN(bSeen) && aSeen !== bSeen) {
        return aSeen - bSeen;
      }
    }

    const aPriority = (a.geoHint === 'natal' ? 2 : 0) + (a.imageUrl ? 1 : 0);
    const bPriority = (b.geoHint === 'natal' ? 2 : 0) + (b.imageUrl ? 1 : 0);
    if (bPriority !== aPriority) return bPriority - aPriority;
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  });

  const clusters = [];

  for (const item of uniqueItems) {
    const tokens = titleTokens(item.title);
    const itemTs = new Date(item.publishedAt).getTime();
    const itemDay = item.natalDate || toNatalDateKey(item.publishedAt);

    let matchedCluster = null;
    if (tokens.size >= 3) {
      for (const cluster of clusters) {
        if (cluster.primary.sourceId === item.sourceId) continue;

        // Mandatory rule: an article already fixed on the homepage must never be swallowed by another card
        if (item.homepageDateKey && cluster.primary.homepageDateKey) continue;

        // Never allow an article from another day (e.g. yesterday) to swallow today's article
        const clusterDay = cluster.primary.natalDate || toNatalDateKey(cluster.primary.publishedAt);
        if (itemDay && clusterDay && itemDay !== clusterDay) continue;

        // Never merge across different classification statuses when status is present
        if (item.status && cluster.primary.status && item.status !== cluster.primary.status) continue;

        const clusterTs = new Date(cluster.primary.publishedAt).getTime();
        if (Math.abs(itemTs - clusterTs) > 48 * 3600 * 1000) continue;

        const sim = headlineSimilarity(tokens, cluster.tokens);
        if (sim.intersection >= 3 && (sim.jaccard >= 0.5 || sim.overlap >= 0.65)) {
          matchedCluster = cluster;
          break;
        }
      }
    }

    if (matchedCluster) {
      const addSecondary = (sec) => {
        if (!sec?.sourceId || sec.sourceId === matchedCluster.primary.sourceId) return;
        const alreadyListed = matchedCluster.primary.alsoReportedBy.some((o) => o.sourceId === sec.sourceId);
        if (!alreadyListed) {
          matchedCluster.primary.alsoReportedBy.push({
            sourceId: sec.sourceId,
            sourceName: sec.sourceName,
            sourceShortName: sec.sourceShortName,
            badgeColor: sec.badgeColor,
            url: sec.url
          });
        }
      };

      addSecondary(item);
      if (Array.isArray(item.alsoReportedBy)) {
        for (const extra of item.alsoReportedBy) addSecondary(extra);
      }

      if (!matchedCluster.primary.imageUrl && item.imageUrl) {
        matchedCluster.primary.imageUrl = item.imageUrl;
      }
    } else {
      const existingAlso = Array.isArray(item.alsoReportedBy)
        ? item.alsoReportedBy.filter((o) => o && o.sourceId && o.sourceId !== item.sourceId)
        : [];
      clusters.push({
        tokens,
        primary: {
          ...item,
          alsoReportedBy: [...existingAlso]
        }
      });
    }
  }

  return clusters.map((c) => c.primary);
}

/**
 * Merges newly scraped articles into the persisted cache while retaining up to 7 days of history.
 * Does NOT discard non-primary clustered articles from the raw cache, ensuring no collected
 * article of the day can ever be lost when feeds rotate.
 */
export function mergeArticlesWithRetention(
  collected = [],
  previousArticles = [],
  nowMs = Date.now(),
  retentionDays = RETENTION_DAYS
) {
  const cutoffMs = nowMs - retentionDays * 24 * 60 * 60 * 1000;
  const nowIso = new Date(nowMs).toISOString();
  const todayKey = toNatalDateKey(new Date(nowMs));
  const byUrl = new Map();

  for (const prev of previousArticles) {
    if (!prev?.canonicalUrl) continue;
    const isTodaySticky =
      prev.homepageDateKey === todayKey ||
      toNatalDateKey(prev.publishedAt) === todayKey ||
      toNatalDateKey(prev.firstSeenAt) === todayKey;
    if (!isTodaySticky && getArticleRetentionTs(prev, nowMs) < cutoffMs) continue;
    byUrl.set(prev.canonicalUrl, mergeArticleRecords(byUrl.get(prev.canonicalUrl), prev, nowIso));
  }

  for (const fresh of collected) {
    if (!fresh?.canonicalUrl) continue;
    const prev = byUrl.get(fresh.canonicalUrl);
    const isTodaySticky =
      prev?.homepageDateKey === todayKey ||
      toNatalDateKey(fresh.publishedAt) === todayKey;
    if (!isTodaySticky && getArticleRetentionTs(fresh, nowMs) < cutoffMs) continue;
    byUrl.set(fresh.canonicalUrl, mergeArticleRecords(prev, fresh, nowIso));
  }

  const merged = [...byUrl.values()];
  merged.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  return merged;
}

function toAuditItem(item) {
  return {
    canonicalUrl: item.canonicalUrl,
    url: item.url,
    title: item.title,
    sourceName: item.sourceName,
    sourceShortName: item.sourceShortName,
    badgeColor: item.badgeColor,
    publishedAt: item.publishedAt,
    status: item.status,
    statusReason: item.statusReason
  };
}

function toHistoryItem(item) {
  return {
    canonicalUrl: item.canonicalUrl,
    url: item.url,
    title: item.title,
    summary: item.summary,
    imageUrl: item.imageUrl,
    publishedAt: item.publishedAt,
    natalDate: item.natalDate,
    sourceId: item.sourceId,
    sourceName: item.sourceName,
    sourceShortName: item.sourceShortName,
    sourceCategory: item.sourceCategory,
    badgeColor: item.badgeColor,
    alsoReportedBy: item.alsoReportedBy,
    tvScore: item.tvScore,
    tvLabel: item.tvLabel,
    tvCategory: item.tvCategory,
    tvSuggestion: item.tvSuggestion,
    preferenceMatch: item.preferenceMatch,
    laya: item.laya,
    geo: item.geo ? { matchedLocations: item.geo.matchedLocations || [] } : undefined,
    status: item.status,
    statusReason: item.statusReason,
    likedByUser: item.likedByUser,
    sentToTelegram: item.sentToTelegram,
    inBulletin: item.inBulletin
  };
}

/**
 * Orchestrates scraping, classification, caching, and optional Telegram auto-dispatch.
 */
export class NewsAggregator {
  constructor(
    store,
    {
      fetchSourceFn = fetchSource,
      sendTelegramFn = sendTelegramMessage,
      classifyLayaBatchFn = classifyBatchWithLaya,
      checkLayaHealthFn = checkLayaHealth,
      sourceTimeoutMs = 22000,
      nowFn = () => Date.now(),
      retentionDays = RETENTION_DAYS
    } = {}
  ) {
    this.store = store;
    this.fetchSourceFn = fetchSourceFn;
    this.sendTelegramFn = sendTelegramFn;
    this.classifyLayaBatchFn = classifyLayaBatchFn;
    this.checkLayaHealthFn = checkLayaHealthFn;
    this.sourceTimeoutMs = sourceTimeoutMs;
    this.nowFn = nowFn;
    this.retentionDays = retentionDays;
    this.cachePath = path.join(this.store.dataDir, 'cache.json');
    this.layaCachePath = path.join(this.store.dataDir, 'laya_cache.json');
    this.isRefreshing = false;
    this.refreshPromise = null;
    this.isClassifyingLaya = false;
    this.layaLastError = null;
    this.layaOnline = false;
    this.cache = this._loadCache();
    this.layaCache = this._loadLayaCache();
  }

  _loadLayaCache() {
    try {
      if (fs.existsSync(this.layaCachePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.layaCachePath, 'utf-8'));
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
      }
    } catch {
      // ignore invalid laya cache
    }
    return {};
  }

  _saveLayaCache() {
    try {
      const entries = Object.entries(this.layaCache);
      if (entries.length > 2500) {
        this.layaCache = Object.fromEntries(entries.slice(-2500));
      }
      fs.mkdirSync(this.store.dataDir, { recursive: true });
      const tmp = `${this.layaCachePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.layaCache), 'utf-8');
      fs.renameSync(tmp, this.layaCachePath);
    } catch (err) {
      console.error('[aggregator] Erro ao salvar laya_cache:', err.message);
    }
  }

  _loadCache() {
    try {
      if (fs.existsSync(this.cachePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.cachePath, 'utf-8'));
        if (Array.isArray(parsed?.rawArticles)) {
          return parsed;
        }
      }
    } catch {
      // ignore invalid cache
    }
    return {
      lastSyncAt: null,
      sourceStatuses: [],
      rawArticles: []
    };
  }

  _saveCache() {
    try {
      fs.mkdirSync(this.store.dataDir, { recursive: true });
      const tmp = `${this.cachePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.cache), 'utf-8');
      fs.renameSync(tmp, this.cachePath);
    } catch (err) {
      console.error('[aggregator] Erro ao salvar cache:', err.message);
    }
  }

  async _fetchSourceSafe(src) {
    const started = Date.now();
    const timeoutMs = Number(this.sourceTimeoutMs || 22000);
    let timer = null;
    const timeoutPromise = new Promise((resolve) => {
      timer = setTimeout(() => {
        resolve({
          sourceId: src.id,
          sourceName: src.name,
          ok: false,
          itemCount: 0,
          durationMs: Date.now() - started,
          error: `Tempo esgotado (${Math.round(timeoutMs / 1000)}s)`,
          items: []
        });
      }, timeoutMs);
    });

    try {
      return await Promise.race([Promise.resolve().then(() => this.fetchSourceFn(src)), timeoutPromise]);
    } catch (err) {
      return {
        sourceId: src.id,
        sourceName: src.name,
        ok: false,
        itemCount: 0,
        durationMs: Date.now() - started,
        error: err?.message || 'Erro desconhecido ao coletar fonte',
        items: []
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async refresh({ triggerAutoSend = true } = {}) {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.isRefreshing = true;
    this.refreshPromise = (async () => {
      const startedAt = Date.now();
      try {
        const sources = this.store.getSources().filter((s) => s.enabled);
        const results = await Promise.all(sources.map((src) => this._fetchSourceSafe(src)));

        const sourceStatuses = [];
        const collected = [];

        for (const res of results) {
          sourceStatuses.push({
            sourceId: res.sourceId,
            sourceName: res.sourceName,
            ok: res.ok,
            itemCount: res.itemCount,
            durationMs: res.durationMs,
            usedFallback: Boolean(res.usedFallback),
            error: res.error || null
          });
          if (Array.isArray(res.items)) {
            collected.push(...res.items);
          }
        }

        const nowMs = this.nowFn();
        const rawArticles = mergeArticlesWithRetention(
          collected,
          this.cache.rawArticles || [],
          nowMs,
          this.retentionDays
        );

        this.cache = {
          lastSyncAt: new Date(nowMs).toISOString(),
          sourceStatuses,
          rawArticles
        };
        this._saveCache();

        const okCount = sourceStatuses.filter((s) => s.ok).length;
        console.log(
          `[aggregator] Ronda concluída em ${Date.now() - startedAt}ms: ${okCount}/${sourceStatuses.length} fontes OK, ${collected.length} coletadas, ${rawArticles.length} retidas (${this.retentionDays}d).`
        );

        if (triggerAutoSend) {
          await this._maybeAutoSendToTelegram();
        }

        // Trigger asynchronous Laya AI classification for uncached Natal/RN articles
        this.classifyPendingWithLaya().catch((err) => {
          console.error('[laya] Erro na fila de classificação:', err.message);
        });

        return this.getClassifiedView();
      } finally {
        this.isRefreshing = false;
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  async checkLayaStatus() {
    const layaCfg = this.store.getSettings().laya || {};
    if (!layaCfg.enabled) {
      this.layaOnline = false;
      this.layaLastError = 'Desativado nas configurações';
      return { online: false, enabled: false, error: this.layaLastError };
    }
    const health = await this.checkLayaHealthFn(layaCfg.endpointUrl, layaCfg.apiKey);
    this.layaOnline = Boolean(health.online);
    this.layaLastError = health.online ? null : health.error;
    return { ...health, enabled: true };
  }

  async classifyPendingWithLaya({ forceAll = false, chunkSize = 8 } = {}) {
    if (this.isClassifyingLaya) return;
    const settings = this.store.getSettings();
    const layaCfg = settings.laya || {};
    if (!layaCfg.enabled) return;

    this.isClassifyingLaya = true;
    try {
      const health = await this.checkLayaHealthFn(layaCfg.endpointUrl, layaCfg.apiKey);
      this.layaOnline = Boolean(health.online);
      if (!health.online) {
        this.layaLastError = health.error || 'Serviço Laya indisponível';
        return;
      }
      this.layaLastError = null;

      if (forceAll) {
        this.layaCache = {};
      }

      const overrides = this.store.getOverrides();
      const preferenceProfile = buildPreferenceProfile(this.store.getLikedArticles());
      const eligible = this.cache.rawArticles
        .map((art) => classifyArticle(art, settings, overrides, preferenceProfile))
        .filter((item) => item.status === 'approved' || item.status === 'filtered_low_tv')
        .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

      const pending = eligible.filter((item) => !this.layaCache[item.canonicalUrl]);
      for (let i = 0; i < pending.length; i += chunkSize) {
        // Re-check if disabled mid-run
        const currentCfg = this.store.getSettings().laya || {};
        if (!currentCfg.enabled) break;

        const batch = pending.slice(i, i + chunkSize);
        const batchResults = await this.classifyLayaBatchFn(batch, {
          ...currentCfg,
          preferenceProfile
        });
        for (const row of batchResults) {
          if (row?.canonicalUrl && row?.laya) {
            this.layaCache[row.canonicalUrl] = {
              ...row.laya,
              preferenceSignature: preferenceProfile.signature
            };
          }
        }
        this._saveLayaCache();
      }
    } catch (err) {
      this.layaLastError = err.message;
      this.layaOnline = false;
      console.error('[laya] Falha na classificação em lote:', err.message);
    } finally {
      this.isClassifyingLaya = false;
    }
  }

  async _maybeAutoSendToTelegram() {
    const settings = this.store.getSettings();
    const tg = settings.telegram;
    if (!tg.autoSendEnabled || !tg.botToken?.trim() || !tg.chatId?.trim()) {
      return;
    }

    const view = this.getClassifiedView();
    const candidates = view.pautas.filter(
      (p) => !p.sentToTelegram && p.tvScore >= (tg.autoSendMinScore ?? 72)
    );
    const toSend = candidates.slice(0, tg.autoSendMaxPerRun ?? 5);

    for (const article of toSend) {
      try {
        const msg = formatArticleMessage(article, tg);
        const delivery = await this.sendTelegramFn(tg.botToken, tg.chatId, msg);
        this.store.recordSent({
          canonicalUrl: article.canonicalUrl,
          title: article.title,
          sourceName: article.sourceName,
          chatId: tg.chatId,
          messageId: delivery.messageId,
          mode: 'auto'
        });
      } catch (err) {
        console.error('[auto-telegram] Falha ao enviar pauta automática:', err.message);
        break;
      }
    }
  }

  /**
   * Re-classifies cached raw articles against current settings and overrides
   * so edits in Configurações take effect immediately without waiting for re-scrape.
   */
  getClassifiedView() {
    const nowMs = this.nowFn();
    const cutoffMs = nowMs - this.retentionDays * 24 * 60 * 60 * 1000;
    const todayKey = toNatalDateKey(new Date(nowMs));

    const settings = this.store.getSettings();
    const layaCfg = settings.laya || { enabled: false, minInterestProb: 0.45, filterLowInterest: false };
    const minProb = Number(layaCfg.minInterestProb ?? 0.45);
    const overrides = this.store.getOverrides();
    const likedArticles = this.store.getLikedArticles();
    const likedUrls = new Set(likedArticles.map((l) => l.canonicalUrl));
    const preferenceProfile = buildPreferenceProfile(likedArticles);
    const sentUrls = new Set(this.store.getSentHistory().map((h) => h.canonicalUrl));
    const bulletinUrls = new Set(this.store.getBulletinQueue().map((b) => b.canonicalUrl));

    const currentEditorialSig = `${settings.editorial?.cityFilterMode || 'natal_strict'}:${
      settings.editorial?.minTvScore ?? 30
    }`;
    const rawByUrl = new Map();
    for (const art of this.cache.rawArticles || []) {
      if (art?.canonicalUrl) rawByUrl.set(art.canonicalUrl, art);
    }

    const retainedRaw = (this.cache.rawArticles || []).filter(
      (art) =>
        art.homepageDateKey === todayKey ||
        toNatalDateKey(art.publishedAt) === todayKey ||
        getArticleRetentionTs(art, nowMs) >= cutoffMs
    );

    const classifiedRaw = retainedRaw.map((art) => {
      const item = classifyArticle(art, settings, overrides, preferenceProfile);
      const cachedLaya = this.layaCache[item.canonicalUrl];
      const prefMatch = item.preferenceMatch || { hasMatch: false, interestBoost: 0, importanceBoost: 0 };

      let laya;
      if (cachedLaya && layaCfg.enabled) {
        const baseImportance =
          typeof cachedLaya.rawImportanceScore === 'number'
            ? computeImportanceScore({
                rawImpScore: cachedLaya.rawImportanceScore,
                pMuito: cachedLaya.muitoInteressanteProb ?? 0,
                pInt: cachedLaya.interestingProb ?? 0.5,
                pPouco: cachedLaya.poucoInteressanteProb ?? Math.max(0, 1 - (cachedLaya.interestingProb ?? 0.5))
              })
            : cachedLaya.importanceScore;
        const alreadySawProfile = cachedLaya.preferenceSignature === preferenceProfile.signature;
        const intDelta = prefMatch.hasMatch ? (alreadySawProfile ? prefMatch.interestBoost * 0.35 : prefMatch.interestBoost) : 0;
        const impDelta = prefMatch.hasMatch ? (alreadySawProfile ? Math.round(prefMatch.importanceBoost * 0.35) : prefMatch.importanceBoost) : 0;
        const interestingProb = Number(Math.min(0.99, (cachedLaya.interestingProb ?? 0.5) + intDelta).toFixed(3));
        const importanceScore = Math.min(100, Math.round(baseImportance + impDelta));

        laya = {
          ...cachedLaya,
          interestingProb,
          importanceScore,
          importanceLabel: importanceLabelFromScore(importanceScore),
          isInteresting: interestingProb >= minProb,
          preferenceBoosted: prefMatch.hasMatch
        };
      } else {
        const fbStatus = !layaCfg.enabled ? 'disabled' : this.layaOnline || this.isClassifyingLaya ? 'pending' : 'offline';
        const fb = buildLayaFallback(item, fbStatus, minProb);
        const interestingProb = prefMatch.hasMatch
          ? Number(Math.min(0.99, fb.interestingProb + prefMatch.interestBoost * 0.5).toFixed(3))
          : fb.interestingProb;
        const importanceScore = prefMatch.hasMatch
          ? Math.min(100, Math.round(fb.importanceScore + prefMatch.importanceBoost * 0.5))
          : fb.importanceScore;
        laya = {
          ...fb,
          interestingProb,
          importanceScore,
          importanceLabel: importanceLabelFromScore(importanceScore),
          isInteresting: interestingProb >= minProb,
          preferenceBoosted: prefMatch.hasMatch
        };
      }

      const wasPinnedToday = art.homepageDateKey === todayKey;
      const natalDate = wasPinnedToday ? todayKey : toNatalDateKey(item.publishedAt);
      let status = item.status;
      let statusReason = item.statusReason;

      // Mandatory site rule: once an article has been collected and shown on today's homepage,
      // it must not leave the homepage during the day due to feed/text edits or re-scrapes
      if (
        wasPinnedToday &&
        (!art.homepageEditorialSig || art.homepageEditorialSig === currentEditorialSig) &&
        (status === 'filtered_geo' || status === 'filtered_low_tv')
      ) {
        status = 'approved';
        statusReason = 'Matéria coletada hoje e mantida na página inicial';
      }

      if (
        status === 'approved' &&
        layaCfg.enabled &&
        layaCfg.filterLowInterest &&
        laya.source === 'laya' &&
        !laya.isInteresting &&
        !item.isManuallyApproved &&
        !wasPinnedToday
      ) {
        status = 'filtered_low_tv';
        statusReason = `Laya classificou com baixo interesse (${Math.round(laya.interestingProb * 100)}%)`;
      }

      const { content: _omittedContent, ...viewItem } = item;
      return {
        ...viewItem,
        firstSeenAt: art.firstSeenAt,
        homepageDateKey: wasPinnedToday ? todayKey : null,
        natalDate,
        laya,
        status,
        statusReason,
        likedByUser: likedUrls.has(item.canonicalUrl),
        sentToTelegram: sentUrls.has(item.canonicalUrl),
        inBulletin: bulletinUrls.has(item.canonicalUrl)
      };
    });

    const classified = deduplicateAndCluster(classifiedRaw);

    const displayConfig = settings.display || {
      searchQuery: '',
      beatFilter: 'all',
      interestFilter: 'all',
      sortBy: 'recent',
      sourceFilter: 'all'
    };

    const allApproved = sortArticles(
      classified.filter((a) => a.status === 'approved'),
      displayConfig.sortBy || 'recent'
    );
    const pautas = allApproved.filter((a) => a.natalDate === todayKey);

    // Stamp homepageDateKey on every primary card displayed on today's homepage so it can never be removed later today
    let cacheMutated = false;
    const canLockLaya = !layaCfg.enabled || !layaCfg.filterLowInterest;
    for (const p of pautas) {
      if (!canLockLaya && p.laya?.source !== 'laya') continue;
      const raw = rawByUrl.get(p.canonicalUrl);
      if (raw && (raw.homepageDateKey !== todayKey || raw.homepageEditorialSig !== currentEditorialSig)) {
        raw.homepageDateKey = todayKey;
        raw.homepageEditorialSig = currentEditorialSig;
        p.homepageDateKey = todayKey;
        cacheMutated = true;
      }
    }
    if (cacheMutated) {
      this._saveCache();
    }
    const historyPautas = allApproved.map(toHistoryItem);
    const historyDates = [...new Set(historyPautas.map((a) => a.natalDate).filter(Boolean))].sort((a, b) =>
      b.localeCompare(a)
    );
    const blockedPrefeitura = classified.filter((a) => a.status === 'blocked_prefeitura').map(toAuditItem);
    const blockedCrime = classified.filter((a) => a.status === 'blocked_crime').map(toAuditItem);
    const blockedManual = classified.filter((a) => a.status === 'blocked_manual').map(toAuditItem);
    const filteredGeo = classified.filter((a) => a.status === 'filtered_geo').map(toAuditItem);
    const filteredLowTv = classified.filter((a) => a.status === 'filtered_low_tv').map(toAuditItem);

    const sourceStatuses = this.cache.sourceStatuses || [];
    const sourcesOk = sourceStatuses.filter((s) => s.ok).length;
    const sourcesError = sourceStatuses.filter((s) => !s.ok).length;

    const layaClassifiedCount = pautas.filter((p) => p.laya?.source === 'laya').length;
    const layaInterestingCount = pautas.filter((p) => p.laya?.isInteresting).length;

    return {
      lastSyncAt: this.cache.lastSyncAt,
      isRefreshing: this.isRefreshing,
      todayDateKey: todayKey,
      retentionDays: this.retentionDays,
      pautas,
      historyPautas,
      historyDates,
      quarantine: [...blockedPrefeitura, ...blockedCrime, ...blockedManual],
      filteredGeo,
      filteredLowTv,
      sourceStatuses,
      layaStatus: {
        enabled: Boolean(layaCfg.enabled),
        online: this.layaOnline,
        isClassifying: this.isClassifyingLaya,
        classifiedCount: layaClassifiedCount,
        totalEligible: pautas.length,
        interestingCount: layaInterestingCount,
        lastError: this.layaLastError
      },
      telegramConfigured: Boolean(settings.telegram?.botToken?.trim() && settings.telegram?.chatId?.trim()),
      displayConfig,
      preferenceProfile: {
        totalLikes: preferenceProfile.totalLikes,
        topKeywords: preferenceProfile.topKeywords,
        topCategories: preferenceProfile.topCategories,
        topLocations: preferenceProfile.topLocations,
        likedArticles: likedArticles.slice(0, 12)
      },
      stats: {
        totalCollected: classified.length,
        totalPautas: pautas.length,
        historyCount: historyPautas.length,
        layaInterestingCount,
        likedCount: likedArticles.length,
        blockedPrefeitura: blockedPrefeitura.length,
        blockedCrime: blockedCrime.length,
        blockedManual: blockedManual.length,
        filteredGeo: filteredGeo.length,
        filteredLowTv: filteredLowTv.length,
        sentCount: sentUrls.size,
        bulletinCount: bulletinUrls.size,
        sourcesOk,
        sourcesError
      }
    };
  }
}
