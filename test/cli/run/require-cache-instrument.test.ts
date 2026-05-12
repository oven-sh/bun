// Heap-instrumentation harness for the `require-cache.test.ts` "via import()
// with a lot of long export names" leak (61 MB / 250 iters on darwin-aarch64,
// ~2 MB on linux). Prints per-iteration deltas of three independent counters
// so CI logs pinpoint *which* allocator the ~244 KB/iter lives in:
//
//   bunStringRefBalance — net +1 refs the Rust side holds against
//     `WTF::StringImpl`. Linear growth = forgotten `.deref()` (the
//     BunString-RAII hypothesis). Per-iter delta is exact for the loop's
//     code path even though the absolute value can drift.
//   mimallocCommit      — `mi_process_info().current_commit`: covers
//     `bun.default_allocator` + every `MimallocArena` (AstAlloc, transpile
//     arena). Does NOT include WTF/bmalloc, so a BunString leak shows up
//     above, not here.
//   liveArenaHeaps      — debug-only count of live `MimallocArena` heaps.
//
// The test always "passes" so it doesn't gate CI; the diagnostic table is
// the deliverable. The macOS `leaks` variant is the ground-truth backtrace.

import { describe, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

describe("require-cache leak instrumentation", () => {
  test("per-iteration heapStats deltas (import() + 10k long export names)", async () => {
    let text = "";
    for (let i = 0; i < 10000; i++) {
      text += `export const superDuperExtraCrazyLongNameWowSuchNameLongYouveNeverSeenANameThisLongForACommonJSModuleExport${i} = 1;\n`;
    }

    const dir = tempDirWithFiles("require-cache-instrument", {
      "index.js": text,
      "fixture.mjs": `
        const path = require.resolve("./index.js");
        const gc = globalThis?.Bun?.gc || (() => {});
        const heapStats = globalThis?.Bun?.unsafe?.heapStats || (() => ({}));

        function snap() {
          gc(true);
          const h = heapStats();
          return {
            rss: process.memoryUsage.rss(),
            commit: h.mimallocCommit ?? 0,
            balance: h.bunStringRefBalance ?? 0,
            arenas: h.liveArenaHeaps ?? 0,
          };
        }

        // Warm up: stabilize JIT, lazy singletons, first-touch pages.
        for (let i = 0; i < 30; i++) { await import(path); delete require.cache[path]; }

        const rows = [];
        let prev = snap();
        const SAMPLE_EVERY = 10;
        for (let i = 1; i <= 200; i++) {
          await import(path);
          delete require.cache[path];
          if (i % SAMPLE_EVERY === 0) {
            const cur = snap();
            rows.push({
              iter: i,
              dRssKB:    ((cur.rss    - prev.rss)    / 1024) | 0,
              dCommitKB: ((cur.commit - prev.commit) / 1024) | 0,
              dBalance:    cur.balance - prev.balance,
              dArenas:     cur.arenas  - prev.arenas,
            });
            prev = cur;
          }
        }

        // Mean of the last half (post-warmup steady state):
        const tail = rows.slice(rows.length >> 1);
        const mean = (k) => (tail.reduce((s,r)=>s+r[k],0) / tail.length / SAMPLE_EVERY).toFixed(1);

        process.stdout.write(JSON.stringify({
          platform: process.platform + "-" + process.arch,
          perIterMean: {
            rssKB:    +mean("dRssKB"),
            commitKB: +mean("dCommitKB"),
            balance:  +mean("dBalance"),
            arenas:   +mean("dArenas"),
          },
          rows,
        }, null, 2) + "\\n");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--smol", join(dir, "fixture.mjs")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    // Surface the diagnostic table in the test log unconditionally.
    console.log(stdout);

    const out = JSON.parse(stdout.trim());
    const m = out.perIterMean;
    console.log(
      `[require-cache-instrument] ${out.platform}: ` +
        `rss=${m.rssKB}KB/iter mimallocCommit=${m.commitKB}KB/iter ` +
        `bunStringRefBalance=${m.balance}/iter liveArenaHeaps=${m.arenas}/iter`,
    );
    if (m.balance >= 1) {
      console.log(
        `[require-cache-instrument] LEAK: ${m.balance} BunString refs/iter — ` +
          `Rust-side forgotten .deref() (BunString-RAII hypothesis CONFIRMED)`,
      );
    }
    if (m.commitKB >= 64) {
      console.log(
        `[require-cache-instrument] LEAK: ${m.commitKB}KB/iter in mimalloc — ` +
          `AstAlloc / MimallocArena retention (NOT a BunString leak)`,
      );
    }

    // Assert exit-code only; the diagnostic printout is the deliverable.
    if (exitCode !== 0) throw new Error("fixture exited " + exitCode);
  }, 60000);

  // Ground truth on darwin: `leaks --atExit` walks the heap at exit and
  // prints the allocation backtrace for every block with no live reference.
  // Requires MallocStackLogging; the 30-iter loop is enough to surface the
  // per-iter leak without making the malloc-log explode.
  test.skipIf(process.platform !== "darwin")(
    "darwin: `leaks --atExit` allocation backtraces",
    async () => {
      let text = "";
      for (let i = 0; i < 10000; i++) {
        text += `export const superDuperExtraCrazyLongNameWowSuchNameLongYouveNeverSeenANameThisLongForACommonJSModuleExport${i} = 1;\n`;
      }
      const dir = tempDirWithFiles("require-cache-leaks-tool", {
        "index.js": text,
        "fixture.mjs": `
          const path = require.resolve("./index.js");
          for (let i = 0; i < 30; i++) { await import(path); delete require.cache[path]; }
          Bun.gc(true);
        `,
      });

      await using proc = Bun.spawn({
        cmd: ["/usr/bin/leaks", "--atExit", "--", bunExe(), "run", "--smol", join(dir, "fixture.mjs")],
        env: { ...bunEnv, MallocStackLogging: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // `leaks` prints one block per leaked allocation, grouped by backtrace.
      // Surface the summary line + the top backtrace groups.
      const lines = stdout.split("\n");
      const summary = lines.find(l => l.includes("leaks for")) ?? "(no leaks summary line)";
      console.log("[require-cache-instrument][leaks]", summary);

      // Extract the "STACK" backtrace groups (each starts with a count + bytes).
      const stackHeader = /^\s*\d+\s+\(\d[\d.]*[KMG]?\)/;
      const groups: string[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (stackHeader.test(lines[i]) && lines[i + 1]?.includes("STACK")) {
          groups.push(lines.slice(i, i + 20).join("\n"));
        }
      }
      // Print the top 5 by appearance order (leaks already sorts by total bytes).
      for (const g of groups.slice(0, 5)) {
        console.log("[require-cache-instrument][leaks-backtrace]\n" + g);
      }

      // `leaks` exits non-zero when leaks are found; don't fail the test on
      // that — the backtraces in the log are the deliverable.
      void exitCode;
      void stderr;
    },
    120000,
  );
});
