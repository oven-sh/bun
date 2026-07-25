// https://github.com/oven-sh/bun/issues/11083
//
// Each --hot reload of an edited file inserted a new UnlinkedModuleProgramCodeBlock
// into JSC's CodeCache (keyed by source text) that holds a Strong<> to the
// SourceProvider and its source string. On top of that, ref_counted_resolved_source()
// leaked the +1 from create_external() so the duped source bytes and ref_strings
// map slot survived forever even after the owning SourceProvider was collected.
// reload() now clears the CodeCache and the ref is balanced.

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

    // Keep the file small so even a debug build cycles fast enough to outrun
    // JSC's ~10s CodeCache prune timer. Content is unique every iteration so
    // the cache key (source hash) never repeats.
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
  refs: typeof refStringsCount === "function" ? refStringsCount() : 0,
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
          if (/Watcher crashed|panic:|oh no:/.test(line)) {
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

    // With the CodeCache cleared on every reload only the current module
    // graph's blocks survive a sync GC (bun:main + this file = 2). Without it,
    // one entry is added per reload and none are evicted inside the first
    // ~10s, so this climbs to ~target.
    expect(maxCodeBlocks).toBeLessThan(10);

    // ref_strings is native-heap (Box<[u8]> + ExternalStringImpl) and invisible
    // to heapStats(); without the refcount balance fix each distinct transpiled
    // source leaks a map slot forever (climbs to ~target). With the fix, entries
    // self-remove when their SourceProvider is collected so only the current
    // file's entry (plus a small number from builtin modules) survives.
    expect(maxRefStrings).toBeLessThan(10);
  },
  isDebug ? 60_000 : 20_000,
);
