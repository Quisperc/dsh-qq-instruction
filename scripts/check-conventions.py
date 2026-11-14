#!/usr/bin/env python3
"""机械校验 CONTRIBUTING.md 里那些**能被自动检查**的规范。

为什么要有它：本项目由不同的人 / 不同的模型在不同的会话里跟进。
规范写在文档里，靠"读"一定会漏——新人不知道有这条，模型上下文里没这段。
能被脚本判定的部分就没必要靠自觉。

覆盖范围（对应 CONTRIBUTING 的条款）：
    §1.1  packages/ 改了代码必须 bump 包版本
    §2    docs/ 下新增的文档必须注册进 docs/README.md
    §4    ADR 编号连续、状态词汇合法、字段格式统一
    §6    版本号双轨：CHANGELOG 顶部条目登记的插件版本 == package.json 的 version
    §10   待办只记在顶层 TODO.md；README 必须指向它

用法：
    python3 scripts/check-conventions.py            # 检查全部
    python3 scripts/check-conventions.py --since 5  # 只看最近 5 个提交涉及的版本 bump

退出码：0 = 合规；1 = 有违规（会打印具体条目与对应条款）。
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
DECISIONS = DOCS / "04-explanation" / "decisions"
PKG = ROOT / "packages"

# CONTRIBUTING §4：状态词汇只有一个集合
VALID_STATUS = ("提议", "已接受", "已接受（已实施）", "已废弃")


def git(*args: str) -> str:
    """跑 git，跑不动就返回空串（没有 git 时相关检查自动跳过）。"""
    try:
        out = subprocess.run(
            ["git", *args], cwd=ROOT, capture_output=True, text=True, check=False
        )
        return out.stdout.strip() if out.returncode == 0 else ""
    except FileNotFoundError:
        return ""


def changed_files(since: int) -> list[str]:
    """最近 N 个提交里改动过的文件（相对路径）。"""
    if since <= 0:
        return []
    return [p for p in git("diff", "--name-only", f"HEAD~{since}", "HEAD").splitlines() if p]


# ---------------------------------------------------------------- 各项检查


def check_pkg_version_bump(since: int, problems: list[str]) -> None:
    """§1.1 / §6：动了 packages/ 下的代码，包版本必须 bump，否则真机不会重新拉 bundle。"""
    changed = changed_files(since)
    if not changed:
        return
    touched_code = [p for p in changed if p.startswith("packages/") and "/lib/" in p]
    if not touched_code:
        return

    version_changed = any(
        p.endswith("package.json") and p.startswith("packages/") for p in changed
    )
    if not version_changed:
        problems.append(
            "§1.1 动了 packages/*/lib/ 但没 bump 包版本 —— "
            "真机上已装的同版本不会重新拉 bundle，改动等于没发布。"
            f"涉及：{', '.join(touched_code[:5])}"
        )


def check_changelog_pkg_version(problems: list[str]) -> None:
    """§6 双轨：CHANGELOG 顶部条目登记的插件版本要与 package.json 的实际版本对得上。"""
    changelog = ROOT / "CHANGELOG.md"
    if not changelog.exists():
        return
    head = changelog.read_text(encoding="utf-8")[:1200]
    m = re.search(r"^##\s*\[[^\]]+\][^\n]*?插件\s*v([\d.]+)", head, re.M)
    if not m:
        return  # 该版本没动插件，不强制登记
    declared = m.group(1)

    for pkg_json in sorted(PKG.glob("*/package.json")):
        try:
            actual = json.loads(pkg_json.read_text(encoding="utf-8")).get("version")
        except (json.JSONDecodeError, OSError):
            continue
        if actual and actual != declared:
            problems.append(
                f"§6 版本号双轨不一致：CHANGELOG 顶部写插件 v{declared}，"
                f"{pkg_json.relative_to(ROOT)} 实际是 {actual}"
            )


def check_docs_registered(problems: list[str]) -> None:
    """§2：docs/ 下新增的文档必须注册进 docs/README.md 索引。

    ADR 例外：它们按目录整体注册（一行简述 + 目录链接），逐篇列会变成一张 11 行的清单，
    没人维护得下去。所以只要求 `decisions/` 这个目录本身出现在索引里。
    """
    index = DOCS / "README.md"
    if not index.exists():
        return
    index_text = index.read_text(encoding="utf-8")

    if "decisions/" not in index_text:
        problems.append("§2 docs/README.md 没有注册 04-explanation/decisions/ 目录")

    for md in sorted(DOCS.rglob("*.md")):
        if md.name == "README.md" or md.parent.name == "decisions":
            continue
        rel = md.relative_to(DOCS).as_posix()
        if rel not in index_text:
            problems.append(f"§2 文档未注册进 docs/README.md：{rel}")


def check_adr(problems: list[str]) -> None:
    """§4：ADR 编号连续、状态词汇合法、字段格式统一。"""
    files = sorted(DECISIONS.glob("ADR-*.md"))
    if not files:
        return

    numbers: list[int] = []
    for f in files:
        m = re.match(r"ADR-(\d+)-", f.name)
        if not m:
            problems.append(f"§4 ADR 文件名不符合 ADR-NNN-标题.md：{f.name}")
            continue
        numbers.append(int(m.group(1)))

        text = f.read_text(encoding="utf-8")
        head = "\n".join(text.splitlines()[:12])

        sm = re.search(r"^-\s*\*{0,2}状态\*{0,2}[:：]\s*(.+)$", head, re.M)
        if not sm:
            problems.append(f"§4 {f.name} 缺状态字段")
        else:
            status = sm.group(1).strip()
            if not any(status.startswith(v) for v in VALID_STATUS):
                problems.append(
                    f"§4 {f.name} 状态词汇不在白名单（{status}）——"
                    f"只能用：{' / '.join(VALID_STATUS)}"
                )
            if "**状态**" not in head:
                problems.append(f"§4 {f.name} 状态字段未加粗，应为 `- **状态**：…`")

    expected = list(range(1, len(numbers) + 1))
    if sorted(numbers) != expected:
        problems.append(f"§4 ADR 编号不连续：现有 {numbers}，应为 {expected}")


def check_todo(problems: list[str]) -> None:
    """§10：待办只记在顶层 TODO.md，且 README 要指向它。"""
    todo = ROOT / "TODO.md"
    if not todo.exists():
        problems.append("§10 缺顶层 TODO.md —— 待办散在各处，多模型跟进必然漏读")
        return
    readme = ROOT / "README.md"
    if readme.exists() and "TODO.md" not in readme.read_text(encoding="utf-8"):
        problems.append("§10 README.md 没有指向 TODO.md，接手的人看不到待办在哪")


# ---------------------------------------------------------------- 入口


def main() -> int:
    since = 1
    if "--since" in sys.argv:
        try:
            since = int(sys.argv[sys.argv.index("--since") + 1])
        except (ValueError, IndexError):
            since = 1

    problems: list[str] = []
    check_adr(problems)
    check_docs_registered(problems)
    check_changelog_pkg_version(problems)
    check_pkg_version_bump(since, problems)
    check_todo(problems)

    if problems:
        print(f"❌ 规范检查未通过（{len(problems)} 项）：\n")
        for p in problems:
            print("   ✗", p)
        print("\n对应条款见 CONTRIBUTING.md。修完再提交。")
        return 1

    print("✅ 规范检查通过（ADR 编号/状态、文档索引、版本双轨、待办归集）")
    print(f"   ADR {len(list(DECISIONS.glob('ADR-*.md')))} 篇 · "
          f"包 {len(list(PKG.glob('*/package.json')))} 个")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
