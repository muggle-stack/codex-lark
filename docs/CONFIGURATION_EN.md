# Configuration

[中文](CONFIGURATION.md)

`.env.example` is the canonical public configuration reference. Tests fail when a `LARK_CODEX_*` variable used by `src/bridge.mjs` is missing from that file.

## Identities and Routing

- `LARK_CODEX_ALLOWED_SENDERS`: ordinary bot-triggered users.
- `LARK_CODEX_ALLOWED_CHATS`: optional exact chat allowlist.
- `LARK_CODEX_OWNER_SENDERS`: owner/admin allowlist; only the owner belongs here.
- `LARK_CODEX_P2P_AUTO_REPLY_ALLOWED_SENDERS`: colleagues allowed to use the knowledge agent.
- `LARK_CODEX_P2P_AUTO_REPLY_SENDER_CHATS`: exact colleague-to-P2P-chat mapping.

Exact chat mappings use direct P2P polling. Without them, the bridge falls back to message search, which may be delayed.

## Execution Backends

- `app-server`: persistent App-visible task, recommended for named sessions.
- `exec-resume`: transcript resume fallback that may not appear as a live App turn.
- one-off `codex exec --json`: owner tasks and dynamic progress events.

The bridge serializes work through one local queue to avoid concurrent edits in the same workspace.

## Sandboxes

Public defaults are `workspace-write` for regular work and `read-only` for colleague sessions. Proxy, SSH, or cross-repository workflows may require `danger-full-access`, but this increases the consequence of prompt injection from messages and documents.

Knowledge-agent instructions prohibit writes and private Skill extraction. They are defense in depth, not an operating-system isolation boundary.

## Branding and Knowledge Sources

```dotenv
LARK_CODEX_ASSISTANT_NAME=Codex
LARK_CODEX_KNOWLEDGE_AGENT_NAME=Codex knowledge agent
LARK_CODEX_KNOWLEDGE_SKILLS=my-company-wiki,my-runbooks
LARK_CODEX_KNOWLEDGE_BASE_NAME=Engineering knowledge base
LARK_CODEX_KNOWLEDGE_BASE_HINT=Use the configured Wiki skill and lark-cli --as user.
```

Keep personal names, Lark IDs, Wiki tokens, workspace paths, actual Skills, and resource identifiers in the user's private Codex home or `.env`.

## Local State

`.lark-codex/` stores redacted run state, session aliases, processed message IDs, logs, and PID files. Downloaded message resources are stored under `lark-im-resources/`. Both locations are ignored by Git.
