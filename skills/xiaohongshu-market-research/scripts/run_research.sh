#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
KEYWORD="${1:-}"
NOTE_COUNT="${2:-20}"
COMMENT_COUNT="${3:-30}"
SUB_COMMENT_COUNT="${4:-10}"
OUTPUT_PATH="${5:-}"

if [[ -z "$KEYWORD" ]]; then
  echo "用法: bash scripts/run_research.sh <关键词> [帖子数] [评论数] [二级评论数] [输出文件]" >&2
  exit 1
fi

cd "$ROOT_DIR"

CMD=(node scripts/xhs_fetch.js --keyword "$KEYWORD" --notes "$NOTE_COUNT" --comments "$COMMENT_COUNT" --sub-comments "$SUB_COMMENT_COUNT")
if [[ -n "$OUTPUT_PATH" ]]; then
  CMD+=(--output "$OUTPUT_PATH")
fi

"${CMD[@]}"
