#!/usr/bin/env node
// 模拟 NapCat（OneBot 11 正向 WebSocket 服务端），用于**不接真实 QQ** 做本地冒烟测试。
//
// 用途：
//   1. 验证 dsh-qq-bot 能连上、能收事件、能发消息
//   2. 验证你的配置/人格/工具接线是否正确
//   3. 不想用真实账号调试时，用脚本化消息批量测试
//
// 用法：
//   npm i ws
//   node tools/mock-napcat.mjs --port 3001 --token devtoken
//   然后让 DSH 连 ws://127.0.0.1:3001（token: devtoken）
//   连接后按提示输入消息，或用 --auto 自动灌入测试消息
//
//   --auto          连上后自动发一批测试消息
//   --script f.json 按 JSON 脚本逐条发消息

import { createRequire } from "node:module";
import readline from "node:readline";

let WebSocketServer = null;
for (const base of [import.meta.url, `file://${process.cwd()}/x.js`]) {
  try { WebSocketServer = createRequire(base)("ws").WebSocketServer; break; } catch {}
}
if (!WebSocketServer) { console.error("缺少依赖：请先 npm i ws"); process.exit(1); }

const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith("--")) continue;
  const next = argv[i + 1];
  args[argv[i].slice(2)] = !next || next.startsWith("--") ? true : next;
}

const PORT = Number(args.port || 3001);
const TOKEN = args.token || "";
const SELF_ID = 100000001;
const TEST_GROUP = 10001;
const TEST_USER = 20001;

let seq = 0;
const send = (ws, payload) => ws.send(JSON.stringify(payload));

function makeMessage(subType, text, extra = {}) {
  const base = {
    self_id: SELF_ID,
    user_id: TEST_USER,
    message_id: ++seq,
    message_seq: seq,
    message_type: subType,
    sender: { user_id: TEST_USER, nickname: "测试用户", role: "member", card: "" },
    raw_message: text,
    message: [{ type: "text", data: { text } }],
    font: 0,
    post_type: "message",
    time: Math.floor(Date.now() / 1000),
  };
  if (subType === "group") Object.assign(base, { group_id: TEST_GROUP, sub_type: "normal", anonymous: null }, extra);
  else Object.assign(base, { sub_type: "friend" }, extra);
  return base;
}

const AUTO_SCRIPT = [
  makeMessage("private", "你好呀"),
  makeMessage("group", "[@机器人] 今天天气怎么样"),
  makeMessage("group", "[@机器人] 讲个笑话"),
  makeMessage("private", "你还记得我叫什么吗"),
];

const wss = new WebSocketServer({ port: PORT });
console.log(`模拟 NapCat 已启动：ws://127.0.0.1:${PORT}${TOKEN ? " (需要 token)" : " (无鉴权)"}`);

wss.on("connection", (ws, req) => {
  // 鉴权
  if (TOKEN) {
    const url = new URL(req.url, "http://x");
    const qToken = url.searchParams.get("access_token");
    const hToken = (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
    if (qToken !== TOKEN && hToken !== TOKEN) {
      console.log("❌ 鉴权失败，断开");
      ws.close(1008, "unauthorized");
      return;
    }
  }
  console.log("✅ DSH 已连接");

  send(ws, {
    time: Math.floor(Date.now() / 1000), self_id: SELF_ID,
    post_type: "meta_event", meta_event_type: "lifecycle", sub_type: "connect",
  });

  // 心跳：服务端发元事件，客户端可忽略
  const hb = setInterval(() => {
    send(ws, { time: Math.floor(Date.now() / 1000), self_id: SELF_ID,
      post_type: "meta_event", meta_event_type: "heartbeat", status: { online: true }, interval: 30000 });
  }, 30000);

  const script = args.script ? JSON.parse(require("node:fs").readFileSync(args.script, "utf8")) : (args.auto ? AUTO_SCRIPT : null);
  if (script) {
    script.forEach((m, i) => setTimeout(() => { console.log(`→ 发送测试消息：${m.raw_message}`); send(ws, m); }, 1500 * (i + 1)));
  }

  ws.on("message", (raw) => {
    let p; try { p = JSON.parse(raw.toString()); } catch { return; }
    // OneBot 11：action 请求带 action + echo
    if (p.action) {
      console.log(`← API 调用：${p.action}  echo=${p.echo ?? "-"}  params=${JSON.stringify(p.params ?? {}).slice(0, 160)}`);
      // 回一个成功的 echo 响应
      let data = {};
      if (p.action === "send_msg" || p.action === "send_group_msg" || p.action === "send_private_msg") {
        data = { message_id: ++seq };
        console.log(`   💬 机器人发言：${JSON.stringify((p.params?.message ?? "")).slice(0, 200)}`);
      } else if (p.action === "get_login_info") {
        data = { user_id: SELF_ID, nickname: "模拟机器人" };
      } else if (p.action === "get_group_member_list") {
        data = [{ user_id: TEST_USER, nickname: "测试用户", role: "member" }];
      }
      send(ws, { status: "ok", retcode: 0, data, echo: p.echo });
      return;
    }
    console.log("← " + raw.toString().slice(0, 200));
  });

  ws.on("close", () => { clearInterval(hb); console.log("连接已断开"); });
});

// 交互模式：终端输入一行 = 群聊 @ 消息
if (!args.auto && !args.script) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on("line", (line) => {
    const t = line.trim();
    if (!t) return;
    const msg = makeMessage(t.startsWith("/p ") ? "private" : "group", t.replace(/^\/p\s*/, ""));
    for (const c of wss.clients) { console.log(`→ ${msg.raw_message}`); send(c, msg); }
  });
  console.log("输入一行即发送群聊消息；以 /p 开头则发私聊。");
}
