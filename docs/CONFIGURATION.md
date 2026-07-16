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

知识代理 Prompt 会禁止写入和私有 Skill 导出,但在 Codex 引擎下这不是操作系统级隔离(Claude 引擎见下)。

## 引擎选择(LARK_CODEX_ENGINE)

用 `LARK_CODEX_ENGINE` 选择后端,默认 `codex`。

- `codex`:驱动 Codex CLI,行为完全不变。
- `claude`:驱动 Claude Code,`claude -p --resume` 每轮一进程,不常驻、无守护进程、无开机自启。

权限复用 `LARK_CODEX_SANDBOX` 及各 P2P session sandbox 配置,映射到中立三档并由各引擎翻译:

| 中立档 | 触发 | Codex | Claude |
|---|---|---|---|
| readonly | 同事知识代理 | `--sandbox read-only` | OS 沙盒(文件系统只读)+ 禁用 `Write`/`Edit` + 凭据 deny + strict(禁逃逸) |
| write | 机器人 | `--sandbox workspace-write` | 沙盒(cwd 可写)+ 自动放行 |
| full | Owner | `--sandbox danger-full-access` | 关沙盒 + `--permission-mode bypassPermissions` |

Claude 引擎下同事只读代理是**两层强制**:操作系统沙盒(Linux 用 `bubblewrap`,需另装 `socat`)把文件系统锁成只读,同时禁用内建 `Write`/`Edit` 工具——因为沙盒只管 Bash 子进程,内建写工具走权限系统。二者缺一有洞。

### Claude 引擎变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `LARK_CLAUDE_BIN` | `claude` | Claude Code 可执行文件 |
| `LARK_CLAUDE_MODEL` | `sonnet` | 模型别名或完整 ID |
| `LARK_CLAUDE_WORKDIR_BASE` | `~/.cc-lark` | 每用户工作目录 = `<base>/<open_id>` |
| `LARK_CLAUDE_TIMEOUT_MS` | `1800000` | 单轮超时 |
| `LARK_CLAUDE_SANDBOX_ENABLED` | `1` | write 档是否启用沙盒 |
| `LARK_CLAUDE_STRICT_SANDBOX` | `1` | `allowUnsandboxedCommands:false`,关闭沙盒外逃逸 |
| `LARK_CLAUDE_READONLY_ALLOWED_TOOLS` | `Read,Glob,Grep,Bash` | 只读代理放行的工具 |
| `LARK_CLAUDE_NETWORK_ALLOWED_DOMAINS` |(空)| 沙盒网络放行域名 |
| `LARK_CLAUDE_CREDENTIALS_DENY` | `~/.ssh,~/.aws` | 对沙盒命令隐藏的凭据路径 |
| `LARK_CLAUDE_EXTRA_ARGS` |(空)| 追加到 `claude` 的原始参数 |

每个飞书用户对应一个预生成的 Claude session UUID:首轮 `--session-id`,之后 `--resume`;若 transcript 已被 Claude 的 30 天保留清理,自动新建。`sess-discover` 在 claude 引擎下扫描 `~/.claude/projects/`。

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
