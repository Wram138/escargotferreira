/**
 * Editorial classification engine for Natal/RN TV newsroom aggregation.
 *
 * Responsibilities:
 *  1. Geo-relevance: distinguish Natal/RN stories from national news, other RN cities,
 *     and Portuguese "Natal" (Christmas) false positives.
 *  2. Institutional protection: detect and filter out news criticizing or casting
 *     negative light on Prefeitura do Natal and municipal agencies.
 *  3. TV newsroom potential: score visual/service/public-interest potential (0-100),
 *     assign an editorial beat (editoria), and generate a practical TV production angle.
 */

export function normalizeText(str = '') {
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function hasTerm(normText, term) {
  if (!normText || !term) return false;
  const escaped = escapeRegex(normalizeText(term));
  const re = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i');
  return re.test(normText);
}

function findMatchedTerms(normText, terms) {
  const hits = [];
  for (const term of terms) {
    if (hasTerm(normText, term)) hits.push(term);
  }
  return hits;
}

// Christmas phrases where "natal" does NOT refer to Natal/RN
const CHRISTMAS_PHRASES = [
  'papai noel',
  'arvore de natal',
  'ceia de natal',
  'compras de natal',
  'presente de natal',
  'presentes de natal',
  'vendas de natal',
  'comercio de natal',
  'feriado de natal',
  'vespera de natal',
  'especial de natal',
  'magia do natal',
  'clima de natal',
  'festa de natal',
  'festas de natal',
  'noite de natal',
  'dia de natal',
  'mensagem de natal',
  'natal de jesus',
  'feliz natal',
  'natalino',
  'natalina',
  'natalinos',
  'natalinas',
  'pre-natal',
  'pos-natal',
  'natal premiado',
  'campanha de natal',
  'natal solidario',
  'natal dos correios'
];

// Explicit city phrases that stay intact even if near holiday words
const EXPLICIT_NATAL_CITY_PHRASES = [
  'natal/rn',
  'natal (rn)',
  'natal-rn',
  'natal, rn',
  'prefeitura do natal',
  'prefeitura de natal',
  'prefeito do natal',
  'prefeito de natal',
  'camara municipal de natal',
  'camara municipal do natal',
  'cidade do natal',
  'municipio do natal',
  'municipio de natal',
  'capital potiguar',
  'capital do rn',
  'capital norte-rio-grandense',
  'natalense',
  'natalenses',
  'natal em natal',
  'em natal',
  'para natal',
  'por natal',
  'bairros de natal',
  'ruas de natal',
  'praias de natal',
  'orla de natal',
  'centro de natal',
  'moradores de natal',
  'transito de natal',
  'transito em natal',
  'zona norte de natal',
  'zona sul de natal',
  'zona leste de natal',
  'zona oeste de natal'
];

const GRANDE_NATAL_PHRASES = [
  'grande natal',
  'regiao metropolitana de natal',
  'rmn'
];

const GRANDE_NATAL_CITIES = [
  'parnamirim',
  'sao goncalo do amarante',
  'macaiba',
  'extremoz',
  'sao jose de mipibu',
  'nisia floresta',
  'ceara-mirim',
  'vera cruz',
  'monte alegre'
];

const NATAL_NEIGHBORHOODS_AND_LANDMARKS = [
  'ponta negra',
  'alecrim',
  'tirol',
  'petropolis',
  'ribeira',
  'cidade alta',
  'rocas',
  'candelaria',
  'capim macio',
  'lagoa nova',
  'neopolis',
  'pitimbu',
  'nova descoberta',
  'potengi',
  'igapo',
  'redinha',
  'pajucara',
  'lagoa azul',
  'nossa senhora da apresentacao',
  'felipe camarao',
  'planalto',
  'guarapes',
  'mae luiza',
  'praia do meio',
  'areia preta',
  'praia dos artistas',
  'praia de miami',
  'via costeira',
  'cidade da esperanca',
  'dix-sept rosado',
  'nossa senhora de nazare',
  'quintas',
  'bom pastor',
  'santos reis',
  'barro vermelho',
  'lagoa seca',
  'cidade nova',
  'ponte newton navarro',
  'ponte de igapo',
  'morro do careca',
  'parque das dunas',
  'bosque dos namorados',
  'arena das dunas',
  'midway mall',
  'praia shopping',
  'natal shopping',
  'partage norte shopping',
  'ufrn',
  'ifrn natal',
  'walfredo gurgel',
  'giselda trigueiro',
  'varela santiago',
  'januario cicco',
  'hemonorte',
  'hospital dos pescadores',
  'hospital santa catarina',
  'sttu',
  'semsur',
  'semurb',
  'semtas',
  'semdes',
  'natalprev',
  'funcarte',
  'procon natal',
  'teatro alberto maranhao',
  'forte dos reis magos',
  'memorial camara cascudo',
  'beco da lama',
  'roberto freire',
  'bernardo vieira',
  'hermes da fonseca',
  'prudente de morais',
  'salgado filho',
  'joao medeiros filho',
  'tomaz landim',
  'felizardo moura',
  'rota do sol',
  'engorda de ponta negra',
  'mercado da redinha',
  'paulinho freire'
];

const RN_STATE_SIGNALS = [
  'rio grande do norte',
  'potiguar',
  'potiguares',
  'rn',
  'governo do rn',
  'cosern',
  'neoenergia cosern',
  'caern',
  'detran-rn',
  'detran rn',
  'mprn',
  'tjrn',
  'alrn',
  'sesap',
  'idema',
  'cbmrn',
  'pmrn',
  'pcrn'
];

const OTHER_RN_CITIES = [
  'mossoro',
  'caico',
  'pau dos ferros',
  'assu',
  'currais novos',
  'macau',
  'maxaranguape',
  'sao miguel do gostoso',
  'tibau do sul',
  'pipa',
  'santa cruz',
  'apodi',
  'joao camara',
  'touros',
  'nova cruz',
  'martins',
  'caraubas',
  'parelhas',
  'acari',
  'alexandria',
  'areia branca',
  'barauna',
  'canguaretama',
  'goianinha',
  'pendencias',
  'uern',
  'ufersa'
];

const OTHER_STATES_OR_ABROAD = [
  'sao paulo',
  'rio de janeiro',
  'belo horizonte',
  'recife',
  'fortaleza',
  'joao pessoa',
  'salvador',
  'maceio',
  'aracaju',
  'teresina',
  'sao luis',
  'brasilia',
  'curitiba',
  'porto alegre',
  'manaus',
  'belem',
  'goiania',
  'florianopolis',
  'campinas',
  'distrito federal',
  'pernambuco',
  'ceara',
  'paraiba',
  'bahia',
  'minas gerais',
  'estados unidos',
  'peru',
  'argentina',
  'europa',
  'ucrania',
  'gaza'
];

/**
 * Strips Christmas uses of "natal" so bare "natal" only scores when it
 * plausibly means the city of Natal/RN.
 */
function stripChristmasUses(normText) {
  let masked = normText;
  for (const phrase of CHRISTMAS_PHRASES) {
    // Do not mask if literally "natal em natal" or "prefeitura do natal"
    if (phrase === 'comercio de natal') continue;
    const escaped = escapeRegex(normalizeText(phrase));
    masked = masked.replace(new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'g'), ' xmas_holiday ');
  }
  // Mask "no natal" when preceded by holiday verbs (e.g., "viajar no Natal", "presentear no Natal")
  masked = masked.replace(
    /\b(viajar|viagem|passar|passam|comemorar|celebrar|presentear|vender|vendas|compras|feriado|ceia)\s+no\s+natal\b/g,
    '$1 no xmas_holiday'
  );
  return masked;
}

