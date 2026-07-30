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

By default, app-server runs with `LARK_CODEX_APP_SERVER_DISABLE_SELF_MCP=1` to avoid
starting a recursive `codex mcp-server`; built-in Codex tools and other MCP servers remain available.
If no item, command, or output event arrives within
`LARK_CODEX_APP_SERVER_FIRST_ACTIVITY_TIMEOUT_MS` (60 seconds by default) after `turn/start`,
the bridge terminates the complete child process tree and fails fast instead of blocking the queue
until the overall timeout.

## Sandboxes

Public defaults are `workspace-write` for regular work and `read-only` for colleague sessions. Proxy, SSH, or cross-repository workflows may require `danger-full-access`, but this increases the consequence of prompt injection from messages and documents.

Knowledge-agent instructions prohibit writes and private Skill extraction. They are defense in depth, not an operating-system isolation boundary.

### Artifact drop box for read-only knowledge agents

Set `LARK_CODEX_P2P_ARTIFACTS_ENABLED=1` to create
`.lark-codex/runs/<run_id>/artifacts/` for each P2P app-server run. At `turn/start`,
the bridge replaces the Codex runtime workspace roots with that directory and uses
a `workspaceWrite` sandbox policy with networking, `/tmp`, and `$TMPDIR` writes
disabled. The source workspace therefore stays read-only while the empty per-run
drop box is writable.

This requires the `codex` + `per_sender` + `app-server` + `read-only` combination.
The bridge uploads only top-level regular text files from the drop box. It rejects
directories, symbolic and hard links, hidden files, path escapes, oversized or
excess files, invalid UTF-8, suspected credentials, and content blocked by the
output policy. Validated bytes are copied into a host-side staging directory
that Codex cannot write before `lark-cli` uploads them, preventing replacement
after validation. The public default permits only `.md`;
`LARK_CODEX_P2P_ARTIFACT_EXTENSIONS` may narrow or expand that list within the
hard limit of `.md,.txt,.csv,.json`. File count and per-file size are also
hard-capped at 10 files and 10 MiB (public defaults: 3 files and 1 MiB).

The drop box does not enable networking or writes to external data sources. Run
updates such as `lei up` in a trusted host-side timer, then let the knowledge agent
read the synchronized data and write only the final report into the drop box.

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
