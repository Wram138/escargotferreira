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
import { NewsAggregator, deduplicateAndCluster } from '../src/services/aggregator.js';

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
                  publishedAt: '2026-11-16T22:00:00.000Z',
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
});
