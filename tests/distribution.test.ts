import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

void test("the project and its standalone userscript use GPL version 3 only", async () => {
  const artifact =
    process.env.YOUTUBE_TOOLS_ARTIFACT === "youtube-tools.debug.js"
      ? "youtube-tools.debug.js"
      : "youtube-tools.user.js";
  const [license, source] = await Promise.all([
    readFile(new URL("../LICENSE", import.meta.url), "utf8"),
    readFile(new URL(`../${artifact}`, import.meta.url), "utf8"),
  ]);
  assert.match(license, /GNU GENERAL PUBLIC LICENSE\s+Version 3,/);
  await assert.rejects(readFile(new URL("../LICENSE-MIT", import.meta.url)), {
    code: "ENOENT",
  });
  assert.match(source, /^\/\/ @license\s+GPL-3\.0-only$/m);
  assert.doesNotMatch(source, /^MIT License$/m);
});
