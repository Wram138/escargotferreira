#!/usr/bin/env bash
set -euo pipefail

# Instalador oficial do Escargot News — Ronda TV • Natal/RN
# Suporta instalação via Docker Compose (padrão) ou ambiente local Node.js + Python (.venv).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

MODE="docker"
APP_PORT="${PORT:-3000}"
LAYA_THREADS_VAL="${LAYA_THREADS:-2}"
SKIP_LAYA=false
SKIP_TESTS=false
NO_START=false
INTERACTIVE=false
CHECK_ONLY=false
CUSTOM_AUTH_USER=""
CUSTOM_AUTH_PASS=""

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  C_RESET=$'\033[0m'
  C_BOLD=$'\033[1m'
  C_BLUE=$'\033[34m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_RED=$'\033[31m'
else
  C_RESET=""
  C_BOLD=""
  C_BLUE=""
  C_GREEN=""
  C_YELLOW=""
  C_RED=""
fi

log_info()  { printf '%s[INFO]%s %s\n' "$C_BLUE" "$C_RESET" "$*"; }
log_ok()    { printf '%s[OK]%s   %s\n' "$C_GREEN" "$C_RESET" "$*"; }
log_warn()  { printf '%s[AVISO]%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
log_err()   { printf '%s[ERRO]%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; }

show_help() {
  cat <<'EOF'
Escargot News — Instalador (Ronda TV • Natal/RN)

Uso:
  ./install.sh [opções]

Modos:
  --docker              Instala e inicia com Docker Compose (padrão; sobe App + Laya AI)
  --local               Instala localmente sem Docker (Node.js + Python .venv p/ Laya)
  --check               Apenas verifica pré-requisitos sem alterar arquivos ou containers

Opções:
  -p, --port PORTA      Define a porta HTTP da aplicação (padrão: 3000)
  -t, --threads N       Threads CPU do Laya AI (padrão: 2)
  -i, --interactive     Pergunta porta e credenciais de acesso antes de subir
      --admin-user USER Define usuário inicial das Configurações no .env
      --admin-pass PASS Define senha inicial das Configurações no .env
      --skip-laya       No modo --local, pula a instalação do ambiente Python .venv do Laya
      --skip-tests      No modo --local, pula a execução do npm test
      --no-start        Prepara ambiente/build sem iniciar os serviços ao final
  -h, --help            Exibe esta ajuda

Exemplos:
  ./install.sh
  ./install.sh --port 8080 --threads 4
  ./install.sh --interactive
  ./install.sh --local
  ./install.sh --check
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --docker)
        MODE="docker"
        shift
        ;;
      --local)
        MODE="local"
        shift
        ;;
      --check)
        CHECK_ONLY=true
        shift
        ;;
      -p|--port)
        [[ $# -lt 2 ]] && { log_err "Faltou informar a porta após $1."; exit 1; }
        APP_PORT="$2"
        shift 2
        ;;
      -t|--threads)
        [[ $# -lt 2 ]] && { log_err "Faltou informar o número de threads após $1."; exit 1; }
        LAYA_THREADS_VAL="$2"
        shift 2
        ;;
      -i|--interactive)
        INTERACTIVE=true
        shift
        ;;
      --admin-user)
        [[ $# -lt 2 ]] && { log_err "Faltou informar o usuário após $1."; exit 1; }
        CUSTOM_AUTH_USER="$2"
        shift 2
        ;;
      --admin-pass)
        [[ $# -lt 2 ]] && { log_err "Faltou informar a senha após $1."; exit 1; }
        CUSTOM_AUTH_PASS="$2"
        shift 2
        ;;
      --skip-laya)
        SKIP_LAYA=true
        shift
        ;;
      --skip-tests)
        SKIP_TESTS=true
        shift
        ;;
      --no-start)
        NO_START=true
        shift
        ;;
      -h|--help)
        show_help
        exit 0
        ;;
      *)
        log_err "Opção desconhecida: $1"
        show_help
        exit 1
        ;;
    esac
  done

  if ! [[ "$APP_PORT" =~ ^[0-9]+$ ]] || (( APP_PORT < 1 || APP_PORT > 65535 )); then
    log_err "Porta inválida: $APP_PORT (use um número entre 1 e 65535)."
    exit 1
  fi

  if ! [[ "$LAYA_THREADS_VAL" =~ ^[0-9]+$ ]] || (( LAYA_THREADS_VAL < 1 )); then
    log_err "Número de threads inválido: $LAYA_THREADS_VAL."
    exit 1
  fi
}

COMPOSE_CMD=()
detect_compose() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD=(docker compose)
    return 0
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD=(docker-compose)
    return 0
  fi
  return 1
}

run_compose() {
  "${COMPOSE_CMD[@]}" "$@"
}

check_project_files() {
  local required=("package.json" "server.js" "docker-compose.yml" "Dockerfile" "Dockerfile.laya")
  for f in "${required[@]}"; do
    if [[ ! -f "$SCRIPT_DIR/$f" ]]; then
      log_err "Arquivo obrigatório não encontrado: $f (execute a partir da pasta do projeto)."
      exit 1
    fi
  done
  log_ok "Arquivos do projeto validados em $SCRIPT_DIR"
}

