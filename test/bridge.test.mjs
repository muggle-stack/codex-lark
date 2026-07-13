import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanPrompt,
  firstUsefulSessionText,
  isSameOrChildPath,
  parseBridgeCommand,
  redactSensitiveSessionText,
  splitArgs,
  splitText,
} from "../src/bridge.mjs";

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
