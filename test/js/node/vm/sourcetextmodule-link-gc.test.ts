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
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

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

// computeErrorInfoWrapperToString (src/jsc/bindings/FormatStackTraceForJS.cpp,
// installed via vm.setOnComputeErrorInfo) runs from ErrorInstance::
// finalizeUnconditionally during Heap::runEndPhase. It used to clear whatever
// exception was pending after computing a stack string. With concurrent GC,
// that finalizer lands at an arbitrary safepoint: if it fires while the mutator
// is mid vm.SourceTextModule evaluation with a module's evaluation error
// pending, it nulled that exception. CyclicModuleRecord::evaluate step 9.d then
// reached rejectWithCaughtException with no pending exception and crashed
// (`ASSERTION FAILED: exception` at JSPromise.cpp, or a SEGV at 0x8 on release).
// The fix only swallows an exception the stack computation itself raised.
//
// The race depends on concurrent GC landing in that window: --smol shrinks the
// heap so collections run often enough to hit it on essentially every run of
// the unfixed assert build, while collectContinuously moves the window and
// hides it. The fixture is a real file (a -e eval script has no source URL, so
// the stack-trace finalizer takes a different path and doesn't fire). The
// processes run one at a time (concurrency starves the collector and hides the
// race); a single crash fails the test.
test.skipIf(isWindows)(
  "vm.SourceTextModule evaluation error survives a concurrent-GC stack-trace finalizer",
  async () => {
    const fixture = `
      import * as vm from "node:vm";
      let UREJ = 0;
      process.on("unhandledRejection", () => { UREJ++; });
      const sl = async () => { await new Promise(r => setTimeout(r, 12)); for (let i = 0; i < 8; i++) await null; };
      const CA = async f => { try { return await f(); } catch (e) { return e; } };
      const ni = () => { throw new Error("noimports"); };
      const M = (src, id, o) => new vm.SourceTextModule(src, { identifier: id, ...o });

      async function fam(sd) {
        { const bad = M("throw new TypeError('boom')", "s1bad" + sd), a = M("import 'bad'; export const x=1;", "s1a" + sd), b = M("import 'bad'; export const y=2;", "s1b" + sd);
          await a.link(() => bad); await b.link(() => bad);
          try { await a.evaluate(); } catch {} try { await b.evaluate(); } catch {} try { await a.evaluate(); } catch {}
          await CA(() => bad.evaluate()); }
        { const ctx = vm.createContext({ log: [] });
          const leaf = M("log.push('L0'); export const v = await Promise.resolve(7); log.push('L1');", "s2l" + sd, { context: ctx });
          const mid = M("import {v} from 'l'; export const m=v+1;", "s2m" + sd, { context: ctx });
          const root = M("import {m} from 'm'; export const r=m+1;", "s2r" + sd, { context: ctx });
          const map = { l: leaf, m: mid }; await root.link(s => map[s]);
          const ep = root.evaluate(); await CA(async () => { await ep; }); await CA(() => root.evaluate()); }
        { const leaf = M("await 0; throw new URIError('tla');", "s3l" + sd), a = M("import 'l'; export const x=1;", "s3a" + sd), b = M("import 'l'; export const y=1;", "s3b" + sd);
          await a.link(() => leaf); await b.link(() => leaf);
          try { await a.evaluate(); } catch {} try { await b.evaluate(); } catch {} try { await leaf.evaluate(); } catch {} }
        { const m = M("export const a=1;", "s5" + sd); await m.link(ni); await m.evaluate();
          const bad = M("null.x", "s5b" + sd); await bad.link(ni); await bad.evaluate().catch(() => {}); }
        { const val = ["str", "num", "null", "undef", "obj", "sym"][sd % 6];
          const src = { str: "throw 'x'", num: "throw 42", null: "throw null", undef: "throw undefined", obj: "throw {a:1}", sym: "throw Symbol.iterator" }[val];
          const m = M(src, "s6" + sd); await m.link(ni); await CA(() => m.evaluate()); }
        await CA(async () => { await sl(); return UREJ; });
      }
      for (let sd = 0; sd < 60; sd++) await fam(sd);
      console.log("ok");
    `;

    using dir = tempDir("vm-module-eval-error-gc", { "fixture.mjs": fixture });

    async function run() {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--smol", "--experimental-vm-modules", "fixture.mjs"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
        stdout: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout: stdout.trim(), stderr, exitCode };
    }

    for (let i = 0; i < 4; i++) {
      const { stdout, stderr, exitCode } = await run();
      expect({ stdout, exitCode }).toEqual({ stdout: "ok", exitCode: 0 });
      void stderr;
    }
  },
  120_000,
);
