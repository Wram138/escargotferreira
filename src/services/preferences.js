import { normalizeText } from './classifier.js';

const PREF_STOPWORDS = new Set([
  'a', 'o', 'as', 'os', 'de', 'da', 'do', 'das', 'dos', 'em', 'na', 'no', 'nas', 'nos',
  'para', 'por', 'com', 'sem', 'e', 'ou', 'que', 'se', 'um', 'uma', 'uns', 'umas',
  'ao', 'aos', 'sobre', 'apos', 'entre', 'ate', 'como', 'mais', 'menos', 'muito', 'muita',
  'muitos', 'muitas', 'pela', 'pelo', 'pelas', 'pelos', 'esse', 'essa', 'este', 'esta',
  'isso', 'isto', 'sao', 'era', 'foi', 'ser', 'vai', 'vao', 'tem', 'ter', 'pode', 'podem',
  'diz', 'afirma', 'conta', 'segundo', 'veja', 'confira', 'saiba', 'hoje', 'ontem', 'amanha',
  'nesta', 'neste', 'nesse', 'nessa', 'dia', 'semana', 'mes', 'ano', 'anos',
  'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo', 'feira',
  'natal', 'rn', 'rio', 'grande', 'norte', 'estado', 'cidade', 'capital', 'municipio',
  'municipios', 'potiguar', 'potiguares', 'brasil', 'brasileiro', 'governo', 'prefeitura',
  'noticia', 'noticias', 'materia', 'materias', 'novo', 'nova', 'novos', 'novas',
  'maior', 'menor', 'primeiro', 'primeira', 'mil', 'milhoes'
]);

const GENERIC_LOCATIONS = new Set(['natal', 'natal/rn', 'grande natal', 'rn', 'rio grande do norte']);

function tokenizeNormalized(text) {
  return normalizeText(text)
    .split(/[^a-z0-9]+/)
    .filter((tok) => tok.length >= 3 && !/^\d+$/.test(tok) && !PREF_STOPWORDS.has(tok));
}

/**
 * Extracts normalized topical keywords from an article's title and summary.
 */
export function extractArticleKeywords(article = {}) {
  const titleTokens = [...new Set(tokenizeNormalized(article.title || ''))];
  const summaryTokens = [...new Set(tokenizeNormalized(article.summary || ''))];

  const weights = new Map();
  for (const tok of titleTokens) {
    weights.set(tok, (weights.get(tok) || 0) + 2);
  }
  for (const tok of summaryTokens) {
    weights.set(tok, (weights.get(tok) || 0) + 1);
  }

  const allKeywords = [...weights.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tok]) => tok);

  return {
    titleKeywords: titleTokens,
    summaryKeywords: summaryTokens,
    allKeywords,
    weights
  };
}

/**
 * Creates a compact persisted snapshot for a user-liked ("Gostei") article.
 */
export function buildLikedArticleSnapshot(article = {}) {
  const extracted = extractArticleKeywords(article);
  return {
    canonicalUrl: article.canonicalUrl,
    title: String(article.title || '').trim(),
    summary: String(article.summary || '').trim().slice(0, 320),
    tvCategory: article.tvCategory || 'Geral Natal',
    sourceId: article.sourceId || '',
    sourceName: article.sourceName || '',
    matchedLocations: Array.isArray(article.geo?.matchedLocations)
      ? article.geo.matchedLocations.slice(0, 6)
      : [],
    keywords: extracted.allKeywords.slice(0, 14),
    likedAt: new Date().toISOString()
  };
}

/**
 * Aggregates user likes into an editorial preference profile used by Laya and local scoring.
 */
