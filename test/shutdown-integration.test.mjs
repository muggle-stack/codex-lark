import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { patchRecoveryRecord, readRecoveryRecord } from "../src/lifecycle.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("SIGTERM stops ingress and drains the active bridge task before exit", {
  skip: process.platform === "win32",
  timeout: 10_000,
}, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "codex-lark-shutdown-"));
  const binDir = join(root, "bin");
  mkdirSync(binDir);
  cpSync(join(projectRoot, "src"), join(root, "src"), { recursive: true });
  writeExecutable(join(binDir, "lark-cli"), fakeLarkCliSource());
  writeExecutable(join(binDir, "codex"), fakeCodexSource());
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const child = spawn(process.execPath, [join(root, "src", "bridge.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH || ""}`,
      LARK_CODEX_ALLOW_ALL: "1",
      LARK_CODEX_ALLOWED_SENDERS: "ou_test",
      LARK_CODEX_BOT_EVENTS_ENABLED: "1",
      LARK_CODEX_RUN_VIEWER_ENABLED: "0",
      LARK_CODEX_P2P_AUTO_REPLY_ENABLED: "0",
      LARK_CODEX_DYNAMIC_CARD_ENABLED: "0",
      LARK_CODEX_PROGRESS_ENABLED: "0",
      LARK_CODEX_STARTED_REPLY_ENABLED: "0",
      LARK_CODEX_STARTED_REACTION_ENABLED: "0",
      LARK_CODEX_RECOVER_INTERRUPTED_TASKS: "0",
      LARK_CODEX_WORKDIR: root,
      LARK_CODEX_SHUTDOWN_DRAIN_TIMEOUT_MS: "2000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  });

  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });

  await waitFor(() => latestRunStatus(root)?.status === "running", 3000);
  const signalAt = Date.now();
  child.kill("SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null) child.kill("SIGTERM");
  }, 30);
  const exit = await waitForExit(child);
  const elapsedAfterSignal = Date.now() - signalAt;

  assert.equal(exit.code, 0, output);
  assert.ok(elapsedAfterSignal >= 150, `bridge exited before the active task drained (${elapsedAfterSignal}ms)`);
  assert.match(output, /pre-restart active task check: active=one-off:/);
  assert.match(output, /draining active and queued tasks before shutdown/);
  assert.match(output, /shutdown drain complete/);
  assert.equal(latestRunStatus(root)?.status, "completed");
});

