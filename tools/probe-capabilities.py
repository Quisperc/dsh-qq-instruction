#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
能力自检脚本 —— 用你的 DashScope API Key 逐项验证机器人依赖的每一个模型是否可用。

用法：
    export DASHSCOPE_API_KEY=sk-xxxx
    python3 tools/probe-capabilities.py

退出码：0 = 全部通过；1 = 有项目不可用（会打印具体是哪一项）。
"""
import base64
import json
import os
import sys
import urllib.request

BASE = "https://dashscope.aliyuncs.com"
KEY = os.environ.get("DASHSCOPE_API_KEY") or os.environ.get("DSK", "")
OK, FAIL, SKIP = "✅", "❌", "⏭"
results = []


def post(path, body, timeout=90):
    url = BASE + path
    headers = {"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers)
    try:
        return 200, urllib.request.urlopen(req, timeout=timeout).read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except Exception as e:  # noqa: BLE001
        return 0, str(e)


def get(path, timeout=30):
    req = urllib.request.Request(BASE + path, headers={"Authorization": f"Bearer {KEY}"})
    try:
        return 200, urllib.request.urlopen(req, timeout=timeout).read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except Exception as e:  # noqa: BLE001
        return 0, str(e)


def record(name, ok, detail=""):
    results.append((name, ok, detail))
    icon = OK if ok else (SKIP if ok is None else FAIL)
    print(f"{icon} {name}" + (f"  —— {detail}" if detail else ""))


# 32×32 纯红 PNG，用于视觉测试（必须是合法图像，否则服务端返回 400 InternalError）
TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAALUlEQVR4nGO8I2LDQEvARFPTRy0YtWDUglELRi0YtWDUglELRi0YtWDUAioCAMTJAWxH2iarAAAAAElFTkSuQmCC"


def main():
    if not KEY:
        print("请先设置环境变量 DASHSCOPE_API_KEY")
        return 1

    # ---------- 1. 文本大模型 ----------
    code, body = post("/compatible-mode/v1/chat/completions", {
        "model": "qwen3.8-max",
        "messages": [{"role": "user", "content": "只回答两个字：可用"}],
        "max_tokens": 20,
    })
    txt = json.loads(body).get("choices", [{}])[0].get("message", {}).get("content", "") if code == 200 else body[:120]
    record("LLM 文本 qwen3.8-max", code == 200, txt.strip()[:40])

    # ---------- 2. 视觉（多候选，取第一个可用） ----------
    vision = None
    for model in ["qwen3-vl-plus", "qwen3.8-omni-flash", "qwen-vl-max"]:
        code, body = post("/compatible-mode/v1/chat/completions", {
            "model": model,
            "messages": [{"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{TINY_PNG}"}},
                {"type": "text", "text": "这张图主色是什么？只回答颜色"}]}],
            "max_tokens": 30,
        }, timeout=60)
        if code == 200:
            vision = model
            txt = json.loads(body).get("choices", [{}])[0].get("message", {}).get("content", "")
            record(f"视觉 {model}", True, txt.strip()[:40])
            break
        print(f"… 视觉候选 {model} 不可用（{code}）")
    if not vision:
        record("视觉（全部候选）", False, "该网关下没有可用的视觉模型")

    # ---------- 3. 生图 ----------
    code, body = post("/api/v1/services/aigc/multimodal-generation/generation", {
        "model": "qwen-image-3.0",
        "input": {"messages": [{"role": "user", "content": [{"text": "一只蓝色小鲸鱼，极简线条"}]}]},
        "parameters": {"size": "1024*1024", "n": 1},
    }, timeout=120)
    ok = code == 200 and ("url" in body or "image" in body)
    record("生图 qwen-image-3.0", ok, body[:100] if not ok else "已提交")

    # ---------- 4. TTS（实时 WebSocket）+ 音色 longanlingxi ----------
    print("… 实时 TTS 需要 WebSocket，单独用 tools/probe-tts.mjs 验证")
    record("TTS qwen-audio-3.1-realtime-flash / longanlingxi", None, "见 tools/probe-tts.mjs")

    # ---------- 5. 模型清单 ----------
    code, body = get("/compatible-mode/v1/models")
    if code == 200:
        ids = [m["id"] for m in json.loads(body).get("data", [])]
        record("模型清单拉取", True, f"共 {len(ids)} 个模型")
        for need in ["qwen-audio-3.1-realtime-flash", "qwen-audio-3.0-asr-flash", "qwen-image-3.0"]:
            record(f"模型在列表中 {need}", need in ids)
    else:
        record("模型清单拉取", False, body[:120])

    failed = [n for n, ok, _ in results if ok is False]
    print("\n" + "=" * 50)
    print(f"通过 {sum(1 for _, ok, _ in results if ok)} / {len(results)}")
    if failed:
        print("不可用：", "、".join(failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
