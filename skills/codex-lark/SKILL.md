---
name: codex-lark
description: Operate, diagnose, configure, test, and maintain the codex-lark local Lark/Feishu-to-Codex bridge. Use when working in this repository, checking bridge liveness or logs, changing sender or chat routing, managing Codex session aliases, installing the LaunchAgent, or debugging bot events, P2P polling, reactions, dynamic cards, and Lark authorization.
---

# Codex Lark

Work from the repository root and inspect the current source, `.env` key names, process state, and fresh logs before deciding. Never print `.env` values, tokens, device codes, chat history, or downloaded resources.

## Diagnose

Run the least invasive checks first:

```bash
npm run status
npm run check
tail -n 100 .lark-codex/launchd.out.log
tail -n 100 .lark-codex/launchd.err.log
lark-cli auth status --json --verify
```

Separate local process health from Lark API, proxy, scope, or token failures. Do not restart a healthy bridge just because an old log contains an error.

## Change Configuration

- Treat `.env.example` as the public schema and `.env` as private runtime state.
- Keep owner IDs separate from colleague allowlists.
- Pin P2P colleagues to exact chat IDs where possible.
- Keep `LARK_CODEX_ALLOW_ALL=0`.
- Update `.env.example`, docs, and tests when adding a new source variable.
- Run `npm test` and `npm run check:public` before a live restart.

After a validated `.env` change, restart with the configured LaunchAgent label. Use graceful `launchctl kickstart -k`; do not kill the event consumer with `SIGKILL`.

## Authorization

Use `lark-cli auth status --json --verify` before starting a new authorization. Bot scope failures are fixed in the developer console; user identity features require both app scopes and user approval. Never store authorization URLs, device codes, or tokens in the repository.

## Session Commands

Use `/codex sess-status`, `sess-discover`, `sess-alias`, `sess-title`, `sess-log`, and `@alias <task>` for managed Codex tasks. Prefer the `app-server` backend when Desktop or mobile visibility matters. Removing an alias must not delete the underlying Codex transcript.

## Security

Colleague knowledge-agent instructions are read-only policy, not a hard sandbox. Do not widen colleague privileges, expose raw Skills or prompts, or copy personal knowledge into this public Skill. Require explicit owner intent for permission changes, deletion, credential disclosure, or broad irreversible actions.
