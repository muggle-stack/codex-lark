// Neutral permission model shared by all engines.
//
// The bridge and the session registry only ever speak in three neutral levels;
// each engine translates a level into its own vocabulary:
//   - Codex:  --sandbox read-only | workspace-write | danger-full-access
//   - Claude: sandbox settings JSON + --permission-mode + --allowed/disallowedTools
//
// This module is pure (no I/O, no process state) so it is fully unit-testable.

export const PERMISSION_LEVELS = ["readonly", "write", "full"];

export function normalizePermission(value, fallback = "write") {
  const v = String(value || "").trim().toLowerCase();
  return PERMISSION_LEVELS.includes(v) ? v : fallback;
}

// Legacy Codex sandbox mode -> neutral level (used when migrating an old
// sessions.json that still stored a `sandbox` field).
export function permissionFromCodexSandbox(sandbox) {
  switch (String(sandbox || "").trim()) {
    case "read-only":
      return "readonly";
    case "danger-full-access":
      return "full";
    case "workspace-write":
      return "write";
    default:
      return "write";
  }
}

// Neutral level -> Codex sandbox mode.
export function permissionToCodexSandbox(level) {
  switch (normalizePermission(level)) {
    case "readonly":
      return "read-only";
    case "full":
      return "danger-full-access";
    default:
      return "workspace-write";
  }
}

// Neutral level -> Claude Code invocation parameters.
//
// Returns:
//   {
//     permissionMode: string,
//     allowedTools:   string[] | null,   // null = leave to Claude default
//     disallowedTools:string[] | null,
//     settings:       object   | null,   // sandbox settings JSON (null = no sandbox)
//     settingSources: string[] | null,   // e.g. ["user"] to ignore project settings
//   }
//
// opts:
//   cwd                  absolute working directory (denied for writes at readonly)
//   readonlyAllowedTools tools a read-only knowledge agent may use
//   networkAllowedDomains sandbox network allowlist
//   credentialsDeny      credential paths to hide from sandboxed commands
//   strictSandbox        true  => allowUnsandboxedCommands:false (no escape hatch)
//   sandboxEnabled       false => write level runs without a sandbox
export function permissionToClaude(level, opts = {}) {
  const lvl = normalizePermission(level);
  const {
    cwd = "",
    readonlyAllowedTools = ["Read", "Glob", "Grep", "Bash"],
    networkAllowedDomains = [],
    credentialsDeny = ["~/.ssh", "~/.aws"],
    strictSandbox = true,
    sandboxEnabled = true,
  } = opts;

  const credentialFiles = credentialsDeny
    .map((p) => String(p || "").trim())
    .filter(Boolean)
    .map((path) => ({ path, mode: "deny" }));

  if (lvl === "full") {
    // Owner / admin: no sandbox, bypass permissions, every tool available.
    return {
      permissionMode: "bypassPermissions",
      allowedTools: null,
      disallowedTools: null,
      settings: null,
      settingSources: null,
    };
  }

  if (lvl === "readonly") {
    // Two enforcement layers (see PLAN §6, D5):
    //   1. OS sandbox: Bash + children run with the filesystem read-only.
    //   2. Tool layer: the built-in Write/Edit tools (which bypass the sandbox)
    //      are denied outright.
    const denyWrite = cwd ? [cwd] : ["."];
    return {
      permissionMode: "default",
      allowedTools: readonlyAllowedTools,
      disallowedTools: ["Write", "Edit", "NotebookEdit"],
      settings: {
        sandbox: {
          enabled: true,
          autoAllow: true,
          allowUnsandboxedCommands: !strictSandbox,
          failIfUnavailable: true,
          filesystem: { denyWrite },
          network: { allowedDomains: networkAllowedDomains },
          credentials: { files: credentialFiles },
        },
      },
      // Ignore the target repo's .claude/settings so a checked-out project
      // cannot widen the read-only agent's permissions.
      settingSources: ["user"],
    };
  }

  // write (bot): sandbox with the working directory writable, auto-approved.
  return {
    permissionMode: "acceptEdits",
    allowedTools: null,
    disallowedTools: null,
    settings: sandboxEnabled
      ? {
          sandbox: {
            enabled: true,
            autoAllow: true,
            allowUnsandboxedCommands: !strictSandbox,
            failIfUnavailable: false,
            network: { allowedDomains: networkAllowedDomains },
            credentials: { files: credentialFiles },
          },
        }
      : null,
    settingSources: null,
  };
}
