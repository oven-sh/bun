// require(esm) drives the C++ module loader through a private microtask queue
// (vm.m_synchronousModuleQueue). The queue's Vector buffer lives on the heap,
// so a GC during the drain loop could collect the queued ModuleLoadingContext
// cells and another import's context would later be allocated at the same
// address — surfacing as e.g. `Export named 'beforeAll' not found in module
// 'node:fs'`. Reproduced with BUN_JSC_collectContinuously=1.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("require(esm) sync queue is a GC root", async () => {
  using dir = tempDir("require-esm-gc-roots", {
    "many.mjs": `
      import { gc } from "bun";
      import { heapStats } from "bun:jsc";
      import { test, expect, beforeAll } from "bun:test";
      import { ChildProcess } from "child_process";
      import { readdir } from "fs/promises";
      import fs, { closeSync } from "node:fs";
      import os from "node:os";
      import { dirname } from "path";
      import * as dep from "./dep.ts";
      export const ok =
        typeof beforeAll === "function" &&
        typeof fs.readFileSync === "function" &&
        typeof os.platform === "function" &&
        dep.x === 1;
      void gc; void heapStats; void test; void expect; void ChildProcess; void readdir; void closeSync; void dirname;
    `,
    "dep.ts": `
      import { join } from "path";
      import { readFileSync } from "node:fs";
      export const x = 1;
      void join; void readFileSync;
    `,
    "entry.cjs": `
      const m = require("./many.mjs");
      if (!m.ok) throw new Error("import resolution mixup");
      console.log("ok");
    `,
  });

  const runs = Array.from({ length: 30 }, async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--smol", "entry.cjs"],
      env: { ...bunEnv, BUN_JSC_collectContinuously: "1" },
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  });
  await Promise.all(runs);
}, 30000);
