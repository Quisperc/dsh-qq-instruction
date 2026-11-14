#!/usr/bin/env node
// NapCat / OneBot 11 连接体检：握手 → 鉴权 → 只读 API 探活。
// 全程只读，不会向任何群或好友发消息。
//
// 用法：
//   npm i ws
//   node tools/ws-check.mjs --url wss://napcat.civer.cn --token <token>
//   node tools/ws-check.mjs --url ws://127.0.0.1:3001 --token <token> --group 778916943

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

const URL_ = args.url;
const TOKEN = args.token || "";
const WANT_GROUP = args.group ? String(args.group) : "";
if (!URL_) { console.error("需要 --url"); process.exit(1); }

console.log(`连接：${URL_}${TOKEN ? "（带 token）" : "（无 token）"}`);

const ws = new WebSocket(URL_, {
  headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
  handshakeTimeout: 15000,
});

const pending = new Map();
let echoSeq = 0;
function api(action, params = {}, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const echo = `chk_${++echoSeq}`;
    pending.set(echo, resolve);
    ws.send(JSON.stringify({ action, params, echo }));
    setTimeout(() => { if (pending.has(echo)) { pending.delete(echo); resolve({ __timeout: true }); } }, timeoutMs);
  });
}

const events = [];
let finished = false;
const done = (code) => { if (!finished) { finished = true; try { ws.close(); } catch {} process.exit(code); } };

ws.on("open", () => console.log("✅ TCP + TLS + WebSocket 握手成功"));

ws.on("unexpected-response", (_req, res) => {
  console.log(`❌ 服务端拒绝握手：HTTP ${res.statusCode}`);
  res.on("data", (d) => {
    const t = d.toString().slice(0, 300);
    if (t.trim()) console.log("   响应体：" + t);
    done(1);
  });
  setTimeout(() => done(1), 1500);
});

ws.on("message", async (raw) => {
  let m; try { m = JSON.parse(raw.toString()); } catch { return; }

  if (m.echo && pending.has(m.echo)) {
    const r = pending.get(m.echo); pending.delete(m.echo); r(m);
    return;
  }
  if (m.post_type === "meta_event") {
    if (m.meta_event_type === "lifecycle" && m.sub_type === "connect") {
      console.log("✅ 收到 lifecycle:connect —— 鉴权通过，协议端已就绪");
      console.log(`   self_id = ${m.self_id}`);

      const info = await api("get_login_info");
      if (info?.__timeout) console.log("⚠️  get_login_info 超时");
      else if (info?.status === "ok") console.log(`✅ 登录账号：${info.data.nickname}（QQ ${info.data.user_id}）`);
      else console.log(`❌ get_login_info 失败：${JSON.stringify(info).slice(0, 200)}`);

      const groups = await api("get_group_list");
      if (groups?.status === "ok") {
        const list = groups.data || [];
        console.log(`✅ 已加入 ${list.length} 个群`);
        list.slice(0, 20).forEach((g) => console.log(`   - ${g.group_id}  ${g.group_name}`));
        if (WANT_GROUP) {
          const hit = list.find((g) => String(g.group_id) === WANT_GROUP);
          console.log(hit
            ? `✅ 目标群 ${WANT_GROUP} 在列表内：${hit.group_name}（成员数 ${hit.member_count ?? "?"}）`
            : `⚠️  目标群 ${WANT_GROUP} 不在列表内 —— 检查机器人是否已入群，或群号是否正确`);
        }
      }

      console.log("\n只读探活完成，未发送任何消息。");
      done(0);
    }
    return;
  }
  if (m.post_type === "message") {
    events.push(m);
    console.log(`📨 收到消息事件（${m.message_type}）：${(m.raw_message || "").slice(0, 60)}`);
  }
});

ws.on("error", (e) => {
  console.log("❌ 连接错误：" + (e.message || "未知").slice(0, 200));
  done(1);
});

setTimeout(() => {
  if (!finished) {
    console.log("⚠️  15 秒内未收到 lifecycle:connect。连接可能是通的，但协议端未推送连接事件（部分实现只在收到首个 API 后才推）。");
    done(2);
  }
}, 15000);
