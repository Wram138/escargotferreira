import express from 'express';
import { probeSourceUrl } from '../services/fetcher.js';
import {
  SESSION_COOKIE_NAME,
  createLoginRateLimiter,
  createSessionToken,
  extractSessionFromRequest
} from '../services/auth.js';
import {
  detectRecentChats,
  formatArticleMessage,
  formatBulletinMessages,
  sendTelegramMessage,
  sendTestNotification
} from '../services/telegram.js';

export function createApiRouter({
  store,
  aggregator,
  telegram = {
    sendTestNotification,
    detectRecentChats,
    sendTelegramMessage
  },
  probeSourceFn = probeSourceUrl
}) {
  const router = express.Router();
  const rateLimiter = createLoginRateLimiter();

  const setSessionCookie = (res, token) => {
    res.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 12 * 60 * 60 * 1000
    });
  };

  const requireConfigAuth = (req, res, next) => {
    const session = extractSessionFromRequest(req, store);
    if (!session) {
      return res.status(401).json({
        error: 'Autenticação necessária para acessar ou alterar as configurações.',
        authRequired: true
      });
    }
    req.adminSession = session;
    next();
  };

  router.get('/auth/status', (req, res) => {
    const session = extractSessionFromRequest(req, store);
    res.json({
      authenticated: Boolean(session),
      username: session ? session.username : null
    });
  });

  router.post('/auth/login', (req, res) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    if (rateLimiter.isBlocked(ip)) {
      return res.status(429).json({
        ok: false,
        error: 'Muitas tentativas inválidas. Aguarde alguns minutos e tente novamente.'
      });
    }

    const { username, password } = req.body || {};
    if (!store.verifyAdminCredentials(username, password)) {
      rateLimiter.recordFailure(ip);
      return res.status(401).json({
        ok: false,
        error: 'Usuário ou senha inválidos.'
      });
    }

    rateLimiter.clear(ip);
    const authCfg = store.getAuthConfig();
    const token = createSessionToken({
      username: authCfg.username,
      tokenVersion: authCfg.tokenVersion,
      secret: authCfg.sessionSecret
    });
    setSessionCookie(res, token);
    res.json({
      ok: true,
      authenticated: true,
      username: authCfg.username
    });
  });

  router.post('/auth/logout', (req, res) => {
    const session = extractSessionFromRequest(req, store);
    if (session) {
      store.invalidateSessions();
    }
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    res.json({ ok: true, authenticated: false });
  });

  router.put('/auth/credentials', requireConfigAuth, (req, res) => {
    try {
      const { currentPassword, newUsername, newPassword } = req.body || {};
      const updated = store.updateAdminCredentials({ currentPassword, newUsername, newPassword });
      const token = createSessionToken({
        username: updated.username,
        tokenVersion: updated.tokenVersion,
        secret: updated.sessionSecret
      });
      setSessionCookie(res, token);
      res.json({
        ok: true,
        username: updated.username,
        message: 'Credenciais administrativas atualizadas com sucesso!'
      });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  router.get('/health', (_req, res) => {
    const view = aggregator.getClassifiedView();
    res.json({
      ok: true,
      lastSyncAt: view.lastSyncAt,
      isRefreshing: view.isRefreshing,
      totalPautas: view.stats.totalPautas
    });
  });

  router.get('/news', async (req, res, next) => {
    try {
      let view = aggregator.getClassifiedView();
      if (!view.lastSyncAt && req.query.bootstrap !== '0') {
        view = await aggregator.refresh({ triggerAutoSend: false });
      }
      res.json(view);
    } catch (err) {
      next(err);
    }
  });

  router.post('/refresh', async (_req, res, next) => {
    try {
      const view = await aggregator.refresh({ triggerAutoSend: true });
      res.json(view);
    } catch (err) {
      next(err);
    }
  });

  router.get('/settings', requireConfigAuth, (_req, res) => {
    const settings = store.getSettings();
    res.json({
      ...settings,
      meta: {
        hasBotToken: Boolean(settings.telegram.botToken?.trim()),
        hasChatId: Boolean(settings.telegram.chatId?.trim())
      }
    });
  });

  router.put('/settings', requireConfigAuth, (req, res) => {
    const updated = store.updateSettings(req.body || {});
    if (req.body?.laya?.enabled) {
      aggregator.classifyPendingWithLaya().catch(() => {});
    }
    res.json({
      ...updated,
      meta: {
        hasBotToken: Boolean(updated.telegram.botToken?.trim()),
        hasChatId: Boolean(updated.telegram.chatId?.trim())
      }
    });
  });

  router.get('/laya/status', async (_req, res) => {
    const status = await aggregator.checkLayaStatus();
    const view = aggregator.getClassifiedView();
    res.json({
      ...status,
      ...view.layaStatus
    });
  });

  router.post('/laya/reclassify', requireConfigAuth, async (req, res) => {
    const forceAll = Boolean(req.body?.forceAll);
    const status = await aggregator.checkLayaStatus();
    if (!status.enabled) {
      return res.status(400).json({ ok: false, error: 'O classificador Laya está desativado nas configurações.' });
    }
    if (!status.online) {
      return res.status(503).json({
        ok: false,
        error: `Serviço Laya indisponível em ${store.getSettings().laya?.endpointUrl}: ${status.error || 'sem resposta'}`
      });
    }
    aggregator.classifyPendingWithLaya({ forceAll }).catch(() => {});
    res.json({
      ok: true,
      message: forceAll
        ? 'Reclassificação completa iniciada com o Laya AI.'
        : 'Classificação das pautas pendentes iniciada com o Laya AI.',
      view: aggregator.getClassifiedView()
    });
  });

  router.get('/sources', requireConfigAuth, (_req, res) => {
    const sources = store.getSources();
    const view = aggregator.getClassifiedView();
    const statusMap = new Map((view.sourceStatuses || []).map((s) => [s.sourceId, s]));
    res.json(
      sources.map((src) => ({
        ...src,
        lastStatus: statusMap.get(src.id) || null
      }))
    );
  });

  router.post('/sources/probe', requireConfigAuth, async (req, res) => {
    try {
      const result = await probeSourceFn(req.body?.url);
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  router.post('/sources', requireConfigAuth, async (req, res) => {
    try {
      const { name, url, category = 'blog', type = 'auto', geoHint = 'rn' } = req.body || {};
      if (!url || !String(url).trim()) {
        return res.status(400).json({ error: 'Informe a URL do portal ou blog.' });
      }

      let resolvedUrl = String(url).trim();
      let resolvedType = type;
      let resolvedName = String(name || '').trim();

      if (type === 'auto') {
        const probed = await probeSourceFn(resolvedUrl);
        resolvedUrl = probed.url;
        resolvedType = probed.type;
        if (!resolvedName && probed.suggestedName) {
          resolvedName = probed.suggestedName.split(/[|\-–]/)[0].trim().slice(0, 48);
        }
      }

      if (!resolvedName) {
        resolvedName = new URL(resolvedUrl).hostname.replace(/^www\./, '');
      }

      const idBase = resolvedName
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'fonte';

      const created = store.addSource({
        id: `${idBase}-${Date.now().toString(36).slice(-4)}`,
        name: resolvedName,
        shortName: resolvedName.slice(0, 14),
        category,
        type: resolvedType,
        url: resolvedUrl,
        siteUrl: new URL(resolvedUrl).origin,
        geoHint
      });
      res.status(201).json(created);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.patch('/sources/:id', requireConfigAuth, (req, res) => {
    const updated = store.updateSource(req.params.id, req.body || {});
    if (!updated) {
      return res.status(404).json({ error: 'Fonte não encontrada.' });
    }
    res.json(updated);
  });

  router.delete('/sources/:id', requireConfigAuth, (req, res) => {
    const result = store.deleteSource(req.params.id);
    if (!result.deleted) {
      if (result.reason === 'builtin_protected') {
        return res.status(400).json({ error: 'Fontes padrão não podem ser removidas, apenas desativadas.' });
      }
      return res.status(404).json({ error: 'Fonte não encontrada.' });
    }
    res.json({ ok: true });
  });

  router.post('/telegram/detect-chats', requireConfigAuth, async (req, res) => {
    try {
      const settings = store.getSettings();
      const botToken = req.body?.botToken?.trim() || settings.telegram.botToken;
      const chats = await telegram.detectRecentChats(botToken);
      res.json({ ok: true, chats });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  router.post('/telegram/test', requireConfigAuth, async (req, res) => {
    try {
      const settings = store.getSettings();
      const botToken = req.body?.botToken?.trim() || settings.telegram.botToken;
      const chatId = req.body?.chatId?.trim() || settings.telegram.chatId;
      const result = await telegram.sendTestNotification(botToken, chatId);
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  router.post('/telegram/send', async (req, res) => {
    try {
      const settings = store.getSettings();
      const tg = settings.telegram;
      const botToken = tg.botToken?.trim();
      const chatId = tg.chatId?.trim();
      if (!botToken || !chatId) {
        return res.status(400).json({
          ok: false,
          error: 'Configure o Token do Bot e o ID do Grupo na aba Configurações antes de enviar.'
        });
      }

      const { canonicalUrl, article: providedArticle, customTvSuggestion } = req.body || {};
      const view = aggregator.getClassifiedView();
      const allKnown = [...view.pautas, ...view.quarantine, ...view.filteredGeo, ...view.filteredLowTv];
      const found =
        allKnown.find((a) => a.canonicalUrl === canonicalUrl) ||
        providedArticle;

      if (!found || !found.title) {
        return res.status(404).json({ ok: false, error: 'Matéria não encontrada para envio.' });
      }

      const enriched = customTvSuggestion
        ? { ...found, tvSuggestion: String(customTvSuggestion).trim() }
        : found;

      const htmlText = formatArticleMessage(enriched, tg);
      const delivery = await telegram.sendTelegramMessage(botToken, chatId, htmlText);

      store.recordSent({
        canonicalUrl: enriched.canonicalUrl,
        title: enriched.title,
        sourceName: enriched.sourceName,
        chatId,
        messageId: delivery.messageId,
        mode: 'single'
      });

      res.json({ ok: true, messageId: delivery.messageId, sentHistory: store.getSentHistory() });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  router.post('/telegram/send-bulletin', async (req, res) => {
    try {
      const settings = store.getSettings();
      const tg = settings.telegram;
      const botToken = tg.botToken?.trim();
      const chatId = tg.chatId?.trim();
      if (!botToken || !chatId) {
        return res.status(400).json({
          ok: false,
          error: 'Configure o Token do Bot e o ID do Grupo na aba Configurações antes de enviar.'
        });
      }

      const {
        articles: bodyArticles,
        mode = 'digest',
        headerTitle = 'BOLETIM DA RONDA — NATAL/RN',
        clearQueue = true
      } = req.body || {};

      const queue = Array.isArray(bodyArticles) && bodyArticles.length > 0
        ? bodyArticles
        : store.getBulletinQueue();

      if (queue.length === 0) {
        return res.status(400).json({ ok: false, error: 'Nenhuma pauta selecionada no boletim.' });
      }

      const messageIds = [];
      if (mode === 'individual') {
        for (const art of queue) {
          const text = formatArticleMessage(art, tg);
          const delivery = await telegram.sendTelegramMessage(botToken, chatId, text);
          messageIds.push(delivery.messageId);
          store.recordSent({
            canonicalUrl: art.canonicalUrl,
            title: art.title,
            sourceName: art.sourceName,
            chatId,
            messageId: delivery.messageId,
            mode: 'bulletin-individual'
          });
        }
      } else {
        const chunks = formatBulletinMessages(queue, { ...tg, headerTitle });
        for (const chunk of chunks) {
          const delivery = await telegram.sendTelegramMessage(botToken, chatId, chunk);
          messageIds.push(delivery.messageId);
        }
        for (const art of queue) {
          store.recordSent({
            canonicalUrl: art.canonicalUrl,
            title: art.title,
            sourceName: art.sourceName,
            chatId,
            messageId: messageIds[0] || null,
            mode: 'bulletin-digest'
          });
        }
      }

      if (clearQueue) {
        store.clearBulletin();
      }

      res.json({
        ok: true,
        sentCount: queue.length,
        messageIds,
        bulletinQueue: store.getBulletinQueue(),
        sentHistory: store.getSentHistory()
      });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  router.get('/bulletin', (_req, res) => {
    res.json(store.getBulletinQueue());
  });

  router.post('/bulletin', (req, res) => {
    const article = req.body?.article;
    if (!article?.canonicalUrl || !article?.title) {
      return res.status(400).json({ error: 'Dados da matéria inválidos.' });
    }
    const updated = store.addToBulletin(article);
    res.json(updated);
  });

  router.delete('/bulletin', (req, res) => {
    const canonicalUrl = req.query.url;
    if (canonicalUrl) {
      return res.json(store.removeFromBulletin(String(canonicalUrl)));
    }
    res.json(store.clearBulletin());
  });

  router.get('/sent-history', (_req, res) => {
    res.json(store.getSentHistory());
  });

  router.post('/articles/override', (req, res) => {
    const { canonicalUrl, action } = req.body || {};
    if (!canonicalUrl || !['approve', 'block', 'reset'].includes(action)) {
      return res.status(400).json({ error: 'Parâmetros inválidos.' });
    }
    store.setOverride(canonicalUrl, action);
    res.json(aggregator.getClassifiedView());
  });

  router.get('/likes', (_req, res) => {
    const view = aggregator.getClassifiedView();
    res.json({
      likedArticles: store.getLikedArticles(),
      preferenceProfile: view.preferenceProfile
    });
  });

  router.post('/articles/like', (req, res) => {
    const { canonicalUrl, article: providedArticle } = req.body || {};
    const url = canonicalUrl || providedArticle?.canonicalUrl;
    if (!url) {
      return res.status(400).json({ error: 'Matéria inválida para curtir.' });
    }

    const currentView = aggregator.getClassifiedView();
    const allKnown = [
      ...currentView.pautas,
      ...currentView.quarantine,
      ...currentView.filteredGeo,
      ...currentView.filteredLowTv
    ];
    const target = allKnown.find((a) => a.canonicalUrl === url) || providedArticle;
    if (!target?.title) {
      return res.status(404).json({ error: 'Matéria não encontrada.' });
    }

    const toggleRes = store.toggleLikeArticle({ ...target, canonicalUrl: url });
    const nextView = aggregator.getClassifiedView();
    res.json({
      ok: true,
      liked: toggleRes.liked,
      ...nextView
    });
  });

  router.delete('/likes', requireConfigAuth, (_req, res) => {
    store.clearLikedArticles();
    res.json({
      ok: true,
      ...aggregator.getClassifiedView()
    });
  });

  return router;
}
