#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const excluded = new Set([".git", ".lark-codex", "node_modules", "lark-im-resources", "outputs", "coverage"]);
const textExtensions = new Set(["", ".md", ".mjs", ".js", ".json", ".yaml", ".yml", ".sh", ".exp", ".example", ".svg"]);
const patterns = [
  { label: "concrete Lark open_id", regex: /\bou_[A-Za-z0-9]{16,}\b/g },
  { label: "concrete Lark chat_id", regex: /\boc_[A-Za-z0-9]{16,}\b/g },
  { label: "concrete Lark app_id", regex: /\bcli_[A-Za-z0-9]{12,}\b/g },
  { label: "OpenAI-style secret", regex: /\bsk-[A-Za-z0-9_-]{12,}\b/g },
  { label: "absolute macOS user path", regex: /\/Users\/[A-Za-z0-9._-]+/g },
  { label: "absolute macOS volume path", regex: /\/Volumes\/[A-Za-z0-9._-]+/g },
];

async function collect(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".env" || excluded.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await collect(path));
    else if (textExtensions.has(extname(entry.name))) result.push(path);
  }
  return result;
}

const findings = [];
for (const path of await collect(root)) {
  const text = await readFile(path, "utf8");
  for (const { label, regex } of patterns) {
    regex.lastIndex = 0;
    for (const match of text.matchAll(regex)) {
      findings.push(`${relative(root, path)}: ${label} ${match[0]}`);
    }
  }
}

if (findings.length > 0) {
  console.error("public tree check failed:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log("public tree check passed");
}
