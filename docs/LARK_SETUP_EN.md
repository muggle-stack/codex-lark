# Lark / Feishu Setup

[中文](LARK_SETUP.md)

The bridge uses two identities:

- `bot` receives app events, sends bot messages, updates cards, and adds reactions.
- `user` reads owner-visible P2P messages and Wiki/Docs/Drive resources, and may send from the owner's conversation when explicitly enabled.

Bot scopes are granted in the developer console. User features require both app scopes and completed user authorization.

## Permission Matrix

| Feature | Identity | Common requirement |
|---|---|---|
| Receive bot messages | bot | event `im.message.receive_v1`; current scope `im:message.p2p_msg:readonly` |
| Send bot replies/cards | bot | bot message-send scope, commonly `im:message:send_as_bot` |
| Add/remove `Typing` | bot or user | `im:message.reactions:write_only` or the equivalent scope reported by the console |
| Search owner-visible messages | user | `search:message` and IM read scopes |
| Read an exact P2P chat | user | `im:message.p2p_msg:get_as_user` and message read access |
| Send as the owner | user | `im:message.send_as_user` |
| Read Wiki and documents | user | `wiki`, `docs`, and `drive` domains |
| Write Wiki and documents | user | matching write scope plus edit access to the resource |

Scope names can evolve. For permission failures, treat `permission_violations`, `console_url`, and `hint` from the CLI error as the source of truth.

## Configure

```bash
lark-cli update
lark-cli config init --new
lark-cli event schema im.message.receive_v1 --json
```

In the developer console, enable bot capability, add the receive-message event, grant the required bot scopes, restrict app availability, and publish a new app version.

For owner P2P and knowledge features:

```bash
lark-cli auth login --domain im,wiki,docs,drive --no-wait --json
lark-cli auth login --device-code <device_code>
lark-cli auth status --json --verify
```

Or run the interactive setup flow:

```bash
npm run setup -- --authorize-user --workdir "$HOME/workspace" --install-launchd
```

Never store app secrets, tokens, authorization URLs, or device codes in `.env` or Git. User access tokens can refresh only while the refresh authorization remains valid.
