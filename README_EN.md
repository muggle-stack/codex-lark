# codex-lark

[中文](README.md) | English

**Run Codex on your own computer directly from Lark or Feishu.**

`codex-lark` is a local-first bridge that accepts allowlisted Lark messages, starts Codex work, and posts progress and results back to the original conversation.

![Sanitized codex-lark UI preview](docs/assets/codex-lark-progress-demo.png)

> This is a sanitized UI preview. The real progress card is rendered natively by Lark and updates in place without requiring a public callback domain.

## Features

- Bot DMs and group mentions routed to `codex exec` or `codex app-server`
- Owner-only high-permission mode with independent sender and chat allowlists
- `Typing` reactions that are removed when work finishes
- One native dynamic card updated throughout long-running tasks
- App-visible persistent Codex sessions with aliases
- Optional per-colleague P2P sessions in read-only knowledge-agent mode
- Image and file inputs downloaded from Lark messages
- Access to configured Codex Skills, memory summaries, and authorized Lark knowledge sources
- Unauthorized-trigger denial and private Skill/prompt exfiltration safeguards
- macOS LaunchAgent, local redacted run logs, and an optional localhost viewer

## Quick Start

Requirements: Node.js 20+, an authenticated Codex CLI, current `lark-cli`, and a Lark custom app with bot capability enabled.

```bash
lark-cli update
lark-cli config init --new

git clone <your-repository-url> codex-lark
cd codex-lark
cp .env.example .env
npm run setup -- --owner-open-id ou_your_open_id --workdir "$HOME/workspace"
npm run check
npm start
```

On macOS, user authorization and LaunchAgent installation can be combined:

```bash
npm run setup -- --authorize-user --workdir "$HOME/workspace" --install-launchd
```

Before starting, enable bot capability, subscribe to `im.message.receive_v1`, grant message send/receive and reaction scopes, publish the app version, and restrict its availability. See [Lark setup](docs/LARK_SETUP_EN.md) for the permission matrix.

## Access Modes

| Mode | Trigger | Default Codex access | Typical use |
|---|---|---|---|
| Bot | allowlisted bot sender | `workspace-write` | repository work and tests |
| Owner/Admin | owner `open_id` only | configurable up to `danger-full-access` | SSH, cross-repo work, Lark writes, managed sessions |
| Colleague knowledge agent | allowlisted sender and P2P chat | `read-only` | knowledge, Skill capability, and memory-summary questions |

Never add colleagues to `LARK_CODEX_OWNER_SENDERS`.

## Engine Selection (Codex / Claude Code)

The bridge supports a pluggable engine, chosen with `LARK_CODEX_ENGINE`:

- `codex` (default): unchanged; drives the Codex CLI (`exec` / `app-server`).
- `claude`: drives Claude Code with `claude -p --resume` — one process per turn, so there is no long-running daemon and no boot autostart.

```dotenv
LARK_CODEX_ENGINE=claude
LARK_CLAUDE_MODEL=sonnet
LARK_CLAUDE_WORKDIR_BASE=~/.cc-lark
```

Permission still uses the `LARK_CODEX_SANDBOX` vocabulary, mapped to a neutral level: `read-only` -> readonly, `workspace-write` -> write, `danger-full-access` -> full. On the Claude engine the read-only knowledge agent is enforced by **two layers**: an OS sandbox (bubblewrap, read-only filesystem) plus denied `Write`/`Edit` tools plus credential deny — neither alone is sufficient. Linux needs `bubblewrap` and `socat`.

Each Lark user gets one pre-generated Claude session UUID (`--session-id` first turn, `--resume` after); working directories default to `~/.cc-lark/<open_id>` and transcripts land in `~/.claude/projects/`. See [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## Managed Sessions

```text
/codex sess-new release --cd /path/to/repo
/codex sess-alias <session_id> release --cd /path/to/repo --title "Release"
/codex @release inspect and fix the latest CI failure
/codex sess-status --all
/codex sess-log release
/codex sess-rm release
```

`app-server` is the default backend so routed work can remain visible in Codex Desktop or mobile. Removing an alias does not delete the underlying Codex session.

## Knowledge Agent

```dotenv
LARK_CODEX_KNOWLEDGE_SKILLS=my-company-knowledge
LARK_CODEX_KNOWLEDGE_BASE_NAME=Engineering knowledge base
LARK_CODEX_P2P_AUTO_REPLY_ENABLED=1
LARK_CODEX_P2P_AUTO_REPLY_ALLOWED_SENDERS=ou_colleague
LARK_CODEX_P2P_AUTO_REPLY_SENDER_NAMES=Alice=ou_colleague
LARK_CODEX_P2P_AUTO_REPLY_SENDER_CHATS=Alice=oc_private_chat
LARK_CODEX_P2P_AUTO_REPLY_TRIGGERS=/ask-codex
LARK_CODEX_P2P_AUTO_REPLY_SESSION_MODE=per_sender
```

Personal Skills remain under `~/.codex/skills`; the bridge references them by name and never copies them into this repository. Install the bundled project-maintenance Skill with `npm run skill:install`.

## Security

Keep `LARK_CODEX_ALLOW_ALL=0`, put only the owner in the owner allowlist, and use the narrowest workspace and sandbox that supports the task. Read-only prompt instructions are defense in depth, not an operating-system isolation boundary. See [SECURITY.md](SECURITY.md).

## Development

```bash
npm test
npm run check:public
node --check src/bridge.mjs
```

Configuration lives in [`.env.example`](.env.example) and [Configuration](docs/CONFIGURATION_EN.md). `npm run check` is a live integration check and requires working Codex and Lark credentials.

## License

[MIT](LICENSE)
