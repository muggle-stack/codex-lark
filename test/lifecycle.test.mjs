import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  activeWorkSnapshot,
  formatActiveWork,
  isShutdownInterruption,
  isTerminationSignalResult,
  loadInterruptedP2PRecoveryPlans,
  patchRecoveryRecord,
  readRecoveryRecord,
  recoveryContinuationPrompt,
  recoveryDeliverySteps,
  recoveryTaskDescriptor,
  serializeRecoveryOptions,
  waitForActiveWorkToDrain,
} from "../src/lifecycle.mjs";

test("active work snapshot covers current task, queue, and card updates", () => {
  const snapshot = activeWorkSnapshot({
    activeTask: {
      kind: "p2p-session-send",
      alias: "yuting",
      message_id: "om_123",
    },
    queue: [{}, {}],
    running: true,
    p2pAutoReplyPolling: true,
    cardUpdates: new Map([["run", {}]]),
  });

  assert.deepEqual(snapshot, {
    activeTask: {
      kind: "p2p-session-send",
      alias: "yuting",
      message_id: "om_123",
    },
    queued: 2,
    backgroundUpdates: 1,
    polling: true,
    busy: true,
  });
  assert.equal(
    formatActiveWork(snapshot),
    "active=p2p-session-send:yuting queued=2 card_updates=1 p2p_poll=active",
  );
});

test("active work snapshot reports idle only when all work is drained", () => {
  const snapshot = activeWorkSnapshot({
    activeTask: null,
    queue: [],
    running: false,
    p2pAutoReplyPolling: false,
    cardUpdates: new Map(),
  });

  assert.equal(snapshot.busy, false);
  assert.equal(formatActiveWork(snapshot), "idle");
});

test("shutdown drain waits for active work and then succeeds", async () => {
  let busy = true;
  setTimeout(() => {
    busy = false;
  }, 20);

  const result = await waitForActiveWorkToDrain(
    () => ({ busy, activeTask: busy ? { kind: "task" } : null }),
    { intervalMs: 5, timeoutMs: 200 },
  );

  assert.equal(result.drained, true);
  assert.equal(result.snapshot.busy, false);
});

test("shutdown drain exposes the remaining work on timeout", async () => {
  const result = await waitForActiveWorkToDrain(
    () => ({ busy: true, activeTask: { kind: "task", message_id: "om_busy" } }),
    { intervalMs: 5, timeoutMs: 15 },
  );

  assert.equal(result.drained, false);
  assert.equal(result.snapshot.activeTask.message_id, "om_busy");
});

test("recovery continuation stays in the existing thread and artifact box", () => {
  const prompt = recoveryContinuationPrompt("/safe/run/artifacts");

  assert.match(prompt, /previous turn was interrupted/i);
  assert.match(prompt, /same thread/i);
  assert.match(prompt, /\/safe\/run\/artifacts/);
  assert.match(prompt, /do not write elsewhere/i);
});

test("recovery options keep delivery context and discard internal values", () => {
  const options = serializeRecoveryOptions({
    startedReply: false,
    progress: true,
    finalPrefix: "[agent]",
    replyTarget: { kind: "chat", chatId: "oc_123", as: "user", ignored: true },
    cleanupReactions: [
      { messageId: "om_1", reactionId: "react_1", emojiType: "Typing", as: "bot" },
      { messageId: "om_invalid" },
    ],
    images: [{ path: "/tmp/image.png", detail: "high", ignored: true }],
    recovery: { secretInternalState: true },
    arbitrary: "discard",
  });

  assert.deepEqual(options, {
    startedReply: false,
    progress: true,
    finalPrefix: "[agent]",
    replyTarget: { kind: "chat", as: "user", chatId: "oc_123" },
    cleanupReactions: [
      { messageId: "om_1", reactionId: "react_1", emojiType: "Typing", as: "bot" },
    ],
    images: [{ path: "/tmp/image.png", detail: "high" }],
  });
  assert.deepEqual(
    serializeRecoveryOptions({
      replyTarget: { kind: "user", userId: "ou_test", as: "bot" },
    }),
    {
      replyTarget: { kind: "user", as: "bot", userId: "ou_test" },
    },
  );
  assert.deepEqual(
    serializeRecoveryOptions({
      replyTarget: { kind: "unsupported", chatId: "oc_test" },
    }),
    {},
  );
});

