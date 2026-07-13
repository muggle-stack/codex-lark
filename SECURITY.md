# Security

## Trust Model

`codex-lark` runs on the owner's machine and can start Codex with the permissions configured in `.env`. A Lark sender who can trigger owner mode may therefore cause local file, network, repository, SSH, or Lark API actions.

Treat these as security boundaries:

- Keep `LARK_CODEX_ALLOW_ALL=0`.
- Put only the owner in `LARK_CODEX_OWNER_SENDERS`.
- Restrict bot senders and chats independently.
- Pin P2P colleagues to exact sender and chat IDs.
- Keep `.env`, `.lark-codex/`, downloaded resources, and logs out of Git.
- Use the narrowest workspace and sandbox that still supports the intended task.

## Knowledge-Agent Limitations

The colleague knowledge-agent prompt prohibits writes, secret disclosure, and raw Skill or prompt extraction. Those rules reduce accidental misuse, but prompt instructions are not a hard isolation mechanism. Content from a message, image, document, Wiki page, Skill, or memory can contain prompt injection.

For untrusted colleagues or untrusted documents, use a genuinely isolated machine/account with read-only credentials. Do not rely on `danger-full-access` plus prompt wording as the only control.

## Credentials

The bridge delegates credential storage to Codex and `lark-cli`. Do not add secrets to repository files or task prompts. Password-based SSH is supported only as a compatibility helper; key-based SSH with restricted keys is preferred.

Dynamic-card and run-viewer output is redacted on a best-effort basis. Never assume logs are suitable for public sharing without review.

## Reporting

Before a public remote is created, define a private vulnerability-reporting address and add it here. Until then, do not publish suspected vulnerabilities in a public issue.
