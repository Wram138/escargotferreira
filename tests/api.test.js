import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';
import { AppStore } from '../src/config/store.js';
import { NewsAggregator } from '../src/services/aggregator.js';
import { sortArticles } from '../public/shared.js';

describe('API Ronda Jornalística & Telegram', () => {
  let tmpDir;
  let server;
  let baseUrl;
  let sentPayloads;
  let adminCookie;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ronda-test-'));
    sentPayloads = [];

    const store = new AppStore(tmpDir);
    const mockFetchSource = async (source) => {
      if (source.id === 'tribuna-natal') {
        return {
          sourceId: source.id,
          sourceName: source.name,
          ok: true,
          itemCount: 3,
          durationMs: 25,
          items: [
            {
              canonicalUrl: 'https://tribunadonorte.com.br/natal/educacao-especial',
              url: 'https://tribunadonorte.com.br/natal/educacao-especial',
              title: 'Matrícula para Educação Especial começa nesta terça em Natal',
              summary: 'Inscrições na rede municipal acontecem até sexta-feira.',
              content: '',
              imageUrl: 'https://example.com/1.jpg',
              categories: ['Natal'],
              publishedAt: '2026-11-16T20:00:00.000Z',
              sourceId: source.id,
              sourceName: source.name,
              sourceShortName: source.shortName,
              sourceCategory: source.category,
              badgeColor: source.badgeColor,
              geoHint: source.geoHint
            },
            {
              canonicalUrl: 'https://tribunadonorte.com.br/natal/critica-prefeitura',
              url: 'https://tribunadonorte.com.br/natal/critica-prefeitura',
              title: 'Moradores denunciam abandono e falta de médicos em UBS de Natal',
              summary: 'População cobra explicações da Prefeitura do Natal.',
              content: '',
              imageUrl: null,
              categories: ['Natal'],
              publishedAt: '2026-11-16T19:00:00.000Z',
              sourceId: source.id,
              sourceName: source.name,
              sourceShortName: source.shortName,
              sourceCategory: source.category,
              badgeColor: source.badgeColor,
              geoHint: source.geoHint
            },
            {
              canonicalUrl: 'https://tribunadonorte.com.br/natal/ocorrencia-policial',
              url: 'https://tribunadonorte.com.br/natal/ocorrencia-policial',
              title: 'Casal é preso por tráfico de drogas e porte de pistola em Natal',
              summary: 'Suspeitos foram levados para a delegacia pela PM.',
              content: '',
              imageUrl: null,
              categories: ['Polícia'],
              publishedAt: '2026-11-16T18:30:00.000Z',
              sourceId: source.id,
              sourceName: source.name,
              sourceShortName: source.shortName,
              sourceCategory: source.category,
              badgeColor: source.badgeColor,
              geoHint: source.geoHint
            }
          ]
        };
      }
      return {
        sourceId: source.id,
        sourceName: source.name,
        ok: true,
        itemCount: 0,
        durationMs: 10,
        items: []
      };
    };

    const mockTelegram = {
      sendTestNotification: async (botToken, chatId) => {
        if (!botToken || !chatId) throw new Error('Token ou chat ausente');
        return {
          bot: { id: 1, username: 'ronda_natal_bot', firstName: 'Ronda' },
          sent: true,
          messageId: 777,
          chatTitle: 'Redação TV Natal',
          message: 'Teste OK!'
        };
      },
      detectRecentChats: async (botToken) => {
        if (!botToken) throw new Error('Token ausente');
        return [{ id: '-100999888777', type: 'supergroup', title: 'Pautas TV Natal' }];
      },
      sendTelegramMessage: async (botToken, chatId, htmlText) => {
        sentPayloads.push({ botToken, chatId, htmlText });
        return { messageId: 100 + sentPayloads.length, chat: { id: chatId } };
      }
    };

    const aggregator = new NewsAggregator(store, {
      fetchSourceFn: mockFetchSource,
      sendTelegramFn: mockTelegram.sendTelegramMessage,
      checkLayaHealthFn: async () => ({ online: true }),
      classifyLayaBatchFn: async (batch) =>
        batch.map((art) => ({
          canonicalUrl: art.canonicalUrl,
          laya: {
            source: 'laya',
            interestingProb: 0.88,
            isInteresting: true,
            importanceScore: 78,
            importanceLabel: 'Urgente'
          }
        }))
    });

    const { app } = createApp({
      store,
      aggregator,
      apiDeps: {
        telegram: mockTelegram,
        probeSourceFn: async (url) => ({
          type: 'rss',
          url: `${url.replace(/\/$/, '')}/feed/`,
          previewCount: 12,
          sampleTitle: 'Notícia local de Natal',
          suggestedName: 'Blog Natal Teste'
        })
      }
    });

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  after(() => {
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('retorna pautas aptas e separa prefeitura e crimes/violência na quarentena', async () => {
    const res = await fetch(`${baseUrl}/api/news`);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.pautas.length, 1);
    assert.match(body.pautas[0].title, /Educação Especial/);
    assert.equal(body.displayConfig.sortBy, 'recent');
    assert.equal(body.quarantine.length, 2);
    assert.equal(body.stats.blockedPrefeitura, 1);
    assert.equal(body.stats.blockedCrime, 1);
    const statuses = body.quarantine.map((q) => q.status).sort();
    assert.deepEqual(statuses, ['blocked_crime', 'blocked_prefeitura']);

    const idxRes = await fetch(`${baseUrl}/`);
    assert.equal(idxRes.status, 200);
    assert.equal(idxRes.headers.get('cache-control'), 'no-store');
    const idxHtml = await idxRes.text();
    assert.match(idxHtml, /id="ronda-sort-select"/);
    assert.match(idxHtml, /<option value="recent" selected>Mais recentes<\/option>/);
    assert.match(idxHtml, /<option value="importance">Mais importantes<\/option>/);
    assert.match(idxHtml, /<option value="interesting">Mais interessantes<\/option>/);
    assert.match(idxHtml, /window\.__INITIAL_NEWS__=/);
    assert.match(idxHtml, /Educação Especial/);
  });

  it('ordena pautas por mais recentes (padrão), mais importantes e mais interessantes', () => {
    const sample = [
      {
        title: 'Antiga mas muito importante',
        publishedAt: '2026-11-16T12:00:00.000Z',
        tvScore: 60,
        laya: { importanceScore: 95, interestingProb: 0.72, muitoInteressanteProb: 0.4 }
      },
      {
        title: 'Intermediária mais interessante',
        publishedAt: '2026-11-16T15:00:00.000Z',
        tvScore: 70,
        laya: { importanceScore: 68, interestingProb: 0.96, muitoInteressanteProb: 0.85 }
      },
      {
        title: 'Mais recente de todas',
        publishedAt: '2026-11-16T18:00:00.000Z',
        tvScore: 88,
        laya: { importanceScore: 42, interestingProb: 0.55, muitoInteressanteProb: 0.2 }
      }
    ];

    assert.equal(sortArticles(sample)[0].title, 'Mais recente de todas');
    assert.equal(sortArticles(sample, 'recent')[0].title, 'Mais recente de todas');
    assert.equal(sortArticles(sample, 'importance')[0].title, 'Antiga mas muito importante');
    assert.equal(sortArticles(sample, 'interesting')[0].title, 'Intermediária mais interessante');
    assert.equal(sortArticles(sample, 'tvScore')[0].title, 'Mais recente de todas');
  });

  it('protege rotas de configurações e autentica com admtati e senha inicial', async () => {
    const unauthEndpoints = [
      ['GET', '/api/settings'],
      ['PUT', '/api/settings'],
      ['GET', '/api/sources'],
      ['POST', '/api/sources'],
      ['POST', '/api/telegram/test'],
      ['POST', '/api/telegram/detect-chats'],
      ['POST', '/api/laya/reclassify']
    ];
    for (const [method, endpoint] of unauthEndpoints) {
      const r = await fetch(`${baseUrl}${endpoint}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'GET' ? undefined : JSON.stringify({})
      });
      assert.equal(r.status, 401, `${method} ${endpoint} deveria retornar 401 sem sessão`);
    }

    const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admtati', password: 'errada' })
    });
    assert.equal(badLogin.status, 401);

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admtati', password: '"w$D[;*[8#g}V_bq' })
    });
    assert.equal(loginRes.status, 200);
    const setCookie = loginRes.headers.get('set-cookie');
    assert.match(setCookie, /ronda_cfg_session=/);
    adminCookie = setCookie.split(';')[0];

    const statusRes = await fetch(`${baseUrl}/api/auth/status`, {
      headers: { Cookie: adminCookie }
    });
    const statusBody = await statusRes.json();
    assert.equal(statusBody.authenticated, true);
    assert.equal(statusBody.username, 'admtati');
  });

  it('persiste token e grupo na aba de configurações e testa/detecta grupos Telegram', async () => {
    const putRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        telegram: { botToken: '123456:TESTTOKEN', chatId: '-100999888777' }
      })
    });
    assert.equal(putRes.status, 200);
    const saved = await putRes.json();
    assert.equal(saved.meta.hasBotToken, true);
    assert.equal(saved.meta.hasChatId, true);

    // Reload store from disk to verify persistence
    const reloaded = new AppStore(tmpDir);
    assert.equal(reloaded.getSettings().telegram.botToken, '123456:TESTTOKEN');
    assert.equal(reloaded.getSettings().telegram.chatId, '-100999888777');

    const detectRes = await fetch(`${baseUrl}/api/telegram/detect-chats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({})
    });
    const detected = await detectRes.json();
    assert.equal(detected.chats[0].id, '-100999888777');

    const testRes = await fetch(`${baseUrl}/api/telegram/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({})
    });
    const testBody = await testRes.json();
    assert.equal(testBody.ok, true);
    assert.equal(testBody.sent, true);
  });

  it('envia matéria individual e boletim para o Telegram e registra histórico', async () => {
    const sendRes = await fetch(`${baseUrl}/api/telegram/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canonicalUrl: 'https://tribunadonorte.com.br/natal/educacao-especial' })
    });
    assert.equal(sendRes.status, 200);
    const sendData = await sendRes.json();
    assert.equal(sendData.ok, true);
    assert.equal(sentPayloads.length, 1);
    assert.match(sentPayloads[0].htmlText, /Educação Especial/);

    const newsRes = await fetch(`${baseUrl}/api/news?bootstrap=0`);
    const news = await newsRes.json();
    await fetch(`${baseUrl}/api/bulletin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ article: news.pautas[0] })
    });

    const bulRes = await fetch(`${baseUrl}/api/telegram/send-bulletin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'digest', clearQueue: true })
    });
    assert.equal(bulRes.status, 200);
    const bulData = await bulRes.json();
    assert.equal(bulData.sentCount, 1);
    assert.equal(bulData.bulletinQueue.length, 0);
    assert.equal(bulData.sentHistory.length, 2);
  });

  it('permite cadastrar e remover blog local customizado, protegendo fontes padrão', async () => {
    const addRes = await fetch(`${baseUrl}/api/sources`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ url: 'https://meublognatal.com.br', category: 'blog', type: 'auto' })
    });
    assert.equal(addRes.status, 201);
    const created = await addRes.json();
    assert.equal(created.name, 'Blog Natal Teste');

    const delBuiltin = await fetch(`${baseUrl}/api/sources/g1-rn`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie }
    });
    assert.equal(delBuiltin.status, 400);

    const delCustom = await fetch(`${baseUrl}/api/sources/${created.id}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie }
    });
    assert.equal(delCustom.status, 200);
  });

  it('permite curtir matérias ("Gostei") e atualiza perfil de preferências via API', async () => {
    const initialNews = await (await fetch(`${baseUrl}/api/news?bootstrap=0`)).json();
    const targetArticle = initialNews.pautas[0];
    assert.equal(targetArticle.likedByUser, false);
    assert.equal(initialNews.stats.likedCount, 0);

    const likeRes = await fetch(`${baseUrl}/api/articles/like`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canonicalUrl: targetArticle.canonicalUrl, article: targetArticle })
    });
    assert.equal(likeRes.status, 200);
    const likedBody = await likeRes.json();
    assert.equal(likedBody.ok, true);
    assert.equal(likedBody.liked, true);
    assert.equal(likedBody.stats.likedCount, 1);
    assert.equal(likedBody.pautas[0].likedByUser, true);
    assert.equal(likedBody.preferenceProfile.totalLikes, 1);

    // DELETE /api/likes exige sessão administrativa
    const unauthClear = await fetch(`${baseUrl}/api/likes`, { method: 'DELETE' });
    assert.equal(unauthClear.status, 401);

    const authClear = await fetch(`${baseUrl}/api/likes`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie }
    });
    assert.equal(authClear.status, 200);
    const clearedBody = await authClear.json();
    assert.equal(clearedBody.stats.likedCount, 0);
    assert.equal(clearedBody.pautas[0].likedByUser, false);
  });

  it('expõe status e reclassificação pelo Laya AI e permite alterar senha e sair', async () => {
    const stRes = await fetch(`${baseUrl}/api/laya/status`);
    assert.equal(stRes.status, 200);
    const st = await stRes.json();
    assert.equal(st.enabled, true);
    assert.equal(st.online, true);

    const recRes = await fetch(`${baseUrl}/api/laya/reclassify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ forceAll: true })
    });
    assert.equal(recRes.status, 200);
    const rec = await recRes.json();
    assert.equal(rec.ok, true);

    const dispPut = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        display: { beatFilter: 'Serviço & Utilidade', interestFilter: 'interesting', sortBy: 'importance' }
      })
    });
    assert.equal(dispPut.status, 200);

    const newsAfterDisp = await fetch(`${baseUrl}/api/news?bootstrap=0`);
    const newsBody = await newsAfterDisp.json();
    assert.equal(newsBody.displayConfig.beatFilter, 'Serviço & Utilidade');
    assert.equal(newsBody.displayConfig.interestFilter, 'interesting');

    const cfgPage = await fetch(`${baseUrl}/configuracoes`);
    assert.equal(cfgPage.status, 200);
    const cfgHtml = await cfgPage.text();
    assert.match(cfgHtml, /display-filters-form/);

    const credRes = await fetch(`${baseUrl}/api/auth/credentials`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ currentPassword: '"w$D[;*[8#g}V_bq', newPassword: 'NovaSenhaForte!2026' })
    });
    assert.equal(credRes.status, 200);
    const newCookie = credRes.headers.get('set-cookie').split(';')[0];

    // Old session cookie should be invalidated after credential rotation
    const oldCheck = await fetch(`${baseUrl}/api/settings`, { headers: { Cookie: adminCookie } });
    assert.equal(oldCheck.status, 401);

    const newCheck = await fetch(`${baseUrl}/api/settings`, { headers: { Cookie: newCookie } });
    assert.equal(newCheck.status, 200);

    await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: newCookie }
    });
    const afterLogout = await fetch(`${baseUrl}/api/settings`, { headers: { Cookie: newCookie } });
    assert.equal(afterLogout.status, 401);
  });
});
