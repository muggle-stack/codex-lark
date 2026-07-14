---
name: claude-lark
description: Operate, diagnose, configure, test, and maintain the codex-lark bridge when it runs on the Claude Code engine (LARK_CODEX_ENGINE=claude). Use when checking bridge liveness or logs, changing sender or chat routing, managing per-user Claude session ids, tuning the read-only sandbox for the knowledge agent, or debugging bot events, P2P polling, dynamic cards, and Lark authorization.
---

# Claude Lark

The bridge drives Claude Code headlessly with `claude -p --resume` (spawn-per-turn: no daemon, no boot autostart). Work from the repository root and inspect the current source, `.env` key names, process state, and fresh logs before deciding. Never print `.env` values, tokens, device codes, chat history, or downloaded resources.

## Diagnose

Run the least invasive checks first:

```bash
npm run status
LARK_CODEX_ENGINE=claude npm run check   # probes `claude --version` and prints the resolved engine config
tail -n 100 .lark-codex/launchd.out.log
lark-cli auth status --json --verify
claude --version
```

Separate local process health from Lark API, proxy, scope, or token failures.

## Engine and permissions

- Select the engine with `LARK_CODEX_ENGINE=claude`; `codex` remains the default and is unchanged.
- Permission is expressed with the shared Codex sandbox vocabulary and mapped to a neutral level: `read-only` -> readonly, `workspace-write` -> write, `danger-full-access` -> full.
- The read-only knowledge agent is enforced by **two layers**: an OS sandbox (bubblewrap) with a read-only filesystem plus denied `Write`/`Edit` tools plus credential deny. Both are required; neither alone is sufficient.
- Keep `LARK_CLAUDE_STRICT_SANDBOX=1` so a failed sandboxed command cannot silently retry outside the sandbox.
- On Linux the sandbox needs `bubblewrap` and `socat`; verify with a read-only probe before trusting the colleague agent.

## Sessions

- Each Lark user gets one pre-generated Claude session UUID stored in the registry; the first turn uses `--session-id`, later turns `--resume`. A pruned session falls back to a fresh id automatically.
- Working directories live under `LARK_CLAUDE_WORKDIR_BASE` (default `~/.cc-lark/<open_id>`); transcripts land in `~/.claude/projects/<slug>`.
- Use `/codex sess-status`, `sess-discover`, `sess-alias`, `sess-title`, `sess-log`, and `@alias <task>`. `sess-discover` scans `~/.claude/projects` when the engine is claude.

## Skills and knowledge

- Skill references render as `/name` for Claude. Configure names with `LARK_CODEX_KNOWLEDGE_SKILLS`; they resolve from the shared `~/.claude/skills`.
- Do not place owner-only private skills in the shared `~/.claude`; a read-only agent with `Read` can see them.

## Change configuration and security

- Treat `.env.example` as the public schema and `.env` as private runtime state; update `.env.example`, docs, and tests when adding a source variable.
- Keep owner IDs separate from colleague allowlists and `LARK_CODEX_ALLOW_ALL=0`.
- Run `npm test` and `npm run check:public` before a live restart.
- Require explicit owner intent for permission changes, deletion, credential disclosure, or broad irreversible actions.
