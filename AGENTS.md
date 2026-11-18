# Regras Obrigatórias do Site (Escargot News — Ronda TV • Natal/RN)

## 1. Permanência Obrigatória das Matérias do Dia na Página Inicial

- **Regra obrigatória:** As matérias que já foram coletadas e exibidas no dia **NÃO devem sair da página inicial (`Ronda de Pautas` / `pautas`)** ao longo daquele mesmo dia (fuso `America/Fortaleza`).
- **Garantias técnicas que nunca podem ser quebradas:**
  1. **Retenção integral no cache bruto (`rawArticles`):** A função `mergeArticlesWithRetention` em `src/services/aggregator.js` deve preservar todas as URLs canônicas coletadas nos últimos 7 dias sem descartar matérias secundárias durante a mesclagem, impedindo que matérias saiam do ar quando o feed RSS/WP-JSON do portal girar (após 20–25 posts) ou oscilar.
  2. **Fixação no dia (`homepageDateKey`):** Toda matéria aprovada e exibida na página inicial no dia corrente recebe `homepageDateKey = todayKey` persistido em `data/cache.json`. Enquanto `todayKey` for o dia atual:
     - Ela nunca pode ser engolida/ocultada pelo agrupamento (`deduplicateAndCluster`) por matérias de outros dias, por matérias barradas/filtradas (`filtered_geo`, `blocked_crime`, `blocked_prefeitura`, `filtered_low_tv`) ou por outros cards já presentes na página inicial.
     - Ela nunca pode ter seu `geoHint` (ex.: `tribuna-natal` sobrescrito por `tribuna-geral`), texto (`summary`/`content`) ou data (`publishedAt`) rebaixados em coletas subsequentes.
     - Ela permanece aprovada na página inicial durante todo o dia (exceto se o usuário clicar explicitamente em **Ocultar** / bloqueio manual ou alterar as regras editoriais nas Configurações).
  3. **Preservação no Frontend (`public/app.js`):** Atualizações de estado na interface (`preserveSameDayPautas`) devem manter todas as matérias já carregadas no dia visíveis na página inicial.