test("recovery records are patched atomically without losing prior fields", (t) => {
  const root = mkdtempSync(join(tmpdir(), "codex-lark-recovery-record-"));
  const runDir = join(root, "run-a");
  mkdirSync(runDir);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  patchRecoveryRecord(
    runDir,
    { kind: "p2p-session-send", status: "running", phase: "executing" },
    { now: "2026-07-30T00:00:00.000Z" },
  );
  patchRecoveryRecord(
    runDir,
    { thread_id: "thread-1" },
    { now: "2026-07-30T00:01:00.000Z" },
  );

  assert.deepEqual(readRecoveryRecord(runDir), {
    kind: "p2p-session-send",
    status: "running",
    phase: "executing",
    version: 1,
    updated_at: "2026-07-30T00:01:00.000Z",
    created_at: "2026-07-30T00:00:00.000Z",
    thread_id: "thread-1",
  });
});

test("startup recovery classifies resume, restart, and delivery phases", (t) => {
  const root = mkdtempSync(join(tmpdir(), "codex-lark-recovery-scan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  writeP2PRecord(root, "run-resume", {
    phase: "executing",
    thread_id: "thread-resume",
    created_at: "2026-07-30T00:00:01.000Z",
  });
  writeP2PRecord(root, "run-restart", {
    phase: "executing",
    thread_id: "",
    created_at: "2026-07-30T00:00:02.000Z",
  });
  writeP2PRecord(root, "run-thread-before-turn", {
    phase: "executing",
    thread_id: "thread-without-turn",
    turn_started: false,
    created_at: "2026-07-30T00:00:02.500Z",
  });
  writeP2PRecord(root, "run-deliver", {
    phase: "delivering",
    outcome: "completed",
    final_message: "done",
    created_at: "2026-07-30T00:00:03.000Z",
  });

  const result = loadInterruptedP2PRecoveryPlans(root);

  assert.deepEqual(
    result.plans.map((plan) => [plan.runId, plan.mode]),
    [
      ["run-resume", "resume"],
      ["run-restart", "restart"],
      ["run-thread-before-turn", "restart"],
      ["run-deliver", "deliver"],
    ],
  );
  assert.deepEqual(result.warnings, []);
});

