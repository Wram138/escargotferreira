# Escargot News — Ronda TV • Natal/RN (`escargotferreira`)

Aplicação web para **ronda jornalística de redação de TV** com foco na cidade de **Natal/RN**, reunindo notícias em tempo real dos principais portais e blogs locais, aplicando filtros editoriais automáticos e enviando pautas diretamente para grupos do **Telegram**.

## Funcionalidades

- **Agregação em tempo real (15 fontes padrão + fontes personalizadas):**
  - Portais: **Tribuna do Norte**, **G1 RN**, **NOVO Notícias**, **Ponta Negra News**, **Agora RN**
  - Agência nacional filtrada para Natal/RN: **Agência Brasil**
  - Blogs e rádios locais: **Blog do BG**, **Blog Gustavo Negreiros**, **Blog do Saulo Vale**, **98 FM Natal**, **96 FM Natal**, **O Poti News**, **Diário do RN**
  - Suporte para adicionar novos blogs/portais com detecção automática de RSS, WordPress REST API (`wp-json`) ou HTML.
- **Filtro geográfico inteligente para Natal/RN:**
  - Reconhece bairros, avenidas, órgãos e instituições da capital (Ponta Negra, Alecrim, Tirol, STTU, Semurb, UFRN, Walfredo Gurgel, etc.) e evita falsos positivos com a palavra "Natal" em contexto natalino.
- **Filtros editoriais automáticos (Prefeitura do Natal & Crimes/Violência):**
  - Separa automaticamente na aba **Bloqueadas (Filtro)** matérias envolvendo **crimes e violência** (`blockCrimeViolence` ativado por padrão) e críticas ou desgaste à **Prefeitura do Natal**, mantendo matérias de serviço/positivas.
- **Classificação com Laya AI (`laya-multilingual`):**
  - Usa o modelo [Laya](https://huggingface.co/convaiinnovations/laya) (`convaiinnovations/laya` / `multilingual` via `laya.serve`) para avaliar automaticamente se cada matéria é **Interessante** para a redação de TV (`choice`) e atribuir um **Grau de Importância** (`Urgente`, `Alta`, `Média`, `Baixa`, via `score`).
- **Ordenação padrão por Mais Recentes + Dropdown rápido:**
  - Lista por padrão as matérias **Mais recentes**, com menu dropdown direto na Ronda de Pautas para alternar entre **Mais recentes**, **Mais importantes**, **Mais interessantes** e **Maior potencial TV**.
- **Pontuação e gancho para redação de TV:**
  - Classifica cada matéria por editoria (`Serviço & Utilidade`, `Cidade & Mobilidade`, `Saúde & Educação`, `Economia & Emprego`, `Defesa Civil & Prevenção`, `Clima & Meio Ambiente`, `Cultura & Turismo`), calcula o potencial televisivo (0–100) e sugere o gancho de produção.
- **Página dedicada de Configurações protegida por login (`/configuracoes`):**
  - Protegida por usuário e senha (configuráveis via variáveis `CONFIG_AUTH_USER` / `CONFIG_AUTH_PASS` e alteráveis na própria interface), concentrando KPIs, filtros avançados, configuração de fontes, Laya AI e Bot do Telegram.
- **Integração completa com Bot do Telegram:**
  - Campos para informar **Token do Bot** e **ID do Grupo/Chat** (com **Detectar Grupos** via `getUpdates` e **Testar Envio**), além de envio individual, montagem de **Boletim da Redação** e histórico de envios.

## Como executar

### Instalador rápido (Linux/macOS)

```bash
chmod +x install.sh
./install.sh
```

Opções úteis:
- `./install.sh --interactive`: pergunta porta, threads do Laya AI e credenciais iniciais antes de subir.
- `./install.sh --local`: instala e configura tudo localmente (Node.js + `.venv` Python para o Laya AI) sem Docker.
- `./install.sh --check`: valida os pré-requisitos antes de instalar.

### Com Docker (manual — sobe a aplicação + Laya AI isolados)

```bash
docker compose up -d --build
```

Acesse `http://localhost:3000` no navegador.

- Os dados (configurações do Telegram, histórico de envios e cache) são persistidos em `./data`.
- Os pesos do modelo Laya (`laya-multilingual`) ficam em cache no volume Docker `laya_hf_cache`.
- Para parar os containers: `docker compose down`.

### Execução local (sem Docker)

```bash
npm install
npm start
```

Se o ambiente virtual `.venv` com `laya[serve]` estiver instalado, o servidor inicia o serviço `laya.serve` automaticamente em `http://127.0.0.1:8001` (ou você pode apontar para outro servidor Laya na aba **⚙ Configurações**). Caso contrário, a aplicação opera normalmente com fallback heurístico.

Para preparar o ambiente Python do Laya localmente (CPU):

```bash
python3 -m venv .venv
.venv/bin/python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
.venv/bin/python -m pip install "laya[serve]"
```

Acesse `http://localhost:3000` no navegador.

### Configurar o Bot do Telegram

1. No Telegram, crie um bot com o [@BotFather](https://t.me/BotFather) (`/newbot`) e copie o **Token**.
2. Adicione o bot ao grupo da redação e envie uma mensagem qualquer no grupo.
3. No painel, abra a aba **⚙ Configurações**, cole o **Token**, clique em **Detectar Grupos** (ou informe o ID manualmente, ex: `-100...`), salve e clique em **Testar Envio no Grupo**.

## Testes

```bash
npm test
```
