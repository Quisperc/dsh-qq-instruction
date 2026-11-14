#!/usr/bin/env node
// 真实环境监听：连上 NapCat，把收到的事件原样打出来。只读，不发消息。
//
// 用法：
//   node tools/listen.mjs --url wss://qapi.civer.cn --token <token> --seconds 45
//
// 用来验证「入站链路」是否通：
//   在 --seconds 秒内往群里/私聊发一条消息，这里应该能看到。
//   看不到 → 事件上报没配好（NapCat 的上报开关 / 消息类型过滤）。

import { createRequire } from "node:module";

let WebSocket = null;
for (const base of [import.meta.url, `file://${process.cwd()}/x.js`]) {
  try { WebSocket = createRequire(base)("ws"); break; } catch {}
}
if (!WebSocket) { console.error("缺少依赖：请先 npm i ws"); process.exit(1); }

const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith("--")) continue;
  const next = argv[i + 1];
  args[argv[i].slice(2)] = !next || next.startsWith("--") ? true : next;
}

const SECONDS = Number(args.seconds || 45);
const ws = new WebSocket(args.url, {
  headers: args.token ? { Authorization: `Bearer ${args.token}` } : {},
  handshakeTimeout: 15000,
});

let msgCount = 0;
console.log(`监听 ${SECONDS} 秒，请在这段时间内往群里或私聊机器人发一条消息……`);

ws.on("open", async () => {
  console.log("✅ 已连接，等待事件……");
  await new Promise((r) => setTimeout(r, 800));
  ws.send(JSON.stringify({ action: "get_login_info", echo: "probe" }));
});

ws.on("message", (raw) => {
  let m; try { m = JSON.parse(raw.toString()); } catch { return; }
  if (m.echo) return;                                   // 忽略自己 API 调用的响应
  if (m.meta_event_type === "heartbeat") return;        // 心跳太吵
  if (m.post_type === "message") {
    msgCount++;
    const who = m.message_type === "group"
      ? `群 ${m.group_id} / ${m.sender?.card || m.sender?.nickname}(${m.user_id})`
      : `私聊 ${m.user_id}`;
    console.log(`📨 [${who}] ${(m.raw_message || "").slice(0, 100)}`);
    const segs = (m.message || []).map((s) => s.type).join(",");
    if (segs && segs !== "text") console.log(`    消息段类型：${segs}`);
    return;
  }
  if (m.post_type === "notice" || m.post_type === "request") {
    console.log(`🔔 ${m.post_type}.${m.notice_type || m.request_type} ${JSON.stringify(m).slice(0, 120)}`);
  }
});

ws.on("error", (e) => console.log("❌ " + e.message));

setTimeout(() => {
  console.log(`\n监听结束，共收到 ${msgCount} 条消息。`);
  console.log(msgCount === 0
    ? "⚠️  期间没有消息事件。可能是这段时间群里没人说话，也可能是事件上报没开。\n   建议：发一条消息后再跑一次确认。"
    : "✅ 入站链路正常。");
  try { ws.close(); } catch {}
  process.exit(0);
}, SECONDS * 1000);
