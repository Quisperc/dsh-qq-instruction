#!/usr/bin/env python3
"""校验仓库内所有 Markdown 的相对链接是否指向真实文件。

用法：
    python3 scripts/check-links.py            # 检查全部
    python3 scripts/check-links.py --fix-info # 额外打印每个文件的链接数

退出码：0 = 全部有效；1 = 存在断链。
CI 或提交前跑一次，可以避免重组目录后出现大面积失效引用。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LINK_RE = re.compile(r"\]\(([^)#\s]+)\)")
SKIP_PREFIX = ("http://", "https://", "mailto:", "#")


def main() -> int:
    verbose = "--fix-info" in sys.argv
    broken: list[str] = []
    total_files = 0
    total_links = 0

    for md in sorted(ROOT.rglob("*.md")):
        if "node_modules" in md.parts:
            continue
        total_files += 1
        text = md.read_text(encoding="utf-8")
        for m in LINK_RE.finditer(text):
            target = m.group(1)
            if target.startswith(SKIP_PREFIX):
                continue
            total_links += 1
            real = (md.parent / target).resolve()
            if not real.exists():
                broken.append(f"{md.relative_to(ROOT)}  ->  {target}")

    print(f"Markdown 文件：{total_files}    相对链接：{total_links}")
    if broken:
        print(f"❌ 断链 {len(broken)} 处：")
        for b in broken:
            print("   ✗", b)
        return 1
    print("✅ 全部链接有效")
    if verbose:
        print("（--fix-info 仅用于排查，脚本不会自动改文件）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