test("startup recovery ignores terminal and unrelated records", (t) => {
  const root = mkdtempSync(join(tmpdir(), "codex-lark-recovery-terminal-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  writeP2PRecord(root, "run-completed", { status: "completed", phase: "completed" });
  writeP2PRecord(root, "run-failed", { status: "failed", phase: "failed" });
  const otherDir = join(root, "run-other");
  mkdirSync(otherDir);
  patchRecoveryRecord(otherDir, {
    kind: "one-off",
    status: "running",
    phase: "executing",
  });

  const result = loadInterruptedP2PRecoveryPlans(root);

  assert.deepEqual(result, { plans: [], warnings: [] });
});

test("startup recovery rejects incomplete, mismatched, and invalid delivery records", (t) => {
  const root = mkdtempSync(join(tmpdir(), "codex-lark-recovery-invalid-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const missingEventDir = join(root, "run-missing-event");
  mkdirSync(missingEventDir);
  patchRecoveryRecord(missingEventDir, {
    kind: "p2p-session-send",
    status: "running",
    phase: "executing",
    alias: "yuting",
    prompt: "task",
  });
  writeP2PRecord(root, "run-mismatch", { run_id: "different-run" });
  writeP2PRecord(root, "run-invalid-delivery", {
    phase: "delivering",
    outcome: "",
  });
  const corruptDir = join(root, "run-corrupt");
  mkdirSync(corruptDir);
  writeFileSync(join(corruptDir, "recovery.json"), "{not-json\n");

  const result = loadInterruptedP2PRecoveryPlans(root);

  assert.deepEqual(result.plans, []);
  assert.equal(result.warnings.length, 4);
  assert.equal(result.warnings.some((warning) => warning.includes("missing event")), true);
  assert.equal(result.warnings.some((warning) => warning.includes("run_id mismatch")), true);
  assert.equal(result.warnings.some((warning) => warning.includes("valid outcome")), true);
  assert.equal(result.warnings.some((warning) => warning.includes("invalid recovery.json")), true);
});

test("recovered queue task descriptors retain run identity", () => {
  assert.deepEqual(
    recoveryTaskDescriptor({
      kind: "p2p-session-send",
      event: { event_id: "event-1", message_id: "om_1" },
      options: {
        recovery: {
          alias: "yuting",
          runId: "run-1",
        },
      },
    }),
    {
      kind: "p2p-session-send",
      alias: "yuting",
      event_id: "event-1",
      message_id: "om_1",
      run_id: "run-1",
    },
  );
});

test("shutdown interruption distinguishes service signals from task failures", () => {
  assert.equal(isShutdownInterruption({ code: 128, stderr: "ordinary failure" }, true), true);
  assert.equal(isShutdownInterruption({ code: 128, stderr: "SIGTERM" }, false), false);
  assert.equal(isShutdownInterruption({ code: 124, stderr: "turn timed out" }, false), false);
  assert.equal(isShutdownInterruption({ code: 1, stderr: "model error" }, false), false);
  assert.equal(isShutdownInterruption({ code: 0, stderr: "SIGTERM" }, true), false);
  assert.equal(
    isTerminationSignalResult({ code: 128, stderr: "codex app-server exited by signal SIGTERM" }),
    true,
  );
  assert.equal(
    isTerminationSignalResult({ code: 128, stderr: "process terminated by SIGINT" }),
    true,
  );
  assert.equal(isTerminationSignalResult({ code: 124, stderr: "turn timed out" }), false);
  assert.equal(isTerminationSignalResult({ code: 0, stderr: "process terminated by SIGTERM" }), false);
});

test("delivery recovery skips checkpoints that already succeeded", () => {
  assert.deepEqual(
    recoveryDeliverySteps({ outcome: "completed" }),
    { reply: true, artifacts: true },
  );
  assert.deepEqual(
    recoveryDeliverySteps({
      outcome: "completed",
      reply_delivered: true,
      artifacts_delivered: false,
    }),
    { reply: false, artifacts: true },
  );
  assert.deepEqual(
    recoveryDeliverySteps({
      outcome: "completed",
      reply_delivered: true,
      artifacts_delivered: true,
    }),
    { reply: false, artifacts: false },
  );
  assert.deepEqual(
    recoveryDeliverySteps({
      outcome: "failed",
      reply_delivered: false,
      artifacts_delivered: false,
    }),
    { reply: true, artifacts: false },
  );
});

function writeP2PRecord(root, runId, overrides = {}) {
  const runDir = join(root, runId);
  mkdirSync(runDir);
  patchRecoveryRecord(runDir, {
    kind: "p2p-session-send",
    status: "running",
    phase: "executing",
    outcome: "",
    run_id: runId,
    alias: "yuting",
    thread_id: "thread-default",
    event: {
      event_id: `event-${runId}`,
      message_id: `message-${runId}`,
      chat_id: "oc_yuting",
      sender_id: "ou_yuting",
    },
    prompt: "generate the report",
    options: {
      replyTarget: { kind: "chat", chatId: "oc_yuting", as: "user" },
    },
    created_at: "2026-07-30T00:00:00.000Z",
    ...overrides,
  });
}
