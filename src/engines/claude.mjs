// Claude Code engine — drives the `claude` CLI headlessly (`claude -p`).
//
// Design (see PLAN §7): spawn-per-turn. A one-shot task or a resumed session
// turn each spawn a fresh `claude -p` process; long sessions are continued with
// `--resume <uuid>`. The engine is self-contained: it takes an explicit options
// object and an `onProgress(string)` callback, and returns
// `{ ok, code, sessionId, finalMessage, error, sessionMissing }`. It never
// touches the bridge's run-dir / card machinery.

import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isLikelyClaudeSessionId(id) {
  return typeof id === "string" && UUID_RE.test(id.trim());
}

// Claude Code stores transcripts under ~/.claude/projects/<slug>/<session-id>.jsonl
// where <slug> is the working directory with every non-alphanumeric byte replaced
// by "-" (verified empirically against a live run).
export function claudeProjectSlug(cwd) {
  return String(cwd || "").replace(/[^a-zA-Z0-9]/g, "-");
}

// Build the `claude` argv (excluding the prompt, which is fed on stdin).
// `permission` is the object returned by permissionToClaude().
export function buildClaudeArgs({ mode = "oneshot", sessionId = "", model = "", permission = {}, extraArgs = [] } = {}) {
  const args = ["-p", "--output-format", "stream-json", "--verbose"];
  if (model) args.push("--model", model);

  if (mode === "resume") {
    if (!sessionId) throw new Error("claude resume requires a sessionId");
    args.push("--resume", sessionId);
  } else if (sessionId) {
    // new / oneshot with a pre-assigned UUID
    args.push("--session-id", sessionId);
  }

  if (permission.permissionMode) args.push("--permission-mode", permission.permissionMode);
  if (permission.allowedTools && permission.allowedTools.length) {
    args.push("--allowedTools", permission.allowedTools.join(","));
  }
  if (permission.disallowedTools && permission.disallowedTools.length) {
    args.push("--disallowedTools", permission.disallowedTools.join(","));
  }
  if (permission.settings) args.push("--settings", JSON.stringify(permission.settings));
  if (permission.settingSources && permission.settingSources.length) {
    args.push("--setting-sources", permission.settingSources.join(","));
  }
  if (Array.isArray(extraArgs) && extraArgs.length) args.push(...extraArgs);
  return args;
}

// Translate one stream-json event into a human progress string (or null to skip).
// Mirrors the Codex describeCodexItemProgress taxonomy so the existing dynamic
// card renders identically.
export function describeClaudeEvent(evt) {
  if (!evt || typeof evt !== "object") return null;
  if (evt.type === "system") {
    if (evt.subtype === "init") return "Claude 已启动";
    return null;
  }
  if (evt.type === "assistant") {
    const content = (evt.message && evt.message.content) || [];
    for (const block of Array.isArray(content) ? content : []) {
      if (!block || typeof block !== "object") continue;
      if (block.type === "thinking") return "分析中";
      if (block.type === "tool_use") {
        const name = block.name || "工具";
        const input = block.input || {};
        if (name === "Bash") {
          const cmd = input.command || input.cmd || "";
          return cmd ? `执行命令：${compact(cmd)}` : "执行命令";
        }
        if (name === "Read" || name === "Glob" || name === "Grep") {
          const target = input.file_path || input.path || input.pattern || "";
          return target ? `读取/搜索：${compact(target)}` : "读取/搜索";
        }
        if (name === "Edit" || name === "Write" || name === "NotebookEdit") {
          const target = input.file_path || input.path || "";
          return target ? `写入：${compact(target)}` : "写入";
        }
        return `调用工具：${name}`;
      }
    }
  }
  return null;
}

// Pull the final answer + session id out of a terminal `result` event.
export function extractClaudeFinal(evt) {
  if (!evt || evt.type !== "result") return null;
  return {
    finalMessage: typeof evt.result === "string" ? evt.result : "",
    sessionId: evt.session_id || "",
    isError: Boolean(evt.is_error) || (evt.subtype && evt.subtype !== "success"),
    subtype: evt.subtype || "",
  };
}

// A resume that failed only because the session id is gone (pruned / not found).
export function isResumeMissError(text) {
  return /no conversation found|could not find|no session|session .*not found|unknown session/i.test(
    String(text || ""),
  );
}

function compact(value, maxChars = 160) {
  const s = String(value || "").replace(/\s+/g, " ").trim();
  return s.length > maxChars ? `${s.slice(0, maxChars - 1)}…` : s;
}