ensure_directories() {
  mkdir -p "$SCRIPT_DIR/data" "$SCRIPT_DIR/public/assets/logo"
  log_ok "Diretórios persistentes garantidos (data/ e public/assets/logo/)"
}

prompt_interactive_options() {
  if [[ "$INTERACTIVE" != true ]]; then
    return 0
  fi
  if [[ ! -t 0 ]]; then
    log_warn "Terminal não interativo detectado; mantendo valores padrão."
    return 0
  fi

  printf '\n%sConfiguração inicial:%s\n' "$C_BOLD" "$C_RESET"
  read -r -p "Porta HTTP da aplicação [${APP_PORT}]: " input_port
  if [[ -n "$input_port" ]]; then
    APP_PORT="$input_port"
  fi

  read -r -p "Threads CPU para o Laya AI [${LAYA_THREADS_VAL}]: " input_threads
  if [[ -n "$input_threads" ]]; then
    LAYA_THREADS_VAL="$input_threads"
  fi

  read -r -p "Usuário das Configurações (Enter mantém padrão 'admtati'): " input_user
  if [[ -n "$input_user" ]]; then
    CUSTOM_AUTH_USER="$input_user"
  fi

  read -r -s -p "Senha inicial das Configurações (Enter mantém padrão ou atual): " input_pass
  printf '\n'
  if [[ -n "$input_pass" ]]; then
    CUSTOM_AUTH_PASS="$input_pass"
  fi
}

upsert_env_var() {
  local file="$1"
  local key="$2"
  local val="$3"
  local escaped_line="${key}=${val}"

  if [[ ! -f "$file" ]]; then
    printf '%s\n' "$escaped_line" > "$file"
    return
  fi

  local tmp_file
  tmp_file="$(mktemp)"
  local replaced=false
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" == "${key}="* ]]; then
      printf '%s\n' "$escaped_line" >> "$tmp_file"
      replaced=true
    else
      printf '%s\n' "$line" >> "$tmp_file"
    fi
  done < "$file"

  if [[ "$replaced" != true ]]; then
    printf '%s\n' "$escaped_line" >> "$tmp_file"
  fi
  mv "$tmp_file" "$file"
}

write_env_file() {
  local env_file="$SCRIPT_DIR/.env"
  if [[ ! -f "$env_file" ]]; then
    log_info "Criando arquivo .env inicial..."
    cat > "$env_file" <<EOF
PORT=${APP_PORT}
LAYA_THREADS=${LAYA_THREADS_VAL}
EOF
  else
    log_info "Atualizando PORT e LAYA_THREADS no .env existente (preservando demais variáveis)..."
    upsert_env_var "$env_file" "PORT" "$APP_PORT"
    upsert_env_var "$env_file" "LAYA_THREADS" "$LAYA_THREADS_VAL"
  fi

  if [[ -n "$CUSTOM_AUTH_USER" ]]; then
    upsert_env_var "$env_file" "CONFIG_AUTH_USER" "$CUSTOM_AUTH_USER"
  fi
  if [[ -n "$CUSTOM_AUTH_PASS" ]]; then
    local quoted_pass
    quoted_pass="'${CUSTOM_AUTH_PASS//\'/\'\\\'\'}'"
    upsert_env_var "$env_file" "CONFIG_AUTH_PASS" "$quoted_pass"
  fi

  chmod 600 "$env_file" 2>/dev/null || true
  log_ok "Configuração salva em .env"
}

check_http_health() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 3 "$url" >/dev/null 2>&1
    return $?
  fi
  if command -v node >/dev/null 2>&1; then
    node -e "fetch(process.argv[1]).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" "$url" >/dev/null 2>&1
    return $?
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "import sys, urllib.request; urllib.request.urlopen(sys.argv[1], timeout=3)" "$url" >/dev/null 2>&1
    return $?
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -q -O /dev/null -T 3 "$url" >/dev/null 2>&1
    return $?
  fi
  return 1
}

wait_for_app_health() {
  local url="http://127.0.0.1:${APP_PORT}/api/health"
  log_info "Aguardando aplicação responder em ${url}..."
  for _ in $(seq 1 45); do
    if check_http_health "$url"; then
      log_ok "Aplicação respondendo com sucesso em http://localhost:${APP_PORT}"
      return 0
    fi
    sleep 2
  done
  log_warn "A aplicação ainda não respondeu em ${url}. Verifique os logs com: ${COMPOSE_CMD[*]} logs -f app"
  return 1
}

