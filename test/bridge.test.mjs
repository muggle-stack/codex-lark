import assert from "node:assert/strict";
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  appendArtifactDeliveryPrompt,
  buildArtifactSandboxOverrides,
  buildCodexAppServerArgs,
  cleanPrompt,
  firstUsefulSessionText,
  inspectArtifactDirectory,
  isCodexTurnActivity,
  isSameOrChildPath,
  isUnauthorizedKnowledgeTriggerText,
  parseBridgeCommand,
  redactSensitiveSessionText,
  stripLeadingTrigger,
  splitArgs,
  splitText,
} from "../src/bridge.mjs";

test("Codex app-server disables the recursive Codex MCP by default", () => {
  assert.deepEqual(
    buildCodexAppServerArgs(),
    [
      "-c",
      'mcp_servers.codex={type="stdio",command="codex",args=["mcp-server"],enabled=false}',
      "app-server",
      "--stdio",
    ],
  );
  assert.deepEqual(buildCodexAppServerArgs(false), ["app-server", "--stdio"]);
});

test("Codex app-server first activity ignores lifecycle-only notifications", () => {
  assert.equal(isCodexTurnActivity("turn/started"), false);
  assert.equal(isCodexTurnActivity("error"), false);
  assert.equal(isCodexTurnActivity("mcpServer/startupStatus/updated"), false);
  assert.equal(isCodexTurnActivity("item/started"), true);
  assert.equal(isCodexTurnActivity("item/agentMessage/delta"), true);
  assert.equal(isCodexTurnActivity("command/exec/outputDelta"), true);
  assert.equal(isCodexTurnActivity("turn/completed"), true);
});

test("P2P trigger matches only a complete command at the start", () => {
  const triggers = ["/troy", "/codex"];

  assert.equal(stripLeadingTrigger("/troy hi", triggers), "hi");
  assert.equal(stripLeadingTrigger(" \n/troy\t hi ", triggers), "hi");
  assert.equal(stripLeadingTrigger("/troy\nsecond line", triggers), "second line");
  assert.equal(stripLeadingTrigger("/troy", triggers), "");
  assert.equal(stripLeadingTrigger("/codex inspect", triggers), "inspect");

  assert.equal(stripLeadingTrigger("你好/troy.", triggers), null);
  assert.equal(stripLeadingTrigger("prefix /troy hi", triggers), null);
  assert.equal(stripLeadingTrigger("/troyish hi", triggers), null);
  assert.equal(stripLeadingTrigger("/troy. hi", triggers), null);
  assert.equal(stripLeadingTrigger("/TROY hi", triggers), null);
});

test("unauthorized reply uses the same start and boundary rules", () => {
  const triggers = ["/troy"];

  assert.equal(isUnauthorizedKnowledgeTriggerText("/troy hi", triggers), true);
  assert.equal(isUnauthorizedKnowledgeTriggerText("  /troy\nhi", triggers), true);
  assert.equal(isUnauthorizedKnowledgeTriggerText("/troy", triggers), true);

  assert.equal(isUnauthorizedKnowledgeTriggerText("你好/troy.", triggers), false);
  assert.equal(isUnauthorizedKnowledgeTriggerText("prefix /troy hi", triggers), false);
  assert.equal(isUnauthorizedKnowledgeTriggerText("/troyish hi", triggers), false);
  assert.equal(isUnauthorizedKnowledgeTriggerText("/troy. hi", triggers), false);
});

test("artifact sandbox narrows writes to the per-run drop box", () => {
  assert.deepEqual(
    buildArtifactSandboxOverrides("/tmp/codex-lark-run/artifacts"),
    {
      runtimeWorkspaceRoots: ["/tmp/codex-lark-run/artifacts"],
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: ["/tmp/codex-lark-run/artifacts"],
        excludeSlashTmp: true,
        excludeTmpdirEnvVar: true,
        networkAccess: false,
      },
    },
  );
});

test("artifact prompt preserves the source workspace as read-only", () => {
  const prompt = appendArtifactDeliveryPrompt("answer the question", "/tmp/run/artifacts");
  assert.match(prompt, /source workspace remain read-only/);
  assert.match(prompt, /\/tmp\/run\/artifacts/);
  assert.match(prompt, /Do not create subdirectories, symlinks, hard links/);
});

