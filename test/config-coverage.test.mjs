import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test(".env.example documents every bridge configuration key", async () => {
  const source = await readFile(new URL("../src/bridge.mjs", import.meta.url), "utf8");
  const example = await readFile(new URL("../.env.example", import.meta.url), "utf8");
  const sourceKeys = new Set(
    [...source.matchAll(/env(?:Bool|List|SenderNameMap|SenderChatMap)?\(\s*"(LARK_CODEX_[A-Z0-9_]+)"/g)]
      .map((match) => match[1]),
  );
  const exampleKeys = new Set(
    [...example.matchAll(/^(LARK_CODEX_[A-Z0-9_]+)=/gm)].map((match) => match[1]),
  );
  const missing = [...sourceKeys].filter((key) => !exampleKeys.has(key)).sort();
  assert.deepEqual(missing, []);
  assert.equal(exampleKeys.has("LARK_CODEX_LAUNCHD_LABEL"), true);
});
