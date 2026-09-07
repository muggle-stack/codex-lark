import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export const RECOVERY_FILE = "recovery.json";

export function activeWorkSnapshot(runtime = {}) {
  const queued = Array.isArray(runtime.queue) ? runtime.queue.length : 0;
  const activeTask = runtime.activeTask && typeof runtime.activeTask === "object"
    ? { ...runtime.activeTask }
    : null;
  const backgroundUpdates = runtime.cardUpdates instanceof Map
    ? runtime.cardUpdates.size
    : Number(runtime.backgroundUpdates || 0);
  const polling = Boolean(runtime.p2pAutoReplyPolling);
  return {
    activeTask,
    queued,
    backgroundUpdates,
    polling,
    busy: Boolean(activeTask || queued > 0 || runtime.running || backgroundUpdates > 0 || polling),
  };
}

export function formatActiveWork(snapshot = {}) {
  const parts = [];
  if (snapshot.activeTask) {
    const task = snapshot.activeTask;
    parts.push(
      `active=${task.kind || "task"}:${task.alias || task.message_id || task.event_id || "unknown"}`,
    );
  }
  if (snapshot.queued > 0) parts.push(`queued=${snapshot.queued}`);
  if (snapshot.backgroundUpdates > 0) parts.push(`card_updates=${snapshot.backgroundUpdates}`);
  if (snapshot.polling) parts.push("p2p_poll=active");
  return parts.length > 0 ? parts.join(" ") : "idle";
}

export async function waitForActiveWorkToDrain(getSnapshot, options = {}) {
  const intervalMs = positiveInteger(options.intervalMs, 50);
  const timeoutMs = nonNegativeInteger(options.timeoutMs, 0);
  const startedAt = Date.now();
  while (true) {
    const snapshot = getSnapshot();
    if (!snapshot?.busy) {
      return { drained: true, elapsed_ms: Date.now() - startedAt, snapshot };
    }
    if (timeoutMs > 0 && Date.now() - startedAt >= timeoutMs) {
      return { drained: false, elapsed_ms: Date.now() - startedAt, snapshot };
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
  }
}

export function recoveryContinuationPrompt(artifactDir = "") {
  return [
    "The previous turn was interrupted because the bridge process stopped.",
    "Continue the original task in this same thread from the work already completed.",
    "Re-check any incomplete tool result, finish the requested deliverable, and provide the final answer.",
    artifactDir
      ? `Use the existing artifact drop box at ${artifactDir}; finish or replace only the requested files there and do not write elsewhere.`
      : "",
    "Do not repeat progress commentary from the interrupted turn.",
  ].filter(Boolean).join("\n");
}

export function serializeRecoveryOptions(options = {}) {
  const serialized = {};
  for (const key of [
    "startedReply",
    "progress",
    "progressMessages",
    "dynamicCard",
    "finalPrefix",
  ]) {
    if (["boolean", "string", "number"].includes(typeof options[key])) {
      serialized[key] = options[key];
    }
  }
  if (isReplyTarget(options.replyTarget)) {
    serialized.replyTarget = {
      kind: options.replyTarget.kind,
      as: String(options.replyTarget.as || ""),
      ...(options.replyTarget.kind === "chat"
        ? { chatId: String(options.replyTarget.chatId || "") }
        : { userId: String(options.replyTarget.userId || "") }),
    };
  }
  if (Array.isArray(options.cleanupReactions)) {
    serialized.cleanupReactions = options.cleanupReactions
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        messageId: String(item.messageId || ""),
        reactionId: String(item.reactionId || ""),
        emojiType: String(item.emojiType || ""),
        as: String(item.as || ""),
      }))
      .filter((item) => item.messageId && item.reactionId);
  }
  if (Array.isArray(options.images)) {
    serialized.images = options.images
      .filter((item) => item && typeof item === "object" && item.path)
      .map((item) => ({
        path: String(item.path),
        detail: String(item.detail || "auto"),
      }));
  }
  return serialized;
}

