import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS, DEFAULT_SOURCES } from './defaultSources.js';
import {
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_ADMIN_USERNAME,
  generateSessionSecret,
  hashPassword,
  verifyPassword
} from '../services/auth.js';
import { buildLikedArticleSnapshot } from '../services/preferences.js';

/**
 * Persistent JSON store for application settings, sources, Telegram history,
 * bulletin queue, and manual editorial overrides.
 */
export class AppStore {
  constructor(dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), 'data')) {
    this.dataDir = dataDir;
    this.filePath = path.join(this.dataDir, 'state.json');
    this.state = this._load();
  }

  _defaultAuth() {
    return {
      username: DEFAULT_ADMIN_USERNAME,
      passwordHash: hashPassword(DEFAULT_ADMIN_PASSWORD),
      sessionSecret: generateSessionSecret(),
      tokenVersion: 1
    };
  }

  _defaultState() {
    return {
      auth: this._defaultAuth(),
      settings: structuredClone(DEFAULT_SETTINGS),
      sources: structuredClone(DEFAULT_SOURCES),
      sentHistory: [],
      bulletinQueue: [],
      likedArticles: [],
      overrides: {
        approvedUrls: [],
        blockedUrls: []
      }
    };
  }

  _mergeDefaults(raw) {
    const base = this._defaultState();
    const rawSettings = raw?.settings || {};

    const settings = {
      telegram: { ...base.settings.telegram, ...(rawSettings.telegram || {}) },
      editorial: {
        ...base.settings.editorial,
        ...(rawSettings.editorial || {}),
        customBlockedTerms: Array.isArray(rawSettings?.editorial?.customBlockedTerms)
          ? rawSettings.editorial.customBlockedTerms
          : []
      },
      laya: {
        ...base.settings.laya,
        ...(rawSettings.laya || {}),
        ...(process.env.LAYA_ENDPOINT_URL &&
        (!rawSettings?.laya?.endpointUrl || rawSettings.laya.endpointUrl === 'http://127.0.0.1:8001')
          ? { endpointUrl: process.env.LAYA_ENDPOINT_URL }
          : {}),
        ...(process.env.LAYA_AUTO_START === 'false' ? { autoStartLocalService: false } : {})
      },
      display: { ...base.settings.display, ...(rawSettings.display || {}) }
    };

    const savedSources = Array.isArray(raw?.sources) ? raw.sources : [];
    const savedById = new Map(savedSources.map((s) => [s.id, s]));

    // Preserve built-in defaults + user toggle states, then append custom sources
    const mergedBuiltins = DEFAULT_SOURCES.map((def) => {
      const saved = savedById.get(def.id);
      if (!saved) return structuredClone(def);
      return {
        ...structuredClone(def),
        enabled: typeof saved.enabled === 'boolean' ? saved.enabled : def.enabled
      };
    });

    const customSources = savedSources.filter((s) => !s.builtin && !DEFAULT_SOURCES.some((d) => d.id === s.id));
    const rawAuth = raw?.auth || {};
    const auth =
      rawAuth.username && rawAuth.passwordHash && rawAuth.sessionSecret
        ? {
            username: String(rawAuth.username),
            passwordHash: String(rawAuth.passwordHash),
            sessionSecret: String(rawAuth.sessionSecret),
            tokenVersion: Number(rawAuth.tokenVersion || 1)
          }
        : base.auth;

    return {
      auth,
      settings,
      sources: [...mergedBuiltins, ...customSources],
      sentHistory: Array.isArray(raw?.sentHistory) ? raw.sentHistory.slice(0, 300) : [],
      bulletinQueue: Array.isArray(raw?.bulletinQueue) ? raw.bulletinQueue : [],
      likedArticles: Array.isArray(raw?.likedArticles) ? raw.likedArticles.slice(-300) : [],
      overrides: {
        approvedUrls: Array.isArray(raw?.overrides?.approvedUrls) ? raw.overrides.approvedUrls : [],
        blockedUrls: Array.isArray(raw?.overrides?.blockedUrls) ? raw.overrides.blockedUrls : []
      }
    };
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const text = fs.readFileSync(this.filePath, 'utf-8');
        return this._mergeDefaults(JSON.parse(text));
      }
    } catch (err) {
      console.error('[store] Falha ao carregar state.json, usando padrão:', err.message);
    }
    return this._defaultState();
  }

  _save() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.state, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.filePath);
  }

  getAuthConfig() {
    if (!this.state.auth?.passwordHash || !this.state.auth?.sessionSecret) {
      this.state.auth = this._defaultAuth();
      this._save();
    }
    return structuredClone(this.state.auth);
  }

  verifyAdminCredentials(username, password) {
    const auth = this.getAuthConfig();
    if (String(username || '').trim() !== auth.username) return false;
    return verifyPassword(password, auth.passwordHash);
  }

  updateAdminCredentials({ currentPassword, newUsername, newPassword }) {
    const auth = this.getAuthConfig();
    if (!verifyPassword(currentPassword, auth.passwordHash)) {
      throw new Error('Senha atual incorreta.');
    }
    const nextUser = String(newUsername || '').trim() || auth.username;
    if (nextUser.length < 3) {
      throw new Error('O nome de usuário deve ter pelo menos 3 caracteres.');
    }
    let nextHash = auth.passwordHash;
    if (newPassword !== undefined && String(newPassword).length > 0) {
      if (String(newPassword).length < 6) {
        throw new Error('A nova senha deve ter pelo menos 6 caracteres.');
      }
      nextHash = hashPassword(String(newPassword));
    }
    this.state.auth = {
      username: nextUser,
      passwordHash: nextHash,
      sessionSecret: auth.sessionSecret,
      tokenVersion: (auth.tokenVersion || 1) + 1
    };
    this._save();
    return this.getAuthConfig();
  }

  invalidateSessions() {
    const auth = this.getAuthConfig();
    this.state.auth = {
      ...auth,
      tokenVersion: (auth.tokenVersion || 1) + 1
    };
    this._save();
  }

  getSettings() {
    return structuredClone(this.state.settings);
  }

  updateSettings(patch) {
    const next = {
      telegram: { ...this.state.settings.telegram, ...(patch.telegram || {}) },
      editorial: { ...this.state.settings.editorial, ...(patch.editorial || {}) },
      laya: { ...this.state.settings.laya, ...(patch.laya || {}) },
      display: { ...this.state.settings.display, ...(patch.display || {}) }
    };

    if (Array.isArray(next.editorial.customBlockedTerms)) {
      next.editorial.customBlockedTerms = next.editorial.customBlockedTerms
        .map((t) => String(t).trim())
        .filter(Boolean);
    }
    next.editorial.minTvScore = Math.max(0, Math.min(100, Number(next.editorial.minTvScore) || 0));
    next.editorial.refreshIntervalMinutes = Math.max(2, Math.min(240, Number(next.editorial.refreshIntervalMinutes) || 15));
    next.laya.minInterestProb = Math.max(0.05, Math.min(0.95, Number(next.laya.minInterestProb) || 0.45));
    next.telegram.autoSendMinScore = Math.max(0, Math.min(100, Number(next.telegram.autoSendMinScore) || 70));
    next.telegram.autoSendMaxPerRun = Math.max(1, Math.min(20, Number(next.telegram.autoSendMaxPerRun) || 5));

    this.state.settings = next;
    this._save();
    return this.getSettings();
  }

  getSources() {
    return structuredClone(this.state.sources);
  }

  addSource(source) {
    const exists = this.state.sources.some((s) => s.id === source.id || s.url === source.url);
    if (exists) {
      throw new Error('Já existe uma fonte cadastrada com essa URL ou identificador.');
    }
    const created = {
      id: source.id,
      name: source.name,
      shortName: source.shortName || source.name.slice(0, 14),
      category: source.category || 'blog',
      type: source.type || 'rss',
      url: source.url,
      siteUrl: source.siteUrl || source.url,
      badgeColor: source.badgeColor || '#475569',
      enabled: source.enabled !== false,
      builtin: false,
      geoHint: source.geoHint || 'rn'
    };
    this.state.sources.push(created);
    this._save();
    return structuredClone(created);
  }

  updateSource(id, patch) {
    const idx = this.state.sources.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    const current = this.state.sources[idx];
    const updated = {
      ...current,
      enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
      name: typeof patch.name === 'string' && patch.name.trim() ? patch.name.trim() : current.name,
      category: typeof patch.category === 'string' ? patch.category : current.category,
      url: typeof patch.url === 'string' && patch.url.trim() && !current.builtin ? patch.url.trim() : current.url
    };
    this.state.sources[idx] = updated;
    this._save();
    return structuredClone(updated);
  }

  deleteSource(id) {
    const target = this.state.sources.find((s) => s.id === id);
    if (!target) return { deleted: false, reason: 'not_found' };
    if (target.builtin) return { deleted: false, reason: 'builtin_protected' };
    this.state.sources = this.state.sources.filter((s) => s.id !== id);
    this._save();
    return { deleted: true };
  }

  getSentHistory() {
    return structuredClone(this.state.sentHistory);
  }

  isUrlSent(canonicalUrl) {
    return this.state.sentHistory.some((h) => h.canonicalUrl === canonicalUrl);
  }

  recordSent(entry) {
    this.state.sentHistory.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      canonicalUrl: entry.canonicalUrl,
      title: entry.title,
      sourceName: entry.sourceName,
      chatId: entry.chatId,
      messageId: entry.messageId || null,
      mode: entry.mode || 'single',
      sentAt: new Date().toISOString()
    });
    this.state.sentHistory = this.state.sentHistory.slice(0, 300);
    this._save();
  }

  getBulletinQueue() {
    return structuredClone(this.state.bulletinQueue);
  }

  addToBulletin(articleSnapshot) {
    if (this.state.bulletinQueue.some((item) => item.canonicalUrl === articleSnapshot.canonicalUrl)) {
      return this.getBulletinQueue();
    }
    this.state.bulletinQueue.push(articleSnapshot);
    this._save();
    return this.getBulletinQueue();
  }

  removeFromBulletin(canonicalUrl) {
    this.state.bulletinQueue = this.state.bulletinQueue.filter((item) => item.canonicalUrl !== canonicalUrl);
    this._save();
    return this.getBulletinQueue();
  }

  clearBulletin() {
    this.state.bulletinQueue = [];
    this._save();
    return [];
  }

  getOverrides() {
    return structuredClone(this.state.overrides);
  }

  setOverride(canonicalUrl, action) {
    const approved = new Set(this.state.overrides.approvedUrls);
    const blocked = new Set(this.state.overrides.blockedUrls);

    if (action === 'approve') {
      approved.add(canonicalUrl);
      blocked.delete(canonicalUrl);
    } else if (action === 'block') {
      blocked.add(canonicalUrl);
      approved.delete(canonicalUrl);
    } else if (action === 'reset') {
      approved.delete(canonicalUrl);
      blocked.delete(canonicalUrl);
    }

    this.state.overrides = {
      approvedUrls: [...approved].slice(-500),
      blockedUrls: [...blocked].slice(-500)
    };
    this._save();
    return this.getOverrides();
  }

  getLikedArticles() {
    return structuredClone(this.state.likedArticles || []);
  }

  toggleLikeArticle(article) {
    const url = article?.canonicalUrl;
    if (!url) throw new Error('Matéria sem URL canônica.');

    const current = Array.isArray(this.state.likedArticles) ? this.state.likedArticles : [];
    const exists = current.some((item) => item.canonicalUrl === url);

    if (exists) {
      this.state.likedArticles = current.filter((item) => item.canonicalUrl !== url);
    } else {
      const snapshot = buildLikedArticleSnapshot(article);
      this.state.likedArticles = [snapshot, ...current].slice(0, 300);
    }

    this._save();
    return {
      liked: !exists,
      likedArticles: this.getLikedArticles()
    };
  }

  clearLikedArticles() {
    this.state.likedArticles = [];
    this._save();
    return [];
  }
}
