# 配置说明

[English](CONFIGURATION_EN.md)

`.env.example` 是公开配置的唯一事实来源。测试会检查 `src/bridge.mjs` 使用的每个 `LARK_CODEX_*` 变量都出现在示例文件中。

## 身份与路由

- `LARK_CODEX_ALLOWED_SENDERS`：允许触发普通机器人任务的用户。
- `LARK_CODEX_ALLOWED_CHATS`：可选的精确会话白名单。
- `LARK_CODEX_OWNER_SENDERS`：Owner/Admin 白名单，只应包含本人。
- `LARK_CODEX_P2P_AUTO_REPLY_ALLOWED_SENDERS`：允许访问知识代理的同事。
- `LARK_CODEX_P2P_AUTO_REPLY_SENDER_CHATS`：同事到 P2P `chat_id` 的精确映射。

直接配置同事的 `chat_id` 时，bridge 会轮询指定 P2P 会话；未配置时退回消息搜索，可能存在索引延迟。

## 执行后端

- `app-server`：长期、App 可见的 Session，推荐用于命名会话。
- `exec-resume`：恢复 transcript 的兼容路径，不保证显示为正在运行的 App Turn。
- 一次性 `codex exec --json`：普通 Owner 任务和动态进度事件。

所有任务进入同一个本地队列，避免两个 Codex 同时修改同一工作区。

## Sandbox

公开默认值是普通任务 `workspace-write`、同事知识代理 `read-only`。本地代理、SSH 或跨仓库任务可能需要 `danger-full-access`，但它会放大消息和文档 Prompt Injection 的影响。

知识代理 Prompt 会禁止写入和私有 Skill 导出，但这不是操作系统级隔离。

## 品牌与知识源

```dotenv
LARK_CODEX_ASSISTANT_NAME=Codex
LARK_CODEX_KNOWLEDGE_AGENT_NAME=Codex knowledge agent
LARK_CODEX_KNOWLEDGE_SKILLS=my-company-wiki,my-runbooks
LARK_CODEX_KNOWLEDGE_BASE_NAME=Engineering knowledge base
LARK_CODEX_KNOWLEDGE_BASE_HINT=Use the configured Wiki skill and lark-cli --as user.
```

公开源码不应包含个人姓名、Lark ID、Wiki token 或本机路径。实际 Skill 与资源标识保留在用户自己的 `~/.codex` 或私有 `.env`。

## 本地状态

`.lark-codex/` 中保存：

- `runs/<run_id>/status.json` 和 `events.jsonl`：脱敏进度状态
- `sessions.json`：Session 别名注册表
- `p2p-auto-reply-state.json`：已处理消息 ID
- 日志和 PID 文件

消息附件下载到 `lark-im-resources/`。这些目录都由 `.gitignore` 排除。
