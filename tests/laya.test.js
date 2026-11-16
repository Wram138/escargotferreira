import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  LAYA_NEWSROOM_QUESTIONS,
  classifyBatchWithLaya,
  importanceLabelFromScore,
  interpretLayaPrediction
} from '../src/services/laya.js';
import { AppStore } from '../src/config/store.js';
import { NewsAggregator } from '../src/services/aggregator.js';
import { formatArticleMessage } from '../src/services/telegram.js';

describe('Classificador Laya AI (interesse e grau de importância)', () => {
  it('interpreta respostas tipadas do Laya em interesse e grau de importância', () => {
    const urgent = interpretLayaPrediction({
      routing: { model: 'multilingual' },
      answers: {
        interesse: {
          choice: 'muito_interessante',
          probabilities: {
            muito_interessante: 0.72,
            interessante: 0.21,
            pouco_interessante: 0.07
          }
        },
        importancia: { score: 3.15 }
      }
    });

    assert.equal(urgent.source, 'laya');
    assert.equal(urgent.isInteresting, true);
    assert.equal(urgent.interestingProb, 0.93);
    assert.ok(urgent.importanceScore >= 75);
    assert.equal(urgent.importanceLabel, 'Urgente');

    const low = interpretLayaPrediction({
      answers: {
        interesse: {
          choice: 'pouco_interessante',
          probabilities: {
            muito_interessante: 0.04,
            interessante: 0.19,
            pouco_interessante: 0.77
          }
        },
        importancia: { score: 1.1 }
      }
    });

    assert.equal(low.isInteresting, false);
    assert.equal(low.interestingProb, 0.23);
    assert.equal(low.importanceLabel, 'Baixa');
    assert.equal(importanceLabelFromScore(58), 'Alta');
  });

  it('envia lote ao endpoint oficial /v1/systemone/batch do Laya', async () => {
    let capturedBody = null;
    const mockFetch = async (url, init) => {
      assert.equal(url, 'http://127.0.0.1:8001/v1/systemone/batch');
      capturedBody = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({
          results: [
            {
              answers: {
                interesse: {
                  choice: 'interessante',
                  probabilities: { muito_interessante: 0.2, interessante: 0.65, pouco_interessante: 0.15 }
                },
                importancia: { score: 2.5 }
              }
            }
          ]
        })
      };
    };

    const res = await classifyBatchWithLaya(
      [
        {
          canonicalUrl: 'https://g1.globo.com/rn/noticia-1',
          title: 'Matrícula especial começa em Natal',
          summary: 'Inscrições na rede municipal.'
        }
      ],
      { endpointUrl: 'http://127.0.0.1:8001' },
      mockFetch
    );

    assert.equal(capturedBody.model, 'multilingual');
    assert.deepEqual(Object.keys(capturedBody.questions), Object.keys(LAYA_NEWSROOM_QUESTIONS));
    assert.equal(res.length, 1);
    assert.equal(res[0].laya.isInteresting, true);
    assert.equal(res[0].laya.importanceLabel, 'Alta');
  });

  it('persiste cache do Laya no agregador e filtra baixo interesse quando ativado', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'laya-agg-'));
    try {
      const store = new AppStore(tmpDir);
      store.updateSettings({
        laya: { enabled: true, filterLowInterest: true, minInterestProb: 0.5 }
      });

      const agg = new NewsAggregator(store, {
        fetchSourceFn: async (src) =>
          src.id === 'tribuna-natal'
            ? {
                sourceId: src.id,
                sourceName: src.name,
                ok: true,
                itemCount: 2,
                durationMs: 10,
                items: [
                  {
                    canonicalUrl: 'https://tribuna.com/apagao-natal',
                    url: 'https://tribuna.com/apagao-natal',
                    title: 'Apagão atinge bairros de Natal',
                    summary: 'Falta de energia afeta moradores.',
                    content: '',
                    categories: ['Natal'],
                    publishedAt: '2026-11-16T21:00:00.000Z',
                    sourceId: src.id,
                    sourceName: src.name,
                    sourceShortName: src.shortName,
                    sourceCategory: src.category,
                    badgeColor: src.badgeColor,
                    geoHint: 'natal'
                  },
                  {
                    canonicalUrl: 'https://tribuna.com/nota-protocolar',
                    url: 'https://tribuna.com/nota-protocolar',
                    title: 'Evento reúne lideranças em homenagem em Natal',
                    summary: 'Solenidade aconteceu na tarde desta segunda.',
                    content: '',
                    categories: ['Natal'],
                    publishedAt: '2026-11-16T20:00:00.000Z',
                    sourceId: src.id,
                    sourceName: src.name,
                    sourceShortName: src.shortName,
                    sourceCategory: src.category,
                    badgeColor: src.badgeColor,
                    geoHint: 'natal'
                  }
                ]
              }
            : { sourceId: src.id, sourceName: src.name, ok: true, itemCount: 0, durationMs: 5, items: [] },
        checkLayaHealthFn: async () => ({ online: true }),
        classifyLayaBatchFn: async (batch) =>
          batch.map((art) => ({
            canonicalUrl: art.canonicalUrl,
            laya:
              art.canonicalUrl.includes('apagao')
                ? {
                    source: 'laya',
                    interestingProb: 0.91,
                    isInteresting: true,
                    importanceScore: 84,
                    importanceLabel: 'Urgente'
                  }
                : {
                    source: 'laya',
                    interestingProb: 0.22,
                    isInteresting: false,
                    importanceScore: 26,
                    importanceLabel: 'Baixa'
                  }
          }))
      });

      await agg.refresh({ triggerAutoSend: false });
      await agg.classifyPendingWithLaya();

      const view = agg.getClassifiedView();
      assert.equal(view.pautas.length, 1);
      assert.equal(view.pautas[0].laya.importanceLabel, 'Urgente');
      assert.equal(view.filteredLowTv.length, 1);
      assert.match(view.filteredLowTv[0].statusReason, /Laya classificou com baixo interesse/);

      const msg = formatArticleMessage(view.pautas[0], { includeLayaImportance: true });
      assert.match(msg, /Laya:.*Urgente.*84\/100/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
