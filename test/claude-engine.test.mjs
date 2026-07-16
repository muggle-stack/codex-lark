import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildClaudeArgs,
  claudeProjectSlug,
  describeClaudeEvent,
  discoverClaudeSessions,
  extractClaudeFinal,
  isLikelyClaudeSessionId,
  isResumeMissError,
  readClaudeSessionMeta,
} from "../src/engines/claude.mjs";
import { permissionToClaude } from "../src/permission.mjs";

test("isLikelyClaudeSessionId matches UUIDs only", () => {
  assert.equal(isLikelyClaudeSessionId("4750c70e-e903-4096-a111-bbf6d8f5e916"), true);
  assert.equal(isLikelyClaudeSessionId("not-a-uuid"), false);
  assert.equal(isLikelyClaudeSessionId(""), false);
  assert.equal(isLikelyClaudeSessionId(null), false);
});

test("claudeProjectSlug replaces non-alphanumerics with dashes", () => {
  assert.equal(
    claudeProjectSlug("/tmp/claude-1000/-home/x"),
    "-tmp-claude-1000--home-x",
  );
  assert.equal(claudeProjectSlug("/home/troy/.cc-lark/ou_x"), "-home-troy--cc-lark-ou-x");
});

test("buildClaudeArgs: oneshot with pre-assigned session id", () => {
  const perm = permissionToClaude("write", { cwd: "/w" });
  const args = buildClaudeArgs({ mode: "oneshot", sessionId: "11111111-1111-1111-1111-111111111111", model: "sonnet", permission: perm });
  assert.ok(args.includes("-p"));
  assert.deepEqual(args.slice(0, 4), ["-p", "--output-format", "stream-json", "--verbose"]);
  assert.ok(args.includes("--session-id"));
  assert.ok(!args.includes("--resume"));
  assert.equal(args[args.indexOf("--model") + 1], "sonnet");
  assert.equal(args[args.indexOf("--permission-mode") + 1], "acceptEdits");
  // settings JSON is passed inline
  const settingsArg = args[args.indexOf("--settings") + 1];
  assert.equal(JSON.parse(settingsArg).sandbox.enabled, true);
});

test("buildClaudeArgs: resume uses --resume, not --session-id", () => {
  const perm = permissionToClaude("readonly", { cwd: "/w" });
  const args = buildClaudeArgs({ mode: "resume", sessionId: "22222222-2222-2222-2222-222222222222", permission: perm });
  assert.ok(args.includes("--resume"));
  assert.ok(!args.includes("--session-id"));
  assert.equal(args[args.indexOf("--allowedTools") + 1], "Read,Glob,Grep,Bash");
  assert.equal(args[args.indexOf("--disallowedTools") + 1], "Write,Edit,NotebookEdit");
  assert.equal(args[args.indexOf("--setting-sources") + 1], "user");
});

test("buildClaudeArgs: resume without session id throws", () => {
  assert.throws(() => buildClaudeArgs({ mode: "resume", permission: {} }), /requires a sessionId/);
});

test("buildClaudeArgs: full level omits sandbox settings", () => {
  const perm = permissionToClaude("full", { cwd: "/w" });
  const args = buildClaudeArgs({ mode: "oneshot", permission: perm });
  assert.ok(!args.includes("--settings"));
  assert.equal(args[args.indexOf("--permission-mode") + 1], "bypassPermissions");
});

test("describeClaudeEvent maps events to progress strings", () => {
  assert.equal(describeClaudeEvent({ type: "system", subtype: "init" }), "Claude 已启动");
  assert.equal(describeClaudeEvent({ type: "system", subtype: "hook_started" }), null);
  assert.equal(
    describeClaudeEvent({ type: "assistant", message: { content: [{ type: "thinking" }] } }),
    "分析中",
  );
  assert.equal(
    describeClaudeEvent({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "git status" } }] } }),
    "执行命令：git status",
  );
  assert.equal(
    describeClaudeEvent({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/a/b.txt" } }] } }),
    "读取/搜索：/a/b.txt",
  );
  assert.equal(
    describeClaudeEvent({ type: "assistant", message: { content: [{ type: "tool_use", name: "WebSearch", input: {} }] } }),
    "调用工具：WebSearch",
  );
  // plain text chunks are not progress
  assert.equal(describeClaudeEvent({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } }), null);
});

test("extractClaudeFinal reads result events", () => {
  assert.equal(extractClaudeFinal({ type: "assistant" }), null);
  const ok = extractClaudeFinal({ type: "result", subtype: "success", result: "done", session_id: "abc", is_error: false });
  assert.equal(ok.finalMessage, "done");
  assert.equal(ok.sessionId, "abc");
  assert.equal(ok.isError, false);
  const bad = extractClaudeFinal({ type: "result", subtype: "error_max_turns", result: "", is_error: true });
  assert.equal(bad.isError, true);
});

test("isResumeMissError detects pruned sessions", () => {
  assert.equal(isResumeMissError("Error: No conversation found with session ID xyz"), true);
  assert.equal(isResumeMissError("could not find session"), true);
  assert.equal(isResumeMissError("some unrelated failure"), false);
});

test("discoverClaudeSessions reads transcripts from the slug dir", () => {
  const home = mkdtempSync(join(tmpdir(), "cc-home-"));
  const cwd = "/home/u/.cc-lark/ou_demo";
  const dir = join(home, ".claude", "projects", claudeProjectSlug(cwd));
  mkdirSync(dir, { recursive: true });
  const sid = "33333333-3333-3333-3333-333333333333";
  const lines = [
    JSON.stringify({ type: "queue-operation", sessionId: sid }),
    JSON.stringify({ type: "user", cwd, sessionId: sid, message: { content: "Summarize the release notes" } }),
    JSON.stringify({ type: "assistant", cwd, sessionId: sid, message: { content: [{ type: "text", text: "ok" }] } }),
  ];
  writeFileSync(join(dir, `${sid}.jsonl`), lines.join("\n") + "\n");

  const found = discoverClaudeSessions({ cwd, home, limit: 10 });
  assert.equal(found.length, 1);
  assert.equal(found[0].sessionId, sid);
  assert.equal(found[0].cwd, cwd);
  assert.equal(found[0].preview, "Summarize the release notes");
  assert.equal(found[0].title, "Summarize the release notes");

  // meta reader directly
  const meta = readClaudeSessionMeta(join(dir, `${sid}.jsonl`));
  assert.equal(meta.cwd, cwd);
  assert.equal(meta.preview, "Summarize the release notes");
});

test("discoverClaudeSessions returns [] when no project dir exists", () => {
  const home = mkdtempSync(join(tmpdir(), "cc-home-empty-"));
  assert.deepEqual(discoverClaudeSessions({ cwd: "/nope", home }), []);
});