export function buildPreferenceProfile(likedArticles = []) {
  const likes = Array.isArray(likedArticles) ? likedArticles : [];
  if (likes.length === 0) {
    return {
      totalLikes: 0,
      topKeywords: [],
      keywordWeights: {},
      topCategories: [],
      categoryWeights: {},
      topLocations: [],
      locationWeights: {},
      topSources: [],
      sourceWeights: {},
      signature: '0:'
    };
  }

  const keywordScores = new Map();
  const categoryScores = new Map();
  const locationScores = new Map();
  const sourceScores = new Map();

  for (const item of likes) {
    const titleWords = new Set(tokenizeNormalized(item.title || ''));
    const savedWords = Array.isArray(item.keywords) && item.keywords.length > 0
      ? item.keywords
      : extractArticleKeywords(item).allKeywords;

    for (const kw of savedWords) {
      const weight = titleWords.has(kw) ? 2 : 1;
      keywordScores.set(kw, (keywordScores.get(kw) || 0) + weight);
    }

    const cat = String(item.tvCategory || '').trim();
    if (cat && cat !== 'Geral Natal') {
      categoryScores.set(cat, (categoryScores.get(cat) || 0) + 1.5);
    }

    for (const loc of item.matchedLocations || []) {
      const locNorm = normalizeText(loc);
      if (locNorm && !GENERIC_LOCATIONS.has(locNorm)) {
        locationScores.set(locNorm, (locationScores.get(locNorm) || 0) + 1.5);
      }
    }

    if (item.sourceId) {
      sourceScores.set(item.sourceId, (sourceScores.get(item.sourceId) || 0) + 1);
    }
  }

  const topEntries = (map, limit) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);

  const topKeywords = topEntries(keywordScores, 12).map(([k]) => k);
  const topCategories = topEntries(categoryScores, 3).map(([k]) => k);
  const topLocations = topEntries(locationScores, 5).map(([k]) => k);
  const topSources = topEntries(sourceScores, 5).map(([k]) => k);

  return {
    totalLikes: likes.length,
    topKeywords,
    keywordWeights: Object.fromEntries(keywordScores),
    topCategories,
    categoryWeights: Object.fromEntries(categoryScores),
    topLocations,
    locationWeights: Object.fromEntries(locationScores),
    topSources,
    sourceWeights: Object.fromEntries(sourceScores),
    signature: `${likes.length}:${topKeywords.slice(0, 6).join(',')}`
  };
}

/**
 * Computes affinity between a candidate article and the user's liked preference profile.
 */
export function evaluatePreferenceMatch(article = {}, profile = null) {
  if (!profile || !profile.totalLikes) {
    return {
      hasMatch: false,
      score: 0,
      tvBoost: 0,
      interestBoost: 0,
      importanceBoost: 0,
      matchedKeywords: [],
      matchedCategory: null,
      matchedLocations: [],
      reason: ''
    };
  }

  const extracted = extractArticleKeywords(article);
  const titleSet = new Set(extracted.titleKeywords);
  const kwWeights = profile.keywordWeights || {};

  let kwScore = 0;
  const matchedKeywords = [];
  for (const kw of extracted.allKeywords) {
    const profWeight = kwWeights[kw];
    if (!profWeight) continue;
    matchedKeywords.push(kw);
    const freqBoost = Math.min(2, profWeight / 2);
    kwScore += (titleSet.has(kw) ? 4 : 2) * freqBoost;
  }
  kwScore = Math.min(14, kwScore);

  const cat = String(article.tvCategory || '').trim();
  const matchedCategory = cat && cat !== 'Geral Natal' && profile.categoryWeights?.[cat] ? cat : null;
  const catScore = matchedCategory ? Math.min(6, 3.5 + profile.categoryWeights[cat]) : 0;

  const matchedLocations = [];
  for (const loc of article.geo?.matchedLocations || []) {
    const locNorm = normalizeText(loc);
    if (locNorm && profile.locationWeights?.[locNorm]) {
      matchedLocations.push(loc);
    }
  }
  const locScore = Math.min(6, matchedLocations.length * 3);

  const baseScore = kwScore + catScore + locScore;
  const srcScore = baseScore > 0 && article.sourceId && profile.sourceWeights?.[article.sourceId] ? 2 : 0;
  const totalScore = Math.min(25, Math.round(baseScore + srcScore));

  // Ignore weak isolated summary overlap without title/category/location signal
  if (totalScore < 4) {
    return {
      hasMatch: false,
      score: 0,
      tvBoost: 0,
      interestBoost: 0,
      importanceBoost: 0,
      matchedKeywords: [],
      matchedCategory: null,
      matchedLocations: [],
      reason: ''
    };
  }

  const tvBoost = Math.min(18, Math.round(totalScore * 0.72));
  const importanceBoost = Math.min(14, Math.round(totalScore * 0.56));
  const interestBoost = Number(Math.min(0.18, totalScore * 0.0075).toFixed(3));

  const reasonParts = [];
  if (matchedKeywords.length > 0) reasonParts.push(matchedKeywords.slice(0, 3).join(', '));
  if (matchedCategory) reasonParts.push(matchedCategory);
  if (matchedLocations.length > 0) reasonParts.push(matchedLocations.slice(0, 2).join(', '));

  return {
    hasMatch: true,
    score: totalScore,
    tvBoost,
    interestBoost,
    importanceBoost,
    matchedKeywords: matchedKeywords.slice(0, 5),
    matchedCategory,
    matchedLocations: matchedLocations.slice(0, 3),
    reason: reasonParts.join(' • ')
  };
}
