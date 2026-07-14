import assert from "node:assert/strict";
import test from "node:test";

import {
  PERMISSION_LEVELS,
  normalizePermission,
  permissionFromCodexSandbox,
  permissionToCodexSandbox,
  permissionToClaude,
} from "../src/permission.mjs";

test("normalizePermission accepts known levels and falls back otherwise", () => {
  assert.deepEqual(PERMISSION_LEVELS, ["readonly", "write", "full"]);
  assert.equal(normalizePermission("readonly"), "readonly");
  assert.equal(normalizePermission("FULL"), "full");
  assert.equal(normalizePermission("  write "), "write");
  assert.equal(normalizePermission("bogus"), "write");
  assert.equal(normalizePermission("", "readonly"), "readonly");
});

test("codex sandbox <-> neutral level round-trips", () => {
  assert.equal(permissionFromCodexSandbox("read-only"), "readonly");
  assert.equal(permissionFromCodexSandbox("workspace-write"), "write");
  assert.equal(permissionFromCodexSandbox("danger-full-access"), "full");
  assert.equal(permissionFromCodexSandbox("weird"), "write");

  assert.equal(permissionToCodexSandbox("readonly"), "read-only");
  assert.equal(permissionToCodexSandbox("write"), "workspace-write");
  assert.equal(permissionToCodexSandbox("full"), "danger-full-access");
});

test("claude readonly enforces both sandbox and tool layers", () => {
  const p = permissionToClaude("readonly", { cwd: "/home/u/.cc-lark/ou_x" });
  assert.equal(p.permissionMode, "default");
  assert.deepEqual(p.allowedTools, ["Read", "Glob", "Grep", "Bash"]);
  // Tool layer: built-in write tools denied (they bypass the OS sandbox).
  assert.ok(p.disallowedTools.includes("Write"));
  assert.ok(p.disallowedTools.includes("Edit"));
  // Sandbox layer: filesystem read-only over the working dir, strict, creds hidden.
  assert.equal(p.settings.sandbox.enabled, true);
  assert.equal(p.settings.sandbox.allowUnsandboxedCommands, false);
  assert.equal(p.settings.sandbox.failIfUnavailable, true);
  assert.deepEqual(p.settings.sandbox.filesystem.denyWrite, ["/home/u/.cc-lark/ou_x"]);
  assert.deepEqual(
    p.settings.sandbox.credentials.files.map((f) => f.path),
    ["~/.ssh", "~/.aws"],
  );
  // Project settings ignored so a repo cannot widen the agent.
  assert.deepEqual(p.settingSources, ["user"]);
});

test("claude readonly strict=false opens the unsandboxed escape hatch", () => {
  const p = permissionToClaude("readonly", { cwd: "/w", strictSandbox: false });
  assert.equal(p.settings.sandbox.allowUnsandboxedCommands, true);
});

test("claude write keeps cwd writable and auto-approves", () => {
  const p = permissionToClaude("write", { cwd: "/w" });
  assert.equal(p.permissionMode, "acceptEdits");
  assert.equal(p.disallowedTools, null);
  assert.equal(p.settings.sandbox.enabled, true);
  assert.equal(p.settings.sandbox.autoAllow, true);
  // write level does not deny writes to the working directory.
  assert.equal(p.settings.sandbox.filesystem, undefined);
});

test("claude write can disable the sandbox entirely", () => {
  const p = permissionToClaude("write", { cwd: "/w", sandboxEnabled: false });
  assert.equal(p.settings, null);
});

test("claude full disables sandbox and bypasses permissions", () => {
  const p = permissionToClaude("full", { cwd: "/w" });
  assert.equal(p.permissionMode, "bypassPermissions");
  assert.equal(p.settings, null);
  assert.equal(p.allowedTools, null);
  assert.equal(p.disallowedTools, null);
});

test("custom readonly tool allowlist and network/credentials propagate", () => {
  const p = permissionToClaude("readonly", {
    cwd: "/w",
    readonlyAllowedTools: ["Read", "Grep"],
    networkAllowedDomains: ["*.github.com"],
    credentialsDeny: ["~/.ssh"],
  });
  assert.deepEqual(p.allowedTools, ["Read", "Grep"]);
  assert.deepEqual(p.settings.sandbox.network.allowedDomains, ["*.github.com"]);
  assert.deepEqual(
    p.settings.sandbox.credentials.files,
    [{ path: "~/.ssh", mode: "deny" }],
  );
});