/**
 * Determines whether an article is relevant to Natal/RN (or Grande Natal).
 */
export function evaluateNatalRelevance(article, cityFilterMode = 'natal_strict') {
  const titleNorm = normalizeText(article.title || '');
  const summaryNorm = normalizeText(article.summary || '');
  const contentNorm = normalizeText(article.content || '').slice(0, 2400);
  const catsNorm = normalizeText((article.categories || []).join(' '));
  const fullNorm = `${titleNorm} ${summaryNorm} ${contentNorm}`;

  const maskedTitle = stripChristmasUses(titleNorm);
  const maskedFull = stripChristmasUses(fullNorm);

  const explicitCityHits = findMatchedTerms(fullNorm, EXPLICIT_NATAL_CITY_PHRASES);
  const neighborhoodHits = findMatchedTerms(fullNorm, NATAL_NEIGHBORHOODS_AND_LANDMARKS);
  const grandeNatalHits = findMatchedTerms(fullNorm, GRANDE_NATAL_PHRASES);
  const grandeNatalCityHits = findMatchedTerms(fullNorm, GRANDE_NATAL_CITIES);
  const rnStateHits = findMatchedTerms(fullNorm, RN_STATE_SIGNALS);
  const otherRnHits = findMatchedTerms(titleNorm + ' ' + summaryNorm, OTHER_RN_CITIES);
  const externalPlaceHits = findMatchedTerms(titleNorm + ' ' + summaryNorm, OTHER_STATES_OR_ABROAD);

  const bareNatalInTitle = hasTerm(maskedTitle, 'natal');
  const bareNatalInFull = hasTerm(maskedFull, 'natal');
  const isTribunaNatalCategory = article.sourceId === 'tribuna-natal' || article.geoHint === 'natal';
  const isLocalRnSource = article.sourceCategory !== 'agencia' && article.geoHint !== 'national';

  // Detect "comercio de natal" ambiguity: only count as city if RN/local context exists
  const hasComercioDeNatal = hasTerm(fullNorm, 'comercio de natal');
  const hasRnContext = rnStateHits.length > 0 || explicitCityHits.length > 0 || neighborhoodHits.length > 0 || isLocalRnSource;

  let geoScore = 0;
  const matchedLocations = [...new Set([...explicitCityHits, ...neighborhoodHits, ...grandeNatalHits])];

  if (explicitCityHits.length > 0) geoScore += 55;
  if (neighborhoodHits.length > 0) geoScore += Math.min(65, 35 + (neighborhoodHits.length - 1) * 15);
  if (grandeNatalHits.length > 0) geoScore += 35;

  if (bareNatalInTitle && (!hasComercioDeNatal || hasRnContext)) {
    // Require RN context if national agency
    if (isLocalRnSource || rnStateHits.length > 0 || explicitCityHits.length > 0 || neighborhoodHits.length > 0) {
      geoScore += 35;
      if (!matchedLocations.includes('natal')) matchedLocations.push('Natal');
    }
  } else if (bareNatalInFull && (isLocalRnSource || rnStateHits.length > 0)) {
    geoScore += 20;
    if (!matchedLocations.includes('natal')) matchedLocations.push('Natal');
  }

  // Tribuna's dedicated Natal category gives a baseline unless headline explicitly targets another city
  if (isTribunaNatalCategory && otherRnHits.length === 0 && externalPlaceHits.length === 0) {
    geoScore += 25;
  }

  // Grande Natal cities (Parnamirim, São Gonçalo, Macaíba, Extremoz...)
  const isGrandeNatalCityOnly =
    grandeNatalCityHits.length > 0 &&
    explicitCityHits.length === 0 &&
    neighborhoodHits.length === 0 &&
    !bareNatalInTitle &&
    grandeNatalHits.length === 0;

  if (grandeNatalCityHits.length > 0) {
    if (cityFilterMode === 'grande_natal') {
      geoScore += 30;
      matchedLocations.push(...grandeNatalCityHits);
    } else if (cityFilterMode === 'natal_strict' && isGrandeNatalCityOnly) {
      geoScore -= 30;
    }
  }

  // Other interior RN cities or external states without direct Natal city anchor
  const hasDirectNatalAnchor =
    explicitCityHits.length > 0 ||
    neighborhoodHits.length > 0 ||
    grandeNatalHits.length > 0 ||
    bareNatalInTitle;

  if (otherRnHits.length > 0 && !hasDirectNatalAnchor) {
    geoScore -= 45;
  }
  if (externalPlaceHits.length > 0 && !hasDirectNatalAnchor) {
    geoScore -= 50;
  }

  // National agency must have strong RN+Natal signal (not just bare "natal")
  if (article.geoHint === 'national') {
    const strongAgenciaNatal =
      explicitCityHits.length > 0 ||
      neighborhoodHits.length > 0 ||
      grandeNatalHits.length > 0 ||
      (bareNatalInFull && rnStateHits.length > 0);
    if (!strongAgenciaNatal) {
      geoScore = Math.min(geoScore, 10);
    }
  }

  // RN statewide stories (e.g., "Hotéis do RN devem registrar 81% de ocupação", "RN lidera turismo",
  // "Apagão na Grande Natal"): include if rn_all mode, or if strong Natal capital impact
  const isRnStatewideImpact =
    rnStateHits.length > 0 &&
    otherRnHits.length === 0 &&
    externalPlaceHits.length === 0 &&
    (hasTerm(fullNorm, 'hoteis') ||
      hasTerm(fullNorm, 'turismo') ||
      hasTerm(fullNorm, 'estado') ||
      hasTerm(fullNorm, 'capital') ||
      hasTerm(fullNorm, 'regiao metropolitana') ||
      hasTerm(fullNorm, 'natal'));

  if (isRnStatewideImpact && isLocalRnSource && bareNatalInFull) {
    geoScore += 15;
  }

  let isNatal = false;
  if (cityFilterMode === 'rn_all') {
    isNatal = geoScore >= 20 || (isLocalRnSource && rnStateHits.length > 0 && externalPlaceHits.length === 0);
  } else if (cityFilterMode === 'grande_natal') {
    isNatal = geoScore >= 25;
  } else {
    // natal_strict
    isNatal = geoScore >= 30;
  }

  // Guard: if headline explicitly targets another city (e.g. "em Mossoró", "em Maxaranguape", "no Peru")
  // and does not mention Natal in title or lead summary, keep strict mode clean
  if (
    cityFilterMode === 'natal_strict' &&
    (otherRnHits.length > 0 || externalPlaceHits.length > 0 || isGrandeNatalCityOnly) &&
    !bareNatalInTitle &&
    explicitCityHits.length === 0 &&
    neighborhoodHits.length === 0 &&
    grandeNatalHits.length === 0
  ) {
    isNatal = false;
  }

  let geoReason = 'Sem vínculo direto com Natal/RN';
  if (isNatal) {
    geoReason =
      matchedLocations.length > 0
        ? `Localidades em Natal/RN: ${matchedLocations.slice(0, 4).join(', ')}`
        : 'Editoria/pauta da capital Natal/RN';
  } else if (isGrandeNatalCityOnly) {
    geoReason = `Região Metropolitana (${grandeNatalCityHits.join(', ')}) — fora do filtro estrito de Natal`;
  } else if (otherRnHits.length > 0) {
    geoReason = `Outro município do RN (${otherRnHits.join(', ')})`;
  } else if (externalPlaceHits.length > 0) {
    geoReason = `Cobertura nacional/externa (${externalPlaceHits.slice(0, 2).join(', ')})`;
  } else if (hasTerm(fullNorm, 'natal') && !hasTerm(maskedFull, 'natal')) {
    geoReason = 'Menção a "Natal" em contexto natalino/festivo, não da cidade';
  }

  return {
    isNatal,
    isGrandeNatal: grandeNatalHits.length > 0 || grandeNatalCityHits.length > 0,
    geoScore: Math.max(0, Math.min(100, geoScore)),
    matchedLocations: [...new Set(matchedLocations)],
    geoReason,
    catsNorm
  };
}

