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

`app-server` 默认通过 `LARK_CODEX_APP_SERVER_DISABLE_SELF_MCP=1` 禁用内部递归的
`codex mcp-server`，不影响 Codex 内建工具或其他 MCP。若 `turn/start` 后
`LARK_CODEX_APP_SERVER_FIRST_ACTIVITY_TIMEOUT_MS`（默认 60 秒）内没有任何 item、命令或输出事件，
bridge 会终止整棵子进程并快速报错，避免占住串行队列直到总超时。

## 安全重启与中断恢复

收到 `SIGTERM`/`SIGINT` 后，bridge 会先停止事件消费和 P2P 轮询，不再接收新任务；随后检查当前
活动任务、排队任务和状态卡更新，并等待它们全部完成后才退出。日志中的
`pre-restart active task check` 会显示 drain 前的任务快照。

`LARK_CODEX_SHUTDOWN_DRAIN_TIMEOUT_MS=0` 表示 bridge 自身不设置强制退出时限，由 systemd 的
`TimeoutStopSec` 等外层机制决定硬超时。若外层最终发送 `SIGKILL`，P2P `per_sender` 任务会依靠
每个 run 的 `recovery.json` 在下次启动恢复：

- Codex thread 创建或恢复成功后立即持久化 thread ID，不再等整轮结束。
- 执行阶段被中断时恢复同一个 thread；尚未获得 thread ID 时重新执行原任务。
- 已执行完成但尚未回复或上传附件时只恢复发送阶段，不重复生成内容。
- 回复和附件继续使用原事件的幂等键；已移出白名单的发送者不会被恢复。

可用 `LARK_CODEX_RECOVER_INTERRUPTED_TASKS=0` 禁用启动恢复，但正常部署建议保持默认值 `1`。

systemd 单元建议配置 `KillMode=mixed`：停止时先只向主 bridge 进程发送 `SIGTERM`，给它机会完成
drain；超过 `TimeoutStopSec` 后再用 `SIGKILL` 清理整个 cgroup。若使用默认
`KillMode=control-group`，Codex 子进程会与 bridge 同时收到 `SIGTERM`；bridge 会把这种退出保留为
可恢复中断而不是业务失败，但该轮仍需在新进程中续跑。

## Sandbox

公开默认值是普通任务 `workspace-write`、同事知识代理 `read-only`。本地代理、SSH 或跨仓库任务可能需要 `danger-full-access`，但它会放大消息和文档 Prompt Injection 的影响。

知识代理 Prompt 会禁止写入和私有 Skill 导出,但在 Codex 引擎下这不是操作系统级隔离(Claude 引擎见下)。

### 只读知识代理的附件投递箱

`LARK_CODEX_P2P_ARTIFACTS_ENABLED=1` 可为每次 P2P app-server 运行创建
`.lark-codex/runs/<run_id>/artifacts/`。bridge 在 `turn/start` 时把 Codex 的 runtime workspace roots
替换为这个目录，并使用关闭网络、排除 `/tmp`/`$TMPDIR` 的 `workspaceWrite` sandbox policy。
因此源工作区仍不可写，只有本次运行的空投递箱可写。

该功能只支持 `codex` + `per_sender` + `app-server` + `read-only` 组合。bridge 只上传投递箱
顶层的普通文本文件，拒绝子目录、符号链接、硬链接、隐藏文件、越界路径、超大/超量文件、
无效 UTF-8、疑似凭据和命中输出策略的内容。通过校验的内容会先复制到 Codex 不可写的宿主侧
暂存目录，再由 `lark-cli` 上传，避免校验后被替换。公开默认仅允许 `.md`；可在
`.md,.txt,.csv,.json` 的硬限制内用 `LARK_CODEX_P2P_ARTIFACT_EXTENSIONS` 缩放允许列表。
数量和单文件大小还有 10 个、10 MiB 的硬上限（公开默认分别为 3 个、1 MiB）。

附件投递箱不开放网络，也不允许修改邮件库等外部数据源。类似 `lei up` 的同步操作应由受信任的
宿主机定时任务完成；知识代理只读取已同步数据并把最终报告写入投递箱。

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
- `runs/<run_id>/recovery.json`：可恢复 P2P 任务的阶段、thread ID 和投递上下文
- `sessions.json`：Session 别名注册表
- `p2p-auto-reply-state.json`：已处理消息 ID
- 日志和 PID 文件

消息附件下载到 `lark-im-resources/`。这些目录都由 `.gitignore` 排除。
