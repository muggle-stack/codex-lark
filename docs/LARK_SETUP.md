# 飞书 / Lark 配置指南

`codex-lark` 同时使用两种身份：

- `bot`：接收应用事件、发送机器人消息、更新动态卡片和添加表情。
- `user`：读取本人可见的 P2P 消息和 Wiki/Docs/Drive，并在明确开启时从本人会话发消息。

Bot 权限只在飞书开发者后台开通，不需要 `auth login`。User 功能必须同时满足“应用已开 scope”和“用户已完成授权”两层条件。

## 功能与权限矩阵

| 功能 | 身份 | 应用后台 / 用户授权要求 | 是否必需 |
|---|---|---|---|
| 接收机器人私聊和群消息 | bot | 事件 `im.message.receive_v1`；当前 scope `im:message.p2p_msg:readonly` | 基础模式必需 |
| 发送机器人回复和进度卡 | bot | 消息发送相关 bot scope，通常为 `im:message:send_as_bot` | 基础模式必需 |
| 添加和撤销 `Typing` 表情 | bot 或 user | `im:message.reactions:write_only` 或控制台提示的等价 scope | 可选，默认开启 |
| 搜索本人可见消息 | user | `search:message`，以及 `im` 域内消息读取权限 | P2P 搜索回退需要 |
| 直接读取指定 P2P 会话 | user | `im:message.p2p_msg:get_as_user`、消息只读权限 | 推荐 |
| 以本人身份回复 | user | `im:message.send_as_user` | `SEND_AS=user` 时必需 |
| 读取 Wiki 和文档 | user | `wiki`、`docs`、`drive` 业务域 | 知识代理需要 |
| 写 Wiki 和文档 | user | 对应 write scope + 资源本身编辑权限 | 仅 Owner 明确要求时 |

飞书会调整权限命名和接口要求。出现缺 scope 时，以 CLI 错误中的 `permission_violations`、`console_url` 和 `hint` 为准，不要猜 scope。

## 1. 初始化 lark-cli

```bash
lark-cli update
lark-cli config init --new
lark-cli auth status --json --verify
```

不要把 `appSecret`、access token、refresh token、device code 或授权 URL 写入 `.env` 或 Git。

## 2. 配置机器人应用

在飞书开发者后台：

1. 启用机器人能力。
2. 在事件订阅中加入 `im.message.receive_v1`。
3. 开通上表中启用功能需要的 bot scope。
4. 设置应用可用范围，只覆盖预期用户。
5. 发布新版本。新增权限和事件通常在发布后才真正生效。

用当前安装的 CLI 查看事件事实来源：

```bash
lark-cli event schema im.message.receive_v1 --json
```

## 3. 授权本人功能

仅使用机器人模式时，不需要 user token。启用本人 P2P、知识库或文档能力时：

```bash
lark-cli auth login --domain im,wiki,docs,drive --no-wait --json
```

打开返回的 `verification_url` 完成审批，然后使用同一次流程返回的 device code 收尾：

```bash
lark-cli auth login --device-code <device_code>
lark-cli auth status --json --verify
```

在本机交互终端也可以由安装脚本直接等待授权：

```bash
npm run setup -- --authorize-user --workdir "$HOME/workspace" --install-launchd
```

多次 `auth login` 会累积 scope。推荐只申请需要的业务域；`--domain all` 可用，但不是默认建议。

`lark-cli` 会在 refresh authorization 有效期内刷新短期 access token。应监控 `auth status` 中的 `expiresAt` 和 `refreshExpiresAt`；refresh authorization 到期后必须由用户重新审批。

## 4. 创建私有配置

```bash
cp .env.example .env
npm run setup -- --owner-open-id ou_your_open_id --workdir "$HOME/workspace"
```

已有有效 user 授权时，`npm run setup` 会尝试自动识别本人 `open_id`。

查找同事的 `open_id` 和 P2P `chat_id`：

```bash
lark-cli contact +search-user --query "Alice" --as user --format json
```

这些 ID 只写入 `.env`，不要放进 README、Issue 或提交记录。

## 5. 验证并运行

```bash
npm run check
npm start
```

macOS 常驻服务：

```bash
npm run launchd:install
npm run status
```

修改 `.env` 后先检查，再优雅重启：

```bash
npm run check
launchctl kickstart -k "gui/$(id -u)/$(sed -n 's/^LARK_CODEX_LAUNCHD_LABEL=//p' .env)"
```

不要对 `lark-cli event consume` 使用 `kill -9`，否则可能跳过服务端订阅清理。
