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
import { bunEnv, bunExe, isDebug, tempDirWithFiles } from "harness";
import { join } from "path";

// Debug builds parse/link the 10k-export module ~20× slower (no JIT, debug
// asserts in JSC's parser + module-record builder), so 230 imports × ~4 s
// blows past any sane timeout. The instrumentation counters (dBalance,
// dProviders, dBmAlloc) are per-iteration ratios and don't depend on the
// absolute export count — scale the workload down in debug so the test still
// produces its diagnostic table locally, and keep the full 10k/200 in
// release CI where the RSS amplitude matters.
const EXPORTS = isDebug ? 1000 : 10000;
const WARMUP = isDebug ? 10 : 30;
const ITERS = isDebug ? 60 : 200;

describe("require-cache leak instrumentation", () => {
  test("per-iteration heapStats deltas (import() + 10k long export names)", async () => {
    let text = "";
    for (let i = 0; i < EXPORTS; i++) {
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
            // libpas summary of every fastMalloc/IsoHeap/Gigacage heap —
            // covers WTF::StringImpl, AtomStringTable, SourceProvider source,
            // UnlinkedCodeBlock. 0 on non-libpas builds.
            bmAlloc: h.bmallocAllocated ?? 0,
            bmCommit: h.bmallocCommitted ?? 0,
            bmFree: h.bmallocFree ?? 0,
            // Zig::SourceProvider live-instance count (ctor++ / dtor--).
            // After removeEntry → GC sweeps JSModuleRecord →
            // ~JSModuleRecord drops m_sourceCode's RefPtr<SourceProvider> →
            // ~SourceProvider runs. CodeCache pins exactly ONE survivor (the
            // SourceCodeKey for iter-0 holds a RefPtr<SourceProvider>; later
            // iters hash-match it under BUN_JSC_ADDITIONS so don't add).
            // dProviders ≈ 0/iter ⇒ the whole module-record graph IS being
            // collected and the 31KB/iter darwin RSS is libpas page retention,
            // not a held ref.
            providers: h.zigSourceProviderLive ?? 0,
          };
        }

        // Warm up: stabilize JIT, lazy singletons, first-touch pages.
        for (let i = 0; i < ${WARMUP}; i++) { await import(path); delete require.cache[path]; }

        const rows = [];
        let prev = snap();
        const SAMPLE_EVERY = 10;
        for (let i = 1; i <= ${ITERS}; i++) {
          await import(path);
          delete require.cache[path];
          if (i % SAMPLE_EVERY === 0) {
            const cur = snap();
            rows.push({
              iter: i,
              dRssKB:      ((cur.rss      - prev.rss)      / 1024) | 0,
              dCommitKB:   ((cur.commit   - prev.commit)   / 1024) | 0,
              dBalance:      cur.balance  - prev.balance,
              dArenas:       cur.arenas   - prev.arenas,
              dBmAllocKB:  ((cur.bmAlloc  - prev.bmAlloc)  / 1024) | 0,
              dBmCommitKB: ((cur.bmCommit - prev.bmCommit) / 1024) | 0,
              dBmFreeKB:   ((cur.bmFree   - prev.bmFree)   / 1024) | 0,
              dProviders:    cur.providers - prev.providers,
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
            rssKB:      +mean("dRssKB"),
            commitKB:   +mean("dCommitKB"),
            balance:    +mean("dBalance"),
            arenas:     +mean("dArenas"),
            bmAllocKB:  +mean("dBmAllocKB"),
            bmCommitKB: +mean("dBmCommitKB"),
            bmFreeKB:   +mean("dBmFreeKB"),
            providers:  +mean("dProviders"),
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
        `bunStringRefBalance=${m.balance}/iter liveArenaHeaps=${m.arenas}/iter ` +
        `bmallocAllocated=${m.bmAllocKB}KB/iter bmallocCommitted=${m.bmCommitKB}KB/iter ` +
        `bmallocFree=${m.bmFreeKB}KB/iter zigSourceProviderLive=${m.providers}/iter`,
    );
    if (Math.abs(m.providers) >= 0.5) {
      console.log(
        `[require-cache-instrument] LEAK: ${m.providers} Zig::SourceProvider/iter survive ` +
          `\`delete require.cache\` + GC — JSModuleRecord (or another RefPtr<SourceProvider> holder: ` +
          `ModuleProgramExecutable, CodeCache SourceCodeKey, IsolatedModuleCache) is NOT being collected. ` +
          `This is the held-ref case; the 31KB/iter is real.`,
      );
    } else {
      console.log(
        `[require-cache-instrument] zigSourceProviderLive flat — JSModuleLoader::removeEntry → GC ` +
          `IS dropping JSModuleRecord/ModuleProgramExecutable/SourceProvider each iter ` +
          `(m_exportEntries/m_lexicalVariables freed via ~JSModuleRecord). ` +
          `If RSS still grows, it's bmalloc/libpas page retention, not a module-graph ref.`,
      );
    }
    if (m.bmAllocKB >= 8) {
      console.log(
        `[require-cache-instrument] LEAK: ${m.bmAllocKB}KB/iter retained in bmalloc/libpas — ` +
          `WTF::StringImpl / AtomStringTable / SourceProvider / UnlinkedCodeBlock retention ` +
          `(JSC-side, NOT mimalloc and NOT a Rust deref bug). ` +
          `bmallocCommitted growth=${m.bmCommitKB}KB/iter explains the darwin RSS delta.`,
      );
    } else if (m.bmCommitKB >= 8) {
      console.log(
        `[require-cache-instrument] NOTE: bmalloc committed grows ${m.bmCommitKB}KB/iter but ` +
          `allocated stays flat (${m.bmAllocKB}KB/iter) — fragmentation/decommit-lag, not a leak.`,
      );
    }
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

  // JSC-heap angle. dBalance=0 and mimallocCommit=0 rule out the Rust side
  // and mimalloc; the vmmap test below attributes the ~31 KB/iter on darwin
  // to a specific malloc zone, but not to a specific *class*. This test
  // snapshots `bun:jsc` heapStats() — which does a full sync GC and then a
  // per-cell-class census via Heap::objectTypeCounts() — at iter 10 and
  // iter 100, and diffs:
  //   • objectTypeCounts        — every live JSCell, bucketed by ClassInfo name
  //   • protectedObjectTypeCounts — JSCells with a non-zero protect count
  //   • heapSize / extraMemorySize — GC-heap bytes vs. reportExtraMemory bytes
  // A class whose count rises by ≈90 over 90 iters is the retained cell
  // (suspects: JSModuleRecord, ModuleNamespaceObject, JSModuleEnvironment,
  // ModuleProgramExecutable, UnlinkedModuleProgramCodeBlock, SymbolTable,
  // FunctionExecutable, Structure). A `string` row rising by ≈10 000/iter
  // means the 10k export-name JSStrings are pinned per generation. If NO
  // class moves but extraMemorySize climbs ≈31 KB/iter, the leak is non-cell
  // bmalloc that *is* reported to the GC (StringImpl backing, SourceProvider
  // text). If neither objectTypeCounts nor heapSize/extraMemorySize move,
  // the 31 KB is outside the GC's accounting entirely → bmalloc page
  // retention / scavenger behaviour (darwin MADV_FREE_REUSABLE vs linux
  // MADV_FREE), i.e. fragmentation, not a logical leak.
  test("JSC objectTypeCounts diff @10 vs @100 (import() + 10k long export names)", async () => {
    let text = "";
    for (let i = 0; i < EXPORTS; i++) {
      text += `export const superDuperExtraCrazyLongNameWowSuchNameLongYouveNeverSeenANameThisLongForACommonJSModuleExport${i} = 1;\n`;
    }
    // Same per-iter ratio logic applies: 10 warmup + N measured. Debug builds
    // can't afford 100 imports of a 10k-export module, but the
    // objectTypeCounts census is count-based — a class growing 1/iter shows
    // up identically over 30 measured iters as over 90.
    const measured = isDebug ? 30 : 90;

    const dir = tempDirWithFiles("require-cache-jsc-typecounts", {
      "index.js": text,
      "fixture.mjs": `
        const path = require.resolve("./index.js");
        const { heapStats } = require("bun:jsc");

        // Full-GC twice so Heap::deleteSourceProviderCaches (gated on
        // m_lastCollectionScope == Full) and the incremental sweeper both
        // settle before the census.
        function snap() {
          Bun.gc(true); Bun.gc(true);
          const h = heapStats();
          return {
            rss: process.memoryUsage.rss(),
            heapSize: h.heapSize,
            heapCapacity: h.heapCapacity,
            extraMemorySize: h.extraMemorySize,
            objectCount: h.objectCount,
            types: h.objectTypeCounts,
            protected: h.protectedObjectTypeCounts,
          };
        }

        // Warm up: stabilize JIT, lazy singletons, AtomString table (the 10k
        // export-name identifiers intern once and stay; that is NOT the
        // per-iter leak — it's the iter10→iter100 delta we care about).
        for (let i = 0; i < 10; i++) { await import(path); delete require.cache[path]; }
        const a = snap();

        for (let i = 0; i < ${measured}; i++) { await import(path); delete require.cache[path]; }
        const b = snap();

        const ITERS = ${measured};
        // Per-class delta, kept if |delta| >= ITERS/3 (i.e. plausibly ≥0.33/iter).
        const keys = new Set([...Object.keys(a.types), ...Object.keys(b.types)]);
        const typeDelta = [];
        for (const k of keys) {
          const d = (b.types[k] ?? 0) - (a.types[k] ?? 0);
          if (Math.abs(d) >= ITERS / 3) typeDelta.push([k, d, +(d / ITERS).toFixed(2)]);
        }
        typeDelta.sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));

        const protKeys = new Set([...Object.keys(a.protected), ...Object.keys(b.protected)]);
        const protDelta = [];
        for (const k of protKeys) {
          const d = (b.protected[k] ?? 0) - (a.protected[k] ?? 0);
          if (d !== 0) protDelta.push([k, d]);
        }

        process.stdout.write(JSON.stringify({
          platform: process.platform + "-" + process.arch,
          iters: ITERS,
          perIter: {
            rssKB:         +(((b.rss             - a.rss)             / ITERS / 1024).toFixed(1)),
            heapSizeB:     +(((b.heapSize        - a.heapSize)        / ITERS).toFixed(0)),
            heapCapacityB: +(((b.heapCapacity    - a.heapCapacity)    / ITERS).toFixed(0)),
            extraMemoryB:  +(((b.extraMemorySize - a.extraMemorySize) / ITERS).toFixed(0)),
            objectCount:   +(((b.objectCount     - a.objectCount)     / ITERS).toFixed(2)),
          },
          // [className, totalDelta, perIter] — the smoking gun if any row's
          // perIter ≈ 1 (one ModuleRecord-shaped cell pinned per import) or
          // ≈ 10000 (one cell per export name pinned per import).
          objectTypeCountsDelta: typeDelta,
          protectedObjectTypeCountsDelta: protDelta,
          // Raw checkpoints for offline diffing (full per-class tables).
          checkpoints: { at10: a, at100: b },
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
    console.log(stdout);

    const out = JSON.parse(stdout.trim());
    const p = out.perIter;
    console.log(
      `[require-cache-instrument][jsc] ${out.platform}: ` +
        `rss=${p.rssKB}KB/iter heapSize=${p.heapSizeB}B/iter ` +
        `heapCapacity=${p.heapCapacityB}B/iter extraMemory=${p.extraMemoryB}B/iter ` +
        `objectCount=${p.objectCount}/iter`,
    );
    for (const [cls, total, perIter] of out.objectTypeCountsDelta) {
      console.log(`[require-cache-instrument][jsc]   ${cls}: ${total >= 0 ? "+" : ""}${total} (${perIter}/iter)`);
    }
    for (const [cls, total] of out.protectedObjectTypeCountsDelta) {
      console.log(`[require-cache-instrument][jsc]   PROTECTED ${cls}: ${total >= 0 ? "+" : ""}${total}`);
    }
    // Self-contained interpretation in the CI log.
    if (out.objectTypeCountsDelta.length === 0 && Math.abs(p.heapSizeB) < 1024 && Math.abs(p.extraMemoryB) < 1024) {
      console.log(
        `[require-cache-instrument][jsc] no JSC cell class grows and heapSize/extraMemory are flat — ` +
          `the ${p.rssKB}KB/iter is NOT in the GC heap. Suspect bmalloc page retention ` +
          `(darwin scavenger holds MADV_FREE_REUSABLE pages dirty; linux MADV_FREE drops RSS) ` +
          `or a non-reported bmalloc owner (VM::sourceProviderCacheMap, AtomStringTable churn).`,
      );
    } else if (out.objectTypeCountsDelta.length === 0 && p.extraMemoryB >= 1024) {
      console.log(
        `[require-cache-instrument][jsc] no cell class grows but extraMemorySize climbs ` +
          `${p.extraMemoryB}B/iter — non-cell bmalloc reported via reportExtraMemoryAllocated ` +
          `(StringImpl backing / SourceProvider text) is retained across imports.`,
      );
    }

    if (exitCode !== 0) throw new Error("fixture exited " + exitCode);
  }, 120000);

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

  // Per-allocator-zone attribution on darwin. The heapStats run above shows
  // dBalance=0/iter (BunString refs balanced) and mimallocCommit=0/iter
  // (AstAlloc/transpile arena freed) yet RSS still grows ~31KB/iter on
  // darwin-aarch64. The remaining suspect is bmalloc (JSC/WTF heap), which
  // mimalloc's counters can't see. `vmmap -summary` reports DIRTY bytes per
  // named MALLOC zone (WebKit Malloc == bmalloc, DefaultMallocZone,
  // MALLOC_NANO) so diffing iter-10 vs iter-100 attributes the growth to a
  // specific zone. `heap -addresses StringImpl | wc -l` tracks the live
  // WTF::StringImpl population independently of our ref-balance counter — if
  // it climbs while dBalance stays 0, the leak is JSC-internal (Identifier
  // table, SourceProvider cache, UnlinkedCodeBlock strings) rather than a
  // forgotten Rust-side deref.
  test.skipIf(process.platform !== "darwin")(
    "darwin: vmmap per-zone diff + heap StringImpl count (iter 10 vs 100)",
    async () => {
      let text = "";
      for (let i = 0; i < 10000; i++) {
        text += `export const superDuperExtraCrazyLongNameWowSuchNameLongYouveNeverSeenANameThisLongForACommonJSModuleExport${i} = 1;\n`;
      }
      const dir = tempDirWithFiles("require-cache-vmmap", {
        "index.js": text,
        "fixture.mjs": `
          import { execFileSync } from "node:child_process";
          const path = require.resolve("./index.js");
          const pid = String(process.pid);
          const gc = globalThis?.Bun?.gc || (() => {});

          function vmmap() {
            try { return execFileSync("/usr/bin/vmmap", ["-summary", pid], { encoding: "utf8", maxBuffer: 16*1024*1024 }); }
            catch (e) { return "vmmap-failed: " + (e?.message ?? e); }
          }
          function stringImplCount() {
            // 'heap -addresses <pattern>' prints one line per live object whose
            // class name matches; wc the lines. Pattern matches WTF::StringImpl
            // and JSC AtomStringImpl/SymbolImpl subclasses.
            try {
              const out = execFileSync("/bin/sh", ["-c", "/usr/bin/heap " + pid + " -addresses 'StringImpl' 2>/dev/null | wc -l"], { encoding: "utf8" });
              return parseInt(out.trim(), 10) || 0;
            } catch { return -1; }
          }

          // Warm up: stabilize JIT, lazy singletons, first-touch pages.
          for (let i = 0; i < 30; i++) { await import(path); delete require.cache[path]; }
          gc(true);

          const checkpoints = {};   // iter -> { vmmap: string, stringImpl: number }
          const stringImplSeries = [];

          for (let i = 1; i <= 100; i++) {
            await import(path);
            delete require.cache[path];
            if (i % 10 === 0) {
              gc(true);
              const n = stringImplCount();
              stringImplSeries.push({ iter: i, stringImpl: n });
              if (i === 10 || i === 100) checkpoints[i] = { vmmap: vmmap(), stringImpl: n };
            }
          }

          process.stdout.write(JSON.stringify({ checkpoints, stringImplSeries }) + "\\n");
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", "--smol", join(dir, "fixture.mjs")],
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      if (exitCode !== 0) throw new Error("fixture exited " + exitCode);
      const out = JSON.parse(stdout.trim());

      // --- parse `vmmap -summary` ---------------------------------------
      // Two tables matter:
      //   REGION TYPE  (MALLOC_NANO, MALLOC_TINY, VM_ALLOCATE, ...)
      //   MALLOC ZONE  (WebKit Malloc == bmalloc, DefaultMallocZone, mimalloc if registered)
      // Columns: ... VIRTUAL  RESIDENT  DIRTY  SWAPPED ...  — DIRTY is what
      // counts toward RSS. Sizes print as "48.1M" / "4616K" / "0K" / "1024".
      const toBytes = (s: string): number => {
        const m = /^([\d.]+)([KMGT]?)$/.exec(s);
        if (!m) return NaN;
        const n = parseFloat(m[1]);
        return Math.round(n * ({ "": 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 }[m[2]] ?? 1));
      };
      type ZoneMap = Record<string, number>; // name -> DIRTY bytes
      const parseVmmap = (raw: string): { region: ZoneMap; zone: ZoneMap } => {
        const region: ZoneMap = {};
        const zone: ZoneMap = {};
        let section: "region" | "zone" | null = null;
        for (const line of raw.split("\n")) {
          if (/^REGION TYPE\b/.test(line)) {
            section = "region";
            continue;
          }
          if (/^MALLOC ZONE\b/.test(line)) {
            section = "zone";
            continue;
          }
          if (/^===/.test(line)) continue;
          if (/^TOTAL\b/.test(line) || line.trim() === "") {
            section = null;
            continue;
          }
          if (!section) continue;
          // Row layout: <name (may contain spaces)> <VIRTUAL> <RESIDENT> <DIRTY> <SWAPPED> ...
          // Greedy-match the name up to the first size token, then take col[2]=DIRTY.
          const m = /^(.+?)\s{2,}([\d.]+[KMGT]?)\s+([\d.]+[KMGT]?)\s+([\d.]+[KMGT]?)\s+([\d.]+[KMGT]?)/.exec(line);
          if (!m) continue;
          const name = m[1].replace(/_0x[0-9a-f]+$/i, "").trim(); // strip per-run zone address suffix
          const dirty = toBytes(m[4]);
          (section === "region" ? region : zone)[name] = ((section === "region" ? region : zone)[name] ?? 0) + dirty;
        }
        return { region, zone };
      };

      const v10 = parseVmmap(out.checkpoints["10"].vmmap);
      const v100 = parseVmmap(out.checkpoints["100"].vmmap);
      const ITERS = 90;

      const diffTable = (a: ZoneMap, b: ZoneMap) => {
        const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
        return keys
          .map(k => ({
            name: k,
            dKB: Math.round(((b[k] ?? 0) - (a[k] ?? 0)) / 1024),
            perIterKB: +(((b[k] ?? 0) - (a[k] ?? 0)) / 1024 / ITERS).toFixed(2),
          }))
          .filter(r => Math.abs(r.dKB) >= 4) // drop noise below 4KB total
          .sort((x, y) => y.dKB - x.dKB);
      };

      const zoneDiff = diffTable(v10.zone, v100.zone);
      const regionDiff = diffTable(v10.region, v100.region);

      console.log("[require-cache-instrument][vmmap] MALLOC ZONE dirty growth, iter 10 -> 100 (90 iters):");
      for (const r of zoneDiff) {
        const tag = /WebKit|bmalloc/i.test(r.name)
          ? "  <-- bmalloc/JSC"
          : /mimalloc/i.test(r.name)
            ? "  <-- mimalloc"
            : /Default|NANO/i.test(r.name)
              ? "  <-- system malloc"
              : "";
        console.log(`  ${r.name.padEnd(32)} ${String(r.dKB).padStart(8)} KB  (${r.perIterKB} KB/iter)${tag}`);
      }
      console.log("[require-cache-instrument][vmmap] REGION TYPE dirty growth, iter 10 -> 100:");
      for (const r of regionDiff) {
        console.log(`  ${r.name.padEnd(32)} ${String(r.dKB).padStart(8)} KB  (${r.perIterKB} KB/iter)`);
      }

      // --- StringImpl population over time ------------------------------
      const s = out.stringImplSeries as { iter: number; stringImpl: number }[];
      console.log("[require-cache-instrument][heap] live StringImpl count (every 10 iters):");
      console.log("  " + s.map(r => `${r.iter}:${r.stringImpl}`).join("  "));
      if (s.length >= 2 && s[0].stringImpl > 0) {
        const dPerIter = (s.at(-1)!.stringImpl - s[0].stringImpl) / (s.at(-1)!.iter - s[0].iter);
        console.log(
          `[require-cache-instrument][heap] StringImpl growth: ${dPerIter.toFixed(1)}/iter ` +
            `(${out.checkpoints["10"].stringImpl} -> ${out.checkpoints["100"].stringImpl})`,
        );
        if (dPerIter > 100) {
          console.log(
            `[require-cache-instrument] LEAK: ~${dPerIter.toFixed(0)} StringImpl/iter retained in bmalloc ` +
              `with bunStringRefBalance=0 — JSC-internal retention (AtomStringTable / Identifier / SourceProvider), ` +
              `not a Rust-side deref bug.`,
          );
        }
      }

      // Dump raw vmmap on parse failure so CI logs are still useful.
      if (zoneDiff.length === 0 && regionDiff.length === 0) {
        console.log("[require-cache-instrument][vmmap] parse produced no rows; raw iter-100 output:");
        console.log(out.checkpoints["100"].vmmap);
      }
    },
    300000,
  );
});
