#!/usr/bin/env bash
# 一次把 main 推到 GitHub（主源）与 CNB（镜像）。
#
# 为什么用脚本而不是 `git remote set-url --push`：
#   双推送需要在 URL 里带令牌，而令牌一旦写进 .git/config 就是明文长期驻留
#   （`git push -u <带令牌的 URL>` 会把令牌写进 branch.<name>.remote，已经踩过一次）。
#   这里改成从环境变量读，用完即弃，仓库与 .git 里都不留凭据。
#
# 用法：
#   GITHUB_TOKEN=ghp_xxx CNB_TOKEN=xxx bash scripts/push-all.sh
#   GITHUB_TOKEN=... CNB_TOKEN=... bash scripts/push-all.sh --force    # 重写历史后需要
#
# 退出码：两个都成功才 0；任一失败为 1（另一个照常尝试，不中断）。
set -uo pipefail

GH_OWNER_REPO="${GH_OWNER_REPO:-Quisperc/dsh-qq-instruction}"
CNB_OWNER_REPO="${CNB_OWNER_REPO:-civer/dsh-qq-instruction}"
BRANCH="${BRANCH:-main}"
FORCE=""
if [ "${1:-}" = "--force" ]; then FORCE="--force"; fi

if [ -z "${GITHUB_TOKEN:-}" ] || [ -z "${CNB_TOKEN:-}" ]; then
  echo "✗ 需要同时提供 GITHUB_TOKEN 与 CNB_TOKEN（只赋一个也行，见下）" >&2
  echo "  例：GITHUB_TOKEN=xxx CNB_TOKEN=yyy bash scripts/push-all.sh" >&2
fi

status=0

if [ -n "${GITHUB_TOKEN:-}" ]; then
  echo "→ GitHub（$GH_OWNER_REPO）"
  if GIT_TERMINAL_PROMPT=0 git push $FORCE \
      "https://x-access-token:${GITHUB_TOKEN}@github.com/${GH_OWNER_REPO}.git" "$BRANCH" 2>&1 | tail -3; then
    echo "  ✓ GitHub 完成"
  else
    echo "  ✗ GitHub 失败" >&2; status=1
  fi
else
  echo "! 跳过 GitHub（未提供 GITHUB_TOKEN）"
fi

if [ -n "${CNB_TOKEN:-}" ]; then
  echo "→ CNB（$CNB_OWNER_REPO）"
  if GIT_TERMINAL_PROMPT=0 git push $FORCE \
      "https://cnb:${CNB_TOKEN}@cnb.cool/${CNB_OWNER_REPO}.git" "$BRANCH" 2>&1 | tail -3; then
    echo "  ✓ CNB 完成"
  else
    echo "  ✗ CNB 失败" >&2; status=1
  fi
else
  echo "! 跳过 CNB（未提供 CNB_TOKEN）"
fi

exit $status