// --- Institutional Filter: Avoid articles criticizing Prefeitura do Natal ---

const NATAL_PREFEITURA_TARGETS = [
  'prefeitura do natal',
  'prefeitura de natal',
  'prefeitura da capital',
  'prefeito do natal',
  'prefeito de natal',
  'paulinho freire',
  'gestao paulinho',
  'gestao municipal',
  'administracao municipal',
  'executivo municipal',
  'municipio do natal',
  'paco da patria',
  'sttu',
  'urbana',
  'semsur',
  'semurb',
  'semtas',
  'semdes',
  'sms natal',
  'sme natal',
  'natalprev',
  'funcarte',
  'arsban',
  'procon natal',
  'guarda municipal de natal',
  'rede municipal de ensino',
  'rede municipal de saude',
  'upa pajucara',
  'upa cidade da esperanca',
  'upa potengi',
  'upa esperanca',
  'engorda de ponta negra'
];

const GENERIC_MUNICIPAL_TARGETS = [
  'prefeitura',
  'prefeito',
  'prefeita',
  'secretaria municipal',
  'secretario municipal',
  'guarda municipal',
  'escola municipal',
  'cmei',
  'ubs',
  'upa'
];

const OTHER_CITY_PREFEITURA_RE =
  /\bprefeit[ao]\s+d[eao]\s+(?!natal\b|capital\b)[a-z]+|\bprefeitura\s+d[eao]\s+(?!natal\b|capital\b)[a-z]+/i;