// Run a single Claude turn. Resolves (never rejects) with a result object.
export function runClaudeTurn(options = {}) {
  const {
    mode = "oneshot",
    sessionId = "",
    prompt = "",
    cwd = process.cwd(),
    permission = {},
    model = "",
    extraArgs = [],
    timeoutMs = 30 * 60 * 1000,
    bin = "claude",
    env = process.env,
    onProgress = () => {},
  } = options;

  const args = buildClaudeArgs({ mode, sessionId, model, permission, extraArgs });

  return new Promise((resolvePromise) => {
    let child;
    try {
      child = spawn(bin, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      resolvePromise({ ok: false, code: -1, sessionId, finalMessage: "", error: error.message, stdout: "", stderr: "" });
      return;
    }

    let stdout = "";
    let stderr = "";
    let buffer = "";
    let finalMessage = "";
    let resolvedSessionId = sessionId;
    let resultIsError = false;
    let settled = false;

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, timeoutMs);

    const handleLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let evt;
      try {
        evt = JSON.parse(trimmed);
      } catch {
        return;
      }
      if (evt.type === "system" && evt.subtype === "init" && evt.session_id) {
        resolvedSessionId = evt.session_id;
      }
      const final = extractClaudeFinal(evt);
      if (final) {
        finalMessage = final.finalMessage || finalMessage;
        if (final.sessionId) resolvedSessionId = final.sessionId;
        if (final.isError) resultIsError = true;
      }
      const progress = describeClaudeEvent(evt);
      if (progress) {
        try {
          onProgress(progress);
        } catch {
          /* ignore progress sink errors */
        }
      }
    };

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      buffer += text;
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        handleLine(line);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (buffer) handleLine(buffer);
      const combined = `${stderr}\n${stdout}`;
      const sessionMissing = mode === "resume" && (resultIsError || code !== 0) && isResumeMissError(combined);
      const ok = code === 0 && !resultIsError && Boolean(finalMessage);
      resolvePromise({
        ok,
        code: code == null ? -1 : code,
        sessionId: resolvedSessionId,
        finalMessage,
        error: ok ? "" : (stderr.trim() || (resultIsError ? "claude reported an error result" : `claude exited with code ${code}`)),
        sessionMissing,
        stdout,
        stderr,
      });
    };

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ ok: false, code: -1, sessionId: resolvedSessionId, finalMessage: "", error: error.message, sessionMissing: false, stdout, stderr });
    });
    child.on("close", (code) => finish(code));

    try {
      child.stdin.write(prompt);
      child.stdin.end();
    } catch {
      /* the process may have already exited */
    }
  });
}

// Discover long-lived Claude sessions from disk for a given working directory.
export function discoverClaudeSessions({ cwd, home = homedir(), limit = 20 } = {}) {
  const slug = claudeProjectSlug(cwd);
  const dir = join(home, ".claude", "projects", slug);
  if (!existsSync(dir)) return [];
  let files;
  try {
    files = readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
  } catch {
    return [];
  }
  const sessions = [];
  for (const file of files) {
    const path = join(dir, file);
    let mtimeMs = 0;
    try {
      mtimeMs = statSync(path).mtimeMs;
    } catch {
      continue;
    }
    const sessionId = file.replace(/\.jsonl$/, "");
    const meta = readClaudeSessionMeta(path);
    sessions.push({
      sessionId,
      cwd: meta.cwd || cwd,
      title: meta.preview ? truncate(meta.preview, 60) : sessionId,
      preview: meta.preview,
      mtimeMs,
    });
  }
  sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return sessions.slice(0, limit);
}

// Read the first useful user prompt + cwd from a transcript file.
export function readClaudeSessionMeta(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { cwd: "", preview: "" };
  }
  let cwd = "";
  let preview = "";
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (!cwd && obj.cwd) cwd = obj.cwd;
    if (!preview && obj.type === "user" && obj.message) {
      const content = obj.message.content;
      if (typeof content === "string") preview = content.trim();
      else if (Array.isArray(content)) {
        const textBlock = content.find((c) => c && c.type === "text" && typeof c.text === "string");
        if (textBlock) preview = textBlock.text.trim();
      }
    }
    if (cwd && preview) break;
  }
  return { cwd, preview };
}

function truncate(value, maxChars) {
  const s = String(value || "").replace(/\s+/g, " ").trim();
  return s.length > maxChars ? `${s.slice(0, maxChars - 1)}…` : s;
}
