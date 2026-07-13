# Contributing

Keep changes focused and preserve the local-first security model.

Before opening a pull request:

```bash
npm test
npm run check:public
node --check src/bridge.mjs
```

Do not include `.env`, Lark IDs, chat history, downloaded attachments, run logs, Codex transcripts, tokens, or personal knowledge Skills. Live integration checks require private credentials and should be reported separately from credential-free unit tests.

Use small commits and explain any permission, sandbox, identity, or message-routing change explicitly in the pull request.
