// NodeVMModule::visitChildrenImpl iterates m_resolveCache.values() on the
// concurrent GC thread while NodeVMSourceTextModule::link() calls
// m_resolveCache.set() on the mutator. A set()-triggered rehash frees the
// old bucket array mid-iteration → WTF::HashTable's debug iterator-validity
// assert (`ASSERTION FAILED: m_table`) or heap-use-after-free under ASAN.
// Both sides now take cellLock() (same pattern as JSC's AbstractModuleRecord).
//
// collectContinuously runs a dedicated collector thread so marking overlaps
// the link() loop; useGenerationalGC=0 makes every cycle a full mark so the
// freshly-allocated SourceTextModule is actually visited while link()
// populates its cache. 500 specifiers per module → the WTF::HashMap rehashes
// ~9× per link() call.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// collectContinuously is very slow under Windows + ASAN in CI; the code path
// is identical on Linux/macOS, so skip Windows to keep duration reasonable.
test.skipIf(isWindows)(
  "vm.SourceTextModule link() m_resolveCache survives concurrent GC",
  async () => {
    const fixture = `
      const vm = require("node:vm");

      const N = 500;
      let src = "";
      for (let i = 0; i < N; i++) src += "import {} from 'm" + i + "';\\n";
      src += "export default 0;\\n";

      const deps = new Map();
      for (let i = 0; i < N; i++) {
        deps.set("m" + i, new vm.SyntheticModule([], function () {}, { identifier: "m" + i }));
      }
      const linker = spec => deps.get(spec);

      (async () => {
        // Create all modules up front so each one exists across several GC
        // cycles before link() mutates its m_resolveCache.
        const mods = [];
        for (let iter = 0; iter < 60; iter++) {
          mods.push(new vm.SourceTextModule(src, { identifier: "root" + iter }));
        }
        Bun.gc(true);
        for (const mod of mods) await mod.link(linker);
        console.log("ok");
      })().catch(e => {
        console.error(e);
        process.exit(1);
      });
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: {
        ...bunEnv,
        BUN_JSC_collectContinuously: "1",
        BUN_JSC_useGenerationalGC: "0",
      },
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Debug/ASAN builds print a "WARNING: ASAN interferes with JSC signal
    // handlers…" banner to stderr at startup; stdout === "ok" + exit 0 is the
    // real signal — a mid-rehash visit aborts before either.
    expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "ok", exitCode: 0 });
    void stderr;
  },
  120_000,
);