export function readRecoveryRecord(runDir) {
  const path = join(runDir, RECOVERY_FILE);
  if (!existsSync(path)) return null;
  try {
    const payload = JSON.parse(readFileSync(path, "utf8"));
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

export function patchRecoveryRecord(runDir, patch = {}, options = {}) {
  const current = readRecoveryRecord(runDir) || {};
  const now = options.now || new Date().toISOString();
  const next = {
    ...current,
    ...patch,
    version: 1,
    updated_at: now,
  };
  if (!next.created_at) next.created_at = now;
  atomicWriteJson(join(runDir, RECOVERY_FILE), next);
  return next;
}

export function loadInterruptedP2PRecoveryPlans(runRoot) {
  const plans = [];
  const warnings = [];
  if (!existsSync(runRoot)) return { plans, warnings };

  for (const entry of readdirSync(runRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const runDir = resolve(runRoot, entry.name);
    const record = readRecoveryRecord(runDir);
    if (!record) {
      if (existsSync(join(runDir, RECOVERY_FILE))) {
        warnings.push(`${entry.name}: invalid recovery.json`);
      }
      continue;
    }
    if (record.kind !== "p2p-session-send") continue;
    if (!["running", "recovering"].includes(record.status)) continue;

    const validationError = validateP2PRecoveryRecord(record, entry.name);
    if (validationError) {
      warnings.push(`${entry.name}: ${validationError}`);
      continue;
    }

    const phase = String(record.phase || "executing");
    const mode = phase === "delivering"
      ? "deliver"
      : record.thread_id && record.turn_started !== false
        ? "resume"
        : "restart";
    plans.push({
      mode,
      runId: entry.name,
      runDir,
      record,
    });
  }

  plans.sort((a, b) => {
    const left = Date.parse(a.record.created_at || "") || 0;
    const right = Date.parse(b.record.created_at || "") || 0;
    return left - right || a.runId.localeCompare(b.runId);
  });
  return { plans, warnings };
}

export function recoveryTaskDescriptor(item = {}) {
  const event = item.event || {};
  const recovery = item.options?.recovery || item.recovery || {};
  return {
    kind: item.kind || "one-off",
    alias: item.command?.alias || recovery.alias || "",
    event_id: String(event.event_id || ""),
    message_id: String(event.message_id || ""),
    run_id: String(recovery.runId || ""),
  };
}

export function isShutdownInterruption(result = {}, shuttingDown = false) {
  return Number(result.code) !== 0 && shuttingDown;
}

export function isTerminationSignalResult(result = {}) {
  if (Number(result.code) === 0) return false;
  const detail = `${result.stderr || ""}\n${result.error || ""}`;
  return /\b(?:exited by signal|terminated by)\s+SIG(?:TERM|INT)\b/i.test(detail);
}

export function recoveryDeliverySteps(record = {}) {
  return {
    reply: record.reply_delivered !== true,
    artifacts: record.outcome === "completed" && record.artifacts_delivered !== true,
  };
}

function validateP2PRecoveryRecord(record, runId) {
  if (!record.event || typeof record.event !== "object") return "missing event";
  if (!String(record.event.event_id || "")) return "missing event_id";
  if (!String(record.event.message_id || "")) return "missing message_id";
  if (!String(record.event.chat_id || "")) return "missing chat_id";
  if (!String(record.event.sender_id || "")) return "missing sender_id";
  if (typeof record.prompt !== "string" || !record.prompt.trim()) return "missing prompt";
  if (!String(record.alias || "")) return "missing alias";
  if (record.run_id && basename(String(record.run_id)) !== runId) return "run_id mismatch";
  if (record.phase === "delivering" && !["completed", "failed"].includes(record.outcome)) {
    return "delivery phase is missing a valid outcome";
  }
  return "";
}

function atomicWriteJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

function isReplyTarget(value) {
  if (!value || typeof value !== "object") return false;
  if (value.kind === "chat") return Boolean(value.chatId);
  if (value.kind === "user") return Boolean(value.userId);
  return false;
}

function positiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeInteger(value, fallback) {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}
