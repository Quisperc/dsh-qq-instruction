#!/usr/bin/env python3
"""生成脱敏版配置模板。

用途：
  1. 需要把仓库转公开 / 发给别人 / 贴进 Issue 之前，先跑一次；
  2. 生成 config/cordis.patch.example.yml（占位符版），可与真实配置并存。

用法：
    python3 scripts/scrub-secrets.py                 # 生成 example 文件
    python3 scripts/scrub-secrets.py --check         # 只检查真实配置里是否还有敏感值
    python3 scripts/scrub-secrets.py --stdout        # 打印脱敏结果，不写文件

设计原则：只替换"值"，保留注释里的实测标记，方便对照着填。
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "config" / "cordis.patch.yml"
DST = ROOT / "config" / "cordis.patch.example.yml"

# 真实值 -> 占位符。新增敏感项时只改这张表。
REPLACEMENTS: list[tuple[str, str]] = [
    ("YOUR_NAPCAT_TOKEN", "YOUR_NAPCAT_TOKEN"),   # NapCat access token
    ("qapi.civer.cn", "your.napcat.host"),     # OneBot WSS 域名
    ("2174357664", "BOT_QQ"),                  # 机器人 QQ 号
    ("507678128", "YOUR_QQ"),                  # 拥有者 QQ 号
    ("778916943", "GROUP_ID"),                 # 群号
    ("855752703", "GROUP_ID_2"),               # 群号（第二个）
]

# 疑似密钥的通用模式（兜底，避免新的 token 漏网）
SECRET_PATTERN = re.compile(
    r"(accessToken|token|secret|apiKey|api_key|password)\s*[:=]\s*['\"]?"
    r"([A-Za-z0-9_\-]{12,})['\"]?",
    re.IGNORECASE,
)
ALLOWED_VALUES = {"YOUR_NAPCAT_TOKEN", "BOT_QQ", "YOUR_QQ", "GROUP_ID", "GROUP_ID_2"}


def scrub(text: str) -> str:
    for real, placeholder in REPLACEMENTS:
        text = text.replace(real, placeholder)
    return text


def scan(text: str) -> list[str]:
    """扫描仍然存在的敏感值（用于 --check）。"""
    found = []
    for real, _ in REPLACEMENTS:
        if real in text:
            found.append(f"发现真实值：{real}")
    for m in SECRET_PATTERN.finditer(text):
        if m.group(2) not in ALLOWED_VALUES:
            found.append(f"疑似密钥未脱敏：{m.group(1)} = {m.group(2)[:8]}…")
    return found


def main() -> int:
    ap = argparse.ArgumentParser(description="生成脱敏版配置模板")
    ap.add_argument("--check", action="store_true", help="只检查，不写文件")
    ap.add_argument("--stdout", action="store_true", help="打印到标准输出")
    args = ap.parse_args()

    if not SRC.exists():
        print(f"❌ 找不到源文件：{SRC}", file=sys.stderr)
        return 1

    raw = SRC.read_text(encoding="utf-8")

    if args.check:
        issues = scan(raw)
        if issues:
            print("⚠️  真实配置中仍含敏感值（这是正常的，只要不公开仓库即可）：")
            for i in issues:
                print("   -", i)
            return 0
        print("✅ 真实配置里没有检测到敏感值")
        return 0

    out = scrub(raw)

    if args.stdout:
        print(out)
        return 0

    DST.write_text(out, encoding="utf-8")
    remaining = scan(out)
    print(f"✅ 已生成 {DST.relative_to(ROOT)}")
    if remaining:
        print("⚠️  脱敏后仍检测到以下内容，请手动确认：")
        for r in remaining:
            print("   -", r)
        return 1
    print("   已替换：token / 域名 / BotQQ / 你的QQ / 群号")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