const HIGH_SEVERITY_CRITICISM = [
  'denuncia',
  'denunciam',
  'denunciado',
  'denunciada',
  'critica',
  'criticam',
  'criticas',
  'criticado',
  'criticada',
  'alvo de',
  'investigacao',
  'investigado',
  'investigada',
  'investiga',
  'inquerito',
  'improbidade',
  'desvio',
  'superfaturamento',
  'fraude',
  'corrupcao',
  'propina',
  'calote',
  'rombo',
  'irregularidade',
  'irregularidades',
  'reprovacao',
  'reprova',
  'reprovado',
  'reprovada',
  'condena',
  'condenado',
  'condenada',
  'mprn cobra',
  'mp cobra',
  'mp investiga',
  'mprn investiga',
  'tce aponta',
  'tce suspende',
  'tce barra',
  'acao civil publica',
  'justica condena',
  'justica obriga',
  'justica suspende',
  'embargo',
  'embargada',
  'escandalo',
  'caos',
  'colapso',
  'abandono',
  'abandonado',
  'abandonada',
  'descaso',
  'omissao',
  'ineficiencia',
  'sucateamento',
  'sucateado',
  'sucateada',
  'pior avaliacao',
  'desaprovacao',
  'desaprova',
  'rejeicao',
  'veto derrubado',
  'derrota da prefeitura',
  'derrota do prefeito',
  'crise na gestao',
  'gastos excessivos',
  'farra'
];

const MODERATE_COMPLAINT_TERMS = [
  'protesto',
  'protestam',
  'manifestacao',
  'manifestantes',
  'greve',
  'paralisacao',
  'reclamacao',
  'reclamam',
  'revolta',
  'revoltados',
  'indignacao',
  'moradores cobram',
  'populacao cobra',
  'usuarios cobram',
  'sindicato cobra',
  'mp cobra',
  'mprn cobra',
  'camara cobra',
  'vereadores cobram',
  'cobram da prefeitura',
  'cobra da prefeitura',
  'cobra a prefeitura',
  'atraso salarial',
  'salarios atrasados',
  'atraso no pagamento',
  'sem pagamento',
  'falta de medico',
  'faltam medicos',
  'falta medico',
  'falta de medicamento',
  'falta remedio',
  'sem medicamento',
  'falta de merenda',
  'sem merenda',
  'sem coleta',
  'lixo acumulado',
  'lixo nas ruas',
  'buraqueira',
  'esburacada',
  'esburacado',
  'sem iluminacao',
  'poste apagado',
  'escuridao',
  'nao cumpre',
  'descumpre',
  'descumprimento',
  'demora no atendimento',
  'superlotacao',
  'superlotada',
  'teto desaba',
  'teto cai',
  'desabamento',
  'precariedade',
  'precario',
  'precaria',
  'insatisfacao',
  'problema na engorda',
  'erosao na engorda',
  'falha na engorda',
  'sem manutencao',
  'falta de manutencao',
  'falta de estrutura',
  'sem resposta'
];

// Implicit complaints about Natal municipal public services even when "Prefeitura" isn't named
const IMPLICIT_MUNICIPAL_COMPLAINT_PHRASES = [
  'lixo acumulado',
  'sem coleta de lixo',
  'buraqueira',
  'rua esburacada',
  'avenida esburacada',
  'sem iluminacao publica',
  'falta de medico na ubs',
  'falta de medico na upa',
  'ubs sem medico',
  'upa sem medico',
  'escola municipal sem merenda',
  'onibus sucateado',
  'frota sucateada',
  'falta de drenagem',
  'erosao na engorda',
  'falha na engorda'
];

const MITIGATING_ACTION_RE =
  /\b(combate|combater|contra|evita|evitar|prevencao|previne|prevenir|mutirao|reduz|reducao|apreende|flagra|multa|autua)\s+(a|o|as|os|ao|na|no|de)?\s*$/;

/**
 * Checks whether an article criticizes or casts negative light on Prefeitura do Natal.
 */
