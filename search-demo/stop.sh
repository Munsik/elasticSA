#!/usr/bin/env bash
# =============================================================================
# stop.sh — search-demo 애플리케이션 중지
#
# 사용법:
#   ./stop.sh           # 백엔드 + 프론트엔드 모두 중지
#   ./stop.sh backend   # 백엔드만 중지
#   ./stop.sh frontend  # 프론트엔드만 중지
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIDS_DIR="$SCRIPT_DIR/.pids"
TARGET="${1:-all}"

# -----------------------------------------------------------------------------
# 색상 출력 유틸
# -----------------------------------------------------------------------------
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

# -----------------------------------------------------------------------------
# 프로세스 종료
# -----------------------------------------------------------------------------
stop_service() {
  local name="$1"
  local pid_file="$PIDS_DIR/$name.pid"

  if [[ ! -f "$pid_file" ]]; then
    warn "$name: PID 파일이 없습니다. 이미 중지된 상태일 수 있습니다."
    return
  fi

  local pid
  pid=$(cat "$pid_file")

  if ! kill -0 "$pid" 2>/dev/null; then
    warn "$name: PID $pid 프로세스가 이미 종료되어 있습니다."
    rm -f "$pid_file"
    return
  fi

  info "$name 중지 중... (PID: $pid)"
  kill "$pid" 2>/dev/null || true

  # 정상 종료 대기 (최대 5초)
  local count=0
  while kill -0 "$pid" 2>/dev/null; do
    sleep 0.5
    ((count++))
    if (( count >= 10 )); then
      warn "$name 강제 종료 (SIGKILL)..."
      kill -9 "$pid" 2>/dev/null || true
      break
    fi
  done

  rm -f "$pid_file"
  info "$name 중지 완료 ✓"
}

# -----------------------------------------------------------------------------
# 메인
# -----------------------------------------------------------------------------
echo ""
echo "=========================================="
echo "  search-demo  —  중지"
echo "=========================================="
echo ""

case "$TARGET" in
  backend)  stop_service backend  ;;
  frontend) stop_service frontend ;;
  all)
    stop_service frontend
    stop_service backend
    echo ""
    info "모든 서비스가 중지되었습니다."
    ;;
  *)
    error "알 수 없는 대상: $TARGET  (사용 가능: all | backend | frontend)"
    exit 1
    ;;
esac

echo ""