test("startup resumes a persisted P2P thread and delivers its final reply", {
  skip: process.platform === "win32",
  timeout: 10_000,
}, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "codex-lark-startup-recovery-"));
  const binDir = join(root, "bin");
  const runId = "run-recovery";
  const runDir = join(root, ".lark-codex", "runs", runId);
  const larkLog = join(root, "lark.jsonl");
  const codexLog = join(root, "codex.jsonl");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(runDir, { recursive: true });
  cpSync(join(projectRoot, "src"), join(root, "src"), { recursive: true });
  writeExecutable(join(binDir, "lark-cli"), fakeLarkCliSource());
  writeExecutable(join(binDir, "codex"), fakeAppServerCodexSource());
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const event = {
    event_id: "event-recovery",
    chat_id: "oc_test",
    chat_type: "p2p",
    sender_id: "ou_test",
    message_id: "om_test",
    content: "/troy generate report",
    type: "p2p_auto_reply",
  };
  patchRecoveryRecord(runDir, {
    kind: "p2p-session-send",
    status: "running",
    phase: "executing",
    outcome: "",
    run_id: runId,
    alias: "yuting",
    thread_id: "thread-recovery",
    event,
    prompt: "original report task",
    options: {
      startedReply: false,
      finalPrefix: "",
      replyTarget: { kind: "chat", chatId: "oc_test", as: "user" },
    },
    artifact_dir: "",
    recovery_attempts: 0,
  });
  writeFileSync(join(runDir, "status.json"), `${JSON.stringify({
    version: 1,
    run_id: runId,
    status: "running",
    kind: "p2p-session",
    session_alias: "yuting",
    chat_id: "oc_test",
    sender_id: "ou_test",
    message_id: "om_test",
    created_at: "2026-07-30T00:00:00.000Z",
    updated_at: "2026-07-30T00:00:00.000Z",
  }, null, 2)}\n`);
  const stateDir = join(root, ".lark-codex");
  writeFileSync(join(stateDir, "sessions.json"), `${JSON.stringify({
    version: 1,
    sessions: {
      yuting: {
        alias: "yuting",
        title: "P2P yuting",
        engine: "codex",
        permission: "readonly",
        backend: "app-server",
        session_id: "thread-recovery",
        cwd: root,
        sandbox: "read-only",
        model: "",
        status: "running",
        chat_id: "oc_test",
        sender_id: "ou_test",
      },
    },
  }, null, 2)}\n`);

  const child = spawn(process.execPath, [join(root, "src", "bridge.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH || ""}`,
      FAKE_LARK_LOG: larkLog,
      FAKE_CODEX_LOG: codexLog,
      LARK_CODEX_ALLOWED_SENDERS: "ou_test",
      LARK_CODEX_BOT_EVENTS_ENABLED: "0",
      LARK_CODEX_RUN_VIEWER_ENABLED: "0",
      LARK_CODEX_DYNAMIC_CARD_ENABLED: "0",
      LARK_CODEX_P2P_AUTO_REPLY_ENABLED: "1",
      LARK_CODEX_P2P_AUTO_REPLY_ALLOWED_SENDERS: "ou_test",
      LARK_CODEX_P2P_AUTO_REPLY_POLL_SECONDS: "60",
      LARK_CODEX_P2P_AUTO_REPLY_SESSION_MODE: "per_sender",
      LARK_CODEX_P2P_AUTO_REPLY_SESSION_BACKEND: "app-server",
      LARK_CODEX_P2P_AUTO_REPLY_SESSION_SANDBOX: "read-only",
      LARK_CODEX_P2P_AUTO_REPLY_SESSION_WORKDIR: root,
      LARK_CODEX_P2P_ARTIFACTS_ENABLED: "0",
      LARK_CODEX_RECOVER_INTERRUPTED_TASKS: "1",
      LARK_CODEX_SHUTDOWN_DRAIN_TIMEOUT_MS: "2000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  });

  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });

  await waitFor(() => readRecoveryRecord(runDir)?.status === "completed", 5000);
  child.kill("SIGTERM");
  const exit = await waitForExit(child);

  assert.equal(exit.code, 0, output);
  assert.match(output, /interrupted P2P task enqueued: run_id=run-recovery mode=resume/);
  assert.equal(latestRunStatus(root)?.status, "completed");
  const registry = JSON.parse(readFileSync(join(stateDir, "sessions.json"), "utf8"));
  assert.equal(registry.sessions.yuting.session_id, "thread-recovery");
  assert.equal(registry.sessions.yuting.status, "idle");

  const codexRequests = readJsonLines(codexLog);
  assert.equal(
    codexRequests.some((request) =>
      request.method === "thread/resume" &&
      request.params?.threadId === "thread-recovery"),
    true,
  );
  const resumedTurn = codexRequests.find((request) => request.method === "turn/start");
  assert.match(resumedTurn.params.input[0].text, /previous turn was interrupted/i);
  const larkCalls = readJsonLines(larkLog);
  const finalReply = larkCalls.find((args) =>
    args.includes("+messages-send") &&
    args.includes("--markdown") &&
    args.includes("recovered done"));
  assert.ok(finalReply, "recovered final reply was not sent");
});

test("startup restarts the original P2P request when no turn was submitted", {
  skip: process.platform === "win32",
  timeout: 10_000,
}, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "codex-lark-startup-restart-"));
  const binDir = join(root, "bin");
  const runId = "run-restart";
  const larkLog = join(root, "lark.jsonl");
  const codexLog = join(root, "codex.jsonl");
  mkdirSync(binDir, { recursive: true });
  cpSync(join(projectRoot, "src"), join(root, "src"), { recursive: true });
  writeExecutable(join(binDir, "lark-cli"), fakeLarkCliSource());
  writeExecutable(join(binDir, "codex"), fakeAppServerCodexSource());
  const fixture = seedRecoveryFixture(root, runId);
  patchRecoveryRecord(fixture.runDir, {
    thread_id: "",
    turn_started: false,
    prompt: "original request before turn start",
  });
  const registry = JSON.parse(readFileSync(join(fixture.stateDir, "sessions.json"), "utf8"));
  registry.sessions.yuting.session_id = "";
  writeFileSync(join(fixture.stateDir, "sessions.json"), `${JSON.stringify(registry, null, 2)}\n`);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const child = spawnRecoveryBridge(root, binDir, {
    FAKE_LARK_LOG: larkLog,
    FAKE_CODEX_LOG: codexLog,
  });
  t.after(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  });

  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });

  await waitFor(() => readRecoveryRecord(fixture.runDir)?.status === "completed", 5000);
  child.kill("SIGTERM");
  const exit = await waitForExit(child);

  assert.equal(exit.code, 0, output);
  assert.match(output, /interrupted P2P task enqueued: run_id=run-restart mode=restart/);
  const codexRequests = readJsonLines(codexLog);
  assert.equal(codexRequests.some((request) => request.method === "thread/start"), true);
  assert.equal(codexRequests.some((request) => request.method === "thread/resume"), false);
  const restartedTurn = codexRequests.find((request) => request.method === "turn/start");
  assert.equal(restartedTurn.params.input[0].text, "original request before turn start");
  assert.equal(readRecoveryRecord(fixture.runDir)?.thread_id, "thread-restarted");
});