export function evaluatePrefeituraFilter(
  article,
  { level = 'strict', customBlockedTerms = [], isNatal = false } = {}
) {
  if (level === 'off') {
    return {
      blocked: false,
      severity: 'none',
      reason: '',
      matchedTargets: [],
      matchedNegatives: []
    };
  }

  const titleNorm = normalizeText(article.title || '');
  const summaryNorm = normalizeText(article.summary || '');
  const contentLeadNorm = normalizeText(article.content || '').slice(0, 1800);
  const fullNorm = `${titleNorm} ${summaryNorm} ${contentLeadNorm}`;

  // 1. Check user custom blocked terms first
  if (Array.isArray(customBlockedTerms) && customBlockedTerms.length > 0) {
    const customHits = findMatchedTerms(fullNorm, customBlockedTerms);
    if (customHits.length > 0) {
      return {
        blocked: true,
        severity: 'high',
        reason: `Termo bloqueado configurado na redação: ${customHits.join(', ')}`,
        matchedTargets: ['regra personalizada'],
        matchedNegatives: customHits
      };
    }
  }

  // 2. Skip if clearly referring exclusively to another municipality's city hall
  const mentionsNatalCityHall = findMatchedTerms(fullNorm, NATAL_PREFEITURA_TARGETS).length > 0;
  if (!mentionsNatalCityHall && OTHER_CITY_PREFEITURA_RE.test(fullNorm) && !hasTerm(fullNorm, 'natal')) {
    return {
      blocked: false,
      severity: 'none',
      reason: '',
      matchedTargets: [],
      matchedNegatives: []
    };
  }

  // 3. Identify municipal targets
  const explicitTargets = findMatchedTerms(fullNorm, NATAL_PREFEITURA_TARGETS);
  const genericTargets =
    isNatal || hasTerm(fullNorm, 'natal') || explicitTargets.length > 0
      ? findMatchedTerms(fullNorm, GENERIC_MUNICIPAL_TARGETS)
      : [];
  const matchedTargets = [...new Set([...explicitTargets, ...genericTargets])];

  // 4. Filter out negative terms that are purely objects of proactive positive government action
  //    e.g., "Prefeitura realiza mutirão contra abandono de animais" or "combate irregularidades"
  const filterGenuineNegatives = (terms, text) => {
    const genuine = [];
    for (const term of terms) {
      const escaped = escapeRegex(normalizeText(term));
      const re = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'g');
      let match;
      let hasNonMitigatedOccurrence = false;
      while ((match = re.exec(text)) !== null) {
        const prefix = text.slice(Math.max(0, match.index - 35), match.index);
        if (!MITIGATING_ACTION_RE.test(prefix)) {
          hasNonMitigatedOccurrence = true;
          break;
        }
      }
      if (hasNonMitigatedOccurrence) genuine.push(term);
    }
    return genuine;
  };

  // Only treat moderate complaints as municipal criticism if they appear in title/summary
  // or co-occur closely in the same lead paragraph (avoids unrelated body mentions)
  const titleSummaryNorm = `${titleNorm} ${summaryNorm}`;
  const highHitsTitleSummary = filterGenuineNegatives(findMatchedTerms(titleSummaryNorm, HIGH_SEVERITY_CRITICISM), titleSummaryNorm);
  const highHits = filterGenuineNegatives(findMatchedTerms(fullNorm, HIGH_SEVERITY_CRITICISM), fullNorm);
  const moderateHitsTitle = filterGenuineNegatives(findMatchedTerms(titleNorm, MODERATE_COMPLAINT_TERMS), titleNorm);
  const moderateHitsTitleSummary = filterGenuineNegatives(findMatchedTerms(titleSummaryNorm, MODERATE_COMPLAINT_TERMS), titleSummaryNorm);
  const implicitHits = findMatchedTerms(titleSummaryNorm, IMPLICIT_MUNICIPAL_COMPLAINT_PHRASES);

  // Case A: Explicit municipal target + high-severity negative term -> ALWAYS block (strict & moderate)
  if (matchedTargets.length > 0 && (highHitsTitleSummary.length > 0 || (level === 'strict' && highHits.length > 0))) {
    const usedHits = highHitsTitleSummary.length > 0 ? highHitsTitleSummary : highHits;
    return {
      blocked: true,
      severity: 'high',
      reason: `Crítica/desgaste à gestão municipal (${matchedTargets[0]}: "${usedHits.slice(0, 2).join('", "')}")`,
      matchedTargets,
      matchedNegatives: usedHits
    };
  }

  // Case B: Explicit municipal target + moderate complaint in headline/summary
  if (matchedTargets.length > 0 && moderateHitsTitleSummary.length > 0) {
    if (level === 'strict' || moderateHitsTitle.length > 0) {
      return {
        blocked: true,
        severity: 'moderate',
        reason: `Cobrança/reclamação envolvendo órgão municipal (${matchedTargets[0]}: "${moderateHitsTitleSummary.slice(0, 2).join('", "')}")`,
        matchedTargets,
        matchedNegatives: moderateHitsTitleSummary
      };
    }
  }

  // Case C: Strict mode catches implicit municipal service complaints in Natal
  if (level === 'strict' && (isNatal || hasTerm(fullNorm, 'natal')) && implicitHits.length > 0) {
    return {
      blocked: true,
      severity: 'moderate',
      reason: `Queixa sobre zeladoria/serviço municipal em Natal ("${implicitHits[0]}")`,
      matchedTargets: ['serviço municipal (implícito)'],
      matchedNegatives: implicitHits
    };
  }

  return {
    blocked: false,
    severity: 'none',
    reason: '',
    matchedTargets,
    matchedNegatives: []
  };
}

// --- Crime & Violence Editorial Filter ---

