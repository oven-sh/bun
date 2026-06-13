// https://github.com/oven-sh/bun/issues/11083
//
// Each --hot reload of an edited file inserted a new UnlinkedModuleProgramCodeBlock
// into JSC's CodeCache (keyed by source text) that holds a Strong<> to the
// SourceProvider and its source string. The cache's prune only fires after
// ~10s elapsed or ~16MB accumulated, so a tight edit loop piled up stale
// entries unbounded. On top of that, the ref_strings source cache leaked its
// initial +1 ref so the duped source bytes survived even after the provider
// was collected. reload() now clears the CodeCache and the ref is balanced.

import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

test(
  "bun --hot should not accumulate stale code blocks when file content changes on every reload",
  async () => {
    using dir = tempDir("hot-11083", {});
    const root = join(String(dir), "leak-runner.mjs");

    // Keep the file small so even a debug build cycles fast enough to outrun
    // JSC's 10s CodeCache prune timer. Content is unique every iteration so
    // the cache key (source hash) never repeats.
    const writeSource = (iter: number) => {
      writeFileSync(
        root,
        `var unused_${iter} = ${iter};
Bun.gc(true);
globalThis.__i = (globalThis.__i ?? 0) + 1;
const s = require("bun:jsc").heapStats();
console.error(JSON.stringify({
  i: globalThis.__i,
  umpcb: s.objectTypeCounts.UnlinkedModuleProgramCodeBlock || 0,
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
    let reached = 0;
    let buf = "";
    outer: for await (const chunk of runner.stderr!) {
      buf += new TextDecoder().decode(chunk);
      let nl: number;
      let progressed = false;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.startsWith("{")) continue;
        const { i, umpcb } = JSON.parse(line);
        reached = i;
        maxCodeBlocks = Math.max(maxCodeBlocks, umpcb);
        progressed = true;
        if (i >= target) {
          runner.kill();
          break outer;
        }
      }
      if (progressed) writeSource(++iter);
    }

    expect(reached).toBe(target);

    // With the CodeCache cleared on every reload only the current module
    // graph's blocks survive a sync GC (bun:main + this file = 2). Without
    // it, one entry is added per reload and none are evicted inside the
    // first ~10s, so this climbs to ~target. The leaked code block pins
    // its SourceProvider and source string, so this single count covers
    // the whole chain; a heap-wide JSString delta would be noisier under
    // conservative GC / JIT tier-up without adding coverage.
    expect(maxCodeBlocks).toBeLessThan(10);
  },
  isDebug ? 60_000 : 20_000,
);
