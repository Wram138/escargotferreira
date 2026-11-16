import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyArticle,
  evaluateCrimeViolenceFilter,
  evaluateNatalRelevance,
  evaluatePrefeituraFilter,
  scoreTvPotential
} from '../src/services/classifier.js';

function makeArticle(overrides = {}) {
  return {
    canonicalUrl: 'https://tribunadonorte.com.br/exemplo',
    url: 'https://tribunadonorte.com.br/exemplo',
    title: 'Título de teste',
    summary: '',
    content: '',
    imageUrl: 'https://example.com/foto.jpg',
    categories: [],
    publishedAt: '2026-11-16T21:00:00.000Z',
    sourceId: 'novo-noticias',
    sourceName: 'NOVO Notícias',
    sourceShortName: 'NOVO',
    sourceCategory: 'portal',
    geoHint: 'rn',
    ...overrides
  };
}

describe('Geo-relevância Natal/RN', () => {
  it('aceita matérias diretamente sobre Natal/RN e bairros', () => {
    const a1 = makeArticle({
      title: 'Matrícula para estudantes da Educação Especial começa nesta terça em Natal',
      summary: 'Prazo para solicitar vagas na rede municipal segue até sexta-feira.'
    });
    const res1 = evaluateNatalRelevance(a1, 'natal_strict');
    assert.equal(res1.isNatal, true);

    const a2 = makeArticle({
      title: 'Semurb prepara cadastramento de comerciantes na Praia de Miami',
      summary: 'Ação organiza ocupação da orla urbana.'
    });
    const res2 = evaluateNatalRelevance(a2, 'natal_strict');
    assert.equal(res2.isNatal, true);

    const a3 = makeArticle({
      title: 'UFRN é aprovada em chamada do MEC e terá sua primeira Cuidoteca',
      summary: 'Espaço funcionará no campus central.'
    });
    const res3 = evaluateNatalRelevance(a3, 'natal_strict');
    assert.equal(res3.isNatal, true);
  });

  it('rejeita falsos positivos da palavra Natal em contexto natalino nacional', () => {
    const xmas = makeArticle({
      sourceId: 'agencia-brasil-ultimas',
      sourceCategory: 'agencia',
      geoHint: 'national',
      title: 'Comércio nacional espera alta de 4% nas vendas de Natal em todo o país',
      summary: 'Pesquisa mostra intenção de compras para presentes de Natal e ceia.'
    });
    const res = evaluateNatalRelevance(xmas, 'natal_strict');
    assert.equal(res.isNatal, false);

    const prenatal = makeArticle({
      sourceId: 'agencia-brasil-geral',
      sourceCategory: 'agencia',
      geoHint: 'national',
      title: 'Ministério da Saúde amplia exames de pré-natal na rede pública',
      summary: 'Medida vale para gestantes atendidas pelo SUS no Brasil.'
    });
    assert.equal(evaluateNatalRelevance(prenatal, 'natal_strict').isNatal, false);
  });

  it('aceita evento cultural Natal em Natal ou Agência Brasil citando Natal/RN', () => {
    const fest = makeArticle({
      title: 'Natal em Natal abre programação cultural gratuita na Ribeira',
      summary: 'Shows acontecem na Praça Augusto Severo.'
    });
    assert.equal(evaluateNatalRelevance(fest, 'natal_strict').isNatal, true);

    const agBr = makeArticle({
      sourceId: 'agencia-brasil-geral',
      sourceCategory: 'agencia',
      geoHint: 'national',
      title: 'Porto de Natal (RN) bate recorde de exportação de frutas',
      summary: 'Movimentação no Rio Grande do Norte cresceu 18% no trimestre.'
    });
    assert.equal(evaluateNatalRelevance(agBr, 'natal_strict').isNatal, true);
  });

  it('separa outras cidades do RN e Grande Natal conforme o modo configurado', () => {
    const mossoro = makeArticle({
      title: 'VI Seminário Vidas Negras ocorre nesta quinta-feira em Mossoró',
      summary: 'Evento acontece no campus da UERN.'
    });
    assert.equal(evaluateNatalRelevance(mossoro, 'natal_strict').isNatal, false);

    const parnamirim = makeArticle({
      title: 'Prefeitura de Parnamirim põe médico para atender sem ficha na UBS de Primavera',
      summary: 'Medida busca reduzir procura pela UPA do município.'
    });
    assert.equal(evaluateNatalRelevance(parnamirim, 'natal_strict').isNatal, false);
    assert.equal(evaluateNatalRelevance(parnamirim, 'grande_natal').isNatal, true);

    const apagarGn = makeArticle({
      title: 'Apagão atinge bairros da Grande Natal; moradores relatam falta de energia',
      summary: 'Cosern apura causa da interrupção.'
    });
    assert.equal(evaluateNatalRelevance(apagarGn, 'natal_strict').isNatal, true);
  });
});