const CRIME_VIOLENCE_TERMS = [
  // Lethal / physical violence & weapons
  'homicidio', 'homicidios', 'assassinato', 'assassinatos', 'latrocinio', 'feminicidio',
  'execucao sumaria', 'execucao a tiros', 'morto a tiros', 'morta a tiros', 'mortos a tiros', 'morte a tiros',
  'baleado', 'baleada', 'baleados', 'tiroteio', 'troca de tiros',
  'pistola', 'revolver', 'fuzil', 'arma de fogo', 'armas de fogo', 'municao', 'municoes',
  'facada', 'facadas', 'esfaqueado', 'esfaqueada', 'tentar matar', 'tentativa de homicidio',
  'suspeito de matar', 'suspeita de matar', 'espancamento', 'espancado', 'agressao',
  'agredido', 'agredida', 'estupro', 'abuso sexual', 'violencia domestica',
  'violencia contra', 'violencia', 'sequestro', 'sequestrado', 'carcere privado',
  'chacina', 'grupo de exterminio', 'cadaver', 'corpo encontrado',
  'encontrado morto', 'encontrada morta',
  // Trafficking, organized crime, theft & fraud
  'trafico de drogas', 'trafico', 'traficante', 'traficantes', 'apreensao de drogas',
  'cocaina', 'maconha', 'crack', 'assalto', 'assaltos', 'assaltante', 'assaltantes',
  'roubo', 'roubos', 'roubado', 'roubada', 'furto', 'furtos',
  'arrombamento', 'arrombamentos', 'arrastao', 'faccao', 'faccao criminosa',
  'grupo criminoso', 'organizacao criminosa', 'crime organizado', 'quadrilha',
  'crime', 'crimes', 'criminoso', 'criminosa', 'criminosos',
  'estelionato', 'subornar', 'suborno', 'fraudes bancarias',
  'golpe de falso investimento', 'rebeliao', 'fuga de presos',
  // Specific arrest & police crime investigation phrases (avoid false positives on guards/inmate projects)
  'e preso', 'e presa', 'foi preso', 'foi presa', 'sao presos', 'foram presos',
  'policia prende', 'policia civil prende', 'policia militar prende', 'pm prende',
  'operacao prende', 'mandado de prisao', 'prisao preventiva', 'prisao em flagrante',
  'preso em flagrante', 'preso suspeito', 'presa suspeita', 'preso apos', 'presa apos',
  'preso por', 'presa por', 'preso com', 'presa com', 'foragido', 'foragida',
  'policia investiga', 'diz policia',
  'delegacia de policia', 'central de flagrantes'
];

const CRIME_CATEGORY_NAMES = ['policia', 'violencia', 'crime', 'policial'];
const CRIME_CATEGORY_CONFIRM_TERMS = [
  'policia', 'suspeito', 'suspeita', 'crime', 'violencia', 'preso', 'presa',
  'morte', 'tiros', 'drogas', 'operacao', 'delegacia', 'ocorrencia', 'armas'
];

export function evaluateCrimeViolenceFilter(article, { enabled = true } = {}) {
  if (!enabled) {
    return { blocked: false, matchedTerms: [], reason: '' };
  }

  const titleNorm = normalizeText(article.title || '');
  const summaryNorm = normalizeText(article.summary || '');
  const cleanContentRaw = String(article.content || '').split(
    /\b(?:Not[ií]cias relacionadas|Leia mais|Leia tamb[ée]m|Saiba mais|Veja tamb[ée]m)\b/i
  )[0];
  const contentLeadNorm = normalizeText(cleanContentRaw.slice(0, 450));
  const combinedNorm = `${titleNorm} ${summaryNorm} ${contentLeadNorm}`.trim();

  const matchedTerms = findMatchedTerms(combinedNorm, CRIME_VIOLENCE_TERMS);
  if (matchedTerms.length > 0) {
    return {
      blocked: true,
      matchedTerms,
      reason: `Filtro de crimes/violência (${matchedTerms.slice(0, 3).join(', ')})`
    };
  }

  const categoriesNorm = (Array.isArray(article.categories) ? article.categories : []).map((c) =>
    normalizeText(c)
  );
  const matchedCat = categoriesNorm.find((c) => CRIME_CATEGORY_NAMES.includes(c));
  if (matchedCat) {
    const confirmTerms = findMatchedTerms(combinedNorm, CRIME_CATEGORY_CONFIRM_TERMS);
    if (confirmTerms.length > 0) {
      return {
        blocked: true,
        matchedTerms: [`cat:${matchedCat}`, ...confirmTerms],
        reason: `Editoria policial/violência (${confirmTerms.slice(0, 2).join(', ')})`
      };
    }
  }

  return { blocked: false, matchedTerms: [], reason: '' };
}

// --- TV Newsroom Potential Scorer ---

