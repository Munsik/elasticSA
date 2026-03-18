#!/usr/bin/env bash
# =============================================================================
# start.sh — search-demo 애플리케이션 백그라운드 시작
#
# 사용법:
#   ./start.sh          # 백엔드 + 프론트엔드 모두 시작
#   ./start.sh backend  # 백엔드만 시작
#   ./start.sh frontend # 프론트엔드만 시작
#
# 프로세스 PID: .pids/ 디렉터리에 저장
# 로그 파일:   .logs/ 디렉터리에 저장
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIDS_DIR="$SCRIPT_DIR/.pids"
LOGS_DIR="$SCRIPT_DIR/.logs"
TARGET="${1:-all}"

mkdir -p "$PIDS_DIR" "$LOGS_DIR"

# -----------------------------------------------------------------------------
# 색상 출력 유틸
# -----------------------------------------------------------------------------
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; }

# -----------------------------------------------------------------------------
# 이미 실행 중인지 확인
# -----------------------------------------------------------------------------
is_running() {
  local pid_file="$PIDS_DIR/$1.pid"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid=$(cat "$pid_file")
    if kill -0 "$pid" 2>/dev/null; then
      return 0   # 실행 중
    fi
  fi
  return 1   # 실행 중 아님
}

# -----------------------------------------------------------------------------
# 백엔드 시작 (Node.js / Express — port 3000)
# -----------------------------------------------------------------------------
start_backend() {
  if is_running backend; then
    warn "백엔드가 이미 실행 중입니다. (PID: $(cat "$PIDS_DIR/backend.pid"))"
    return
  fi

  info "백엔드 시작 중... (port 3000)"
  cd "$SCRIPT_DIR/backend"

  nohup node --import ./instrument.mjs src/index.js \
    >> "$LOGS_DIR/backend.log" 2>&1 &
  local pid=$!
  echo "$pid" > "$PIDS_DIR/backend.pid"

  # 서버 기동 대기 (최대 15초)
  local count=0
  while ! curl -sf http://localhost:3000/api/health > /dev/null 2>&1; do
    sleep 1
    ((count++))
    if (( count >= 15 )); then
      error "백엔드 기동 타임아웃 (15초 초과). 로그를 확인하세요: $LOGS_DIR/backend.log"
      return 1
    fi
  done

  info "백엔드 기동 완료 ✓  PID=$pid  →  http://localhost:3000"
}

# -----------------------------------------------------------------------------
# 프론트엔드 시작 (Vite dev server — port 5173)
# -----------------------------------------------------------------------------
start_frontend() {
  if is_running frontend; then
    warn "프론트엔드가 이미 실행 중입니다. (PID: $(cat "$PIDS_DIR/frontend.pid"))"
    return
  fi

  info "프론트엔드 시작 중... (port 5173)"
  cd "$SCRIPT_DIR/frontend"

  nohup npx vite --host 0.0.0.0 \
    >> "$LOGS_DIR/frontend.log" 2>&1 &
  local pid=$!
  echo "$pid" > "$PIDS_DIR/frontend.pid"

  # Vite 기동 대기 (최대 15초)
  local count=0
  while ! curl -sf http://localhost:5173 > /dev/null 2>&1; do
    sleep 1
    ((count++))
    if (( count >= 15 )); then
      error "프론트엔드 기동 타임아웃 (15초 초과). 로그를 확인하세요: $LOGS_DIR/frontend.log"
      return 1
    fi
  done

  info "프론트엔드 기동 완료 ✓  PID=$pid  →  http://localhost:5173"
}

# -----------------------------------------------------------------------------
# 메인
# -----------------------------------------------------------------------------
echo ""
echo "=========================================="
echo "  search-demo  —  시작"
echo "=========================================="
echo ""

case "$TARGET" in
  backend)  start_backend  ;;
  frontend) start_frontend ;;
  all)
    start_backend
    start_frontend
    echo ""
    info "모든 서비스가 기동되었습니다."
    info "  백엔드:    http://localhost:3000"
    info "  프론트엔드: http://localhost:5173"
    info "  로그:      $LOGS_DIR/"
    ;;
  *)
    error "알 수 없는 대상: $TARGET  (사용 가능: all | backend | frontend)"
    exit 1
    ;;
esac

echo ""
