// https://github.com/oven-sh/bun/issues/11083

import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

test(
  "bun --hot should not accumulate stale code blocks or ref-string entries when file content changes on every reload",
  async () => {
    using dir = tempDir("hot-11083", {});
    const root = join(String(dir), "leak-runner.mjs");

    // Small file so debug builds cycle faster than JSC's ~10s CodeCache prune
    // timer; unique content each iteration so the cache key never repeats.
    const writeSource = (iter: number) => {
      writeFileSync(
        root,
        `var unused_${iter} = ${iter};
Bun.gc(true);
globalThis.__i = (globalThis.__i ?? 0) + 1;
const s = require("bun:jsc").heapStats();
const { refStringsCount } = require("bun:internal-for-testing");
console.error(JSON.stringify({
  i: globalThis.__i,
  umpcb: s.objectTypeCounts.UnlinkedModuleProgramCodeBlock || 0,
  refs: refStringsCount(),
}));
`,
      );
    };

    let iter = 0;
    writeSource(++iter);

    await using runner = spawn({
      cmd: [bunExe(), "--hot", "run", root],
      env: bunEnv,
      cwd: String(dir),
      stdout: "ignore",
      stderr: "pipe",
      stdin: "ignore",
    });

    const target = 50;
    let maxCodeBlocks = 0;
    let maxRefStrings = 0;
    let reached = 0;
    let buf = "";
    outer: for await (const chunk of runner.stderr!) {
      buf += new TextDecoder().decode(chunk);
      let nl: number;
      let progressed = false;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.startsWith("{")) {
          if (/Watcher crashed|panic:|oh no:|TypeError:|is not a function/.test(line)) {
            throw new Error("child --hot died: " + line);
          }
          continue;
        }
        const { i, umpcb, refs } = JSON.parse(line);
        reached = i;
        maxCodeBlocks = Math.max(maxCodeBlocks, umpcb);
        maxRefStrings = Math.max(maxRefStrings, refs);
        progressed = true;
        if (i >= target) {
          runner.kill();
          break outer;
        }
      }
      if (progressed) writeSource(++iter);
    }

    expect(reached).toBe(target);
    expect(maxCodeBlocks).toBeLessThan(10);
    expect(maxRefStrings).toBeGreaterThan(0);
    expect(maxRefStrings).toBeLessThan(10);
  },
  isDebug ? 60_000 : 20_000,
);