const TV_BEATS = [
  {
    name: 'Serviço & Utilidade',
    keywords: [
      'matricula', 'inscricao', 'inscricoes', 'concurso', 'vagas', 'emprego', 'sine',
      'vacina', 'vacinacao', 'atendimento', 'horario', 'funcionamento', 'feriado',
      'prazo', 'documento', 'iptu', 'desconto', 'beneficio', 'bolsa familia', 'abono',
      'mutirao', 'cadastro', 'cadastramento', 'gratuito', 'gratuita', 'edital', 'selecao',
      'isencao', 'calendario', 'agendamento'
    ],
    weight: 28,
    suggestion:
      'Nota de serviço para o telejornal: detalhar datas, documentos, locais de atendimento e orientar o telespectador em Natal.'
  },
  {
    name: 'Cidade & Mobilidade',
    keywords: [
      'transito', 'interdicao', 'desvio', 'onibus', 'vlt', 'sttu', 'apagao',
      'falta de energia', 'falta de agua', 'caern', 'cosern', 'avenida', 'ponte',
      'obra', 'obras', 'asfalto', 'semaforo', 'acidente', 'congestionamento',
      'aeroporto', 'rodoviaria', 'itinerario', 'linha de onibus', 'praia', 'orla',
      'ambulante', 'comerciante', 'fila'
    ],
    weight: 26,
    suggestion:
      'Pauta de externa/link ao vivo: registrar imagens da via ou do bairro afetado e ouvir moradores, motoristas ou técnicos no local.'
  },
  {
    name: 'Clima & Meio Ambiente',
    keywords: [
      'chuva', 'chuvas', 'temporal', 'alerta', 'inmet', 'mare', 'ressaca',
      'ventania', 'onda de calor', 'temperatura', 'meio ambiente', 'parque das dunas',
      'tartaruga', 'praia', 'resgate ambiental', 'balneabilidade', 'queimada', 'incendio'
    ],
    weight: 25,
    suggestion:
      'Pauta visual/meteorológica: usar arte de previsão do tempo no telão e imagens das condições climáticas na orla ou ruas.'
  },
  {
    name: 'Saúde & Educação',
    keywords: [
      'saude', 'hospital', 'walfredo gurgel', 'giselda trigueiro', 'varela santiago',
      'januario cicco', 'hemonorte', 'doacao de sangue', 'mpox', 'dengue', 'gripe',
      'covid', 'escola', 'alunos', 'estudantes', 'educacao', 'ufrn', 'ifrn',
      'enem', 'sisu', 'cuidoteca', 'pesquisa', 'autismo', 'autistas'
    ],
    weight: 24,
    suggestion:
      'Matéria de interesse humano/público: buscar entrevista com especialista local (UFRN/SESAP) e personagem beneficiado.'
  },
  {
    name: 'Economia & Emprego',
    keywords: [
      'comercio', 'consumidor', 'precos', 'cesta basica', 'combustivel', 'gasolina',
      'turismo', 'hoteis', 'ocupacao hoteleira', 'turistas', 'shoppings', 'vendas',
      'oportunidades', 'trabalho', 'salario', 'energia solar', 'microgeracao', 'procon'
    ],
    weight: 22,
    suggestion:
      'Matéria de bolso e comércio local: gravar no Alecrim ou shopping/rede hoteleira com depoimento de comerciante e consumidor.'
  },
  {
    name: 'Defesa Civil & Prevenção',
    keywords: [
      'bombeiros', 'defesa civil', 'resgate', 'prevencao', 'alerta',
      'seguranca viaria', 'lei seca', 'guarda vidas'
    ],
    weight: 16,
    suggestion:
      'Pauta de prevenção, trânsito educativo ou defesa civil: verificar orientações oficiais de bombeiros, Defesa Civil ou órgão de trânsito.'
  },
  {
    name: 'Cultura & Turismo',
    keywords: [
      'cultura', 'festival', 'show', 'teatro', 'exposicao', 'patrimonio', 'gastronomia',
      'carnatal', 'natal em natal', 'forte dos reis magos', 'pinacoteca', 'corrida',
      'esporte', 'abc', 'america-rn', 'arena das dunas', 'solidariedade', 'homenagem'
    ],
    weight: 20,
    suggestion:
      'Pauta cultural/leve para fechamento de bloco: explorar ambiente visual, música/cenário e agenda gratuita para o fim de semana.'
  }
];

const TV_ANTI_SIGNALS = [
  { term: 'pesquisa eleitoral', penalty: 28, reason: 'bastidor eleitoral' },
  { term: 'articulacao politica', penalty: 28, reason: 'bastidor partidário' },
  { term: 'bastidores', penalty: 25, reason: 'coluna de bastidores' },
  { term: 'coluna politica', penalty: 25, reason: 'coluna opinativa' },
  { term: 'nota de repudio', penalty: 25, reason: 'nota protocolar' },
  { term: 'sessao solene', penalty: 30, reason: 'ato protocolar sem apelo visual' },
  { term: 'titulo de cidadania', penalty: 30, reason: 'ato protocolar/homenagem formal' },
  { term: 'titulos de cidadania', penalty: 30, reason: 'ato protocolar/homenagem formal' },
  { term: 'marca presenca', penalty: 25, reason: 'release institucional' },
  { term: 'fortalece compromisso', penalty: 25, reason: 'release institucional' },
  { term: 'atribui vitoria', penalty: 25, reason: 'declaração político-eleitoral' },
  { term: 'eleicoes', penalty: 22, reason: 'pauta eleitoral protocolar' },
  { term: 'filiacao', penalty: 25, reason: 'movimentação partidária' },
  { term: 'lula 4', penalty: 30, reason: 'especulação eleitoral nacional' },
  { term: 'artigo:', penalty: 22, reason: 'texto opinativo' },
  { term: 'opiniao:', penalty: 22, reason: 'coluna de opinião' },
  { term: 'podcast', penalty: 18, reason: 'divulgação de áudio/podcast' },
  { term: 'horoscopo', penalty: 45, reason: 'conteúdo não jornalístico' },
  { term: 'black friday', penalty: 30, reason: 'conteúdo comercial' },
  { term: 'cupom', penalty: 35, reason: 'conteúdo promocional' },
  { term: 'apostas', penalty: 35, reason: 'conteúdo promocional' },
  { term: 'grammy', penalty: 30, reason: 'entretenimento nacional/internacional' },
  { term: 'celebridades', penalty: 30, reason: 'fofoca/celebridades' },
  { term: 'bbb', penalty: 30, reason: 'reality show nacional' },
  { term: 'publi', penalty: 40, reason: 'informe publicitário' }
];

/**
 * Evaluates how well a Natal/RN news item translates into a TV newsroom story.
 */
