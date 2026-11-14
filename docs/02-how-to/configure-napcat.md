# NapCat 侧配置

---

## 零、实测结论 + 一个要处理的安全问题

### ✅ 你的 OneBot 端点已验证可用（2026-10-31）

```
wss://qapi.civer.cn  +  token YOUR_NAPCAT_TOKEN
  ✅ TCP + TLS + WebSocket 握手成功
  ✅ 鉴权通过，self_id = 2174357664
  ✅ 群 778916943「Botest」在列表内（7 名成员）
```

**地址、token、BotQQ、群号全部正确**，可以直接用。验证脚本：`../../tools/ws-check.mjs`。

### ⚠️ 但另一个域名把 NapCat 管理面板暴露在了公网

顺手测了 `napcat.civer.cn`，结果是：

```text
https://napcat.civer.cn/          → 301 重定向到 /webui
https://napcat.civer.cn/webui     → 返回 NapCat 管理面板页面
server: openresty  +  x-powered-by: Express
```

**这意味着 NapCat 的 WebUI（默认端口 6099）正暴露在公网，且走 CDN 全球可访问。**

风险不是理论上的：WebUI 是 NapCat 的**完整管理面板**，登录后可查看/修改全部配置、扫码登录任意 QQ、查看消息记录。任何人只要爆破出登录口令，就等于接管你的 QQ。

同时实测 `napcat.civer.cn` 的 3000 / 3001 / 6099 / 6700 / 8080 **全部无响应**，说明这个入口当前只挂了 WebUI，**没有挂 OneBot WebSocket**。

### 立刻做（按顺序，5 分钟内）

```bash
# 1) 立刻改 WebUI 密码为强随机口令
openssl rand -base64 24

# 2) 在反向代理上把 /webui 限定为只有你的 IP 可访问（Nginx 示例）
#    location /webui { allow 你的公网IP; deny all; ... }

# 3) 如果暂时用不上 WebUI，直接在云防火墙上把 6099 端口的公网入口关掉
#    只保留 SSH + 你真正需要的端口
```

### 正确的架构：路径/子域名分流，不要混在一起

```nginx
# OneBot WS 走独立路径，转发到本机 NapCat 的 WS 端口
location /onebot11 {
    proxy_pass http://127.0.0.1:3001;          # NapCat 正向 WS 实际监听端口
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
    client_max_body_size 20m;
    limit_conn onebot 5;
}

# WebUI 只允许你自己的 IP
location /webui {
    allow 1.2.3.4;              # ← 你的公网 IP
    deny all;
    proxy_pass http://127.0.0.1:6099;
    proxy_set_header Host $host;
}
```

配好后验证：`curl -i https://napcat.civer.cn/onebot11` 应该返回 **426 Upgrade Required**（而不是 401 或 301），这才说明请求真的到了 OneBot WS 端点。

---

## 一、确认你的连接模式

| 模式 | 谁连谁 | DSH 侧配置 |
|---|---|---|
| **正向 WS**（NapCat 是服务端） | DSH → NapCat | `mode: forward` + `onebot.wsUrl` |
| 反向 WS（NapCat 是客户端） | NapCat → DSH | `mode: reverse` + `onebot.listen` |

**你说「NapCat 通过 WSS 提供服务」，所以是正向 WS。** DSH 作为客户端连过去。

```yaml
onebot:
  wsUrl: 'wss://napcat.example.com/onebot11'   # 注意是 wss 不是 ws
  httpUrl: ''                                   # 留空：发消息也走这条 WS
  accessToken: '你的token'
```

> `httpUrl` 留空后，插件会改用 **WS Action** 发送请求。这样只需要**一条连接**做双工，攻击面最小。

---

## 二、NapCat 侧要确认的 5 件事

| 项 | 要求 | 怎么验证 |
|---|---|---|
| **1. WebSocket 服务端已启用** | 端口通常 3001 | `ss -ltnp \| grep 3001` |
| **2. Token 已设置** | 32 位以上随机串 | 生成：`openssl rand -hex 32` |
| **3. 消息格式** | OneBot 11 | NapCat 网络配置里选「OneBot11」 |
| **4. 心跳** | 建议开启 | 防止中间设备静默断连 |
| **5. 上报事件类型** | 至少包含 message / notice | 否则收不到消息 |

---

## 三、公网 WSS：必须做的事

如果你的 WSS 暴露在公网（云服务器场景通常是），**逐条检查**：

- [ ] **用了可信 TLS 证书**（Let's Encrypt 即可）。自签证书需要把 CA 注入到 DSH 进程的 `NODE_EXTRA_CA_CERTS`，不要用 `NODE_TLS_REJECT_UNAUTHORIZED=0` 绕过校验。
- [ ] **Token 强度足够**（`openssl rand -hex 32`）。官方明确要求公网部署启用 Token。
- [ ] **安全组只放行 DSH 服务器 IP** 访问该端口。
- [ ] **NapCat WebUI（默认 6099）绝不暴露公网**。它一旦被扫到，等于把 QQ 控制权交出去。
- [ ] **Token 走 `Authorization: Bearer` 头**，不要拼在 URL 里 —— URL 会被 Nginx、CDN、shell history 全部记录下来。
- [ ] 反向代理上设置**连接数上限、消息体上限、空闲超时**。

### Nginx 反代 WSS 参考片段

```nginx
location /onebot11 {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 600s;        # 长连接，别设太短
    proxy_send_timeout 600s;
    client_max_body_size 20m;       # 图片/文件
    limit_conn onebot 5;            # 限制并发连接
}
```

---

## 四、DSH 侧连接不上时的排查顺序

```text
1. 从 DSH 服务器手工连一次，看能不能握手
   （用 ../../tools/ws-check.mjs 或 wscat）
       ↓ 能连 → 问题在 DSH 配置
       ↓ 连不上 → 问题在网络或 NapCat

2. 检查 Token 是否一致（注意别有空格/换行）
       ↓
3. 检查 wsUrl 协议：公网必须 wss，内网才用 ws
       ↓
4. 看 DSH 日志里有没有 "unauthorized" / "403"
       ↓
5. 确认 NapCat 的 WebSocket 服务端不是只监听 127.0.0.1
```

---

## 五、安全红线（不可协商）

| 红线 | 原因 |
|---|---|
| 公网 WSS 必须开 Token | 否则任何人都能接管你的 QQ |
| WebUI 6099 不暴露公网 | 同上，且它是明文 HTTP |
| Token 不写进配置文件/仓库/记忆 | 记忆是明文 Markdown，会被模型读出来 |
| `auth.owners` 必须填 | 插件留空会 fail-closed（不驱动任何会话）——这是正确的默认值 |
| 访客禁用 DSH 内部工具 | 否则它会被当抓网页的跳板 |

---

## 六、Token 生成与轮换

```bash
# 生成一个
openssl rand -hex 32

# 建议：每季度轮换一次。轮换顺序：
# 1. 先在 DSH 配置里改成新 token
# 2. 再在 NapCat 里改成新 token
# 3. 重启两边
# （反过来会有一段时间连不上，但更安全）
```
