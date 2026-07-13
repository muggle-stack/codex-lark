import assert from "node:assert/strict";
import { stat, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

for (const readme of ["README.md", "README_EN.md"]) {
  test(`${readme} local links resolve`, async () => {
    const sourcePath = resolve(root, readme);
    const text = await readFile(sourcePath, "utf8");
    const targets = [...text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)]
      .map((match) => match[1].trim())
      .filter((target) => target && !target.startsWith("#") && !/^[a-z]+:/i.test(target));

    for (const target of targets) {
      const path = resolve(dirname(sourcePath), decodeURIComponent(target.split("#", 1)[0]));
      const metadata = await stat(path);
      assert.equal(metadata.isFile() || metadata.isDirectory(), true, `${readme}: missing ${target}`);
    }
  });
}

test("README preview image is a non-empty PNG", async () => {
  const path = resolve(root, "docs/assets/codex-lark-progress-demo.png");
  const data = await readFile(path);
  assert.equal(data.subarray(1, 4).toString("ascii"), "PNG");
  assert.ok(data.length > 10_000);
});