describe('Filtro institucional — evitar matérias contra a Prefeitura do Natal', () => {
  it('bloqueia críticas, denúncias, protestos e cobranças contra a Prefeitura do Natal', () => {
    const cases = [
      {
        title: 'Moradores denunciam abandono e falta de médicos em UBS de Natal',
        summary: 'População reclama de demora no atendimento na Zona Norte.'
      },
      {
        title: 'MPRN cobra Prefeitura do Natal por irregularidades em contrato',
        summary: 'Investigação aponta suspeita de superfaturamento.'
      },
      {
        title: 'Sindicato faz protesto contra prefeito Paulinho Freire por atraso salarial',
        summary: 'Manifestantes ocuparam o Paço da Pátria.'
      },
      {
        title: 'Lixo acumulado e buraqueira revoltam moradores no Alecrim',
        summary: 'Moradores cobram coleta regular e reparo na via.'
      },
      {
        title: 'TCE aponta falha na engorda de Ponta Negra e critica gestão municipal',
        summary: 'Relatório menciona erosão e risco de embargo.'
      }
    ];

    for (const c of cases) {
      const art = makeArticle(c);
      const res = evaluatePrefeituraFilter(art, { level: 'strict', isNatal: true });
      assert.equal(res.blocked, true, `Deveria bloquear: ${c.title}`);
    }
  });

  it('mantém notícias positivas ou de serviço da Prefeitura do Natal', () => {
    const allowedCases = [
      {
        title: 'Prefeitura do Natal antecipa IPTU 2027 com desconto de 16% para contribuintes em dia',
        summary: 'Boletos já podem ser emitidos pela internet.'
      },
      {
        title: 'Semurb prepara cadastramento de comerciantes na Praia de Miami',
        summary: 'Organização de ambulantes começa na próxima semana em Natal.'
      },
      {
        title: 'STTU publica lista de veículos autuados em Natal; multas somam R$ 3,9 milhões',
        summary: 'Trânsito irregular em faixa exclusiva foi a infração mais comum.'
      },
      {
        title: 'Prefeitura do Natal promove mutirão contra abandono de animais no Parque das Dunas',
        summary: 'Ação inclui vacinação e feira de adoção gratuita.'
      },
      {
        title: 'Natal abre matrícula antecipada para estudantes da Educação Especial nesta terça',
        summary: 'Inscrições na rede municipal começam às 8h.'
      },
      {
        title: 'IPTU de Natal fica 4,47% mais caro em 2027; veja como obter desconto',
        summary: 'Prefeitura de Natal inicia cobrança do IPTU com opção de 16% de abatimento.'
      }
    ];

    for (const c of allowedCases) {
      const art = makeArticle(c);
      const res = evaluatePrefeituraFilter(art, { level: 'strict', isNatal: true });
      assert.equal(res.blocked, false, `Não deveria bloquear serviço/positiva: ${c.title} (${res.reason})`);
    }
  });

  it('respeita termos personalizados bloqueados e nível desligado', () => {
    const art = makeArticle({
      title: 'Nova discussão sobre taxa do lixo movimenta Natal',
      summary: 'Tema entra em pauta nesta semana.'
    });
    const blocked = evaluatePrefeituraFilter(art, {
      level: 'strict',
      customBlockedTerms: ['taxa do lixo'],
      isNatal: true
    });
    assert.equal(blocked.blocked, true);

    const off = evaluatePrefeituraFilter(
      makeArticle({ title: 'Protesto contra Prefeitura de Natal gera caos' }),
      { level: 'off', isNatal: true }
    );
    assert.equal(off.blocked, false);
  });
});

describe('Pontuação de potencial para redação de TV', () => {
  it('prioriza pautas de serviço e impacto urbano sobre bastidor político e publi', () => {
    const service = makeArticle({
      title: 'Natal e Parnamirim concentram 180 novas vagas de emprego; veja como se inscrever',
      summary: 'Sine divulga horários de atendimento e documentos necessários.'
    });
    const geoService = evaluateNatalRelevance(service, 'natal_strict');
    const scoreService = scoreTvPotential(service, geoService);

    const gossip = makeArticle({
      title: 'Bastidores: pesquisa eleitoral e articulação política movimentam semana em Natal',
      summary: 'Coluna política analisa filiação partidária.',
      imageUrl: null
    });
    const geoGossip = evaluateNatalRelevance(gossip, 'natal_strict');
    const scoreGossip = scoreTvPotential(gossip, geoGossip);

    assert.ok(scoreService.tvScore > scoreGossip.tvScore);
    assert.ok(scoreService.tvScore >= 60);
    assert.equal(scoreService.tvCategory, 'Serviço & Utilidade');
    assert.ok(scoreService.tvSuggestion.length > 15);
  });

  it('integra todo o pipeline em classifyArticle incluindo override manual', () => {
    const critic = makeArticle({
      title: 'Protesto contra Prefeitura de Natal bloqueia avenida por falta de médico em UPA',
      summary: 'Moradores denunciam precariedade.'
    });
    const blocked = classifyArticle(critic, { editorial: { prefeituraFilterLevel: 'strict' } });
    assert.equal(blocked.status, 'blocked_prefeitura');

    const rescued = classifyArticle(
      critic,
      { editorial: { prefeituraFilterLevel: 'strict' } },
      { approvedUrls: [critic.canonicalUrl] }
    );
    assert.equal(rescued.status, 'approved');
  });
});

