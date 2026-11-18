import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  canonicalizeUrl,
  parseFeedXml,
  parseHtmlArticles,
  parseWpJsonPosts,
  stripHtmlToText
} from '../src/services/fetcher.js';
import { AppStore } from '../src/config/store.js';
import { NewsAggregator, deduplicateAndCluster, toNatalDateKey } from '../src/services/aggregator.js';

const TODAY_MIDDAY_ISO = `${toNatalDateKey(new Date())}T15:00:00.000Z`;

describe('Fetcher & Parsers', () => {
  it('canonicaliza URLs removendo utm e barra final', () => {
    const clean = canonicalizeUrl('https://tribunadonorte.com.br/natal/materia-teste/?utm_source=ig&fbclid=123#top');
    assert.equal(clean, 'https://tribunadonorte.com.br/natal/materia-teste');
  });

  it('interpreta posts WP-JSON com data GMT e imagem destacada', () => {
    const source = { id: 'tribuna-natal', name: 'Tribuna', shortName: 'Tribuna', category: 'portal', badgeColor: '#004b8d' };
    const posts = [
      {
        link: 'https://tribunadonorte.com.br/natal/noticia-1/',
        date_gmt: '2026-11-16T21:19:10',
        title: { rendered: 'Semurb prepara cadastramento &#8211; Praia de Miami' },
        excerpt: { rendered: '<p>Ação organiza ambulantes em Natal. <a href="#">Leia mais</a></p>' },
        content: { rendered: '<p>Conteúdo completo sobre o cadastramento na Praia de Miami em Natal.</p>' },
        _embedded: {
          'wp:featuredmedia': [{ source_url: 'https://storage.tribunadonorte.com.br/foto.jpg' }]
        }
      }
    ];
    const items = parseWpJsonPosts(posts, source);
    assert.equal(items.length, 1);
    assert.equal(items[0].publishedAt, '2026-11-16T21:19:10.000Z');
    assert.equal(items[0].imageUrl, 'https://storage.tribunadonorte.com.br/foto.jpg');
    assert.match(items[0].title, /Semurb prepara cadastramento – Praia de Miami/);
    assert.doesNotMatch(items[0].summary, /<p>/);
  });

  it('interpreta RSS XML padrão G1 RN e Agência Brasil', () => {
    const g1Xml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
        <channel>
          <item>
            <title>Matrícula especial começa em Natal</title>
            <atom:subtitle>Inscrições seguem até sexta-feira na rede municipal.</atom:subtitle>
            <link>https://g1.globo.com/rn/rio-grande-do-norte/noticia/2026/11/16/matricula.ghtml</link>
            <media:content url="https://s2-g1.glbimg.com/foto.jpg" medium="image" />
            <category>G1</category>
            <pubDate>Mon, 16 Nov 2026 21:06:28 -0000</pubDate>
          </item>
        </channel>
      </rss>`;

    const g1Items = parseFeedXml(g1Xml, { id: 'g1-rn', name: 'G1 RN', category: 'portal' });
    assert.equal(g1Items.length, 1);
    assert.equal(g1Items[0].imageUrl, 'https://s2-g1.glbimg.com/foto.jpg');
    assert.equal(g1Items[0].summary, 'Inscrições seguem até sexta-feira na rede municipal.');

    const agXml = `<?xml version="1.0" encoding="utf-8"?>
      <rss version="2.0">
        <channel>
          <item>
            <title>Porto de Natal bate recorde</title>
            <link>https://agenciabrasil.ebc.com.br/geral/noticia/2026-11/porto-natal</link>
            <imagem-destaque>https://imagens.ebc.com.br/porto.jpg</imagem-destaque>
            <description><![CDATA[<p>Movimentação em Natal cresceu no trimestre.</p>]]></description>
            <pubDate>Mon, 16 Nov 2026 14:59:00 -0300</pubDate>
          </item>
        </channel>
      </rss>`;
    const agItems = parseFeedXml(agXml, { id: 'agencia-brasil', name: 'Agência Brasil', category: 'agencia' });
    assert.equal(agItems.length, 1);
    assert.equal(agItems[0].imageUrl, 'https://imagens.ebc.com.br/porto.jpg');
    assert.equal(stripHtmlToText(agItems[0].summary), 'Movimentação em Natal cresceu no trimestre.');
  });

  it('extrai notícias de HTML como fallback para blogs sem RSS', () => {
    const html = `
      <main>
        <article>
          <h2><a href="/2026/chuvas-natal">Chuvas alagam trechos da Avenida Roberto Freire em Natal</a></h2>
          <p>Motoristas enfrentam retenções na manhã desta segunda-feira em Ponta Negra.</p>
          <img src="/uploads/chuva.jpg" />
        </article>
      </main>`;
    const items = parseHtmlArticles(html, 'https://bloglocalnatal.com.br', { id: 'blog-x', name: 'Blog X' });
    assert.equal(items.length, 1);
    assert.equal(items[0].url, 'https://bloglocalnatal.com.br/2026/chuvas-natal');
    assert.equal(items[0].imageUrl, 'https://bloglocalnatal.com.br/uploads/chuva.jpg');
  });

  it('deduplica URLs repetidas e agrupa manchetes idênticas entre portais diferentes', () => {
    const items = [
      {
        canonicalUrl: 'https://novonoticias.com.br/iptu-2027',
        url: 'https://novonoticias.com.br/iptu-2027',
        title: 'Prefeitura do Natal antecipa IPTU 2027 com desconto de 16% para contribuintes em dia',
        sourceId: 'novo-noticias',
        sourceName: 'NOVO Notícias',
        sourceShortName: 'NOVO',
        publishedAt: '2026-11-16T21:00:00.000Z',
        imageUrl: 'https://novo.jpg'
      },
      {
        canonicalUrl: 'https://pontanegranews.com.br/iptu-2027',
        url: 'https://pontanegranews.com.br/iptu-2027',
        title: 'IPTU 2027: Prefeitura do Natal oferece desconto de 16% para pagamento antecipado',
        sourceId: 'ponta-negra-news',
        sourceName: 'Ponta Negra News',
        sourceShortName: 'Ponta Negra',
        publishedAt: '2026-11-16T20:40:00.000Z',
        imageUrl: null
      }
    ];
    const clustered = deduplicateAndCluster(items);
    assert.equal(clustered.length, 1);
    assert.equal(clustered[0].alsoReportedBy.length, 1);
    assert.equal(clustered[0].alsoReportedBy[0].sourceShortName, 'Ponta Negra');
  });

  it('compartilha refresh simultâneo e aplica timeout rígido em fonte travada', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agg-refresh-'));
    try {
      const store = new AppStore(tmpDir);
      let fetchCalls = 0;
      const agg = new NewsAggregator(store, {
        sourceTimeoutMs: 60,
        fetchSourceFn: async (src) => {
          fetchCalls++;
          if (src.id === 'tribuna-natal') {
            await new Promise((r) => setTimeout(r, 30));
            return {
              sourceId: src.id,
              sourceName: src.name,
              ok: true,
              itemCount: 1,
              durationMs: 30,
              items: [
                {
                  canonicalUrl: 'https://tribunadonorte.com.br/natal/teste-sync',
                  url: 'https://tribunadonorte.com.br/natal/teste-sync',
                  title: 'Feira de serviços atende moradores em Natal nesta manhã',
                  summary: 'Atendimento gratuito segue até as 16h.',
                  content: '',
                  imageUrl: null,
                  categories: ['Natal'],
                  publishedAt: TODAY_MIDDAY_ISO,
                  sourceId: src.id,
                  sourceName: src.name,
                  sourceShortName: src.shortName,
                  sourceCategory: src.category,
                  badgeColor: src.badgeColor,
                  geoHint: 'natal'
                }
              ]
            };
          }
          // Simula outra fonte lenta além do sourceTimeoutMs
          await new Promise((r) => setTimeout(r, 200));
          return { sourceId: src.id, sourceName: src.name, ok: true, itemCount: 0, durationMs: 200, items: [] };
        },
        checkLayaHealthFn: async () => ({ online: false })
      });

      const [v1, v2] = await Promise.all([
        agg.refresh({ triggerAutoSend: false }),
        agg.refresh({ triggerAutoSend: false })
      ]);

      assert.ok(v1.lastSyncAt, 'Primeira chamada deve preencher lastSyncAt');
      assert.equal(v2.lastSyncAt, v1.lastSyncAt, 'Segunda chamada simultânea deve receber resultado concluído');
      assert.equal(v2.pautas.length, 1);
      assert.equal(agg.isRefreshing, false);
      assert.equal(fetchCalls, store.getSources().filter((s) => s.enabled).length);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('retém matérias por 7 dias entre coletas, exibe só as do dia na inicial e expira acima de 7 dias', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agg-retention-'));
    try {
      const store = new AppStore(tmpDir);
      const fixedNow = new Date('2026-11-17T15:00:00.000Z').getTime();
      let round = 1;

      const makeItem = (slug, title, publishedAt) => ({
        canonicalUrl: `https://tribunadonorte.com.br/natal/${slug}`,
        url: `https://tribunadonorte.com.br/natal/${slug}`,
        title,
        summary: 'Matéria de serviço em Natal.',
        content: '',
        imageUrl: null,
        categories: ['Natal'],
        publishedAt,
        sourceId: 'tribuna-natal',
        sourceName: 'Tribuna do Norte (Natal)',
        sourceShortName: 'Tribuna',
        sourceCategory: 'portal',
        badgeColor: '#004b8d',
        geoHint: 'natal'
      });

      const agg = new NewsAggregator(store, {
        nowFn: () => fixedNow,
        fetchSourceFn: async (src) => {
          if (src.id !== 'tribuna-natal') {
            return { sourceId: src.id, sourceName: src.name, ok: true, itemCount: 0, durationMs: 5, items: [] };
          }
          if (round === 1) {
            return {
              sourceId: src.id,
              sourceName: src.name,
              ok: true,
              itemCount: 3,
              durationMs: 10,
              items: [
                makeItem('hoje-1', 'Matrícula escolar abre hoje em Natal', '2026-11-17T13:00:00.000Z'),
                makeItem('dois-dias', 'Mutirão de serviços no Alecrim em Natal', '2026-11-15T14:00:00.000Z'),
                makeItem('oito-dias', 'Feira antiga da semana passada em Natal', '2026-11-08T14:00:00.000Z')
              ]
            };
          }
          // Na 2a coleta o RSS girou e não traz mais 'hoje-1' nem 'dois-dias'
          return {
            sourceId: src.id,
            sourceName: src.name,
            ok: true,
            itemCount: 1,
            durationMs: 10,
            items: [
              makeItem('hoje-2', 'Sine abre novas vagas de emprego em Natal', '2026-11-17T14:30:00.000Z')
            ]
          };
        },
        checkLayaHealthFn: async () => ({ online: false })
      });

      await agg.refresh({ triggerAutoSend: false });
      round = 2;
      const view = await agg.refresh({ triggerAutoSend: false });

      assert.equal(view.todayDateKey, '2026-11-17');
      assert.equal(view.pautas.length, 2, 'Deve manter as 2 matérias de hoje mesmo após o feed girar');
      assert.deepEqual(
        view.pautas.map((p) => p.title),
        ['Sine abre novas vagas de emprego em Natal', 'Matrícula escolar abre hoje em Natal']
      );

      assert.equal(view.historyPautas.length, 3, 'Histórico de 7 dias retém hoje + 2 dias atrás e remove 8+ dias');
      assert.ok(view.historyPautas.some((p) => p.title.includes('Mutirão de serviços')));
      assert.equal(
        view.historyPautas.some((p) => p.title.includes('Feira antiga')),
        false
      );
      assert.deepEqual(view.historyDates, ['2026-11-17', '2026-11-15']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('regra obrigatória: matérias já coletadas no dia nunca saem da página inicial em novas coletas', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agg-sticky-today-'));
    try {
      const store = new AppStore(tmpDir);
      const fixedNow = new Date('2026-11-18T15:00:00.000Z').getTime();
      let round = 1;

      const agg = new NewsAggregator(store, {
        nowFn: () => fixedNow,
        fetchSourceFn: async (src) => {
          if (round === 1) {
            if (src.id === 'o-poti') {
              return {
                sourceId: src.id,
                sourceName: src.name,
                ok: true,
                itemCount: 1,
                durationMs: 5,
                items: [
                  {
                    canonicalUrl: 'https://opoti.com.br/unimed-edital-2027',
                    url: 'https://opoti.com.br/unimed-edital-2027',
                    title: 'Unimed Natal lança edital cultural para 2027 e prêmio de jornalismo',
                    summary: 'Inscrições gratuitas começam nesta semana em Natal.',
                    content: 'Atendimento e inscrições em Natal/RN.',
                    imageUrl: null,
                    categories: ['Cultura'],
                    publishedAt: '2026-11-18T13:09:19.000Z',
                    sourceId: src.id,
                    sourceName: src.name,
                    sourceShortName: src.shortName,
                    sourceCategory: src.category,
                    badgeColor: src.badgeColor,
                    geoHint: 'rn'
                  }
                ]
              };
            }
            if (src.id === 'ponta-negra-news') {
              return {
                sourceId: src.id,
                sourceName: src.name,
                ok: true,
                itemCount: 1,
                durationMs: 5,
                items: [
                  {
                    canonicalUrl: 'https://pontanegranews.com.br/gabarito-enem-2026',
                    url: 'https://pontanegranews.com.br/gabarito-enem-2026',
                    title: 'Inep divulga gabarito oficial do Enem 2026; veja como consultar',
                    summary: 'Estudantes de Natal e do RN já podem conferir as respostas.',
                    content: 'Em Natal, provas ocorreram na UFRN e IFRN.',
                    imageUrl: null,
                    categories: ['Educação'],
                    publishedAt: '2026-11-18T14:20:00.000Z',
                    sourceId: src.id,
                    sourceName: src.name,
                    sourceShortName: src.shortName,
                    sourceCategory: src.category,
                    badgeColor: src.badgeColor,
                    geoHint: 'rn'
                  }
                ]
              };
            }
            return { sourceId: src.id, sourceName: src.name, ok: true, itemCount: 0, durationMs: 5, items: [] };
          }

          // Round 2:
          // - 'tribuna-natal' traz matéria de ONTEM (2026-11-17) com manchete quase idêntica à do O Poti (não pode engolir a de hoje)
          // - 'novo-noticias' traz matéria de HOJE sem menção a Natal (filtered_geo) com manchete idêntica à da Ponta Negra (não pode engolir a aprovada)
          // - 'ponta-negra-news' retorna versão truncada (fallback RSS sem menção a Natal) da mesma URL já aprovada
          if (src.id === 'tribuna-natal') {
            return {
              sourceId: src.id,
              sourceName: src.name,
              ok: true,
              itemCount: 1,
              durationMs: 5,
              items: [
                {
                  canonicalUrl: 'https://tribunadonorte.com.br/unimed-edital-ontem',
                  url: 'https://tribunadonorte.com.br/unimed-edital-ontem',
                  title: 'Unimed Natal lança edital cultural para 2027 e prêmio de jornalismo no RN',
                  summary: 'Edital cultural foi apresentado ontem.',
                  content: '',
                  imageUrl: 'https://tribuna.com/foto.jpg',
                  categories: ['Natal'],
                  publishedAt: '2026-11-18T00:47:50.000Z', // 21:47 de 2026-11-17 em Natal (-03:00)
                  sourceId: src.id,
                  sourceName: src.name,
                  sourceShortName: src.shortName,
                  sourceCategory: src.category,
                  badgeColor: src.badgeColor,
                  geoHint: 'natal'
                }
              ]
            };
          }
          if (src.id === 'novo-noticias') {
            return {
              sourceId: src.id,
              sourceName: src.name,
              ok: true,
              itemCount: 1,
              durationMs: 5,
              items: [
                {
                  canonicalUrl: 'https://novonoticias.com.br/gabarito-enem-2026',
                  url: 'https://novonoticias.com.br/gabarito-enem-2026',
                  title: 'Inep divulga gabarito oficial do Enem 2026; veja como consultar',
                  summary: 'Cadernos de prova estão disponíveis na Página do Participante.',
                  content: 'Texto nacional sem citar a capital.',
                  imageUrl: 'https://novo.com/enem.jpg',
                  categories: ['Brasil'],
                  publishedAt: '2026-11-18T14:40:00.000Z',
                  sourceId: src.id,
                  sourceName: src.name,
                  sourceShortName: src.shortName,
                  sourceCategory: src.category,
                  badgeColor: src.badgeColor,
                  geoHint: 'rn'
                }
              ]
            };
          }
          if (src.id === 'ponta-negra-news') {
            return {
              sourceId: src.id,
              sourceName: src.name,
              ok: true,
              itemCount: 1,
              durationMs: 5,
              items: [
                {
                  canonicalUrl: 'https://pontanegranews.com.br/gabarito-enem-2026',
                  url: 'https://pontanegranews.com.br/gabarito-enem-2026',
                  title: 'Inep divulga gabarito oficial do Enem 2026; veja como consultar',
                  summary: 'Confira as respostas oficiais.',
                  content: '',
                  imageUrl: null,
                  categories: [],
                  publishedAt: '2026-11-18T14:20:00.000Z',
                  sourceId: src.id,
                  sourceName: src.name,
                  sourceShortName: src.shortName,
                  sourceCategory: src.category,
                  badgeColor: src.badgeColor,
                  geoHint: 'rn'
                }
              ]
            };
          }
          return { sourceId: src.id, sourceName: src.name, ok: true, itemCount: 0, durationMs: 5, items: [] };
        },
        checkLayaHealthFn: async () => ({ online: false })
      });

      const v1 = await agg.refresh({ triggerAutoSend: false });
      assert.equal(v1.pautas.length, 2, 'Round 1 deve aprovar as 2 matérias de hoje na página inicial');
      const v1Urls = v1.pautas.map((p) => p.canonicalUrl).sort();
      assert.deepEqual(v1Urls, [
        'https://opoti.com.br/unimed-edital-2027',
        'https://pontanegranews.com.br/gabarito-enem-2026'
      ]);

      round = 2;
      const v2 = await agg.refresh({ triggerAutoSend: false });
      const v2Urls = v2.pautas.map((p) => p.canonicalUrl).sort();
      assert.deepEqual(
        v2Urls,
        v1Urls,
        'Nenhuma matéria já coletada no dia pode sair da página inicial na coleta seguinte'
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
