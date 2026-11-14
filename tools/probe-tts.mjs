#!/usr/bin/env node
// 语音合成验证 / 生成工具（已实测可用）
//
// 用法：
//   npm i ws                                   # 只此一个依赖
//   export DASHSCOPE_API_KEY=sk-xxxx
//   node tools/probe-tts.mjs --text "我才不胖呢" --voice longanlingxi --out /tmp/voice.wav
//   node tools/probe-tts.mjs --list-voices     # 打印该模型支持的全部音色
//
// 注意：龙灵安希只有 WebSocket 实时接口支持，HTTP 的 qwen3-tts-flash 没有这个音色。

import fs from "node:fs";
import { createRequire } from "node:module";

// 从脚本目录、当前工作目录依次尝试解析 ws，避免必须把依赖装到交付目录里
let WebSocket = null;
for (const base of [import.meta.url, `file://${process.cwd()}/x.js`]) {
  try {
    WebSocket = createRequire(base)("ws");
    break;
  } catch { /* 换下一个位置 */ }
}
if (!WebSocket) {
  console.error("缺少依赖 ws。请在任意目录执行 `npm i ws`，然后在该目录下运行本脚本；");
  console.error("或在本脚本所在目录执行 `npm i ws`。");
  process.exit(1);
}

const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith("--")) continue;
  const next = argv[i + 1];
  args[argv[i].slice(2)] = !next || next.startsWith("--") ? true : next;
}

const KEY = process.env.DASHSCOPE_API_KEY || process.env.DSK;
const MODEL = args.model || "qwen-audio-3.1-realtime-flash";
const VOICE = args.voice || "longanlingxi";
const TEXT = args.text || "我才不胖呢，一点都不。";
const INSTRUCTION = args.instruction || "";
const OUT = args.out || "/tmp/tts-out.wav";
const SAMPLE_RATE = Number(args.rate || 24000);

if (!KEY) {
  console.error("请先设置环境变量 DASHSCOPE_API_KEY");
  process.exit(1);
}

function pcmToWav(pcm, sampleRate = SAMPLE_RATE, channels = 1, bits = 16) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE((sampleRate * channels * bits) / 8, 28);
  header.writeUInt16LE((channels * bits) / 8, 32);
  header.writeUInt16LE(bits, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function callRealtime({ voice, text, instruction }) {
  return new Promise((resolve) => {
    const url = `wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=${MODEL}`;
    const ws = new WebSocket(url, {
      headers: { Authorization: `Bearer ${KEY}`, "OpenAI-Beta": "realtime=v1" },
      handshakeTimeout: 15000,
    });
    const finish = (r) => { try { ws.terminate(); } catch {} resolve(r); };
    const timer = setTimeout(() => finish({ type: "error", message: "超时（25s）" }), 25000);

    const chunks = [];
    let voiceList = null;
    let lastErr = null;

    ws.on("open", () => {
      ws.send(JSON.stringify({
        event_id: "1",
        type: "session.update",
        session: {
          voice,
          modalities: ["text", "audio"],        // 必须含 text，否则报 Must include 'text'
          output_audio_format: "pcm",
          turn_detection: null,
        },
      }));
      setTimeout(() => {
        // 必须用 conversation.item.create，input_text_buffer.append 会报 no messages
        ws.send(JSON.stringify({
          event_id: "2", type: "conversation.item.create",
          item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
        }));
        ws.send(JSON.stringify({
          event_id: "3", type: "response.create",
          response: { modalities: ["text", "audio"], instructions: instruction || "" },
        }));
      }, 800);
    });

    ws.on("message", (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.type === "error") {
        const msg = m.error?.message || "";
        if (msg.includes("Supported voices")) { voiceList = msg; return; }
        lastErr = msg || JSON.stringify(m).slice(0, 200);
        return;
      }
      if (m.type === "response.audio.delta" && m.delta) chunks.push(Buffer.from(m.delta, "base64"));
      if (m.type === "response.done") {
        clearTimeout(timer);
        const pcm = Buffer.concat(chunks);
        if (pcm.length > 0) finish({ type: "ok", pcm });
        else finish({ type: "error", message: voiceList || lastErr || "未收到音频" });
      }
    });

    ws.on("error", (e) => { clearTimeout(timer); finish({ type: "error", message: (e.message || "连接失败").slice(0, 200) }); });
  });
}

// ---------- 打印音色表 ----------
if (args["list-voices"]) {
  const r = await callRealtime({ voice: "__probe_invalid__", text: "测试", instruction: "" });
  if (r.type === "error" && r.message.includes("Supported voices")) {
    const list = r.message.split("Supported voices:")[1].trim().split(",").map((s) => s.trim());
    console.log(`${MODEL} 支持 ${list.length} 个音色：\n`);
    const cols = list.map((v) => v.padEnd(22));
    for (let i = 0; i < cols.length; i += 3) console.log("  " + cols.slice(i, i + 3).join(""));
  } else {
    console.log("未能取回音色表：", r.message);
  }
  process.exit(0);
}

console.log(`合成：model=${MODEL} voice=${VOICE}`);
console.log(`文本：${TEXT}${INSTRUCTION ? `\n语气：${INSTRUCTION}` : ""}`);
const r = await callRealtime({ voice: VOICE, text: TEXT, instruction: INSTRUCTION });

if (r.type === "ok") {
  fs.writeFileSync(OUT, pcmToWav(r.pcm));
  const seconds = (r.pcm.length / 2 / SAMPLE_RATE).toFixed(1);
  console.log(`\n✅ 成功：${r.pcm.length} 字节 PCM（约 ${seconds} 秒）\n   已写入 ${OUT}`);
  console.log("   播放验证： ffplay " + OUT + "  或下载到本地试听");
} else {
  console.error("❌ 失败：" + r.message);
  process.exit(1);
}
