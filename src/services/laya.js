/**
 * Client for Laya System-1 decision server (`laya.serve` / `/v1/systemone/batch`).
 * Evaluates Portuguese news items for editorial interest (`interessante`)
 * and importance/urgency level (`importancia`).
 */

import { evaluatePreferenceMatch } from './preferences.js';

export const LAYA_NEWSROOM_QUESTIONS = {
  interesse: {
    type: 'choice',
    instructions: 'Classify how interesting this news article is for a local city TV news broadcast.',
    criteria: {
      muito_interessante:
        'urgent breaking public utility news, power or water outage, severe weather, health alert, traffic disruption, school enrollment, or jobs',
      interessante:
        'useful city service, taxes or discounts, local economy, tourism, hotels, university project, culture or neighborhood story',
      pouco_interessante:
        'political party quote, election endorsement, formal legislative tribute, award ceremony, police crime report, or commercial ad'
    }
  },
  importancia: {
    type: 'score',
    instructions: 'Rate the urgency and importance of this news for city citizens.',
    criteria: [
      'political opinion or ceremonial tribute with zero practical impact',
      'minor curiosity or niche local event',
      'moderate local interest in tourism, culture or economy',
      'important public service, school enrollment, jobs, taxes, health or city mobility',
      'urgent emergency, widespread outage, severe weather or major public utility disruption'
    ]
  }
};

export function importanceLabelFromScore(score100) {
  if (score100 >= 75) return 'Urgente';
  if (score100 >= 55) return 'Alta';
  if (score100 >= 38) return 'Média';
  return 'Baixa';
}

export function computeImportanceScore({ rawImpScore = 1.5, pMuito = 0, pInt = 0.5, pPouco = 0 }) {
  const impNorm = Math.max(0, Math.min(1, (rawImpScore - 1.0) / 2.2));
  const muitoBoost = Math.min(1, pMuito * 2.5);
  const raw = impNorm * 45 + muitoBoost * 35 + pInt * 20 - pPouco * 15;
  return Math.max(5, Math.min(100, Math.round(raw)));
}

/**
 * Converts raw Laya `/v1/systemone/batch` answer object into clean newsroom metadata.
 */
export function interpretLayaPrediction(rawResult, minInterestProb = 0.45) {
  const answers = rawResult?.answers || {};
  const intAns = answers.interesse || {};
  const impAns = answers.importancia || {};

  const probs = intAns.probabilities || {};
  const pMuito = Number(probs.muito_interessante || 0);
  const pInt = Number(probs.interessante || 0);
  const pPouco = Number(probs.pouco_interessante || 0);

  const interestingProb = Math.max(0, Math.min(1, pMuito + pInt));
  const isInteresting = interestingProb >= minInterestProb;

  const rawImpScore = Number(impAns.score ?? 1.5); // 0..4
  const importanceScore = computeImportanceScore({
    rawImpScore,
    pMuito,
    pInt: interestingProb,
    pPouco
  });
  const importanceLabel = importanceLabelFromScore(importanceScore);

  return {
    source: 'laya',
    model: rawResult?.routing?.model || 'multilingual',
    choice: intAns.choice || (isInteresting ? 'interessante' : 'pouco_interessante'),
    interestingProb: Number(interestingProb.toFixed(3)),
    muitoInteressanteProb: Number(pMuito.toFixed(3)),
    poucoInteressanteProb: Number(pPouco.toFixed(3)),
    isInteresting,
    rawImportanceScore: Number(rawImpScore.toFixed(3)),
    importanceScore,
    importanceLabel,
    classifiedAt: new Date().toISOString()
  };
}

/**
 * Provides deterministic fallback when Laya service is offline or pending.
 */
