/**
 * Default news portals, national news agency, and local blogs for Natal/RN.
 * Each source supports either WP-JSON REST API (with RSS fallback) or RSS/Atom XML.
 */
export const DEFAULT_SOURCES = [
  {
    id: 'tribuna-natal',
    name: 'Tribuna do Norte (Natal)',
    shortName: 'Tribuna',
    category: 'portal',
    type: 'wp-json',
    url: 'https://tribunadonorte.com.br/wp-json/wp/v2/posts?categories=10&per_page=25&_embed=wp:featuredmedia',
    fallbackUrl: 'https://tribunadonorte.com.br/feed/',
    siteUrl: 'https://tribunadonorte.com.br/natal/',
    badgeColor: '#004b8d',
    enabled: true,
    builtin: true,
    geoHint: 'natal'
  },
  {
    id: 'tribuna-geral',
    name: 'Tribuna do Norte (Geral/RN)',
    shortName: 'Tribuna RN',
    category: 'portal',
    type: 'wp-json',
    url: 'https://tribunadonorte.com.br/wp-json/wp/v2/posts?per_page=25&_embed=wp:featuredmedia',
    fallbackUrl: 'https://tribunadonorte.com.br/feed/',
    siteUrl: 'https://tribunadonorte.com.br/',
    badgeColor: '#0369a1',
    enabled: true,
    builtin: true,
    geoHint: 'rn'
  },
  {
    id: 'g1-rn',
    name: 'G1 RN',
    shortName: 'G1 RN',
    category: 'portal',
    type: 'rss',
    url: 'https://g1.globo.com/rss/g1/rn/rio-grande-do-norte/',
    siteUrl: 'https://g1.globo.com/rn/rio-grande-do-norte/',
    badgeColor: '#c4170c',
    enabled: true,
    builtin: true,
    geoHint: 'rn'
  },
  {
    id: 'novo-noticias',
    name: 'NOVO Notícias',
    shortName: 'NOVO',
    category: 'portal',
    type: 'wp-json',
    url: 'https://novonoticias.com.br/wp-json/wp/v2/posts?per_page=25&_embed=wp:featuredmedia',
    fallbackUrl: 'https://novonoticias.com.br/feed/',
    siteUrl: 'https://novonoticias.com.br/',
    badgeColor: '#d97706',
    enabled: true,
    builtin: true,
    geoHint: 'rn'
  },
  {
    id: 'ponta-negra-news',
    name: 'Ponta Negra News',
    shortName: 'Ponta Negra',
    category: 'portal',
    type: 'wp-json',
    url: 'https://pontanegranews.com.br/wp-json/wp/v2/posts?per_page=25&_embed=wp:featuredmedia',
    fallbackUrl: 'https://pontanegranews.com.br/feed/',
    siteUrl: 'https://pontanegranews.com.br/',
    badgeColor: '#1d4ed8',
    enabled: true,
    builtin: true,
    geoHint: 'rn'
  },
  {
    id: 'agora-rn',
    name: 'Agora RN',
    shortName: 'Agora RN',
    category: 'portal',
    type: 'wp-json',
    url: 'https://agorarn.com.br/wp-json/wp/v2/posts?per_page=25&_embed=wp:featuredmedia',
    fallbackUrl: 'https://agorarn.com.br/feed/',
    siteUrl: 'https://agorarn.com.br/',
    badgeColor: '#7c3aed',
    enabled: true,
    builtin: true,
    geoHint: 'rn'
  },
  {
    id: 'agencia-brasil-ultimas',
    name: 'Agência Brasil (Últimas)',
    shortName: 'Ag. Brasil',
    category: 'agencia',
    type: 'rss',
    url: 'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml',
    siteUrl: 'https://agenciabrasil.ebc.com.br/',
    badgeColor: '#15803d',
    enabled: true,
    builtin: true,
    geoHint: 'national'
  },
  {
    id: 'agencia-brasil-geral',
    name: 'Agência Brasil (Geral)',
    shortName: 'Ag. Brasil Geral',
    category: 'agencia',
    type: 'rss',
    url: 'https://agenciabrasil.ebc.com.br/rss/geral/feed.xml',
    siteUrl: 'https://agenciabrasil.ebc.com.br/geral',
    badgeColor: '#166534',
    enabled: true,
    builtin: true,
    geoHint: 'national'
  },
  {
    id: 'blog-do-bg',
    name: 'Blog do BG',
    shortName: 'Blog do BG',
    category: 'blog',
    type: 'wp-json',
    url: 'https://blogdobg.com.br/wp-json/wp/v2/posts?per_page=25&_embed=wp:featuredmedia',
    fallbackUrl: 'https://blogdobg.com.br/feed/',
    siteUrl: 'https://blogdobg.com.br/',
    badgeColor: '#0f766e',
    enabled: true,
    builtin: true,
    geoHint: 'rn'
  },
  {
    id: 'gustavo-negreiros',
    name: 'Blog Gustavo Negreiros',
    shortName: 'G. Negreiros',
    category: 'blog',
    type: 'rss',
    url: 'https://gustavonegreiros.com.br/feed/',
    siteUrl: 'https://gustavonegreiros.com.br/',
    badgeColor: '#475569',
    enabled: true,
    builtin: true,
    geoHint: 'rn'
  },
  {
    id: 'saulo-vale',
    name: 'Blog do Saulo Vale',
    shortName: 'Saulo Vale',
    category: 'blog',
    type: 'rss',
    url: 'https://saulovale.com.br/feed/',
    siteUrl: 'https://saulovale.com.br/',
    badgeColor: '#334155',
    enabled: true,
    builtin: true,
    geoHint: 'rn'
  },
  {
    id: '98fm-natal',
    name: '98 FM Natal',
    shortName: '98 FM Natal',
    category: 'blog',
    type: 'wp-json',
    url: 'https://98fmnatal.com.br/wp-json/wp/v2/posts?per_page=20&_embed=wp:featuredmedia',
    fallbackUrl: 'https://98fmnatal.com.br/feed/',
    siteUrl: 'https://98fmnatal.com.br/',
    badgeColor: '#ea580c',
    enabled: true,
    builtin: true,
    geoHint: 'natal'
  },
  {
    id: '96fm-natal',
    name: '96 FM Natal',
    shortName: '96 FM Natal',
    category: 'blog',
    type: 'rss',
    url: 'https://www.96fm.com.br/feed/',
    siteUrl: 'https://www.96fm.com.br/',
    badgeColor: '#b45309',
    enabled: true,
    builtin: true,
    geoHint: 'rn'
  },
  {
    id: 'o-poti',
    name: 'O Poti News',
    shortName: 'O Poti',
    category: 'blog',
    type: 'rss',
    url: 'https://opoti.com.br/feed/',
    siteUrl: 'https://opoti.com.br/',
    badgeColor: '#4338ca',
    enabled: true,
    builtin: true,
    geoHint: 'rn'
  },
  {
    id: 'diario-do-rn',
    name: 'Diário do RN',
    shortName: 'Diário RN',
    category: 'blog',
    type: 'rss',
    url: 'https://diariodorn.com.br/feed/',
    siteUrl: 'https://diariodorn.com.br/',
    badgeColor: '#be123c',
    enabled: true,
    builtin: true,
    geoHint: 'rn'
  }
];

export const DEFAULT_SETTINGS = {
  telegram: {
    botToken: '',
    chatId: '',
    includeSummary: true,
    includeTvSuggestion: true,
    includeScore: false,
    includeLayaImportance: true,
    includeLink: true,
    autoSendEnabled: false,
    autoSendMinScore: 72,
    autoSendMaxPerRun: 5
  },
  editorial: {
    cityFilterMode: 'natal_strict', // 'natal_strict' | 'grande_natal' | 'rn_all'
    prefeituraFilterLevel: 'strict', // 'strict' | 'moderate' | 'off'
    blockCrimeViolence: true,
    minTvScore: 30,
    customBlockedTerms: [],
    refreshIntervalMinutes: 15
  },
  laya: {
    enabled: true,
    endpointUrl: process.env.LAYA_ENDPOINT_URL || 'http://127.0.0.1:8001',
    apiKey: process.env.LAYA_API_KEY || '',
    minInterestProb: 0.45,
    filterLowInterest: false,
    autoStartLocalService: process.env.LAYA_AUTO_START !== 'false'
  },
  display: {
    searchQuery: '',
    beatFilter: 'all',
    interestFilter: 'all',
    sortBy: 'recent',
    sourceFilter: 'all'
  }
};