install_docker_mode() {
  if ! command -v docker >/dev/null 2>&1; then
    log_err "Docker não encontrado. Instale o Docker Engine + Compose plugin e execute novamente:"
    printf '  https://docs.docker.com/engine/install/\n'
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    log_err "Não foi possível conectar ao daemon do Docker."
    printf '  Verifique se o serviço está rodando (sudo systemctl start docker)\n'
    printf '  e se seu usuário tem permissão no grupo docker (sudo usermod -aG docker "$USER").\n'
    exit 1
  fi
  if ! detect_compose; then
    log_err "Docker Compose não encontrado (nem 'docker compose' nem 'docker-compose')."
    exit 1
  fi

  log_ok "Docker ativo e $( "${COMPOSE_CMD[@]}" version | head -n1 )"

  if [[ "$CHECK_ONLY" == true ]]; then
    log_ok "Verificação (--check) no modo Docker concluída sem pendências."
    return 0
  fi

  ensure_directories
  write_env_file

  log_info "Construindo imagens Docker (App + Laya AI)..."
  run_compose build

  if [[ "$NO_START" == true ]]; then
    log_ok "Build concluído (--no-start). Para iniciar depois, execute: ${COMPOSE_CMD[*]} up -d"
    return 0
  fi

  log_info "Subindo containers em segundo plano..."
  run_compose up -d

  wait_for_app_health || true
  run_compose ps

  printf '\n%sInstalacao Docker concluida!%s\n' "$C_GREEN$C_BOLD" "$C_RESET"
  printf '  • Painel principal: %shttp://localhost:%s%s\n' "$C_BOLD" "$APP_PORT" "$C_RESET"
  printf '  • Configurações:    %shttp://localhost:%s/configuracoes%s\n' "$C_BOLD" "$APP_PORT" "$C_RESET"
  printf '  • Nota: na primeira execução, o container ronda-laya baixa o modelo laya-multilingual (~1 min+).\n'
  printf '  • Logs ao vivo:     %s logs -f\n' "${COMPOSE_CMD[*]}"
  printf '  • Parar serviços:   %s down\n\n' "${COMPOSE_CMD[*]}"
}

check_node_version() {
  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    log_err "Node.js (>= 18) e npm são obrigatórios para o modo --local."
    exit 1
  fi
  local major
  major="$(node -p "Number(process.versions.node.split('.')[0])")"
  if (( major < 18 )); then
    log_err "Node.js v${major} detectado. É necessário Node.js 18 ou superior (recomendado 20+)."
    exit 1
  fi
  log_ok "Node.js $(node -v) e npm $(npm -v) disponíveis"
}

install_local_mode() {
  check_node_version

  if [[ "$SKIP_LAYA" != true ]]; then
    if ! command -v python3 >/dev/null 2>&1; then
      log_err "python3 não encontrado. Instale python3 e python3-venv ou use --skip-laya."
      exit 1
    fi
    if ! python3 -m venv --help >/dev/null 2>&1; then
      log_err "Módulo venv do Python ausente (no Ubuntu/Debian: sudo apt install python3-venv)."
      exit 1
    fi
    log_ok "$(python3 --version) com suporte a venv disponível"
  fi

  if [[ "$CHECK_ONLY" == true ]]; then
    log_ok "Verificação (--check) no modo local concluída sem pendências."
    return 0
  fi

  ensure_directories
  write_env_file

  log_info "Instalando dependências Node.js..."
  if [[ -f "$SCRIPT_DIR/package-lock.json" ]]; then
    npm ci
  else
    npm install
  fi

  if [[ "$SKIP_LAYA" != true ]]; then
    if [[ ! -x "$SCRIPT_DIR/.venv/bin/python" ]]; then
      log_info "Criando ambiente virtual Python em .venv/..."
      python3 -m venv "$SCRIPT_DIR/.venv"
    fi
    log_info "Instalando PyTorch (CPU) e laya[serve] em .venv/ (pode levar alguns minutos)..."
    "$SCRIPT_DIR/.venv/bin/python" -m pip install --upgrade pip
    "$SCRIPT_DIR/.venv/bin/python" -m pip install torch --index-url https://download.pytorch.org/whl/cpu
    "$SCRIPT_DIR/.venv/bin/python" -m pip install "laya[serve]"
    log_ok "Laya AI configurado em .venv/"
  else
    log_warn "Instalação do Laya local ignorada (--skip-laya). O app usará fallback heurístico."
  fi

  if [[ "$SKIP_TESTS" != true ]]; then
    log_info "Executando suíte de testes..."
    npm test
    log_ok "Todos os testes passaram!"
  fi

  printf '\n%sInstalacao local concluida!%s\n' "$C_GREEN$C_BOLD" "$C_RESET"
  printf '  • Para iniciar: %sPORT=%s npm start%s\n' "$C_BOLD" "$APP_PORT" "$C_RESET"
  printf '  • Painel:       http://localhost:%s\n\n' "$APP_PORT"

  if [[ "$NO_START" != true && "$INTERACTIVE" == true ]]; then
    read -r -p "Deseja iniciar o servidor agora? [s/N] " start_now
    if [[ "$start_now" =~ ^[sSyY]$ ]]; then
      PORT="$APP_PORT" exec npm start
    fi
  fi
}

main() {
  parse_args "$@"
  printf '%s=== Escargot News — Instalador (%s) ===%s\n' "$C_BOLD" "$MODE" "$C_RESET"
  check_project_files

  if [[ "$CHECK_ONLY" != true ]]; then
    prompt_interactive_options
  fi

  if [[ "$MODE" == "docker" ]]; then
    install_docker_mode
  else
    install_local_mode
  fi
}

main "$@"