export function buildLayaFallback(article, status = 'pending', minInterestProb = 0.45) {
  const tvScore = Number(article?.tvScore ?? 45);
  const interestingProb = Number(Math.max(0.1, Math.min(0.95, tvScore / 100)).toFixed(3));
  const isInteresting = interestingProb >= minInterestProb;
  const importanceScore = Math.max(0, Math.min(100, Math.round(tvScore * 0.9)));
  return {
    source: 'fallback',
    status,
    interestingProb,
    isInteresting,
    importanceScore,
    importanceLabel: importanceLabelFromScore(importanceScore)
  };
}

/**
 * Builds Laya questions dynamically enriched with learned editor "Gostei" preferences.
 */
export function buildLayaQuestions(preferenceProfile = null) {
  if (!preferenceProfile || !preferenceProfile.totalLikes) {
    return LAYA_NEWSROOM_QUESTIONS;
  }

  const topics = [...(preferenceProfile.topKeywords || []).slice(0, 6)];
  const beats = [...(preferenceProfile.topCategories || []).slice(0, 2)];
  const hintParts = [...topics, ...beats].filter(Boolean);
  if (hintParts.length === 0) return LAYA_NEWSROOM_QUESTIONS;

  const topicList = hintParts.join(', ');
  const q = structuredClone(LAYA_NEWSROOM_QUESTIONS);
  q.interesse.instructions =
    'Classify how interesting this news article is for a local city TV news broadcast, prioritizing topics the editor liked.';
  q.interesse.criteria.muito_interessante = `${q.interesse.criteria.muito_interessante}, or editor-liked topics (${topicList})`;
  q.importancia.criteria[3] = `${q.importancia.criteria[3]}, or editor-preferred topics (${topicList})`;
  return q;
}

export function buildArticleStateText(article, preferenceProfile = null) {
  const title = String(article?.title || '').trim();
  const summary = String(article?.summary || '').trim().slice(0, 320);
  let text = summary ? `${title}. ${summary}` : title;

  if (preferenceProfile?.totalLikes > 0) {
    const match = evaluatePreferenceMatch(article, preferenceProfile);
    if (match.hasMatch) {
      text = `${text} [Preferência da redação: tema semelhante às pautas curtidas em ${match.reason}.]`;
    }
  }

  return text;
}

export async function checkLayaHealth(endpointUrl, apiKey = '', fetchImpl = fetch) {
  const base = String(endpointUrl || '').replace(/\/$/, '');
  if (!base) {
    return { online: false, error: 'URL do Laya não configurada.' };
  }
  const headers = {};
  if (apiKey?.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;

  try {
    const res = await fetchImpl(`${base}/health`, {
      headers,
      signal: AbortSignal.timeout(3000)
    });
    if (!res.ok) {
      return { online: false, error: `HTTP ${res.status}` };
    }
    const body = await res.json().catch(() => ({}));
    return {
      online: true,
      detail: body
    };
  } catch (err) {
    return { online: false, error: err.message };
  }
}

export async function classifyBatchWithLaya(
  articles,
  { endpointUrl, apiKey = '', minInterestProb = 0.45, maxLen = 192, batchSize = 8, preferenceProfile = null } = {},
  fetchImpl = fetch
) {
  if (!Array.isArray(articles) || articles.length === 0) return [];
  const base = String(endpointUrl || '').replace(/\/$/, '');
  if (!base) throw new Error('URL do serviço Laya não configurada.');

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey?.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;

  const states = articles.map((art) => buildArticleStateText(art, preferenceProfile));
  const questions = buildLayaQuestions(preferenceProfile);
  const res = await fetchImpl(`${base}/v1/systemone/batch`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'multilingual',
      max_len: maxLen,
      batch_size: batchSize,
      sort_by_length: true,
      states,
      questions
    }),
    signal: AbortSignal.timeout(120000)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Laya HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const rawResults = Array.isArray(data?.results) ? data.results : [];
  return articles.map((art, idx) => ({
    canonicalUrl: art.canonicalUrl,
    laya: interpretLayaPrediction(rawResults[idx], minInterestProb)
  }));
}
