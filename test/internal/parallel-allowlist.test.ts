import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const testDir = join(import.meta.dir, "..");
const table = JSON.parse(readFileSync(join(testDir, "parallel-allowlist.json"), "utf8"));

test("test/parallel-allowlist.json has the shape the runner reads", () => {
  expect(table._meta).toBeObject();
  expect(table.dirs).toBeArray();
  expect(table.excludeFiles).toBeArray();
  expect(table.dirs.length).toBeGreaterThan(100);
  for (const p of [...table.dirs, ...table.excludeFiles]) {
    expect(p).not.toContain("\\");
    expect(p).not.toStartWith("test/");
    expect(p).not.toStartWith("/");
  }
});

test("excludeFiles are real files inside listed dirs", () => {
  const dirs = new Set(table.dirs);
  const bad = table.excludeFiles.filter((f: string) => !dirs.has(dirname(f)) || !existsSync(join(testDir, f)));
  expect(bad).toEqual([]);
});

// scripts/update-parallel-allowlist.mjs rebuilds excludeFiles from scratch: a
// file is excluded only if it produced a flaky/error annotation in the scanned
// build window. A file that is already excluded runs serially, produces no
// annotation, and so gets dropped on the next regen, then flakes again once
// re-included (#36585 -> #36867 for inspect-error-leak, #36759 for
// request-clone-leak). Pin the in-process RSS/process-state leak tests here so
// a regen that drops one of them fails CI instead of reintroducing the flake.
// Remove an entry only after the test is made parallel-safe (subprocess
// isolation) or its directory leaves `dirs`.
const mustExclude = [
  "js/bun/shell/leak.test.ts",
  "js/bun/util/inspect-error-leak.test.js",
  "js/node/fs/fs-leak.test.js",
  "js/node/tls/node-tls-getpeercert-leak.test.ts",
  "js/third_party/body-parser/express-memory-leak.test.ts",
  "js/web/fetch/fetch-http2-leak.test.ts",
  "js/web/fetch/fetch-leak.test.ts",
  "js/web/fetch/fetch-stream-cancel-leak.test.ts",
  "js/web/request/request-clone-leak.test.ts",
  "js/web/streams/streams-leak.test.ts",
  "js/workerd/html-rewriter-leak.test.ts",
];

test("in-process RSS leak tests stay excluded from the parallel batch", () => {
  const excluded = new Set(table.excludeFiles);
  const dirs = new Set(table.dirs);
  const missing = mustExclude.filter(f => dirs.has(dirname(f)) && !excluded.has(f));
  expect(missing).toEqual([]);
});