export function scoreTvPotential(article, geoResult) {
  const titleNorm = normalizeText(article.title || '');
  const summaryNorm = normalizeText(article.summary || '');
  const catsNorm = normalizeText((article.categories || []).join(' '));
  const combinedNorm = `${titleNorm} ${summaryNorm} ${catsNorm}`;

  let score = 25; // baseline for valid Natal/RN news
  const signals = [];

  if (geoResult?.geoScore >= 50) {
    score += 12;
    signals.push('Forte impacto direto em Natal');
  }
  if (article.imageUrl) {
    score += 8;
    signals.push('Com foto/material visual');
  }

  // Visual / TV-friendly format hints
  if (hasTerm(titleNorm, 'video') || hasTerm(titleNorm, 'veja') || hasTerm(titleNorm, 'confira') || hasTerm(titleNorm, 'flagrante')) {
    score += 10;
    signals.push('Formato visual / serviço direto');
  }

  let bestBeat = { name: 'Geral Natal', hits: 0, weight: 0, suggestion: 'Checar desdobramento local em Natal com apuração de rua e sonora de fonte oficial.' };

  for (const beat of TV_BEATS) {
    const titleHits = findMatchedTerms(titleNorm, beat.keywords);
    const bodyHits = findMatchedTerms(`${summaryNorm} ${catsNorm}`, beat.keywords);
    const uniqueHits = [...new Set([...titleHits, ...bodyHits])];

    if (uniqueHits.length > 0) {
      const beatScore = beat.weight + titleHits.length * 6 + Math.min(12, uniqueHits.length * 3);
      if (beatScore > bestBeat.weight + bestBeat.hits * 4) {
        bestBeat = {
          name: beat.name,
          hits: uniqueHits.length,
          weight: beatScore,
          suggestion: beat.suggestion,
          matched: uniqueHits.slice(0, 4)
        };
      }
    }
  }

  if (bestBeat.hits > 0) {
    score += Math.min(40, bestBeat.weight);
    signals.push(`${bestBeat.name} (${bestBeat.matched.join(', ')})`);
  }

  // Bonus if story combines numbers, deadlines, or neighborhood names (concrete for TV)
  if (/\b\d+/.test(titleNorm)) {
    score += 6;
  }
  if (geoResult?.matchedLocations?.length > 1) {
    score += 5;
  }

  // Apply anti-signals
  const penalties = [];
  for (const anti of TV_ANTI_SIGNALS) {
    if (hasTerm(combinedNorm, anti.term)) {
      score -= anti.penalty;
      penalties.push(anti.reason);
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let tvLabel = 'Baixo Apelo TV';
  if (score >= 72) tvLabel = 'Pauta Forte';
  else if (score >= 50) tvLabel = 'Boa Pauta';
  else if (score >= 30) tvLabel = 'Pauta Regular';

  return {
    tvScore: score,
    tvLabel,
    tvCategory: bestBeat.name,
    tvSuggestion: bestBeat.suggestion,
    tvSignals: signals,
    tvPenalties: penalties
  };
}

/**
 * Runs complete editorial classification pipeline on an article.
 */
export function classifyArticle(article, settings = {}, overrides = {}) {
  const editorial = settings.editorial || {};
  const cityFilterMode = editorial.cityFilterMode || 'natal_strict';
  const prefeituraFilterLevel = editorial.prefeituraFilterLevel || 'strict';
  const blockCrimeViolence = editorial.blockCrimeViolence !== false;
  const customBlockedTerms = editorial.customBlockedTerms || [];
  const minTvScore = Number(editorial.minTvScore ?? 30);

  const geo = evaluateNatalRelevance(article, cityFilterMode);
  const prefeitura = evaluatePrefeituraFilter(article, {
    level: prefeituraFilterLevel,
    customBlockedTerms,
    isNatal: geo.isNatal
  });
  const crime = evaluateCrimeViolenceFilter(article, { enabled: blockCrimeViolence });
  const tv = scoreTvPotential(article, geo);

  const approvedSet = new Set(overrides.approvedUrls || []);
  const blockedSet = new Set(overrides.blockedUrls || []);
  const isManuallyApproved = approvedSet.has(article.canonicalUrl);
  const isManuallyBlocked = blockedSet.has(article.canonicalUrl);

  let status = 'approved';
  let statusReason = '';

  if (isManuallyBlocked) {
    status = 'blocked_manual';
    statusReason = 'Ocultada manualmente pela redação';
  } else if (prefeitura.blocked && !isManuallyApproved) {
    status = 'blocked_prefeitura';
    statusReason = prefeitura.reason;
  } else if (crime.blocked && !isManuallyApproved) {
    status = 'blocked_crime';
    statusReason = crime.reason;
  } else if (!geo.isNatal && !isManuallyApproved) {
    status = 'filtered_geo';
    statusReason = geo.geoReason;
  } else if (tv.tvScore < minTvScore && !isManuallyApproved) {
    status = 'filtered_low_tv';
    statusReason = `Potencial para TV (${tv.tvScore}) abaixo do mínimo (${minTvScore})`;
  }

  return {
    ...article,
    geo,
    prefeitura,
    crime,
    tvScore: tv.tvScore,
    tvLabel: tv.tvLabel,
    tvCategory: tv.tvCategory,
    tvSuggestion: tv.tvSuggestion,
    tvSignals: tv.tvSignals,
    tvPenalties: tv.tvPenalties,
    status,
    statusReason,
    isManuallyApproved
  };
}