test("artifact inspection accepts safe text and rejects links and credentials", (t) => {
  const root = mkdtempSync(join(tmpdir(), "codex-lark-artifacts-"));
  const artifactDir = join(root, "artifacts");
  mkdirSync(artifactDir);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  writeFileSync(join(artifactDir, "report.md"), "| Status | Item |\n|---|---|\n| merged | K3 |\n");
  writeFileSync(join(artifactDir, "secret.md"), "token=abc123456789012345\n");
  writeFileSync(join(artifactDir, "binary.md"), Buffer.from([0, 1, 2, 3]));
  writeFileSync(join(artifactDir, "invalid-utf8.md"), Buffer.from([0xc3, 0x28]));
  writeFileSync(join(root, "outside.md"), "outside\n");
  linkSync(join(root, "outside.md"), join(artifactDir, "hard-link.md"));
  symlinkSync(join(root, "outside.md"), join(artifactDir, "symbolic-link.md"));
  mkdirSync(join(artifactDir, "nested"));

  const inspected = inspectArtifactDirectory(artifactDir, {
    extensions: [".md"],
    maxFiles: 10,
    maxBytes: 1024,
  });
  assert.deepEqual(inspected.files.map((file) => file.name), ["report.md"]);
  assert.equal(inspected.warnings.some((warning) => warning.includes("凭据")), true);
  assert.equal(inspected.warnings.some((warning) => warning.includes("非文本")), true);
  assert.equal(inspected.warnings.some((warning) => warning.includes("链接文件")), true);
  assert.equal(inspected.warnings.some((warning) => warning.includes("非普通文件")), true);
});

test("splitArgs preserves quoted command arguments", () => {
  assert.deepEqual(
    splitArgs('sess-alias abc release --title "Release train"'),
    ["sess-alias", "abc", "release", "--title", "Release train"],
  );
});

test("parseBridgeCommand recognizes aliases and management commands", () => {
  assert.deepEqual(parseBridgeCommand("@release inspect CI"), {
    name: "session-send",
    alias: "release",
    prompt: "inspect CI",
  });
  assert.deepEqual(parseBridgeCommand("sess-status --all"), {
    name: "sess-status",
    args: ["--all"],
    raw: "sess-status --all",
  });
  assert.equal(parseBridgeCommand("ordinary task"), null);
});

test("prompt and title helpers remove wrappers", () => {
  assert.equal(cleanPrompt(" ： hello ， "), "hello");
  assert.equal(
    firstUsefulSessionText("User task:\ninspect the release\n\n<environment_context>hidden</environment_context>"),
    "inspect the release",
  );
});

test("redaction removes common credentials", () => {
  const fakeOpenAIKey = "sk-" + "1234567890abcdef";
  const redacted = redactSensitiveSessionText(
    `password=hunter2 token=abc123456789012345 https://alice:secret@example.com ${fakeOpenAIKey}`,
  );
  assert.equal(redacted.includes("hunter2"), false);
  assert.equal(redacted.includes("abc123456789012345"), false);
  assert.equal(redacted.includes("alice:secret"), false);
  assert.equal(redacted.includes(fakeOpenAIKey), false);
});

test("splitText bounds message chunks", () => {
  const chunks = splitText("alpha\nbeta\ngamma", 8);
  assert.deepEqual(chunks, ["alpha", "beta", "gamma"]);
  assert.equal(chunks.every((chunk) => chunk.length <= 8), true);
});

test("workspace containment does not accept sibling prefixes", () => {
  assert.equal(isSameOrChildPath("/tmp/work/repo", "/tmp/work"), true);
  assert.equal(isSameOrChildPath("/tmp/work-other", "/tmp/work"), false);
});

test("workspace containment rejects parent traversal and cross-drive paths", () => {
  // Reject exact ".." and ".." prefix
  assert.equal(isSameOrChildPath("/tmp", "/tmp/work"), false);
  assert.equal(isSameOrChildPath("/tmp/../etc", "/tmp/work"), false);
  // Accept legitimate paths like "..cache" (not parent traversal)
  assert.equal(isSameOrChildPath("/tmp/work/..cache", "/tmp/work"), true);
  // Windows cross-drive: path.win32.relative("C:\\work", "D:\\secret") returns "D:\\secret"
  // (absolute), which must be rejected
  if (process.platform === "win32") {
    assert.equal(isSameOrChildPath("D:\\secret", "C:\\work"), false);
  }
});