test("startup delivers a completed P2P result without rerunning Codex", {
  skip: process.platform === "win32",
  timeout: 10_000,
}, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "codex-lark-startup-delivery-"));
  const binDir = join(root, "bin");
  const runId = "run-delivery";
  const larkLog = join(root, "lark.jsonl");
  const codexLog = join(root, "codex.jsonl");
  mkdirSync(binDir, { recursive: true });
  cpSync(join(projectRoot, "src"), join(root, "src"), { recursive: true });
  writeExecutable(join(binDir, "lark-cli"), fakeLarkCliSource());
  writeExecutable(join(binDir, "codex"), fakeAppServerCodexSource());
  const fixture = seedRecoveryFixture(root, runId);
  patchRecoveryRecord(fixture.runDir, {
    status: "running",
    phase: "delivering",
    outcome: "completed",
    final_message: "completed before restart",
    reply_delivered: false,
    artifacts_delivered: true,
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const child = spawnRecoveryBridge(root, binDir, {
    FAKE_LARK_LOG: larkLog,
    FAKE_CODEX_LOG: codexLog,
  });
  t.after(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  });

  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });

  await waitFor(() => readRecoveryRecord(fixture.runDir)?.status === "completed", 5000);
  child.kill("SIGTERM");
  const exit = await waitForExit(child);

  assert.equal(exit.code, 0, output);
  assert.match(output, /interrupted P2P task enqueued: run_id=run-delivery mode=deliver/);
  assert.equal(existsSync(codexLog), false, "delivery-only recovery unexpectedly started Codex");
  const larkCalls = readJsonLines(larkLog);
  const finalReply = larkCalls.find((args) =>
    args.includes("+messages-send") &&
    args.includes("--markdown") &&
    args.includes("completed before restart"));
  assert.ok(finalReply, "completed result was not delivered");
});

test("control-group SIGTERM leaves an active P2P turn recoverable", {
  skip: process.platform === "win32",
  timeout: 10_000,
}, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "codex-lark-control-group-"));
  const binDir = join(root, "bin");
  const runId = "run-control-group";
  const codexLog = join(root, "codex.jsonl");
  const codexPidFile = join(root, "codex.pid");
  mkdirSync(binDir, { recursive: true });
  cpSync(join(projectRoot, "src"), join(root, "src"), { recursive: true });
  writeExecutable(join(binDir, "lark-cli"), fakeLarkCliSource());
  writeExecutable(join(binDir, "codex"), fakeAppServerCodexSource());
  const fixture = seedRecoveryFixture(root, runId);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const child = spawn(process.execPath, [join(root, "src", "bridge.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH || ""}`,
      FAKE_CODEX_LOG: codexLog,
      FAKE_CODEX_PID_FILE: codexPidFile,
      FAKE_CODEX_DELAY_MS: "1000",
      LARK_CODEX_ALLOWED_SENDERS: "ou_test",
      LARK_CODEX_BOT_EVENTS_ENABLED: "0",
      LARK_CODEX_RUN_VIEWER_ENABLED: "0",
      LARK_CODEX_DYNAMIC_CARD_ENABLED: "0",
      LARK_CODEX_P2P_AUTO_REPLY_ENABLED: "1",
      LARK_CODEX_P2P_AUTO_REPLY_ALLOWED_SENDERS: "ou_test",
      LARK_CODEX_P2P_AUTO_REPLY_POLL_SECONDS: "60",
      LARK_CODEX_P2P_AUTO_REPLY_SESSION_MODE: "per_sender",
      LARK_CODEX_P2P_AUTO_REPLY_SESSION_BACKEND: "app-server",
      LARK_CODEX_P2P_AUTO_REPLY_SESSION_SANDBOX: "read-only",
      LARK_CODEX_P2P_AUTO_REPLY_SESSION_WORKDIR: root,
      LARK_CODEX_P2P_ARTIFACTS_ENABLED: "0",
      LARK_CODEX_RECOVER_INTERRUPTED_TASKS: "1",
      LARK_CODEX_SHUTDOWN_DRAIN_TIMEOUT_MS: "2000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  });

  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });

  await waitFor(() =>
    existsSync(codexPidFile) &&
    existsSync(codexLog) &&
    readJsonLines(codexLog).some((request) => request.method === "turn/start"),
  3000);
  const codexPid = Number(readFileSync(codexPidFile, "utf8"));
  child.kill("SIGTERM");
  process.kill(codexPid, "SIGTERM");
  const exit = await waitForExit(child);

  assert.equal(exit.code, 0, output);
  assert.match(output, /pre-restart active task check: active=p2p-session-send:yuting/);
  const recovery = readRecoveryRecord(fixture.runDir);
  assert.equal(recovery.status, "running");
  assert.equal(recovery.phase, "executing");
  assert.equal(recovery.thread_id, "thread-recovery");
  assert.equal(recovery.turn_started, true);
  assert.equal(latestRunStatus(root)?.status, "recovering");
  const registry = JSON.parse(readFileSync(join(fixture.stateDir, "sessions.json"), "utf8"));
  assert.equal(registry.sessions.yuting.status, "running");
});

