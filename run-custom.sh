#!/usr/bin/env bash
# ============================================================================
# OpenClaw Custom Instance — Isolated Runner
# ============================================================================
# 기존 ~/.openclaw 인스턴스와 완전히 격리된 환경으로 실행합니다.
#
# 격리 항목:
#   - 상태 디렉토리:  ~/.openclaw-custom/
#   - 설정 파일:     ~/.openclaw-custom/openclaw.json
#   - 게이트웨이 포트: 19789 (기존: 18789)
#   - 프로필:        custom (launchd: ai.openclaw.custom)
#   - 세션/인증/미디어: 모두 ~/.openclaw-custom/ 하위
#
# 사용법:
#   ./run-custom.sh                    # 게이트웨이 실행 (포그라운드)
#   ./run-custom.sh gateway            # 위와 동일
#   ./run-custom.sh gateway --verbose  # 상세 로그
#   ./run-custom.sh onboard            # 온보딩 마법사
#   ./run-custom.sh status             # 상태 확인
#   ./run-custom.sh config set <k> <v> # 설정 변경
#   ./run-custom.sh doctor             # 진단
#   ./run-custom.sh <any-command>      # 모든 openclaw CLI 명령어
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="$HOME/.openclaw-custom"

# ── 격리 환경변수 설정 ──────────────────────────────────────────────────────
export OPENCLAW_STATE_DIR="$STATE_DIR"
export OPENCLAW_CONFIG_PATH="$STATE_DIR/openclaw.json"
export OPENCLAW_GATEWAY_PORT="19789"
export OPENCLAW_PROFILE="custom"

# ── 상태 디렉토리 자동 생성 ─────────────────────────────────────────────────
mkdir -p "$STATE_DIR"/{credentials,sessions,agents/main/sessions,media,workspace,logs,hooks}

# ── 기본 설정 파일 생성 (없을 경우) ─────────────────────────────────────────
if [ ! -f "$OPENCLAW_CONFIG_PATH" ]; then
  cat > "$OPENCLAW_CONFIG_PATH" << 'DEFAULTCFG'
{
  "gateway": {
    "mode": "local",
    "port": 19789,
    "bind": "loopback"
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/claude-opus-4-6"
      }
    }
  }
}
DEFAULTCFG
  echo "[openclaw-custom] Created default config: $OPENCLAW_CONFIG_PATH"
fi

# ── 명령어 라우팅 ──────────────────────────────────────────────────────────
CMD="${1:-gateway}"

if [ "$CMD" = "gateway" ] && [ $# -le 1 ]; then
  # 기본: 게이트웨이 포그라운드 실행
  echo ""
  echo "  ┌─────────────────────────────────────────────┐"
  echo "  │  OpenClaw Custom Instance                   │"
  echo "  │  State:  $STATE_DIR"
  echo "  │  Config: $OPENCLAW_CONFIG_PATH"
  echo "  │  Port:   $OPENCLAW_GATEWAY_PORT"
  echo "  │  Profile: $OPENCLAW_PROFILE"
  echo "  └─────────────────────────────────────────────┘"
  echo ""
  exec pnpm openclaw gateway run --port "$OPENCLAW_GATEWAY_PORT" --bind loopback
else
  exec pnpm openclaw "$@"
fi