describe('Filtro de crimes e violência', () => {
  it('bloqueia pautas policiais e de violência no feed de Natal/RN', () => {
    const crimeCases = [
      {
        title: 'Casal é preso por tráfico de drogas no bairro de Felipe Camarão em Natal',
        summary: 'Polícia Militar apreendeu entorpecentes durante patrulhamento.'
      },
      {
        title: 'Operação prende trio acusado de homicídio e tráfico de drogas na Zona Norte de Natal',
        summary: 'Mandados de prisão foram cumpridos pela Polícia Civil.'
      },
      {
        title: 'Pai e filho são mortos a tiros dentro de residência em Natal',
        summary: 'Polícia Civil investiga a autoria do crime.'
      },
      {
        title: 'ABANDONO: Memorial Câmara Cascudo acumula arrombamentos e furtos no Centro de Natal',
        summary: 'Moradores relatam insegurança na região.'
      },
      {
        title: 'Homem é preso com pistola e munições na Zona Oeste de Natal',
        summary: 'Suspeito foi conduzido à delegacia de plantão.'
      },
      {
        title: 'Homem é baleado e morto em tentativa de latrocínio em Natal',
        summary: 'Assaltantes fugiram após o crime.'
      }
    ];

    for (const c of crimeCases) {
      const art = makeArticle(c);
      const res = evaluateCrimeViolenceFilter(art, { enabled: true });
      assert.equal(res.blocked, true, `Deveria bloquear crime/violência: ${c.title}`);

      const classified = classifyArticle(art, {
        editorial: { prefeituraFilterLevel: 'off', blockCrimeViolence: true }
      });
      assert.equal(classified.status, 'blocked_crime', `Status esperado blocked_crime para: ${c.title}`);
    }
  });

  it('evita falsos positivos em pautas institucionais ou sociais sem ocorrência criminal', () => {
    const safeCases = [
      {
        title: 'Natal não tem previsão para transformar Guarda Municipal em Polícia Municipal',
        summary: 'Gestão avalia atribuições administrativas e ordenamento urbano na capital.'
      },
      {
        title: 'Coleção criada por presos no RN recebe convite para desfilar na New York Fashion Week',
        summary: 'Projeto cultural e de ressocialização ganha destaque internacional em Natal.'
      },
      {
        title: 'TCE-RN fiscaliza emendas parlamentares e execução de obras públicas em Natal',
        summary: 'Relatório técnico acompanha cronograma financeiro do município.'
      },
      {
        title: 'INSS: mutirão oferece 7,9 mil vagas em Natal neste fim de semana',
        summary: 'Atendimentos de perícia médica e avaliação social ocorrem nas agências.',
        content: 'Mutirão previdenciário segue até domingo. Notícias relacionadas: benefício para vítimas de violência doméstica.'
      }
    ];

    for (const c of safeCases) {
      const art = makeArticle(c);
      const res = evaluateCrimeViolenceFilter(art, { enabled: true });
      assert.equal(res.blocked, false, `Não deveria bloquear: ${c.title} (${res.reason})`);

      const classified = classifyArticle(art, { editorial: { blockCrimeViolence: true } });
      assert.notEqual(classified.status, 'blocked_crime');
    }
  });

  it('permite desligar filtro de crimes ou liberar manualmente na redação', () => {
    const homicide = makeArticle({
      title: 'Polícia Civil investiga homicídio ocorrido em Natal',
      summary: 'Delegacia colhe depoimentos na manhã desta terça-feira.'
    });

    const whenDisabled = classifyArticle(homicide, { editorial: { blockCrimeViolence: false } });
    assert.notEqual(whenDisabled.status, 'blocked_crime');

    const rescued = classifyArticle(
      homicide,
      { editorial: { blockCrimeViolence: true } },
      { approvedUrls: [homicide.canonicalUrl] }
    );
    assert.equal(rescued.status, 'approved');
  });
});