function latestRunStatus(root) {
  const runRoot = join(root, ".lark-codex", "runs");
  let entries;
  try {
    entries = readdirSync(runRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return null;
  }
  const latest = entries.at(-1);
  if (!latest) return null;
  try {
    return JSON.parse(readFileSync(join(runRoot, latest.name, "status.json"), "utf8"));
  } catch {
    return null;
  }
}

async function waitFor(predicate, timeoutMs) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`condition was not met within ${timeoutMs}ms`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
}

function waitForExit(child) {
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error("bridge did not exit")), 5000);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ code, signal });
    });
  });
}

function writeExecutable(path, source) {
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}

function spawnRecoveryBridge(root, binDir, overrides = {}) {
  return spawn(process.execPath, [join(root, "src", "bridge.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH || ""}`,
      LARK_CODEX_ALLOWED_SENDERS: "ou_test",
      LARK_CODEX_BOT_EVENTS_ENABLED: "0",
      LARK_CODEX_RUN_VIEWER_ENABLED: "0",
      LARK_CODEX_DYNAMIC_CARD_ENABLED: "0",
      LARK_CODEX_P2P_AUTO_REPLY_ENABLED: "1",
      LARK_CODEX_P2P_AUTO_REPLY_ALLOWED_SENDERS: "ou_test",
      LARK_CODEX_P2P_AUTO_REPLY_POLL_SECONDS: "60",
      LARK_CODEX_P2P_AUTO_REPLY_SESSION_MODE: "per_sender",
      LARK_CODEX_P2P_AUTO_REPLY_SESSION_BACKEND: "app-server",
      LARK_CODEX_P2P_AUTO_REPLY_SESSION_SANDBOX: "read-only",
      LARK_CODEX_P2P_AUTO_REPLY_SESSION_WORKDIR: root,
      LARK_CODEX_P2P_ARTIFACTS_ENABLED: "0",
      LARK_CODEX_RECOVER_INTERRUPTED_TASKS: "1",
      LARK_CODEX_SHUTDOWN_DRAIN_TIMEOUT_MS: "2000",
      ...overrides,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function fakeLarkCliSource() {
  return `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
if (process.env.FAKE_LARK_LOG) {
  appendFileSync(process.env.FAKE_LARK_LOG, JSON.stringify(args) + "\\n");
}
if (args[0] === "auth" && args[1] === "status") {
  console.log(JSON.stringify({
    identities: {
      bot: { openId: "ou_bot", appName: "test-bot" },
      user: { openId: "ou_test" }
    }
  }));
  process.exit(0);
}
if (args[0] === "event" && args[1] === "consume") {
  console.log(JSON.stringify({
    event_id: "event-test",
    chat_id: "oc_test",
    chat_type: "p2p",
    sender_id: "ou_test",
    message_id: "om_test",
    content: "/codex slow task"
  }));
  const timer = setInterval(() => {}, 1000);
  process.on("SIGTERM", () => {
    clearInterval(timer);
    process.exit(0);
  });
  return;
}
if (args.includes("+messages-search")) {
  console.log(JSON.stringify({ ok: true, data: { items: [] } }));
  process.exit(0);
}
console.log(JSON.stringify({ ok: true, data: { message_id: "om_reply" } }));
`;
}

function fakeCodexSource() {
  return `#!/usr/bin/env node
const { dirname } = require("node:path");
const { mkdirSync, writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
const outputIndex = args.indexOf("-o");
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : "";
console.log(JSON.stringify({ type: "thread.started", thread_id: "thread-test" }));
console.log(JSON.stringify({ type: "turn.started" }));
setTimeout(() => {
  if (outputPath) {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, "done");
  }
  console.log(JSON.stringify({
    type: "item.completed",
    item: { type: "agent_message", text: "done" }
  }));
  process.exit(0);
}, 350);
`;
}

function fakeAppServerCodexSource() {
  return `#!/usr/bin/env node
const { appendFileSync, writeFileSync } = require("node:fs");
const readline = require("node:readline");
if (process.env.FAKE_CODEX_PID_FILE) {
  writeFileSync(process.env.FAKE_CODEX_PID_FILE, String(process.pid));
}
const delayMs = Number(process.env.FAKE_CODEX_DELAY_MS || "30");
let activeThreadId = "thread-recovery";
const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  const request = JSON.parse(line);
  if (process.env.FAKE_CODEX_LOG) {
    appendFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify(request) + "\\n");
  }
  if (!request.id || !request.method) return;
  if (request.method === "initialize") {
    console.log(JSON.stringify({ id: request.id, result: {} }));
    return;
  }
  if (request.method === "thread/resume") {
    activeThreadId = request.params.threadId;
    console.log(JSON.stringify({
      id: request.id,
      result: { thread: { id: activeThreadId } }
    }));
    return;
  }
  if (request.method === "thread/start") {
    activeThreadId = "thread-restarted";
    console.log(JSON.stringify({
      id: request.id,
      result: { thread: { id: activeThreadId } }
    }));
    return;
  }
  if (request.method === "turn/start") {
    console.log(JSON.stringify({
      id: request.id,
      result: { turn: { id: "turn-recovery", status: "inProgress", items: [] } }
    }));
    setTimeout(() => {
      console.log(JSON.stringify({
        method: "item/completed",
        params: {
          item: {
            id: "agent-final",
            type: "agentMessage",
            phase: "final_answer",
            text: "recovered done"
          }
        }
      }));
      console.log(JSON.stringify({
        method: "turn/completed",
        params: {
          threadId: activeThreadId,
          turn: {
            id: "turn-recovery",
            status: "completed",
            items: [{
              id: "agent-final",
              type: "agentMessage",
              phase: "final_answer",
              text: "recovered done"
            }]
          }
        }
      }));
    }, delayMs);
  }
});
`;
}

function readJsonLines(path) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function seedRecoveryFixture(root, runId) {
  const runDir = join(root, ".lark-codex", "runs", runId);
  const stateDir = join(root, ".lark-codex");
  mkdirSync(runDir, { recursive: true });
  const event = {
    event_id: `event-${runId}`,
    chat_id: "oc_test",
    chat_type: "p2p",
    sender_id: "ou_test",
    message_id: `message-${runId}`,
    content: "/troy task",
    type: "p2p_auto_reply",
  };
  patchRecoveryRecord(runDir, {
    kind: "p2p-session-send",
    status: "running",
    phase: "executing",
    outcome: "",
    run_id: runId,
    alias: "yuting",
    thread_id: "thread-recovery",
    turn_started: true,
    event,
    prompt: "original task",
    options: {
      startedReply: false,
      finalPrefix: "",
      replyTarget: { kind: "chat", chatId: "oc_test", as: "user" },
    },
    artifact_dir: "",
    recovery_attempts: 0,
  });
  writeFileSync(join(runDir, "status.json"), `${JSON.stringify({
    version: 1,
    run_id: runId,
    status: "running",
    kind: "p2p-session",
    session_alias: "yuting",
    chat_id: "oc_test",
    sender_id: "ou_test",
    message_id: event.message_id,
    created_at: "2026-07-30T00:00:00.000Z",
    updated_at: "2026-07-30T00:00:00.000Z",
  }, null, 2)}\n`);
  writeFileSync(join(stateDir, "sessions.json"), `${JSON.stringify({
    version: 1,
    sessions: {
      yuting: {
        alias: "yuting",
        title: "P2P yuting",
        engine: "codex",
        permission: "readonly",
        backend: "app-server",
        session_id: "thread-recovery",
        cwd: root,
        sandbox: "read-only",
        model: "",
        status: "running",
        chat_id: "oc_test",
        sender_id: "ou_test",
      },
    },
  }, null, 2)}\n`);
  return { event, runDir, stateDir };
}
