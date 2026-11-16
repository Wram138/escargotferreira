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

/**
 * Deduplicates identical URLs and clusters near-duplicate headlines across portals.
 */
export function deduplicateAndCluster(rawItems) {
  // Prefer dedicated Natal feeds and entries with images/longer summaries
  const sorted = [...rawItems].sort((a, b) => {
    const aPriority = (a.geoHint === 'natal' ? 2 : 0) + (a.imageUrl ? 1 : 0);
    const bPriority = (b.geoHint === 'natal' ? 2 : 0) + (b.imageUrl ? 1 : 0);
    if (bPriority !== aPriority) return bPriority - aPriority;
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  });

  const byUrl = new Map();
  for (const item of sorted) {
    if (!item.canonicalUrl) continue;
    if (!byUrl.has(item.canonicalUrl)) {
      byUrl.set(item.canonicalUrl, item);
    }
  }

  const uniqueItems = [...byUrl.values()];
  const clusters = [];

  for (const item of uniqueItems) {
    const tokens = titleTokens(item.title);
    const itemTs = new Date(item.publishedAt).getTime();

    let matchedCluster = null;
    if (tokens.size >= 3) {
      for (const cluster of clusters) {
        if (cluster.primary.sourceId === item.sourceId) continue;
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
      const alreadyListed = matchedCluster.primary.alsoReportedBy.some(
        (o) => o.sourceId === item.sourceId
      );
      if (!alreadyListed) {
        matchedCluster.primary.alsoReportedBy.push({
          sourceId: item.sourceId,
          sourceName: item.sourceName,
          sourceShortName: item.sourceShortName,
          badgeColor: item.badgeColor,
          url: item.url
        });
      }
      if (!matchedCluster.primary.imageUrl && item.imageUrl) {
        matchedCluster.primary.imageUrl = item.imageUrl;
      }
    } else {
      clusters.push({
        tokens,
        primary: {
          ...item,
          alsoReportedBy: []
        }
      });
    }
  }

  return clusters.map((c) => c.primary);
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
      sourceTimeoutMs = 22000
    } = {}
  ) {
    this.store = store;
    this.fetchSourceFn = fetchSourceFn;
    this.sendTelegramFn = sendTelegramFn;
    this.classifyLayaBatchFn = classifyLayaBatchFn;
    this.checkLayaHealthFn = checkLayaHealthFn;
    this.sourceTimeoutMs = sourceTimeoutMs;
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
      if (entries.length > 1500) {
        this.layaCache = Object.fromEntries(entries.slice(-1500));
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

        const rawArticles = deduplicateAndCluster(collected);
        rawArticles.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

        this.cache = {
          lastSyncAt: new Date().toISOString(),
          sourceStatuses,
          rawArticles
        };
        this._saveCache();

        const okCount = sourceStatuses.filter((s) => s.ok).length;
        console.log(
          `[aggregator] Ronda concluída em ${Date.now() - startedAt}ms: ${okCount}/${sourceStatuses.length} fontes OK, ${rawArticles.length} matérias.`
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
    const settings = this.store.getSettings();
    const layaCfg = settings.laya || { enabled: false, minInterestProb: 0.45, filterLowInterest: false };
    const minProb = Number(layaCfg.minInterestProb ?? 0.45);
    const overrides = this.store.getOverrides();
    const likedArticles = this.store.getLikedArticles();
    const likedUrls = new Set(likedArticles.map((l) => l.canonicalUrl));
    const preferenceProfile = buildPreferenceProfile(likedArticles);
    const sentUrls = new Set(this.store.getSentHistory().map((h) => h.canonicalUrl));
    const bulletinUrls = new Set(this.store.getBulletinQueue().map((b) => b.canonicalUrl));

    const classified = this.cache.rawArticles.map((art) => {
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

      let status = item.status;
      let statusReason = item.statusReason;

      if (
        status === 'approved' &&
        layaCfg.enabled &&
        layaCfg.filterLowInterest &&
        laya.source === 'laya' &&
        !laya.isInteresting &&
        !item.isManuallyApproved
      ) {
        status = 'filtered_low_tv';
        statusReason = `Laya classificou com baixo interesse (${Math.round(laya.interestingProb * 100)}%)`;
      }

      const { content: _omittedContent, ...viewItem } = item;
      return {
        ...viewItem,
        laya,
        status,
        statusReason,
        likedByUser: likedUrls.has(item.canonicalUrl),
        sentToTelegram: sentUrls.has(item.canonicalUrl),
        inBulletin: bulletinUrls.has(item.canonicalUrl)
      };
    });

    const displayConfig = settings.display || {
      searchQuery: '',
      beatFilter: 'all',
      interestFilter: 'all',
      sortBy: 'recent',
      sourceFilter: 'all'
    };

    const pautas = sortArticles(
      classified.filter((a) => a.status === 'approved'),
      displayConfig.sortBy || 'recent'
    );
    const blockedPrefeitura = classified.filter((a) => a.status === 'blocked_prefeitura');
    const blockedCrime = classified.filter((a) => a.status === 'blocked_crime');
    const blockedManual = classified.filter((a) => a.status === 'blocked_manual');
    const filteredGeo = classified.filter((a) => a.status === 'filtered_geo');
    const filteredLowTv = classified.filter((a) => a.status === 'filtered_low_tv');

    const sourceStatuses = this.cache.sourceStatuses || [];
    const sourcesOk = sourceStatuses.filter((s) => s.ok).length;
    const sourcesError = sourceStatuses.filter((s) => !s.ok).length;

    const layaClassifiedCount = pautas.filter((p) => p.laya?.source === 'laya').length;
    const layaInterestingCount = pautas.filter((p) => p.laya?.isInteresting).length;

    return {
      lastSyncAt: this.cache.lastSyncAt,
      isRefreshing: this.isRefreshing,
      pautas,
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
